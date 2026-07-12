import { Agent } from "@mastra/core/agent";
import type { MastraLanguageModel } from "@mastra/core/llm";
import type { ToolAction } from "@mastra/core/tools";
import { buildPrompt, STATIC_SYSTEM_PROMPT } from "./prompt";

type AgentTools = Record<string, ToolAction>;

export type CreateAgentConfig = {
  model: MastraLanguageModel;
  memoryDir: string;
  tools?: AgentTools;
};

export function createAgent(config: CreateAgentConfig) {
  const { model, memoryDir, tools } = config;

  // Build the dynamic system prompt; fall back to static prompt on any failure.
  const instructions = buildPrompt(memoryDir).catch(() => STATIC_SYSTEM_PROMPT);

  return new Agent({
    id: "pokai",
    name: "Pokai",
    instructions,
    model,
    tools: tools ?? {},
  });
}
