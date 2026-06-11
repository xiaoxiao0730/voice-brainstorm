// Server-only Azure OpenAI provider helper.
// Import only from server function handlers.

import { createAzure } from "@ai-sdk/azure";

export type AzureOpenAIClient = {
  model: ReturnType<ReturnType<typeof createAzure>>;
  deployment: string;
};

export function getAzureOpenAIClient(): AzureOpenAIClient {
  const endpoint = process.env.AZURE_OPENAI_ENDPOINT;
  const apiKey = process.env.AZURE_OPENAI_API_KEY;
  const deployment = process.env.AZURE_OPENAI_DEPLOYMENT;
  const apiVersion = process.env.AZURE_OPENAI_API_VERSION || "2024-10-21";

  if (!endpoint || !apiKey || !deployment) {
    throw new Error(
      "Missing Azure OpenAI configuration: AZURE_OPENAI_ENDPOINT, AZURE_OPENAI_API_KEY, AZURE_OPENAI_DEPLOYMENT are required.",
    );
  }

  // Extract resource name from endpoint like "https://my-resource.openai.azure.com".
  let resourceName: string;
  try {
    const host = new URL(endpoint).hostname;
    resourceName = host.split(".")[0];
  } catch {
    throw new Error(`Invalid AZURE_OPENAI_ENDPOINT: ${endpoint}`);
  }

  const azure = createAzure({
    resourceName,
    apiKey,
    apiVersion,
  });

  return { model: azure(deployment), deployment };
}
