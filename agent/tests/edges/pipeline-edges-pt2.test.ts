import { describe, it, expect, beforeAll, afterAll, vi } from "vitest";
import { mkdtempSync, mkdirSync, writeFileSync, rmSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { createDb, closeDb, type PokaicoDb } from "../../src/db/client";

vi.mock("../../src/memory/summarizer", () => ({
  summarize: vi.fn(),
}));
vi.mock("../../src/memory/foundational", () => ({
  refreshFoundational: vi.fn(),
}));

// Mock guards to simulate DB failure
vi.mock("../../src/memory/guards", async () => {
  const actual = await vi.importActual("../../src/memory/guards");
  return {
    ...actual,
    updatePointer: vi.fn(),
  };
});

import { processSession } from "../../src/memory/pipeline";
import { summarize } from "../../src/memory/summarizer";
import { refreshFoundational } from "../../src/memory/foundational";
import { updatePointer } from "../../src/memory/guards";

const mockSummarize = vi.mocked(summarize);
const mockRefresh = vi.mocked(refreshFoundational);
const mockUpdatePointer = vi.mocked(updatePointer);

describe("E7: Pointer update failure after journal mark", () => {
  let db: PokaicoDb;
  let dir: string;
  let journalDir: string;
  let memoryDir: string;

  beforeAll(() => {
    dir = mkdtempSync(join(tmpdir(), "edge-e7-"));
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

  it("does NOT mark journal extracted when pointer update throws (FIXED)", async () => {
    const sessionId = "pointer-fail";
    const startedAt = "2026-07-09T12:00:00+07:00";
    const journalPath = join(journalDir, `2026-07-09-${sessionId}.md`);

    writeFileSync(
      journalPath,
      `---
session_id: ${sessionId}
started_at: ${startedAt}
model: test
extracted: false
---
## [12:00:00] User
Test content.
## [12:00:05] Pokai
Response.`,
      "utf-8",
    );

    mockSummarize.mockResolvedValue({
      summary: "Test summary.",
      keyPoints: ["Test point"],
    });
    mockRefresh.mockResolvedValue([]);
    mockUpdatePointer.mockImplementation(() => {
      throw new Error("DB disk full!");
    });

    const searchSimilar = vi.fn().mockResolvedValue([]);
    const indexTopic = vi.fn().mockResolvedValue(undefined);
    const mockLlm = {} as never;

    await expect(
      processSession(sessionId, {
        llm: mockLlm,
        searchSimilar,
        indexTopic,
        db,
        memoryDir,
        journalDir,
      }),
    ).rejects.toThrow();

    // updatePointer (Step 7) runs BEFORE markJournalExtracted (Step 8).
    // If the pointer write fails, the journal must stay extracted:false so the
    // session is safely retried on the next run.
    const journalContent = readFileSync(journalPath, "utf-8");
    expect(journalContent).toContain("extracted: false");
    expect(journalContent).not.toContain("extracted: true");
  });
});

describe("E3 v2: Large content updates replace the file (compact-on-update)", () => {
  it("keeps only the latest large update, dropping superseded content", async () => {
    const { applyChanges } = await import("../../src/memory/writer");
    const { existsSync } = await import("node:fs");
    const dir2 = mkdtempSync(join(tmpdir(), "edge-e3v2-"));
    const mem = join(dir2, "memory");
    mkdirSync(join(mem, "topics"), { recursive: true });

    await applyChanges(
      [{ topicId: "big-topic", action: "create", content: "Initial topic: " + "X".repeat(300) }],
      mem, "s0", 0,
    );

    for (let i = 1; i <= 30; i++) {
      const bigContent = `Update #${i}: ` + "Y".repeat(1900) + ` More stuff for iteration ${i}.`;
      await applyChanges(
        [{ topicId: "big-topic", action: "update", content: bigContent }],
        mem, `s${i}`, i,
      );
    }

    const content = readFileSync(join(mem, "topics", "big-topic", "CONTEXT.md"), "utf-8");
    const resourcesPath = join(mem, "topics", "big-topic", "resources");

    // Each update replaces the file — only the last update survives, no overflow.
    expect(content.startsWith("Update #30:")).toBe(true);
    expect(content).not.toContain("Initial topic");
    expect(content).not.toContain("Update #1:");
    expect(existsSync(resourcesPath)).toBe(false);

    rmSync(dir2, { recursive: true, force: true });
  });
});
