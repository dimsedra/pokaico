import { generateText, Output } from "ai";
import type { LanguageModel } from "ai";
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
  "user-patterns": "Recurring behaviour patterns detected across sessions (e.g. user often requests blog drafts). Each entry uses [session:id] markers to track which sessions observed the pattern (e.g. 'User requests blog drafts [session:abc, session:def]').",
};

const SESSION_ID_RE = /^[\w][\w-]{0,80}$/;

function dedupSessionTags(content: string): string {
  return content.replace(/\[session:([^\]]+)\]/g, (_match, inside) => {
    const ids = inside.split(",").map((s: string) => s.trim()).filter(Boolean);
    const seen = new Set<string>();
    const deduped: string[] = [];
    for (const id of ids) {
      const key = id.toLowerCase();
      if (!seen.has(key)) { seen.add(key); deduped.push(id); }
    }
    return `[session:${deduped.join(", ")}]`;
  });
}

export async function refreshFoundational(
  summary: SummaryOutput,
  foundationalTopics: FoundationalTopic[],
  model: LanguageModel,
  sessionId?: string,
): Promise<FoundationalUpdate[]> {
  if (foundationalTopics.length === 0) return [];

  const validSessionId = sessionId && SESSION_ID_RE.test(sessionId) ? sessionId : undefined;
  if (sessionId && !validSessionId) {
    console.warn("[pokaico] invalid sessionId for foundational refresh, skipping session tags:", sessionId);
  }

  const topicsSection = foundationalTopics
    .map((t) => {
      const def = TOPIC_DEFINITIONS[t.topicId] ? `Definition: ${TOPIC_DEFINITIONS[t.topicId]}` : "";
      const instr = t.topicId === "user-patterns" && validSessionId
        ? `\nSession tag instructions for user-patterns:

Three-way decision:
1. NEW semantic information about a pattern → hasNewInfo: true, newContent: full updated content.
2. REINFORCED pattern (same behavior observed again) → hasNewInfo: true, newContent: existing content with [session:${validSessionId}] appended to the matching pattern's bracket. Do NOT change the pattern description.
3. NO relevance → hasNewInfo: false, newContent: null.

Rules:
- Append [session:${validSessionId}] to the EXACT matching pattern's bracket, not to all brackets.
- If [session:${validSessionId}] is already present, do NOT add it again — session markers are unique.
- NEVER remove existing session markers — they are evidence weight.`
        : "";
      return `Topic "${t.topicId}"${def ? `\n${def}` : ""}${instr}\nCurrent content:\n${t.currentContent || "(empty)"}`;
    })
    .join("\n\n");

  const { output } = await generateText({
    model,
    output: Output.object({ schema: foundationalSchema }),
    prompt: `Given the conversation summary and each foundational topic's current content, determine if any topic has NEW information from the conversation. If yes, provide the UPDATED full content for that topic — append new info, do not remove existing. If no new info at all, return null for newContent. (Exception: reinforced user-patterns returns hasNewInfo:true — see per-topic instructions.)

Respond with a JSON object in this exact format:
{
  "updates": [
    {
      "topicId": "user-profile",
      "newContent": "Updated full content for this topic...",
      "hasNewInfo": true
    },
    {
      "topicId": "user-background",
      "newContent": null,
      "hasNewInfo": false
    }
  ]
}

Conversation Summary: ${summary.summary}
Key Points: ${summary.keyPoints.join(", ")}

Topics to review:
${topicsSection}`,
  });

  // Code-level dedup: ensure no duplicate [session:id] in user-patterns content
  for (const update of output.updates) {
    if (update.topicId === "user-patterns" && update.newContent) {
      update.newContent = dedupSessionTags(update.newContent);
    }
  }

  return output.updates;
}