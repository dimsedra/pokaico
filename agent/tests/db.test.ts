import { describe, it, expect, beforeAll } from "vitest";
import { mkdtempSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";

import { createDb, closeDb } from "../src/db/client";

let tmpDir: string;

beforeAll(() => {
  tmpDir = mkdtempSync(join(tmpdir(), "pokaico-db-test-"));
});

function tableNames(db: ReturnType<typeof createDb>): string[] {
  return db
    .prepare("SELECT name FROM sqlite_master WHERE type='table'")
    .all()
    .map((r: { name: string }) => r.name);
}

describe("createDb", () => {
  it("creates a SQLite file at the given path", () => {
    const dbPath = join(tmpDir, "pokai.db");
    const db = createDb(dbPath);
    expect(db).toBeDefined();
    closeDb(db);
  });

  it("creates all required tables", () => {
    const dbPath = join(tmpDir, "tables.db");
    const db = createDb(dbPath);
    const names = tableNames(db);

    expect(names).toContain("sessions");
    expect(names).toContain("topics");
    expect(names).toContain("edges");
    expect(names).toContain("resources");
    expect(names).toContain("session_pointers");

    closeDb(db);
  });

  it("creates FTS5 virtual table (chunk_fts)", () => {
    const dbPath = join(tmpDir, "fts.db");
    const db = createDb(dbPath);
    expect(tableNames(db)).toContain("chunk_fts");
    expect(tableNames(db)).toContain("chunk_fts_content");
    expect(tableNames(db)).toContain("chunk_fts_idx");
    closeDb(db);
  });

  it("chunk_fts is searchable", () => {
    const dbPath = join(tmpDir, "fts-search.db");
    const db = createDb(dbPath);

    db.prepare(
      "INSERT INTO chunk_fts(rowid, content, topic_id, source_path) VALUES (?, ?, ?, ?)",
    ).run(1, "test content about work", "work", "memory/topics/work/CONTEXT.md");

    const result = db
      .prepare("SELECT content FROM chunk_fts WHERE chunk_fts MATCH ?")
      .all("work") as { content: string }[];

    expect(result).toHaveLength(1);
    expect(result[0].content).toBe("test content about work");

    closeDb(db);
  });

  it("creates vec0 virtual table (chunk_vec)", () => {
    const dbPath = join(tmpDir, "vec.db");
    const db = createDb(dbPath);

    const names = db
      .prepare("SELECT name FROM sqlite_master WHERE type='table'")
      .all()
      .map((r: { name: string }) => r.name);

    expect(names).toContain("chunk_vec");

    closeDb(db);
  });
});

describe("edge cases", () => {
  it("autocreates directory if it does not exist", () => {
    const nestedDir = join(tmpDir, "nested", "deep", "path");
    const dbPath = join(nestedDir, "pokai.db");
    const db = createDb(dbPath);
    expect(tableNames(db)).toContain("sessions");
    closeDb(db);
  });

  it("enables foreign keys pragma", () => {
    const dbPath = join(tmpDir, "fk.db");
    const db = createDb(dbPath);
    const result = db.pragma("foreign_keys", { simple: true }) as unknown as number;
    expect(result).toBe(1);
    closeDb(db);
  });

  it("idempotent reopen preserves tables", () => {
    const dbPath = join(tmpDir, "reopen.db");
    const db1 = createDb(dbPath);
    db1.prepare(
      "INSERT INTO sessions(id, path, model) VALUES (?, ?, ?)",
    ).run("s1", "journal/2026-01-01.md", "test");
    closeDb(db1);

    const db2 = createDb(dbPath);
    const rows = db2
      .prepare("SELECT id FROM sessions")
      .all() as { id: string }[];
    expect(rows).toHaveLength(1);
    expect(rows[0].id).toBe("s1");
    closeDb(db2);
  });

  it("handles special characters in FTS5 content", () => {
    const dbPath = join(tmpDir, "special-fts.db");
    const db = createDb(dbPath);

    const special = `it's "quoted" — emoji ✅ newline\nhere`;
    db.prepare(
      "INSERT INTO chunk_fts(rowid, content, topic_id, source_path) VALUES (?, ?, ?, ?)",
    ).run(1, special, "test", "path.md");

    const result = db
      .prepare("SELECT content FROM chunk_fts WHERE chunk_fts MATCH ?")
      .all("emoji") as { content: string }[];

    expect(result).toHaveLength(1);
    closeDb(db);
  });

  it("throws DbError for invalid path", () => {
    const invalidPath = join("Z:\\nonexistent\\drive\\test.db");
    expect(() => createDb(invalidPath)).toThrow();
  });
});

describe("closeDb", () => {
  it("closes the database without error", () => {
    const dbPath = join(tmpDir, "close.db");
    const db = createDb(dbPath);
    expect(() => closeDb(db)).not.toThrow();
  });
});
