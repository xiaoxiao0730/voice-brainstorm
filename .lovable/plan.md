## Goal

Make the Live Brief work reliably: stop the "could not parse the response" crash, batch LLM calls to natural pauses (~5s silence), switch the canvas from a node-tree to a Notion-style document, and keep the AI's writes as additive patches that respect what the user has edited.

## Problem analysis

1. **Parse failure** — `orchestrateSegment` uses `generateText` + `Output.object({ schema: OutputSchema })` with Gemini. Gemini frequently rejects/struggles with deeply nested `discriminatedUnion` schemas, and when it returns prose or partial JSON the AI SDK throws "No object generated: could not parse the response." There is no fallback parser, no retry, no `finish_reason` check.
2. **LLM called too often** — `transcriptBuffer` flushes on 1.2s silence / 50 words / 8s, so we call the LLM every couple of sentences. User wants ~5s silence as the primary trigger.
3. **Wrong mental model** — current UI is a tree of `BriefNode`s (h1/h2/bullet) rendered as `<li>` rows with per-node contentEditable. User wants ONE document the user types into freely, with the LLM appending/refining sections, not emitting `add_node`/`update_node` ops over a tree.
4. **No memory of user edits** — model gets a node snapshot but no clear "this is what the user wrote/changed, do not overwrite" channel beyond a `lastEditedBy` flag.

## Plan

### 1. Switch the data model to a document with sections

New shape (in `src/lib/pipeline/types.ts`):
```ts
type BriefBlock = {
  id: string;            // stable uuid
  heading: string;       // "" for intro/unlabeled
  level: 1 | 2 | 3;      // heading level
  body: string;          // markdown text (bullets as "- ..." lines)
  lastEditedBy: "ai" | "user";
  locked: boolean;       // true after user edits inside it
  sourceChunkIds: string[];
};
type BriefDoc = { blocks: BriefBlock[] };
```

Persistence: reuse the existing `brief_nodes` table by treating each row as a block (level→heading level, text→body markdown, parent_id stays null). No migration needed for v1.

### 2. New Notion-style canvas component

Replace `BriefCanvas` with `BriefDocument`:
- One scrollable column, max-width ~720px.
- Each block renders: an editable heading (`<h1/h2/h3 contentEditable>`) + an editable body (`<div contentEditable>` rendering markdown-ish text; bullets via leading `- `).
- Typing anywhere marks that block `lastEditedBy="user"` and `locked=true`, debounced 600ms → persists via `upsertBriefNode`.
- AI-appended blocks fade in; locked blocks get a subtle "edited" indicator and the AI cannot overwrite them.
- Empty state: a single placeholder block that says "Start speaking…".

### 3. Trigger LLM only on real pauses

Update `transcriptBuffer.ts`:
- `SILENCE_MS` 1200 → **5000**.
- Keep a hard ceiling: flush on 30s elapsed OR ~150 words to avoid runaway segments during continuous speech.
- Remove per-sentence flushes.

### 4. Rewrite the orchestrator to emit safe patches

In `orchestrate.functions.ts`:
- Replace the `discriminatedUnion` schema with a **flat, simple** schema Gemini handles reliably:
  ```ts
  z.object({
    patches: z.array(z.object({
      action: z.enum(["append_block", "update_block", "append_to_block"]),
      blockId: z.string().nullable(),    // null for append_block
      heading: z.string().default(""),
      level: z.number().int().min(1).max(3).default(2),
      bodyMarkdown: z.string().default(""),
      sourceChunkIds: z.array(z.string()).default([]),
    })).default([]),
  })
  ```
- Build prompt with two clearly separated sections:
  1. **Current document** (rendered as markdown, with each block prefixed by `<!-- block:{id} locked={true|false} -->`).
  2. **New transcript segment** plus the **list of locked block ids** the model MUST NOT touch.
- System prompt rules: never rewrite a locked block; prefer `append_to_block` for refinements on AI blocks; create a new block only for genuinely new topics; return `{ "patches": [] }` if nothing meaningful.
- **Robust parsing fallback**: if `Output.object` throws, call `generateText` again WITHOUT the schema and reuse a tolerant `extractJSON` helper (strip ```json fences, find first `{`/last `}`, `JSON.parse`, validate with Zod). If that also fails, return `{ patches: [], error }` instead of crashing the segment.
- Drop unused op types (`move_node`, `annotate`, `delete_node`) — out of scope for v1 document model.

### 5. Apply patches client-side, respecting locks

New reducer `applyBriefPatch(doc, patch)`:
- `append_block` → push new block at end.
- `append_to_block` → if target exists and `!locked`, append `\n\n{bodyMarkdown}` to body; if locked, fall back to creating a new block right after it.
- `update_block` → only if `!locked`; otherwise skip and log.
- Always persist via `upsertBriefNode` after apply.

### 6. Feed user edits back to the model

When sending the snapshot, include the last ~3 user-edited block excerpts under a `"User has personally written/edited these — match their voice and never contradict:"` header. This gives the model concrete memory of the user's wording without complex fine-tuning.

### 7. Verification

- Manually trigger one short utterance → expect exactly one LLM call after 5s silence, one or two `append_block` patches, document renders.
- Edit a block, speak again → that block stays untouched; new content lands as a new block or appended to a different AI block.
- Force a malformed model response (temporary test) → orchestrator returns `{ patches: [], error }`, UI shows a small toast, no crash.

## Files touched

- `src/lib/pipeline/types.ts` — add `BriefBlock`, `BriefDoc`, patch types.
- `src/lib/pipeline/transcriptBuffer.ts` — silence 5s, ceilings.
- `src/lib/pipeline/applyBriefPatch.ts` — new reducer (replaces `applyBriefOperation`).
- `src/lib/orchestrate.functions.ts` — new flat schema, tolerant parser, user-edit memory in prompt.
- `src/components/brief/BriefDocument.tsx` — new Notion-style component (replaces `BriefCanvas`).
- `src/routes/_authenticated/workbench.tsx` — swap canvas, wire new patch flow.
- `src/lib/brief.functions.ts` — unchanged shape; still upserts rows.

## Out of scope (v1)

- Slash commands, drag-to-reorder, rich inline formatting (bold/italic/links).
- Real-time multi-cursor / collaboration.
- Migration of any existing session data (current sessions can be left as-is or cleared).