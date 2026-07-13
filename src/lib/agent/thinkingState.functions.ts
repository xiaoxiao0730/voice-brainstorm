import { createServerFn } from "@tanstack/react-start";
import { Output, generateText } from "ai";
import { z } from "zod";

import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { createOpenAIProvider, normalizeAiModel, requireOpenAIKey } from "@/lib/ai-gateway.server";
import { parseLlmJsonObject } from "@/lib/llm/json";
import {
  EMPTY_ARTIFACT_STATE,
  ArtifactStateSchema,
  formatArtifactState,
  normalizeArtifactState,
} from "@/lib/agent/artifactState";

export const NodeTypeSchema = z.enum(["fact", "thought", "question", "decision"]);
export const EdgeRelationSchema = z.enum(["includes", "contradicts", "leads_to"]);
export const InteractionStageSchema = z.enum(["explore", "clarify", "analyze", "decide", "draft"]);
export const ThoughtSourceSchema = z.enum(["user", "context", "agent"]);

export const ThoughtNodeSchema = z.object({
  id: z.string().min(1).max(120),
  type: NodeTypeSchema,
  content: z.string().min(1).max(500),
  confidence: z.number().min(0).max(1),
  source: ThoughtSourceSchema,
  updatedAt: z.string().min(1).max(80),
  parentId: z.string().min(1).max(120).optional(),
});

export const ThoughtEdgeSchema = z.object({
  id: z.string().min(1).max(160),
  source: z.string().min(1).max(120),
  target: z.string().min(1).max(120),
  relation: EdgeRelationSchema,
});

export const ControlStateSchema = z.object({
  goal: z.string().max(500).default(""),
  focusNodeId: z.string().min(1).max(120).nullable().default(null),
  unresolvedQuestionIds: z.array(z.string().min(1).max(120)).max(80).default([]),
  artifactProgress: z.record(z.enum(["empty", "active", "filled"])).default({}),
  interactionStage: InteractionStageSchema.default("explore"),
});

export const ThinkingGraphSchema = z.object({
  nodes: z.array(ThoughtNodeSchema).max(300).default([]),
  edges: z.array(ThoughtEdgeSchema).max(600).default([]),
});

export const ThinkingStateV0Schema = z.object({
  sessionId: z.string().uuid(),
  graph: ThinkingGraphSchema.default({ nodes: [], edges: [] }),
  control: ControlStateSchema.default({
    goal: "",
    focusNodeId: null,
    unresolvedQuestionIds: [],
    artifactProgress: {},
    interactionStage: "explore",
  }),
  meta: z.object({
    version: z.number().int().min(0).default(0),
    lastTurnId: z.string().max(120).nullable().default(null),
    updatedAt: z.string().min(1).max(80),
  }),
});

const StateOpSchema = z.discriminatedUnion("op", [
  z.object({ op: z.literal("add_node"), node: ThoughtNodeSchema }),
  z.object({ op: z.literal("update_node"), nodeId: z.string().min(1).max(120), changes: ThoughtNodeSchema.partial() }),
  z.object({ op: z.literal("add_edge"), edge: ThoughtEdgeSchema }),
  z.object({ op: z.literal("set_focus"), nodeId: z.string().min(1).max(120).nullable() }),
  z.object({ op: z.literal("update_control"), changes: ControlStateSchema.partial() }),
  z.object({ op: z.literal("set_stage"), stage: InteractionStageSchema }),
  z.object({ op: z.literal("noop"), reason: z.string().min(1).max(500) }),
]);

export const StatePatchSchema = z.object({
  patchId: z.string().min(1).max(120),
  turnId: z.string().min(1).max(120),
  baseVersion: z.number().int().min(0),
  idempotencyKey: z.string().min(1).max(240),
  ops: z.array(StateOpSchema).max(40),
});

export type NodeType = z.infer<typeof NodeTypeSchema>;
export type EdgeRelation = z.infer<typeof EdgeRelationSchema>;
export type Stage = z.infer<typeof InteractionStageSchema>;
export type ThoughtNode = z.infer<typeof ThoughtNodeSchema>;
export type ThoughtEdge = z.infer<typeof ThoughtEdgeSchema>;
export type ControlState = z.infer<typeof ControlStateSchema>;
export type ThinkingStateV0 = z.infer<typeof ThinkingStateV0Schema>;
export type StateOp = z.infer<typeof StateOpSchema>;
export type StatePatch = z.infer<typeof StatePatchSchema>;

function parseJsonObject(text: string) {
  return parseLlmJsonObject(text);
}

function asRecord(value: unknown): Record<string, unknown> {
  return typeof value === "object" && value !== null ? (value as Record<string, unknown>) : {};
}

function normalizeModelNode(value: unknown, fallbackId = "node") {
  const raw = asRecord(value);
  return {
    id: typeof raw.id === "string" && raw.id.trim() ? raw.id.trim() : fallbackId,
    type: NodeTypeSchema.safeParse(raw.type).success ? raw.type : "thought",
    content: typeof raw.content === "string" && raw.content.trim() ? raw.content.trim() : "未命名想法",
    confidence: typeof raw.confidence === "number" ? raw.confidence : 0.75,
    source: ThoughtSourceSchema.safeParse(raw.source).success ? raw.source : "user",
    updatedAt: typeof raw.updatedAt === "string" && raw.updatedAt.trim() ? raw.updatedAt : new Date().toISOString(),
    ...(typeof raw.parentId === "string" && raw.parentId.trim() ? { parentId: raw.parentId.trim() } : {}),
  };
}

function normalizeModelStatePatch(input: unknown) {
  const raw = asRecord(input);
  const ops = Array.isArray(raw.ops) ? raw.ops : [];
  const normalizedOps: unknown[] = [];
  ops.forEach((item, index) => {
    const op = asRecord(item);
    const kind = typeof op.op === "string" ? op.op : "noop";
    if (kind === "add_node") {
      normalizedOps.push({ op: "add_node", node: normalizeModelNode(op.node, `node_${index + 1}`) });
      return;
    }
    if (kind === "update_node") {
      const nodeRecord = asRecord(op.node);
      const nodeId =
        (typeof op.nodeId === "string" && op.nodeId.trim()) ||
        (typeof nodeRecord.id === "string" && nodeRecord.id.trim()) ||
        "";
      if (!nodeId) {
        normalizedOps.push({ op: "noop", reason: "update_node missing nodeId" });
        return;
      }
      const rawChanges = Object.keys(asRecord(op.changes)).length > 0 ? asRecord(op.changes) : nodeRecord;
      const changes = { ...rawChanges };
      delete changes.id;
      normalizedOps.push({ op: "update_node", nodeId, changes });
      return;
    }
    if (kind === "add_edge") {
      const rawEdge = asRecord(op.edge);
      const source = typeof rawEdge.source === "string" ? rawEdge.source.trim() : "";
      const target = typeof rawEdge.target === "string" ? rawEdge.target.trim() : "";
      const relation = EdgeRelationSchema.safeParse(rawEdge.relation).success ? rawEdge.relation : "includes";
      if (!source || !target) {
        normalizedOps.push({ op: "noop", reason: "add_edge missing endpoint" });
        return;
      }
      normalizedOps.push({
        op: "add_edge",
        edge: {
          id:
            typeof rawEdge.id === "string" && rawEdge.id.trim()
              ? rawEdge.id.trim()
              : `${source}-${relation}-${target}`,
          source,
          target,
          relation,
        },
      });
      return;
    }
    if (kind === "set_focus") {
      const nodeId = typeof op.nodeId === "string" ? op.nodeId : typeof op.focusNodeId === "string" ? op.focusNodeId : null;
      normalizedOps.push({ op: "set_focus", nodeId });
      return;
    }
    if (kind === "update_control") {
      normalizedOps.push({ op: "update_control", changes: asRecord(op.changes).goal || op.changes ? asRecord(op.changes) : asRecord(op.control) });
      return;
    }
    if (kind === "set_stage") {
      const stage = InteractionStageSchema.safeParse(op.stage).success ? op.stage : "explore";
      normalizedOps.push({ op: "set_stage", stage });
      return;
    }
    normalizedOps.push({ op: "noop", reason: typeof op.reason === "string" ? op.reason : "unrecognized op" });
  });
  return {
    ...raw,
    ops: normalizedOps,
  };
}

export function createEmptyThinkingStateV0(sessionId: string, now = new Date().toISOString()): ThinkingStateV0 {
  return ThinkingStateV0Schema.parse({
    sessionId,
    graph: { nodes: [], edges: [] },
    control: {
      goal: "",
      focusNodeId: null,
      unresolvedQuestionIds: [],
      artifactProgress: {},
      interactionStage: "explore",
    },
    meta: { version: 0, lastTurnId: null, updatedAt: now },
  });
}

function normalizeThinkingStateV0(input: unknown): ThinkingStateV0 | null {
  const parsed = ThinkingStateV0Schema.safeParse(input);
  return parsed.success ? parsed.data : null;
}

function dedupeStrings(values: string[], allowedIds?: Set<string>) {
  const seen = new Set<string>();
  return values.filter((value) => {
    if (!value || seen.has(value)) return false;
    if (allowedIds && !allowedIds.has(value)) return false;
    seen.add(value);
    return true;
  });
}

function normalizeGraphLinks(state: ThinkingStateV0): ThinkingStateV0 {
  const nodeIds = new Set(state.graph.nodes.map((node) => node.id));
  const edges = state.graph.edges.filter(
    (edge) => nodeIds.has(edge.source) && nodeIds.has(edge.target) && edge.source !== edge.target,
  );
  const includeParentByChild = new Map<string, string>();
  for (const edge of edges) {
    if (edge.relation === "includes") includeParentByChild.set(edge.target, edge.source);
  }
  const nodes = state.graph.nodes.map((node) => {
    const parentId = node.parentId && nodeIds.has(node.parentId) ? node.parentId : includeParentByChild.get(node.id);
    return parentId ? { ...node, parentId } : { ...node, parentId: undefined };
  });
  const questionIds = nodes.filter((node) => node.type === "question").map((node) => node.id);
  return {
    ...state,
    graph: { nodes, edges },
    control: {
      ...state.control,
      focusNodeId: state.control.focusNodeId && nodeIds.has(state.control.focusNodeId) ? state.control.focusNodeId : null,
      unresolvedQuestionIds: dedupeStrings(state.control.unresolvedQuestionIds, new Set(questionIds)),
    },
  };
}

export function applyStatePatch(stateInput: ThinkingStateV0, patchInput: StatePatch, now = new Date().toISOString()) {
  const parsedState = ThinkingStateV0Schema.parse(stateInput);
  const patch = StatePatchSchema.parse(patchInput);
  let state = normalizeGraphLinks(parsedState);
  if (patch.baseVersion !== state.meta.version) {
    return {
      state,
      applied: false,
      reason: `baseVersion mismatch: patch=${patch.baseVersion}, state=${state.meta.version}`,
    };
  }

  const nodes = new Map(state.graph.nodes.map((node) => [node.id, node] as const));
  const edges = new Map(state.graph.edges.map((edge) => [edge.id, edge] as const));
  let control = { ...state.control };

  for (const op of patch.ops) {
    if (op.op === "noop") continue;
    if (op.op === "add_node") {
      nodes.set(op.node.id, { ...nodes.get(op.node.id), ...op.node });
      continue;
    }
    if (op.op === "update_node") {
      const existing = nodes.get(op.nodeId);
      if (!existing) continue;
      const next = { ...existing, ...op.changes, id: existing.id };
      nodes.set(op.nodeId, ThoughtNodeSchema.parse(next));
      continue;
    }
    if (op.op === "add_edge") {
      if (!nodes.has(op.edge.source) || !nodes.has(op.edge.target) || op.edge.source === op.edge.target) continue;
      edges.set(op.edge.id, op.edge);
      if (op.edge.relation === "includes") {
        const child = nodes.get(op.edge.target);
        if (child) nodes.set(child.id, { ...child, parentId: op.edge.source });
      }
      continue;
    }
    if (op.op === "set_focus") {
      control.focusNodeId = op.nodeId && nodes.has(op.nodeId) ? op.nodeId : null;
      continue;
    }
    if (op.op === "update_control") {
      control = { ...control, ...op.changes };
      continue;
    }
    if (op.op === "set_stage") {
      control.interactionStage = op.stage;
    }
  }

  state = normalizeGraphLinks({
    ...state,
    graph: { nodes: [...nodes.values()], edges: [...edges.values()] },
    control,
    meta: {
      version: state.meta.version + 1,
      lastTurnId: patch.turnId,
      updatedAt: now,
    },
  });

  return { state, applied: true, reason: "applied" };
}

export function formatThinkingStateV0(stateInput: ThinkingStateV0): string {
  const state = normalizeGraphLinks(ThinkingStateV0Schema.parse(stateInput));
  const nodeLines = state.graph.nodes.map((node) => {
    const parent = node.parentId ? ` parent=${node.parentId}` : "";
    return `- ${node.id} [${node.type}]${parent}: ${node.content}`;
  });
  const edgeLines = state.graph.edges.map((edge) => `- ${edge.source} -${edge.relation}-> ${edge.target}`);
  return [
    `sessionId: ${state.sessionId}`,
    `version: ${state.meta.version}`,
    `stage: ${state.control.interactionStage}`,
    `goal: ${state.control.goal || "(unclear)"}`,
    `focusNodeId: ${state.control.focusNodeId ?? "(none)"}`,
    `unresolvedQuestionIds: ${state.control.unresolvedQuestionIds.join(", ") || "(none)"}`,
    "nodes:",
    nodeLines.length ? nodeLines.join("\n") : "- (none)",
    "edges:",
    edgeLines.length ? edgeLines.join("\n") : "- (none)",
  ].join("\n");
}

const PatchPlannerInputSchema = z.object({
  sessionId: z.string().uuid(),
  turnId: z.string().min(1).max(120),
  thoughtSegment: z.string().min(1).max(8000),
  currentState: ThinkingStateV0Schema.optional(),
  model: z.string().default("openai/gpt-4o-mini"),
});

const STATE_UPDATER_SYSTEM = `You are the Thinking State updater for a co-thinking workspace.

Your job: current thinking state + new thought segment -> minimal state transition patch.

State semantics:
- Nodes are durable units of thought.
- Edges express relationships between nodes.
- parentId is an optional denormalized shortcut for outline/tree rendering. When you create an includes edge from parent to child, the child node should also have parentId set to the parent node id.
- Control state tracks attention: goal, current focus, unresolved questions, artifact progress, and interaction stage.

Operation rules:
- add_node: use when the user introduces a new fact, thought, question, or decision.
- update_node: use when the latest segment refines or corrects an existing node.
- add_edge: use includes for parent/child hierarchy, contradicts for tension, leads_to for causal/next-step flow.
- set_focus: use when the latest segment makes one node the current center of attention.
- update_control: use for goal, unresolvedQuestionIds, artifactProgress, or other control fields.
- set_stage: explore for messy ideation, analyze for tradeoffs/causes, decide for convergence, draft for producing or filling an artifact. Keep clarify only as a backward-compatible label for defining terms/users/needs when no artifact section is being developed.

Quality rules:
- Prefer 1-4 meaningful ops per turn.
- Do not duplicate nodes with the same meaning. Update existing nodes instead.
- If the current focus node is an agent-created placeholder or section node with empty/weak content, fill it with update_node instead of adding a parallel node.
- If the user explicitly corrects or replaces a prior claim, update the existing node. Do not add a second competing node unless the user is comparing both options.
- If the user jumps to a different artifact section or idea type, follow the user's attention. Create/update the relevant node and set_focus to it.
- If the user does not explicitly change focus, treat the current focus as sticky. Attach refinements, details, examples, evidence, and constraints under the current focus or update the current focus instead of creating a new top-level node.
- When an artifact scaffold or section focus already exists, interpret continued user content as developing that structure. Prefer update_node or child nodes under the active focus; do not set clarify merely because more details are needed.
- In artifact development, use draft when the user is filling/producing the artifact, analyze when the user introduces tensions/risks/causes, and decide when the user commits to a choice.
- Change focus only when the user clearly switches topic, introduces a new artifact area, asks to park the current topic, corrects/replaces the current goal, or gives a new branch that should be discussed independently.
- When adding a node while focus remains the same, prefer an includes edge from the current focus or its nearest suitable parent to the new node.
- If a focus node now has enough who + pain / claim + evidence / mechanism + purpose, treat it as saturated and move focus along the most relevant leads_to edge when one exists.
- Filter speech filler, hesitation, and irrelevant side comments. Do not write them into nodes.
- Node content must be semantic compression, not transcript copying. Use one concise claim, ideally under 18 Chinese characters or 8 English words.
- If the user says a long contrast, split it into the key claim/tension instead of copying the whole sentence.
- Prefer update_node when the new segment refines an existing node; prefer add_node only for genuinely new concepts, questions, decisions, or evidence.
- Every substantive patch should set focus to the node that best represents the next thinking target.
- Do not invent facts.
- Use stable ids: short lowercase snake_case ids based on meaning, e.g. ai_tutor_answers, students_do_not_learn.
- Relation choice:
  - includes = hierarchy/part-of, parent contains child.
  - contradicts = tension between two claims/directions.
  - leads_to = causal, implication, or next-step reasoning.
- Control state should not mirror every node. It should track the current goal, focus, unresolved questions, artifact progress, and stage.

Decision examples:
Existing node: students_do_not_learn [question]: 学生拿到答案后仍然没有真正学习
New segment: 我觉得不是继续帮学生更快拿答案，而是帮助他们从答案走向理解。
Good ops:
- add_node thought answer_to_understanding: 帮学生从答案走向理解
- add_edge ai_learning_product includes answer_to_understanding
- add_node question how_to_enable_understanding: 如何让学生真正理解？
- add_edge answer_to_understanding leads_to how_to_enable_understanding
- set_focus how_to_enable_understanding
- update_control unresolvedQuestionIds=["students_do_not_learn","how_to_enable_understanding"], interactionStage="draft"
Bad ops:
- add_node with the full user sentence as content.
- duplicate node with the same meaning as students_do_not_learn.

Section/focus examples:
- If current focus is sec_1 with empty content and the user gives target-user details, update sec_1, then move focus to sec_2 if sec_1 now has a clear subject and pain.
- If current focus is an artifact section and the user adds examples/details, update that section or add child nodes under it; keep the stage as draft unless the user is analyzing a tension or making a decision.
- If the user says "目标用户先放放" and gives a feature idea, create/update a feature/mechanism node and set_focus there.
- If the user says "不对" or "我仔细想了下", update the relevant prior node instead of adding a duplicate.
- If the user says there is a conflict/risk, represent both the positive direction and risk, then add a contradicts edge.

Return a StatePatch only. No markdown.`;

export const planThinkingStatePatchV0 = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) => PatchPlannerInputSchema.parse(input))
  .handler(async ({ data }) => {
    const apiKey = requireOpenAIKey();
    if (!apiKey) throw new Error("Missing OPENAI_API_KEY");

    const currentState = normalizeThinkingStateV0(data.currentState) ?? createEmptyThinkingStateV0(data.sessionId);
    const gateway = createOpenAIProvider(apiKey);
    const prompt = `CURRENT THINKING STATE:
${formatThinkingStateV0(currentState)}

NEW THOUGHT SEGMENT:
${data.thoughtSegment}

Return a StatePatch with:
- patchId
- turnId: ${data.turnId}
- baseVersion: ${currentState.meta.version}
- idempotencyKey
- ops`;

    const startedAt = Date.now();
    const { text } = await generateText({
      model: gateway(normalizeAiModel(data.model)),
      system: STATE_UPDATER_SYSTEM,
      prompt: `${prompt}

Return strict JSON only with this shape:
{
  "patchId": "short id",
  "turnId": "${data.turnId}",
  "baseVersion": ${currentState.meta.version},
  "idempotencyKey": "${data.turnId}:semantic",
  "ops": [
    { "op": "add_node", "node": { "id": "...", "type": "thought", "content": "...", "confidence": 0.8, "source": "user", "updatedAt": "${new Date().toISOString()}", "parentId": "optional-parent-id" } },
    { "op": "update_node", "nodeId": "existing-node-id", "changes": { "content": "new concise content", "source": "user", "updatedAt": "${new Date().toISOString()}" } },
    { "op": "add_edge", "edge": { "id": "...", "source": "parent", "target": "child", "relation": "includes" } },
    { "op": "set_focus", "nodeId": "node-id" },
    { "op": "update_control", "changes": { "goal": "...", "unresolvedQuestionIds": ["..."], "interactionStage": "clarify" } }
  ]
}

If a node has no parent, omit parentId.`,
    });
    const patch = StatePatchSchema.parse({
      ...normalizeModelStatePatch(parseJsonObject(text)),
      turnId: data.turnId,
      baseVersion: currentState.meta.version,
    });
    const applied = applyStatePatch(currentState, patch);
    return {
      patch,
      nextState: applied.state,
      applied: applied.applied,
      diagnostics: {
        reason: applied.reason,
        latencyMs: Date.now() - startedAt,
        nodeCount: applied.state.graph.nodes.length,
        edgeCount: applied.state.graph.edges.length,
      },
    };
  });

const ThinkingStateSchema = z.object({
  current_goal: z.string().max(500).default(""),
  user_intent: z.string().max(500).default(""),
  assumptions: z.array(z.string().max(240)).max(8).default([]),
  open_questions: z.array(z.string().max(240)).max(8).default([]),
  promising_directions: z.array(z.string().max(240)).max(8).default([]),
  decision_points: z.array(z.string().max(240)).max(8).default([]),
  last_turn_id: z.string().max(120).nullable().default(null),
  artifact_state: ArtifactStateSchema.default(EMPTY_ARTIFACT_STATE),
});

export type SessionThinkingState = z.infer<typeof ThinkingStateSchema>;

const EMPTY_STATE: SessionThinkingState = {
  current_goal: "",
  user_intent: "",
  assumptions: [],
  open_questions: [],
  promising_directions: [],
  decision_points: [],
  last_turn_id: null,
  artifact_state: EMPTY_ARTIFACT_STATE,
};

const UpdateInputSchema = z.object({
  sessionId: z.string().uuid(),
  turnId: z.string().min(1).max(120),
  latestTurn: z.string().min(1).max(8000),
  currentState: ThinkingStateSchema.default(EMPTY_STATE),
  briefText: z.string().max(6000).default(""),
  mapContext: z.string().max(4000).default(""),
  model: z.string().default("openai/gpt-4o-mini"),
});

const SYSTEM = `You maintain SESSION THINKING STATE for a real-time co-thinking workspace.

Update the state after the user's latest spoken thought. This state is the shared memory used by voice, brief, and canvas.

FIELDS
- current_goal: what the user is trying to figure out or make progress on now.
- user_intent: what kind of help the user seems to want from the agent.
- assumptions: claims or constraints the user is implicitly relying on.
- open_questions: unresolved questions that would unlock progress.
- promising_directions: paths that look worth exploring next.
- decision_points: choices the user may need to make or converge on.

RULES
- Preserve useful prior state, but update it when the latest turn changes direction.
- Remove stale or duplicate items.
- Ground everything in the user's words, brief, or canvas. Do not invent facts.
- Keep each item short and actionable.
- Match the user's language where possible. Keep product/technical terms unchanged.
- Return strict JSON only.`;

function normalizeState(input: unknown): SessionThinkingState {
  const parsed = ThinkingStateSchema.safeParse(input);
  if (!parsed.success) return EMPTY_STATE;
  return {
    ...parsed.data,
    artifact_state: normalizeArtifactState(parsed.data.artifact_state),
  };
}

export function formatThinkingState(state: SessionThinkingState): string {
  const s = normalizeState(state);
  const list = (items: string[]) => (items.length ? items.map((item) => `- ${item}`).join("\n") : "- (none)");
  return [
    `current_goal: ${s.current_goal || "(unclear)"}`,
    `user_intent: ${s.user_intent || "(unclear)"}`,
    "assumptions:",
    list(s.assumptions),
    "open_questions:",
    list(s.open_questions),
    "promising_directions:",
    list(s.promising_directions),
    "decision_points:",
    list(s.decision_points),
    "artifact_state:",
    formatArtifactState(s.artifact_state),
  ].join("\n");
}

export const loadThinkingState = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) => z.object({ sessionId: z.string().uuid() }).parse(input))
  .handler(async ({ data, context }) => {
    const { data: row, error } = await context.supabase
      .from("session_thinking_state" as any)
      .select("*")
      .eq("session_id", data.sessionId)
      .maybeSingle();
    if (error) throw new Error(error.message);
    if (!row) return EMPTY_STATE;
    const r = row as any;
    return normalizeState({
      current_goal: r.current_goal ?? "",
      user_intent: r.user_intent ?? "",
      assumptions: r.assumptions ?? [],
      open_questions: r.open_questions ?? [],
      promising_directions: r.promising_directions ?? [],
      decision_points: r.decision_points ?? [],
      last_turn_id: r.last_turn_id ?? null,
      artifact_state: r.artifact_state ?? EMPTY_ARTIFACT_STATE,
    });
  });

export const updateThinkingStateFromTurn = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) => UpdateInputSchema.parse(input))
  .handler(async ({ data, context }) => {
    const apiKey = requireOpenAIKey();
    if (!apiKey) throw new Error("Missing OPENAI_API_KEY");

    const gateway = createOpenAIProvider(apiKey);
    const prompt = `CURRENT SESSION THINKING STATE:
${formatThinkingState(data.currentState)}

LATEST USER TURN:
${data.latestTurn}

LIVE BRIEF:
${data.briefText || "(empty)"}

IDEA CANVAS:
${data.mapContext || "(empty)"}

Return the updated session thinking state.`;

    let nextState = data.currentState;
    try {
      const { experimental_output } = await generateText({
        model: gateway(normalizeAiModel(data.model)),
        system: SYSTEM,
        prompt,
        experimental_output: Output.object({ schema: ThinkingStateSchema }),
      });
      nextState = normalizeState({ ...experimental_output, last_turn_id: data.turnId });
    } catch (e) {
      console.warn("[thinkingState] update failed", e instanceof Error ? e.message : String(e));
      nextState = normalizeState({ ...data.currentState, last_turn_id: data.turnId });
    }

    const { error } = await context.supabase.from("session_thinking_state" as any).upsert({
      session_id: data.sessionId,
      current_goal: nextState.current_goal,
      user_intent: nextState.user_intent,
      assumptions: nextState.assumptions,
      open_questions: nextState.open_questions,
      promising_directions: nextState.promising_directions,
      decision_points: nextState.decision_points,
      last_turn_id: data.turnId,
      artifact_state: nextState.artifact_state,
    });
    if (error) throw new Error(error.message);

    return nextState;
  });
