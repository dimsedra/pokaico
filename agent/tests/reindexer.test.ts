import { describe, it, expect, beforeAll, afterAll, vi } from "vitest";
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { createDb, closeDb, type PokaicoDb } from "../src/db/client";
import { reindexTopics } from "../src/memory/reindexer";

describe("reindexer", () => {
  let db: PokaicoDb;
  let dir: string;

  beforeAll(() => {
    dir = mkdtempSync(join(tmpdir(), "reindex-test-"));
    db = createDb(join(dir, "test.db"));
    mkdirSync(join(dir, "memory", "topics"), { recursive: true });
  });

  afterAll(() => {
    closeDb(db);
    rmSync(dir, { recursive: true, force: true });
  });

  function memoryDir() {
    return join(dir, "memory");
  }

  it("indexes CONTEXT.md for an existing topic", async () => {
    const topicDir = join(memoryDir(), "topics", "hiking");
    mkdirSync(topicDir, { recursive: true });
    writeFileSync(join(topicDir, "CONTEXT.md"), "User loves hiking in mountains.", "utf-8");

    const indexTopic = vi.fn().mockResolvedValue(undefined);

    await reindexTopics(["hiking"], memoryDir(), db, indexTopic);

    expect(indexTopic).toHaveBeenCalledWith("hiking", "User loves hiking in mountains.");
  });

  it("indexes overflow resources too", async () => {
    const topicDir = join(memoryDir(), "topics", "work");
    mkdirSync(join(topicDir, "resources"), { recursive: true });
    writeFileSync(join(topicDir, "CONTEXT.md"), "Work summary. See [notes](resources/overflow.md).", "utf-8");
    writeFileSync(join(topicDir, "resources", "overflow.md"), "Detailed work notes here.", "utf-8");

    const indexTopic = vi.fn().mockResolvedValue(undefined);

    await reindexTopics(["work"], memoryDir(), db, indexTopic);

    expect(indexTopic).toHaveBeenCalledWith("work", "Work summary. See [notes](resources/overflow.md).");
    expect(indexTopic).toHaveBeenCalledWith("work", "Detailed work notes here.");
  });

  it("updates topic token_count and updated_at in DB", async () => {
    const topicDir = join(memoryDir(), "topics", "token-test");
    mkdirSync(topicDir, { recursive: true });
    writeFileSync(join(topicDir, "CONTEXT.md"), "Some content.", "utf-8");

    db.prepare(
      "INSERT OR IGNORE INTO topics(id, path, summary, token_count, updated_at) VALUES (?, ?, ?, ?, ?)",
    ).run("token-test", "memory/topics/token-test/CONTEXT.md", "", 0, 0);

    const indexTopic = vi.fn().mockResolvedValue(undefined);

    await reindexTopics(["token-test"], memoryDir(), db, indexTopic);

    const row = db.prepare("SELECT token_count, updated_at FROM topics WHERE id = ?").get("token-test") as { token_count: number; updated_at: number };
    expect(row.token_count).toBeGreaterThan(0);
    expect(row.updated_at).toBeGreaterThan(0);
  });

  it("creates topic row if not exists", async () => {
    const topicDir = join(memoryDir(), "topics", "new-topic");
    mkdirSync(topicDir, { recursive: true });
    writeFileSync(join(topicDir, "CONTEXT.md"), "Brand new topic.", "utf-8");

    const indexTopic = vi.fn().mockResolvedValue(undefined);

    await reindexTopics(["new-topic"], memoryDir(), db, indexTopic);

    const row = db.prepare("SELECT id FROM topics WHERE id = ?").get("new-topic") as { id: string } | undefined;
    expect(row).toBeDefined();
    expect(row!.id).toBe("new-topic");
  });
});