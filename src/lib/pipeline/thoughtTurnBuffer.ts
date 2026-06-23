// ThoughtTurn buffer: aggregates Azure final TranscriptSegments into a single
// long-form ThoughtTurn. Emits one `thought_turn.finalized` SessionEvent per
// turn, not one per segment.
//
// Boundary algorithm (see .lovable/plan.md §3):
//   - CHECKPOINT_MS = 30s  → internal-only progress snapshot (no UI Pending)
//   - HARD_LIMIT_MS = 120s → force finalize
//   - SEMANTIC_PAUSE_MS = 2.5s → user yielded
//   - MAX_GAP_MS = 8s → segment too old → start a new turn
//
// Finalization triggers: semantic-pause timer, voice.response_started event,
// manual stop, or hard limit.

import type {
  SessionEvent,
  ThoughtTurn,
  ThoughtTurnBoundaryReason,
  TranscriptSegment,
} from "@/lib/pipeline/types";
import type { SessionEventBus } from "@/lib/orchestrator/sessionEvents";

export const THOUGHT_TURN_CONSTANTS = {
  CHECKPOINT_MS: 30_000,
  HARD_LIMIT_MS: 120_000,
  SEMANTIC_PAUSE_MS: 2_500,
  MAX_GAP_MS: 8_000,
};

type Current = {
  id: string;
  startedAt: number;
  lastSegmentAt: number;
  revision: number;
  lastCheckpointRevision: number;
  segments: TranscriptSegment[];
};

export type ThoughtTurnBuffer = {
  ingest: (segment: TranscriptSegment) => void;
  manualStop: () => void;
  onVoiceResponseStarted: () => void;
  /** Drop any in-flight turn WITHOUT emitting. Used on session switch / reconnect. */
  reset: () => void;
  dispose: () => void;
};

export function createThoughtTurnBuffer(
  sessionId: string,
  bus: SessionEventBus,
  opts: { newId?: () => string; now?: () => number } = {},
): ThoughtTurnBuffer {
  const newId = opts.newId ?? (() => crypto.randomUUID());
  const now = opts.now ?? (() => Date.now());

  let current: Current | null = null;
  let pauseTimer: ReturnType<typeof setTimeout> | null = null;
  let hardLimitTimer: ReturnType<typeof setTimeout> | null = null;
  let disposed = false;

  const clearPause = () => {
    if (pauseTimer) { clearTimeout(pauseTimer); pauseTimer = null; }
  };
  const clearHard = () => {
    if (hardLimitTimer) { clearTimeout(hardLimitTimer); hardLimitTimer = null; }
  };

  const finalize = (reason: ThoughtTurnBoundaryReason) => {
    if (!current || current.segments.length === 0) {
      current = null;
      clearPause();
      clearHard();
      return;
    }
    const combinedText = current.segments
      .map((s) => s.rawText.trim())
      .filter(Boolean)
      .join(" ")
      .replace(/\s+/g, " ")
      .trim();

    const turn: ThoughtTurn = {
      id: current.id,
      sessionId,
      segmentIds: current.segments.map((s) => s.segmentId),
      chunkIds: current.segments.flatMap((s) => s.chunkIds),
      combinedText,
      startedAt: current.startedAt,
      endedAt: now(),
      boundaryReason: reason,
      revision: current.revision,
    };

    current = null;
    clearPause();
    clearHard();

    const evt: SessionEvent = {
      type: "thought_turn.finalized",
      sessionId,
      turnId: turn.id,
      thoughtTurn: turn,
    };
    bus.emit(evt);
  };

  const schedulePause = () => {
    clearPause();
    pauseTimer = setTimeout(() => finalize("semantic_pause"), THOUGHT_TURN_CONSTANTS.SEMANTIC_PAUSE_MS);
  };
  const scheduleHardLimit = (msFromNow: number) => {
    clearHard();
    hardLimitTimer = setTimeout(() => finalize("hard_limit"), Math.max(0, msFromNow));
  };

  return {
    ingest(segment) {
      if (disposed) return;
      const t = now();
      const gap = current ? t - current.lastSegmentAt : Infinity;
      if (!current || gap > THOUGHT_TURN_CONSTANTS.MAX_GAP_MS) {
        // Close any stale turn before starting a new one.
        if (current) finalize("semantic_pause");
        current = {
          id: newId(),
          startedAt: t,
          lastSegmentAt: t,
          revision: 0,
          lastCheckpointRevision: -1,
          segments: [],
        };
        scheduleHardLimit(THOUGHT_TURN_CONSTANTS.HARD_LIMIT_MS);
      }
      current.segments.push(segment);
      current.lastSegmentAt = t;

      // Internal checkpoint at 30s elapsed — bump revision, no UI.
      const elapsed = t - current.startedAt;
      if (elapsed >= THOUGHT_TURN_CONSTANTS.HARD_LIMIT_MS) {
        finalize("hard_limit");
        return;
      }
      if (
        elapsed >= THOUGHT_TURN_CONSTANTS.CHECKPOINT_MS &&
        current.lastCheckpointRevision !== current.revision
      ) {
        current.revision += 1;
        current.lastCheckpointRevision = current.revision;
      }
      schedulePause();
    },
    manualStop() {
      if (disposed) return;
      finalize("manual_stop");
    },
    onVoiceResponseStarted() {
      if (disposed || !current) return;
      // Agent grabbed the turn — flush what the user has said so far.
      finalize("semantic_pause");
    },
    dispose() {
      disposed = true;
      clearPause();
      clearHard();
      current = null;
    },
  };
}
