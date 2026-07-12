import { existsSync, mkdirSync, readFileSync, writeFileSync, renameSync, rmSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import type { PokaicoDb } from "../db/client";

// Shared validation pattern for topicId slugs. Used by writer.ts and tools
// to ensure topic IDs are safe for filesystem access.
export const VALID_TOPIC_RE = /^[a-z0-9][a-z0-9-]{0,80}$/;

// The 3 shipped foundational topics — loaded at every session start.
export const FOUNDATIONAL_TOPIC_IDS = ["user-profile", "user-background", "user-patterns"];

export type TopicMeta = {
  topicId: string;
  summary: string;
  isFoundational: boolean;
  updatedAt: number;
};

export type IndexTopic = { topicId: string; summary: string };

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
  try {
    if (!existsSync(path)) return null;
    return readFileSync(path, "utf-8");
  } catch {
    return null;
  }
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

  const sections = [`# Memory Index`, ""];
  sections.push(...(topicLines.length > 0 ? topicLines : ["_(no topics yet)_"]));
  sections.push("");

  // Atomic write: render to a temp file in the same directory, then rename into
  // place so a crash mid-write can never leave a half-written INDEX.md (which
  // becomes the primary routing map read at session start in Langkah 2).
  const tmpPath = `${indexPath}.tmp`;
  writeFileSync(tmpPath, sections.join("\n"), "utf-8");
  renameSync(tmpPath, indexPath);
}

/**
 * Read the canonical routing map (INDEX.md) back into structured form. This is
 * the deterministic counterpart to `regenerateIndex` — extraction consults it
 * before creating topics so it can UPDATE an existing slug instead of
 * duplicating it (issue #4). Returns [] if INDEX.md is absent so callers can
 * fall back to the DB-backed topic list.
 */
export function parseIndex(memoryDir: string): IndexTopic[] {
  const indexPath = join(memoryDir, "INDEX.md");
  if (!existsSync(indexPath)) return [];

  const content = readFileSync(indexPath, "utf-8");
  const topics: IndexTopic[] = [];
  // Tolerant of hand-edited variants (leading spaces, extra spaces around the
  // colon) so a stray space in INDEX.md can never silently drop a topic from
  // the routing map.
  const re = /^\s*-\s+\*\*(.+?)\*\*\s*:\s*(.*?)\s*$/;
  for (const line of content.split("\n")) {
    const m = re.exec(line);
    if (m) topics.push({ topicId: m[1].trim(), summary: m[2].trim() });
  }
  return topics;
}
