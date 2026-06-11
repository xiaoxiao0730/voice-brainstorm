import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { lovable } from "@/integrations/lovable";

export const Route = createFileRoute("/auth")({
  ssr: false,
  head: () => ({
    meta: [
      { title: "Sign in — Murmur" },
      { name: "description", content: "Sign in to your Murmur co-thinking workbench." },
    ],
    links: [
      { rel: "preconnect", href: "https://fonts.googleapis.com" },
      { rel: "preconnect", href: "https://fonts.gstatic.com", crossOrigin: "anonymous" },
      {
        rel: "stylesheet",
        href: "https://fonts.googleapis.com/css2?family=Instrument+Serif:ital@0;1&family=Inter:wght@400;500;600&display=swap",
      },
    ],
  }),
  component: AuthPage,
});

function AuthPage() {
  const navigate = useNavigate();
  const [mode, setMode] = useState<"signin" | "signup">("signin");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    supabase.auth.getUser().then(({ data }) => {
      if (data.user) navigate({ to: "/workbench" });
    });
  }, [navigate]);

  const onGoogle = async () => {
    setError(null);
    setBusy(true);
    const result = await lovable.auth.signInWithOAuth("google", {
      redirect_uri: window.location.origin + "/workbench",
    });
    if (result.error) {
      setError(result.error instanceof Error ? result.error.message : String(result.error));
      setBusy(false);
      return;
    }
    if (result.redirected) return;
    navigate({ to: "/workbench" });
  };

  const onEmail = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    setBusy(true);
    try {
      if (mode === "signup") {
        const { error: err } = await supabase.auth.signUp({
          email,
          password,
          options: { emailRedirectTo: window.location.origin + "/workbench" },
        });
        if (err) throw err;
        const { data: sess } = await supabase.auth.getSession();
        if (sess.session) navigate({ to: "/workbench" });
        else setError("Check your email to confirm your account, then sign in.");
      } else {
        const { error: err } = await supabase.auth.signInWithPassword({ email, password });
        if (err) throw err;
        navigate({ to: "/workbench" });
      }
    } catch (e: any) {
      setError(e?.message || "Sign-in failed");
    } finally {
      setBusy(false);
    }
  };

  return (
    <main className="min-h-screen w-full flex items-center justify-center px-6 bg-background">
      <div className="w-full max-w-sm">
        <h1
          className="text-center text-foreground text-4xl mb-2"
          style={{ fontFamily: "Instrument Serif, serif" }}
        >
          Murmur
        </h1>
        <p className="text-center text-secondary text-sm mb-8">
          Your live brainstorming brief, co-written with AI.
        </p>

        <button
          type="button"
          onClick={onGoogle}
          disabled={busy}
          className="w-full mb-4 rounded-full border border-auralis bg-surface px-4 py-2.5 text-sm font-medium text-primary hover:bg-surface-variant transition-colors disabled:opacity-50 flex items-center justify-center gap-2"
        >
          <svg width="16" height="16" viewBox="0 0 48 48" aria-hidden>
            <path fill="#FFC107" d="M43.6 20.5H42V20H24v8h11.3c-1.6 4.6-6 8-11.3 8-6.6 0-12-5.4-12-12s5.4-12 12-12c3 0 5.8 1.1 7.9 3l5.7-5.7C34 6.5 29.3 4.5 24 4.5 13.2 4.5 4.5 13.2 4.5 24S13.2 43.5 24 43.5c10.9 0 19.5-7.9 19.5-19.5 0-1.2-.1-2.3-.4-3.5z"/>
            <path fill="#FF3D00" d="M6.3 14.7l6.6 4.8C14.7 16 19 13 24 13c3 0 5.8 1.1 7.9 3l5.7-5.7C34 6.5 29.3 4.5 24 4.5 16.3 4.5 9.7 8.9 6.3 14.7z"/>
            <path fill="#4CAF50" d="M24 43.5c5.2 0 9.9-2 13.4-5.2l-6.2-5.2C29.2 34.7 26.7 35.5 24 35.5c-5.3 0-9.7-3.4-11.3-8L6.2 32.4C9.5 38.4 16.2 43.5 24 43.5z"/>
            <path fill="#1976D2" d="M43.6 20.5H42V20H24v8h11.3c-.8 2.2-2.2 4.1-4.1 5.6l6.2 5.2c4.4-4 7.1-9.9 7.1-16.8 0-1.2-.1-2.3-.4-3.5z"/>
          </svg>
          Continue with Google
        </button>

        <div className="flex items-center gap-3 my-4">
          <div className="flex-1 h-px bg-auralis" />
          <span className="text-xs text-secondary uppercase tracking-wider">or</span>
          <div className="flex-1 h-px bg-auralis" />
        </div>

        <form onSubmit={onEmail} className="space-y-3">
          <input
            type="email"
            required
            placeholder="Email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            className="w-full rounded-lg border border-auralis bg-surface px-3 py-2.5 text-sm text-primary placeholder:text-secondary outline-none focus:border-primary/40"
          />
          <input
            type="password"
            required
            minLength={6}
            placeholder="Password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            className="w-full rounded-lg border border-auralis bg-surface px-3 py-2.5 text-sm text-primary placeholder:text-secondary outline-none focus:border-primary/40"
          />
          {error && <p className="text-xs text-rose-500">{error}</p>}
          <button
            type="submit"
            disabled={busy}
            className="w-full rounded-full bg-primary text-on-primary px-4 py-2.5 text-sm font-medium hover:opacity-90 disabled:opacity-50"
          >
            {busy ? "…" : mode === "signin" ? "Sign in" : "Create account"}
          </button>
        </form>

        <p className="text-center text-xs text-secondary mt-6">
          {mode === "signin" ? "New to Murmur?" : "Already have an account?"}{" "}
          <button
            type="button"
            onClick={() => {
              setMode(mode === "signin" ? "signup" : "signin");
              setError(null);
            }}
            className="text-primary underline-offset-2 hover:underline"
          >
            {mode === "signin" ? "Create one" : "Sign in"}
          </button>
        </p>
      </div>
    </main>
  );
}
