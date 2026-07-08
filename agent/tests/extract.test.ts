import { describe, it, expect, vi } from "vitest";
import { extractTopics } from "../src/memory/extract";
import type { TopicMeta } from "../src/memory/topics";

describe("extractTopics", () => {
  const summary = {
    summary: "User loves hiking in mountains.",
    keyPoints: ["Hiking is a hobby"],
  };

  it("returns create action when no similar topics exist", async () => {
    const searchSimilar = vi.fn().mockResolvedValue([]);

    const result = await extractTopics(summary, [], searchSimilar);
    expect(result).toHaveLength(1);
    expect(result[0].action).toBe("create");
    expect(result[0].topicId).toBeTruthy();
  });

  it("returns merge action when similar topic found above threshold", async () => {
    const searchSimilar = vi.fn().mockResolvedValue([
      { topicId: "hobbies", score: 0.92, content: "Previous hobby info", sourcePath: "" },
    ]);

    const existingTopics: TopicMeta[] = [
      { topicId: "hobbies", summary: "User hobbies", isFoundational: false, updatedAt: 100 },
    ];

    const result = await extractTopics(summary, existingTopics, searchSimilar);
    expect(result[0].action).toBe("update");
    expect(result[0].topicId).toBe("hobbies");
  });

  it("skips topics below similarity threshold", async () => {
    const searchSimilar = vi.fn().mockResolvedValue([
      { topicId: "work", score: 0.3, content: "Work stuff", sourcePath: "" },
      { topicId: "hobbies", score: 0.88, content: "Hobby stuff", sourcePath: "" },
    ]);

    const existingTopics: TopicMeta[] = [
      { topicId: "work", summary: "", isFoundational: false, updatedAt: 0 },
      { topicId: "hobbies", summary: "", isFoundational: false, updatedAt: 0 },
      { topicId: "health", summary: "", isFoundational: false, updatedAt: 0 },
    ];

    const result = await extractTopics(summary, existingTopics, searchSimilar);
    const updates = result.filter((c) => c.action === "update");
    expect(updates).toHaveLength(1);
    expect(updates[0].topicId).toBe("hobbies");
  });

  it("excludes foundational topics from similarity search", async () => {
    const searchSimilar = vi.fn().mockResolvedValue([
      { topicId: "hobbies", score: 0.9, content: "Hobby stuff", sourcePath: "" },
    ]);

    const existingTopics: TopicMeta[] = [
      { topicId: "user-profile", summary: "", isFoundational: true, updatedAt: 0 },
      { topicId: "hobbies", summary: "", isFoundational: false, updatedAt: 0 },
    ];

    const result = await extractTopics(summary, existingTopics, searchSimilar);
    const creates = result.filter((c) => c.action === "create");
    const updates = result.filter((c) => c.action === "update");
    expect(updates[0].topicId).toBe("hobbies");
    expect(creates).toHaveLength(0); // hobbies matched, no create needed
  });
});