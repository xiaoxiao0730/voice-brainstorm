// Stage 0 — Pipeline Inspector (dev only).
//
// Floating bottom-right panel that visualizes pipelineTracer entries grouped
// by turnId for the currently active session. Mount via `?debug=1` or in
// dev builds.

import { useEffect, useMemo, useState } from "react";
import { pipelineTracer, type TracerEntry } from "@/lib/debug/pipelineTracer";

type Props = { sessionId: string | null };

const KIND_COLOR: Record<string, string> = {
  "azure.final_chunk": "#94a3b8",
  "transcript.segment": "#64748b",
  "thought_turn.started": "#0ea5e9",
  "thought_turn.finalized": "#0284c7",
  "decideBrief.start": "#a78bfa",
  "decideBrief.end": "#7c3aed",
  "bulletLane.start": "#34d399",
  "bulletLane.end": "#059669",
  "brief.proposed": "#16a34a",
  "brief.applied": "#15803d",
  "brief.kept": "#22c55e",
  "brief.undone": "#f97316",
  "brief.edited": "#facc15",
  "voice.response_started": "#ec4899",
  "voice.spoke": "#db2777",
  "voice.stayed_silent": "#9ca3af",
  "research.requested": "#f59e0b",
  "research.start": "#fb923c",
  "research.synth.start": "#fdba74",
  "research.synth.end": "#ea580c",
  "research.completed": "#d97706",
  "research.failed": "#dc2626",
  "insight.start": "#06b6d4",
  "insight.end": "#0891b2",
  "insight.created": "#0e7490",
};

function fmtTime(t: number): string {
  const d = new Date(t);
  return `${d.toLocaleTimeString(undefined, { hour12: false })}.${String(d.getMilliseconds()).padStart(3, "0")}`;
}

export function PipelineInspector({ sessionId }: Props) {
  const [open, setOpen] = useState(false);
  const [, force] = useState(0);
  const [filter, setFilter] = useState<string>("");

  useEffect(() => {
    const off = pipelineTracer.subscribe(() => force((n) => n + 1));
    return off;
  }, []);

  const entries = useMemo<TracerEntry[]>(() => {
    if (!sessionId) return [];
    let list = pipelineTracer.bySession(sessionId);
    if (filter) {
      const f = filter.toLowerCase();
      list = list.filter((e) => e.kind.toLowerCase().includes(f));
    }
    return list.slice(-200).reverse();
  }, [sessionId, filter]);

  // Aggregate stats per turn for the header.
  const stats = useMemo(() => {
    const turns = new Map<string, { start?: number; finalized?: number; decideEnd?: number; patches?: number }>();
    let voiceCount = 0;
    let decideTotal = 0;
    let decideN = 0;
    for (const e of pipelineTracer.bySession(sessionId ?? "")) {
      if (e.turnId) {
        const t = turns.get(e.turnId) ?? {};
        if (e.kind === "thought_turn.started") t.start = e.at;
        if (e.kind === "thought_turn.finalized") t.finalized = e.at;
        if (e.kind === "decideBrief.end") {
          t.decideEnd = e.at;
          if (typeof e.durationMs === "number") { decideTotal += e.durationMs; decideN++; }
        }
        turns.set(e.turnId, t);
      }
      if (e.kind === "voice.response_started") voiceCount++;
      if (e.kind === "brief.proposed" && e.meta?.patches !== undefined) {
        // best-effort association via operationId chain not tracked; skip.
      }
    }
    const turnList = [...turns.values()];
    const finalizedDelays = turnList
      .filter((t) => t.start && t.finalized)
      .map((t) => (t.finalized! - t.start!));
    const avgFinalize = finalizedDelays.length
      ? Math.round(finalizedDelays.reduce((a, b) => a + b, 0) / finalizedDelays.length)
      : 0;
    return {
      turns: turns.size,
      avgFinalizeMs: avgFinalize,
      avgDecideMs: decideN ? Math.round(decideTotal / decideN) : 0,
      voiceResponses: voiceCount,
    };
  }, [sessionId, entries.length]);

  if (!sessionId) return null;

  return (
    <div
      style={{
        position: "fixed",
        right: 16,
        bottom: 16,
        zIndex: 9999,
        fontFamily: "ui-monospace, monospace",
        fontSize: 11,
        color: "#0f172a",
      }}
    >
      {!open && (
        <button
          onClick={() => setOpen(true)}
          style={{
            background: "#0f172a",
            color: "#fff",
            border: "none",
            borderRadius: 999,
            padding: "8px 14px",
            cursor: "pointer",
            boxShadow: "0 4px 16px rgba(0,0,0,.2)",
          }}
        >
          🔬 pipeline ({pipelineTracer.bySession(sessionId).length})
        </button>
      )}
      {open && (
        <div
          style={{
            width: 480,
            maxHeight: "70vh",
            background: "#fff",
            border: "1px solid #cbd5e1",
            borderRadius: 8,
            boxShadow: "0 10px 30px rgba(0,0,0,.25)",
            display: "flex",
            flexDirection: "column",
            overflow: "hidden",
          }}
        >
          <div style={{ display: "flex", alignItems: "center", gap: 8, padding: "8px 10px", background: "#0f172a", color: "#fff" }}>
            <strong style={{ flex: 1 }}>Pipeline Inspector</strong>
            <button
              onClick={() => pipelineTracer.clear()}
              style={{ background: "transparent", color: "#fff", border: "1px solid #475569", borderRadius: 4, padding: "2px 6px", cursor: "pointer" }}
            >
              clear
            </button>
            <button
              onClick={() => setOpen(false)}
              style={{ background: "transparent", color: "#fff", border: "1px solid #475569", borderRadius: 4, padding: "2px 8px", cursor: "pointer" }}
            >
              ×
            </button>
          </div>
          <div style={{ display: "flex", gap: 12, padding: "6px 10px", background: "#f1f5f9", borderBottom: "1px solid #e2e8f0" }}>
            <span>turns: <b>{stats.turns}</b></span>
            <span>avg finalize: <b>{stats.avgFinalizeMs}ms</b></span>
            <span>avg decideBrief: <b>{stats.avgDecideMs}ms</b></span>
            <span>voice replies: <b>{stats.voiceResponses}</b></span>
          </div>
          <input
            value={filter}
            onChange={(e) => setFilter(e.target.value)}
            placeholder="filter kinds (e.g. decideBrief, voice, research)"
            style={{ padding: "6px 10px", border: "none", borderBottom: "1px solid #e2e8f0", outline: "none" }}
          />
          <div style={{ overflowY: "auto", flex: 1, padding: "4px 0" }}>
            {entries.map((e) => (
              <div
                key={e.id}
                style={{
                  padding: "3px 10px",
                  display: "grid",
                  gridTemplateColumns: "78px 8px 1fr 70px",
                  gap: 6,
                  alignItems: "baseline",
                  borderBottom: "1px solid #f1f5f9",
                }}
              >
                <span style={{ color: "#64748b" }}>{fmtTime(e.at)}</span>
                <span style={{ width: 8, height: 8, borderRadius: "50%", background: KIND_COLOR[e.kind] ?? "#cbd5e1" }} />
                <span>
                  <b style={{ color: "#0f172a" }}>{e.kind}</b>
                  {e.meta ? (
                    <span style={{ color: "#475569", marginLeft: 6 }}>
                      {Object.entries(e.meta)
                        .map(([k, v]) => `${k}=${typeof v === "string" ? v : JSON.stringify(v)}`)
                        .join(" ")}
                    </span>
                  ) : null}
                </span>
                <span style={{ color: "#7c3aed", textAlign: "right" }}>
                  {typeof e.durationMs === "number" ? `${e.durationMs}ms` : ""}
                </span>
              </div>
            ))}
            {entries.length === 0 && (
              <div style={{ padding: 12, color: "#94a3b8" }}>no entries yet — talk to record events.</div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
