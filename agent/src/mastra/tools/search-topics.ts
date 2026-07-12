import { createTool } from "@mastra/core/tools";
import { z } from "zod";
import { routeTopics, type SearchResult as RouteSearchResult } from "../../memory/retrieval";
import { parseIndex } from "../../memory/topics";
import type { SearchResult } from "../../embeddings/service";

const SNIPPET_CAP = 200;

export type TopicSearcher = {
  searchSimilar: (query: string, limit?: number) => Promise<SearchResult[]>;
};

export const createSearchTopicsTool = (deps: { memoryDir: string; embedding: TopicSearcher }) =>
  createTool({
    id: "search_topics",
    description:
      "Search memory topics by a free-text query. Routes through INDEX.md (lexical match on topic summaries) first; only when nothing matches, falls back to embedding + FTS5 search. Returns up to 5 topic IDs with a short snippet and the route source.",
    inputSchema: z.object({
      query: z.string().min(1).describe("Free-text query, e.g. 'my work schedule'"),
    }),
    execute: async ({ query }, _ctx) => {
      const { memoryDir, embedding } = deps;

      const idxMap = new Map(parseIndex(memoryDir).map((e) => [e.topicId, e.summary]));

      const fbResults: SearchResult[] = await embedding.searchSimilar(query, 20).catch(() => []);
      const fbMap = new Map<string, string>();
      for (const r of fbResults) {
        if (!fbMap.has(r.topicId)) fbMap.set(r.topicId, r.content);
      }

      const ids = await routeTopics(memoryDir, query, {
        searchSimilar: embedding.searchSimilar as (q: string, limit?: number) => Promise<RouteSearchResult[]>,
        limit: 5,
      });

      const results = ids.slice(0, 5).map((topicId) => {
        const inIndex = idxMap.has(topicId);
        const snippet = inIndex
          ? (idxMap.get(topicId) ?? "")
          : (fbMap.get(topicId)?.slice(0, SNIPPET_CAP) ?? "");
        return {
          topicId,
          snippet,
          source: inIndex ? "index" : "embedding",
        };
      });

      return { query, results, found: results.length };
    },
  });
