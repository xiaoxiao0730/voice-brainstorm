import { createFileRoute, Link } from "@tanstack/react-router";

export const Route = createFileRoute("/auth")({
  ssr: false,
  head: () => ({
    meta: [
      { title: "Local mode — Murmur" },
      { name: "description", content: "Murmur is running in local no-auth mode." },
    ],
  }),
  component: AuthPage,
});

function AuthPage() {
  return (
    <main className="min-h-screen w-full flex items-center justify-center px-6 bg-background">
      <div className="w-full max-w-sm text-center">
        <h1
          className="text-foreground text-4xl mb-2"
          style={{ fontFamily: "Instrument Serif, serif" }}
        >
          Murmur
        </h1>
        <p className="text-secondary text-sm mb-8">
          Local mode is enabled. Sign-in is disabled while this workspace runs
          against your own Supabase project.
        </p>
        <Link
          to="/"
          className="inline-flex items-center justify-center rounded-full bg-primary text-on-primary px-4 py-2.5 text-sm font-medium hover:opacity-90"
        >
          Continue to workbench
        </Link>
      </div>
    </main>
  );
}
