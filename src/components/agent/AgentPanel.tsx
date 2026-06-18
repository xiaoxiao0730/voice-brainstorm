// Slimmed AgentPanel for the Stage 3 dual-pipeline architecture.
// Only the status pill remains here — the Background Canvas Lane writes
// directly into the Live Brief, so there's no floating suggestion or
// ghost-patch card to render.

export type AgentStatus = "off" | "connecting" | "listening" | "thinking" | "speaking" | "error";

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
}: {
  status: AgentStatus;
  enabled: boolean;
  onToggle: () => void;
}) {
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
