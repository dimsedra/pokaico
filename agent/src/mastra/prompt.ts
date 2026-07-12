import { readFile, readdir } from "node:fs/promises";
import { join, dirname } from "node:path";
import { readSessionAsync, type JournalTurn, type JournalSession } from "../memory/journal";

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
  _query?: string,
  journalDir?: string
): Promise<string> {
  const indexMdPath = join(memoryDir, "INDEX.md");
  const userProfilePath = join(memoryDir, "topics", "user-profile", "CONTEXT.md");
  const userBackgroundPath = join(memoryDir, "topics", "user-background", "CONTEXT.md");
  const userPatternsPath = join(memoryDir, "topics", "user-patterns", "CONTEXT.md");
  const resolvedJournalDir = journalDir || join(dirname(memoryDir), "journal");

  // Read memory files in parallel
  const [indexContent, userProfile, userBackground, userPatterns, recentHistory] = await Promise.all([
    readFileSafely(indexMdPath, ""),
    readFileSafely(userProfilePath, "(No profile information recorded yet.)"),
    readFileSafely(userBackgroundPath, "(No background information recorded yet.)"),
    readFileSafely(userPatternsPath, "(No recurring patterns detected yet.)"),
    readRecentHistory(resolvedJournalDir)
  ]);

  let prompt = `${STATIC_SYSTEM_PROMPT}\n`;

  if (indexContent) {
    prompt += `## Memory Index\nUse this index to understand what topics are available in your long-term memory. You can read them using tools.\n\`\`\`markdown\n${indexContent}\n\`\`\`\n\n`;
  }

  prompt += `## User Profile\n${userProfile}\n\n`;
  prompt += `## User Background\n${userBackground}\n\n`;
  prompt += `## User Patterns\n${userPatterns}\n\n`;

  if (recentHistory) {
    prompt += `## Recent Conversation History\nUse this history for context and continuity across recent sessions.\n${recentHistory}\n\n`;
  }

  return prompt;
}

async function readFileSafely(filePath: string, fallback: string): Promise<string> {
  try {
    return await readFile(filePath, "utf-8");
  } catch {
    return fallback;
  }
}

async function readRecentHistory(journalDir: string): Promise<string> {
  let files: string[] = [];
  try {
    files = await readdir(journalDir);
  } catch {
    return "";
  }

  // Filter markdown files
  const mdFiles = files.filter((f) => f.endsWith(".md"));
  if (mdFiles.length === 0) return "";

  // O(1) Optimization: Sort alphabetically descending and slice top-10 latest filenames
  mdFiles.sort((a, b) => b.localeCompare(a));
  const topFiles = mdFiles.slice(0, 10);

  // Parallel asynchronous read/parse
  const sessionPromises = topFiles.map(async (file) => {
    try {
      return await readSessionAsync(join(journalDir, file));
    } catch (err) {
      console.warn(`[pokaico] Failed to parse journal file ${file}:`, err);
      return null;
    }
  });

  const sessions = (await Promise.all(sessionPromises)).filter(
    (s): s is JournalSession => s !== null
  );

  if (sessions.length === 0) return "";

  // Sort sessions chronologically by startedAt frontmatter descending (tie-breaker: sessionId)
  sessions.sort((a, b) => {
    const timeA = new Date(a.startedAt).getTime() || 0;
    const timeB = new Date(b.startedAt).getTime() || 0;
    if (timeB !== timeA) {
      return timeB - timeA;
    }
    return b.sessionId.localeCompare(a.sessionId);
  });

  const chunks: JournalTurn[][] = [];
  let accumulatedCount = 0;

  for (const session of sessions) {
    if (session.turns && session.turns.length > 0) {
      const needed = 10 - accumulatedCount;
      if (needed <= 0) break;

      const chunk = session.turns.slice(-needed);
      chunks.push(chunk);
      accumulatedCount += chunk.length;

      if (accumulatedCount >= 10) break;
    }
  }

  // Reverse chunks to put older sessions first, then flatten
  const finalTurns = chunks.reverse().flat();
  if (finalTurns.length === 0) return "";

  return finalTurns
    .map((turn) => {
      const label = turn.role === "user" ? "User" : turn.role === "pokai" ? "Pokai" : turn.toolName ? `Tool (${turn.toolName.trim()})` : "Tool";
      const formattedContent = turn.content.trim().replace(/\n/g, "\n  ");
      return `- [${turn.timestamp}] ${label}: ${formattedContent}`;
    })
    .join("\n");
}
