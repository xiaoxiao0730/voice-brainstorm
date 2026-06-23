// B1 — InsightCoordinator.
//
// Subscribes once per session bus to:
//   - thought_turn.finalized → call insightAgent with last N turns + snapshot.
//   - research.completed     → call insightAgent with research result attached.
//
// For each returned InsightPacket:
//   1. Emit `insight.created` on the bus (tracer + future Realtime consumer).
//   2. If `bulletText` is set, emit a `brief.proposed` patch carrying that
//      bullet, so it surfaces as a pending bullet in the Live Brief —
//      reusing the existing fast-lane path (no new UI plumbing).
//
// Best-effort; failures are logged and swallowed.

import { sessionStore } from "./sessionStore";
import { insightAgent } from "@/lib/agent/insightAgent.functions";
import { pipelineTracer } from "@/lib/debug/pipelineTracer";
import type { InsightPacket, ResearchResult } from "@/lib/pipeline/types";

export type InsightContext = {
  getSnapshot: () => Array<{ id: string; kind: "h2" | "p"; text: string; locked: boolean }>;
  getModel?: () => string;
};

type RecentTurn = { turnId: string; text: string };
const RECENT_TURNS = 4;

const attached = new Map<string, () => void>();

export function attachInsightCoordinator(
  sessionId: string,
  ctx: InsightContext,
): () => void {
  if (attached.has(sessionId)) return attached.get(sessionId)!;

  const slot = sessionStore.getOrCreate(sessionId);
  const recent: RecentTurn[] = [];

  const runAgent = async (
    trigger: "thought_turn" | "research",
    research: ResearchResult | null,
    researchTaskId: string | undefined,
  ) => {
    const endSpan = pipelineTracer.startSpan({
      sessionId,
      kind: "insight.start" as never,
      endKind: "insight.end" as never,
      key: `${trigger}:${Date.now()}`,
      meta: { trigger, turns: recent.length, hasResearch: !!research },
    });
    try {
      const snapshot = ctx.getSnapshot().slice(-80);
      const model = ctx.getModel?.() ?? "openai/gpt-5-mini";
      const { packets } = await insightAgent({
        data: {
          trigger,
          recentTurns: recent.slice(-RECENT_TURNS),
          snapshot,
          research: research
            ? {
                taskId: researchTaskId,
                query: research.query,
                title: research.title,
                summary: research.summary,
                findings: research.findings,
              }
            : null,
          model,
        },
      });
      endSpan({ packets: packets.length });

      const turnIds = recent.slice(-RECENT_TURNS).map((t) => t.turnId);
      for (const p of packets) {
        const packet: InsightPacket = {
          id: crypto.randomUUID(),
          sessionId,
          kind: p.kind,
          text: p.text,
          priority: p.priority,
          shouldSpeak: p.shouldSpeak,
          bulletText: p.bulletText || undefined,
          basedOn: { turnIds, researchTaskId },
          createdAt: Date.now(),
        };
        slot.bus.emit({ type: "insight.created", sessionId, packet });

        // Brief-side consumption: high-signal packets become pending bullets.
        if (packet.bulletText && (packet.priority === "high" || packet.kind === "conclusion")) {
          const operationId = crypto.randomUUID();
          slot.bus.emit({
            type: "brief.proposed",
            sessionId,
            operationId,
            patches: [
              {
                action: "append_block",
                blockId: null,
                heading: "",
                level: 3,
                bodyMarkdown: packet.bulletText,
                sourceChunkIds: [],
              },
            ],
          });
        }
      }
    } catch (err) {
      endSpan({ error: err instanceof Error ? err.message : String(err) });
      console.warn("[insightCoordinator] failed", err);
    }
  };

  const offTurn = slot.bus.on("thought_turn.finalized", (e) => {
    const text = e.thoughtTurn.combinedText.trim();
    if (!text) return;
    recent.push({ turnId: e.turnId, text });
    if (recent.length > RECENT_TURNS * 2) recent.splice(0, recent.length - RECENT_TURNS * 2);
    void runAgent("thought_turn", null, undefined);
  });

  const offResearch = slot.bus.on("research.completed", (e) => {
    void runAgent("research", e.result, e.taskId);
  });

  const detach = () => {
    offTurn();
    offResearch();
    attached.delete(sessionId);
  };
  attached.set(sessionId, detach);
  return detach;
}
