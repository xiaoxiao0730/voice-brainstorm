import { useEffect, useState } from "react";

export type AgentStatus = "off" | "connecting" | "listening" | "thinking" | "speaking" | "error";

export type AgentSuggestion = {
  id: string;
  text: string;
  state: string;
};

type Props = {
  status: AgentStatus;
  enabled: boolean;
  onToggle: () => void;
  suggestion: AgentSuggestion | null;
  onDismiss: () => void;
  onAskOutLoud: () => void;
  onAccept: () => void;
};

const STATUS_DOT: Record<AgentStatus, string> = {
  off: "bg-secondary",
  connecting: "bg-amber-400 animate-pulse",
  listening: "bg-emerald-500",
  thinking: "bg-amber-500 animate-pulse",
  speaking: "bg-indigo-500 animate-pulse",
  error: "bg-rose-500",
};

const STATUS_LABEL: Record<AgentStatus, string> = {
  off: "Agent off",
  connecting: "Connecting…",
  listening: "Agent listening",
  thinking: "Agent thinking",
  speaking: "Agent speaking",
  error: "Agent error",
};

export function AgentStatusPill({
  status,
  enabled,
  onToggle,
}: Pick<Props, "status" | "enabled" | "onToggle">) {
  return (
    <button
      onClick={onToggle}
      className="flex items-center gap-2 px-3 py-1 rounded-full border border-auralis bg-surface hover:bg-surface-variant text-xs text-primary"
      aria-label={enabled ? "Turn agent off" : "Turn agent on"}
      title={enabled ? "Turn agent off" : "Turn agent on"}
    >
      <span className={`w-1.5 h-1.5 rounded-full ${STATUS_DOT[status]}`} />
      <span>{STATUS_LABEL[status]}</span>
    </button>
  );
}

export function AgentSuggestionCard({
  suggestion,
  onDismiss,
  onAskOutLoud,
  onAccept,
}: Pick<Props, "suggestion" | "onDismiss" | "onAskOutLoud" | "onAccept">) {
  // Auto-dismiss after 25s = treated as "ignored" by the parent.
  const [, force] = useState(0);
  useEffect(() => {
    if (!suggestion) return;
    const t = setTimeout(() => onDismiss(), 25_000);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [suggestion?.id]);

  useEffect(() => {
    const i = setInterval(() => force((n) => n + 1), 1000);
    return () => clearInterval(i);
  }, []);

  if (!suggestion) return null;

  return (
    <div className="fixed bottom-6 right-6 z-40 max-w-sm bg-surface border border-auralis rounded-2xl shadow-lg p-4 animate-in fade-in slide-in-from-bottom-2">
      <div className="flex items-center gap-2 mb-2">
        <span className="w-1.5 h-1.5 rounded-full bg-indigo-500" />
        <span className="text-[10px] uppercase tracking-[0.18em] text-secondary">
          Co-thinking nudge · {suggestion.state.replace(/_/g, " ")}
        </span>
      </div>
      <p className="text-sm text-primary leading-relaxed mb-3 whitespace-pre-wrap">
        {suggestion.text}
      </p>
      <div className="flex items-center gap-2">
        <button
          onClick={onAccept}
          className="px-3 py-1.5 rounded-full bg-primary text-on-primary text-xs font-medium hover:opacity-90"
        >
          Useful
        </button>
        <button
          onClick={onAskOutLoud}
          className="px-3 py-1.5 rounded-full border border-auralis text-primary text-xs font-medium hover:bg-surface-variant flex items-center gap-1"
        >
          <span className="material-symbols-outlined text-sm">volume_up</span>
          Say it out loud
        </button>
        <button
          onClick={onDismiss}
          className="ml-auto px-2 py-1.5 text-xs text-secondary hover:text-primary"
          aria-label="Dismiss"
        >
          ✕
        </button>
      </div>
    </div>
  );
}
