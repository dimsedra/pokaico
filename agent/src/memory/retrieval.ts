import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { parseIndex } from "./topics";

export type RouteHit = {
  topicId: string;
  score: number;
  source: "index" | "embedding";
};

type SearchResult = {
  topicId: string;
  score: number;
  content: string;
  sourcePath: string;
};

function tokenize(text: string): Set<string> {
  return new Set(
    text
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, " ")
      .split(" ")
      .filter(Boolean),
  );
}

// Deterministic lexical score (Jaccard overlap) between the query and an INDEX
// entry. Pure, LLM/embedding-free — this is what makes INDEX the PRIMARY router.
function lexicalScore(queryTokens: Set<string>, text: string): number {
  if (queryTokens.size === 0) return 0;
  const entryTokens = tokenize(text);
  if (entryTokens.size === 0) return 0;
  let overlap = 0;
  for (const t of queryTokens) if (entryTokens.has(t)) overlap++;
  if (overlap === 0) return 0;
  return overlap / (queryTokens.size + entryTokens.size - overlap);
}

/**
 * Route a query to the relevant topics using INDEX.md as the PRIMARY, deterministic
 * router (issue #2). Lexical (token-overlap) matching against the canonical
 * routing map picks candidate topics with no embedding/LLM call. If a
 * `searchSimilar` (embedding/FTS) function is supplied it runs as a SECONDARY
 * ranker whose hits are appended *after* the INDEX-primary hits, so an INDEX
 * match always wins a conflict. When INDEX.md is absent we fall back entirely to
 * `searchSimilar` and never throw.
 */
export async function routeTopics(
  memoryDir: string,
  query: string,
  opts?: {
    searchSimilar?: (q: string, limit?: number) => Promise<SearchResult[]>;
    limit?: number;
  },
): Promise<string[]> {
  const queryTokens = tokenize(query);
  const idx = parseIndex(memoryDir);

  const indexHits: RouteHit[] = [];
  for (const entry of idx) {
    const score = lexicalScore(queryTokens, `${entry.topicId} ${entry.summary}`);
    if (score > 0) indexHits.push({ topicId: entry.topicId, score, source: "index" });
  }
  indexHits.sort((a, b) => b.score - a.score);

  // PRIMARY: INDEX-matched topics are returned as-is — no embedding call needed.
  // This is the whole point of issue #2: the deterministic routing map
  // replaces the nondeterministic, subprocess-based embedding search as the
  // first resolver, saving the (expensive) model call whenever it can route.
  if (indexHits.length > 0) {
    return indexHits.map((h) => h.topicId);
  }

  // FALLBACK (secondary): only when INDEX yields nothing do we spend the
  // embedding/FTS search. Guarded so a misbehaving searchSimilar can never
  // crash routing.
  if (opts?.searchSimilar) {
    try {
      const secondary = await opts.searchSimilar(query, opts.limit ?? 10);
      if (Array.isArray(secondary)) return secondary.map((r) => r.topicId);
    } catch {
      // swallow — routing returns nothing rather than throw
    }
  }

  return [];
}

/**
 * Convenience loader: concatenate the CONTEXT.md of the top-N routed topics so
 * the agent can inject them as memory context at session start. The router
 * (INDEX-primary) decides *which* topics; this decides *what* to load.
 */
export async function loadRoutedContext(
  memoryDir: string,
  query: string,
  opts?: {
    searchSimilar?: (q: string, limit?: number) => Promise<SearchResult[]>;
    limit?: number;
    topN?: number;
  },
): Promise<string> {
  const ids = await routeTopics(memoryDir, query, opts);
  const top = opts?.topN != null ? ids.slice(0, opts.topN) : ids;

  const parts: string[] = [];
  for (const id of top) {
    const cp = join(memoryDir, "topics", id, "CONTEXT.md");
    if (existsSync(cp)) parts.push(`# ${id}\n${readFileSync(cp, "utf-8")}`);
  }
  return parts.join("\n\n");
}
