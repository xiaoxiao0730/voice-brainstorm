// Background Canvas Lane generator.
//
// Stage 3 architecture: this server fn is invoked unconditionally on every
// committed STT segment. It runs a deeper model in parallel with the Realtime
// voice lane and produces a structural Ghost Patch for the Live Brief.
// Optionally returns a short `insight` string the client may inject into the
// active Realtime session as silent system context.

import { createServerFn } from "@tanstack/react-start";
import { Output, generateText } from "ai";
import { z } from "zod";

import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { createLovableAiGatewayProvider } from "@/lib/ai-gateway.server";

const SnapshotBlock = z.object({
  heading: z.string().default(""),
  level: z.number().int().min(1).max(3),
  body: z.string().default(""),
});

const InputSchema = z.object({
  latestText: z.string().default(""),
  recentTexts: z.array(z.string()).max(8).default([]),
  snapshot: z.array(SnapshotBlock).max(60).default([]),
  model: z.string().default("google/gemini-2.5-pro"),
});

const CanvasPatchSchema = z.object({
  emit: z
    .boolean()
    .describe("False when the latest segment is filler/greeting/control with nothing structural to add."),
  heading: z.string().max(80).default(""),
  body: z.string().max(400).default(""),
  rationale: z.string().max(200).default(""),
  insight: z
    .string()
    .max(180)
    .default("")
    .describe("Optional one-sentence deep insight to inject into the live voice agent. Empty when not useful."),
});

const SYSTEM_CANVAS = `You are the BACKGROUND CANVAS LANE of a dual-pipeline co-thinking system. A separate native voice agent handles all spoken interaction. You NEVER produce spoken replies — only structured written notes for the user's Live Brief.

Your job: silently watch the user's stream of thought and the existing brief, then propose ONE small structural addition that captures what the user just said or fills a clear structural gap.

HARD RULES:
- Propose at most one block. Heading 2–6 words, body 1–3 sentences. Plain text. Match the user's language.
- Ground every claim in the user's own words or the existing brief. Do NOT invent facts.
- If the latest segment is a greeting / filler / control phrase ("好的", "stop", "let me think") or adds nothing structural, set emit=false and leave the other fields empty.
- rationale: one short phrase (≤ 1 line) shown as a hover tip.
- insight: only when you have a non-obvious cross-cutting observation worth whispering into the voice agent's ear (contradiction, missing assumption, surprising connection). One sentence, ≤ 30 words. Otherwise empty.

Return strict JSON matching the schema.`;

export const generateIntervention = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) => InputSchema.parse(input))
  .handler(async ({ data }) => {
    const apiKey = process.env.LOVABLE_API_KEY;
    if (!apiKey) throw new Error("Missing LOVABLE_API_KEY");

    const briefStr = data.snapshot.length
      ? data.snapshot
          .map((b) => {
            const prefix = b.level === 1 ? "# " : b.level === 2 ? "## " : "";
            const head = b.heading ? `${prefix}${b.heading}` : "";
            return [head, b.body].filter(Boolean).join("\n");
          })
          .join("\n\n")
      : "(empty)";

    const recentStr = data.recentTexts.length ? data.recentTexts.join(" / ") : "(none)";
    const gateway = createLovableAiGatewayProvider(apiKey);

    const userPrompt = `LIVE BRIEF:\n${briefStr}\n\nRECENT USER SPEECH: ${recentStr}\nLATEST USER SEGMENT: ${data.latestText}\n\nPropose one ghost block now (or set emit=false).`;

    try {
      const { experimental_output } = await generateText({
        model: gateway(data.model),
        system: SYSTEM_CANVAS,
        prompt: userPrompt,
        experimental_output: Output.object({ schema: CanvasPatchSchema }),
      });
      const out = experimental_output;
      if (!out.emit || !out.body.trim()) {
        return {
          emit: false as const,
          insight: out.insight?.trim() || undefined,
        };
      }
      return {
        emit: true as const,
        patch: {
          heading: out.heading,
          body: out.body,
          rationale: out.rationale,
        },
        insight: out.insight?.trim() || undefined,
      };
    } catch (e) {
      const message = e instanceof Error ? e.message : String(e);
      return { emit: false as const, error: message };
    }
  });
