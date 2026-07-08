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
type IdeaKindValue = z.infer<typeof IdeaKind>;

const IDEA_KIND_ALIASES: Record<string, IdeaKindValue> = {
  action: "next",
  next_step: "next",
  nextstep: "next",
  todo: "next",
  task: "next",
  uncertainty: "question",
  unknown: "question",
  decision_point: "question",
  decisionpoint: "question",
  problem: "risk",
  issue: "risk",
  pain: "risk",
  constraint: "risk",
  assumption: "question",
  evidence: "idea",
  context: "idea",
  background: "idea",
};

function trimToMax(value: unknown, max: number) {
  if (typeof value !== "string") return value;
  return value.trim().slice(0, max);
}

function boundedString(max: number) {
  return z.preprocess((value) => trimToMax(value, max), z.string().max(max));
}

function boundedRequiredString(max: number) {
  return z.preprocess((value) => trimToMax(value, max), z.string().min(1).max(max));
}

function normalizeIdeaKind(value: unknown) {
  if (typeof value !== "string") return value;
  const key = value.trim().toLowerCase().replace(/[\s-]+/g, "_");
  return IDEA_KIND_ALIASES[key] ?? value;
}

const FlexibleIdeaKind = z.preprocess(normalizeIdeaKind, IdeaKind);

const ExistingCardSchema = z.object({
  title: boundedString(160).default(""),
  body: boundedString(800).default(""),
  kind: FlexibleIdeaKind.default("idea"),
});

const InputSchema = z.object({
  rawTranscript: z.string().min(1).max(6000),
  existingCards: z.array(ExistingCardSchema).max(40).default([]),
  model: z.string().default("openai/gpt-4o-mini"),
});

const CardSchema = z.object({
  title: boundedRequiredString(120),
  body: boundedString(500).default(""),
  kind: FlexibleIdeaKind.default("idea"),
  role: boundedString(40).default(""),
  granularity: boundedString(40).default(""),
  attachToTitle: boundedString(160).default(""),
  relation: boundedString(80).default(""),
});

const EdgeSchema = z.object({
  sourceTitle: boundedRequiredString(160),
  targetTitle: boundedRequiredString(160),
  label: boundedString(80).default(""),
});

const OutputSchema = z.object({
  title: boundedString(120).default(""),
  summary: boundedString(500).default(""),
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
- Prefer one stable cognitive scaffold per substantial turn: one focus card plus four layer cards. For very small turns, 1-2 cards is acceptable.
- Match the user's dominant language. Use Chinese when the user speaks Chinese; English when the user speaks English. Keep terms like API, MVP, Agent, Notion as-is.
- Do not translate proper nouns, keyboard names, model names, code terms, or feature names.
- Your output should use first narrative instead of saying "the user wants to XXX". You are representing the user.

COGNITIVE TRAJECTORY GUIDELINE
Your deeper job is to help the user move through four cognitive layers. Do not label
cards mechanically as S0/S1/S2/S3 unless the user asks, but make the layer visible in
the card content and structure.
- S0 Descriptive: what happened, what the user observed, what options/facts were named.
- S1 Contextual: why it matters, the situation, constraints, user intent, background.
- S2 Analytical: competing explanations, causal chain, tradeoff, assumption, root-cause hypothesis, product judgment.
- S3 Actionable: concrete next step, MVP direction, validation question, success metric.
- Prefer progression over volume: a good map with one S2 hypothesis and one S3 next step is better than many S0 notes.
- If the transcript is only descriptive, capture S0 faithfully and add at most one S1/S2 question that would unlock progress.
- If the transcript compares possible problem framings, create S2 cards that preserve the competing hypotheses and evidence.
- If the transcript contains a product decision or validation move, create an S3 next-step card with a concrete action and success criterion.
- Avoid jumping to S3 feature ideas when the user has not established S1 context or S2 reasoning.

COGNITIVE SCAFFOLD OUTPUT
- For substantial voice captures, prefer one stable scaffold arranged as one centered focus plus four cognitive-layer cards.
- Card 1 must be the focus card. Use kind="focus", role="FOCUS", granularity="FEATURE".
- Then create one card for each layer, using these title prefixes exactly:
  - "Observation"
  - "Context"
  - "Analysis"
  - "Action"
- The four layer cards must attachToTitle to the exact focus title.
- Use each layer card body for 0-2 tight lines. Do not create separate cards for every detail.
- Progressively fill the scaffold. Do not make the first capture look like a completed answer.
- Observation should contain only what the user has actually said or what uploaded context directly supports.
- Context should name the background/workflow only when it is grounded; otherwise write a short question or "To clarify" line.
- Analysis should preserve the current hypothesis or uncertainty. Do not resolve it until evidence appears.
- Action should usually be a next thinking move, not a product solution, until Context and Analysis are grounded.
- If a layer is weak or missing, keep it sparse and write the smallest grounded gap/question for that layer.
- Do not add top-level cross edges for scaffold captures. The UI will connect focus to the four layers.
- Edge labels are not needed for scaffold captures.

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

function hasCognitiveScaffold(cards: z.infer<typeof CardSchema>[]) {
  const titles = cards.map((card) => card.title.trim().toUpperCase());
  return (
    cards.some((card) => card.kind === "focus") &&
    titles.some((title) => title === "OBSERVATION" || title === "OBSERVATIONS" || /^S0\b/.test(title)) &&
    titles.some((title) => title === "CONTEXT" || /^S1\b/.test(title)) &&
    titles.some((title) => title === "ANALYSIS" || /^S2\b/.test(title)) &&
    titles.some((title) => title === "ACTION" || /^S3\b/.test(title))
  );
}

function layerBody(cards: z.infer<typeof CardSchema>[], matcher: (card: z.infer<typeof CardSchema>) => boolean) {
  return cards
    .filter(matcher)
    .slice(0, 3)
    .map((card) => {
      const detail = card.body.trim();
      return detail ? `${card.title.trim()}: ${detail}` : card.title.trim();
    })
    .filter(Boolean)
    .join("\n");
}

function ensureCognitiveScaffold(parsed: z.infer<typeof OutputSchema>): z.infer<typeof OutputSchema> {
  if (hasCognitiveScaffold(parsed.cards)) return parsed;

  const focus = parsed.cards.find((card) => card.kind === "focus") ?? parsed.cards[0];
  const focusTitle = focus?.title.trim() || parsed.title.trim() || "Current focus";
  const observationBody = layerBody(parsed.cards, (card) => card.kind === "idea" || card.role === "OPTION") || parsed.summary;
  const contextBody = layerBody(parsed.cards, (card) => card.role === "EVIDENCE" || card.granularity === "EVIDENCE");
  const analysisBody = layerBody(
    parsed.cards,
    (card) =>
      card.kind === "risk" ||
      card.kind === "question" ||
      card.role === "RISK" ||
      card.role === "ASSUMPTION" ||
      card.granularity === "RISK" ||
      card.granularity === "ASSUMPTION" ||
      card.granularity === "QUESTION",
  );
  const actionBody = layerBody(
    parsed.cards,
    (card) =>
      card.kind === "next" ||
      card.kind === "decision" ||
      card.role === "NEXT_STEP" ||
      card.granularity === "NEXT_STEP",
  );

  return {
    ...parsed,
    title: focusTitle,
    cards: [
      {
        title: focusTitle,
        body: focus?.body.trim() || parsed.summary,
        kind: "focus",
        role: "FOCUS",
        granularity: "FEATURE",
        attachToTitle: "",
        relation: "",
      },
      {
        title: "Observation",
        body: observationBody || "What the user observed or named in this turn.",
        kind: "idea",
        role: "OPTION",
        granularity: "FEATURE",
        attachToTitle: focusTitle,
        relation: "SUPPORTS",
      },
      {
        title: "Context",
        body: contextBody || "Why this matters, the situation, constraints, or user intent to clarify next.",
        kind: "question",
        role: "QUESTION",
        granularity: "QUESTION",
        attachToTitle: focusTitle,
        relation: "SUPPORTS",
      },
      {
        title: "Analysis",
        body: analysisBody || "Compare possible explanations and identify the strongest product judgment.",
        kind: "risk",
        role: "RISK",
        granularity: "RISK",
        attachToTitle: focusTitle,
        relation: "SUPPORTS",
      },
      {
        title: "Action",
        body: actionBody || "Define the next validation step, MVP direction, or success metric.",
        kind: "next",
        role: "NEXT_STEP",
        granularity: "NEXT_STEP",
        attachToTitle: focusTitle,
        relation: "LEADS_TO",
      },
    ],
    edges: [],
  };
}

function applyCanvasContract(
  parsed: z.infer<typeof OutputSchema>,
  existingCards: Array<z.infer<typeof ExistingCardSchema>>,
): z.infer<typeof OutputSchema> {
  parsed = ensureCognitiveScaffold(parsed);
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
