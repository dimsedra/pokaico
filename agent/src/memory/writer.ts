import { writeFileSync, readFileSync, existsSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import type { TopicChange } from "./types";

const TOKEN_LIMIT = 2500;
const PROVENANCE_PREFIX = "[src:%s:%d]";

function topicDir(memoryDir: string, topicId: string): string {
  return join(memoryDir, "topics", topicId);
}

function contextPath(memoryDir: string, topicId: string): string {
  return join(topicDir(memoryDir, topicId), "CONTEXT.md");
}

function resourcesDir(memoryDir: string, topicId: string): string {
  return join(topicDir(memoryDir, topicId), "resources");
}

function ensureDir(d: string): void {
  if (!existsSync(d)) mkdirSync(d, { recursive: true });
}

function buildContent(
  content: string,
  sessionId?: string,
  timestamp?: number,
): string {
  let result = content;
  if (sessionId !== undefined && timestamp !== undefined) {
    const marker = PROVENANCE_PREFIX.replace("%s", sessionId).replace(
      "%d",
      String(timestamp),
    );
    result = `${marker}\n\n${result}`;
  }
  return result;
}

function writeWithOverflow(
  topicId: string,
  content: string,
  memoryDir: string,
): void {
  const td = topicDir(memoryDir, topicId);
  const cp = contextPath(memoryDir, topicId);
  ensureDir(td);

  // Arbitrarily using character count as proxy for token count
  if (content.length > TOKEN_LIMIT) {
    const rd = resourcesDir(memoryDir, topicId);
    ensureDir(rd);

    const resourceFile = `overflow-${Date.now()}.md`;
    writeFileSync(join(rd, resourceFile), content, "utf-8");

    const summary = content.slice(0, TOKEN_LIMIT - 100);
    const ref = `See [detailed notes](resources/${resourceFile}) for full content.`;
    writeFileSync(cp, `${summary}\n\n${ref}\n`, "utf-8");
  } else {
    writeFileSync(cp, content, "utf-8");
  }
}

export async function applyChanges(
  changes: TopicChange[],
  memoryDir: string,
  lock: <T>(topicId: string, fn: () => Promise<T>) => Promise<T>,
  sessionId?: string,
  timestamp?: number,
): Promise<string[]> {
  const updated: string[] = [];

  for (const change of changes) {
    await lock(change.topicId, async () => {
      const content = buildContent(change.content, sessionId, timestamp);

      // For update action, read existing content and append/merge
      let finalContent = content;
      if (change.action === "update") {
        const cp = contextPath(memoryDir, change.topicId);
        if (existsSync(cp)) {
          const existing = readFileSync(cp, "utf-8");
          finalContent = `${existing}\n\n${content}`;
        }
      }

      writeWithOverflow(change.topicId, finalContent, memoryDir);
      updated.push(change.topicId);
    });
  }

  return updated;
}