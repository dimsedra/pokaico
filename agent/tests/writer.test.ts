import { describe, it, expect, beforeEach } from "vitest";
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, existsSync, rmSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { applyChanges } from "../src/memory/writer";
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

    const updated = await applyChanges(changes, memoryDir());
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

    const updated = await applyChanges(changes, memoryDir());
    expect(updated).toContain("work");
    const content = readFileSync(join(topicDir, "CONTEXT.md"), "utf-8");
    expect(content).toContain("New work content.");
    expect(content).toContain("Old content.");
  });

  it("includes provenance markers in content", async () => {
    const changes: TopicChange[] = [
      { topicId: "test-provenance", action: "create", content: "Test content." },
    ];

    await applyChanges(changes, memoryDir(), "session-1", 1000);
    const content = readFileSync(
      join(memoryDir(), "topics", "test-provenance", "CONTEXT.md"),
      "utf-8",
    );
    expect(content).toContain("[src:session-1:1000]");
  });

  it("overflows to resources/ when content exceeds 2500 tokens", async () => {
    // 2500 tokens = ~10000 chars with char/4 estimation
    const longContent = "A".repeat(10001);

    const changes: TopicChange[] = [
      { topicId: "overflow-test", action: "create", content: longContent },
    ];

    await applyChanges(changes, memoryDir());

    const topicDir = join(memoryDir(), "topics", "overflow-test");
    const resources = readdirSync(join(topicDir, "resources"));
    expect(resources.length).toBeGreaterThan(0);

    const contextContent = readFileSync(join(topicDir, "CONTEXT.md"), "utf-8");
    expect(contextContent).toContain("See [detailed notes](resources/");
  });

  it("handles multiple changes concurrently via internal mutex", async () => {
    const changes: TopicChange[] = [
      { topicId: "multi-a", action: "create", content: "Content A." },
      { topicId: "multi-b", action: "create", content: "Content B." },
    ];

    const updated = await applyChanges(changes, memoryDir());
    expect(updated).toContain("multi-a");
    expect(updated).toContain("multi-b");
    expect(
      existsSync(join(memoryDir(), "topics", "multi-a", "CONTEXT.md")),
    ).toBe(true);
    expect(
      existsSync(join(memoryDir(), "topics", "multi-b", "CONTEXT.md")),
    ).toBe(true);
  });

  it("does not duplicate content with same provenance", async () => {
    const topicId = "dedup-test";
    const changes1: TopicChange[] = [
      { topicId, action: "create", content: "First content." },
    ];

    await applyChanges(changes1, memoryDir(), "session-1", 100);
    const content = readFileSync(
      join(memoryDir(), "topics", "dedup-test", "CONTEXT.md"),
      "utf-8",
    );

    // Second write with same provenance should be no-op
    const changes2: TopicChange[] = [
      { topicId, action: "update", content: "Duplicated content." },
    ];
    await applyChanges(changes2, memoryDir(), "session-1", 100);

    const content2 = readFileSync(
      join(memoryDir(), "topics", "dedup-test", "CONTEXT.md"),
      "utf-8",
    );
    expect(content2).toBe(content);
  });
});