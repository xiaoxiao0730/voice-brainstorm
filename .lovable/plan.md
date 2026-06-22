# Plan: Live Brief → Single Continuous Document

Refactor Live Brief from a multi-block, slot-grouped canvas into a single continuous contentEditable document with optional template starters. Preserve all Workbench layout, design tokens, audio/realtime/background logic.

## 1. Data model

Introduce a single per-session document instead of N blocks. Use a JSON document model that maps cleanly to plain text + heading markers.

```ts
// src/lib/pipeline/types.ts (additions)
export type BriefDocLine =
  | { id: string; kind: "h2"; text: string; lastEditedBy: "user" | "ai"; locked?: boolean }
  | { id: string; kind: "p";  text: string; lastEditedBy: "user" | "ai"; locked?: boolean };

export type BriefDocV2 = {
  sessionId: string;
  lines: BriefDocLine[];        // ordered; rendered as one stream
  updatedAt: number;
};
```

Why "lines" instead of full HTML: avoids storing unsanitised HTML, keeps diffs simple, lets the Background Canvas append plain lines, and serialises trivially.

### Storage

Reuse the existing `brief_nodes` table — no migration needed.
- Each `BriefDocLine` is stored as one `brief_nodes` row.
- `level = "h2"` for headings, `"bullet"` for paragraphs (`kind: "p"`).
- `orderKey` defines stream order across the whole document (slot grouping ignored).
- `slot_id` retained only as legacy metadata; never drives UI.
- `is_pending` / `rationale` retained for AI-pending lines.

Loader: read all `brief_nodes` for the session, sort by `orderKey`, map each row → `BriefDocLine`. Heading rows become `h2`, body rows become `p`. Old rows that had both `heading` + `body` are split into two lines (heading first, then body) on first load and re-persisted with new orderKeys; this preserves all existing content.

## 2. Editor component (`BriefDocument.tsx`)

Single `contentEditable` root holding the whole document.

- Render each line as a `<h2>` or `<p>` with `data-line-id`.
- React renders the initial HTML once per session load (keyed on `sessionId`); after mount, React does NOT re-render the contentEditable subtree from state. Local state and DOM diverge intentionally — React owns mount, the DOM owns edits.
- Background Canvas writes happen via imperative DOM ops (`document.querySelector('[data-line-id="…"]')` insert) wrapped in a helper that preserves the current Selection (save anchor/focus offset before insert, restore after).
- Composition events: track `isComposing` ref; suppress save/diff while true.
- Save pipeline (debounced 500 ms, also on blur, on session switch, on `beforeunload`):
  1. Walk the contentEditable DOM, read each top-level `<h2>`/`<p>` → array of lines (preserve `data-line-id` where present; mint UUIDs for new nodes).
  2. Diff against last persisted snapshot → emit `upsert` / `delete` calls to existing `brief.functions.ts`.
- Selection: native browser selection across the whole element; Ctrl+A and Delete work because there is only one contentEditable.
- Placeholder: render an absolutely-positioned overlay div with `pointer-events-none` showing "A canvas for thinking aloud." + "Start speaking or type anywhere. You can choose a template listed above." Visible only when the editor contains zero non-whitespace text. Driven by a single `isEmpty` state recomputed from DOM on input. Never written to DB.
- Pending AI lines: render with a subtle left border + lighter text + small inline `Accept` / `Reject` affordances at the end of the line. No card, no dashed box.
- Edit a pending line: any keystroke flips it to user-owned + accepted.

## 3. Template behaviour

`thinkingTemplate.ts`:
- Add `NONE_TEMPLATE_ID = "none"`; `DEFAULT_TEMPLATE_ID = "none"`.
- Add `headings: string[]` field for insertion. Slots kept as optional AI hint metadata.
- Product Thinking Artifact headings: Current Question, User Journey, Hypothesis, Info & Observation, Solution, Open Questions, Next Actions.

Workbench:
- Rename pinned UI label to "Template", as a dropdown: No template / Product Thinking Artifact / (disabled: Research, Decision).
- Default per new session: `none`. Persisted per session in localStorage as today.
- Selecting a template:
  1. Confirm it's not the currently-applied template (track `appliedTemplateId` separately from `templateId`, both in state + persisted).
  2. Append each heading as a new `h2` line to the end of the document (mint UUIDs, allocate orderKeys via `between(last, null)`), persist.
  3. Update `appliedTemplateId`.
- Re-selecting same template: no-op (dedupe guard).
- Switching to a different template or back to "No template": only updates AI hint; previously inserted headings stay as normal editable lines.

## 4. Background Canvas adaptation

`responseGenerator.functions.ts`:
- Input shape becomes `{ latestText, recentTexts, documentSnapshot: BriefDocLine[], templateHint?: { name, headings, slotHints } | null, userSignals, model }`.
- Output shape becomes `{ emit: false, insight? } | { emit: true, lines: Array<{ kind: "h2" | "p"; text: string; rationale: string; anchor?: { afterLineId?: string } }>, insight? }`.
- Prompt: with template hint, prefer placing under matching heading; without, append freely; never invent "Unsorted" sections.

Workbench `runBackgroundCanvas`:
- Pass current document snapshot + optional template hint.
- For each returned line, insert as `isPending` line either after `anchor.afterLineId` or at end. Insertion uses the DOM-preserving helper from §2 so user's caret isn't disturbed; if `focusedBlockRef` (renamed: `isEditingRef`) is true, queue and retry on blur.
- Pending lines reuse the existing `acceptPendingBlock` server fn (still keyed by node id).

## 5. Cleanup

- Delete slot-grouping render path in `BriefDocument.tsx`, "Loose threads", "Unsorted", per-block `BlockRow` with its dual contentEditables.
- Remove `BriefCanvas.tsx` if unused after refactor (check imports first).
- Keep `interventionPolicy`, `segmentGate`, `signalBus`, `realtimeClient`, speech pipeline untouched.
- Keep `brief.functions.ts` signatures; only adjust where field meaning changes (heading vs body).

## 6. Styles (`src/styles.css`)

Add a minimal scoped block (single class root, e.g. `.brief-doc`):
- Max width 760 px, mx-auto.
- `h2`: 22 px, font-medium, mt-8 mb-2, color text-primary, Inter.
- `p`: 17 px, line-height 1.65, my-3.
- `::selection`: low-contrast neutral.
- No focus outline on the root; rely on caret only.
- Pending line: `border-l-2 border-emerald-400/60 pl-3 text-primary/85`.

No design-token changes. No new colors. Inter remains body font; existing Instrument Serif usage elsewhere untouched.

## 7. Caret/state safety summary

- React renders editor HTML once per `sessionId` mount; never re-renders from `doc` state during editing.
- All AI insertions go through one helper that:
  1. Saves `selection.anchorNode/offset` (if inside editor).
  2. Inserts new DOM node at target position.
  3. Restores selection (clamped if anchor node was replaced).
- Composition tracked via `compositionstart` / `compositionend` refs; saves suppressed while composing.
- Debounced save reads DOM, not state, so user keystrokes are the source of truth.

## 8. Files touched

- `src/lib/pipeline/types.ts` — add `BriefDocLine`, helpers `nodeToLine` / `lineToNodeUpsert`, keep legacy exports for compat.
- `src/lib/pipeline/thinkingTemplate.ts` — add `none` template, add `headings` field.
- `src/components/brief/BriefDocument.tsx` — rewrite as single contentEditable.
- `src/components/brief/BriefCanvas.tsx` — delete if no remaining import.
- `src/routes/_authenticated/workbench.tsx` — template default = none, template apply logic, doc loader splits legacy rows, Background Canvas wiring, isEditing ref instead of focusedBlock.
- `src/lib/agent/responseGenerator.functions.ts` — new I/O shape (lines instead of single slot patch).
- `src/lib/brief.functions.ts` — no signature change expected; verify pending accept still works on a row whose "heading" is empty.
- `src/styles.css` — add `.brief-doc` typography block.

## 9. Out of scope

- No DB migration. No changes to speech, Realtime token, Azure pipeline, sidebar, transcript, audio meter, agent panel chrome.
- No new template content beyond Product Thinking Artifact headings.
- No rich-text formatting (bold/italic/links) — plain headings + paragraphs only.

## 10. Acceptance check map

All 19 acceptance criteria covered: default None (§3), placeholder behaviour (§2), Ctrl+A / Delete (§2 single root), template append + persistence (§3), no slot UI (§5), background canvas free-form (§4), IME safety (§2/§7), session reload + legacy data (§1 loader), typecheck (no `any` in new code, lines reuse existing row types).

## 11. Open question before implementation

The legacy split (one DB row → two lines on first load) does a one-time write per old session. Confirm this is acceptable, or I can keep legacy rows as a single combined `p` line containing "Heading\n\nBody" instead.
