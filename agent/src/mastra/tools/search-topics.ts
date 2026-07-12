import { createTool } from "@mastra/core/tools";
import { z } from "zod";
import { routeTopics } from "../../memory/retrieval";
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
    outputSchema: z.object({
      query: z.string(),
      results: z.array(
        z.object({
          topicId: z.string(),
          snippet: z.string().max(SNIPPET_CAP),
          source: z.enum(["index", "embedding"]),
        }),
      ),
      found: z.number(),
    }),
    execute: async ({ query }, _ctx) => {
      const { memoryDir, embedding } = deps;

      let idxMap = new Map<string, string>();
      try {
        idxMap = new Map(parseIndex(memoryDir).map((e) => [e.topicId, e.summary]));
      } catch {
        // Unreadable INDEX.md must not crash the tool — degrade to fallback-only.
        idxMap = new Map();
      }

      // Capture the fallback (embedding/FTS) results that routeTopics fetches so we
      // can reuse them for snippet text — without a second embedding call, and
      // without firing the model when INDEX already resolves the query. SPEC §7's
      // economy: INDEX-primary must avoid the expensive call whenever it can route.
      // routeTopics calls searchSimilar ONLY on its miss branch, so `captured` is
      // non-empty iff the fallback actually fired — the reliable route signal.
      let captured: SearchResult[] = [];
      const searchSimilar = async (q: string, limit?: number) => {
        const r = await embedding.searchSimilar(q, limit).catch(() => []);
        captured = r;
        return r;
      };

      const ids = await routeTopics(memoryDir, query, { searchSimilar, limit: 5 }).catch(() => []);

      // Keep the highest-scoring chunk per topic for the snippet.
      const fbMap = new Map<string, { content: string; score: number }>();
      for (const r of captured) {
        const prev = fbMap.get(r.topicId);
        if (!prev || r.score > prev.score) fbMap.set(r.topicId, { content: r.content, score: r.score });
      }

      const viaFallback = captured.length > 0;

      const results = ids.slice(0, 5).map((topicId) => {
        const raw = viaFallback
          ? (fbMap.get(topicId)?.content ?? "")
          : (idxMap.get(topicId) ?? "");
        const snippet = raw.length > SNIPPET_CAP ? raw.slice(0, SNIPPET_CAP) : raw;
        return {
          topicId,
          snippet,
          source: viaFallback ? ("embedding" as const) : ("index" as const),
        };
      });

      return { query, results, found: results.length };
    },
  });
