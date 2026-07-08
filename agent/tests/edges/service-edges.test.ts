import { describe, it, expect, beforeAll, afterAll, vi } from "vitest";
import { mkdtempSync, mkdirSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { createDb, closeDb, type PokaicoDb } from "../../src/db/client";
import { createEmbeddingService } from "../../src/embeddings/service";

describe("E9: Empty content indexed — phantom search results", () => {
  it("creates a phantom row with embedding of 'passage: '", async () => {
    const dir = mkdtempSync(join(tmpdir(), "edge-e9-"));
    const db = createDb(join(dir, "test.db"));

    const mockModel = {
      embed: vi.fn().mockResolvedValue(new Float32Array(384).fill(0.01)),
      embedBatch: vi.fn(),
      close: vi.fn(),
    };

    const svc = createEmbeddingService(mockModel, db);
    await svc.indexTopic("empty-topic", "");

    // Check if row exists
    const ftsRow = db
      .prepare("SELECT content FROM chunk_fts WHERE topic_id = ?")
      .get("empty-topic") as { content: string } | undefined;

    console.log("E9 FTS content:", ftsRow?.content);
    console.log("E9 FTS content length:", ftsRow?.content?.length);

    if (ftsRow && ftsRow.content === "") {
      console.log("E9 VERDICT: BUG CONFIRMED — empty content stored in FTS5");
    }

    // Try to search for it
    const results = await svc.searchSimilar("any query");
    const hasEmptyResult = results.some((r) => r.content === "");
    console.log("E9 search results with empty content:", hasEmptyResult);

    if (hasEmptyResult) {
      console.log("E9 VERDICT: BUG CONFIRMED — phantom empty result appears in search");
    } else {
      console.log("E9 VERDICT: PASS — no phantom results");
    }

    closeDb(db);
    rmSync(dir, { recursive: true, force: true });
  });
});

describe("E10: Duplicate content indexing — duplicate search results", () => {
  it("produces duplicate results when same content indexed twice", async () => {
    const dir = mkdtempSync(join(tmpdir(), "edge-e10-"));
    const db = createDb(join(dir, "test.db"));

    const mockModel = {
      embed: vi.fn().mockResolvedValue(new Float32Array(384).fill(0.01)),
      embedBatch: vi.fn(),
      close: vi.fn(),
    };

    const svc = createEmbeddingService(mockModel, db);

    // Index same content twice
    await svc.indexTopic("dogs", "Dogs are loyal animals.");
    await svc.indexTopic("dogs", "Dogs are loyal animals."); // duplicate!

    const cnt = (db
      .prepare("SELECT COUNT(*) as cnt FROM chunk_fts WHERE topic_id = ?")
      .get("dogs") as { cnt: number });

    console.log("E10 duplicate rows in chunk_fts:", cnt.cnt);

    if (cnt.cnt >= 2) {
      console.log("E10 VERDICT: BUG CONFIRMED — duplicate rows in index");
    } else {
      console.log("E10 VERDICT: PASS — no duplicates");
    }

    const results = await svc.searchSimilar("dogs loyal animals");
    const dogResults = results.filter((r) => r.topicId === "dogs");
    console.log("E10 search results for 'dogs':", dogResults.length);

    if (dogResults.length >= 2) {
      console.log("E10 VERDICT: BUG CONFIRMED — duplicate search results");
    }

    closeDb(db);
    rmSync(dir, { recursive: true, force: true });
  });
});
