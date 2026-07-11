import { createFileRoute } from "@tanstack/react-router";
import { useMemo, useState } from "react";

export const Route = createFileRoute("/mindmap-preview")({
  head: () => ({
    meta: [
      { title: "Mind map · reference" },
      { name: "description", content: "Radial mind map reference layout with bullet-carrying nodes." },
    ],
  }),
  component: MindMapPreview,
});

type Bullet = { text: string; hint?: string };
type SubNode = { label: string; tone?: "idea" | "todo" | "question" };
type Branch = {
  id: string;
  title: string;
  tag?: string;
  accent: string; // hex for the tiny accent dot
  bullets: Bullet[];
  subs?: SubNode[];
};

const FOCUS = {
  title: "KitKit",
  subtitle: "AI-native product thinking canvas",
};

const BRANCHES: Branch[] = [
  {
    id: "product",
    title: "产品定义",
    tag: "Definition",
    accent: "#7c9cff",
    bullets: [
      { text: "面向独立开发者 & 早期 PM", hint: "not enterprise" },
      { text: "从"想法"到"可行方案"的中间层" },
      { text: "非白板、非文档 — 而是"思考轨迹"" },
    ],
    subs: [
      { label: "目标用户", tone: "idea" },
      { label: "痛点验证", tone: "question" },
    ],
  },
  {
    id: "core",
    title: "核心交互",
    tag: "Interaction",
    accent: "#e59a4a",
    bullets: [
      { text: "语音输入 → 结构化 brief" },
      { text: "选中内容一键生成思维导图" },
      { text: "Keep / Undo 粒度到"一次思考"" },
    ],
    subs: [
      { label: "信息架构", tone: "idea" },
      { label: "手势 & 快捷键", tone: "todo" },
    ],
  },
  {
    id: "tech",
    title: "技术",
    tag: "Tech",
    accent: "#5fbf7a",
    bullets: [
      { text: "TanStack Start + Supabase" },
      { text: "AI Gateway: Gemini 3 Flash / GPT-5" },
      { text: "Realtime STT via Azure" },
    ],
    subs: [
      { label: "架构选型", tone: "idea" },
      { label: "AI 能力边界", tone: "question" },
      { label: "性能与体验", tone: "todo" },
    ],
  },
  {
    id: "biz",
    title: "商业化",
    tag: "Business",
    accent: "#c48ad6",
    bullets: [
      { text: "免费额度 → Pro 订阅" },
      { text: "以"每次深度思考"计费而非 token" },
      { text: "团队版共享 canvas" },
    ],
    subs: [
      { label: "付费时机", tone: "question" },
      { label: "定价模型", tone: "idea" },
    ],
  },
  {
    id: "growth",
    title: "增长与品牌",
    tag: "Growth",
    accent: "#d76b6b",
    bullets: [
      { text: "内容驱动:  独立开发者社区" },
      { text: "作品即传播 — 分享 canvas 链接" },
      { text: "冷启动: 100 位深度用户" },
    ],
    subs: [
      { label: "品牌叙事", tone: "idea" },
      { label: "内容策略", tone: "todo" },
    ],
  },
  {
    id: "market",
    title: "竞争格局",
    tag: "Market",
    accent: "#4fb0a8",
    bullets: [
      { text: "vs Notion AI: 更专注"思考"而非"文档"" },
      { text: "vs Whimsical: 语音优先、AI 原生" },
      { text: "vs Granola: 面向个人创造而非会议" },
    ],
    subs: [
      { label: "差异化", tone: "idea" },
      { label: "moat", tone: "question" },
    ],
  },
];

// Fixed geometry — the whole point is stability.
const CENTER = { x: 640, y: 460 };
const R_MAIN = 300; // main branch card distance from center
const R_SUB = 150; // sub-node distance from main card
const CARD_W = 220;
const CARD_H_MIN = 130;

function polar(cx: number, cy: number, r: number, angleDeg: number) {
  const a = ((angleDeg - 90) * Math.PI) / 180;
  return { x: cx + r * Math.cos(a), y: cy + r * Math.sin(a) };
}

// Cubic bezier that eases out of center and into the card.
function curvePath(x1: number, y1: number, x2: number, y2: number) {
  const mx = (x1 + x2) / 2;
  const my = (y1 + y2) / 2;
  const dx = x2 - x1;
  const dy = y2 - y1;
  // perpendicular offset for a gentle sway
  const nx = -dy;
  const ny = dx;
  const len = Math.hypot(nx, ny) || 1;
  const bow = 18;
  const bx = mx + (nx / len) * bow;
  const by = my + (ny / len) * bow;
  return `M ${x1} ${y1} Q ${bx} ${by} ${x2} ${y2}`;
}

const toneStyles: Record<NonNullable<SubNode["tone"]>, string> = {
  idea: "bg-surface border-auralis text-primary",
  todo: "bg-[#1A1A1A] border-[#1A1A1A] text-white",
  question: "bg-surface border-dashed border-secondary text-secondary",
};

function MindMapPreview() {
  const [openId, setOpenId] = useState<string | null>(null);

  const laid = useMemo(() => {
    const n = BRANCHES.length;
    const step = 360 / n;
    return BRANCHES.map((b, i) => {
      const angle = i * step; // 0 = top, clockwise
      const cardCenter = polar(CENTER.x, CENTER.y, R_MAIN, angle);
      const subs = (b.subs ?? []).map((s, si) => {
        const spread = 32; // deg between sub-nodes
        const subCount = b.subs!.length;
        const subAngle = angle + (si - (subCount - 1) / 2) * spread;
        const pos = polar(CENTER.x, CENTER.y, R_MAIN + R_SUB, subAngle);
        return { ...s, pos, subAngle };
      });
      return { branch: b, angle, cardCenter, subs };
    });
  }, []);

  return (
    <div className="min-h-screen w-full bg-background text-primary">
      {/* Header */}
      <header className="border-b border-auralis bg-surface/70 backdrop-blur sticky top-0 z-10">
        <div className="max-w-[1400px] mx-auto px-6 py-3 flex items-center justify-between">
          <div className="flex items-baseline gap-3">
            <h1 className="font-h1 text-2xl leading-none">Mind map</h1>
            <span className="text-xs text-secondary">radial reference · fixed geometry</span>
          </div>
          <div className="flex items-center gap-2">
            <button className="h-8 px-3 rounded-md border border-auralis bg-surface text-xs hover:bg-surface-variant">
              + Add branch
            </button>
            <button className="h-8 px-3 rounded-md border border-auralis bg-surface text-xs hover:bg-surface-variant">
              Export
            </button>
            <button className="h-8 px-3 rounded-md bg-primary text-on-primary text-xs">
              Focus mode
            </button>
          </div>
        </div>
      </header>

      {/* Canvas */}
      <div className="relative mx-auto" style={{ width: 1280, height: 920 }}>
        {/* Subtle grid */}
        <div
          className="absolute inset-0 pointer-events-none opacity-[0.35]"
          style={{
            backgroundImage:
              "linear-gradient(#eeece6 1px, transparent 1px), linear-gradient(90deg, #eeece6 1px, transparent 1px)",
            backgroundSize: "32px 32px",
          }}
        />

        {/* SVG connectors */}
        <svg
          className="absolute inset-0"
          width={1280}
          height={920}
          viewBox="0 0 1280 920"
          fill="none"
        >
          <defs>
            <radialGradient id="focus-halo" cx="50%" cy="50%" r="50%">
              <stop offset="0%" stopColor="#1A1A1A" stopOpacity="0.06" />
              <stop offset="70%" stopColor="#1A1A1A" stopOpacity="0" />
            </radialGradient>
          </defs>
          <circle cx={CENTER.x} cy={CENTER.y} r={140} fill="url(#focus-halo)" />

          {laid.map(({ branch, cardCenter, subs }) => {
            // connector from center to card edge (approx — use unit vector back CARD_W/2)
            const dx = cardCenter.x - CENTER.x;
            const dy = cardCenter.y - CENTER.y;
            const len = Math.hypot(dx, dy) || 1;
            const shrink = 62; // stop short of the card
            const ex = cardCenter.x - (dx / len) * shrink;
            const ey = cardCenter.y - (dy / len) * shrink;
            const sx = CENTER.x + (dx / len) * 46; // start outside focus node
            const sy = CENTER.y + (dy / len) * 46;

            return (
              <g key={branch.id}>
                <path
                  d={curvePath(sx, sy, ex, ey)}
                  stroke="#c9c6bd"
                  strokeWidth={1.25}
                  strokeLinecap="round"
                  fill="none"
                />
                {subs.map((s, i) => {
                  const ddx = s.pos.x - cardCenter.x;
                  const ddy = s.pos.y - cardCenter.y;
                  const dlen = Math.hypot(ddx, ddy) || 1;
                  const s2x = cardCenter.x + (ddx / dlen) * 58;
                  const s2y = cardCenter.y + (ddy / dlen) * 58;
                  const e2x = s.pos.x - (ddx / dlen) * 24;
                  const e2y = s.pos.y - (ddy / dlen) * 24;
                  return (
                    <path
                      key={i}
                      d={curvePath(s2x, s2y, e2x, e2y)}
                      stroke="#dcd9d0"
                      strokeWidth={1}
                      strokeLinecap="round"
                      fill="none"
                      strokeDasharray="2 4"
                    />
                  );
                })}
              </g>
            );
          })}
        </svg>

        {/* Focus node */}
        <div
          className="absolute rounded-full border-[1.5px] border-primary bg-surface shadow-[0_8px_30px_-12px_rgba(0,0,0,0.15)] flex flex-col items-center justify-center text-center"
          style={{
            width: 130,
            height: 130,
            left: CENTER.x - 65,
            top: CENTER.y - 65,
          }}
        >
          <div className="font-h1 text-xl leading-tight">{FOCUS.title}</div>
          <div className="text-[10px] text-secondary mt-1 px-3 leading-snug">
            {FOCUS.subtitle}
          </div>
        </div>

        {/* Main branch cards */}
        {laid.map(({ branch, cardCenter, subs }) => {
          const isOpen = openId === branch.id;
          return (
            <div key={branch.id}>
              <button
                onClick={() => setOpenId(isOpen ? null : branch.id)}
                className={`absolute text-left rounded-xl border bg-surface transition-all
                  ${isOpen ? "border-primary shadow-[0_12px_40px_-12px_rgba(0,0,0,0.2)] -translate-y-0.5" : "border-auralis shadow-[0_4px_16px_-8px_rgba(0,0,0,0.1)] hover:-translate-y-0.5"}
                `}
                style={{
                  width: CARD_W,
                  minHeight: CARD_H_MIN,
                  left: cardCenter.x - CARD_W / 2,
                  top: cardCenter.y - CARD_H_MIN / 2,
                }}
              >
                <div className="px-3.5 pt-3 pb-2 flex items-center justify-between border-b border-auralis/70">
                  <div className="flex items-center gap-2 min-w-0">
                    <span
                      className="w-2 h-2 rounded-full shrink-0"
                      style={{ background: branch.accent }}
                    />
                    <span className="text-[13px] font-medium truncate">{branch.title}</span>
                  </div>
                  {branch.tag && (
                    <span className="text-[9px] uppercase tracking-wider text-secondary ml-2 shrink-0">
                      {branch.tag}
                    </span>
                  )}
                </div>
                <ul className="px-3.5 py-2.5 space-y-1.5">
                  {branch.bullets.map((b, i) => (
                    <li key={i} className="flex gap-1.5 text-[11.5px] leading-snug text-primary/85">
                      <span className="text-secondary shrink-0">·</span>
                      <span className="min-w-0">
                        {b.text}
                        {b.hint && (
                          <span className="text-secondary italic ml-1">— {b.hint}</span>
                        )}
                      </span>
                    </li>
                  ))}
                </ul>
              </button>

              {/* Sub nodes */}
              {subs.map((s, i) => (
                <div
                  key={i}
                  className={`absolute rounded-full px-2.5 py-1 text-[10.5px] border whitespace-nowrap shadow-sm ${toneStyles[s.tone ?? "idea"]}`}
                  style={{
                    left: s.pos.x,
                    top: s.pos.y,
                    transform: "translate(-50%, -50%)",
                  }}
                >
                  {s.label}
                </div>
              ))}
            </div>
          );
        })}
      </div>

      {/* Legend */}
      <div className="max-w-[1400px] mx-auto px-6 pb-10 -mt-4">
        <div className="flex flex-wrap items-center gap-x-5 gap-y-2 text-[11px] text-secondary">
          <span className="flex items-center gap-1.5">
            <span className="w-4 h-4 rounded-full border-[1.5px] border-primary bg-surface inline-block" />
            Focus (L0)
          </span>
          <span className="flex items-center gap-1.5">
            <span className="w-4 h-4 rounded border border-auralis bg-surface inline-block" />
            Topic card with bullets (L1)
          </span>
          <span className="flex items-center gap-1.5">
            <span className="w-4 h-4 rounded-full border border-auralis bg-surface inline-block" />
            Idea sub-node (L2)
          </span>
          <span className="flex items-center gap-1.5">
            <span className="w-4 h-4 rounded-full border border-[#1A1A1A] bg-[#1A1A1A] inline-block" />
            Todo
          </span>
          <span className="flex items-center gap-1.5">
            <span className="w-4 h-4 rounded-full border border-dashed border-secondary bg-surface inline-block" />
            Question
          </span>
          <span className="ml-auto">
            Geometry: 6 branches · 60° spacing · main radius 300px · sub radius +150px
          </span>
        </div>
      </div>
    </div>
  );
}
