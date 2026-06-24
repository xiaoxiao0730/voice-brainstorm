import { useEffect, useMemo, useState } from "react";
import {
  Background,
  Controls,
  Position,
  ReactFlow,
  type Edge,
  type Node,
} from "@xyflow/react";
import "@xyflow/react/dist/style.css";

import { useServerFn } from "@tanstack/react-start";
import { generateMindMap, type MindMapNode } from "@/lib/mindmap/generateMindMap.functions";

type Props = {
  open: boolean;
  selectedText: string;
  contextText?: string;
  onClose: () => void;
};

const COL_W = 220;
const ROW_H = 56;

type Layout = { nodes: Node[]; edges: Edge[] };

function layoutTree(root: MindMapNode): Layout {
  const nodes: Node[] = [];
  const edges: Edge[] = [];
  let cursorY = 0;

  // Walk the tree right-to-deep, assigning a y-row to each leaf, then
  // centering parents over their children.
  const walk = (node: MindMapNode, depth: number, parentId: string | null): number => {
    let centerY: number;
    if (!node.children || node.children.length === 0) {
      centerY = cursorY * ROW_H;
      cursorY += 1;
    } else {
      const childYs = node.children.map((c) => walk(c, depth + 1, node.id));
      centerY = (childYs[0] + childYs[childYs.length - 1]) / 2;
    }
    const isRoot = depth === 0;
    nodes.push({
      id: node.id,
      position: { x: depth * COL_W, y: centerY },
      data: { label: node.label },
      style: {
        padding: "8px 12px",
        borderRadius: 10,
        border: isRoot ? "1.5px solid hsl(var(--primary, 220 90% 56%))" : "1px solid #d4d4d8",
        background: isRoot ? "hsl(var(--primary, 220 90% 56%) / 0.08)" : "white",
        fontSize: isRoot ? 13 : 12,
        fontWeight: isRoot ? 600 : 500,
        maxWidth: 200,
        color: "#111827",
      },
      sourcePosition: "right" as const,
      targetPosition: "left" as const,
    });
    if (parentId) {
      edges.push({
        id: `${parentId}->${node.id}`,
        source: parentId,
        target: node.id,
        type: "smoothstep",
        style: { stroke: "#9ca3af", strokeWidth: 1.25 },
      });
    }
    return centerY;
  };

  walk(root, 0, null);
  return { nodes, edges };
}

export function MindMapModal({ open, selectedText, contextText, onClose }: Props) {
  const run = useServerFn(generateMindMap);
  const [loading, setLoading] = useState(false);
  const [tree, setTree] = useState<MindMapNode | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!open) return;
    let aborted = false;
    setTree(null);
    setError(null);
    setLoading(true);
    (async () => {
      try {
        const res = await run({
          data: { selectedText, context: contextText ?? "" },
        });
        if (!aborted) setTree(res.root);
      } catch (e) {
        if (!aborted) setError(e instanceof Error ? e.message : String(e));
      } finally {
        if (!aborted) setLoading(false);
      }
    })();
    return () => {
      aborted = true;
    };
  }, [open, selectedText, contextText, run]);

  const layout = useMemo<Layout | null>(() => (tree ? layoutTree(tree) : null), [tree]);

  if (!open) return null;

  return (
    <div
      className="fixed inset-0 z-[80] flex items-center justify-center bg-black/40 backdrop-blur-sm"
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div className="bg-surface text-primary border border-auralis rounded-xl shadow-2xl w-[min(1080px,92vw)] h-[min(720px,86vh)] flex flex-col overflow-hidden">
        <div className="flex items-center justify-between px-4 py-2.5 border-b border-auralis">
          <div className="flex items-center gap-2">
            <span className="text-sm font-medium">Mind map</span>
            {loading && (
              <span className="text-xs text-secondary flex items-center gap-1.5">
                <span className="w-1.5 h-1.5 rounded-full bg-emerald-500 animate-pulse" />
                generating…
              </span>
            )}
          </div>
          <button
            type="button"
            onClick={onClose}
            className="h-7 px-2.5 rounded border border-auralis bg-surface hover:bg-surface-variant text-xs"
          >
            Close
          </button>
        </div>
        <div className="flex-1 relative bg-[#fafafa]">
          {error && (
            <div className="absolute inset-0 flex items-center justify-center text-xs text-red-500 p-6 text-center">
              {error}
            </div>
          )}
          {layout && (
            <ReactFlow
              nodes={layout.nodes}
              edges={layout.edges}
              fitView
              fitViewOptions={{ padding: 0.2 }}
              nodesDraggable
              proOptions={{ hideAttribution: true }}
            >
              <Background gap={20} color="#e5e7eb" />
              <Controls showInteractive={false} />
            </ReactFlow>
          )}
        </div>
      </div>
    </div>
  );
}
