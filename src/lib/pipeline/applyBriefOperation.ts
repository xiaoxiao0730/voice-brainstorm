import { between } from "./orderKey";
import type { ApplyResult, BriefNode, BriefOperation } from "./types";

// Pure functional reducer for brief state.
// Returns the next nodes map and a result describing what happened.

type NodesById = Record<string, BriefNode>;

function siblingsOrdered(nodes: NodesById, parentId: string | null): BriefNode[] {
  return Object.values(nodes)
    .filter((n) => n.parentId === parentId)
    .sort((a, b) => a.orderKey.localeCompare(b.orderKey));
}

function keyForInsert(
  nodes: NodesById,
  parentId: string | null,
  afterId: string | null,
): string {
  const sibs = siblingsOrdered(nodes, parentId);
  if (afterId === null) {
    // Insert at end.
    const last = sibs[sibs.length - 1];
    return between(last?.orderKey ?? null, null);
  }
  const idx = sibs.findIndex((s) => s.id === afterId);
  if (idx < 0) {
    const last = sibs[sibs.length - 1];
    return between(last?.orderKey ?? null, null);
  }
  const a = sibs[idx].orderKey;
  const b = sibs[idx + 1]?.orderKey ?? null;
  return between(a, b);
}

export function applyBriefOperation(
  nodes: NodesById,
  op: BriefOperation,
  opts: { sessionId: string; tempIdMap: Map<string, string>; newId?: () => string },
): { nodes: NodesById; result: ApplyResult } {
  const newId = opts.newId ?? (() => crypto.randomUUID());

  const resolve = (id: string | null): string | null => {
    if (!id) return null;
    return opts.tempIdMap.get(id) ?? id;
  };

  switch (op.op) {
    case "add_node": {
      const parentId = resolve(op.parentId);
      const afterId = resolve(op.afterId);
      if (op.level === "h1" && parentId !== null) {
        return { nodes, result: { ok: false, reason: "h1 must be top-level" } };
      }
      const id = newId();
      opts.tempIdMap.set(op.tempId, id);
      const orderKey = keyForInsert(nodes, parentId, afterId);
      const node: BriefNode = {
        id,
        sessionId: opts.sessionId,
        parentId,
        orderKey,
        level: op.level,
        text: op.text.trim(),
        status: "ai_draft",
        lastEditedBy: "ai",
        sourceChunkIds: op.sourceChunkIds ?? [],
        confidence: op.confidence ?? null,
        tag: op.tag ?? null,
      };
      return { nodes: { ...nodes, [id]: node }, result: { ok: true, node } };
    }
    case "update_node": {
      const id = resolve(op.nodeId);
      if (!id) return { nodes, result: { ok: false, reason: "missing nodeId" } };
      const existing = nodes[id];
      if (!existing) return { nodes, result: { ok: false, reason: "node not found" } };
      if (existing.lastEditedBy === "user" || existing.status === "user_confirmed") {
        return { nodes, result: { ok: false, reason: "user-locked node" } };
      }
      const next: BriefNode = {
        ...existing,
        text: op.text.trim(),
        sourceChunkIds: op.sourceChunkIds ?? existing.sourceChunkIds,
        confidence: op.confidence ?? existing.confidence,
      };
      return { nodes: { ...nodes, [id]: next }, result: { ok: true, node: next } };
    }
    case "delete_node": {
      const id = resolve(op.nodeId);
      if (!id) return { nodes, result: { ok: false, reason: "missing nodeId" } };
      const existing = nodes[id];
      if (!existing) return { nodes, result: { ok: false, reason: "node not found" } };
      if (existing.lastEditedBy === "user" || existing.status === "user_confirmed") {
        return { nodes, result: { ok: false, reason: "user-locked node" } };
      }
      // Cascade delete children.
      const toDelete = new Set<string>([id]);
      let added = true;
      while (added) {
        added = false;
        for (const n of Object.values(nodes)) {
          if (n.parentId && toDelete.has(n.parentId) && !toDelete.has(n.id)) {
            toDelete.add(n.id);
            added = true;
          }
        }
      }
      const next = { ...nodes };
      for (const did of toDelete) delete next[did];
      return { nodes: next, result: { ok: true } };
    }
    case "move_node": {
      const id = resolve(op.nodeId);
      if (!id) return { nodes, result: { ok: false, reason: "missing nodeId" } };
      const existing = nodes[id];
      if (!existing) return { nodes, result: { ok: false, reason: "node not found" } };
      if (existing.lastEditedBy === "user" || existing.status === "user_confirmed") {
        return { nodes, result: { ok: false, reason: "user-locked node" } };
      }
      const newParentId = resolve(op.newParentId);
      const orderKey = keyForInsert(nodes, newParentId, resolve(op.afterId));
      const next = { ...existing, parentId: newParentId, orderKey };
      return { nodes: { ...nodes, [id]: next }, result: { ok: true, node: next } };
    }
    case "annotate": {
      const id = resolve(op.nodeId);
      if (!id) return { nodes, result: { ok: false, reason: "missing nodeId" } };
      const existing = nodes[id];
      if (!existing) return { nodes, result: { ok: false, reason: "node not found" } };
      const next = { ...existing, tag: op.tag };
      return { nodes: { ...nodes, [id]: next }, result: { ok: true, node: next } };
    }
  }
}
