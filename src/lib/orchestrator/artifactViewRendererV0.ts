import type { Edge } from "@xyflow/react";

import type { IdeaCanvasState, IdeaFlowNode, IdeaNodeKind } from "@/components/mindmap/IdeaCanvas";
import type { CanvasArtifactViewV0 } from "@/lib/orchestrator/orchestratorV0.functions";

const ARTIFACT_NODE_PREFIX = "artifact-view-v0-";
const FOCUS_POSITION = { x: 520, y: 320 };
const FOCUS_SIZE = { width: 260, height: 88 };
const SECTION_SIZE = { width: 220, height: 72 };
const BULLET_SIZE = { width: 260, height: 54 };
const HORIZONTAL_GAP = 300;
const BULLET_GAP = 250;
const SECTION_VERTICAL_GAP = 132;
const BULLET_VERTICAL_GAP = 72;
const BRANCH_COLORS = ["#ff6467", "#ff9f68", "#94d1b1", "#7edfd2", "#67c7ef", "#b7a6f6"];

function clean(value: string) {
  return value.replace(/\s+/g, " ").trim();
}

function stableKey(value: string) {
  return clean(value).toLowerCase();
}

function slug(value: string, fallback: string) {
  const text = clean(value)
    .toLowerCase()
    .replace(/[^a-z0-9\u4e00-\u9fff]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 80);
  return text || fallback;
}

function snap(position: { x: number; y: number }, grid = 24) {
  return {
    x: Math.round(position.x / grid) * grid,
    y: Math.round(position.y / grid) * grid,
  };
}

function sectionKind(status: "empty" | "active" | "filled"): IdeaNodeKind {
  if (status === "active") return "question";
  return "idea";
}

function splitSides(count: number) {
  return Array.from({ length: count }, (_, index) => {
    if (count === 1) return 1;
    return index % 2 === 0 ? 1 : -1;
  });
}

function sideIndex(index: number) {
  return Math.floor(index / 2);
}

function sectionPosition(index: number, count: number) {
  const side = splitSides(count)[index] ?? 1;
  const rank = sideIndex(index);
  const sideCount = splitSides(count).filter((item) => item === side).length;
  const offset = rank - (sideCount - 1) / 2;
  return snap({
    x: FOCUS_POSITION.x + side * HORIZONTAL_GAP,
    y: FOCUS_POSITION.y + offset * SECTION_VERTICAL_GAP,
  });
}

function bulletPosition(sectionPos: { x: number; y: number }, sectionIndex: number, bulletIndex: number, bulletCount: number, sectionCount: number) {
  const side = splitSides(sectionCount)[sectionIndex] ?? 1;
  const offset = bulletIndex - (bulletCount - 1) / 2;
  return snap({
    x: sectionPos.x + side * BULLET_GAP,
    y: sectionPos.y + offset * BULLET_VERTICAL_GAP,
  });
}

function artifactNodeId(part: string) {
  return `${ARTIFACT_NODE_PREFIX}${part}`;
}

function updateOrCreateNode(args: {
  nodes: IdeaFlowNode[];
  id: string;
  title: string;
  body: string;
  kind: IdeaNodeKind;
  position: { x: number; y: number };
  width: number;
  height: number;
  selected?: boolean;
  branchColor?: string;
}) {
  const byId = args.nodes.findIndex((node) => node.id === args.id);
  const byTitle = args.nodes.findIndex((node) => stableKey(node.data.title ?? "") === stableKey(args.title));
  const existingIndex = byId >= 0 ? byId : byTitle;
  const existing = existingIndex >= 0 ? args.nodes[existingIndex] : null;
  const node: IdeaFlowNode = existing
    ? {
        ...existing,
        selected: Boolean(args.selected),
        position: existing.position ?? args.position,
        data: {
          ...existing.data,
          title: args.title,
          body: args.body,
          kind: args.kind,
          layoutMode: "xmind",
          locked: true,
          branchColor: args.branchColor,
          width: args.width,
          height: args.height,
        },
      }
    : {
        id: args.id,
        type: "ideaNode",
        position: args.position,
        selected: Boolean(args.selected),
        data: {
          title: args.title,
          body: args.body,
          kind: args.kind,
          layoutMode: "xmind",
          locked: true,
          branchColor: args.branchColor,
          width: args.width,
          height: args.height,
        },
      };

  if (existingIndex >= 0) {
    args.nodes.splice(existingIndex, 1, node);
  } else {
    args.nodes.push(node);
  }
  return node;
}

function edgeId(source: string, target: string) {
  return `${ARTIFACT_NODE_PREFIX}edge-${source}-to-${target}`;
}

function makeArtifactEdge(source: string, target: string, branchColor: string): Edge {
  return {
    id: edgeId(source, target),
    source,
    target,
    sourceHandle: "right",
    targetHandle: "left",
    type: "editable",
    data: { locked: true, branchColor },
  };
}

export function renderArtifactViewToIdeaCanvasV0(
  artifact: CanvasArtifactViewV0 | null,
  current: IdeaCanvasState = { nodes: [], edges: [] },
): IdeaCanvasState {
  if (!artifact) return current;

  const nodes = current.nodes
    .filter((node) => !node.id.startsWith(ARTIFACT_NODE_PREFIX))
    .map((node) => ({ ...node, selected: false }));
  const existingEdges = current.edges.filter(
    (edge) => !String(edge.id).startsWith(ARTIFACT_NODE_PREFIX),
  );
  const artifactNodeIds = new Set<string>();

  const focusNode = updateOrCreateNode({
    nodes,
    id: artifactNodeId(`focus-${slug(artifact.title, "artifact")}`),
    title: artifact.title,
    body: "",
    kind: "focus",
    position: snap(FOCUS_POSITION),
    width: FOCUS_SIZE.width,
    height: FOCUS_SIZE.height,
    selected: true,
    branchColor: "#111827",
  });
  artifactNodeIds.add(focusNode.id);

  const artifactEdges: Edge[] = [];
  for (const [index, section] of artifact.sections.entries()) {
    const isActive = section.id === artifact.activeSectionId || section.status === "active";
    const branchColor = BRANCH_COLORS[index % BRANCH_COLORS.length];
    const position = sectionPosition(index, artifact.sections.length);
    const sectionNode = updateOrCreateNode({
      nodes,
      id: artifactNodeId(`section-${slug(section.id || section.heading, `section-${index + 1}`)}`),
      title: section.heading,
      body: "",
      kind: sectionKind(isActive ? "active" : section.status),
      position,
      width: SECTION_SIZE.width,
      height: SECTION_SIZE.height,
      selected: isActive,
      branchColor,
    });
    artifactNodeIds.add(sectionNode.id);
    artifactEdges.push(makeArtifactEdge(focusNode.id, sectionNode.id, branchColor));

    const bullets = section.bullets.map((bullet) => clean(bullet.replace(/^[-•]\s*/, ""))).filter(Boolean).slice(0, 6);
    for (const [bulletIndex, bullet] of bullets.entries()) {
      const bulletNode = updateOrCreateNode({
        nodes,
        id: artifactNodeId(`bullet-${slug(section.id || section.heading, `section-${index + 1}`)}-${bulletIndex + 1}`),
        title: bullet,
        body: "",
        kind: "idea",
        position: bulletPosition(position, index, bulletIndex, bullets.length, artifact.sections.length),
        width: BULLET_SIZE.width,
        height: BULLET_SIZE.height,
        selected: false,
        branchColor,
      });
      artifactNodeIds.add(bulletNode.id);
      artifactEdges.push(makeArtifactEdge(sectionNode.id, bulletNode.id, branchColor));
    }
  }

  const validNodeIds = new Set(nodes.map((node) => node.id));
  const edges = [...existingEdges, ...artifactEdges].filter(
    (edge) => validNodeIds.has(edge.source) && validNodeIds.has(edge.target),
  );

  return { nodes, edges };
}

export function formatIdeaCanvasStateV0(canvas: IdeaCanvasState) {
  const nodeLines = canvas.nodes.map((node) => {
    const body = clean(node.data.body ?? "");
    return `- ${node.id} [${node.data.kind}] ${node.data.title}${body ? `: ${body}` : ""}`;
  });
  const edgeLines = canvas.edges.map((edge) => `- ${edge.source} -> ${edge.target}${edge.label ? ` (${edge.label})` : ""}`);
  return [
    "nodes:",
    nodeLines.length ? nodeLines.join("\n") : "- (none)",
    "edges:",
    edgeLines.length ? edgeLines.join("\n") : "- (none)",
  ].join("\n");
}
