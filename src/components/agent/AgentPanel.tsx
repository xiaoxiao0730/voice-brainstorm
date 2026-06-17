import { useEffect, useState } from "react";
import type { AgentMode } from "@/lib/agent/agentMode";
import { MODE_DESCRIPTION, MODE_LABEL } from "@/lib/agent/agentMode";

export type AgentStatus = "off" | "connecting" | "listening" | "thinking" | "speaking" | "error";

export type AgentSuggestion = {
  id: string;
  text: string;
  state: string;
};

export type CanvasGhostPatch = {
  id: string;
  heading: string;
  body: string;
  rationale: string;
};

type PillProps = {
  status: AgentStatus;
  enabled: boolean;
  onToggle: () => void;
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

export function AgentStatusPill({ status, enabled, onToggle }: PillProps) {
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

export function AgentModeSelector({
  mode,
  onChange,
  disabled,
}: {
  mode: AgentMode;
  onChange: (m: AgentMode) => void;
  disabled?: boolean;
}) {
  const modes: AgentMode[] = ["listen", "guide", "answer"];
  return (
    <div
      className={`inline-flex rounded-full border border-auralis bg-surface p-0.5 text-[11px] ${disabled ? "opacity-50 pointer-events-none" : ""}`}
      role="radiogroup"
      aria-label="Agent mode"
    >
      {modes.map((m) => (
        <button
          key={m}
          role="radio"
          aria-checked={mode === m}
          onClick={() => onChange(m)}
          title={MODE_DESCRIPTION[m]}
          className={`px-2.5 py-1 rounded-full transition-colors ${
            mode === m
              ? "bg-primary text-on-primary"
              : "text-secondary hover:text-primary"
          }`}
        >
          {MODE_LABEL[m]}
        </button>
      ))}
    </div>
  );
}

export function AgentSuggestionCard({
  suggestion,
  onDismiss,
  onAskOutLoud,
  onAccept,
}: {
  suggestion: AgentSuggestion | null;
  onDismiss: () => void;
  onAskOutLoud: () => void;
  onAccept: () => void;
}) {
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

export function CanvasGhostPatchCard({
  patch,
  onAccept,
  onEdit,
  onDismiss,
}: {
  patch: CanvasGhostPatch | null;
  onAccept: () => void;
  onEdit: () => void;
  onDismiss: () => void;
}) {
  useEffect(() => {
    if (!patch) return;
    const t = setTimeout(() => onDismiss(), 45_000);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [patch?.id]);

  if (!patch) return null;

  return (
    <div className="fixed bottom-6 left-6 z-40 max-w-sm bg-surface border border-dashed border-indigo-400/60 rounded-2xl shadow-lg p-4 animate-in fade-in slide-in-from-bottom-2">
      <div className="flex items-center gap-2 mb-2">
        <span className="w-1.5 h-1.5 rounded-full bg-indigo-500" />
        <span className="text-[10px] uppercase tracking-[0.18em] text-secondary">
          Ghost block · suggested
        </span>
      </div>
      {patch.heading && (
        <p className="text-sm font-medium text-primary mb-1">{patch.heading}</p>
      )}
      <p className="text-sm text-primary/80 leading-relaxed mb-2 whitespace-pre-wrap italic">
        {patch.body}
      </p>
      {patch.rationale && (
        <p className="text-[11px] text-secondary mb-3">{patch.rationale}</p>
      )}
      <div className="flex items-center gap-2">
        <button
          onClick={onAccept}
          className="px-3 py-1.5 rounded-full bg-primary text-on-primary text-xs font-medium hover:opacity-90"
        >
          Accept
        </button>
        <button
          onClick={onEdit}
          className="px-3 py-1.5 rounded-full border border-auralis text-primary text-xs font-medium hover:bg-surface-variant"
        >
          Edit
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
