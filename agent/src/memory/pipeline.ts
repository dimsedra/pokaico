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
import { createMutex } from "./mutex";
import type { SummaryOutput, FoundationalUpdate, PipelineResult } from "./types";

const withSessionLock = createMutex();

export type PipelineDeps = {
  llm: LanguageModelV1;
  searchSimilar: (query: string, limit?: number) => Promise<SearchResult[]>;
  indexTopic: (topicId: string, content: string) => Promise<void>;
  db: PokaicoDb;
  memoryDir: string;
  journalDir: string;
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
const JOURNAL_FILE_RE = /^\d{4}-\d{2}-\d{2}-(.+)\.md$/;

function parseUnixTimestamp(startedAt: string, hhMmSs: string): number {
  // Replace the time portion in started_at ISO string with the turn's HH:mm:ss
  // This preserves the timezone offset correctly
  const datePart = startedAt.substring(0, 10);
  const tzPart = startedAt.slice(19);
  const isoString = `${datePart}T${hhMmSs}${tzPart}`;
  const ts = new Date(isoString).getTime();
  return isNaN(ts) ? 0 : ts;
}

function getLatestUnixTimestamp(filePath: string): number {
  const content = readFileSync(filePath, "utf-8");

  // Parse frontmatter started_at
  const fmMatch = content.match(/^started_at:\s*(.+)$/m);
  if (!fmMatch) return 0;
  const startedAt = fmMatch[1].trim();

  // Find last timestamp in turns
  const turnTimestamps: string[] = [];
  const turnRe = /^## \[(\d{2}:\d{2}:\d{2})\]/gm;
  let m: RegExpExecArray | null;
  while ((m = turnRe.exec(content)) !== null) {
    turnTimestamps.push(m[1]);
  }
  if (turnTimestamps.length === 0) return 0;

  const lastTurn = turnTimestamps[turnTimestamps.length - 1];
  return parseUnixTimestamp(startedAt, lastTurn);
}

function findJournalFile(journalDir: string, sessionId: string): string | null {
  if (!existsSync(journalDir)) return null;
  const entries = readdirSync(journalDir);
  for (const entry of entries) {
    const match = entry.match(JOURNAL_FILE_RE);
    if (match && match[1] === sessionId) {
      return join(journalDir, entry);
    }
  }
  return null;
}

function markJournalExtracted(filePath: string): void {
  const content = readFileSync(filePath, "utf-8");

  // Replace only within frontmatter (first YAML block between --- markers)
  const fmStart = content.indexOf("---\n");
  const fmEnd = content.indexOf("\n---", fmStart + 4);
  if (fmStart === -1 || fmEnd === -1) return;

  const before = content.slice(0, fmStart + 4);
  const fmBody = content.slice(fmStart + 4, fmEnd);
  const after = content.slice(fmEnd);

  const updatedFm = fmBody.replace(/^extracted: false$/m, "extracted: true");
  if (updatedFm === fmBody) return;

  writeFileSync(filePath, `${before}${updatedFm}${after}`, "utf-8");
}

function truncate(content: string, max: number): string {
  return content.length > max ? content.slice(0, max) + "..." : content;
}

const RETRY_COUNT = 1;

async function withRetry<T>(
  label: string,
  fn: () => Promise<T>,
  retries: number = RETRY_COUNT,
): Promise<T> {
  for (let attempt = 0; attempt <= retries; attempt++) {
    try {
      return await fn();
    } catch (err) {
      if (attempt < retries) {
        continue;
      }
      throw err;
    }
  }
  throw new Error(`${label} failed after ${retries + 1} attempts`);
}

export async function processSession(
  sessionId: string,
  deps: PipelineDeps,
): Promise<PipelineResult> {
  return withSessionLock(sessionId, async () => {
  const { llm, searchSimilar, indexTopic, db, memoryDir, journalDir } = deps;

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

  const latestTs = getLatestUnixTimestamp(fullPath);
  if (latestTs === 0) {
    return {
      sessionId,
      hasNewMessages: false,
      summary: null,
      updates: [],
      changes: [],
      reindexed: [],
      error: "Could not parse timestamp from journal file",
    };
  }

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

  let summary: SummaryOutput;
  try {
    summary = await withRetry("summarize", () => defaultSummarize(session.turns, llm));
  } catch (err) {
    return {
      sessionId,
      hasNewMessages: true,
      summary: null,
      updates: [],
      changes: [],
      reindexed: [],
      error: `Summarization failed: ${(err as Error).message}`,
    };
  }

  // Step 3: Refresh foundational topics
  let updates: FoundationalUpdate[] = [];
  try {
    const foundationalTopics = FOUNDATIONAL_TOPIC_IDS.map((topicId) => ({
      topicId,
      currentContent: truncate(readTopic(memoryDir, topicId) ?? "", 700),
    }));
    updates = await withRetry("refreshFoundational", () =>
      defaultRefresh(summary, foundationalTopics, llm),
    );
  } catch (err) {
    // Non-fatal: log and continue
  }

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
  const writtenTopics = await applyChanges(changes, memoryDir, sessionId, latestTs);

  // Apply foundational updates
  const foundationalUpdated: string[] = [];
  for (const update of updates) {
    if (update.newContent !== null) {
      updateTopic(memoryDir, update.topicId, update.newContent);
      foundationalUpdated.push(update.topicId);
    }
  }

  const allUpdated = [...new Set([...writtenTopics, ...foundationalUpdated])];

  // Step 6: Re-index
  if (allUpdated.length > 0) {
    await reindexTopics(allUpdated, memoryDir, db, indexTopic);
  }

  // Step 7: Update pointer (do this BEFORE marking journal as extracted)
  // If this fails, the journal stays extracted:false and will be re-processed safely
  updatePointer(sessionId, latestTs, db);

  // Step 8: Mark journal extracted
  markJournalExtracted(fullPath);

  return {
    sessionId,
    hasNewMessages: true,
    summary,
    updates,
    changes,
    reindexed: allUpdated,
  };
  });
}