// Slow-lane Coordinator (stub). Subscribes once per session bus to
// `thought_turn.finalized` and logs. Future PRs will:
//   - call decideBrief.functions to produce BriefPatch[] (one operationId)
//   - serialize writes via slot.briefQueue
//   - optionally enqueue research via researchQueue
//
// Voice never writes the brief; coordinator never speaks.

import { sessionStore } from "./sessionStore";

const attached = new Set<string>();

export function attachCoordinator(sessionId: string): () => void {
  const slot = sessionStore.getOrCreate(sessionId);
  if (attached.has(sessionId)) {
    return () => { /* idempotent */ };
  }
  attached.add(sessionId);

  const off = slot.bus.on("thought_turn.finalized", (e) => {
    // PR2 stub: log only.
    console.info(
      "[coordinator] thought_turn.finalized",
      {
        sessionId: e.sessionId,
        turnId: e.turnId,
        boundary: e.thoughtTurn.boundaryReason,
        chars: e.thoughtTurn.combinedText.length,
        segments: e.thoughtTurn.segmentIds.length,
        revision: e.thoughtTurn.revision,
      },
    );
  });

  return () => {
    off();
    attached.delete(sessionId);
  };
}
