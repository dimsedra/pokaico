import { generateText } from "ai";
import type { LanguageModel } from "ai";
import { writeFileSync, mkdirSync } from "node:fs";
import { dirname } from "node:path";
import type { ConversationTurn } from "./conversation";

export async function generateCompanionDiary(
  turns: ConversationTurn[],
  model: LanguageModel,
): Promise<string> {
  if (turns.length === 0) {
    throw new Error("Cannot summarize empty conversation");
  }

  const transcript = turns
    .map((t) => `[${t.timestamp}] ${t.role === "user" ? "User" : t.role === "pokai" ? "Pokai" : "Tool"}: ${t.content}`)
    .join("\n");

  const prompt = `Write a cozy, empathetic third-person diary entry summarizing this conversation from the perspective of the companion (Pokai). Focus on the user's feelings, key events, and what the companion feels about the day. Make it read like a warm personal diary entry, e.g. "Today, Eds shared that...". Do not include any HTML or markdown headers, just return 1-2 warm paragraphs of text.

Transcript:
${transcript}`;

  const { text } = await generateText({
    model,
    prompt,
  });

  return text.trim();
}

export async function writeDiaryEntry(
  filePath: string,
  content: string,
  sessionId: string,
  startedAt: string,
  lastActiveAt: string,
): Promise<void> {
  mkdirSync(dirname(filePath), { recursive: true });
  const fileContent = `---
session_id: ${sessionId}
started_at: ${startedAt}
last_active_at: ${lastActiveAt}
---
${content}
`;
  writeFileSync(filePath, fileContent, "utf-8");
}
