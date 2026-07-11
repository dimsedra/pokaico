import { describe, it, expect, vi } from "vitest";

const mockGenerateText = vi.hoisted(() => vi.fn());

vi.mock("ai", () => ({
  generateText: mockGenerateText,
  Output: { object: (opts: unknown) => opts },
}));

import { refreshFoundational } from "../src/memory/foundational";

describe("refreshFoundational", () => {
  const summary = {
    summary: "User talked about work stress.",
    keyPoints: ["Work stress is recurring"],
  };

  const mockModel = {} as never;

  beforeEach(() => {
    mockGenerateText.mockReset();
  });

  it("returns empty array given no topics", async () => {
    const result = await refreshFoundational(summary, [], mockModel);
    expect(result).toEqual([]);
  });

  it("detects new info and returns updated content", async () => {
    mockGenerateText.mockResolvedValue({
      output: {
        updates: [
          {
            topicId: "user-profile",
            newContent: "User experiences recurring work stress every two weeks.",
            hasNewInfo: true,
          },
        ],
      },
    });

    const result = await refreshFoundational(summary, [
      { topicId: "user-profile", currentContent: "User likes coffee." },
    ], mockModel);

    expect(result).toHaveLength(1);
    expect(result[0].topicId).toBe("user-profile");
    expect(result[0].hasNewInfo).toBe(true);
    expect(result[0].newContent).toContain("recurring work stress");
  });

  it("returns null newContent when no new info", async () => {
    mockGenerateText.mockResolvedValue({
      output: {
        updates: [
          {
            topicId: "user-profile",
            newContent: null,
            hasNewInfo: false,
          },
        ],
      },
    });

    const result = await refreshFoundational(summary, [
      { topicId: "user-profile", currentContent: "User likes coffee." },
    ], mockModel);

    expect(result[0].hasNewInfo).toBe(false);
    expect(result[0].newContent).toBeNull();
  });

  it("handles multiple topics", async () => {
    mockGenerateText.mockResolvedValue({
      output: {
        updates: [
          { topicId: "user-profile", newContent: null, hasNewInfo: false },
          { topicId: "user-background", newContent: null, hasNewInfo: false },
          { topicId: "user-patterns", newContent: "User often requests blog drafts weekly.", hasNewInfo: true },
        ],
      },
    });

    const result = await refreshFoundational(summary, [
      { topicId: "user-profile", currentContent: "" },
      { topicId: "user-background", currentContent: "" },
      { topicId: "user-patterns", currentContent: "" },
    ], mockModel);

    expect(result).toHaveLength(3);
    expect(result.filter((u) => u.hasNewInfo)).toHaveLength(1);
  });
});