// ThoughtTurn buffer: aggregates Azure final TranscriptSegments into short
// "mini-batch" ThoughtTurns. Emits a `thought_turn.finalized` SessionEvent as
// soon as EITHER enough segments have accumulated OR a brief pause elapses —
// so the brief grows in near-real-time while you keep talking, not only after
// you stop. decideBrief still receives the full brief snapshot each time, so
// quality stays high (it appends/updates incrementally instead of fragmenting).
//
// Boundary algorithm:
//   - MAX_SEGMENTS = 2    → flush as soon as this many segments accumulate (real-time)
//   - SEMANTIC_PAUSE_MS = 1.2s → user paused briefly → flush what we have
//   - HARD_LIMIT_MS = 60s → force finalize a runaway turn
//   - MAX_GAP_MS = 8s → segment too old → start a new turn
//
// Finalization triggers: segment-count threshold, semantic-pause timer,
// voice.response_started event, manual stop, or hard limit.

import type {
  SessionEvent,
  ThoughtTurn,
  ThoughtTurnBoundaryReason,
  TranscriptSegment,
} from "@/lib/pipeline/types";
import type { SessionEventBus } from "@/lib/orchestrator/sessionEvents";
import { pipelineTracer } from "@/lib/debug/pipelineTracer";

export const THOUGHT_TURN_CONSTANTS = {
  MAX_SEGMENTS: 2,
  HARD_LIMIT_MS: 60_000,
  SEMANTIC_PAUSE_MS: 1_200,
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
        pipelineTracer.log({
          sessionId,
          kind: "thought_turn.started",
          turnId: current.id,
        });
        scheduleHardLimit(THOUGHT_TURN_CONSTANTS.HARD_LIMIT_MS);
      }
      current.segments.push(segment);
      current.lastSegmentAt = t;

      const elapsed = t - current.startedAt;
      if (elapsed >= THOUGHT_TURN_CONSTANTS.HARD_LIMIT_MS) {
        finalize("hard_limit");
        return;
      }
      // Mini-batch: flush as soon as we have enough segments, so the brief
      // grows while the user is still talking (not only on a pause).
      if (current.segments.length >= THOUGHT_TURN_CONSTANTS.MAX_SEGMENTS) {
        finalize("hard_limit");
        return;
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
    reset() {
      if (disposed) return;
      current = null;
      clearPause();
      clearHard();
    },
    dispose() {
      disposed = true;
      clearPause();
      clearHard();
      current = null;
    },
  };
}
