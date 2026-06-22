# Long-form Speech + Dual-speed Architecture — Implementation Plan

Builds on `.lovable/plan.md` (v2). Keeps Azure STT → OpenAI Realtime → Lovable AI Gateway (Gemini) → Supabase. Refactors the interaction unit from **per-segment** to **ThoughtTurn**, splits work into a **Fast Voice lane** and a **Slow Coordinator lane**, and unifies brief/research output into a single Pending block with one Keep/Undo.

---

## 1. File architecture

### Create
```text
src/lib/pipeline/
  thoughtTurnBuffer.ts        # aggregates Azure final segments → ThoughtTurn; owns boundary algorithm

src/lib/orchestrator/
  sessionEvents.ts            # typed SessionEvent bus (per-session, in-memory)
  sessionStore.ts             # single source of truth: activeSessionId, per-session broker, queues, registry
  coordinator.ts              # Slow lane: consumes thought_turn.finalized → brief + research fallback
  decideBrief.functions.ts    # createServerFn → BriefPatch[] from ThoughtTurn (Lovable AI, Gemini flash)
  detectResearch.functions.ts # createServerFn → optional research query if coordinator detects gap

src/lib/voice/
  voiceController.ts          # wraps realtimeClient; speak/cancel; exposes tool handlers
  voiceTools.ts               # tool schemas: stay_silent, request_research (passed to Realtime session)

src/lib/research/
  webSearch.functions.ts      # gemini + google_search grounded notes
  researchSynthesizer.functions.ts  # notes → ResearchResult (Output.object)
  researchQueue.ts            # global semaphore (max 2), session-tagged tasks, results posted via SessionEvent
```

### Modify
```text
src/lib/pipeline/types.ts                 # add ThoughtTurn, SessionEvent, BriefBlock.researchResultId?
src/lib/pipeline/transcriptBuffer.ts      # onSegment final → thoughtTurnBuffer.ingest(segment)  (NOT runTurn)
src/lib/agent/realtimeClient.ts           # remove char/word truncation; register tools; emit speech_started/response_started bridge events; longer reply caps
src/routes/_authenticated/workbench.tsx   # wire Azure→transcriptBuffer→thoughtTurnBuffer; subscribe to SessionEvent; render pending sections
src/components/brief/BriefDocument.tsx    # group all blocks from one operationId into ONE inline Pending section with ONE Keep/Undo
```

### Delete (after integration test passes)
```text
src/lib/agent/responseGenerator.functions.ts
src/lib/agent/interventionPolicy.ts
src/lib/orchestrate.functions.ts             # replaced by coordinator.ts + decideBrief
src/lib/orchestrator/runTurn.ts (v2 plan)    # not built; coordinator replaces it
```

`segmentGate.ts` stays only as a density classifier (not a pipeline entrypoint).

---

## 2. Confirmed TypeScript types

In `src/lib/pipeline/types.ts`:

```ts
export type ThoughtTurn = {
  id: string;
  sessionId: string;
  segmentIds: string[];        // Azure TranscriptSegment ids
  chunkIds: string[];          // source chunk ids (flattened) for brief provenance
  combinedText: string;        // cleanly concatenated segment text
  startedAt: number;
  endedAt: number;
  boundaryReason: "semantic_pause" | "hard_limit" | "manual_stop";
  revision: number;            // incremented when checkpoint is superseded
};

export type SessionEvent =
  | { type: "thought_turn.finalized"; sessionId: string; turnId: string; thoughtTurn: ThoughtTurn }
  | { type: "voice.spoke"; sessionId: string; turnId?: string; text: string }
  | { type: "research.requested"; sessionId: string; taskId: string; query: string }
  | { type: "research.completed"; sessionId: string; taskId: string; result: ResearchResult }
  | { type: "brief.proposed" | "brief.kept" | "brief.undone" | "brief.edited";
      sessionId: string; operationId: string };

export type ResearchResult = {
  id: string;
  query: string;
  title: string;
  summary: string;             // markdown, richer than voice
  findings: string[];
  links: { title: string; url: string }[];
  voiceSummary: string;        // ≤ ~25s spoken form
};
```

`BriefBlock` gains `researchResultId?: string` and `operationId?: string` (groups co-proposed pending blocks). No change to `status` / `isPending`.

---

## 3. ThoughtTurn boundary algorithm

`thoughtTurnBuffer.ts` (per-session singleton, held in `sessionStore`):

State: `current: { segments: TranscriptSegment[]; startedAt; lastSegmentAt; revision } | null`,
hard-limit timer, checkpoint timer.

Constants:
- `CHECKPOINT_MS = 30_000`  — internal-only progress snapshot
- `HARD_LIMIT_MS = 120_000`
- `SEMANTIC_PAUSE_MS = 2_500` — Azure final + no new final within window
- `MAX_GAP_MS = 8_000`        — segment older than this starts a new turn

### ingest(segment)
1. If `current == null` or `segment.startTimeMs - current.lastSegmentAt > MAX_GAP_MS`:
   start new turn (`id = uuid`, `startedAt = segment.startTimeMs`, `revision = 0`).
2. Push segment; update `lastSegmentAt`. Clear pending semantic-pause timer; schedule a new one at `SEMANTIC_PAUSE_MS`.
3. If `(now - startedAt) >= HARD_LIMIT_MS` → `finalize("hard_limit")`.
4. Else if `(now - startedAt) >= CHECKPOINT_MS` and no checkpoint at this revision → `checkpoint()` (bumps `revision`, emits internal-only event, no Pending UI).

### Finalization triggers
- semantic-pause timer fires → `finalize("semantic_pause")`
- voice lane emits `agent.response_started` (via SessionEvent) → flush current turn early → `finalize("semantic_pause")` (treat agent yield as turn close)
- `manualStop()` → `finalize("manual_stop")`
- hard-limit reached → `finalize("hard_limit")`

### finalize(reason)
- Build `ThoughtTurn`: `combinedText = segments.map(rawText).join(" ").normalizeWhitespace()`,
  `chunkIds = segments.flatMap(s => s.chunkIds)`.
- Emit `SessionEvent { type: "thought_turn.finalized", … }`.
- Clear all timers; `current = null`.

`runTurn()` is NOT called per Azure segment. The slow-lane coordinator subscribes to `thought_turn.finalized` once.

---

## 4. Two-lane architecture

### Lane A — Fast (OpenAI Realtime, WebRTC)
- `realtimeClient.ts`: drop hard word/char caps and the interviewer prompt; new SOCRATIC prompt allows 3–6 sentence replies (~30s), peer tone, no "tell me more" filler.
- Keep `create_response: true` + server VAD (Lane A owns its own turn-taking; the slow lane never speaks).
- Register two tools on the Realtime session (`session.update.tools`):
  - `stay_silent({ reason })` — cancel/suppress in-flight response; surfaces as `voice.stayed_silent` SessionEvent.
  - `request_research({ query, reason })` — synchronously: (a) emit `research.requested` SessionEvent (Canvas shows running pill instantly), (b) push task to `researchQueue`, (c) return short string for the agent to speak ("Looking that up.").
- Emit bridge SessionEvents on `response.created` (`voice.response_started`) and `response.done` (`voice.spoke` with transcript). `thoughtTurnBuffer` listens for `voice.response_started` to early-finalize.

### Lane B — Slow Coordinator (Lovable AI Gateway, Gemini flash)
- `coordinator.ts` subscribes to `thought_turn.finalized`. For each turn (serialized per session via `briefQueue` mutex):
  1. Call `decideBrief.functions` → returns `{ operationId, patches: BriefPatch[], proposeResearch?: { query, reason } }`.
  2. Apply patches as a single Pending group: every produced/edited block gets the same `operationId` and `isPending: true`; emits one `brief.proposed` SessionEvent.
  3. If `proposeResearch` and no Lane-A `request_research` already covers it → enqueue research task tagged with `sessionId + operationId`.
- Voice never writes to the brief. Coordinator never speaks.

### UI Pending rules (BriefDocument.tsx)
- Group all pending blocks sharing `operationId` into ONE inline Pending section with ONE Keep/Undo toolbar.
- Inline rendering only: green left-border for inserts, red strike-through for edits/deletes. No dashed cards, no shadow.
- Research completion appends its result blocks into the SAME `operationId` group if research was triggered for that op; otherwise its own single group.
- Keep → flips all blocks in group to `status: "user_confirmed"`, `isPending: false`, emits `brief.kept`. Undo → deletes/reverts, emits `brief.undone`.

---

## 5. Shared state & queues

`sessionStore.ts` (single source of truth, no parallel signal bus):
- `activeSessionId: string | null`
- `sessions: Map<sessionId, { broker, thoughtTurnBuffer, briefQueue (mutex), eventBus, researchTasks: Map<taskId, status> }>`
- Global `researchQueue` (semaphore = 2, FIFO; tasks carry `sessionId`).
- `setActiveSession(id)`: does NOT abort in-flight research. Coordinator/UI subscribers gate on `event.sessionId === activeSessionId` before rendering; results still persist to their original session row.
- `disposeSession(id)`: cancels Realtime, clears that session's buffers/queues; lets pending research finish and write to its origin session only.

Research result delivery: on completion, `researchQueue` emits `research.completed` on the **origin** session's eventBus. UI subscribes only to the active session's bus, so stale results never flash on the new canvas but are preserved when the user returns.

---

## 6. Web Search

Per spike (already in `.lovable/plan.md`): Gemini `google/gemini-3-flash-preview` + `tools: [{ type: "google_search" }]` via OpenAI-compatible adapter. Two-call shape: grounded notes → `Output.object` synthesis to `ResearchResult`. Links parsed from JSON tail with markdown-regex fallback.

---

## 7. Timeout / retry / failure

| Pipeline | Timeout | Retry | No-result / failure |
|---|---|---|---|
| Realtime tool call | 10s server-side ack | none (user can re-ask) | tool returns `{ ok:false }`; agent apologizes |
| decideBrief | 12s | 1× on 5xx/timeout | drop turn silently; log |
| webSearch | 20s | 1× | emit `research.completed` with empty `findings`+`links`; UI shows "No reliable sources found" pending block (still single Keep/Undo) |
| researchSynthesizer | 10s | 1× | fall back to notes as `summary` |

---

## 8. Session isolation

- Every async job carries `{ sessionId, turnId?, operationId?, taskId? }`.
- Coordinator / UI subscribers filter by `activeSessionId` before mutating UI.
- Research tasks persist results to `sessions.get(originSessionId).eventBus` regardless of active session.
- Switching session → UI unsubscribes from old bus, subscribes to new bus; old research never renders on new canvas.

---

## 9. Testing & acceptance

1. **Boundary**: speak 45s nonstop → exactly one `thought_turn.finalized` with `boundaryReason: "semantic_pause"` (or `hard_limit` past 120s). No per-segment briefs.
2. **Voice early-finalize**: agent starts speaking mid-stream → current turn finalizes; brief reflects everything said before voice started.
3. **Tools**: ask a factual question → agent calls `request_research`, voice says short ack, Canvas shows running pill instantly, result appears as ONE pending group later.
4. **Single Pending group**: a long turn that yields 3 brief blocks + 1 research result → ONE Keep/Undo toolbar controlling all four.
5. **Session switch**: trigger research, switch session before it returns → new canvas stays clean; switch back → result is there.
6. **No regression**: Azure STT entrypoint unchanged; `transcriptBuffer` still owns chunk dedupe and silence flush.

---

## 10. Rollout (incremental, no big-bang)

1. Types + `sessionEvents` + `sessionStore` skeleton (no behavior change).
2. `thoughtTurnBuffer` + transcriptBuffer wiring; coordinator stub logs only.
3. Voice prompt + remove caps; register tools (Lane A complete).
4. `decideBrief` + briefQueue + single-Pending-group UI.
5. Research pipeline + concurrency cap + session-gated rendering.
6. Delete legacy `responseGenerator`, `interventionPolicy`, `orchestrate.functions`.

Awaiting approval before writing code.
