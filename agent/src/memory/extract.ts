import type { SummaryOutput, TopicChange } from "./types";
import type { TopicMeta } from "./topics";

const SIMILARITY_THRESHOLD = 0.35;

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
    if (r.score >= SIMILARITY_THRESHOLD && nonFoundational.has(r.topicId)) {
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
  const dbNonFoundational = new Set(
    existingTopics.filter((t) => !t.isFoundational).map((t) => t.topicId),
  );
  const deterministicSlugs =
    indexSlugs && indexSlugs.size > 0 ? indexSlugs : dbNonFoundational;

  const segments = Array.isArray(summary.topics) && summary.topics.length > 0
    ? summary.topics
    : null;

  if (!segments) {
    const title = summary.keyPoints[0] || summary.summary;
    const baseSlug = slugify(title);
    if (deterministicSlugs.has(baseSlug)) {
      // Exact slug already exists → deterministic UPDATE (no embedding call).
      return [{ topicId: baseSlug, action: "update", content: summary.summary }];
    }

    // Fall back to old single-segment behavior
    const results = await searchSimilar(summary.summary, 5);
    const match = pickExistingTopic(results, existingTopics);

    if (match) {
      return [
        {
          topicId: match.topicId,
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
    const baseSlug = slugify(segment.title);
    if (deterministicSlugs.has(baseSlug)) {
      // Deterministic hit: this segment maps to an existing topic slug → UPDATE.
      if (matchedTopics.has(baseSlug)) {
        const prev = matchedTopics.get(baseSlug)!;
        matchedTopics.set(baseSlug, {
          content: `${prev.content}\n\n${segment.summary}`,
          score: Math.max(prev.score, 1),
        });
      } else {
        matchedTopics.set(baseSlug, { content: segment.summary, score: 1 });
      }
      continue;
    }

    const results = await searchSimilar(segment.summary, 5);
    const match = pickExistingTopic(results, existingTopics);

    if (match) {
      if (matchedTopics.has(match.topicId)) {
        const prev = matchedTopics.get(match.topicId)!;
        matchedTopics.set(match.topicId, {
          content: `${prev.content}\n\n${segment.summary}`,
          score: Math.max(prev.score, match.score),
        });
      } else {
        matchedTopics.set(match.topicId, {
          content: segment.summary,
          score: match.score,
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
