import type { IdeaCanvasState, IdeaNodeKind } from "@/components/mindmap/IdeaCanvas";

const STOP_TERMS = new Set([
  "the",
  "and",
  "for",
  "with",
  "that",
  "this",
  "from",
  "have",
  "what",
  "when",
  "where",
  "就是",
  "然后",
  "这个",
  "那个",
  "嗯",
  "啊",
]);

function clean(value: string) {
  return value.replace(/\s+/g, " ").trim();
}

function truncate(value: string, max: number) {
  const text = clean(value);
  return text.length > max ? `${text.slice(0, max - 1).trimEnd()}…` : text;
}

function extractTerms(texts: string[], limit = 18) {
  const counts = new Map<string, number>();
  const add = (term: string) => {
    const normalized = clean(term).toLowerCase();
    if (normalized.length < 2 || STOP_TERMS.has(normalized)) return;
    counts.set(normalized, (counts.get(normalized) ?? 0) + 1);
  };

  for (const text of texts) {
    const compact = clean(text);
    for (const match of compact.matchAll(
      /[A-Za-z][A-Za-z0-9_-]*(?:\s+[A-Za-z][A-Za-z0-9_-]*){0,3}/g,
    )) {
      add(match[0]);
    }
    for (const match of compact.matchAll(/[\u4e00-\u9fa5]{2,8}/g)) {
      add(match[0]);
    }
  }

  return Array.from(counts.entries())
    .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
    .slice(0, limit)
    .map(([term]) => term);
}

export function formatAgentCanvasContext({
  canvas,
  recentTranscript = [],
}: {
  canvas: IdeaCanvasState;
  recentTranscript?: string[];
}) {
  const nodes = canvas.nodes
    .filter((node) => node.data.title?.trim() || node.data.body?.trim())
    .slice(-80);
  const nodeIds = new Set(nodes.map((node) => node.id));
  const edges = canvas.edges.filter((edge) => nodeIds.has(edge.source) && nodeIds.has(edge.target));
  const titleById = new Map(nodes.map((node) => [node.id, clean(node.data.title || node.id)]));
  const terms = extractTerms([
    ...nodes.flatMap((node) => [node.data.title ?? "", node.data.body ?? ""]),
    ...recentTranscript.slice(-12),
  ]);

  const lines = ["[Current Canvas Context]", "", "Nodes:"];
  if (nodes.length === 0) {
    lines.push("- (empty canvas)");
  } else {
    for (const node of nodes) {
      const title = truncate(node.data.title || "Untitled", 120);
      const body = truncate(node.data.body || "", 260);
      const flags = [node.selected ? "selected" : ""].filter(Boolean).join(", ");
      lines.push(
        `- ${node.id} [${node.data.kind as IdeaNodeKind}] ${title}${flags ? ` (${flags})` : ""}`,
      );
      if (body) lines.push(`  body: ${body}`);
    }
  }

  lines.push("", "Edges:");
  if (edges.length === 0) {
    lines.push("- (none)");
  } else {
    for (const edge of edges.slice(-80)) {
      const source = titleById.get(edge.source) ?? edge.source;
      const target = titleById.get(edge.target) ?? edge.target;
      const label =
        typeof edge.label === "string" && edge.label.trim() ? `: ${truncate(edge.label, 80)}` : "";
      lines.push(`- ${source} -> ${target}${label}`);
    }
  }

  lines.push("", "Recent transcript:");
  const recent = recentTranscript
    .map((text) => truncate(text, 180))
    .filter(Boolean)
    .slice(-8);
  lines.push(...(recent.length ? recent.map((text) => `- ${text}`) : ["- (none)"]));

  lines.push("", "Recent terms:");
  lines.push(terms.length ? terms.join(", ") : "(none)");

  return lines.join("\n");
}
