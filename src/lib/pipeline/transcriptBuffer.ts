import type { BoundaryReason, TranscriptChunk, TranscriptSegment } from "./types";

// Only flush when the user has stopped speaking for a real pause, or hits a
// hard ceiling. The LLM is called per flush, so smaller numbers = more calls.
const EN_WORD_LIMIT = 150;
const CN_CHAR_LIMIT = 240;
const TIME_LIMIT_MS = 30_000;
const SILENCE_MS = 700;

function isCjk(text: string): boolean {
  // Quick heuristic: >30% CJK chars means treat as CJK.
  let cjk = 0;
  for (const ch of text) {
    const c = ch.codePointAt(0)!;
    if (
      (c >= 0x4e00 && c <= 0x9fff) ||
      (c >= 0x3400 && c <= 0x4dbf) ||
      (c >= 0x3040 && c <= 0x30ff) ||
      (c >= 0xac00 && c <= 0xd7af)
    ) {
      cjk++;
    }
  }
  return cjk / Math.max(1, text.length) > 0.3;
}

function countWords(text: string): number {
  return text.trim().split(/\s+/).filter(Boolean).length;
}

export type TranscriptBufferOptions = {
  sessionId: string;
  onSegment: (segment: TranscriptSegment) => void;
  newId?: () => string;
};

export function createTranscriptBuffer(opts: TranscriptBufferOptions) {
  const { sessionId, onSegment } = opts;
  const newId = opts.newId ?? (() => crypto.randomUUID());

  let pending: TranscriptChunk[] = [];
  let firstFinalAt: number | null = null;
  let lastFinalAt: number | null = null;
  let silenceTimer: ReturnType<typeof setTimeout> | null = null;
  let lastFlushedText = "";

  const flush = (reason: BoundaryReason) => {
    if (silenceTimer) {
      clearTimeout(silenceTimer);
      silenceTimer = null;
    }
    if (pending.length === 0) return;
    const rawText = pending.map((c) => c.text.trim()).filter(Boolean).join(" ").trim();
    if (!rawText || rawText === lastFlushedText) {
      pending = [];
      firstFinalAt = null;
      lastFinalAt = null;
      return;
    }
    const segment: TranscriptSegment = {
      segmentId: newId(),
      sessionId,
      chunkIds: pending.map((c) => c.id),
      rawText,
      startTimeMs: pending[0].startMs,
      endTimeMs: pending[pending.length - 1].endMs,
      boundaryReason: reason,
    };
    lastFlushedText = rawText;
    pending = [];
    firstFinalAt = null;
    lastFinalAt = null;
    onSegment(segment);
  };

  const scheduleSilenceFlush = () => {
    if (silenceTimer) clearTimeout(silenceTimer);
    silenceTimer = setTimeout(() => flush("silence"), SILENCE_MS);
  };

  const shouldFlush = (): BoundaryReason | null => {
    const text = pending.map((c) => c.text).join(" ");
    if (!text.trim()) return null;
    if (isCjk(text)) {
      if (text.replace(/\s+/g, "").length >= CN_CHAR_LIMIT) return "char_count";
    } else if (countWords(text) >= EN_WORD_LIMIT) {
      return "word_count";
    }
    if (firstFinalAt != null && Date.now() - firstFinalAt >= TIME_LIMIT_MS) return "time";
    return null;
  };

  return {
    pushFinal(chunk: Omit<TranscriptChunk, "isFinal" | "sessionId"> & { isFinal?: true }) {
      const ch: TranscriptChunk = {
        id: chunk.id,
        sessionId,
        text: chunk.text,
        isFinal: true,
        startMs: chunk.startMs,
        endMs: chunk.endMs,
        lang: chunk.lang,
      };
      // Dedupe: skip if identical trailing of previous.
      if (pending.length) {
        const prev = pending[pending.length - 1];
        if (prev.text.trim() === ch.text.trim()) return;
      }
      pending.push(ch);
      if (firstFinalAt == null) firstFinalAt = Date.now();
      lastFinalAt = Date.now();
      const reason = shouldFlush();
      if (reason) flush(reason);
      else scheduleSilenceFlush();
    },
    forceFlush(reason: BoundaryReason = "manual_stop") {
      flush(reason);
    },
    dispose() {
      if (silenceTimer) clearTimeout(silenceTimer);
      pending = [];
    },
  };
}
