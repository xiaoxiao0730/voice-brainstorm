import type { IdeaEdgeData, IdeaFlowEdge, IdeaFlowNode } from "@/components/mindmap/IdeaCanvas";

export type CanvasSide = "top" | "right" | "bottom" | "left";
export type ParallelBranchLayout = NonNullable<IdeaEdgeData["branchLayout"]>;

export const IDEA_NODE_DEFAULT_WIDTH = 260;
export const IDEA_NODE_DEFAULT_HEIGHT = 178;
export const IDEA_NODE_MIN_HEIGHT = 76;
export const PARALLEL_BRANCH_LENGTH = 110;
export const PARALLEL_BRANCH_GAP = 150;
export const PARALLEL_BRANCH_SAFE_GAP = 34;

export const OPPOSITE_SIDE: Record<CanvasSide, CanvasSide> = {
  top: "bottom",
  right: "left",
  bottom: "top",
  left: "right",
};

export function estimateCanvasNodeSize(node: IdeaFlowNode) {
  const isIdeaNode = node.type !== "textNode" && node.type !== "imageNode";
  if (isIdeaNode) {
    return {
      width: Math.max(Number(node.data.width ?? IDEA_NODE_DEFAULT_WIDTH), IDEA_NODE_DEFAULT_WIDTH),
      height: Math.max(Number(node.data.height ?? IDEA_NODE_DEFAULT_HEIGHT), IDEA_NODE_MIN_HEIGHT),
    };
  }

  return {
    width: Number(node.data.width ?? node.measured?.width ?? IDEA_NODE_DEFAULT_WIDTH),
    height: Number(node.data.height ?? node.measured?.height ?? IDEA_NODE_DEFAULT_HEIGHT),
  };
}

export function chooseConnectionHandles(source: IdeaFlowNode, target: IdeaFlowNode): {
  sourceHandle: CanvasSide;
  targetHandle: CanvasSide;
} {
  const sourceSize = estimateCanvasNodeSize(source);
  const targetSize = estimateCanvasNodeSize(target);
  const sourceCenter = {
    x: source.position.x + sourceSize.width / 2,
    y: source.position.y + sourceSize.height / 2,
  };
  const targetCenter = {
    x: target.position.x + targetSize.width / 2,
    y: target.position.y + targetSize.height / 2,
  };
  const dx = targetCenter.x - sourceCenter.x;
  const dy = targetCenter.y - sourceCenter.y;
  if (Math.abs(dx) >= Math.abs(dy)) {
    return dx < 0
      ? { sourceHandle: "left", targetHandle: "right" }
      : { sourceHandle: "right", targetHandle: "left" };
  }
  return dy < 0
    ? { sourceHandle: "top", targetHandle: "bottom" }
    : { sourceHandle: "bottom", targetHandle: "top" };
}

export function parallelChildPosition(args: {
  source: IdeaFlowNode;
  side: CanvasSide;
  index: number;
  count: number;
  childWidth?: number;
  childHeight?: number;
  gap?: number;
  fixedLength?: number;
}) {
  const sourceSize = estimateCanvasNodeSize(args.source);
  const childWidth = args.childWidth ?? IDEA_NODE_DEFAULT_WIDTH;
  const childHeight = args.childHeight ?? IDEA_NODE_DEFAULT_HEIGHT;
  const gap = args.gap ?? PARALLEL_BRANCH_GAP;
  const fixedLength = args.fixedLength ?? PARALLEL_BRANCH_LENGTH;
  const centeredIndex = args.index - (args.count - 1) / 2;
  const sourceCenterX = args.source.position.x + sourceSize.width / 2;
  const sourceCenterY = args.source.position.y + sourceSize.height / 2;

  if (args.side === "right") {
    return {
      x: args.source.position.x + sourceSize.width + fixedLength,
      y: sourceCenterY + centeredIndex * gap - childHeight / 2,
    };
  }
  if (args.side === "left") {
    return {
      x: args.source.position.x - fixedLength - childWidth,
      y: sourceCenterY + centeredIndex * gap - childHeight / 2,
    };
  }
  if (args.side === "bottom") {
    return {
      x: sourceCenterX + centeredIndex * gap - childWidth / 2,
      y: args.source.position.y + sourceSize.height + fixedLength,
    };
  }
  return {
    x: sourceCenterX + centeredIndex * gap - childWidth / 2,
    y: args.source.position.y - fixedLength - childHeight,
  };
}

export function makeParallelBranchLayout(args: {
  side: CanvasSide;
  index: number;
  count: number;
  gap?: number;
  fixedLength?: number;
}): ParallelBranchLayout {
  return {
    mode: "parallel",
    side: args.side,
    index: args.index,
    count: args.count,
    fixedLength: args.fixedLength ?? PARALLEL_BRANCH_LENGTH,
    gap: args.gap ?? PARALLEL_BRANCH_GAP,
  };
}

export function layoutParallelBranch(args: {
  nodes: IdeaFlowNode[];
  edges: IdeaFlowEdge[];
  sourceId: string;
  side: CanvasSide;
  targetIds: string[];
}) {
  const source = args.nodes.find((node) => node.id === args.sourceId);
  if (!source || args.targetIds.length === 0) return { nodes: args.nodes, edges: args.edges };

  const targetIndex = new Map(args.targetIds.map((id, index) => [id, index] as const));
  const count = args.targetIds.length;
  const targetSizes = args.targetIds
    .map((id) => args.nodes.find((node) => node.id === id))
    .filter((node): node is IdeaFlowNode => Boolean(node))
    .map(estimateCanvasNodeSize);
  const maxTargetWidth = Math.max(IDEA_NODE_DEFAULT_WIDTH, ...targetSizes.map((size) => size.width));
  const maxTargetHeight = Math.max(IDEA_NODE_MIN_HEIGHT, ...targetSizes.map((size) => size.height));
  const gap = Math.max(PARALLEL_BRANCH_GAP, maxTargetHeight + PARALLEL_BRANCH_SAFE_GAP);

  const nodes = args.nodes.map((node) => {
    const index = targetIndex.get(node.id);
    if (typeof index !== "number") return node;
    const position = parallelChildPosition({
      source,
      side: args.side,
      index,
      count,
      childWidth: maxTargetWidth,
      childHeight: maxTargetHeight,
      gap,
    });
    return {
      ...node,
      position: { x: Math.round(position.x), y: Math.round(position.y) },
    };
  });

  const edges = args.edges.map((edge) => {
    const index = targetIndex.get(edge.target);
    if (edge.source !== args.sourceId || typeof index !== "number") return edge;
    return {
      ...edge,
      sourceHandle: args.side,
      targetHandle: OPPOSITE_SIDE[args.side],
      data: {
        ...edge.data,
        branchLayout: makeParallelBranchLayout({ side: args.side, index, count, gap }),
      },
    };
  });

  return { nodes, edges };
}

export function reflowParallelBranches(nodes: IdeaFlowNode[], edges: IdeaFlowEdge[]) {
  const groups = new Map<string, { sourceId: string; side: CanvasSide; targetIds: string[] }>();
  for (const edge of edges) {
    const layout = edge.data?.branchLayout;
    if (layout?.mode !== "parallel") continue;
    const key = `${edge.source}:${layout.side}`;
    const group = groups.get(key) ?? { sourceId: edge.source, side: layout.side, targetIds: [] };
    group.targetIds[layout.index] = edge.target;
    groups.set(key, group);
  }

  let next = { nodes, edges };
  for (const group of groups.values()) {
    next = layoutParallelBranch({
      nodes: next.nodes,
      edges: next.edges,
      sourceId: group.sourceId,
      side: group.side,
      targetIds: group.targetIds.filter(Boolean),
    });
  }
  return next;
}
