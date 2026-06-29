// Grounded web research note for a query.
//
// Primary path: OpenAI Responses API with web_search_preview, using
// OPENAI_API_KEY. Fallback path: the workspace's Azure model notes, so local
// environments without public OpenAI web search remain usable.

import { createServerFn } from "@tanstack/react-start";
import { generateText } from "ai";
import { z } from "zod";

import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { createOpenAIProvider, normalizeAiModel, requireOpenAIKey } from "@/lib/ai-gateway.server";

const InputSchema = z.object({
  query: z.string().min(1),
  model: z.string().default("google/gemini-3-flash-preview"),
});

const SYSTEM_BASE = `You are a research assistant collecting concise notes for a co-thinking workbench. Produce DENSE plain-text notes for the given query. Include concrete facts, named entities, numbers, and any well-known sources. If you're uncertain about freshness or accuracy, say so explicitly. If you do not actually know something, write "uncertain" rather than guessing. No fluff, no preamble — just the notes.`;

function buildSystem(): string {
  const now = new Date();
  const dateStr = now.toLocaleDateString(undefined, {
    weekday: "long",
    year: "numeric",
    month: "long",
    day: "numeric",
  });
  const isoDate = now.toISOString().slice(0, 10);
  return `TIME ANCHOR (authoritative): today is ${dateStr} (${isoDate}). Treat any event after this date as future/unknown. Do not invent holidays or recent events.\n\n${SYSTEM_BASE}`;
}

type ResponseContent = {
  type?: unknown;
  text?: unknown;
  annotations?: unknown;
};

type ResponseOutput = {
  type?: unknown;
  content?: unknown;
};

function collectResponseText(value: unknown) {
  const root = value as { output_text?: unknown; output?: unknown };
  if (typeof root.output_text === "string" && root.output_text.trim())
    return root.output_text.trim();

  const parts: string[] = [];
  const outputs = Array.isArray(root.output) ? (root.output as ResponseOutput[]) : [];
  for (const output of outputs) {
    const content = Array.isArray(output.content) ? (output.content as ResponseContent[]) : [];
    for (const item of content) {
      if (typeof item.text === "string" && item.text.trim()) parts.push(item.text.trim());
    }
  }
  return parts.join("\n\n").trim();
}

function collectResponseSources(value: unknown) {
  const root = value as { output?: unknown };
  const sources = new Map<string, string>();
  const outputs = Array.isArray(root.output) ? (root.output as ResponseOutput[]) : [];
  for (const output of outputs) {
    const content = Array.isArray(output.content) ? (output.content as ResponseContent[]) : [];
    for (const item of content) {
      const annotations = Array.isArray(item.annotations) ? item.annotations : [];
      for (const raw of annotations) {
        const ann = raw as { type?: unknown; title?: unknown; url?: unknown };
        if (typeof ann.url !== "string" || !ann.url.trim()) continue;
        const title =
          typeof ann.title === "string" && ann.title.trim() ? ann.title.trim() : ann.url.trim();
        sources.set(ann.url.trim(), title);
      }
    }
  }
  return Array.from(sources.entries()).map(([url, title]) => ({ title, url }));
}

async function searchWithOpenAIResponses(query: string) {
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) throw new Error("Missing OPENAI_API_KEY for grounded web search");

  const model = process.env.OPENAI_WEB_SEARCH_MODEL || "gpt-4.1-mini";
  const response = await fetch("https://api.openai.com/v1/responses", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model,
      tools: [{ type: "web_search_preview" }],
      input: [
        { role: "system", content: buildSystem() },
        {
          role: "user",
          content: `Search the web for this query and produce concise research notes with citations when available.\n\nQuery: ${query}`,
        },
      ],
    }),
  });

  if (!response.ok) {
    const body = await response.text().catch(() => "");
    throw new Error(`OpenAI web search failed (${response.status}): ${body.slice(0, 800)}`);
  }

  const json = (await response.json()) as unknown;
  const text = collectResponseText(json);
  const sources = collectResponseSources(json);
  const sourceNotes = sources.length
    ? `\n\nSources:\n${sources.map((source) => `- ${source.title}: ${source.url}`).join("\n")}`
    : "";
  return `${text}${sourceNotes}`.trim();
}

async function fallbackModelNotes(query: string, model: string) {
  const key = requireOpenAIKey();
  const gateway = createOpenAIProvider(key);
  const { text } = await generateText({
    model: gateway(normalizeAiModel(model)),
    system: buildSystem(),
    prompt: `Query: ${query}\n\nWrite the research notes now.`,
  });
  return text.trim();
}

export const webSearch = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) => InputSchema.parse(input))
  .handler(async ({ data }) => {
    try {
      const notes = await searchWithOpenAIResponses(data.query);
      return { ok: true as const, notes, grounded: true as const };
    } catch (e) {
      const message = e instanceof Error ? e.message : String(e);
      console.warn("[webSearch] grounded search failed; falling back", message);
      try {
        const notes = await fallbackModelNotes(data.query, data.model);
        return { ok: true as const, notes, grounded: false as const, warning: message };
      } catch (fallbackError) {
        const fallbackMessage =
          fallbackError instanceof Error ? fallbackError.message : String(fallbackError);
        console.warn("[webSearch] fallback failed", fallbackMessage);
        return { ok: false as const, notes: "", error: `${message}\n${fallbackMessage}` };
      }
    }
  });
