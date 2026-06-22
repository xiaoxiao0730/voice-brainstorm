// Slow-lane Coordinator.
//
// Subscribes once per session bus to `thought_turn.finalized` and:
//   1. Calls decideBrief to produce BriefPatch[] + optional research query.
//   2. Serializes work via slot.briefQueue (mutex).
//   3. Emits ONE `brief.proposed` SessionEvent per turn (carrying patches +
//      a single operationId). Workbench applies + renders.
//   4. If decideBrief proposes research → emits `research.requested`
//      (tagged with same operationId). researchQueue picks it up.
//
// Voice never writes the brief. Coordinator never speaks.

import { sessionStore } from "./sessionStore";
import { decideBrief } from "./decideBrief.functions";

export type CoordinatorContext = {
  /** Snapshot of the current brief, used as context for decideBrief. */
  getSnapshot: () => Array<{ id: string; kind: "h2" | "p"; text: string; locked: boolean }>;
  /** Model id to use for decideBrief (gateway model string). */
  getModel?: () => string;
};

const attached = new Map<string, () => void>();

export function attachCoordinator(sessionId: string, ctx: CoordinatorContext): () => void {
  if (attached.has(sessionId)) return attached.get(sessionId)!;

  const slot = sessionStore.getOrCreate(sessionId);

  const off = slot.bus.on("thought_turn.finalized", (e) => {
    void slot.briefQueue.run(async () => {
      try {
        const snapshot = ctx.getSnapshot();
        const model = ctx.getModel?.() ?? "google/gemini-3-flash-preview";
        const decision = await decideBrief({
          data: {
            thoughtTurn: {
              combinedText: e.thoughtTurn.combinedText,
              boundaryReason: e.thoughtTurn.boundaryReason,
            },
            snapshot,
            model,
          },
        });

        const operationId = crypto.randomUUID();

        if (decision.patches.length > 0) {
          slot.bus.emit({
            type: "brief.proposed",
            sessionId,
            operationId,
            patches: decision.patches.map((p) => ({
              action: p.action,
              blockId: p.blockId,
              heading: p.heading,
              level: p.level,
              bodyMarkdown: p.bodyMarkdown,
              sourceChunkIds: e.thoughtTurn.chunkIds,
            })),
          });
        }

        if (decision.proposeResearch?.query) {
          const taskId = crypto.randomUUID();
          slot.bus.emit({
            type: "research.requested",
            sessionId,
            taskId,
            query: decision.proposeResearch.query,
            operationId: decision.patches.length > 0 ? operationId : undefined,
          });
        }
      } catch (err) {
        console.warn("[coordinator] decideBrief failed", err);
      }
    });
  });

  const detach = () => {
    off();
    attached.delete(sessionId);
  };
  attached.set(sessionId, detach);
  return detach;
}
