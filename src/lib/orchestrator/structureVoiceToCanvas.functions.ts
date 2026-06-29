import { createServerFn } from "@tanstack/react-start";
import { generateText } from "ai";
import { z } from "zod";

import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { createOpenAIProvider, normalizeAiModel, requireOpenAIKey } from "@/lib/ai-gateway.server";

const IdeaKind = z.enum(["focus", "idea", "question", "decision", "risk", "next"]);

const ExistingCardSchema = z.object({
  title: z.string().max(160).default(""),
  body: z.string().max(800).default(""),
  kind: IdeaKind.default("idea"),
});

const InputSchema = z.object({
  rawTranscript: z.string().min(1).max(6000),
  existingCards: z.array(ExistingCardSchema).max(40).default([]),
  model: z.string().default("openai/gpt-4o-mini"),
});

const CardSchema = z.object({
  title: z.string().min(1).max(120),
  body: z.string().max(500).default(""),
  kind: IdeaKind.default("idea"),
  attachToTitle: z.string().max(160).default(""),
  relation: z.string().max(80).default(""),
});

const EdgeSchema = z.object({
  sourceTitle: z.string().min(1).max(160),
  targetTitle: z.string().min(1).max(160),
  label: z.string().max(80).default(""),
});

const OutputSchema = z.object({
  title: z.string().max(120).default(""),
  summary: z.string().max(500).default(""),
  cards: z.array(CardSchema).min(1).max(7),
  edges: z.array(EdgeSchema).max(10).default([]),
});

export type StructuredVoiceCanvasCard = z.infer<typeof CardSchema>;
export type StructuredVoiceCanvasEdge = z.infer<typeof EdgeSchema>;
export type StructuredVoiceCanvas = z.infer<typeof OutputSchema> & { rawTranscript: string };

const SYSTEM = `You are a CANVAS STRUCTURER for a voice-first thinking board.

The user held Space on an empty canvas area, spoke a messy thought, and released. Your job is to turn that raw transcript into a small, editable thinking map.

PRODUCT BEHAVIOR
- This is NOT dictation. Do not merely clean the transcript.
- Create structured, high-quality cards that reduce the user's second-editing cost.
- Preserve the user's meaning, language, concrete nouns, product terms, uncertainty, and tradeoffs.
- Remove filler/repetition, but do not invent facts.
- If the canvas already has cards, place the new thought in relation to them: attach new cards to the most relevant existing card title when appropriate.
- Never rewrite existing cards. Only propose new cards and relationships.
- Prefer 3-5 cards. Use fewer if the thought is short; never exceed 7.
- Use Chinese when the user speaks Chinese; English when the user speaks English. Keep terms like API, MVP, Agent, Notion as-is.

TIDY MAP QUALITY RULES
- Make the map visually tidy: one clear central focus when possible, then compact branch cards.
- Card titles should be short labels, usually 3-9 words / 4-16 Chinese characters.
- Put supporting detail in body. Do not make huge paragraph titles.
- Avoid duplicate cards that say the same thing with different words.
- Prefer one card per semantic role: goal/focus, options/ideas, open questions, risks, decisions, next steps.
- Edges should express real structure only: causes, enables, blocks, answers, leads to, risk of. Do not connect everything.
- If a card is a risk/question/next step about another card, set attachToTitle to that parent card's exact title.
- If the transcript is rambly, extract the stable skeleton instead of every aside.

KINDS
- focus: the current central goal/topic.
- question: open question / uncertainty / thing to decide.
- idea: promising direction, concept, possible approach.
- risk: problem, constraint, tension, failure mode.
- decision: settled conclusion or choice.
- next: concrete next action.

EXISTING CANVAS RELATIONSHIP RULES
- attachToTitle must be either an EXACT title from Existing cards or "".
- Use attachToTitle when the new card is a child/detail/answer/risk/next-step of an existing card.
- If the new thought introduces a separate cluster, leave attachToTitle empty.
- Edges can connect new cards to existing cards or to other new cards. Use exact titles.

OUTPUT STRICT JSON ONLY:
{
  "title": "short cluster title",
  "summary": "one concise sentence",
  "cards": [
    { "title": "...", "body": "...", "kind": "idea", "attachToTitle": "", "relation": "" }
  ],
  "edges": [
    { "sourceTitle": "...", "targetTitle": "...", "label": "..." }
  ]
}`;

function extractJSON(raw: string): unknown {
  let cleaned = (raw ?? "").trim();
  const fence = cleaned.match(/```(?:json)?\s*([\s\S]*?)```/i);
  if (fence) cleaned = fence[1].trim();
  const first = cleaned.indexOf("{");
  const last = cleaned.lastIndexOf("}");
  if (first >= 0 && last > first) cleaned = cleaned.slice(first, last + 1);
  return JSON.parse(cleaned);
}

function fallback(rawTranscript: string): StructuredVoiceCanvas {
  const trimmed = rawTranscript.trim();
  const title = trimmed.slice(0, 80) || "Voice thought";
  return {
    rawTranscript: trimmed,
    title,
    summary: trimmed.slice(0, 220),
    cards: [
      {
        title,
        body: trimmed.length > title.length ? trimmed.slice(title.length).trim() : "",
        kind: "idea",
        attachToTitle: "",
        relation: "",
      },
    ],
    edges: [],
  };
}

export const structureVoiceToCanvas = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) => InputSchema.parse(input))
  .handler(async ({ data }) => {
    const apiKey = requireOpenAIKey();
    if (!apiKey) return fallback(data.rawTranscript);

    const existing = data.existingCards
      .filter((card) => card.title.trim())
      .slice(-30)
      .map(
        (card, index) =>
          `${index + 1}. [${card.kind}] ${card.title.trim()}${card.body.trim() ? ` — ${card.body.trim().slice(0, 160)}` : ""}`,
      )
      .join("\n");

    try {
      const gateway = createOpenAIProvider(apiKey);
      const { text } = await generateText({
        model: gateway(normalizeAiModel(data.model)),
        system: SYSTEM,
        temperature: 0.2,
        maxOutputTokens: 1200,
        prompt: `Existing cards (use exact titles for attachToTitle/edges; may be empty):\n${
          existing || "(empty canvas)"
        }\n\nRaw voice transcript:\n"""${data.rawTranscript.slice(0, 6000)}"""\n\nCreate the canvas structure now.`,
      });
      const parsed = OutputSchema.parse(extractJSON(text));
      return {
        ...parsed,
        rawTranscript: data.rawTranscript.trim(),
      } satisfies StructuredVoiceCanvas;
    } catch (error) {
      console.warn(
        "[structureVoiceToCanvas] failed",
        error instanceof Error ? error.message : String(error),
      );
      return fallback(data.rawTranscript);
    }
  });
