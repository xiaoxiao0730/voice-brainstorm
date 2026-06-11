// Shared types for the Live Brief pipeline.

export type TranscriptChunk = {
  id: string;
  sessionId: string;
  text: string;
  isFinal: boolean;
  startMs: number;
  endMs: number;
  lang?: string;
};

export type BoundaryReason = "word_count" | "char_count" | "time" | "silence" | "manual_stop";

export type TranscriptSegment = {
  segmentId: string;
  sessionId: string;
  chunkIds: string[];
  rawText: string;
  startTimeMs: number;
  endTimeMs: number;
  boundaryReason: BoundaryReason;
};

export type BriefLevel = "h1" | "h2" | "bullet";
export type BriefStatus = "ai_draft" | "user_confirmed";
export type BriefEditor = "ai" | "user";
export type BriefTag = "insight" | "question" | "action" | "idea";

export type BriefNode = {
  id: string;
  sessionId: string;
  parentId: string | null;
  orderKey: string;
  level: BriefLevel;
  text: string;
  status: BriefStatus;
  lastEditedBy: BriefEditor;
  sourceChunkIds: string[];
  confidence: number | null;
  tag: string | null;
};

// AI-emitted operations. tempId fields are client-resolved at apply time.
export type BriefOperation =
  | {
      op: "add_node";
      tempId: string;
      parentId: string | null;
      afterId: string | null;
      level: BriefLevel;
      text: string;
      sourceChunkIds: string[];
      confidence?: number;
      tag?: string;
    }
  | {
      op: "update_node";
      nodeId: string;
      text: string;
      sourceChunkIds?: string[];
      confidence?: number;
    }
  | {
      op: "delete_node";
      nodeId: string;
      reason?: string;
    }
  | {
      op: "move_node";
      nodeId: string;
      newParentId: string | null;
      afterId: string | null;
    }
  | {
      op: "annotate";
      nodeId: string;
      tag: string;
    };

export type ApplyResult =
  | { ok: true; node?: BriefNode }
  | { ok: false; reason: string };
