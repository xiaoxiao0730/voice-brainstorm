import { createFileRoute } from "@tanstack/react-router";
import { useCallback, useEffect, useRef, useState } from "react";

export const Route = createFileRoute("/workbench")({
  head: () => ({
    meta: [
      { title: "Brainstorm AI — Co-thinking Workbench" },
      { name: "description", content: "Voice-driven AI co-thinking workbench with a live transcript canvas." },
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

type SR = any;

type Session = { id: string; title: string; time: string };

const MOCK_SESSIONS: Session[] = [
  { id: "s1", title: "Untitled session", time: "Just now" },
  { id: "s2", title: "Product naming brainstorm", time: "Yesterday" },
  { id: "s3", title: "Q3 strategy notes", time: "2 days ago" },
  { id: "s4", title: "Personal reflection — career", time: "Last week" },
  { id: "s5", title: "Trip planning · Lisbon", time: "Last week" },
];

function Workbench() {
  const [listening, setListening] = useState(false);
  const [level, setLevel] = useState(0);
  const [partial, setPartial] = useState("");
  const [finals, setFinals] = useState<string[]>([]);
  const [expanded, setExpanded] = useState(true);
  const [sidebarOpen, setSidebarOpen] = useState(true);
  const [activeSession, setActiveSession] = useState("s1");

  const audioCtxRef = useRef<AudioContext | null>(null);
  const analyserRef = useRef<AnalyserNode | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const rafRef = useRef<number | null>(null);
  const recogRef = useRef<SR>(null);

  const stop = useCallback(() => {
    setListening(false);
    if (rafRef.current) cancelAnimationFrame(rafRef.current);
    rafRef.current = null;
    streamRef.current?.getTracks().forEach((t) => t.stop());
    streamRef.current = null;
    if (audioCtxRef.current) {
      audioCtxRef.current.close();
      audioCtxRef.current = null;
    }
    analyserRef.current = null;
    try { recogRef.current?.stop(); } catch {}
    setLevel(0);
  }, []);

  const start = useCallback(async () => {
    if (listening) return;
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      streamRef.current = stream;
      const ctx = new (window.AudioContext || (window as any).webkitAudioContext)();
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

      const SRClass: any = (window as any).SpeechRecognition || (window as any).webkitSpeechRecognition;
      if (SRClass) {
        const r = new SRClass();
        r.continuous = true;
        r.interimResults = true;
        r.lang = navigator.language || "en-US";
        r.onresult = (e: any) => {
          let interim = "";
          for (let i = e.resultIndex; i < e.results.length; i++) {
            const res = e.results[i];
            const txt = res[0].transcript;
            if (res.isFinal) {
              setFinals((f) => [...f, txt.trim()]);
              interim = "";
            } else {
              interim += txt;
            }
          }
          setPartial(interim);
        };
        r.onerror = () => {};
        r.onend = () => { if (listening) try { r.start(); } catch {} };
        recogRef.current = r;
        try { r.start(); } catch {}
      }
      setListening(true);
    } catch (e) {
      console.error(e);
      stop();
    }
  }, [listening, stop]);

  useEffect(() => () => stop(), [stop]);

  const liveText = (finals.join(" ") + " " + partial).trim();

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
            <button className="w-9 h-9 rounded-lg hover:bg-surface-variant flex items-center justify-center text-primary" aria-label="New session">
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
              {MOCK_SESSIONS.map((s) => (
                <button
                  key={s.id}
                  onClick={() => setActiveSession(s.id)}
                  className={`w-full text-left px-3 py-2 rounded-lg transition-colors ${
                    activeSession === s.id
                      ? "bg-surface-variant text-primary"
                      : "text-secondary hover:bg-surface-variant/60 hover:text-primary"
                  }`}
                >
                  <div className="text-sm font-medium truncate">{s.title}</div>
                  <div className="text-[11px] text-secondary mt-0.5">{s.time}</div>
                </button>
              ))}
            </nav>
            <div className="border-t border-auralis p-3 flex items-center gap-2">
              <div className="w-7 h-7 rounded-full bg-gradient-to-tr from-rose-400 via-indigo-300 to-emerald-300" />
              <span className="text-xs text-primary font-medium">Brainstorm</span>
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
              <div className={`absolute inset-0 rounded-full border border-auralis/60 ${listening ? "animate-[ring-pulse_3.2s_ease-out_infinite]" : ""}`} />
              <div className={`absolute inset-6 rounded-full border border-auralis/40 ${listening ? "animate-[ring-pulse_4.1s_ease-out_infinite_0.6s]" : ""}`} />

              <div
                className={`absolute left-6 w-[110px] h-[110px] rounded-full bg-gradient-to-tr from-rose-400 to-orange-300 opacity-80 mix-blend-multiply blur-[6px] ${listening ? "animate-[orb-a_3s_ease-in-out_infinite]" : ""}`}
                style={{ transform: `scale(${1 + level * 0.3})` }}
              />
              <div
                className={`absolute right-6 w-[110px] h-[110px] rounded-full bg-gradient-to-tr from-emerald-300 to-teal-300 opacity-80 mix-blend-multiply blur-[6px] ${listening ? "animate-[orb-c_4.2s_ease-in-out_infinite]" : ""}`}
                style={{ transform: `scale(${1 + level * 0.28})` }}
              />
              <div
                className={`relative w-[150px] h-[150px] rounded-full bg-gradient-to-tr from-indigo-400 via-violet-400 to-purple-500 opacity-90 blur-[4px] ${listening ? "animate-[orb-b_3.6s_ease-in-out_infinite]" : ""}`}
                style={{ transform: `scale(${1 + level * 0.35})` }}
              />
              <div
                className="absolute w-3 h-3 rounded-full bg-primary/90 shadow-[0_0_24px_rgba(0,0,0,0.25)]"
                style={{ transform: `scale(${1 + level * 0.8})` }}
              />
            </div>
          </div>

          {/* Controls */}
          <div className="px-5 pb-4 flex items-center justify-center gap-2 shrink-0">
            <button
              onClick={start}
              disabled={listening}
              className="px-5 py-2.5 rounded-full bg-primary text-on-primary text-sm font-medium disabled:opacity-40 hover:opacity-90 flex items-center gap-2"
            >
              <span className="material-symbols-outlined text-base">mic</span>
              Start
            </button>
            <button
              onClick={stop}
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
                  {finals.map((t, i) => (
                    <p key={i} className="mb-1">{t}</p>
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
            <span className="text-xs uppercase tracking-[0.18em] text-secondary">Live Canvas</span>
            <div className="flex items-center gap-2">
              <span className="px-3 py-1 bg-surface rounded-full text-xs text-primary border border-auralis">Auto-format</span>
              <span className="px-3 py-1 bg-surface rounded-full text-xs text-secondary border border-auralis">Markdown</span>
              <span className="text-xs text-secondary ml-3 flex items-center gap-1.5">
                <span className="w-1.5 h-1.5 rounded-full bg-emerald-500" /> Synced
              </span>
            </div>
          </header>
          <div className="flex-1 overflow-y-auto p-8 min-h-0">
            <Canvas finals={finals} partial={partial} />
          </div>
          <footer className="h-10 px-6 flex items-center justify-between border-t border-auralis text-xs text-secondary shrink-0">
            <span>{liveText.length} chars · {finals.length} segments</span>
            <span>Auralis Workbench</span>
          </footer>
        </section>
      </main>
    </div>
  );
}

function Orb({ className, size, level }: { className: string; size: number; level: number }) {
  const scale = 1 + level * 0.45;
  return (
    <div
      className={`rounded-full transition-transform duration-100 ease-out ${className}`}
      style={{ width: size, height: size, transform: `scale(${scale})` }}
    />
  );
}

function Canvas({ finals, partial }: { finals: string[]; partial: string }) {
  const blocks: { title: string; body: string }[] = [];
  for (let i = 0; i < finals.length; i += 2) {
    blocks.push({ title: finals[i], body: finals[i + 1] || "" });
  }

  return (
    <div className="max-w-4xl mx-auto">
      {blocks.length === 0 && !partial && (
        <div className="min-h-[60vh] flex items-center justify-center text-center">
          <div className="max-w-sm">
            <div className="mx-auto mb-4 w-12 h-12 rounded-full bg-gradient-to-tr from-rose-300 via-indigo-200 to-emerald-200" />
            <h3 className="text-3xl text-primary mb-2" style={{ fontFamily: "Instrument Serif, serif" }}>
              A canvas for thinking aloud.
            </h3>
            <p className="text-sm text-secondary">
              Everything you say will smoothly land here, automatically organized into readable thought snippets.
            </p>
          </div>
        </div>
      )}

      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        {blocks.map((b, i) => (
          <article key={i} className="bg-panel rounded-2xl border border-auralis p-5 animate-[fade-in_0.4s_ease-out]">
            <div className="flex items-center gap-2 mb-2">
              <span className="w-1.5 h-1.5 rounded-full bg-primary" />
              <span className="text-[10px] uppercase tracking-[0.2em] text-secondary">Thought {i + 1}</span>
            </div>
            <h4 className="text-primary mb-1 leading-snug" style={{ fontFamily: "Instrument Serif, serif", fontSize: 22 }}>
              {b.title}
            </h4>
            {b.body && <p className="text-sm text-secondary leading-relaxed">{b.body}</p>}
          </article>
        ))}
        {partial && (
          <article className="bg-surface rounded-2xl border border-dashed border-auralis p-5 md:col-span-2">
            <div className="flex items-center gap-2 mb-2">
              <span className="w-1.5 h-1.5 rounded-full bg-emerald-500 animate-pulse" />
              <span className="text-[10px] uppercase tracking-[0.2em] text-secondary">Live</span>
            </div>
            <p className="text-primary leading-relaxed" style={{ fontFamily: "Instrument Serif, serif", fontSize: 20 }}>
              {partial}
              <span className="inline-block w-[2px] h-[18px] bg-primary ml-1 align-middle animate-pulse" />
            </p>
          </article>
        )}
      </div>
    </div>
  );
}
