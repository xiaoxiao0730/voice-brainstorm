// Per-session typed event bus. In-memory, browser-side. Subscribers filter
// by event.sessionId; sessionStore owns one bus per session so stale work
// from another session can never leak into the active UI.

import type { SessionEvent, SessionEventType } from "@/lib/pipeline/types";

type AnyHandler = (e: SessionEvent) => void;
type TypedHandler<T extends SessionEventType> = (e: Extract<SessionEvent, { type: T }>) => void;

export type SessionEventBus = {
  emit: (event: SessionEvent) => void;
  on: <T extends SessionEventType>(type: T, handler: TypedHandler<T>) => () => void;
  onAny: (handler: AnyHandler) => () => void;
  dispose: () => void;
};

export function createSessionEventBus(): SessionEventBus {
  const typed = new Map<SessionEventType, Set<AnyHandler>>();
  const any = new Set<AnyHandler>();
  let disposed = false;

  return {
    emit(event) {
      if (disposed) return;
      const subs = typed.get(event.type);
      if (subs) for (const h of subs) { try { h(event); } catch (err) { console.error("[sessionEvents]", err); } }
      for (const h of any) { try { h(event); } catch (err) { console.error("[sessionEvents]", err); } }
    },
    on(type, handler) {
      const h = handler as AnyHandler;
      let set = typed.get(type);
      if (!set) { set = new Set(); typed.set(type, set); }
      set.add(h);
      return () => { set!.delete(h); };
    },
    onAny(handler) {
      any.add(handler);
      return () => { any.delete(handler); };
    },
    dispose() {
      disposed = true;
      typed.clear();
      any.clear();
    },
  };
}
