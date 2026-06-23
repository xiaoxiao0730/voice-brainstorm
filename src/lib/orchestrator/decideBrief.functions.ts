// Slow-lane brief decision. Given a finalized ThoughtTurn + the current
// brief snapshot, produce a small batch of BriefPatch[] and optionally
// propose a research query. All blocks emitted from one call share a
// single operationId on the client side, so the UI can show ONE grouped
// Keep / Undo control.

import { createServerFn } from "@tanstack/react-start";
import { Output, generateText } from "ai";
import { z } from "zod";

import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { createLovableAiGatewayProvider } from "@/lib/ai-gateway.server";

const SnapshotLine = z.object({
  id: z.string(),
  kind: z.enum(["h2", "p"]),
  text: z.string().default(""),
  locked: z.boolean().default(false),
});

const InputSchema = z.object({
  thoughtTurn: z.object({
    combinedText: z.string(),
    boundaryReason: z.string().default("semantic_pause"),
  }),
  snapshot: z.array(SnapshotLine).max(120).default([]),
  model: z.string().default("google/gemini-3-flash-preview"),
});

const PatchSchema = z.object({
  action: z.enum(["append_block", "update_block", "append_to_block"]),
  blockId: z.string().nullable().default(null),
  heading: z.string().default(""),
  level: z.enum(["2", "3"]).default("3"),
  bodyMarkdown: z.string().default(""),
});

const DecisionSchema = z.object({
  patches: z.array(PatchSchema).max(4).default([]),
  proposeResearch: z
    .object({ query: z.string().default(""), reason: z.string().default("") })
    .default({ query: "", reason: "" }),
  rationale: z.string().default(""),
});

const SYSTEM_BASE = `You are the SLOW LANE of a dual-pipeline co-thinking system. A separate voice agent handles speech. Your only job is to keep the user's Live Brief document in sync with their thinking.

INPUT: ONE long ThoughtTurn (everything the user said since they last paused). Plus the current brief snapshot.

OUTPUT: A short batch of structured patches (max 3) that capture what's NEW or what should be REVISED. Then optionally a research query.

RULES
- Ground every patch STRICTLY in the user's actual words from the ThoughtTurn. Never invent topics, examples, or facts the user did not say. If the ThoughtTurn does not contain a topic, do NOT introduce it.
- Prefer append_block for genuinely new ideas. Use update_block / append_to_block only on UNLOCKED existing blocks (locked=false) when the new speech refines them.
- Heading blocks: level "2", short 2–6 words in heading, empty bodyMarkdown.
- Body blocks: level "3", empty heading, 1–3 sentences in bodyMarkdown.
- Match the user's language.
- If the user said nothing structural (filler, hello, "stop", off-topic), return patches: [].
- proposeResearch: set query+reason ONLY when answering well requires external fresh facts (named sources, recent events, specific numbers). Otherwise leave query="" and reason="".

Return strict JSON matching the schema.`;

function buildSystem(): string {
  const now = new Date();
  const dateStr = now.toLocaleDateString(undefined, {
    weekday: "long",
    year: "numeric",
    month: "long",
    day: "numeric",
  });
  const isoDate = now.toISOString().slice(0, 10);
  return `TIME ANCHOR (authoritative): today is ${dateStr} (${isoDate}). Do not invent holidays, seasons, or recent events that contradict this date.\n\n${SYSTEM_BASE}`;
}

export const decideBrief = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) => InputSchema.parse(input))
  .handler(async ({ data }) => {
    const key = process.env.LOVABLE_API_KEY;
    if (!key) throw new Error("Missing LOVABLE_API_KEY");

    const docStr = data.snapshot.length
      ? data.snapshot
          .map((l) => {
            const tag = l.locked ? "[user]" : "[ai]";
            const prefix = l.kind === "h2" ? "## " : "";
            return `  ${tag} id=${l.id.slice(0, 8)} ${prefix}${l.text}`;
          })
          .join("\n")
      : "  (empty document)";

    const userPrompt = `LIVE BRIEF (in order):\n${docStr}\n\nNEW THOUGHT TURN (boundary=${data.thoughtTurn.boundaryReason}):\n${data.thoughtTurn.combinedText}\n\nProduce patches (max 3) and optional proposeResearch.`;

    const gateway = createLovableAiGatewayProvider(key);
    try {
      const { experimental_output } = await generateText({
        model: gateway(data.model),
        system: buildSystem(),
        prompt: userPrompt,
        experimental_output: Output.object({ schema: DecisionSchema }),
      });
      const out = experimental_output;
      const patches = out.patches
        .map((p) => ({
          action: p.action,
          blockId: p.blockId,
          heading: p.heading?.trim() || undefined,
          level: (p.level === "2" ? 2 : 3) as 2 | 3,
          bodyMarkdown: p.bodyMarkdown?.trim() || undefined,
        }))
        .filter((p) => (p.heading && p.heading.length) || (p.bodyMarkdown && p.bodyMarkdown.length));

      const research = out.proposeResearch?.query?.trim()
        ? { query: out.proposeResearch.query.trim(), reason: (out.proposeResearch.reason ?? "").trim() }
        : null;

      return { patches, proposeResearch: research, rationale: out.rationale };
    } catch (e) {
      const message = e instanceof Error ? e.message : String(e);
      console.warn("[decideBrief] failed", message);
      return { patches: [], proposeResearch: null, rationale: "" };
      //debug
      console.log("[pipeline] decideBrief.server.start", {
        model: data.model,
        textLength: data.thoughtTurn.combinedText.length,
        snapshotCount: data.snapshot.length,
      });

      console.log("[pipeline] decideBrief.server.done", {
        patchCount: patches.length,
        research,
      });
    }
  });
