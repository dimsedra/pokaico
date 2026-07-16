import { readFile, readdir } from "node:fs/promises";
import { join, dirname } from "node:path";

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
  conversationDir?: string,
  diaryDir?: string
): Promise<string> {
  const indexMdPath = join(memoryDir, "INDEX.md");
  const userProfilePath = join(memoryDir, "topics", "user-profile", "CONTEXT.md");
  const userBackgroundPath = join(memoryDir, "topics", "user-background", "CONTEXT.md");
  const userPatternsPath = join(memoryDir, "topics", "user-patterns", "CONTEXT.md");
  const resolvedDiaryDir = diaryDir || join(dirname(memoryDir), "diary");

  // Read memory files in parallel
  const [indexContent, userProfile, userBackground, userPatterns, recentDiaries] = await Promise.all([
    readFileSafely(indexMdPath, ""),
    readFileSafely(userProfilePath, "(No profile information recorded yet.)"),
    readFileSafely(userBackgroundPath, "(No background information recorded yet.)"),
    readFileSafely(userPatternsPath, "(No recurring patterns detected yet.)"),
    readRecentDiaries(resolvedDiaryDir)
  ]);

  let prompt = `${STATIC_SYSTEM_PROMPT}\n`;

  if (indexContent) {
    prompt += `## Memory Index\nUse this index to understand what topics are available in your long-term memory. You can read them using tools.\n\`\`\`markdown\n${indexContent}\n\`\`\`\n\n`;
  }

  prompt += `## User Profile\n${userProfile}\n\n`;
  prompt += `## User Background\n${userBackground}\n\n`;
  prompt += `## User Patterns\n${userPatterns}\n\n`;

  if (recentDiaries) {
    prompt += `## Companion's Diary / Recent Context\nUse these recent diary entries to understand the context of recent conversations.\n${recentDiaries}\n\n`;
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

interface DiaryEntry {
  sessionId: string;
  startedAt: string;
  lastActiveAt: string;
  content: string;
}

async function readDiaryFile(filePath: string): Promise<DiaryEntry> {
  const raw = await readFile(filePath, "utf-8");
  const cleanRaw = raw.replace(/^\uFEFF/, "").trimStart();
  const normalized = cleanRaw.replace(/\r\n/g, "\n");
  const lines = normalized.split("\n");

  if (lines.length < 2 || lines[0] !== "---") {
    throw new Error("missing frontmatter");
  }
  const fmEnd = lines.indexOf("---", 1);
  if (fmEnd === -1) {
    throw new Error("unclosed frontmatter");
  }

  const fm: Record<string, string> = {};
  for (let i = 1; i < fmEnd; i++) {
    const line = lines[i].split("#")[0].trim();
    const colonIdx = line.indexOf(":");
    if (colonIdx === -1) continue;
    const key = line.slice(0, colonIdx).trim();
    const value = line.slice(colonIdx + 1).trim();
    fm[key] = value;
  }

  const content = lines.slice(fmEnd + 1).join("\n").trim();

  return {
    sessionId: fm["session_id"] || "",
    startedAt: fm["started_at"] || "",
    lastActiveAt: fm["last_active_at"] || fm["started_at"] || "",
    content,
  };
}

async function readRecentDiaries(diaryDir: string): Promise<string> {
  let files: string[] = [];
  try {
    files = await readdir(diaryDir);
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
  const diaryPromises = topFiles.map(async (file) => {
    try {
      return await readDiaryFile(join(diaryDir, file));
    } catch {
      return null;
    }
  });

  const entries = (await Promise.all(diaryPromises)).filter(
    (e): e is DiaryEntry => e !== null
  );

  if (entries.length === 0) return "";

  // Sort diaries descending by last_active_at (newest first)
  entries.sort((a, b) => {
    const timeA = new Date(a.lastActiveAt).getTime() || 0;
    const timeB = new Date(b.lastActiveAt).getTime() || 0;
    if (timeB !== timeA) {
      return timeB - timeA;
    }
    return b.sessionId.localeCompare(a.sessionId);
  });

  // Take top 3 most recently active
  const topDiaries = entries.slice(0, 3);

  // Reverse to display oldest first (chronological order)
  topDiaries.reverse();

  return topDiaries
    .map((entry) => {
      const dateStr = new Date(entry.lastActiveAt).toLocaleDateString("en-US", {
        day: "numeric",
        month: "long",
        year: "numeric",
      });
      return `### Entry from ${dateStr}\n${entry.content}`;
    })
    .join("\n\n");
}
