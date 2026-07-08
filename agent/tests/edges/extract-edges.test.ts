import { describe, it, expect, vi } from "vitest";
import { extractTopics } from "../../src/memory/extract";
import type { TopicMeta } from "../../src/memory/topics";

describe("E6: Summarizer returns keyPoints: []", () => {
  it("handles empty keyPoints array gracefully", async () => {
    const summary = {
      summary: "User had a short chat about nothing specific.",
      keyPoints: [] as string[],
    };

    const searchSimilar = vi.fn().mockResolvedValue([]);

    const result = await extractTopics(summary, [], searchSimilar);

    console.log("E6 result:", JSON.stringify(result));
    console.log("E6 topicId:", result[0].topicId);
    console.log("E6 content:", result[0].content);

    // Should not crash, should produce valid output
    expect(result).toHaveLength(1);
    expect(result[0].action).toBe("create");
    expect(result[0].topicId).toBeTruthy();

    if (result[0].content.includes("Key points:\n")) {
      console.log("E6 VERDICT: BUG CONFIRMED — empty 'Key points:' section in topic content");
    } else {
      console.log("E6 VERDICT: PASS — no empty section");
    }
  });

  it("handles keyPoints with empty strings", async () => {
    const summary = {
      summary: "Short talk.",
      keyPoints: ["", ""],
    };

    const searchSimilar = vi.fn().mockResolvedValue([]);

    const result = await extractTopics(summary, [], searchSimilar);

    console.log("E6b topicId from ['', '']:", result[0].topicId);
    console.log("E6b content:", result[0].content);

    expect(result).toHaveLength(1);
    expect(result[0].topicId).toBeTruthy();

    if (result[0].topicId === "topic") {
      console.log("E6b VERDICT: WARNING — generic 'topic' slug due to empty keyPoints");
    } else {
      console.log("E6b VERDICT: PASS — slug derived from summary");
    }
  });
});
