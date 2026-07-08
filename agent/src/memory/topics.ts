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
  if (!existsSync(topicDir(memoryDir, topicId))) {
    createTopic(memoryDir, topicId, content);
    return;
  }
  writeFileSync(contextPath(memoryDir, topicId), content, "utf-8");
}

export function deleteTopic(memoryDir: string, topicId: string): void {
  const dir = topicDir(memoryDir, topicId);
  if (!existsSync(dir)) return;
  rmSync(dir, { recursive: true, force: true });
}

function scanTopics(memoryDir: string): TopicMeta[] {
  const topicsDir = join(memoryDir, "topics");
  if (!existsSync(topicsDir)) return [];

  return readdirSync(topicsDir)
    .filter((entry) => {
      const path = join(topicsDir, entry);
      return statSync(path).isDirectory();
    })
    .map((entry) => ({
      topicId: entry,
      summary: readExcerpt(memoryDir, entry),
      isFoundational: false,
      updatedAt: 0,
    }));
}

function readExcerpt(memoryDir: string, topicId: string): string {
  const cp = contextPath(memoryDir, topicId);
  if (!existsSync(cp)) return "";
  const content = readFileSync(cp, "utf-8");
  return content.length > 80 ? content.slice(0, 80) + "..." : content;
}

export function listTopics(memoryDir: string): TopicMeta[] {
  return scanTopics(memoryDir);
}

export function ensureIndex(memoryDir: string): void {
  const indexPath = join(memoryDir, "INDEX.md");
  if (existsSync(indexPath)) return;

  const topics = scanTopics(memoryDir);
  const lines = topics.map((t) => `- **${t.topicId}**: # "${t.summary}"`);

  writeFileSync(indexPath, `# Memory Index\n\n${lines.join("\n")}\n`, "utf-8");
}
