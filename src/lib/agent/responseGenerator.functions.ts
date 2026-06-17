import { createServerFn } from "@tanstack/react-start";
import { Output, generateText } from "ai";
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
  // text = card, voice = spoken, canvas = ghost block proposal.
  level: z.enum(["text", "voice", "canvas"]),
});

const SYSTEM_TEXT_VOICE = `You are a co-thinking partner for the BACKGROUND structural lane. A separate fast lane handles greetings, direct questions, and chit-chat — you NEVER do those. You only speak when the user is stuck, contradicting themselves, missing structure, or explicitly asking for deeper help.

HARD RULES:
- Maximum 1–2 sentences. No paragraphs, no lists.
- Either ask ONE useful question OR offer ONE structural reframing — never both.
- Reference something concrete from the Live Brief or the user's latest segment.
- Match the user's language.
- Voice responses must sound natural when spoken aloud — no markdown.

Per state:
- stuck: name what you hear and offer one direction.
- contradiction_detected: point to the specific tension, ask which holds.
- missing_structure: name the single most-needed structural element.
- explicit_request: answer with one concrete suggestion grounded in the brief.
- thinking_continuing / pause_but_not_done: return an empty string.

Output ONLY the response text.`;

const CanvasPatchSchema = z.object({
  heading: z.string().max(80).default(""),
  body: z.string().min(1).max(400),
  rationale: z.string().max(200).default(""),
});

const SYSTEM_CANVAS = `You propose ONE small structural addition to a Live Brief — the kind a co-thinker would jot at the side as a ghost suggestion. The user will see it as a dashed-outline block they can accept, edit, or dismiss.

HARD RULES:
- Propose exactly one block. It must fill a clear structural gap (e.g. missing problem statement, missing assumption, missing target user, missing next step).
- Heading: short (2–6 words). Body: 1–3 sentences, plain text, matches user's language.
- Ground every claim in the user's own words or the existing brief. Do NOT invent new facts.
- Rationale: one short phrase explaining why this is missing (shown as a hover tip).

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

    if (data.level === "canvas") {
      const userPrompt = `LIVE BRIEF:\n${briefStr}\n\nRECENT USER SPEECH: ${recentStr}\nLATEST USER SEGMENT: ${data.latestText}\n\nDETECTED STATE: ${data.state}\nWHY: ${data.evidence}\n\nPropose one ghost block now.`;
      try {
        const { experimental_output } = await generateText({
          model: gateway("google/gemini-3-flash-preview"),
          system: SYSTEM_CANVAS,
          prompt: userPrompt,
          experimental_output: Output.object({ schema: CanvasPatchSchema }),
        });
        return {
          text: experimental_output.body,
          patch: {
            heading: experimental_output.heading,
            body: experimental_output.body,
            rationale: experimental_output.rationale,
          },
        };
      } catch (e) {
        const message = e instanceof Error ? e.message : String(e);
        return { text: "", error: message };
      }
    }

    const userPrompt = `LIVE BRIEF:\n${briefStr}\n\nRECENT USER SPEECH: ${recentStr}\nLATEST USER SEGMENT: ${data.latestText}\n\nDETECTED STATE: ${data.state}\nWHY: ${data.evidence}\nDELIVERY: ${data.level === "voice" ? "spoken aloud" : "shown as a small suggestion card"}\n\nWrite the response now. 1–2 sentences max.`;

    try {
      const { text } = await generateText({
        model: gateway("google/gemini-3-flash-preview"),
        system: SYSTEM_TEXT_VOICE,
        prompt: userPrompt,
      });
      const clean = text.trim().replace(/^["'"「『]+|["'"」』]+$/g, "").trim();
      return { text: clean };
    } catch (e) {
      const message = e instanceof Error ? e.message : String(e);
      return { text: "", error: message };
    }
  });
