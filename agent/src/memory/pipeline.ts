import { readFileSync, writeFileSync, readdirSync, existsSync } from "node:fs";
import { join } from "node:path";
import type { LanguageModelV1 } from "ai";
import type { PokaicoDb } from "../db/client";
import { readSession } from "./journal";
import { readTopic, updateTopic } from "./topics";
import { hasNewMessages, updatePointer } from "./guards";
import { summarize as defaultSummarize } from "./summarizer";
import { refreshFoundational as defaultRefresh } from "./foundational";
import { extractTopics } from "./extract";
import { applyChanges } from "./writer";
import { reindexTopics } from "./reindexer";
import { withTopicLock } from "./mutex";
import type { SummaryOutput, FoundationalUpdate, PipelineResult, TopicChange } from "./types";

export type PipelineDeps = {
  llm: LanguageModelV1;
  searchSimilar: (query: string, limit?: number) => Promise<SearchResult[]>;
  indexTopic: (topicId: string, content: string) => Promise<void>;
  db: PokaicoDb;
  memoryDir: string;
  journalDir: string;
  lock: typeof withTopicLock;
};

type SearchResult = {
  topicId: string;
  score: number;
  content: string;
  sourcePath: string;
};

type TopicRow = {
  id: string;
  summary: string;
  is_foundational: number;
  updated_at: number;
};

const FOUNDATIONAL_TOPIC_IDS = ["user-profile", "user-background", "user-communication"];

function getLatestTimestamp(filePath: string): number {
  const content = readFileSync(filePath, "utf-8");
  const match = content.matchAll(/\[(\d{2}):(\d{2}):(\d{2})\]/g);
  let latest = 0;
  for (const m of match) {
    const h = parseInt(m[1], 10);
    const min = parseInt(m[2], 10);
    const s = parseInt(m[3], 10);
    const ts = h * 3600 + min * 60 + s;
    if (ts > latest) latest = ts;
  }
  return latest;
}

function findJournalFile(journalDir: string, sessionId: string): string | null {
  if (!existsSync(journalDir)) return null;
  const entries = readdirSync(journalDir);
  const match = entries.find((f) => f.includes(sessionId) && f.endsWith(".md"));
  return match ? join(journalDir, match) : null;
}

function markJournalExtracted(filePath: string): void {
  const content = readFileSync(filePath, "utf-8");
  const updated = content.replace(/^extracted: false$/m, "extracted: true");
  if (updated !== content) {
    writeFileSync(filePath, updated, "utf-8");
  }
}

function truncate(content: string, max: number): string {
  return content.length > max ? content.slice(0, max) + "..." : content;
}

export async function processSession(
  sessionId: string,
  deps: PipelineDeps,
): Promise<PipelineResult> {
  const { llm, searchSimilar, indexTopic, db, memoryDir, journalDir, lock } = deps;

  const fullPath = findJournalFile(journalDir, sessionId);
  if (!fullPath) {
    return {
      sessionId,
      hasNewMessages: false,
      summary: null,
      updates: [],
      changes: [],
      reindexed: [],
      error: "Journal file not found",
    };
  }

  const latestTs = getLatestTimestamp(fullPath);

  // Step 1: Guard
  if (!hasNewMessages(sessionId, db, latestTs)) {
    return {
      sessionId,
      hasNewMessages: false,
      summary: null,
      updates: [],
      changes: [],
      reindexed: [],
    };
  }

  // Read journal
  const session = readSession(fullPath);

  // Step 2: Summarize
  const summary = await defaultSummarize(session.turns, llm);

  // Step 3: Refresh foundational topics
  const foundationalTopics = FOUNDATIONAL_TOPIC_IDS.map((topicId) => ({
    topicId,
    currentContent: truncate(readTopic(memoryDir, topicId) ?? "", 700),
  }));
  const updates = await defaultRefresh(summary, foundationalTopics, llm);

  // Step 4: Extract topics (similarity-gated)
  const existingRows = db
    .prepare("SELECT id, summary, is_foundational, updated_at FROM topics")
    .all() as TopicRow[];

  const existingMeta = existingRows.map((r) => ({
    topicId: r.id,
    summary: r.summary,
    isFoundational: r.is_foundational === 1,
    updatedAt: r.updated_at,
  }));

  const changes = await extractTopics(summary, existingMeta, searchSimilar);

  // Step 5: Write phase
  const writtenTopics = await applyChanges(changes, memoryDir, lock, sessionId, latestTs);

  // Apply foundational updates
  const foundationalUpdated: string[] = [];
  for (const update of updates) {
    if (update.newContent !== null) {
      await lock(update.topicId, async () => {
        updateTopic(memoryDir, update.topicId, update.newContent!);
        foundationalUpdated.push(update.topicId);
      });
    }
  }

  const allUpdated = [...new Set([...writtenTopics, ...foundationalUpdated])];

  // Step 6: Re-index
  if (allUpdated.length > 0) {
    await reindexTopics(allUpdated, memoryDir, db, indexTopic);
  }

  // Step 7: Mark journal extracted
  markJournalExtracted(fullPath);

  // Step 8: Update pointer
  updatePointer(sessionId, latestTs, db);

  return {
    sessionId,
    hasNewMessages: true,
    summary,
    updates,
    changes,
    reindexed: allUpdated,
  };
}