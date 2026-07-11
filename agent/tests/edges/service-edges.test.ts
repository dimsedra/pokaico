import { describe, it, expect, beforeAll, afterAll, vi } from "vitest";
import { mkdtempSync, mkdirSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { createDb, closeDb, type PokaicoDb } from "../../src/db/client";
import { createEmbeddingService } from "../../src/embeddings/service";

describe("E9: Empty content indexed does not create phantom search results", () => {
  it("does not store an empty chunk nor surface it in search", async () => {
    const dir = mkdtempSync(join(tmpdir(), "edge-e9-"));
    const db = createDb(join(dir, "test.db"));

    const mockModel = {
      embed: vi.fn().mockResolvedValue(new Float32Array(384).fill(0.01)),
      embedBatch: vi.fn(),
      close: vi.fn(),
    };

    const svc = createEmbeddingService(mockModel, db);
    await svc.indexTopic("empty-topic", "");

    const ftsRow = db
      .prepare("SELECT content FROM chunk_fts WHERE topic_id = ?")
      .get("empty-topic") as { content: string } | undefined;
    expect(ftsRow).toBeUndefined();

    const results = await svc.searchSimilar("any query");
    expect(results.some((r) => r.content === "")).toBe(false);

    closeDb(db);
    rmSync(dir, { recursive: true, force: true });
  });
});

describe("E10: Re-indexing identical content does not duplicate rows", () => {
  it("keeps a single chunk and a single search result", async () => {
    const dir = mkdtempSync(join(tmpdir(), "edge-e10-"));
    const db = createDb(join(dir, "test.db"));

    const mockModel = {
      embed: vi.fn().mockResolvedValue(new Float32Array(384).fill(0.01)),
      embedBatch: vi.fn(),
      close: vi.fn(),
    };

    const svc = createEmbeddingService(mockModel, db);

    await svc.indexTopic("dogs", "Dogs are loyal animals.");
    await svc.indexTopic("dogs", "Dogs are loyal animals."); // re-index same content

    const cnt = db
      .prepare("SELECT COUNT(*) as cnt FROM chunk_fts WHERE topic_id = ?")
      .get("dogs") as { cnt: number };
    expect(cnt.cnt).toBe(1);

    const results = await svc.searchSimilar("dogs loyal animals");
    const dogResults = results.filter((r) => r.topicId === "dogs");
    expect(dogResults).toHaveLength(1);

    closeDb(db);
    rmSync(dir, { recursive: true, force: true });
  });
});
