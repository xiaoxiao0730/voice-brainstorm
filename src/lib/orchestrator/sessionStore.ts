// Single source of truth for live session state (browser-side).
//
// Owns:
//  - activeSessionId
//  - per-session event bus (sessionEvents.ts)
//  - per-session briefQueue (serial mutex for canvas writes)
//  - placeholder slots for thoughtTurnBuffer + research task registry
//    (wired in later PRs)
//
// Subscribers filter by activeSessionId before mutating UI so that
// background work from a previously-active session can finish without
// flashing onto the new canvas.

import { createSessionEventBus, type SessionEventBus } from "./sessionEvents";
import { createThoughtTurnBuffer, type ThoughtTurnBuffer } from "@/lib/pipeline/thoughtTurnBuffer";

type Mutex = {
  run: <T>(fn: () => Promise<T>) => Promise<T>;
};

function createMutex(): Mutex {
  let tail: Promise<unknown> = Promise.resolve();
  return {
    run<T>(fn: () => Promise<T>): Promise<T> {
      const next = tail.then(fn, fn);
      tail = next.catch(() => undefined);
      return next;
    },
  };
}

export type ResearchTaskStatus = "queued" | "running" | "completed" | "failed";

export type SessionSlot = {
  sessionId: string;
  bus: SessionEventBus;
  briefQueue: Mutex;
  thoughtTurnBuffer: ThoughtTurnBuffer;
  researchTasks: Map<string, ResearchTaskStatus>;
};

type Listener = (activeSessionId: string | null) => void;

const sessions = new Map<string, SessionSlot>();
let activeSessionId: string | null = null;
const activeListeners = new Set<Listener>();

function ensure(sessionId: string): SessionSlot {
  let slot = sessions.get(sessionId);
  if (!slot) {
    slot = {
      sessionId,
      bus: createSessionEventBus(),
      briefQueue: createMutex(),
      researchTasks: new Map(),
    };
    sessions.set(sessionId, slot);
  }
  return slot;
}

export const sessionStore = {
  getOrCreate(sessionId: string): SessionSlot {
    return ensure(sessionId);
  },
  get(sessionId: string): SessionSlot | undefined {
    return sessions.get(sessionId);
  },
  setActive(sessionId: string | null) {
    if (activeSessionId === sessionId) return;
    activeSessionId = sessionId;
    if (sessionId) ensure(sessionId);
    for (const l of activeListeners) { try { l(sessionId); } catch (err) { console.error("[sessionStore]", err); } }
  },
  getActive(): string | null {
    return activeSessionId;
  },
  isActive(sessionId: string): boolean {
    return activeSessionId === sessionId;
  },
  onActiveChange(listener: Listener): () => void {
    activeListeners.add(listener);
    return () => { activeListeners.delete(listener); };
  },
  /**
   * Dispose a session's local state. Does NOT abort in-flight research —
   * research finishes and writes to its origin bus regardless of the
   * currently active session.
   */
  dispose(sessionId: string) {
    const slot = sessions.get(sessionId);
    if (!slot) return;
    slot.bus.dispose();
    slot.researchTasks.clear();
    sessions.delete(sessionId);
    if (activeSessionId === sessionId) {
      activeSessionId = null;
      for (const l of activeListeners) { try { l(null); } catch (err) { console.error("[sessionStore]", err); } }
    }
  },
};
