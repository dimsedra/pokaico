import type { SummaryOutput, TopicChange } from "./types";
import type { TopicMeta } from "./topics";

// Secondary (fallback) gate for the embedding/FTS match. Since Langkah 4/2
// made INDEX.md the PRIMARY, deterministic router, embedding is no longer the
// sole decider — this threshold only gates the *fallback* update path when
// INDEX yields no lexical hit (issue #1, poin 3: demoted from primary).
export const EMBEDDING_MATCH_THRESHOLD = 0.35;

type SearchResult = {
  topicId: string;
  score: number;
  content: string;
  sourcePath: string;
};

function slugify(text: string, existingSlugs?: Set<string>): string {
  let slug = text
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "")
    .slice(0, 60);

  if (!slug) slug = "topic";

  if (existingSlugs && existingSlugs.has(slug)) {
    let counter = 1;
    while (existingSlugs.has(`${slug}-${counter}`)) {
      counter++;
    }
    slug = `${slug}-${counter}`;
  }

  return slug;
}

function pickExistingTopic(
  searchResults: SearchResult[],
  existingTopics: TopicMeta[],
): { topicId: string; score: number } | null {
  const nonFoundational = new Set(
    existingTopics.filter((t) => !t.isFoundational).map((t) => t.topicId),
  );

  for (const r of searchResults) {
    if (r.score >= EMBEDDING_MATCH_THRESHOLD && nonFoundational.has(r.topicId)) {
      return { topicId: r.topicId, score: r.score };
    }
  }

  return null;
}

function buildContent(segment: { summary: string; keyPoints: string[] }): string {
  const points = segment.keyPoints.filter((k) => k.length > 0);
  const pointsSection = points.length > 0
    ? `\n\nKey points:\n${points.map((k) => `- ${k}`).join("\n")}`
    : "";
  return `${segment.summary}${pointsSection}`;
}

export async function extractTopics(
  summary: SummaryOutput,
  existingTopics: TopicMeta[],
  searchSimilar: (query: string, limit?: number) => Promise<SearchResult[]>,
  indexSlugs?: Set<string>,
): Promise<TopicChange[]> {
  // Deterministic authority (issue #4): prefer the canonical routing map
  // (INDEX.md) so we UPDATE an existing slug instead of duplicating it. Fall
  // back to the DB-backed non-foundational slug set when INDEX.md is absent.
  // Self-guard: never treat a foundational slug as an extraction update target
  // (those are owned by refreshFoundational) — even if the caller forgot to
  // filter it out of `indexSlugs`.
  const foundational = new Set(
    existingTopics.filter((t) => t.isFoundational).map((t) => t.topicId),
  );
  const dbNonFoundational = new Set(
    existingTopics.filter((t) => !t.isFoundational).map((t) => t.topicId),
  );
  const deterministicSlugs = new Set(
    (indexSlugs && indexSlugs.size > 0 ? indexSlugs : dbNonFoundational).values(),
  );
  for (const id of foundational) deterministicSlugs.delete(id);

  // Resolve a segment title to an existing topic slug deterministically.
  // Returns the matched topicId to UPDATE, or null to fall back to embedding.
  //  - Exact match on the canonical slug → UPDATE (primary, deterministic).
  //  - Single collision-suffixed sibling (e.g. "bike-purchase" → "bike-purchase-1")
  //    → UPDATE that sibling (otherwise the next run would duplicate it).
  //  - Titles longer than 60 chars are truncated by slugify, so two distinct
  //    long titles can collapse to the same slug; for those we DON'T trust the
  //    deterministic match and let the embedding ranker decide instead.
  //  - Multiple ambiguous siblings → fall back to embedding (don't guess).
  function resolveDeterministic(title: string): string | null {
    const baseSlug = slugify(title);
    if (title.length > 60) return null;
    if (deterministicSlugs.has(baseSlug)) return baseSlug;
    // Single collision-suffixed sibling (e.g. "bike-purchase" → "bike-purchase-1"),
    // identified strictly: the id must be exactly `baseSlug-N` with N numeric. A
    // topic like "hiking-is-a-hobby" is NOT a sibling of "hiking".
    const siblings = [...deterministicSlugs].filter((id) => {
      const i = id.lastIndexOf("-");
      return i > 0 && id.slice(0, i) === baseSlug && /^\d+$/.test(id.slice(i + 1));
    });
    return siblings.length === 1 ? siblings[0] : null;
  }

  const segments = Array.isArray(summary.topics) && summary.topics.length > 0
    ? summary.topics
    : null;

  if (!segments) {
    const title = summary.keyPoints[0] || summary.summary;
    const match = resolveDeterministic(title);
    if (match) {
      // Deterministic hit → UPDATE (no embedding call). similarityScore: 1
      // marks an INDEX/deterministic match, symmetric with the multi-segment path.
      return [{ topicId: match, action: "update", content: summary.summary, similarityScore: 1 }];
    }

    // Fall back to old single-segment behavior
    const results = await searchSimilar(summary.summary, 5);
    const embMatch = pickExistingTopic(results, existingTopics);

    if (embMatch) {
      return [
        {
          topicId: embMatch.topicId,
          action: "update",
          content: summary.summary,
          similarityScore: match.score,
        },
      ];
    }

    const existingSlugs = new Set(existingTopics.map((t) => t.topicId));
    const topicId = slugify(title, existingSlugs);
    return [
      {
        topicId,
        action: "create",
        content: buildContent(summary),
      },
    ];
  }

  // Multi-segment path
  const existingSlugs = new Set(existingTopics.map((t) => t.topicId));
  const batchSlugs = new Set<string>();
  const matchedTopics = new Map<string, { content: string; score: number }>();
  const newTopics: TopicChange[] = [];

  for (const segment of segments) {
    const title = segment.title ?? segment.summary ?? "";
    const match = resolveDeterministic(title);
    if (match) {
      // Deterministic hit: this segment maps to an existing topic slug → UPDATE.
      if (matchedTopics.has(match)) {
        const prev = matchedTopics.get(match)!;
        matchedTopics.set(match, {
          content: `${prev.content}\n\n${segment.summary}`,
          score: Math.max(prev.score, 1),
        });
      } else {
        matchedTopics.set(match, { content: segment.summary, score: 1 });
      }
      continue;
    }

    const results = await searchSimilar(segment.summary, 5);
    const embMatch = pickExistingTopic(results, existingTopics);

    if (embMatch) {
      if (matchedTopics.has(embMatch.topicId)) {
        const prev = matchedTopics.get(embMatch.topicId)!;
        matchedTopics.set(embMatch.topicId, {
          content: `${prev.content}\n\n${segment.summary}`,
          score: Math.max(prev.score, embMatch.score),
        });
      } else {
        matchedTopics.set(embMatch.topicId, {
          content: segment.summary,
          score: embMatch.score,
        });
      }
    } else {
      const allSlugs = new Set([...existingSlugs, ...batchSlugs]);
      const topicId = slugify(segment.title, allSlugs);
      batchSlugs.add(topicId);

      newTopics.push({
        topicId,
        action: "create",
        content: buildContent(segment),
      });
    }
  }

  const updates: TopicChange[] = [];
  for (const [topicId, { content, score }] of matchedTopics) {
    updates.push({ topicId, action: "update", content, similarityScore: score });
  }

  return [...updates, ...newTopics];
}
