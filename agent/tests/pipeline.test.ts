import { describe, it, expect, beforeAll, afterAll, vi } from "vitest";
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { createDb, closeDb, type PokaicoDb } from "../src/db/client";
import { hasNewMessages, updatePointer } from "../src/memory/guards";

// Mock the LLM-dependent modules
vi.mock("../src/memory/summarizer", () => ({
  summarize: vi.fn(),
}));
vi.mock("../src/memory/foundational", () => ({
  refreshFoundational: vi.fn(),
}));

import { processSession } from "../src/memory/pipeline";
import { summarize } from "../src/memory/summarizer";
import { refreshFoundational } from "../src/memory/foundational";
import { withTopicLock } from "../src/memory/mutex";

const mockSummarize = vi.mocked(summarize);
const mockRefresh = vi.mocked(refreshFoundational);

describe("pipeline E2E", () => {
  let db: PokaicoDb;
  let dir: string;
  let journalDir: string;
  let memoryDir: string;

  beforeAll(() => {
    dir = mkdtempSync(join(tmpdir(), "pipeline-test-"));
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

  it("skips extraction if no new messages", async () => {
    const sessionId = "skip-session";
    const journalPath = join(journalDir, `2026-07-08-${sessionId}.md`);
    writeFileSync(journalPath, `---
session_id: ${sessionId}
started_at: 2026-07-08T14:00:00+07:00
model: test-model
extracted: false
---
## [14:00:00] User
Hello

## [14:00:05] Pokai
Hi there`, "utf-8");

    updatePointer(sessionId, 72005, db);

    const searchSimilar = vi.fn();
    const indexTopic = vi.fn();
    const mockLlm = {} as never;

    const result = await processSession(sessionId, {
      llm: mockLlm,
      searchSimilar,
      indexTopic,
      db,
      memoryDir,
      journalDir,
      lock: withTopicLock,
    });

    expect(result.hasNewMessages).toBe(false);
    expect(mockSummarize).not.toHaveBeenCalled();
    expect(searchSimilar).not.toHaveBeenCalled();
    expect(indexTopic).not.toHaveBeenCalled();
  });

  it("runs full pipeline on new messages", async () => {
    const sessionId = "full-run";
    const journalPath = join(journalDir, `2026-07-08-${sessionId}.md`);
    writeFileSync(journalPath, `---
session_id: ${sessionId}
started_at: 2026-07-08T15:00:00+07:00
model: test-model
extracted: false
---
## [15:00:00] User
I love hiking and mountain views.

## [15:00:10] Pokai
That's great!

## [15:00:20] User
Mount Kinabalu was amazing.`, "utf-8");

    mockSummarize.mockResolvedValue({
      summary: "User loves hiking, especially Mount Kinabalu.",
      keyPoints: ["User enjoys hiking", "Mount Kinabalu was memorable"],
    });

    mockRefresh.mockResolvedValue([]);

    const searchSimilar = vi.fn().mockResolvedValue([]);
    const indexTopic = vi.fn().mockResolvedValue(undefined);
    const mockLlm = {} as never;

    const result = await processSession(sessionId, {
      llm: mockLlm,
      searchSimilar,
      indexTopic,
      db,
      memoryDir,
      journalDir,
      lock: withTopicLock,
    });

    expect(result.hasNewMessages).toBe(true);
    expect(result.summary).toBeTruthy();
    expect(mockSummarize).toHaveBeenCalledOnce();
    expect(mockRefresh).toHaveBeenCalledOnce();
    expect(result.reindexed).toHaveLength(1);

    // Journal should be marked as extracted
    const updatedJournal = await import("node:fs").then((fs) =>
      fs.readFileSync(journalPath, "utf-8"),
    );
    expect(updatedJournal).toContain("extracted: true");

    // Pointer should be updated
    expect(hasNewMessages(sessionId, db, 54020)).toBe(false);
  });

  it("handles foundational topic updates", async () => {
    const sessionId = "foundational-run";
    const journalPath = join(journalDir, `2026-07-08-${sessionId}.md`);
    writeFileSync(journalPath, `---
session_id: ${sessionId}
started_at: 2026-07-08T16:00:00+07:00
model: test-model
extracted: false
---
## [16:00:00] User
I prefer a casual chat style.

## [16:00:05] Pokai
Noted!

## [16:00:10] User
Yeah don't be too formal with me.`, "utf-8");

    // Seed foundational topic
    const profileDir = join(memoryDir, "topics", "user-communication");
    mkdirSync(profileDir, { recursive: true });
    writeFileSync(join(profileDir, "CONTEXT.md"), "User likes casual tone.", "utf-8");

    db.prepare(
      "INSERT OR IGNORE INTO topics(id, path, summary, token_count, is_foundational, updated_at) VALUES (?, ?, ?, ?, ?, ?)",
    ).run("user-communication", "memory/topics/user-communication/CONTEXT.md", "", 5, 1, 0);

    mockSummarize.mockResolvedValue({
      summary: "User wants casual chat style, not formal.",
      keyPoints: ["User prefers casual tone"],
    });

    mockRefresh.mockResolvedValue([
      {
        topicId: "user-communication",
        newContent: "User prefers casual tone. Do not be too formal.",
        hasNewInfo: true,
      },
    ]);

    const searchSimilar = vi.fn().mockResolvedValue([]);
    const indexTopic = vi.fn().mockResolvedValue(undefined);
    const mockLlm = {} as never;

    const result = await processSession(sessionId, {
      llm: mockLlm,
      searchSimilar,
      indexTopic,
      db,
      memoryDir,
      journalDir,
      lock: withTopicLock,
    });

    expect(result.updates).toHaveLength(1);
    expect(result.updates[0].topicId).toBe("user-communication");

    // CONTEXT.md should be updated
    const content = await import("node:fs").then((fs) =>
      fs.readFileSync(join(profileDir, "CONTEXT.md"), "utf-8"),
    );
    expect(content).toContain("casual");
    expect(content).toContain("formal");
  });

  it("marks journal as extracted on success", async () => {
    const sessionId = "mark-extracted";
    const journalPath = join(journalDir, `2026-07-08-${sessionId}.md`);
    writeFileSync(journalPath, `---
session_id: ${sessionId}
started_at: 2026-07-08T17:00:00+07:00
model: test-model
extracted: false
---
## [17:00:00] User
Test message.`, "utf-8");

    mockSummarize.mockResolvedValue({
      summary: "Test session.",
      keyPoints: ["Test point"],
    });
    mockRefresh.mockResolvedValue([]);

    const searchSimilar = vi.fn().mockResolvedValue([]);
    const indexTopic = vi.fn().mockResolvedValue(undefined);
    const mockLlm = {} as never;

    await processSession(sessionId, {
      llm: mockLlm,
      searchSimilar,
      indexTopic,
      db,
      memoryDir,
      journalDir,
      lock: withTopicLock,
    });

    const updated = await import("node:fs").then((fs) =>
      fs.readFileSync(journalPath, "utf-8"),
    );
    expect(updated).toContain("extracted: true");
  });
});