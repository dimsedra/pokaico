import { describe, it, expect, beforeEach } from "vitest";
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, existsSync, rmSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { applyChanges } from "../src/memory/writer";
import { withTopicLock } from "../src/memory/mutex";
import type { TopicChange } from "../src/memory/types";

describe("writer", () => {
  let dir: string;

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), "writer-test-"));
    mkdirSync(join(dir, "memory", "topics"), { recursive: true });
  });

  function memoryDir() {
    return join(dir, "memory");
  }

  it("creates a new topic directory with CONTEXT.md", async () => {
    const changes: TopicChange[] = [
      { topicId: "hiking", action: "create", content: "User loves hiking." },
    ];

    const updated = await applyChanges(changes, memoryDir(), withTopicLock);
    expect(updated).toEqual(["hiking"]);

    const contextPath = join(memoryDir(), "topics", "hiking", "CONTEXT.md");
    expect(existsSync(contextPath)).toBe(true);
    expect(readFileSync(contextPath, "utf-8")).toContain("User loves hiking.");
  });

  it("updates existing topic content", async () => {
    const topicDir = join(memoryDir(), "topics", "work");
    mkdirSync(topicDir, { recursive: true });
    writeFileSync(join(topicDir, "CONTEXT.md"), "Old content.", "utf-8");

    const changes: TopicChange[] = [
      { topicId: "work", action: "update", content: "New work content." },
    ];

    const updated = await applyChanges(changes, memoryDir(), withTopicLock);
    expect(updated).toContain("work");
    expect(readFileSync(join(topicDir, "CONTEXT.md"), "utf-8")).toContain("New work content.");
  });

  it("includes provenance markers in content", async () => {
    const changes: TopicChange[] = [
      { topicId: "test-provenance", action: "create", content: "Test content." },
    ];

    await applyChanges(changes, memoryDir(), withTopicLock, "session-1", 1000);
    const content = readFileSync(
      join(memoryDir(), "topics", "test-provenance", "CONTEXT.md"),
      "utf-8",
    );
    expect(content).toContain("[src:session-1:1000]");
  });

  it("overflows to resources/ when content exceeds 2500 chars", async () => {
    const longContent = "A".repeat(2600);

    const changes: TopicChange[] = [
      { topicId: "overflow-test", action: "create", content: longContent },
    ];

    await applyChanges(changes, memoryDir(), withTopicLock);

    const topicDir = join(memoryDir(), "topics", "overflow-test");
    const resources = readdirSync(join(topicDir, "resources"));
    expect(resources.length).toBeGreaterThan(0);

    const contextContent = readFileSync(join(topicDir, "CONTEXT.md"), "utf-8");
    expect(contextContent).toContain("See [detailed notes](resources/");
  });

  it("handles multiple changes concurrently via mutex", async () => {
    const changes: TopicChange[] = [
      { topicId: "multi-a", action: "create", content: "Content A." },
      { topicId: "multi-b", action: "create", content: "Content B." },
    ];

    const updated = await applyChanges(changes, memoryDir(), withTopicLock);
    expect(updated).toContain("multi-a");
    expect(updated).toContain("multi-b");
    expect(
      existsSync(join(memoryDir(), "topics", "multi-a", "CONTEXT.md")),
    ).toBe(true);
    expect(
      existsSync(join(memoryDir(), "topics", "multi-b", "CONTEXT.md")),
    ).toBe(true);
  });
});