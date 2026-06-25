import { createServerFn } from "@tanstack/react-start";
import { Output, generateText } from "ai";
import { z } from "zod";

import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { createOpenAIProvider, normalizeAiModel, requireOpenAIKey } from "@/lib/ai-gateway.server";

const SnapshotBlock = z.object({
  heading: z.string().default(""),
  level: z.number().int().min(1).max(3),
  body: z.string().default(""),
});

const InputSchema = z.object({
  latestText: z.string().min(1),
  recentTexts: z.array(z.string()).max(8).default([]),
  snapshot: z.array(SnapshotBlock).max(60).default([]),
});

export const THINKING_STATES = [
  "thinking_continuing",
  "pause_but_not_done",
  "stuck",
  "contradiction_detected",
  "missing_structure",
  "explicit_request",
] as const;

export type ThinkingState = (typeof THINKING_STATES)[number];

const OutputSchema = z.object({
  state: z.enum(THINKING_STATES),
  confidence: z.number().min(0).max(1),
  evidence: z.string().max(240).default(""),
});

const SYSTEM_PROMPT = `You classify a product builder's current thinking state while they think out loud and a Live Brief evolves alongside them.

Choose EXACTLY ONE state from this fixed list:
- thinking_continuing: the user is still actively developing thoughts; do not interrupt.
- pause_but_not_done: the user paused but is likely still mid-thought.
- stuck: the user is repeating uncertainty, going in circles, or explicitly says they don't know how to proceed.
- contradiction_detected: the latest statement clearly conflicts with an earlier point in the Live Brief.
- missing_structure: the user has dumped many raw thoughts but lacks a clear problem, assumption, direction, or next step.
- explicit_request: the user directly asks the AI for help, opinion, or feedback ("what do you think", "help me", "can you...").

For each decision give: state, confidence in [0,1], and a one-sentence evidence pointing at what made you choose this.

Defaults: when in doubt, return thinking_continuing with confidence <= 0.5. Be conservative — false positives on stuck/contradiction/missing_structure are worse than silence.`;

export const detectThinkingState = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) => InputSchema.parse(input))
  .handler(async ({ data }) => {
    const apiKey = requireOpenAIKey();
    if (!apiKey) throw new Error("Missing OPENAI_API_KEY");

    const briefStr = data.snapshot.length
      ? data.snapshot
          .map((b) => {
            const prefix = b.level === 1 ? "# " : b.level === 2 ? "## " : "";
            const head = b.heading ? `${prefix}${b.heading}` : "";
            return [head, b.body].filter(Boolean).join("\n");
          })
          .join("\n\n")
      : "(empty)";

    const recentStr = data.recentTexts.length
      ? data.recentTexts.map((t, i) => `[${i + 1}] ${t}`).join("\n")
      : "(none)";

    const userPrompt = `LIVE BRIEF (current):\n${briefStr}\n\nRECENT TRANSCRIPT (oldest first):\n${recentStr}\n\nLATEST USER SEGMENT:\n${data.latestText}\n\nClassify the latest segment.`;

    const gateway = createOpenAIProvider(apiKey);

    try {
      const { experimental_output } = await generateText({
        model: gateway(normalizeAiModel("google/gemini-3-flash-preview")),
        system: SYSTEM_PROMPT,
        prompt: userPrompt,
        experimental_output: Output.object({ schema: OutputSchema }),
      });

      return {
        state: experimental_output.state,
        confidence: experimental_output.confidence,
        evidence: experimental_output.evidence ?? "",
      };
    } catch (e) {
      const message = e instanceof Error ? e.message : String(e);
      console.warn("detectThinkingState failed", message);
      return {
        state: "thinking_continuing" as ThinkingState,
        confidence: 0,
        evidence: "",
        error: message,
      };
    }
  });
