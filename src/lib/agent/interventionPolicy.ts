// Client-side decision layer with persisted cooldown state (per session).
// Decides whether the agent should stay silent, surface a text suggestion,
// or speak out loud, based on detected thinking state + recency + feedback.

import type { ThinkingState } from "./thinkingState.functions";

export type InterventionLevel = "silent" | "text" | "voice";

export type FeedbackSignal =
  | "accepted"
  | "ignored"
  | "dismissed"
  | "edited_after"
  | "corrected"
  | "requested_more";

type PolicyState = {
  lastInterventionAt: number;
  lastVoiceAt: number;
  recentFeedback: FeedbackSignal[]; // newest last, capped at 8
  consecutiveDismissed: number;
};

export type PolicyEngine = {
  decide: (state: ThinkingState, confidence: number) => InterventionLevel;
  recordIntervention: (level: InterventionLevel) => void;
  recordFeedback: (signal: FeedbackSignal) => void;
  snapshot: () => PolicyState;
};

const MIN_VOICE_GAP_MS = 45_000;       // stuck / explicit
const SOFT_VOICE_GAP_MS = 90_000;      // contradiction / missing_structure
const MIN_TEXT_GAP_MS = 12_000;
const NEGATIVE_PENALTY_MULT = 2;       // doubles cooldown after recent dismiss/correction

const STORAGE_PREFIX = "murmur.agent.policy.";

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
      lastInterventionAt: Number(parsed.lastInterventionAt) || 0,
      lastVoiceAt: Number(parsed.lastVoiceAt) || 0,
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
  try {
    window.localStorage.setItem(key, JSON.stringify(state));
  } catch {
    /* quota / unavailable — ignore */
  }
}

export function createPolicyEngine(sessionId?: string | null): PolicyEngine {
  const persisted = loadPersisted(sessionId);
  const state: PolicyState = persisted ?? {
    lastInterventionAt: 0,
    lastVoiceAt: 0,
    recentFeedback: [],
    consecutiveDismissed: 0,
  };

  const save = () => persist(sessionId, state);

  const recentlyNegative = () => {
    const last3 = state.recentFeedback.slice(-3);
    return last3.some((f) => f === "dismissed" || f === "corrected" || f === "ignored");
  };

  const decide = (thinkingState: ThinkingState, confidence: number): InterventionLevel => {
    const now = Date.now();
    const sinceVoice = now - state.lastVoiceAt;
    const sinceAny = now - state.lastInterventionAt;
    const penalty = recentlyNegative() ? NEGATIVE_PENALTY_MULT : 1;

    switch (thinkingState) {
      case "thinking_continuing":
      case "pause_but_not_done":
        return "silent";

      case "explicit_request":
        // User asked — always allowed, ignore cooldown.
        return "voice";

      case "stuck": {
        if (confidence < 0.6) return "silent";
        if (sinceVoice >= MIN_VOICE_GAP_MS * penalty) return "voice";
        if (sinceAny >= MIN_TEXT_GAP_MS * penalty) return "text";
        return "silent";
      }

      case "contradiction_detected":
      case "missing_structure": {
        if (confidence < 0.7) return "silent";
        if (sinceVoice >= SOFT_VOICE_GAP_MS * penalty && state.consecutiveDismissed === 0) {
          return "voice";
        }
        if (sinceAny >= MIN_TEXT_GAP_MS * penalty) return "text";
        return "silent";
      }

      default:
        return "silent";
    }
  };

  const recordIntervention = (level: InterventionLevel) => {
    if (level === "silent") return;
    const now = Date.now();
    state.lastInterventionAt = now;
    if (level === "voice") state.lastVoiceAt = now;
    save();
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
    decide,
    recordIntervention,
    recordFeedback,
    snapshot: () => ({ ...state, recentFeedback: [...state.recentFeedback] }),
  };
}
