import type { PokaicoDb } from "../db/client";

export type FtsResult = {
  topicId: string;
  content: string;
  rank: number;
  sourcePath: string;
};

// FTS5 has its own query language: ", *, :, (, ), -, AND/OR/NOT/NEAR are
// syntax, not literals. A raw user query containing them makes FTS5 throw,
// which our caller used to swallow into `[]` — silently killing the keyword
// branch (issue #1, point 2). This builder strips that syntax, drops the
// boolean operators, and quotes each remaining token so FTS5 just searches
// the words normally.
//
// Tokenization is aligned with FTS5's default `unicode61` tokenizer: it
// keeps ALL Unicode letters/numbers (so CJK / non-Latin queries still match
// indexed content) and strips diacritics (é -> e), exactly as content was
// indexed. Skipping this alignment would silently drop recall for accented or
// non-ASCII text. Post-condition: returns "" for blank input, otherwise a
// string of whitespace-joined `"token"` phrases (no raw FTS5 syntax leaks).
const FTS_OPERATORS = new Set(["AND", "OR", "NOT", "NEAR"]);

export function buildFtsQuery(raw: string): string {
  if (!raw || !raw.trim()) return "";
  const tokens = raw
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "") // strip combining diacritics (unicode61 does this)
    .replace(/[^\p{L}\p{N}\s]/gu, " ") // keep letters/numbers, drop FTS5 syntax
    .split(/\s+/)
    .map((t) => t.trim())
    .filter((t) => t.length > 0 && !FTS_OPERATORS.has(t.toUpperCase()));
  const quoted = tokens.map((t) => `"${t}"`);
  return quoted.join(" ");
}

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

export function purgeTopicChunks(db: PokaicoDb, topicId: string): void {
  const rows = db
    .prepare("SELECT rowid FROM chunk_fts WHERE topic_id = ?")
    .all(topicId) as { rowid: number }[];
  if (rows.length === 0) return;

  const purge = db.transaction(() => {
    for (const r of rows) {
      db.prepare("DELETE FROM chunk_vec WHERE rowid = ?").run(r.rowid);
    }
    db.prepare("DELETE FROM chunk_fts WHERE topic_id = ?").run(topicId);
  });
  purge();
}

export function ftsSearch(db: PokaicoDb, query: string): FtsResult[] {
  const q = buildFtsQuery(query);
  if (!q) return [];
  try {
    const rows = db
      .prepare(
        `SELECT topic_id, content, source_path, rank
         FROM chunk_fts
         WHERE chunk_fts MATCH ?
         ORDER BY rank
         LIMIT 20`,
      )
      .all(q) as { topic_id: string; content: string; source_path: string; rank: number }[];

    return rows.map((r) => ({
      topicId: r.topic_id,
      content: r.content,
      sourcePath: r.source_path,
      rank: r.rank,
    }));
  } catch (err) {
    console.error("[pokaico] ftsSearch failed:", err);
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
  const ftsQ = buildFtsQuery(ftsQuery);
  if (ftsQ) {
    try {
      const ftsResults = db
        .prepare(
          `SELECT rowid, topic_id, content, source_path, rank
           FROM chunk_fts
           WHERE chunk_fts MATCH ?
           ORDER BY rank
           LIMIT ?`,
        )
        .all(ftsQ, limit * 2) as { rowid: number; topic_id: string; content: string; source_path: string; rank: number }[];

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
    } catch (err) {
      console.error("[pokaico] ftsSearch (hybrid) failed:", err);
    }
  }

  return Array.from(seen.values())
    .sort((a, b) => b.combinedScore - a.combinedScore)
    .slice(0, limit);
}
