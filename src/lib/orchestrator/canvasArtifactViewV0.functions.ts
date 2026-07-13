import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";

import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import {
  CanvasArtifactViewV0Schema,
  type CanvasArtifactViewV0,
} from "@/lib/orchestrator/orchestratorV0.functions";

type SupabaseLike = {
  from: (table: string) => {
    select: (columns: string) => {
      eq: (
        column: string,
        value: string,
      ) => {
        maybeSingle: () => Promise<{
          data: { artifact_view?: unknown } | null;
          error: { message: string } | null;
        }>;
      };
    };
    upsert: (row: unknown) => Promise<{ error: { message: string } | null }>;
  };
};

const LoadCanvasArtifactViewV0Schema = z.object({
  sessionId: z.string().uuid(),
});

const SaveCanvasArtifactViewV0Schema = z.object({
  sessionId: z.string().uuid(),
  artifactView: CanvasArtifactViewV0Schema,
});

function asSupabaseLike(value: unknown) {
  return value as SupabaseLike;
}

export const loadCanvasArtifactViewV0 = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) => LoadCanvasArtifactViewV0Schema.parse(input))
  .handler(async ({ data, context }): Promise<CanvasArtifactViewV0 | null> => {
    const supabase = asSupabaseLike(context.supabase);
    const { data: row, error } = await supabase
      .from("session_canvas_artifact_v0")
      .select("artifact_view")
      .eq("session_id", data.sessionId)
      .maybeSingle();
    if (error) throw new Error(error.message);
    if (!row?.artifact_view) return null;

    const parsed = CanvasArtifactViewV0Schema.safeParse(row.artifact_view);
    if (!parsed.success) {
      console.warn("[canvasArtifactViewV0] invalid persisted artifact view", parsed.error.flatten());
      return null;
    }
    return parsed.data;
  });

export const saveCanvasArtifactViewV0 = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) => SaveCanvasArtifactViewV0Schema.parse(input))
  .handler(async ({ data, context }) => {
    const supabase = asSupabaseLike(context.supabase);
    const { error } = await supabase.from("session_canvas_artifact_v0").upsert({
      session_id: data.sessionId,
      artifact_view: data.artifactView,
    });
    if (error) throw new Error(error.message);

    return { ok: true };
  });
