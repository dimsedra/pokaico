import { writeFileSync, readFileSync, existsSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import type { TopicChange } from "./types";
import { createMutex, withTopicLock } from "./mutex";

const CHAR_LIMIT = 2500;
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

function countTokens(text: string): number {
  return Math.ceil(text.length / 4);
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

function hasProvenance(existing: string, sessionId: string, timestamp: number): boolean {
  const marker = PROVENANCE_PREFIX.replace("%s", sessionId).replace(
    "%d",
    String(timestamp),
  );
  return existing.includes(marker);
}

function writeWithOverflow(
  topicId: string,
  content: string,
  memoryDir: string,
): void {
  const td = topicDir(memoryDir, topicId);
  const cp = contextPath(memoryDir, topicId);
  ensureDir(td);

  if (countTokens(content) > CHAR_LIMIT) {
    const rd = resourcesDir(memoryDir, topicId);
    ensureDir(rd);

    const resourceFile = `overflow-${Date.now()}.md`;
    writeFileSync(join(rd, resourceFile), content, "utf-8");

    // Token-budget summary in CONTEXT.md
    const rawSummary = content.slice(0, CHAR_LIMIT * 3);
    const ref = `See [detailed notes](resources/${resourceFile}) for full content.`;
    writeFileSync(cp, `${rawSummary}\n\n${ref}\n`, "utf-8");
  } else {
    writeFileSync(cp, content, "utf-8");
  }
}

function accumulateWithCap(
  existing: string,
  newContent: string,
): string {
  const combined = `${existing}\n\n${newContent}`;
  const tokens = countTokens(combined);

  if (tokens <= CHAR_LIMIT) return combined;

  // Keep most recent content + provenance, drop oldest portions
  // Strategy: remove oldest content in chunks until under limit
  const provenanceLine = existing.match(/^\[src:[^\]]+\]/m);
  const existingBase = provenanceLine
    ? existing.slice(provenanceLine.index! + provenanceLine[0].length).trim()
    : existing;

  // Keep as much of existing as fits with new content
  const budget = CHAR_LIMIT - countTokens(newContent) - 1;
  const truncatedExisting = countTokens(existingBase) > budget
    ? existingBase.slice(0, budget * 4)
    : existingBase;

  const marker = provenanceLine ? `${provenanceLine[0]}\n\n` : "";
  return `${marker}${truncatedExisting}\n\n${newContent}`;
}

const VALID_TOPIC_RE = /^[a-z0-9][a-z0-9-]{0,80}$/;

export async function applyChanges(
  changes: TopicChange[],
  memoryDir: string,
  sessionId?: string,
  timestamp?: number,
): Promise<string[]> {
  for (const change of changes) {
    if (!VALID_TOPIC_RE.test(change.topicId)) {
      throw new Error(`Invalid topicId: "${change.topicId}". Must match pattern: lower-kebab-case.`);
    }
  }

  const updated: string[] = [];

  for (const change of changes) {
    await withTopicLock(change.topicId, async () => {
      const content = buildContent(change.content, sessionId, timestamp);

      let finalContent = content;
      if (change.action === "update") {
        const cp = contextPath(memoryDir, change.topicId);
        if (existsSync(cp)) {
          const existing = readFileSync(cp, "utf-8");

          // Idempotency guard
          if (sessionId !== undefined && timestamp !== undefined) {
            if (hasProvenance(existing, sessionId, timestamp)) {
              return;
            }
          }

          finalContent = accumulateWithCap(existing, content);
        }
      }

      writeWithOverflow(change.topicId, finalContent, memoryDir);
      updated.push(change.topicId);
    });
  }

  return updated;
}