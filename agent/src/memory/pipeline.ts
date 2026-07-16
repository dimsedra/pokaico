import { readFileSync, writeFileSync, readdirSync, existsSync } from "node:fs";
import { join } from "node:path";
import type { LanguageModel } from "ai";
import type { PokaicoDb } from "../db/client";
import { readSession } from "./conversation";
import { generateCompanionDiary, writeDiaryEntry } from "./diary";
import { readTopic, updateTopic, regenerateIndex, parseIndex, FOUNDATIONAL_TOPIC_IDS } from "./topics";
import { hasNewMessages, updatePointer } from "./guards";
import { summarize as defaultSummarize } from "./summarizer";
import { refreshFoundational as defaultRefresh } from "./foundational";
import { extractTopics } from "./extract";
import { applyChanges } from "./writer";
import { reindexTopics } from "./reindexer";
import { createMutex } from "./mutex";
import { compact as defaultCompact } from "./compactor";
import { CONTEXT_CAP, FOUNDATIONAL_CAP } from "./tokens";
import { writeEdge, writeResource, getEdges } from "./edges";
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
  model?: any;
  existingEdges?: any[];
}) => Promise<CompactResult>;

const withSessionLock = createMutex();

export type PipelineDeps = {
  llm: LanguageModel;
  searchSimilar: (query: string, limit?: number) => Promise<SearchResult[]>;
  indexTopic: (topicId: string, content: string) => Promise<void>;
  db: PokaicoDb;
  memoryDir: string;
  conversationDir: string;
  diaryDir: string;
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

const CONVERSATION_FILE_RE = /^\d{4}-\d{2}-\d{2}-(.+)\.md$/;

function parseUnixTimestamp(startedAt: string, hhMmSs: string): number {
  const datePart = startedAt.substring(0, 10);
  const tzPart = startedAt.slice(19);
  const isoString = `${datePart}T${hhMmSs}${tzPart}`;
  let ts = new Date(isoString).getTime();
  if (isNaN(ts)) return 0;

  const startTs = new Date(startedAt).getTime();
  if (ts < startTs) {
    ts += 24 * 60 * 60 * 1000;
  }
  return ts;
}

function getLatestUnixTimestamp(filePath: string): number {
  const content = readFileSync(filePath, "utf-8");

  const fmMatch = content.match(/^started_at:\s*(.+)$/m);
  if (!fmMatch) return 0;
  const startedAt = fmMatch[1].trim();

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

function findConversationFile(conversationDir: string, sessionId: string): string | null {
  if (!existsSync(conversationDir)) return null;
  const entries = readdirSync(conversationDir);
  for (const entry of entries) {
    const match = entry.match(CONVERSATION_FILE_RE);
    if (match && match[1] === sessionId) {
      return join(conversationDir, entry);
    }
  }
  return null;
}

function markConversationExtracted(filePath: string): void {
  const content = readFileSync(filePath, "utf-8");

  const fmStart = content.indexOf("---\n");
  const fmEnd = content.indexOf("\n---", fmStart + 4);
  if (fmStart === -1 || fmEnd === -1) return;

  const before = content.slice(0, fmStart + 4);
  const fmBody = content.slice(fmStart + 4, fmEnd);
  const after = content.slice(fmEnd);

  const updatedFm = fmBody.replace(/^extracted:\s*["']?false["']?\s*$/m, "extracted: true");
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
    const { llm, searchSimilar, indexTopic, db, memoryDir, conversationDir, diaryDir } = deps;
    const compact: CompactFn =
      deps.compact ??
      ((input) => defaultCompact({ ...input, model: llm }));

    // Defensive: reject sessionIds that could inject prompt-breaking characters
    if (!/^[\w][\w-]{0,80}$/.test(sessionId)) {
      return {
        sessionId,
        hasNewMessages: false,
        summary: null,
        updates: [],
        changes: [],
        reindexed: [],
        error: `Invalid sessionId format: "${sessionId}"`,
      };
    }

    const fullPath = findConversationFile(conversationDir, sessionId);
    if (!fullPath) {
      return {
        sessionId,
        hasNewMessages: false,
        summary: null,
        updates: [],
        changes: [],
        reindexed: [],
        error: "Conversation file not found",
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
        error: "Could not parse timestamp from conversation file",
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

    // Read conversation
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

    // Cozy Diary Generation Step
    try {
      const diaryContent = await withRetry("diary", () => generateCompanionDiary(session.turns, llm));
      const datePart = session.startedAt.substring(0, 10);
      const diaryPath = join(diaryDir, `${datePart}-${sessionId}.md`);

      await writeDiaryEntry(
        diaryPath,
        diaryContent,
        sessionId,
        session.startedAt,
        session.lastActiveAt
      );
    } catch (diaryErr) {
      console.error("[pokaico] Companion diary generation failed:", diaryErr);
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
      console.error("[pokaico] refreshFoundational failed:", err);
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

    const indexTopics = parseIndex(memoryDir);
    const indexSlugs = new Set(
      indexTopics
        .map((t) => t.topicId)
        .filter((id) => !FOUNDATIONAL_TOPIC_IDS.includes(id)),
    );

    const changes = await extractTopics(summary, existingMeta, searchSimilar, indexSlugs);

    // Compact update-changes before writing
    const resolvedChanges: TopicChange[] = [];
    for (const change of changes) {
      if (change.action === "update") {
        try {
          const current = readTopic(memoryDir, change.topicId) ?? "";
          const dbEdges = getEdges(db, change.topicId);
          const mergedEdges = [...(change.edges ?? [])];
          for (const dbEdge of dbEdges) {
            if (!mergedEdges.some((e) => e.toTopic === dbEdge.toTopic && e.relationship === dbEdge.relationship)) {
              mergedEdges.push(dbEdge);
            }
          }
          const result = await compact({
            current,
            newInfo: change.content,
            cap: CONTEXT_CAP,
            model: llm as never,
            existingEdges: mergedEdges,
          });
          resolvedChanges.push({
            ...change,
            content: result.context,
            overflow: result.overflow,
            edges: result.edges,
          });
        } catch {
          resolvedChanges.push(change);
        }
      } else {
        resolvedChanges.push(change);
      }
    }

    // Step 5: Write phase
    const writtenTopics = await applyChanges(resolvedChanges, memoryDir, sessionId, latestTs);

    // Apply foundational updates
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
          // ignore
        }
        updateTopic(memoryDir, update.topicId, content);
        foundationalUpdated.push(update.topicId);
      }
    }

    const allUpdated = [...new Set([...writtenTopics, ...foundationalUpdated])];

    // Step 6: Re-index
    if (allUpdated.length > 0) {
      await reindexTopics(allUpdated, memoryDir, db, indexTopic);
    }

    // Step 6b: Record graph
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

    // Step 6c (observer)
    try {
      regenerateIndex(memoryDir, db);
    } catch (err) {
      console.error("[pokaico] regenerateIndex failed:", err);
    }

    // Step 7: Update pointer
    updatePointer(sessionId, latestTs, db);

    // Step 8: Mark conversation extracted
    markConversationExtracted(fullPath);

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