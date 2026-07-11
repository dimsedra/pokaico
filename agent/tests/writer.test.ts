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

  it("replaces existing topic content on update (content is compacted upstream)", async () => {
    const topicDir = join(memoryDir(), "topics", "work");
    mkdirSync(topicDir, { recursive: true });
    writeFileSync(join(topicDir, "CONTEXT.md"), "Old content.", "utf-8");

    const changes: TopicChange[] = [
      { topicId: "work", action: "update", content: "Compacted work content." },
    ];

    const updated = await applyChanges(changes, memoryDir());
    expect(updated).toContain("work");
    const content = readFileSync(join(topicDir, "CONTEXT.md"), "utf-8");
    expect(content).toBe("Compacted work content.");
  });

  it("writes overflow to resources/ on update", async () => {
    const topicDir = join(memoryDir(), "topics", "proj");
    mkdirSync(topicDir, { recursive: true });
    writeFileSync(join(topicDir, "CONTEXT.md"), "Old.", "utf-8");

    const changes: TopicChange[] = [
      {
        topicId: "proj",
        action: "update",
        content: "High-level summary. See [notes](resources/proj-details.md).",
        overflow: [
          { filename: "proj-details.md", content: "Long detail.", relationship: "has-detailed-notes" },
        ],
      },
    ];

    await applyChanges(changes, memoryDir());

    const context = readFileSync(join(topicDir, "CONTEXT.md"), "utf-8");
    expect(context).toContain("See [notes](resources/proj-details.md)");

    const resource = readFileSync(join(topicDir, "resources", "proj-details.md"), "utf-8");
    expect(resource).toBe("Long detail.");
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

  it("update replaces rather than accumulates (idempotency handled by session_pointers)", async () => {
    const topicId = "growing";
    await applyChanges(
      [{ topicId, action: "create", content: "First." }],
      memoryDir(), "s1", 1,
    );

    for (let i = 2; i <= 20; i++) {
      await applyChanges(
        [{ topicId, action: "update", content: `Compacted state ${i}.` }],
        memoryDir(), `s${i}`, i,
      );
    }

    const content = readFileSync(
      join(memoryDir(), "topics", "growing", "CONTEXT.md"),
      "utf-8",
    );

    // Only the latest compacted state remains — no unbounded growth.
    expect(content).toBe("[src:s20:20]\n\nCompacted state 20.");
    expect(content).not.toContain("First.");

    // No overflow to resources when none provided.
    const rd = join(memoryDir(), "topics", "growing", "resources");
    expect(existsSync(rd)).toBe(false);
  });
});
