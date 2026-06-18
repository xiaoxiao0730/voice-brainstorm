// Minimal throttle for the Background Canvas Lane.
//
// Stage 3 architecture removes the old fast/voice mutex. The canvas lane is
// no longer gated by whether the Realtime voice agent is speaking — the two
// pipelines run truly in parallel. We only keep a small per-session debounce
// so a fast burst of short segments doesn't spam the brief with near-empty
// patches.

export type FeedbackSignal =
  | "accepted"
  | "ignored"
  | "dismissed"
  | "edited_after"
  | "corrected"
  | "requested_more";

type PolicyState = {
  lastCanvasAt: number;
  recentFeedback: FeedbackSignal[]; // newest last, capped at 8
  consecutiveDismissed: number;
};

export type PolicyEngine = {
  shouldEmitCanvas: () => boolean;
  recordCanvas: () => void;
  recordFeedback: (signal: FeedbackSignal) => void;
  snapshot: () => PolicyState;
};

const MIN_CANVAS_GAP_MS = 4_000;
const NEGATIVE_PENALTY_MULT = 2;
const STORAGE_PREFIX = "murmur.agent.policy.v3.";

function storageKey(sessionId: string | null | undefined) {
  return sessionId ? `${STORAGE_PREFIX}${sessionId}` : null;
}

function loadPersisted(sessionId: string | null | undefined): PolicyState | null {
  const key = storageKey(sessionId);
  if (!key || typeof window === "undefined") return null;
  try {
    const raw = window.localStorage.getItem(key);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as Partial<PolicyState>;
    return {
      lastCanvasAt: Number(parsed.lastCanvasAt) || 0,
      recentFeedback: Array.isArray(parsed.recentFeedback)
        ? (parsed.recentFeedback.slice(-8) as FeedbackSignal[])
        : [],
      consecutiveDismissed: Number(parsed.consecutiveDismissed) || 0,
    };
  } catch {
    return null;
  }
}

function persist(sessionId: string | null | undefined, state: PolicyState) {
  const key = storageKey(sessionId);
  if (!key || typeof window === "undefined") return;
  try { window.localStorage.setItem(key, JSON.stringify(state)); } catch { /* ignore */ }
}

export function createPolicyEngine(sessionId?: string | null): PolicyEngine {
  const state: PolicyState = loadPersisted(sessionId) ?? {
    lastCanvasAt: 0,
    recentFeedback: [],
    consecutiveDismissed: 0,
  };

  const save = () => persist(sessionId, state);

  const recentlyNegative = () => {
    const last3 = state.recentFeedback.slice(-3);
    return last3.some((f) => f === "dismissed" || f === "corrected" || f === "ignored");
  };

  return {
    shouldEmitCanvas: () => {
      const penalty = recentlyNegative() ? NEGATIVE_PENALTY_MULT : 1;
      return Date.now() - state.lastCanvasAt >= MIN_CANVAS_GAP_MS * penalty;
    },
    recordCanvas: () => {
      state.lastCanvasAt = Date.now();
      save();
    },
    recordFeedback: (signal) => {
      state.recentFeedback.push(signal);
      if (state.recentFeedback.length > 8) state.recentFeedback.shift();
      if (signal === "dismissed" || signal === "ignored") {
        state.consecutiveDismissed += 1;
      } else if (signal === "accepted" || signal === "requested_more" || signal === "edited_after") {
        state.consecutiveDismissed = 0;
      }
      save();
    },
    snapshot: () => ({
      lastCanvasAt: state.lastCanvasAt,
      recentFeedback: [...state.recentFeedback],
      consecutiveDismissed: state.consecutiveDismissed,
    }),
  };
}
