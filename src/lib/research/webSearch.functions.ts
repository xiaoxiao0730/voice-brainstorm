// Lovable AI Gateway — Gemini call returning a research note for a query.
//
// MVP: relies on model's prior knowledge plus an explicit "based on what
// you know; if uncertain, say so" instruction. Later we can promote this
// to a true grounded google_search tool call via provider options.

import { createServerFn } from "@tanstack/react-start";
import { generateText } from "ai";
import { z } from "zod";

import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { createLovableAiGatewayProvider } from "@/lib/ai-gateway.server";

const InputSchema = z.object({
  query: z.string().min(1),
  model: z.string().default("google/gemini-3-flash-preview"),
});

const SYSTEM_BASE = `You are a research assistant collecting concise notes for a co-thinking workbench. Produce DENSE plain-text notes for the given query. Include concrete facts, named entities, numbers, and any well-known sources. If you're uncertain about freshness or accuracy, say so explicitly. If you do not actually know something, write "uncertain" rather than guessing. No fluff, no preamble — just the notes.`;

function buildSystem(): string {
  const now = new Date();
  const dateStr = now.toLocaleDateString(undefined, { weekday: "long", year: "numeric", month: "long", day: "numeric" });
  const isoDate = now.toISOString().slice(0, 10);
  return `TIME ANCHOR (authoritative): today is ${dateStr} (${isoDate}). Treat any event after this date as future/unknown. Do not invent holidays or recent events.\n\n${SYSTEM_BASE}`;
}

export const webSearch = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) => InputSchema.parse(input))
  .handler(async ({ data }) => {
    const key = process.env.LOVABLE_API_KEY;
    if (!key) throw new Error("Missing LOVABLE_API_KEY");
    const gateway = createLovableAiGatewayProvider(key);
    try {
      const { text } = await generateText({
        model: gateway(data.model),
        system: buildSystem(),
        prompt: `Query: ${data.query}\n\nWrite the research notes now.`,
      });
      return { ok: true as const, notes: text.trim() };
    } catch (e) {
      const message = e instanceof Error ? e.message : String(e);
      console.warn("[webSearch] failed", message);
      return { ok: false as const, notes: "", error: message };
    }
  });
