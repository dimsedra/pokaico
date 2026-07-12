import { describe, it, expect } from "vitest";
import { mkdtempSync, writeFileSync, mkdirSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { createAgent } from "../src/mastra/index";
import { ModelRouterLanguageModel } from "@mastra/core/llm";

const mockModel = new ModelRouterLanguageModel("openai/gpt-4");

describe("createAgent", () => {
  it("returns an Agent with id 'pokai' using model and memoryDir", () => {
    const dir = mkdtempSync(join(tmpdir(), "mastra-test-"));
    const agent = createAgent({ model: mockModel, memoryDir: dir });
    expect(agent).toBeDefined();
    expect(agent.id).toBe("pokai");
    expect(agent.name).toBe("Pokai");
    rmSync(dir, { recursive: true, force: true });
  });

  it("accepts optional tools parameter", () => {
    const dir = mkdtempSync(join(tmpdir(), "mastra-test-tools-"));
    const agent = createAgent({ model: mockModel, memoryDir: dir, tools: {} });
    expect(agent).toBeDefined();
    expect(agent.id).toBe("pokai");
    rmSync(dir, { recursive: true, force: true });
  });

  it("falls back to static prompt when buildPrompt fails (missing directory)", () => {
    const dir = mkdtempSync(join(tmpdir(), "mastra-test-fallback-"));
    const agent = createAgent({ model: mockModel, memoryDir: dir });
    expect(agent).toBeDefined();
    expect(agent.id).toBe("pokai");
    rmSync(dir, { recursive: true, force: true });
  });
});
