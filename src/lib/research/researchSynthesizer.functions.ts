// Turn raw research notes into a structured ResearchResult.

import { createServerFn } from "@tanstack/react-start";
import { Output, generateText } from "ai";
import { z } from "zod";

import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { createLovableAiGatewayProvider } from "@/lib/ai-gateway.server";

const InputSchema = z.object({
  query: z.string().min(1),
  notes: z.string().default(""),
  model: z.string().default("google/gemini-3-flash-preview"),
});

const ResultSchema = z.object({
  title: z.string().default(""),
  summary: z.string().default(""),
  findings: z.array(z.string()).max(6).default([]),
  links: z
    .array(z.object({ title: z.string().default(""), url: z.string().default("") }))
    .max(6)
    .default([]),
  voiceSummary: z.string().default(""),
});

const SYSTEM_BASE = `Convert raw research notes into a clean structured result for a Live Brief.
- title: ≤ 8 words
- summary: 2–4 sentences of markdown
- findings: 3–5 short bullets, each one concrete fact taken from the notes (do not invent)
- links: only include URLs explicitly named in the notes; otherwise return an empty list
- voiceSummary: ≤ 2 sentences, ~25s spoken, plain conversational tone
- If the notes say "uncertain" or contradict the time anchor, reflect that honestly instead of fabricating.
Match the user's language. Return strict JSON.`;

function buildSystem(): string {
  const now = new Date();
  const dateStr = now.toLocaleDateString(undefined, { weekday: "long", year: "numeric", month: "long", day: "numeric" });
  const isoDate = now.toISOString().slice(0, 10);
  return `TIME ANCHOR (authoritative): today is ${dateStr} (${isoDate}).\n\n${SYSTEM_BASE}`;
}

export const synthesizeResearch = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) => InputSchema.parse(input))
  .handler(async ({ data }) => {
    const key = process.env.LOVABLE_API_KEY;
    if (!key) throw new Error("Missing LOVABLE_API_KEY");
    const gateway = createLovableAiGatewayProvider(key);
    const userPrompt = `Query: ${data.query}\n\nRaw notes:\n${data.notes || "(no notes available)"}\n\nProduce the structured ResearchResult now.`;
    try {
      const { experimental_output } = await generateText({
        model: gateway(data.model),
        system: buildSystem(),
        prompt: userPrompt,
        experimental_output: Output.object({ schema: ResultSchema }),
      });
      const out = experimental_output;
      return {
        title: out.title?.trim() || data.query,
        summary: out.summary?.trim() || data.notes,
        findings: out.findings.filter((f) => f.trim()),
        links: out.links.filter((l) => l.url.trim()),
        voiceSummary: out.voiceSummary?.trim() || "",
      };
    } catch (e) {
      const message = e instanceof Error ? e.message : String(e);
      console.warn("[synthesizeResearch] failed", message);
      return {
        title: data.query,
        summary: data.notes || "No reliable sources found.",
        findings: [],
        links: [],
        voiceSummary: "",
      };
    }
  });
