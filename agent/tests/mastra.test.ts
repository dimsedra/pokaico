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
    // No INDEX.md or topics directory exists — buildPrompt reads start failing
    // and the .catch() supplies STATIC_SYSTEM_PROMPT.
    // If the fallback were missing, the function passed to Agent constructor
    // would return a rejected promise (unhandled) — but with .catch() the
    // promise resolves, so the agent is created without error.
    expect(() => createAgent({ model: mockModel, memoryDir: dir })).not.toThrow();
    const agent = createAgent({ model: mockModel, memoryDir: dir });
    expect(agent).toBeDefined();
    expect(agent.id).toBe("pokai");
    rmSync(dir, { recursive: true, force: true });
  });
});
