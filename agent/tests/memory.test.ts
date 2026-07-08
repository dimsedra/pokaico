import { describe, it, expect, beforeAll } from "vitest";
import { mkdtempSync, readFileSync, existsSync, rmSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";

import {
  createTopic,
  readTopic,
  updateTopic,
  listTopics,
  deleteTopic,
  ensureIndex,
} from "../src/memory/topics";

let tmpDir: string;

beforeAll(() => {
  tmpDir = mkdtempSync(join(tmpdir(), "pokaico-memory-test-"));
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
