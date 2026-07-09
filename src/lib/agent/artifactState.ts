import { z } from "zod";

export const ARTIFACT_MODES = [
  "none",
  "artifact_proposal",
  "artifact_scaffolding",
  "section_filling",
  "artifact_export",
] as const;

export const PRD_SECTION_IDS = [
  "target_user",
  "user_need",
  "core_features",
  "market_research",
] as const;

export const ArtifactModeSchema = z.enum(ARTIFACT_MODES);
export const PrdSectionIdSchema = z.enum(PRD_SECTION_IDS);

export const ArtifactSectionSchema = z.object({
  id: z.string().min(1).max(80),
  title: z.string().max(80),
  status: z.enum(["empty", "active", "filled"]).default("empty"),
  body: z.string().max(1200).default(""),
  guidingQuestion: z.string().max(500).default(""),
});

export const ArtifactStateSchema = z.object({
  mode: ArtifactModeSchema.default("none"),
  artifactType: z.enum(["prd"]).default("prd"),
  artifactTitle: z.string().max(120).default(""),
  sections: z.array(ArtifactSectionSchema).default([]),
  activeSectionId: z.string().max(80).default(""),
});

export type ArtifactMode = z.infer<typeof ArtifactModeSchema>;
export type PrdSectionId = z.infer<typeof PrdSectionIdSchema>;
export type ArtifactSection = z.infer<typeof ArtifactSectionSchema>;
export type ArtifactState = z.infer<typeof ArtifactStateSchema>;

export const PRD_SECTION_DEFS: Array<Pick<ArtifactSection, "id" | "title" | "guidingQuestion">> = [
  {
    id: "target_user",
    title: "目标用户",
    guidingQuestion: "谁在学习？他们现在怎么学习？在哪个环节遇到困难？",
  },
  {
    id: "user_need",
    title: "用户需求",
    guidingQuestion: "学生最需要 AI 帮助的是理解概念、发现漏洞、练习应用，还是复盘思考？",
  },
  {
    id: "core_features",
    title: "核心功能",
    guidingQuestion: "什么机制能让学生从获得答案走向真正理解和应用？",
  },
  {
    id: "market_research",
    title: "市场调研",
    guidingQuestion: "现有 AI tutor、问答工具、学习平台分别解决了什么，缺口在哪里？",
  },
];

export const EMPTY_ARTIFACT_STATE: ArtifactState = {
  mode: "none",
  artifactType: "prd",
  artifactTitle: "",
  sections: [],
  activeSectionId: "",
};

export function createPrdArtifactState(input: Partial<ArtifactState> = {}): ArtifactState {
  const currentSections = new Map(
    (input.sections ?? []).map((section) => [section.id, section] as const),
  );
  const activeSectionId = input.activeSectionId || "target_user";
  const defaultSections = PRD_SECTION_DEFS.map((def) => {
    const existing = currentSections.get(def.id);
    return {
      id: def.id,
      title: def.title,
      status:
        existing?.status ?? (def.id === activeSectionId ? "active" : "empty"),
      body: existing?.body ?? "",
      guidingQuestion: def.guidingQuestion,
    } satisfies ArtifactSection;
  });
  const defaultIds = new Set(PRD_SECTION_IDS);
  const customSections = (input.sections ?? [])
    .filter((section) => !defaultIds.has(section.id as PrdSectionId) && section.title.trim())
    .map((section) => ({
      id: section.id,
      title: section.title.trim(),
      status: section.status ?? (section.id === activeSectionId ? "active" : "empty"),
      body: section.body ?? "",
      guidingQuestion: section.guidingQuestion ?? "",
    } satisfies ArtifactSection));
  const sections = [...defaultSections, ...customSections];

  return ArtifactStateSchema.parse({
    mode: input.mode ?? "artifact_proposal",
    artifactType: "prd",
    artifactTitle: input.artifactTitle || "AI 学习产品 PRD",
    sections,
    activeSectionId,
  });
}

export function normalizeArtifactState(value: unknown): ArtifactState {
  const parsed = ArtifactStateSchema.safeParse(value);
  if (!parsed.success) return EMPTY_ARTIFACT_STATE;
  if (parsed.data.mode === "none") return { ...EMPTY_ARTIFACT_STATE };
  return createPrdArtifactState(parsed.data);
}

export function sectionTitleForId(sectionId: string) {
  return PRD_SECTION_DEFS.find((section) => section.id === sectionId)?.title ?? sectionId;
}

export function nextPrdSectionId(sectionId: string): PrdSectionId {
  const index = PRD_SECTION_IDS.indexOf(sectionId as PrdSectionId);
  return PRD_SECTION_IDS[Math.min(index + 1, PRD_SECTION_IDS.length - 1)] ?? "target_user";
}

export function formatArtifactState(state: ArtifactState) {
  const s = normalizeArtifactState(state);
  if (s.mode === "none") return "artifact: (none)";
  const sections = s.sections
    .map((section) => {
      const marker = section.id === s.activeSectionId ? "*" : "-";
      const body = section.body.trim() ? ` — ${section.body.trim().slice(0, 160)}` : "";
      return `${marker} ${section.title} [${section.status}]${body}`;
    })
    .join("\n");
  return [
    `artifact_mode: ${s.mode}`,
    `artifact_type: ${s.artifactType}`,
    `artifact_title: ${s.artifactTitle}`,
    `active_section: ${sectionTitleForId(s.activeSectionId)}`,
    "sections:",
    sections || "- (none)",
  ].join("\n");
}
