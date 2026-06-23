// Stage 0 — pipeline observability.
//
// A lightweight in-memory ring buffer (max 500 entries) that records timing
// and meta for every pipeline event we care about, keyed by sessionId and
// optionally turnId / operationId so the inspector can group them into
// per-turn timelines.
//
// Two ways to populate it:
//   1. `wireTracerToBus(sessionId, bus)` auto-mirrors every SessionEvent
//      (uses bus.onAny). Called from sessionStore on slot creation.
//   2. Call sites that don't emit on the bus (decideBrief start/end, raw
//      transcript segments, brief.applied, etc.) call `tracer.log(...)`
//      directly.
//
// Subscribers (the inspector panel) call `subscribe` to get notified on
// every new entry.

import type { SessionEvent, SessionEventType } from "@/lib/pipeline/types";
import type { SessionEventBus } from "@/lib/orchestrator/sessionEvents";

export type TracerKind =
  | SessionEventType
  | "azure.final_chunk"
  | "transcript.segment"
  | "thought_turn.started"
  | "decideBrief.start"
  | "decideBrief.end"
  | "bulletLane.start"
  | "bulletLane.end"
  | "brief.applied"
  | "research.start"
  | "research.synth.start"
  | "research.synth.end";

export type TracerEntry = {
  id: number;
  at: number;                 // performance.now()-style wall ms (Date.now())
  sessionId: string;
  kind: TracerKind;
  turnId?: string;
  operationId?: string;
  taskId?: string;
  durationMs?: number;        // for *.end entries
  meta?: Record<string, unknown>;
};

const MAX_ENTRIES = 500;
const buffer: TracerEntry[] = [];
let nextId = 1;
const listeners = new Set<(entry: TracerEntry) => void>();
const wired = new Set<string>();

// Track open spans so *.end can compute a duration without callers passing it.
const openSpans = new Map<string, number>();
const spanKey = (sessionId: string, kind: TracerKind, key?: string) =>
  `${sessionId}::${kind}::${key ?? ""}`;

function push(entry: Omit<TracerEntry, "id" | "at"> & { at?: number }) {
  const full: TracerEntry = {
    id: nextId++,
    at: entry.at ?? Date.now(),
    ...entry,
  };
  buffer.push(full);
  if (buffer.length > MAX_ENTRIES) buffer.shift();
  for (const l of listeners) {
    try { l(full); } catch (err) { console.error("[pipelineTracer]", err); }
  }
}

export const pipelineTracer = {
  log(entry: Omit<TracerEntry, "id" | "at">) {
    push(entry);
  },
  /** Open a span; record start entry. Returns a function to close it. */
  startSpan(args: {
    sessionId: string;
    kind: TracerKind;          // should be a *.start kind
    endKind: TracerKind;
    key?: string;              // disambiguator (turnId / taskId)
    turnId?: string;
    operationId?: string;
    taskId?: string;
    meta?: Record<string, unknown>;
  }) {
    const startAt = Date.now();
    openSpans.set(spanKey(args.sessionId, args.endKind, args.key), startAt);
    push({
      sessionId: args.sessionId,
      kind: args.kind,
      turnId: args.turnId,
      operationId: args.operationId,
      taskId: args.taskId,
      meta: args.meta,
    });
    return (endMeta?: Record<string, unknown>) => {
      const k = spanKey(args.sessionId, args.endKind, args.key);
      const t0 = openSpans.get(k) ?? startAt;
      openSpans.delete(k);
      push({
        sessionId: args.sessionId,
        kind: args.endKind,
        turnId: args.turnId,
        operationId: args.operationId,
        taskId: args.taskId,
        durationMs: Date.now() - t0,
        meta: endMeta,
      });
    };
  },
  snapshot(): TracerEntry[] {
    return buffer.slice();
  },
  bySession(sessionId: string): TracerEntry[] {
    return buffer.filter((e) => e.sessionId === sessionId);
  },
  clear() {
    buffer.length = 0;
  },
  subscribe(fn: (entry: TracerEntry) => void): () => void {
    listeners.add(fn);
    return () => { listeners.delete(fn); };
  },
};

/** Mirror every bus event into the tracer. Idempotent per session. */
export function wireTracerToBus(sessionId: string, bus: SessionEventBus): void {
  if (wired.has(sessionId)) return;
  wired.add(sessionId);
  bus.onAny((e: SessionEvent) => {
    const base: Omit<TracerEntry, "id" | "at"> = {
      sessionId,
      kind: e.type as TracerKind,
    };
    switch (e.type) {
      case "thought_turn.finalized":
        base.turnId = e.turnId;
        base.meta = {
          chars: e.thoughtTurn.combinedText.length,
          segments: e.thoughtTurn.segmentIds.length,
          boundary: e.thoughtTurn.boundaryReason,
          elapsedMs: e.thoughtTurn.endedAt - e.thoughtTurn.startedAt,
        };
        break;
      case "brief.proposed":
        base.operationId = e.operationId;
        base.meta = { patches: e.patches.length };
        break;
      case "brief.kept":
      case "brief.undone":
      case "brief.edited":
        base.operationId = e.operationId;
        break;
      case "research.requested":
        base.taskId = e.taskId;
        base.operationId = e.operationId;
        base.meta = { query: e.query.slice(0, 80) };
        break;
      case "research.completed":
        base.taskId = e.taskId;
        base.operationId = e.operationId;
        base.meta = {
          title: e.result.title?.slice(0, 80) ?? "",
          findings: e.result.findings.length,
          links: e.result.links.length,
        };
        break;
      case "research.failed":
        base.taskId = e.taskId;
        base.operationId = e.operationId;
        base.meta = { error: e.error.slice(0, 120) };
        break;
      case "voice.spoke":
        base.turnId = e.turnId;
        base.meta = { chars: e.text.length, sample: e.text.slice(0, 80) };
        break;
      case "voice.stayed_silent":
        base.meta = { reason: e.reason };
        break;
      default:
        break;
    }
    push(base);
  });
}
