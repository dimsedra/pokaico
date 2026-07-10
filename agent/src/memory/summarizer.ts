import { generateText, Output } from "ai";
import type { LanguageModelV1 } from "ai";
import { z } from "zod";
import type { JournalTurn } from "./journal";
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
    }),
  ).describe(
    "Distinct topic segments found in the conversation. Split if the conversation covers multiple different subjects.",
  ),
});

export async function summarize(
  turns: JournalTurn[],
  model: LanguageModelV1,
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

Transcript:
${transcript}`,
  });

  return output;
}