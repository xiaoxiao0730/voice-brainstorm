import { createServerFn } from "@tanstack/react-start";
import { generateText } from "ai";
import { z } from "zod";

import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { createOpenAIProvider, normalizeAiModel, requireOpenAIKey } from "@/lib/ai-gateway.server";

const SectionSchema = z.object({
  title: z.string().max(80),
  bullets: z.array(z.string().max(260)).max(6).default([]),
});

const OutputSchema = z.object({
  title: z.string().max(120).default("Exploration Brief"),
  summary: z.string().max(500).default(""),
  sections: z.array(SectionSchema).min(1).max(8),
});

const InputSchema = z.object({
  title: z.string().max(160).default("Exploration Brief"),
  briefText: z.string().max(8000).default(""),
  canvasText: z.string().max(8000).default(""),
  model: z.string().default("openai/gpt-4o-mini"),
});

export type ExplorationBriefExport = z.infer<typeof OutputSchema>;

const DEFAULT_SECTIONS = [
  "Current Question",
  "User Journey",
  "Hypothesis",
  "Info & Observation",
  "Solution",
  "Open Questions",
  "Next Actions",
];

const SYSTEM = `You create an Exploration Brief from a brainstorming canvas.

The brief is for sharing with a mentor or teammate after a thinking session. It should not be a raw transcript. It should organize the user's current thinking into a useful product exploration artifact.

TARGET SECTIONS
- Current Question: the core question or problem the user is wrestling with.
- User Journey: user, scenario, context, and moments of use.
- Hypothesis: working beliefs, assumptions, and possible explanations.
- Info & Observation: concrete notes, evidence, examples, or things the user noticed.
- Solution: candidate directions, product moves, or design ideas.
- Open Questions: unresolved questions or missing information.
- Next Actions: concrete validation steps or decisions to make next.

RULES
- Preserve the user's language. If most input is Chinese, write Simplified Chinese. Keep terms like AI, Agent, MVP, API, PDF, Notion as-is.
- Ground everything in the input. Do not invent facts, metrics, research, or user quotes.
- Prefer concise bullets over paragraphs.
- If a section has no grounded content, include 1 bullet saying what is still missing or needs to be clarified.
- Make it useful for continuing the work, not just pretty.

Return STRICT JSON only:
{
  "title": "...",
  "summary": "...",
  "sections": [
    { "title": "Current Question", "bullets": ["..."] }
  ]
}`;

function extractJSON(raw: string): unknown {
  let cleaned = (raw ?? "").trim();
  const fence = cleaned.match(/```(?:json)?\s*([\s\S]*?)```/i);
  if (fence) cleaned = fence[1].trim();
  const first = cleaned.indexOf("{");
  const last = cleaned.lastIndexOf("}");
  if (first >= 0 && last > first) cleaned = cleaned.slice(first, last + 1);
  return JSON.parse(cleaned);
}

function fallback(title: string, text: string): ExplorationBriefExport {
  const lines = text
    .split(/\n+/)
    .map((line) => line.trim())
    .filter(Boolean)
    .slice(0, 8);
  return {
    title: title || "Exploration Brief",
    summary: lines[0] ?? "",
    sections: DEFAULT_SECTIONS.map((section, index) => ({
      title: section,
      bullets: index === 0 && lines.length ? lines : ["Needs clarification."],
    })),
  };
}

export const exportExplorationBrief = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) => InputSchema.parse(input))
  .handler(async ({ data }) => {
    const source = [data.briefText.trim(), data.canvasText.trim()].filter(Boolean).join("\n\n");
    if (!source) return fallback(data.title, "");

    const key = requireOpenAIKey();
    const gateway = createOpenAIProvider(key);
    try {
      const { text } = await generateText({
        model: gateway(normalizeAiModel(data.model)),
        system: SYSTEM,
        temperature: 0.2,
        maxOutputTokens: 1800,
        prompt: `Session title: ${data.title || "Exploration Brief"}\n\nBRIEF TEXT:\n${
          data.briefText.trim() || "(empty)"
        }\n\nCANVAS TEXT:\n${data.canvasText.trim() || "(empty)"}\n\nCreate the Exploration Brief now.`,
      });
      return OutputSchema.parse(extractJSON(text));
    } catch (error) {
      console.warn(
        "[exportExplorationBrief] failed",
        error instanceof Error ? error.message : String(error),
      );
      return fallback(data.title, source);
    }
  });
