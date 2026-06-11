import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { BriefNode } from "@/lib/pipeline/types";

type Props = {
  nodes: Record<string, BriefNode>;
  onEditText: (id: string, text: string) => void;
  onConfirm: (id: string) => void;
  onDelete: (id: string) => void;
  onAddBullet: (afterId: string | null) => void;
  onIndent: (id: string, delta: 1 | -1) => void;
  aiLoading: boolean;
};

function buildOrderedTree(nodes: Record<string, BriefNode>): BriefNode[] {
  const byParent = new Map<string | null, BriefNode[]>();
  for (const n of Object.values(nodes)) {
    const k = n.parentId ?? null;
    const arr = byParent.get(k) ?? [];
    arr.push(n);
    byParent.set(k, arr);
  }
  for (const arr of byParent.values()) arr.sort((a, b) => a.orderKey.localeCompare(b.orderKey));

  const out: BriefNode[] = [];
  const walk = (parentId: string | null) => {
    const children = byParent.get(parentId) ?? [];
    for (const c of children) {
      out.push(c);
      walk(c.id);
    }
  };
  walk(null);
  return out;
}

function depthOf(node: BriefNode, nodes: Record<string, BriefNode>): number {
  let d = 0;
  let p = node.parentId;
  while (p) {
    d++;
    p = nodes[p]?.parentId ?? null;
    if (d > 8) break;
  }
  return d;
}

export function BriefCanvas({
  nodes,
  onEditText,
  onConfirm,
  onDelete,
  onAddBullet,
  onIndent,
  aiLoading,
}: Props) {
  const ordered = useMemo(() => buildOrderedTree(nodes), [nodes]);
  const isEmpty = ordered.length === 0;

  return (
    <div className="max-w-3xl mx-auto px-2">
      {isEmpty && (
        <div className="min-h-[40vh] flex items-center justify-center text-center">
          <div className="max-w-sm">
            <div className="mx-auto mb-4 w-12 h-12 rounded-full bg-gradient-to-tr from-rose-300 via-indigo-200 to-emerald-200" />
            <h3
              className="text-3xl text-primary mb-2"
              style={{ fontFamily: "Instrument Serif, serif" }}
            >
              A canvas for thinking aloud.
            </h3>
            <p className="text-sm text-secondary">
              Start speaking. The AI will outline your ideas as you go.{"\n"}
              You can edit any bullet — your edits are protected.
            </p>
          </div>
        </div>
      )}

      <ul className="space-y-1">
        {ordered.map((node) => (
          <BriefNodeRow
            key={node.id}
            node={node}
            depth={depthOf(node, nodes)}
            onEditText={onEditText}
            onConfirm={onConfirm}
            onDelete={onDelete}
            onAddBullet={onAddBullet}
            onIndent={onIndent}
          />
        ))}
      </ul>

      {aiLoading && (
        <div className="mt-4 flex items-center gap-2 text-xs text-secondary px-3 py-2">
          <span className="w-1.5 h-1.5 rounded-full bg-amber-500 animate-pulse" />
          AI is thinking…
        </div>
      )}
    </div>
  );
}

function BriefNodeRow({
  node,
  depth,
  onEditText,
  onConfirm,
  onDelete,
  onAddBullet,
  onIndent,
}: {
  node: BriefNode;
  depth: number;
  onEditText: (id: string, text: string) => void;
  onConfirm: (id: string) => void;
  onDelete: (id: string) => void;
  onAddBullet: (afterId: string | null) => void;
  onIndent: (id: string, delta: 1 | -1) => void;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const [draft, setDraft] = useState(node.text);
  const lastCommitted = useRef(node.text);

  // Pull updates from AI when this node is not user-locked.
  useEffect(() => {
    if (node.lastEditedBy === "ai" && node.text !== lastCommitted.current) {
      lastCommitted.current = node.text;
      setDraft(node.text);
      if (ref.current && ref.current !== document.activeElement) {
        ref.current.innerText = node.text;
      }
    }
  }, [node.text, node.lastEditedBy]);

  const commit = useCallback(() => {
    const text = ref.current?.innerText ?? draft;
    if (text === lastCommitted.current) return;
    lastCommitted.current = text;
    onEditText(node.id, text);
  }, [draft, node.id, onEditText]);

  const onKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      commit();
      onAddBullet(node.id);
    } else if (e.key === "Tab") {
      e.preventDefault();
      commit();
      onIndent(node.id, e.shiftKey ? -1 : 1);
    } else if (e.key === "Backspace" && (ref.current?.innerText ?? "") === "") {
      e.preventDefault();
      onDelete(node.id);
    } else if ((e.metaKey || e.ctrlKey) && e.key === "Enter") {
      e.preventDefault();
      commit();
      onConfirm(node.id);
    }
  };

  const isLocked = node.status === "user_confirmed";
  const isUserEdited = node.lastEditedBy === "user" && !isLocked;

  const baseStyle: React.CSSProperties = {
    fontFamily:
      node.level === "h1" || node.level === "h2"
        ? "Instrument Serif, serif"
        : "Inter, sans-serif",
    fontSize: node.level === "h1" ? 30 : node.level === "h2" ? 22 : 14.5,
    lineHeight: node.level === "h1" ? 1.2 : node.level === "h2" ? 1.3 : 1.55,
    paddingLeft: depth * 18,
  };

  const marker =
    node.level === "bullet" ? (
      <span className="inline-block w-3 text-secondary select-none">•</span>
    ) : (
      <span className="inline-block w-3" />
    );

  return (
    <li className="group flex items-start gap-2 px-2 py-1 rounded-md hover:bg-surface-variant/40 transition-colors">
      <div className="pt-2 shrink-0" style={{ paddingLeft: depth * 18 }}>
        {marker}
      </div>
      <div className="flex-1 min-w-0">
        <div
          ref={ref}
          contentEditable
          suppressContentEditableWarning
          role="textbox"
          aria-multiline="false"
          onBlur={commit}
          onKeyDown={onKeyDown}
          className={`outline-none text-primary break-words ${
            isLocked ? "opacity-95" : ""
          }`}
          style={{ ...baseStyle, paddingLeft: 0 }}
        >
          {node.text}
        </div>
        {(node.tag || isUserEdited || isLocked || (node.sourceChunkIds?.length ?? 0) > 0) && (
          <div className="flex items-center gap-2 mt-0.5 text-[10px] uppercase tracking-[0.15em] text-secondary">
            {node.tag && (
              <span className="px-1.5 py-0.5 rounded bg-surface border border-auralis">
                {node.tag}
              </span>
            )}
            {isUserEdited && <span className="text-amber-500">• edited</span>}
            {isLocked && <span className="text-emerald-500">✓ confirmed</span>}
          </div>
        )}
      </div>
      <div className="opacity-0 group-hover:opacity-100 transition-opacity flex items-center gap-1 pt-1.5">
        {!isLocked && (
          <button
            onClick={() => onConfirm(node.id)}
            title="Confirm (⌘↵)"
            className="text-[11px] text-secondary hover:text-primary px-1.5"
          >
            ✓
          </button>
        )}
        <button
          onClick={() => onDelete(node.id)}
          title="Delete"
          className="text-[11px] text-secondary hover:text-rose-500 px-1.5"
        >
          ✕
        </button>
      </div>
    </li>
  );
}
