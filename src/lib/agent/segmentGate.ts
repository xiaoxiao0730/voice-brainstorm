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

export function assessDensity(
  segmentText: string,
  recentTexts: readonly string[],
): DensityVerdict {
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
