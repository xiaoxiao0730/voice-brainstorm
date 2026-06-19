// Cross-lane signal bus (in-memory, per-tab).
//
// Captures user actions on the Live Brief (accept / reject / edit) and
// background events (pending_appear) so the next deep-model call gets a
// high-weight signal stream, and the Realtime voice agent can be whispered
// a debounced summary via injectContext.

export type CanvasSignal = {
  type: "accept" | "reject" | "edit" | "pending_appear";
  slotId: string;
  heading: string;
  body?: string;
  ts: number;
};

type Listener = (signal: CanvasSignal) => void;

const RING_SIZE = 12;
const signals: CanvasSignal[] = [];
const listeners = new Set<Listener>();

export function publish(signal: Omit<CanvasSignal, "ts">) {
  const s: CanvasSignal = { ...signal, ts: Date.now() };
  signals.push(s);
  while (signals.length > RING_SIZE) signals.shift();
  for (const l of listeners) {
    try { l(s); } catch { /* ignore */ }
  }
}

export function snapshot(): CanvasSignal[] {
  return signals.slice();
}

export function clear() {
  signals.length = 0;
}

export function subscribe(l: Listener) {
  listeners.add(l);
  return () => { listeners.delete(l); };
}

/** Compact summary suitable for Realtime injectContext. */
export function summarizeForInject(s: CanvasSignal): string {
  const verb =
    s.type === "accept" ? "user accepted"
    : s.type === "reject" ? "user rejected"
    : s.type === "edit" ? "user edited"
    : "pending proposal in";
  return `${verb} ${s.slotId}: ${s.heading || s.body || ""}`.trim();
}
