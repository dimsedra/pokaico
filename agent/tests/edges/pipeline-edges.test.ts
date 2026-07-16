import { describe, it, expect, beforeAll, afterAll, vi, beforeEach } from "vitest";
import { mkdtempSync, mkdirSync, writeFileSync, rmSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { createDb, closeDb, type PokaicoDb } from "../../src/db/client";

vi.mock("ai", () => ({
  generateText: vi.fn().mockResolvedValue({ text: "Mocked companion diary entry" }),
}));

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

function makeConversation(
  conversationDir: string,
  sessionId: string,
  startedAt: string,
  turns: Array<{ ts: string; role: string; content: string }>,
): string {
  const path = join(conversationDir, `2026-07-09-${sessionId}.md`);
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
  let conversationDir: string;
  let diaryDir: string;
  let memoryDir: string;

  beforeAll(() => {
    dir = mkdtempSync(join(tmpdir(), "edge-e2-"));
    db = createDb(join(dir, "test.db"));
    conversationDir = join(dir, "conversation");
    diaryDir = join(dir, "diary");
    memoryDir = join(dir, "memory");
    mkdirSync(conversationDir, { recursive: true });
    mkdirSync(diaryDir, { recursive: true });
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

    makeConversation(conversationDir, sessionId, startedAt1, [
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
      conversationDir,
      diaryDir,
    });

    // Verify topic was created
    const topicContent1 = readFileSync(
      join(memoryDir, "topics", "python-programming-interest", "CONTEXT.md"),
      "utf-8",
    );
    expect(topicContent1).toContain("User loves Python");

    // Now SIMULATE: change started_at from July 9 to July 10 (same turns)
    // Recreate conversation with new date
    const startedAt2 = "2026-07-10T08:00:00+07:00";
    makeConversation(conversationDir, sessionId, startedAt2, [
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
      conversationDir,
      diaryDir,
    });

    expect(result2.hasNewMessages).toBe(true);

    // The original topic file must NOT accumulate a duplicate copy of the same fact.
    const topicContent2 = readFileSync(
      join(memoryDir, "topics", "python-programming-interest", "CONTEXT.md"),
      "utf-8",
    );
    const occurrences = (topicContent2.match(/User loves Python/g) || []).length;
    expect(occurrences).toBe(1);
  });
});

describe("E5: Rapid double processSession", () => {
  let db: PokaicoDb;
  let dir: string;
  let conversationDir: string;
  let diaryDir: string;
  let memoryDir: string;

  beforeAll(() => {
    dir = mkdtempSync(join(tmpdir(), "edge-e5-"));
    db = createDb(join(dir, "test.db"));
    conversationDir = join(dir, "conversation");
    diaryDir = join(dir, "diary");
    memoryDir = join(dir, "memory");
    mkdirSync(conversationDir, { recursive: true });
    mkdirSync(diaryDir, { recursive: true });
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

    makeConversation(conversationDir, sessionId, startedAt, [
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

    const deps = {
      llm: mockLlm,
      searchSimilar,
      indexTopic,
      db,
      memoryDir,
      conversationDir,
      diaryDir,
    };

    // Fire two calls concurrently — session lock should serialize them
    const [r1, r2] = await Promise.all([
      processSession(sessionId, deps),
      processSession(sessionId, deps),
    ]);

    expect(mockSummarize.mock.calls.length).toBe(1);
    expect([r1.hasNewMessages, r2.hasNewMessages].filter(Boolean)).toHaveLength(1);
  });
});
