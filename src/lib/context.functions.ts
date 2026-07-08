import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { getChatCompletionsConfig, normalizeAiModel, requireOpenAIKey } from "@/lib/ai-gateway.server";
import { isSupportedContextMime } from "@/lib/contextFiles";

const MAX_TEXT_BYTES = 200_000; // ~200KB plain text inlined
const MAX_BINARY_BYTES = 8_000_000; // ~8MB for PDF/image summarization

type ContextFile = {
  path: string;
  name: string;
  mime: string;
  size: number;
  summary: string;
  status: "summarized" | "skipped" | "error";
  error?: string;
};

async function summarizeWithGateway(args: {
  apiKey: string;
  name: string;
  mime: string;
  buffer: Uint8Array;
}): Promise<string> {
  const { apiKey, name, mime, buffer } = args;

  const userInstruction =
    `You are summarizing a document the user attached as context for a live brainstorming session. ` +
    `Extract the key facts, entities, decisions, and open questions in <= 250 words. ` +
    `Use compact bullets. No preamble.`;

  let userContent: any[];

  if (mime.startsWith("text/") || mime === "application/json" || mime === "application/xml") {
    let text = new TextDecoder("utf-8", { fatal: false }).decode(buffer);
    if (text.length > MAX_TEXT_BYTES) text = text.slice(0, MAX_TEXT_BYTES);
    userContent = [
      { type: "text", text: `${userInstruction}\n\nFile name: ${name}\n\n---\n${text}` },
    ];
  } else if (mime.startsWith("image/")) {
    const b64 = bufferToBase64(buffer);
    userContent = [
      { type: "text", text: `${userInstruction}\n\nFile name: ${name}` },
      { type: "image_url", image_url: { url: `data:${mime};base64,${b64}` } },
    ];
  } else if (mime === "application/pdf") {
    const b64 = bufferToBase64(buffer);
    userContent = [
      { type: "text", text: `${userInstruction}\n\nFile name: ${name}` },
      { type: "file", file: { filename: name, file_data: `data:application/pdf;base64,${b64}` } },
    ];
  } else {
    throw new Error(`Unsupported mime type for summarization: ${mime}`);
  }

  const chat = getChatCompletionsConfig(apiKey);
  const res = await fetch(chat.url, {
    method: "POST",
    headers: chat.headers,
    body: JSON.stringify({
      model: normalizeAiModel("openai/fast"),
      messages: [{ role: "user", content: userContent }],
      temperature: 0.2,
    }),
  });

  if (!res.ok) {
    const t = await res.text().catch(() => "");
    throw new Error(`OpenAI ${res.status}: ${t.slice(0, 300)}`);
  }
  const json: any = await res.json();
  const summary = json?.choices?.[0]?.message?.content;
  if (typeof summary !== "string" || !summary.trim()) {
    throw new Error("Empty summary from model");
  }
  return summary.trim();
}

function bufferToBase64(buf: Uint8Array): string {
  let binary = "";
  const chunk = 0x8000;
  for (let i = 0; i < buf.length; i += chunk) {
    binary += String.fromCharCode.apply(null, Array.from(buf.subarray(i, i + chunk)) as any);
  }
  // btoa is available in the Worker runtime.
  return btoa(binary);
}

export const summarizeContextFile = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) =>
    z
      .object({
        sessionId: z.string().uuid(),
        path: z.string().min(1),
        name: z.string().min(1).max(300),
        mime: z.string().min(1).max(200),
        size: z.number().int().nonnegative(),
      })
      .parse(input),
  )
  .handler(async ({ data, context }) => {
    const { supabase, userId } = context;

    // Verify the storage path is inside the user's folder.
    if (!data.path.startsWith(`${userId}/`)) {
      throw new Error("Path outside user scope");
    }

    // Verify the session belongs to the user (RLS will also enforce on update).
    const { data: sess, error: sessErr } = await supabase
      .from("sessions")
      .select("id, context_files")
      .eq("id", data.sessionId)
      .single();
    if (sessErr || !sess) throw new Error(sessErr?.message || "Session not found");

    const existing: ContextFile[] = Array.isArray(sess.context_files)
      ? (sess.context_files as ContextFile[])
      : [];

    // Skip if already attached (idempotent).
    if (existing.some((f) => f.path === data.path)) {
      return { ok: true, skipped: true };
    }

    const isSupported = isSupportedContextMime(data.mime);

    let entry: ContextFile;

    if (!isSupported || data.size > MAX_BINARY_BYTES) {
      entry = {
        path: data.path,
        name: data.name,
        mime: data.mime,
        size: data.size,
        summary: "",
        status: "skipped",
        error: !isSupported ? "Unsupported file type" : "File too large to summarize",
      };
    } else {
      try {
        const apiKey = requireOpenAIKey();
        if (!apiKey) throw new Error("Missing OPENAI_API_KEY");

        // Download via the user-scoped client (RLS on storage.objects enforces ownership).
        const { data: blob, error: dlErr } = await supabase.storage
          .from("session-context")
          .download(data.path);
        if (dlErr || !blob) throw new Error(dlErr?.message || "Download failed");

        const buffer = new Uint8Array(await blob.arrayBuffer());
        const summary = await summarizeWithGateway({
          apiKey: apiKey,
          name: data.name,
          mime: data.mime,
          buffer,
        });
        entry = {
          path: data.path,
          name: data.name,
          mime: data.mime,
          size: data.size,
          summary,
          status: "summarized",
        };
      } catch (e: any) {
        entry = {
          path: data.path,
          name: data.name,
          mime: data.mime,
          size: data.size,
          summary: "",
          status: "error",
          error: e?.message || "Summarization failed",
        };
      }
    }

    const next = [...existing, entry];
    const { error: updErr } = await supabase
      .from("sessions")
      .update({ context_files: next })
      .eq("id", data.sessionId);
    if (updErr) throw new Error(updErr.message);

    return { ok: true, entry };
  });
