import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { generateText } from "ai";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { createOpenAIProvider, normalizeAiModel, requireOpenAIKey } from "@/lib/ai-gateway.server";
import type { BriefPatch, BriefBlockLevel } from "./pipeline/types";

const SnapshotBlock = z.object({
  id: z.string(),
  heading: z.string().default(""),
  level: z.number().int().min(1).max(3),
  body: z.string().default(""),
  locked: z.boolean(),
  lastEditedBy: z.enum(["ai", "user"]),
});

const SegmentInput = z.object({
  segmentId: z.string().uuid(),
  sessionId: z.string().uuid(),
  rawText: z.string().min(1),
  chunkIds: z.array(z.string()).default([]),
});

const ALLOWED_MODELS = [
  "google/gemini-3-flash-preview",
  "google/gemini-2.5-pro",
  "openai/gpt-5",
  "openai/gpt-5-mini",
] as const;
const DEFAULT_MODEL = "google/gemini-3-flash-preview";

const InputSchema = z.object({
  segment: SegmentInput,
  snapshot: z.array(SnapshotBlock),
  model: z.enum(ALLOWED_MODELS).optional(),
});

// Flat schema — easy for the model to fill, easy to parse.
const PatchSchema = z.object({
  action: z.enum(["append_block", "update_block", "append_to_block"]),
  blockId: z.string().nullable().optional(),
  heading: z.string().optional(),
  level: z.number().int().min(1).max(3).optional(),
  bodyMarkdown: z.string().optional(),
  sourceChunkIds: z.array(z.string()).optional(),
});
const ResponseSchema = z.object({
  patches: z.array(PatchSchema).default([]),
});

const SYSTEM_PROMPT = `You are the AI co-author of a live thinking document (Notion-style).

The document is an ordered list of BLOCKS. Each block has:
- id (string)
- heading (string, may be empty)
- level (1 = H1, 2 = H2, 3 = body paragraph / bullet group)
- body (markdown; bullets are lines starting with "- ")
- locked (true if the user typed or edited inside it — NEVER overwrite a locked block)

Your job: given the user's latest spoken segment, update the document by returning a JSON object with a "patches" array.

You are NOT summarizing sentence by sentence. You are restructuring the user's messy spoken thoughts into a clearer thinking document.

Output content in the user's transcribed language by default. Keep product/technical terms in English when they are naturally used by the user. Do not translate proper nouns or technical product names awkwardly.

Each patch is one of:
1. { "action": "append_block", "blockId": null, "heading": "...", "level": 1|2|3, "bodyMarkdown": "...", "sourceChunkIds": [...] }
   — adds a NEW block at the end only when the segment introduces a genuinely new topic.
2. { "action": "append_to_block", "blockId": "<existing id>", "bodyMarkdown": "...", "sourceChunkIds": [...] }
   — appends a line/bullet to an existing AI block. Use when the user is elaborating a thread already in the doc.
3. { "action": "update_block", "blockId": "<existing id>", "heading": "...", "bodyMarkdown": "...", "sourceChunkIds": [...] }
   — rewrites an existing AI block only when the user clearly revises a previous idea or the existing AI-generated block is too complicated, or several related points should be merged into a cleaner structure. Use sparingly, only when the new segment clearly supersedes it.

HARD RULES:
- NEVER emit update_block or append_to_block targeting a block where locked=true. The user's words are sacred. Match their voice and write around them instead.
- NEVER paste the transcript verbatim. Synthesize. Rewrite in tight, structured form.
- Do not write abstract summaries. Prefer concrete, usable statements.
- If the segment is filler / restating / noise, return { "patches": [] }.
- Headings ≤ 6 words. Bullets ≤ 20 words each. Use "- " prefix for bullet lines.
- Always include sourceChunkIds (copy them from the segment).
- bodyMarkdown must use numbered structure by default.

Use:
1. ...
2. ...
3. ...

Use nested bullets only for details under a numbered point:

1. ...
 - ...
 - ...
Do NOT use loose bullet lists as the default format.
Each numbered point should be concrete and short. Prefer 1–2 lines per point.
- Organize by semantic relationship, not by speaking order.

Related ideas may appear far apart in the transcript.
Group them under the same topic when they refer to the same issue.

Common sections include but are not limited to:
Goal, Current Situation, Problem, Ideas, Demand, Constraint, Plan, Questions, Next Step, etc.

Do not create every section automatically.
Only create sections that are useful.

When deciding where to put new content:

If it extends an existing topic, append to that block.
If it refines or corrects an existing AI block, update that block.
If it starts a new topic, append a new block.
If it is filler or repeated, return no patches.

- The output should feel like a working product / technical planning document.

Prefer:

specific nouns
clear action verbs
concrete requirements
explicit constraints
short numbered points
practical wording

Avoid:

long paragraphs
transcript-like fragments
overly polished marketing language
generic consulting language

- Output STRICT JSON only. No prose, no markdown fences, no comments.

Example response:
{"patches":[{"action":"append_block","blockId":null,"heading":"Onboarding redesign","level":1,"bodyMarkdown":"- Users drop off in first 30 seconds\\n- Value prop unclear at first contact","sourceChunkIds":["c1"]}]}
`;

// Robust JSON extractor — strips fences, finds first {/last }, parses.
function extractJSON(raw: string): unknown {
  let cleaned = raw
    .replace(/^\s*```json\s*/i, "")
    .replace(/^\s*```\s*/i, "")
    .replace(/```\s*$/i, "")
    .trim();

  if (!cleaned.startsWith("{") && !cleaned.startsWith("[")) {
    const objStart = cleaned.indexOf("{");
    const arrStart = cleaned.indexOf("[");
    const isArray = arrStart !== -1 && (objStart === -1 || arrStart < objStart);
    const start = isArray ? arrStart : objStart;
    const end = isArray ? cleaned.lastIndexOf("]") : cleaned.lastIndexOf("}");
    if (start === -1 || end <= start) {
      throw new Error("No JSON object found in model response");
    }
    cleaned = cleaned.slice(start, end + 1);
  }
  return JSON.parse(cleaned);
}

function renderSnapshot(snapshot: z.infer<typeof SnapshotBlock>[]): string {
  if (snapshot.length === 0) return "(document is empty)";
  return snapshot
    .map((b) => {
      const lock = b.locked ? "LOCKED" : "ai";
      const heading = b.heading || "(no heading)";
      return `--- block id=${b.id} level=${b.level} ${lock} ---\n## ${heading}\n${b.body}`;
    })
    .join("\n\n");
}

export const orchestrateSegment = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) => InputSchema.parse(input))
  .handler(async ({ data, context }) => {
    const apiKey = requireOpenAIKey();
    if (!apiKey) {
      return { patches: [] as BriefPatch[], error: "Missing OPENAI_API_KEY" };
    }
    const gateway = createOpenAIProvider(apiKey);
    const model = gateway(normalizeAiModel(data.model ?? DEFAULT_MODEL));

    const lockedIds = data.snapshot.filter((b) => b.locked).map((b) => b.id);
    const userEditedExcerpts = data.snapshot
      .filter((b) => b.locked)
      .slice(-3)
      .map((b) => `• [${b.heading || "untitled"}] ${b.body.slice(0, 240)}`)
      .join("\n");

    // Pull the onboarding prompt + uploaded-file summaries for THIS session.
    let onboardingPrompt = "";
    let contextSummaries = "";
    try {
      const { data: sessRow } = await context.supabase
        .from("sessions")
        .select("prompt, context_files")
        .eq("id", data.segment.sessionId)
        .single();
      if (sessRow) {
        onboardingPrompt = (sessRow.prompt as string) || "";
        const files = Array.isArray(sessRow.context_files) ? (sessRow.context_files as any[]) : [];
        contextSummaries = files
          .filter((f) => f && typeof f.summary === "string" && f.summary.trim())
          .slice(0, 6)
          .map((f) => `• ${f.name}: ${f.summary.slice(0, 800)}`)
          .join("\n\n");
      }
    } catch {
      /* non-fatal — keep going without context */
    }

    const prompt = `${
      onboardingPrompt ? `User's original intent (from onboarding):\n"""${onboardingPrompt}"""\n\n` : ""
    }${
      contextSummaries
        ? `Reference material the user attached (use as background, do NOT regurgitate):\n${contextSummaries}\n\n`
        : ""
    }Current document:
${renderSnapshot(data.snapshot)}

LOCKED block ids (DO NOT touch): ${JSON.stringify(lockedIds)}

${
  userEditedExcerpts
    ? `The user personally wrote/edited these — match their voice, never contradict:\n${userEditedExcerpts}\n\n`
    : ""
}New transcript segment (chunkIds: ${JSON.stringify(data.segment.chunkIds)}):
"""${data.segment.rawText}"""

Return STRICT JSON of shape { "patches": [...] }. No prose, no fences.`;

    let patches: BriefPatch[] = [];
    let aiError: string | null = null;

    try {
      const selectedModel = data.model ?? DEFAULT_MODEL;
      // GPT-5 family only supports the default temperature (1).
      const supportsCustomTemperature = !selectedModel.startsWith("openai/gpt-5");
      const { text, finishReason } = await generateText({
        model,
        system: SYSTEM_PROMPT,
        prompt,
        ...(supportsCustomTemperature ? { temperature: 0.4 } : {}),
      });

      if (finishReason === "length") {
        throw new Error("Response truncated (finish_reason=length)");
      }

      const parsed = extractJSON(text);
      const validated = ResponseSchema.parse(parsed);

      // Normalize into BriefPatch shape; coerce level to 1|2|3.
      patches = validated.patches.map((p) => ({
        action: p.action,
        blockId: p.blockId ?? null,
        heading: p.heading,
        level: p.level as BriefBlockLevel | undefined,
        bodyMarkdown: p.bodyMarkdown,
        sourceChunkIds: p.sourceChunkIds ?? [],
      }));
    } catch (e: any) {
      aiError = e?.message || "AI call failed";
      console.error("[orchestrate] AI error:", aiError);
    }

    if (patches.length > 0) {
      const rows = patches.map((p) => ({
        session_id: data.segment.sessionId,
        segment_id: data.segment.segmentId,
        op_type: (p.action === "append_block"
          ? "add_node"
          : p.action === "update_block"
            ? "update_node"
            : "annotate") as "add_node" | "update_node" | "annotate",
        payload: p as any,
        applied: false,
      }));
      const { error: logError } = await context.supabase.from("brief_operations").insert(rows);
      if (logError) console.warn("[orchestrate] op log error:", logError.message);
    }

    return { patches, error: aiError };
  });
