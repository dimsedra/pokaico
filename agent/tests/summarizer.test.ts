import { describe, it, expect, vi, beforeEach } from "vitest";

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

  const multiTurns = [
    { timestamp: "14:00:00", role: "user" as const, content: "I just got promoted at work!" },
    { timestamp: "14:00:15", role: "pokai" as const, content: "Congrats! How do you feel?" },
    { timestamp: "14:01:00", role: "user" as const, content: "Excited but nervous." },
    { timestamp: "14:02:00", role: "user" as const, content: "By the way, I've been cycling to work." },
    { timestamp: "14:02:15", role: "pokai" as const, content: "Nice! How far?" },
    { timestamp: "14:02:30", role: "user" as const, content: "About 15km each way, saves money on transport." },
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
        topics: [
          {
            title: "work stress",
            summary: "User experiences work stress every two weeks.",
            keyPoints: ["User's work stress is recurring every two weeks"],
          },
        ],
      },
    });

    const result = await summarize(turns, mockModel);
    expect(result.summary).toBe("User has recurring work stress every two weeks.");
    expect(result.keyPoints).toHaveLength(1);
    expect(result.keyPoints[0]).toContain("recurring");
    expect(result.topics).toHaveLength(1);
    expect(result.topics[0].title).toBe("work stress");
  });

  it("returns multiple topic segments for multi-subject conversation", async () => {
    mockGenerateText.mockResolvedValue({
      output: {
        summary: "User got promoted and also cycles to work.",
        keyPoints: ["Promoted to senior role", "Cycles 15km to work"],
        topics: [
          {
            title: "job promotion",
            summary: "User was promoted at work and feels excited but nervous.",
            keyPoints: ["Got promoted", "Feels excited and nervous"],
          },
          {
            title: "cycling commute",
            summary: "User cycles 15km each way to work daily.",
            keyPoints: ["Cycles 15km each way", "Saves money on transport"],
          },
        ],
      },
    });

    const result = await summarize(multiTurns, mockModel);
    expect(result.topics).toHaveLength(2);
    expect(result.topics[0].title).toBe("job promotion");
    expect(result.topics[0].keyPoints).toHaveLength(2);
    expect(result.topics[1].title).toBe("cycling commute");
    expect(result.topics[1].summary).toContain("15km");
  });

  it("throws on empty turns", async () => {
    await expect(summarize([], mockModel)).rejects.toThrow("empty conversation");
  });

  it("passes the transcript to the LLM", async () => {
    let capturedPrompt = "";
    mockGenerateText.mockImplementation(async ({ prompt }: { prompt: string }) => {
      capturedPrompt = prompt;
      return {
        output: {
          summary: "test summary",
          keyPoints: ["test point"],
          topics: [{ title: "test", summary: "test", keyPoints: ["test"] }],
        },
      };
    });

    await summarize(turns, mockModel);
    expect(capturedPrompt).toContain("Man, work was rough");
    expect(capturedPrompt).toContain("That sounds exhausting");
    expect(capturedPrompt).toContain("every two weeks");
  });
});
