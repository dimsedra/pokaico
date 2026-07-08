import type { PokaicoDb } from "../db/client";

export type FtsResult = {
  topicId: string;
  content: string;
  rank: number;
  sourcePath: string;
};

export type HybridResult = {
  topicId: string;
  content: string;
  sourcePath: string;
  vectorScore: number;
  ftsScore: number;
  combinedScore: number;
};

export type HybridOptions = {
  limit?: number;
  vectorWeight?: number;
};

export function ftsSearch(db: PokaicoDb, query: string): FtsResult[] {
  try {
    const rows = db
      .prepare(
        `SELECT topic_id, content, source_path, rank
         FROM chunk_fts
         WHERE chunk_fts MATCH ?
         ORDER BY rank
         LIMIT 20`,
      )
      .all(query) as { topic_id: string; content: string; source_path: string; rank: number }[];

    return rows.map((r) => ({
      topicId: r.topic_id,
      content: r.content,
      sourcePath: r.source_path,
      rank: r.rank,
    }));
  } catch {
    return [];
  }
}

export function hybridSearch(
  db: PokaicoDb,
  embedding: Float32Array | Buffer,
  ftsQuery: string,
  options: HybridOptions = {},
): HybridResult[] {
  const limit = options.limit ?? 10;
  const vectorWeight = options.vectorWeight ?? 0.5;

  const ftsWeight = 1 - vectorWeight;
  const seen = new Map<string, HybridResult>();

  // Vector search
  try {
    const vecResults = db
      .prepare(
        `SELECT c.rowid, c.topic_id, c.content, c.source_path, v.distance
         FROM chunk_vec AS v
         JOIN chunk_fts AS c ON c.rowid = v.rowid
         WHERE v.embedding MATCH ?
         ORDER BY v.distance
         LIMIT ?`,
      )
      .all(embedding instanceof Buffer ? embedding : Buffer.from(embedding.buffer), limit * 2) as { rowid: number; topic_id: string; content: string; source_path: string; distance: number }[];

    for (const r of vecResults) {
      const vectorScore = Math.max(0, 1 - r.distance);
      seen.set(`${r.topic_id}::${r.rowid}`, {
        topicId: r.topic_id,
        content: r.content,
        sourcePath: r.source_path,
        vectorScore,
        ftsScore: 0,
        combinedScore: vectorScore * vectorWeight,
      });
    }
  } catch {
    // vec0 search may fail when no data exists yet
  }

  // FTS5 search
  try {
    const ftsResults = db
      .prepare(
        `SELECT rowid, topic_id, content, source_path, rank
         FROM chunk_fts
         WHERE chunk_fts MATCH ?
         ORDER BY rank
         LIMIT ?`,
      )
      .all(ftsQuery, limit * 2) as { rowid: number; topic_id: string; content: string; source_path: string; rank: number }[];

    for (const r of ftsResults) {
      const id = `${r.topic_id}::${r.rowid}`;
      const existing = seen.get(id);
      const ftsScore = 1 / (1 + Math.abs(r.rank));
      if (existing) {
        existing.ftsScore = ftsScore;
        existing.combinedScore = existing.vectorScore * vectorWeight + ftsScore * ftsWeight;
      } else {
        seen.set(id, {
          topicId: r.topic_id,
          content: r.content,
          sourcePath: r.source_path,
          vectorScore: 0,
          ftsScore,
          combinedScore: ftsScore * ftsWeight,
        });
      }
    }
  } catch {
    // FTS5 may fail when no data exists
  }

  return Array.from(seen.values())
    .sort((a, b) => b.combinedScore - a.combinedScore)
    .slice(0, limit);
}
