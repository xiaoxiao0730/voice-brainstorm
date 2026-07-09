import { createServerFn } from "@tanstack/react-start";
import { generateText } from "ai";
import { z } from "zod";

import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { createOpenAIProvider, normalizeAiModel, requireOpenAIKey } from "@/lib/ai-gateway.server";
import type { BriefPatch } from "@/lib/pipeline/types";
import {
  formatThinkingState,
  type SessionThinkingState,
} from "@/lib/agent/thinkingState.functions";
import {
  EMPTY_ARTIFACT_STATE,
  ArtifactStateSchema,
  PRD_SECTION_DEFS,
  createPrdArtifactState,
  nextPrdSectionId,
  normalizeArtifactState,
  sectionTitleForId,
  type ArtifactState,
  type PrdSectionId,
} from "@/lib/agent/artifactState";

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

const BriefPatchSchema = z.object({
  action: z.enum(["append_block", "update_block", "append_to_block"]).default("append_block"),
  blockId: z.string().nullable().default(null),
  heading: z.string().max(160).optional(),
  level: z.union([z.literal(1), z.literal(2), z.literal(3)]).optional(),
  bodyMarkdown: z.string().max(1600).optional(),
  sourceChunkIds: z.array(z.string()).default([]).optional(),
});

const CanvasOpSchema = z.object({
  action: z.enum(["add_card", "update_card", "connect", "none"]).default("none"),
  kind: z.enum(["focus", "idea", "question", "decision", "risk", "next"]).default("idea"),
  title: z.string().max(120).default(""),
  body: z.string().max(400).default(""),
  sourceTitle: z.string().max(120).default(""),
  targetTitle: z.string().max(120).default(""),
  label: z.string().max(80).default(""),
});

const ArtifactOpSchema = z.discriminatedUnion("action", [
  z.object({
    action: z.literal("propose_artifact"),
    artifactType: z.literal("prd"),
    artifactTitle: z.string().max(120).default("AI 学习产品 PRD"),
  }),
  z.object({
    action: z.literal("ensure_scaffold"),
    artifactState: ArtifactStateSchema,
  }),
  z.object({
    action: z.literal("update_section"),
    sectionId: z.string().min(1).max(80),
    body: z.string().max(1200).default(""),
    status: z.enum(["active", "filled"]).default("filled"),
  }),
  z.object({
    action: z.literal("set_active_section"),
    sectionId: z.string().min(1).max(80),
  }),
  z.object({
    action: z.literal("add_section"),
    sectionId: z.string().min(1).max(80),
    title: z.string().min(1).max(80),
  }),
]);

const DirectionSchema = z.object({
  title: z.string().min(1).max(100),
  why: z.string().max(240).default(""),
  kind: z.enum(["question", "decision", "risk", "next", "idea"]).default("next"),
});

const SectionExtractionSchema = z.object({
  sectionId: z.string().min(1).max(80),
  bullets: z.array(z.string().min(1).max(140)).min(1).max(5),
  voiceReplyHint: z.string().max(500).default(""),
});

type SectionExtraction = z.infer<typeof SectionExtractionSchema>;

const ContractSchema = z.object({
  interactionMode: z
    .enum([
      "cognitive_exploration",
      "artifact_proposal",
      "artifact_scaffolding",
      "section_filling",
      "artifact_export",
    ])
    .default("cognitive_exploration"),
  intent: z
    .enum(["brainstorm", "ask", "draft", "revise", "decide", "explain", "reflect", "casual"])
    .default("brainstorm"),
  updateKind: z
    .enum(["capture", "answer", "expand", "structure", "revise", "summarize", "no_canvas_update"])
    .default("capture"),
  replyMode: z
    .enum(["reflect", "frame", "challenge", "extend", "decide_next", "stay_silent"])
    .default("frame"),
  shouldWriteBrief: z.boolean().default(true),
  shouldWriteCanvas: z.boolean().default(false),
  thinkingState: ThinkingStateSchema.default(EMPTY_STATE),
  artifactState: ArtifactStateSchema.default(EMPTY_ARTIFACT_STATE),
  artifactOps: z.array(ArtifactOpSchema).max(4).default([]),
  briefOps: z.array(BriefPatchSchema).max(4).default([]),
  canvasOps: z.array(CanvasOpSchema).max(4).default([]),
  nextDirections: z.array(DirectionSchema).max(3).default([]),
  voiceReplyHint: z.string().max(700).default(""),
  rationale: z.string().max(300).default(""),
});

export type ThoughtTurnContract = z.infer<typeof ContractSchema>;
export type ThoughtTurnCanvasOp = z.infer<typeof CanvasOpSchema>;
export type ThoughtTurnArtifactOp = z.infer<typeof ArtifactOpSchema>;

const InputSchema = z.object({
  sessionId: z.string().uuid(),
  turnId: z.string().min(1).max(120),
  userTurn: z.string().min(1).max(8000),
  agentReply: z.string().max(4000).optional(),
  currentThinkingState: ThinkingStateSchema.default(EMPTY_STATE),
  briefText: z.string().max(7000).default(""),
  canvasText: z.string().max(5000).default(""),
  recentTurns: z.array(z.string().max(1000)).max(8).default([]),
  model: z.string().default("openai/gpt-4o-mini"),
});

const SYSTEM = `You are the THOUGHT TURN ORCHESTRATOR for a live voice co-thinking workspace.

You receive one finalized user thought. Return ONE turn contract that coordinates:
1. session thinking state,
2. Live Brief updates,
3. Thinking Board card updates,
4. the realtime voice agent's next reply hint.

IMPORTANT PRODUCT BEHAVIOR
- Do not append random bullets. Decide where the thought belongs.
- The Live Brief should become structured working notes, not a transcript.
- Update existing ideas when possible; append only when the turn adds something new.
- Not every turn deserves a canvas update. Use no_canvas_update for filler, confirmation, or casual talk.
- Agent replies may contain useful conclusions; if agentReply is present, reconcile it with the user turn.
- Match the user's language. Keep technical terms and product names unchanged.

COGNITIVE TRAJECTORY
- Organize the turn as part of a four-layer trajectory: S0 Descriptive → S1 Contextual → S2 Analytical → S3 Actionable.
- S0 Descriptive: observations, events, named options/facts, interview notes.
- S1 Contextual: why the observation matters, constraints, user intent, task situation, stakes.
- S2 Analytical: competing hypotheses, evidence strength, causal chain, tradeoff, root-cause/product judgment.
- S3 Actionable: concrete next step, MVP direction, validation question, success metric.
- The contract should preserve the user's current layer and gently advance the missing next layer.
- Do not jump straight to S3 features when S1 context or S2 reasoning is missing.
- When the user lists multiple possible explanations, produce S2 structure: competing hypotheses + evidence, not a flat list.
- When S2 reasoning is already clear, produce S3 nextDirections and a concise validation move.
- Use voiceReplyHint to ask one targeted, evidence-based question when a layer is missing.
- Prefer fewer, deeper updates over many shallow S0 notes.

INTENT GUIDE
- brainstorm: user is exploring possibilities.
- ask: user asks a direct question.
- draft: user asks to write content.
- revise: user wants to edit or improve existing content.
- decide: user is choosing or converging.
- explain: user asks for explanation.
- reflect: user is clarifying/processing their own thinking.
- casual: greetings, acknowledgements, filler.

BRIEF OPS
- Use append_block for new sections or notes.
- Use level 2 for structural headings and level 3 for body notes.
- For ask/explain, prefer a concise answer note.
- For draft, write draft-like prose, not analysis bullets.
- For brainstorm, use structured headings/notes such as Current Goal, Open Questions, Possible Directions, Risks, Next Step when helpful.
- If nothing useful should be written, return shouldWriteBrief=false and no briefOps.

BOARD / CANVAS OPS
- The board is a mixed-media thinking board with zones: Focus, Open questions, Promising paths, Risks / tensions, Decisions, Next moves.
- Map kind to zone:
  - focus → Focus
  - question → Open questions
  - idea → Promising paths
  - risk → Risks / tensions
  - decision → Decisions
  - next → Next moves
- Use add_card only for important entities/directions/questions/risks/next steps.
- Prefer 0-2 cards per turn. The board should stay clear.
- Use connect only when sourceTitle and targetTitle are clear.

VOICE HINT
- This is NOT the full voice reply. It is a grounding hint for the realtime agent.
- Keep it short and action-oriented.
- For idea-sharing turns: suggest one useful next prompt, question, or framing move.
- For command turns such as write, edit, connect, or research: hint only a brief confirmation plus the requested action.
- Do not encourage long summaries, praise, or generic reflection.

Return strict JSON only.`;

function includesAny(text: string, terms: string[]) {
  const normalized = text.toLowerCase();
  return terms.some((term) => normalized.includes(term.toLowerCase()));
}

function isPrdProductExploration(text: string) {
  return (
    includesAny(text, ["产品", "prd", "PRD", "怎么做", "方向", "用户需求", "核心功能"]) &&
    includesAny(text, ["AI", "学习", "tutor", "学生", "掌握概念", "思维"])
  );
}

function isAffirmingScaffold(text: string, artifactState: ArtifactState) {
  const trimmed = text.trim().toLowerCase();
  if (artifactState.mode !== "artifact_proposal") return false;
  return /^(好|好的|可以|行|嗯|就这么写|yes|ok|okay)/i.test(trimmed);
}

function bulletize(items: string[]) {
  return items
    .map((item) => item.trim())
    .filter(Boolean)
    .map((item) => item.replace(/^[-•]\s*/, ""))
    .filter((item, index, arr) => arr.indexOf(item) === index)
    .slice(0, 5)
    .map((item) => `- ${item}`)
    .join("\n");
}

function cleanSpokenFragment(text: string) {
  return text
    .replace(/[，,。.!！?？]/g, " ")
    .replace(/\b(um|uh|like)\b/gi, " ")
    .replace(/\s+/g, " ")
    .replace(/^(嗯|呃|额|啊|就是|然后|我觉得|主要是|可能是|应该是|其实)+/g, "")
    .replace(/(吧|嘛|呢|然后)$/g, "")
    .trim();
}

function routeSectionForTurn(text: string, activeSectionId: string): string {
  const normalized = text.replace(/\s+/g, " ").trim();
  if (includesAny(normalized, ["目标用户", "大学生", "高中生", "老师", "学生", "学习者", "用户群体"])) {
    return "target_user";
  }
  if (includesAny(normalized, ["用户需求", "需求", "痛点", "理解", "概念", "知识漏洞", "练习", "应用", "复盘", "自主思考", "不会真正学习"])) {
    return "user_need";
  }
  if (includesAny(normalized, ["功能", "机制", "反馈", "推荐", "引导", "练习任务", "核心功能", "怎么帮助"])) {
    return "core_features";
  }
  if (includesAny(normalized, ["市场", "竞品", "调研", "AI tutor", "同类产品", "竞争", "差异化"])) {
    return "market_research";
  }
  return activeSectionId;
}

function compactSectionBody(text: string, sectionId: PrdSectionId) {
  const normalized = cleanSpokenFragment(text);
  if (!normalized) return "";
  if (sectionId === "target_user" && includesAny(normalized, ["大学生", "学生"])) {
    const details = [];
    if (normalized.includes("大学生")) details.push("大学生");
    if (includesAny(normalized, ["ChatGPT", "AI", "答案"])) details.push("已经使用 AI / ChatGPT 获取答案");
    if (includesAny(normalized, ["完成作业", "作业"])) details.push("常把 AI 用于完成作业");
    if (includesAny(normalized, ["没有应用", "不会应用", "应用知识", "真正学习"])) {
      details.push("痛点是没有真正应用知识");
    }
    return details.length ? bulletize(details) : bulletize([normalized.slice(0, 260)]);
  }
  if (sectionId === "user_need" && includesAny(normalized, ["答案", "理解", "概念", "应用", "知识"])) {
    const details = [];
    if (includesAny(normalized, ["答案"])) details.push("学生并不缺少答案");
    if (includesAny(normalized, ["理解", "概念", "新的概念", "新概念"])) details.push("需要帮助学生理解新概念");
    if (includesAny(normalized, ["应用", "新题目", "知识"])) details.push("需要能把概念应用到新题目里的支持");
    if (includesAny(normalized, ["比较", "对比"])) details.push("需要支持学生比较和区分概念");
    return bulletize(details.length ? details : ["核心需求是从答案走向理解"]);
  }
  return bulletize([normalized.slice(0, 320)]);
}

function mergeSectionBody(previous: string, next: string) {
  const lines = [...previous.split("\n"), ...next.split("\n")]
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line) => line.replace(/^[-•]\s*/, ""));
  return bulletize(lines);
}

function slugifySectionTitle(title: string) {
  const ascii = title
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9\u4e00-\u9fff]+/g, "_")
    .replace(/^_+|_+$/g, "")
    .slice(0, 40);
  return `custom_${ascii || "section"}`;
}

function extractAddSectionTitle(text: string) {
  const normalized = text.replace(/\s+/g, " ").trim();
  const match = normalized.match(/(?:加|新增|添加|补一个|加一个)\s*(?:一个|一块|板块|section|部分)?\s*([^，。,.!?！？]+?)(?:\s*(?:section|板块|部分|模块))?(?:$|[，。,.!?！？])/i);
  const title = match?.[1]?.trim().replace(/^(叫|为|是)\s*/, "") ?? "";
  if (!title || title.length > 40) return "";
  if (/^(这个|section|板块|部分|模块)$/.test(title.toLowerCase())) return "";
  return title;
}

function addArtifactSection(artifactState: ArtifactState, title: string) {
  const existing = artifactState.sections.find((section) => section.title === title);
  if (existing) {
    return createPrdArtifactState({ ...artifactState, activeSectionId: existing.id });
  }
  const baseId = slugifySectionTitle(title);
  const used = new Set(artifactState.sections.map((section) => section.id));
  let sectionId = baseId;
  let index = 2;
  while (used.has(sectionId)) {
    sectionId = `${baseId}_${index++}`;
  }
  return createPrdArtifactState({
    ...artifactState,
    mode: "section_filling",
    activeSectionId: sectionId,
    sections: [
      ...artifactState.sections.map((section) => ({
        ...section,
        status: section.status === "active" ? "empty" : section.status,
      })),
      {
        id: sectionId,
        title,
        status: "active",
        body: "",
        guidingQuestion: `补充「${title}」里最关键的判断。`,
      },
    ],
  });
}

function upsertArtifactSection(
  artifactState: ArtifactState,
  sectionId: string,
  body: string,
  status: "active" | "filled" = "filled",
) {
  const isDefaultSection = PRD_SECTION_DEFS.some((section) => section.id === sectionId);
  const nextActive = isDefaultSection ? nextPrdSectionId(sectionId as PrdSectionId) : sectionId;
  return createPrdArtifactState({
    ...artifactState,
    mode: "section_filling",
    activeSectionId: nextActive,
    sections: artifactState.sections.map((section) => ({
      ...section,
      body: section.id === sectionId ? mergeSectionBody(section.body, body) : section.body,
      status:
        section.id === sectionId
          ? status
          : section.id === nextActive
            ? "active"
            : section.status,
    })),
  });
}

function scaffoldVoiceHint() {
  return "我已经把它搭成一个轻量 PRD。我们先从目标用户开始，因为不同学生遇到的学习问题不同，后面的功能设计也会不同。先回答：谁在学习、他们现在怎么学习、在哪个环节遇到困难？";
}

function sectionVoiceHint(sectionId: string, body: string) {
  if (sectionId === "target_user") {
    return "这里的核心问题不是“学生获取不到答案”，而是“学生如何从答案走向理解”。下一步我们先明确 User Need：学生在哪个阶段最需要 AI 帮助，是理解新概念、发现知识漏洞、练习应用，还是复盘自己的思考过程？";
  }
  if (sectionId === "user_need") {
    return "现在 User Need 更清楚了：不是给更多答案，而是帮助学生内化和应用。下一步进入核心功能：什么机制能让学生先思考、再得到反馈、最后能迁移应用？";
  }
  const isDefaultSection = PRD_SECTION_DEFS.some((section) => section.id === sectionId);
  const nextTitle = isDefaultSection ? sectionTitleForId(nextPrdSectionId(sectionId as PrdSectionId)) : sectionTitleForId(sectionId);
  return `我会把这部分更新到「${sectionTitleForId(sectionId)}」。下一步继续补「${nextTitle}」：${body ? "围绕刚才的判断往下定义。" : "先补一个最关键判断。"}`;
}

function artifactSectionListForPrompt(artifactState: ArtifactState) {
  return artifactState.sections
    .map((section) => `- ${section.id}: ${section.title}${section.id === artifactState.activeSectionId ? " (active)" : ""}`)
    .join("\n");
}

async function extractArtifactSectionUpdate(opts: {
  gateway: ReturnType<typeof createOpenAIProvider>;
  model: string;
  userTurn: string;
  artifactState: ArtifactState;
}): Promise<SectionExtraction> {
  const prompt = `You are extracting concise PRD section bullets from one spoken user turn.

Artifact title: ${opts.artifactState.artifactTitle}
Active section: ${opts.artifactState.activeSectionId}
Available sections:
${artifactSectionListForPrompt(opts.artifactState)}

User turn:
${opts.userTurn}

Rules:
- Choose the section where the content semantically belongs, not necessarily the active section.
- Remove filler words, hesitation, and transcript artifacts.
- Do not copy the transcript verbatim.
- Return 1-3 short bullets in Simplified Chinese unless the user mostly spoke English.
- Bullets should be artifact-ready, e.g. "需要帮助学生理解新概念".
- Do not include leading "-" in bullets.
- Return strict JSON only:
{"sectionId":"user_need","bullets":["需要帮助学生理解新概念"],"voiceReplyHint":"..."}`;

  const { text } = await generateText({
    model: opts.gateway(normalizeAiModel(opts.model)),
    system: "Return strict JSON only. Extract artifact section bullets, do not answer conversationally.",
    prompt,
  });
  const parsed = SectionExtractionSchema.parse(extractJSON(text));
  const availableIds = new Set(opts.artifactState.sections.map((section) => section.id));
  return {
    ...parsed,
    sectionId: availableIds.has(parsed.sectionId) ? parsed.sectionId : opts.artifactState.activeSectionId || "target_user",
    bullets: parsed.bullets.map((bullet) => bullet.replace(/^[-•]\s*/, "").trim()).filter(Boolean).slice(0, 5),
  };
}

async function deterministicArtifactContract(
  userTurn: string,
  turnId: string,
  currentState: SessionThinkingState,
  opts?: { gateway: ReturnType<typeof createOpenAIProvider>; model: string },
): Promise<ThoughtTurnContract | null> {
  const currentArtifact = normalizeArtifactState(currentState.artifact_state);
  if (currentArtifact.mode === "none" && isPrdProductExploration(userTurn)) {
    const artifactState = createPrdArtifactState({ mode: "artifact_proposal" });
    return normalizeContract(
      {
        interactionMode: "artifact_proposal",
        intent: "draft",
        updateKind: "no_canvas_update",
        replyMode: "frame",
        shouldWriteBrief: false,
        shouldWriteCanvas: false,
        thinkingState: {
          ...currentState,
          current_goal: "把 AI 学习产品想法搭成一个轻量 PRD",
          user_intent: "希望 agent 先给出可推进的产出物框架",
          open_questions: ["目标用户是谁", "学生真正的学习需求是什么", "核心功能机制是什么", "市场缺口在哪里"],
          promising_directions: ["轻量 PRD scaffold"],
          artifact_state: artifactState,
        },
        artifactState,
        artifactOps: [
          { action: "propose_artifact", artifactType: "prd", artifactTitle: artifactState.artifactTitle },
        ],
        briefOps: [],
        canvasOps: [],
        nextDirections: [
          { title: "搭建轻量 PRD", why: "先建立目标用户、用户需求、核心功能、市场调研四个位置。", kind: "next" },
        ],
        voiceReplyHint:
          "我建议先把这个想法搭成一个轻量 PRD。先有四块：目标用户、用户需求、核心功能、市场调研。这样后面每次补充想法，都能落到一个明确位置里。",
        rationale: "The user asked how to proceed with a vague AI learning product idea, so propose an artifact scaffold before asking details.",
      },
      turnId,
      currentState,
    );
  }

  if (isAffirmingScaffold(userTurn, currentArtifact)) {
    const artifactState = createPrdArtifactState({ ...currentArtifact, mode: "artifact_scaffolding", activeSectionId: "target_user" });
    return normalizeContract(
      {
        interactionMode: "artifact_scaffolding",
        intent: "draft",
        updateKind: "structure",
        replyMode: "decide_next",
        shouldWriteBrief: false,
        shouldWriteCanvas: false,
        thinkingState: {
          ...currentState,
          artifact_state: artifactState,
          current_goal: artifactState.artifactTitle,
        },
        artifactState,
        artifactOps: [{ action: "ensure_scaffold", artifactState }],
        briefOps: [],
        canvasOps: [],
        nextDirections: [
          { title: "先定义目标用户", why: "不同学生的问题会决定后面的需求和功能。", kind: "next" },
        ],
        voiceReplyHint: scaffoldVoiceHint(),
        rationale: "The user accepted the scaffold, so create the PRD structure and guide the first section.",
      },
      turnId,
      currentState,
    );
  }

  if (currentArtifact.mode !== "none" && currentArtifact.mode !== "artifact_proposal") {
    const requestedSectionTitle = extractAddSectionTitle(userTurn);
    if (requestedSectionTitle) {
      const artifactState = addArtifactSection(currentArtifact, requestedSectionTitle);
      const sectionId = artifactState.activeSectionId;
      return normalizeContract(
        {
          interactionMode: "section_filling",
          intent: "revise",
          updateKind: "structure",
          replyMode: "decide_next",
          shouldWriteBrief: false,
          shouldWriteCanvas: false,
          thinkingState: {
            ...currentState,
            artifact_state: artifactState,
            current_goal: artifactState.artifactTitle,
            promising_directions: [requestedSectionTitle],
          },
          artifactState,
          artifactOps: [
            { action: "add_section", sectionId, title: requestedSectionTitle },
            { action: "set_active_section", sectionId },
          ],
          briefOps: [],
          canvasOps: [],
          nextDirections: [
            { title: `补${requestedSectionTitle}`, why: `新增 section 后，下一轮内容会填进「${requestedSectionTitle}」。`, kind: "next" },
          ],
          voiceReplyHint: `好的，我加一个「${requestedSectionTitle}」section。接下来你说的内容会先填到这一块。`,
          rationale: "The user asked to add a new artifact section, so append a custom section instead of creating a free-form card.",
        },
        turnId,
        currentState,
      );
    }
    let sectionId = routeSectionForTurn(userTurn, currentArtifact.activeSectionId || "target_user");
    let body = compactSectionBody(userTurn, sectionId as PrdSectionId);
    let extractedVoiceHint = "";
    if (opts) {
      try {
        const extraction = await extractArtifactSectionUpdate({
          gateway: opts.gateway,
          model: opts.model,
          userTurn,
          artifactState: currentArtifact,
        });
        sectionId = extraction.sectionId;
        body = bulletize(extraction.bullets);
        extractedVoiceHint = extraction.voiceReplyHint;
      } catch (error) {
        console.warn("[thoughtTurnContract] section extraction failed", error instanceof Error ? error.message : String(error));
      }
    }
    if (!body) return null;
    const artifactState = upsertArtifactSection(currentArtifact, sectionId, body, "filled");
    return normalizeContract(
      {
        interactionMode: "section_filling",
        intent: "draft",
        updateKind: "revise",
        replyMode: "decide_next",
        shouldWriteBrief: false,
        shouldWriteCanvas: false,
        thinkingState: {
          ...currentState,
          artifact_state: artifactState,
          current_goal: artifactState.artifactTitle,
          promising_directions: [sectionTitleForId(artifactState.activeSectionId)],
        },
        artifactState,
          artifactOps: [
            { action: "update_section", sectionId, body, status: "filled" },
          { action: "set_active_section", sectionId: artifactState.activeSectionId },
          ],
        briefOps: [],
        canvasOps: [],
        nextDirections: [
          {
            title: `继续补${sectionTitleForId(artifactState.activeSectionId)}`,
            why: PRD_SECTION_DEFS.find((section) => section.id === artifactState.activeSectionId)?.guidingQuestion ?? "推进下一块。",
            kind: "next",
          },
        ],
        voiceReplyHint: extractedVoiceHint || sectionVoiceHint(sectionId, body),
        rationale: "The artifact already exists, so this turn should update the active PRD section instead of creating new topic cards.",
      },
      turnId,
      currentState,
    );
  }

  return null;
}

// Azure's structured-output (response_format) rejects schemas with optional/
// defaulted fields, so we ask for JSON in the prompt and parse it ourselves.
function extractJSON(raw: string): unknown {
  let cleaned = (raw ?? "").trim();
  const fence = cleaned.match(/```(?:json)?\s*([\s\S]*?)```/i);
  if (fence) cleaned = fence[1].trim();
  const first = cleaned.indexOf("{");
  const last = cleaned.lastIndexOf("}");
  if (first >= 0 && last > first) cleaned = cleaned.slice(first, last + 1);
  return JSON.parse(cleaned);
}

function normalizeContract(input: unknown, turnId: string, currentState: SessionThinkingState): ThoughtTurnContract {
  const parsed = ContractSchema.safeParse(input);
  const base = parsed.success
    ? parsed.data
    : {
        interactionMode: "cognitive_exploration" as const,
        intent: "brainstorm" as const,
        updateKind: "capture" as const,
        replyMode: "frame" as const,
        shouldWriteBrief: true,
        shouldWriteCanvas: false,
        thinkingState: currentState,
        artifactState: normalizeArtifactState(currentState.artifact_state),
        artifactOps: [],
        briefOps: [],
        canvasOps: [],
        nextDirections: [],
        voiceReplyHint: "",
        rationale: "",
      };
  const currentArtifactState = normalizeArtifactState(currentState.artifact_state);
  const parsedArtifactState = normalizeArtifactState(
    base.artifactState ?? base.thinkingState.artifact_state,
  );
  const artifactState =
    parsedArtifactState.mode === "none" && currentArtifactState.mode !== "none"
      ? currentArtifactState
      : parsedArtifactState;
  return {
    ...base,
    artifactState,
    artifactOps: base.artifactOps ?? [],
    thinkingState: {
      ...base.thinkingState,
      artifact_state: artifactState,
      last_turn_id: turnId,
    },
    briefOps: base.shouldWriteBrief ? base.briefOps : [],
    canvasOps: base.shouldWriteCanvas ? base.canvasOps : [],
  };
}

export const planThoughtTurnContract = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) => InputSchema.parse(input))
  .handler(async ({ data, context }) => {
    const apiKey = requireOpenAIKey();
    if (!apiKey) throw new Error("Missing OPENAI_API_KEY");
    const gateway = createOpenAIProvider(apiKey);

    const deterministic = await deterministicArtifactContract(
      data.userTurn,
      data.turnId,
      data.currentThinkingState,
      { gateway, model: data.model },
    );
    if (deterministic) {
      const { error } = await context.supabase.from("session_thinking_state" as any).upsert({
        session_id: data.sessionId,
        current_goal: deterministic.thinkingState.current_goal,
        user_intent: deterministic.thinkingState.user_intent,
        assumptions: deterministic.thinkingState.assumptions,
        open_questions: deterministic.thinkingState.open_questions,
        promising_directions: deterministic.thinkingState.promising_directions,
        decision_points: deterministic.thinkingState.decision_points,
        artifact_state: deterministic.artifactState,
        last_turn_id: data.turnId,
      });
      if (error) {
        console.warn("[thoughtTurnContract] thinking state upsert failed", error.message);
      }
      return deterministic;
    }

    const prompt = `CURRENT SESSION THINKING STATE:
${formatThinkingState(data.currentThinkingState)}

RECENT USER TURNS:
${data.recentTurns.length ? data.recentTurns.map((t) => `- ${t}`).join("\n") : "(none)"}

LATEST USER TURN:
${data.userTurn}

LATEST AGENT REPLY:
${data.agentReply?.trim() || "(not available yet)"}

LIVE BRIEF:
${data.briefText || "(empty)"}

THINKING BOARD:
${data.canvasText || "(empty)"}

Create the thought turn contract.`;

    let contract;
    try {
      const { text } = await generateText({
        model: gateway(normalizeAiModel(data.model)),
        system: SYSTEM,
        prompt,
      });
      contract = normalizeContract(extractJSON(text), data.turnId, data.currentThinkingState);
    } catch (e) {
      console.warn("[thoughtTurnContract] failed", e instanceof Error ? e.message : String(e));
      const text = data.userTurn.trim();
      contract = normalizeContract(
        {
          intent: "reflect",
          updateKind: "capture",
          replyMode: "frame",
          shouldWriteBrief: text.length > 0,
          shouldWriteCanvas: false,
          thinkingState: {
            ...data.currentThinkingState,
            current_goal: data.currentThinkingState.current_goal || text.slice(0, 160),
          },
          briefOps: text
            ? ([
                {
                  action: "append_block",
                  blockId: null,
                  level: 3,
                  bodyMarkdown: text,
                },
              ] satisfies BriefPatch[])
            : [],
          canvasOps: [],
          nextDirections: [
            {
              title: "Clarify the goal",
              why: "Make the next turn easier to structure.",
              kind: "question",
            },
            {
              title: "Map options",
              why: "Turn the thought into visible alternatives.",
              kind: "idea",
            },
          ],
          voiceReplyHint:
            "Give a tiny acknowledgment, then ask whether to clarify the goal, map options, or pick the next concrete step.",
        },
        data.turnId,
        data.currentThinkingState,
      );
    }

    const { error } = await context.supabase.from("session_thinking_state" as any).upsert({
      session_id: data.sessionId,
      current_goal: contract.thinkingState.current_goal,
      user_intent: contract.thinkingState.user_intent,
      assumptions: contract.thinkingState.assumptions,
      open_questions: contract.thinkingState.open_questions,
      promising_directions: contract.thinkingState.promising_directions,
      decision_points: contract.thinkingState.decision_points,
      artifact_state: contract.artifactState,
      last_turn_id: data.turnId,
    });
    if (error) {
      console.warn("[thoughtTurnContract] thinking state upsert failed", error.message);
    }

    return contract;
  });
