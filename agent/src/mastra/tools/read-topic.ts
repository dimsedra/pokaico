import { createTool } from "@mastra/core/tools";
import { z } from "zod";
import { readTopic, VALID_TOPIC_RE } from "../../memory/topics";

export const createReadTopicTool = (memoryDir: string) =>
  createTool({
    id: "read_topic",
    description: "Read the full CONTEXT.md for a topic by its slug. Returns the current stored context.",
    inputSchema: z.object({
      topicId: z.string().regex(VALID_TOPIC_RE).describe("Topic slug, e.g. 'cycling-commute' or 'user-profile'"),
    }),
    execute: async ({ topicId }, _ctx) => {
      const content = readTopic(memoryDir, topicId);
      return {
        content: content ?? null,
        exists: content !== null,
      };
    },
  });
