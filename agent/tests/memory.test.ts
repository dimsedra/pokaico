import { describe, it, expect, beforeAll, afterAll, beforeEach } from "vitest";
import { mkdtempSync, readFileSync, existsSync, rmSync, mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { createDb, closeDb, type PokaicoDb } from "../src/db/client";

import {
  createTopic,
  readTopic,
  updateTopic,
  listTopics,
  deleteTopic,
  ensureIndex,
  regenerateIndex,
  parseIndex,
} from "../src/memory/topics";

let tmpDir: string;
let db: PokaicoDb;

beforeAll(() => {
  tmpDir = mkdtempSync(join(tmpdir(), "pokaico-memory-test-"));
  db = createDb(join(tmpDir, "test.db"));
});

afterAll(() => {
  closeDb(db);
  rmSync(tmpDir, { recursive: true, force: true });
});

describe("createTopic", () => {
  it("creates CONTEXT.md at the expected path", () => {
    createTopic(tmpDir, "work", "Work-related topics and notes");
    const path = join(tmpDir, "topics", "work", "CONTEXT.md");
    expect(existsSync(path)).toBe(true);
    expect(readFileSync(path, "utf-8")).toBe("Work-related topics and notes");
  });

  it("creates a resources directory alongside CONTEXT.md", () => {
    createTopic(tmpDir, "health", "Health notes");
    const resourcesDir = join(tmpDir, "topics", "health", "resources");
    expect(existsSync(resourcesDir)).toBe(true);
  });

  it("uses the topicId as the directory slug", () => {
    createTopic(tmpDir, "user-profile", "Profile info");
    const path = join(tmpDir, "topics", "user-profile", "CONTEXT.md");
    expect(existsSync(path)).toBe(true);
  });
});

describe("readTopic", () => {
  it("returns content of an existing topic", () => {
    createTopic(tmpDir, "test-read", "Hello world");
    const content = readTopic(tmpDir, "test-read");
    expect(content).toBe("Hello world");
  });

  it("returns null for non-existent topic", () => {
    const content = readTopic(tmpDir, "does-not-exist");
    expect(content).toBeNull();
  });
});

describe("updateTopic", () => {
  it("overwrites CONTEXT.md with new content", () => {
    createTopic(tmpDir, "test-update", "Original content");
    updateTopic(tmpDir, "test-update", "Updated content");
    expect(readTopic(tmpDir, "test-update")).toBe("Updated content");
  });
});

describe("listTopics", () => {
  it("returns empty array when no topics exist", () => {
    const emptyDir = mkdtempSync(join(tmpdir(), "pokaico-empty-topics-"));
    expect(listTopics(emptyDir)).toEqual([]);
  });

  it("reads from INDEX.md when it exists", () => {
    createTopic(tmpDir, "topic-a", "Content A");
    createTopic(tmpDir, "topic-b", "Content B");

    const topics = listTopics(tmpDir);
    expect(topics.length).toBeGreaterThanOrEqual(2);

    const topicA = topics.find((t) => t.topicId === "topic-a");
    expect(topicA).toBeDefined();
  });
});

describe("deleteTopic", () => {
  it("removes the topic directory and its contents", () => {
    createTopic(tmpDir, "test-delete", "To be deleted");
    const topicDir = join(tmpDir, "topics", "test-delete");
    expect(existsSync(topicDir)).toBe(true);

    deleteTopic(tmpDir, "test-delete");
    expect(existsSync(topicDir)).toBe(false);
  });
});

describe("ensureIndex", () => {
  it("creates INDEX.md if it does not exist", () => {
    const freshDir = mkdtempSync(join(tmpdir(), "pokaico-fresh-"));
    createTopic(freshDir, "alpha", "Alpha topic");

    const indexPath = join(freshDir, "INDEX.md");
    expect(existsSync(indexPath)).toBe(false);

    ensureIndex(freshDir);
    expect(existsSync(indexPath)).toBe(true);
  });

  it("INDEX.md contains topic IDs and summaries", () => {
    const indexDir = mkdtempSync(join(tmpdir(), "pokaico-index-"));
    createTopic(indexDir, "one", "First topic");
    createTopic(indexDir, "two", "Second topic");
    ensureIndex(indexDir);

    const indexContent = readFileSync(join(indexDir, "INDEX.md"), "utf-8");
    expect(indexContent).toContain("one");
    expect(indexContent).toContain("First topic");
    expect(indexContent).toContain("two");
    expect(indexContent).toContain("Second topic");
  });
});

describe("regenerateIndex (issue #3 — mechanical observer)", () => {
  // The shared `db` is reused across tests; clear topic/edge rows before each
  // so a leftover edge from one test can't leak into another via readEdges.
  beforeEach(() => {
    db.prepare("DELETE FROM edges").run();
    db.prepare("DELETE FROM topics").run();
  });

  it("rebuilds INDEX.md from topics + edges, overwriting stale content", () => {
    const dir = mkdtempSync(join(tmpdir(), "pokaico-regen-"));
    createTopic(dir, "cycling", "Daily bike commute to work.");
    createTopic(dir, "fitness", "User's fitness goals and routines.");

    // Seed topic rows (FK targets) + a stale edge the observer must surface.
    db.prepare(
      "INSERT OR IGNORE INTO topics(id, path, summary, token_count, updated_at) VALUES (?, ?, '', 0, 0)",
    ).run("cycling", "memory/topics/cycling/CONTEXT.md");
    db.prepare(
      "INSERT OR IGNORE INTO topics(id, path, summary, token_count, updated_at) VALUES (?, ?, '', 0, 0)",
    ).run("fitness", "memory/topics/fitness/CONTEXT.md");
    db.prepare(
      "INSERT INTO edges(from_topic, to_topic, relationship) VALUES (?, ?, ?)",
    ).run("cycling", "fitness", "related-to");

    // Pretend a previous (stale) INDEX.md exists.
    writeFileSync(join(dir, "INDEX.md"), "# Memory Index\n\n- **old-stale-topic**: gone\n", "utf-8");

    regenerateIndex(dir, db);

    const content = readFileSync(join(dir, "INDEX.md"), "utf-8");
    expect(content).toContain("cycling");
    expect(content).toContain("Daily bike commute to work.");
    expect(content).toContain("fitness");
    expect(content).toContain("## Edges");
    expect(content).toContain("cycling → fitness: related-to");
    // Stale entry must be gone.
    expect(content).not.toContain("old-stale-topic");
  });

  it("is idempotent — two regenerations yield identical content", () => {
    const dir = mkdtempSync(join(tmpdir(), "pokaico-regen-idem-"));
    createTopic(dir, "work", "Work schedule and projects.");

    regenerateIndex(dir, db);
    const first = readFileSync(join(dir, "INDEX.md"), "utf-8");
    regenerateIndex(dir, db);
    const second = readFileSync(join(dir, "INDEX.md"), "utf-8");

    expect(second).toBe(first);
  });

  it("drops edges whose endpoint topic has no directory", () => {
    const dir = mkdtempSync(join(tmpdir(), "pokaico-regen-edge-"));
    createTopic(dir, "a", "Topic A.");
    db.prepare(
      "INSERT OR IGNORE INTO topics(id, path, summary, token_count, updated_at) VALUES (?, ?, '', 0, 0)",
    ).run("a", "memory/topics/a/CONTEXT.md");
    // Topic "b" exists in DB (FK holds) but has NO topic directory,
    // so the observer must drop the dangling edge (a → b).
    db.prepare(
      "INSERT OR IGNORE INTO topics(id, path, summary, token_count, updated_at) VALUES (?, ?, '', 0, 0)",
    ).run("b", "memory/topics/b/CONTEXT.md");
    db.prepare(
      "INSERT INTO edges(from_topic, to_topic, relationship) VALUES (?, ?, ?)",
    ).run("a", "b", "related-to");
    // Directory for "b" intentionally absent (only "a" was created via createTopic).

    regenerateIndex(dir, db);

    const content = readFileSync(join(dir, "INDEX.md"), "utf-8");
    expect(content).toContain("a");
    expect(content).not.toContain("a → b");
    expect(content).not.toContain("## Edges");
  });
});

describe("parseIndex (issue #4 — read routing map before create)", () => {
  it("parses topic lines and ignores edge/placeholder lines", () => {
    const dir = mkdtempSync(join(tmpdir(), "pokaico-parse-"));
    writeFileSync(
      join(dir, "INDEX.md"),
      [
        "# Memory Index",
        "",
        "- **cycling**: User bikes to work.",
        "- **fitness**: User's fitness goals.",
        "",
        "## Edges",
        "- cycling → fitness: related-to",
        "",
      ].join("\n"),
      "utf-8",
    );

    const topics = parseIndex(dir);
    expect(topics).toHaveLength(2);
    expect(topics[0]).toEqual({ topicId: "cycling", summary: "User bikes to work." });
    expect(topics[1]).toEqual({ topicId: "fitness", summary: "User's fitness goals." });
  });

  it("returns [] when INDEX.md is absent (caller falls back to DB)", () => {
    const dir = mkdtempSync(join(tmpdir(), "pokaico-parse-empty-"));
    expect(parseIndex(dir)).toEqual([]);
  });
});

describe("edge cases", () => {
  it("handles topic ID with spaces", () => {
    const edgeDir = mkdtempSync(join(tmpdir(), "pokaico-edge-"));
    createTopic(edgeDir, "my work notes", "Spaces in slug");
    expect(readTopic(edgeDir, "my work notes")).toBe("Spaces in slug");
    expect(existsSync(join(edgeDir, "topics", "my work notes", "CONTEXT.md"))).toBe(true);
  });

  it("collision overwrites existing topic content", () => {
    const colDir = mkdtempSync(join(tmpdir(), "pokaico-collision-"));
    createTopic(colDir, "collide", "First");
    createTopic(colDir, "collide", "Second");
    expect(readTopic(colDir, "collide")).toBe("Second");
  });

  it("creates memory root directory if it does not exist", () => {
    const freshRoot = join(tmpdir(), "pokaico-brand-new-memory");
    createTopic(freshRoot, "fresh", "Brand new memory");
    expect(readTopic(freshRoot, "fresh")).toBe("Brand new memory");
    rmSync(freshRoot, { recursive: true, force: true });
  });

  it("listTopics reflects actual filesystem after manual deletion", () => {
    const staleDir = mkdtempSync(join(tmpdir(), "pokaico-stale-"));
    createTopic(staleDir, "alpha", "Alpha");
    createTopic(staleDir, "beta", "Beta");

    const before = listTopics(staleDir);
    expect(before).toHaveLength(2);

    // manually delete one topic from filesystem
    rmSync(join(staleDir, "topics", "alpha"), { recursive: true, force: true });

    const after = listTopics(staleDir);
    expect(after).toHaveLength(1);
    expect(after[0].topicId).toBe("beta");
  });

  it("deleteTopic on non-existent topic is a no-op", () => {
    const noopDir = mkdtempSync(join(tmpdir(), "pokaico-noop-"));
    expect(() => deleteTopic(noopDir, "does-not-exist")).not.toThrow();
  });

  it("handles case-insensitive topic IDs on case-insensitive filesystems", () => {
    const caseDir = mkdtempSync(join(tmpdir(), "pokaico-case-"));
    createTopic(caseDir, "Work", "Capital W");
    createTopic(caseDir, "work", "Lowercase w");

    // On case-insensitive FS (Windows, macOS), "Work" and "work" collide
    // On case-sensitive FS (Linux), they're distinct. We test both scenarios.
    const topics = listTopics(caseDir);
    if (topics.length === 1) {
      // Case-insensitive: second write overwrites
      expect(readTopic(caseDir, "work")).toBe("Lowercase w");
    } else {
      // Case-sensitive: both exist
      expect(readTopic(caseDir, "Work")).toBe("Capital W");
      expect(readTopic(caseDir, "work")).toBe("Lowercase w");
    }
  });
});
