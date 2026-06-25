// Slow-lane brief decision. Given a finalized ThoughtTurn + the current
// brief snapshot, produce a small batch of BriefPatch[] and optionally
// propose a research query. All blocks emitted from one call share a
// single operationId on the client side, so the UI can show ONE grouped
// Keep / Undo control.

import { createServerFn } from "@tanstack/react-start";
import { generateText } from "ai";
import { z } from "zod";

import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { createOpenAIProvider, normalizeAiModel, requireOpenAIKey } from "@/lib/ai-gateway.server";

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

You are NOT transcribing. You are RESTRUCTURING messy spoken thought into a clean working document — like a product/technical planning doc, not a meeting transcript.

INPUT: ONE long ThoughtTurn (everything the user said since they last paused) + the current brief snapshot.
OUTPUT: A short batch of structured patches (max 3) capturing what is NEW or what should be REVISED. Optionally a research query.

GROUNDING
- Ground every patch STRICTLY in the user's actual words. Never invent topics, examples, or facts they did not say.
- If the turn is filler / greeting / restating / off-topic / "stop", return patches: [].
- Never paste the transcript verbatim. Synthesize into tight, structured form.

LOCKED BLOCKS
- Existing blocks tagged [user] are LOCKED and sacred. NEVER target them with update_block or append_to_block. Write around them, match their voice.
- Only target [ai] (unlocked) blocks for update_block / append_to_block.

ORGANIZE BY SEMANTIC RELATIONSHIP, NOT SPEAKING ORDER
- Related ideas can appear far apart in the transcript. Group them under the same topic.
- If the new turn extends an existing topic → append_to_block on that [ai] block.
- If it refines/corrects an existing [ai] block → update_block.
- If it starts a genuinely new topic → append_block.
- If it is filler or repeats what's already captured → no patch.

COMMON SECTIONS (use as needed, do NOT auto-create all)
Goal · Current Situation · Problem · Ideas · Demand · Constraint · Plan · Questions · Next Step · Risks · Decisions
Only create the sections that are actually useful for what the user said.

BLOCK SHAPE
- Heading block: level "2", short 2–6 word heading, bodyMarkdown empty.
- Body block: level "3", heading empty, bodyMarkdown uses NUMBERED structure by default:

  1. concrete point (1–2 lines)
  2. concrete point
     - optional nested bullet for a sub-detail
     - another sub-detail
  3. concrete point

  Do NOT use loose "- " bullet lists as the default top-level format. Numbered points are the default; nested "- " bullets only as details under a numbered point.
- Each numbered point: concrete, short, ≤ ~20 words. Prefer specific nouns, action verbs, explicit constraints. Avoid long paragraphs, transcript fragments, marketing/consulting language.

LANGUAGE
- Output in the user's transcribed language by default.
- Keep product/technical terms (API names, frameworks, brand names, code identifiers) in English when the user naturally used them. Do not translate proper nouns awkwardly.

RESEARCH
- proposeResearch: set query+reason ONLY when answering well requires fresh external facts (named sources, recent events, specific numbers). Otherwise leave query="" and reason="".

Return strict JSON matching the schema.`;

function buildSystem(): string {
  const now = new Date();
  const dateStr = now.toLocaleDateString(undefined, { weekday: "long", year: "numeric", month: "long", day: "numeric" });
  const isoDate = now.toISOString().slice(0, 10);
  return `TIME ANCHOR (authoritative): today is ${dateStr} (${isoDate}). Do not invent holidays, seasons, or recent events that contradict this date.\n\n${SYSTEM_BASE}`;
}

export const decideBrief = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) => InputSchema.parse(input))
  .handler(async ({ data }) => {
    const key = requireOpenAIKey();
    if (!key) throw new Error("Missing OPENAI_API_KEY");

    const docStr = data.snapshot.length
      ? data.snapshot
          .map((l) => {
            const tag = l.locked ? "[user]" : "[ai]";
            const prefix = l.kind === "h2" ? "## " : "";
            return `  ${tag} id=${l.id.slice(0, 8)} ${prefix}${l.text}`;
          })
          .join("\n")
      : "  (empty document)";

    const userPrompt = `LIVE BRIEF (in order):\n${docStr}\n\nNEW THOUGHT TURN (boundary=${data.thoughtTurn.boundaryReason}):\n${data.thoughtTurn.combinedText}\n\nReturn STRICT JSON only, no prose, no code fences. Shape:
{
  "patches": [ { "action": "append_block"|"update_block"|"append_to_block", "blockId": string|null, "heading": string, "level": "2"|"3", "bodyMarkdown": string } ],
  "proposeResearch": { "query": string, "reason": string },
  "rationale": string
}
Max 3 patches. Empty patches array if nothing structural was said.`;

    const gateway = createOpenAIProvider(key);
    try {
      const { text } = await generateText({
        model: gateway(normalizeAiModel(data.model)),
        system: buildSystem(),
        prompt: userPrompt,
      });

      // Tolerant JSON extraction — strip code fences / leading prose if any.
      let raw = (text ?? "").trim();
      const fence = raw.match(/```(?:json)?\s*([\s\S]*?)```/i);
      if (fence) raw = fence[1].trim();
      const first = raw.indexOf("{");
      const last = raw.lastIndexOf("}");
      if (first >= 0 && last > first) raw = raw.slice(first, last + 1);

      let parsed: unknown;
      try {
        parsed = JSON.parse(raw);
      } catch (e) {
        console.warn("[decideBrief] JSON parse failed", (e as Error).message, "raw=", raw.slice(0, 200));
        return { patches: [], proposeResearch: null, rationale: "" };
      }

      const out = DecisionSchema.parse(parsed);
      const patches = out.patches
        .map((p) => ({
          action: p.action,
          blockId: p.blockId,
          heading: p.heading?.trim() || undefined,
          level: (p.level === "2" ? 2 : 3) as 2 | 3,
          bodyMarkdown: p.bodyMarkdown?.trim() || undefined,
        }))
        .filter((p) => (p.heading && p.heading.length) || (p.bodyMarkdown && p.bodyMarkdown.length));

      const research =
        out.proposeResearch?.query?.trim()
          ? { query: out.proposeResearch.query.trim(), reason: (out.proposeResearch.reason ?? "").trim() }
          : null;

      return { patches, proposeResearch: research, rationale: out.rationale };
    } catch (e) {
      const message = e instanceof Error ? e.message : String(e);
      console.warn("[decideBrief] failed", message);
      return { patches: [], proposeResearch: null, rationale: "" };
    }
  });
