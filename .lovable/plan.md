# Voice + Live Brief + Research — Revised Plan (v2)

Approved direction with 10 revisions applied. Web Search spike verified before designing the Research pipeline.

---

## 0. Web Search spike — VERIFIED

Spike against the production Lovable AI Gateway (`/v1/chat/completions`):

| Attempt | Result |
|---|---|
| `tools: [{ type: "google_search" }]` on `google/gemini-3-flash-preview` | **200 OK** — grounded answer with inline markdown citations (e.g. `[Node.js Releases](https://github.com/nodejs/node/releases)`) |
| Plain ask for URLs (no tool) | 200 — but URLs are hallucinated; not usable |
| `tools: [{ type: "web_search_preview" }]` on `openai/gpt-5-mini` | **400** — only `function` / `custom` supported |

**Conclusion:** Research Pipeline uses Gemini + `google_search` tool. Citations are NOT exposed as a separate `groundingMetadata` field through the OpenAI-compatible adapter — they appear inline in the assistant message. We will:

1. Call the model with the `google_search` tool and a prompt that asks for both prose + a JSON tail listing `{title, url}` per source.
2. Parse the JSON tail for `links[]`; fall back to a markdown-link regex on `content` if JSON parsing fails.
3. Run a second small Gemini call (`Output.object`) to synthesize the final `ResearchResult` from the grounded notes.

The AI SDK `createOpenAICompatible` provider passes `tools` through unchanged, so this works with `generateText({ tools: [{ type: "google_search" }] })` — no provider-specific helper needed.

Minimal verified shape used in spike:
```ts
await fetch("https://ai.gateway.lovable.dev/v1/chat/completions", {
  method: "POST",
  headers: { "Content-Type": "application/json", "Lovable-API-Key": key },
  body: JSON.stringify({
    model: "google/gemini-3-flash-preview",
    messages: [{ role: "user", content: query }],
    tools: [{ type: "google_search" }],
  }),
});
```

---

## 1. Files (minimized)

### Create (8 files, not 14)
```text
src/lib/orchestrator/
  types.ts                # TurnDecision, TurnContext, ResearchTask/Result, ids
  sessionStore.ts         # SINGLE SOURCE OF TRUTH for session state (broker + queues + registry)
  decide.functions.ts     # createServerFn → TurnDecision
  runTurn.ts              # client dispatcher: decide → fan out (voice now, brief queued, research queued)

src/lib/voice/
  voiceController.ts      # wraps realtimeClient: speak(mode, goal), cancel; owns response.create

src/lib/research/
  webSearch.functions.ts  # createServerFn: gemini + google_search → grounded notes + links
  researchSynthesizer.functions.ts  # createServerFn: notes → ResearchResult (Output.object)
  researchQueue.ts        # global semaphore (2), FIFO, session-tagged tasks
```

`sessionStore.ts` is the **single source of truth** for live session state — broker snapshot, per-session briefQueue mutex, per-session turnQueue (decisions+voice only), global researchQueue, and `activeSessionId`. All consumers read/write through it; no parallel module-level signal buses.

### Modify (5 files)
```text
src/lib/agent/realtimeClient.ts        # session.update → create_response:false; expose speak(mode,goal), cancel
src/lib/pipeline/transcriptBuffer.ts   # onSegment final → call runTurn() (current entrypoint preserved)
src/routes/_authenticated/workbench.tsx# wire onSegment→runTurn; render research status + Keep/Undo inline
src/components/brief/BriefDocument.tsx # inline pending treatment (green border / red strike + tiny toolbar)
src/lib/pipeline/types.ts              # add researchResultId? on BriefBlock; NO status field change
```

### Keep during rollout (delete only after integration tests pass)
- `src/lib/agent/responseGenerator.functions.ts`
- `src/lib/agent/interventionPolicy.ts`
- `src/lib/agent/segmentGate.ts` (stays a density classifier, **not** a transcript entrypoint)
- `src/lib/orchestrate.functions.ts` (the existing brief writer; `briefQueue` wraps it; rename/replace later)

### Database
**No migration.** Reuse existing `brief_nodes` columns: `status: "ai_draft" | "user_confirmed"`, `is_pending: boolean`. Research tasks are tracked in memory inside `sessionStore` (ephemeral); completed research becomes ordinary `ai_draft` rows tagged with a new optional `research_result_id` on a future migration if needed — initially we just store the result id in `rationale` JSON.

---

## 2. Final TypeScript types

```ts
// orchestrator/types.ts
export type SessionId = string;
export type TurnId = string;

export type VoiceAction =
  | "silent" | "acknowledge" | "probe" | "direct_answer" | "research_ack";
export type BriefAction =
  | "none" | "capture" | "restructure" | "capture_answer";
export type ResearchAction =
  | "none" | "quick_search" | "deep_search";

export interface TurnDecision {
  voiceAction: VoiceAction;
  briefAction: BriefAction;
  researchAction: ResearchAction;
  reason: string;
  confidence: number;            // 0..1
  researchQuery?: string;
  /** High-level intent for the Voice Pipeline; NOT a draft answer. */
  responseGoal?: string;         // e.g. "acknowledge user is stuck on pricing", "offer 2 framings for onboarding metric"
}

export interface TurnContext {
  sessionId: SessionId;
  turnId: TurnId;
  finalTranscript: string;
  recentTranscript: string[];    // last ~6 user turns
  recentVoice: string[];         // last ~4 agent replies
  briefDigest: string;           // compressed brief text
  openResearch: { id: string; status: ResearchStatus; query: string }[];
  attachmentsDigest?: string;
}

// research/types.ts
export type ResearchStatus =
  | "queued" | "searching" | "comparing" | "writing" | "ready" | "failed";

export interface ResearchTask {
  id: string;
  sessionId: SessionId;          // origin session — never reassigned
  turnId: TurnId;
  kind: "quick" | "deep";
  query: string;
  status: ResearchStatus;
  startedAt: number;
  finishedAt?: number;
  error?: string;
}

export interface ResearchResult {
  title: string;
  summary: string;
  findings: string[];
  links: string[];               // canvas shows links only, no metadata
  voiceSummary: string;
}
```

**Brief status fields stay untouched:** `status: "ai_draft" | "user_confirmed"`, `isPending: boolean`. Pending = `isPending: true && status: "ai_draft"`. Keep = set `isPending: false, status: "user_confirmed"`. Undo = delete row (or revert via existing `originalText` if present).

---

## 3. Three-pipeline call sequence

```text
Azure final transcript
   │
   ▼
workbench onSegment (existing entrypoint, unchanged)
   │
   ▼
transcriptBuffer.push(final)  ── density tracking lives here; segmentGate still classifies for telemetry
   │
   ▼
runTurn({sessionId, turnId, finalText})
   │
   ▼  sessionStore.snapshot(sessionId) → TurnContext
   │
   ▼  decide(ctx) → TurnDecision     [serialized in turnQueue: decisions + voice only]
   │
   ├─► VOICE  (in-order, awaited)
   │    voiceController.speak(voiceAction, responseGoal)   // voice pipeline drafts the actual words
   │    on user barge-in → voiceController.cancel()
   │
   ├─► BRIEF  (NOT in turnQueue; per-session mutex in briefQueue)
   │    briefQueue.run(sessionId, () =>
   │       orchestrateSegment({action, ctx, researchResult?}))   // existing function, wrapped
   │
   └─► RESEARCH  (NOT in turnQueue; global semaphore = 2)
        researchQueue.submit({kind, query, sessionId, turnId})
          status callbacks → sessionStore.researchStatus(sessionId, id, status)
          on ready → if sessionStore.isActive(task.sessionId):
                       briefQueue.run(task.sessionId, () =>
                         orchestrateSegment({ action:"capture_answer", researchResult }))
                     else: persist result to origin session's brief_nodes only — never touch UI
        voice stays silent on completion; user must ask "what did you find"
```

Only **decisions + voice actions** are serialized. Slow brief writes run in parallel with the next turn's voice; research runs fully independently.

---

## 4. Voice Pipeline (no answer drafting in Orchestrator)

`voiceController.speak(action, goal)` builds the Realtime `response.create` instructions from a per-mode template + the orchestrator's `responseGoal`:

```ts
const MODE_PROMPTS = {
  acknowledge: "One short sentence acknowledging what you heard.",
  probe: "One brief observation, then one focused question. Offer 2–3 concrete options when useful. Never ask generic openers like 'tell me more' or 'what's the main problem'.",
  direct_answer: "Answer concisely in 3–6 sentences, ≤30s of speech.",
  research_ack: "Briefly say you'll look it up.",
};
client.response.create({
  modalities: ["audio","text"],
  instructions: `${MODE_PROMPTS[action]}\n\nGoal: ${goal ?? ""}\n\nRecent context: ${digest}`,
});
```

The Orchestrator passes intent ("user stuck on positioning, suggest 2 angles"); the Voice Pipeline + Realtime model produce the words. No `voicePayload`.

Realtime session: `turn_detection: { type:"server_vad", create_response: false, interrupt_response: true }`. The Orchestrator owns every `response.create`.

---

## 5. Live Brief

- `briefQueue` = per-session mutex around `orchestrateSegment`. Wraps the existing server fn, so we don't rewrite it on day 1.
- Pending rows: `isPending=true, status="ai_draft"` — unchanged.
- Research result becomes ONE pending insertion (heading + paragraph) tied to a single Keep/Undo control on the UI side.
- User-edited rows (`status="user_confirmed"`) are passed to the writer as **immutable** and excluded from restructure targets.

### Inline pending treatment (no cards)
```css
.brief-pending-insert { border-left: 2px solid theme(emerald.400/60); padding-left: .75rem; }
.brief-pending-delete { color: theme(red.400/80); text-decoration: line-through; }
.brief-pending-toolbar { /* tiny: ✓ Keep · ↶ Undo, ghost buttons, no shadow */ }
```
No dashed boxes, no rounded panels, no drop shadows.

---

## 6. Research Pipeline

`webSearch.functions.ts` (createServerFn):
```ts
const gateway = createLovableAiGatewayProvider(process.env.LOVABLE_API_KEY!);
const { text } = await generateText({
  model: gateway("google/gemini-3-flash-preview"),
  tools: [{ type: "google_search" } as any],   // verified shape
  prompt: `${query}\n\nReturn 1-2 paragraphs of grounded notes, then a fenced JSON block:\n\`\`\`json\n{"links":[{"title":"...","url":"..."}]}\n\`\`\`\nTarget ${kind === "deep" ? "8-12" : "3-5"} sources.`,
  stopWhen: stepCountIs(50),
});
// parse trailing ```json``` block; fallback: regex /\[([^\]]+)\]\((https?:\/\/[^\s)]+)\)/g
```

`researchSynthesizer.functions.ts` takes the notes + link list and produces `ResearchResult` via small `Output.object` schema (kept narrow to avoid Gemini state-limit errors).

`researchQueue.ts`: in-memory FIFO with `MAX_CONCURRENT = 2` across all sessions. Tasks carry `sessionId/turnId` in their closure; status updates push through `sessionStore` only when the task's origin session is still the active session.

Canvas status strings (no chain-of-thought): `Searching sources…`, `Comparing findings…`, `Preparing brief…`, `Ready for review`, `Search failed`.

---

## 7. Timeout / retry / failure / no-result

| Stage | Timeout | Retry | On failure |
|---|---|---|---|
| `decide` | 4s | 1× (network only) | `{silent, none, none}` |
| Voice `response.create` | n/a (stream) | none | log + status pill |
| `orchestrateSegment` (brief) | 15s | 1× on 5xx/429 | drop pending row; toast "Brief failed" |
| `webSearch` | 25s | 1× | task→`failed`; canvas shows "Search failed — retry" |
| `researchSynthesizer` | 15s | 1× | same as above |
| No results | n/a | n/a | `ready` with `{summary:"No reliable sources found.", links:[]}` |

429 / 402 from gateway surface explicitly per Lovable AI conventions.

---

## 8. Session isolation (corrected — no aborting research)

- `sessionStore.activeSessionId` is the only "which session is on screen" flag. Set on workbench mount / route param change.
- **Research tasks are never aborted on session switch.** They run to completion against their origin `sessionId`.
- On completion, `runResearch.complete()` does:
  ```ts
  // ALWAYS persist to origin session
  await briefQueue.run(task.sessionId, () => persistResearch(task.sessionId, result));
  // Update UI ONLY if origin === active
  if (sessionStore.activeSessionId === task.sessionId) {
    sessionStore.emit(task.sessionId, "research:ready", result);
  }
  ```
- Brief and voice fan-out from `runTurn` check `sessionStore.activeSessionId === ctx.sessionId` before mutating UI signals; database writes always go to `ctx.sessionId` regardless.
- Switching session: clear UI subscriptions; do NOT cancel in-flight fetches.
- Voice is cancelled on switch (Realtime is a single live channel): `voiceController.cancel()`.

---

## 9. Reliability checklist

- Decisions+voice serialized per session via `turnQueue` (FIFO).
- Brief writes serialized per session via `briefQueue` (independent of turnQueue).
- Research global concurrency = 2 (semaphore).
- Every async job carries `{sessionId, turnId}` and tags writes.
- Stale-session UI guard at the emit boundary, not at the write boundary.
- `sourceChunkIds` round-tripped through `orchestrateSegment` (already does).
- User edits respected: `status="user_confirmed"` rows excluded from restructure targets (already enforced in the writer's prompt; add an assertion test).

---

## 10. Testing & acceptance

Unit:
- `decide` returns valid `TurnDecision` for fixtures: thinking-aloud, stuck pause, direct factual Q, comparison Q.
- `researchQueue` enforces global concurrency 2 + FIFO.
- `briefQueue` serializes per session; parallel across sessions.
- `voiceController` cancels on barge-in within one event loop tick.

Integration (Playwright in sandbox):
- Factual question → voice says "Let me look that up" → status pill cycles → research pending block appears → Keep persists as `user_confirmed`.
- Rambling thought → voice silent; brief grows pending rows.
- Barge-in → Realtime response cancelled.
- **Corrected session switch test:** start research in session A, switch to B mid-flight, wait for completion → confirm session A's `brief_nodes` got the new row, confirm session B's UI never showed it and its `brief_nodes` is untouched. Switch back to A → row is visible.
- Web search spike (already passing): `tools:[{type:"google_search"}]` returns grounded answer with citations.

Acceptance:
- No regression in Azure STT, Realtime audio, current Brief editor or template UX.
- TypeScript + lint + build pass.
- `orchestrateSegment` and `interventionPolicy` still present until integration tests are green.

---

## 11. Incremental rollout (5 PRs)

1. **Types + `sessionStore`** (no behavior change). Add `voiceController` shim that forwards to existing `realtimeClient` API.
2. **Realtime `create_response:false`** + Orchestrator `decide` + `turnQueue`. STT final still triggers existing brief path; Orchestrator only drives voice. `responseGenerator`/`interventionPolicy` remain authoritative for now.
3. **`briefQueue`** wraps `orchestrateSegment`; route brief writes through it. Keep old path behind a flag for one PR.
4. **Research module** (webSearch + synthesizer + queue) + canvas status pill, behind a flag.
5. **Enable research actions** in `decide`; flip flags on; delete `responseGenerator.functions.ts` and `interventionPolicy.ts` after acceptance tests pass.

Each PR ships independently; `workbench.tsx` only gains a thin `runTurn()` call, never a rewrite.
