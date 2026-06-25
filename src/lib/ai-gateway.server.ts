// Server-only OpenAI-compatible provider helper.
import { createOpenAICompatible } from "@ai-sdk/openai-compatible";

export function requireOpenAIKey(): string {
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) throw new Error("Missing OPENAI_API_KEY");
  return apiKey;
}

export function normalizeAiModel(model?: string): string {
  const fast = process.env.AI_MODEL_FAST ?? "gpt-4o-mini";
  const deep = process.env.AI_MODEL_DEEP ?? "gpt-4o";
  if (!model || model === "openai/fast") return fast;
  if (model === "openai/deep") return deep;
  if (model.startsWith("openai/")) return model.replace(/^openai\//, "");
  if (model.includes("gemini-2.5-pro")) return deep;
  if (model.includes("gemini")) return fast;
  return model;
}

export function createOpenAIProvider(apiKey = requireOpenAIKey()) {
  return createOpenAICompatible({
    name: "openai",
    baseURL: "https://api.openai.com/v1",
    headers: {
      Authorization: `Bearer ${apiKey}`,
    },
  });
}

export function getChatCompletionsConfig(apiKey = requireOpenAIKey()): {
  url: string;
  headers: Record<string, string>;
} {
  return {
    url: "https://api.openai.com/v1/chat/completions",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${apiKey}`,
    },
  };
}
