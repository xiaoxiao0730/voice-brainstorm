import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import type { BriefNode } from "./pipeline/types";

const NodeLevel = z.enum(["h1", "h2", "bullet"]);
const NodeStatus = z.enum(["ai_draft", "user_confirmed"]);
const NodeEditor = z.enum(["ai", "user"]);

const BoundaryReason = z.enum(["word_count", "char_count", "time", "silence", "manual_stop"]);

export const loadTranscript = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) =>
    z.object({ sessionId: z.string().uuid() }).parse(input),
  )
  .handler(async ({ data, context }) => {
    const { data: rows, error } = await context.supabase
      .from("transcript_chunks")
      .select("id,text,is_final,start_ms,end_ms,lang,created_at")
      .eq("session_id", data.sessionId)
      .order("created_at", { ascending: true })
      .order("start_ms", { ascending: true });
    if (error) throw new Error(error.message);

    return (rows ?? []).map((row: any) => ({
      id: row.id as string,
      text: row.text as string,
      isFinal: !!row.is_final,
      startMs: Number(row.start_ms ?? 0),
      endMs: Number(row.end_ms ?? 0),
      lang: row.lang as string | null,
      createdAt: row.created_at as string,
    }));
  });

export const loadBrief = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) =>
    z.object({ sessionId: z.string().uuid() }).parse(input),
  )
  .handler(async ({ data, context }) => {
    const { data: rows, error } = await context.supabase
      .from("brief_nodes")
      .select("*")
      .eq("session_id", data.sessionId)
      .order("order_key", { ascending: true });
    if (error) throw new Error(error.message);
    const nodes: BriefNode[] = (rows ?? []).map((r: any) => ({
      id: r.id,
      sessionId: r.session_id,
      parentId: r.parent_id,
      orderKey: r.order_key,
      level: r.level,
      text: r.text,
      status: r.status,
      lastEditedBy: r.last_edited_by,
      sourceChunkIds: r.source_chunk_ids ?? [],
      confidence: r.confidence,
      tag: r.tag,
      slotId: r.slot_id ?? null,
      isPending: !!r.is_pending,
      rationale: r.rationale ?? null,
    }));
    return nodes;
  });

export const upsertBriefNode = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) =>
    z
      .object({
        id: z.string().uuid(),
        sessionId: z.string().uuid(),
        parentId: z.string().uuid().nullable(),
        orderKey: z.string(),
        level: NodeLevel,
        text: z.string(),
        status: NodeStatus,
        lastEditedBy: NodeEditor,
        sourceChunkIds: z.array(z.string()).default([]),
        confidence: z.number().nullable().optional(),
        tag: z.string().nullable().optional(),
        slotId: z.string().nullable().optional(),
        isPending: z.boolean().optional(),
        rationale: z.string().nullable().optional(),
      })
      .parse(input),
  )
  .handler(async ({ data, context }) => {
    const { data: existing, error: existingError } = await context.supabase
      .from("brief_nodes")
      .select("session_id")
      .eq("id", data.id)
      .maybeSingle();
    if (existingError) throw new Error(existingError.message);
    if (existing && existing.session_id !== data.sessionId) {
      throw new Error("Refusing to move a brief node across sessions.");
    }

    const row = {
      id: data.id,
      session_id: data.sessionId,
      parent_id: data.parentId,
      order_key: data.orderKey,
      level: data.level,
      text: data.text,
      status: data.status,
      last_edited_by: data.lastEditedBy,
      source_chunk_ids: data.sourceChunkIds,
      confidence: data.confidence ?? null,
      tag: data.tag ?? null,
      slot_id: data.slotId ?? null,
      is_pending: data.isPending ?? false,
      rationale: data.rationale ?? null,
    } as any;

    if (existing) {
      const { error } = await context.supabase
        .from("brief_nodes")
        .update(row)
        .eq("id", data.id)
        .eq("session_id", data.sessionId);
      if (error) throw new Error(error.message);
    } else {
      const { error } = await context.supabase.from("brief_nodes").insert(row);
      if (error) throw new Error(error.message);
    }
    return { ok: true };
  });

export const deleteBriefNode = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) =>
    z.object({ id: z.string().uuid(), sessionId: z.string().uuid() }).parse(input),
  )
  .handler(async ({ data, context }) => {
    const { error } = await context.supabase
      .from("brief_nodes")
      .delete()
      .eq("id", data.id)
      .eq("session_id", data.sessionId);
    if (error) throw new Error(error.message);
    return { ok: true };
  });

export const acceptPendingBlock = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) =>
    z.object({ id: z.string().uuid(), sessionId: z.string().uuid() }).parse(input),
  )
  .handler(async ({ data, context }) => {
    const { error } = await context.supabase
      .from("brief_nodes")
      .update({ is_pending: false, status: "user_confirmed", last_edited_by: "user" } as any)
      .eq("id", data.id)
      .eq("session_id", data.sessionId);
    if (error) throw new Error(error.message);
    return { ok: true };
  });

export const persistChunks = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) =>
    z
      .object({
        sessionId: z.string().uuid(),
        chunks: z.array(
          z.object({
            id: z.string().uuid(),
            text: z.string(),
            isFinal: z.boolean(),
            startMs: z.number().int().min(0),
            endMs: z.number().int().min(0),
            lang: z.string().optional(),
          }),
        ),
      })
      .parse(input),
  )
  .handler(async ({ data, context }) => {
    if (data.chunks.length === 0) return { ok: true };
    const { error } = await context.supabase.from("transcript_chunks").upsert(
      data.chunks.map((c) => ({
        id: c.id,
        session_id: data.sessionId,
        text: c.text,
        is_final: c.isFinal,
        start_ms: c.startMs,
        end_ms: c.endMs,
        lang: c.lang ?? null,
      })),
    );
    if (error) throw new Error(error.message);
    return { ok: true };
  });

export const persistSegment = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) =>
    z
      .object({
        segmentId: z.string().uuid(),
        sessionId: z.string().uuid(),
        chunkIds: z.array(z.string().uuid()),
        rawText: z.string(),
        startTimeMs: z.number().int().min(0),
        endTimeMs: z.number().int().min(0),
        boundaryReason: BoundaryReason,
      })
      .parse(input),
  )
  .handler(async ({ data, context }) => {
    const { error } = await context.supabase.from("transcript_segments").insert({
      id: data.segmentId,
      session_id: data.sessionId,
      chunk_ids: data.chunkIds,
      raw_text: data.rawText,
      start_ms: data.startTimeMs,
      end_ms: data.endTimeMs,
      boundary_reason: data.boundaryReason,
    });
    if (error) throw new Error(error.message);
    return { ok: true };
  });
