import { createServerFn } from "@tanstack/react-start";
import { generateText } from "ai";
import { z } from "zod";

import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { createOpenAIProvider, normalizeAiModel, requireOpenAIKey } from "@/lib/ai-gateway.server";

const ArtifactSectionSchema = z.object({
  id: z.string().min(1).max(80),
  title: z.string().min(1).max(80),
  purpose: z.string().max(240).default(""),
  status: z.enum(["empty", "active", "filled"]).default("empty"),
  bodyBullets: z.array(z.string().min(1).max(180)).max(8).default([]),
  order: z.number().int().min(0).max(30),
});

const ArtifactSchema = z.object({
  id: z.string().min(1).max(80),
  type: z.string().min(1).max(80),
  title: z.string().min(1).max(140),
  sections: z.array(ArtifactSectionSchema).min(2).max(8),
});

const LastTurnSchema = z.object({
  transcript: z.string().max(8000).default(""),
  route: z.enum(["scaffold_generation", "section_update", "canvas_command", "fallback"]).default("fallback"),
  status: z.enum(["captured", "processing", "canvas_applied", "voice_replied", "failed"]).default("captured"),
  diagnostics: z.string().max(500).optional(),
});

const ArtifactSessionStateSchema = z.object({
  mode: z
    .enum(["idle", "scaffold_proposed", "scaffold_active", "section_filling", "canvas_editing", "artifact_export"])
    .default("idle"),
  artifact: ArtifactSchema.nullable().default(null),
  activeSectionId: z.string().max(80).nullable().default(null),
  lastTurn: LastTurnSchema.default({ transcript: "", route: "fallback", status: "captured" }),
});

const CanvasOpSchema = z.discriminatedUnion("action", [
  z.object({ action: z.literal("render_artifact"), artifact: ArtifactSchema }),
  z.object({ action: z.literal("update_section"), sectionId: z.string().min(1).max(80), bodyBullets: z.array(z.string().min(1).max(180)).max(8) }),
  z.object({ action: z.literal("add_section"), section: ArtifactSectionSchema }),
]);

const ArtifactTurnContractSchema = z.object({
  route: z.enum(["scaffold_generation", "section_update", "add_section", "canvas_command", "no_op"]),
  nextState: ArtifactSessionStateSchema,
  canvasOps: z.array(CanvasOpSchema).max(4).default([]),
  voiceReply: z.string().max(700).default(""),
  diagnostics: z.object({
    usedLLM: z.boolean().default(false),
    fallback: z.boolean().default(false),
    reason: z.string().max(500).default(""),
  }),
});

const InputSchema = z.object({
  userTurn: z.string().min(1).max(8000),
  currentState: ArtifactSessionStateSchema.optional(),
  recentTurns: z.array(z.string().max(1200)).max(8).default([]),
  canvasSnapshot: z.string().max(5000).default(""),
  model: z.string().default("openai/gpt-4o-mini"),
});

export type ArtifactSectionV2 = z.infer<typeof ArtifactSectionSchema>;
export type ArtifactV2 = z.infer<typeof ArtifactSchema>;
export type ArtifactSessionStateV2 = z.infer<typeof ArtifactSessionStateSchema>;
export type ArtifactTurnContractV2 = z.infer<typeof ArtifactTurnContractSchema>;

export const EMPTY_ARTIFACT_SESSION_STATE_V2: ArtifactSessionStateV2 = {
  mode: "idle",
  artifact: null,
  activeSectionId: null,
  lastTurn: { transcript: "", route: "fallback", status: "captured" },
};

function slugId(input: string, prefix = "section") {
  const slug = input
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9\u4e00-\u9fff]+/g, "_")
    .replace(/^_+|_+$/g, "")
    .slice(0, 48);
  return slug || prefix;
}

function normalizeState(input: unknown): ArtifactSessionStateV2 {
  const parsed = ArtifactSessionStateSchema.safeParse(input);
  return parsed.success ? parsed.data : EMPTY_ARTIFACT_SESSION_STATE_V2;
}

function normalizeArtifact(artifact: ArtifactV2): ArtifactV2 {
  const used = new Set<string>();
  const sections = artifact.sections
    .slice(0, 8)
    .map((section, index) => {
      const base = slugId(section.id || section.title, `section_${index + 1}`);
      let id = base;
      let suffix = 2;
      while (used.has(id)) id = `${base}_${suffix++}`;
      used.add(id);
      return {
        ...section,
        id,
        title: section.title.trim(),
        status: index === 0 ? "active" as const : section.status === "filled" ? "filled" as const : "empty" as const,
        bodyBullets: [],
        order: index,
      };
    });
  return {
    ...artifact,
    id: slugId(artifact.id || artifact.title, "artifact"),
    type: artifact.type.trim() || "artifact",
    title: artifact.title.trim(),
    sections,
  };
}

function textLooksSubstantive(text: string) {
  const trimmed = text.trim();
  if (trimmed.length < 12) return false;
  return !/^(你好|您好|hi|hello|谢谢|好的|ok|okay|嗯|啊)[。.!！?？\s]*$/i.test(trimmed);
}

function looksLikeNoisyTranscript(text: string) {
  const trimmed = text.trim();
  if (!trimmed) return true;
  const cjkCount = (trimmed.match(/[\u4e00-\u9fff]/g) ?? []).length;
  const lower = trimmed.toLowerCase();
  const knownNoise: string[] = ["weather", "temperature", "attendance", "venue", "island", "joshua"];
  if (cjkCount === 0 && knownNoise.some((word) => lower.includes(word))) return true;
  const words: string[] = lower.match(/[a-z]+/g) ?? [];
  const hasProductIntent = /product|app|artifact|proposal|research|prd|design|plan|canvas|section/.test(lower);
  return cjkCount === 0 && words.length >= 5 && !hasProductIntent && knownNoise.some((word) => words.includes(word));
}

function extractAddSectionTitle(text: string) {
  const normalized = text.replace(/\s+/g, " ").trim();
  const match = normalized.match(/(?:加|新增|添加|补一个|加一个)\s*(?:一个|一块|板块|section|部分)?\s*([^，。,.!?！？]+?)(?:\s*(?:section|板块|部分|模块))?(?:$|[，。,.!?！？])/i);
  const title = match?.[1]?.trim().replace(/^(叫|为|是)\s*/, "") ?? "";
  return title && title.length <= 40 ? title : "";
}

function fallbackContract(userTurn: string, state: ArtifactSessionStateV2, reason: string): ArtifactTurnContractV2 {
  return {
    route: "no_op",
    nextState: {
      ...state,
      lastTurn: { transcript: userTurn, route: "fallback", status: "failed", diagnostics: reason },
    },
    canvasOps: [],
    voiceReply: "我这句没有提炼清楚，你可以再说一遍最关键的判断吗？",
    diagnostics: { usedLLM: false, fallback: true, reason },
  };
}

async function generateScaffold(args: { gateway: ReturnType<typeof createOpenAIProvider>; model: string; userTurn: string; state: ArtifactSessionStateV2; recentTurns: string[] }) {
  const prompt = `Generate an artifact scaffold from the user's ambiguous idea.

User turn:
${args.userTurn}

Recent turns:
${args.recentTurns.map((turn) => `- ${turn}`).join("\n") || "(none)"}

Rules:
- Infer the most useful artifact type and section structure.
- Do not hard-code a PRD. Use the user's goal to decide.
- Return 3-6 sections.
- Section titles should be short and user-facing.
- Section bodies must be empty.
- Match the user's language.
- Return strict JSON only with shape:
{"artifact":{"id":"...","type":"...","title":"...","sections":[{"id":"...","title":"...","purpose":"...","status":"empty","bodyBullets":[],"order":0}]},"voiceReply":"..."}`;
  const { text } = await generateText({
    model: args.gateway(normalizeAiModel(args.model)),
    system: "Return strict JSON only. You design artifact scaffolds, not final answers.",
    prompt,
  });
  const parsed = z.object({ artifact: ArtifactSchema, voiceReply: z.string().max(700) }).parse(JSON.parse(text.slice(text.indexOf("{"), text.lastIndexOf("}") + 1)));
  const artifact = normalizeArtifact(parsed.artifact);
  const nextState: ArtifactSessionStateV2 = {
    mode: "scaffold_proposed",
    artifact,
    activeSectionId: artifact.sections[0]?.id ?? null,
    lastTurn: { transcript: args.userTurn, route: "scaffold_generation", status: "canvas_applied" },
  };
  return {
    route: "scaffold_generation" as const,
    nextState,
    canvasOps: [{ action: "render_artifact" as const, artifact }],
    voiceReply: parsed.voiceReply || `我建议先把这个想法搭成一个「${artifact.title}」结构。`,
    diagnostics: { usedLLM: true, fallback: false, reason: "generated scaffold" },
  } satisfies ArtifactTurnContractV2;
}

async function updateSection(args: { gateway: ReturnType<typeof createOpenAIProvider>; model: string; userTurn: string; state: ArtifactSessionStateV2 }) {
  const artifact = args.state.artifact;
  if (!artifact) return fallbackContract(args.userTurn, args.state, "no artifact to update");
  const prompt = `Extract artifact section bullets from the user's spoken turn.

Artifact: ${artifact.title}
Active section: ${args.state.activeSectionId ?? "(none)"}
Sections:
${artifact.sections.map((section) => `- ${section.id}: ${section.title} — ${section.purpose}`).join("\n")}

User turn:
${args.userTurn}

Rules:
- Choose the section where the content belongs.
- Return 1-4 concise bullets.
- Remove filler and hesitation.
- Do not copy transcript verbatim.
- Match user's language.
- Return strict JSON only:
{"sectionId":"...","bullets":["..."],"voiceReply":"..."}`;
  const { text } = await generateText({
    model: args.gateway(normalizeAiModel(args.model)),
    system: "Return strict JSON only. Extract section bullets from speech.",
    prompt,
  });
  const parsed = z.object({ sectionId: z.string().min(1).max(80), bullets: z.array(z.string().min(1).max(180)).min(1).max(4), voiceReply: z.string().max(700).default("") }).parse(JSON.parse(text.slice(text.indexOf("{"), text.lastIndexOf("}") + 1)));
  const sectionId = artifact.sections.some((section) => section.id === parsed.sectionId) ? parsed.sectionId : args.state.activeSectionId ?? artifact.sections[0].id;
  const nextSections = artifact.sections.map((section) => {
    if (section.id !== sectionId) return section;
    const merged = [...section.bodyBullets, ...parsed.bullets.map((bullet) => bullet.replace(/^[-•]\s*/, "").trim()).filter(Boolean)];
    return { ...section, status: "filled" as const, bodyBullets: Array.from(new Set(merged)).slice(0, 8) };
  });
  const nextState: ArtifactSessionStateV2 = {
    mode: "section_filling",
    artifact: { ...artifact, sections: nextSections },
    activeSectionId: sectionId,
    lastTurn: { transcript: args.userTurn, route: "section_update", status: "canvas_applied" },
  };
  return {
    route: "section_update" as const,
    nextState,
    canvasOps: [{ action: "update_section" as const, sectionId, bodyBullets: nextSections.find((section) => section.id === sectionId)?.bodyBullets ?? [] }],
    voiceReply: parsed.voiceReply || `我先把这点填到「${nextSections.find((section) => section.id === sectionId)?.title ?? sectionId}」。`,
    diagnostics: { usedLLM: true, fallback: false, reason: "extracted section bullets" },
  } satisfies ArtifactTurnContractV2;
}

function addSection(userTurn: string, state: ArtifactSessionStateV2, title: string): ArtifactTurnContractV2 {
  const artifact = state.artifact;
  if (!artifact) return fallbackContract(userTurn, state, "no artifact to add section to");
  const idBase = slugId(title, "custom_section");
  const used = new Set(artifact.sections.map((section) => section.id));
  let id = idBase;
  let suffix = 2;
  while (used.has(id)) id = `${idBase}_${suffix++}`;
  const section: ArtifactSectionV2 = {
    id,
    title,
    purpose: `补充「${title}」相关判断。`,
    status: "active",
    bodyBullets: [],
    order: artifact.sections.length,
  };
  const nextArtifact = { ...artifact, sections: [...artifact.sections.map((item) => ({ ...item, status: item.status === "active" ? "empty" as const : item.status })), section] };
  const nextState: ArtifactSessionStateV2 = {
    mode: "section_filling",
    artifact: nextArtifact,
    activeSectionId: id,
    lastTurn: { transcript: userTurn, route: "canvas_command", status: "canvas_applied" },
  };
  return {
    route: "add_section",
    nextState,
    canvasOps: [{ action: "add_section", section }],
    voiceReply: `好的，我加一个「${title}」section。接下来你说的内容会先填到这一块。`,
    diagnostics: { usedLLM: false, fallback: false, reason: "deterministic add section" },
  };
}

export const planArtifactTurnV2 = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) => InputSchema.parse(input))
  .handler(async ({ data }) => {
    const apiKey = requireOpenAIKey();
    if (!apiKey) throw new Error("Missing OPENAI_API_KEY");
    const gateway = createOpenAIProvider(apiKey);
    const state = normalizeState(data.currentState);
    const text = data.userTurn.trim();
    const addTitle = extractAddSectionTitle(text);
    try {
      if (looksLikeNoisyTranscript(text)) return fallbackContract(text, state, "recognition noise");
      if (state.artifact && addTitle) return addSection(text, state, addTitle);
      if (!state.artifact && textLooksSubstantive(text)) {
        return await generateScaffold({ gateway, model: data.model, userTurn: text, state, recentTurns: data.recentTurns });
      }
      if (state.artifact && textLooksSubstantive(text)) {
        return await updateSection({ gateway, model: data.model, userTurn: text, state });
      }
      return {
        route: "no_op" as const,
        nextState: { ...state, lastTurn: { transcript: text, route: "fallback" as const, status: "captured" as const, diagnostics: "non-substantive turn" } },
        canvasOps: [],
        voiceReply: /^(你好|您好|hi|hello)/i.test(text) ? "你好。" : "",
        diagnostics: { usedLLM: false, fallback: false, reason: "non-substantive turn" },
      } satisfies ArtifactTurnContractV2;
    } catch (error) {
      return fallbackContract(text, state, error instanceof Error ? error.message : String(error));
    }
  });
