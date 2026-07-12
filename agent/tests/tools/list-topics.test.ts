import { describe, it, expect } from "vitest";
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { createListTopicsTool } from "../../src/mastra/tools/list-topics";

describe("list_topics tool", () => {
  it("returns all topics when no filter is given", async () => {
    const dir = mkdtempSync(join(tmpdir(), "list-topics-"));
    mkdirSync(join(dir, "topics", "hiking"), { recursive: true });
    writeFileSync(join(dir, "topics", "hiking", "CONTEXT.md"), "User loves hiking.");
    mkdirSync(join(dir, "topics", "biking"), { recursive: true });
    writeFileSync(join(dir, "topics", "biking", "CONTEXT.md"), "User bikes daily.");

    const tool = createListTopicsTool(dir);
    const result = await tool.execute({});
    expect(result.topics).toHaveLength(2);
    expect(result.topics.find((t: any) => t.topicId === "hiking")).toBeTruthy();
    expect(result.topics.find((t: any) => t.topicId === "biking")).toBeTruthy();
    rmSync(dir, { recursive: true, force: true });
  });

  it("filters foundational topics when filter='foundational'", async () => {
    const dir = mkdtempSync(join(tmpdir(), "list-topics-found-"));
    mkdirSync(join(dir, "topics", "user-profile"), { recursive: true });
    writeFileSync(join(dir, "topics", "user-profile", "CONTEXT.md"), "Profile.");
    mkdirSync(join(dir, "topics", "hobby"), { recursive: true });
    writeFileSync(join(dir, "topics", "hobby", "CONTEXT.md"), "A hobby.");

    const tool = createListTopicsTool(dir);
    const result = await tool.execute({ filter: "foundational" });
    expect(result.topics).toHaveLength(1);
    expect(result.topics[0].topicId).toBe("user-profile");
    expect(result.topics[0].isFoundational).toBe(true);
    rmSync(dir, { recursive: true, force: true });
  });

  it("returns empty array when topics/ directory does not exist", async () => {
    const dir = mkdtempSync(join(tmpdir(), "list-topics-empty-"));

    const tool = createListTopicsTool(dir);
    const result = await tool.execute({});
    expect(result.topics).toEqual([]);
    rmSync(dir, { recursive: true, force: true });
  });
});
