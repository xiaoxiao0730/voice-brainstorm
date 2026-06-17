// Client-side decision layer with persisted cooldown state (per session).
// Two-lane architecture: fast lane (greetings, direct Qs, controls) and
// structural lane (Live Brief reasoning). Cooldowns are tracked separately
// so a fast greeting never silences a structural canvas suggestion.

import type { ThinkingState } from "./thinkingState.functions";

export type InterventionLevel = "silent" | "text" | "voice";
export type BackgroundDecision = "silent" | "text_suggestion" | "canvas_suggestion" | "voice";

export type FeedbackSignal =
  | "accepted"
  | "ignored"
  | "dismissed"
  | "edited_after"
  | "corrected"
  | "requested_more";

type LaneState = {
  lastInterventionAt: number;
  lastVoiceAt: number;
};

type PolicyState = {
  structural: LaneState;
  fast: LaneState;
  recentFeedback: FeedbackSignal[]; // newest last, capped at 8
  consecutiveDismissed: number;
};

export type PolicyEngine = {
  // Background lane: returns one of the 4 BackgroundDecision values.
  decideStructural: (state: ThinkingState, confidence: number) => BackgroundDecision;
  recordStructural: (decision: BackgroundDecision) => void;
  recordFast: () => void;
  isFastRecent: (windowMs?: number) => boolean;
  recordFeedback: (signal: FeedbackSignal) => void;
  snapshot: () => PolicyState;
};

const MIN_VOICE_GAP_MS = 60_000;       // stuck / explicit
const SOFT_VOICE_GAP_MS = 120_000;     // contradiction / missing_structure (rarely voice now)
const MIN_TEXT_GAP_MS = 15_000;
const MIN_CANVAS_GAP_MS = 30_000;
const NEGATIVE_PENALTY_MULT = 2;

const STORAGE_PREFIX = "murmur.agent.policy.v2.";

function storageKey(sessionId: string | null | undefined) {
  return sessionId ? `${STORAGE_PREFIX}${sessionId}` : null;
}

function emptyLane(): LaneState {
  return { lastInterventionAt: 0, lastVoiceAt: 0 };
}

function loadPersisted(sessionId: string | null | undefined): PolicyState | null {
  const key = storageKey(sessionId);
  if (!key || typeof window === "undefined") return null;
  try {
    const raw = window.localStorage.getItem(key);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as Partial<PolicyState>;
    return {
      structural: { ...emptyLane(), ...(parsed.structural ?? {}) },
      fast: { ...emptyLane(), ...(parsed.fast ?? {}) },
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
  const persisted = loadPersisted(sessionId);
  const state: PolicyState = persisted ?? {
    structural: emptyLane(),
    fast: emptyLane(),
    recentFeedback: [],
    consecutiveDismissed: 0,
  };

  const save = () => persist(sessionId, state);

  const recentlyNegative = () => {
    const last3 = state.recentFeedback.slice(-3);
    return last3.some((f) => f === "dismissed" || f === "corrected" || f === "ignored");
  };

  const decideStructural = (thinkingState: ThinkingState, confidence: number): BackgroundDecision => {
    const now = Date.now();
    const s = state.structural;
    const sinceVoice = now - s.lastVoiceAt;
    const sinceAny = now - s.lastInterventionAt;
    const penalty = recentlyNegative() ? NEGATIVE_PENALTY_MULT : 1;

    switch (thinkingState) {
      case "thinking_continuing":
      case "pause_but_not_done":
        return "silent";

      case "explicit_request":
        // Deep ask → allowed voice, ignore cooldown.
        return "voice";

      case "stuck": {
        if (confidence < 0.65) return "silent";
        if (sinceVoice >= MIN_VOICE_GAP_MS * penalty) return "voice";
        if (sinceAny >= MIN_TEXT_GAP_MS * penalty) return "text_suggestion";
        return "silent";
      }

      case "missing_structure": {
        if (confidence < 0.7) return "silent";
        // Prefer a canvas ghost patch over voice / text for localized structural gaps.
        if (sinceAny >= MIN_CANVAS_GAP_MS * penalty && state.consecutiveDismissed === 0) {
          return "canvas_suggestion";
        }
        if (sinceAny >= MIN_TEXT_GAP_MS * penalty) return "text_suggestion";
        return "silent";
      }

      case "contradiction_detected": {
        if (confidence < 0.7) return "silent";
        if (sinceVoice >= SOFT_VOICE_GAP_MS * penalty && state.consecutiveDismissed === 0) {
          // Rarely escalate to voice — usually a text suggestion is enough.
          return "text_suggestion";
        }
        if (sinceAny >= MIN_TEXT_GAP_MS * penalty) return "text_suggestion";
        return "silent";
      }

      default:
        return "silent";
    }
  };

  const recordStructural = (decision: BackgroundDecision) => {
    if (decision === "silent") return;
    const now = Date.now();
    state.structural.lastInterventionAt = now;
    if (decision === "voice") state.structural.lastVoiceAt = now;
    save();
  };

  const recordFast = () => {
    const now = Date.now();
    state.fast.lastInterventionAt = now;
    state.fast.lastVoiceAt = now;
    save();
  };

  const isFastRecent = (windowMs = 2_500) => {
    return Date.now() - state.fast.lastVoiceAt < windowMs;
  };

  const recordFeedback = (signal: FeedbackSignal) => {
    state.recentFeedback.push(signal);
    if (state.recentFeedback.length > 8) state.recentFeedback.shift();
    if (signal === "dismissed" || signal === "ignored") {
      state.consecutiveDismissed += 1;
    } else if (signal === "accepted" || signal === "requested_more" || signal === "edited_after") {
      state.consecutiveDismissed = 0;
    }
    save();
  };

  return {
    decideStructural,
    recordStructural,
    recordFast,
    isFastRecent,
    recordFeedback,
    snapshot: () => ({
      ...state,
      structural: { ...state.structural },
      fast: { ...state.fast },
      recentFeedback: [...state.recentFeedback],
    }),
  };
}
