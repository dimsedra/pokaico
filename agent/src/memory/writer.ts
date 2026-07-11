import { writeFileSync, readFileSync, existsSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import type { TopicChange } from "./types";
import { withTopicLock } from "./mutex";

const PROVENANCE_PREFIX = "[src:%s:%d]";
const VALID_TOPIC_RE = /^[a-z0-9][a-z0-9-]{0,80}$/;

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

function hasProvenance(existing: string, sessionId: string, timestamp: number): boolean {
  const marker = PROVENANCE_PREFIX.replace("%s", sessionId).replace(
    "%d",
    String(timestamp),
  );
  return existing.includes(marker);
}

function mergeExisting(existing: string, newEntry: string): string {
  return `${existing}\n\n${newEntry}`;
}

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
      if (change.action === "external") {
        const rawContent = change.content;
        const filename = change.resourceFile ?? `external-${Date.now()}.md`;

        const td = topicDir(memoryDir, change.topicId);
        const rd = resourcesDir(memoryDir, change.topicId);
        ensureDir(rd);

        writeFileSync(join(rd, filename), rawContent, "utf-8");

        const contextEntry = buildContent(
          `See [full content](resources/${filename})`,
          sessionId,
          timestamp,
        );

        const cp = contextPath(memoryDir, change.topicId);
        if (existsSync(cp)) {
          const existing = readFileSync(cp, "utf-8");
          if (sessionId !== undefined && timestamp !== undefined) {
            if (hasProvenance(existing, sessionId, timestamp)) return;
          }
          writeFileSync(cp, mergeExisting(existing, contextEntry), "utf-8");
        } else {
          ensureDir(td);
          writeFileSync(cp, contextEntry, "utf-8");
        }

        updated.push(change.topicId);
        return;
      }

      const entry = buildContent(change.content, sessionId, timestamp);

      if (change.action === "create") {
        const td = topicDir(memoryDir, change.topicId);
        ensureDir(td);
        writeFileSync(contextPath(memoryDir, change.topicId), entry, "utf-8");
        updated.push(change.topicId);
        return;
      }

      // action === "update" — content is already compacted upstream; replace file.
      const cp = contextPath(memoryDir, change.topicId);
      ensureDir(topicDir(memoryDir, change.topicId));
      writeFileSync(cp, change.content, "utf-8");

      if (change.overflow && change.overflow.length > 0) {
        const rd = resourcesDir(memoryDir, change.topicId);
        ensureDir(rd);
        for (const o of change.overflow) {
          writeFileSync(join(rd, o.filename), o.content, "utf-8");
        }
      }

      updated.push(change.topicId);
    });
  }

  return updated;
}
