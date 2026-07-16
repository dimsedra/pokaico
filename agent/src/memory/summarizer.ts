import { generateText, Output } from "ai";
import type { LanguageModel } from "ai";
import { z } from "zod";
import type { ConversationTurn } from "./conversation";
import type { SummaryOutput } from "./types";

const summarySchema = z.object({
  summary: z.string().describe("A concise 2-3 sentence summary of the entire conversation"),
  keyPoints: z
    .array(z.string())
    .describe("Key facts, events, or insights from the entire conversation"),
  topics: z.array(
    z.object({
      title: z.string().describe("Short topic title (2-4 words, suitable for a slug)"),
      summary: z.string().describe("1-2 sentence summary specific to this topic segment"),
      keyPoints: z.array(z.string()).describe("Key facts specific to this topic segment"),
      relatedTo: z.array(
        z.object({
          topicIndex: z.number().describe("Index of the related segment in this same topics array"),
          reason: z.string().describe("Short explanation of why these topics are related"),
        }),
      ).describe("Cross-topic relationships. Empty if this segment is unrelated to other segments in the same conversation (e.g. a context switch).").default([]),
    }),
  ).describe(
    "Distinct topic segments found in the conversation. Split if the conversation covers multiple different subjects.",
  ),
});

export async function summarize(
  turns: ConversationTurn[],
  model: LanguageModel,
): Promise<SummaryOutput> {
  if (turns.length === 0) {
    throw new Error("Cannot summarize empty conversation");
  }

  const transcript = turns
    .map((t) => `[${t.timestamp}] ${t.role === "user" ? "User" : t.role === "pokai" ? "Pokai" : "Tool"}: ${t.content}`)
    .join("\n");

  const { output } = await generateText({
    model,
    output: Output.object({ schema: summarySchema }),
    prompt: `Summarize this conversation transcript. Identify distinct topic segments if the conversation covers multiple different subjects. For each segment, provide a short title and specific summary.

Respond with a JSON object in this exact format:
{
  "summary": "A concise 2-3 sentence summary of the entire conversation.",
  "keyPoints": ["Key fact or insight 1", "Key fact or insight 2"],
  "topics": [
    {
      "title": "topic-title",
      "summary": "1-2 sentence summary specific to this topic segment",
      "keyPoints": ["Key fact specific to this topic"],
      "relatedTo": []
    }
  ]
}

Transcript:
${transcript}`,
  });

  return output;
}