import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { createDb, closeDb, type PokaicoDb } from "../src/db/client";
import { mkdtempSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { hasNewMessages, updatePointer } from "../src/memory/guards";

describe("guards", () => {
  let db: PokaicoDb;
  let dir: string;

  beforeAll(() => {
    dir = mkdtempSync(join(tmpdir(), "guards-test-"));
    db = createDb(join(dir, "test.db"));
  });

  afterAll(() => {
    closeDb(db);
    rmSync(dir, { recursive: true, force: true });
  });

  it("returns true when session has no pointer entry", () => {
    expect(hasNewMessages("session-1", db, 100)).toBe(true);
  });

  it("returns true when latest ts > stored pointer", () => {
    updatePointer("session-2", 50, db);
    expect(hasNewMessages("session-2", db, 100)).toBe(true);
  });

  it("returns false when latest ts equals stored pointer", () => {
    updatePointer("session-3", 100, db);
    expect(hasNewMessages("session-3", db, 100)).toBe(false);
  });

  it("returns false when latest ts < stored pointer", () => {
    updatePointer("session-4", 200, db);
    expect(hasNewMessages("session-4", db, 100)).toBe(false);
  });

  it("updatePointer upserts existing entry", () => {
    updatePointer("session-3", 150, db);
    expect(hasNewMessages("session-3", db, 150)).toBe(false);
    expect(hasNewMessages("session-3", db, 200)).toBe(true);
  });

  it("handles multiple sessions independently", () => {
    updatePointer("multi-a", 50, db);
    updatePointer("multi-b", 100, db);

    expect(hasNewMessages("multi-a", db, 100)).toBe(true);
    expect(hasNewMessages("multi-b", db, 100)).toBe(false);
    expect(hasNewMessages("multi-a", db, 50)).toBe(false);
  });
});
