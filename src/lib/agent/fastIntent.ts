// Rule-based fast intent router. Runs client-side on every committed
// Azure segment in parallel with the slow background reasoning loop.
// No LLM calls — keep it sub-millisecond.

export type FastIntent =
  | "greeting"
  | "simple_direct_question"
  | "structural_deep_question"
  | "control_listen"
  | "control_guide"
  | "control_answer"
  | "control_mute"
  | "control_resume"
  | "light_guidance_request"
  | "thinking_aloud"
  | "request_summary"
  | "unknown";

const CONTROL_LISTEN = [
  /先别打断我/, /别说话/, /别打断/, /让我想想/, /让我自己想/, /安静/,
  /\blet me think\b/i, /\bbe quiet\b/i, /\bdon'?t interrupt\b/i, /\bstop talking\b/i,
];

const CONTROL_GUIDE = [
  /你可以边听边问/, /可以打断我/, /可以问我/, /随时打断/,
  /\byou can interrupt\b/i, /\bask me\b.*\b(while|as)\b/i, /\bguide me\b/i,
];

const CONTROL_ANSWER = [
  /你觉得呢/, /你怎么看/, /给点建议/, /帮我想想/, /给我一个答案/,
  /\bwhat do you think\b/i, /\byour opinion\b/i, /\bgive me an answer\b/i,
];

const CONTROL_MUTE = [
  /^(静音|闭嘴|stop|pause|mute|shut up)[\s。！!.]*$/i,
  /^(停一下|先停|先暂停)/,
];

const CONTROL_RESUME = [
  /^(继续|开始吧|resume|continue|go on|keep going)[\s。！!.]*$/i,
];

const GREETING = [
  /^(hi|hello|hey|yo|hiya|hey there)[\s,!.?]*$/i,
  /^(你好|您好|哈喽|嗨)[\s，！。？?]*$/,
  /^(在吗|你在吗|are you there|you there)[\s，！。？?]*$/i,
  /^(thanks?|thank you|谢谢|多谢)[\s，！。？?]*$/i,
];

const STRUCTURAL_MARKERS = [
  /how should i (structure|organi[sz]e|frame|approach)/i,
  /what'?s missing/i,
  /what should (i|we) (do next|focus on)/i,
  /帮我(整理|结构化|梳理|理一下)/,
  /怎么(组织|结构|安排|拆分)/,
  /还差什么/, /缺什么/,
];

const SUMMARY_MARKERS = [
  /^(总结一下|帮我总结|summari[sz]e|give me a summary)/i,
  /\brecap\b/i, /\bsummary\b/i,
];

const LIGHT_GUIDE_MARKERS = [
  /^(给我个|给我一个|提示一下|hint|nudge|prompt me|help me get started)/i,
  /^(我不知道(从哪|怎么)开始|i don'?t know where to (start|begin))/i,
];

function wordCount(s: string): number {
  // Mixed CJK + latin — count chinese chars + latin words.
  const cjk = (s.match(/[\u3400-\u9fff]/g) ?? []).length;
  const latin = (s.trim().match(/[A-Za-z]+/g) ?? []).length;
  return cjk + latin;
}

function isQuestion(s: string): boolean {
  return /[?？]/.test(s) || /^(what|why|how|when|where|who|is|are|can|does|do|should)\b/i.test(s.trim());
}

export type ClassifyResult = { intent: FastIntent; matched?: string };

export function classifyFastIntent(text: string): ClassifyResult {
  const t = text.trim();
  if (!t) return { intent: "unknown" };

  // 1. Controls (highest priority)
  for (const r of CONTROL_LISTEN) if (r.test(t)) return { intent: "control_listen", matched: r.source };
  for (const r of CONTROL_GUIDE) if (r.test(t)) return { intent: "control_guide", matched: r.source };
  for (const r of CONTROL_MUTE) if (r.test(t)) return { intent: "control_mute", matched: r.source };
  for (const r of CONTROL_RESUME) if (r.test(t)) return { intent: "control_resume", matched: r.source };

  // 2. Greetings
  for (const r of GREETING) if (r.test(t)) return { intent: "greeting", matched: r.source };

  // 3. Summary / light guidance / structural deep — check before answer/question
  for (const r of SUMMARY_MARKERS) if (r.test(t)) return { intent: "request_summary", matched: r.source };
  for (const r of STRUCTURAL_MARKERS) if (r.test(t)) return { intent: "structural_deep_question", matched: r.source };
  for (const r of LIGHT_GUIDE_MARKERS) if (r.test(t)) return { intent: "light_guidance_request", matched: r.source };

  // 4. "你觉得呢" style → answer-mode request, treated as simple direct question
  for (const r of CONTROL_ANSWER) if (r.test(t)) return { intent: "simple_direct_question", matched: r.source };

  const wc = wordCount(t);
  const q = isQuestion(t);

  // 5. Short direct question
  if (q && wc <= 12) return { intent: "simple_direct_question" };

  // 6. Long question with structural feel
  if (q && wc > 12) return { intent: "structural_deep_question" };

  // 7. Long declarative → thinking aloud
  if (!q && wc >= 6) return { intent: "thinking_aloud" };

  // 8. Otherwise unknown (could fall back to LLM later)
  return { intent: "unknown" };
}

// Lightweight canned reply composer for the fast lane. Keeps the
// "feels immediate" promise without an LLM round-trip for trivial cases.
// Returns null when we should hand off to the gateway for a real answer.
export function fastCannedReply(intent: FastIntent, text: string): string | null {
  const zh = /[\u3400-\u9fff]/.test(text);
  switch (intent) {
    case "greeting":
      return zh ? "在的，你说。" : "Hey, I'm here. Go ahead.";
    case "control_listen":
      return zh ? "好，我安静听着。" : "Okay, I'll stay quiet.";
    case "control_guide":
      return zh ? "好，我会偶尔提点问题。" : "Got it — I'll chime in when useful.";
    case "control_answer":
      return zh ? "好，我直接说想法。" : "Okay, I'll give you my take.";
    case "control_mute":
      return null; // no verbal reply; just stop talking
    case "control_resume":
      return zh ? "好。" : "Okay.";
    case "request_summary":
      return zh ? "好，我整理一下。" : "On it — let me pull it together.";
    case "structural_deep_question":
      return zh ? "好，让我看看。" : "Let me look at the brief.";
    default:
      return null;
  }
}
