import { describe, it, expect } from "vitest";
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { createReadTopicTool } from "../../src/mastra/tools/read-topic";

describe("read_topic tool", () => {
  it("returns content for an existing topic", async () => {
    const dir = mkdtempSync(join(tmpdir(), "read-topic-"));
    const topicDir = join(dir, "topics", "hiking");
    mkdirSync(topicDir, { recursive: true });
    writeFileSync(join(topicDir, "CONTEXT.md"), "User loves hiking in mountains.");

    const tool = createReadTopicTool(dir);
    const result = await tool.execute({ topicId: "hiking" });
    expect(result.exists).toBe(true);
    expect(result.content).toBe("User loves hiking in mountains.");
    rmSync(dir, { recursive: true, force: true });
  });

  it("returns exists=false for a non-existent topic", async () => {
    const dir = mkdtempSync(join(tmpdir(), "read-topic-miss-"));
    mkdirSync(join(dir, "topics"), { recursive: true });

    const tool = createReadTopicTool(dir);
    const result = await tool.execute({ topicId: "ghost" });
    expect(result.exists).toBe(false);
    expect(result.content).toBe("(topic not found)");
    rmSync(dir, { recursive: true, force: true });
  });

  it("returns content with provenance marker intact", async () => {
    const dir = mkdtempSync(join(tmpdir(), "read-topic-prov-"));
    const topicDir = join(dir, "topics", "work");
    mkdirSync(topicDir, { recursive: true });
    writeFileSync(join(topicDir, "CONTEXT.md"), "[src:s1:100]\n\nWork stress notes.");

    const tool = createReadTopicTool(dir);
    const result = await tool.execute({ topicId: "work" });
    expect(result.content).toContain("[src:s1:100]");
    expect(result.content).toContain("Work stress notes.");
    rmSync(dir, { recursive: true, force: true });
  });

  it("rejects path traversal in topicId", async () => {
    const dir = mkdtempSync(join(tmpdir(), "read-topic-trav-"));
    mkdirSync(join(dir, "topics"), { recursive: true });

    const tool = createReadTopicTool(dir);
    const result = await tool.execute({ topicId: "../../etc/passwd" });
    expect(result.exists).toBe(false);
    expect(result.content).toBe("(invalid topicId)");
    rmSync(dir, { recursive: true, force: true });
  });
});
