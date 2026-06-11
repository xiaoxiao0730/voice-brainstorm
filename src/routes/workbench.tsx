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

// SpeechRecognition typing
type SR = any;

function Workbench() {
  const [listening, setListening] = useState(false);
  const [level, setLevel] = useState(0); // 0..1 mic amplitude
  const [partial, setPartial] = useState("");
  const [finals, setFinals] = useState<string[]>([]);
  const [expanded, setExpanded] = useState(true);

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
    <div className="min-h-screen w-full bg-background text-foreground">
      <header className="max-w-[1400px] mx-auto px-8 pt-8 pb-4 flex items-center justify-between">
        <div className="flex items-center gap-3">
          <div className="w-8 h-8 rounded-full bg-gradient-to-tr from-rose-400 via-indigo-300 to-emerald-300" />
          <span className="font-medium tracking-tight">Brainstorm · Co-thinking Workbench</span>
        </div>
        <div className="flex bg-surface p-1 rounded-full border border-auralis shadow-sm">
          <button className="px-4 py-1.5 bg-panel text-primary rounded-full text-sm font-medium">Session</button>
          <button className="px-4 py-1.5 text-secondary rounded-full text-sm font-medium hover:text-primary transition-colors">History</button>
        </div>
      </header>

      <main className="max-w-[1400px] mx-auto px-8 pb-12">
        <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
          {/* LEFT — Audio */}
          <section className="lg:col-span-5">
            <div className="bg-panel rounded-[28px] border border-auralis p-8 min-h-[640px] flex flex-col relative overflow-hidden">
              <div className="flex items-center justify-between">
                <span className="text-xs uppercase tracking-[0.18em] text-secondary">Audio Interaction</span>
                <span className={`text-xs flex items-center gap-2 ${listening ? "text-emerald-600" : "text-secondary"}`}>
                  <span className={`w-1.5 h-1.5 rounded-full ${listening ? "bg-emerald-500 animate-pulse" : "bg-secondary"}`} />
                  {listening ? "Listening" : "Idle"}
                </span>
              </div>

              {/* Orbs */}
              <div className="flex-1 flex items-center justify-center gap-4 my-8 relative">
                <Orb
                  className={`bg-gradient-to-tr from-rose-400 to-orange-300 blur-2xl ${listening ? "blob-a" : "rounded-full"}`}
                  size={100}
                  level={level}
                  phase={0}
                />
                <div
                  className="relative flex items-center justify-center transition-transform duration-100 ease-out"
                  style={{ transform: `scale(${1 + level * 0.3})` }}
                >
                  <div className={`w-[160px] h-[160px] bg-gradient-to-tr from-indigo-300 via-violet-400 to-purple-400 blur-2xl ${listening ? "blob-b" : "rounded-full"}`} />
                </div>
                <Orb
                  className={`bg-gradient-to-tr from-emerald-300 to-teal-200 blur-2xl ${listening ? "blob-c" : "rounded-full"}`}
                  size={100}
                  level={level}
                  phase={Math.PI}
                />
              </div>

              {/* Controls */}
              <div className="flex items-center justify-center gap-3">
                <button
                  onClick={start}
                  disabled={listening}
                  className="px-6 py-3 rounded-full bg-primary text-on-primary text-sm font-medium disabled:opacity-40 transition-all hover:opacity-90 flex items-center gap-2"
                >
                  <span className="material-symbols-outlined text-base">mic</span>
                  Start Speaking
                </button>
                <button
                  onClick={stop}
                  disabled={!listening}
                  className="px-6 py-3 rounded-full border border-auralis bg-surface text-primary text-sm font-medium disabled:opacity-40 transition-all hover:bg-surface-variant flex items-center gap-2"
                >
                  <span className="material-symbols-outlined text-base">stop</span>
                  Stop Speaking
                </button>
              </div>

              {/* Transcript */}
              <div className="mt-6 bg-surface/80 backdrop-blur-md rounded-2xl border border-auralis overflow-hidden">
                <button
                  onClick={() => setExpanded((v) => !v)}
                  className="w-full flex items-center justify-between px-4 py-3 text-left hover:bg-surface-variant/50 transition-colors"
                >
                  <span className="text-xs uppercase tracking-[0.18em] text-secondary">Transcript</span>
                  <span className="material-symbols-outlined text-secondary text-lg">
                    {expanded ? "expand_less" : "expand_more"}
                  </span>
                </button>
                <div
                  className="grid transition-all duration-300 ease-out"
                  style={{ gridTemplateRows: expanded ? "1fr" : "0fr" }}
                >
                  <div className="overflow-hidden">
                    <div className="px-4 pb-4 max-h-40 overflow-y-auto text-sm leading-relaxed text-primary">
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
            </div>
          </section>

          {/* RIGHT — Canvas */}
          <section className="lg:col-span-7">
            <div className="bg-panel rounded-[28px] border border-auralis p-8 min-h-[640px] flex flex-col relative overflow-hidden">
              <div className="flex items-center justify-between mb-6">
                <span className="text-xs uppercase tracking-[0.18em] text-secondary">Live Canvas</span>
                <div className="flex gap-2">
                  <span className="px-3 py-1 bg-surface rounded-full text-xs text-primary border border-auralis">Auto-format</span>
                  <span className="px-3 py-1 bg-surface rounded-full text-xs text-secondary border border-auralis">Markdown</span>
                </div>
              </div>

              <Canvas finals={finals} partial={partial} />

              <div className="mt-6 flex items-center justify-between text-xs text-secondary">
                <span>{liveText.length} chars · {finals.length} segments</span>
                <span className="flex items-center gap-2">
                  <span className="w-1.5 h-1.5 rounded-full bg-emerald-500" /> Synced with voice
                </span>
              </div>
            </div>
          </section>
        </div>
      </main>
    </div>
  );
}

function Orb({ className, size, level, phase }: { className: string; size: number; level: number; phase: number }) {
  const scale = 1 + level * 0.45 + Math.sin(Date.now() / 600 + phase) * 0.02;
  return (
    <div
      className={`rounded-full transition-transform duration-100 ease-out ${className}`}
      style={{ width: size, height: size, transform: `scale(${scale})` }}
    />
  );
}

function Canvas({ finals, partial }: { finals: string[]; partial: string }) {
  // Group into "thought blocks" — every 2 finals becomes a card
  const blocks: { title: string; body: string }[] = [];
  for (let i = 0; i < finals.length; i += 2) {
    const title = finals[i];
    const body = finals[i + 1] || "";
    blocks.push({ title, body });
  }

  return (
    <div className="flex-1 bg-surface rounded-2xl border border-auralis p-6 overflow-y-auto relative">
      {/* dot grid bg */}
      <div
        className="absolute inset-0 opacity-[0.4] pointer-events-none"
        style={{
          backgroundImage: "radial-gradient(circle, #d8d6d0 1px, transparent 1px)",
          backgroundSize: "22px 22px",
        }}
      />
      <div className="relative">
        {blocks.length === 0 && !partial && (
          <div className="h-full min-h-[420px] flex items-center justify-center text-center">
            <div className="max-w-sm">
              <div className="mx-auto mb-4 w-12 h-12 rounded-full bg-gradient-to-tr from-rose-300 via-indigo-200 to-emerald-200" />
              <h3 className="font-h1 text-2xl text-primary mb-2" style={{ fontFamily: "Instrument Serif, serif" }}>
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
            <article
              key={i}
              className="bg-panel rounded-2xl border border-auralis p-5 animate-[fade-in_0.4s_ease-out]"
            >
              <div className="flex items-center gap-2 mb-2">
                <span className="w-1.5 h-1.5 rounded-full bg-primary" />
                <span className="text-[10px] uppercase tracking-[0.2em] text-secondary">Thought {i + 1}</span>
              </div>
              <h4
                className="text-primary mb-1 leading-snug"
                style={{ fontFamily: "Instrument Serif, serif", fontSize: 22 }}
              >
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
    </div>
  );
}
