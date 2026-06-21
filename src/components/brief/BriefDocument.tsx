import { useEffect, useMemo, useRef } from "react";
import type { BriefBlock, BriefDoc } from "@/lib/pipeline/types";
import type { ThinkingTemplate } from "@/lib/pipeline/thinkingTemplate";

type Props = {
  doc: BriefDoc;
  template: ThinkingTemplate;
  onEditBlock: (id: string, patch: { heading?: string; body?: string }) => void;
  onDeleteBlock: (id: string) => void;
  onAcceptPending: (id: string) => void;
  onRejectPending: (id: string) => void;
  onFocusBlock?: (id: string | null) => void;
  aiLoading: boolean;
};

export function BriefDocument({
  doc,
  template,
  onEditBlock,
  onDeleteBlock,
  onAcceptPending,
  onRejectPending,
  onFocusBlock,
  aiLoading,
}: Props) {
  const grouped = useMemo(() => {
    const map: Record<string, BriefBlock[]> = {};
    for (const slot of template.slots) map[slot.id] = [];
    const orphans: BriefBlock[] = [];
    for (const b of Object.values(doc)) {
      const arr = b.slotId && map[b.slotId] ? map[b.slotId] : null;
      (arr ?? orphans).push(b);
    }
    for (const arr of Object.values(map)) {
      arr.sort((a, b) => a.orderKey.localeCompare(b.orderKey));
    }
    orphans.sort((a, b) => a.orderKey.localeCompare(b.orderKey));
    return { map, orphans };
  }, [doc, template]);

  const allEmpty = Object.values(grouped.map).every((a) => a.length === 0) && grouped.orphans.length === 0;

  return (
    <div className="max-w-3xl mx-auto px-4 pb-32 space-y-4">
      {allEmpty && (
        <div className="text-center py-8">
          <h3 className="text-2xl text-primary mb-1.5" style={{ fontFamily: "Instrument Serif, serif" }}>
            A canvas for thinking aloud.
          </h3>
          <p className="text-sm text-secondary">Start speaking — the canvas will fill in as you think.</p>
        </div>
      )}

      {template.slots.map((slot) => {
        const blocks = grouped.map[slot.id] ?? [];
        return (
          <section
            key={slot.id}
            className="rounded-xl border border-auralis bg-surface/40 px-5 py-4"
          >
            <header className="flex items-baseline justify-between mb-2">
              <h2
                className="text-base font-medium text-primary"
                style={{ fontFamily: "Instrument Serif, serif" }}
              >
                {slot.title}
              </h2>
              <span className="text-[10px] uppercase tracking-[0.18em] text-secondary">
                {blocks.length === 0 ? "empty" : `${blocks.length}`}
              </span>
            </header>
            {blocks.length === 0 ? (
              <p className="text-xs text-secondary/70 italic">{slot.prompt}</p>
            ) : (
              <div className="space-y-3">
                {blocks.map((block) => (
                  <BlockRow
                    key={block.id}
                    block={block}
                    onEditBlock={onEditBlock}
                    onDeleteBlock={onDeleteBlock}
                    onAcceptPending={onAcceptPending}
                    onRejectPending={onRejectPending}
                    onFocusBlock={onFocusBlock}
                  />
                ))}
              </div>
            )}
          </section>
        );
      })}

      {grouped.orphans.length > 0 && (
        <section className="rounded-xl border border-dashed border-auralis bg-surface/20 px-5 py-4">
          <header className="mb-2">
            <h2 className="text-sm text-secondary">Unsorted</h2>
          </header>
          <div className="space-y-3">
            {grouped.orphans.map((block) => (
              <BlockRow
                key={block.id}
                block={block}
                onEditBlock={onEditBlock}
                onDeleteBlock={onDeleteBlock}
                onAcceptPending={onAcceptPending}
                onRejectPending={onRejectPending}
                onFocusBlock={onFocusBlock}
              />
            ))}
          </div>
        </section>
      )}

      {aiLoading && (
        <div className="flex items-center gap-2 text-xs text-secondary px-3 py-2">
          <span className="w-1.5 h-1.5 rounded-full bg-amber-500 animate-pulse" />
          AI is weaving your thoughts…
        </div>
      )}
    </div>
  );
}

function BlockRow({
  block,
  onEditBlock,
  onDeleteBlock,
  onAcceptPending,
  onRejectPending,
  onFocusBlock,
}: {
  block: BriefBlock;
  onEditBlock: (id: string, patch: { heading?: string; body?: string }) => void;
  onDeleteBlock: (id: string) => void;
  onAcceptPending: (id: string) => void;
  onRejectPending: (id: string) => void;
  onFocusBlock?: (id: string | null) => void;
}) {
  const headingRef = useRef<HTMLDivElement>(null);
  const bodyRef = useRef<HTMLDivElement>(null);
  const lastHeading = useRef(block.heading);
  const lastBody = useRef(block.body);

  useEffect(() => {
    if (headingRef.current) headingRef.current.innerText = block.heading;
    if (bodyRef.current) bodyRef.current.innerText = block.body;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    if (block.heading !== lastHeading.current && headingRef.current && headingRef.current !== document.activeElement) {
      lastHeading.current = block.heading;
      headingRef.current.innerText = block.heading;
    }
  }, [block.heading]);

  useEffect(() => {
    if (block.body !== lastBody.current && bodyRef.current && bodyRef.current !== document.activeElement) {
      lastBody.current = block.body;
      bodyRef.current.innerText = block.body;
    }
  }, [block.body]);

  const composingHeading = useRef(false);
  const composingBody = useRef(false);

  const commitHeading = () => {
    if (composingHeading.current) return;
    const text = headingRef.current?.innerText ?? "";
    if (text === lastHeading.current) return;
    lastHeading.current = text;
    onEditBlock(block.id, { heading: text });
  };
  const commitBody = () => {
    if (composingBody.current) return;
    const text = bodyRef.current?.innerText ?? "";
    if (text === lastBody.current) return;
    lastBody.current = text;
    onEditBlock(block.id, { body: text });
  };

  const isPending = !!block.isPending;
  const editable = !isPending; // pending blocks aren't user-editable until accepted
  const showHeading = block.heading.length > 0 || (!isPending && !block.body);

  return (
    <div
      className={`group relative rounded-md transition-colors ${
        isPending
          ? "border border-dashed border-emerald-500/60 bg-emerald-500/5 px-3 py-2.5"
          : "px-1 py-1"
      }`}
      onFocus={() => onFocusBlock?.(block.id)}
      onBlur={() => onFocusBlock?.(null)}
    >
      {isPending && (
        <div className="flex items-center justify-between mb-1.5">
          <span className="text-[10px] uppercase tracking-[0.18em] text-emerald-600">Pending</span>
          <div className="flex items-center gap-1.5">
            <button
              onClick={() => onAcceptPending(block.id)}
              className="px-2 py-0.5 rounded text-[11px] font-medium bg-emerald-500/90 text-white hover:bg-emerald-600 flex items-center gap-1"
              title="Accept proposal"
            >
              <span className="material-symbols-outlined text-[14px] leading-none">check</span>
              Accept
            </button>
            <button
              onClick={() => onRejectPending(block.id)}
              className="px-2 py-0.5 rounded text-[11px] font-medium border border-auralis text-secondary hover:text-rose-500 hover:border-rose-400 flex items-center gap-1"
              title="Reject proposal"
            >
              <span className="material-symbols-outlined text-[14px] leading-none">close</span>
              Reject
            </button>
          </div>
        </div>
      )}
      {!isPending && (
        <button
          onClick={() => onDeleteBlock(block.id)}
          className="absolute -right-7 top-1 w-6 h-6 rounded-md flex items-center justify-center text-secondary opacity-0 group-hover:opacity-100 hover:text-rose-500 hover:bg-rose-500/10 transition-all"
          title="Delete"
          aria-label="Delete block"
        >
          <span className="material-symbols-outlined text-[16px]">delete</span>
        </button>
      )}
      {showHeading && (
        <div
          ref={headingRef}
          contentEditable={editable}
          suppressContentEditableWarning
          role="textbox"
          aria-label="Block heading"
          onBlur={commitHeading}
          onInput={commitHeading}
          onCompositionStart={() => { composingHeading.current = true; }}
          onCompositionEnd={() => { composingHeading.current = false; commitHeading(); }}
          className="outline-none text-primary mb-0.5 font-medium text-[15px] empty:before:content-['Heading…'] empty:before:text-secondary/40"
        />
      )}
      <div
        ref={bodyRef}
        contentEditable={editable}
        suppressContentEditableWarning
        role="textbox"
        aria-multiline="true"
        aria-label="Block body"
        onBlur={commitBody}
        onInput={commitBody}
        onCompositionStart={() => { composingBody.current = true; }}
        onCompositionEnd={() => { composingBody.current = false; commitBody(); }}
        className="outline-none text-primary text-[14px] leading-relaxed empty:before:content-['Write_or_speak…'] empty:before:[white-space:pre] empty:before:text-secondary/40"
        style={{ whiteSpace: "pre-wrap" }}
      />
      {isPending && block.rationale && (
        <p className="mt-1.5 text-[11px] text-emerald-700/80 italic">{block.rationale}</p>
      )}
    </div>
  );
}
