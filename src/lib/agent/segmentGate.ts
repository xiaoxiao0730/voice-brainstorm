// Density gate for the Background Canvas Lane.
//
// Decides whether a committed STT segment is "substantive" enough to warrant
// a deep-model call. Pure function: no IO, no model access.

const FILLER_PATTERNS = [
  /^(嗯+|啊+|呃+|那个|然后|就是|对|好|好的|ok|okay|yeah|yes|no|hm+|um+|uh+)\W*$/i,
  /^(stop|start|继续|开始|结束)\W*$/i,
];

function normalize(s: string) {
  return s.trim().replace(/\s+/g, " ");
}

function similarityRatio(a: string, b: string) {
  const sa = new Set(a.split(""));
  const sb = new Set(b.split(""));
  if (sa.size === 0 || sb.size === 0) return 0;
  let common = 0;
  for (const ch of sa) if (sb.has(ch)) common++;
  return common / Math.min(sa.size, sb.size);
}

export type DensityVerdict = {
  substantive: boolean;
  reason: string;
};

function cjkCount(text: string): number {
  let count = 0;
  for (const ch of text) {
    const c = ch.codePointAt(0)!;
    if ((c >= 0x4e00 && c <= 0x9fff) || (c >= 0x3400 && c <= 0x4dbf)) count++;
  }
  return count;
}

function wordCount(text: string): number {
  return text.split(/\s+/).filter(Boolean).length;
}

export function assessDensity(segmentText: string, recentTexts: readonly string[]): DensityVerdict {
  const text = normalize(segmentText);
  if (text.length < 8) return { substantive: false, reason: "too_short" };
  if (FILLER_PATTERNS.some((re) => re.test(text))) {
    return { substantive: false, reason: "filler" };
  }
  // High overlap with recent → likely repetition
  for (const r of recentTexts.slice(-3)) {
    if (!r) continue;
    if (similarityRatio(text, normalize(r)) > 0.85) {
      return { substantive: false, reason: "repeat" };
    }
  }
  return { substantive: true, reason: "ok" };
}

export function assessMindMapTrigger(
  segmentText: string,
  recentTexts: readonly string[],
): DensityVerdict {
  const base = assessDensity(segmentText, recentTexts);
  if (!base.substantive) return base;

  const text = normalize(segmentText);
  const cjk = cjkCount(text);
  const words = wordCount(text);
  const hasStructureCue =
    /[?？]|\b(because|so|but|however|maybe|should|could|need|risk|problem|idea|option|next)\b/i.test(
      text,
    ) || /因为|所以|但是|可能|需要|问题|风险|方案|想法|选择|下一步|场景|用户|目标/.test(text);

  if (cjk >= 18 || words >= 9) return { substantive: true, reason: "ok" };
  if (hasStructureCue && (cjk >= 10 || words >= 6)) return { substantive: true, reason: "ok" };

  return { substantive: false, reason: "too_shallow_for_mindmap" };
}
