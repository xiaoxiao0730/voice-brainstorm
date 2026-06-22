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

// ===== Document model (Notion-style) =====

export type BriefBlockLevel = 1 | 2 | 3; // 1=h1, 2=h2, 3=body/bullet block

export type BriefBlock = {
  id: string;
  sessionId: string;
  orderKey: string;
  heading: string;          // "" for unlabeled blocks
  level: BriefBlockLevel;   // 1/2 = heading level, 3 = body block
  body: string;             // markdown text (use "- " prefix for bullets)
  lastEditedBy: "ai" | "user";
  locked: boolean;          // true once user has touched it
  sourceChunkIds: string[];
  // Stage 3: schema-driven canvas
  slotId?: string;          // template slot binding
  isPending?: boolean;      // true → pending_approval (sandbox staging)
  rationale?: string;       // short LLM justification shown on pending cards
  // Stage 4: dual-speed coordinator
  operationId?: string;     // groups co-proposed pending blocks under one Keep/Undo
  researchResultId?: string;// link to ResearchResult that produced this block
};

// ===== Stage 4: ThoughtTurn (long-form speech aggregation) =====

export type ThoughtTurnBoundaryReason = "semantic_pause" | "hard_limit" | "manual_stop";

export type ThoughtTurn = {
  id: string;
  sessionId: string;
  segmentIds: string[];     // Azure TranscriptSegment ids
  chunkIds: string[];       // source chunk ids (flattened) for brief provenance
  combinedText: string;     // cleanly concatenated segment text
  startedAt: number;
  endedAt: number;
  boundaryReason: ThoughtTurnBoundaryReason;
  revision: number;         // incremented at checkpoints
};

// ===== Stage 4: Research =====

export type ResearchLink = { title: string; url: string };

export type ResearchResult = {
  id: string;
  query: string;
  title: string;
  summary: string;          // markdown, richer than voice
  findings: string[];
  links: ResearchLink[];
  voiceSummary: string;     // ≤ ~25s spoken form
};

// ===== Stage 4: Session event bus =====

export type SessionEvent =
  | { type: "thought_turn.finalized"; sessionId: string; turnId: string; thoughtTurn: ThoughtTurn }
  | { type: "voice.response_started"; sessionId: string }
  | { type: "voice.spoke"; sessionId: string; turnId?: string; text: string }
  | { type: "voice.stayed_silent"; sessionId: string; reason: string }
  | { type: "research.requested"; sessionId: string; taskId: string; query: string; operationId?: string }
  | { type: "research.completed"; sessionId: string; taskId: string; result: ResearchResult; operationId?: string }
  | { type: "research.failed"; sessionId: string; taskId: string; error: string; operationId?: string }
  | { type: "brief.proposed"; sessionId: string; operationId: string; patches: BriefPatch[] }
  | { type: "brief.kept"; sessionId: string; operationId: string }
  | { type: "brief.undone"; sessionId: string; operationId: string }
  | { type: "brief.edited"; sessionId: string; operationId: string };

export type SessionEventType = SessionEvent["type"];

export type BriefDoc = Record<string, BriefBlock>;

// ===== AI patch operations =====

export type BriefPatchAction = "append_block" | "update_block" | "append_to_block";

export type BriefPatch = {
  action: BriefPatchAction;
  blockId: string | null;   // null for append_block; required for update/append_to
  heading?: string;
  level?: BriefBlockLevel;
  bodyMarkdown?: string;
  sourceChunkIds?: string[];
};

// ===== Legacy node types (still used by DB row mapping) =====

export type BriefLevel = "h1" | "h2" | "bullet";
export type BriefStatus = "ai_draft" | "user_confirmed";
export type BriefEditor = "ai" | "user";

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
  // Stage 3 columns
  slotId?: string | null;
  isPending?: boolean;
  rationale?: string | null;
};

// ===== DB row <-> BriefBlock mapping =====

export function blockLevelToDbLevel(level: BriefBlockLevel): BriefLevel {
  if (level === 1) return "h1";
  if (level === 2) return "h2";
  return "bullet";
}

export function dbLevelToBlockLevel(level: BriefLevel): BriefBlockLevel {
  if (level === "h1") return 1;
  if (level === "h2") return 2;
  return 3;
}

export function nodeToBlock(n: BriefNode): BriefBlock {
  return {
    id: n.id,
    sessionId: n.sessionId,
    orderKey: n.orderKey,
    heading: n.tag ?? "",
    level: dbLevelToBlockLevel(n.level),
    body: n.text,
    lastEditedBy: n.lastEditedBy,
    locked: n.lastEditedBy === "user" || n.status === "user_confirmed",
    sourceChunkIds: n.sourceChunkIds,
    slotId: n.slotId ?? undefined,
    isPending: !!n.isPending,
    rationale: n.rationale ?? undefined,
  };
}

export function blockToNodeUpsert(b: BriefBlock): {
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
  slotId: string | null;
  isPending: boolean;
  rationale: string | null;
} {
  return {
    id: b.id,
    sessionId: b.sessionId,
    parentId: null,
    orderKey: b.orderKey,
    level: blockLevelToDbLevel(b.level),
    text: b.body,
    status: b.locked ? "user_confirmed" : "ai_draft",
    lastEditedBy: b.lastEditedBy,
    sourceChunkIds: b.sourceChunkIds,
    confidence: null,
    tag: b.heading ? b.heading : null,
    slotId: b.slotId ?? null,
    isPending: !!b.isPending,
    rationale: b.rationale ?? null,
  };
}

// Legacy operation type kept for back-compat with applyBriefOperation.
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
  | { op: "update_node"; nodeId: string; text: string; sourceChunkIds?: string[]; confidence?: number }
  | { op: "delete_node"; nodeId: string; reason?: string }
  | { op: "move_node"; nodeId: string; newParentId: string | null; afterId: string | null }
  | { op: "annotate"; nodeId: string; tag: string };

export type ApplyResult = { ok: true; node?: BriefNode } | { ok: false; reason: string };
