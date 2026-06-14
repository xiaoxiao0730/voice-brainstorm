import { useEffect, useMemo, useRef } from "react";
import type { BriefBlock, BriefDoc } from "@/lib/pipeline/types";

type Props = {
  doc: BriefDoc;
  onEditBlock: (id: string, patch: { heading?: string; body?: string }) => void;
  onAddBlock: () => void;
  aiLoading: boolean;
};

export function BriefDocument({ doc, onEditBlock, onAddBlock, aiLoading }: Props) {
  const ordered = useMemo(
    () => Object.values(doc).sort((a, b) => a.orderKey.localeCompare(b.orderKey)),
    [doc],
  );
  const isEmpty = ordered.length === 0;

  return (
    <div className="max-w-3xl mx-auto px-4 pb-32">
      {isEmpty && (
        <div className="min-h-[50vh] flex items-center justify-center text-center">
          <div className="max-w-sm">
            <div className="mx-auto mb-4 w-12 h-12 rounded-full bg-gradient-to-tr from-rose-300 via-indigo-200 to-emerald-200" />
            <h3
              className="text-3xl text-primary mb-2"
              style={{ fontFamily: "Instrument Serif, serif" }}
            >
              A canvas for thinking aloud.
            </h3>
            <p className="text-sm text-secondary">
              Start speaking and see your ideas grow.
            </p>
          </div>
        </div>
      )}

      <article className="space-y-5">
        {ordered.map((block) => (
          <BlockRow key={block.id} block={block} onEditBlock={onEditBlock} />
        ))}
      </article>

      {!isEmpty && (
        <button
          onClick={onAddBlock}
          className="mt-6 w-full text-left px-3 py-2 rounded-md text-sm text-secondary hover:bg-surface-variant/40 hover:text-primary transition-colors"
        >
          + Add a block
        </button>
      )}

      {aiLoading && (
        <div className="mt-4 flex items-center gap-2 text-xs text-secondary px-3 py-2">
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
}: {
  block: BriefBlock;
  onEditBlock: (id: string, patch: { heading?: string; body?: string }) => void;
}) {
  const headingRef = useRef<HTMLDivElement>(null);
  const bodyRef = useRef<HTMLDivElement>(null);
  const lastHeading = useRef(block.heading);
  const lastBody = useRef(block.body);

  // Set initial DOM content once on mount — never via JSX children,
  // otherwise React reconciliation resets the caret on every keystroke
  // (which is why typing appeared "reversed").
  useEffect(() => {
    if (headingRef.current) headingRef.current.innerText = block.heading;
    if (bodyRef.current) bodyRef.current.innerText = block.body;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Sync from AI updates when the user isn't focused on this block.
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

  const headingStyle: React.CSSProperties = {
    fontFamily: "Instrument Serif, serif",
    fontSize: block.level === 1 ? 34 : block.level === 2 ? 24 : 18,
    lineHeight: 1.25,
  };

  const bodyStyle: React.CSSProperties = {
    fontFamily: "Inter, sans-serif",
    fontSize: 15,
    lineHeight: 1.65,
    whiteSpace: "pre-wrap",
  };

  const showHeading = block.heading.length > 0 || block.level <= 2;

  return (
    <section className="group relative">
      {block.locked && (
        <span className="absolute -left-4 top-2 w-1 h-[calc(100%-1rem)] rounded-full bg-amber-400/50" title="You edited this" />
      )}
      {showHeading && (
        <div
          ref={headingRef}
          contentEditable
          suppressContentEditableWarning
          role="textbox"
          aria-label="Block heading"
          onBlur={commitHeading}
          onInput={commitHeading}
          onCompositionStart={() => { composingHeading.current = true; }}
          onCompositionEnd={() => { composingHeading.current = false; commitHeading(); }}
          className="outline-none text-primary mb-1.5 empty:before:content-['Heading…'] empty:before:text-secondary/40"
          style={headingStyle}
        />
      )}
      <div
        ref={bodyRef}
        contentEditable
        suppressContentEditableWarning
        role="textbox"
        aria-multiline="true"
        aria-label="Block body"
        onBlur={commitBody}
        onInput={commitBody}
        onCompositionStart={() => { composingBody.current = true; }}
        onCompositionEnd={() => { composingBody.current = false; commitBody(); }}
        className="outline-none text-primary empty:before:content-['Write_or_speak…'] empty:before:[white-space:pre] empty:before:text-secondary/40"
        style={bodyStyle}
      />
    </section>
  );
}


