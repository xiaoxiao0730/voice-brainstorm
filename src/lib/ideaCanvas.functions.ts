import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";

import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

const IdeaKind = z.enum(["focus", "idea", "question", "decision", "risk", "next"]);
const TextSize = z.enum(["small", "normal", "large"]);
const TextAlign = z.enum(["left", "center", "right"]);
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
      width?: number;
      height?: number;
      textSize?: z.infer<typeof TextSize>;
      bold?: boolean;
      italic?: boolean;
      textAlign?: z.infer<typeof TextAlign>;
    };
  }>;
  edges: Array<{
    id: string;
    source: string;
    target: string;
    type?: string;
    label?: string;
    animated?: boolean;
    data?: {
      routeOffset?: number;
    };
  }>;
};

type SupabaseLike = {
  from: (table: string) => {
    select: (columns: string) => {
      eq: (
        column: string,
        value: string,
      ) => {
        order: (
          column: string,
          options: { ascending: boolean },
        ) => Promise<{ data: unknown[] | null; error: { message: string } | null }>;
      };
    };
    delete: () => {
      eq: (column: string, value: string) => Promise<{ error: { message: string } | null }>;
    };
    insert: (rows: unknown[]) => Promise<{ error: { message: string } | null }>;
  };
};

type CanvasNodeRow = {
  id?: unknown;
  type?: unknown;
  position_x?: unknown;
  position_y?: unknown;
  title?: unknown;
  body?: unknown;
  kind?: unknown;
  width?: unknown;
  height?: unknown;
  text_style?: {
    size?: unknown;
    bold?: unknown;
    italic?: unknown;
    align?: unknown;
  } | null;
};

type CanvasEdgeRow = {
  id?: unknown;
  source?: unknown;
  target?: unknown;
  type?: unknown;
  label?: unknown;
  animated?: unknown;
  style?: {
    routeOffset?: unknown;
  } | null;
};

function asSupabaseLike(value: unknown) {
  return value as SupabaseLike;
}

function asText(value: unknown, fallback = "") {
  return typeof value === "string" ? value : fallback;
}

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
    width: z.number().min(120).max(800).optional(),
    height: z.number().min(80).max(800).optional(),
    textSize: TextSize.optional(),
    bold: z.boolean().optional(),
    italic: z.boolean().optional(),
    textAlign: TextAlign.optional(),
  }),
});

const EdgeSchema = z.object({
  id: z.string().min(1).max(240),
  source: z.string().min(1).max(200),
  target: z.string().min(1).max(200),
  type: z.string().max(80).optional(),
  label: z.string().max(500).optional(),
  animated: z.boolean().optional(),
  data: z
    .object({
      routeOffset: z.number().min(-2000).max(2000).optional(),
    })
    .optional(),
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
    const supabase = asSupabaseLike(context.supabase);
    const { data: nodeRows, error: nodeError } = await supabase
      .from("idea_canvas_nodes")
      .select("*")
      .eq("session_id", data.sessionId)
      .order("created_at", { ascending: true });
    if (nodeError) throw new Error(nodeError.message);

    const { data: edgeRows, error: edgeError } = await supabase
      .from("idea_canvas_edges")
      .select("*")
      .eq("session_id", data.sessionId)
      .order("created_at", { ascending: true });
    if (edgeError) throw new Error(edgeError.message);

    const state: SerializableIdeaCanvasState = {
      nodes: (nodeRows ?? []).map((rawRow) => {
        const row = rawRow as CanvasNodeRow;
        const kind = IdeaKind.safeParse(row.kind);
        const textSize = TextSize.safeParse(row.text_style?.size);
        const textAlign = TextAlign.safeParse(row.text_style?.align);
        return {
          id: asText(row.id),
          type: asText(row.type, "ideaNode"),
          position: { x: Number(row.position_x ?? 0), y: Number(row.position_y ?? 0) },
          data: {
            title: asText(row.title),
            body: asText(row.body),
            kind: kind.success ? kind.data : "idea",
            width: Number(row.width ?? 0) || undefined,
            height: Number(row.height ?? 0) || undefined,
            textSize: textSize.success ? textSize.data : undefined,
            bold: typeof row.text_style?.bold === "boolean" ? row.text_style.bold : undefined,
            italic: typeof row.text_style?.italic === "boolean" ? row.text_style.italic : undefined,
            textAlign: textAlign.success ? textAlign.data : undefined,
          },
        };
      }),
      edges: (edgeRows ?? []).map((rawRow) => {
        const row = rawRow as CanvasEdgeRow;
        return {
          id: asText(row.id),
          source: asText(row.source),
          target: asText(row.target),
          type: typeof row.type === "string" ? row.type : undefined,
          label: typeof row.label === "string" ? row.label : undefined,
          animated: !!row.animated,
          data:
            typeof row.style?.routeOffset === "number"
              ? { routeOffset: row.style.routeOffset }
              : undefined,
        };
      }),
    };

    return state;
  });

export const saveIdeaCanvas = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) => CanvasSchema.parse(input))
  .handler(async ({ data, context }) => {
    const supabase = asSupabaseLike(context.supabase);
    const nodeIds = new Set(data.nodes.map((node) => node.id));
    const edges = data.edges.filter((edge) => nodeIds.has(edge.source) && nodeIds.has(edge.target));

    const { error: deleteEdgesError } = await supabase
      .from("idea_canvas_edges")
      .delete()
      .eq("session_id", data.sessionId);
    if (deleteEdgesError) throw new Error(deleteEdgesError.message);

    const { error: deleteNodesError } = await supabase
      .from("idea_canvas_nodes")
      .delete()
      .eq("session_id", data.sessionId);
    if (deleteNodesError) throw new Error(deleteNodesError.message);

    if (data.nodes.length > 0) {
      const nodeRowsWithSize = data.nodes.map((node) => ({
        session_id: data.sessionId,
        id: node.id,
        type: node.type ?? "ideaNode",
        position_x: node.position.x,
        position_y: node.position.y,
        title: node.data.title ?? "",
        body: node.data.body ?? "",
        kind: node.data.kind ?? "idea",
        width: node.data.width ?? null,
        height: node.data.height ?? null,
        text_style: {
          size: node.data.textSize ?? "normal",
          bold: node.data.bold ?? false,
          italic: node.data.italic ?? false,
          align: node.data.textAlign ?? "left",
        },
      }));
      const { error: nodeError } = await supabase
        .from("idea_canvas_nodes")
        .insert(nodeRowsWithSize);
      if (nodeError) {
        const missingSizeColumn =
          nodeError.message.toLowerCase().includes("width") ||
          nodeError.message.toLowerCase().includes("height") ||
          nodeError.message.toLowerCase().includes("text_style");
        if (!missingSizeColumn) throw new Error(nodeError.message);

        const { error: fallbackNodeError } = await supabase.from("idea_canvas_nodes").insert(
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
        if (fallbackNodeError) throw new Error(fallbackNodeError.message);
      }
    }

    if (edges.length > 0) {
      const { error: edgeError } = await supabase.from("idea_canvas_edges").insert(
        edges.map((edge) => ({
          session_id: data.sessionId,
          id: edge.id,
          source: edge.source,
          target: edge.target,
          type: edge.type ?? null,
          label: typeof edge.label === "string" ? edge.label : null,
          animated: edge.animated ?? false,
          style: {
            ...(edge.style ?? {}),
            ...(typeof edge.data?.routeOffset === "number"
              ? { routeOffset: edge.data.routeOffset }
              : {}),
          },
          marker_end: edge.markerEnd ?? null,
        })),
      );
      if (edgeError) throw new Error(edgeError.message);
    }

    return { ok: true, nodes: data.nodes.length, edges: edges.length };
  });
