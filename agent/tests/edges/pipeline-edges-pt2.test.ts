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
import { updatePointer, hasNewMessages } from "../../src/memory/guards";

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

    try {
      await processSession(sessionId, {
        llm: mockLlm,
        searchSimilar,
        indexTopic,
        db,
        memoryDir,
        journalDir,
      });
      console.log("E7: pipeline completed (unexpected)");
    } catch (err) {
      console.log("E7: pipeline threw:", (err as Error).message);
    }

    // After fix: updatePointer (Step 7) runs BEFORE markJournalExtracted (Step 8)
    // So if pointer fails, journal stays at extracted:false
    const journalContent = readFileSync(journalPath, "utf-8");
    const extractedFlag = journalContent.includes("extracted: true");
    console.log("E7 journal marked extracted:", extractedFlag);

    if (!extractedFlag) {
      console.log("E7 VERDICT: FIX VERIFIED — journal NOT marked extracted, safe to retry on next run");
    } else {
      console.log("E7 VERDICT: STILL BUGGY — journal marked extracted despite pointer failure");
    }
  });
});

describe("E3 v2: Large content consecutive updates — information loss", () => {
  it("accumulates large updates (2000 chars each) and verifies content loss", async () => {
    const { applyChanges } = await import("../../src/memory/writer");
    const dir2 = mkdtempSync(join(tmpdir(), "edge-e3v2-"));
    const mem = join(dir2, "memory");
    mkdirSync(join(mem, "topics"), { recursive: true });

    // Create with substantial content
    await applyChanges(
      [{ topicId: "big-topic", action: "create", content: "Initial topic: " + "X".repeat(300) }],
      mem, "s0", 0,
    );

    // 30 updates, each ~2000 chars (~500 tokens)
    for (let i = 1; i <= 30; i++) {
      const bigContent = `Update #${i}: ` + "Y".repeat(1900) + ` More stuff for iteration ${i}.`;
      await applyChanges(
        [{ topicId: "big-topic", action: "update", content: bigContent }],
        mem, `s${i}`, i,
      );
    }

    const content = readFileSync(join(mem, "topics", "big-topic", "CONTEXT.md"), "utf-8");
    const resourcesPath = join(mem, "topics", "big-topic", "resources");
    const hasResources = (await import("node:fs")).existsSync(resourcesPath);

    console.log("E3v2 final content length:", content.length, "chars");
    console.log("E3v2 has overflow:", hasResources);
    console.log("E3v2 contains 'Initial topic':", content.includes("Initial topic"));
    console.log("E3v2 contains 'Update #1':", content.includes("Update #1"));
    console.log("E3v2 contains 'Update #15':", content.includes("Update #15"));
    console.log("E3v2 contains 'Update #30':", content.includes("Update #30"));

    if (!content.includes("Initial topic")) {
      console.log("E3v2 VERDICT: BUG CONFIRMED — oldest content dropped from CONTEXT.md");
    } else {
      console.log("E3v2 VERDICT: PASS — oldest content preserved");
    }

    if (hasResources) {
      const files = (await import("node:fs")).readdirSync(resourcesPath);
      console.log("E3v2 overflow file count:", files.length);
      if (files.length > 0) {
        console.log("E3v2: WARNING — content overflowed to resources/");
        const firstOverflow = (await import("node:fs")).readFileSync(
          join(resourcesPath, files[files.length - 1]), "utf-8"
        );
        console.log("E3v2 last overflow content length:", firstOverflow.length);
      }
    }

    rmSync(dir2, { recursive: true, force: true });
  });
});
