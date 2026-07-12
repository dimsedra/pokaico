import { describe, it, expect } from "vitest";
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { createSearchTopicsTool } from "../../src/mastra/tools/search-topics";
import type { SearchResult } from "../../src/embeddings/service";

// Fake embedding service: returns canned chunks without touching any model/subprocess.
function fakeEmbedding(results: SearchResult[]) {
  return {
    searchSimilar: async (_q: string, _limit?: number) => results,
  };
}

// Spy embedding: counts calls and (optionally) throws, to prove economy + resilience.
function spyEmbedding(opts: { results?: SearchResult[]; throws?: boolean } = {}) {
  const calls: string[] = [];
  const impl = async (q: string, _limit?: number): Promise<SearchResult[]> => {
    calls.push(q);
    if (opts.throws) throw new Error("embedding boom");
    return opts.results ?? [];
  };
  return { searchSimilar: impl, calls };
}

describe("search_topics tool", () => {
  it("uses INDEX-primary route and returns summary as snippet", async () => {
    const dir = mkdtempSync(join(tmpdir(), "search-index-"));
    const topicsDir = join(dir, "topics");
    mkdirSync(topicsDir, { recursive: true });
    writeFileSync(join(topicsDir, "work-schedule"), "", "utf-8");
    writeFileSync(
      join(dir, "INDEX.md"),
      "# Memory Index\n\n- **work-schedule**: the user's weekly work schedule and shifts\n",
      "utf-8",
    );

    const tool = createSearchTopicsTool({ memoryDir: dir, embedding: fakeEmbedding([]) });
    const result = await tool.execute({ query: "my work schedule" });

    expect(result.found).toBe(1);
    expect(result.results[0].topicId).toBe("work-schedule");
    expect(result.results[0].source).toBe("index");
    expect(result.results[0].snippet).toContain("weekly work schedule");
    rmSync(dir, { recursive: true, force: true });
  });

  it("falls back to embedding search when no INDEX match", async () => {
    const dir = mkdtempSync(join(tmpdir(), "search-fallback-"));
    const topicsDir = join(dir, "topics");
    mkdirSync(topicsDir, { recursive: true });
    writeFileSync(join(topicsDir, "travel"), "", "utf-8");

    const fb: SearchResult[] = [
      {
        topicId: "travel",
        content: "User enjoys solo mountain treks and plans trips to remote cabins.",
        score: 0.91,
        sourcePath: "memory/topics/travel/CONTEXT.md",
      },
    ];
    const tool = createSearchTopicsTool({ memoryDir: dir, embedding: fakeEmbedding(fb) });
    const result = await tool.execute({ query: "where do I like to travel" });

    expect(result.found).toBe(1);
    expect(result.results[0].topicId).toBe("travel");
    expect(result.results[0].source).toBe("embedding");
    expect(result.results[0].snippet).toContain("solo mountain treks");
    rmSync(dir, { recursive: true, force: true });
  });

  it("returns found=0 when no hits anywhere", async () => {
    const dir = mkdtempSync(join(tmpdir(), "search-empty-"));
    mkdirSync(join(dir, "topics"), { recursive: true });

    const tool = createSearchTopicsTool({ memoryDir: dir, embedding: fakeEmbedding([]) });
    const result = await tool.execute({ query: "nonexistent topic xyz" });

    expect(result.found).toBe(0);
    expect(result.results).toEqual([]);
    rmSync(dir, { recursive: true, force: true });
  });

  it("caps results to top 5", async () => {
    const dir = mkdtempSync(join(tmpdir(), "search-limit-"));
    const topicsDir = join(dir, "topics");
    mkdirSync(topicsDir, { recursive: true });
    const lines = ["alpha", "beta", "gamma", "delta", "epsilon", "zeta"].map(
      (id) => `- **${id}**: some summary about ${id}`,
    );
    for (const id of ["alpha", "beta", "gamma", "delta", "epsilon", "zeta"]) {
      writeFileSync(join(topicsDir, id), "", "utf-8");
    }
    writeFileSync(join(dir, "INDEX.md"), `# Memory Index\n\n${lines.join("\n")}\n`, "utf-8");

    const tool = createSearchTopicsTool({ memoryDir: dir, embedding: fakeEmbedding([]) });
    const result = await tool.execute({ query: "summary" });

    expect(result.found).toBe(5);
    expect(result.results.map((r) => r.topicId).sort()).toEqual(
      ["alpha", "beta", "delta", "epsilon", "gamma"],
    );
    rmSync(dir, { recursive: true, force: true });
  });

  it("caps snippet length to 200 characters", async () => {
    const dir = mkdtempSync(join(tmpdir(), "search-snippet-"));
    const topicsDir = join(dir, "topics");
    mkdirSync(topicsDir, { recursive: true });
    writeFileSync(join(topicsDir, "travel"), "", "utf-8");

    const longChunk = "word ".repeat(100); // 500 chars
    const fb: SearchResult[] = [
      { topicId: "travel", content: longChunk, score: 0.8, sourcePath: "memory/topics/travel/CONTEXT.md" },
    ];
    const tool = createSearchTopicsTool({ memoryDir: dir, embedding: fakeEmbedding(fb) });
    const result = await tool.execute({ query: "travel plans" });

    expect(result.results[0].snippet.length).toBeLessThanOrEqual(200);
    rmSync(dir, { recursive: true, force: true });
  });

  it("does NOT call embedding when INDEX resolves the query (economy)", async () => {
    const dir = mkdtempSync(join(tmpdir(), "search-econ-"));
    const topicsDir = join(dir, "topics");
    mkdirSync(topicsDir, { recursive: true });
    writeFileSync(join(topicsDir, "work-schedule"), "", "utf-8");
    writeFileSync(
      join(dir, "INDEX.md"),
      "# Memory Index\n\n- **work-schedule**: the user's weekly work schedule and shifts\n",
      "utf-8",
    );

    const spy = spyEmbedding({ results: [{ topicId: "x", content: "should not appear", score: 0.9, sourcePath: "p" }] });
    const tool = createSearchTopicsTool({ memoryDir: dir, embedding: spy });
    const result = await tool.execute({ query: "work schedule" });

    expect(result.results[0].topicId).toBe("work-schedule");
    expect(spy.calls.length).toBe(0);
    rmSync(dir, { recursive: true, force: true });
  });

  it("caps INDEX-sourced snippet at 200 characters", async () => {
    const dir = mkdtempSync(join(tmpdir(), "search-capidx-"));
    const topicsDir = join(dir, "topics");
    mkdirSync(topicsDir, { recursive: true });
    writeFileSync(join(topicsDir, "long"), "", "utf-8");
    const longSummary = "summary ".repeat(40); // >200 chars
    writeFileSync(join(dir, "INDEX.md"), `# Memory Index\n\n- **long**: ${longSummary}\n`, "utf-8");

    const tool = createSearchTopicsTool({ memoryDir: dir, embedding: fakeEmbedding([]) });
    const result = await tool.execute({ query: "summary" });

    expect(result.results[0].source).toBe("index");
    expect(result.results[0].snippet.length).toBeLessThanOrEqual(200);
    expect(result.results[0].snippet.length).toBeLessThan(longSummary.length);
    rmSync(dir, { recursive: true, force: true });
  });

  it("degrades to found=0 without throwing when embedding throws", async () => {
    const dir = mkdtempSync(join(tmpdir(), "search-throw-"));
    mkdirSync(join(dir, "topics"), { recursive: true });

    const spy = spyEmbedding({ throws: true });
    const tool = createSearchTopicsTool({ memoryDir: dir, embedding: spy });
    const result = await tool.execute({ query: "anything" });

    expect(result.found).toBe(0);
    expect(result.results).toEqual([]);
    rmSync(dir, { recursive: true, force: true });
  });

  it("ranks INDEX hits by lexical overlap (higher overlap first)", async () => {
    const dir = mkdtempSync(join(tmpdir(), "search-rank-"));
    const topicsDir = join(dir, "topics");
    mkdirSync(topicsDir, { recursive: true });
    writeFileSync(join(topicsDir, "cycling"), "", "utf-8");
    writeFileSync(join(topicsDir, "work"), "", "utf-8");
    writeFileSync(
      join(dir, "INDEX.md"),
      "# Memory Index\n\n- **cycling**: bike commute and cycling routes\n- **work**: general work notes\n",
      "utf-8",
    );

    const tool = createSearchTopicsTool({ memoryDir: dir, embedding: fakeEmbedding([]) });
    const result = await tool.execute({ query: "bike cycling commute work" });

    expect(result.results[0].topicId).toBe("cycling");
    expect(result.results[1].topicId).toBe("work");
    rmSync(dir, { recursive: true, force: true });
  });

  it("labels an in-INDEX topic as 'embedding' when reached via fallback", async () => {
    const dir = mkdtempSync(join(tmpdir(), "search-reroute-"));
    const topicsDir = join(dir, "topics");
    mkdirSync(topicsDir, { recursive: true });
    writeFileSync(join(topicsDir, "travel"), "", "utf-8");
    writeFileSync(
      join(dir, "INDEX.md"),
      "# Memory Index\n\n- **travel**: the user's trips and destinations\n",
      "utf-8",
    );

    // Query has zero lexical tokens (no INDEX match), but the embedding
    // fallback returns the in-INDEX topic. It MUST be labeled "embedding"
    // with the chunk snippet, not the INDEX summary.
    const fb: SearchResult[] = [
      {
        topicId: "travel",
        content: "User enjoys remote cabins in the mountains.",
        score: 0.88,
        sourcePath: "memory/topics/travel/CONTEXT.md",
      },
    ];
    const tool = createSearchTopicsTool({ memoryDir: dir, embedding: fakeEmbedding(fb) });
    const result = await tool.execute({ query: "???" });

    expect(result.results[0].topicId).toBe("travel");
    expect(result.results[0].source).toBe("embedding");
    expect(result.results[0].snippet).toContain("remote cabins");
    expect(result.results[0].snippet).not.toContain("trips and destinations");
    rmSync(dir, { recursive: true, force: true });
  });

  it("returns a validation error object for empty query", async () => {
    const dir = mkdtempSync(join(tmpdir(), "search-emptyq-"));
    mkdirSync(join(dir, "topics"), { recursive: true });

    const tool = createSearchTopicsTool({ memoryDir: dir, embedding: fakeEmbedding([]) });
    const result = (await tool.execute({ query: "" })) as { error?: boolean; message?: string };
    expect(result.error).toBe(true);
    expect(result.message ?? "").toContain("query");
    rmSync(dir, { recursive: true, force: true });
  });
});
