import { createFileRoute } from "@tanstack/react-router";
import { useCallback, useMemo, useState } from "react";
import {
  Background,
  BackgroundVariant,
  Controls,
  Handle,
  Position,
  ReactFlow,
  type Edge,
  type EdgeProps,
  type Node,
  type NodeProps,
} from "@xyflow/react";
import "@xyflow/react/dist/style.css";

export const Route = createFileRoute("/mindmap-preview")({
  head: () => ({
    meta: [
      { title: "Mind map · reference" },
      {
        name: "description",
        content: "XMind-style radial mind map reference built with React Flow.",
      },
    ],
  }),
  component: MindMapPreview,
});

/* ---------- Data ---------- */

type SubTopic = { label: string; leaves?: string[] };
type Branch = {
  id: string;
  title: string;
  color: string;
  soft: string;
  side: "left" | "right";
  subs: SubTopic[];
};

const CENTER_TITLE = "KitKit";
const CENTER_SUBTITLE = "AI-native product thinking canvas";

const BRANCHES: Branch[] = [
  {
    id: "product",
    title: "产品定义",
    color: "#E86A5C",
    soft: "#FBE4E1",
    side: "right",
    subs: [
      { label: "目标用户", leaves: ["独立开发者", "早期 PM"] },
      { label: "核心价值", leaves: ["思考轨迹", "而非文档"] },
      { label: "痛点验证", leaves: ["访谈 20+"] },
    ],
  },
  {
    id: "interaction",
    title: "核心交互",
    color: "#E8A24A",
    soft: "#FBEBD3",
    side: "right",
    subs: [
      { label: "语音输入", leaves: ["流式 STT"] },
      { label: "选中→导图", leaves: ["单击生成"] },
      { label: "Keep / Undo" },
    ],
  },
  {
    id: "biz",
    title: "商业化",
    color: "#5CBF89",
    soft: "#DFF2E6",
    side: "right",
    subs: [
      { label: "订阅制", leaves: ["Free → Pro"] },
      { label: "按「深度思考」计费" },
    ],
  },
  {
    id: "tech",
    title: "技术",
    color: "#4FB0C8",
    soft: "#DAECF2",
    side: "left",
    subs: [
      { label: "TanStack Start" },
      { label: "AI Gateway", leaves: ["Gemini 3", "GPT-5"] },
      { label: "Realtime STT", leaves: ["Azure"] },
    ],
  },
  {
    id: "growth",
    title: "增长与品牌",
    color: "#7A8CE0",
    soft: "#E1E5F7",
    side: "left",
    subs: [
      { label: "内容驱动", leaves: ["独立开发者社区"] },
      { label: "作品即传播" },
      { label: "冷启动 100 人" },
    ],
  },
  {
    id: "market",
    title: "竞争格局",
    color: "#B678C8",
    soft: "#EEDFF3",
    side: "left",
    subs: [
      { label: "vs Notion AI" },
      { label: "vs Whimsical" },
      { label: "差异化护城河" },
    ],
  },
];

/* ---------- Editable label primitive ---------- */

type EditableProps = {
  value: string;
  editing: boolean;
  onStartEdit: () => void;
  onCommit: (next: string) => void;
  onCancel: () => void;
  className?: string;
  style?: React.CSSProperties;
  multiline?: boolean;
};

function EditableLabel({
  value,
  editing,
  onStartEdit,
  onCommit,
  onCancel,
  className,
  style,
  multiline,
}: EditableProps) {
  const [draft, setDraft] = useState(value);
  // Reset draft whenever we (re-)enter edit mode.
  const enterKey = editing ? "on" : "off";

  if (editing) {
    return (
      <input
        key={enterKey}
        autoFocus
        defaultValue={value}
        onChange={(e) => setDraft(e.target.value)}
        onBlur={() => onCommit(draft || value)}
        onKeyDown={(e) => {
          if (e.key === "Enter" && !e.shiftKey) {
            e.preventDefault();
            onCommit((e.target as HTMLInputElement).value || value);
          } else if (e.key === "Escape") {
            e.preventDefault();
            onCancel();
          }
        }}
        onClick={(e) => e.stopPropagation()}
        className={`bg-transparent outline-none border-b border-white/50 min-w-[60px] w-full text-center ${className ?? ""}`}
        style={style}
      />
    );
  }

  return (
    <span
      onDoubleClick={(e) => {
        e.stopPropagation();
        onStartEdit();
      }}
      className={`cursor-text ${className ?? ""}`}
      style={style}
    >
      {value || (multiline ? " " : "…")}
    </span>
  );
}

/* ---------- Custom nodes ---------- */

type NodeCallbacks = {
  editingId: string | null;
  setEditingId: (id: string | null) => void;
  updateLabel: (id: string, next: string) => void;
  updateSubtitle?: (id: string, next: string) => void;
};

type CenterData = {
  title: string;
  subtitle: string;
  cb: NodeCallbacks;
};
function CenterNode({ id, data, selected }: NodeProps<Node<CenterData>>) {
  const { cb } = data;
  const editingTitle = cb.editingId === `${id}:title`;
  const editingSub = cb.editingId === `${id}:sub`;
  return (
    <div
      className={`relative flex flex-col items-center justify-center text-center rounded-[28px] px-7 py-5 bg-[#1A1A1A] text-white shadow-[0_10px_40px_-10px_rgba(0,0,0,0.35)] transition-all ${
        selected ? "ring-2 ring-white/80 ring-offset-2 ring-offset-background" : ""
      }`}
      style={{ width: 220 }}
    >
      <div className="font-h1 text-[26px] leading-none tracking-tight w-full">
        <EditableLabel
          value={data.title}
          editing={editingTitle}
          onStartEdit={() => cb.setEditingId(`${id}:title`)}
          onCommit={(v) => {
            cb.updateLabel(id, v);
            cb.setEditingId(null);
          }}
          onCancel={() => cb.setEditingId(null)}
        />
      </div>
      <div className="text-[10.5px] opacity-70 mt-2 leading-snug px-2 w-full">
        <EditableLabel
          value={data.subtitle}
          editing={editingSub}
          onStartEdit={() => cb.setEditingId(`${id}:sub`)}
          onCommit={(v) => {
            cb.updateSubtitle?.(id, v);
            cb.setEditingId(null);
          }}
          onCancel={() => cb.setEditingId(null)}
          multiline
        />
      </div>
      <Handle type="source" position={Position.Left} style={{ opacity: 0 }} />
      <Handle type="source" position={Position.Right} style={{ opacity: 0 }} />
      <Handle type="target" position={Position.Left} style={{ opacity: 0 }} />
      <Handle type="target" position={Position.Right} style={{ opacity: 0 }} />
    </div>
  );
}

type BranchData = { label: string; color: string; side: "left" | "right"; cb: NodeCallbacks };
function BranchNode({ id, data, selected }: NodeProps<Node<BranchData>>) {
  const src = data.side === "right" ? Position.Right : Position.Left;
  const tgt = data.side === "right" ? Position.Left : Position.Right;
  const editing = data.cb.editingId === id;
  return (
    <div
      className={`rounded-[12px] px-4 py-2.5 text-white text-[14px] font-medium shadow-[0_6px_20px_-8px_rgba(0,0,0,0.25)] whitespace-nowrap transition-all ${
        selected ? "ring-2 ring-offset-2 ring-offset-background" : ""
      }`}
      style={{
        background: data.color,
        boxShadow: selected ? `0 0 0 2px ${data.color}, 0 6px 20px -8px rgba(0,0,0,0.35)` : undefined,
      }}
    >
      <EditableLabel
        value={data.label}
        editing={editing}
        onStartEdit={() => data.cb.setEditingId(id)}
        onCommit={(v) => {
          data.cb.updateLabel(id, v);
          data.cb.setEditingId(null);
        }}
        onCancel={() => data.cb.setEditingId(null)}
      />
      <Handle type="target" position={tgt} style={{ opacity: 0 }} />
      <Handle type="source" position={src} style={{ opacity: 0 }} />
    </div>
  );
}

type SubData = {
  label: string;
  color: string;
  soft: string;
  side: "left" | "right";
  cb: NodeCallbacks;
};
function SubNode({ id, data, selected }: NodeProps<Node<SubData>>) {
  const src = data.side === "right" ? Position.Right : Position.Left;
  const tgt = data.side === "right" ? Position.Left : Position.Right;
  const editing = data.cb.editingId === id;
  return (
    <div
      className="rounded-[10px] px-3 py-1.5 text-[12.5px] whitespace-nowrap border transition-all"
      style={{
        background: data.soft,
        color: "#1A1A1A",
        borderColor: selected ? data.color : data.color + "55",
        boxShadow: selected ? `0 0 0 2px ${data.color}55` : undefined,
      }}
    >
      <EditableLabel
        value={data.label}
        editing={editing}
        onStartEdit={() => data.cb.setEditingId(id)}
        onCommit={(v) => {
          data.cb.updateLabel(id, v);
          data.cb.setEditingId(null);
        }}
        onCancel={() => data.cb.setEditingId(null)}
      />
      <Handle type="target" position={tgt} style={{ opacity: 0 }} />
      <Handle type="source" position={src} style={{ opacity: 0 }} />
    </div>
  );
}

type LeafData = { label: string; color: string; side: "left" | "right"; cb: NodeCallbacks };
function LeafNode({ id, data, selected }: NodeProps<Node<LeafData>>) {
  const tgt = data.side === "right" ? Position.Left : Position.Right;
  const editing = data.cb.editingId === id;
  return (
    <div
      className="text-[11.5px] px-1.5 whitespace-nowrap rounded transition-all"
      style={{
        color: "#4a4a4a",
        background: selected ? data.color + "22" : "transparent",
        boxShadow: selected ? `inset 0 0 0 1px ${data.color}66` : undefined,
      }}
    >
      <EditableLabel
        value={data.label}
        editing={editing}
        onStartEdit={() => data.cb.setEditingId(id)}
        onCommit={(v) => {
          data.cb.updateLabel(id, v);
          data.cb.setEditingId(null);
        }}
        onCancel={() => data.cb.setEditingId(null)}
      />
      <Handle type="target" position={tgt} style={{ opacity: 0 }} />
    </div>
  );
}

/* ---------- Custom edge ---------- */

function OrganicEdge({ sourceX, sourceY, targetX, targetY, data }: EdgeProps) {
  const color = (data as { color?: string; width?: number } | undefined)?.color ?? "#c9c6bd";
  const width = (data as { color?: string; width?: number } | undefined)?.width ?? 2;
  const dx = targetX - sourceX;
  const c1x = sourceX + dx * 0.55;
  const c1y = sourceY;
  const c2x = targetX - dx * 0.55;
  const c2y = targetY;
  const d = `M ${sourceX} ${sourceY} C ${c1x} ${c1y}, ${c2x} ${c2y}, ${targetX} ${targetY}`;
  return <path d={d} stroke={color} strokeWidth={width} strokeLinecap="round" fill="none" />;
}

const nodeTypes = {
  center: CenterNode,
  branch: BranchNode,
  sub: SubNode,
  leaf: LeafNode,
};
const edgeTypes = { organic: OrganicEdge };

/* ---------- Layout ---------- */

const BRANCH_DX = 260;
const SUB_DX = 200;
const LEAF_DX = 130;
const ROW_H = 44;

type GraphState = {
  centerTitle: string;
  centerSubtitle: string;
  branches: Branch[];
};

function buildGraph(state: GraphState, cb: NodeCallbacks): { nodes: Node[]; edges: Edge[] } {
  const nodes: Node[] = [];
  const edges: Edge[] = [];

  nodes.push({
    id: "center",
    type: "center",
    position: { x: -110, y: -40 },
    data: { title: state.centerTitle, subtitle: state.centerSubtitle, cb },
    draggable: false,
  });

  const perSide: Record<"left" | "right", Branch[]> = { left: [], right: [] };
  state.branches.forEach((b) => perSide[b.side].push(b));

  (["left", "right"] as const).forEach((side) => {
    const list = perSide[side];
    const branchHeights = list.map((b) =>
      Math.max(1, b.subs.reduce((acc, s) => acc + Math.max(1, s.leaves?.length ?? 0), 0)),
    );
    const totalRows = branchHeights.reduce((a, b) => a + b, 0);
    const gap = 60;
    const totalHeight = totalRows * ROW_H + (list.length - 1) * gap;
    let cursorY = -totalHeight / 2;

    list.forEach((b, bi) => {
      const rows = branchHeights[bi];
      const blockH = rows * ROW_H;
      const branchY = cursorY + blockH / 2;
      const dir = side === "right" ? 1 : -1;
      const branchX = dir * BRANCH_DX;

      nodes.push({
        id: b.id,
        type: "branch",
        position: { x: branchX - 60, y: branchY - 20 },
        data: { label: b.title, color: b.color, side: b.side, cb },
        draggable: false,
      });
      edges.push({
        id: `center-${b.id}`,
        source: "center",
        target: b.id,
        type: "organic",
        data: { color: b.color, width: 2.5 },
      });

      let subCursor = cursorY;
      b.subs.forEach((s, si) => {
        const leafCount = Math.max(1, s.leaves?.length ?? 0);
        const subBlockH = leafCount * ROW_H;
        const subY = subCursor + subBlockH / 2;
        const subX = branchX + dir * SUB_DX;
        const subId = `${b.id}-s${si}`;

        nodes.push({
          id: subId,
          type: "sub",
          position: { x: subX - 60, y: subY - 16 },
          data: { label: s.label, color: b.color, soft: b.soft, side: b.side, cb },
          draggable: false,
        });
        edges.push({
          id: `${b.id}->${subId}`,
          source: b.id,
          target: subId,
          type: "organic",
          data: { color: b.color, width: 1.75 },
        });

        if (s.leaves?.length) {
          s.leaves.forEach((lf, li) => {
            const leafY = subCursor + li * ROW_H + ROW_H / 2;
            const leafX = subX + dir * LEAF_DX;
            const leafId = `${subId}-l${li}`;
            nodes.push({
              id: leafId,
              type: "leaf",
              position: { x: leafX - 40, y: leafY - 10 },
              data: { label: lf, color: b.color, side: b.side, cb },
              draggable: false,
            });
            edges.push({
              id: `${subId}->${leafId}`,
              source: subId,
              target: leafId,
              type: "organic",
              data: { color: b.color + "aa", width: 1.25 },
            });
          });
        }

        subCursor += subBlockH;
      });

      cursorY += blockH + gap;
    });
  });

  return { nodes, edges };
}

/* ---------- Label update helper ---------- */

function setLabelInState(state: GraphState, nodeId: string, next: string): GraphState {
  if (nodeId === "center") {
    return { ...state, centerTitle: next };
  }
  // ids: branch = branch.id; sub = "<branch>-s<i>"; leaf = "<branch>-s<i>-l<j>"
  return {
    ...state,
    branches: state.branches.map((b) => {
      if (b.id === nodeId) return { ...b, title: next };
      if (!nodeId.startsWith(`${b.id}-s`)) return b;
      const rest = nodeId.slice(b.id.length + 2); // after "-s"
      const [siRaw, leafPart] = rest.split("-l");
      const si = Number(siRaw);
      if (Number.isNaN(si)) return b;
      const subs = b.subs.map((s, i) => {
        if (i !== si) return s;
        if (leafPart === undefined) return { ...s, label: next };
        const li = Number(leafPart);
        if (Number.isNaN(li) || !s.leaves) return s;
        const leaves = s.leaves.map((l, j) => (j === li ? next : l));
        return { ...s, leaves };
      });
      return { ...b, subs };
    }),
  };
}

/* ---------- Page ---------- */

function MindMapPreview() {
  const [state, setState] = useState<GraphState>(() => ({
    centerTitle: CENTER_TITLE,
    centerSubtitle: CENTER_SUBTITLE,
    branches: BRANCHES,
  }));
  const [editingId, setEditingId] = useState<string | null>(null);
  const [selectedId, setSelectedId] = useState<string | null>(null);

  const updateLabel = useCallback((nodeId: string, next: string) => {
    setState((s) =>
      nodeId === "center"
        ? { ...s, centerTitle: next }
        : setLabelInState(s, nodeId, next),
    );
  }, []);

  const updateSubtitle = useCallback((_id: string, next: string) => {
    setState((s) => ({ ...s, centerSubtitle: next }));
  }, []);

  const cb: NodeCallbacks = useMemo(
    () => ({ editingId, setEditingId, updateLabel, updateSubtitle }),
    [editingId, updateLabel, updateSubtitle],
  );

  const { nodes, edges } = useMemo(() => buildGraph(state, cb), [state, cb]);

  // Apply selection flag onto nodes so React Flow renders the visual selection.
  const displayNodes = useMemo(
    () => nodes.map((n) => ({ ...n, selected: n.id === selectedId })),
    [nodes, selectedId],
  );

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      if (editingId) return; // let the input handle keys
      if ((e.key === "Enter" || e.key === "F2") && selectedId) {
        e.preventDefault();
        setEditingId(selectedId);
      }
    },
    [editingId, selectedId],
  );

  return (
    <div
      className="h-screen w-full flex flex-col bg-background text-primary outline-none"
      tabIndex={0}
      onKeyDown={handleKeyDown}
    >
      <header className="border-b border-auralis bg-surface/80 backdrop-blur">
        <div className="max-w-[1400px] mx-auto px-6 py-3 flex items-center justify-between">
          <div className="flex items-baseline gap-3">
            <h1 className="font-h1 text-2xl leading-none">Mind map</h1>
            <span className="text-xs text-secondary">
              点击选中 · 双击 或 Enter 编辑 · Esc 取消
            </span>
          </div>
          <div className="flex items-center gap-2">
            <button className="h-8 px-3 rounded-md border border-auralis bg-surface text-xs hover:bg-surface-variant">
              + Branch
            </button>
            <button className="h-8 px-3 rounded-md border border-auralis bg-surface text-xs hover:bg-surface-variant">
              Export
            </button>
            <button className="h-8 px-3 rounded-md bg-primary text-on-primary text-xs">
              Focus mode
            </button>
          </div>
        </div>
      </header>

      <div className="flex-1 relative">
        <ReactFlow
          nodes={displayNodes}
          edges={edges}
          nodeTypes={nodeTypes}
          edgeTypes={edgeTypes}
          fitView
          fitViewOptions={{ padding: 0.15 }}
          minZoom={0.4}
          maxZoom={1.6}
          nodesDraggable={false}
          nodesConnectable={false}
          elementsSelectable
          selectNodesOnDrag={false}
          onNodeClick={(_, n) => {
            setSelectedId(n.id);
            if (editingId && editingId.split(":")[0] !== n.id && editingId !== n.id) {
              setEditingId(null);
            }
          }}
          onPaneClick={() => {
            setSelectedId(null);
            setEditingId(null);
          }}
          proOptions={{ hideAttribution: true }}
          panOnScroll
        >
          <Background variant={BackgroundVariant.Dots} gap={22} size={1} color="#d9d6cd" />
          <Controls
            showInteractive={false}
            className="!bg-surface !border !border-auralis !rounded-md !shadow-sm"
          />
        </ReactFlow>
      </div>
    </div>
  );
}
