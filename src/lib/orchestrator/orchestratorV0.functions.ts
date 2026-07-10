import { createServerFn } from "@tanstack/react-start";
import { generateText } from "ai";
import { z } from "zod";

import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { createOpenAIProvider, normalizeAiModel, requireOpenAIKey } from "@/lib/ai-gateway.server";
import {
  formatOrchestratorContextV0,
  type OrchestratorContextV0,
} from "@/lib/orchestrator/orchestratorContextV0.functions";

export const ArtifactViewChildV0Schema = z.object({
  id: z.string().min(1).max(80),
  heading: z.string().min(1).max(80),
  bullets: z.array(z.string().min(1).max(180)).max(8).default([]),
  sourceNodeIds: z.array(z.string().min(1).max(120)).max(20).default([]),
  status: z.enum(["empty", "active", "filled"]).default("empty"),
});

export const ArtifactViewSectionV0Schema = z.object({
  id: z.string().min(1).max(80),
  heading: z.string().min(1).max(80),
  bullets: z.array(z.string().min(1).max(180)).max(8).default([]),
  children: z.array(ArtifactViewChildV0Schema).max(12).default([]),
  sourceNodeIds: z.array(z.string().min(1).max(120)).max(20).default([]),
  status: z.enum(["empty", "active", "filled"]).default("empty"),
});

export const CanvasArtifactViewV0Schema = z.object({
  artifactType: z.enum(["prd", "outline", "decision_brief", "research_plan"]),
  title: z.string().min(1).max(120),
  sections: z.array(ArtifactViewSectionV0Schema).min(1).max(10),
  activeSectionId: z.string().min(1).max(80).nullable().default(null),
});

export const ResearchRequestV0Schema = z.object({
  query: z.string().min(1).max(300),
  reason: z.string().max(300).default(""),
});

export const OrchestratorOutputV0Schema = z.object({
  nextAction: z.enum(["ask_user", "update_canvas", "request_research", "draft_artifact", "wait"]),
  voiceResponse: z.string().min(1).max(1200),
  canvasArtifactView: CanvasArtifactViewV0Schema.nullable().default(null),
  canvasOps: z.preprocess(() => [], z.array(z.never())).default([]),
  researchRequests: z.array(ResearchRequestV0Schema).max(4).default([]),
  exportArtifact: z.null().default(null),
  diagnostics: z
    .object({
      mode: z
        .enum(["artifact_proposal", "artifact_scaffold", "section_update", "general_guidance", "fallback"])
        .default("general_guidance"),
      rationale: z.string().max(400).default(""),
    })
    .default({ mode: "general_guidance", rationale: "" }),
});

export type ArtifactViewChildV0 = z.infer<typeof ArtifactViewChildV0Schema>;
export type ArtifactViewSectionV0 = z.infer<typeof ArtifactViewSectionV0Schema>;
export type CanvasArtifactViewV0 = z.infer<typeof CanvasArtifactViewV0Schema>;
export type ResearchRequestV0 = z.infer<typeof ResearchRequestV0Schema>;
export type OrchestratorOutputV0 = z.infer<typeof OrchestratorOutputV0Schema>;

const InputSchema = z.object({
  context: z.unknown(),
  model: z.string().default("openai/gpt-4o"),
});

const BASE_SYSTEM = `You are ORCHESTRATOR V0 for a voice-first co-thinking workspace.

Your role is Strategic Synthesizer + Interaction Director.

Your input is an OrchestratorContextV0: updated internal thinking state, uploaded context, recent turns, and current canvas snapshot.
Your output is the next user-facing turn plan: voiceResponse + optional canvasArtifactView.

STRICT RESPONSIBILITIES
- Decide what should happen next for the user experience.
- Produce a user-facing artifact view when the canvas should show structure.
- Produce a concise spoken response that guides exactly one next step.
- Do not update ThinkingState. Do not create graph nodes or edges. Do not emit low-level React Flow canvas ops in V0.
- Ground everything in context. Do not invent user facts.
- Use interactionStage as the default posture, but the user's latest intent can override it.

PROMPTING PRINCIPLES
- Analyze before choosing output shape: identify user intent, current stage, active focus, canvas state, and missing information.
- Reorganize internal graph content into a user-facing artifact. Do not expose internal node ids as visible text.
- Prefer existing artifact structure when present. Add or change structure only when the user asks or the current structure no longer fits.
- For sparse content, ask 1 targeted question. For sufficient content, update the artifact and move to the next section.
- If the user asks how to proceed with making, planning, designing, or clarifying a product/work artifact, establish the output container before drilling into details.
- If the user asks for advice or a concrete path, lead with a recommendation. Do not turn the advice request back into a broad question.
- Output must be concrete enough that a renderer can draw it without guessing.`;

const SYNTHESIS_SYSTEM = `SYNTHESIS RULES
- Do not mirror the graph. Transform it into the clearest user-facing artifact and next move.
- Select: choose the 1-3 most important claims for the current artifact section or voice response.
- Compress: merge related nodes into one strong artifact-ready bullet when they describe the same user, need, risk, mechanism, or decision.
- Frame: place synthesized content into the most useful section heading for the user's goal.
- Advance: decide the next active section or next question based on what is missing.
- Prefer one complete, synthesized bullet over several thin copied bullets.
- Preserve uncertainty as a question or risk; do not convert it into a fact.

Example synthesis:
Input graph content:
- 目标用户是大学生
- 大学生已使用 ChatGPT 获取答案完成作业
- 学生没有应用知识
Good artifact bullet:
- 大学生，已使用 AI / ChatGPT 获取答案，常用于完成作业但缺少知识应用。
Bad artifact bullets:
- 大学生
- 使用 ChatGPT
- 获取答案
- 完成作业
- 没有应用知识`;

const PLACEMENT_SYSTEM = `ARTIFACT PLACEMENT RULES
- The active section/focus is the default parent for new artifact content.
- If the user adds details, examples, evidence, constraints, or refinements and the focus has not changed, place them in the active section's bullets.
- Create children only for true sub-branches that may be discussed independently, such as alternative needs, feature mechanisms, risks, options, experiments, or next-step paths.
- Create or switch to a different top-level section only when the user explicitly changes topic, asks to add/change a section, introduces a different artifact area, or the current section is clearly not the right parent.
- Do not create parallel top-level sections for details that refine the current active section.
- Renderer semantics: bullets stay inside the current card; children become visible child nodes. Choose bullets vs children accordingly.`;

const MODE_SYSTEM_PROMPTS = {
  explore: `INTERACTION MODE: explore
- The user is still shaping the problem space.
- Voice should recommend a useful frame or artifact path, not conduct a broad interview.
- If the user asks "how should I do this?" for a product/work direction, create or propose the artifact scaffold and lead with a recommendation.
- canvasArtifactView should be generated when the user asks for concrete guidance, asks to structure the work, or the next step is clearly to externalize a scaffold.
- Good voice shape: recommendation -> structure/path -> first section to develop.`,

  clarify: `INTERACTION MODE: clarify
- Treat this as STRUCTURE/DEVELOP mode, not interview mode.
- The user is adding material to an artifact section or defining users, needs, constraints, concepts, or boundaries.
- First place the new material into the active artifact section when possible. Then advance to the next useful section.
- Ask only one targeted question when a specific missing slot blocks progress; otherwise make a concrete recommendation or next move.
- If there is no visible artifact yet and the user is asking how to proceed with a product/work artifact, create or propose the artifact scaffold instead of asking another diagnostic question.
- If the latest user turn asks "what should I do / how should I proceed / 你觉得我应该怎么做", override clarify mode: recommend a concrete path and create or propose the scaffold.
- Good voice shape: synthesized placement -> why it matters -> next section to develop.`,

  analyze: `INTERACTION MODE: analyze
- The user is reasoning about causes, contradictions, tradeoffs, risks, or assumptions.
- Voice should surface one tension or assumption and turn it into a decision or validation question.
- canvasArtifactView can add bullets under risks, assumptions, market research, or core mechanism if those sections exist.
- Good voice shape: identify tension -> explain why it matters -> ask for evidence or choice.`,

  decide: `INTERACTION MODE: decide
- The user is converging.
- Voice should help choose using criteria, not keep expanding.
- canvasArtifactView should mark decisions or filled sections when the choice is clear.
- Good voice shape: state recommendation or decision axis -> name tradeoff -> propose next concrete step.`,

  draft: `INTERACTION MODE: draft
- The user wants an artifact to be generated or filled.
- Prefer update_canvas or draft_artifact over more discussion when enough content exists.
- Voice should be a short confirmation plus the next section-level guide.
- canvasArtifactView should use clean headings and bullet points under each heading.`,
} as const;

const ARTIFACT_VIEW_SYSTEM = `CANVAS ARTIFACT VIEW RULES
- canvasArtifactView is a user-facing structure, not the internal thought graph.
- All visible canvasArtifactView text must match the dominant language of the latest user turn in recentTurns: title, section headings, section bullets, child headings, and child bullets.
- The latest user turn's language overrides existing canvasSnapshot headings. If the existing canvas is in another language, don't change it and continue generate in the dominant language used by the user now.
- If the latest user turn is English, use English canvas headings such as Target Users, User Needs, Core Features, Market Research instead of Chinese headings.
- If the latest user turn is Chinese, use Chinese canvas headings instead of English headings, unless the user explicitly asks for English labels.
- Use a simple document-like layout: title at the top, sections underneath, bullet points as section body.
- Section headings should be short noun phrases chosen for the artifact type.
- Section bullets should be concise, artifact-ready claims, not raw transcript.
- Each bullet should contain one complete thought with enough context to stand alone.
- Section children are visible sub-branches. Use them only when the item deserves its own node and can be expanded later.
- Avoid duplicate bullets with the same meaning.
- Use sourceNodeIds to preserve traceability, but never show sourceNodeIds in visible text.
- Status semantics:
  - empty: section exists but has no substantive content yet.
  - active: this is the next section the voice should guide.
  - filled: the section has at least one useful user-grounded bullet.
- For product planning, prefer a lightweight PRD artifact when the user wants to figure out a product direction.
- For PRD artifacts, choose section headings that match the user's product goal, such as audience, needs, solution/mechanism, risks, research, or next steps.
- Do not use a fixed PRD scaffold unless the current context makes those sections appropriate.
- A useful default PRD scaffold for early product exploration is: target audience/users, user needs/problems, core solution/features/mechanism, and market/research/risks. Localize all visible artifact text to the latest user turn's language.
- Generate the scaffold when the user accepts, clearly asks to write/build the artifact, or asks for concrete advice on how to proceed with a product/work artifact.
- If the user is merely brainstorming without asking for help, propose the artifact in voiceResponse and keep canvasArtifactView null.
- If the latest user response is a short acceptance of the immediately previous artifact proposal, generate the scaffold instead of asking for confirmation again.
- If canvasSnapshot already contains section headings, preserve that structure and update/fill the relevant section rather than inventing a new artifact.
- After scaffold exists, fill one section at a time and move activeSectionId to the next useful section.`;

const VOICE_RESPONSE_SYSTEM = `VOICE RESPONSE RULES
- Match the dominant language of the latest user turn in recentTurns.
- The latest user turn's language overrides canvas headings, artifact section names, uploaded context, and examples in this prompt.
- If the latest user turn is English, write voiceResponse in English even when artifact headings are Chinese; translate section names naturally in speech if needed.
- If the latest user turn is Chinese, write voiceResponse in Chinese and avoid English filler such as "Got it", "Let's", or "How does that sound".
- Strictly keep voiceResponse under 3 conversational sentences.
- Prefer 1-2 sentences unless the user explicitly asks for a walkthrough.
- If listing options, compress them into one spoken sentence instead of long bullets.
- Do not over-summarize the user.
- For artifact scaffolding, name the structure and guide the active section.
- Ask one targeted next question, not a generic "tell me more".
- The canvas carries structure; the voice should make the next move obvious.
- Voice response is generated from:
  1. interactionStage: default conversational posture.
  2. activeSectionId: what to guide next.
  3. artifact status: whether to propose, scaffold, fill, or advance.
  4. latest user intent from recentTurns: can override the stage.
- Voice should not describe internal mechanics, JSON, node ids, prompt rules, or canvas rendering.
- Good artifact voice format:
  - advice/scaffold: "I recommend turning this into a lightweight [artifact] with [sections]. I'll set up the structure and start with [first section]."
  - proposal: "A useful container would be [artifact], covering [sections]. We can use that as the foundation."
  - scaffold created: "I've created the frame. Let's start with [section], because [reason]."
  - section filled: "This section can be captured as [synthesis]. Next, move into [next section]."
  - analysis: "The key tension is [tension], so the next judgment is [decision/question]."`;

const OUTPUT_CONTRACT_SYSTEM = `OUTPUT CONTRACT
- Return strict JSON only. No markdown. No commentary.
- nextAction must describe the immediate user-facing action.
- Use nextAction="update_canvas" whenever canvasArtifactView is non-null.
- canvasOps must always be []. V0 does not emit low-level canvas operations.
- exportArtifact must be null unless a later version explicitly supports export.
- If generating canvasArtifactView, every section must have id, heading, bullets, children, sourceNodeIds, and status.
- If a section has no child branches, return children: [].
- Prefer these stable PRD section ids only when applicable: target_user, user_need, core_features, market_research.
- Stable ids are language-neutral. Do not use stable ids as visible labels; localize headings and bullets to the latest user language.
- activeSectionId must be null or match an existing section id.`;

export function buildOrchestratorSystemPromptV0(context: OrchestratorContextV0) {
  return [
    BASE_SYSTEM,
    MODE_SYSTEM_PROMPTS[context.semanticSummary.stage],
    SYNTHESIS_SYSTEM,
    PLACEMENT_SYSTEM,
    ARTIFACT_VIEW_SYSTEM,
    VOICE_RESPONSE_SYSTEM,
    OUTPUT_CONTRACT_SYSTEM,
  ].join("\n\n");
}

function parseJsonObject(text: string) {
  let cleaned = (text ?? "").trim();
  const fence = cleaned.match(/```(?:json)?\s*([\s\S]*?)```/i);
  if (fence) cleaned = fence[1].trim();
  const start = cleaned.indexOf("{");
  const end = cleaned.lastIndexOf("}");
  if (start < 0 || end <= start) throw new Error("Model did not return a JSON object");
  return JSON.parse(cleaned.slice(start, end + 1)) as unknown;
}

function latestUserTurnLanguage(context: OrchestratorContextV0): "zh" | "en" {
  const latestUserTurn = context.recentTurns
    .slice()
    .reverse()
    .find((turn) => /^\s*User\s*:/i.test(turn) || turn.trim());
  const text = latestUserTurn ?? "";
  const cjkCount = (text.match(/[\u4e00-\u9fff]/g) ?? []).length;
  const latinCount = (text.match(/[a-z]/gi) ?? []).length;
  return cjkCount > latinCount * 0.25 ? "zh" : "en";
}

function fallbackOutput(context: OrchestratorContextV0, reason: string): OrchestratorOutputV0 {
  const focus = context.semanticSummary.focus || context.semanticSummary.goal || "这个方向";
  const language = latestUserTurnLanguage(context);
  return {
    nextAction: "ask_user",
    voiceResponse:
      language === "zh"
        ? `我们先把「${focus}」收成一个可推进的结构。下一步最需要明确的是：你希望最后产出 PRD、研究计划，还是决策 brief？`
        : `Let's turn "${focus}" into a structure we can work with. The next decision is whether this should become a PRD, a research plan, or a decision brief.`,
    canvasArtifactView: null,
    canvasOps: [],
    researchRequests: [],
    exportArtifact: null,
    diagnostics: { mode: "fallback", rationale: reason },
  };
}

function normalizeOutput(input: unknown, context: OrchestratorContextV0): OrchestratorOutputV0 {
  const parsed = OrchestratorOutputV0Schema.safeParse(input);
  if (!parsed.success) return fallbackOutput(context, parsed.error.message.slice(0, 300));
  const out = parsed.data;
  if (!out.canvasArtifactView) return out;
  const sectionIds = new Set(out.canvasArtifactView.sections.map((section) => section.id));
  const activeSectionId = out.canvasArtifactView.activeSectionId;
  return {
    ...out,
    canvasArtifactView: {
      ...out.canvasArtifactView,
      activeSectionId: activeSectionId && sectionIds.has(activeSectionId) ? activeSectionId : null,
      sections: out.canvasArtifactView.sections.map((section) => ({
        ...section,
        bullets: Array.from(new Set(section.bullets.map((item) => item.trim()).filter(Boolean))).slice(0, 8),
        sourceNodeIds: Array.from(new Set(section.sourceNodeIds.map((item) => item.trim()).filter(Boolean))).slice(0, 20),
      })),
    },
  };
}

export function formatOrchestratorOutputV0(output: OrchestratorOutputV0): string {
  const artifact = output.canvasArtifactView;
  const artifactLines = artifact
    ? [
        `artifactType: ${artifact.artifactType}`,
        `title: ${artifact.title}`,
        `activeSectionId: ${artifact.activeSectionId ?? "(none)"}`,
        "sections:",
        ...artifact.sections.flatMap((section) => [
          `- ${section.id} [${section.status}]: ${section.heading}`,
          ...section.bullets.map((bullet) => `  - ${bullet}`),
        ]),
      ]
    : ["artifact: (none)"];
  return [
    `nextAction: ${output.nextAction}`,
    `voiceResponse: ${output.voiceResponse}`,
    ...artifactLines,
    `researchRequests: ${output.researchRequests.length}`,
    `mode: ${output.diagnostics.mode}`,
  ].join("\n");
}

export const planOrchestratorTurnV0 = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) => InputSchema.parse(input))
  .handler(async ({ data }) => {
    const apiKey = requireOpenAIKey();
    if (!apiKey) throw new Error("Missing OPENAI_API_KEY");
    const context = data.context as OrchestratorContextV0;
    const gateway = createOpenAIProvider(apiKey);
    const prompt = `${formatOrchestratorContextV0(context)}

Return OrchestratorOutputV0 JSON with this exact shape:
{
  "nextAction": "ask_user | update_canvas | request_research | draft_artifact | wait",
  "voiceResponse": "spoken response",
  "canvasArtifactView": null or {
    "artifactType": "prd | outline | decision_brief | research_plan",
    "title": "user-facing title",
    "sections": [
      { "id": "section_id", "heading": "user-facing section heading", "bullets": [], "sourceNodeIds": [], "status": "active" }
      { "id": "section_id", "heading": "user-facing section heading", "bullets": [], "children": [], "sourceNodeIds": [], "status": "active" }
    ],
    "activeSectionId": "section_id"
  },
  "canvasOps": [],
  "researchRequests": [],
  "exportArtifact": null,
  "diagnostics": { "mode": "artifact_proposal | artifact_scaffold | section_update | general_guidance", "rationale": "brief reason" }
}`;

    const startedAt = Date.now();
    try {
      const { text } = await generateText({
        model: gateway(normalizeAiModel(data.model)),
        system: buildOrchestratorSystemPromptV0(context),
        prompt,
      });
      const output = normalizeOutput(parseJsonObject(text), context);
      return {
        ...output,
        diagnostics: {
          ...output.diagnostics,
          rationale: output.diagnostics.rationale || `planned in ${Date.now() - startedAt}ms`,
        },
      };
    } catch (error) {
      return fallbackOutput(context, error instanceof Error ? error.message : String(error));
    }
  });
