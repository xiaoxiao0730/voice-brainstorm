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
  deleteSession,
  endSession,
  getSessionContext,
  listSessions,
} from "@/lib/session.functions";

import {
  deleteBriefNode,
  loadBrief,
  persistChunks,
  persistSegment,
  upsertBriefNode,
} from "@/lib/brief.functions";
import { orchestrateSegment } from "@/lib/orchestrate.functions";
import { exportBriefToDocx } from "@/lib/exportDocx";

import { getRealtimeSession } from "@/lib/agent/realtime.functions";
import { connectRealtime, type RealtimeClient } from "@/lib/agent/realtimeClient";
import { generateIntervention } from "@/lib/agent/responseGenerator.functions";
import { logIntervention } from "@/lib/agent/interventionLog.functions";
import { createPolicyEngine } from "@/lib/agent/interventionPolicy";
import { type AgentStatus } from "@/components/agent/AgentPanel";

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

  const { session: requestedSessionId } = Route.useSearch();

  // Server fn hooks
  const list = useServerFn(listSessions);
  const createS = useServerFn(createSession);

  const endS = useServerFn(endSession);
  const deleteS = useServerFn(deleteSession);
  const getCtx = useServerFn(getSessionContext);

  const getToken = useServerFn(getSpeechToken);
  const loadB = useServerFn(loadBrief);
  const upsertN = useServerFn(upsertBriefNode);
  const deleteN = useServerFn(deleteBriefNode);
  const saveChunks = useServerFn(persistChunks);
  const saveSegment = useServerFn(persistSegment);
  const orchestrate = useServerFn(orchestrateSegment);
  const generateNudge = useServerFn(generateIntervention);
  const logIntv = useServerFn(logIntervention);
  const mintRealtime = useServerFn(getRealtimeSession);

  // UI state
  const [sessions, setSessions] = useState<SessionRow[]>([]);
  const [activeSessionId, setActiveSessionId] = useState<string | null>(null);
  const [sidebarOpen, setSidebarOpen] = useState(true);
  const [menuOpenFor, setMenuOpenFor] = useState<string | null>(null);
  const [expanded, setExpanded] = useState(true);
  const [listening, setListening] = useState(false);
  const [level, setLevel] = useState(0);
  const [partial, setPartial] = useState("");
  const [finals, setFinals] = useState<{ id: string; text: string }[]>([]);
  const [doc, setDoc] = useState<BriefDoc>({});
  const [aiLoading, setAiLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Agent state — Realtime voice lane only. Background canvas lane runs
  // whenever `listening` is true, independent of `agentEnabled`.
  const [agentEnabled, setAgentEnabled] = useState(false);
  const [agentStatus, setAgentStatus] = useState<AgentStatus>("off");

  const [userEmail, setUserEmail] = useState<string | null>(null);

  const MODEL_OPTIONS = [
    { id: "google/gemini-3-flash-preview", label: "Gemini 3 Flash" },
    { id: "google/gemini-2.5-pro", label: "Gemini 2.5 Pro" },
    { id: "openai/gpt-5", label: "GPT-5" },
    { id: "openai/gpt-5-mini", label: "GPT-5 Mini" },
  ] as const;
  const [model, setModel] = useState<(typeof MODEL_OPTIONS)[number]["id"]>("google/gemini-3-flash-preview");
  const modelRef = useRef(model);
  useEffect(() => { modelRef.current = model; }, [model]);

  // Refs
  const recognizerRef = useRef<SpeechRecognizerHandle | null>(null);
  const bufferRef = useRef<ReturnType<typeof createTranscriptBuffer> | null>(null);
  const audioCtxRef = useRef<AudioContext | null>(null);
  const analyserRef = useRef<AnalyserNode | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const rafRef = useRef<number | null>(null);
  const docRef = useRef(doc);
  const activeSessionRef = useRef(activeSessionId);

  // Agent refs
  const realtimeRef = useRef<RealtimeClient | null>(null);
  const policyRef = useRef(createPolicyEngine(null));
  const recentTextsRef = useRef<string[]>([]);
  const listeningRef = useRef(listening);
  const agentConnectedAtRef = useRef(Date.now());

  useEffect(() => { docRef.current = doc; }, [doc]);
  useEffect(() => {
    activeSessionRef.current = activeSessionId;
    policyRef.current = createPolicyEngine(activeSessionId);
    recentTextsRef.current = [];
  }, [activeSessionId]);
  useEffect(() => { listeningRef.current = listening; }, [listening]);


  // Fetch user email
  useEffect(() => {
    supabase.auth.getUser().then(({ data }) => {
      setUserEmail(data.user?.email ?? null);
    });
  }, []);

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

  // Initial load — honor ?session=… first, else open most recent or create new
  useEffect(() => {
    (async () => {
      const rows = await refreshSessions();
      if (requestedSessionId && rows.some((r) => r.id === requestedSessionId)) {
        await openSession(requestedSessionId);
      } else if (rows.length > 0) {
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

        // First time opening a session that has an onboarding prompt → seed
        // it as the first locked block so the AI treats it as the user's
        // intent and writes around it.
        if (Object.keys(map).length === 0) {
          try {
            const ctx = await getCtx({ data: { sessionId: id } });
            if (ctx.prompt?.trim()) {
              const seeded: BriefBlock = {
                id: crypto.randomUUID(),
                sessionId: id,
                orderKey: between(null, null),
                heading: "Starting thought",
                level: 2,
                body: ctx.prompt.trim(),
                lastEditedBy: "user",
                locked: true,
                sourceChunkIds: [],
              };
              map[seeded.id] = seeded;
              void upsertN({ data: blockToNodeUpsert(seeded) }).catch((e) =>
                console.warn("seed upsert failed", e),
              );
            }
          } catch (e) {
            console.warn("getCtx failed", e);
          }
        }
        setDoc(map);
      } catch (e: any) {
        setError(e.message);
      }
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [loadB, getCtx, upsertN],
  );


  const newSession = async () => {
    const created = await createS({ data: {} });
    await refreshSessions();
    await openSession(created.id);
  };

  const handleDeleteSession = useCallback(
    async (id: string) => {
      const target = sessions.find((s) => s.id === id);
      const label = target?.title ?? "this session";
      if (!window.confirm(`Delete "${label}"? This permanently removes its transcript and brief.`)) return;
      setMenuOpenFor(null);
      try {
        await deleteS({ data: { sessionId: id } });
        if (typeof window !== "undefined") {
          window.localStorage.removeItem(`murmur.agent.policy.${id}`);
        }
        const rows = await refreshSessions();
        if (activeSessionId === id) {
          if (rows.length > 0) {
            await openSession(rows[0].id);
          } else {
            const created = await createS({ data: {} });
            await refreshSessions();
            await openSession(created.id);
          }
        }
      } catch (e: any) {
        setError(e?.message ?? "Delete failed");
      }
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [deleteS, sessions, activeSessionId, refreshSessions, openSession],
  );


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
            model: modelRef.current,
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

      // ============= Background Canvas Lane =============
      // Runs unconditionally on every committed segment. Independent of the
      // Realtime voice lane — never gated on whether the agent is speaking.
      void runBackgroundCanvas(segment).catch((e) => console.warn("canvas lane failed", e));
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [orchestrate, saveSegment, persistBlock],
  );

  // ---- BACKGROUND CANVAS LANE ----
  // Reads the committed STT segment, asks a deep model for a structural
  // addition to the Live Brief, and (when emitted) inserts it inline as a
  // locked AI-authored block. Optionally whispers a one-line insight into the
  // active Realtime voice session as silent system context.
  const runBackgroundCanvas = useCallback(
    async (segment: TranscriptSegment) => {
      if (!listeningRef.current) return;
      if (!policyRef.current.shouldEmitCanvas()) return;

      recentTextsRef.current = [...recentTextsRef.current, segment.rawText].slice(-6);

      const snapshot = Object.values(docRef.current)
        .sort((a, b) => a.orderKey.localeCompare(b.orderKey))
        .map((b) => ({ heading: b.heading, level: b.level, body: b.body }));

      setAgentStatus((s) => (s === "speaking" ? s : "thinking"));

      let result:
        | { emit: true; patch: { heading: string; body: string; rationale: string }; insight?: string }
        | { emit: false; insight?: string; error?: string };
      try {
        result = (await generateNudge({
          data: {
            latestText: segment.rawText,
            recentTexts: recentTextsRef.current.slice(0, -1),
            snapshot,
            model: modelRef.current,
          },
        })) as typeof result;
      } catch (e) {
        console.warn("generateIntervention failed", e);
        setAgentStatus((s) => (s === "speaking" ? s : realtimeRef.current ? "listening" : "off"));
        return;
      }

      // Inject background insight into the Realtime voice session, if any.
      if (result.insight && realtimeRef.current) {
        try { realtimeRef.current.injectContext(result.insight); } catch { /* ignore */ }
      }

      if (!result.emit) {
        try {
          await logIntv({
            data: { sessionId: segment.sessionId, segmentId: segment.segmentId, decision: "silent" },
          });
        } catch { /* best effort */ }
        setAgentStatus((s) => (s === "speaking" ? s : realtimeRef.current ? "listening" : "off"));
        return;
      }

      const patch = result.patch;
      const sid = segment.sessionId;
      const keys = Object.values(docRef.current).map((b) => b.orderKey).sort();
      const newBlock: BriefBlock = {
        id: crypto.randomUUID(),
        sessionId: sid,
        orderKey: between(keys.length ? keys[keys.length - 1] : null, null),
        heading: patch.heading,
        level: 3,
        body: patch.body,
        lastEditedBy: "ai",
        locked: true,
        sourceChunkIds: [],
      };
      const map = { ...docRef.current, [newBlock.id]: newBlock };
      setDoc(map);
      docRef.current = map;
      await persistBlock(newBlock);
      policyRef.current.recordCanvas();

      try {
        await logIntv({
          data: {
            sessionId: segment.sessionId,
            segmentId: segment.segmentId,
            decision: "canvas",
            responseText: patch.body,
          },
        });
      } catch { /* best effort */ }

      setAgentStatus((s) => (s === "speaking" ? s : realtimeRef.current ? "listening" : "off"));
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [generateNudge, logIntv, persistBlock],
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
    // Disconnect the agent too — its mic track is cloned from the now-stopped stream.
    if (realtimeRef.current) {
      try { await realtimeRef.current.disconnect(); } catch { /* ignore */ }
      realtimeRef.current = null;
    }
    setAgentEnabled(false);
    setAgentStatus("off");
  }, []);

  useEffect(() => () => { void stopListening(); }, [stopListening]);

  // ============= Agent connect / toggle / feedback =============

  const connectAgent = useCallback(async () => {
    if (realtimeRef.current) return;
    if (!streamRef.current || !activeSessionRef.current) {
      setError("Start listening first so the agent can hear you.");
      return;
    }
    setAgentStatus("connecting");
    try {
      const { clientSecret, model: rtModel } = await mintRealtime();
      const client = await connectRealtime({
        clientSecret,
        model: rtModel,
        micStream: streamRef.current,
        events: {
          onConnected: () => {
            agentConnectedAtRef.current = Date.now();
            setAgentStatus("listening");
          },
          onAgentSpeakingStart: () => setAgentStatus("speaking"),
          onAgentSpeakingEnd: () => setAgentStatus("listening"),
          onUserBargeIn: () => setAgentStatus("listening"),
          onDisconnected: () => setAgentStatus("off"),
          onAgentTranscript: (text) => {
            const sessionId = activeSessionRef.current;
            if (!sessionId || !text) return;
            // Surface the agent's spoken line in the transcript list and
            // persist it as a chunk so it shows up alongside user speech.
            const chunkId = crypto.randomUUID();
            const labeled = `🤖 ${text}`;
            setFinals((f) => [...f, { id: chunkId, text: labeled }]);
            // Use a small offset relative to agent-connect time — the DB
            // column is a 32-bit integer, so raw Date.now() overflows.
            const offset = Date.now() - agentConnectedAtRef.current;
            saveChunks({
              data: {
                sessionId,
                chunks: [{
                  id: chunkId,
                  text: labeled,
                  isFinal: true,
                  startMs: offset,
                  endMs: offset,
                  lang: "agent",
                }],
              },
            }).catch((err) => console.warn("persist agent chunk failed", err));
          },
          onError: (err) => {
            console.warn("realtime error", err);
            setAgentStatus("error");
          },
        },
      });
      realtimeRef.current = client;
    } catch (e: any) {
      setError(e.message ?? "Failed to connect agent");
      setAgentStatus("error");
    }
  }, [mintRealtime, saveChunks]);

  const toggleAgent = useCallback(async () => {
    if (agentEnabled) {
      if (realtimeRef.current) {
        try { await realtimeRef.current.disconnect(); } catch { /* ignore */ }
        realtimeRef.current = null;
      }
      setAgentEnabled(false);
      setAgentStatus("off");
      return;
    }
    // Auto-start mic if not already listening — Talk with Agent implies
    // both panels should be live.
    if (!listening || !streamRef.current) {
      try {
        await startListening();
      } catch {
        setError("Couldn't access the microphone. Check browser permissions and try again.");
        return;
      }
    }
    setAgentEnabled(true);
    void connectAgent();
  }, [agentEnabled, listening, connectAgent]);

  // Note: no auto-connect effect — toggleAgent owns connection lifecycle.





  // Hotkeys (outside text inputs):
  //   T → toggle voice listening (Azure STT only)
  //   A → start talking with agent mode on (enables agent + starts listening)
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.repeat) return;
      if (e.ctrlKey || e.metaKey || e.altKey || e.shiftKey) return;
      const key = e.key.toLowerCase();
      if (key !== "t" && key !== "a") return;
      const t = e.target as HTMLElement | null;
      if (t) {
        const tag = t.tagName;
        if (tag === "INPUT" || tag === "TEXTAREA" || t.isContentEditable) return;
      }
      e.preventDefault();
      if (key === "t") {
        if (listening) void stopListening();
        else void startListening();
        return;
      }
      // "a": start agent conversation
      (async () => {
        if (!listening) await startListening();
        if (!agentEnabledRef.current) await toggleAgent();
      })();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [listening, stopListening, activeSessionId, toggleAgent]);


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

  const onDeleteBlock = useCallback(
    async (id: string) => {
      const next = { ...docRef.current };
      delete next[id];
      setDoc(next);
      docRef.current = next;
      await deleteN({ data: { id } }).catch((e) => console.warn("delete failed", e));
    },
    [deleteN],
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
                <div
                  key={s.id}
                  className={`group relative w-full rounded-lg transition-colors ${
                    activeSessionId === s.id
                      ? "bg-surface-variant text-primary"
                      : "text-secondary hover:bg-surface-variant/60 hover:text-primary"
                  }`}
                >
                  <button
                    onClick={() => openSession(s.id)}
                    className="w-full text-left px-3 py-2 pr-9"
                  >
                    <div className="text-sm font-medium truncate">{s.title}</div>
                    <div className="text-[11px] text-secondary mt-0.5">{relative(s.started_at)}</div>
                  </button>
                  <button
                    onClick={(e) => {
                      e.stopPropagation();
                      setMenuOpenFor((cur) => (cur === s.id ? null : s.id));
                    }}
                    className={`absolute top-1.5 right-1.5 w-7 h-7 rounded-md flex items-center justify-center text-secondary hover:bg-surface hover:text-primary ${
                      menuOpenFor === s.id ? "opacity-100" : "opacity-0 group-hover:opacity-100 focus:opacity-100"
                    }`}
                    aria-label="Session options"
                    aria-haspopup="menu"
                    aria-expanded={menuOpenFor === s.id}
                  >
                    <span className="material-symbols-outlined text-[18px]">more_horiz</span>
                  </button>
                  {menuOpenFor === s.id && (
                    <>
                      <div
                        className="fixed inset-0 z-10"
                        onClick={() => setMenuOpenFor(null)}
                        aria-hidden="true"
                      />
                      <div
                        role="menu"
                        className="absolute z-20 top-9 right-1.5 min-w-[140px] rounded-md border border-auralis bg-surface shadow-lg py-1"
                      >
                        <button
                          role="menuitem"
                          onClick={(e) => {
                            e.stopPropagation();
                            void handleDeleteSession(s.id);
                          }}
                          className="w-full text-left px-3 py-1.5 text-xs text-rose-500 hover:bg-surface-variant flex items-center gap-2"
                        >
                          <span className="material-symbols-outlined text-[16px]">delete</span>
                          Delete
                        </button>
                      </div>
                    </>
                  )}
                </div>
              ))}
            </nav>
            <div className="border-t border-auralis p-3 flex items-center justify-between">
              <div className="flex items-center gap-2">
                <div className="w-7 h-7 rounded-full bg-gradient-to-tr from-rose-400 via-indigo-300 to-emerald-300" />
                <span className="text-xs text-primary font-medium truncate max-w-[140px]">{userEmail ?? "Murmur"}</span>
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
            {/* Start / Stop toggle */}
            <button
              onClick={() => { listening ? void stopListening() : void startListening(); }}
              disabled={!activeSessionId}
              className={`px-5 py-2.5 rounded-full text-sm font-medium disabled:opacity-40 hover:opacity-90 flex items-center gap-2 ${
                listening
                  ? "border border-auralis bg-surface text-primary hover:bg-surface-variant"
                  : "bg-primary text-on-primary"
              }`}
            >
              <span className="material-symbols-outlined text-base">{listening ? "stop" : "mic"}</span>
              {listening ? "Stop" : "Start"}
            </button>

            {/* Talk with Agent toggle */}
            <button
              onClick={() => void toggleAgent()}
              disabled={!activeSessionId}
              className={`px-5 py-2.5 rounded-full text-sm font-medium disabled:opacity-40 hover:opacity-90 flex items-center gap-2 ${
                agentEnabled
                  ? "border border-auralis bg-surface text-primary hover:bg-surface-variant"
                  : "bg-primary text-on-primary"
              }`}
              title={agentEnabled ? "Stop talking with agent" : "Talk with agent"}
            >
              <span
                className={`w-1.5 h-1.5 rounded-full ${
                  agentStatus === "connecting"
                    ? "bg-amber-400 animate-pulse"
                    : agentStatus === "thinking"
                    ? "bg-amber-500 animate-pulse"
                    : agentStatus === "speaking"
                    ? "bg-indigo-500 animate-pulse"
                    : agentStatus === "listening"
                    ? "bg-emerald-500"
                    : agentStatus === "error"
                    ? "bg-rose-500"
                    : "bg-secondary"
                }`}
              />
              {!agentEnabled
                ? "Talk with Agent"
                : agentStatus === "connecting"
                ? "Connecting…"
                : agentStatus === "thinking"
                ? "Agent Thinking…"
                : agentStatus === "speaking"
                ? "Agent Speaking…"
                : agentStatus === "error"
                ? "Agent Error"
                : "Stop Agent"}
            </button>

            {muted && (
              <button
                onClick={() => setMuted(false)}
                className="px-2.5 py-1 rounded-full border border-rose-500/40 bg-rose-500/10 text-rose-500 text-[11px]"
                title="Agent muted — click to resume"
              >
                Muted
              </button>
            )}
          </div>
          <div className="px-5 pb-3 flex items-center justify-center shrink-0">
            <span className="text-[11px] text-secondary">
              Press <kbd className="px-1.5 py-0.5 rounded border border-auralis bg-surface text-[10px] font-mono">T</kbd> to {listening ? "stop" : "start"} talking ·{" "}
              <kbd className="px-1.5 py-0.5 rounded border border-auralis bg-surface text-[10px] font-mono">A</kbd> to talk with agent
            </span>
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
              <select
                value={model}
                onChange={(e) => setModel(e.target.value as typeof model)}
                className="px-3 py-1 bg-surface rounded-full text-xs text-primary border border-auralis hover:bg-surface-variant cursor-pointer focus:outline-none focus:ring-1 focus:ring-primary"
                aria-label="AI model"
                title="Select AI model"
              >
                {MODEL_OPTIONS.map((m) => (
                  <option key={m.id} value={m.id}>{m.label}</option>
                ))}
              </select>
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
              <button
                onClick={() => {
                  const active = sessions.find((s) => s.id === activeSessionId);
                  void exportBriefToDocx(doc, active?.title ?? "Live Brief").catch((e) =>
                    setError(e?.message ?? "Export failed"),
                  );
                }}
                disabled={blockCount === 0}
                className="ml-3 px-3 py-1.5 rounded-full border border-auralis bg-surface text-primary text-xs font-medium hover:bg-surface-variant disabled:opacity-40 flex items-center gap-1.5"
                aria-label="Export to Word"
                title="Export to Word (.docx)"
              >
                <span className="material-symbols-outlined text-base">download</span>
                Export
              </button>
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
              onDeleteBlock={onDeleteBlock}
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

      <AgentSuggestionCard
        suggestion={suggestion}
        onAccept={handleSuggestionAccept}
        onDismiss={handleSuggestionDismiss}
        onAskOutLoud={handleAskOutLoud}
      />
      <CanvasGhostPatchCard
        patch={ghostPatch}
        onAccept={handleGhostAccept}
        onEdit={handleGhostEdit}
        onDismiss={handleGhostDismiss}
      />
    </div>
  );
}
