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

  it("updates existing topic content by appending", async () => {
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

  it("stores external content in resources/ with link in CONTEXT.md", async () => {
    const longReadme = "# My Project\n\nThis is a very long README with lots of details.\n\n## Install\n\n```\nnpm i\n```".repeat(5);

    const changes: TopicChange[] = [
      {
        topicId: "user-project",
        action: "external",
        content: longReadme,
        resourceFile: "user-project-readme.md",
      },
    ];

    await applyChanges(changes, memoryDir(), "session-1", 1000);

    const topicPath = join(memoryDir(), "topics", "user-project");
    const resourcePath = join(topicPath, "resources", "user-project-readme.md");
    const contextPath = join(topicPath, "CONTEXT.md");

    expect(existsSync(resourcePath)).toBe(true);
    expect(readFileSync(resourcePath, "utf-8")).toBe(longReadme);

    const contextContent = readFileSync(contextPath, "utf-8");
    expect(contextContent).toContain("See [full content](resources/user-project-readme.md)");
    expect(contextContent).toContain("[src:session-1:1000]");
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

    const changes2: TopicChange[] = [
      { topicId, action: "update", content: "Duplicated content." },
    ];
    await applyChanges(changes2, memoryDir(), "session-1", 100);

    const content = readFileSync(
      join(memoryDir(), "topics", "dedup-test", "CONTEXT.md"),
      "utf-8",
    );

    // "Duplicated content." should NOT appear
    expect(content).not.toContain("Duplicated content.");
  });

  it("accumulates multiple updates without truncation", async () => {
    const topicId = "growing";
    await applyChanges(
      [{ topicId, action: "create", content: "First." }],
      memoryDir(), "s1", 1,
    );

    for (let i = 2; i <= 20; i++) {
      await applyChanges(
        [{ topicId, action: "update", content: `Update ${i}.` }],
        memoryDir(), `s${i}`, i,
      );
    }

    const content = readFileSync(
      join(memoryDir(), "topics", "growing", "CONTEXT.md"),
      "utf-8",
    );

    expect(content).toContain("First.");
    expect(content).toContain("Update 10.");
    expect(content).toContain("Update 20.");

    // No overflow to resources for regular updates
    const rd = join(memoryDir(), "topics", "growing", "resources");
    expect(existsSync(rd)).toBe(false);
  });
});
