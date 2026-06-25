// Fast-lane: per-TranscriptSegment bullet extractor.
//
// Goal: while the slow-lane decideBrief waits for a full ThoughtTurn boundary
// (2.5s pause), this lane fires on every Azure final TranscriptSegment and
// asks a cheap model "is there ONE short bullet (≤20 chars) we can pin to
// the brief right now?"
//
// Output is intentionally minimal:
//   - 0 or 1 bullet per call (rarely 2)
//   - level=3 body, no heading
//   - no research, no updates to existing blocks (slow lane handles that)
//
// The bullet lane is best-effort: any failure (parse, network) returns []
// silently. It must NEVER block transcript ingestion.

import { createServerFn } from "@tanstack/react-start";
import { generateText } from "ai";
import { z } from "zod";

import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { createOpenAIProvider, normalizeAiModel, requireOpenAIKey } from "@/lib/ai-gateway.server";

const InputSchema = z.object({
  segmentText: z.string().min(1),
  recentBullets: z.array(z.string()).max(8).default([]),
  briefHints: z.array(z.string()).max(12).default([]),
  model: z.string().default("google/gemini-3-flash-preview"),
});

const BulletSchema = z.object({
  text: z.string().default(""),
});

const OutputSchema = z.object({
  bullets: z.array(BulletSchema).max(2).default([]),
});

const SYSTEM = `You are the FAST LANE bullet extractor for a live co-thinking workspace.

Input: one short transcript segment (a few seconds of speech), the user's recent pending bullets, and brief headings for context.

Task: If — and ONLY if — this segment introduces ONE concrete new idea, fact, decision, question, or constraint worth pinning, return that as ONE short bullet. Otherwise return an empty array.

HARD RULES
- Max 1 bullet per call. Two ONLY if the segment clearly contains two distinct ideas.
- Each bullet ≤ 20 characters (chinese chars count as 1). Be telegraphic — a noun phrase or short clause, not a sentence.
- Use the user's own language and words. Never invent facts.
- Skip filler, greetings, restating, self-talk, "um", "let me think".
- Skip if the segment merely elaborates an idea already in recentBullets/briefHints.
- Output STRICT JSON: { "bullets": [{ "text": "..." }] }. No code fences, no prose.`;

export const bulletLane = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) => InputSchema.parse(input))
  .handler(async ({ data }) => {
    const key = requireOpenAIKey();
    if (!key) throw new Error("Missing OPENAI_API_KEY");

    const prompt = `RECENT BULLETS (already pinned, do not repeat):
${data.recentBullets.length ? data.recentBullets.map((b) => `- ${b}`).join("\n") : "(none)"}

BRIEF HEADINGS (context):
${data.briefHints.length ? data.briefHints.map((h) => `- ${h}`).join("\n") : "(none)"}

NEW SEGMENT:
${data.segmentText}

Return STRICT JSON only:
{ "bullets": [ { "text": "..." } ] }
If nothing pinnable, return { "bullets": [] }.`;

    const gateway = createOpenAIProvider(key);
    try {
      const { text } = await generateText({
        model: gateway(normalizeAiModel(data.model)),
        system: SYSTEM,
        prompt,
      });

      let raw = (text ?? "").trim();
      const fence = raw.match(/```(?:json)?\s*([\s\S]*?)```/i);
      if (fence) raw = fence[1].trim();
      const first = raw.indexOf("{");
      const last = raw.lastIndexOf("}");
      if (first >= 0 && last > first) raw = raw.slice(first, last + 1);

      let parsed: unknown;
      try {
        parsed = JSON.parse(raw);
      } catch {
        return { bullets: [] as Array<{ text: string }> };
      }
      const out = OutputSchema.parse(parsed);
      const bullets = out.bullets
        .map((b) => ({ text: (b.text ?? "").trim() }))
        .filter((b) => b.text.length > 0 && b.text.length <= 40);
      return { bullets };
    } catch (e) {
      console.warn("[bulletLane] failed", e instanceof Error ? e.message : String(e));
      return { bullets: [] as Array<{ text: string }> };
    }
  });
