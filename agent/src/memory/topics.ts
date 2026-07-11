import { existsSync, mkdirSync, readFileSync, writeFileSync, renameSync, rmSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import type { PokaicoDb } from "../db/client";

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

type IndexEdge = {
  fromTopic: string;
  toTopic: string;
  relationship: string;
};

function readEdges(db: PokaicoDb): IndexEdge[] {
  try {
    return db
      .prepare(
        "SELECT from_topic AS fromTopic, to_topic AS toTopic, relationship FROM edges",
      )
      .all() as IndexEdge[];
  } catch (err) {
    console.error("[pokaico] readEdges failed (treating as empty):", err);
    return [];
  }
}

/**
 * Rebuild INDEX.md from the current topic graph — always overwrites (never
 * skips on existence, unlike the old lazy `ensureIndex`). Deterministic and
 * LLM-free: topics come from the filesystem, edges from the `edges` table.
 * This is the mechanical observer that keeps the routing map fresh (issue #3).
 */
export function regenerateIndex(memoryDir: string, db: PokaicoDb): void {
  const indexPath = join(memoryDir, "INDEX.md");
  const topics = scanTopics(memoryDir);

  const topicLines = topics.map((t) => `- **${t.topicId}**: ${t.summary || "(no summary)"}`);

  const edges = readEdges(db).filter(
    (e) =>
      existsSync(join(memoryDir, "topics", e.fromTopic)) &&
      existsSync(join(memoryDir, "topics", e.toTopic)),
  );
  const edgeLines = edges.map(
    (e) => `- ${e.fromTopic} → ${e.toTopic}: ${e.relationship}`,
  );

  const sections = [`# Memory Index`, ""];
  sections.push(...(topicLines.length > 0 ? topicLines : ["_(no topics yet)_"]));
  if (edgeLines.length > 0) {
    sections.push("", "## Edges", ...edgeLines);
  }
  sections.push("");

  // Atomic write: render to a temp file in the same directory, then rename into
  // place so a crash mid-write can never leave a half-written INDEX.md (which
  // becomes the primary routing map read at session start in Langkah 2).
  const tmpPath = `${indexPath}.tmp`;
  writeFileSync(tmpPath, sections.join("\n"), "utf-8");
  renameSync(tmpPath, indexPath);
}
