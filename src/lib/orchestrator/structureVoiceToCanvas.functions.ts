import { createServerFn } from "@tanstack/react-start";
import { generateText } from "ai";
import { z } from "zod";

import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { createOpenAIProvider, normalizeAiModel, requireOpenAIKey } from "@/lib/ai-gateway.server";
import { CANVAS_EDGE_LABELS, normalizeCanvasEdgeLabel } from "@/lib/canvas/edgeLabels";

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
  relation: z
    .string()
    .max(80)
    .default("")
    .transform((value) => normalizeCanvasEdgeLabel(value)),
});

const EdgeSchema = z.object({
  sourceTitle: z.string().min(1).max(160),
  targetTitle: z.string().min(1).max(160),
  label: z
    .string()
    .max(80)
    .default("")
    .transform((value) => normalizeCanvasEdgeLabel(value)),
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

The user used a canvas voice hotkey, spoke a messy thought, then stopped capture. Your job is to turn that raw transcript into a small, editable thinking map.

PRODUCT BEHAVIOR
- This is NOT dictation. Do not merely clean the transcript.
- Create structured, high-quality cards that reduce the user's second-editing cost.
- Preserve the user's meaning, language, concrete nouns, product terms, uncertainty, and tradeoffs.
- Remove filler/repetition, but do not invent facts.
- If the canvas already has cards, place the new thought in relation to them: attach new cards to the most relevant existing card title when appropriate.
- Never rewrite existing cards. Only propose new cards and relationships.
- Use the fewest cards that faithfully represent the thought. If the user expressed one atomic idea, create ONE card. If the thought has one idea plus nuance, keep the nuance in that card's body instead of splitting it.
- Create multiple cards only when the transcript contains clearly distinct semantic roles, such as a problem plus separate risks, options, questions, decisions, or next steps. Never exceed 7 cards.
- Match the user's dominant language. Use Chinese when the user speaks Chinese; English when the user speaks English. Keep terms like API, MVP, Agent, Notion as-is.
- Output title, summary, card titles, and card bodies in the mandatory output language given in the user prompt. If it says Simplified Chinese, use Simplified Chinese for all user-facing text.
- Do not translate proper nouns, keyboard names, model names, code terms, or feature names.

TIDY MAP QUALITY RULES
- Make the map visually tidy: one clear central focus when possible, then compact branch cards.
- Card titles should be short labels, usually 3-9 words / 4-16 Chinese characters.
- Put supporting detail in body. Do not make huge paragraph titles.
- Avoid duplicate cards that say the same thing with different words.
- Do not create an abstract hub/heading card just to make the output look like a map. The cluster title already names the cluster; do not repeat it as a node.
- Do not split one idea into a title card plus a detail card. Keep the detail in the same card body.
- Prefer one card per semantic role: goal/focus, options/ideas, open questions, risks, decisions, next steps.
- Edges should express real structure only. Do not connect everything.
- Prefer 0-3 edges. If there is only one new card, return no edges unless it clearly attaches to an existing card. Never make a chain just because ideas were spoken in sequence.
- Edge labels MUST be a single categorical tag from this exact set: ${CANVAS_EDGE_LABELS.join(", ")}.
- Edge labels are NOT natural language. Do not write explanations in edges.
- INVALID edge labels: "leads to improving system performance", "is related to latency issues", "because of user behavior causing delay".
- VALID edge labels: CAUSES, ENABLES, PART_OF, DEPENDS_ON.
- If a card is a risk/question/next step about another card, set attachToTitle to that parent card's exact title.
- If the transcript is rambly, extract the stable skeleton instead of every aside.
- If you are unsure whether two cards relate, leave them unconnected.

CARD COUNT DECISION RULES
- One atomic thought -> 1 card, 0 edges.
- One thought with examples/details -> 1 card; put examples/details in body.
- One problem plus one clearly separate consequence/risk/question -> 2 cards, only connect if the relationship is explicit.
- A requested brainstorm/list (for example "give me three scenarios") -> exactly the requested count of child cards.
- A real multi-part thought with distinct roles -> 3-5 cards.

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
- Do not attach to an existing card based on vague topical similarity; attach only when the new card is clearly a child/detail/risk/question/next step of that exact card.

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

function languageHint(rawTranscript: string) {
  const cjkMatches = rawTranscript.match(/[\u3400-\u9fff]/g) ?? [];
  const latinMatches = rawTranscript.match(/[a-zA-Z]/g) ?? [];
  if (cjkMatches.length >= 4 && cjkMatches.length >= latinMatches.length * 0.35) {
    return {
      language: "Simplified Chinese",
      instruction:
        "MANDATORY OUTPUT LANGUAGE: Simplified Chinese. Write all user-facing title, summary, card title, and card body text in Simplified Chinese. Keep product/code terms such as API, MVP, Agent, Notion, Cmd, Space unchanged.",
    };
  }
  return {
    language: "English",
    instruction:
      "MANDATORY OUTPUT LANGUAGE: English, unless the transcript clearly uses another language. Keep product/code terms unchanged.",
  };
}

function outputLooksEnglish(value: string) {
  const letters = value.match(/[a-zA-Z]/g)?.length ?? 0;
  const cjk = value.match(/[\u3400-\u9fff]/g)?.length ?? 0;
  return letters >= 12 && cjk === 0;
}

function sanitizeOutput(parsed: z.infer<typeof OutputSchema>): z.infer<typeof OutputSchema> {
  return {
    ...parsed,
    cards: parsed.cards.map((card) => ({
      ...card,
      relation: card.relation ? normalizeCanvasEdgeLabel(card.relation) : "",
    })),
    edges: parsed.edges
      .map((edge) => ({
        ...edge,
        label: normalizeCanvasEdgeLabel(edge.label),
      }))
      .filter((edge) => edge.label),
  };
}

function violatesMandatoryLanguage(parsed: z.infer<typeof OutputSchema>, language: string) {
  if (language !== "Simplified Chinese") return false;
  const userFacing = [
    parsed.title,
    parsed.summary,
    ...parsed.cards.flatMap((card) => [card.title, card.body]),
  ]
    .join("\n")
    .trim();
  if (!userFacing) return false;
  return outputLooksEnglish(userFacing);
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
    const outputLanguage = languageHint(data.rawTranscript);

    try {
      const gateway = createOpenAIProvider(apiKey);
      const { text } = await generateText({
        model: gateway(normalizeAiModel(data.model)),
        system: SYSTEM,
        temperature: 0.2,
        maxOutputTokens: 1200,
        prompt: `${outputLanguage.instruction}

Existing cards (use exact titles for attachToTitle/edges; may be empty):\n${
          existing || "(empty canvas)"
        }\n\nRaw voice transcript:\n"""${data.rawTranscript.slice(0, 6000)}"""\n\nCreate the canvas structure now.`,
      });
      const parsed = sanitizeOutput(OutputSchema.parse(extractJSON(text)));
      if (violatesMandatoryLanguage(parsed, outputLanguage.language)) {
        console.warn("[structureVoiceToCanvas] rejected output for language mismatch");
        return fallback(data.rawTranscript);
      }
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
