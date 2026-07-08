# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What this is

**Murmur** is a voice-driven AI co-thinking workbench. The user speaks; the app
transcribes (Azure STT), restructures the messy speech into a live "Brief"
document, generates a mind-map ("Idea Canvas"), and runs a low-interruption
Realtime voice agent that comments only when it has something worth saying. The
single screen lives at [workbench.tsx](src/routes/_authenticated/workbench.tsx)
— it is the orchestration hub that wires every lane together.

Stack: TanStack Start (SSR + server functions) · React 19 · Vite 7 · Tailwind v4
· shadcn/ui (new-york) · Supabase (Postgres + Storage + RLS) · OpenAI (chat +
Realtime) · Azure Speech · `ai` SDK (Vercel AI SDK v6). Package manager is
**pnpm** (see `bunfig.toml` — Bun is only used for its install supply-chain
guard config; run scripts with pnpm).

## Commands

```bash
pnpm install
pnpm run dev          # vite dev server (SSR)
pnpm run build        # production build
pnpm run build:dev    # build in development mode
pnpm run preview      # preview a production build
pnpm run lint         # eslint
pnpm run format       # prettier --write .
```

There is **no test suite and no typecheck script**. To check types run
`pnpm exec tsc --noEmit`. Lint a single file with `pnpm exec eslint <path>`.

Supabase migrations (see [LOCAL_SETUP.md](LOCAL_SETUP.md)):

```bash
npx supabase login
npx supabase link --project-ref YOUR_PROJECT_REF
npx supabase db push
```

## Environment & auth modes

Copy `.env.local.example` → `.env.local`. This branch defaults to
**local no-auth mode** (`VITE_ENABLE_AUTH=false`): server functions run as a
fixed `LOCAL_USER_ID` using the Supabase **secret/service-role** key, bypassing
RLS. The migration `20260625090000_local_no_auth_sessions.sql` drops the
`sessions.user_id → auth.users` FK so the fake user can create sessions.

Auth is enforced in [auth-middleware.ts](src/integrations/supabase/auth-middleware.ts)
via the `requireSupabaseAuth` function-middleware, which every data server fn
calls. When `VITE_ENABLE_AUTH=true` it validates a Bearer token and scopes the
client to the real user (RLS via `auth.uid()`).

**Secrets must never get a `VITE_` prefix** (`SUPABASE_SECRET_KEY`,
`OPENAI_API_KEY`, `AZURE_SPEECH_KEY`). `VITE_*` values ship to the browser.

## Critical conventions

- **Server-only code lives in `*.server.ts` or `*.functions.ts`.** The
  `server-only` npm package is banned (eslint `no-restricted-imports`) — TanStack
  Start does not use it. Note: `*.functions.ts` files are bundled into the
  **client** too, so a top-level import of `client.server.ts` from a
  `.functions.ts` file leaks the service key. Import the admin client lazily
  inside the handler: `const { supabaseAdmin } = await import("@/integrations/supabase/client.server")`.
  Most server fns instead get a scoped client from `requireSupabaseAuth` via
  `context.supabase`.
- **Read env inside handlers, never at module scope.** On Cloudflare Workers env
  binds per-request; module-scope `process.env.X` is `undefined`. See the comment
  block in [config.server.ts](src/lib/config.server.ts).
- **Routing is file-based (TanStack Start).** Every `.tsx` under `src/routes/` is
  a route; `__root.tsx` is the only shell. Do NOT add `src/pages/` or Next/Remix
  conventions. `routeTree.gen.ts` is generated — never edit by hand. See
  [routes/README.md](src/routes/README.md) for the dynamic/splat/optional syntax.
- **`32-bit int` columns for timestamps.** `transcript_chunks.start_ms/end_ms`
  are `INTEGER`; raw `Date.now()` overflows. Code stores offsets relative to a
  connect time (see the agent-transcript handler in workbench).
- Path alias `@/*` → `src/*`. Prettier: 100 cols, double quotes, semicolons,
  trailing commas.
- `bunfig.toml` enforces a 24h supply-chain delay on new deps; adding to
  `minimumReleaseAgeExcludes` requires confirming with the user.

## Architecture: the three data pathways

The core design (and its rationale) is documented in
[.lovable/plan.md](.lovable/plan.md) — **read it before touching the pipeline.**
The product goal is "real-time co-thinking workbench," and the architecture is
built around decoupling document updates from voice turns. Everything is keyed by
`sessionId` and flows through a **per-session in-memory event bus**.

```
[mic] → Azure STT (azureRecognizer.ts, browser)
          │ final chunks
          ▼
   TranscriptBuffer (pipeline/transcriptBuffer.ts)  → emits TranscriptSegment (~3-8s)
          │
   workbench onSegment(segment) splits into parallel lanes:
          │
   ├─ FAST LANE: bulletLane.functions.ts (cheap LLM) → 0-1 short bullet
   │     → bus "brief.proposed" (source: bullet) → applied to doc immediately
   │
   ├─ SLOW LANE: ThoughtTurnBuffer (pipeline/thoughtTurnBuffer.ts)
   │     aggregates segments until semantic pause (2.5s) / hard limit (120s) /
   │     voice response / manual stop → emits bus "thought_turn.finalized"
   │        ├→ coordinator.ts → decideBrief.functions.ts → "brief.proposed" (+ maybe "research.requested")
   │        ├→ insightCoordinator.ts → insightAgent.functions.ts → "insight.created" (high-pri → also a bullet)
   │        └→ workbench → thinkingState + coThinkingTurn → Idea Canvas + voice context
   │
   └─ BACKGROUND CANVAS LANE: responseGenerator.functions.ts (density-gated,
         policy-throttled) → one pending line for the brief
```

### Event bus is the spine

[pipeline/types.ts](src/lib/pipeline/types.ts) defines the `SessionEvent` union
(`thought_turn.finalized`, `brief.proposed`, `research.requested/completed`,
`insight.created`, `voice.*`, …). [orchestrator/sessionStore.ts](src/lib/orchestrator/sessionStore.ts)
is a **browser-side singleton** that owns one bus + `ThoughtTurnBuffer` +
research registry per session. The workbench subscribes to the active session's
bus; coordinators are attached/detached as the active session changes.

### Two coordinators (browser-side, attached in workbench)

- **coordinator.ts** (slow brief lane): on `thought_turn.finalized`, calls
  `decideBrief` (LLM restructures the turn into patches — it does NOT transcribe),
  emits `brief.proposed`. Serialized through a per-session brief mutex.
- **insightCoordinator.ts**: on `thought_turn.finalized` and `research.completed`,
  calls `insightAgent` → `insight.created` packets (observation / contradiction /
  suggestion / question / conclusion). High-priority packets also feed the brief.

### Document model

The Brief is a **flat ordered list of blocks** (`BriefBlock`, fractional
`orderKey` via [pipeline/orderKey.ts](src/lib/pipeline/orderKey.ts)). Patches
(`append_block` / `update_block` / `append_to_block`) are applied by the pure
reducer [applyBriefPatch.ts](src/lib/pipeline/applyBriefPatch.ts). DB rows
(`brief_nodes`) use a legacy `BriefNode` shape; `nodeToBlock` / `blockToNodeUpsert`
in `types.ts` map between them. **Locked blocks (user-edited) are sacrosanct — AI
patches must never overwrite them.** Pending AI blocks are grouped by
`operationId` for one Keep/Undo action.

### Voice (Realtime) lane

[agent/realtimeClient.ts](src/lib/agent/realtimeClient.ts) is a browser WebRTC
wrapper around the OpenAI Realtime API; [agent/realtime.functions.ts](src/lib/agent/realtime.functions.ts)
mints the short-lived client secret. The agent shares context with the document
via two channels: `updateCanvasSnapshot(text)` pushes the current brief into its
instructions, and `injectContext(note)` whispers debounced user-action signals
(from [agent/signalBus.ts](src/lib/agent/signalBus.ts)) and thinking-state. The
intention (per plan.md) is **low-interruption**: VAD detects speech but the
intervention policy ([agent/interventionPolicy.ts](src/lib/agent/interventionPolicy.ts),
adaptive throttle) decides when to actually speak.

### Shared thinking state

[agent/thinkingState.functions.ts](src/lib/agent/thinkingState.functions.ts)
maintains a per-session `SessionThinkingState` (goal / intent / assumptions /
open questions / directions / decisions) in the `session_thinking_state` table.
It is updated each finalized turn and injected into the voice agent so the brief
and the voice lane stay grounded in the same understanding.

### Research lane

`research.requested` (from `decideBrief` or the agent's `request_research` tool)
enters the browser-side [research/researchQueue.ts](src/lib/research/researchQueue.ts)
(max 2 concurrent) → `webSearch.functions.ts` + `researchSynthesizer.functions.ts`
→ `research.completed`, whose result is appended to the brief as a "Research:" section.

### Observability

[debug/pipelineTracer.ts](src/lib/debug/pipelineTracer.ts) is an in-memory ring
buffer auto-wired to the bus; [debug/PipelineInspector.tsx](src/components/debug/PipelineInspector.tsx)
renders it (mount via `?debug=1` or in dev). When changing pipeline timing/lanes,
**verify behavior through tracer spans, not by feel** (the plan.md workflow).

## Database

Tables (all RLS-scoped via the `owns_session()` security-definer in local-auth
mode, bypassed by service role): `sessions`, `transcript_chunks`,
`transcript_segments`, `brief_nodes`, `brief_operations` (audit log),
`session_thinking_state`, `idea_canvas_nodes`, `idea_canvas_edges`. Generated
types live in [supabase/types.ts](src/integrations/supabase/types.ts). Migrations
are timestamp-prefixed in `supabase/migrations/`.

## AI model routing

`createServerFn` handlers select models through allow-lists. Browser passes ids
like `openai/gpt-4o-mini`; [ai-gateway.server.ts](src/lib/ai-gateway.server.ts)
`normalizeAiModel` maps `openai/fast`→`AI_MODEL_FAST`, `openai/deep`→`AI_MODEL_DEEP`,
and Gemini aliases onto those. **GPT-5 family only supports the default
temperature** — handlers must omit `temperature` for `openai/gpt-5*`. LLM JSON
responses are parsed with a tolerant extractor (strips fences, slices first/last
brace) — see `extractJSON` in [orchestrate.functions.ts](src/lib/orchestrate.functions.ts).
