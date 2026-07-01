import { z } from "zod";

import { normalizeCanvasEdgeLabel } from "@/lib/canvas/edgeLabels";

export const CANVAS_CARD_ROLES = [
  "FOCUS",
  "QUESTION",
  "OPTION",
  "EVIDENCE",
  "RISK",
  "ASSUMPTION",
  "NEXT_STEP",
] as const;

export const CANVAS_COMMAND_EDGE_RELATIONS = [
  "SUPPORTS",
  "CHALLENGES",
  "LEADS_TO",
  "DEPENDS_ON",
  "ANSWERS",
  "RISK_OF",
] as const;

export const CANVAS_CARD_GRANULARITIES = [
  "FEATURE",
  "QUESTION",
  "RISK",
  "NEXT_STEP",
  "EVIDENCE",
  "ASSUMPTION",
] as const;

export type CanvasCardRole = (typeof CANVAS_CARD_ROLES)[number];
export type CanvasCommandEdgeRelation = (typeof CANVAS_COMMAND_EDGE_RELATIONS)[number];
export type CanvasCardGranularity = (typeof CANVAS_CARD_GRANULARITIES)[number];

export const CanvasCommandCardSchema = z.object({
  title: z.string().min(1).max(80),
  body: z.string().max(360).default(""),
  role: z.enum(CANVAS_CARD_ROLES),
  granularity: z.enum(CANVAS_CARD_GRANULARITIES).default("FEATURE"),
  attachToTitle: z.string().max(160).default(""),
  relation: z.enum(CANVAS_COMMAND_EDGE_RELATIONS).optional(),
});

export const CanvasCommandEdgeSchema = z.object({
  sourceTitle: z.string().min(1).max(160),
  targetTitle: z.string().min(1).max(160),
  relation: z.enum(CANVAS_COMMAND_EDGE_RELATIONS),
});

export const CanvasCommandResultSchema = z.object({
  cards: z.array(CanvasCommandCardSchema).max(3).default([]),
  edges: z.array(CanvasCommandEdgeSchema).max(2).default([]),
});

export type CanvasCommandCard = z.infer<typeof CanvasCommandCardSchema>;
export type CanvasCommandEdge = z.infer<typeof CanvasCommandEdgeSchema>;
export type CanvasCommandResult = z.infer<typeof CanvasCommandResultSchema>;

const LIMITS = {
  maxCards: 3,
  maxEdges: 2,
  maxCrossLinks: 1,
  maxTitleChars: 80,
  maxBodyChars: 360,
};

const ROLE_BY_KIND: Record<string, CanvasCardRole> = {
  focus: "FOCUS",
  question: "QUESTION",
  idea: "OPTION",
  decision: "NEXT_STEP",
  risk: "RISK",
  next: "NEXT_STEP",
};

const KIND_BY_ROLE: Record<
  CanvasCardRole,
  "focus" | "idea" | "question" | "decision" | "risk" | "next"
> = {
  FOCUS: "focus",
  QUESTION: "question",
  OPTION: "idea",
  EVIDENCE: "idea",
  RISK: "risk",
  ASSUMPTION: "question",
  NEXT_STEP: "next",
};

const GRANULARITY_BY_ROLE: Record<CanvasCardRole, CanvasCardGranularity> = {
  FOCUS: "FEATURE",
  QUESTION: "QUESTION",
  OPTION: "FEATURE",
  EVIDENCE: "EVIDENCE",
  RISK: "RISK",
  ASSUMPTION: "ASSUMPTION",
  NEXT_STEP: "NEXT_STEP",
};

const ROLE_BY_GRANULARITY: Record<CanvasCardGranularity, CanvasCardRole> = {
  FEATURE: "OPTION",
  QUESTION: "QUESTION",
  RISK: "RISK",
  NEXT_STEP: "NEXT_STEP",
  EVIDENCE: "EVIDENCE",
  ASSUMPTION: "ASSUMPTION",
};

const RELATION_BY_EDGE_LABEL: Record<string, CanvasCommandEdgeRelation> = {
  SUPPORTS: "SUPPORTS",
  CHALLENGES: "CHALLENGES",
  CONTRADICTS: "CHALLENGES",
  BLOCKS: "CHALLENGES",
  LEADS_TO: "LEADS_TO",
  ENABLES: "LEADS_TO",
  DEPENDS_ON: "DEPENDS_ON",
  ANSWERS: "ANSWERS",
  RISK_OF: "RISK_OF",
  TESTS: "SUPPORTS",
  EXAMPLE_OF: "SUPPORTS",
  PART_OF: "SUPPORTS",
  REFINES: "SUPPORTS",
  CAUSES: "LEADS_TO",
  ALTERNATIVE_TO: "CHALLENGES",
};

function normalizeTitleKey(value: string | null | undefined) {
  return (value ?? "").trim().replace(/\s+/g, " ").toLowerCase();
}

function truncate(value: string, max: number) {
  const trimmed = value.trim();
  if (trimmed.length <= max) return trimmed;
  return trimmed.slice(0, max - 1).trimEnd();
}

function normalizeRelation(
  value: string | null | undefined,
): CanvasCommandEdgeRelation | undefined {
  const normalized = normalizeCanvasEdgeLabel(value);
  if (!normalized) return undefined;
  return RELATION_BY_EDGE_LABEL[normalized] ?? undefined;
}

function normalizeGranularity(value: string | null | undefined): CanvasCardGranularity | undefined {
  const normalized = String(value ?? "")
    .trim()
    .toUpperCase()
    .replace(/[\s-]+/g, "_");
  return CANVAS_CARD_GRANULARITIES.includes(normalized as CanvasCardGranularity)
    ? (normalized as CanvasCardGranularity)
    : undefined;
}

function roleFromGranularity(value: string | null | undefined): CanvasCardRole | undefined {
  const granularity = normalizeGranularity(value);
  return granularity ? ROLE_BY_GRANULARITY[granularity] : undefined;
}

function titleTokens(value: string) {
  const text = value.toLowerCase();
  const tokens = new Set<string>();
  for (const match of text.matchAll(/[a-z0-9][a-z0-9_-]{2,}/g)) {
    tokens.add(match[0]);
  }

  const cjkChars = text.match(/[\u4e00-\u9fff]/g) ?? [];
  for (let index = 0; index < cjkChars.length - 1; index += 1) {
    tokens.add(`${cjkChars[index]}${cjkChars[index + 1]}`);
  }

  return tokens;
}

function intersects(left: Set<string>, right: Set<string>) {
  for (const token of left) {
    if (right.has(token)) return true;
  }
  return false;
}

function isFeatureFlowCluster(
  cards: CanvasCommandCard[],
  rawEdges: Array<{
    sourceTitle: string;
    targetTitle: string;
    label?: string;
    relation?: string;
  }> = [],
) {
  if (cards.length < 2) return false;
  if (cards.some((card) => card.granularity !== "FEATURE")) return false;
  if (cards.some((card) => card.role !== "OPTION" && card.role !== "FOCUS")) return false;

  const parentKeys = new Set(cards.map((card) => normalizeTitleKey(card.attachToTitle)));
  if (parentKeys.size > 1) return false;

  const cardTitleKeys = new Set(cards.map((card) => normalizeTitleKey(card.title)));
  const featureEdges = rawEdges.filter((edge) => {
    const sourceKey = normalizeTitleKey(edge.sourceTitle);
    const targetKey = normalizeTitleKey(edge.targetTitle);
    const relation = normalizeRelation(edge.relation ?? edge.label);
    return (
      cardTitleKeys.has(sourceKey) &&
      cardTitleKeys.has(targetKey) &&
      (relation === "SUPPORTS" || relation === "LEADS_TO")
    );
  });
  const hasOnlyFeatureFlowEdges =
    featureEdges.length > 0 &&
    rawEdges.every((edge) => {
      const relation = normalizeRelation(edge.relation ?? edge.label);
      return !relation || relation === "SUPPORTS" || relation === "LEADS_TO";
    });

  const tokenSets = cards.map((card) => titleTokens(`${card.title} ${card.body}`));
  const sharesConcept = tokenSets.every((tokens, index) => {
    if (index === 0) return tokens.size > 0;
    return tokenSets.slice(0, index).some((previous) => intersects(tokens, previous));
  });

  return hasOnlyFeatureFlowEdges || sharesConcept;
}

function mergeFeatureFlowCards(cards: CanvasCommandCard[]): CanvasCommandCard {
  const [first] = cards;
  const details = cards
    .flatMap((card) => {
      const body = card.body.trim();
      if (!body) return [card.title];
      return [`${card.title}: ${body}`];
    })
    .filter(Boolean);

  return {
    ...first,
    title: first.title,
    body: truncate(details.join("; "), LIMITS.maxBodyChars),
    role: first.role === "FOCUS" ? "FOCUS" : "OPTION",
    granularity: "FEATURE",
  };
}

export function roleToIdeaKind(role: CanvasCardRole) {
  return KIND_BY_ROLE[role];
}

export function canvasRelationToEdgeLabel(relation: CanvasCommandEdgeRelation | undefined) {
  if (!relation) return "";
  if (relation === "CHALLENGES") return "CONTRADICTS";
  return relation;
}

export function roleFromIdeaKind(kind: string | null | undefined): CanvasCardRole {
  return ROLE_BY_KIND[(kind ?? "").trim().toLowerCase()] ?? "OPTION";
}

export function validateCanvasCommandResult(input: {
  cards: Array<{
    title: string;
    body?: string;
    kind?: string;
    role?: string;
    granularity?: string;
    attachToTitle?: string;
    relation?: string;
  }>;
  edges?: Array<{
    sourceTitle: string;
    targetTitle: string;
    label?: string;
    relation?: string;
  }>;
  existingTitles?: string[];
}): CanvasCommandResult {
  const existingTitleKeys = new Set((input.existingTitles ?? []).map(normalizeTitleKey));
  const seenTitleKeys = new Set<string>();
  const cards: CanvasCommandCard[] = [];

  for (const raw of input.cards) {
    if (cards.length >= LIMITS.maxCards) break;
    const title = truncate(raw.title ?? "", LIMITS.maxTitleChars);
    const titleKey = normalizeTitleKey(title);
    if (!title || !titleKey || existingTitleKeys.has(titleKey) || seenTitleKeys.has(titleKey))
      continue;

    const roleCandidate = String(raw.role ?? "")
      .trim()
      .toUpperCase();
    const rawRole = CANVAS_CARD_ROLES.includes(roleCandidate as CanvasCardRole)
      ? (roleCandidate as CanvasCardRole)
      : undefined;
    const rawGranularity = normalizeGranularity(raw.granularity);
    const role =
      rawGranularity && rawGranularity !== "FEATURE"
        ? ROLE_BY_GRANULARITY[rawGranularity]
        : (rawRole ?? roleFromGranularity(raw.granularity) ?? roleFromIdeaKind(raw.kind));
    const granularity =
      rawGranularity && rawGranularity !== "FEATURE" ? rawGranularity : GRANULARITY_BY_ROLE[role];
    const relation = normalizeRelation(raw.relation);

    cards.push({
      title,
      body: truncate(raw.body ?? "", LIMITS.maxBodyChars),
      role,
      granularity,
      attachToTitle: truncate(raw.attachToTitle ?? "", 160),
      ...(relation ? { relation } : {}),
    });
    seenTitleKeys.add(titleKey);
  }

  const contractedCards = isFeatureFlowCluster(cards, input.edges)
    ? [mergeFeatureFlowCards(cards)]
    : cards;

  const knownTitleKeys = new Set([
    ...existingTitleKeys,
    ...contractedCards.map((card) => normalizeTitleKey(card.title)),
  ]);
  const parentLinks = new Set(
    contractedCards
      .filter((card) => card.attachToTitle.trim())
      .map((card) => `${normalizeTitleKey(card.attachToTitle)}->${normalizeTitleKey(card.title)}`),
  );

  const edges: CanvasCommandEdge[] = [];
  let crossLinks = 0;
  for (const raw of input.edges ?? []) {
    if (edges.length >= LIMITS.maxEdges || crossLinks >= LIMITS.maxCrossLinks) break;
    const sourceTitle = truncate(raw.sourceTitle ?? "", 160);
    const targetTitle = truncate(raw.targetTitle ?? "", 160);
    const sourceKey = normalizeTitleKey(sourceTitle);
    const targetKey = normalizeTitleKey(targetTitle);
    if (!sourceKey || !targetKey || sourceKey === targetKey) continue;
    if (!knownTitleKeys.has(sourceKey) || !knownTitleKeys.has(targetKey)) continue;
    if (parentLinks.has(`${sourceKey}->${targetKey}`)) continue;

    const relation = normalizeRelation(raw.relation ?? raw.label);
    if (!relation) continue;
    if (
      edges.some(
        (edge) =>
          normalizeTitleKey(edge.sourceTitle) === sourceKey &&
          normalizeTitleKey(edge.targetTitle) === targetKey,
      )
    ) {
      continue;
    }

    edges.push({ sourceTitle, targetTitle, relation });
    crossLinks += 1;
  }

  return CanvasCommandResultSchema.parse({ cards: contractedCards, edges });
}
