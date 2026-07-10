import { describe, it, expect, beforeEach, vi } from "vitest";

const mockGenerateText = vi.hoisted(() => vi.fn());

vi.mock("ai", () => ({
  generateText: mockGenerateText,
  Output: { object: (opts: unknown) => opts },
}));

import { compact } from "../src/memory/compactor";

const mockModel = {} as never;

describe("compactor", () => {
  beforeEach(() => {
    mockGenerateText.mockReset();
  });

  it("returns condensed context within the cap", async () => {
    mockGenerateText.mockResolvedValue({
      output: {
        context: "User cycles 15km to work and enjoys it.",
        overflow: [],
        edges: [],
      },
    });

    const result = await compact({
      current: "User cycles to work.",
      newInfo: "It is 15km each way and they enjoy it.",
      cap: 2500,
      model: mockModel,
    });

    expect(result.context).toContain("15km");
    expect(result.overflow).toEqual([]);
    expect(result.edges).toEqual([]);
  });

  it("returns overflow when content cannot be condensed within the cap", async () => {
    mockGenerateText.mockResolvedValue({
      output: {
        context: "High-level summary of the project. See [notes](resources/project-details.md).",
        overflow: [
          {
            filename: "project-details.md",
            content: "Very long detailed breakdown of every project milestone...",
            relationship: "has-detailed-notes",
          },
        ],
        edges: [],
      },
    });

    const result = await compact({
      current: "Project summary.",
      newInfo: "A huge amount of detail that cannot fit.",
      cap: 2500,
      model: mockModel,
    });

    expect(result.overflow).toHaveLength(1);
    expect(result.overflow[0].filename).toBe("project-details.md");
    expect(result.overflow[0].relationship).toBe("has-detailed-notes");
  });

  it("returns edges the LLM wants to preserve or add", async () => {
    mockGenerateText.mockResolvedValue({
      output: {
        context: "User's cycling relates to their fitness goals.",
        overflow: [],
        edges: [{ toTopic: "fitness-goals", relationship: "related-to" }],
      },
    });

    const result = await compact({
      current: "User cycles.",
      newInfo: "Cycling is part of their fitness plan.",
      cap: 2500,
      model: mockModel,
      existingEdges: [{ toTopic: "fitness-goals", relationship: "related-to" }],
    });

    expect(result.edges).toEqual([{ toTopic: "fitness-goals", relationship: "related-to" }]);
  });

  it("defaults overflow and edges to empty arrays when omitted", async () => {
    mockGenerateText.mockResolvedValue({
      output: { context: "Condensed.", overflow: undefined, edges: undefined },
    });

    const result = await compact({
      current: "a",
      newInfo: "b",
      cap: 2500,
      model: mockModel,
    });

    expect(result.overflow).toEqual([]);
    expect(result.edges).toEqual([]);
  });

  it("passes current content, new info, and cap to the LLM prompt", async () => {
    let capturedPrompt = "";
    mockGenerateText.mockImplementation(async ({ prompt }: { prompt: string }) => {
      capturedPrompt = prompt;
      return { output: { context: "ok", overflow: [], edges: [] } };
    });

    await compact({
      current: "EXISTING_MARKER_TEXT",
      newInfo: "NEW_INFO_MARKER",
      cap: 700,
      model: mockModel,
    });

    expect(capturedPrompt).toContain("EXISTING_MARKER_TEXT");
    expect(capturedPrompt).toContain("NEW_INFO_MARKER");
    expect(capturedPrompt).toContain("700");
  });
});
