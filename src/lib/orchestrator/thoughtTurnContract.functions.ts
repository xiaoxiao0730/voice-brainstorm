import { createServerFn } from "@tanstack/react-start";
import { generateText } from "ai";
import { z } from "zod";

import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { createOpenAIProvider, normalizeAiModel, requireOpenAIKey } from "@/lib/ai-gateway.server";
import type { BriefPatch } from "@/lib/pipeline/types";
import {
  formatThinkingState,
  type SessionThinkingState,
} from "@/lib/agent/thinkingState.functions";

const ThinkingStateSchema = z.object({
  current_goal: z.string().max(500).default(""),
  user_intent: z.string().max(500).default(""),
  assumptions: z.array(z.string().max(240)).max(8).default([]),
  open_questions: z.array(z.string().max(240)).max(8).default([]),
  promising_directions: z.array(z.string().max(240)).max(8).default([]),
  decision_points: z.array(z.string().max(240)).max(8).default([]),
  last_turn_id: z.string().max(120).nullable().default(null),
});

const EMPTY_STATE: SessionThinkingState = {
  current_goal: "",
  user_intent: "",
  assumptions: [],
  open_questions: [],
  promising_directions: [],
  decision_points: [],
  last_turn_id: null,
};

const BriefPatchSchema = z.object({
  action: z.enum(["append_block", "update_block", "append_to_block"]).default("append_block"),
  blockId: z.string().nullable().default(null),
  heading: z.string().max(160).optional(),
  level: z.union([z.literal(1), z.literal(2), z.literal(3)]).optional(),
  bodyMarkdown: z.string().max(1600).optional(),
  sourceChunkIds: z.array(z.string()).default([]).optional(),
});

const CanvasOpSchema = z.object({
  action: z.enum(["add_card", "update_card", "connect", "none"]).default("none"),
  kind: z.enum(["focus", "idea", "question", "decision", "risk", "next"]).default("idea"),
  title: z.string().max(120).default(""),
  body: z.string().max(400).default(""),
  sourceTitle: z.string().max(120).default(""),
  targetTitle: z.string().max(120).default(""),
  label: z.string().max(80).default(""),
});

const DirectionSchema = z.object({
  title: z.string().min(1).max(100),
  why: z.string().max(240).default(""),
  kind: z.enum(["question", "decision", "risk", "next", "idea"]).default("next"),
});

const ContractSchema = z.object({
  intent: z
    .enum(["brainstorm", "ask", "draft", "revise", "decide", "explain", "reflect", "casual"])
    .default("brainstorm"),
  updateKind: z
    .enum(["capture", "answer", "expand", "structure", "revise", "summarize", "no_canvas_update"])
    .default("capture"),
  replyMode: z
    .enum(["reflect", "frame", "challenge", "extend", "decide_next", "stay_silent"])
    .default("frame"),
  shouldWriteBrief: z.boolean().default(true),
  shouldWriteCanvas: z.boolean().default(false),
  thinkingState: ThinkingStateSchema.default(EMPTY_STATE),
  briefOps: z.array(BriefPatchSchema).max(4).default([]),
  canvasOps: z.array(CanvasOpSchema).max(4).default([]),
  nextDirections: z.array(DirectionSchema).max(3).default([]),
  voiceReplyHint: z.string().max(700).default(""),
  rationale: z.string().max(300).default(""),
});

export type ThoughtTurnContract = z.infer<typeof ContractSchema>;
export type ThoughtTurnCanvasOp = z.infer<typeof CanvasOpSchema>;

const InputSchema = z.object({
  sessionId: z.string().uuid(),
  turnId: z.string().min(1).max(120),
  userTurn: z.string().min(1).max(8000),
  agentReply: z.string().max(4000).optional(),
  currentThinkingState: ThinkingStateSchema.default(EMPTY_STATE),
  briefText: z.string().max(7000).default(""),
  canvasText: z.string().max(5000).default(""),
  recentTurns: z.array(z.string().max(1000)).max(8).default([]),
  model: z.string().default("openai/gpt-4o-mini"),
});

const SYSTEM = `You are the THOUGHT TURN ORCHESTRATOR for a live voice co-thinking workspace.

You receive one finalized user thought. Return ONE turn contract that coordinates:
1. session thinking state,
2. Live Brief updates,
3. Thinking Board card updates,
4. the realtime voice agent's next reply hint.

IMPORTANT PRODUCT BEHAVIOR
- Do not append random bullets. Decide where the thought belongs.
- The Live Brief should become structured working notes, not a transcript.
- Update existing ideas when possible; append only when the turn adds something new.
- Not every turn deserves a canvas update. Use no_canvas_update for filler, confirmation, or casual talk.
- Agent replies may contain useful conclusions; if agentReply is present, reconcile it with the user turn.
- Match the user's language. Keep technical terms and product names unchanged.

COGNITIVE TRAJECTORY
- Organize the turn as part of a four-layer trajectory: S0 Descriptive → S1 Contextual → S2 Analytical → S3 Actionable.
- S0 Descriptive: observations, events, named options/facts, interview notes.
- S1 Contextual: why the observation matters, constraints, user intent, task situation, stakes.
- S2 Analytical: competing hypotheses, evidence strength, causal chain, tradeoff, root-cause/product judgment.
- S3 Actionable: concrete next step, MVP direction, validation question, success metric.
- The contract should preserve the user's current layer and gently advance the missing next layer.
- Do not jump straight to S3 features when S1 context or S2 reasoning is missing.
- When the user lists multiple possible explanations, produce S2 structure: competing hypotheses + evidence, not a flat list.
- When S2 reasoning is already clear, produce S3 nextDirections and a concise validation move.
- Use voiceReplyHint to ask one targeted, evidence-based question when a layer is missing.
- Prefer fewer, deeper updates over many shallow S0 notes.

INTENT GUIDE
- brainstorm: user is exploring possibilities.
- ask: user asks a direct question.
- draft: user asks to write content.
- revise: user wants to edit or improve existing content.
- decide: user is choosing or converging.
- explain: user asks for explanation.
- reflect: user is clarifying/processing their own thinking.
- casual: greetings, acknowledgements, filler.

BRIEF OPS
- Use append_block for new sections or notes.
- Use level 2 for structural headings and level 3 for body notes.
- For ask/explain, prefer a concise answer note.
- For draft, write draft-like prose, not analysis bullets.
- For brainstorm, use structured headings/notes such as Current Goal, Open Questions, Possible Directions, Risks, Next Step when helpful.
- If nothing useful should be written, return shouldWriteBrief=false and no briefOps.

BOARD / CANVAS OPS
- The board is a mixed-media thinking board with zones: Focus, Open questions, Promising paths, Risks / tensions, Decisions, Next moves.
- Map kind to zone:
  - focus → Focus
  - question → Open questions
  - idea → Promising paths
  - risk → Risks / tensions
  - decision → Decisions
  - next → Next moves
- Use add_card only for important entities/directions/questions/risks/next steps.
- Prefer 0-2 cards per turn. The board should stay clear.
- Use connect only when sourceTitle and targetTitle are clear.

VOICE HINT
- This is NOT the full voice reply. It is a grounding hint for the realtime agent.
- Keep it short and action-oriented.
- For idea-sharing turns: suggest one useful next prompt, question, or framing move.
- For command turns such as write, edit, connect, or research: hint only a brief confirmation plus the requested action.
- Do not encourage long summaries, praise, or generic reflection.

Return strict JSON only.`;

// Azure's structured-output (response_format) rejects schemas with optional/
// defaulted fields, so we ask for JSON in the prompt and parse it ourselves.
function extractJSON(raw: string): unknown {
  let cleaned = (raw ?? "").trim();
  const fence = cleaned.match(/```(?:json)?\s*([\s\S]*?)```/i);
  if (fence) cleaned = fence[1].trim();
  const first = cleaned.indexOf("{");
  const last = cleaned.lastIndexOf("}");
  if (first >= 0 && last > first) cleaned = cleaned.slice(first, last + 1);
  return JSON.parse(cleaned);
}

function normalizeContract(input: unknown, turnId: string, currentState: SessionThinkingState) {
  const parsed = ContractSchema.safeParse(input);
  const base = parsed.success
    ? parsed.data
    : {
        intent: "brainstorm" as const,
        updateKind: "capture" as const,
        replyMode: "frame" as const,
        shouldWriteBrief: true,
        shouldWriteCanvas: false,
        thinkingState: currentState,
        briefOps: [],
        canvasOps: [],
        nextDirections: [],
        voiceReplyHint: "",
        rationale: "",
      };
  return {
    ...base,
    thinkingState: {
      ...base.thinkingState,
      last_turn_id: turnId,
    },
    briefOps: base.shouldWriteBrief ? base.briefOps : [],
    canvasOps: base.shouldWriteCanvas ? base.canvasOps : [],
  };
}

export const planThoughtTurnContract = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) => InputSchema.parse(input))
  .handler(async ({ data, context }) => {
    const apiKey = requireOpenAIKey();
    if (!apiKey) throw new Error("Missing OPENAI_API_KEY");

    const gateway = createOpenAIProvider(apiKey);
    const prompt = `CURRENT SESSION THINKING STATE:
${formatThinkingState(data.currentThinkingState)}

RECENT USER TURNS:
${data.recentTurns.length ? data.recentTurns.map((t) => `- ${t}`).join("\n") : "(none)"}

LATEST USER TURN:
${data.userTurn}

LATEST AGENT REPLY:
${data.agentReply?.trim() || "(not available yet)"}

LIVE BRIEF:
${data.briefText || "(empty)"}

THINKING BOARD:
${data.canvasText || "(empty)"}

Create the thought turn contract.`;

    let contract;
    try {
      const { text } = await generateText({
        model: gateway(normalizeAiModel(data.model)),
        system: SYSTEM,
        prompt,
      });
      contract = normalizeContract(extractJSON(text), data.turnId, data.currentThinkingState);
    } catch (e) {
      console.warn("[thoughtTurnContract] failed", e instanceof Error ? e.message : String(e));
      const text = data.userTurn.trim();
      contract = normalizeContract(
        {
          intent: "reflect",
          updateKind: "capture",
          replyMode: "frame",
          shouldWriteBrief: text.length > 0,
          shouldWriteCanvas: false,
          thinkingState: {
            ...data.currentThinkingState,
            current_goal: data.currentThinkingState.current_goal || text.slice(0, 160),
          },
          briefOps: text
            ? ([
                {
                  action: "append_block",
                  blockId: null,
                  level: 3,
                  bodyMarkdown: text,
                },
              ] satisfies BriefPatch[])
            : [],
          canvasOps: [],
          nextDirections: [
            {
              title: "Clarify the goal",
              why: "Make the next turn easier to structure.",
              kind: "question",
            },
            {
              title: "Map options",
              why: "Turn the thought into visible alternatives.",
              kind: "idea",
            },
          ],
          voiceReplyHint:
            "Give a tiny acknowledgment, then ask whether to clarify the goal, map options, or pick the next concrete step.",
        },
        data.turnId,
        data.currentThinkingState,
      );
    }

    const { error } = await context.supabase.from("session_thinking_state" as any).upsert({
      session_id: data.sessionId,
      current_goal: contract.thinkingState.current_goal,
      user_intent: contract.thinkingState.user_intent,
      assumptions: contract.thinkingState.assumptions,
      open_questions: contract.thinkingState.open_questions,
      promising_directions: contract.thinkingState.promising_directions,
      decision_points: contract.thinkingState.decision_points,
      last_turn_id: data.turnId,
    });
    if (error) {
      console.warn("[thoughtTurnContract] thinking state upsert failed", error.message);
    }

    return contract;
  });
