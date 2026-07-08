import { describe, it, expect, vi } from "vitest";

const mockGenerateText = vi.hoisted(() => vi.fn());

vi.mock("ai", () => ({
  generateText: mockGenerateText,
  Output: { object: (opts: unknown) => opts },
}));

import { summarize } from "../src/memory/summarizer";

describe("summarizer", () => {
  const turns = [
    { timestamp: "14:02:11", role: "user" as const, content: "Man, work was rough today." },
    { timestamp: "14:02:19", role: "pokai" as const, content: "That sounds exhausting." },
    { timestamp: "14:05:03", role: "user" as const, content: "Yeah it happens every two weeks." },
  ];

  const mockModel = {} as never;

  beforeEach(() => {
    mockGenerateText.mockReset();
  });

  it("returns summary and keyPoints from LLM output", async () => {
    mockGenerateText.mockResolvedValue({
      output: {
        summary: "User has recurring work stress every two weeks.",
        keyPoints: ["Work stress is recurring every two weeks"],
      },
    });

    const result = await summarize(turns, mockModel);
    expect(result.summary).toBe("User has recurring work stress every two weeks.");
    expect(result.keyPoints).toHaveLength(1);
    expect(result.keyPoints[0]).toContain("recurring");
  });

  it("throws on empty turns", async () => {
    await expect(summarize([], mockModel)).rejects.toThrow("empty conversation");
  });

  it("passes the transcript to the LLM", async () => {
    let capturedPrompt = "";
    mockGenerateText.mockImplementation(async ({ prompt }: { prompt: string }) => {
      capturedPrompt = prompt;
      return {
        output: { summary: "test summary", keyPoints: ["test point"] },
      };
    });

    await summarize(turns, mockModel);
    expect(capturedPrompt).toContain("Man, work was rough");
    expect(capturedPrompt).toContain("That sounds exhausting");
    expect(capturedPrompt).toContain("every two weeks");
  });
});