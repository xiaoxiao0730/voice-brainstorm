import { createServerFn } from "@tanstack/react-start";
import { Output, generateText } from "ai";
import { z } from "zod";

import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { createOpenAIProvider, normalizeAiModel, requireOpenAIKey } from "@/lib/ai-gateway.server";

const ThinkingStateSchema = z.object({
  current_goal: z.string().max(500).default(""),
  user_intent: z.string().max(500).default(""),
  assumptions: z.array(z.string().max(240)).max(8).default([]),
  open_questions: z.array(z.string().max(240)).max(8).default([]),
  promising_directions: z.array(z.string().max(240)).max(8).default([]),
  decision_points: z.array(z.string().max(240)).max(8).default([]),
  last_turn_id: z.string().max(120).nullable().default(null),
});

export type SessionThinkingState = z.infer<typeof ThinkingStateSchema>;

const EMPTY_STATE: SessionThinkingState = {
  current_goal: "",
  user_intent: "",
  assumptions: [],
  open_questions: [],
  promising_directions: [],
  decision_points: [],
  last_turn_id: null,
};

const UpdateInputSchema = z.object({
  sessionId: z.string().uuid(),
  turnId: z.string().min(1).max(120),
  latestTurn: z.string().min(1).max(8000),
  currentState: ThinkingStateSchema.default(EMPTY_STATE),
  briefText: z.string().max(6000).default(""),
  mapContext: z.string().max(4000).default(""),
  model: z.string().default("openai/gpt-4o-mini"),
});

const SYSTEM = `You maintain SESSION THINKING STATE for a real-time co-thinking workspace.

Update the state after the user's latest spoken thought. This state is the shared memory used by voice, brief, and canvas.

FIELDS
- current_goal: what the user is trying to figure out or make progress on now.
- user_intent: what kind of help the user seems to want from the agent.
- assumptions: claims or constraints the user is implicitly relying on.
- open_questions: unresolved questions that would unlock progress.
- promising_directions: paths that look worth exploring next.
- decision_points: choices the user may need to make or converge on.

RULES
- Preserve useful prior state, but update it when the latest turn changes direction.
- Remove stale or duplicate items.
- Ground everything in the user's words, brief, or canvas. Do not invent facts.
- Keep each item short and actionable.
- Match the user's language where possible. Keep product/technical terms unchanged.
- Return strict JSON only.`;

function normalizeState(input: unknown): SessionThinkingState {
  const parsed = ThinkingStateSchema.safeParse(input);
  return parsed.success ? parsed.data : EMPTY_STATE;
}

export function formatThinkingState(state: SessionThinkingState): string {
  const s = normalizeState(state);
  const list = (items: string[]) => (items.length ? items.map((item) => `- ${item}`).join("\n") : "- (none)");
  return [
    `current_goal: ${s.current_goal || "(unclear)"}`,
    `user_intent: ${s.user_intent || "(unclear)"}`,
    "assumptions:",
    list(s.assumptions),
    "open_questions:",
    list(s.open_questions),
    "promising_directions:",
    list(s.promising_directions),
    "decision_points:",
    list(s.decision_points),
  ].join("\n");
}

export const loadThinkingState = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) => z.object({ sessionId: z.string().uuid() }).parse(input))
  .handler(async ({ data, context }) => {
    const { data: row, error } = await context.supabase
      .from("session_thinking_state" as any)
      .select("*")
      .eq("session_id", data.sessionId)
      .maybeSingle();
    if (error) throw new Error(error.message);
    if (!row) return EMPTY_STATE;
    const r = row as any;
    return normalizeState({
      current_goal: r.current_goal ?? "",
      user_intent: r.user_intent ?? "",
      assumptions: r.assumptions ?? [],
      open_questions: r.open_questions ?? [],
      promising_directions: r.promising_directions ?? [],
      decision_points: r.decision_points ?? [],
      last_turn_id: r.last_turn_id ?? null,
    });
  });

export const updateThinkingStateFromTurn = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) => UpdateInputSchema.parse(input))
  .handler(async ({ data, context }) => {
    const apiKey = requireOpenAIKey();
    if (!apiKey) throw new Error("Missing OPENAI_API_KEY");

    const gateway = createOpenAIProvider(apiKey);
    const prompt = `CURRENT SESSION THINKING STATE:
${formatThinkingState(data.currentState)}

LATEST USER TURN:
${data.latestTurn}

LIVE BRIEF:
${data.briefText || "(empty)"}

IDEA CANVAS:
${data.mapContext || "(empty)"}

Return the updated session thinking state.`;

    let nextState = data.currentState;
    try {
      const { experimental_output } = await generateText({
        model: gateway(normalizeAiModel(data.model)),
        system: SYSTEM,
        prompt,
        experimental_output: Output.object({ schema: ThinkingStateSchema }),
      });
      nextState = normalizeState({ ...experimental_output, last_turn_id: data.turnId });
    } catch (e) {
      console.warn("[thinkingState] update failed", e instanceof Error ? e.message : String(e));
      nextState = normalizeState({ ...data.currentState, last_turn_id: data.turnId });
    }

    const { error } = await context.supabase.from("session_thinking_state" as any).upsert({
      session_id: data.sessionId,
      current_goal: nextState.current_goal,
      user_intent: nextState.user_intent,
      assumptions: nextState.assumptions,
      open_questions: nextState.open_questions,
      promising_directions: nextState.promising_directions,
      decision_points: nextState.decision_points,
      last_turn_id: data.turnId,
    });
    if (error) throw new Error(error.message);

    return nextState;
  });
