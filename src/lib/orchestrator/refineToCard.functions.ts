// Refine ONE spoken utterance into ONE Smart Note card.
//
// Product role: a REFINER, not a summarizer. The user pressed-and-held T to
// say one short thing; the keypress already defines the card boundary, so this
// only needs to clean the transcript — drop fillers/repeats, keep the user's
// own words and tone. ~20 chars in → ~13-15 chars out. No restructuring, no
// invented content, no sections.

import { createServerFn } from "@tanstack/react-start";
import { generateText } from "ai";
import { z } from "zod";

import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { createOpenAIProvider, normalizeAiModel, requireOpenAIKey } from "@/lib/ai-gateway.server";

export type RefinedCardKind = "focus" | "idea" | "question" | "decision" | "risk" | "next";

const InputSchema = z.object({
  rawTranscript: z.string().min(1).max(4000),
  model: z.string().default("openai/gpt-4o-mini"),
});

const OutputSchema = z.object({
  title: z.string().default(""),
  body: z.string().default(""),
  kind: z.enum(["focus", "idea", "question", "decision", "risk", "next"]).default("idea"),
});

const SYSTEM = `You are a REFINER for a voice co-thinking canvas. The user pressed and held a key, said ONE short thought out loud, and released. Your ONLY job is to turn that raw speech transcript into ONE clean, good-looking note. You are NOT a summarizer and NOT an organizer.

HARD RULES
- Keep the user's OWN words, nouns, and tone. Do NOT paraphrase into "professional" or "consulting" language. Do NOT abstract.
- REMOVE only: filler words and hesitations (嗯, 啊, 呃, 那个, 然后, 就是, 对, 这个, um, uh, like, you know), self-repeats, false starts, and trailing "stop"/"结束"/"好了".
- Roughly: 20 spoken chars in → ~13-15 chars out. Shorten by deleting noise, NOT by rewriting meaning.
- NEVER invent facts, causes, examples, or conclusions the user did not say.
- NEVER split into multiple points or add headings/sections. This is ONE note.
- Output language = the user's language. Keep technical/product terms (API, Notion, MVP, login…) as-is.

OUTPUT
- title: the cleaned core sentence (a phrase or short clause). This is the card's main line. Usually this is all you need.
- body: leave EMPTY unless the user clearly said two related parts; then body holds the lesser detail. Default "".
- kind: pick the ONE that best fits what the user expressed:
  - question — they asked something / are unsure ("怎么做…", "要不要…", "I wonder…")
  - decision — they decided/concluded ("就用 X", "决定…", "let's go with…")
  - risk — a problem, worry, constraint, tradeoff ("担心…", "问题是…", "太复杂")
  - next — a concrete next action ("下一步…", "先做…", "需要去…")
  - idea — a suggestion, observation, or possibility (DEFAULT)
  - focus — only for a high-level topic/goal statement
  When unsure, use "idea".

Examples:
- "嗯，我觉得这个登录流程有点复杂" → title="登录流程有点复杂", kind="risk"
- "那个，要不要先做一个 landing page 验证一下需求" → title="先做 landing page 验证需求", kind="next"
- "我决定就用 Resend 来发邮件吧" → title="用 Resend 发邮件", kind="decision"

Return STRICT JSON only, no prose, no code fences:
{ "title": "...", "body": "", "kind": "idea" }`;

function extractJSON(raw: string): unknown {
  let cleaned = (raw ?? "").trim();
  const fence = cleaned.match(/```(?:json)?\s*([\s\S]*?)```/i);
  if (fence) cleaned = fence[1].trim();
  const first = cleaned.indexOf("{");
  const last = cleaned.lastIndexOf("}");
  if (first >= 0 && last > first) cleaned = cleaned.slice(first, last + 1);
  return JSON.parse(cleaned);
}

export const refineToCard = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) => InputSchema.parse(input))
  .handler(async ({ data }) => {
    const key = requireOpenAIKey();
    if (!key) throw new Error("Missing OPENAI_API_KEY");

    const gateway = createOpenAIProvider(key);
    const fallbackTitle = data.rawTranscript.trim().slice(0, 40);

    try {
      const { text } = await generateText({
        model: gateway(normalizeAiModel(data.model)),
        system: SYSTEM,
        prompt: `Raw transcript:\n"""${data.rawTranscript}"""\n\nRefine it into one note. Return STRICT JSON only.`,
      });
      const parsed = OutputSchema.parse(extractJSON(text));
      const title = parsed.title.trim() || fallbackTitle;
      return {
        title,
        body: parsed.body.trim(),
        kind: parsed.kind as RefinedCardKind,
      };
    } catch (e) {
      console.warn("[refineToCard] failed", e instanceof Error ? e.message : String(e));
      return { title: fallbackTitle, body: "", kind: "idea" as RefinedCardKind };
    }
  });
