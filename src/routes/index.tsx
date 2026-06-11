import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useCallback, useRef, useState } from "react";

export const Route = createFileRoute("/")({
  head: () => ({
    meta: [
      { title: "Brainstorm AI — What's on your mind?" },
      { name: "description", content: "Start a new brainstorming session with AI co-thinking." },
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
  const [prompt, setPrompt] = useState("");
  const [files, setFiles] = useState<File[]>([]);
  const [dragging, setDragging] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  const addFiles = useCallback((list: FileList | null) => {
    if (!list) return;
    setFiles((prev) => [...prev, ...Array.from(list)]);
  }, []);

  const onDrop = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    setDragging(false);
    addFiles(e.dataTransfer.files);
  }, [addFiles]);

  const start = useCallback(() => {
    navigate({ to: "/workbench" });
  }, [navigate]);

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
          Drop in a thought, a question, or some context — we'll think it through together.
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
              onClick={start}
              className="shrink-0 inline-flex items-center gap-2 rounded-full bg-primary text-on-primary px-5 py-2.5 text-sm font-medium hover:opacity-90 transition-opacity"
            >
              Start brainstorming
              <span className="material-symbols-outlined text-[18px]">arrow_forward</span>
            </button>
          </div>
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
