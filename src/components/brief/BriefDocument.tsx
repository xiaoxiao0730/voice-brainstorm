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
  // 1. 将所有节点按 orderKey 压平排序，不按 slot 分组隔离，实现大无界画布
  const sortedBlocks = useMemo(() => {
    return Object.values(doc).sort((a, b) => a.orderKey.localeCompare(b.orderKey));
  }, [doc]);

  const allEmpty = sortedBlocks.length === 0;

  return (
    <div className="max-w-3xl mx-auto px-6 pb-32 space-y-6 text-slate-800 dark:text-slate-100 selection:bg-green-500/20">
      {allEmpty && (
        <div className="text-center py-12">
          <h3 className="text-3xl font-light text-primary mb-2" style={{ fontFamily: "Instrument Serif, serif" }}>
            A canvas for thinking aloud.
          </h3>
          <p className="text-sm text-secondary">
            Start speaking — the canvas will flow naturally as your thoughts evolve.
          </p>
        </div>
      )}

      {/* 2. 移除所有的大外壳卡片、边框、阴影，整页变成纯粹连续流式排版 */}
      <div className="prose prose-slate max-w-none space-y-6">
        {sortedBlocks.map((block) => {
          const isPending = block.status === "pending_approval";

          return (
            <div
              key={block.id}
              className={`group relative transition-all duration-200 rounded px-3 py-1 -mx-3 ${
                isPending
                  ? "bg-green-500/5 border-l-2 border-green-500/60" // VSCode 新增高亮
                  : "hover:bg-slate-500/5"
              }`}
            >
              {/* 3. 100% 全页面内容可原地修改：把标题和正文全部替换为全透明的 textarea */}
              {block.heading && (
                <textarea
                  className="w-full bg-transparent border-none p-0 focus:ring-0 resize-none font-medium text-xl text-slate-900 dark:text-white tracking-tight focus:outline-none placeholder-slate-300"
                  style={{ fontFamily: "Instrument Serif, serif" }}
                  rows={1}
                  value={block.heading}
                  onChange={(e) => onEditBlock(block.id, { heading: e.target.value })}
                  onFocus={() => onFocusBlock?.(block.id)}
                  onBlur={() => onFocusBlock?.(null)}
                  placeholder="Heading..."
                />
              )}

              {block.body && (
                <textarea
                  className={`w-full bg-transparent border-none p-0 focus:ring-0 resize-none text-base leading-relaxed text-slate-600 dark:text-slate-300 focus:outline-none placeholder-slate-300 ${
                    isPending ? "text-slate-800 font-medium" : ""
                  }`}
                  style={{ fontFamily: "sans-serif" }}
                  rows={Math.max(1, block.body.split("\n").length)}
                  value={block.body}
                  onChange={(e) => onEditBlock(block.id, { body: e.target.value })}
                  onFocus={() => onFocusBlock?.(block.id)}
                  onBlur={() => onFocusBlock?.(null)}
                  placeholder="Start writing or speaking..."
                />
              )}

              {/* 4. VSCode 风格微型悬浮工具栏 */}
              <div className="absolute right-2 top-1 opacity-0 group-hover:opacity-100 transition-opacity flex items-center gap-1.5 bg-background/80 backdrop-blur-sm shadow-sm border rounded px-1.5 py-0.5 text-xs">
                {isPending ? (
                  <>
                    <button
                      onClick={() => onAcceptPending(block.id)}
                      className="text-green-600 hover:text-green-700 font-medium px-1"
                    >
                      Keep
                    </button>
                    <span className="text-slate-300">|</span>
                    <button
                      onClick={() => onRejectPending(block.id)}
                      className="text-rose-600 hover:text-rose-700 px-1"
                    >
                      Undo
                    </button>
                  </>
                ) : (
                  <button onClick={() => onDeleteBlock(block.id)} className="text-slate-400 hover:text-rose-600 px-1">
                    Delete
                  </button>
                )}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
