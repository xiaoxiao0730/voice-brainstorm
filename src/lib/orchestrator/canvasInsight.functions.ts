import { createServerFn } from "@tanstack/react-start";
import { generateText } from "ai";
import { z } from "zod";

import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { createOpenAIProvider, normalizeAiModel, requireOpenAIKey } from "@/lib/ai-gateway.server";
import { parseLlmJsonObject } from "@/lib/llm/json";

const InsightKind = z.enum(["gap", "assumption", "contradiction", "decision", "next_step"]);
const CardKind = z.enum(["focus", "idea", "question", "decision", "risk", "next"]);

const InputSchema = z.object({
  latestThought: z.string().min(1).max(6000),
  canvasText: z.string().max(5000).default(""),
  model: z.string().default("openai/gpt-4o-mini"),
});

const SuggestedCardSchema = z.object({
  kind: CardKind.default("question"),
  title: z.string().max(120).default(""),
  body: z.string().max(500).default(""),
});

const OutputSchema = z.object({
  emit: z.boolean().default(false),
  kind: InsightKind.default("gap"),
  title: z.string().max(80).default(""),
  observation: z.string().max(320).default(""),
  suggestedCard: SuggestedCardSchema.default({ kind: "question", title: "", body: "" }),
});

export type CanvasInsight = z.infer<typeof OutputSchema>;

const SYSTEM = `You are the QUIET INSIGHT LAYER for a voice-first brainstorming canvas.

Your job is to silently inspect the user's latest thought and current canvas, then decide whether there is ONE genuinely useful insight to surface.

WHAT TO NOTICE
- gap: an important missing piece that would help the user move forward.
- assumption: an unstated belief the user seems to rely on.
- contradiction: a tension between two things the user wants.
- decision: a choice point the user may need to make.
- next_step: a concrete next validation/action.

WHEN TO EMIT
- Emit only when the insight is specific, grounded, and useful.
- Return emit=false for generic advice, restatements, or weak observations.
- Do not critique every thought. Most thoughts do not need an insight.

STYLE
- Use the user's language. If the latest thought is Chinese, write Simplified Chinese.
- Be concise and calm. This is a quiet canvas nudge, not a chat reply.
- observation: one sentence.
- suggestedCard: something the user could optionally add to the canvas.

Return STRICT JSON only:
{
  "emit": true,
  "kind": "gap",
  "title": "AI noticed a gap",
  "observation": "...",
  "suggestedCard": { "kind": "question", "title": "...", "body": "..." }
}`;

function extractJSON(raw: string): unknown {
  return parseLlmJsonObject(raw);
}

export const generateCanvasInsight = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) => InputSchema.parse(input))
  .handler(async ({ data }) => {
    const apiKey = requireOpenAIKey();
    const gateway = createOpenAIProvider(apiKey);
    try {
      const { text } = await generateText({
        model: gateway(normalizeAiModel(data.model)),
        system: SYSTEM,
        temperature: 0.2,
        maxOutputTokens: 700,
        prompt: `LATEST THOUGHT:\n"""${data.latestThought.slice(0, 6000)}"""\n\nCURRENT CANVAS:\n${
          data.canvasText.trim() || "(empty)"
        }\n\nReturn one quiet insight or emit=false.`,
      });
      const parsed = OutputSchema.parse(extractJSON(text));
      if (!parsed.emit || !parsed.title.trim() || !parsed.observation.trim()) {
        return { ...parsed, emit: false } satisfies CanvasInsight;
      }
      return parsed satisfies CanvasInsight;
    } catch (error) {
      console.warn(
        "[canvasInsight] failed",
        error instanceof Error ? error.message : String(error),
      );
      return {
        emit: false,
        kind: "gap",
        title: "",
        observation: "",
        suggestedCard: { kind: "question", title: "", body: "" },
      } satisfies CanvasInsight;
    }
  });
