// Background Canvas Lane generator (Stage 3, schema-driven).
//
// Produces at most one structural patch bound to one of the template slots.
// The patch is injected client-side as a pending_approval block (sandbox).
// Optionally returns a short `insight` for the Realtime voice lane.

import { createServerFn } from "@tanstack/react-start";
import { Output, generateText } from "ai";
import { z } from "zod";

import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { createLovableAiGatewayProvider } from "@/lib/ai-gateway.server";

const SnapshotBlock = z.object({
  slotId: z.string().default(""),
  heading: z.string().default(""),
  body: z.string().default(""),
  isPending: z.boolean().default(false),
  locked: z.boolean().default(false),
});

const SlotDef = z.object({
  id: z.string(),
  title: z.string(),
  prompt: z.string().default(""),
  multi: z.boolean().default(true),
});

const SignalSchema = z.object({
  type: z.enum(["accept", "reject", "edit", "pending_appear"]),
  slotId: z.string(),
  heading: z.string().default(""),
});

const InputSchema = z.object({
  latestText: z.string().default(""),
  recentTexts: z.array(z.string()).max(8).default([]),
  snapshot: z.array(SnapshotBlock).max(80).default([]),
  slots: z.array(SlotDef).min(1).max(20),
  userSignals: z.array(SignalSchema).max(12).default([]),
  model: z.string().default("google/gemini-2.5-pro"),
});

const CanvasPatchSchema = z.object({
  emit: z.boolean(),
  slotId: z.string().default(""),
  heading: z.string().max(80).default(""),
  body: z.string().max(400).default(""),
  rationale: z.string().max(200).default(""),
  insight: z.string().max(180).default(""),
});

const SYSTEM_CANVAS = `You are the BACKGROUND CANVAS LANE of a dual-pipeline co-thinking system. A separate voice agent handles all spoken interaction. You NEVER produce spoken replies — only structured pending proposals for the user's Live Brief.

The canvas is divided into stable SLOTS. Every proposal MUST target exactly one slot by its id. Do NOT invent new slots.

HARD RULES:
- Propose at most ONE block in ONE slot. Heading 2–6 words, body 1–3 sentences. Plain text. Match the user's language.
- Ground every claim in the user's own words or the existing brief. Do NOT invent facts.
- If the latest segment is filler / greeting / control ("好的", "stop") or adds nothing structural, set emit=false.
- USER SIGNALS are strong feedback. If the user recently REJECTED a similar proposal in a slot, do NOT propose the same thing again. If the user ACCEPTED or EDITED something, build forward from that, not over it.
- Prefer slots that are empty or where the latest user thought clearly belongs. Only add to a slot that already has a pending proposal if the new one materially differs.
- rationale: one short phrase shown as a hover tip (why this slot, in ≤ 1 line).
- insight: only when you have a non-obvious cross-cutting observation worth whispering to the voice agent (contradiction, missing assumption, surprising connection). One sentence, ≤ 30 words. Otherwise empty.

Return strict JSON matching the schema.`;

export const generateIntervention = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) => InputSchema.parse(input))
  .handler(async ({ data }) => {
    const apiKey = process.env.LOVABLE_API_KEY;
    if (!apiKey) throw new Error("Missing LOVABLE_API_KEY");

    const validSlotIds = new Set(data.slots.map((s) => s.id));

    // Group snapshot by slot for the prompt
    const bySlot: Record<string, typeof data.snapshot> = {};
    for (const b of data.snapshot) {
      const k = b.slotId || "_unsorted";
      (bySlot[k] ??= []).push(b);
    }
    const slotStr = data.slots
      .map((s) => {
        const blocks = bySlot[s.id] ?? [];
        const lines = blocks
          .map((b) => {
            const tag = b.isPending ? "[pending] " : b.locked ? "[user] " : "[ai] ";
            return `  - ${tag}${b.heading ? b.heading + ": " : ""}${b.body}`;
          })
          .join("\n");
        return `## slot ${s.id} — ${s.title}\n  hint: ${s.prompt}\n${lines || "  (empty)"}`;
      })
      .join("\n\n");

    const recentStr = data.recentTexts.length ? data.recentTexts.join(" / ") : "(none)";
    const signalsStr = data.userSignals.length
      ? data.userSignals
          .map((s) => `${s.type} in ${s.slotId}${s.heading ? `: ${s.heading}` : ""}`)
          .join(" | ")
      : "(none)";

    const gateway = createLovableAiGatewayProvider(apiKey);

    const userPrompt = `LIVE BRIEF (by slot):\n${slotStr}\n\nRECENT USER SPEECH: ${recentStr}\nLATEST USER SEGMENT: ${data.latestText}\nRECENT USER SIGNALS: ${signalsStr}\n\nPropose ONE pending block targeting a valid slotId from {${[...validSlotIds].join(", ")}}, or set emit=false.`;

    try {
      const { experimental_output } = await generateText({
        model: gateway(data.model),
        system: SYSTEM_CANVAS,
        prompt: userPrompt,
        experimental_output: Output.object({ schema: CanvasPatchSchema }),
      });
      const out = experimental_output;
      const insight = out.insight?.trim() || undefined;

      if (!out.emit || !out.body.trim() || !validSlotIds.has(out.slotId)) {
        return { emit: false as const, insight };
      }
      return {
        emit: true as const,
        patch: {
          slotId: out.slotId,
          heading: out.heading,
          body: out.body,
          rationale: out.rationale,
        },
        insight,
      };
    } catch (e) {
      const message = e instanceof Error ? e.message : String(e);
      return { emit: false as const, error: message };
    }
  });
