import {
  forwardRef,
  useCallback,
  useEffect,
  useImperativeHandle,
  useRef,
  useState,
  type KeyboardEvent as ReactKeyboardEvent,
  type MouseEvent as ReactMouseEvent,
} from "react";
import type { BriefBlock, BriefDoc } from "@/lib/pipeline/types";
import { between } from "@/lib/pipeline/orderKey";

export type BriefDocumentHandle = {
  /**
   * Append lines to the end of the document (and persist via callback).
   * When `asHtml` is true, each block's `heading` / `body` is treated as
   * pre-sanitized HTML (e.g. markdown converted via renderMarkdownToSafeHtml)
   * and inserted without further escaping. Defaults to false (plain text).
   */
  appendLines: (blocks: BriefBlock[], opts?: { asHtml?: boolean }) => void;
  /** Force-flush any in-flight debounced save (e.g. before session switch). */
  flush: () => void;
};

type Delta = { upserts: BriefBlock[]; deletedIds: string[] };

type Props = {
  sessionId: string;
  doc: BriefDoc;
  onPersistDelta: (delta: Delta) => void;
  onIsEditingChange?: (editing: boolean) => void;
  aiLoading: boolean;
};

type LineKind = "h2" | "p";
type DocSize = "sm" | "md" | "lg";

const SIZE_PRESETS: Record<DocSize, { h2: string; p: string; label: string }> = {
  sm: { h2: "15px", p: "12px", label: "Small" },
  md: { h2: "17px", p: "14px", label: "Default" },
  lg: { h2: "20px", p: "16px", label: "Large" },
};

const INLINE_SIZES: Array<{ label: string; value: string }> = [
  { label: "Smaller", value: "0.85em" },
  { label: "Normal", value: "1em" },
  { label: "Larger", value: "1.25em" },
];

function blockKind(b: BriefBlock): LineKind {
  return b.level === 2 ? "h2" : "p";
}
function blockHtml(b: BriefBlock): string {
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

function renderLineHtml(block: BriefBlock, options?: { escapeText?: boolean }): string {
  const kind = blockKind(block);
  const tag = kind === "h2" ? "h2" : "p";
  const raw = blockHtml(block);
  const inner = (options?.escapeText ? escapeHtml(raw) : raw) || "<br>";
  return `<${tag} data-line-id="${block.id}" data-order-key="${escapeHtml(
    block.orderKey,
  )}">${inner}</${tag}>`;
}

function readLineHtml(el: HTMLElement): { html: string; text: string } {
  const clone = el.cloneNode(true) as HTMLElement;
  clone.querySelectorAll("[data-control]").forEach((n) => n.remove());
  const html = clone.innerHTML
    .replace(/\u00a0/g, " ")
    .replace(/\u200b/g, "")
    .trim();
  const text = (clone.textContent ?? "")
    .replace(/\u00a0/g, " ")
    .replace(/\u200b/g, "")
    .trim();
  return { html, text };
}

export const BriefDocument = forwardRef<BriefDocumentHandle, Props>(function BriefDocument(
  { sessionId, doc, onPersistDelta, onIsEditingChange, aiLoading },
  ref,
) {
  const editorRef = useRef<HTMLDivElement>(null);
  const [isEmpty, setIsEmpty] = useState(true);
  const composingRef = useRef(false);
  const saveTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const lastSnapshotRef = useRef<Map<string, BriefBlock>>(new Map());
  const sessionIdRef = useRef(sessionId);

  const [docSize, setDocSize] = useState<DocSize>(() => {
    if (typeof window === "undefined") return "md";
    const v = window.localStorage.getItem("brief-doc-size");
    return v === "sm" || v === "md" || v === "lg" ? v : "md";
  });

  useEffect(() => {
    try {
      window.localStorage.setItem("brief-doc-size", docSize);
    } catch {
      /* ignore */
    }
  }, [docSize]);

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
      const { html, text } = readLineHtml(ch);
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
        heading: kind === "h2" ? html : "",
        body: kind === "h2" ? "" : html,
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
      if (
        !p ||
        p.heading !== l.heading ||
        p.body !== l.body ||
        p.level !== l.level ||
        p.orderKey !== l.orderKey ||
        !!p.isPending !== !!l.isPending
      ) {
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
    el.innerHTML = ordered.map((b) => renderLineHtml(b)).join("");
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
      appendLines: (blocks, opts) => {
        const el = editorRef.current;
        if (!el || blocks.length === 0) return;
        const escapeText = !opts?.asHtml;
        const sel = window.getSelection();
        const savedRange =
          sel && sel.rangeCount > 0 && el.contains(sel.anchorNode)
            ? sel.getRangeAt(0).cloneRange()
            : null;
        const childs = Array.from(el.children) as HTMLElement[];
        let lastKey: string | null =
          childs.length > 0 ? childs[childs.length - 1].dataset.orderKey ?? null : null;
        for (const b of blocks) {
          const key = b.orderKey || between(lastKey, null);
          const block: BriefBlock = { ...b, orderKey: key };
          // When asHtml is false, escape on insert (AI/template plain text).
          // When asHtml is true, the caller has already rendered safe HTML.
          el.insertAdjacentHTML("beforeend", renderLineHtml(block, { escapeText }));
          lastSnapshotRef.current.set(block.id, block);
          lastKey = key;
        }
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

  // No accept/undo controls — AI writes land directly in the canvas.

  const isSelectionInEditor = (): boolean => {
    const el = editorRef.current;
    const sel = window.getSelection();
    if (!el || !sel || sel.rangeCount === 0) return false;
    const r = sel.getRangeAt(0);
    return el.contains(r.commonAncestorContainer);
  };

  const exec = useCallback(
    (cmd: "bold" | "italic") => {
      const el = editorRef.current;
      if (!el) return;
      el.focus();
      try {
        document.execCommand(cmd, false);
      } catch {
        /* ignore */
      }
      scheduleSave();
    },
    [scheduleSave],
  );

  const applyInlineSize = useCallback(
    (size: string) => {
      const el = editorRef.current;
      if (!el) return;
      el.focus();
      if (!isSelectionInEditor()) return;
      const sel = window.getSelection()!;
      if (sel.isCollapsed) return;
      const range = sel.getRangeAt(0);
      const span = document.createElement("span");
      span.style.fontSize = size;
      try {
        range.surroundContents(span);
      } catch {
        const frag = range.extractContents();
        span.appendChild(frag);
        range.insertNode(span);
      }
      sel.removeAllRanges();
      const nr = document.createRange();
      nr.selectNodeContents(span);
      sel.addRange(nr);
      scheduleSave();
    },
    [scheduleSave],
  );

  const onKeyDown = (e: ReactKeyboardEvent<HTMLDivElement>) => {
    if ((e.metaKey || e.ctrlKey) && !e.altKey) {
      const k = e.key.toLowerCase();
      if (k === "b") {
        e.preventDefault();
        exec("bold");
      } else if (k === "i") {
        e.preventDefault();
        exec("italic");
      }
    }
  };

  const preset = SIZE_PRESETS[docSize];

  return (
    <div className="max-w-[760px] mx-auto px-4">
      {/* Toolbar */}
      <div className="flex items-center justify-between gap-2 mb-3 text-xs text-secondary">
        <div className="flex items-center gap-1">
          <button
            type="button"
            onMouseDown={(e) => {
              e.preventDefault();
              exec("bold");
            }}
            className="w-7 h-7 rounded border border-auralis bg-surface hover:bg-surface-variant font-bold text-primary"
            title="Bold (⌘/Ctrl+B)"
            aria-label="Bold"
          >
            B
          </button>
          <button
            type="button"
            onMouseDown={(e) => {
              e.preventDefault();
              exec("italic");
            }}
            className="w-7 h-7 rounded border border-auralis bg-surface hover:bg-surface-variant italic text-primary"
            title="Italic (⌘/Ctrl+I)"
            aria-label="Italic"
          >
            I
          </button>
          <span className="mx-1 text-secondary/70">·</span>
          <span className="text-[11px] text-secondary mr-1">Selection size</span>
          {INLINE_SIZES.map((s) => (
            <button
              key={s.value}
              type="button"
              onMouseDown={(e) => {
                e.preventDefault();
                applyInlineSize(s.value);
              }}
              className="px-2 h-7 rounded border border-auralis bg-surface hover:bg-surface-variant text-primary"
              title={`Apply ${s.label}`}
            >
              {s.label}
            </button>
          ))}
        </div>
        <div className="flex items-center gap-1.5">
          <span className="text-[11px] text-secondary">Doc size</span>
          <select
            value={docSize}
            onChange={(e) => setDocSize(e.target.value as DocSize)}
            className="h-7 px-2 rounded border border-auralis bg-surface text-primary text-xs focus:outline-none focus:ring-1 focus:ring-primary"
            aria-label="Document font size"
            title="Default font size for the document"
          >
            {(Object.keys(SIZE_PRESETS) as DocSize[]).map((k) => (
              <option key={k} value={k}>
                {SIZE_PRESETS[k].label}
              </option>
            ))}
          </select>
        </div>
      </div>

      <div className="relative">
        <div
          ref={editorRef}
          contentEditable
          suppressContentEditableWarning
          spellCheck
          role="textbox"
          aria-multiline="true"
          aria-label="Live brief document"
          className="brief-doc outline-none min-h-[60vh] py-4 text-primary"
          style={
            {
              ["--brief-h2-size" as string]: preset.h2,
              ["--brief-p-size" as string]: preset.p,
            } as React.CSSProperties
          }
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
          onKeyDown={onKeyDown}
        />
        {isEmpty && (
          <div
            className="absolute inset-x-0 top-4 pointer-events-none select-none"
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
    </div>
  );
});
