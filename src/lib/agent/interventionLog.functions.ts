import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";

import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { THINKING_STATES } from "./thinkingState.functions";

const LogInput = z.object({
  sessionId: z.string().uuid(),
  segmentId: z.string().uuid().optional(),
  detectedState: z.enum(THINKING_STATES).optional(),
  stateConfidence: z.number().min(0).max(1).optional(),
  decision: z.enum(["silent", "text", "voice", "text_suggestion", "canvas_suggestion"]),
  responseText: z.string().optional(),
  lane: z.enum(["fast", "structural"]).default("structural"),
  intent: z.string().max(64).optional(),
});

const FeedbackInput = z.object({
  interventionId: z.string().uuid(),
  feedback: z.enum([
    "accepted",
    "ignored",
    "dismissed",
    "edited_after",
    "corrected",
    "requested_more",
  ]),
});

export const logIntervention = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) => LogInput.parse(input))
  .handler(async ({ data, context }) => {
    const { supabase } = context;
    // Normalize new decision names down to legacy enum values stored in the DB.
    const decision =
      data.decision === "text_suggestion" ? "text" :
      data.decision === "canvas_suggestion" ? "text" :
      data.decision;
    const { data: row, error } = await supabase
      .from("agent_interventions")
      .insert({
        session_id: data.sessionId,
        segment_id: data.segmentId ?? null,
        detected_state: data.detectedState ?? "thinking_continuing",
        state_confidence: data.stateConfidence ?? null,
        decision,
        response_text: data.responseText ?? null,
        lane: data.lane,
        intent: data.intent ?? null,
      })
      .select("id")
      .single();
    if (error) throw new Error(error.message);
    return { id: row.id as string };
  });

export const recordInterventionFeedback = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) => FeedbackInput.parse(input))
  .handler(async ({ data, context }) => {
    const { supabase } = context;
    const { error } = await supabase
      .from("agent_interventions")
      .update({ feedback: data.feedback })
      .eq("id", data.interventionId);
    if (error) throw new Error(error.message);
    return { ok: true };
  });
