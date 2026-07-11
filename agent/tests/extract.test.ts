import { describe, it, expect, vi } from "vitest";
import { extractTopics, FALLBACK_MATCH_THRESHOLD } from "../src/memory/extract";
import type { TopicMeta } from "../src/memory/topics";

describe("extractTopics", () => {
  const summary = {
    summary: "User loves hiking in mountains.",
    keyPoints: ["Hiking is a hobby"],
    topics: [
      { title: "hiking hobby", summary: "User loves hiking in mountains.", keyPoints: ["Hiking is a hobby"] },
    ],
  };

  const multiSummary = {
    summary: "User got promoted and cycles to work.",
    keyPoints: ["Promoted at work", "Cycles 15km daily"],
    topics: [
      { title: "job promotion", summary: "User promoted at work.", keyPoints: ["Got promoted to senior engineer"] },
      { title: "cycling commute", summary: "User cycles 15km each way to work.", keyPoints: ["Cycles 15km", "Saves money"] },
    ],
  };

  it("returns create action when no similar topics exist", async () => {
    const searchSimilar = vi.fn().mockResolvedValue([]);

    const result = await extractTopics(summary, [], searchSimilar);
    expect(result).toHaveLength(1);
    expect(result[0].action).toBe("create");
    expect(result[0].topicId).toBeTruthy();
  });

  it("returns merge action when similar topic found above threshold", async () => {
    const searchSimilar = vi.fn().mockResolvedValue([
      { topicId: "hobbies", score: 0.92, content: "Previous hobby info", sourcePath: "" },
    ]);

    const existingTopics: TopicMeta[] = [
      { topicId: "hobbies", summary: "User hobbies", isFoundational: false, updatedAt: 100 },
    ];

    const result = await extractTopics(summary, existingTopics, searchSimilar);
    expect(result[0].action).toBe("update");
    expect(result[0].topicId).toBe("hobbies");
  });

  it("skips topics below similarity threshold", async () => {
    const searchSimilar = vi.fn().mockResolvedValue([
      { topicId: "work", score: 0.3, content: "Work stuff", sourcePath: "" },
      { topicId: "hobbies", score: 0.88, content: "Hobby stuff", sourcePath: "" },
    ]);

    const existingTopics: TopicMeta[] = [
      { topicId: "work", summary: "", isFoundational: false, updatedAt: 0 },
      { topicId: "hobbies", summary: "", isFoundational: false, updatedAt: 0 },
      { topicId: "health", summary: "", isFoundational: false, updatedAt: 0 },
    ];

    const result = await extractTopics(summary, existingTopics, searchSimilar);
    const updates = result.filter((c) => c.action === "update");
    expect(updates).toHaveLength(1);
    expect(updates[0].topicId).toBe("hobbies");
  });

  it("excludes foundational topics from similarity search", async () => {
    const searchSimilar = vi.fn().mockResolvedValue([
      { topicId: "hobbies", score: 0.9, content: "Hobby stuff", sourcePath: "" },
    ]);

    const existingTopics: TopicMeta[] = [
      { topicId: "user-profile", summary: "", isFoundational: true, updatedAt: 0 },
      { topicId: "hobbies", summary: "", isFoundational: false, updatedAt: 0 },
    ];

    const result = await extractTopics(summary, existingTopics, searchSimilar);
    const creates = result.filter((c) => c.action === "create");
    const updates = result.filter((c) => c.action === "update");
    expect(updates[0].topicId).toBe("hobbies");
    expect(creates).toHaveLength(0);
  });

  it("generates unique slug when collision exists", async () => {
    const searchSimilar = vi.fn().mockResolvedValue([]);
    const existingTopics: TopicMeta[] = [
      { topicId: "hiking-is-a-hobby", summary: "", isFoundational: false, updatedAt: 0 },
    ];
    const summary2 = {
      summary: "Hiking is fun",
      keyPoints: ["Hiking is a hobby"],
      topics: [
        { title: "hiking", summary: "Hiking is fun", keyPoints: ["Hiking is a hobby"] },
      ],
    };

    const result = await extractTopics(summary2, existingTopics, searchSimilar);
    expect(result[0].action).toBe("create");
    expect(result[0].topicId).toBe("hiking");
  });

  // Multi-topic tests
  it("creates multiple topics from multi-segment summary", async () => {
    const searchSimilar = vi.fn().mockResolvedValue([]);

    const result = await extractTopics(multiSummary, [], searchSimilar);
    expect(result).toHaveLength(2);
    expect(result[0].action).toBe("create");
    expect(result[1].action).toBe("create");
    expect(result[0].topicId).toContain("job");
    expect(result[1].topicId).toContain("cycl");
  });

  it("produces mix of create and update for multi-segment", async () => {
    const searchSimilar = vi.fn();
    searchSimilar.mockResolvedValueOnce([]); // "job promotion" → no match
    searchSimilar.mockResolvedValueOnce([
      { topicId: "cycling", score: 0.92, content: "Cycling stuff", sourcePath: "" },
    ]); // "cycling commute" → match

    const existingTopics: TopicMeta[] = [
      { topicId: "cycling", summary: "Cycling hobby", isFoundational: false, updatedAt: 100 },
    ];

    const result = await extractTopics(multiSummary, existingTopics, searchSimilar);
    const creates = result.filter((c) => c.action === "create");
    const updates = result.filter((c) => c.action === "update");

    expect(creates).toHaveLength(1);
    expect(creates[0].topicId).toContain("job");
    expect(updates).toHaveLength(1);
    expect(updates[0].topicId).toBe("cycling");
    // The update carries the embedding ranker's score (hybrid combined), not a stale null.
    expect(updates[0].similarityScore).toBe(0.92);
  });

  it("dedupes when two segments match the same existing topic", async () => {
    const searchSimilar = vi.fn();
    searchSimilar.mockResolvedValueOnce([
      { topicId: "life-events", score: 0.9, content: "Promotion stuff", sourcePath: "" },
    ]);
    searchSimilar.mockResolvedValueOnce([
      { topicId: "life-events", score: 0.9, content: "Cycling stuff", sourcePath: "" },
    ]);

    const existingTopics: TopicMeta[] = [
      { topicId: "life-events", summary: "Things happening in life", isFoundational: false, updatedAt: 200 },
    ];

    const result = await extractTopics(multiSummary, existingTopics, searchSimilar);
    expect(result).toHaveLength(1);
    expect(result[0].action).toBe("update");
    expect(result[0].topicId).toBe("life-events");
  });

  it("handles batch slug collision between new topics", async () => {
    const searchSimilar = vi.fn().mockResolvedValue([]);

    const sameTitleSummaries = {
      summary: "Two topics about cooking",
      keyPoints: ["Cooking pasta", "Cooking rice"],
      topics: [
        { title: "cooking", summary: "Making pasta.", keyPoints: ["Pasta"] },
        { title: "cooking", summary: "Making rice.", keyPoints: ["Rice"] },
      ],
    };

    const result = await extractTopics(sameTitleSummaries, [], searchSimilar);
    expect(result).toHaveLength(2);
    const ids = result.map((c) => c.topicId);
    expect(new Set(ids).size).toBe(2); // should be unique
    expect(ids[0]).toBe("cooking");
    expect(ids[1]).toMatch(/cooking-\d+/);
  });

  it("falls back to old behavior when topics array is empty", async () => {
    const searchSimilar = vi.fn().mockResolvedValue([]);
    const oldStyle = { summary: "Just hiking.", keyPoints: ["hiking"], topics: [] };

    const result = await extractTopics(oldStyle, [], searchSimilar);
    expect(result).toHaveLength(1);
    expect(result[0].action).toBe("create");
  });

  // --- Issue #4: deterministic pre-check against INDEX.md slug set ---

  it("updates existing topic when title slug matches an INDEX topic (skips embedding)", async () => {
    const searchSimilar = vi.fn().mockResolvedValue([]);
    const indexSlugs = new Set(["hiking-hobby"]);

    const result = await extractTopics(summary, [], searchSimilar, indexSlugs);
    expect(result).toHaveLength(1);
    expect(result[0].action).toBe("update");
    expect(result[0].topicId).toBe("hiking-hobby");
    expect(searchSimilar).not.toHaveBeenCalled();
  });

  it("creates a new topic when title slug is absent from INDEX", async () => {
    const searchSimilar = vi.fn().mockResolvedValue([]);
    const indexSlugs = new Set(["other-topic"]);

    const result = await extractTopics(summary, [], searchSimilar, indexSlugs);
    expect(result[0].action).toBe("create");
    expect(result[0].topicId).toBe("hiking-hobby");
  });

  it("falls back to DB slug set when no INDEX slugs provided", async () => {
    const searchSimilar = vi.fn().mockResolvedValue([]);
    const existingTopics: TopicMeta[] = [
      { topicId: "hiking-hobby", summary: "", isFoundational: false, updatedAt: 0 },
    ];

    const result = await extractTopics(summary, existingTopics, searchSimilar);
    expect(result).toHaveLength(1);
    expect(result[0].action).toBe("update");
    expect(result[0].topicId).toBe("hiking-hobby");
    expect(searchSimilar).not.toHaveBeenCalled();
  });

  it("updates deterministically in the single-segment (old-style) path", async () => {
    const searchSimilar = vi.fn().mockResolvedValue([]);
    const oldStyle = {
      summary: "Bike purchase details",
      keyPoints: ["hiking-hobby"], // used as the single-segment title
      topics: [],
    };
    const indexSlugs = new Set(["hiking-hobby"]);

    const result = await extractTopics(oldStyle, [], searchSimilar, indexSlugs);
    expect(result).toHaveLength(1);
    expect(result[0].action).toBe("update");
    expect(result[0].topicId).toBe("hiking-hobby");
    expect(result[0].similarityScore).toBe(1);
    expect(searchSimilar).not.toHaveBeenCalled();
  });

  it("INDEX slug wins over a conflicting high-score embedding match (primacy)", async () => {
    const searchSimilar = vi.fn().mockResolvedValue([
      { topicId: "unrelated", score: 0.95, content: "Different topic", sourcePath: "" },
    ]);
    const indexSlugs = new Set(["hiking-hobby"]);

    const result = await extractTopics(summary, [], searchSimilar, indexSlugs);
    expect(result[0].action).toBe("update");
    expect(result[0].topicId).toBe("hiking-hobby");
    expect(searchSimilar).not.toHaveBeenCalled();
  });

  it("routes to a collision-suffixed sibling instead of duplicating", async () => {
    const searchSimilar = vi.fn().mockResolvedValue([]);
    // The existing topic was created as "bike-purchase-1" via collision avoidance.
    const indexSlugs = new Set(["bike-purchase-1"]);
    const bikeSummary = {
      summary: "User bought a new bike.",
      keyPoints: ["Bike purchase"],
      topics: [
        { title: "Bike Purchase", summary: "User bought a new bike.", keyPoints: ["New bike"] },
      ],
    };

    const result = await extractTopics(bikeSummary, [], searchSimilar, indexSlugs);
    expect(result[0].action).toBe("update");
    expect(result[0].topicId).toBe("bike-purchase-1");
    expect(searchSimilar).not.toHaveBeenCalled();
  });

  it("never updates a foundational slug even if present in indexSlugs", async () => {
    const searchSimilar = vi.fn().mockResolvedValue([]);
    const indexSlugs = new Set(["user-profile"]);
    const existingTopics: TopicMeta[] = [
      { topicId: "user-profile", summary: "", isFoundational: true, updatedAt: 0 },
    ];

    const result = await extractTopics(summary, existingTopics, searchSimilar, indexSlugs);
    expect(result[0].action).toBe("create");
    expect(result[0].topicId).not.toBe("user-profile");
  });

  it("uses the embedding fallback score in the single-segment path", async () => {
    const searchSimilar = vi.fn().mockResolvedValue([
      { topicId: "hobbies", score: 0.88, content: "Hobby stuff", sourcePath: "" },
    ]);
    const oldStyle = { summary: "I love jazz.", keyPoints: ["jazz"], topics: [] };
    const existingTopics: TopicMeta[] = [
      { topicId: "hobbies", summary: "Hobbies", isFoundational: false, updatedAt: 0 },
    ];

    const result = await extractTopics(oldStyle, existingTopics, searchSimilar);
    expect(result[0].action).toBe("update");
    expect(result[0].topicId).toBe("hobbies");
    expect(result[0].similarityScore).toBe(0.88);
  });

  it("exposes FALLBACK_MATCH_THRESHOLD (0.35) as the secondary/fallback gate", () => {
    expect(FALLBACK_MATCH_THRESHOLD).toBe(0.35);
  });
});

describe("extractTopics deterministic guards (issue #4)", () => {
  // A 60-char slug, simulating a previously-created long topic whose title was
  // truncated by slugify.
  const longSlug = "a".repeat(60);

  it("does NOT deterministically update a >60-char title even if its slug collides", async () => {
    const searchSimilar = vi.fn().mockResolvedValue([]);
    const indexSlugs = new Set([longSlug]);
    // Title > 60 chars whose slugify result equals longSlug (collision). Without
    // the >60 guard this would be a deterministic UPDATE; with it, it falls
    // through to the embedding fallback instead.
    const summary = {
      summary: "long",
      keyPoints: ["long"],
      topics: [{ title: `${longSlug} second`, summary: "long", keyPoints: ["long"] }],
    };

    const result = await extractTopics(summary, [], searchSimilar, indexSlugs);

    expect(result[0].action).toBe("create");
    expect(searchSimilar).toHaveBeenCalled();
  });

  it("does NOT deterministically update when multiple ambiguous siblings exist", async () => {
    const searchSimilar = vi.fn().mockResolvedValue([]);
    const indexSlugs = new Set(["bike-purchase-1", "bike-purchase-2"]);
    const summary = {
      summary: "bike",
      keyPoints: ["bike"],
      topics: [{ title: "Bike Purchase", summary: "bike", keyPoints: ["bike"] }],
    };

    const result = await extractTopics(summary, [], searchSimilar, indexSlugs);

    expect(result[0].action).toBe("create");
    expect(result[0].topicId).not.toBe("bike-purchase-1");
    expect(result[0].topicId).not.toBe("bike-purchase-2");
    expect(searchSimilar).toHaveBeenCalled();
  });
});

describe("extractTopics relatedTo (issue #8 — LLM-judged cross-topic edges)", () => {
  it("resolves relatedTo segment indices to bidirectional TopicChange.edges with reason", async () => {
    const searchSimilar = vi.fn().mockResolvedValue([]);
    const summary = {
      summary: "User cycles and hikes.",
      keyPoints: ["cycling", "hiking"],
      topics: [
        { title: "cycling commute", summary: "Cycling to work.", keyPoints: [], relatedTo: [{ topicIndex: 1, reason: "User often compares trail conditions" }] },
        { title: "hiking trails", summary: "Hiking on weekends.", keyPoints: [], relatedTo: [{ topicIndex: 0, reason: "User often compares trail conditions" }] },
      ],
    };

    const result = await extractTopics(summary, [], searchSimilar);

    expect(result).toHaveLength(2);

    const cycling = result.find((c) => c.topicId.includes("cycl"))!;
    const hiking = result.find((c) => c.topicId.includes("hik"))!;

    expect(cycling).toBeDefined();
    expect(hiking).toBeDefined();

    expect(cycling.edges).toBeDefined();
    expect(cycling.edges!.some((e) => e.toTopic === hiking.topicId && e.reason === "User often compares trail conditions")).toBe(true);

    expect(hiking.edges).toBeDefined();
    expect(hiking.edges!.some((e) => e.toTopic === cycling.topicId && e.reason === "User often compares trail conditions")).toBe(true);
  });

  it("skips out-of-range topicIndex gracefully", async () => {
    const searchSimilar = vi.fn().mockResolvedValue([]);
    const summary = {
      summary: "Single topic.",
      keyPoints: ["work"],
      topics: [
        { title: "work stress", summary: "Stressful week.", keyPoints: [], relatedTo: [{ topicIndex: 5, reason: "nonexistent" }] },
      ],
    };

    const result = await extractTopics(summary, [], searchSimilar);

    expect(result).toHaveLength(1);
    expect(result[0].edges).toBeUndefined();
  });

  it("skips self-referencing topicIndex", async () => {
    const searchSimilar = vi.fn().mockResolvedValue([]);
    const summary = {
      summary: "One topic.",
      keyPoints: ["alone"],
      topics: [
        { title: "solo topic", summary: "Just me.", keyPoints: [], relatedTo: [{ topicIndex: 0, reason: "self" }] },
      ],
    };

    const result = await extractTopics(summary, [], searchSimilar);

    expect(result).toHaveLength(1);
    expect(result[0].edges).toBeUndefined();
  });
});
