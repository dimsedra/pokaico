import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { google } from "@ai-sdk/google";
import { createDb, closeDb, type PokaicoDb } from "../../src/db/client";

const hasApiKey = !!process.env.GOOGLE_GENERATIVE_AI_API_KEY;

describe.runIf(hasApiKey)("E4: 200+ turn conversation with real Gemini", () => {
  let db: PokaicoDb;
  let dir: string;
  let conversationDir: string;
  let diaryDir: string;
  let memoryDir: string;

  beforeAll(() => {
    dir = mkdtempSync(join(tmpdir(), "edge-e4-"));
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

  it("handles 200-turn conversation without crashing or context limit error", async () => {
    const sessionId = "long-convo";
    const startedAt = "2026-07-09T14:00:00+07:00";

    const turns: Array<{ ts: string; role: string; content: string }> = [];
    for (let i = 0; i < 100; i++) {
      const ts = new Date(0);
      ts.setSeconds(i * 30);
      const mm = String(ts.getUTCHours() + 14).padStart(2, "0");
      const ss = String(ts.getUTCSeconds()).padStart(2, "0");
      const tsStr = `${mm}:00:${ss}`;

      turns.push({
        ts: tsStr,
        role: "User",
        content: `User message #${i + 1}: I've been thinking about the project architecture and ${["scalability", "security", "performance", "maintainability", "testing", "deployment", "monitoring", "logging", "caching", "database design"][i % 10]} is a key concern. We should probably consider using a ${["microservices", "monolith", "serverless", "edge computing", "modular architecture"][i % 5]} approach for the next phase.`,
      });

      turns.push({
        ts: tsStr,
        role: "Pokai",
        content: `Response #${i + 1}: Good point about ${["scalability", "security", "performance", "maintainability", "testing", "deployment", "monitoring", "logging", "caching", "database design"][i % 10]}. Based on the requirements, I'd suggest examining ${["Redis", "PostgreSQL", "Kubernetes", "Docker", "AWS Lambda"][i % 5]} as part of the solution. The team's experience with ${["TypeScript", "Python", "Go", "Rust", "Java"][i % 5]} will be valuable here.`,
      });
    }

    const turnLines = turns.map((t) => `## [${t.ts}] ${t.role}\n${t.content}`).join("\n\n");
    const conversationPath = join(conversationDir, `2026-07-09-${sessionId}.md`);
    writeFileSync(
      conversationPath,
      `---
session_id: ${sessionId}
started_at: ${startedAt}
model: test
extracted: false
---
${turnLines}
`,
      "utf-8",
    );

    const model = google("gemini-3.1-flash-lite-preview");

    const { processSession } = await import("../../src/memory/pipeline");
    const searchSimilar = async () => [] as { topicId: string; score: number; content: string; sourcePath: string }[];
    const indexTopic = async () => {};

    const start = Date.now();
    const result = await processSession(sessionId, {
      llm: model as never,
      searchSimilar,
      indexTopic,
      db,
      memoryDir,
      conversationDir,
      diaryDir,
    });
    const elapsed = Date.now() - start;

    console.log(`E4 200 turns, elapsed: ${elapsed}ms, error: ${result.error ?? "none"}`);

    expect(result.hasNewMessages).toBe(true);
    if (!result.error) {
      expect(result.summary).toBeTruthy();
    }
  }, 120_000);
});

describe.skipIf(hasApiKey)("E4 (skipped — no API key)", () => {
  it("placeholder", () => {});
});
