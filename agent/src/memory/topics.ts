import { existsSync, mkdirSync, readFileSync, writeFileSync, rmSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";

export type TopicMeta = {
  topicId: string;
  summary: string;
  isFoundational: boolean;
  updatedAt: number;
};

function topicDir(memoryDir: string, topicId: string): string {
  return join(memoryDir, "topics", topicId);
}

function contextPath(memoryDir: string, topicId: string): string {
  return join(topicDir(memoryDir, topicId), "CONTEXT.md");
}

function resourcesDir(memoryDir: string, topicId: string): string {
  return join(topicDir(memoryDir, topicId), "resources");
}

export function createTopic(memoryDir: string, topicId: string, content: string): void {
  mkdirSync(resourcesDir(memoryDir, topicId), { recursive: true });
  writeFileSync(contextPath(memoryDir, topicId), content, "utf-8");
}

export function readTopic(memoryDir: string, topicId: string): string | null {
  const path = contextPath(memoryDir, topicId);
  if (!existsSync(path)) return null;
  return readFileSync(path, "utf-8");
}

export function updateTopic(memoryDir: string, topicId: string, content: string): void {
  writeFileSync(contextPath(memoryDir, topicId), content, "utf-8");
}

export function deleteTopic(memoryDir: string, topicId: string): void {
  const dir = topicDir(memoryDir, topicId);
  if (existsSync(dir)) {
    rmSync(dir, { recursive: true, force: true });
  }
}

function indexMeta(memoryDir: string): TopicMeta[] {
  const indexPath = join(memoryDir, "INDEX.md");
  if (!existsSync(indexPath)) return [];

  const content = readFileSync(indexPath, "utf-8");
  const lines = content.split("\n").filter((l) => l.startsWith("- **"));

  return lines.map((line) => {
    const idMatch = line.match(/- \*\*([^*]+)\*\*/);
    const sumMatch = line.match(/]: # "([^"]+)"/);
    const topicId = idMatch?.[1] ?? "";
    const summary = sumMatch?.[1] ?? "";
    const isFoundational = line.includes("foundational");
    return { topicId, summary, isFoundational, updatedAt: 0 };
  });
}

export function listTopics(memoryDir: string): TopicMeta[] {
  const topicsDir = join(memoryDir, "topics");
  if (!existsSync(topicsDir)) return [];

  // Try INDEX.md first for metadata
  const indexEntries = indexMeta(memoryDir);
  if (indexEntries.length > 0) return indexEntries;

  // Fallback: scan directory
  return readdirSync(topicsDir)
    .filter((entry) => {
      const path = join(topicsDir, entry);
      return statSync(path).isDirectory();
    })
    .map((entry) => ({
      topicId: entry,
      summary: "",
      isFoundational: false,
      updatedAt: 0,
    }));
}

export function ensureIndex(memoryDir: string): void {
  const indexPath = join(memoryDir, "INDEX.md");
  if (existsSync(indexPath)) return;

  const topicsDir = join(memoryDir, "topics");
  if (!existsSync(topicsDir)) {
    writeFileSync(indexPath, "# Memory Index\n\n", "utf-8");
    return;
  }

  const entries = readdirSync(topicsDir).filter((entry) => {
    const path = join(topicsDir, entry);
    return statSync(path).isDirectory();
  });

  const lines = entries.map((topicId) => {
    const cp = contextPath(memoryDir, topicId);
    let excerpt = "";
    if (existsSync(cp)) {
      const content = readFileSync(cp, "utf-8");
      excerpt = content.length > 80 ? content.slice(0, 80) + "..." : content;
    }
    return `- **${topicId}**: # "${excerpt}"`;
  });

  writeFileSync(indexPath, `# Memory Index\n\n${lines.join("\n")}\n`, "utf-8");
}
