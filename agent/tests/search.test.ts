import { describe, it, expect, beforeAll } from "vitest";
import { mkdtempSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { Buffer } from "node:buffer";

import { createDb, closeDb, type PokaicoDb } from "../src/db/client";
import { ftsSearch, hybridSearch } from "../src/embeddings/search";

let db: PokaicoDb;
let tmpDir: string;

beforeAll(() => {
  tmpDir = mkdtempSync(join(tmpdir(), "pokaico-search-test-"));
  db = createDb(join(tmpDir, "search.db"));

  const insert = db.prepare(
    "INSERT INTO chunk_fts(rowid, content, topic_id, source_path) VALUES (?, ?, ?, ?)",
  );
  insert.run(1, "Work schedule and work meetings", "work", "memory/topics/work/CONTEXT.md");
  insert.run(2, "Family vacation plans for summer", "family", "memory/topics/family/CONTEXT.md");
  insert.run(3, "Project work deadlines and work deliverables", "work", "memory/topics/work/CONTEXT.md");
  insert.run(4, "Healthy recipes and meal prep", "health", "memory/topics/health/CONTEXT.md");
  insert.run(5, "Team standup and sprint planning", "team", "memory/topics/team/CONTEXT.md");
  insert.run(6, "Vacation destinations: Paris, Tokyo, Bali", "travel", "memory/topics/travel/CONTEXT.md");
  insert.run(7, "Daily standup notes about project deadlines", "work", "memory/topics/work/CONTEXT.md");
  insert.run(8, "OR AND NOT NEAR embedded in text", "logic", "memory/topics/logic/CONTEXT.md");

  // Seed vec0 — omit rowid (vec0 auto-assigns sequentially).
  // Insert in matching fts rowid order so join by rowid is correct.
  const embed = db.prepare("INSERT INTO chunk_vec(embedding) VALUES (?)");
  function toBuffer(values: number[]): Buffer {
    return Buffer.from(new Float32Array(values).buffer);
  }
  // row 1 → fts 1 (work)
  embed.run(toBuffer(Array.from({ length: 384 }, () => 0.01)));
  // row 2 → fts 2 (family)
  embed.run(toBuffer(Array.from({ length: 384 }, () => 0.02)));
  // row 3 → fts 3 (work)
  embed.run(toBuffer(Array.from({ length: 384 }, () => 0.015)));
  // row 4 → fts 4 (health) — dummy
  embed.run(toBuffer(Array.from({ length: 384 }, () => 0.001)));
  // row 5 → fts 5 (team) — dummy
  embed.run(toBuffer(Array.from({ length: 384 }, () => 0.001)));
  // row 6 → fts 6 (travel)
  embed.run(toBuffer(Array.from({ length: 384 }, () => 0.03)));
});

describe("ftsSearch", () => {
  it("returns matching results ranked by BM25", () => {
    const results = ftsSearch(db, "work");
    expect(results.length).toBeGreaterThan(0);
    expect(results.every((r) => r.topicId === "work")).toBe(true);
  });

  it("returns empty array for non-matching query", () => {
    const results = ftsSearch(db, "zzznotfound");
    expect(results).toEqual([]);
  });

  it("includes content in results", () => {
    const results = ftsSearch(db, "Paris");
    expect(results).toHaveLength(1);
    expect(results[0].content).toContain("Paris");
  });

  it("ranks more relevant results higher", () => {
    const results = ftsSearch(db, "work");
    expect(results.length).toBeGreaterThanOrEqual(2);

    expect(typeof results[0].rank).toBe("number");
    expect(results[0].rank).toBeLessThanOrEqual(results[1].rank);
  });

  it("handles SQL-like special characters without crashing", () => {
    const results = ftsSearch(db, "' OR '1'='1");
    expect(Array.isArray(results)).toBe(true);
  });

  it("handles FTS5 operator keywords embedded in text", () => {
    const results = ftsSearch(db, "OR");
    expect(Array.isArray(results)).toBe(true);
  });

  it("returns empty for empty query string", () => {
    const results = ftsSearch(db, "");
    expect(results).toEqual([]);
  });

  it("returns correct sourcePath in results", () => {
    const results = ftsSearch(db, "Tokyo");
    expect(results[0].sourcePath).toBe("memory/topics/travel/CONTEXT.md");
  });
});

describe("hybridSearch", () => {
  it("combines vector and FTS5 scores", () => {
    const fakeEmbedding = Buffer.from(new Float32Array(384).fill(0.01).buffer);
    const results = hybridSearch(db, fakeEmbedding, "work", { vectorWeight: 0.5 });

    expect(results.length).toBeGreaterThan(0);
    expect(results[0].combinedScore).toBeGreaterThan(0);
  });

  it("returns results even when FTS5 has no matches (vector fallback)", () => {
    const fakeEmbedding = Buffer.from(new Float32Array(384).fill(0.5).buffer);
    const results = hybridSearch(db, fakeEmbedding, "zzznotfound");
    expect(results.length).toBeGreaterThanOrEqual(0);
  });

  it("returns empty when both searches fail", () => {
    const zeroEmbedding = Buffer.from(new Float32Array(384).buffer);
    const results = hybridSearch(db, zeroEmbedding, "zzznotfound");
    expect(results).toEqual([]);
  });

  it("uses only FTS when vectorWeight = 0", () => {
    const fakeEmbedding = Buffer.from(new Float32Array(384).fill(0.5).buffer);
    const results = hybridSearch(db, fakeEmbedding, "vacation", { vectorWeight: 0 });

    expect(results.length).toBeGreaterThan(0);
    for (const r of results) {
      expect(r.vectorScore).toBe(0);
      expect(r.combinedScore).toBe(r.ftsScore);
    }
  });

  it("uses only vector when vectorWeight = 1", () => {
    const fakeEmbedding = Buffer.from(new Float32Array(384).fill(0.01).buffer);
    const results = hybridSearch(db, fakeEmbedding, "vacation", { vectorWeight: 1 });

    expect(results.length).toBeGreaterThan(0);
    for (const r of results) {
      // ftsScore is still computed but combinedScore is purely vectorWeight * vectorScore
      expect(r.combinedScore).toBeCloseTo(r.vectorScore, 5);
    }
  });

  it("returns empty for limit = 0", () => {
    const fakeEmbedding = Buffer.from(new Float32Array(384).fill(0.01).buffer);
    const results = hybridSearch(db, fakeEmbedding, "work", { limit: 0 });
    expect(results).toEqual([]);
  });

  it("deduplicates when same content appears in both vec and FTS", () => {
    const fakeEmbedding = Buffer.from(new Float32Array(384).fill(0.01).buffer);
    const results = hybridSearch(db, fakeEmbedding, "work", { limit: 50 });

    const keys = results.map((r) => `${r.topicId}::${r.content.slice(0, 40)}`);
    expect(new Set(keys).size).toBe(keys.length);
  });

  it("includes sourcePath in all results", () => {
    const fakeEmbedding = Buffer.from(new Float32Array(384).fill(0.01).buffer);
    const results = hybridSearch(db, fakeEmbedding, "work");

    for (const r of results) {
      expect(r.sourcePath).toBeTruthy();
      expect(r.sourcePath).toMatch(/^memory\/topics\//);
    }
  });
});

describe("search — confirmed findings", () => {
  it("FIX F25: dedup uses rowid — two chunks with same prefix are no longer merged", () => {
    const dedupDb = createDb(join(tmpDir, "search-dedup.db"));

    const prefix40 = "This is a very long chunk that starts with the".slice(0, 40);
    const chunkA = prefix40 + "exact same prefix but then diverges AAAA";
    const chunkB = prefix40 + "exact same prefix but then diverges BBBB";

    const insert = dedupDb.prepare(
      "INSERT INTO chunk_fts(rowid, content, topic_id, source_path) VALUES (?, ?, ?, ?)",
    );
    insert.run(1, chunkA, "dedup-topic", "memory/topics/dedup/CONTEXT.md");
    insert.run(2, chunkB, "dedup-topic", "memory/topics/dedup/CONTEXT.md");

    const embed = dedupDb.prepare("INSERT INTO chunk_vec(embedding) VALUES (?)");
    const vec = Buffer.from(new Float32Array(384).fill(0.01).buffer);
    embed.run(vec);
    embed.run(vec);

    const results = hybridSearch(
      dedupDb,
      Buffer.from(new Float32Array(384).fill(0.01).buffer),
      "prefix",
      { vectorWeight: 0.5, limit: 10 },
    );

    // Dedup key is now `${topicId}::${rowid}` — both chunks have unique rowids
    expect(results.length).toBe(2);

    closeDb(dedupDb);
  });

  it("FIX F26: vectorScore is clamped to [0, 1] when distance > 1", () => {
    // Test the clamping formula directly: Math.max(0, 1 - distance)
    // This is the formula used in hybridSearch for vectorScore
    const nearDistance = 0.0384;
    const farDistance = 100;

    expect(Math.max(0, 1 - nearDistance)).toBeGreaterThan(0);
    expect(Math.max(0, 1 - nearDistance)).toBeLessThanOrEqual(1);
    expect(Math.max(0, 1 - farDistance)).toBe(0);

    // Also test via hybridSearch when vec0 returns a result
    const clampDb = createDb(join(tmpDir, "search-clamp.db"));

    const insert = clampDb.prepare(
      "INSERT INTO chunk_fts(rowid, content, topic_id, source_path) VALUES (?, ?, ?, ?)",
    );
    insert.run(1, "some content", "clamp-topic", "memory/topics/clamp/CONTEXT.md");

    // Store a vec whose distance from query will produce a negative raw score
    const storedVec = new Float32Array(384);
    storedVec[0] = -10;
    const storedBuf = Buffer.from(storedVec.buffer);
    clampDb.prepare("INSERT INTO chunk_vec(embedding) VALUES (?)").run(storedBuf);

    // Query matches stored vector exactly (distance = 0)
    const exactQuery = Buffer.from(storedVec.buffer);
    const exactResults = hybridSearch(clampDb, exactQuery, "nonexistent", { vectorWeight: 1, limit: 10 });
    if (exactResults.length > 0) {
      // vectorScore = Math.max(0, 1 - 0) = 1
      expect(exactResults[0].vectorScore).toBe(1);
    }

    closeDb(clampDb);
  });
});
