import { describe, it, expect, vi } from "vitest";
import { extractTopics } from "../../src/memory/extract";

describe("E6: Summarizer returns keyPoints: []", () => {
  it("produces valid output with no empty 'Key points:' section", async () => {
    const summary = {
      summary: "User had a short chat about nothing specific.",
      keyPoints: [] as string[],
    };

    const searchSimilar = vi.fn().mockResolvedValue([]);

    const result = await extractTopics(summary, [], searchSimilar);

    expect(result).toHaveLength(1);
    expect(result[0].action).toBe("create");
    expect(result[0].topicId).toBeTruthy();
    expect(result[0].content).not.toContain("Key points:");
  });

  it("derives a meaningful slug from the summary when keyPoints are empty strings", async () => {
    const summary = {
      summary: "Short talk.",
      keyPoints: ["", ""],
    };

    const searchSimilar = vi.fn().mockResolvedValue([]);

    const result = await extractTopics(summary, [], searchSimilar);

    expect(result).toHaveLength(1);
    expect(result[0].topicId).toBeTruthy();
    // Slug comes from the summary, not a generic "topic" fallback.
    expect(result[0].topicId).not.toBe("topic");
    expect(result[0].topicId).toBe("short-talk");
  });
});
