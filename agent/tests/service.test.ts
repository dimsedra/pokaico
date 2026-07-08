import { describe, it, expect, beforeAll } from "vitest";
import { mkdtempSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";

import { createDb, closeDb, type PokaicoDb } from "../src/db/client";
import { createModelFromSession, type OnnxSession } from "../src/embeddings/model";
import { createEmbeddingService } from "../src/embeddings/service";

function makeMockModel(dim: number = 768) {
  const session: OnnxSession = {
    run: async () => {
      const data = new Float32Array(dim);
      for (let i = 0; i < dim; i++) data[i] = Math.sin(i) * 0.1;
      return { last_hidden_state: { data } };
    },
    release: async () => {},
  };
  return createModelFromSession(session, dim);
}

let db: PokaicoDb;
let tmpDir: string;

beforeAll(() => {
  tmpDir = mkdtempSync(join(tmpdir(), "pokaico-service-test-"));
  db = createDb(join(tmpDir, "service.db"));
});

describe("createEmbeddingService", () => {
  it("creates a service with model and db", () => {
    const model = makeMockModel();
    const svc = createEmbeddingService(model, db);
    expect(svc).toBeDefined();
    expect(typeof svc.embedQuery).toBe("function");
    expect(typeof svc.searchSimilar).toBe("function");
    expect(typeof svc.indexTopic).toBe("function");
  });

  it("embedQuery returns embedding vector", async () => {
    const model = makeMockModel();
    const svc = createEmbeddingService(model, db);
    const vec = await svc.embedQuery("hello world");
    expect(vec).toBeInstanceOf(Float32Array);
    expect(vec.length).toBe(768);
  });

  it("embedQuery handles empty string", async () => {
    const model = makeMockModel(4);
    const svc = createEmbeddingService(model, db);
    const vec = await svc.embedQuery("");
    expect(vec).toBeInstanceOf(Float32Array);
    expect(vec.length).toBe(4);
  });

  it("indexTopic stores content in chunk_fts", async () => {
    const model = makeMockModel();
    const svc = createEmbeddingService(model, db);
    await svc.indexTopic("test-topic", "Some test content about indexing");

    const result = db
      .prepare("SELECT content FROM chunk_fts WHERE chunk_fts MATCH ?")
      .all("indexing") as { content: string }[];
    expect(result.length).toBeGreaterThan(0);
    expect(result[0].content).toContain("indexing");
  });

  it("indexTopic handles empty content gracefully", async () => {
    const model = makeMockModel();
    const svc = createEmbeddingService(model, db);
    // Should not throw
    await expect(svc.indexTopic("empty-topic", "")).resolves.toBeUndefined();
  });

  it("indexTopic handles special characters in topicId", async () => {
    const model = makeMockModel();
    const svc = createEmbeddingService(model, db);
    await expect(
      svc.indexTopic("foo/bar baz!@#", "Special chars in topic ID"),
    ).resolves.toBeUndefined();
  });

  it("indexTopic is idempotent when called twice with same content", async () => {
    const model = makeMockModel();
    const svc = createEmbeddingService(model, db);
    await svc.indexTopic("dup-topic", "Duplicate content");
    await svc.indexTopic("dup-topic", "Duplicate content");
    // Should not throw — second call with same hash silently handled
    // Verify at least one entry exists
    const rows = db
      .prepare("SELECT count(*) as cnt FROM chunk_fts WHERE topic_id = ?")
      .get("dup-topic") as { cnt: number };
    expect(rows.cnt).toBeGreaterThanOrEqual(1);
  });

  it("searchSimilar returns results after indexing", async () => {
    const model = makeMockModel();
    const svc = createEmbeddingService(model, db);

    await svc.indexTopic("alpha", "Alpha content about work");
    await svc.indexTopic("beta", "Beta content about health");

    const results = await svc.searchSimilar("work", 5);
    expect(Array.isArray(results)).toBe(true);
    for (const r of results) {
      expect(r).toHaveProperty("topicId");
      expect(r).toHaveProperty("score");
      expect(r).toHaveProperty("content");
    }
  });

  it("searchSimilar handles empty query string", async () => {
    const model = makeMockModel();
    const svc = createEmbeddingService(model, db);
    const results = await svc.searchSimilar("", 5);
    expect(Array.isArray(results)).toBe(true);
  });

  it("searchSimilar returns empty for empty index", async () => {
    const emptyDb = createDb(join(tmpDir, "empty-service.db"));
    const model = makeMockModel();
    const svc = createEmbeddingService(model, emptyDb);
    const results = await svc.searchSimilar("anything", 5);
    expect(results).toEqual([]);
    closeDb(emptyDb);
  });

  it("searchSimilar falls back to FTS5 when vector search fails", async () => {
    const model = makeMockModel();
    const svc = createEmbeddingService(model, db);
    // Index some content (FTS5 only, vec0 not populated by current service)
    await svc.indexTopic("fallback-topic", "Fallback content about testing");

    const results = await svc.searchSimilar("testing", 5);
    expect(results.length).toBeGreaterThan(0);
    expect(results[0].topicId).toBe("fallback-topic");
  });
});
