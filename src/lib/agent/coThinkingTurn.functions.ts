import { createServerFn } from "@tanstack/react-start";
import { Output, generateText } from "ai";
import { z } from "zod";

import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { createOpenAIProvider, normalizeAiModel, requireOpenAIKey } from "@/lib/ai-gateway.server";

const InputSchema = z.object({
  latestTurn: z.string().min(1).max(8000),
  briefText: z.string().max(6000).default(""),
  mapContext: z.string().max(4000).default(""),
  thinkingState: z.string().max(5000).default(""),
  model: z.string().default("openai/gpt-4o-mini"),
});

const ReplyModeSchema = z.enum(["reflect", "frame", "challenge", "extend", "decide_next", "stay_silent"]);

const DirectionSchema = z.object({
  title: z.string().min(1).max(80),
  why: z.string().max(240).default(""),
  kind: z.enum(["idea", "question", "decision", "risk", "next"]).default("next"),
});

const OutputSchema = z.object({
  replyMode: ReplyModeSchema.default("frame"),
  stateSummary: z.string().min(1).max(220),
  voiceReply: z.string().min(1).max(700),
  directions: z.array(DirectionSchema).min(2).max(3),
});

const SYSTEM = `You are the CO-THINKING TURN PLANNER for a live voice workspace.

Your job is to convert the user's latest spoken thought into ONE shared turn contract used by both:
1. the voice agent, which should move the conversation forward; and
2. the canvas, which should show the same next directions as editable nodes.

VOICE CONTRACT
- The voice reply should do exactly three things:
  1. explain the current state in one compact sentence;
  2. propose 2-3 concrete next directions;
  3. ask which direction the user wants to explore first.
- Pick exactly one replyMode:
  - reflect: restate the structure when the user is exploring and needs clarity.
  - frame: offer a useful frame or decomposition.
  - challenge: point out a risk, contradiction, or hidden assumption.
  - extend: add a new grounded direction.
  - decide_next: converge and help choose the next step.
  - stay_silent: use only when the latest turn is filler or clearly unfinished.
- Match the user's language. Keep product and technical terms in their original language.
- Be specific to the user's latest turn. No generic coaching.
- Do not invent facts. If uncertain, frame it as an option or question.

CANVAS CONTRACT
- directions must be clickable-worthy labels, not vague categories.
- Use kinds:
  - question: when this opens a clarifying path
  - decision: when user needs to choose/commit
  - risk: when it explores uncertainty or failure mode
  - next: when it is an action/next step
  - idea: when it is a conceptual branch
- Prefer exactly 3 directions unless the turn is very small.

Return strict JSON only.`;

export const planCoThinkingTurn = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) => InputSchema.parse(input))
  .handler(async ({ data }) => {
    const apiKey = requireOpenAIKey();
    if (!apiKey) throw new Error("Missing OPENAI_API_KEY");

    const gateway = createOpenAIProvider(apiKey);
    const prompt = `LATEST USER TURN:
${data.latestTurn}

LIVE BRIEF:
${data.briefText || "(empty)"}

CURRENT IDEA CANVAS:
${data.mapContext || "(empty)"}

SESSION THINKING STATE:
${data.thinkingState || "(empty)"}

Create the shared co-thinking turn contract.`;

    try {
      const { experimental_output } = await generateText({
        model: gateway(normalizeAiModel(data.model)),
        system: SYSTEM,
        prompt,
        experimental_output: Output.object({ schema: OutputSchema }),
      });

      const out = experimental_output;
      return {
        replyMode: out.replyMode,
        stateSummary: out.stateSummary.trim(),
        voiceReply: out.voiceReply.trim(),
        directions: out.directions
          .map((d) => ({
            title: d.title.trim(),
            why: d.why.trim(),
            kind: d.kind,
          }))
          .filter((d) => d.title.length > 0)
          .slice(0, 3),
      };
    } catch (e) {
      console.warn("[coThinkingTurn] failed", e instanceof Error ? e.message : String(e));
      const text = data.latestTurn.trim().slice(0, 80) || "Current thought";
      return {
        replyMode: "frame" as const,
        stateSummary: text,
        voiceReply: `I see the current thread. We can either clarify the core question, map the main options, or pick the next concrete step. Which one should we start with?`,
        directions: [
          { title: "Clarify the question", why: "Make the problem sharper before expanding.", kind: "question" as const },
          { title: "Map the options", why: "Lay out the possible paths side by side.", kind: "idea" as const },
          { title: "Pick next step", why: "Turn the thought into a concrete move.", kind: "next" as const },
        ],
      };
    }
  });
