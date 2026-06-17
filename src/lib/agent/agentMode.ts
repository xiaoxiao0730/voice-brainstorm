// Agent mode: controls how aggressively the fast lane speaks up.
// Persisted per session in localStorage.

export type AgentMode = "listen" | "guide" | "answer";

const KEY_PREFIX = "murmur.agent.mode.";

export function loadAgentMode(sessionId: string | null | undefined): AgentMode {
  if (!sessionId || typeof window === "undefined") return "guide";
  try {
    const raw = window.localStorage.getItem(KEY_PREFIX + sessionId);
    if (raw === "listen" || raw === "guide" || raw === "answer") return raw;
  } catch { /* ignore */ }
  return "guide";
}

export function saveAgentMode(sessionId: string | null | undefined, mode: AgentMode): void {
  if (!sessionId || typeof window === "undefined") return;
  try { window.localStorage.setItem(KEY_PREFIX + sessionId, mode); } catch { /* ignore */ }
}

export const MODE_LABEL: Record<AgentMode, string> = {
  listen: "Listen",
  guide: "Guide",
  answer: "Answer",
};

export const MODE_DESCRIPTION: Record<AgentMode, string> = {
  listen: "Stay quiet — organize in background only",
  guide: "Ask short guiding questions when useful",
  answer: "Answer directly when I ask",
};
