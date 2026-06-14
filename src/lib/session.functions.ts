import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

export const listSessions = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { data, error } = await context.supabase
      .from("sessions")
      .select("id, title, status, started_at, ended_at")
      .order("started_at", { ascending: false })
      .limit(50);
    if (error) throw new Error(error.message);
    return data ?? [];
  });

export const createSession = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) =>
    z
      .object({
        title: z.string().optional(),
        prompt: z.string().max(8000).optional(),
      })
      .parse(input),
  )
  .handler(async ({ data, context }) => {
    const prompt = data.prompt?.trim() || "";
    const title =
      data.title?.trim() ||
      (prompt ? prompt.split(/\s+/).slice(0, 8).join(" ") : "Untitled session");
    const { data: row, error } = await context.supabase
      .from("sessions")
      .insert({
        user_id: context.userId,
        title,
        prompt,
      })
      .select("id, title, status, started_at, ended_at, prompt")
      .single();
    if (error) throw new Error(error.message);
    return row;
  });


export const endSession = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) =>
    z.object({ sessionId: z.string().uuid() }).parse(input),
  )
  .handler(async ({ data, context }) => {
    const { error } = await context.supabase
      .from("sessions")
      .update({ status: "ended", ended_at: new Date().toISOString() })
      .eq("id", data.sessionId);
    if (error) throw new Error(error.message);
    return { ok: true };
  });

export const renameSession = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) =>
    z.object({ sessionId: z.string().uuid(), title: z.string().min(1).max(120) }).parse(input),
  )
  .handler(async ({ data, context }) => {
    const { error } = await context.supabase
      .from("sessions")
      .update({ title: data.title.trim() })
      .eq("id", data.sessionId);
    if (error) throw new Error(error.message);
    return { ok: true };
  });
