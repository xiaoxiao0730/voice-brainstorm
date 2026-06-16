import { createServerFn } from "@tanstack/react-start";
import { generateText } from "ai";
import { z } from "zod";

import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { createLovableAiGatewayProvider } from "@/lib/ai-gateway.server";
import { THINKING_STATES } from "./thinkingState.functions";

const SnapshotBlock = z.object({
  heading: z.string().default(""),
  level: z.number().int().min(1).max(3),
  body: z.string().default(""),
});

const InputSchema = z.object({
  state: z.enum(THINKING_STATES),
  evidence: z.string().default(""),
  latestText: z.string().default(""),
  recentTexts: z.array(z.string()).max(8).default([]),
  snapshot: z.array(SnapshotBlock).max(60).default([]),
  level: z.enum(["text", "voice"]),
});

const SYSTEM_PROMPT = `You are a co-thinking partner, not an assistant. The user is thinking out loud about an early-stage product idea, and a Live Brief is being built alongside them. You only get to speak when the policy engine decides the user genuinely needs a nudge.

HARD RULES — violating any of these makes the response unusable:
- Maximum 1–2 sentences. No paragraphs, no lists, no preamble.
- Never produce a full answer. Never introduce ideas not grounded in the Live Brief or the user's own words.
- Either ask ONE useful question OR offer ONE structural reframing — never both.
- Reference something concrete from the Live Brief or the user's latest segment.
- Match the user's language (English if they speak English, Chinese if they speak Chinese).
- Voice responses must sound natural when spoken aloud — no markdown, no bullet points.

For each thinking state, your job:
- stuck: name what you're hearing and offer one direction to unstick (one question).
- contradiction_detected: point out the specific tension between two parts of the brief, ask which is true.
- missing_structure: suggest the single most-needed structural element (problem? assumption? next step?).
- explicit_request: answer the user's question with one concrete suggestion grounded in the brief.
- thinking_continuing, pause_but_not_done: you should not have been called — return an empty string.

Output ONLY the response text. No JSON, no quotes, no labels.`;

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

    const userPrompt = `LIVE BRIEF:\n${briefStr}\n\nRECENT USER SPEECH: ${recentStr}\nLATEST USER SEGMENT: ${data.latestText}\n\nDETECTED STATE: ${data.state}\nWHY: ${data.evidence}\nDELIVERY: ${data.level === "voice" ? "spoken aloud" : "shown as a small suggestion card"}\n\nWrite the response now. 1–2 sentences max.`;

    const gateway = createLovableAiGatewayProvider(apiKey);

    try {
      const { text } = await generateText({
        model: gateway("google/gemini-3-flash-preview"),
        system: SYSTEM_PROMPT,
        prompt: userPrompt,
      });

      const clean = text
        .trim()
        .replace(/^["'"「『]+|["'"」』]+$/g, "")
        .trim();

      return { text: clean };
    } catch (e) {
      const message = e instanceof Error ? e.message : String(e);
      return { text: "", error: message };
    }
  });
