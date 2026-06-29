// Server-only AI provider helper.
//
// Routed to AZURE OpenAI (the OpenAI public API is not reachable from this
// network without a proxy/VPN; Azure is). All server functions call
// createOpenAIProvider() + normalizeAiModel() — switching the provider here
// re-routes every call (refineToCard, summarizeCards, connectCards,
// generateMindMap, thoughtTurnContract, …) with no per-function change.
import { createAzure } from "@ai-sdk/azure";

export function requireOpenAIKey(): string {
  // Kept for signature compatibility with existing call sites. Azure uses its
  // own key; we surface a clear error if Azure isn't configured.
  const apiKey = process.env.AZURE_OPENAI_API_KEY;
  if (!apiKey) throw new Error("Missing AZURE_OPENAI_API_KEY");
  return apiKey;
}

// Map a gateway model id to an Azure DEPLOYMENT name.
// Azure addresses models by deployment, not model id, so everything collapses
// to FAST_DEPLOYMENT (cheap/quick) or DEEP_DEPLOYMENT (higher quality).
export function normalizeAiModel(model?: string): string {
  const fast = process.env.AZURE_OPENAI_FAST_DEPLOYMENT || "gpt-4o-mini";
  const deep = process.env.AZURE_OPENAI_DEEP_DEPLOYMENT || "gpt-4o";
  if (!model) return fast;
  const m = model.toLowerCase();
  // Anything explicitly "mini"/"fast" → fast. Higher tiers → deep.
  if (m.includes("mini") || m.includes("fast") || m.includes("flash")) return fast;
  if (m.includes("deep") || m.includes("pro") || m.includes("gpt-4o") || m.includes("gpt-5")) return deep;
  return fast;
}

function azureBaseURL(): string {
  const endpoint = process.env.AZURE_OPENAI_ENDPOINT;
  if (!endpoint) throw new Error("Missing AZURE_OPENAI_ENDPOINT");
  // @ai-sdk/azure resolves a baseURL to `{baseURL}/v1{path}`. Our AI Foundry
  // endpoint serves chat at `{endpoint}/openai/v1/chat/completions`, so the
  // baseURL is `{endpoint}/openai`. (resourceName would assume the classic
  // `.openai.azure.com` host, which is the wrong host here.)
  return `${endpoint.replace(/\/$/, "")}/openai`;
}

// Returns a provider callable as gateway(deploymentName) → LanguageModel,
// matching how call sites use the previous OpenAI provider.
export function createOpenAIProvider(_apiKey?: string) {
  const apiKey = process.env.AZURE_OPENAI_API_KEY;
  if (!apiKey) throw new Error("Missing AZURE_OPENAI_API_KEY");
  return createAzure({
    baseURL: azureBaseURL(),
    apiKey,
  });
}

// Raw Azure chat-completions endpoint (for call sites that fetch directly,
// e.g. multimodal file summarization). AI Foundry v1 path: the model/deployment
// goes in the request body's "model" field, not the URL.
export function getChatCompletionsConfig(_apiKey?: string): {
  url: string;
  headers: Record<string, string>;
} {
  const endpoint = process.env.AZURE_OPENAI_ENDPOINT;
  const apiKey = process.env.AZURE_OPENAI_API_KEY;
  if (!endpoint || !apiKey) throw new Error("Missing AZURE_OPENAI_ENDPOINT or AZURE_OPENAI_API_KEY");
  const base = endpoint.replace(/\/$/, "");
  return {
    url: `${base}/openai/v1/chat/completions`,
    headers: {
      "Content-Type": "application/json",
      "api-key": apiKey,
    },
  };
}
