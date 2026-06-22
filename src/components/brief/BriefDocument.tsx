import {
  forwardRef,
  useCallback,
  useEffect,
  useImperativeHandle,
  useRef,
  useState,
} from "react";
import type { BriefBlock, BriefDoc } from "@/lib/pipeline/types";
import { between } from "@/lib/pipeline/orderKey";

export type BriefDocumentHandle = {
  /** Append lines to the end of the document (and persist via callback). */
  appendLines: (blocks: BriefBlock[]) => void;
  /** Force-flush any in-flight debounced save (e.g. before session switch). */
  flush: () => void;
};

type Delta = { upserts: BriefBlock[]; deletedIds: string[] };

type Props = {
  sessionId: string;
  doc: BriefDoc;
  onPersistDelta: (delta: Delta) => void;
  onAcceptPending: (id: string) => void;
  onRejectPending: (id: string) => void;
  onIsEditingChange?: (editing: boolean) => void;
  aiLoading: boolean;
};

type LineKind = "h2" | "p";

function blockKind(b: BriefBlock): LineKind {
  return b.level === 2 ? "h2" : "p";
}
function blockText(b: BriefBlock): string {
  if (blockKind(b) === "h2") return b.heading || b.body || "";
  return b.body || b.heading || "";
}

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function renderLineHtml(block: BriefBlock): string {
  const kind = blockKind(block);
  const tag = kind === "h2" ? "h2" : "p";
  const text = escapeHtml(blockText(block)) || "<br>";
  const pendingAttr = block.isPending ? ' data-pending="true"' : "";
  const controls = block.isPending
    ? `<span contenteditable="false" data-control class="brief-line-controls"><button type="button" data-accept title="Accept">✓</button><button type="button" data-reject title="Reject">✕</button></span>`
    : "";
  return `<${tag} data-line-id="${block.id}" data-order-key="${escapeHtml(
    block.orderKey,
  )}"${pendingAttr}>${text}${controls}</${tag}>`;
}

function readLineText(el: HTMLElement): string {
  const clone = el.cloneNode(true) as HTMLElement;
  clone.querySelectorAll("[data-control]").forEach((n) => n.remove());
  return (clone.textContent ?? "")
    .replace(/\u00a0/g, " ")
    .replace(/\u200b/g, "")
    .trim();
}

export const BriefDocument = forwardRef<BriefDocumentHandle, Props>(function BriefDocument(
  { sessionId, doc, onPersistDelta, onAcceptPending, onRejectPending, onIsEditingChange, aiLoading },
  ref,
) {
  const editorRef = useRef<HTMLDivElement>(null);
  const [isEmpty, setIsEmpty] = useState(true);
  const composingRef = useRef(false);
  const saveTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const lastSnapshotRef = useRef<Map<string, BriefBlock>>(new Map());
  const sessionIdRef = useRef(sessionId);

  const recomputeEmpty = useCallback(() => {
    const el = editorRef.current;
    if (!el) return;
    const text = (el.innerText ?? "").replace(/\u200b/g, "").trim();
    setIsEmpty(text.length === 0);
  }, []);

  const readDom = useCallback((): BriefBlock[] => {
    const el = editorRef.current;
    if (!el) return [];
    const sid = sessionIdRef.current;
    const children = Array.from(el.children) as HTMLElement[];
    const out: BriefBlock[] = [];
    let prevKey: string | null = null;
    for (let i = 0; i < children.length; i++) {
      const ch = children[i];
      const text = readLineText(ch);
      if (!text) continue;
      let id = ch.dataset.lineId;
      if (!id) {
        id = (crypto as Crypto).randomUUID();
        ch.dataset.lineId = id;
      }
      let orderKey = ch.dataset.orderKey;
      if (!orderKey) {
        let nextKey: string | null = null;
        for (let j = i + 1; j < children.length; j++) {
          const k = children[j].dataset.orderKey;
          if (k) {
            nextKey = k;
            break;
          }
        }
        orderKey = between(prevKey, nextKey);
        ch.dataset.orderKey = orderKey;
      }
      prevKey = orderKey;
      const kind: LineKind = ch.tagName === "H2" ? "h2" : "p";
      // Once user touches a line, it's no longer pending.
      ch.removeAttribute("data-pending");
      ch.querySelectorAll("[data-control]").forEach((n) => n.remove());
      out.push({
        id,
        sessionId: sid,
        orderKey,
        heading: kind === "h2" ? text : "",
        body: kind === "h2" ? "" : text,
        level: kind === "h2" ? 2 : 3,
        lastEditedBy: "user",
        locked: true,
        sourceChunkIds: [],
        isPending: false,
      });
    }
    return out;
  }, []);

  const flush = useCallback(() => {
    if (saveTimerRef.current) {
      clearTimeout(saveTimerRef.current);
      saveTimerRef.current = null;
    }
    if (composingRef.current) return;
    const lines = readDom();
    const prev = lastSnapshotRef.current;
    const nextMap = new Map(lines.map((l) => [l.id, l]));
    const upserts: BriefBlock[] = [];
    for (const l of lines) {
      const p = prev.get(l.id);
      if (!p || p.heading !== l.heading || p.body !== l.body || p.level !== l.level || p.orderKey !== l.orderKey || !!p.isPending !== !!l.isPending) {
        upserts.push(l);
      }
    }
    const deletedIds: string[] = [];
    for (const id of prev.keys()) if (!nextMap.has(id)) deletedIds.push(id);
    if (upserts.length === 0 && deletedIds.length === 0) return;
    lastSnapshotRef.current = nextMap;
    onPersistDelta({ upserts, deletedIds });
  }, [onPersistDelta, readDom]);

  const scheduleSave = useCallback(() => {
    if (saveTimerRef.current) clearTimeout(saveTimerRef.current);
    saveTimerRef.current = setTimeout(() => {
      saveTimerRef.current = null;
      flush();
    }, 500);
  }, [flush]);

  // Mount once per session — replace DOM with snapshot.
  useEffect(() => {
    sessionIdRef.current = sessionId;
    const el = editorRef.current;
    if (!el) return;
    if (saveTimerRef.current) {
      clearTimeout(saveTimerRef.current);
      saveTimerRef.current = null;
    }
    const ordered = Object.values(doc).sort((a, b) => a.orderKey.localeCompare(b.orderKey));
    el.innerHTML = ordered.map(renderLineHtml).join("");
    lastSnapshotRef.current = new Map(ordered.map((b) => [b.id, b]));
    recomputeEmpty();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sessionId]);

  // Persist on unmount / beforeunload.
  useEffect(() => {
    const onBeforeUnload = () => flush();
    window.addEventListener("beforeunload", onBeforeUnload);
    return () => {
      window.removeEventListener("beforeunload", onBeforeUnload);
      flush();
    };
  }, [flush]);

  useImperativeHandle(
    ref,
    () => ({
      appendLines: (blocks) => {
        const el = editorRef.current;
        if (!el || blocks.length === 0) return;
        // Save selection
        const sel = window.getSelection();
        const savedRange =
          sel && sel.rangeCount > 0 && el.contains(sel.anchorNode)
            ? sel.getRangeAt(0).cloneRange()
            : null;
        // Compute orderKey tail (last existing)
        const childs = Array.from(el.children) as HTMLElement[];
        let lastKey: string | null =
          childs.length > 0 ? childs[childs.length - 1].dataset.orderKey ?? null : null;
        for (const b of blocks) {
          const key = b.orderKey || between(lastKey, null);
          const block: BriefBlock = { ...b, orderKey: key };
          el.insertAdjacentHTML("beforeend", renderLineHtml(block));
          lastSnapshotRef.current.set(block.id, block);
          lastKey = key;
        }
        // Restore selection
        if (savedRange) {
          try {
            sel?.removeAllRanges();
            sel?.addRange(savedRange);
          } catch {
            /* ignore */
          }
        }
        recomputeEmpty();
      },
      flush,
    }),
    [flush, recomputeEmpty],
  );

  // Delegated click for pending controls
  const onClick = (e: React.MouseEvent<HTMLDivElement>) => {
    const target = e.target as HTMLElement;
    const acceptBtn = target.closest("[data-accept]") as HTMLElement | null;
    const rejectBtn = target.closest("[data-reject]") as HTMLElement | null;
    if (!acceptBtn && !rejectBtn) return;
    e.preventDefault();
    e.stopPropagation();
    const line = (acceptBtn ?? rejectBtn)!.closest("[data-line-id]") as HTMLElement | null;
    const id = line?.dataset.lineId;
    if (!id) return;
    if (acceptBtn) {
      line!.removeAttribute("data-pending");
      line!.querySelectorAll("[data-control]").forEach((n) => n.remove());
      const snap = lastSnapshotRef.current.get(id);
      if (snap) lastSnapshotRef.current.set(id, { ...snap, isPending: false, locked: true, lastEditedBy: "user" });
      recomputeEmpty();
      onAcceptPending(id);
    } else if (rejectBtn) {
      line!.remove();
      lastSnapshotRef.current.delete(id);
      recomputeEmpty();
      onRejectPending(id);
    }
  };

  return (
    <div className="relative max-w-[760px] mx-auto px-4">
      <div
        ref={editorRef}
        contentEditable
        suppressContentEditableWarning
        spellCheck
        role="textbox"
        aria-multiline="true"
        aria-label="Live brief document"
        className="brief-doc outline-none min-h-[60vh] py-4 text-primary"
        onInput={() => {
          recomputeEmpty();
          if (!composingRef.current) scheduleSave();
        }}
        onCompositionStart={() => {
          composingRef.current = true;
        }}
        onCompositionEnd={() => {
          composingRef.current = false;
          recomputeEmpty();
          scheduleSave();
        }}
        onBlur={() => {
          onIsEditingChange?.(false);
          flush();
        }}
        onFocus={() => onIsEditingChange?.(true)}
        onClick={onClick}
      />
      {isEmpty && (
        <div
          className="absolute inset-x-4 top-4 pointer-events-none select-none"
          aria-hidden="true"
        >
          <h3
            className="text-2xl text-primary mb-1.5"
            style={{ fontFamily: "Instrument Serif, serif" }}
          >
            A canvas for thinking aloud.
          </h3>
          <p className="text-sm text-secondary">
            Start speaking or type anywhere. You can choose a template listed above.
          </p>
        </div>
      )}
      {aiLoading && (
        <div className="mt-3 flex items-center gap-2 text-xs text-secondary px-1">
          <span className="w-1.5 h-1.5 rounded-full bg-amber-500 animate-pulse" />
          AI is weaving your thoughts…
        </div>
      )}
    </div>
  );
});
