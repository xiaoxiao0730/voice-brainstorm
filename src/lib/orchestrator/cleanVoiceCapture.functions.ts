import { createServerFn } from "@tanstack/react-start";
import { generateText } from "ai";
import { z } from "zod";

import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { createOpenAIProvider, normalizeAiModel, requireOpenAIKey } from "@/lib/ai-gateway.server";

const InputSchema = z.object({
  text: z.string().min(1).max(6000),
  model: z.string().default("openai/gpt-4o-mini"),
});

const SYSTEM = `You are a faithful INLINE DICTATION cleaner for a canvas text editor.

The user held Space while their cursor was inside a card/text box. Your output will be inserted exactly at that cursor position. Treat this as cleaned dictation, NOT as a summary.

Rules:
- Preserve the speaker's wording, intent, tone, examples, uncertainty, and language.
- Remove filler words, hesitations, accidental repetitions, false starts, and trailing control words like "嗯" "stop", "done", "结束", "好了".
- Add punctuation only when it improves readability.
- Preserve fragments if the user spoke in fragments. Do not force a complete sentence.
- Do not summarize, categorize, title, group, analyze, or add new information.
- Do not make it more professional, more product-y, or more abstract.
- Turn the note into a bullet list if the speaker explicitly dictated bullet points. Otherwise, keep it as a single paragraph.
- Keep technical/product terms exactly as spoken when possible.
- Keep the speaker's language and preserve technical terms.
- Return only the cleaned text to insert. No quotes, no markdown fence, no explanation.`;

function localFallback(text: string) {
  return text
    .replace(/(^|[\s，。！？,.!?])(嗯+|啊+|呃+|额+|那个|就是说)(?=[\s，。！？,.!?]|$)/gi, "$1")
    .replace(/\b(um+|uh+|erm+|you know)\b[,\s]*/gi, "")
    .replace(/\s+/g, " ")
    .replace(/([，。！？,.!?])\1+/g, "$1")
    .trim();
}

export const cleanVoiceCapture = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) => InputSchema.parse(input))
  .handler(async ({ data }) => {
    const apiKey = requireOpenAIKey();
    if (!apiKey) return { text: localFallback(data.text) };

    try {
      const gateway = createOpenAIProvider(apiKey);
      const result = await generateText({
        model: gateway(normalizeAiModel(data.model)),
        system: SYSTEM,
        temperature: 0.1,
        maxOutputTokens: 900,
        prompt: data.text,
      });
      return { text: result.text.trim() || localFallback(data.text) };
    } catch (error) {
      console.warn(
        "[cleanVoiceCapture] model failed",
        error instanceof Error ? error.message : String(error),
      );
      return { text: localFallback(data.text) };
    }
  });
