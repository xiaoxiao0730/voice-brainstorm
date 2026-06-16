import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";

import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { THINKING_STATES } from "./thinkingState.functions";

const LogInput = z.object({
  sessionId: z.string().uuid(),
  segmentId: z.string().uuid().optional(),
  detectedState: z.enum(THINKING_STATES),
  stateConfidence: z.number().min(0).max(1).optional(),
  decision: z.enum(["silent", "text", "voice"]),
  responseText: z.string().optional(),
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
    const { data: row, error } = await supabase
      .from("agent_interventions")
      .insert({
        session_id: data.sessionId,
        segment_id: data.segmentId ?? null,
        detected_state: data.detectedState,
        state_confidence: data.stateConfidence ?? null,
        decision: data.decision,
        response_text: data.responseText ?? null,
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
