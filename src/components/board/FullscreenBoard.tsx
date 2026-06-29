import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type FormEvent,
  type KeyboardEvent as ReactKeyboardEvent,
} from "react";
import {
  Background,
  BaseEdge,
  ConnectionMode,
  EdgeLabelRenderer,
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

type Side = "top" | "right" | "bottom" | "left";

type EditableEdgeData = {
  onLabelChange?: (id: string, label: string) => void;
  routeOffset?: number;
};

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

const OPPOSITE_SIDE: Record<Side, Side> = {
  top: "bottom",
  right: "left",
  bottom: "top",
  left: "right",
};

const QUICK_ADD_POSITION: Record<Side, string> = {
  top: "left-1/2 top-0 -translate-x-1/2 -translate-y-[34px]",
  right: "right-0 top-1/2 translate-x-[34px] -translate-y-1/2",
  bottom: "bottom-0 left-1/2 -translate-x-1/2 translate-y-[34px]",
  left: "left-0 top-1/2 -translate-x-[34px] -translate-y-1/2",
};

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

function roundedOrthogonalPath(points: Array<{ x: number; y: number }>, radius = 18) {
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
}: {
  sourceX: number;
  sourceY: number;
  targetX: number;
  targetY: number;
  sourcePosition: Position;
  targetPosition: Position;
  routeOffset?: number;
}) {
  const sourceVertical = sourcePosition === Position.Top || sourcePosition === Position.Bottom;
  const targetVertical = targetPosition === Position.Top || targetPosition === Position.Bottom;
  const sourceDir =
    sourcePosition === Position.Left
      ? { x: -1, y: 0 }
      : sourcePosition === Position.Right
        ? { x: 1, y: 0 }
        : sourcePosition === Position.Top
          ? { x: 0, y: -1 }
          : { x: 0, y: 1 };
  const targetDir =
    targetPosition === Position.Left
      ? { x: -1, y: 0 }
      : targetPosition === Position.Right
        ? { x: 1, y: 0 }
        : targetPosition === Position.Top
          ? { x: 0, y: -1 }
          : { x: 0, y: 1 };
  const stem = 42;
  const sourceStem = { x: sourceX + sourceDir.x * stem, y: sourceY + sourceDir.y * stem };
  const targetStem = { x: targetX + targetDir.x * stem, y: targetY + targetDir.y * stem };

  let points: Array<{ x: number; y: number }>;
  let handle: { x: number; y: number; cursor: "ew-resize" | "ns-resize" };

  if (sourceVertical && targetVertical) {
    const busY = (sourceStem.y + targetStem.y) / 2 + routeOffset;
    points = [
      { x: sourceX, y: sourceY },
      sourceStem,
      { x: sourceStem.x, y: busY },
      { x: targetStem.x, y: busY },
      targetStem,
      { x: targetX, y: targetY },
    ];
    handle = { x: (sourceStem.x + targetStem.x) / 2, y: busY, cursor: "ns-resize" };
  } else if (!sourceVertical && !targetVertical) {
    const busX = (sourceStem.x + targetStem.x) / 2 + routeOffset;
    points = [
      { x: sourceX, y: sourceY },
      sourceStem,
      { x: busX, y: sourceStem.y },
      { x: busX, y: targetStem.y },
      targetStem,
      { x: targetX, y: targetY },
    ];
    handle = { x: busX, y: (sourceStem.y + targetStem.y) / 2, cursor: "ew-resize" };
  } else {
    const corner = sourceVertical
      ? { x: sourceStem.x, y: targetStem.y + routeOffset }
      : { x: targetStem.x + routeOffset, y: sourceStem.y };
    points = [
      { x: sourceX, y: sourceY },
      sourceStem,
      corner,
      targetStem,
      { x: targetX, y: targetY },
    ];
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
  const taRef = useRef<HTMLTextAreaElement>(null);
  const [hovered, setHovered] = useState(false);
  const text = data.body ? `${data.title}\n${data.body}` : data.title;
  const showConnections = hovered || selected;
  const dictationCaret = data.dictationCaret;
  const onChange = data.onChange;

  useEffect(() => {
    const ta = taRef.current;
    if (!ta) return;
    ta.style.height = "auto";
    ta.style.height = `${Math.max(112, ta.scrollHeight)}px`;
  }, [text, data.width]);

  useEffect(() => {
    if (!data.autoFocus) return;
    const timer = window.setTimeout(() => {
      const ta = taRef.current;
      ta?.focus();
      ta?.setSelectionRange(ta.value.length, ta.value.length);
    }, 380);
    return () => window.clearTimeout(timer);
  }, [data.autoFocus]);

  useEffect(() => {
    if (typeof dictationCaret !== "number") return;
    const timer = window.setTimeout(() => {
      const ta = taRef.current;
      if (!ta) return;
      const caret = Math.min(dictationCaret, ta.value.length);
      ta.focus();
      ta.setSelectionRange(caret, caret);
      onChange?.(id, { dictationCaret: undefined });
    }, 0);
    return () => window.clearTimeout(timer);
  }, [dictationCaret, id, onChange]);

  return (
    <div
      className="group/note relative"
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
    >
      {selected && (
        <>
          <NodeResizeControl
            position="left"
            variant={ResizeControlVariant.Line}
            resizeDirection="horizontal"
            minWidth={190}
            maxWidth={560}
            color="#168cf5"
          />
          <NodeResizeControl
            position="right"
            variant={ResizeControlVariant.Line}
            resizeDirection="horizontal"
            minWidth={190}
            maxWidth={560}
            color="#168cf5"
          />
        </>
      )}

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
        className={`relative flex min-h-[178px] w-full flex-col overflow-visible border transition-shadow ${
          selected
            ? "shadow-[0_10px_24px_rgba(20,24,31,0.16)]"
            : "shadow-[0_7px_18px_rgba(20,24,31,0.1)] hover:shadow-[0_10px_24px_rgba(20,24,31,0.14)]"
        }`}
        style={{
          background: style.bg,
          borderColor: selected ? "#168cf5" : style.border,
          borderRadius: 4,
        }}
      >
        <textarea
          ref={taRef}
          onFocus={() => data.onSelect?.(id)}
          onKeyDown={(event) => data.onInlineDictationKeyDown?.(id, event, text)}
          onKeyUp={(event) => data.onInlineDictationKeyUp?.(id, event, text)}
          className="nodrag nowheel w-full resize-none overflow-hidden whitespace-pre-wrap break-words bg-transparent px-5 pb-3 pt-5 text-[15px] font-medium leading-[1.55] outline-none"
          style={{ color: style.titleColor, minHeight: 112 }}
          value={text}
          onChange={(event) => {
            const value = event.target.value;
            const newline = value.indexOf("\n");
            if (newline === -1) data.onChange?.(id, { title: value, body: "" });
            else {
              data.onChange?.(id, {
                title: value.slice(0, newline),
                body: value.slice(newline + 1),
              });
            }
          }}
          placeholder="Type a thought..."
        />
        <div className="mt-auto flex items-center justify-between gap-2 px-4 pb-3 pt-2">
          <select
            className="nodrag min-w-0 cursor-pointer bg-transparent text-[10px] font-semibold uppercase tracking-[0.08em] outline-none"
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
    textarea.style.height = `${Math.max(72, textarea.scrollHeight)}px`;
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
    <div className="group/text relative min-h-[72px]">
      {selected && (
        <>
          <NodeResizeControl
            position="left"
            variant={ResizeControlVariant.Line}
            resizeDirection="horizontal"
            minWidth={220}
            maxWidth={860}
            color="#168cf5"
          />
          <NodeResizeControl
            position="right"
            variant={ResizeControlVariant.Line}
            resizeDirection="horizontal"
            minWidth={220}
            maxWidth={860}
            color="#168cf5"
          />
        </>
      )}
      <div
        className={`relative min-h-[72px] border bg-transparent transition-colors ${
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
            data.onChange?.(
              id,
              newline === -1
                ? { title: value, body: "" }
                : { title: value.slice(0, newline), body: value.slice(newline + 1) },
            );
          }}
          placeholder="Start writing..."
          className="nodrag nowheel block w-full resize-none overflow-hidden whitespace-pre-wrap break-words bg-transparent px-2 py-2 font-sans leading-[1.5] text-primary outline-none placeholder:text-secondary/55"
          style={{
            fontFamily: "Inter, ui-sans-serif, system-ui, sans-serif",
            fontSize: data.textSize === "small" ? 14 : data.textSize === "large" ? 24 : 18,
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
  label,
  selected,
  data,
}: EdgeProps<EditableBoardEdge>) {
  const labelText = typeof label === "string" || typeof label === "number" ? String(label) : "";
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(labelText);
  const inputRef = useRef<HTMLInputElement>(null);
  const route = orthogonalEdgePath({
    sourceX,
    sourceY,
    sourcePosition,
    targetX,
    targetY,
    targetPosition,
    routeOffset: Number(data?.routeOffset ?? 0),
  });

  useEffect(() => setDraft(labelText), [labelText]);
  useEffect(() => {
    if (!editing) return;
    inputRef.current?.focus();
    inputRef.current?.select();
  }, [editing]);

  const commit = () => {
    data?.onLabelChange?.(id, draft.trim());
    setEditing(false);
  };

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
        className="cursor-text"
        style={{ pointerEvents: "stroke" }}
        onDoubleClick={(event) => {
          event.stopPropagation();
          setEditing(true);
        }}
      />
      <EdgeLabelRenderer>
        <div
          className="nodrag nopan absolute"
          style={{
            transform: `translate(-50%, -50%) translate(${route.labelX}px, ${route.labelY}px)`,
            pointerEvents: "all",
          }}
        >
          {editing ? (
            <input
              ref={inputRef}
              value={draft}
              onChange={(event) => setDraft(event.target.value)}
              onBlur={commit}
              onKeyDown={(event) => {
                if (event.key === "Enter") {
                  event.preventDefault();
                  commit();
                } else if (event.key === "Escape") {
                  setDraft(labelText);
                  setEditing(false);
                }
              }}
              className="h-7 w-36 rounded border border-[#168cf5] bg-white px-2 text-[11px] text-primary shadow-sm outline-none"
              aria-label="Relationship label"
            />
          ) : labelText ? (
            <button
              type="button"
              onDoubleClick={() => setEditing(true)}
              className="max-w-44 rounded bg-[#fbfaf7]/92 px-1.5 py-0.5 text-[10px] font-medium text-secondary shadow-sm"
              title="Double-click to edit relationship"
            >
              {labelText}
            </button>
          ) : selected ? (
            <button
              type="button"
              onDoubleClick={() => setEditing(true)}
              className="rounded border border-dashed border-[#168cf5]/60 bg-white/90 px-1.5 py-0.5 text-[10px] text-[#168cf5]"
              title="Double-click to add relationship text"
            >
              Add relation
            </button>
          ) : (
            <button
              type="button"
              onDoubleClick={() => setEditing(true)}
              className="flex h-6 w-6 items-center justify-center rounded-full border border-[#168cf5]/50 bg-white text-[#168cf5] opacity-0 shadow-sm transition-opacity hover:opacity-100 focus:opacity-100"
              title="Double-click to add relationship text"
              aria-label="Edit relationship"
            >
              <Plus size={13} />
            </button>
          )}
        </div>
      </EdgeLabelRenderer>
    </>
  );
}

const nodeTypes = { ideaNode: SmartNote, textNode: TextBlock };
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
          | "textSize"
          | "bold"
          | "italic"
          | "textAlign"
          | "dictationCaret"
        >
      >,
    ) => {
      const current = stateRef.current;
      commitState({
        ...current,
        nodes: current.nodes.map((node) =>
          node.id === id ? { ...node, data: { ...node.data, ...patch } } : node,
        ),
      });
    },
    [commitState],
  );

  const updateEdgeLabel = useCallback(
    (id: string, nextLabel: string) => {
      const current = stateRef.current;
      commitState({
        ...current,
        edges: current.edges.map((edge) =>
          edge.id === id ? { ...edge, label: nextLabel || undefined } : edge,
        ),
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
      const isOptionKey =
        event.key === "Alt" || event.code === "AltLeft" || event.code === "AltRight";
      if (!isOptionKey) return;
      if (event.repeat || event.ctrlKey || event.metaKey || event.shiftKey) return;
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
      const isOptionKey =
        event.key === "Alt" || event.code === "AltLeft" || event.code === "AltRight";
      if (!isOptionKey) return;
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

      const sourceWidth = source.data.width ?? source.measured?.width ?? 260;
      const sourceHeight = source.measured?.height ?? 178;
      const width = 260;
      const desiredPosition = dropPosition
        ? { x: dropPosition.x - width / 2, y: dropPosition.y - 80 }
        : side === "right"
          ? { x: source.position.x + sourceWidth + 110, y: source.position.y }
          : side === "left"
            ? { x: source.position.x - width - 110, y: source.position.y }
            : side === "bottom"
              ? { x: source.position.x, y: source.position.y + sourceHeight + 100 }
              : { x: source.position.x, y: source.position.y - 278 };
      const position = findOpenPosition(current.nodes, desiredPosition, width);

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
        sourceHandle: side,
        targetHandle: OPPOSITE_SIDE[side],
        type: "editable",
      };
      commitState({
        ...current,
        nodes: [...current.nodes, node],
        edges: [...current.edges, edge],
      });
      window.setTimeout(() => {
        void rf.setCenter(node.position.x + width / 2, node.position.y + 90, {
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
        width: 260,
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

  const addTextBlock = useCallback(() => {
    const current = stateRef.current;
    const center = rf.screenToFlowPosition({
      x: window.innerWidth / 2,
      y: window.innerHeight / 2,
    });
    const width = 520;
    const position = findOpenPosition(
      current.nodes,
      { x: center.x - width / 2, y: center.y - 70 },
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
        autoFocus: true,
      },
      selected: true,
    };
    commitState({
      ...current,
      nodes: [...current.nodes.map((item) => ({ ...item, selected: false })), node],
    });
  }, [commitState, rf]);

  const renderNodes = useMemo(
    () =>
      state.nodes.map((node) => ({
        ...node,
        type: node.type === "textNode" ? "textNode" : "ideaNode",
        dragHandle: ".note-drag-handle",
        style: {
          width: node.data.width ?? (node.type === "textNode" ? 520 : 260),
          height: "auto" as const,
        },
        data: {
          ...node.data,
          onChange: updateNodeData,
          onQuickAdd: node.type === "textNode" ? undefined : createConnectedNode,
          onSelect: selectNode,
          onInlineDictationKeyDown: onInlineKeyDown,
          onInlineDictationKeyUp: onInlineKeyUp,
        },
      })),
    [createConnectedNode, onInlineKeyDown, onInlineKeyUp, selectNode, state.nodes, updateNodeData],
  );

  const renderEdges = useMemo(
    () =>
      state.edges.map((edge) => ({
        ...edge,
        type: "editable",
        data: {
          ...edge.data,
          onLabelChange: updateEdgeLabel,
        },
      })),
    [state.edges, updateEdgeLabel],
  );

  const onNodesChange = useCallback(
    (changes: NodeChange<IdeaFlowNode>[]) => {
      const current = stateRef.current;
      const changedNodes = applyNodeChanges(changes, current.nodes);
      const widths = new Map<string, number>();
      for (const change of changes) {
        if (change.type === "dimensions" && change.dimensions?.width) {
          widths.set(change.id, change.dimensions.width);
        }
      }
      const nodes = changedNodes.map((node) => {
        const width = widths.get(node.id);
        return width ? { ...node, data: { ...node.data, width: Math.round(width) } } : node;
      });
      commitState({ ...current, nodes });
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
      top: bounds.top * viewport.zoom + viewport.y - 54,
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
            label: result.relation || "answers",
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
        label: result.relation || undefined,
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
      if (event.key === "Escape" && mode === "fullscreen") {
        onExit();
      }
    };
    window.addEventListener("keydown", onKeyDown, true);
    return () => window.removeEventListener("keydown", onKeyDown, true);
  }, [askOpen, mode, onExit]);

  return (
    <div
      className={
        mode === "fullscreen"
          ? "fixed inset-0 z-50 bg-[#fbfaf7]"
          : "absolute inset-0 overflow-hidden bg-[#fbfaf7]"
      }
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
        onPaneClick={(event) => {
          const position = rf.screenToFlowPosition({
            x: event.clientX,
            y: event.clientY,
          });
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
                  ? "Listening... release Space to structure"
                  : "AI structure will start here"}
              </span>
            </div>
          </ViewportPortal>
        )}
      </ReactFlow>

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
          style={{ left: toolbarPos.left, top: toolbarPos.top + 42 }}
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
            placeholder="比如：这几张卡片共同指向什么？最大的风险是什么？"
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
          style={{ left: toolbarPos.left, top: toolbarPos.top + (askOpen ? 172 : 42) }}
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
          title="Create text"
          aria-label="Create text"
        >
          <Type size={18} />
        </button>
        <button
          type="button"
          onMouseDown={(event) => event.preventDefault()}
          onClick={addStandaloneNote}
          className="flex h-9 w-9 items-center justify-center rounded text-primary hover:bg-surface-variant"
          title="Create note"
          aria-label="Create note"
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
