import type { EmbeddingModel } from "./model";
import type { PokaicoDb } from "../db/client";
import { ftsSearch, hybridSearch, type HybridResult } from "./search";

export type SearchResult = {
  topicId: string;
  score: number;
  content: string;
  sourcePath: string;
};

export function createEmbeddingService(model: EmbeddingModel, db: PokaicoDb) {
  async function embedQuery(text: string): Promise<Float32Array> {
    return model.embed(text);
  }

  async function indexTopic(topicId: string, content: string): Promise<void> {
    try {
      const lastRow = db
        .prepare("SELECT MAX(rowid) as max_id FROM chunk_fts")
        .get() as { max_id: number | null };
      const nextId = (lastRow?.max_id ?? 0) + 1;
      const sourcePath = `memory/topics/${topicId}/CONTEXT.md`;

      db.prepare(
        "INSERT INTO chunk_fts(rowid, content, topic_id, source_path) VALUES (?, ?, ?, ?)",
      ).run(nextId, content, topicId, sourcePath);
    } catch {
      // index silently if table doesn't exist yet
    }
  }

  async function searchSimilar(query: string, limit: number = 10): Promise<SearchResult[]> {
    try {
      const embedding = await model.embed(query);
      const results = hybridSearch(db, embedding, query, { limit, vectorWeight: 0.5 });

      return results.map((r) => ({
        topicId: r.topicId,
        score: r.combinedScore,
        content: r.content,
        sourcePath: r.sourcePath,
      }));
    } catch {
      // Fallback to FTS-only search
      const ftsResults = ftsSearch(db, query);
      return ftsResults.map((r) => ({
        topicId: r.topicId,
        score: r.rank > 0 ? 1 / (1 + r.rank) : 1,
        content: r.content,
        sourcePath: r.sourcePath,
      }));
    }
  }

  return { embedQuery, indexTopic, searchSimilar };
}
