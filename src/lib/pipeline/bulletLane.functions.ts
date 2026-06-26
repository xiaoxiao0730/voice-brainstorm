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

const SYSTEM = `You are the FAST LANE note-taker for a live co-thinking workspace. You keep a brief growing in real time while people brainstorm out loud.

Input: one short transcript segment (a few seconds of speech — from the user OR the AI co-thinker), the recent bullets already pinned, and the brief headings for context.

YOUR DEFAULT IS TO WRITE. Every segment that carries ANY meaning should produce at least one bullet. You are the fast, generous lane — a separate slow lane will later merge, tidy, and restructure what you capture, so rough and slightly-too-much is GOOD. Missing things is BAD.

Capture a bullet for ANY of these (this list is broad on purpose):
- an idea, suggestion, or option ("第三个吧", "we could use Redis")
- a goal, intent, or topic ("AI in Brainstorming")
- a plan, step, or proposed action ("先选定一个主题，再让 AI 列思路")
- a decision or preference ("好的，那就先这样", "I prefer the second one")
- a problem, risk, constraint, or requirement
- a question worth tracking
- a concrete fact or example
The AI co-thinker's speech counts the same as the user's — capture its suggestions and conclusions too.

ONLY return an empty array when the WHOLE segment is nothing but: a bare greeting ("hi"), a content-free filler ("嗯", "um", "let me think"), or a word-for-word repeat of an existing bullet. A segment like "好的，那我们就先把这个想法变成一个具体的行动" is NOT filler — the "好的" is filler but "把想法变成具体行动" is a real point, so capture that part.

HOW TO WRITE EACH BULLET
- Telegraphic: a short phrase or clause capturing the POINT, not a transcription. Strip the "嗯/好的/那我们" framing, keep the substance.
- ≤ 30 characters (chinese chars count as 1).
- Same language as the speaker. Never invent facts not in the segment.
- 1 bullet usually; up to 2 if the segment has two distinct points.

Output STRICT JSON only: { "bullets": [{ "text": "..." }] }. No code fences, no prose.`;

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
