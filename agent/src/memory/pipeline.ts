import { readFileSync, writeFileSync, readdirSync, existsSync } from "node:fs";
import { join } from "node:path";
import type { LanguageModelV1 } from "ai";
import type { PokaicoDb } from "../db/client";
import { readSession } from "./journal";
import { readTopic, updateTopic, regenerateIndex, parseIndex } from "./topics";
import { hasNewMessages, updatePointer } from "./guards";
import { summarize as defaultSummarize } from "./summarizer";
import { refreshFoundational as defaultRefresh } from "./foundational";
import { extractTopics } from "./extract";
import { applyChanges } from "./writer";
import { reindexTopics } from "./reindexer";
import { createMutex } from "./mutex";
import { compact as defaultCompact } from "./compactor";
import { CONTEXT_CAP, FOUNDATIONAL_CAP } from "./tokens";
import { writeEdge, writeResource } from "./edges";
import type {
  SummaryOutput,
  FoundationalUpdate,
  PipelineResult,
  CompactResult,
  TopicChange,
} from "./types";

export type CompactFn = (input: {
  current: string;
  newInfo: string;
  cap: number;
}) => Promise<CompactResult>;

const withSessionLock = createMutex();

export type PipelineDeps = {
  llm: LanguageModelV1;
  searchSimilar: (query: string, limit?: number) => Promise<SearchResult[]>;
  indexTopic: (topicId: string, content: string) => Promise<void>;
  db: PokaicoDb;
  memoryDir: string;
  journalDir: string;
  compact?: CompactFn;
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

const FOUNDATIONAL_TOPIC_IDS = ["user-profile", "user-background", "user-patterns"];
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
  const compact: CompactFn =
    deps.compact ??
    ((input) => defaultCompact({ ...input, model: llm }));

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
      currentContent: readTopic(memoryDir, topicId) ?? "",
    }));
    updates = await withRetry("refreshFoundational", () =>
      defaultRefresh(summary, foundationalTopics, llm, sessionId),
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

  // Audit before create (issue #4): read the canonical routing map so
  // extraction can deterministically UPDATE an existing slug instead of
  // duplicating it. Foundational topics are excluded — they are owned by the
  // refreshFoundational step, not by extraction.
  const indexTopics = parseIndex(memoryDir);
  const indexSlugs = new Set(
    indexTopics
      .map((t) => t.topicId)
      .filter((id) => !FOUNDATIONAL_TOPIC_IDS.includes(id)),
  );

  const changes = await extractTopics(summary, existingMeta, searchSimilar, indexSlugs);

  // Compact update-changes before writing: LLM condenses current + new info
  // into the token cap (runs BEFORE acquiring per-topic write locks).
  const resolvedChanges: TopicChange[] = [];
  for (const change of changes) {
    if (change.action === "update") {
      try {
        const current = readTopic(memoryDir, change.topicId) ?? "";
        const result = await compact({
          current,
          newInfo: change.content,
          cap: CONTEXT_CAP,
          model: llm as never,
          existingEdges: change.edges,
        });
        resolvedChanges.push({
          ...change,
          content: result.context,
          overflow: result.overflow,
          edges: result.edges,
        });
      } catch {
        // Compaction failed — fall back to writing the raw new info.
        resolvedChanges.push(change);
      }
    } else {
      resolvedChanges.push(change);
    }
  }

  // Step 5: Write phase
  const writtenTopics = await applyChanges(resolvedChanges, memoryDir, sessionId, latestTs);

  // Apply foundational updates — condense to the foundational cap.
  const foundationalUpdated: string[] = [];
  for (const update of updates) {
    if (update.newContent !== null) {
      let content = update.newContent;
      try {
        const result = await compact({
          current: "",
          newInfo: update.newContent,
          cap: FOUNDATIONAL_CAP,
        });
        content = result.context;
      } catch {
        // Condensation failed — write the un-condensed content.
      }
      updateTopic(memoryDir, update.topicId, content);
      foundationalUpdated.push(update.topicId);
    }
  }

  const allUpdated = [...new Set([...writtenTopics, ...foundationalUpdated])];

  // Step 6: Re-index (also upserts topic rows, needed before edges/resources FK)
  if (allUpdated.length > 0) {
    await reindexTopics(allUpdated, memoryDir, db, indexTopic);
  }

  // Step 6b: Record graph — overflow resources and LLM-judged cross-topic edges.
  for (const change of resolvedChanges) {
    if (change.overflow) {
      for (const o of change.overflow) {
        writeResource(
          db,
          change.topicId,
          `memory/topics/${change.topicId}/resources/${o.filename}`,
          "md",
        );
      }
    }
    if (change.edges) {
      for (const e of change.edges) {
        writeEdge(db, change.topicId, e.toTopic, e.relationship, e.reason);
      }
    }
  }

  // Step6c (observer): rebuild INDEX.md from the current topic graph so the
  // routing map stays fresh after every extraction (issue #3). Deterministic,
  // LLM-free — runs after all edges/resources are recorded above.
  // Non-critical: a failure here must NOT abort the extraction (which would
  // leave the journal unmarked and re-trigger on the next run), so swallow it.
  try {
    regenerateIndex(memoryDir, db);
  } catch (err) {
    console.error("[pokaico] regenerateIndex failed:", err);
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