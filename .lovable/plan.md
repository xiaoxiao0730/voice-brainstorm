## Goal

Replace the browser's SpeechRecognition + single-shot Gemini call with a real pipeline:
Azure Speech → buffered TranscriptSegments → Azure OpenAI reasoning that emits **incremental BriefOperations** → validated merge into a Notion-style editable canvas (H1 / H2 / bullet body) → persisted to Lovable Cloud.

## Architecture

```text
Mic ──► Azure Speech SDK (browser, token-auth)
          │  partial + final recognition events
          ▼
   TranscriptBuffer  (50 words EN / 80 chars CN / 8s / silence)
          │  flush → TranscriptSegment
          ▼
   POST /api/orchestrate  (TanStack server route, streaming SSE)
          │  Azure OpenAI chat completions (JSON-schema mode)
          ▼
   BriefOperation[]  (add_node / update_node / delete_node / reorder / annotate)
          │
          ▼
   Client validator + reducer → BriefDoc state
          │           (rejects ops on user_confirmed / user-edited nodes)
          ▼
   <BriefCanvas /> contentEditable bullet outliner
          │
          ▼
   Lovable Cloud (sessions, transcript_segments, brief_nodes, brief_ops)
```

## 1. Secrets & connections

Add as runtime secrets:
- `AZURE_SPEECH_KEY`, `AZURE_SPEECH_REGION`
- `AZURE_OPENAI_ENDPOINT` (e.g. `https://<resource>.openai.azure.com`)
- `AZURE_OPENAI_API_KEY`
- `AZURE_OPENAI_DEPLOYMENT` (your gpt-4o / gpt-4.1 deployment name)
- `AZURE_OPENAI_API_VERSION` (e.g. `2024-10-21`)

Auth: enable Google sign-in + email/password (Lovable Cloud managed). All workbench routes move under `src/routes/_authenticated/`.

## 2. Database (Lovable Cloud)

Tables, all scoped to `auth.uid()` via RLS:
- `sessions` — id, user_id, title, status, started_at, ended_at
- `transcript_chunks` — id, session_id, text, is_final, start_ms, end_ms, lang
- `transcript_segments` — id, session_id, chunk_ids[], raw_text, start_ms, end_ms, boundary_reason
- `brief_nodes` — id, session_id, parent_id, order_key, level (`h1`|`h2`|`bullet`), text, status (`ai_draft`|`user_confirmed`), last_edited_by (`ai`|`user`), source_chunk_ids[], confidence, updated_at
- `brief_operations` — id, session_id, segment_id, op_type, payload jsonb, applied bool, rejection_reason, created_at  (audit log)

GRANTs + RLS policies in the same migration. Order key uses fractional indexing string so AI inserts don't renumber siblings.

## 3. Azure Speech (browser)

- Install `microsoft-cognitiveservices-speech-sdk`.
- New server fn `getSpeechToken()` → returns short-lived token from `https://<region>.api.cognitive.microsoft.com/sts/v1.0/issueToken` using `AZURE_SPEECH_KEY`. Never ship the key.
- `src/lib/speech/azureRecognizer.ts` — wraps `SpeechRecognizer` with continuous recognition; emits `{ kind: "partial"|"final", text, offsetMs, durationMs }`. Auto-detect EN/CN via `AutoDetectSourceLanguageConfig`.
- Replace the `webkitSpeechRecognition` block in `workbench.tsx`.

## 4. TranscriptBuffer

`src/lib/pipeline/transcriptBuffer.ts`:
- Stores finalized chunks since last flush.
- Flush when ANY of: ≥50 EN words, ≥80 CN chars, ≥8s elapsed, or ≥1.2s silence after a final.
- Dedupes by chunk id and by trailing-substring match to drop Azure's overlap re-finals.
- Emits `TranscriptSegment { segmentId, sessionId, chunkIds, rawText, startTimeMs, endTimeMs, boundaryReason }`.
- Persists chunk + segment via server fns as it goes.

## 5. Orchestrator (Azure OpenAI)

`src/routes/api/orchestrate.ts` — streaming server route (SSE). Input: `{ sessionId, segment, briefSnapshot }`.

- Uses AI SDK `@ai-sdk/azure` with deployment from env. Model is **whatever Azure deployment the user provisioned** (gpt-4o recommended).
- System prompt enforces:
  - Maintain an *evolving* brief; do not re-summarize prior content.
  - Never copy transcript verbatim; rewrite as concise bullets.
  - Never overwrite nodes where `lastEditedBy === "user"` or `status === "user_confirmed"`.
  - Output ONLY a JSON array of `BriefOperation`s — the minimum to reflect this segment. Empty array is valid.
  - Few-shot examples for: first segment (creates H1 + bullets), refinement segment (updates a bullet), tangent (adds new H2 section), no-op segment.
- Response schema (zod, also passed to model as JSON schema):
  ```ts
  BriefOperation =
    | { op: "add_node"; tempId; parentId|null; afterId|null; level; text; sourceChunkIds[]; confidence }
    | { op: "update_node"; nodeId; text; sourceChunkIds[]; confidence }
    | { op: "delete_node"; nodeId; reason }
    | { op: "move_node"; nodeId; newParentId|null; afterId|null }
    | { op: "annotate"; nodeId; tag } // "insight" | "question" | "action"
  ```
- Streams ops as they're produced (`text/event-stream`, one JSON op per `data:` line) so the canvas updates progressively.
- Persists every op (applied or not) to `brief_operations` for replay/debug.

## 6. Client merge & validation

`src/lib/pipeline/applyBriefOperation.ts`:
1. Resolve target node; reject if missing.
2. Reject any op touching a node with `lastEditedBy="user"` or `status="user_confirmed"` (log to `brief_operations.rejection_reason`).
3. Resolve `tempId` → real id after add_node persists.
4. Enforce level rules (no bullet under bullet beyond depth 3, H1 only at root).
5. Update local Zustand store + write through to `brief_nodes` via server fn.

## 7. Notion-style canvas

Replace today's card grid with `src/components/brief/BriefCanvas.tsx`:
- Single scrollable column, contentEditable list. Three styles via `level`:
  - `h1` → Instrument Serif 32px
  - `h2` → Instrument Serif 22px
  - `bullet` → Inter 14px with `•` marker; supports nested indent
- Keyboard: Enter = new sibling bullet, Tab/Shift-Tab = indent, `/` = level menu (H1/H2/bullet/toggle confirmed).
- On any user edit: set `lastEditedBy="user"`, debounce 600ms, persist, lock against AI overwrite. Subtle "edited" dot indicator.
- "Confirm" action (⌘↵) sets `status="user_confirmed"`.
- Each node shows hoverable source chips → click jumps transcript panel to the source segment.

Drag/drop reordering is out of scope for this iteration (manual order via keyboard).

## 8. Workbench wiring

`src/routes/_authenticated/workbench.tsx`:
- On Start: create `session` row, init Azure recognizer + buffer.
- On each segment flush: append to transcript panel, POST to `/api/orchestrate`, stream ops into reducer.
- On Stop: final flush, mark session ended.
- Sidebar lists user's sessions (already mocked — wire to real query).
- Loading/error UI for 429 (rate limit) and Azure quota errors.

## 9. Out of scope for this round (saved for "level up")

- Step 7 "co-thinking" blocks (questions/insights side panel) — schema reserves `annotate` op for it.
- Multi-user collaborative editing.
- Voice diarization.
- Drag/drop reordering.
- Offline queue.

## Technical notes

- Keep Azure OpenAI calls strictly server-side; AI SDK + `@ai-sdk/azure` provider configured per-request inside the route handler (not module scope) so env reads happen at runtime.
- Use server functions (not edge functions) for all DB writes — TanStack idiom.
- `brief_operations` table doubles as the audit trail and as the replay log for future "rewind brief" UX.
- Fractional order keys (e.g. `mudder` library or simple midpoint strings) so AI can insert between siblings without rewriting peers.
- The current `processTranscript` server fn and ThoughtBlock UI are deleted; nothing else in the app depends on them.

## Files touched / created

- delete: `src/lib/ai.functions.ts` (replaced)
- new: `src/lib/azure/openai.server.ts`, `src/lib/azure/speech.server.ts`, `src/lib/speech/azureRecognizer.ts`, `src/lib/pipeline/{transcriptBuffer,applyBriefOperation,briefStore}.ts`, `src/lib/pipeline/types.ts`
- new server route: `src/routes/api/orchestrate.ts`
- new server fns: `src/lib/session.functions.ts`, `src/lib/brief.functions.ts`, `src/lib/speech.functions.ts`
- new components: `src/components/brief/{BriefCanvas,BriefNode,SourceChip}.tsx`
- move + rewrite: `src/routes/workbench.tsx` → `src/routes/_authenticated/workbench.tsx`
- new: `src/routes/auth.tsx` (sign-in with Google + email)
- migration: tables + RLS + GRANTs above
- secrets: 5 Azure secrets via `add_secret`

After you approve, I'll request the 5 Azure secrets first, then run the migration, then build the code in dependency order (DB types → speech → buffer → orchestrator → canvas → workbench).
