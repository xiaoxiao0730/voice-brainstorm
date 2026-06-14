import { between } from "./orderKey";
import type { BriefBlock, BriefDoc, BriefPatch } from "./types";

function lastOrderKey(doc: BriefDoc): string | null {
  const keys = Object.values(doc).map((b) => b.orderKey).sort();
  return keys.length ? keys[keys.length - 1] : null;
}

function nextOrderKeyAfter(doc: BriefDoc, afterId: string | null): string {
  if (!afterId) return between(lastOrderKey(doc), null);
  const ordered = Object.values(doc).sort((a, b) => a.orderKey.localeCompare(b.orderKey));
  const idx = ordered.findIndex((b) => b.id === afterId);
  if (idx < 0) return between(lastOrderKey(doc), null);
  return between(ordered[idx].orderKey, ordered[idx + 1]?.orderKey ?? null);
}

export type ApplyPatchResult =
  | { ok: true; block: BriefBlock; reason?: "appended_after_locked" }
  | { ok: false; reason: string };

export function applyBriefPatch(
  doc: BriefDoc,
  patch: BriefPatch,
  opts: { sessionId: string; newId?: () => string },
): { doc: BriefDoc; result: ApplyPatchResult } {
  const newId = opts.newId ?? (() => crypto.randomUUID());

  switch (patch.action) {
    case "append_block": {
      const id = newId();
      const block: BriefBlock = {
        id,
        sessionId: opts.sessionId,
        orderKey: between(lastOrderKey(doc), null),
        heading: (patch.heading ?? "").trim(),
        level: patch.level ?? 2,
        body: (patch.bodyMarkdown ?? "").trim(),
        lastEditedBy: "ai",
        locked: false,
        sourceChunkIds: patch.sourceChunkIds ?? [],
      };
      return { doc: { ...doc, [id]: block }, result: { ok: true, block } };
    }
    case "update_block": {
      if (!patch.blockId) return { doc, result: { ok: false, reason: "missing blockId" } };
      const existing = doc[patch.blockId];
      if (!existing) return { doc, result: { ok: false, reason: "block not found" } };
      if (existing.locked) {
        return { doc, result: { ok: false, reason: "block locked by user" } };
      }
      const next: BriefBlock = {
        ...existing,
        heading: patch.heading !== undefined ? patch.heading.trim() : existing.heading,
        level: patch.level ?? existing.level,
        body: patch.bodyMarkdown !== undefined ? patch.bodyMarkdown.trim() : existing.body,
        sourceChunkIds: patch.sourceChunkIds?.length
          ? Array.from(new Set([...existing.sourceChunkIds, ...patch.sourceChunkIds]))
          : existing.sourceChunkIds,
      };
      return { doc: { ...doc, [next.id]: next }, result: { ok: true, block: next } };
    }
    case "append_to_block": {
      if (!patch.blockId) return { doc, result: { ok: false, reason: "missing blockId" } };
      const existing = doc[patch.blockId];
      if (!existing) return { doc, result: { ok: false, reason: "block not found" } };
      const addition = (patch.bodyMarkdown ?? "").trim();
      if (!addition) return { doc, result: { ok: false, reason: "empty addition" } };

      if (existing.locked) {
        // Fallback: insert a new sibling block immediately after the locked one.
        const id = newId();
        const block: BriefBlock = {
          id,
          sessionId: opts.sessionId,
          orderKey: nextOrderKeyAfter(doc, existing.id),
          heading: "",
          level: existing.level,
          body: addition,
          lastEditedBy: "ai",
          locked: false,
          sourceChunkIds: patch.sourceChunkIds ?? [],
        };
        return {
          doc: { ...doc, [id]: block },
          result: { ok: true, block, reason: "appended_after_locked" },
        };
      }

      const next: BriefBlock = {
        ...existing,
        body: existing.body ? `${existing.body}\n${addition}` : addition,
        sourceChunkIds: patch.sourceChunkIds?.length
          ? Array.from(new Set([...existing.sourceChunkIds, ...patch.sourceChunkIds]))
          : existing.sourceChunkIds,
      };
      return { doc: { ...doc, [next.id]: next }, result: { ok: true, block: next } };
    }
  }
}
