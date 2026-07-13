import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type DragEvent as ReactDragEvent,
  type FormEvent,
  type KeyboardEvent as ReactKeyboardEvent,
} from "react";
import {
  Background,
  BaseEdge,
  ConnectionMode,
  Handle,
  MiniMap,
  NodeResizeControl,
  Position,
  ReactFlow,
  ReactFlowProvider,
  ResizeControlVariant,
  ViewportPortal,
  addEdge,
  applyEdgeChanges,
  applyNodeChanges,
  useOnSelectionChange,
  useReactFlow,
  useViewport,
  type Connection,
  type Edge,
  type EdgeChange,
  type EdgeProps,
  type FinalConnectionState,
  type NodeChange,
  type NodeProps,
} from "@xyflow/react";
import "@xyflow/react/dist/style.css";
import { useServerFn } from "@tanstack/react-start";
import {
  AlignCenter,
  AlignLeft,
  AlignRight,
  Bold,
  Italic,
  LoaderCircle,
  Merge,
  MessageCircle,
  MousePointer2,
  Plus,
  Scan,
  Shrink,
  StickyNote,
  Type,
  ZoomIn,
  ZoomOut,
} from "lucide-react";

import { AgentDock } from "@/components/agent/AgentDock";
import type { AgentStatus } from "@/components/agent/AgentPanel";
import type {
  IdeaCanvasState,
  IdeaFlowNode,
  IdeaNodeData,
  IdeaNodeKind,
} from "@/components/mindmap/IdeaCanvas";
import {
  IDEA_NODE_DEFAULT_HEIGHT,
  IDEA_NODE_DEFAULT_WIDTH,
  IDEA_NODE_MIN_HEIGHT,
  OPPOSITE_SIDE,
  PARALLEL_BRANCH_GAP,
  chooseBestBranchSide,
  layoutParallelBranch,
  makeParallelBranchLayout,
  parallelChildPosition,
  reflowParallelBranches,
  type CanvasSide,
  type ParallelBranchLayout,
} from "@/lib/canvas/canvasLayoutEngine";
import { normalizeCanvasEdgeLabel } from "@/lib/canvas/edgeLabels";
import { askCards, mergeCards } from "@/lib/orchestrator/boardActions.functions";

type Props = {
  state: IdeaCanvasState;
  onChange: (next: IdeaCanvasState) => void;
  onExit: () => void;
  agentStatus: AgentStatus;
  listening: boolean;
  level: number;
  partial?: string;
  aiWriting?: boolean;
  insight?: string;
  agentDockCollapsed: boolean;
  onToggleListening: () => void;
  onPromptAgent: () => void;
  onToggleAgentDock: () => void;
  onExpandAudio: () => void;
  onInlineDictationStart?: () => Promise<void> | void;
  onInlineDictationStop?: () => Promise<string>;
};

type CanvasProps = Props & {
  mode?: "embedded" | "fullscreen";
  onEnterFullscreen?: () => void;
  showAgentDock?: boolean;
  captureAnchor?: { x: number; y: number } | null;
  captureActive?: boolean;
  onCanvasPointSelect?: (position: { x: number; y: number }) => void;
};

type Side = CanvasSide;

type EditableEdgeData = import("@/components/mindmap/IdeaCanvas").IdeaEdgeData;

type EditableBoardEdge = Edge<EditableEdgeData>;

const KIND_STYLE: Record<
  IdeaNodeKind,
  {
    label: string;
    bg: string;
    border: string;
    accent: string;
    titleColor: string;
  }
> = {
  focus: {
    label: "Focus",
    bg: "#ecebea",
    border: "#c9c7c4",
    accent: "#66635f",
    titleColor: "#242321",
  },
  idea: {
    label: "Idea",
    bg: "#cfe8fb",
    border: "#a8d1ef",
    accent: "#3978aa",
    titleColor: "#183d58",
  },
  question: {
    label: "Question",
    bg: "#ded6f4",
    border: "#c2b4e7",
    accent: "#7052ad",
    titleColor: "#39265c",
  },
  decision: {
    label: "Decision",
    bg: "#cfe9d5",
    border: "#a7d5b1",
    accent: "#3e8250",
    titleColor: "#204c2b",
  },
  risk: {
    label: "Risk",
    bg: "#f6c9c5",
    border: "#eba9a4",
    accent: "#b94d47",
    titleColor: "#5c211d",
  },
  next: {
    label: "Next",
    bg: "#ffe29a",
    border: "#efc96b",
    accent: "#9a6a0d",
    titleColor: "#4e370d",
  },
};

const SIDES: Array<{ side: Side; position: Position }> = [
  { side: "top", position: Position.Top },
  { side: "right", position: Position.Right },
  { side: "bottom", position: Position.Bottom },
  { side: "left", position: Position.Left },
];

const QUICK_ADD_POSITION: Record<Side, string> = {
  top: "left-1/2 top-0 -translate-x-1/2 -translate-y-[34px]",
  right: "right-0 top-1/2 translate-x-[34px] -translate-y-1/2",
  bottom: "bottom-0 left-1/2 -translate-x-1/2 translate-y-[34px]",
  left: "left-0 top-1/2 -translate-x-[34px] -translate-y-1/2",
};

const TEXT_NODE_MIN_WIDTH = 190;
const TEXT_NODE_DEFAULT_WIDTH = 190;
const TEXT_NODE_MAX_WIDTH = 520;

const MAX_PASTED_IMAGE_BYTES = 1_800_000;

function fileToDataUrl(file: File) {
  return new Promise<string>((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result ?? ""));
    reader.onerror = () => reject(reader.error ?? new Error("Could not read image."));
    reader.readAsDataURL(file);
  });
}

function findOpenPosition(nodes: IdeaFlowNode[], desired: { x: number; y: number }, width = 260) {
  const height = 190;
  for (let index = 0; index < 20; index++) {
    const column = index % 4;
    const row = Math.floor(index / 4);
    const candidate = {
      x: desired.x + column * 300,
      y: desired.y + row * 225,
    };
    const overlaps = nodes.some((node) => {
      const nodeWidth = node.data.width ?? node.measured?.width ?? 260;
      const nodeHeight = node.measured?.height ?? 190;
      return !(
        candidate.x + width + 28 < node.position.x ||
        candidate.x > node.position.x + nodeWidth + 28 ||
        candidate.y + height + 28 < node.position.y ||
        candidate.y > node.position.y + nodeHeight + 28
      );
    });
    if (!overlaps) return candidate;
  }
  return {
    x: desired.x + 48,
    y: desired.y + 48,
  };
}

function getNodeBounds(node: IdeaFlowNode) {
  const width = node.data.width ?? node.measured?.width ?? 260;
  const height = node.data.height ?? node.measured?.height ?? 190;
  return {
    left: node.position.x,
    right: node.position.x + width,
    top: node.position.y,
    bottom: node.position.y + height,
    width,
    height,
  };
}

function getNodesBounds(nodes: IdeaFlowNode[]) {
  const bounds = nodes.map(getNodeBounds);
  const left = Math.min(...bounds.map((item) => item.left));
  const right = Math.max(...bounds.map((item) => item.right));
  const top = Math.min(...bounds.map((item) => item.top));
  const bottom = Math.max(...bounds.map((item) => item.bottom));
  return {
    left,
    right,
    top,
    bottom,
    centerX: (left + right) / 2,
    centerY: (top + bottom) / 2,
  };
}

function estimateTextBlockWidth(text: string, textSize: IdeaNodeData["textSize"] = "small") {
  const fontSize = textSize === "large" ? 24 : textSize === "normal" ? 18 : 14;
  const longestLine = Math.max(8, ...text.split("\n").map((line) => line.length));
  return Math.min(
    TEXT_NODE_MAX_WIDTH,
    Math.max(TEXT_NODE_MIN_WIDTH, longestLine * fontSize * 0.62 + 28),
  );
}

function roundedOrthogonalPath(points: Array<{ x: number; y: number }>, radius = 8) {
  const unique = points.filter(
    (point, index) =>
      index === 0 || point.x !== points[index - 1].x || point.y !== points[index - 1].y,
  );
  if (unique.length < 2) return "";

  const path: string[] = [`M ${unique[0].x} ${unique[0].y}`];
  for (let index = 1; index < unique.length; index++) {
    const prev = unique[index - 1];
    const current = unique[index];
    const next = unique[index + 1];
    if (!next) {
      path.push(`L ${current.x} ${current.y}`);
      continue;
    }

    const inDx = current.x - prev.x;
    const inDy = current.y - prev.y;
    const outDx = next.x - current.x;
    const outDy = next.y - current.y;
    const inLength = Math.abs(inDx || inDy);
    const outLength = Math.abs(outDx || outDy);
    const corner = Math.min(radius, inLength / 2, outLength / 2);
    if (corner <= 0 || (inDx && outDx) || (inDy && outDy)) {
      path.push(`L ${current.x} ${current.y}`);
      continue;
    }

    const before = {
      x: current.x - Math.sign(inDx) * corner,
      y: current.y - Math.sign(inDy) * corner,
    };
    const after = {
      x: current.x + Math.sign(outDx) * corner,
      y: current.y + Math.sign(outDy) * corner,
    };
    path.push(`L ${before.x} ${before.y}`);
    path.push(`Q ${current.x} ${current.y} ${after.x} ${after.y}`);
  }
  return path.join(" ");
}

function orthogonalEdgePath({
  sourceX,
  sourceY,
  targetX,
  targetY,
  sourcePosition,
  targetPosition,
  routeOffset = 0,
  branchLayout,
}: {
  sourceX: number;
  sourceY: number;
  targetX: number;
  targetY: number;
  sourcePosition: Position;
  targetPosition: Position;
  routeOffset?: number;
  branchLayout?: ParallelBranchLayout;
}) {
  const sourceVertical = sourcePosition === Position.Top || sourcePosition === Position.Bottom;
  const targetVertical = targetPosition === Position.Top || targetPosition === Position.Bottom;
  const stub = 32;

  let points: Array<{ x: number; y: number }>;
  let handle: { x: number; y: number; cursor: "ew-resize" | "ns-resize" };

  if (branchLayout?.mode === "parallel") {
    const fixedStub = Math.max(36, Math.min(72, branchLayout.fixedLength * 0.48));
    if (branchLayout.side === "right" || branchLayout.side === "left") {
      const dir = branchLayout.side === "right" ? 1 : -1;
      const trunkX = sourceX + dir * fixedStub;
      const targetStubX = targetX - dir * stub;
      points = [
        { x: sourceX, y: sourceY },
        { x: trunkX, y: sourceY },
        { x: trunkX, y: targetY },
        { x: targetStubX, y: targetY },
        { x: targetX, y: targetY },
      ];
      handle = { x: trunkX, y: (sourceY + targetY) / 2, cursor: "ew-resize" };
    } else {
      const dir = branchLayout.side === "bottom" ? 1 : -1;
      const trunkY = sourceY + dir * fixedStub;
      const targetStubY = targetY - dir * stub;
      points = [
        { x: sourceX, y: sourceY },
        { x: sourceX, y: trunkY },
        { x: targetX, y: trunkY },
        { x: targetX, y: targetStubY },
        { x: targetX, y: targetY },
      ];
      handle = { x: (sourceX + targetX) / 2, y: trunkY, cursor: "ns-resize" };
    }

    const path = roundedOrthogonalPath(points);
    return {
      path,
      labelX: handle.x,
      labelY: handle.y,
      handleX: handle.x,
      handleY: handle.y,
      handleCursor: handle.cursor,
    };
  }

  if (sourceVertical && targetVertical) {
    const sourceDir = sourcePosition === Position.Bottom ? 1 : -1;
    const targetDir = targetPosition === Position.Bottom ? 1 : -1;
    const sourceStubY = sourceY + sourceDir * stub;
    const targetStubY = targetY + targetDir * stub;
    const busX = (sourceX + targetX) / 2 + routeOffset;

    if (Math.abs(sourceX - targetX) <= 8 && Math.abs(routeOffset) <= 0.5) {
      points = [
        { x: sourceX, y: sourceY },
        { x: targetX, y: targetY },
      ];
    } else {
      points = [
        { x: sourceX, y: sourceY },
        { x: sourceX, y: sourceStubY },
        { x: busX, y: sourceStubY },
        { x: busX, y: targetStubY },
        { x: targetX, y: targetStubY },
        { x: targetX, y: targetY },
      ];
    }
    handle = { x: busX, y: (sourceStubY + targetStubY) / 2, cursor: "ew-resize" };
  } else if (!sourceVertical && !targetVertical) {
    const sourceDir = sourcePosition === Position.Right ? 1 : -1;
    const targetDir = targetPosition === Position.Right ? 1 : -1;
    const sourceStubX = sourceX + sourceDir * stub;
    const targetStubX = targetX + targetDir * stub;
    const busY = (sourceY + targetY) / 2 + routeOffset;

    if (Math.abs(sourceY - targetY) <= 8 && Math.abs(routeOffset) <= 0.5) {
      points = [
        { x: sourceX, y: sourceY },
        { x: targetX, y: targetY },
      ];
    } else {
      points = [
        { x: sourceX, y: sourceY },
        { x: sourceStubX, y: sourceY },
        { x: sourceStubX, y: busY },
        { x: targetStubX, y: busY },
        { x: targetStubX, y: targetY },
        { x: targetX, y: targetY },
      ];
    }
    handle = { x: (sourceStubX + targetStubX) / 2, y: busY, cursor: "ns-resize" };
  } else {
    const corner = sourceVertical
      ? { x: sourceX, y: targetY + routeOffset }
      : { x: targetX + routeOffset, y: sourceY };
    points = [{ x: sourceX, y: sourceY }, corner, { x: targetX, y: targetY }];
    handle = {
      x: corner.x,
      y: corner.y,
      cursor: sourceVertical ? "ns-resize" : "ew-resize",
    };
  }

  const path = roundedOrthogonalPath(points);
  return {
    path,
    labelX: handle.x,
    labelY: handle.y,
    handleX: handle.x,
    handleY: handle.y,
    handleCursor: handle.cursor,
  };
}

function SmartNote({ id, data, selected }: NodeProps<IdeaFlowNode>) {
  const style = KIND_STYLE[data.kind] ?? KIND_STYLE.idea;
  const titleRef = useRef<HTMLTextAreaElement>(null);
  const bodyRef = useRef<HTMLTextAreaElement>(null);
  const [hovered, setHovered] = useState(false);
  const text = data.body ? `${data.title}\n${data.body}` : data.title;
  const showConnections = hovered || selected;
  const dictationCaret = data.dictationCaret;
  const onChange = data.onChange;
  const savedWidth = Number(data.width ?? IDEA_NODE_DEFAULT_WIDTH);
  const noteWidth = Math.max(savedWidth, IDEA_NODE_DEFAULT_WIDTH);

  useEffect(() => {
    const title = titleRef.current;
    const body = bodyRef.current;
    if (title) {
      title.style.height = "auto";
      title.style.height = `${Math.max(34, title.scrollHeight)}px`;
    }
    if (body) {
      body.style.height = "auto";
      body.style.height = `${Math.max(68, body.scrollHeight)}px`;
    }
  }, [data.title, data.body, data.width]);

  useEffect(() => {
    if (!data.autoFocus) return;
    const timer = window.setTimeout(() => {
      const target = data.title ? bodyRef.current : titleRef.current;
      target?.focus();
      target?.setSelectionRange(target.value.length, target.value.length);
    }, 380);
    return () => window.clearTimeout(timer);
  }, [data.autoFocus, data.title]);

  useEffect(() => {
    if (typeof dictationCaret !== "number") return;
    const timer = window.setTimeout(() => {
      const titleLength = data.title.length;
      if (dictationCaret <= titleLength) {
        const title = titleRef.current;
        if (!title) return;
        const caret = Math.min(dictationCaret, title.value.length);
        title.focus();
        title.setSelectionRange(caret, caret);
      } else {
        const body = bodyRef.current;
        if (!body) return;
        const caret = Math.min(Math.max(0, dictationCaret - titleLength - 1), body.value.length);
        body.focus();
        body.setSelectionRange(caret, caret);
      }
      onChange?.(id, { dictationCaret: undefined });
    }, 0);
    return () => window.clearTimeout(timer);
  }, [data.title, dictationCaret, id, onChange]);

  return (
    <div
      className="group/note relative"
      style={{ width: noteWidth }}
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
    >
      {SIDES.map(({ side, position }) => (
        <Handle
          key={side}
          id={side}
          type="source"
          position={position}
          style={{
            width: 11,
            height: 11,
            opacity: showConnections ? 1 : 0,
            pointerEvents: showConnections ? "auto" : "none",
            background: "#168cf5",
            border: "2px solid white",
            transition: "opacity 120ms ease",
            zIndex: 20,
          }}
          aria-label={`Connect from ${side}`}
        />
      ))}

      {SIDES.map(({ side }) => (
        <button
          key={`add-${side}`}
          type="button"
          className={`nodrag nopan absolute z-30 flex h-7 w-7 items-center justify-center rounded-full bg-[#168cf5] text-white shadow-sm transition-all hover:scale-105 ${
            QUICK_ADD_POSITION[side]
          } ${showConnections ? "pointer-events-auto opacity-100" : "pointer-events-none opacity-0"}`}
          onMouseDown={(event) => event.preventDefault()}
          onClick={(event) => {
            event.stopPropagation();
            data.onQuickAdd?.(id, side);
          }}
          title={`Create connected note ${side}`}
          aria-label={`Create connected note ${side}`}
        >
          <Plus size={17} strokeWidth={2.4} />
        </button>
      ))}

      <div
        className={`relative flex w-full flex-col overflow-visible border transition-all duration-200 ${
          selected || data.activeWriting
            ? "shadow-[0_10px_24px_rgba(20,24,31,0.16)]"
            : "shadow-[0_6px_15px_rgba(20,24,31,0.08)] hover:shadow-[0_10px_24px_rgba(20,24,31,0.12)]"
        }`}
        style={{
          background: style.bg,
          borderColor: selected || data.activeWriting ? "#168cf5" : style.border,
          borderRadius: 4,
          width: noteWidth,
          minHeight: IDEA_NODE_DEFAULT_HEIGHT,
          boxShadow: data.activeWriting
            ? "0 0 0 2px rgba(22,140,245,0.16), 0 10px 24px rgba(20,24,31,0.16)"
            : undefined,
        }}
      >
        {data.activeWriting && (
          <div className="pointer-events-none absolute right-3 top-3 flex items-center gap-1.5 rounded-full bg-white/70 px-2 py-1 text-[10px] font-medium text-[#168cf5] shadow-sm">
            <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-[#168cf5]" />
            Writing
          </div>
        )}
        <div className="flex min-h-[112px] min-w-0 flex-col px-5 pb-3 pt-5">
          <textarea
            ref={titleRef}
            rows={1}
            wrap="soft"
            onFocus={() => data.onSelect?.(id)}
            onKeyDown={(event) => {
              data.onInlineDictationKeyDown?.(id, event, text);
              if (!event.defaultPrevented && event.key === "Enter" && !event.shiftKey) {
                event.preventDefault();
                bodyRef.current?.focus();
                bodyRef.current?.setSelectionRange(0, 0);
              }
            }}
            onKeyUp={(event) => data.onInlineDictationKeyUp?.(id, event, text)}
            className="nodrag nowheel block w-full min-w-0 resize-none overflow-hidden whitespace-pre-wrap break-words bg-transparent p-0 text-[18px] font-semibold leading-[1.32] outline-none placeholder:text-secondary/55"
            style={{ color: style.titleColor, overflowWrap: "break-word" }}
            value={data.title}
            onChange={(event) => {
              const value = event.target.value;
              const newline = value.indexOf("\n");
              if (newline === -1) data.onChange?.(id, { title: value });
              else {
                data.onChange?.(id, {
                  title: value.slice(0, newline),
                  body: `${value.slice(newline + 1)}${data.body ? `\n${data.body}` : ""}`,
                });
                window.setTimeout(() => bodyRef.current?.focus(), 0);
              }
            }}
            placeholder="Title"
          />
          <textarea
            ref={bodyRef}
            rows={2}
            wrap="soft"
            onFocus={() => data.onSelect?.(id)}
            onKeyDown={(event) => data.onInlineDictationKeyDown?.(id, event, text)}
            onKeyUp={(event) => data.onInlineDictationKeyUp?.(id, event, text)}
            className="nodrag nowheel mt-2 block w-full min-w-0 resize-none overflow-hidden whitespace-pre-wrap break-words bg-transparent p-0 text-[14px] font-normal leading-[1.5] outline-none placeholder:text-secondary/55"
            style={{ color: style.titleColor, overflowWrap: "break-word" }}
            value={data.body ?? ""}
            onChange={(event) => data.onChange?.(id, { body: event.target.value })}
            placeholder="Add details"
          />
          {data.activeWriting && !data.body && (
            <div className="pointer-events-none mt-3 space-y-2 overflow-hidden">
              <div className="h-2.5 w-4/5 animate-pulse rounded bg-white/60" />
              <div className="h-2.5 w-2/3 animate-pulse rounded bg-white/50" />
              <div className="h-2.5 w-1/2 animate-pulse rounded bg-white/45" />
            </div>
          )}
        </div>
        <div className="mt-auto flex items-center justify-between gap-2 px-4 pb-3 pt-2">
          <select
            className="nodrag min-w-0 cursor-pointer bg-transparent text-[9px] font-semibold uppercase tracking-[0.08em] outline-none"
            style={{ color: style.accent }}
            value={data.kind}
            onChange={(event) => data.onChange?.(id, { kind: event.target.value as IdeaNodeKind })}
            title="Note type"
            aria-label="Note type"
          >
            {Object.entries(KIND_STYLE).map(([kind, item]) => (
              <option key={kind} value={kind}>
                {item.label}
              </option>
            ))}
          </select>
          <div
            className="note-drag-handle flex h-5 w-5 cursor-grab items-center justify-center rounded-full hover:bg-black/5 active:cursor-grabbing"
            title="Drag note"
            aria-label="Drag note"
          >
            <span className="h-2 w-2 rounded-full" style={{ background: style.accent }} />
          </div>
        </div>
      </div>
    </div>
  );
}

function TextBlock({ id, data, selected }: NodeProps<IdeaFlowNode>) {
  const taRef = useRef<HTMLTextAreaElement>(null);
  const text = data.body ? `${data.title}\n${data.body}` : data.title;
  const dictationCaret = data.dictationCaret;
  const onChange = data.onChange;

  useEffect(() => {
    const textarea = taRef.current;
    if (!textarea) return;
    textarea.style.height = "auto";
    textarea.style.height = `${Math.max(52, textarea.scrollHeight)}px`;
  }, [data.width, text]);

  useEffect(() => {
    if (!data.autoFocus) return;
    const timer = window.setTimeout(() => {
      taRef.current?.focus();
      taRef.current?.setSelectionRange(text.length, text.length);
    }, 180);
    return () => window.clearTimeout(timer);
  }, [data.autoFocus, text.length]);

  useEffect(() => {
    if (typeof dictationCaret !== "number") return;
    const timer = window.setTimeout(() => {
      const textarea = taRef.current;
      if (!textarea) return;
      const caret = Math.min(dictationCaret, textarea.value.length);
      textarea.focus();
      textarea.setSelectionRange(caret, caret);
      onChange?.(id, { dictationCaret: undefined });
    }, 0);
    return () => window.clearTimeout(timer);
  }, [dictationCaret, id, onChange]);

  return (
    <div className="group/text relative min-h-[52px]">
      {selected && (
        <>
          <NodeResizeControl
            position="left"
            variant={ResizeControlVariant.Line}
            resizeDirection="horizontal"
            minWidth={TEXT_NODE_MIN_WIDTH}
            maxWidth={TEXT_NODE_MAX_WIDTH}
            color="#168cf5"
          />
          <NodeResizeControl
            position="right"
            variant={ResizeControlVariant.Line}
            resizeDirection="horizontal"
            minWidth={TEXT_NODE_MIN_WIDTH}
            maxWidth={TEXT_NODE_MAX_WIDTH}
            color="#168cf5"
          />
        </>
      )}
      <div
        className={`relative min-h-[52px] border bg-transparent transition-colors ${
          selected ? "border-[#168cf5]/70" : "border-transparent"
        }`}
      >
        <textarea
          ref={taRef}
          onFocus={() => data.onSelect?.(id)}
          onKeyDown={(event) => data.onInlineDictationKeyDown?.(id, event, text)}
          onKeyUp={(event) => data.onInlineDictationKeyUp?.(id, event, text)}
          value={text}
          onChange={(event) => {
            const value = event.target.value;
            const newline = value.indexOf("\n");
            const width = Math.round(estimateTextBlockWidth(value, data.textSize ?? "small"));
            data.onChange?.(
              id,
              newline === -1
                ? { title: value, body: "", width }
                : { title: value.slice(0, newline), body: value.slice(newline + 1), width },
            );
          }}
          placeholder="Add text"
          className="nodrag nowheel block w-full resize-none overflow-hidden whitespace-pre-wrap break-words bg-transparent px-2 py-2 font-sans leading-[1.5] text-primary outline-none placeholder:text-secondary/55"
          style={{
            fontFamily: "Inter, ui-sans-serif, system-ui, sans-serif",
            fontSize: data.textSize === "large" ? 24 : data.textSize === "normal" ? 18 : 14,
            fontWeight: data.bold ? 600 : 400,
            fontStyle: data.italic ? "italic" : "normal",
            textAlign: data.textAlign ?? "left",
          }}
        />
        <div
          className={`note-drag-handle absolute bottom-1 right-1 flex h-5 w-5 cursor-grab items-center justify-center rounded-full bg-white/80 transition-opacity active:cursor-grabbing ${
            selected ? "opacity-100" : "opacity-0 group-hover/text:opacity-100"
          }`}
          title="Drag text block"
          aria-label="Drag text block"
        >
          <span className="h-1.5 w-1.5 rounded-full bg-secondary" />
        </div>
      </div>
    </div>
  );
}

function ImageBlock({ data, selected }: NodeProps<IdeaFlowNode>) {
  const src = data.body ?? "";
  return (
    <div className="group/image relative">
      {selected && (
        <NodeResizeControl
          variant={ResizeControlVariant.Line}
          minWidth={180}
          minHeight={120}
          maxWidth={960}
          maxHeight={720}
          color="#168cf5"
        />
      )}
      <div
        className={`relative overflow-hidden border bg-white transition-shadow ${
          selected
            ? "shadow-[0_10px_24px_rgba(20,24,31,0.16)]"
            : "shadow-[0_7px_18px_rgba(20,24,31,0.1)] hover:shadow-[0_10px_24px_rgba(20,24,31,0.14)]"
        }`}
        style={{ borderColor: selected ? "#168cf5" : "rgba(0,0,0,0.12)", borderRadius: 4 }}
      >
        {src ? (
          <img
            src={src}
            alt={data.title || "Canvas image"}
            className="block h-full w-full select-none object-contain"
            draggable={false}
          />
        ) : (
          <div className="flex h-full min-h-[160px] items-center justify-center text-sm text-secondary">
            Image unavailable
          </div>
        )}
        <div
          className={`note-drag-handle absolute right-2 top-2 flex h-7 w-7 cursor-grab items-center justify-center rounded bg-white/90 text-secondary shadow-sm transition-opacity active:cursor-grabbing ${
            selected ? "opacity-100" : "opacity-0 group-hover/image:opacity-100"
          }`}
          title="Drag image"
          aria-label="Drag image"
        >
          <span className="h-1.5 w-1.5 rounded-full bg-secondary" />
        </div>
      </div>
    </div>
  );
}

function EditableEdge({
  id,
  sourceX,
  sourceY,
  targetX,
  targetY,
  sourcePosition,
  targetPosition,
  markerEnd,
  style,
  selected,
  data,
}: EdgeProps<EditableBoardEdge>) {
  const route = orthogonalEdgePath({
    sourceX,
    sourceY,
    sourcePosition,
    targetX,
    targetY,
    targetPosition,
    routeOffset: Number(data?.routeOffset ?? 0) + Number(data?.autoRouteOffset ?? 0),
    branchLayout: data?.branchLayout,
  });

  return (
    <>
      <BaseEdge
        id={id}
        path={route.path}
        markerEnd={markerEnd}
        style={{
          stroke: selected ? "#168cf5" : "#777a7d",
          strokeWidth: selected ? 2.3 : 2,
          strokeLinecap: "round",
          strokeLinejoin: "round",
          ...style,
        }}
      />
      <path
        d={route.path}
        fill="none"
        stroke="rgba(22, 140, 245, 0.001)"
        strokeWidth={22}
        className="cursor-default"
        style={{ pointerEvents: "stroke" }}
      />
    </>
  );
}

const nodeTypes = { ideaNode: SmartNote, textNode: TextBlock, imageNode: ImageBlock };
const edgeTypes = { editable: EditableEdge };

function BoardInner({
  state,
  onChange,
  onExit,
  agentStatus,
  listening,
  level,
  partial,
  aiWriting,
  insight,
  agentDockCollapsed,
  onToggleListening,
  onPromptAgent,
  onToggleAgentDock,
  onExpandAudio,
  onInlineDictationStart,
  onInlineDictationStop,
  mode = "fullscreen",
  onEnterFullscreen,
  showAgentDock = true,
  captureAnchor,
  captureActive = false,
  onCanvasPointSelect,
}: CanvasProps) {
  const rf = useReactFlow();
  const viewport = useViewport();
  const stateRef = useRef(state);
  const lastPointerFlowRef = useRef<{ x: number; y: number } | null>(null);
  const [selectedNodes, setSelectedNodes] = useState<IdeaFlowNode[]>([]);
  const [actionBusy, setActionBusy] = useState(false);
  const [askOpen, setAskOpen] = useState(false);
  const [askDraft, setAskDraft] = useState("");
  const inlineDictationRef = useRef<{
    timer: number | null;
    active: boolean;
    nodeId: string;
    text: string;
    selectionStart: number;
    selectionEnd: number;
  } | null>(null);
  const mergeFn = useServerFn(mergeCards);
  const askFn = useServerFn(askCards);
  const hasCanvasContent = state.nodes.length > 0;

  useEffect(() => {
    stateRef.current = state;
  }, [state]);

  const commitState = useCallback(
    (next: IdeaCanvasState) => {
      stateRef.current = next;
      onChange(next);
    },
    [onChange],
  );

  const updateNodeData = useCallback(
    (
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
        >
      >,
    ) => {
      const current = stateRef.current;
      const existing = current.nodes.find((node) => node.id === id);
      if (existing?.type === "textNode" && ("title" in patch || "body" in patch)) {
        const currentText = `${existing.data.title ?? ""}${existing.data.body ?? ""}`.trim();
        const nextTitle = patch.title ?? existing.data.title ?? "";
        const nextBody = patch.body ?? existing.data.body ?? "";
        const nextText = `${nextTitle}${nextBody}`.trim();
        if (currentText && !nextText) {
          commitState({
            ...current,
            nodes: current.nodes.filter((node) => node.id !== id),
            edges: current.edges.filter((edge) => edge.source !== id && edge.target !== id),
          });
          return;
        }
      }
      const nodes = current.nodes.map((node) =>
        node.id === id ? { ...node, data: { ...node.data, ...patch } } : node,
      );
      const shouldReflow = "width" in patch || "height" in patch;
      const next = shouldReflow
        ? reflowParallelBranches(nodes, current.edges)
        : { nodes, edges: current.edges };
      commitState({
        ...current,
        nodes: next.nodes,
        edges: next.edges,
      });
    },
    [commitState],
  );

  const selectNode = useCallback(
    (id: string) => {
      const current = stateRef.current;
      commitState({
        ...current,
        nodes: current.nodes.map((node) => ({
          ...node,
          selected: node.id === id,
        })),
      });
    },
    [commitState],
  );

  const replaceNodeText = useCallback(
    (id: string, nextText: string, caret?: number) => {
      const newline = nextText.indexOf("\n");
      updateNodeData(
        id,
        newline === -1
          ? { title: nextText, body: "", dictationCaret: caret }
          : {
              title: nextText.slice(0, newline),
              body: nextText.slice(newline + 1),
              dictationCaret: caret,
            },
      );
    },
    [updateNodeData],
  );

  const onInlineKeyDown = useCallback(
    (id: string, event: ReactKeyboardEvent<HTMLTextAreaElement>, currentText: string) => {
      const isInlineVoiceHotkey =
        event.code === "Space" &&
        (event.metaKey || event.ctrlKey) &&
        event.shiftKey &&
        !event.altKey;
      if (!isInlineVoiceHotkey) return;
      if (event.repeat) return;
      if (!onInlineDictationStart || !onInlineDictationStop) return;
      if (inlineDictationRef.current?.timer || inlineDictationRef.current?.active) return;

      const target = event.currentTarget;
      const selectionStart = target.selectionStart ?? currentText.length;
      const selectionEnd = target.selectionEnd ?? selectionStart;
      const snapshot = currentText;
      event.preventDefault();
      event.stopPropagation();
      const ref = {
        timer: null as number | null,
        active: false,
        nodeId: id,
        text: snapshot,
        selectionStart,
        selectionEnd,
      };
      ref.timer = window.setTimeout(() => {
        ref.timer = null;
        ref.active = true;
        void onInlineDictationStart();
      }, 280);
      inlineDictationRef.current = ref;
    },
    [onInlineDictationStart, onInlineDictationStop],
  );

  const onInlineKeyUp = useCallback(
    (id: string, event: ReactKeyboardEvent<HTMLTextAreaElement>, currentText: string) => {
      const isInlineVoiceRelease =
        event.code === "Space" ||
        event.key === "Meta" ||
        event.key === "Control" ||
        event.key === "Shift";
      if (!isInlineVoiceRelease) return;
      const ref = inlineDictationRef.current;
      if (!ref || ref.nodeId !== id) return;

      if (ref.timer) {
        clearTimeout(ref.timer);
        inlineDictationRef.current = null;
        return;
      }

      if (!ref.active || !onInlineDictationStop) {
        inlineDictationRef.current = null;
        return;
      }

      event.preventDefault();
      event.stopPropagation();
      inlineDictationRef.current = null;
      void onInlineDictationStop().then((cleaned) => {
        const insert = cleaned.trim();
        if (!insert) return;
        const base = ref.text;
        const start = Math.min(ref.selectionStart, base.length);
        const end = Math.min(ref.selectionEnd, base.length);
        const before = base.slice(0, start);
        const after = base.slice(end);
        const needsLeadingSpace = before.length > 0 && !/[\s\n]$/.test(before);
        const needsTrailingSpace = after.length > 0 && !/^[\s\n，。！？,.!?]/.test(after);
        const nextText = `${before}${needsLeadingSpace ? " " : ""}${insert}${needsTrailingSpace ? " " : ""}${after}`;
        const caret = before.length + (needsLeadingSpace ? 1 : 0) + insert.length;
        replaceNodeText(id, nextText, caret);
      });
    },
    [onInlineDictationStop, replaceNodeText],
  );

  const createConnectedNode = useCallback(
    (sourceId: string, side: Side, dropPosition?: { x: number; y: number }) => {
      const current = stateRef.current;
      const source = current.nodes.find((node) => node.id === sourceId);
      if (!source) return;

      const width = IDEA_NODE_DEFAULT_WIDTH;
      const branchSide = dropPosition
        ? side
        : chooseBestBranchSide({
            nodes: current.nodes,
            edges: current.edges,
            sourceId,
            newChildCount: 1,
            preferredSide: side,
          });
      const existingBranchEdges = current.edges.filter(
        (edge) => edge.source === sourceId && edge.sourceHandle === branchSide,
      );
      const branchTargetIds = [
        ...existingBranchEdges.map((edge) => edge.target),
        "__new__",
      ];
      const branchIndex = branchTargetIds.length - 1;
      const desiredPosition = dropPosition
        ? { x: dropPosition.x - width / 2, y: dropPosition.y - 80 }
        : parallelChildPosition({
            source,
            side: branchSide,
            index: branchIndex,
            count: branchTargetIds.length,
            childWidth: width,
            childHeight: IDEA_NODE_MIN_HEIGHT,
          });
      const position = dropPosition ? findOpenPosition(current.nodes, desiredPosition, width) : desiredPosition;

      const id = crypto.randomUUID();
      const node: IdeaFlowNode = {
        id,
        type: "ideaNode",
        position: {
          x: Math.round(position.x),
          y: Math.round(position.y),
        },
        data: {
          title: "",
          body: "",
          kind: "idea",
          width,
          autoFocus: true,
        },
      };
      const edge: Edge = {
        id: crypto.randomUUID(),
        source: sourceId,
        target: id,
        sourceHandle: branchSide,
        targetHandle: OPPOSITE_SIDE[branchSide],
        type: "editable",
        data: {
          branchLayout: makeParallelBranchLayout({
            side: branchSide,
            index: branchIndex,
            count: branchTargetIds.length,
            gap: PARALLEL_BRANCH_GAP,
          }),
        },
      };
      const next = layoutParallelBranch({
        nodes: [...current.nodes, node],
        edges: [...current.edges, edge],
        sourceId,
        side: branchSide,
        targetIds: [...existingBranchEdges.map((branchEdge) => branchEdge.target), id],
      });
      commitState({
        ...current,
        nodes: next.nodes,
        edges: next.edges,
      });
      const centeredNode = next.nodes.find((item) => item.id === id) ?? node;
      window.setTimeout(() => {
        void rf.setCenter(centeredNode.position.x + width / 2, centeredNode.position.y + 90, {
          zoom: Math.min(rf.getZoom(), 1.2),
          duration: 280,
        });
      }, 0);
    },
    [commitState, rf],
  );

  const addStandaloneNote = useCallback(() => {
    const current = stateRef.current;
    const center = rf.screenToFlowPosition({
      x: window.innerWidth / 2,
      y: window.innerHeight / 2,
    });
    const desiredPosition = { x: center.x - 130, y: center.y - 90 };
    const position = findOpenPosition(current.nodes, desiredPosition);
    const node: IdeaFlowNode = {
      id: crypto.randomUUID(),
      type: "ideaNode",
      position: { x: Math.round(position.x), y: Math.round(position.y) },
      data: {
        title: "",
        body: "",
        kind: "idea",
        width: IDEA_NODE_DEFAULT_WIDTH,
        autoFocus: true,
      },
      selected: true,
    };
    commitState({
      ...current,
      nodes: [...current.nodes.map((item) => ({ ...item, selected: false })), node],
    });
    window.setTimeout(() => {
      void rf.setCenter(node.position.x + 130, node.position.y + 90, {
        zoom: Math.min(rf.getZoom(), 1.2),
        duration: 280,
      });
    }, 0);
  }, [commitState, rf]);

  const addTextBlockAt = useCallback(
    (flowPosition: { x: number; y: number }) => {
      const current = stateRef.current;
      const width = TEXT_NODE_DEFAULT_WIDTH;
      const position = findOpenPosition(
        current.nodes,
        { x: flowPosition.x - width / 2, y: flowPosition.y - 36 },
        width,
      );
      const node: IdeaFlowNode = {
        id: crypto.randomUUID(),
        type: "textNode",
        position: { x: Math.round(position.x), y: Math.round(position.y) },
        data: {
          title: "",
          body: "",
          kind: "idea",
          width,
          textSize: "small",
          autoFocus: true,
        },
        selected: true,
      };
      commitState({
        ...current,
        nodes: [...current.nodes.map((item) => ({ ...item, selected: false })), node],
      });
    },
    [commitState],
  );

  const addTextBlock = useCallback(() => {
    const center =
      lastPointerFlowRef.current ??
      rf.screenToFlowPosition({
        x: window.innerWidth / 2,
        y: window.innerHeight / 2,
      });
    addTextBlockAt(center);
  }, [addTextBlockAt, rf]);

  const addImageBlockAt = useCallback(
    (src: string, flowPosition?: { x: number; y: number }) => {
      const current = stateRef.current;
      const width = 360;
      const height = 240;
      const center =
        flowPosition ??
        rf.screenToFlowPosition({
          x: window.innerWidth / 2,
          y: window.innerHeight / 2,
        });
      const position = findOpenPosition(
        current.nodes,
        { x: center.x - width / 2, y: center.y - height / 2 },
        width,
      );
      const node: IdeaFlowNode = {
        id: crypto.randomUUID(),
        type: "imageNode",
        position: { x: Math.round(position.x), y: Math.round(position.y) },
        data: {
          title: "Pasted image",
          body: src,
          kind: "idea",
          width,
          height,
        },
        selected: true,
      };
      commitState({
        ...current,
        nodes: [...current.nodes.map((item) => ({ ...item, selected: false })), node],
      });
    },
    [commitState, rf],
  );

  const renderNodes = useMemo(
    () => {
      const selectedId = state.nodes.find((node) => node.selected)?.id;
      const fallbackActiveId = state.nodes.at(-1)?.id;
      const activeWritingId = aiWriting ? selectedId ?? fallbackActiveId : null;
      return state.nodes.map((node) => {
        const activeWriting = node.id === activeWritingId;
        const savedIdeaWidth = Number(node.data.width ?? IDEA_NODE_DEFAULT_WIDTH);
        return {
          ...node,
          type:
            node.type === "textNode"
              ? "textNode"
              : node.type === "imageNode"
                ? "imageNode"
                : "ideaNode",
          dragHandle: ".note-drag-handle",
          style: {
            width:
              node.type === "textNode"
                ? (node.data.width ?? TEXT_NODE_DEFAULT_WIDTH)
                : node.type === "imageNode"
                  ? (node.data.width ?? 360)
                  : Math.max(savedIdeaWidth, IDEA_NODE_DEFAULT_WIDTH),
            height: node.type === "imageNode" ? (node.data.height ?? 240) : "auto",
          },
          data: {
            ...node.data,
            onChange: updateNodeData,
            onQuickAdd: node.type === "textNode" ? undefined : createConnectedNode,
            onSelect: selectNode,
            onInlineDictationKeyDown: onInlineKeyDown,
            onInlineDictationKeyUp: onInlineKeyUp,
            activeWriting,
          },
        };
      });
    },
    [aiWriting, createConnectedNode, onInlineKeyDown, onInlineKeyUp, selectNode, state.nodes, updateNodeData],
  );

  const renderEdges = useMemo(() => {
    const nodeById = new Map(state.nodes.map((node) => [node.id, node] as const));
    const grouped = new Map<string, typeof state.edges>();

    for (const edge of state.edges) {
      const key = `${edge.source}:${edge.sourceHandle ?? ""}:${edge.targetHandle ?? ""}`;
      grouped.set(key, [...(grouped.get(key) ?? []), edge]);
    }

    const autoOffsets = new Map<string, number>();
    for (const group of grouped.values()) {
      if (group.length < 2) continue;
      const sorted = [...group].sort((a, b) => {
        const aTarget = nodeById.get(a.target);
        const bTarget = nodeById.get(b.target);
        const aCenter = (aTarget?.position.y ?? 0) + Number(aTarget?.data.height ?? 178) / 2;
        const bCenter = (bTarget?.position.y ?? 0) + Number(bTarget?.data.height ?? 178) / 2;
        return aCenter - bCenter;
      });
      sorted.forEach((edge, index) => {
        const centeredIndex = index - (sorted.length - 1) / 2;
        const offset = Math.max(-84, Math.min(84, centeredIndex * 28));
        autoOffsets.set(edge.id, offset);
      });
    }

    return state.edges.map((edge) => ({
      ...edge,
      type: "editable",
      data: {
        ...edge.data,
        autoRouteOffset: autoOffsets.get(edge.id) ?? 0,
      },
    }));
  }, [state.edges, state.nodes]);

  const onNodesChange = useCallback(
    (changes: NodeChange<IdeaFlowNode>[]) => {
      const current = stateRef.current;
      const changedNodes = applyNodeChanges(changes, current.nodes);
      const sizes = new Map<string, { width?: number; height?: number }>();
      for (const change of changes) {
        if (change.type === "dimensions" && change.dimensions) {
          sizes.set(change.id, {
            width: change.dimensions.width,
            height: change.dimensions.height,
          });
        }
      }
      const nodes = changedNodes.map((node) => {
        const size = sizes.get(node.id);
        if (!size?.width) return node;
        return {
          ...node,
          data: {
            ...node.data,
            width: Math.round(size.width),
            height:
              node.type === "imageNode" && size.height ? Math.round(size.height) : node.data.height,
          },
        };
      });
      const next = sizes.size > 0 ? reflowParallelBranches(nodes, current.edges) : { nodes, edges: current.edges };
      commitState({ ...current, nodes: next.nodes, edges: next.edges });
    },
    [commitState],
  );

  const onEdgesChange = useCallback(
    (changes: EdgeChange[]) => {
      const current = stateRef.current;
      commitState({ ...current, edges: applyEdgeChanges(changes, current.edges) });
    },
    [commitState],
  );

  const onConnect = useCallback(
    (connection: Connection) => {
      const current = stateRef.current;
      commitState({
        ...current,
        edges: addEdge(
          {
            ...connection,
            id: crypto.randomUUID(),
            type: "editable",
          },
          current.edges,
        ),
      });
    },
    [commitState],
  );

  const onConnectEnd = useCallback(
    (event: MouseEvent | TouchEvent, connectionState: FinalConnectionState) => {
      if (
        connectionState.isValid ||
        connectionState.toNode ||
        !connectionState.fromNode ||
        !connectionState.fromPosition
      ) {
        return;
      }
      const pointer =
        "changedTouches" in event && event.changedTouches.length
          ? event.changedTouches[0]
          : (event as MouseEvent);
      const position = rf.screenToFlowPosition({
        x: pointer.clientX,
        y: pointer.clientY,
      });
      createConnectedNode(
        connectionState.fromNode.id,
        connectionState.fromPosition as Side,
        position,
      );
    },
    [createConnectedNode, rf],
  );

  const onSelectionChange = useCallback(({ nodes }: { nodes: IdeaFlowNode[] }) => {
    setSelectedNodes(nodes);
    if (nodes.length === 0) setAskOpen(false);
  }, []);
  useOnSelectionChange({ onChange: onSelectionChange });

  const toolbarPos = useMemo(() => {
    if (selectedNodes.length === 0) return null;
    const bounds = getNodesBounds(selectedNodes);
    return {
      left: bounds.centerX * viewport.zoom + viewport.x,
      top: bounds.top * viewport.zoom + viewport.y - 84,
    };
  }, [selectedNodes, viewport.x, viewport.y, viewport.zoom]);

  const openAsk = useCallback(() => {
    if (selectedNodes.length === 0 || actionBusy) return;
    setAskDraft("");
    setAskOpen(true);
  }, [actionBusy, selectedNodes.length]);

  const doAsk = useCallback(async () => {
    if (selectedNodes.length === 0 || actionBusy) return;
    const question = askDraft.trim();
    if (!question) return;
    setActionBusy(true);
    setAskOpen(false);
    const selected = selectedNodes.slice(0, 12);
    try {
      const result = await askFn({
        data: {
          question: question.trim(),
          cards: selected.map((node) => ({ title: node.data.title, body: node.data.body ?? "" })),
        },
      });
      const bounds = getNodesBounds(selected);
      const id = crypto.randomUUID();
      const width = 320;
      const node: IdeaFlowNode = {
        id,
        type: "ideaNode",
        position: {
          x: Math.round(bounds.centerX - width / 2),
          y: Math.round(bounds.bottom + 110),
        },
        selected: true,
        data: {
          title: result.title,
          body: result.body,
          kind: result.kind,
          width,
        },
      };
      const current = stateRef.current;
      commitState({
        ...current,
        nodes: [...current.nodes.map((item) => ({ ...item, selected: false })), node],
        edges: [
          ...current.edges,
          ...selected.map((source) => ({
            id: crypto.randomUUID(),
            source: source.id,
            target: id,
            sourceHandle: "bottom",
            targetHandle: "top",
            type: "editable" as const,
            label: normalizeCanvasEdgeLabel(result.relation) || "ANSWERS",
          })),
        ],
      });
    } finally {
      setActionBusy(false);
    }
  }, [actionBusy, askDraft, askFn, commitState, selectedNodes]);

  const submitAsk = useCallback(
    (event: FormEvent<HTMLFormElement>) => {
      event.preventDefault();
      void doAsk();
    },
    [doAsk],
  );

  const doMerge = useCallback(async () => {
    if (selectedNodes.length !== 2 || actionBusy) return;
    setAskOpen(false);
    setActionBusy(true);
    const [a, b] = selectedNodes;
    try {
      const result = await mergeFn({
        data: {
          a: { title: a.data.title, body: a.data.body ?? "" },
          b: { title: b.data.title, body: b.data.body ?? "" },
        },
      });
      const id = crypto.randomUUID();
      const bounds = getNodesBounds([a, b]);
      const node: IdeaFlowNode = {
        id,
        type: "ideaNode",
        position: {
          x: Math.round(bounds.centerX - 140),
          y: Math.round(bounds.bottom + 110),
        },
        data: {
          title: result.title,
          body: result.body,
          kind: result.kind,
          width: 280,
        },
      };
      const current = stateRef.current;
      const sharedEdge = {
        type: "editable" as const,
        label: normalizeCanvasEdgeLabel(result.relation) || undefined,
      };
      commitState({
        ...current,
        nodes: [...current.nodes, node],
        edges: [
          ...current.edges,
          {
            id: crypto.randomUUID(),
            source: a.id,
            target: id,
            sourceHandle: "bottom",
            targetHandle: "top",
            ...sharedEdge,
          },
          {
            id: crypto.randomUUID(),
            source: b.id,
            target: id,
            sourceHandle: "bottom",
            targetHandle: "top",
            ...sharedEdge,
          },
        ],
      });
    } finally {
      setActionBusy(false);
    }
  }, [actionBusy, commitState, mergeFn, selectedNodes]);

  useEffect(() => {
    const isTypingTarget = (target: EventTarget | null) => {
      const element = target as HTMLElement | null;
      if (!element) return false;
      return (
        element.tagName === "INPUT" || element.tagName === "TEXTAREA" || element.isContentEditable
      );
    };
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape" && askOpen) {
        event.preventDefault();
        event.stopPropagation();
        setAskOpen(false);
        return;
      }
      if (isTypingTarget(event.target)) return;
      if (
        event.key.toLowerCase() === "t" &&
        !event.metaKey &&
        !event.ctrlKey &&
        !event.altKey &&
        !event.repeat
      ) {
        event.preventDefault();
        event.stopPropagation();
        addTextBlock();
        return;
      }
      if (event.key === "Escape" && mode === "fullscreen") {
        onExit();
      }
    };
    window.addEventListener("keydown", onKeyDown, true);
    return () => window.removeEventListener("keydown", onKeyDown, true);
  }, [addTextBlock, askOpen, mode, onExit]);

  useEffect(() => {
    const isTypingTarget = (target: EventTarget | null) => {
      const element = target as HTMLElement | null;
      if (!element) return false;
      return (
        element.tagName === "INPUT" || element.tagName === "TEXTAREA" || element.isContentEditable
      );
    };
    const onPaste = (event: ClipboardEvent) => {
      if (isTypingTarget(event.target)) return;
      const items = Array.from(event.clipboardData?.items ?? []);
      const imageItem = items.find((item) => item.type.startsWith("image/"));
      const file = imageItem?.getAsFile();
      if (!file) return;
      event.preventDefault();
      if (file.size > MAX_PASTED_IMAGE_BYTES) {
        console.warn("[canvas] pasted image is too large for local canvas storage");
        return;
      }
      void fileToDataUrl(file)
        .then((src) => addImageBlockAt(src))
        .catch((error) => console.warn("[canvas] paste image failed", error));
    };
    window.addEventListener("paste", onPaste);
    return () => window.removeEventListener("paste", onPaste);
  }, [addImageBlockAt]);

  const handleImageDrop = useCallback(
    (event: ReactDragEvent<HTMLDivElement>) => {
      const file = Array.from(event.dataTransfer.files).find((item) =>
        item.type.startsWith("image/"),
      );
      if (!file) return;
      event.preventDefault();
      if (file.size > MAX_PASTED_IMAGE_BYTES) {
        console.warn("[canvas] dropped image is too large for local canvas storage");
        return;
      }
      const position = rf.screenToFlowPosition({ x: event.clientX, y: event.clientY });
      void fileToDataUrl(file)
        .then((src) => addImageBlockAt(src, position))
        .catch((error) => console.warn("[canvas] drop image failed", error));
    },
    [addImageBlockAt, rf],
  );

  return (
    <div
      className={
        mode === "fullscreen"
          ? "fixed inset-0 z-50 bg-[#fbfaf7]"
          : "absolute inset-0 overflow-hidden bg-[#fbfaf7]"
      }
      onDoubleClick={(event) => {
        const target = event.target as HTMLElement | null;
        if (
          target?.closest(".react-flow__node, .react-flow__edge, input, textarea, button, select")
        ) {
          return;
        }
        const position = rf.screenToFlowPosition({
          x: event.clientX,
          y: event.clientY,
        });
        lastPointerFlowRef.current = position;
        addTextBlockAt(position);
      }}
      onDragOver={(event) => {
        if (Array.from(event.dataTransfer.items).some((item) => item.type.startsWith("image/"))) {
          event.preventDefault();
        }
      }}
      onDrop={handleImageDrop}
    >
      <ReactFlow
        nodes={renderNodes}
        edges={renderEdges}
        nodeTypes={nodeTypes}
        edgeTypes={edgeTypes}
        onNodesChange={onNodesChange}
        onEdgesChange={onEdgesChange}
        onConnect={onConnect}
        onConnectEnd={onConnectEnd}
        onPaneMouseMove={(event) => {
          lastPointerFlowRef.current = rf.screenToFlowPosition({
            x: event.clientX,
            y: event.clientY,
          });
        }}
        onPaneClick={(event) => {
          const position = rf.screenToFlowPosition({
            x: event.clientX,
            y: event.clientY,
          });
          lastPointerFlowRef.current = position;
          onCanvasPointSelect?.({
            x: Math.round(position.x),
            y: Math.round(position.y),
          });
        }}
        connectionMode={ConnectionMode.Loose}
        fitView
        fitViewOptions={{ padding: 0.18 }}
        minZoom={0.35}
        maxZoom={2}
        panOnScroll
        selectionOnDrag
        panOnDrag={[1, 2]}
        selectionKeyCode={null}
        multiSelectionKeyCode={["Meta", "Shift"]}
        proOptions={{ hideAttribution: true }}
      >
        <Background gap={22} color="#deddd9" />
        <MiniMap
          pannable
          zoomable
          nodeStrokeWidth={2}
          maskColor="rgba(251, 250, 247, 0.72)"
          className="!rounded-md !border !border-black/8 !bg-white/85"
        />
        {captureAnchor && (
          <ViewportPortal>
            <div
              className="pointer-events-none absolute flex -translate-x-1/2 -translate-y-1/2 flex-col items-center gap-2"
              style={{
                transform: `translate(${captureAnchor.x}px, ${captureAnchor.y}px) translate(-50%, -50%)`,
              }}
            >
              <span
                className={`h-3 w-3 rounded-full border-2 border-white bg-[#168cf5] shadow-md ${
                  captureActive ? "animate-pulse" : ""
                }`}
              />
              <span className="whitespace-nowrap rounded bg-white/95 px-2 py-1 text-[11px] font-medium text-secondary shadow-sm">
                {captureActive
                  ? "Listening... press Cmd/Ctrl+Shift+Space again to structure"
                  : "AI structure will start here"}
              </span>
            </div>
          </ViewportPortal>
        )}
      </ReactFlow>

      {!hasCanvasContent && !captureAnchor && (
        <div className="pointer-events-none absolute left-1/2 top-[34%] z-10 flex w-[410px] max-w-[calc(100vw-40px)] -translate-x-1/2 -translate-y-1/2 flex-col items-center text-center">
          <div className="h-10 w-10 rounded-full bg-gradient-to-tr from-rose-300 via-indigo-200 to-emerald-200" />
          <div
            className="mt-5 text-[28px] leading-[1.08] text-primary"
            style={{ fontFamily: '"Instrument Serif", Georgia, serif' }}
          >
            A canvas that lets your ideas grow.
          </div>
          <div className="mt-3 text-[14px] leading-snug text-secondary">
            Press Cmd/Ctrl+Shift+Space to start or stop thinking out loud, or talk with the agent
            directly.
          </div>
        </div>
      )}

      {toolbarPos && selectedNodes.length > 0 && (
        <div
          className="absolute z-30 flex -translate-x-1/2 items-center gap-1 rounded-md border border-auralis bg-white px-1.5 py-1 shadow-md"
          style={{ left: toolbarPos.left, top: toolbarPos.top }}
        >
          <button
            type="button"
            onClick={openAsk}
            disabled={actionBusy}
            className="flex h-8 items-center gap-1.5 rounded px-2.5 text-xs font-medium text-primary hover:bg-surface-variant disabled:opacity-40"
            title="Ask about selected card(s)"
          >
            {actionBusy ? (
              <LoaderCircle size={15} className="animate-spin" />
            ) : (
              <MessageCircle size={15} />
            )}
            Ask
          </button>
          {selectedNodes.length === 2 && <span className="h-5 w-px bg-auralis" />}
          <button
            type="button"
            onClick={doMerge}
            disabled={actionBusy || selectedNodes.length !== 2}
            className={`flex h-8 items-center gap-1.5 rounded px-2.5 text-xs font-medium text-primary hover:bg-surface-variant disabled:opacity-40 ${
              selectedNodes.length === 2 ? "" : "hidden"
            }`}
            title="Merge into a new idea"
          >
            {actionBusy ? <LoaderCircle size={15} className="animate-spin" /> : <Merge size={15} />}
            Merge
          </button>
        </div>
      )}

      {toolbarPos && askOpen && selectedNodes.length > 0 && (
        <form
          onSubmit={submitAsk}
          onKeyDown={(event) => {
            if (event.key === "Escape") {
              event.preventDefault();
              setAskOpen(false);
            }
          }}
          className="absolute z-40 flex w-[360px] -translate-x-1/2 flex-col gap-2 rounded-xl border border-auralis bg-white p-3 shadow-[0_16px_40px_rgba(20,24,31,0.16)]"
          style={{ left: toolbarPos.left, top: toolbarPos.top + 44 }}
          aria-label="Ask selected cards"
        >
          <label className="text-[11px] font-semibold uppercase tracking-[0.14em] text-secondary">
            Ask selected cards
          </label>
          <textarea
            autoFocus
            value={askDraft}
            onChange={(event) => setAskDraft(event.target.value)}
            rows={3}
            placeholder="For example: What do these cards point to? What is the biggest risk?"
            className="min-h-[76px] resize-none rounded-lg border border-black/10 bg-[#fbfaf7] px-3 py-2 text-sm text-primary outline-none transition focus:border-[#168cf5] focus:bg-white focus:ring-2 focus:ring-[#168cf5]/15"
          />
          <div className="flex items-center justify-end gap-2">
            <button
              type="button"
              onClick={() => setAskOpen(false)}
              className="rounded-md px-3 py-1.5 text-xs font-medium text-secondary hover:bg-surface-variant hover:text-primary"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={actionBusy || !askDraft.trim()}
              className="flex items-center gap-1.5 rounded-md bg-primary px-3 py-1.5 text-xs font-semibold text-on-primary disabled:opacity-40"
            >
              {actionBusy && <LoaderCircle size={14} className="animate-spin" />}
              Ask
            </button>
          </div>
        </form>
      )}

      {toolbarPos && selectedNodes.length === 1 && selectedNodes[0].type === "textNode" && (
        <div
          className="absolute z-30 flex -translate-x-1/2 items-center gap-1 rounded-md border border-auralis bg-white p-1 shadow-md"
          style={{ left: toolbarPos.left, top: toolbarPos.top - 42 }}
          aria-label="Text formatting"
        >
          <select
            value={selectedNodes[0].data.textSize ?? "normal"}
            onChange={(event) =>
              updateNodeData(selectedNodes[0].id, {
                textSize: event.target.value as "small" | "normal" | "large",
              })
            }
            className="h-8 rounded border-0 bg-transparent px-2 text-xs text-primary outline-none hover:bg-surface-variant"
            aria-label="Text size"
            title="Text size"
          >
            <option value="small">Small</option>
            <option value="normal">Normal</option>
            <option value="large">Large</option>
          </select>
          <span className="mx-0.5 h-5 w-px bg-auralis" />
          <button
            type="button"
            onClick={() =>
              updateNodeData(selectedNodes[0].id, {
                bold: !selectedNodes[0].data.bold,
              })
            }
            className={`flex h-8 w-8 items-center justify-center rounded ${
              selectedNodes[0].data.bold ? "bg-primary text-on-primary" : "hover:bg-surface-variant"
            }`}
            title="Bold"
            aria-label="Bold"
            aria-pressed={!!selectedNodes[0].data.bold}
          >
            <Bold size={15} />
          </button>
          <button
            type="button"
            onClick={() =>
              updateNodeData(selectedNodes[0].id, {
                italic: !selectedNodes[0].data.italic,
              })
            }
            className={`flex h-8 w-8 items-center justify-center rounded ${
              selectedNodes[0].data.italic
                ? "bg-primary text-on-primary"
                : "hover:bg-surface-variant"
            }`}
            title="Italic"
            aria-label="Italic"
            aria-pressed={!!selectedNodes[0].data.italic}
          >
            <Italic size={15} />
          </button>
          <span className="mx-0.5 h-5 w-px bg-auralis" />
          {[
            { value: "left" as const, label: "Align left", icon: AlignLeft },
            { value: "center" as const, label: "Align center", icon: AlignCenter },
            { value: "right" as const, label: "Align right", icon: AlignRight },
          ].map(({ value, label, icon: Icon }) => (
            <button
              key={value}
              type="button"
              onClick={() => updateNodeData(selectedNodes[0].id, { textAlign: value })}
              className={`flex h-8 w-8 items-center justify-center rounded ${
                (selectedNodes[0].data.textAlign ?? "left") === value
                  ? "bg-surface-variant text-primary"
                  : "text-secondary hover:bg-surface-variant hover:text-primary"
              }`}
              title={label}
              aria-label={label}
              aria-pressed={(selectedNodes[0].data.textAlign ?? "left") === value}
            >
              <Icon size={15} />
            </button>
          ))}
        </div>
      )}

      {mode === "fullscreen" ? (
        <button
          type="button"
          onClick={onExit}
          className="absolute right-4 top-4 z-20 flex h-9 w-9 items-center justify-center rounded-full border border-auralis bg-white text-primary shadow-sm hover:bg-surface-variant"
          title="Exit fullscreen (Esc)"
          aria-label="Exit fullscreen"
        >
          <Shrink size={17} />
        </button>
      ) : (
        <button
          type="button"
          onClick={onEnterFullscreen}
          className="absolute right-4 top-4 z-20 flex h-9 w-9 items-center justify-center rounded-full border border-auralis bg-white text-primary shadow-sm hover:bg-surface-variant"
          title="Open fullscreen canvas"
          aria-label="Open fullscreen canvas"
        >
          <Scan size={17} />
        </button>
      )}

      <div className="absolute bottom-6 left-6 z-20 flex items-center gap-0.5 rounded-md border border-black/10 bg-white/95 p-1 shadow-sm backdrop-blur-md">
        <button
          type="button"
          onClick={() => void rf.zoomOut({ duration: 180 })}
          className="flex h-8 w-8 items-center justify-center rounded text-primary hover:bg-surface-variant"
          title="Zoom out"
          aria-label="Zoom out"
        >
          <ZoomOut size={17} />
        </button>
        <button
          type="button"
          onClick={() => void rf.zoomIn({ duration: 180 })}
          className="flex h-8 w-8 items-center justify-center rounded text-primary hover:bg-surface-variant"
          title="Zoom in"
          aria-label="Zoom in"
        >
          <ZoomIn size={17} />
        </button>
        <button
          type="button"
          onClick={() => void rf.fitView({ padding: 0.18, duration: 220 })}
          className="flex h-8 w-8 items-center justify-center rounded text-secondary hover:bg-surface-variant hover:text-primary"
          title="Fit canvas"
          aria-label="Fit canvas"
        >
          <Scan size={16} />
        </button>
      </div>

      <div className="absolute bottom-6 left-1/2 z-20 flex -translate-x-1/2 items-center gap-1 rounded-md border border-black/10 bg-white/95 p-1.5 shadow-[0_12px_34px_rgba(20,24,31,0.15)] backdrop-blur-md">
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
          onMouseDown={(event) => event.preventDefault()}
          onClick={addTextBlock}
          className="flex h-9 w-9 items-center justify-center rounded text-primary hover:bg-surface-variant"
          title="Write freely"
          aria-label="Write freely"
        >
          <Type size={18} />
        </button>
        <button
          type="button"
          onMouseDown={(event) => event.preventDefault()}
          onClick={addStandaloneNote}
          className="flex h-9 w-9 items-center justify-center rounded text-primary hover:bg-surface-variant"
          title="Create structured card"
          aria-label="Create structured card"
        >
          <StickyNote size={18} />
        </button>
      </div>

      {showAgentDock && (
        <div className="absolute bottom-6 right-6 z-20">
          <AgentDock
            status={agentStatus}
            listening={listening}
            level={level}
            partial={partial}
            aiWriting={aiWriting}
            insight={insight}
            disabled={captureActive}
            collapsed={agentDockCollapsed}
            onToggleListening={onToggleListening}
            onPromptAgent={onPromptAgent}
            onToggleDock={onToggleAgentDock}
            onExpandPanel={onExpandAudio}
          />
        </div>
      )}
    </div>
  );
}

export function ThinkingBoard(props: CanvasProps) {
  return (
    <ReactFlowProvider>
      <BoardInner {...props} />
    </ReactFlowProvider>
  );
}

export function FullscreenBoard(props: CanvasProps) {
  return <ThinkingBoard {...props} mode="fullscreen" />;
}
