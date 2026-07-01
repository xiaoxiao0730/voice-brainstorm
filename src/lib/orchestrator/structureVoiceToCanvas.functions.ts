import { createServerFn } from "@tanstack/react-start";
import { generateText } from "ai";
import { z } from "zod";

import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import {
  canvasRelationToEdgeLabel,
  type CanvasCardGranularity,
  roleFromIdeaKind,
  roleToIdeaKind,
  validateCanvasCommandResult,
  type CanvasCardRole,
} from "@/lib/canvas/canvasCommandContract";
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
  role: z.string().max(40).default(""),
  granularity: z.string().max(40).default(""),
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
- Prefer 1-2 cards per turn. Use one card for one conceptual unit, not one sentence. Never exceed 3 cards unless the user explicitly asks for a numbered list.
- Match the user's dominant language. Use Chinese when the user speaks Chinese; English when the user speaks English. Keep terms like API, MVP, Agent, Notion as-is.
- Do not translate proper nouns, keyboard names, model names, code terms, or feature names.
- Your output should use first narrative instead of saying "the user wants to XXX". You are representing the user.

TIDY MAP QUALITY RULES
- Make the map visually tidy: one clear central focus when possible, then compact branch cards.
- Card titles should be short labels, usually 3-9 words / 4-16 Chinese characters.
- Put supporting detail in body. Do not make huge paragraph titles.
- Avoid duplicate cards that say the same thing with different words.
- Every card must have one thinking role: FOCUS, QUESTION, OPTION, EVIDENCE, RISK, ASSUMPTION, NEXT_STEP.
- Prefer one card per semantic role: focus, question, option, evidence, risk, assumption, next step.
- Every card must have one granularity: FEATURE, QUESTION, RISK, NEXT_STEP, EVIDENCE, ASSUMPTION.
- Split by thinking role, not by sentence order.
- Do not split a single product feature into separate cards just because it has multiple steps, surfaces, outputs, or implementation details.
- If several sentences share the same subject and describe one feature flow, create ONE FEATURE card and put substeps/details in the body.
- Do not create separate cards for product/platform name, feature action, UI surface, and output format when they describe the same feature.
- Split only when the thinking roles differ, for example FEATURE + RISK, FEATURE + QUESTION, FEATURE + NEXT_STEP, or EVIDENCE + ASSUMPTION.
- Prefer a clean tree: use attachToTitle + relation for parent-child structure.
- Use the top-level edges array only for 0-1 important cross-link that is not already captured by attachToTitle.
- Do not connect everything. Most good maps need only parent-child links.
- Never make a chain just because ideas were spoken in sequence.
- Only create an edge when its label would still make sense if read aloud between the two card titles.
- If a card is a risk/question/next step about another card, set attachToTitle to that parent card's exact title.
- If the transcript is rambly, extract the stable skeleton instead of every aside.
- If you are unsure whether two cards relate, leave them unconnected.

EDGE LABELS
- Edge labels MUST be exactly one categorical tag from this set: SUPPORTS, CHALLENGES, LEADS_TO, DEPENDS_ON, ANSWERS, RISK_OF.
- Edge labels are NOT natural language. Do not write explanations in edges.
- Prefer relation labels on cards over extra edges whenever the relation is parent-child.
- Avoid long-distance cross-links unless they are central to the user's meaning.

KINDS
- focus: the current central goal/topic.
- question: open question / uncertainty / thing to decide.
- idea: promising direction, concept, possible approach.
- risk: problem, constraint, tension, failure mode.
- decision: settled conclusion or choice.
- next: concrete next action.

ROLE MAPPING
- FOCUS: the central thing being explored.
- QUESTION: uncertainty or thing to decide.
- OPTION: possible direction, mechanism, feature, or approach.
- EVIDENCE: external finding, example, or support.
- RISK: problem, constraint, or failure mode.
- ASSUMPTION: belief that must be tested.
- NEXT_STEP: concrete next action or validation step.

CARD GRANULARITY
- FEATURE: one product feature, mechanism, workflow, or product idea. If several clauses describe one flow, keep them in ONE card.
- QUESTION: uncertainty or decision point.
- RISK: failure mode, concern, tradeoff, or constraint.
- NEXT_STEP: concrete validation or action.
- EVIDENCE: external fact, example, support, or research finding.
- ASSUMPTION: belief that must be tested.

GRANULARITY EXAMPLES
- Transcript idea: "飞书可以在会议里实时总结，然后生成思维导图，再在会议界面展示出来。"
  Good: ONE FEATURE card titled "飞书会议实时思维导图" with the full flow in the body.
  Bad: three cards for "飞书实时总结", "生成思维导图", and "会议界面展示".
- Transcript idea: "这个功能很好，但风险是用户会不信任自动总结。"
  Good: one FEATURE card + one RISK card attached to it.
- Transcript idea: "我还不确定应该先做语音转录还是先做画布生成。"
  Good: one QUESTION card.

EXISTING CANVAS RELATIONSHIP RULES
- attachToTitle must be either an EXACT title from Existing cards or "".
- Use attachToTitle when the new card is a child/detail/answer/risk/next-step of an existing card.
- If the new thought introduces a separate cluster, leave attachToTitle empty.
- Edges can connect new cards to existing cards or to other new cards. Use exact titles.
- Do not attach to an existing card based on vague topical similarity; attach only when the new card is clearly a child/detail/risk/question/next step of that exact card.

Output language MUST strictly follow the user's latest input language.

- If user speaks Chinese → ALL outputs must be Chinese
- If user speaks English → ALL outputs must be English

This applies to:
- canvas nodes
- brief
- summaries
- labels
- explanations

NO EXCEPTIONS.

OUTPUT STRICT JSON ONLY:
{
  "title": "short cluster title",
  "summary": "one concise sentence",
  "cards": [
    { "title": "...", "body": "...", "kind": "idea", "role": "OPTION", "granularity": "FEATURE", "attachToTitle": "", "relation": "" }
  ],
  "edges": [
    { "sourceTitle": "...", "targetTitle": "...", "label": "SUPPORTS" }
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
        role: "OPTION",
        granularity: "FEATURE",
        attachToTitle: "",
        relation: "",
      },
    ],
    edges: [],
  };
}

function applyCanvasContract(
  parsed: z.infer<typeof OutputSchema>,
  existingCards: Array<z.infer<typeof ExistingCardSchema>>,
): z.infer<typeof OutputSchema> {
  const validated = validateCanvasCommandResult({
    existingTitles: existingCards.map((card) => card.title),
    cards: parsed.cards.map((card) => ({
      title: card.title,
      body: card.body,
      kind: card.kind,
      role: card.role,
      granularity: card.granularity,
      attachToTitle: card.attachToTitle,
      relation: card.relation,
    })),
    edges: parsed.edges.map((edge) => ({
      sourceTitle: edge.sourceTitle,
      targetTitle: edge.targetTitle,
      label: edge.label,
    })),
  });

  const cards = validated.cards.map((card) => {
    const role = card.role as CanvasCardRole;
    const granularity = card.granularity as CanvasCardGranularity;
    return {
      title: card.title,
      body: card.body,
      kind: roleToIdeaKind(role),
      role,
      granularity,
      attachToTitle: card.attachToTitle,
      relation: canvasRelationToEdgeLabel(card.relation),
    };
  });

  return {
    ...parsed,
    cards:
      cards.length > 0
        ? cards
        : parsed.cards.slice(0, 1).map((card) => ({
            ...card,
            title: card.title.slice(0, 80),
            body: card.body.slice(0, 360),
            role: roleFromIdeaKind(card.kind),
            granularity: card.granularity || "FEATURE",
          })),
    edges: validated.edges.map((edge) => ({
      sourceTitle: edge.sourceTitle,
      targetTitle: edge.targetTitle,
      label: canvasRelationToEdgeLabel(edge.relation),
    })),
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
      const parsed = applyCanvasContract(OutputSchema.parse(extractJSON(text)), data.existingCards);
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
