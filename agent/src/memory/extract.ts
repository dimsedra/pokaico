import type { SummaryOutput, TopicChange } from "./types";
import type { TopicMeta } from "./topics";

const SIMILARITY_THRESHOLD = 0.85;

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

  // Resolve collisions
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

export async function extractTopics(
  summary: SummaryOutput,
  existingTopics: TopicMeta[],
  searchSimilar: (query: string, limit?: number) => Promise<SearchResult[]>,
): Promise<TopicChange[]> {
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

  // Create new topic — guard against slug collision
  const existingSlugs = new Set(existingTopics.map((t) => t.topicId));
  const topicId = slugify(summary.keyPoints[0] || summary.summary, existingSlugs);
  const points = summary.keyPoints.filter((k) => k.length > 0);
  const pointsSection = points.length > 0
    ? `\n\nKey points:\n${points.map((k) => `- ${k}`).join("\n")}`
    : "";
  return [
    {
      topicId,
      action: "create",
      content: `${summary.summary}${pointsSection}`,
    },
  ];
}