// Generate a hierarchical mind map (tree) from a selected snippet of text.
// Returns a strict tree shape suitable for rendering with React Flow.

import { createServerFn } from "@tanstack/react-start";
import { generateText } from "ai";
import { z } from "zod";

import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { createOpenAIProvider, normalizeAiModel, requireOpenAIKey } from "@/lib/ai-gateway.server";
import { parseLlmJsonObject } from "@/lib/llm/json";

const InputSchema = z.object({
  selectedText: z.string().min(1).max(8000),
  context: z.string().max(4000).default(""),
  model: z.string().default("google/gemini-3-flash-preview"),
});

export type MindMapNode = {
  id: string;
  label: string;
  relation?: string; // short relation word describing the link from the PARENT to this node
  children: MindMapNode[];
};

type MindMapNodeInput = {
  id?: string;
  label?: string;
  relation?: string;
  children?: MindMapNodeInput[];
};

const NodeSchema: z.ZodType<MindMapNodeInput> = z.lazy(() =>
  z.object({
    id: z.string().optional(),
    label: z.string().optional(),
    relation: z.string().optional(),
    children: z.array(NodeSchema).optional(),
  }),
);

const OutputSchema = z.object({
  root: NodeSchema,
});

function ensureIds(node: MindMapNodeInput, path = "r"): MindMapNode {
  const id = node.id?.trim() || path;
  return {
    id,
    label: (node.label ?? "").trim() || "·",
    relation: node.relation?.trim() || undefined,
    children: (node.children ?? []).map((c, i) => ensureIds(c, `${path}-${i}`)),
  };
}

const SYSTEM = `You turn a user's working notes / brief into a clear, structured MIND MAP that captures and organizes their thinking. You are SYNTHESIZING and SUMMARIZING — not copying text.

LANGUAGE FIDELITY
- Detect the dominant language of SELECTED SNIPPET and write node labels + relations in that language.
- If the user mixes Chinese with English product/technical terms, keep the English terms exactly as-is.
- Do not translate product names, model names, feature names, keyboard names, or code terms.

STRUCTURE
- ONE root node = the single central topic, summarized in 2–6 words.
- 3 to 6 first-level branches radiating from the root = the main aspects / threads of the thinking.
- Each branch may have 0–4 children (sub-points); max depth 3 below the root.
- Keep the whole map readable: target 12–24 total nodes. Prefer fewer strong nodes over many thin nodes.

NODE LABELS — summarize, never transcribe
- Every label is a TIGHT summary of the point: a noun phrase or short clause, 2–8 words.
- NEVER paste raw sentences from the notes. Distill the idea into its essence.
- Use the user's language. Keep technical/product terms in their original form (usually English).
- Preserve the user's actual concepts and priorities; do not upgrade vague thoughts into polished strategy claims.

RELATIONS — label every edge
- For EVERY non-root node, set "relation": a SHORT word/phrase (1–4 words) describing how it relates to its PARENT.
- Examples: 包含 / 导致 / 依赖 / 对比 / 解决 / 风险 / 前提 / 例子 / 子任务 / leads to / part of / blocks / vs.
- Pick the relation that genuinely fits the logic. The root node has no relation.
- Do not create sibling branches that only differ by wording. Merge them and put detail below the stronger parent.

QUALITY
- Group by semantic relationship, not speaking order. Merge near-duplicates.
- Be faithful — do not invent facts the notes don't support.
- Preserve uncertainty, open questions, and unresolved tradeoffs as uncertainty; do not convert them into decisions.
- Aim for a map that helps the user SEE the structure of their own thinking at a glance.

Return STRICT JSON only, no prose, no code fences:
{ "root": { "id": "r", "label": "...", "children": [ { "id": "n1", "label": "...", "relation": "...", "children": [ { "id": "n1a", "label": "...", "relation": "...", "children": [] } ] } ] } }`;

export const generateMindMap = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) => InputSchema.parse(input))
  .handler(async ({ data }) => {
    const key = requireOpenAIKey();
    if (!key) throw new Error("Missing OPENAI_API_KEY");

    const gateway = createOpenAIProvider(key);
    const userPrompt = `SELECTED SNIPPET:\n${data.selectedText}\n\n${
      data.context ? `SURROUNDING CONTEXT (for disambiguation only):\n${data.context}\n\n` : ""
    }Build the mind map JSON now.`;

    try {
      const { text } = await generateText({
        model: gateway(normalizeAiModel(data.model)),
        system: SYSTEM,
        prompt: userPrompt,
      });
      const parsed = parseLlmJsonObject(text ?? "");
      const out = OutputSchema.parse(parsed);
      return { root: ensureIds(out.root) };
    } catch (e) {
      const message = e instanceof Error ? e.message : String(e);
      console.warn("[generateMindMap] failed", message);
      // Fallback: single-node mind map so the UI can still render something.
      return {
        root: ensureIds({
          id: "r",
          label: data.selectedText.slice(0, 40).trim() || "Mind map",
          children: [],
        }),
      };
    }
  });
