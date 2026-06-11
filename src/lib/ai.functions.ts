import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { generateText, Output } from "ai";
import { createLovableAiGatewayProvider } from "@/lib/ai-gateway.server";

const ProcessTranscriptInput = z.object({
  transcript: z.string().min(1),
});

export type ThoughtBlock = {
  title: string;
  body: string;
  tag?: string;
};

export const processTranscript = createServerFn({ method: "POST" })
  .inputValidator((input: unknown) => ProcessTranscriptInput.parse(input))
  .handler(async ({ data }) => {
    const key = process.env.LOVABLE_API_KEY;
    if (!key) throw new Error("Missing LOVABLE_API_KEY");

    const gateway = createLovableAiGatewayProvider(key);

    const { output } = await generateText({
      model: gateway("google/gemini-3-flash-preview"),
      output: Output.object({
        schema: z.object({
          thoughts: z.array(
            z.object({
              title: z.string().describe("A concise, punchy headline for this thought (3-8 words)"),
              body: z.string().describe("The expanded insight, 1-3 sentences"),
              tag: z.string().describe("A category label like 'Insight', 'Question', 'Action', 'Idea'").optional(),
            })
          ).describe("Organized thought blocks extracted from the transcript"),
        }),
      }),
      system:
        "You are a co-thinking assistant. Take raw spoken transcript text and organize it into clear, distinct thought blocks. " +
        "Each block should have a headline title and expanded body text. Infer category tags when helpful. " +
        "Preserve the user's intent and tone. Return structured JSON.",
      prompt: `Organize this spoken transcript into structured thought blocks:\n\n${data.transcript}`,
    });

    return output as { thoughts: ThoughtBlock[] };
  });
