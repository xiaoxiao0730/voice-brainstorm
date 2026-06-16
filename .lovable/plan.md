# Stage 2 — Realtime Co-thinking Voice Agent

## Design principle

Keep Stage 1 untouched: Azure STT → `transcriptBuffer` → `orchestrateSegment` → Live Brief. The voice agent is a **second, parallel consumer** of the same committed transcript segments. It does not own transcription, and it does not speak unless the policy engine explicitly tells it to. Default = silent.

OpenAI Realtime (`gpt-realtime`, WebRTC) is used for **voice output + barge-in detection**, not as the primary STT (Azure already does that better for our Chinese/English mixed case and is wired into the Live Brief flow).

## Architecture

```text
              ┌────────────── mic (existing) ──────────────┐
              ▼                                            ▼
       Azure Recognizer                          OpenAI Realtime (WebRTC)
       (existing, owns ASR)                      (audio in: barge-in only;
              │                                   audio out: agent speech)
              ▼                                            ▲
       transcriptBuffer                                    │
              │ committed segment                          │ speak(text)
              ▼                                            │
       orchestrateSegment ─────► Live Brief ◄──────────────┤
              │                       │                    │
              └────► ThinkingState ◄──┘                    │
                          │                                │
                          ▼                                │
                 InterventionPolicy ──────► AgentResponseGen
                          │                                │
                          ├─ silent  (nothing)             │
                          ├─ text    (suggestion card) ────┤
                          └─ voice   (TTS via Realtime) ───┘
```

Two reasons not to replace Azure with Realtime ASR: (1) Stage 1's whole Live Brief loop is keyed off Azure final segments and the buffer's silence/length heuristics; (2) Realtime's transcription model is fine but switching breaks the current orchestrator contract. We can revisit later.

## Modules (new code)

All new server logic goes in `src/lib/agent/*.functions.ts` (client-safe path). Client state lives in `src/lib/agent/` plain modules consumed by the workbench route.

### 1. `agent/realtime.functions.ts` — token endpoint
- `getRealtimeSession()` server fn (auth-required). Mints an OpenAI Realtime ephemeral client_secret by POSTing to `https://api.openai.com/v1/realtime/client_secrets` with `OPENAI_API_KEY`. Returns `{ client_secret, model, expires_at }`.
- Requires new secret `OPENAI_API_KEY` (separate from Lovable AI Gateway — Realtime is not on the gateway).

### 2. `agent/realtimeClient.ts` — browser
Thin wrapper around WebRTC connection:
- `connect(token)` — creates RTCPeerConnection, attaches mic track (cloned from existing `getUserMedia` stream so Azure keeps its own track), opens data channel, SDP exchange against `https://api.openai.com/v1/realtime?model=gpt-realtime`.
- `speak(text)` — sends `response.create` with `instructions: text`, `modalities: ["audio","text"]`, server-side VAD enabled so user interrupting auto-cancels (`turn_detection.interrupt_response = true`).
- `cancel()` — `response.cancel` for hard barge-in.
- `setSilent(true)` — sets `turn_detection: null` so Realtime never auto-replies on its own; we are the only trigger.
- Exposes events: `onAgentSpeakingStart/End`, `onUserBargeIn`.

Critical: configure `session.update` once on connect with `instructions: "You are silent unless explicitly asked to speak. Never start a turn on your own."` and `turn_detection.create_response: false` so Realtime's own VAD only signals barge-in, never auto-responds.

### 3. `agent/thinkingState.functions.ts` — state detector
`detectThinkingState({ latestSegment, recentSegments, brief, secondsSinceLastSpeech })` server fn:
- Calls Lovable AI Gateway (`google/gemini-3-flash-preview`, fast + cheap) with structured `Output.object` schema returning one of the 6 states + `confidence` + `evidence` (1 short sentence).
- Prompt grounds the model in the 6 enums and forbids inventing new ones.
- Returns `{ state, confidence, evidence }`.

### 4. `agent/interventionPolicy.ts` — pure client function
No LLM. Deterministic rules:
- Tracks `lastInterventionAt`, `lastInterventionLevel`, recent feedback signals in a ref.
- `decide(state, confidence)` returns `silent | text | voice`:
  - `thinking_continuing`, `pause_but_not_done` → silent.
  - `explicit_request` → voice (always allowed, ignore cooldown).
  - `stuck` (conf ≥ 0.7) → voice if ≥ 45s since last voice, else text.
  - `contradiction_detected`, `missing_structure` (conf ≥ 0.7) → text by default; promote to voice if ≥ 90s since last voice AND user has not dismissed last 2 text suggestions.
  - Recent negative feedback ("not what I mean", dismissed) doubles the cooldown.

### 5. `agent/responseGenerator.functions.ts`
`generateIntervention({ state, evidence, brief, recentSegments })` server fn:
- Calls Lovable AI Gateway with strict system prompt enforcing: 1–2 sentences max, grounded in current Live Brief, one question OR one structural reframing, never a full answer.
- Returns `{ text, briefHints?: BriefPatch[] }` (hints optional — surfaced as ghost suggestions, not auto-applied).

### 6. `agent/feedbackTracker.ts` — client
In-memory + persisted via new server fn `recordFeedback({ sessionId, suggestionId, action })` writing to a new `agent_interventions` table (see DB). Tracked actions: `accepted | ignored | dismissed | edited_after | corrected | requested_more`.

### 7. UI surface (in `workbench.tsx` or new sibling component)
- **Agent status pill** in the existing header: dot (idle/listening/thinking/speaking) + connect/disconnect toggle.
- **Suggestion card**: small floating panel above the brief when policy = `text`. Buttons: ✓ apply hint, ✕ dismiss, 🔊 "ask me out loud". Auto-dismiss after 20s = `ignored`.
- **Speaking indicator**: subtle wave animation when agent talks. Tapping anywhere or starting to speak cancels.

## Wire-up in `workbench.tsx`

Per committed segment in the existing `onSegment` callback:
1. (existing) `orchestrateSegment(...)` → patches Live Brief.
2. (new) After patches apply, call `detectThinkingState(...)` in parallel with persistence.
3. Feed result into client `interventionPolicy.decide(...)`.
4. If `text` → show suggestion card, call `generateIntervention` for the copy.
5. If `voice` → call `generateIntervention`, then `realtime.speak(text)`. Log to `agent_interventions`.
6. Always log the decision (including `silent`) for later evaluation.

## Database (one new migration)

```sql
create table public.agent_interventions (
  id uuid primary key default gen_random_uuid(),
  session_id uuid not null references public.sessions(id) on delete cascade,
  segment_id uuid,
  detected_state text not null,
  state_confidence numeric,
  decision text not null,             -- silent | text | voice
  response_text text,
  feedback text,                      -- accepted | ignored | dismissed | edited_after | corrected | requested_more
  created_at timestamptz not null default now()
);
grant select, insert, update on public.agent_interventions to authenticated;
grant all on public.agent_interventions to service_role;
alter table public.agent_interventions enable row level security;
create policy "owner reads" on public.agent_interventions for select to authenticated
  using (public.owns_session(session_id));
create policy "owner writes" on public.agent_interventions for insert to authenticated
  with check (public.owns_session(session_id));
create policy "owner updates" on public.agent_interventions for update to authenticated
  using (public.owns_session(session_id));
```

## Secrets / connectors

- New secret: `OPENAI_API_KEY` (asked from user — Realtime is not behind Lovable AI Gateway and not on a standard connector).
- Existing `LOVABLE_API_KEY` continues powering state detection + response generation (free / on-gateway).
- Azure secrets untouched.

## Out of scope (explicitly deferred)

Mobile, multi-user, long-term memory, web research, tool use, PRD/deck generation, full canvas drag-drop, personalization, multi-vertical templates.

## Open question before build

OpenAI Realtime billing is per-minute audio in+out and is **not** free under your Lovable AI credits — you need an OpenAI account with billing enabled and an API key. Confirm you want to proceed on that basis (vs. fallback options like ElevenLabs Conversational Agent, which has a standard Lovable connector but is more expensive per minute and replaces the whole STT pipeline).

