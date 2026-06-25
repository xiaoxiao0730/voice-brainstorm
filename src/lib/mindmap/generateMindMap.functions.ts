// Generate a hierarchical mind map (tree) from a selected snippet of text.
// Returns a strict tree shape suitable for rendering with React Flow.

import { createServerFn } from "@tanstack/react-start";
import { generateText } from "ai";
import { z } from "zod";

import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { createOpenAIProvider, normalizeAiModel, requireOpenAIKey } from "@/lib/ai-gateway.server";

const InputSchema = z.object({
  selectedText: z.string().min(1).max(8000),
  context: z.string().max(4000).default(""),
  model: z.string().default("google/gemini-3-flash-preview"),
});

export type MindMapNode = {
  id: string;
  label: string;
  children: MindMapNode[];
};

type MindMapNodeInput = {
  id?: string;
  label?: string;
  children?: MindMapNodeInput[];
};

const NodeSchema: z.ZodType<MindMapNodeInput> = z.lazy(() =>
  z.object({
    id: z.string().optional(),
    label: z.string().optional(),
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
    children: (node.children ?? []).map((c, i) => ensureIds(c, `${path}-${i}`)),
  };
}

const SYSTEM = `You convert a snippet of working notes into a compact MIND MAP tree.

RULES
- Output ONE root node that captures the central topic in 2–6 words.
- 2 to 5 first-level branches, each 2–6 words.
- Each branch may have 0–4 short children (2–8 words each); max depth 3 below root.
- Use the user's language. Keep technical/product terms in their original form (usually English).
- Group by semantic relationship, not speaking order. Merge near-duplicates.
- Be faithful — do not invent facts the snippet doesn't support.
- No sentences, no punctuation except hyphens/slashes when natural.

Return STRICT JSON only, no prose, no code fences:
{ "root": { "id": "r", "label": "...", "children": [ { "id": "n1", "label": "...", "children": [ ... ] } ] } }`;


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
      let raw = (text ?? "").trim();
      const fence = raw.match(/```(?:json)?\s*([\s\S]*?)```/i);
      if (fence) raw = fence[1].trim();
      const first = raw.indexOf("{");
      const last = raw.lastIndexOf("}");
      if (first >= 0 && last > first) raw = raw.slice(first, last + 1);

      const parsed = JSON.parse(raw);
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
