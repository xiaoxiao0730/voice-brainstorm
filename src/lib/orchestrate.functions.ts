import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { generateText, Output } from "ai";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import type { BriefOperation } from "./pipeline/types";

const SnapshotNode = z.object({
  id: z.string(),
  parentId: z.string().nullable(),
  level: z.enum(["h1", "h2", "bullet"]),
  text: z.string(),
  status: z.enum(["ai_draft", "user_confirmed"]),
  lastEditedBy: z.enum(["ai", "user"]),
});

const SegmentInput = z.object({
  segmentId: z.string().uuid(),
  sessionId: z.string().uuid(),
  rawText: z.string().min(1),
  chunkIds: z.array(z.string()).default([]),
});

const InputSchema = z.object({
  segment: SegmentInput,
  snapshot: z.array(SnapshotNode),
});

// Schema we ask the model to fill. Discriminated union via op field.
const AddNodeOp = z.object({
  op: z.literal("add_node"),
  tempId: z.string(),
  parentId: z.string().nullable(),
  afterId: z.string().nullable(),
  level: z.enum(["h1", "h2", "bullet"]),
  text: z.string(),
  sourceChunkIds: z.array(z.string()).default([]),
  confidence: z.number().min(0).max(1).optional(),
  tag: z.string().optional(),
});
const UpdateNodeOp = z.object({
  op: z.literal("update_node"),
  nodeId: z.string(),
  text: z.string(),
  sourceChunkIds: z.array(z.string()).optional(),
  confidence: z.number().min(0).max(1).optional(),
});
const DeleteNodeOp = z.object({
  op: z.literal("delete_node"),
  nodeId: z.string(),
  reason: z.string().optional(),
});
const MoveNodeOp = z.object({
  op: z.literal("move_node"),
  nodeId: z.string(),
  newParentId: z.string().nullable(),
  afterId: z.string().nullable(),
});
const AnnotateOp = z.object({
  op: z.literal("annotate"),
  nodeId: z.string(),
  tag: z.string(),
});

const OutputSchema = z.object({
  ops: z.array(
    z.discriminatedUnion("op", [
      AddNodeOp,
      UpdateNodeOp,
      DeleteNodeOp,
      MoveNodeOp,
      AnnotateOp,
    ]),
  ),
});

const SYSTEM_PROMPT = `You are the reasoning layer of a live brainstorming brief.

You maintain an evolving outline (the "brief") while the user speaks. The brief is a tree of nodes:
- "h1" — top-level section heading
- "h2" — subsection heading
- "bullet" — body bullet (may be nested under another bullet or under an h1/h2)

Rules — non-negotiable:
1. Return ONLY the MINIMUM incremental operations needed to reflect this new transcript segment in the brief. Do NOT regenerate the full brief.
2. NEVER summarize the transcript sentence by sentence. Synthesize ideas; rewrite in your own concise wording. NEVER copy the transcript verbatim.
3. NEVER overwrite a node where lastEditedBy="user" or status="user_confirmed". If the segment contradicts or extends such a node, add a NEW sibling instead.
4. Prefer update_node over add_node when refining an existing point. Add new bullets only for genuinely new ideas.
5. Use add_node with a fresh tempId you make up (any short string) for new nodes. Use real ids (from the snapshot) for nodeId / parentId / afterId references.
6. If the segment contains no usable signal (filler, restating prior content, noise), return ops: [].
7. Always include sourceChunkIds on add_node and update_node so the user can trace bullets back to spoken segments.
8. Keep bullets crisp: max ~15 words. Headings: max ~6 words.
9. afterId is the id of the sibling AFTER which to insert; null means append at end of that parent's children.

Examples:

Snapshot empty. Segment: "So I've been thinking about how onboarding for our app sucks — new users drop off in the first minute because they don't understand the value."
→ ops:
  { "op":"add_node","tempId":"t1","parentId":null,"afterId":null,"level":"h1","text":"Onboarding redesign","sourceChunkIds":["c1"] }
  { "op":"add_node","tempId":"t2","parentId":"t1","afterId":null,"level":"bullet","text":"Users drop off in first 60 seconds","sourceChunkIds":["c1"], "tag":"insight" }
  { "op":"add_node","tempId":"t3","parentId":"t1","afterId":null,"level":"bullet","text":"Value prop unclear at first contact","sourceChunkIds":["c1"] }

Snapshot has a bullet n5 "Users drop off in first 60 seconds". Segment refines: "actually it's more like 30 seconds, and most of them never even scroll past the hero."
→ ops:
  { "op":"update_node","nodeId":"n5","text":"Users drop off in first 30 seconds, most never scroll past hero","sourceChunkIds":["c2"] }

Segment is just "yeah, um, what was I saying."
→ ops: []
`;

export const orchestrateSegment = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) => InputSchema.parse(input))
  .handler(async ({ data, context }) => {
    const { getAzureOpenAIClient } = await import("./azure-openai.server");
    const { model, deployment } = getAzureOpenAIClient();

    const snapshotText =
      data.snapshot.length === 0
        ? "(brief is empty)"
        : JSON.stringify(data.snapshot, null, 2);

    let ops: BriefOperation[] = [];
    let aiError: string | null = null;
    try {
      const { output } = await generateText({
        model,
        output: Output.object({ schema: OutputSchema }),
        system: SYSTEM_PROMPT,
        prompt: `Current brief snapshot:\n${snapshotText}\n\nNew transcript segment (chunkIds: ${JSON.stringify(
          data.segment.chunkIds,
        )}):\n"""${data.segment.rawText}"""\n\nReturn the minimum incremental operations.`,
      });
      ops = (output as { ops: BriefOperation[] }).ops;
    } catch (e: any) {
      aiError = e?.message || "AI call failed";
      console.error("[orchestrate] AI error", aiError, "deployment:", deployment);
    }

    // Log every op to the audit table (applied flag stays false; client updates later if needed).
    if (ops.length > 0) {
      const rows = ops.map((op) => ({
        session_id: data.segment.sessionId,
        segment_id: data.segment.segmentId,
        op_type: op.op,
        payload: op as any,
        applied: false,
      }));
      const { error: logError } = await context.supabase.from("brief_operations").insert(rows);
      if (logError) console.warn("[orchestrate] op log error:", logError.message);
    }

    if (aiError) {
      return { ops, error: aiError };
    }
    return { ops, error: null };
  });
