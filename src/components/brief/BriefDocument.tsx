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

// A single, continuous note canvas.
// The template only seeds fixed section headings; the rest is one flowing
// document the user (and the agent) can write into freely. No boxed cards,
// no per-block borders — typography carries the structure.
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

  const allEmpty =
    Object.values(grouped.map).every((a) => a.length === 0) && grouped.orphans.length === 0;

  return (
    <article
      className="max-w-2xl mx-auto px-8 pb-32 pt-6"
      style={{ fontFamily: "'Source Serif 4', 'Source Serif Pro', 'Iowan Old Style', Georgia, serif" }}
    >
      {allEmpty && (
        <header className="mb-10">
          <h1
            className="text-4xl text-primary leading-tight mb-2"
            style={{ fontFamily: "'Instrument Serif', serif" }}
          >
            A canvas for thinking aloud.
          </h1>
          <p className="text-[15px] text-secondary italic">
            Start speaking — the page will fill itself in as you think.
          </p>
        </header>
      )}

      {template.slots.map((slot, idx) => {
        const blocks = grouped.map[slot.id] ?? [];
        const isEmpty = blocks.length === 0;
        return (
          <section key={slot.id} className={idx === 0 ? "" : "mt-10"}>
            <h2
              className="text-[26px] text-primary leading-snug mb-3 tracking-tight"
              style={{ fontFamily: "'Instrument Serif', serif" }}
            >
              {slot.title}
            </h2>
            {isEmpty ? (
              <p className="text-[14px] text-secondary/60 italic leading-relaxed">
                {slot.prompt}
              </p>
            ) : (
              <div className="space-y-4">
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
        <section className="mt-10">
          <h2
            className="text-[20px] text-secondary leading-snug mb-3 italic"
            style={{ fontFamily: "'Instrument Serif', serif" }}
          >
            Loose threads
          </h2>
          <div className="space-y-4">
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
        <div className="flex items-center gap-2 text-[12px] text-secondary mt-8 italic">
          <span className="w-1.5 h-1.5 rounded-full bg-amber-500 animate-pulse" />
          weaving…
        </div>
      )}
    </article>
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
    if (
      block.heading !== lastHeading.current &&
      headingRef.current &&
      headingRef.current !== document.activeElement
    ) {
      lastHeading.current = block.heading;
      headingRef.current.innerText = block.heading;
    }
  }, [block.heading]);

  useEffect(() => {
    if (
      block.body !== lastBody.current &&
      bodyRef.current &&
      bodyRef.current !== document.activeElement
    ) {
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
  const editable = !isPending;
  const showHeading = block.heading.length > 0;

  return (
    <div
      className={`group relative ${
        isPending ? "border-l-2 border-emerald-500/70 pl-3 py-0.5" : ""
      }`}
      onFocus={() => onFocusBlock?.(block.id)}
      onBlur={() => onFocusBlock?.(null)}
    >
      {!isPending && (
        <button
          onClick={() => onDeleteBlock(block.id)}
          className="absolute -left-7 top-1 w-6 h-6 rounded-md flex items-center justify-center text-secondary opacity-0 group-hover:opacity-100 hover:text-rose-500 hover:bg-rose-500/10 transition-all"
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
          onCompositionStart={() => {
            composingHeading.current = true;
          }}
          onCompositionEnd={() => {
            composingHeading.current = false;
            commitHeading();
          }}
          className="outline-none text-primary mb-1 text-[17px] leading-snug"
          style={{ fontFamily: "'Instrument Serif', serif" }}
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
        onCompositionStart={() => {
          composingBody.current = true;
        }}
        onCompositionEnd={() => {
          composingBody.current = false;
          commitBody();
        }}
        className="outline-none text-primary text-[16px] leading-[1.7] empty:before:content-['Write_or_speak…'] empty:before:[white-space:pre] empty:before:text-secondary/40"
        style={{ whiteSpace: "pre-wrap" }}
      />
      {isPending && (
        <div className="mt-1.5 flex items-center gap-3 text-[12px]">
          <button
            onClick={() => onAcceptPending(block.id)}
            className="text-emerald-700 hover:text-emerald-800 underline underline-offset-2 decoration-emerald-500/40 hover:decoration-emerald-700"
          >
            keep
          </button>
          <button
            onClick={() => onRejectPending(block.id)}
            className="text-secondary hover:text-rose-500 underline underline-offset-2 decoration-secondary/30 hover:decoration-rose-400"
          >
            discard
          </button>
          {block.rationale && (
            <span className="text-emerald-700/70 italic">— {block.rationale}</span>
          )}
        </div>
      )}
    </div>
  );
}
