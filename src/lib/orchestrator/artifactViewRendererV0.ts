import type { IdeaCanvasState, IdeaFlowEdge, IdeaFlowNode, IdeaNodeKind } from "@/components/mindmap/IdeaCanvas";
import {
  chooseConnectionHandles,
  makeParallelBranchLayout,
  type CanvasSide,
} from "@/lib/canvas/canvasLayoutEngine";
import type { CanvasArtifactViewV0 } from "@/lib/orchestrator/orchestratorV0.functions";

const ARTIFACT_NODE_PREFIX = "artifact-view-v0-";
const FOCUS_POSITION = { x: 520, y: 320 };
const MIN_NODE_SIZE = { width: 160, height: 80 };
const FOCUS_SIZE = { width: 300, height: 88 };
const SECTION_SIZE = { width: 250, height: 132 };
const CHILD_SIZE = { width: 220, height: 88 };
const HORIZONTAL_GAP = 390;
const CHILD_GAP = 310;
const SECTION_VERTICAL_GAP = 180;
const CHILD_VERTICAL_GAP = 118;
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

function bodyFromBullets(bullets: string[]) {
  return bullets
    .map((bullet) => clean(bullet.replace(/^[-•]\s*/, "")))
    .filter(Boolean)
    .map((bullet) => `- ${bullet}`)
    .join("\n");
}

function estimateHeight(title: string, body: string, base: number) {
  const titleLines = Math.ceil(Math.max(clean(title).length, 1) / 14);
  const bodyLines = body
    ? body.split("\n").reduce((sum, line) => sum + Math.max(1, Math.ceil(clean(line).length / 22)), 0)
    : 0;
  return Math.max(MIN_NODE_SIZE.height, Math.min(220, base + titleLines * 10 + bodyLines * 22));
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
  const presets = [
    { x: 0, y: -230 },
    { x: HORIZONTAL_GAP, y: 0 },
    { x: 0, y: 230 },
    { x: -HORIZONTAL_GAP, y: 0 },
    { x: -HORIZONTAL_GAP, y: -230 },
    { x: HORIZONTAL_GAP, y: -230 },
    { x: HORIZONTAL_GAP, y: 230 },
    { x: -HORIZONTAL_GAP, y: 230 },
  ];
  const preset = presets[index] ?? {
    x: (splitSides(count)[index] ?? 1) * HORIZONTAL_GAP,
    y: (sideIndex(index) - 1) * SECTION_VERTICAL_GAP,
  };
  return snap({
    x: FOCUS_POSITION.x + preset.x,
    y: FOCUS_POSITION.y + preset.y,
  });
}

function childPosition(sectionPos: { x: number; y: number }, sectionIndex: number, childIndex: number, childCount: number, sectionCount: number) {
  const side = splitSides(sectionCount)[sectionIndex] ?? 1;
  const offset = childIndex - (childCount - 1) / 2;
  return snap({
    x: sectionPos.x + side * CHILD_GAP,
    y: sectionPos.y + offset * CHILD_VERTICAL_GAP,
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
          layoutMode: "artifact",
          locked: true,
          branchColor: args.branchColor,
          width: Math.max(MIN_NODE_SIZE.width, args.width),
          height: Math.max(MIN_NODE_SIZE.height, args.height),
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
          layoutMode: "artifact",
          locked: true,
          branchColor: args.branchColor,
          width: Math.max(MIN_NODE_SIZE.width, args.width),
          height: Math.max(MIN_NODE_SIZE.height, args.height),
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

function branchSideFromHandles(handles: ReturnType<typeof chooseConnectionHandles>): CanvasSide {
  return handles.sourceHandle;
}

function makeArtifactEdge(
  source: IdeaFlowNode,
  target: IdeaFlowNode,
  branchColor: string,
  index: number,
  count: number,
): IdeaFlowEdge {
  const handles = chooseConnectionHandles(source, target);
  return {
    id: edgeId(source.id, target.id),
    source: source.id,
    target: target.id,
    ...handles,
    type: "editable",
    data: {
      locked: true,
      branchColor,
      branchLayout: makeParallelBranchLayout({
        side: branchSideFromHandles(handles),
        index,
        count,
      }),
    },
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

  const artifactEdges: IdeaFlowEdge[] = [];
  for (const [index, section] of artifact.sections.entries()) {
    const isActive = section.id === artifact.activeSectionId || section.status === "active";
    const branchColor = BRANCH_COLORS[index % BRANCH_COLORS.length];
    const position = sectionPosition(index, artifact.sections.length);
    const sectionBody = bodyFromBullets(section.bullets);
    const sectionNode = updateOrCreateNode({
      nodes,
      id: artifactNodeId(`section-${slug(section.id || section.heading, `section-${index + 1}`)}`),
      title: section.heading,
      body: sectionBody,
      kind: sectionKind(isActive ? "active" : section.status),
      position,
      width: SECTION_SIZE.width,
      height: estimateHeight(section.heading, sectionBody, SECTION_SIZE.height),
      selected: isActive,
      branchColor,
    });
    artifactNodeIds.add(sectionNode.id);
    artifactEdges.push(makeArtifactEdge(focusNode, sectionNode, branchColor, index, artifact.sections.length));

    const children = (section.children ?? []).slice(0, 8);
    for (const [childIndex, child] of children.entries()) {
      const childTitle = clean(child.heading);
      if (!childTitle) continue;
      const childBody = bodyFromBullets(child.bullets);
      const childNode = updateOrCreateNode({
        nodes,
        id: artifactNodeId(`child-${slug(section.id || section.heading, `section-${index + 1}`)}-${slug(child.id || child.heading, `${childIndex + 1}`)}`),
        title: childTitle,
        body: childBody,
        kind: sectionKind(child.status),
        position: childPosition(position, index, childIndex, children.length, artifact.sections.length),
        width: CHILD_SIZE.width,
        height: estimateHeight(childTitle, childBody, CHILD_SIZE.height),
        selected: child.status === "active" || child.id === artifact.activeSectionId,
        branchColor,
      });
      artifactNodeIds.add(childNode.id);
      artifactEdges.push(makeArtifactEdge(sectionNode, childNode, branchColor, childIndex, children.length));
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
