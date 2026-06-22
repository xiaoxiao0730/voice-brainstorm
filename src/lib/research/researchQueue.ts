// Browser-side research queue. FIFO with a global concurrency cap (2).
// Tasks are tagged with their origin sessionId and emit research.completed
// back to that origin bus regardless of which session is currently active.

import { sessionStore } from "@/lib/orchestrator/sessionStore";
import { webSearch } from "@/lib/research/webSearch.functions";
import { synthesizeResearch } from "@/lib/research/researchSynthesizer.functions";
import type { ResearchResult } from "@/lib/pipeline/types";

const MAX_CONCURRENT = 2;

type Task = {
  taskId: string;
  sessionId: string;
  query: string;
  operationId?: string;
};

let active = 0;
const queue: Task[] = [];

function pump() {
  while (active < MAX_CONCURRENT && queue.length > 0) {
    const t = queue.shift()!;
    active++;
    void runTask(t).finally(() => {
      active--;
      pump();
    });
  }
}

async function runTask(t: Task): Promise<void> {
  const slot = sessionStore.get(t.sessionId);
  if (slot) slot.researchTasks.set(t.taskId, "running");

  let notes = "";
  try {
    const r = await webSearch({ data: { query: t.query } });
    if (r.ok) notes = r.notes;
  } catch (e) {
    console.warn("[researchQueue] webSearch failed", e);
  }

  let result: ResearchResult;
  try {
    const synth = await synthesizeResearch({ data: { query: t.query, notes } });
    result = { id: t.taskId, query: t.query, ...synth };
  } catch (e) {
    console.warn("[researchQueue] synth failed", e);
    result = {
      id: t.taskId,
      query: t.query,
      title: t.query,
      summary: notes || "No reliable sources found.",
      findings: [],
      links: [],
      voiceSummary: "",
    };
  }

  const target = sessionStore.get(t.sessionId);
  if (target) {
    target.researchTasks.set(t.taskId, "completed");
    target.bus.emit({
      type: "research.completed",
      sessionId: t.sessionId,
      taskId: t.taskId,
      result,
      operationId: t.operationId,
    });
  }
}

export function enqueueResearch(t: Task): void {
  queue.push(t);
  pump();
}
