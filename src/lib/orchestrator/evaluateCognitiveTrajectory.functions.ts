import { createServerFn } from "@tanstack/react-start";
import { generateText } from "ai";
import { z } from "zod";

import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { createOpenAIProvider, normalizeAiModel, requireOpenAIKey } from "@/lib/ai-gateway.server";

const CognitiveStateSchema = z.enum(["S0", "S1", "S2", "S3", "unclear"]);

const FailureTagSchema = z.enum([
  "RAW_TRANSCRIPT_LEAK",
  "MISSING_S0_DESCRIPTION",
  "MISSING_S1_CONTEXT",
  "MISSING_S2_REASONING",
  "MISSING_S3_ACTION",
  "WRONG_LAYER_ASSIGNMENT",
  "FLAT_CARD_LIST",
  "GENERIC_AGENT_QUESTION",
  "PREMATURE_FEATURE_JUMP",
  "LOW_FIDELITY",
  "OVER_GENERATION",
  "NO_TRANSITION_PROGRESS",
  "NO_DRIFT_RECOVERY",
]);

const ScoreSchema = z.number().min(1).max(5).default(3);

const CanvasCardSchema = z.object({
  title: z.string().max(200).default(""),
  body: z.string().max(1200).default(""),
  kind: z.string().max(80).default(""),
});

const InputSchema = z.object({
  rawTranscript: z.string().max(12000).default(""),
  turns: z.array(z.string().max(3000)).max(20).default([]),
  agentReplies: z.array(z.string().max(3000)).max(20).default([]),
  canvasCards: z.array(CanvasCardSchema).max(80).default([]),
  finalArtifact: z.string().max(12000).default(""),
  expectedOutcome: z.string().max(8000).default(""),
  model: z.string().default("openai/gpt-4o-mini"),
});

const ClusterAssessmentSchema = z.object({
  cluster: z.string().max(120).default(""),
  initialState: CognitiveStateSchema.default("unclear"),
  finalState: CognitiveStateSchema.default("unclear"),
  evidence: z.string().max(500).default(""),
  issue: z.string().max(300).default(""),
});

const OutputSchema = z.object({
  layerScores: z.object({
    S0_descriptive: ScoreSchema,
    S1_contextual: ScoreSchema,
    S2_analytical: ScoreSchema,
    S3_actionable: ScoreSchema,
  }),
  transitionScores: z.object({
    S0_to_S1: ScoreSchema,
    S1_to_S2: ScoreSchema,
    S2_to_S3: ScoreSchema,
    drift_recovery: ScoreSchema,
  }),
  qualityScores: z.object({
    fidelity: ScoreSchema,
    structure: ScoreSchema,
    reasoning: ScoreSchema,
    actionability: ScoreSchema,
    cognitive_load: ScoreSchema,
  }),
  overall: ScoreSchema,
  pass: z.boolean().default(false),
  failureTags: z.array(FailureTagSchema).max(8).default([]),
  clusterAssessments: z.array(ClusterAssessmentSchema).max(8).default([]),
  summary: z.string().max(700).default(""),
  recommendedFix: z.string().max(500).default(""),
});

export type CognitiveTrajectoryEvaluation = z.infer<typeof OutputSchema>;

const SYSTEM = `You are a COGNITIVE TRAJECTORY EVALUATOR for a voice-first co-thinking canvas.

Your job is to judge whether the interaction helped the user move through four cognitive layers:
- S0 Descriptive: what happened, observed facts, named options, interview notes.
- S1 Contextual: why it matters, situation, constraints, user intent, background, stakes.
- S2 Analytical: competing hypotheses, evidence strength, causal chain, tradeoff, root-cause or product judgment.
- S3 Actionable: concrete next step, MVP direction, validation question, success metric.

EVALUATION PRINCIPLES
- Score the trajectory, not the prettiness of the canvas.
- Reward correct layer assignment and evidence-grounded transitions.
- Penalize raw transcript leakage, flat lists, generic questions, and premature feature jumps.
- A high score requires S2 reasoning and S3 action that are grounded in the user's evidence.
- If expectedOutcome is provided, use it as the gold rubric. Do not require exact wording, but require the same product judgment and constraints.
- Do not over-reward volume. Fewer deeper clusters are better than many shallow cards.

SCORING
- 1 = absent or actively wrong.
- 2 = weak, generic, or mostly copied from transcript.
- 3 = partially present but incomplete.
- 4 = good, grounded, usable.
- 5 = excellent, precise, and clearly advances the user's thinking.

PASS THRESHOLD
- pass=true only if overall >= 4, S2_analytical >= 4, S3_actionable >= 4, and failureTags does not include RAW_TRANSCRIPT_LEAK, MISSING_S2_REASONING, MISSING_S3_ACTION, LOW_FIDELITY, or PREMATURE_FEATURE_JUMP.

Return strict JSON only matching the requested shape.`;

function extractJSON(raw: string): unknown {
  let cleaned = (raw ?? "").trim();
  const fence = cleaned.match(/```(?:json)?\s*([\s\S]*?)```/i);
  if (fence) cleaned = fence[1].trim();
  const first = cleaned.indexOf("{");
  const last = cleaned.lastIndexOf("}");
  if (first >= 0 && last > first) cleaned = cleaned.slice(first, last + 1);
  return JSON.parse(cleaned);
}

function fallbackEvaluation(reason: string): CognitiveTrajectoryEvaluation {
  return {
    layerScores: {
      S0_descriptive: 3,
      S1_contextual: 2,
      S2_analytical: 2,
      S3_actionable: 2,
    },
    transitionScores: {
      S0_to_S1: 2,
      S1_to_S2: 2,
      S2_to_S3: 2,
      drift_recovery: 3,
    },
    qualityScores: {
      fidelity: 3,
      structure: 2,
      reasoning: 2,
      actionability: 2,
      cognitive_load: 3,
    },
    overall: 2,
    pass: false,
    failureTags: ["NO_TRANSITION_PROGRESS"],
    clusterAssessments: [],
    summary: "Evaluation failed, so this conservative fallback marks the trajectory as not passing.",
    recommendedFix: reason,
  };
}

function formatCards(cards: Array<z.infer<typeof CanvasCardSchema>>) {
  if (!cards.length) return "(none)";
  return cards
    .map((card, index) => {
      const body = card.body.trim() ? ` — ${card.body.trim().slice(0, 500)}` : "";
      const kind = card.kind.trim() ? `[${card.kind.trim()}] ` : "";
      return `${index + 1}. ${kind}${card.title.trim()}${body}`;
    })
    .join("\n");
}

export const evaluateCognitiveTrajectory = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) => InputSchema.parse(input))
  .handler(async ({ data }) => {
    const apiKey = requireOpenAIKey();
    const gateway = createOpenAIProvider(apiKey);
    const prompt = `RAW TRANSCRIPT:
${data.rawTranscript || "(none)"}

USER TURNS:
${data.turns.length ? data.turns.map((turn, i) => `${i + 1}. ${turn}`).join("\n") : "(none)"}

AGENT REPLIES:
${data.agentReplies.length ? data.agentReplies.map((reply, i) => `${i + 1}. ${reply}`).join("\n") : "(none)"}

CANVAS CARDS:
${formatCards(data.canvasCards)}

FINAL ARTIFACT:
${data.finalArtifact || "(none)"}

EXPECTED OUTCOME / GOLD RUBRIC:
${data.expectedOutcome || "(none provided)"}

Evaluate the cognitive trajectory now.`;

    try {
      const { text } = await generateText({
        model: gateway(normalizeAiModel(data.model)),
        system: SYSTEM,
        temperature: 0,
        maxOutputTokens: 1400,
        prompt,
      });
      const parsed = OutputSchema.parse(extractJSON(text));
      const blockingFailures = new Set([
        "RAW_TRANSCRIPT_LEAK",
        "MISSING_S2_REASONING",
        "MISSING_S3_ACTION",
        "LOW_FIDELITY",
        "PREMATURE_FEATURE_JUMP",
      ]);
      const computedPass =
        parsed.overall >= 4 &&
        parsed.layerScores.S2_analytical >= 4 &&
        parsed.layerScores.S3_actionable >= 4 &&
        !parsed.failureTags.some((tag) => blockingFailures.has(tag));
      return { ...parsed, pass: computedPass } satisfies CognitiveTrajectoryEvaluation;
    } catch (error) {
      console.warn(
        "[evaluateCognitiveTrajectory] failed",
        error instanceof Error ? error.message : String(error),
      );
      return fallbackEvaluation(error instanceof Error ? error.message : String(error));
    }
  });
