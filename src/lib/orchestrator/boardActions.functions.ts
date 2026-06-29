// Board context-menu actions: Connect (relate two cards) and Summarize
// (integrate many cards into a structured summary card).

import { createServerFn } from "@tanstack/react-start";
import { generateText } from "ai";
import { z } from "zod";

import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { createOpenAIProvider, normalizeAiModel, requireOpenAIKey } from "@/lib/ai-gateway.server";

function extractJSON(raw: string): unknown {
  let cleaned = (raw ?? "").trim();
  const fence = cleaned.match(/```(?:json)?\s*([\s\S]*?)```/i);
  if (fence) cleaned = fence[1].trim();
  const first = cleaned.indexOf("{");
  const last = cleaned.lastIndexOf("}");
  if (first >= 0 && last > first) cleaned = cleaned.slice(first, last + 1);
  return JSON.parse(cleaned);
}

// ===== Connect: two cards → a short relation label for the edge =====

const ConnectInput = z.object({
  source: z.object({ title: z.string(), body: z.string().default("") }),
  target: z.object({ title: z.string(), body: z.string().default("") }),
  model: z.string().default("openai/gpt-4o-mini"),
});

const ConnectOutput = z.object({ relation: z.string().default("") });

const CONNECT_SYSTEM = `You label the relationship between two idea cards on a thinking canvas.
Given a SOURCE card and a TARGET card, return ONE short relation phrase (1-4 words) describing how SOURCE relates to TARGET — the kind of phrase that would sit on the connecting arrow.
Examples: 导致 / 依赖 / 对比 / 解决 / 是…的灵感来源 / 风险 / 前提 / leads to / blocks / part of / vs.
Use the user's language. Be specific to THESE two cards, not generic.
Return STRICT JSON only: { "relation": "..." }`;

export const connectCards = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) => ConnectInput.parse(input))
  .handler(async ({ data }) => {
    const key = requireOpenAIKey();
    if (!key) throw new Error("Missing OPENAI_API_KEY");
    const gateway = createOpenAIProvider(key);
    try {
      const { text } = await generateText({
        model: gateway(normalizeAiModel(data.model)),
        system: CONNECT_SYSTEM,
        prompt: `SOURCE: ${data.source.title}${data.source.body ? ` — ${data.source.body}` : ""}\nTARGET: ${data.target.title}${data.target.body ? ` — ${data.target.body}` : ""}\n\nReturn the relation JSON.`,
      });
      const out = ConnectOutput.parse(extractJSON(text));
      return { relation: out.relation.trim() };
    } catch (e) {
      console.warn("[connectCards] failed", e instanceof Error ? e.message : String(e));
      return { relation: "" };
    }
  });

// ===== Merge: two cards → ONE new idea node that connects them =====

const MergeInput = z.object({
  a: z.object({ title: z.string(), body: z.string().default("") }),
  b: z.object({ title: z.string(), body: z.string().default("") }),
  model: z.string().default("openai/gpt-4o-mini"),
});

const MergeOutput = z.object({
  title: z.string().default(""),
  body: z.string().default(""),
  relation: z.string().default(""),
  kind: z.enum(["focus", "idea", "question", "decision", "risk", "next"]).default("idea"),
});

const MERGE_SYSTEM = `You help a user connect two idea cards on a thinking canvas. Given card A and card B, produce ONE NEW idea that emerges from relating them — a synthesis, tension, implication, or next move that only becomes visible when you hold both together.

RULES
- The new idea must genuinely BUILD ON both A and B, not just restate one or concatenate them.
- Ground it in what the cards actually say. Do not invent unrelated facts.
- Use the user's language. Keep product/technical terms as-is.
- title: the new idea in a short phrase or clause (the card's main line).
- body: optional one-line elaboration; default "".
- relation: a SHORT phrase (1-4 words) for the connecting arrows, e.g. 结合得出 / 共同指向 / 由此产生 / leads to / implies.
- kind: pick the type that fits the new idea (idea/question/decision/risk/next/focus); default "idea".

Return STRICT JSON only: { "title": "...", "body": "", "relation": "...", "kind": "idea" }`;

export const mergeCards = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) => MergeInput.parse(input))
  .handler(async ({ data }) => {
    const key = requireOpenAIKey();
    if (!key) throw new Error("Missing OPENAI_API_KEY");
    const gateway = createOpenAIProvider(key);
    try {
      const { text } = await generateText({
        model: gateway(normalizeAiModel(data.model)),
        system: MERGE_SYSTEM,
        prompt: `CARD A: ${data.a.title}${data.a.body ? ` — ${data.a.body}` : ""}\nCARD B: ${data.b.title}${data.b.body ? ` — ${data.b.body}` : ""}\n\nProduce the new idea that connects them. Return the JSON.`,
      });
      const out = MergeOutput.parse(extractJSON(text));
      return {
        title: out.title.trim() || "New idea",
        body: out.body.trim(),
        relation: out.relation.trim(),
        kind: out.kind,
      };
    } catch (e) {
      console.warn("[mergeCards] failed", e instanceof Error ? e.message : String(e));
      return { title: "New idea", body: "", relation: "", kind: "idea" as const };
    }
  });

// ===== Ask: selected cards + question → ONE answer/analysis card =====

const AskInput = z.object({
  question: z.string().min(1).max(1000),
  cards: z
    .array(z.object({ title: z.string(), body: z.string().default("") }))
    .min(1)
    .max(12),
  model: z.string().default("openai/gpt-4o-mini"),
});

const AskOutput = z.object({
  title: z.string().default("Answer"),
  body: z.string().default(""),
  relation: z.string().default("answers"),
  kind: z.enum(["focus", "idea", "question", "decision", "risk", "next"]).default("idea"),
});

const ASK_SYSTEM = `You answer a user's question about selected cards on a thinking canvas.

RULES
- Ground the answer only in the selected cards. Do not invent external facts.
- If the question asks for judgment, make the reasoning explicit but concise.
- If the cards are insufficient, say what is missing and turn that into a useful question/next step.
- title: short label for the answer card.
- body: concise answer, ideally 2-5 bullets or short paragraphs.
- relation: short edge label from selected cards to this answer, e.g. answers / implies / suggests / risk.
- kind: choose the best card type.
- Use the user's language. Preserve product/technical terms.

Return STRICT JSON only: { "title": "...", "body": "...", "relation": "answers", "kind": "idea" }`;

export const askCards = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) => AskInput.parse(input))
  .handler(async ({ data }) => {
    const key = requireOpenAIKey();
    if (!key) throw new Error("Missing OPENAI_API_KEY");
    const gateway = createOpenAIProvider(key);
    const listed = data.cards
      .map((c, i) => `${i + 1}. ${c.title}${c.body ? ` — ${c.body}` : ""}`)
      .join("\n");
    try {
      const { text } = await generateText({
        model: gateway(normalizeAiModel(data.model)),
        system: ASK_SYSTEM,
        prompt: `QUESTION:\n${data.question}\n\nSELECTED CARDS:\n${listed}\n\nReturn the answer card JSON.`,
      });
      const out = AskOutput.parse(extractJSON(text));
      return {
        title: out.title.trim() || "Answer",
        body: out.body.trim(),
        relation: out.relation.trim() || "answers",
        kind: out.kind,
      };
    } catch (e) {
      console.warn("[askCards] failed", e instanceof Error ? e.message : String(e));
      return {
        title: data.question.slice(0, 80) || "Answer",
        body: data.cards.map((c) => `- ${c.title}`).join("\n"),
        relation: "answers",
        kind: "idea" as const,
      };
    }
  });

// ===== Summarize: many cards → ONE structured summary card =====

const SummarizeInput = z.object({
  cards: z
    .array(z.object({ title: z.string(), body: z.string().default("") }))
    .min(1)
    .max(40),
  model: z.string().default("openai/gpt-4o-mini"),
});

const SummarizeOutput = z.object({
  title: z.string().default("Summary"),
  body: z.string().default(""),
});

const SUMMARIZE_SYSTEM = `You integrate a set of scattered idea cards from a thinking canvas into ONE dense, structured summary card. This is the "summarize" action — unlike normal note-taking, here you SHOULD organize and synthesize.

RULES
- Find the through-line across the selected cards: the shared topic or goal.
- Output a short title (2-6 words) naming what these cards are collectively about.
- Output a body as a tight, structured markdown summary: numbered points grouping related ideas, surfacing the goal / key points / tensions / next steps that the cards collectively imply.
- Ground everything in the cards' actual content. Do not invent.
- Use the user's language. Keep technical/product terms as-is.
- Body ≤ ~6 numbered points, each concrete and short.

Return STRICT JSON only: { "title": "...", "body": "1. ...\\n2. ..." }`;

export const summarizeCards = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) => SummarizeInput.parse(input))
  .handler(async ({ data }) => {
    const key = requireOpenAIKey();
    if (!key) throw new Error("Missing OPENAI_API_KEY");
    const gateway = createOpenAIProvider(key);
    const listed = data.cards
      .map((c, i) => `${i + 1}. ${c.title}${c.body ? ` — ${c.body}` : ""}`)
      .join("\n");
    try {
      const { text } = await generateText({
        model: gateway(normalizeAiModel(data.model)),
        system: SUMMARIZE_SYSTEM,
        prompt: `SELECTED CARDS:\n${listed}\n\nIntegrate into one structured summary. Return the JSON.`,
      });
      const out = SummarizeOutput.parse(extractJSON(text));
      return { title: out.title.trim() || "Summary", body: out.body.trim() };
    } catch (e) {
      console.warn("[summarizeCards] failed", e instanceof Error ? e.message : String(e));
      return { title: "Summary", body: data.cards.map((c) => `- ${c.title}`).join("\n") };
    }
  });
