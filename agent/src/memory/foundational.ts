import { generateText, Output } from "ai";
import type { LanguageModelV1 } from "ai";
import { z } from "zod";
import type { FoundationalUpdate, SummaryOutput } from "./types";

const foundationalSchema = z.object({
  updates: z.array(
    z.object({
      topicId: z.string(),
      newContent: z.string().nullable().describe("Updated CONTEXT.md content, or null if no new info"),
      hasNewInfo: z.boolean(),
    }),
  ),
});

type FoundationalTopic = {
  topicId: string;
  currentContent: string;
};

export async function refreshFoundational(
  summary: SummaryOutput,
  foundationalTopics: FoundationalTopic[],
  model: LanguageModelV1,
): Promise<FoundationalUpdate[]> {
  if (foundationalTopics.length === 0) return [];

  const topicsSection = foundationalTopics
    .map(
      (t) => `Topic "${t.topicId}":
Current content: ${t.currentContent || "(empty)"}`,
    )
    .join("\n\n");

  const { output } = await generateText({
    model,
    output: Output.object({ schema: foundationalSchema }),
    prompt: `Given the conversation summary and each foundational topic's current content, determine if any topic has NEW information from the conversation. If yes, provide the UPDATED full content for that topic (append new info, do not remove existing). If no new info, return null for newContent.

Conversation Summary: ${summary.summary}
Key Points: ${summary.keyPoints.join(", ")}

Topics to review:
${topicsSection}`,
  });

  return output.updates;
}