import { useCallback, useMemo } from "react";
import {
  Background,
  Controls,
  Handle,
  MiniMap,
  Position,
  ReactFlow,
  addEdge,
  applyEdgeChanges,
  applyNodeChanges,
  type Connection,
  type Edge,
  type EdgeChange,
  type Node,
  type NodeChange,
  type NodeProps,
} from "@xyflow/react";
import "@xyflow/react/dist/style.css";

import type { MindMapNode } from "@/lib/mindmap/generateMindMap.functions";

export type IdeaNodeKind = "focus" | "idea" | "question" | "decision" | "risk" | "next";

export type IdeaNodeData = {
  title: string;
  body?: string;
  kind: IdeaNodeKind;
  onChange?: (id: string, patch: Partial<Pick<IdeaNodeData, "title" | "body" | "kind">>) => void;
};

export type IdeaFlowNode = Node<IdeaNodeData>;

export type IdeaCanvasState = {
  nodes: IdeaFlowNode[];
  edges: Edge[];
};

type Props = {
  state: IdeaCanvasState;
  sessionTitle?: string;
  loading?: boolean;
  onChange: (next: IdeaCanvasState) => void;
  onGenerateFromBrief?: () => void;
};

const KIND_STYLE: Record<
  IdeaNodeKind,
  { label: string; border: string; bg: string; accent: string }
> = {
  focus: { label: "Focus", border: "#111827", bg: "#fffdf7", accent: "#111827" },
  idea: { label: "Idea", border: "#7c8b73", bg: "#fbfdf8", accent: "#7c8b73" },
  question: { label: "Question", border: "#6f7f99", bg: "#f8fbff", accent: "#6f7f99" },
  decision: { label: "Decision", border: "#9a7c47", bg: "#fffaf0", accent: "#9a7c47" },
  risk: { label: "Risk", border: "#a16b6b", bg: "#fff8f8", accent: "#a16b6b" },
  next: { label: "Next", border: "#5f8775", bg: "#f7fffb", accent: "#5f8775" },
};

const COL_W = 260;
const ROW_H = 118;

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

function IdeaNode({ id, data, selected }: NodeProps<IdeaFlowNode>) {
  const style = KIND_STYLE[data.kind] ?? KIND_STYLE.idea;
  return (
    <div
      className={`w-[220px] rounded-md border bg-white shadow-sm transition-shadow ${
        selected ? "shadow-md ring-2 ring-black/10" : ""
      }`}
      style={{ borderColor: style.border, background: style.bg }}
    >
      <Handle
        type="target"
        position={Position.Left}
        style={{ width: 9, height: 9, background: style.accent, border: "2px solid #fff" }}
      />
      <Handle
        type="source"
        position={Position.Right}
        style={{ width: 9, height: 9, background: style.accent, border: "2px solid #fff" }}
      />
      <div className="flex items-center justify-between gap-2 border-b border-black/10 px-2.5 py-1.5">
        <select
          className="nodrag min-w-0 bg-transparent text-[10px] font-medium uppercase text-secondary focus:outline-none"
          value={data.kind}
          onChange={(e) => data.onChange?.(id, { kind: e.target.value as IdeaNodeKind })}
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
        className="nodrag w-full bg-transparent px-2.5 pt-2 text-sm font-semibold leading-tight text-primary outline-none"
        value={data.title}
        onChange={(e) => data.onChange?.(id, { title: e.target.value })}
        placeholder="Untitled"
      />
      <textarea
        className="nodrag min-h-[58px] w-full resize-none bg-transparent px-2.5 pb-2 pt-1 text-xs leading-relaxed text-secondary outline-none"
        value={data.body ?? ""}
        onChange={(e) => data.onChange?.(id, { body: e.target.value })}
        placeholder="Add detail"
      />
    </div>
  );
}

const nodeTypes = { ideaNode: IdeaNode };

export function treeToIdeaCanvas(
  root: MindMapNode,
  options?: { originX?: number; originY?: number },
): IdeaCanvasState {
  const nodes: IdeaFlowNode[] = [];
  const edges: Edge[] = [];
  const originX = options?.originX ?? 80;
  const originY = options?.originY ?? 120;
  const idMap = new Map<string, string>();
  let leafCursor = 0;

  const mapId = (id: string) => {
    const existing = idMap.get(id);
    if (existing) return existing;
    const mapped = nextId(`map-${id.replace(/[^a-z0-9_-]/gi, "") || "node"}`);
    idMap.set(id, mapped);
    return mapped;
  };

  const walk = (node: MindMapNode, depth: number, parentId: string | null): number => {
    let centerY: number;
    if (!node.children.length) {
      centerY = leafCursor * ROW_H;
      leafCursor += 1;
    } else {
      const childYs = node.children.map((child) => walk(child, depth + 1, mapId(node.id)));
      centerY = (childYs[0] + childYs[childYs.length - 1]) / 2;
    }

    const id = mapId(node.id);
    nodes.push({
      id,
      type: "ideaNode",
      position: { x: originX + depth * COL_W, y: originY + centerY },
      data: {
        title: node.label,
        body: "",
        kind: depth === 0 ? "focus" : depth === 1 ? "idea" : "question",
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
    return centerY;
  };

  walk(root, 0, null);
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
}: Props) {
  const updateNodeData = useCallback(
    (id: string, patch: Partial<Pick<IdeaNodeData, "title" | "body" | "kind">>) => {
      onChange({
        ...state,
        nodes: state.nodes.map((node) =>
          node.id === id ? { ...node, data: { ...node.data, ...patch } } : node,
        ),
      });
    },
    [onChange, state],
  );

  const renderNodes = useMemo(
    () =>
      state.nodes.map((node) => ({
        ...node,
        data: { ...node.data, onChange: updateNodeData },
      })),
    [state.nodes, updateNodeData],
  );

  const onNodesChange = useCallback(
    (changes: NodeChange<IdeaFlowNode>[]) => {
      onChange({ ...state, nodes: applyNodeChanges(changes, state.nodes) });
    },
    [onChange, state],
  );

  const onEdgesChange = useCallback(
    (changes: EdgeChange[]) => {
      onChange({ ...state, edges: applyEdgeChanges(changes, state.edges) });
    },
    [onChange, state],
  );

  const onConnect = useCallback(
    (connection: Connection) => {
      onChange({
        ...state,
        edges: addEdge(
          {
            ...connection,
            type: "smoothstep",
            style: { stroke: "#9ca3af", strokeWidth: 1.2 },
          },
          state.edges,
        ),
      });
    },
    [onChange, state],
  );

  const addNode = useCallback(
    (kind: IdeaNodeKind) => {
      const index = state.nodes.length;
      onChange({
        ...state,
        nodes: [
          ...state.nodes,
          {
            id: nextId(kind),
            type: "ideaNode",
            position: { x: 120 + (index % 3) * 260, y: 120 + Math.floor(index / 3) * 150 },
            data: { title: KIND_STYLE[kind].label, body: "", kind },
          },
        ],
      });
    },
    [onChange, state],
  );

  const exportMap = useCallback(() => {
    const title = safeFilename(sessionTitle ?? "idea-canvas") || "idea-canvas";
    downloadJson(`${title}-map.json`, {
      version: 1,
      exportedAt: new Date().toISOString(),
      title: sessionTitle ?? "Idea Canvas",
      nodes: state.nodes.map((node) => ({
        ...node,
        data: { title: node.data.title, body: node.data.body ?? "", kind: node.data.kind },
      })),
      edges: state.edges,
    });
  }, [sessionTitle, state]);

  return (
    <div className="flex h-full min-h-[640px] flex-col overflow-hidden rounded-md border border-auralis bg-[#fbfaf7]">
      <div className="flex h-11 shrink-0 items-center justify-between gap-3 border-b border-auralis bg-surface px-3">
        <div className="flex items-center gap-1.5">
          <button
            type="button"
            onClick={() => addNode("idea")}
            className="h-7 rounded-md border border-auralis px-2 text-xs text-primary hover:bg-surface-variant"
          >
            Idea
          </button>
          <button
            type="button"
            onClick={() => addNode("question")}
            className="h-7 rounded-md border border-auralis px-2 text-xs text-primary hover:bg-surface-variant"
          >
            Question
          </button>
          <button
            type="button"
            onClick={() => addNode("next")}
            className="h-7 rounded-md border border-auralis px-2 text-xs text-primary hover:bg-surface-variant"
          >
            Next
          </button>
          {onGenerateFromBrief && (
            <button
              type="button"
              onClick={onGenerateFromBrief}
              disabled={loading}
              className="ml-2 h-7 rounded-md border border-auralis bg-surface px-2.5 text-xs font-medium text-primary hover:bg-surface-variant disabled:opacity-40"
            >
              {loading ? "Generating..." : "Generate"}
            </button>
          )}
        </div>
        <button
          type="button"
          onClick={exportMap}
          disabled={state.nodes.length === 0}
          className="h-7 rounded-md border border-auralis bg-surface px-2.5 text-xs font-medium text-primary hover:bg-surface-variant disabled:opacity-40"
        >
          Export JSON
        </button>
      </div>
      <div className="relative min-h-0 flex-1">
        {state.nodes.length === 0 && (
          <div className="pointer-events-none absolute inset-0 z-10 flex items-center justify-center">
            <div className="rounded-md border border-auralis bg-surface px-4 py-3 text-center text-xs text-secondary shadow-sm">
              Select text in Brief, generate from the current brief, or add a node.
            </div>
          </div>
        )}
        <ReactFlow
          nodes={renderNodes}
          edges={state.edges}
          nodeTypes={nodeTypes}
          onNodesChange={onNodesChange}
          onEdgesChange={onEdgesChange}
          onConnect={onConnect}
          fitView
          fitViewOptions={{ padding: 0.2 }}
          proOptions={{ hideAttribution: true }}
          nodesDraggable
          nodesConnectable
        >
          <Background gap={22} color="#e5e4e0" />
          <MiniMap pannable zoomable nodeStrokeWidth={2} />
          <Controls />
        </ReactFlow>
      </div>
    </div>
  );
}
