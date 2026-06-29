import { MessageCircle, Mic, Minimize2, PanelLeftOpen, Square } from "lucide-react";

import type { AgentStatus } from "@/components/agent/AgentPanel";

type Props = {
  status: AgentStatus;
  listening: boolean;
  level: number;
  partial?: string;
  aiWriting?: boolean;
  insight?: string;
  disabled?: boolean;
  collapsed?: boolean;
  onToggleListening: () => void;
  onPromptAgent: () => void;
  onExpandPanel?: () => void;
  onToggleDock?: () => void;
};

const STATUS_LABEL: Record<AgentStatus, string> = {
  off: "Agent idle",
  connecting: "Connecting to agent...",
  listening: "Listening with you",
  thinking: "Agent is thinking...",
  speaking: "Agent is speaking...",
  error: "Agent connection error",
};

function Waveform({ active, level }: { active: boolean; level: number }) {
  const energy = active ? Math.max(0.15, level) : 0;

  return (
    <div className="relative flex h-36 w-36 items-center justify-center" aria-hidden="true">
      <div
        className={`absolute inset-0 rounded-full border border-auralis/30 blur-[1px] ${
          active ? "animate-[ring-pulse_3.2s_ease-out_infinite]" : ""
        }`}
      />
      <div
        className={`absolute inset-5 rounded-full border border-auralis/40 ${
          active ? "animate-[ring-pulse_4.1s_ease-out_infinite_0.5s]" : ""
        }`}
      />
      <div
        className={`absolute left-[30px] h-[62px] w-[25px] rounded-full bg-gradient-to-tr from-rose-400 to-orange-300 opacity-75 mix-blend-multiply blur-[4px] ${
          active ? "animate-[orb-a_3s_ease-in-out_infinite]" : ""
        }`}
        style={{ height: `${62 + energy * 20}px` }}
      />
      <div
        className={`absolute right-[30px] h-[62px] w-[25px] rounded-full bg-gradient-to-tr from-emerald-300 to-teal-300 opacity-75 mix-blend-multiply blur-[4px] ${
          active ? "animate-[orb-c_4.2s_ease-in-out_infinite]" : ""
        }`}
        style={{ height: `${62 + energy * 18}px` }}
      />
      <div
        className={`relative h-[82px] w-[34px] rounded-full bg-gradient-to-tr from-indigo-400 via-violet-400 to-purple-500 opacity-85 blur-[3px] ${
          active ? "animate-[orb-b_3.6s_ease-in-out_infinite]" : ""
        }`}
        style={{ height: `${82 + energy * 24}px` }}
      />
    </div>
  );
}

export function AgentDock({
  status,
  listening,
  level,
  partial,
  aiWriting,
  insight,
  disabled,
  collapsed,
  onToggleListening,
  onPromptAgent,
  onExpandPanel,
  onToggleDock,
}: Props) {
  const statusLabel = partial
    ? "Transcribing..."
    : aiWriting
      ? "AI is writing to the canvas..."
      : STATUS_LABEL[status];
  const message =
    partial?.trim() || insight?.trim() || "Start a conversation about anything on this canvas.";

  if (collapsed) {
    return (
      <button
        type="button"
        onClick={onToggleDock}
        className="relative flex h-14 w-14 items-center justify-center rounded-full border border-black/10 bg-white/95 shadow-[0_12px_30px_rgba(20,24,31,0.16)] backdrop-blur-md hover:bg-white"
        title="Expand agent dock"
        aria-label="Expand agent dock"
      >
        <span className="flex h-8 items-center gap-1" aria-hidden="true">
          <span className="h-5 w-2 rounded-full bg-rose-400/75 blur-[1px]" />
          <span
            className={`h-8 w-2.5 rounded-full bg-violet-500/80 blur-[1px] ${
              listening || status === "speaking" ? "animate-pulse" : ""
            }`}
          />
          <span className="h-5 w-2 rounded-full bg-emerald-300/80 blur-[1px]" />
        </span>
        <span
          className={`absolute right-0.5 top-0.5 h-2 w-2 rounded-full border border-white ${
            status === "error"
              ? "bg-rose-500"
              : listening || status === "speaking"
                ? "bg-emerald-500"
                : aiWriting || status === "connecting" || status === "thinking"
                  ? "animate-pulse bg-amber-500"
                  : "bg-secondary"
          }`}
        />
      </button>
    );
  }

  return (
    <aside className="relative flex min-h-[326px] w-[224px] flex-col items-center rounded-md border border-black/10 bg-white/95 px-4 pb-4 pt-5 shadow-[0_18px_45px_rgba(20,24,31,0.16)] backdrop-blur-md">
      {(onExpandPanel || onToggleDock) && (
        <div className="absolute right-2 top-2 flex items-center gap-0.5">
          {onToggleDock && (
            <button
              type="button"
              onClick={onToggleDock}
              className="flex h-7 w-7 items-center justify-center rounded-full text-secondary hover:bg-surface-variant hover:text-primary"
              title="Collapse agent dock"
              aria-label="Collapse agent dock"
            >
              <Minimize2 size={14} />
            </button>
          )}
          {onExpandPanel && (
            <button
              type="button"
              onClick={onExpandPanel}
              className="flex h-7 w-7 items-center justify-center rounded-full text-secondary hover:bg-surface-variant hover:text-primary"
              title="Expand Audio Interaction panel"
              aria-label="Expand Audio Interaction panel"
            >
              <PanelLeftOpen size={15} />
            </button>
          )}
        </div>
      )}

      <Waveform active={listening || status === "speaking" || !!aiWriting} level={level} />

      <div className="mt-1 flex items-center justify-center gap-1.5 text-[11px] font-medium text-primary">
        <span
          className={`h-1.5 w-1.5 rounded-full ${
            status === "error"
              ? "bg-rose-500"
              : listening || status === "speaking"
                ? "bg-emerald-500"
                : aiWriting || status === "connecting" || status === "thinking"
                  ? "animate-pulse bg-amber-500"
                  : "bg-secondary"
          }`}
        />
        <span>{statusLabel}</span>
      </div>

      <p
        className="mt-2 min-h-10 overflow-hidden text-center text-xs leading-relaxed text-secondary"
        style={{
          display: "-webkit-box",
          WebkitBoxOrient: "vertical",
          WebkitLineClamp: 2,
        }}
      >
        {message}
      </p>

      <div className="mt-auto flex items-center justify-center gap-2 pt-3">
        <button
          type="button"
          onClick={onToggleListening}
          disabled={disabled}
          className={`flex h-10 w-10 items-center justify-center rounded-full transition-colors disabled:opacity-40 ${
            listening
              ? "bg-primary text-on-primary hover:opacity-85"
              : "border border-auralis bg-surface text-primary hover:bg-surface-variant"
          }`}
          title={listening ? "Stop AI conversation" : "Start AI conversation"}
          aria-label={listening ? "Stop AI conversation" : "Start AI conversation"}
        >
          {listening ? <Square size={15} fill="currentColor" /> : <Mic size={18} />}
        </button>
        <button
          type="button"
          onClick={onPromptAgent}
          disabled={!listening || status === "connecting" || disabled}
          className="flex h-9 w-9 items-center justify-center rounded-full border border-auralis bg-surface text-primary hover:bg-surface-variant disabled:opacity-35"
          title={status === "speaking" ? "Stop agent response (S)" : "Ask agent to respond (S)"}
          aria-label={status === "speaking" ? "Stop agent response" : "Ask agent to respond"}
        >
          <MessageCircle size={16} />
        </button>
      </div>
    </aside>
  );
}
