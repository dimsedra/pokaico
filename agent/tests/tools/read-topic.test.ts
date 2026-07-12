import { describe, it, expect } from "vitest";
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { createReadTopicTool } from "../../src/mastra/tools/read-topic";
import { readTopic, VALID_TOPIC_RE } from "../../src/memory/topics";

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

  it("returns exists=false with null content for a non-existent topic", async () => {
    const dir = mkdtempSync(join(tmpdir(), "read-topic-miss-"));
    mkdirSync(join(dir, "topics"), { recursive: true });

    const tool = createReadTopicTool(dir);
    const result = await tool.execute({ topicId: "ghost" });
    expect(result.exists).toBe(false);
    expect(result.content).toBeNull();
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

  it("returns exists=false with null content when memoryDir is missing", async () => {
    const dir = join(tmpdir(), "read-topic-missing-" + Date.now());

    const tool = createReadTopicTool(dir);
    const result = await tool.execute({ topicId: "hiking" });
    expect(result.exists).toBe(false);
    expect(result.content).toBeNull();
  });
});

describe("VALID_TOPIC_RE", () => {
  it("rejects path traversal", () => {
    expect(VALID_TOPIC_RE.test("../../etc/passwd")).toBe(false);
    expect(VALID_TOPIC_RE.test("..")).toBe(false);
  });

  it("rejects empty string", () => {
    expect(VALID_TOPIC_RE.test("")).toBe(false);
  });

  it("accepts valid kebab-case slugs", () => {
    expect(VALID_TOPIC_RE.test("cycling-commute")).toBe(true);
    expect(VALID_TOPIC_RE.test("hiking")).toBe(true);
    expect(VALID_TOPIC_RE.test("a")).toBe(true);
  });
});
