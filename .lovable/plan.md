## Plan

### 1. Tap-T hotkey (toggle voice)
In `src/routes/_authenticated/workbench.tsx`, add a global `keydown` listener:
- When user presses `T` (no modifiers), toggle the mic: if not listening → `startListening()`, if listening → `stopListening()`.
- Ignore when focus is in `<input>`, `<textarea>`, `[contenteditable]`, or when modifier keys (Ctrl/Cmd/Alt/Meta) are held.
- Ignore auto-repeat (`e.repeat`).
- Show a small hint near the mic button: "Press T to talk".

### 2. AI model selector
Add a dropdown in the workbench header (next to Export) with 4 Lovable AI Gateway models:
- **Gemini 3 Flash** (`google/gemini-3-flash-preview`) — default, fast
- **Gemini 2.5 Pro** (`google/gemini-2.5-pro`) — deeper reasoning
- **GPT-5** (`openai/gpt-5`) — OpenAI all-rounder
- **GPT-5 Mini** (`openai/gpt-5-mini`) — cheaper OpenAI

Note on GPT-4o: the Lovable AI Gateway doesn't expose `gpt-4o`. GPT-5 / GPT-5 Mini are the current OpenAI options. If you specifically need `gpt-4o` later, we'd add a custom OpenAI API key.

### 3. Wiring
- `src/lib/orchestrate.functions.ts`: extend `InputSchema` with `model: z.string().optional()`, validate against the allow-list, default to `google/gemini-3-flash-preview`, pass to `gateway(model)`.
- `src/routes/_authenticated/workbench.tsx`: store selected model in local state, pass it in the `orchestrate({ data: { ..., model } })` call.

### Cost note (for your earlier question)
The **Lovable AI Gateway** is Lovable's hosted AI service — your app calls models like Gemini/GPT through Lovable's infrastructure, no separate API key needed. **It is usage-based**: each call draws from your workspace's free monthly AI balance ($1/mo free until early 2026). If you exceed it, you top up in Settings → Cloud & AI balance. Cheaper models (Gemini Flash) cost less per call than premium ones (GPT-5, Gemini 2.5 Pro), so the selector also gives you cost control.

### Files touched
- `src/routes/_authenticated/workbench.tsx`
- `src/lib/orchestrate.functions.ts`
