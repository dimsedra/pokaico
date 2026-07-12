import { createTool } from "@mastra/core/tools";
import { z } from "zod";
import { listTopics } from "../../memory/topics";
import { FOUNDATIONAL_TOPIC_IDS } from "../../memory/pipeline";

export const createListTopicsTool = (memoryDir: string) =>
  createTool({
    id: "list_topics",
    description: "List all topics with optional filter. Returns topic IDs, summaries, and foundational status.",
    inputSchema: z.object({
      filter: z.enum(["foundational", "all"]).optional().describe("Filter by topic type"),
    }),
    execute: async ({ filter }, _ctx) => {
      const allTopics = listTopics(memoryDir);
      const topics = allTopics.map((t) => ({
        topicId: t.topicId,
        summary: t.summary,
        isFoundational: FOUNDATIONAL_TOPIC_IDS.includes(t.topicId),
      }));

      if (filter === "foundational") {
        return { topics: topics.filter((t) => t.isFoundational) };
      }

      return { topics };
    },
  });
