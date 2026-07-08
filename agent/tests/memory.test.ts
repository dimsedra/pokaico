import { describe, it, expect, beforeAll } from "vitest";
import { mkdtempSync, readFileSync, existsSync, mkdirSync } from "node:fs";
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
