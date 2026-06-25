// Background Canvas Lane generator.
//
// Produces at most one pending line for the continuous document. May be a
// heading (h2) or paragraph (p). Optionally returns a short `insight` for
// the Realtime voice lane.

import { createServerFn } from "@tanstack/react-start";
import { Output, generateText } from "ai";
import { z } from "zod";

import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { createOpenAIProvider, normalizeAiModel, requireOpenAIKey } from "@/lib/ai-gateway.server";

const SnapshotLine = z.object({
  kind: z.enum(["h2", "p"]),
  text: z.string().default(""),
  isPending: z.boolean().default(false),
  locked: z.boolean().default(false),
});

const SignalSchema = z.object({
  type: z.enum(["accept", "reject", "edit", "pending_appear"]),
  heading: z.string().default(""),
});

const TemplateHint = z.object({
  name: z.string(),
  headings: z.array(z.string()).default([]),
  slotHints: z.array(z.object({ title: z.string(), prompt: z.string().default("") })).default([]),
}).nullable();

const InputSchema = z.object({
  latestText: z.string().default(""),
  recentTexts: z.array(z.string()).max(8).default([]),
  snapshot: z.array(SnapshotLine).max(120).default([]),
  templateHint: TemplateHint.default(null),
  userSignals: z.array(SignalSchema).max(12).default([]),
  model: z.string().default("google/gemini-2.5-pro"),
});

const CanvasPatchSchema = z.object({
  emit: z.boolean(),
  kind: z.enum(["h2", "p"]).default("p"),
  text: z.string().max(480).default(""),
  rationale: z.string().max(200).default(""),
  insight: z.string().max(180).default(""),
});

const SYSTEM_CANVAS = `You are the BACKGROUND CANVAS LANE of a dual-pipeline co-thinking system. A separate voice agent handles all spoken interaction. You NEVER produce spoken replies — only structured pending proposals appended to the user's continuous Live Brief document.

HARD RULES:
- Propose at most ONE line per call. Either a short heading (h2, 2–6 words) OR a paragraph (p, 1–3 sentences). Plain text. Match the user's language.
- Ground every claim in the user's own words or what's already in the brief. Do NOT invent facts.
- If the latest segment is filler / greeting / control ("好的", "stop") or adds nothing structural, set emit=false.
- USER SIGNALS are strong feedback. If the user recently REJECTED a similar proposal, do NOT propose the same again. If the user ACCEPTED or EDITED something, build forward from that.
- If a template hint is provided, prefer reusing one of its headings as context, but do NOT force content into categories it doesn't fit — append a free paragraph or a new heading when appropriate. Never invent "Unsorted" or system sections.
- rationale: one short phrase (≤ 1 line) for hover tip.
- insight: only when you have a non-obvious cross-cutting observation worth whispering to the voice agent (contradiction, missing assumption, surprising connection). One sentence, ≤ 30 words. Otherwise empty.

Return strict JSON matching the schema.`;

export const generateIntervention = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) => InputSchema.parse(input))
  .handler(async ({ data }) => {
    const apiKey = requireOpenAIKey();
    if (!apiKey) throw new Error("Missing OPENAI_API_KEY");

    const docStr = data.snapshot.length
      ? data.snapshot
          .map((l) => {
            const tag = l.isPending ? "[pending]" : l.locked ? "[user]" : "[ai]";
            const prefix = l.kind === "h2" ? "## " : "";
            return `  ${tag} ${prefix}${l.text}`;
          })
          .join("\n")
      : "  (empty document)";

    const recentStr = data.recentTexts.length ? data.recentTexts.join(" / ") : "(none)";
    const signalsStr = data.userSignals.length
      ? data.userSignals.map((s) => `${s.type}: ${s.heading}`).join(" | ")
      : "(none)";
    const tplStr = data.templateHint
      ? `Template: ${data.templateHint.name}\nHeadings present: ${data.templateHint.headings.join(", ") || "(none)"}\nSlot hints:\n${data.templateHint.slotHints
          .map((s) => `  - ${s.title}: ${s.prompt}`)
          .join("\n")}`
      : "Template: (none — free-form document)";

    const gateway = createOpenAIProvider(apiKey);

    const userPrompt = `${tplStr}\n\nLIVE BRIEF (in order):\n${docStr}\n\nRECENT USER SPEECH: ${recentStr}\nLATEST USER SEGMENT: ${data.latestText}\nRECENT USER SIGNALS: ${signalsStr}\n\nPropose ONE pending line (h2 heading or p paragraph) appended to the end, or set emit=false.`;

    try {
      const { experimental_output } = await generateText({
        model: gateway(normalizeAiModel(data.model)),
        system: SYSTEM_CANVAS,
        prompt: userPrompt,
        experimental_output: Output.object({ schema: CanvasPatchSchema }),
      });
      const out = experimental_output;
      const insight = out.insight?.trim() || undefined;

      if (!out.emit || !out.text.trim()) {
        return { emit: false as const, insight };
      }
      return {
        emit: true as const,
        line: {
          kind: out.kind,
          text: out.text.trim(),
          rationale: out.rationale,
        },
        insight,
      };
    } catch (e) {
      const message = e instanceof Error ? e.message : String(e);
      return { emit: false as const, error: message };
    }
  });
