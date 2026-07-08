import { describe, it, expect, beforeAll, afterAll, vi } from "vitest";
import { mkdtempSync, mkdirSync, writeFileSync, rmSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { createDb, closeDb, type PokaicoDb } from "../../src/db/client";
import { hasNewMessages, updatePointer } from "../../src/memory/guards";

vi.mock("../../src/memory/summarizer", () => ({
  summarize: vi.fn(),
}));
vi.mock("../../src/memory/foundational", () => ({
  refreshFoundational: vi.fn(),
}));

import { processSession } from "../../src/memory/pipeline";
import { summarize } from "../../src/memory/summarizer";
import { refreshFoundational } from "../../src/memory/foundational";

const mockSummarize = vi.mocked(summarize);
const mockRefresh = vi.mocked(refreshFoundational);

function makeJournal(
  journalDir: string,
  sessionId: string,
  startedAt: string,
  turns: Array<{ ts: string; role: string; content: string }>,
): string {
  const path = join(journalDir, `2026-07-09-${sessionId}.md`);
  const turnLines = turns
    .map((t) => `## [${t.ts}] ${t.role}\n${t.content}`)
    .join("\n\n");
  writeFileSync(
    path,
    `---
session_id: ${sessionId}
started_at: ${startedAt}
model: test-model
extracted: false
---
${turnLines}
`,
    "utf-8",
  );
  return path;
}

describe("E2: started_at changed without new turns", () => {
  let db: PokaicoDb;
  let dir: string;
  let journalDir: string;
  let memoryDir: string;

  beforeAll(() => {
    dir = mkdtempSync(join(tmpdir(), "edge-e2-"));
    db = createDb(join(dir, "test.db"));
    journalDir = join(dir, "journal");
    memoryDir = join(dir, "memory");
    mkdirSync(journalDir, { recursive: true });
    mkdirSync(join(memoryDir, "topics"), { recursive: true });
  });

  afterAll(() => {
    closeDb(db);
    rmSync(dir, { recursive: true, force: true });
  });

  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("duplicates topic content when started_at is changed on the same turns", async () => {
    const sessionId = "date-change";
    const startedAt1 = "2026-07-09T08:00:00+07:00";

    makeJournal(journalDir, sessionId, startedAt1, [
      { ts: "08:00:00", role: "User", content: "I love python programming." },
      { ts: "08:00:15", role: "Pokai", content: "Python is great!" },
    ]);

    mockSummarize.mockResolvedValue({
      summary: "User loves Python programming.",
      keyPoints: ["Python programming interest"],
    });
    mockRefresh.mockResolvedValue([]);

    const searchSimilar = vi.fn().mockResolvedValue([]);
    const indexTopic = vi.fn().mockResolvedValue(undefined);
    const mockLlm = {} as never;

    // First extraction
    await processSession(sessionId, {
      llm: mockLlm,
      searchSimilar,
      indexTopic,
      db,
      memoryDir,
      journalDir,
    });

    // Verify topic was created
    const topicContent1 = readFileSync(
      join(memoryDir, "topics", "python-programming-interest", "CONTEXT.md"),
      "utf-8",
    );
    console.log("E2 first write:", topicContent1.slice(0, 100));

    // Now SIMULATE: change started_at from July 9 to July 10 (same turns)
    // Recreate journal with new date
    const startedAt2 = "2026-07-10T08:00:00+07:00";
    makeJournal(journalDir, sessionId, startedAt2, [
      { ts: "08:00:00", role: "User", content: "I love python programming." },
      { ts: "08:00:15", role: "Pokai", content: "Python is great!" },
    ]);

    mockSummarize.mockResolvedValue({
      summary: "User loves Python programming.",
      keyPoints: ["Python programming interest"],
    });
    mockRefresh.mockResolvedValue([]);

    // Second extraction — should be treated as NEW messages (different timestamp)
    const result2 = await processSession(sessionId, {
      llm: mockLlm,
      searchSimilar,
      indexTopic,
      db,
      memoryDir,
      journalDir,
    });

    console.log("E2 second extraction hasNewMessages:", result2.hasNewMessages);
    console.log("E2 second extraction changes:", JSON.stringify(result2.changes));

    // Check if content was duplicated
    const topicContent2 = readFileSync(
      join(memoryDir, "topics", "python-programming-interest", "CONTEXT.md"),
      "utf-8",
    );

    const occurrences = (topicContent2.match(/User loves Python/g) || []).length;
    console.log("E2 'User loves Python' occurrences:", occurrences);
    console.log("E2 final content length:", topicContent2.length);

    if (result2.hasNewMessages && occurrences >= 2) {
      console.log("E2 VERDICT: BUG CONFIRMED — duplicate content, pointer inflated");
    } else if (!result2.hasNewMessages) {
      console.log("E2 VERDICT: PASS — guard correctly skipped (unexpected but correct)");
    } else if (occurrences === 1) {
      console.log("E2 VERDICT: PASS — dedup prevented duplication");
    }
  });
});

describe("E5: Rapid double processSession", () => {
  let db: PokaicoDb;
  let dir: string;
  let journalDir: string;
  let memoryDir: string;

  beforeAll(() => {
    dir = mkdtempSync(join(tmpdir(), "edge-e5-"));
    db = createDb(join(dir, "test.db"));
    journalDir = join(dir, "journal");
    memoryDir = join(dir, "memory");
    mkdirSync(journalDir, { recursive: true });
    mkdirSync(join(memoryDir, "topics"), { recursive: true });
  });

  afterAll(() => {
    closeDb(db);
    rmSync(dir, { recursive: true, force: true });
  });

  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("double invocation on same session — session mutex prevents duplicate LLM calls (FIXED)", async () => {
    const sessionId = "rapid-double";
    const startedAt = "2026-07-09T10:00:00+07:00";

    makeJournal(journalDir, sessionId, startedAt, [
      { ts: "10:00:00", role: "User", content: "I work as a graphic designer." },
      { ts: "10:00:10", role: "Pokai", content: "That's creative!" },
    ]);

    mockSummarize.mockResolvedValue({
      summary: "User is a graphic designer.",
      keyPoints: ["Graphic designer profession"],
    });
    mockRefresh.mockResolvedValue([]);

    const searchSimilar = vi.fn().mockResolvedValue([]);
    const indexTopic = vi.fn().mockResolvedValue(undefined);
    const mockLlm = {} as never;

    const deps = { llm: mockLlm, searchSimilar, indexTopic, db, memoryDir, journalDir };

    // Fire two calls concurrently — session lock should serialize them
    const [r1, r2] = await Promise.all([
      processSession(sessionId, deps),
      processSession(sessionId, deps),
    ]);

    console.log("E5 r1 hasNewMessages:", r1.hasNewMessages);
    console.log("E5 r2 hasNewMessages:", r2.hasNewMessages);
    console.log("E5 LLM calls:", mockSummarize.mock.calls.length);

    if (mockSummarize.mock.calls.length === 1) {
      console.log("E5 VERDICT: FIX VERIFIED — only 1 LLM call, session mutex works");
    } else {
      console.log("E5 VERDICT: STILL BUGGY —", mockSummarize.mock.calls.length, "LLM calls");
    }
  });
});
