import { createTool } from "@mastra/core/tools";
import { z } from "zod";
import { readTopic } from "../../memory/topics";

export const createReadTopicTool = (memoryDir: string) =>
  createTool({
    id: "read_topic",
    description: "Read the full CONTEXT.md for a topic by its slug. Returns the current stored context.",
    inputSchema: z.object({
      topicId: z.string().describe("Topic slug, e.g. 'cycling-commute' or 'user-profile'"),
    }),
    execute: async ({ topicId }) => {
      const content = readTopic(memoryDir, topicId);
      return {
        content: content ?? "(topic not found)",
        exists: content !== null,
      };
    },
  });
