# Stage 2: Two-Lane Agent Architecture

Split the agent into a low-latency dialogue lane and a structural reasoning lane. Realtime is the immediate co-thinking voice; Live Brief stays the single source of truth, owned exclusively by the background lane.

## Lanes

```text
                  ┌─ Azure committed transcript ─┐
mic ─┬─ Azure STT ┤                              │
     │            └─→ Background Reasoning Loop ─┴─→ Live Brief (truth)
     │                detectThinkingState                │
     │                policy → decision                  ├─→ text suggestion card
     │                generateIntervention               ├─→ canvas ghost patch
     │                                                   └─→ Exploration Brief
     │
     └─ Realtime PC ─→ Fast Dialogue Loop ─→ voice reply only
                       intent router + mode             (no brief / canvas writes)
```

## 1. Agent Modes

Add a session-scoped `agentMode: "listen" | "guide" | "answer"` (default `guide`), persisted in `localStorage` per session and toggleable via UI + voice commands.

- `listen` — fast lane silent except for control acks; background still runs.
- `guide` — fast lane may ask one short guiding question on `light_guidance_request`.
- `answer` — fast lane answers `simple_direct_question` and `structural_deep_question` acks freely.

Voice triggers (matched in the intent router):

- "先别打断我" / "别说话" / "let me think" → `listen`
- "你可以边听边问" / "you can interrupt" → `guide`
- "你觉得呢" / "what do you think" → `answer`

## 2. Fast Intent Router

New `src/lib/agent/fastIntent.ts` (client-side, no LLM by default). Runs on every Azure interim+committed segment, in parallel with the background pipeline.

Intents:
`greeting`, `simple_direct_question`, `structural_deep_question`, `control_listen`, `control_guide`, `control_mute`, `control_resume`, `light_guidance_request`, `thinking_aloud`, `request_summary`, `unknown`.

Routing rules:

1. Regex / keyword match against mode-switch phrases and control commands → `control_*` (highest priority, instant).
2. Short utterance (<8 words) + question mark + non-structural keywords → `simple_direct_question`.
3. Greetings / presence checks (small lexicon, zh + en) → `greeting`.
4. Question containing structural markers ("how should I structure", "what's missing", "帮我整理") → `structural_deep_question`.
5. Imperative requests for short prompts ("give me a hint", "提示一下") → `light_guidance_request`.
6. "Summarize / 总结一下" → `request_summary`.
7. Long, non-question, declarative segment → `thinking_aloud`.
8. Otherwise → `unknown`.

LLM fallback (Gemini Flash, single call, <400ms) only fires when the rule router returns `unknown` AND segment length is between 4 and 20 words. Otherwise default to `thinking_aloud` (safe silent).

## 3. Intent → Action Table


| Intent                        | Fast lane                                           | Background lane              | Touches brief? |
| ----------------------------- | --------------------------------------------------- | ---------------------------- | -------------- |
| `greeting`                    | short voice reply                                   | skip                         | no             |
| `simple_direct_question`      | short voice answer (gateway, <1.5s)                 | skip                         | no             |
| `control_listen/guide/answer` | switch mode + verbal ack                            | skip                         | no             |
| `control_mute`                | cancel current speech, suppress lane                | skip                         | no             |
| `control_resume`              | re-enable lane + ack                                | skip                         | no             |
| `light_guidance_request`      | one short guiding question (guide/answer mode only) | skip                         | no             |
| `request_summary`             | brief ack ("整理一下")                                  | generate summary/brief       | yes            |
| `structural_deep_question`    | brief ack only                                      | full reasoning + canvas/text | yes            |
| `thinking_aloud`              | silent                                              | full pipeline                | yes            |
| `unknown`                     | silent                                              | full pipeline                | yes            |


## 4. Background Lane Scope

Strip greeting / direct-question / control handling from `responseGenerator.functions.ts` and `interventionPolicy.ts`. Background continues to own: `missing_structure`, `contradiction_detected`, `stuck`, deep `explicit_request`, Live Brief updates, suggestion cards, canvas patches, Exploration Brief.

Background voice becomes rare — only `explicit_request` (deep) and high-confidence `stuck` may emit `voice`; everything else collapses to `text_suggestion` or `canvas_suggestion`.

## 5. Canvas Ghost Patch

Extend the decision union in `interventionPolicy.ts`:

```ts
type BackgroundDecision = "silent" | "text_suggestion" | "canvas_suggestion" | "voice";
```

`canvas_suggestion` path:

- `generateIntervention` returns `{ kind: "canvas_patch", patch: BriefPatch, rationale }`.
- `BriefCanvas` renders the patch as a ghost overlay (dashed border, reduced opacity) with Accept / Edit / Dismiss controls.
- Accept → `applyBriefPatch`. Edit → open in inline editor. Dismiss → record `dismissed` feedback.
- Never auto-commits.

Policy: prefer `canvas_suggestion` over `text_suggestion` when the decision concerns `missing_structure` and the patch target is well-localized; otherwise text.

## 6. Lane Coordination

Both lanes share the single `realtimeClient` instance.

- **Speaking mutex**: `realtimeClient.isAgentSpeaking()` checked before background `voice`; if true, downgrade to `text_suggestion`.
- **Barge-in**: existing `input_audio_buffer.speech_started` handler cancels active response regardless of which lane started it.
- **Separate cooldowns**: split `PolicyState` into `fast` and `structural` buckets. Fast greetings/answers do not bump `lastVoiceAt` for structural decisions and vice versa.
- **Separate logs**: `interventionLog.functions.ts` gains `lane: "fast" | "structural"` column; both lanes call `logIntervention` with their lane tag.

## Files

New:

- `src/lib/agent/fastIntent.ts` — rule router + optional Gemini fallback (`fastIntentFallback.functions.ts`).
- `src/lib/agent/agentMode.ts` — mode state hook, voice-command matchers.

Edit:

- `src/lib/agent/interventionPolicy.ts` — split cooldowns, add `canvas_suggestion`, narrow decision space.
- `src/lib/agent/responseGenerator.functions.ts` — drop greeting/direct-Q paths; add canvas-patch output kind.
- `src/lib/agent/interventionLog.functions.ts` — add `lane` field + migration.
- `src/lib/agent/realtimeClient.ts` — no API change; consumers respect `isAgentSpeaking()` mutex.
- `src/components/agent/AgentPanel.tsx` — mode selector UI (Listen / Guide / Answer).
- `src/components/brief/BriefCanvas.tsx` — ghost patch overlay + accept/edit/dismiss.
- `src/routes/_authenticated/workbench.tsx` — per-segment: run fast router immediately, dispatch background in parallel, gate background voice on mutex.

DB migration: add `lane TEXT NOT NULL DEFAULT 'structural'` to `intervention_log` (with GRANTs preserved).

## Out of Scope

- Realtime as primary reasoner (speculative drafting, text modality).
- Realtime writing canvas directly.
- STT silence-timeout tuning.

## Acceptance

- "你在吗" → voice reply ≤700ms, no brief/canvas change, logged as `lane=fast`.
- "先别打断我" → mode flips to `listen`, brief verbal ack, subsequent guiding questions suppressed.
- "What is SaaS?" in `answer` mode → fast lane answers; background silent.
- 30s thinking-aloud monologue → zero fast voice; background may emit one ghost patch or text card.
- "帮我整理一下结构" → fast ack ("好的，让我看看"), background generates canvas ghost patch.
- Barge-in mid-fast-reply cancels cleanly; background can still surface text card.
- Fast and structural cooldowns advance independently (verifiable via `intervention_log`).