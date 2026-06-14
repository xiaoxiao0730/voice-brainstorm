import { createFileRoute, redirect, useNavigate } from "@tanstack/react-router";
import { useCallback, useRef, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useServerFn } from "@tanstack/react-start";
import { createSession } from "@/lib/session.functions";
import { summarizeContextFile } from "@/lib/context.functions";


export const Route = createFileRoute("/")({
  ssr: false,
  beforeLoad: async () => {
    const { data, error } = await supabase.auth.getUser();
    if (error || !data.user) {
      throw redirect({ to: "/auth" });
    }
  },
  head: () => ({
    meta: [
      { title: "Murmur — What's on your mind?" },
      { name: "description", content: "Start a new Murmur session with AI co-thinking." },
    ],
    links: [
      { rel: "preconnect", href: "https://fonts.googleapis.com" },
      { rel: "preconnect", href: "https://fonts.gstatic.com", crossOrigin: "anonymous" },
      { rel: "stylesheet", href: "https://fonts.googleapis.com/css2?family=Instrument+Serif:ital@0;1&family=Inter:wght@400;500;600&display=swap" },
      { rel: "stylesheet", href: "https://fonts.googleapis.com/icon?family=Material+Symbols+Outlined" },
    ],
  }),
  component: Onboarding,
});

function Onboarding() {
  const navigate = useNavigate();
  const createS = useServerFn(createSession);
  const summarize = useServerFn(summarizeContextFile);
  const [prompt, setPrompt] = useState("");
  const [files, setFiles] = useState<File[]>([]);
  const [dragging, setDragging] = useState(false);
  const [listening, setListening] = useState(false);
  const [voiceSupported, setVoiceSupported] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [submitNote, setSubmitNote] = useState<string | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const recogRef = useRef<any>(null);
  const baseTextRef = useRef("");

  const addFiles = useCallback((list: FileList | null) => {
    if (!list) return;
    setFiles((prev) => [...prev, ...Array.from(list)]);
  }, []);

  const onDrop = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    setDragging(false);
    addFiles(e.dataTransfer.files);
  }, [addFiles]);

  const start = useCallback(async () => {
    if (submitting) return;
    setSubmitting(true);
    setSubmitNote(null);
    try {
      // Get the signed-in user (needed for the per-user storage path).
      const { data: userRes, error: userErr } = await supabase.auth.getUser();
      if (userErr || !userRes.user) throw new Error(userErr?.message || "Not signed in");
      const userId = userRes.user.id;

      // 1. Create the session row with the onboarding prompt.
      const session = await createS({ data: { prompt: prompt.trim() } });

      // 2. Upload each file to private storage and ask the server to summarize it.
      if (files.length > 0) {
        setSubmitNote(`Uploading ${files.length} file${files.length === 1 ? "" : "s"}…`);
        for (const file of files) {
          const safeName = file.name.replace(/[^\w.\-]+/g, "_");
          const path = `${userId}/${session.id}/${crypto.randomUUID()}-${safeName}`;
          const { error: upErr } = await supabase.storage
            .from("session-context")
            .upload(path, file, {
              contentType: file.type || "application/octet-stream",
              upsert: false,
            });
          if (upErr) {
            console.warn("Upload failed:", file.name, upErr.message);
            continue;
          }
          // Fire-and-forget summarization; don't block navigation on it.
          void summarize({
            data: {
              sessionId: session.id,
              path,
              name: file.name,
              mime: file.type || "application/octet-stream",
              size: file.size,
            },
          }).catch((e) => console.warn("Summarize failed:", file.name, e?.message));
        }
      }

      navigate({ to: "/workbench", search: { session: session.id } });
    } catch (e: any) {
      setSubmitNote(e?.message || "Couldn't start session");
      setSubmitting(false);
    }
  }, [submitting, prompt, files, createS, summarize, navigate]);


  const stopVoice = useCallback(() => {
    try { recogRef.current?.stop(); } catch {}
    setListening(false);
  }, []);

  const toggleVoice = useCallback(() => {
    if (listening) {
      stopVoice();
      return;
    }
    const SRClass: any =
      (window as any).SpeechRecognition || (window as any).webkitSpeechRecognition;
    if (!SRClass) {
      setVoiceSupported(false);
      return;
    }
    const r = new SRClass();
    r.continuous = true;
    r.interimResults = true;
    r.lang = navigator.language || "en-US";
    baseTextRef.current = prompt ? prompt.trimEnd() + " " : "";
    r.onresult = (e: any) => {
      let interim = "";
      let finalAdd = "";
      for (let i = e.resultIndex; i < e.results.length; i++) {
        const res = e.results[i];
        const txt = res[0].transcript;
        if (res.isFinal) finalAdd += txt;
        else interim += txt;
      }
      if (finalAdd) baseTextRef.current += finalAdd.trim() + " ";
      setPrompt((baseTextRef.current + interim).trimStart());
    };
    r.onerror = () => setListening(false);
    r.onend = () => setListening(false);
    recogRef.current = r;
    try {
      r.start();
      setListening(true);
    } catch {
      setListening(false);
    }
  }, [listening, prompt, stopVoice]);


  const removeFile = (idx: number) => setFiles((p) => p.filter((_, i) => i !== idx));

  return (
    <main className="min-h-screen w-full flex flex-col items-center justify-center px-6 py-16 bg-background">
      <div className="w-full max-w-3xl flex flex-col items-center">
        <h1
          className="text-center text-foreground font-normal tracking-tight text-4xl sm:text-5xl md:text-6xl leading-tight"
          style={{ fontFamily: "'Instrument Serif', serif" }}
        >
          What do you have on your mind today?
        </h1>
        <p className="mt-4 text-secondary text-base text-center max-w-xl">
          Drop in a thought or some context and we'll think it through together.
        </p>

        {/* Prompt box */}
        <div className="mt-10 w-full rounded-2xl border border-auralis bg-surface shadow-sm focus-within:border-foreground/40 transition-colors">
          <div className="flex items-end gap-3 p-4">
            <textarea
              value={prompt}
              onChange={(e) => setPrompt(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) start();
              }}
              rows={3}
              placeholder="Type what you want to brainstorm…"
              className="flex-1 resize-none bg-transparent outline-none text-foreground placeholder:text-secondary text-[15px] leading-6 min-h-[72px]"
            />
            <button
              type="button"
              onClick={toggleVoice}
              aria-label={listening ? "Stop voice input" : "Start voice input"}
              title={voiceSupported ? (listening ? "Stop voice input" : "Use voice input") : "Voice input not supported in this browser"}
              className={`shrink-0 inline-flex items-center justify-center w-10 h-10 rounded-full border transition-colors ${
                listening
                  ? "bg-rose-500 text-white border-rose-500 animate-pulse"
                  : "bg-surface text-foreground border-auralis hover:bg-surface-variant"
              }`}
            >
              <span className="material-symbols-outlined text-[20px]">
                {listening ? "stop" : "mic"}
              </span>
            </button>
            <button
              onClick={start}
              className="shrink-0 inline-flex items-center gap-2 rounded-full bg-primary text-on-primary px-5 py-2.5 text-sm font-medium hover:opacity-90 transition-opacity"
            >
              Start brainstorming
              <span className="material-symbols-outlined text-[18px]">arrow_forward</span>
            </button>
          </div>
          {!voiceSupported && (
            <div className="px-4 pb-3 text-xs text-rose-500">
              Voice input isn't supported in this browser. Try Chrome or Edge.
            </div>
          )}

        </div>

        {/* Dropzone */}
        <div
          onDragOver={(e) => { e.preventDefault(); setDragging(true); }}
          onDragLeave={() => setDragging(false)}
          onDrop={onDrop}
          onClick={() => inputRef.current?.click()}
          className={`mt-4 w-full rounded-2xl border border-dashed p-6 text-center cursor-pointer transition-colors ${
            dragging ? "border-foreground/60 bg-surface-variant" : "border-auralis bg-panel hover:bg-surface-variant"
          }`}
        >
          <input
            ref={inputRef}
            type="file"
            multiple
            className="hidden"
            onChange={(e) => addFiles(e.target.files)}
          />
          <div className="flex flex-col items-center gap-2">
            <span className="material-symbols-outlined text-secondary text-[28px]">upload_file</span>
            <div className="text-sm text-foreground">
              <span className="font-medium">Click to upload</span>
              <span className="text-secondary"> or drag and drop files here as context</span>
            </div>
            <div className="text-xs text-secondary">PDF, images, docs, audio — anything that helps</div>
          </div>

          {files.length > 0 && (
            <ul className="mt-4 flex flex-wrap gap-2 justify-center" onClick={(e) => e.stopPropagation()}>
              {files.map((f, i) => (
                <li
                  key={i}
                  className="inline-flex items-center gap-2 rounded-full border border-auralis bg-surface px-3 py-1.5 text-xs text-foreground"
                >
                  <span className="material-symbols-outlined text-[14px] text-secondary">description</span>
                  <span className="max-w-[180px] truncate">{f.name}</span>
                  <button
                    onClick={() => removeFile(i)}
                    className="text-secondary hover:text-foreground"
                    aria-label="Remove file"
                  >
                    <span className="material-symbols-outlined text-[14px]">close</span>
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>
      </div>
    </main>
  );
}
