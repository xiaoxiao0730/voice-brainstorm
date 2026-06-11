import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import type { BriefNode } from "./pipeline/types";

const NodeLevel = z.enum(["h1", "h2", "bullet"]);
const NodeStatus = z.enum(["ai_draft", "user_confirmed"]);
const NodeEditor = z.enum(["ai", "user"]);

const BoundaryReason = z.enum(["word_count", "char_count", "time", "silence", "manual_stop"]);

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
    const nodes: BriefNode[] = (rows ?? []).map((r) => ({
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
      })
      .parse(input),
  )
  .handler(async ({ data, context }) => {
    const { error } = await context.supabase.from("brief_nodes").upsert({
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
    });
    if (error) throw new Error(error.message);
    return { ok: true };
  });

export const deleteBriefNode = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) =>
    z.object({ id: z.string().uuid() }).parse(input),
  )
  .handler(async ({ data, context }) => {
    const { error } = await context.supabase.from("brief_nodes").delete().eq("id", data.id);
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
