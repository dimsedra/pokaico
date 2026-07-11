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

const TOPIC_DEFINITIONS: Record<string, string> = {
  "user-profile": "Personality traits, thinking patterns, values, decision-making style, emotional triggers, tone preferences, pet peeves, response style.",
  "user-background": "Name, location, timezone, occupation, languages, work role, industry, career goals, life situation, key relationships.",
  "user-patterns": "Recurring behaviour patterns detected across sessions (e.g. user often requests blog drafts). Each entry tracks the session IDs where the pattern was observed.",
};

export async function refreshFoundational(
  summary: SummaryOutput,
  foundationalTopics: FoundationalTopic[],
  model: LanguageModelV1,
  sessionId?: string,
): Promise<FoundationalUpdate[]> {
  if (foundationalTopics.length === 0) return [];

  const topicsSection = foundationalTopics
    .map((t) => {
      const def = TOPIC_DEFINITIONS[t.topicId] ? `Definition: ${TOPIC_DEFINITIONS[t.topicId]}` : "";
      const instr = t.topicId === "user-patterns" && sessionId
        ? `\nSession tag instructions for user-patterns:\n- If existing information is REINFORCED by this session, add [session:${sessionId}] to its bracket (e.g. "pattern info [session:a, session:b]").\n- If NEW pattern found, add a new line with [session:${sessionId}].\n- NEVER remove existing session markers — they are evidence weight.\n- If no new info, return null for newContent.`
        : "";
      return `Topic "${t.topicId}"${def ? `\n${def}` : ""}${instr}\nCurrent content:\n${t.currentContent || "(empty)"}`;
    })
    .join("\n\n");

  const { output } = await generateText({
    model,
    output: Output.object({ schema: foundationalSchema }),
    prompt: `Given the conversation summary and each foundational topic's current content, determine if any topic has NEW information from the conversation. If yes, provide the UPDATED full content for that topic — append new info, do not remove existing. If no new info at all, return null for newContent.

Conversation Summary: ${summary.summary}
Key Points: ${summary.keyPoints.join(", ")}

Topics to review:
${topicsSection}`,
  });

  return output.updates;
}