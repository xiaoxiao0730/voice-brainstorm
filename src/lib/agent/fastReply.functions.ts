// Fast-lane short answer generator. Single LLM call, hard cap on output.
// Used for simple_direct_question when no canned reply suffices.

import { createServerFn } from "@tanstack/react-start";
import { generateText } from "ai";
import { z } from "zod";

import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { createLovableAiGatewayProvider } from "@/lib/ai-gateway.server";

const InputSchema = z.object({
  question: z.string().min(1).max(800),
  language: z.enum(["zh", "en", "auto"]).default("auto"),
});

const SYSTEM_PROMPT = `You are a fast voice co-thinking partner. The user just asked a short, direct question while thinking out loud.

HARD RULES:
- Reply in ONE sentence. Two only if absolutely necessary. Never more.
- Match the user's language (Chinese if Chinese, English if English).
- Sound natural spoken aloud — no markdown, no lists, no preamble like "Sure," or "Great question".
- If the question is fuzzy or speculative, answer directly with your best take. Do NOT defer to the brief or ask for clarification — another lane handles structure.
- If you genuinely cannot answer in one sentence, say "Let me think about that" in their language.

Output ONLY the spoken reply.`;

export const fastReply = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) => InputSchema.parse(input))
  .handler(async ({ data }) => {
    const apiKey = process.env.LOVABLE_API_KEY;
    if (!apiKey) throw new Error("Missing LOVABLE_API_KEY");

    const gateway = createLovableAiGatewayProvider(apiKey);

    try {
      const { text } = await generateText({
        model: gateway("google/gemini-3-flash-preview"),
        system: SYSTEM_PROMPT,
        prompt: data.question,
      });
      const clean = text.trim().replace(/^["'"「『]+|["'"」』]+$/g, "").trim();
      return { text: clean };
    } catch (e) {
      const message = e instanceof Error ? e.message : String(e);
      return { text: "", error: message };
    }
  });
