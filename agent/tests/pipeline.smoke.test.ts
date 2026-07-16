import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { google } from "@ai-sdk/google";
import { createDb, closeDb, type PokaicoDb } from "../src/db/client";
import { processSession } from "../src/memory/pipeline";
import { extractTopics } from "../src/memory/extract";
import type { TopicMeta } from "../src/memory/topics";

const hasApiKey = !!process.env.GOOGLE_GENERATIVE_AI_API_KEY;

describe.runIf(hasApiKey)("pipeline smoke test (real Gemini)", () => {
  let db: PokaicoDb;
  let dir: string;
  let conversationDir: string;
  let diaryDir: string;
  let memoryDir: string;

  beforeAll(() => {
    dir = mkdtempSync(join(tmpdir(), "pipeline-smoke-"));
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

  it("summarizes a real conversation with Gemini", async () => {
    const sessionId = "smoke-summarize";
    const conversationPath = join(conversationDir, `2026-07-08-${sessionId}.md`);
    writeFileSync(conversationPath, `---
session_id: ${sessionId}
started_at: 2026-07-08T14:00:00+07:00
model: test-model
extracted: false
---
## [14:00:00] User
I just got promoted at work! I'm now a senior engineer.

## [14:00:15] Pokai
Congratulations! That's amazing news. How do you feel about it?

## [14:00:30] User
Honestly a bit nervous but excited. The new role comes with team lead responsibilities.

## [14:00:45] Pokai
That's a big step. You'll do great! What's your team like?

## [14:01:00] User
Small team of 4 people, very supportive. I've worked with them for 2 years so I know them well.`, "utf-8");

    const searchSimilar = async () => [] as { topicId: string; score: number; content: string; sourcePath: string }[];
    const indexTopic = async () => {};
    const model = google("gemini-3.1-flash-lite-preview");

    const result = await processSession(sessionId, {
      llm: model as never,
      searchSimilar,
      indexTopic,
      db,
      memoryDir,
      conversationDir,
      diaryDir,
    });

    console.log("Summary:", result.summary?.summary);
    console.log("Key points:", result.summary?.keyPoints);

    expect(result.hasNewMessages).toBe(true);
    expect(result.summary).toBeTruthy();
    expect(result.summary!.summary).toBeTruthy();
    expect(result.summary!.keyPoints.length).toBeGreaterThan(0);
    expect(result.summary!.summary.length).toBeGreaterThan(10);
  }, 30_000);

  it("extracts a topic from real conversation", async () => {
    const sessionId = "smoke-extract";
    const conversationPath = join(conversationDir, `2026-07-08-${sessionId}.md`);
    writeFileSync(conversationPath, `---
session_id: ${sessionId}
started_at: 2026-07-08T15:00:00+07:00
model: test-model
extracted: false
---
## [15:00:00] User
I love cycling. I cycle to work every day, about 15km each way.

## [15:00:15] Pokai
That's impressive! How long does it take?

## [15:00:30] User
About 45 minutes. It's great exercise and saves money on transport.`, "utf-8");

    const model = google("gemini-3.1-flash-lite-preview");
    const { summarize } = await import("../src/memory/summarizer");
    const { readSession } = await import("../src/memory/conversation");

    const session = readSession(conversationPath);
    const summary = await summarize(session.turns, model as never);

    const existingTopics: TopicMeta[] = [];
    const searchSimilar = async () => [] as { topicId: string; score: number; content: string; sourcePath: string }[];
    const changes = await extractTopics(summary, existingTopics, searchSimilar);

    console.log("Extracted topic:", changes);

    expect(changes.length).toBeGreaterThanOrEqual(1);
    expect(changes[0].action).toBe("create");
    expect(changes.some((c) => /cycl|commut|bike|bicycle/.test(c.topicId))).toBe(true);
  }, 30_000);
});

describe.skipIf(hasApiKey)("pipeline smoke test (skipped — no API key)", () => {
  it("placeholder", () => {});
});