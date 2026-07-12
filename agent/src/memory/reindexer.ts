import { readFileSync, existsSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import type { PokaicoDb } from "../db/client";
import { countTokens } from "./tokens";
import { purgeTopicChunks } from "../embeddings/search";
import { resourcesDir } from "./topics";

function contextPath(memoryDir: string, topicId: string): string {
  return join(memoryDir, "topics", topicId, "CONTEXT.md");
}

export async function reindexTopics(
  topicIds: string[],
  memoryDir: string,
  db: PokaicoDb,
  indexTopic: (topicId: string, content: string) => Promise<void>,
): Promise<void> {
  for (const topicId of topicIds) {
    // Read CONTEXT.md
    const cp = contextPath(memoryDir, topicId);
    if (!existsSync(cp)) continue;

    // Remove any prior chunks for this topic so stale versions don't linger.
    purgeTopicChunks(db, topicId);

    const contextContent = readFileSync(cp, "utf-8");
    await indexTopic(topicId, contextContent);

    // Index resource files
    const rd = resourcesDir(memoryDir, topicId);
    if (existsSync(rd)) {
      const resources = readdirSync(rd).filter((f) => f.endsWith(".md"));
      for (const res of resources) {
        const resContent = readFileSync(join(rd, res), "utf-8");
        await indexTopic(topicId, resContent);
      }
    }

    // Update topic metadata
    const totalContent = [contextContent, ...readResourceContents(memoryDir, topicId)].join("\n");
    const tokenCount = countTokens(totalContent);
    const now = Math.floor(Date.now() / 1000);

    db.prepare(
      `INSERT INTO topics(id, path, summary, token_count, updated_at)
       VALUES (?, ?, '', ?, ?)
       ON CONFLICT(id) DO UPDATE SET
         token_count = excluded.token_count,
         updated_at = excluded.updated_at`,
    ).run(topicId, join("memory/topics", topicId, "CONTEXT.md").replace(/\\/g, "/"), tokenCount, now);
  }
}

function readResourceContents(memoryDir: string, topicId: string): string[] {
  const rd = resourcesDir(memoryDir, topicId);
  if (!existsSync(rd)) return [];

  return readdirSync(rd)
    .filter((f) => f.endsWith(".md"))
    .map((f) => readFileSync(join(rd, f), "utf-8"));
}