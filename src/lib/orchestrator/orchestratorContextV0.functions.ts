import { z } from "zod";

import {
  EdgeRelationSchema,
  ThinkingStateV0Schema,
  type EdgeRelation,
  type ThinkingStateV0,
  type ThoughtEdge,
  type ThoughtNode,
} from "@/lib/agent/thinkingState.functions";

const UploadedContextSchema = z.object({
  id: z.string().max(120).default(""),
  title: z.string().max(180).default(""),
  summary: z.string().max(1200).default(""),
  relevantSnippets: z.array(z.string().max(1200)).max(12).default([]),
  sourceType: z.enum(["file", "url", "manual", "research", "unknown"]).default("unknown"),
});

const CanvasSnapshotInputSchema = z.object({
  plainText: z.string().max(12000).default(""),
  nodes: z
    .array(
      z.object({
        id: z.string().max(160).default(""),
        title: z.string().max(240).default(""),
        body: z.string().max(1200).default(""),
        kind: z.string().max(80).default("idea"),
        selected: z.boolean().default(false),
      }),
    )
    .max(120)
    .default([]),
  edges: z
    .array(
      z.object({
        source: z.string().max(160).default(""),
        target: z.string().max(160).default(""),
        label: z.string().max(120).default(""),
      }),
    )
    .max(240)
    .default([]),
});

const BuildContextInputSchema = z.object({
  thinkingState: ThinkingStateV0Schema,
  recentTurns: z.array(z.string().max(2000)).max(20).default([]),
  uploadedContext: z.array(UploadedContextSchema).max(20).default([]),
  canvasSnapshot: CanvasSnapshotInputSchema.default({ plainText: "", nodes: [], edges: [] }),
});

export type UploadedContextV0 = z.infer<typeof UploadedContextSchema>;
export type CanvasSnapshotV0 = z.infer<typeof CanvasSnapshotInputSchema>;
export type BuildOrchestratorContextV0Input = z.infer<typeof BuildContextInputSchema>;

export type OrchestratorContextNodeV0 = {
  id: string;
  type: ThoughtNode["type"];
  content: string;
  source: ThoughtNode["source"];
  confidence: number;
  relationToFocus?: EdgeRelation | "self" | "parent" | "child";
};

export type OrchestratorContextOutlineNodeV0 = OrchestratorContextNodeV0 & {
  children: OrchestratorContextOutlineNodeV0[];
};

export type OrchestratorContextV0 = {
  sessionId: string;
  stateSummary: string;
  semanticSummary: {
    goal: string;
    stage: ThinkingStateV0["control"]["interactionStage"];
    focus: string;
    keyClaims: string[];
    openQuestions: string[];
    decisions: string[];
    tensions: string[];
    nextLikelyFocus: string;
  };
  focus: {
    nodeId: string | null;
    node: OrchestratorContextNodeV0 | null;
    relatedNodes: OrchestratorContextNodeV0[];
  };
  graph: {
    outline: OrchestratorContextOutlineNodeV0[];
    flatNodes: OrchestratorContextNodeV0[];
    edges: ThoughtEdge[];
  };
  unresolvedQuestions: OrchestratorContextNodeV0[];
  recentTurns: string[];
  uploadedContext: UploadedContextV0[];
  canvasSnapshot: CanvasSnapshotV0;
  diagnostics: {
    nodeCount: number;
    edgeCount: number;
    rootCount: number;
    uploadedContextCount: number;
    recentTurnCount: number;
  };
};

function clean(value: string) {
  return value.replace(/\s+/g, " ").trim();
}

function truncate(value: string, max: number) {
  const text = clean(value);
  return text.length > max ? `${text.slice(0, max - 1).trimEnd()}…` : text;
}

function dedupeStrings(values: string[], limit: number) {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const value of values) {
    const text = clean(value);
    const key = text.toLowerCase();
    if (!text || seen.has(key)) continue;
    seen.add(key);
    out.push(text);
    if (out.length >= limit) break;
  }
  return out;
}

function normalizeGraph(state: ThinkingStateV0): ThinkingStateV0 {
  const parsed = ThinkingStateV0Schema.parse(state);
  const nodeIds = new Set(parsed.graph.nodes.map((node) => node.id));
  const edges = parsed.graph.edges.filter(
    (edge) => nodeIds.has(edge.source) && nodeIds.has(edge.target) && edge.source !== edge.target,
  );
  const parentByChild = new Map<string, string>();
  for (const edge of edges) {
    if (edge.relation === "includes") parentByChild.set(edge.target, edge.source);
  }
  const nodes = parsed.graph.nodes.map((node) => {
    const parentId = node.parentId && nodeIds.has(node.parentId) ? node.parentId : parentByChild.get(node.id);
    return parentId ? { ...node, parentId } : { ...node, parentId: undefined };
  });
  const normalizedIds = new Set(nodes.map((node) => node.id));
  const questionIds = new Set(nodes.filter((node) => node.type === "question").map((node) => node.id));
  return {
    ...parsed,
    graph: { nodes, edges },
    control: {
      ...parsed.control,
      focusNodeId:
        parsed.control.focusNodeId && normalizedIds.has(parsed.control.focusNodeId)
          ? parsed.control.focusNodeId
          : null,
      unresolvedQuestionIds: parsed.control.unresolvedQuestionIds.filter((id) => questionIds.has(id)),
    },
  };
}

function toContextNode(node: ThoughtNode, relationToFocus?: OrchestratorContextNodeV0["relationToFocus"]): OrchestratorContextNodeV0 {
  return {
    id: node.id,
    type: node.type,
    content: node.content,
    source: node.source,
    confidence: node.confidence,
    ...(relationToFocus ? { relationToFocus } : {}),
  };
}

function relationPriority(relation: OrchestratorContextNodeV0["relationToFocus"] | undefined) {
  if (relation === "self") return 0;
  if (relation === "parent") return 1;
  if (relation === "child") return 2;
  if (relation === "leads_to") return 3;
  if (relation === "contradicts") return 4;
  if (relation === "includes") return 5;
  return 9;
}

function buildRelatedNodes(state: ThinkingStateV0, focusNode: ThoughtNode | undefined) {
  if (!focusNode) return [];
  const byId = new Map(state.graph.nodes.map((node) => [node.id, node] as const));
  const related = new Map<string, OrchestratorContextNodeV0>();
  related.set(focusNode.id, toContextNode(focusNode, "self"));

  const parent = focusNode.parentId ? byId.get(focusNode.parentId) : undefined;
  if (parent) related.set(parent.id, toContextNode(parent, "parent"));

  for (const node of state.graph.nodes) {
    if (node.parentId === focusNode.id) related.set(node.id, toContextNode(node, "child"));
  }

  for (const edge of state.graph.edges) {
    if (edge.source === focusNode.id) {
      const target = byId.get(edge.target);
      if (target) related.set(target.id, toContextNode(target, edge.relation));
    }
    if (edge.target === focusNode.id) {
      const source = byId.get(edge.source);
      if (source) related.set(source.id, toContextNode(source, edge.relation));
    }
  }

  return Array.from(related.values())
    .sort((a, b) => relationPriority(a.relationToFocus) - relationPriority(b.relationToFocus))
    .slice(0, 12);
}

function buildOutline(state: ThinkingStateV0) {
  const byParent = new Map<string, ThoughtNode[]>();
  const roots: ThoughtNode[] = [];
  for (const node of state.graph.nodes) {
    if (node.parentId) {
      byParent.set(node.parentId, [...(byParent.get(node.parentId) ?? []), node]);
    } else {
      roots.push(node);
    }
  }

  const visit = (node: ThoughtNode, seen: Set<string>, depth: number): OrchestratorContextOutlineNodeV0 => {
    if (seen.has(node.id) || depth >= 5) return { ...toContextNode(node), children: [] };
    const nextSeen = new Set(seen);
    nextSeen.add(node.id);
    const children = (byParent.get(node.id) ?? [])
      .slice()
      .sort((a, b) => a.updatedAt.localeCompare(b.updatedAt))
      .map((child) => visit(child, nextSeen, depth + 1));
    return { ...toContextNode(node), children };
  };

  return roots
    .slice()
    .sort((a, b) => a.updatedAt.localeCompare(b.updatedAt))
    .map((node) => visit(node, new Set<string>(), 0));
}

function formatOutlineLines(nodes: OrchestratorContextOutlineNodeV0[], depth = 0): string[] {
  return nodes.flatMap((node) => {
    const prefix = `${"  ".repeat(depth)}- `;
    return [
      `${prefix}${node.content} [${node.type}]`,
      ...formatOutlineLines(node.children, depth + 1),
    ];
  });
}

function edgeText(edge: ThoughtEdge, byId: Map<string, ThoughtNode>) {
  const source = byId.get(edge.source)?.content ?? edge.source;
  const target = byId.get(edge.target)?.content ?? edge.target;
  if (edge.relation === "contradicts") return `${source} conflicts with ${target}`;
  if (edge.relation === "leads_to") return `${source} leads to ${target}`;
  return `${source} includes ${target}`;
}

function buildSemanticSummary(state: ThinkingStateV0, relatedNodes: OrchestratorContextNodeV0[]) {
  const byId = new Map(state.graph.nodes.map((node) => [node.id, node] as const));
  const focus = state.control.focusNodeId ? byId.get(state.control.focusNodeId) : undefined;
  const unresolvedQuestionIds = new Set(state.control.unresolvedQuestionIds);
  const openQuestions = state.graph.nodes
    .filter((node) => node.type === "question" && (unresolvedQuestionIds.size === 0 || unresolvedQuestionIds.has(node.id)))
    .map((node) => node.content)
    .slice(0, 8);
  const decisions = state.graph.nodes
    .filter((node) => node.type === "decision")
    .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))
    .map((node) => node.content)
    .slice(0, 6);
  const keyClaims = state.graph.nodes
    .filter((node) => node.type === "fact" || node.type === "thought")
    .sort((a, b) => b.confidence - a.confidence || b.updatedAt.localeCompare(a.updatedAt))
    .map((node) => node.content)
    .slice(0, 8);
  const tensions = state.graph.edges
    .filter((edge) => edge.relation === "contradicts")
    .map((edge) => edgeText(edge, byId))
    .slice(0, 6);
  const nextLikelyFocus =
    relatedNodes.find((node) => node.relationToFocus === "leads_to")?.content ??
    openQuestions[0] ??
    focus?.content ??
    "";

  return {
    goal: state.control.goal,
    stage: state.control.interactionStage,
    focus: focus?.content ?? "",
    keyClaims,
    openQuestions,
    decisions,
    tensions,
    nextLikelyFocus,
  };
}

function formatStateSummary(args: {
  semanticSummary: OrchestratorContextV0["semanticSummary"];
  outline: OrchestratorContextOutlineNodeV0[];
  uploadedContextCount: number;
  canvasText: string;
}) {
  const lines = [
    `Goal: ${args.semanticSummary.goal || "(unclear)"}`,
    `Stage: ${args.semanticSummary.stage}`,
    `Focus: ${args.semanticSummary.focus || "(none)"}`,
  ];
  if (args.semanticSummary.keyClaims.length) {
    lines.push("Key claims:", ...args.semanticSummary.keyClaims.slice(0, 5).map((item) => `- ${item}`));
  }
  if (args.semanticSummary.openQuestions.length) {
    lines.push("Open questions:", ...args.semanticSummary.openQuestions.slice(0, 5).map((item) => `- ${item}`));
  }
  if (args.semanticSummary.tensions.length) {
    lines.push("Tensions:", ...args.semanticSummary.tensions.slice(0, 3).map((item) => `- ${item}`));
  }
  if (args.semanticSummary.nextLikelyFocus) lines.push(`Next likely focus: ${args.semanticSummary.nextLikelyFocus}`);
  const outlineLines = formatOutlineLines(args.outline).slice(0, 20);
  if (outlineLines.length) lines.push("Outline:", ...outlineLines);
  if (args.uploadedContextCount > 0) lines.push(`Uploaded context: ${args.uploadedContextCount} item(s)`);
  if (clean(args.canvasText)) lines.push(`Canvas snapshot: ${truncate(args.canvasText, 500)}`);
  return lines.join("\n");
}

function normalizeUploadedContext(items: UploadedContextV0[]) {
  return items
    .map((item, index) => ({
      ...item,
      id: clean(item.id) || `context_${index + 1}`,
      title: truncate(item.title || `Context ${index + 1}`, 180),
      summary: truncate(item.summary, 1200),
      relevantSnippets: dedupeStrings(item.relevantSnippets, 8).map((snippet) => truncate(snippet, 1000)),
    }))
    .filter((item) => item.title || item.summary || item.relevantSnippets.length > 0)
    .slice(0, 12);
}

function normalizeCanvasSnapshot(snapshot: CanvasSnapshotV0): CanvasSnapshotV0 {
  const nodes = snapshot.nodes
    .map((node) => ({
      id: clean(node.id),
      title: truncate(node.title, 180),
      body: truncate(node.body, 1000),
      kind: clean(node.kind) || "idea",
      selected: node.selected,
    }))
    .filter((node) => node.id || node.title || node.body)
    .slice(-80);
  const nodeIds = new Set(nodes.map((node) => node.id).filter(Boolean));
  const edges = snapshot.edges
    .map((edge) => ({
      source: clean(edge.source),
      target: clean(edge.target),
      label: truncate(edge.label, 100),
    }))
    .filter((edge) => edge.source && edge.target && nodeIds.has(edge.source) && nodeIds.has(edge.target))
    .slice(-120);
  const plainText = snapshot.plainText || nodes.map((node) => [node.title, node.body].filter(Boolean).join(": ")).join("\n");
  return { plainText: truncate(plainText, 10000), nodes, edges };
}

export function buildOrchestratorContextV0(input: BuildOrchestratorContextV0Input): OrchestratorContextV0 {
  const parsed = BuildContextInputSchema.parse(input);
  const state = normalizeGraph(parsed.thinkingState);
  const byId = new Map(state.graph.nodes.map((node) => [node.id, node] as const));
  const focusNode = state.control.focusNodeId ? byId.get(state.control.focusNodeId) : undefined;
  const relatedNodes = buildRelatedNodes(state, focusNode);
  const outline = buildOutline(state);
  const semanticSummary = buildSemanticSummary(state, relatedNodes);
  const uploadedContext = normalizeUploadedContext(parsed.uploadedContext);
  const canvasSnapshot = normalizeCanvasSnapshot(parsed.canvasSnapshot);
  const flatNodes = state.graph.nodes.map((node) => toContextNode(node));

  return {
    sessionId: state.sessionId,
    stateSummary: formatStateSummary({
      semanticSummary,
      outline,
      uploadedContextCount: uploadedContext.length,
      canvasText: canvasSnapshot.plainText,
    }),
    semanticSummary,
    focus: {
      nodeId: focusNode?.id ?? null,
      node: focusNode ? toContextNode(focusNode, "self") : null,
      relatedNodes,
    },
    graph: {
      outline,
      flatNodes,
      edges: state.graph.edges,
    },
    unresolvedQuestions: state.graph.nodes
      .filter((node) => state.control.unresolvedQuestionIds.includes(node.id))
      .map((node) => toContextNode(node)),
    recentTurns: dedupeStrings(parsed.recentTurns, 12).map((turn) => truncate(turn, 1000)),
    uploadedContext,
    canvasSnapshot,
    diagnostics: {
      nodeCount: state.graph.nodes.length,
      edgeCount: state.graph.edges.length,
      rootCount: outline.length,
      uploadedContextCount: uploadedContext.length,
      recentTurnCount: parsed.recentTurns.length,
    },
  };
}

export function formatOrchestratorContextV0(context: OrchestratorContextV0): string {
  const related = context.focus.relatedNodes
    .filter((node) => node.relationToFocus !== "self")
    .map((node) => `- ${node.content}${node.relationToFocus ? ` (${node.relationToFocus})` : ""}`);
  const uploads = context.uploadedContext.map((item) => `- ${item.title}: ${item.summary || item.relevantSnippets[0] || "(no summary)"}`);
  return [
    "[Orchestrator Context V0]",
    context.stateSummary,
    "",
    "Focus related nodes:",
    related.length ? related.join("\n") : "- (none)",
    "",
    "Recent turns:",
    context.recentTurns.length ? context.recentTurns.map((turn) => `- ${turn}`).join("\n") : "- (none)",
    "",
    "Uploaded context:",
    uploads.length ? uploads.join("\n") : "- (none)",
  ].join("\n");
}

export { CanvasSnapshotInputSchema, UploadedContextSchema };
