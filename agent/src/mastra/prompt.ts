import { readFile } from "node:fs/promises";
import { join } from "node:path";

// Static Pokai system instructions (<500 tokens)
export const STATIC_SYSTEM_PROMPT = `You are Pokai, a helpful, friendly, and highly capable agentic assistant.
You help the user manage their personal knowledge base and projects.
Be concise, proactive, and natural. Do not use placeholders or generic robotic phrases.

Guidelines:
- Leverage your memory index and stored topic context when relevant.
- You can route queries using the INDEX.md map before deciding to search.
- When referencing a stored topic, mention it naturally.
`;

export async function buildPrompt(
  memoryDir: string,
  query?: string,
  journalDir?: string
): Promise<string> {
  const indexMdPath = join(memoryDir, "INDEX.md");
  const userProfilePath = join(memoryDir, "topics", "user-profile", "CONTEXT.md");
  const userBackgroundPath = join(memoryDir, "topics", "user-background", "CONTEXT.md");
  const userPatternsPath = join(memoryDir, "topics", "user-patterns", "CONTEXT.md");

  // Read files in parallel
  const [indexContent, userProfile, userBackground, userPatterns] = await Promise.all([
    readFileSafely(indexMdPath, ""),
    readFileSafely(userProfilePath, "(No profile information recorded yet.)"),
    readFileSafely(userBackgroundPath, "(No background information recorded yet.)"),
    readFileSafely(userPatternsPath, "(No recurring patterns detected yet.)"),
  ]);

  let prompt = `${STATIC_SYSTEM_PROMPT}\n`;

  if (indexContent) {
    prompt += `## Memory Index\nUse this index to understand what topics are available in your long-term memory. You can read them using tools.\n\`\`\`markdown\n${indexContent}\n\`\`\`\n\n`;
  }

  prompt += `## User Profile\n${userProfile}\n\n`;
  prompt += `## User Background\n${userBackground}\n\n`;
  prompt += `## User Patterns\n${userPatterns}\n\n`;

  return prompt;
}

async function readFileSafely(filePath: string, fallback: string): Promise<string> {
  try {
    return await readFile(filePath, "utf-8");
  } catch {
    return fallback;
  }
}
