import { generateText, Output } from "ai";
import type { LanguageModelV1 } from "ai";
import { z } from "zod";
import type { JournalTurn } from "./journal";
import type { SummaryOutput } from "./types";

const summarySchema = z.object({
  summary: z.string().describe("A concise 2-3 sentence summary of the conversation"),
  keyPoints: z
    .array(z.string())
    .describe("Key facts, events, or insights from the conversation"),
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
    prompt: `Summarize this conversation transcript. Extract key facts, insights, events, and user information mentioned.

Transcript:
${transcript}`,
  });

  return output;
}