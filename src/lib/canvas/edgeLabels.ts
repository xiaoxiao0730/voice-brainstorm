export const CANVAS_EDGE_LABELS = [
  "CAUSES",
  "ENABLES",
  "PART_OF",
  "DEPENDS_ON",
  "BLOCKS",
  "SUPPORTS",
  "CONTRADICTS",
  "ANSWERS",
  "LEADS_TO",
  "TESTS",
  "EXAMPLE_OF",
  "RISK_OF",
  "ALTERNATIVE_TO",
  "REFINES",
] as const;

export type CanvasEdgeLabel = (typeof CANVAS_EDGE_LABELS)[number];

const EDGE_LABEL_SET = new Set<string>(CANVAS_EDGE_LABELS);

const EDGE_LABEL_ALIASES: Record<string, CanvasEdgeLabel> = {
  ANSWER: "ANSWERS",
  ANSWERS: "ANSWERS",
  ALTERNATIVE: "ALTERNATIVE_TO",
  ALTERNATIVES: "ALTERNATIVE_TO",
  ALTERNATIVE_TO: "ALTERNATIVE_TO",
  BLOCK: "BLOCKS",
  BLOCKS: "BLOCKS",
  CAUSE: "CAUSES",
  CAUSES: "CAUSES",
  CONTRADICT: "CONTRADICTS",
  CONTRADICTS: "CONTRADICTS",
  DEPEND_ON: "DEPENDS_ON",
  DEPENDS_ON: "DEPENDS_ON",
  ENABLE: "ENABLES",
  ENABLES: "ENABLES",
  EXAMPLE: "EXAMPLE_OF",
  EXAMPLE_OF: "EXAMPLE_OF",
  LEAD_TO: "LEADS_TO",
  LEADS_TO: "LEADS_TO",
  PART_OF: "PART_OF",
  REFINES: "REFINES",
  RISK: "RISK_OF",
  RISK_OF: "RISK_OF",
  SUPPORT: "SUPPORTS",
  SUPPORTS: "SUPPORTS",
  TEST: "TESTS",
  TESTS: "TESTS",
  VS: "ALTERNATIVE_TO",
};

export function normalizeCanvasEdgeLabel(value: string | null | undefined): CanvasEdgeLabel | "" {
  const raw = (value ?? "").trim();
  if (!raw) return "";

  const normalized = raw
    .replace(/[^a-zA-Z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "")
    .toUpperCase();

  if (!normalized) return "";
  if (EDGE_LABEL_SET.has(normalized)) return normalized as CanvasEdgeLabel;
  return EDGE_LABEL_ALIASES[normalized] ?? "";
}
