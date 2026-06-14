import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import { BriefDocument } from "@/components/brief/BriefDocument";
import { supabase } from "@/integrations/supabase/client";

import { applyBriefPatch } from "@/lib/pipeline/applyBriefPatch";
import { between } from "@/lib/pipeline/orderKey";
import { createTranscriptBuffer } from "@/lib/pipeline/transcriptBuffer";
import {
  blockToNodeUpsert,
  nodeToBlock,
  type BriefBlock,
  type BriefDoc,
  type TranscriptSegment,
} from "@/lib/pipeline/types";

import { getSpeechToken } from "@/lib/speech.functions";
import { startAzureRecognizer, type SpeechRecognizerHandle } from "@/lib/speech/azureRecognizer";

import {
  createSession,
  endSession,
  listSessions,
} from "@/lib/session.functions";
import {
  loadBrief,
  persistChunks,
  persistSegment,
  upsertBriefNode,
} from "@/lib/brief.functions";
import { orchestrateSegment } from "@/lib/orchestrate.functions";

export const Route = createFileRoute("/_authenticated/workbench")({
  validateSearch: (search: Record<string, unknown>) => ({
    session: typeof search.session === "string" ? search.session : undefined,
  }),
  head: () => ({
    meta: [
      { title: "Murmur — Co-thinking Workbench" },
      { name: "description", content: "Voice-driven AI co-thinking workbench with a live brief canvas." },
    ],
    links: [
      { rel: "preconnect", href: "https://fonts.googleapis.com" },
      { rel: "preconnect", href: "https://fonts.gstatic.com", crossOrigin: "anonymous" },
      { rel: "stylesheet", href: "https://fonts.googleapis.com/css2?family=Instrument+Serif:ital@0;1&family=Inter:wght@400;500;600&display=swap" },
      { rel: "stylesheet", href: "https://fonts.googleapis.com/icon?family=Material+Symbols+Outlined" },
    ],
  }),
  component: Workbench,
});


type SessionRow = { id: string; title: string; status: string; started_at: string; ended_at: string | null };

function relative(ts: string) {
  const diff = (Date.now() - new Date(ts).getTime()) / 1000;
  if (diff < 60) return "Just now";
  if (diff < 3600) return `${Math.floor(diff / 60)}m ago`;
  if (diff < 86400) return `${Math.floor(diff / 3600)}h ago`;
  return `${Math.floor(diff / 86400)}d ago`;
}

function Workbench() {
  const navigate = useNavigate();

  // Server fn hooks
  const list = useServerFn(listSessions);
  const createS = useServerFn(createSession);
  const endS = useServerFn(endSession);
  const getToken = useServerFn(getSpeechToken);
  const loadB = useServerFn(loadBrief);
  const upsertN = useServerFn(upsertBriefNode);
  const saveChunks = useServerFn(persistChunks);
  const saveSegment = useServerFn(persistSegment);
  const orchestrate = useServerFn(orchestrateSegment);

  // UI state
  const [sessions, setSessions] = useState<SessionRow[]>([]);
  const [activeSessionId, setActiveSessionId] = useState<string | null>(null);
  const [sidebarOpen, setSidebarOpen] = useState(true);
  const [expanded, setExpanded] = useState(true);
  const [listening, setListening] = useState(false);
  const [level, setLevel] = useState(0);
  const [partial, setPartial] = useState("");
  const [finals, setFinals] = useState<{ id: string; text: string }[]>([]);
  const [doc, setDoc] = useState<BriefDoc>({});
  const [aiLoading, setAiLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Refs
  const recognizerRef = useRef<SpeechRecognizerHandle | null>(null);
  const bufferRef = useRef<ReturnType<typeof createTranscriptBuffer> | null>(null);
  const audioCtxRef = useRef<AudioContext | null>(null);
  const analyserRef = useRef<AnalyserNode | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const rafRef = useRef<number | null>(null);
  const docRef = useRef(doc);
  const activeSessionRef = useRef(activeSessionId);

  useEffect(() => { docRef.current = doc; }, [doc]);
  useEffect(() => { activeSessionRef.current = activeSessionId; }, [activeSessionId]);

  // Sign out
  const signOut = async () => {
    try { await stopListening(); } catch { /* ignore */ }
    await supabase.auth.signOut();
    navigate({ to: "/auth" });
  };

  // Load session list
  const refreshSessions = useCallback(async () => {
    try {
      const rows = await list();
      setSessions(rows as SessionRow[]);
      return rows as SessionRow[];
    } catch (e: any) {
      setError(e.message);
      return [];
    }
  }, [list]);

  // Initial load — get sessions, open most recent or create new
  useEffect(() => {
    (async () => {
      const rows = await refreshSessions();
      if (rows.length > 0) {
        await openSession(rows[0].id);
      } else {
        const created = await createS({ data: {} });
        await refreshSessions();
        await openSession(created.id);
      }
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const openSession = useCallback(
    async (id: string) => {
      try { await stopListening(); } catch { /* ignore */ }
      setActiveSessionId(id);
      setFinals([]);
      setPartial("");
      try {
        const briefNodes = await loadB({ data: { sessionId: id } });
        const map: BriefDoc = {};
        for (const n of briefNodes) map[n.id] = nodeToBlock(n);
        setDoc(map);
      } catch (e: any) {
        setError(e.message);
      }
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [loadB],
  );

  const newSession = async () => {
    const created = await createS({ data: {} });
    await refreshSessions();
    await openSession(created.id);
  };

  // ============= Recording =============

  const persistBlock = useCallback(
    async (block: BriefBlock) => {
      await upsertN({ data: blockToNodeUpsert(block) }).catch((e) =>
        console.warn("upsert failed", e),
      );
    },
    [upsertN],
  );

  const onSegment = useCallback(
    async (segment: TranscriptSegment) => {
      try {
        await saveSegment({
          data: {
            segmentId: segment.segmentId,
            sessionId: segment.sessionId,
            chunkIds: segment.chunkIds,
            rawText: segment.rawText,
            startTimeMs: segment.startTimeMs,
            endTimeMs: segment.endTimeMs,
            boundaryReason: segment.boundaryReason,
          },
        });
      } catch (e: any) {
        console.warn("persistSegment failed", e);
      }

      // Snapshot of the current document (sorted) for the AI.
      const snapshot = Object.values(docRef.current)
        .sort((a, b) => a.orderKey.localeCompare(b.orderKey))
        .map((b) => ({
          id: b.id,
          heading: b.heading,
          level: b.level,
          body: b.body,
          locked: b.locked,
          lastEditedBy: b.lastEditedBy,
        }));

      setAiLoading(true);
      try {
        const { patches, error: aiErr } = await orchestrate({
          data: {
            segment: {
              segmentId: segment.segmentId,
              sessionId: segment.sessionId,
              rawText: segment.rawText,
              chunkIds: segment.chunkIds,
            },
            snapshot,
          },
        });
        if (aiErr) setError(aiErr);

        let current = docRef.current;
        const toPersist: BriefBlock[] = [];
        for (const p of patches) {
          const { doc: next, result } = applyBriefPatch(current, p, {
            sessionId: segment.sessionId,
          });
          current = next;
          if (result.ok) toPersist.push(result.block);
        }
        setDoc(current);
        docRef.current = current;
        await Promise.all(toPersist.map(persistBlock));
      } catch (e: any) {
        setError(e.message);
      } finally {
        setAiLoading(false);
      }
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [orchestrate, saveSegment, persistBlock],
  );

  const startListening = async () => {
    if (listening || !activeSessionId) return;
    setError(null);
    try {
      const { token, region } = await getToken();

      // Mic level meter
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      streamRef.current = stream;
      const Ctx = window.AudioContext || (window as any).webkitAudioContext;
      const ctx = new Ctx();
      audioCtxRef.current = ctx;
      const src = ctx.createMediaStreamSource(stream);
      const analyser = ctx.createAnalyser();
      analyser.fftSize = 512;
      src.connect(analyser);
      analyserRef.current = analyser;
      const data = new Uint8Array(analyser.frequencyBinCount);
      const tick = () => {
        analyser.getByteTimeDomainData(data);
        let sum = 0;
        for (let i = 0; i < data.length; i++) {
          const v = (data[i] - 128) / 128;
          sum += v * v;
        }
        const rms = Math.sqrt(sum / data.length);
        setLevel((prev) => prev * 0.6 + Math.min(1, rms * 3) * 0.4);
        rafRef.current = requestAnimationFrame(tick);
      };
      tick();

      // Buffer
      const sessionId = activeSessionId;
      const buf = createTranscriptBuffer({
        sessionId,
        onSegment,
      });
      bufferRef.current = buf;

      // Recognizer
      const handle = await startAzureRecognizer({
        token,
        region,
        onEvent: (e) => {
          if (e.kind === "partial") {
            setPartial(e.text);
          } else if (e.kind === "final") {
            const chunkId = crypto.randomUUID();
            setPartial("");
            setFinals((f) => [...f, { id: chunkId, text: e.text }]);
            // Persist chunk + push to buffer
            const endMs = Math.round(e.offsetMs + e.durationMs);
            saveChunks({
              data: {
                sessionId,
                chunks: [{
                  id: chunkId,
                  text: e.text,
                  isFinal: true,
                  startMs: Math.round(e.offsetMs),
                  endMs,
                  lang: e.lang,
                }],
              },
            }).catch((err) => console.warn("persistChunks failed", err));
            buf.pushFinal({
              id: chunkId,
              text: e.text,
              startMs: Math.round(e.offsetMs),
              endMs,
              lang: e.lang,
            });
          } else if (e.kind === "error") {
            setError(e.message);
          }
        },
      });
      recognizerRef.current = handle;
      setListening(true);
    } catch (e: any) {
      setError(e.message);
      await stopListening();
    }
  };

  const stopListening = useCallback(async () => {
    setListening(false);
    if (rafRef.current) cancelAnimationFrame(rafRef.current);
    rafRef.current = null;
    streamRef.current?.getTracks().forEach((t) => t.stop());
    streamRef.current = null;
    if (audioCtxRef.current) {
      try { await audioCtxRef.current.close(); } catch { /* ignore */ }
      audioCtxRef.current = null;
    }
    analyserRef.current = null;
    setLevel(0);
    if (recognizerRef.current) {
      try { await recognizerRef.current.stop(); } catch { /* ignore */ }
      recognizerRef.current = null;
    }
    if (bufferRef.current) {
      bufferRef.current.forceFlush("manual_stop");
      bufferRef.current.dispose();
      bufferRef.current = null;
    }
  }, []);

  useEffect(() => () => { void stopListening(); }, [stopListening]);

  // ============= Document handlers =============

  const editTimers = useRef<Map<string, ReturnType<typeof setTimeout>>>(new Map());

  const onEditBlock = useCallback(
    (id: string, patch: { heading?: string; body?: string }) => {
      const existing = docRef.current[id];
      if (!existing) return;
      const next: BriefBlock = {
        ...existing,
        heading: patch.heading !== undefined ? patch.heading : existing.heading,
        body: patch.body !== undefined ? patch.body : existing.body,
        lastEditedBy: "user",
        locked: true,
      };
      const map = { ...docRef.current, [id]: next };
      setDoc(map);
      docRef.current = map;

      // Debounced persist (600ms) per block.
      const existingTimer = editTimers.current.get(id);
      if (existingTimer) clearTimeout(existingTimer);
      const t = setTimeout(() => {
        editTimers.current.delete(id);
        void persistBlock(next);
      }, 600);
      editTimers.current.set(id, t);
    },
    [persistBlock],
  );

  const onAddBlock = useCallback(async () => {
    if (!activeSessionId) return;
    const keys = Object.values(docRef.current).map((b) => b.orderKey).sort();
    const newBlock: BriefBlock = {
      id: crypto.randomUUID(),
      sessionId: activeSessionId,
      orderKey: between(keys.length ? keys[keys.length - 1] : null, null),
      heading: "",
      level: 3,
      body: "",
      lastEditedBy: "user",
      locked: true,
      sourceChunkIds: [],
    };
    const map = { ...docRef.current, [newBlock.id]: newBlock };
    setDoc(map);
    docRef.current = map;
    await persistBlock(newBlock);
  }, [activeSessionId, persistBlock]);

  const liveText = useMemo(
    () => (finals.map((f) => f.text).join(" ") + " " + partial).trim(),
    [finals, partial],
  );

  const blockCount = Object.keys(doc).length;

  // ============= UI =============

  return (
    <div className="h-screen w-screen flex bg-background text-foreground overflow-hidden">
      {/* SIDEBAR */}
      <aside
        className={`flex flex-col border-r border-auralis bg-surface transition-[width] duration-300 ease-out ${
          sidebarOpen ? "w-[260px]" : "w-[56px]"
        }`}
      >
        <div className="flex items-center justify-between h-14 px-3 border-b border-auralis shrink-0">
          <button
            onClick={() => setSidebarOpen((v) => !v)}
            className="w-9 h-9 rounded-lg hover:bg-surface-variant flex items-center justify-center text-primary"
            aria-label="Toggle sidebar"
          >
            <span className="material-symbols-outlined text-[20px]">menu</span>
          </button>
          {sidebarOpen && (
            <button
              onClick={newSession}
              className="w-9 h-9 rounded-lg hover:bg-surface-variant flex items-center justify-center text-primary"
              aria-label="New session"
            >
              <span className="material-symbols-outlined text-[20px]">edit_square</span>
            </button>
          )}
        </div>

        {sidebarOpen && (
          <>
            <div className="px-4 pt-4 pb-2">
              <span className="text-[10px] uppercase tracking-[0.18em] text-secondary">Sessions</span>
            </div>
            <nav className="flex-1 overflow-y-auto px-2 pb-4 space-y-0.5">
              {sessions.map((s) => (
                <button
                  key={s.id}
                  onClick={() => openSession(s.id)}
                  className={`w-full text-left px-3 py-2 rounded-lg transition-colors ${
                    activeSessionId === s.id
                      ? "bg-surface-variant text-primary"
                      : "text-secondary hover:bg-surface-variant/60 hover:text-primary"
                  }`}
                >
                  <div className="text-sm font-medium truncate">{s.title}</div>
                  <div className="text-[11px] text-secondary mt-0.5">{relative(s.started_at)}</div>
                </button>
              ))}
            </nav>
            <div className="border-t border-auralis p-3 flex items-center justify-between">
              <div className="flex items-center gap-2">
                <div className="w-7 h-7 rounded-full bg-gradient-to-tr from-rose-400 via-indigo-300 to-emerald-300" />
                <span className="text-xs text-primary font-medium">Murmur</span>
              </div>
              <button
                onClick={signOut}
                className="text-[11px] text-secondary hover:text-primary"
                title="Sign out"
              >
                Sign out
              </button>
            </div>
          </>
        )}
      </aside>

      {/* MAIN */}
      <main className="flex-1 flex min-w-0">
        {/* AUDIO PANEL */}
        <section className="w-[380px] xl:w-[420px] shrink-0 border-r border-auralis flex flex-col min-h-0">
          <header className="h-14 px-5 flex items-center justify-between border-b border-auralis shrink-0">
            <span className="text-xs uppercase tracking-[0.18em] text-secondary">Audio Interaction</span>
            <span className={`text-xs flex items-center gap-2 ${listening ? "text-emerald-600" : "text-secondary"}`}>
              <span className={`w-1.5 h-1.5 rounded-full ${listening ? "bg-emerald-500 animate-pulse" : "bg-secondary"}`} />
              {listening ? "Listening" : "Idle"}
            </span>
          </header>

          {/* Waveform */}
          <div className="flex-1 flex items-center justify-center p-6 min-h-0 relative">
            <div className="relative w-[260px] h-[260px] flex items-center justify-center">
              <div className={`absolute inset-0 rounded-full border border-auralis/25 blur-[2px] ${listening ? "animate-[ring-pulse_3.2s_ease-out_infinite]" : ""}`} />
              <div className={`absolute inset-8 rounded-full border border-auralis/40 ${listening ? "animate-[ring-pulse_4.1s_ease-out_infinite_0.6s]" : ""}`} />
              <div
                className={`absolute left-[50px] top-[80px] w-[50px] h-[100px] rounded-full bg-gradient-to-tr from-rose-400 to-orange-300 opacity-80 mix-blend-multiply blur-[6px] ${listening ? "animate-[orb-a_3s_ease-in-out_infinite]" : ""}`}
                style={{ transform: `scale(${1 + level * 0.3})` }}
              />
              <div
                className={`absolute right-[50px] top-[80px] w-[50px] h-[100px] rounded-full bg-gradient-to-tr from-emerald-300 to-teal-300 opacity-80 mix-blend-multiply blur-[6px] ${listening ? "animate-[orb-c_4.2s_ease-in-out_infinite]" : ""}`}
                style={{ transform: `scale(${1 + level * 0.28})` }}
              />
              <div
                className={`relative w-[65px] h-[130px] rounded-full bg-gradient-to-tr from-indigo-400 via-violet-400 to-purple-500 opacity-90 blur-[4px] ${listening ? "animate-[orb-b_3.6s_ease-in-out_infinite]" : ""}`}
                style={{ transform: `scale(${1 + level * 0.35})` }}
              />
            </div>
          </div>

          {/* Controls */}
          <div className="px-5 pb-4 flex items-center justify-center gap-2 shrink-0">
            <button
              onClick={startListening}
              disabled={listening || !activeSessionId}
              className="px-5 py-2.5 rounded-full bg-primary text-on-primary text-sm font-medium disabled:opacity-40 hover:opacity-90 flex items-center gap-2"
            >
              <span className="material-symbols-outlined text-base">mic</span>
              Start
            </button>
            <button
              onClick={() => { void stopListening(); }}
              disabled={!listening}
              className="px-5 py-2.5 rounded-full border border-auralis bg-surface text-primary text-sm font-medium disabled:opacity-40 hover:bg-surface-variant flex items-center gap-2"
            >
              <span className="material-symbols-outlined text-base">stop</span>
              Stop
            </button>
          </div>

          {/* Transcript */}
          <div className="border-t border-auralis bg-surface/60 shrink-0">
            <button
              onClick={() => setExpanded((v) => !v)}
              className="w-full flex items-center justify-between px-5 py-3 hover:bg-surface-variant/40 transition-colors"
            >
              <span className="text-xs uppercase tracking-[0.18em] text-secondary">Transcript</span>
              <span className="material-symbols-outlined text-secondary text-lg">
                {expanded ? "expand_more" : "expand_less"}
              </span>
            </button>
            <div className="grid transition-all duration-300 ease-out" style={{ gridTemplateRows: expanded ? "1fr" : "0fr" }}>
              <div className="overflow-hidden">
                <div className="px-5 pb-4 max-h-48 overflow-y-auto text-sm leading-relaxed text-primary">
                  {finals.length === 0 && !partial && (
                    <p className="text-secondary italic">Start speaking to see live transcription here…</p>
                  )}
                  {finals.map((f) => (
                    <p key={f.id} className="mb-1">{f.text}</p>
                  ))}
                  {partial && <p className="text-secondary">{partial}</p>}
                </div>
              </div>
            </div>
          </div>
        </section>

        {/* CANVAS PANEL */}
        <section className="flex-1 flex flex-col min-w-0">
          <header className="h-14 px-6 flex items-center justify-between border-b border-auralis shrink-0">
            <span className="text-xs uppercase tracking-[0.18em] text-secondary">Live Brief</span>
            <div className="flex items-center gap-2">
              <span className="px-3 py-1 bg-surface rounded-full text-xs text-primary border border-auralis">Gemini 3 Flash</span>
              <span className="text-xs text-secondary ml-3 flex items-center gap-1.5">
                {aiLoading ? (
                  <>
                    <span className="w-1.5 h-1.5 rounded-full bg-amber-500 animate-pulse" /> Thinking…
                  </>
                ) : (
                  <>
                    <span className="w-1.5 h-1.5 rounded-full bg-emerald-500" /> Synced
                  </>
                )}
              </span>
            </div>
          </header>
          {error && (
            <div className="px-6 py-2 bg-rose-500/10 border-b border-rose-500/20 text-xs text-rose-500 flex items-center justify-between">
              <span>{error}</span>
              <button onClick={() => setError(null)} className="text-rose-500/70 hover:text-rose-500">✕</button>
            </div>
          )}
          <div className="flex-1 overflow-y-auto p-8 min-h-0">
            <BriefDocument
              doc={doc}
              onEditBlock={onEditBlock}
              onAddBlock={onAddBlock}
              aiLoading={aiLoading}
            />
          </div>
          <footer className="h-10 px-6 flex items-center justify-between border-t border-auralis text-xs text-secondary shrink-0">
            <span>{liveText.length} chars · {finals.length} segments · {blockCount} blocks</span>
            <span>Murmur · <Link to="/" className="hover:text-primary">Home</Link></span>
          </footer>
        </section>
      </main>
    </div>
  );
}
