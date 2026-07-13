import {
  useCallback,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type KeyboardEvent as ReactKeyboardEvent,
  type PointerEvent,
} from "react";
import type { Edge, Node } from "@xyflow/react";
import "@xyflow/react/dist/style.css";
import {
  Download,
  Maximize2,
  MousePointer2,
  Scan,
  Sparkles,
  StickyNote,
  ZoomIn,
  ZoomOut,
} from "lucide-react";

import type { MindMapNode } from "@/lib/mindmap/generateMindMap.functions";

export type IdeaNodeKind = "focus" | "idea" | "question" | "decision" | "risk" | "next";
export type IdeaTextSize = "small" | "normal" | "large";
export type IdeaTextAlign = "left" | "center" | "right";

export type IdeaNodeData = {
  title: string;
  body?: string;
  kind: IdeaNodeKind;
  layoutMode?: "free" | "xmind" | "artifact";
  locked?: boolean;
  branchColor?: string;
  width?: number;
  height?: number;
  textSize?: IdeaTextSize;
  bold?: boolean;
  italic?: boolean;
  textAlign?: IdeaTextAlign;
  dictationCaret?: number;
  expanded?: boolean;
  activeWriting?: boolean;
  onChange?: (
    id: string,
    patch: Partial<
      Pick<
        IdeaNodeData,
        | "title"
        | "body"
        | "kind"
        | "width"
        | "height"
        | "textSize"
        | "bold"
        | "italic"
        | "textAlign"
        | "dictationCaret"
        | "expanded"
      >
    >,
  ) => void;
  onQuickAdd?: (id: string, position: "top" | "right" | "bottom" | "left") => void;
  onSelect?: (id: string) => void;
  onInlineDictationKeyDown?: (
    id: string,
    event: ReactKeyboardEvent<HTMLTextAreaElement>,
    currentText: string,
  ) => void;
  onInlineDictationKeyUp?: (
    id: string,
    event: ReactKeyboardEvent<HTMLTextAreaElement>,
    currentText: string,
  ) => void;
  autoFocus?: boolean;
};

export type IdeaFlowNode = Node<IdeaNodeData>;

export type IdeaEdgeData = {
  routeOffset?: number;
  autoRouteOffset?: number;
  locked?: boolean;
  branchColor?: string;
  branchLayout?: {
    mode: "parallel";
    side: "top" | "right" | "bottom" | "left";
    index: number;
    count: number;
    fixedLength: number;
    gap: number;
  };
};

export type IdeaFlowEdge = Edge<IdeaEdgeData>;

export type IdeaCanvasState = {
  nodes: IdeaFlowNode[];
  edges: IdeaFlowEdge[];
};

type Props = {
  state: IdeaCanvasState;
  sessionTitle?: string;
  loading?: boolean;
  onChange: (next: IdeaCanvasState) => void;
  onGenerateFromBrief?: () => void;
  onFullscreen?: () => void;
};

type BoardEdgePath = {
  id: string;
  d: string;
  handleX: number;
  handleY: number;
  locked?: boolean;
  color?: string;
};

type DragState = {
  mode: "move" | "resize" | "edge";
  id: string;
  pointerId: number;
  startX: number;
  startY: number;
  originX: number;
  originY: number;
  originWidth: number;
  originHeight: number;
  originOffset: number;
};

const KIND_STYLE: Record<
  IdeaNodeKind,
  { label: string; zone: string; border: string; bg: string; accent: string; description: string }
> = {
  focus: {
    label: "Focus",
    zone: "Focus",
    border: "#111827",
    bg: "#fffdf7",
    accent: "#111827",
    description: "The current center of the discussion.",
  },
  idea: {
    label: "Path",
    zone: "Promising paths",
    border: "#7c8b73",
    bg: "#fbfdf8",
    accent: "#7c8b73",
    description: "Directions, concepts, and possible approaches.",
  },
  question: {
    label: "Question",
    zone: "Open questions",
    border: "#6f7f99",
    bg: "#f8fbff",
    accent: "#6f7f99",
    description: "Things that would unlock the next step.",
  },
  decision: {
    label: "Decision",
    zone: "Decisions",
    border: "#9a7c47",
    bg: "#fffaf0",
    accent: "#9a7c47",
    description: "Choices or conclusions that are starting to settle.",
  },
  risk: {
    label: "Risk",
    zone: "Risks / tensions",
    border: "#a16b6b",
    bg: "#fff8f8",
    accent: "#a16b6b",
    description: "Assumptions, contradictions, and failure modes.",
  },
  next: {
    label: "Next",
    zone: "Next moves",
    border: "#5f8775",
    bg: "#f7fffb",
    accent: "#5f8775",
    description: "Concrete moves to continue the work.",
  },
};

const BOARD_ZONES: IdeaNodeKind[] = ["focus", "question", "idea", "risk", "decision", "next"];

const COL_W = 260;
const ROW_H = 118;
const CANVAS_PADDING = 72;
const DEFAULT_CANVAS_WIDTH = 1320;
const DEFAULT_CANVAS_HEIGHT = 900;
const NOTE_WIDTH = 224;
const NOTE_HEIGHT = 136;
const FOCUS_WIDTH = 278;
const FOCUS_HEIGHT = 156;
const MIN_NOTE_WIDTH = 160;
const MIN_NOTE_HEIGHT = 110;
const MAX_NOTE_WIDTH = 520;
const MAX_NOTE_HEIGHT = 420;
const MIN_ZOOM = 0.55;
const MAX_ZOOM = 1.7;

function downloadJson(filename: string, value: unknown) {
  const blob = new Blob([JSON.stringify(value, null, 2)], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}

function safeFilename(input: string) {
  return input
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9\u4e00-\u9fa5]+/gi, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 48);
}

function nextId(prefix = "idea") {
  if (typeof crypto !== "undefined" && "randomUUID" in crypto)
    return `${prefix}-${crypto.randomUUID()}`;
  return `${prefix}-${Date.now()}-${Math.random().toString(16).slice(2)}`;
}

function clamp(value: number, min: number, max: number) {
  return Math.min(max, Math.max(min, value));
}

function getNoteWidth(node: IdeaFlowNode) {
  const fallback = node.data.kind === "focus" ? FOCUS_WIDTH : NOTE_WIDTH;
  return clamp(Number(node.data.width ?? fallback), MIN_NOTE_WIDTH, MAX_NOTE_WIDTH);
}

function getNoteHeight(node: IdeaFlowNode) {
  const fallback = node.data.kind === "focus" ? FOCUS_HEIGHT : NOTE_HEIGHT;
  return clamp(Number(node.data.height ?? fallback), MIN_NOTE_HEIGHT, MAX_NOTE_HEIGHT);
}

// Figma-style orthogonal connector: source-bottom → down → horizontal bus → up
// → target-bottom, with rounded right-angle corners. `busY` is the y of the
// horizontal bus (draggable). Returns the SVG path + the bus midpoint handle.
// Figma-style orthogonal connector with a vertical "bus" at busX: source-side →
// horizontal → down/up → horizontal → target-side, with rounded corners. busX is
// the x of the vertical bus (draggable). Returns path + bus midpoint handle.
function orthogonalPath(
  sx: number,
  sy: number,
  tx: number,
  ty: number,
  busX: number,
): { d: string; handleX: number; handleY: number } {
  const r = 12;
  const sDir = busX >= sx ? 1 : -1;
  const tDir = busX >= tx ? 1 : -1;
  const vDir = ty >= sy ? 1 : -1;
  const handle = { handleX: busX, handleY: (sy + ty) / 2 };
  if (Math.abs(busX - sx) < r * 2 || Math.abs(busX - tx) < r * 2 || Math.abs(ty - sy) < r * 2) {
    return { d: `M ${sx} ${sy} L ${busX} ${sy} L ${busX} ${ty} L ${tx} ${ty}`, ...handle };
  }
  const d = [
    `M ${sx} ${sy}`,
    `L ${busX - sDir * r} ${sy}`,
    `Q ${busX} ${sy} ${busX} ${sy + vDir * r}`,
    `L ${busX} ${ty - vDir * r}`,
    `Q ${busX} ${ty} ${busX - tDir * r} ${ty}`,
    `L ${tx} ${ty}`,
  ].join(" ");
  return { d, ...handle };
}

function IdeaCard({
  id,
  data,
  onChange,
}: {
  id: string;
  data: IdeaNodeData;
  onChange: (
    id: string,
    patch: Partial<Pick<IdeaNodeData, "title" | "body" | "kind" | "width" | "height">>,
  ) => void;
}) {
  const style = KIND_STYLE[data.kind] ?? KIND_STYLE.idea;
  const isXMind = data.layoutMode === "xmind";
  const isArtifact = data.layoutMode === "artifact";
  const branchColor = data.branchColor || style.accent;
  if (isArtifact) {
    const hasBody = Boolean(data.body?.trim());
    const isFocus = data.kind === "focus";
    return (
      <div
        className={`flex h-full flex-col justify-center overflow-hidden text-left ${
          isFocus ? "items-center rounded-full px-4 py-2" : "rounded-md border px-4 py-3 shadow-sm"
        }`}
        style={{
          borderColor: isFocus ? "transparent" : `${branchColor}55`,
          background: isFocus ? "transparent" : "#fff8d8",
          borderTopWidth: isFocus ? 0 : 3,
          borderTopColor: branchColor,
          boxShadow: isFocus ? "none" : "0 12px 26px rgba(24, 28, 36, 0.08)",
        }}
      >
        <input
          className={`w-full bg-transparent text-primary outline-none ${
            isFocus ? "text-center text-2xl font-semibold" : "text-sm font-semibold"
          }`}
          value={data.title}
          onChange={(e) => onChange(id, { title: e.target.value })}
          placeholder={isFocus ? "Focus" : "Untitled"}
        />
        {!isFocus && hasBody ? (
          <textarea
            className="mt-2 min-h-0 flex-1 resize-none bg-transparent text-xs leading-relaxed text-secondary outline-none"
            value={data.body ?? ""}
            onChange={(e) => onChange(id, { body: e.target.value })}
            placeholder=""
          />
        ) : null}
        {!isFocus && !hasBody ? (
          <div className="mt-2 text-xs leading-relaxed text-secondary/50">Awaiting signal</div>
        ) : null}
      </div>
    );
  }
  if (isXMind) {
    const hasBody = Boolean(data.body?.trim());
    return (
      <div
        className="flex h-full flex-col justify-center overflow-hidden rounded-md border bg-white px-4 py-3 text-left shadow-sm"
        style={{
          borderColor: data.kind === "focus" ? "#d8d6d0" : `${branchColor}66`,
          background: data.kind === "focus" ? "#ffffff" : "#fffefa",
          borderLeftWidth: data.kind === "focus" ? 1 : 4,
          boxShadow: data.kind === "focus" ? "0 10px 24px rgba(20, 24, 31, 0.08)" : "0 8px 18px rgba(20, 24, 31, 0.06)",
        }}
      >
        <input
          className={`w-full bg-transparent text-primary outline-none ${
            data.kind === "focus" ? "text-lg font-semibold" : "text-sm font-semibold"
          }`}
          value={data.title}
          onChange={(e) => onChange(id, { title: e.target.value })}
          placeholder="Untitled"
        />
        {hasBody ? (
          <textarea
            className="mt-2 min-h-0 flex-1 resize-none bg-transparent text-xs leading-relaxed text-secondary outline-none"
            value={data.body ?? ""}
            onChange={(e) => onChange(id, { body: e.target.value })}
            placeholder=""
          />
        ) : null}
      </div>
    );
  }
  return (
    <div
      className="group flex h-full cursor-grab flex-col rounded-sm border bg-white shadow-sm transition hover:-translate-y-px hover:shadow-md active:cursor-grabbing"
      style={{
        borderColor: `${style.border}38`,
        background: style.bg,
        boxShadow: "0 14px 28px rgba(20, 24, 31, 0.1)",
      }}
    >
      <div className="flex items-center justify-between gap-2 px-3 pb-1.5 pt-2.5">
        <select
          className="min-w-0 cursor-pointer bg-transparent text-[10px] font-medium uppercase text-secondary focus:outline-none"
          value={data.kind}
          onChange={(e) => onChange(id, { kind: e.target.value as IdeaNodeKind })}
          title="Node type"
        >
          {Object.entries(KIND_STYLE).map(([kind, item]) => (
            <option key={kind} value={kind}>
              {item.label}
            </option>
          ))}
        </select>
        <span className="h-2 w-2 rounded-full" style={{ background: style.accent }} />
      </div>
      <input
        className={`w-full bg-transparent px-3 text-primary outline-none ${
          data.kind === "focus" ? "text-lg font-semibold" : "text-base font-semibold"
        }`}
        value={data.title}
        onChange={(e) => onChange(id, { title: e.target.value })}
        placeholder="Untitled"
      />
      <textarea
        className="min-h-0 flex-1 resize-none bg-transparent px-3 pb-4 pt-1 text-sm leading-relaxed text-secondary outline-none"
        value={data.body ?? ""}
        onChange={(e) => onChange(id, { body: e.target.value })}
        placeholder="Add detail"
      />
    </div>
  );
}

export function treeToIdeaCanvas(
  root: MindMapNode,
  options?: { originX?: number; originY?: number },
): IdeaCanvasState {
  const nodes: IdeaFlowNode[] = [];
  const edges: Edge[] = [];
  const originX = options?.originX ?? 440;
  const originY = options?.originY ?? 330;
  const idMap = new Map<string, string>();
  const leaves = (node: MindMapNode): number =>
    Math.max(
      1,
      node.children.reduce((sum, child) => sum + leaves(child), 0),
    );

  const mapId = (id: string) => {
    const existing = idMap.get(id);
    if (existing) return existing;
    const mapped = nextId(`map-${id.replace(/[^a-z0-9_-]/gi, "") || "node"}`);
    idMap.set(id, mapped);
    return mapped;
  };

  const place = (
    node: MindMapNode,
    depth: number,
    parentId: string | null,
    x: number,
    y: number,
    direction: 1 | -1 = 1,
  ) => {
    const id = mapId(node.id);
    nodes.push({
      id,
      type: "ideaNode",
      position: { x: Math.round(x), y: Math.round(y) },
      data: {
        title: node.label,
        body: "",
        kind: depth === 0 ? "focus" : depth === 1 ? "idea" : "question",
        width: depth === 0 ? FOCUS_WIDTH : NOTE_WIDTH,
        height: depth === 0 ? FOCUS_HEIGHT : NOTE_HEIGHT,
      },
    });
    if (parentId) {
      edges.push({
        id: `${parentId}-${id}`,
        source: parentId,
        target: id,
        type: "smoothstep",
        label: node.relation || undefined,
        labelStyle: { fontSize: 10, fill: "#6b7280", fontWeight: 500 },
        labelBgStyle: { fill: "#fbfaf7", fillOpacity: 0.9 },
        labelBgPadding: [4, 2],
        labelBgBorderRadius: 3,
        style: { stroke: "#9ca3af", strokeWidth: 1.2 },
      });
    }

    const childCount = node.children.length;
    if (childCount === 0) return;

    if (depth === 0) {
      const left = node.children.filter((_, index) => index % 2 === 0);
      const right = node.children.filter((_, index) => index % 2 === 1);
      const placeSide = (children: MindMapNode[], direction: 1 | -1) => {
        const total = Math.max(
          1,
          children.reduce((sum, child) => sum + leaves(child), 0),
        );
        let cursor = y - ((total - 1) * 150) / 2;
        children.forEach((child) => {
          const span = leaves(child);
          const childY = cursor + ((span - 1) * 150) / 2;
          cursor += span * 150;
          place(child, depth + 1, id, x + direction * 330, childY, direction);
        });
      };
      placeSide(left.length ? left : right, -1);
      if (left.length) placeSide(right, 1);
      return;
    }

    const total = Math.max(
      1,
      node.children.reduce((sum, child) => sum + leaves(child), 0),
    );
    let cursor = y - ((total - 1) * 118) / 2;
    node.children.forEach((child, index) => {
      const span = leaves(child);
      const childY = cursor + ((span - 1) * 118) / 2 + (index - (childCount - 1) / 2) * 10;
      cursor += span * 118;
      place(
        child,
        depth + 1,
        id,
        x + direction * Math.max(230, 310 - depth * 34),
        childY,
        direction,
      );
    });
  };

  place(root, 0, null, originX, originY);
  return { nodes, edges };
}

export function mergeIdeaCanvas(
  current: IdeaCanvasState,
  incoming: IdeaCanvasState,
): IdeaCanvasState {
  if (current.nodes.length === 0) return incoming;
  const maxX = Math.max(...current.nodes.map((node) => node.position.x));
  const shiftedNodes = incoming.nodes.map((node) => ({
    ...node,
    position: { x: node.position.x + maxX + 120, y: node.position.y },
  }));
  return {
    nodes: [...current.nodes, ...shiftedNodes],
    edges: [...current.edges, ...incoming.edges],
  };
}

export function IdeaCanvas({
  state,
  sessionTitle,
  loading,
  onChange,
  onGenerateFromBrief,
  onFullscreen,
}: Props) {
  const boardRef = useRef<HTMLDivElement>(null);
  const [edgePaths, setEdgePaths] = useState<BoardEdgePath[]>([]);
  const [edgeOffsets, setEdgeOffsets] = useState<Record<string, number>>({});
  const [zoom, setZoom] = useState(1);
  const dragRef = useRef<DragState | null>(null);

  const updateNodeData = useCallback(
    (
      id: string,
      patch: Partial<Pick<IdeaNodeData, "title" | "body" | "kind" | "width" | "height">>,
    ) => {
      onChange({
        ...state,
        nodes: state.nodes.map((node) =>
          node.id === id ? { ...node, data: { ...node.data, ...patch } } : node,
        ),
      });
    },
    [onChange, state],
  );

  const visibleClusterEdges = useMemo(() => {
    const nodeIds = new Set(state.nodes.map((node) => node.id));
    return state.edges.filter((edge) => nodeIds.has(edge.source) && nodeIds.has(edge.target));
  }, [state.edges, state.nodes]);

  const canvasSize = useMemo(() => {
    const maxX = Math.max(0, ...state.nodes.map((node) => node.position.x + getNoteWidth(node)));
    const maxY = Math.max(0, ...state.nodes.map((node) => node.position.y + getNoteHeight(node)));
    return {
      width: Math.max(DEFAULT_CANVAS_WIDTH, maxX + 420),
      height: Math.max(DEFAULT_CANVAS_HEIGHT, maxY + 320),
    };
  }, [state.nodes]);

  const addNode = useCallback(
    (kind: IdeaNodeKind) => {
      const sameKindCount = state.nodes.filter((node) => node.data.kind === kind).length;
      const zoneIndex = BOARD_ZONES.indexOf(kind);
      onChange({
        ...state,
        nodes: [
          ...state.nodes,
          {
            id: nextId(kind),
            type: "ideaNode",
            position: { x: 80 + Math.max(0, zoneIndex) * COL_W, y: 100 + sameKindCount * ROW_H },
            data: {
              title: KIND_STYLE[kind].label,
              body: "",
              kind,
              width: kind === "focus" ? FOCUS_WIDTH : NOTE_WIDTH,
              height: kind === "focus" ? FOCUS_HEIGHT : NOTE_HEIGHT,
            },
          },
        ],
      });
    },
    [onChange, state],
  );

  const exportMap = useCallback(() => {
    const title = safeFilename(sessionTitle ?? "thinking-board") || "thinking-board";
    downloadJson(`${title}-board.json`, {
      version: 1,
      exportedAt: new Date().toISOString(),
      title: sessionTitle ?? "Thinking Board",
      nodes: state.nodes.map((node) => ({
        ...node,
        data: {
          title: node.data.title,
          body: node.data.body ?? "",
          kind: node.data.kind,
          width: getNoteWidth(node),
          height: getNoteHeight(node),
          layoutMode: node.data.layoutMode,
          locked: node.data.locked,
          branchColor: node.data.branchColor,
        },
      })),
      edges: state.edges,
    });
  }, [sessionTitle, state]);

  const moveNode = useCallback(
    (id: string, x: number, y: number) => {
      onChange({
        ...state,
        nodes: state.nodes.map((node) =>
          node.id === id
            ? {
                ...node,
                position: {
                  x: Math.max(12, Math.round(x)),
                  y: Math.max(12, Math.round(y)),
                },
              }
            : node,
        ),
      });
    },
    [onChange, state],
  );

  const resizeNode = useCallback(
    (id: string, width: number, height: number) => {
      onChange({
        ...state,
        nodes: state.nodes.map((node) =>
          node.id === id
            ? {
                ...node,
                data: {
                  ...node.data,
                  width: Math.round(clamp(width, MIN_NOTE_WIDTH, MAX_NOTE_WIDTH)),
                  height: Math.round(clamp(height, MIN_NOTE_HEIGHT, MAX_NOTE_HEIGHT)),
                },
              }
            : node,
        ),
      });
    },
    [onChange, state],
  );

  const beginDrag = useCallback((event: PointerEvent<HTMLDivElement>, node: IdeaFlowNode) => {
    const target = event.target as HTMLElement;
    if (target.closest("input, textarea, select, button")) return;
    if (node.data.locked || node.data.layoutMode === "xmind" || node.data.layoutMode === "artifact") return;

    event.currentTarget.setPointerCapture(event.pointerId);
    dragRef.current = {
      mode: "move",
      id: node.id,
      pointerId: event.pointerId,
      startX: event.clientX,
      startY: event.clientY,
      originX: node.position.x,
      originY: node.position.y,
      originWidth: getNoteWidth(node),
      originHeight: getNoteHeight(node),
      originOffset: 0,
    };
  }, []);

  const beginResize = useCallback((event: PointerEvent<HTMLButtonElement>, node: IdeaFlowNode) => {
    event.preventDefault();
    event.stopPropagation();
    event.currentTarget.setPointerCapture(event.pointerId);
    dragRef.current = {
      mode: "resize",
      id: node.id,
      pointerId: event.pointerId,
      startX: event.clientX,
      startY: event.clientY,
      originX: node.position.x,
      originY: node.position.y,
      originWidth: getNoteWidth(node),
      originHeight: getNoteHeight(node),
      originOffset: 0,
    };
  }, []);

  const beginEdgeDrag = useCallback(
    (event: PointerEvent<HTMLDivElement>, edgeId: string) => {
      event.preventDefault();
      event.stopPropagation();
      event.currentTarget.setPointerCapture(event.pointerId);
      dragRef.current = {
        mode: "edge",
        id: edgeId,
        pointerId: event.pointerId,
        startX: event.clientX,
        startY: event.clientY,
        originX: 0,
        originY: 0,
        originWidth: 0,
        originHeight: 0,
        originOffset: edgeOffsets[edgeId] ?? 0,
      };
    },
    [edgeOffsets],
  );

  const updateDrag = useCallback(
    (event: PointerEvent<HTMLDivElement>) => {
      const drag = dragRef.current;
      if (!drag || drag.pointerId !== event.pointerId) return;
      const deltaX = (event.clientX - drag.startX) / zoom;
      const deltaY = (event.clientY - drag.startY) / zoom;
      if (drag.mode === "edge") {
        const next = drag.originOffset + deltaX;
        setEdgeOffsets((prev) => ({ ...prev, [drag.id]: next }));
        return;
      }
      if (drag.mode === "resize") {
        resizeNode(drag.id, drag.originWidth + deltaX, drag.originHeight + deltaY);
        return;
      }
      moveNode(drag.id, drag.originX + deltaX, drag.originY + deltaY);
    },
    [moveNode, resizeNode, zoom],
  );

  const endDrag = useCallback((event: PointerEvent<HTMLDivElement>) => {
    const drag = dragRef.current;
    if (!drag || drag.pointerId !== event.pointerId) return;
    dragRef.current = null;
    if (event.currentTarget.hasPointerCapture(event.pointerId)) {
      event.currentTarget.releasePointerCapture(event.pointerId);
    }
  }, []);

  useLayoutEffect(() => {
    const board = boardRef.current;
    if (!board) return;

    let frame = 0;
    const calculatePaths = () => {
      const boardRect = board.getBoundingClientRect();
      const nextPaths = visibleClusterEdges.flatMap((edge) => {
        const sourceEl = board.querySelector<HTMLElement>(`[data-board-node-id="${edge.source}"]`);
        const targetEl = board.querySelector<HTMLElement>(`[data-board-node-id="${edge.target}"]`);
        if (!sourceEl || !targetEl) return [];

        const sourceRect = sourceEl.getBoundingClientRect();
        const targetRect = targetEl.getBoundingClientRect();
        const sLeft = (sourceRect.left - boardRect.left) / zoom;
        const sRight = (sourceRect.right - boardRect.left) / zoom;
        const sMidY = (sourceRect.top + sourceRect.height / 2 - boardRect.top) / zoom;
        const tLeft = (targetRect.left - boardRect.left) / zoom;
        const tRight = (targetRect.right - boardRect.left) / zoom;
        const tMidY = (targetRect.top + targetRect.height / 2 - boardRect.top) / zoom;
        // exit from the side facing the target
        const targetIsRight = (tLeft + tRight) / 2 >= (sLeft + sRight) / 2;
        const sx = targetIsRight ? sRight : sLeft;
        const tx = targetIsRight ? tLeft : tRight;
        const baseBusX = (sx + tx) / 2;
        const busX = baseBusX + (edgeOffsets[edge.id] ?? 0);
        const { d, handleX, handleY } = orthogonalPath(sx, sMidY, tx, tMidY, busX);
        const data = edge.data as { locked?: boolean; branchColor?: string } | undefined;

        return [{ id: edge.id, d, handleX, handleY, locked: Boolean(data?.locked), color: data?.branchColor }];
      });
      setEdgePaths(nextPaths);
    };

    const schedule = () => {
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(calculatePaths);
    };

    schedule();
    const resizeObserver = new ResizeObserver(schedule);
    resizeObserver.observe(board);
    board.querySelectorAll("[data-board-node-id]").forEach((node) => resizeObserver.observe(node));
    window.addEventListener("resize", schedule);

    return () => {
      cancelAnimationFrame(frame);
      resizeObserver.disconnect();
      window.removeEventListener("resize", schedule);
    };
  }, [state.nodes, visibleClusterEdges, zoom, edgeOffsets]);

  return (
    <div className="relative flex h-full min-h-[640px] flex-col overflow-hidden rounded-md border border-auralis bg-[#fbfaf7]">
      <div className="min-h-0 flex-1 overflow-auto p-4">
        {state.nodes.length === 0 && (
          <div className="flex h-full min-h-[520px] items-center justify-center">
            <div className="max-w-[360px] rounded-md border border-auralis bg-surface px-4 py-3 text-center shadow-sm">
              <div className="text-sm font-medium text-primary">Thinking Board</div>
              <div className="mt-1 text-xs leading-relaxed text-secondary">
                Select text in Brief, structure the current brief, or add a card to start shaping
                the board.
              </div>
            </div>
          </div>
        )}
        {state.nodes.length > 0 && (
          <div
            className="relative"
            style={{
              width: canvasSize.width * zoom,
              height: canvasSize.height * zoom,
            }}
          >
            <div
              ref={boardRef}
              className="relative overflow-hidden rounded-md border border-auralis/80 bg-[#fbfaf7]"
              style={{
                width: canvasSize.width,
                height: canvasSize.height,
                transform: `scale(${zoom})`,
                transformOrigin: "top left",
                backgroundImage:
                  "radial-gradient(circle, rgba(115, 125, 138, 0.22) 1px, transparent 1.2px)",
                backgroundSize: "22px 22px",
              }}
            >
              <svg className="pointer-events-none absolute inset-0 z-10 h-full w-full overflow-visible">
                {edgePaths.map((path) => (
                  <g key={path.id}>
                    <path
                      d={path.d}
                      fill="none"
                      stroke={path.color || "#9da3a8"}
                      strokeLinecap="round"
                      strokeWidth="2"
                      opacity={path.locked ? "0.74" : "0.48"}
                    />
                  </g>
                ))}
              </svg>
              {edgePaths.filter((path) => !path.locked).map((path) => (
                <div
                  key={`handle-${path.id}`}
                  className="group/handle absolute z-20 h-4 w-4 -translate-x-1/2 -translate-y-1/2 cursor-ew-resize rounded-full border border-white bg-[#9da3a8]/60 opacity-0 transition-opacity hover:bg-sky-500 hover:opacity-100"
                  style={{ left: path.handleX, top: path.handleY }}
                  title="Drag to reroute connector"
                  onPointerDown={(event) => beginEdgeDrag(event, path.id)}
                  onPointerMove={updateDrag}
                  onPointerUp={endDrag}
                  onPointerCancel={endDrag}
                />
              ))}
              {state.nodes.map((node) => {
                const noteWidth = getNoteWidth(node);
                const noteHeight = getNoteHeight(node);
                return (
                  <div
                    key={node.id}
                    data-board-node-id={node.id}
                    className="group absolute z-20 touch-none"
                    style={{
                      left: node.position.x + CANVAS_PADDING,
                      top: node.position.y + CANVAS_PADDING,
                      width: noteWidth,
                      height: noteHeight,
                    }}
                    onPointerDown={(event) => beginDrag(event, node)}
                    onPointerMove={updateDrag}
                    onPointerUp={endDrag}
                    onPointerCancel={endDrag}
                  >
                    <IdeaCard
                      id={node.id}
                      data={node.data}
                      onChange={updateNodeData}
                    />
                    {!node.data.locked && node.data.layoutMode !== "xmind" && node.data.layoutMode !== "artifact" && (
                      <button
                        type="button"
                        onPointerDown={(event) => beginResize(event, node)}
                        className="absolute bottom-1 right-1 h-4 w-4 cursor-nwse-resize rounded-sm opacity-0 transition-opacity hover:bg-black/5 group-hover:opacity-100"
                        title="Resize note"
                      >
                        <span className="absolute bottom-1 right-1 h-2 w-2 border-b border-r border-secondary/70" />
                      </button>
                    )}
                  </div>
                );
              })}
            </div>
          </div>
        )}
      </div>

      {onFullscreen && (
        <button
          type="button"
          onClick={onFullscreen}
          className="absolute right-3 top-3 z-30 flex h-9 w-9 items-center justify-center rounded-full border border-black/10 bg-white/95 text-primary shadow-sm hover:bg-surface-variant"
          title="Open fullscreen board"
          aria-label="Open fullscreen board"
        >
          <Maximize2 size={16} />
        </button>
      )}

      <div className="absolute bottom-4 left-4 z-30 flex items-center gap-0.5 rounded-md border border-black/10 bg-white/95 p-1 shadow-sm backdrop-blur-md">
        <button
          type="button"
          onClick={() =>
            setZoom((value) => clamp(Number((value - 0.1).toFixed(2)), MIN_ZOOM, MAX_ZOOM))
          }
          className="flex h-8 w-8 items-center justify-center rounded text-primary hover:bg-surface-variant"
          title="Zoom out"
          aria-label="Zoom out"
        >
          <ZoomOut size={17} />
        </button>
        <button
          type="button"
          onClick={() =>
            setZoom((value) => clamp(Number((value + 0.1).toFixed(2)), MIN_ZOOM, MAX_ZOOM))
          }
          className="flex h-8 w-8 items-center justify-center rounded text-primary hover:bg-surface-variant"
          title="Zoom in"
          aria-label="Zoom in"
        >
          <ZoomIn size={17} />
        </button>
        <button
          type="button"
          onClick={() => setZoom(1)}
          className="flex h-8 w-8 items-center justify-center rounded text-secondary hover:bg-surface-variant hover:text-primary"
          title={`Reset zoom (${Math.round(zoom * 100)}%)`}
          aria-label="Reset zoom"
        >
          <Scan size={16} />
        </button>
      </div>

      <div className="absolute bottom-4 left-1/2 z-30 flex -translate-x-1/2 items-center gap-1 rounded-md border border-black/10 bg-white/95 p-1.5 shadow-[0_12px_34px_rgba(20,24,31,0.14)] backdrop-blur-md">
        <button
          type="button"
          className="flex h-9 w-9 items-center justify-center rounded bg-primary text-on-primary"
          title="Select and move"
          aria-label="Select and move"
        >
          <MousePointer2 size={17} />
        </button>
        <button
          type="button"
          onClick={() => addNode("idea")}
          className="flex h-9 w-9 items-center justify-center rounded text-primary hover:bg-surface-variant"
          title="Create note"
          aria-label="Create note"
        >
          <StickyNote size={18} />
        </button>
        {onGenerateFromBrief && (
          <button
            type="button"
            onClick={onGenerateFromBrief}
            disabled={loading}
            className="flex h-9 w-9 items-center justify-center rounded text-primary hover:bg-surface-variant disabled:opacity-40"
            title={loading ? "Structuring brief" : "Structure brief"}
            aria-label="Structure brief"
          >
            <Sparkles size={17} className={loading ? "animate-pulse" : ""} />
          </button>
        )}
        <button
          type="button"
          onClick={exportMap}
          disabled={state.nodes.length === 0}
          className="flex h-9 w-9 items-center justify-center rounded text-primary hover:bg-surface-variant disabled:opacity-35"
          title="Export board JSON"
          aria-label="Export board JSON"
        >
          <Download size={17} />
        </button>
      </div>
    </div>
  );
}
