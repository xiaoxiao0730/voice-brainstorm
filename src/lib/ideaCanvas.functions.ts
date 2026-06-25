import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";

import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

const IdeaKind = z.enum(["focus", "idea", "question", "decision", "risk", "next"]);
type SerializableIdeaNodeKind = z.infer<typeof IdeaKind>;
type SerializableIdeaCanvasState = {
  nodes: Array<{
    id: string;
    type?: string;
    position: { x: number; y: number };
    data: {
      title: string;
      body?: string;
      kind: SerializableIdeaNodeKind;
    };
  }>;
  edges: Array<{
    id: string;
    source: string;
    target: string;
    type?: string;
    label?: string;
    animated?: boolean;
  }>;
};

const PositionSchema = z.object({
  x: z.number(),
  y: z.number(),
});

const NodeSchema = z.object({
  id: z.string().min(1).max(200),
  type: z.string().min(1).max(80).optional(),
  position: PositionSchema,
  data: z.object({
    title: z.string().max(500).default(""),
    body: z.string().max(5000).optional(),
    kind: IdeaKind.default("idea"),
  }),
});

const EdgeSchema = z.object({
  id: z.string().min(1).max(240),
  source: z.string().min(1).max(200),
  target: z.string().min(1).max(200),
  type: z.string().max(80).optional(),
  label: z.string().max(500).optional(),
  animated: z.boolean().optional(),
  style: z.record(z.string(), z.unknown()).optional(),
  markerEnd: z.unknown().optional(),
});

const CanvasSchema = z.object({
  sessionId: z.string().uuid(),
  nodes: z.array(NodeSchema).max(500),
  edges: z.array(EdgeSchema).max(1000),
});

export const loadIdeaCanvas = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) => z.object({ sessionId: z.string().uuid() }).parse(input))
  .handler(async ({ data, context }) => {
    const { data: nodeRows, error: nodeError } = await context.supabase
      .from("idea_canvas_nodes" as any)
      .select("*")
      .eq("session_id", data.sessionId)
      .order("created_at", { ascending: true });
    if (nodeError) throw new Error(nodeError.message);

    const { data: edgeRows, error: edgeError } = await context.supabase
      .from("idea_canvas_edges" as any)
      .select("*")
      .eq("session_id", data.sessionId)
      .order("created_at", { ascending: true });
    if (edgeError) throw new Error(edgeError.message);

    const state: SerializableIdeaCanvasState = {
      nodes: (nodeRows ?? []).map((row: any) => ({
        id: row.id,
        type: row.type ?? "ideaNode",
        position: { x: Number(row.position_x ?? 0), y: Number(row.position_y ?? 0) },
        data: {
          title: row.title ?? "",
          body: row.body ?? "",
          kind: IdeaKind.safeParse(row.kind).success ? row.kind : "idea",
        },
      })),
      edges: (edgeRows ?? []).map((row: any) => ({
        id: row.id,
        source: row.source,
        target: row.target,
        type: row.type ?? undefined,
        label: row.label ?? undefined,
        animated: !!row.animated,
      })),
    };

    return state;
  });

export const saveIdeaCanvas = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) => CanvasSchema.parse(input))
  .handler(async ({ data, context }) => {
    const nodeIds = new Set(data.nodes.map((node) => node.id));
    const edges = data.edges.filter((edge) => nodeIds.has(edge.source) && nodeIds.has(edge.target));

    const { error: deleteEdgesError } = await context.supabase
      .from("idea_canvas_edges" as any)
      .delete()
      .eq("session_id", data.sessionId);
    if (deleteEdgesError) throw new Error(deleteEdgesError.message);

    const { error: deleteNodesError } = await context.supabase
      .from("idea_canvas_nodes" as any)
      .delete()
      .eq("session_id", data.sessionId);
    if (deleteNodesError) throw new Error(deleteNodesError.message);

    if (data.nodes.length > 0) {
      const { error: nodeError } = await context.supabase.from("idea_canvas_nodes" as any).insert(
        data.nodes.map((node) => ({
          session_id: data.sessionId,
          id: node.id,
          type: node.type ?? "ideaNode",
          position_x: node.position.x,
          position_y: node.position.y,
          title: node.data.title ?? "",
          body: node.data.body ?? "",
          kind: node.data.kind ?? "idea",
        })),
      );
      if (nodeError) throw new Error(nodeError.message);
    }

    if (edges.length > 0) {
      const { error: edgeError } = await context.supabase.from("idea_canvas_edges" as any).insert(
        edges.map((edge) => ({
          session_id: data.sessionId,
          id: edge.id,
          source: edge.source,
          target: edge.target,
          type: edge.type ?? null,
          label: typeof edge.label === "string" ? edge.label : null,
          animated: edge.animated ?? false,
          style: edge.style ?? {},
          marker_end: edge.markerEnd ?? null,
        })),
      );
      if (edgeError) throw new Error(edgeError.message);
    }

    return { ok: true, nodes: data.nodes.length, edges: edges.length };
  });
