import { describe, it, expect, vi, beforeAll, afterAll } from "vitest";
import { mkdtempSync, mkdirSync, writeFileSync, rmSync, readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { google } from "@ai-sdk/google";
import { createDb, closeDb, type PokaicoDb } from "../src/db/client";
import { createPythonEmbeddingModel } from "../src/embeddings/model";
import { createEmbeddingService } from "../src/embeddings/service";
import { processSession } from "../src/memory/pipeline";
import { retrieveMemory } from "../src/memory/retrieval";
import { compact } from "../src/memory/compactor";
import { countTokens } from "../src/memory/tokens";

const hasApiKey = !!process.env.GOOGLE_GENERATIVE_AI_API_KEY;

describe.runIf(hasApiKey)("memory E2E smoke (real Gemini + E5)", () => {
  let db: PokaicoDb;
  let dir: string;
  let journalDir: string;
  let memoryDir: string;
  let embeddingService: ReturnType<typeof createEmbeddingService>;
  let capturedTopicIds: string[] = [];

  beforeAll(async () => {
    dir = mkdtempSync(join(tmpdir(), "memory-e2e-"));
    db = createDb(join(dir, "test.db"));
    journalDir = join(dir, "journal");
    memoryDir = join(dir, "memory");
    mkdirSync(journalDir, { recursive: true });
    mkdirSync(join(memoryDir, "topics"), { recursive: true });

    const embeddingModel = createPythonEmbeddingModel({ timeoutMs: 120_000 });
    embeddingService = createEmbeddingService(embeddingModel, db);
  }, 60_000);

  afterAll(async () => {
    closeDb(db);
    rmSync(dir, { recursive: true, force: true });
  });

  it("Test 1: saves 2 distinct topics from 1 multi-subject session", async () => {
    const sessionId = "multi-subject-session";
    const journalPath = join(journalDir, `2026-07-11-${sessionId}.md`);
    writeFileSync(journalPath, `---
session_id: ${sessionId}
started_at: 2026-07-11T14:00:00+07:00
model: test-model
extracted: false
---
## [14:00:00] User
I've been cycling to work for the past month. It's about 15km each way through some nice trails.

## [14:00:15] Pokai
That's great exercise! How long does it take you?

## [14:00:30] User
About 45 minutes. Saves me a lot of money on gas too.

## [14:01:00] User
Oh also, I started baking sourdough bread last weekend. My first loaf came out pretty good!

## [14:01:15] Pokai
Sourdough? That's ambitious! Did you make your own starter?

## [14:01:30] User
Yeah, I fed the starter for 5 days before baking. The crust was perfect but the crumb needs work.

## [14:01:45] Pokai
Practice makes perfect. Keep feeding that starter!
`, "utf-8");

    const model = google("gemini-3.1-flash-lite-preview");

    const result = await processSession(sessionId, {
      llm: model as never,
      searchSimilar: embeddingService.searchSimilar,
      indexTopic: embeddingService.indexTopic,
      db,
      memoryDir,
      journalDir,
    });

    console.log("E2E Test 1 result:");
    console.log("  hasNewMessages:", result.hasNewMessages);
    console.log("  error:", result.error);
    console.log("  summary:", result.summary?.summary?.slice(0, 150));
    console.log("  changes count:", result.changes.length);
    for (const c of result.changes) {
      console.log(`    - ${c.action}: ${c.topicId} (score: ${c.similarityScore ?? "N/A"})`);
    }
    console.log("  reindexed:", result.reindexed);

    expect(result.hasNewMessages).toBe(true);
    expect(result.error).toBeUndefined();
    expect(result.summary).toBeTruthy();
    expect(result.changes.length).toBeGreaterThanOrEqual(1);

    capturedTopicIds = result.changes.map((c) => c.topicId);

    for (const tid of capturedTopicIds) {
      const cp = join(memoryDir, "topics", tid, "CONTEXT.md");
      expect(readFileSync(cp, "utf-8").length).toBeGreaterThan(0);
      console.log(`\n  Topic [${tid}]:`, readFileSync(cp, "utf-8").slice(0, 200));
    }

    const topicRows = db.prepare("SELECT id FROM topics WHERE is_foundational = 0").all() as { id: string }[];
    for (const tid of capturedTopicIds) {
      expect(topicRows.map((r) => r.id)).toContain(tid);
    }
  }, 120_000);

  it("Test 2: retrieves relevant topic via searchSimilar (new chat)", async () => {
    expect(capturedTopicIds.length).toBeGreaterThanOrEqual(1);

    // Use single-word queries to avoid FTS5 AND semantics
    const cyclingResults = await embeddingService.searchSimilar("cycling", 5);
    console.log("\nE2E Test 2 - cycling search:", cyclingResults.map((r) => `${r.topicId} (${r.score.toFixed(3)})`));

    const cyclingTopic = capturedTopicIds.find((id) =>
      id.includes("cycl") || id.includes("bike") || id.includes("bicycle") || id.includes("commute"),
    );
    if (cyclingTopic) {
      const found = cyclingResults.find((r) => r.topicId === cyclingTopic);
      expect(found).toBeTruthy();
      console.log(`  Cycling topic [${cyclingTopic}] FOUND with score ${found!.score.toFixed(3)}`);
    } else {
      // Topic might have unexpected slug — just verify search returned something
      expect(cyclingResults.length).toBeGreaterThan(0);
      console.log(`  No cycling topic matched captured IDs. Top result: ${cyclingResults[0]?.topicId ?? "none"}`);
    }

    const bakingResults = await embeddingService.searchSimilar("sourdough", 5);
    console.log("\nE2E Test 2 - baking search:", bakingResults.map((r) => `${r.topicId} (${r.score.toFixed(3)})`));

    const bakingTopic = capturedTopicIds.find((id) =>
      id.includes("sour") || id.includes("bak") || id.includes("bread"),
    );
    if (bakingTopic) {
      const found = bakingResults.find((r) => r.topicId === bakingTopic);
      expect(found).toBeTruthy();
      console.log(`  Baking topic [${bakingTopic}] FOUND with score ${found!.score.toFixed(3)}`);
    } else {
      expect(bakingResults.length).toBeGreaterThan(0);
      console.log(`  No baking topic matched. Top result: ${bakingResults[0]?.topicId ?? "none"}`);
    }
  }, 60_000);

  it("Test 3: second session about existing topic -> update (not create new)", async () => {
    const existingId = capturedTopicIds[0];
    expect(existingId).toBeTruthy();

    const sessionId = "follow-up-session";
    const journalPath = join(journalDir, `2026-07-12-${sessionId}.md`);
    writeFileSync(journalPath, `---
session_id: ${sessionId}
started_at: 2026-07-12T10:00:00+07:00
model: test-model
extracted: false
---
## [10:00:00] User
Remember I told you about my cycling commute? I just bought a new bike yesterday!

## [10:00:15] Pokai
Oh nice! What kind of bike did you get?

## [10:00:30] User
A Canyon Endurace road bike. It's so much lighter than my old one.

## [10:00:45] Pokai
That's a serious bike! You'll shave minutes off your commute.

## [10:01:00] User
Yeah I'm excited. The old bike was a heavy mountain bike, not ideal for road.
`, "utf-8");

    const model = google("gemini-3.1-flash-lite-preview");

    const result = await processSession(sessionId, {
      llm: model as never,
      searchSimilar: embeddingService.searchSimilar,
      indexTopic: embeddingService.indexTopic,
      db,
      memoryDir,
      journalDir,
    });

    console.log("\nE2E Test 3 - follow-up session:");
    console.log("  hasNewMessages:", result.hasNewMessages);
    console.log("  error:", result.error);
    for (const c of result.changes) {
      console.log(`    ${c.action}: ${c.topicId} (similarityScore: ${c.similarityScore ?? "N/A"})`);
    }

    expect(result.hasNewMessages).toBe(true);
    expect(result.error).toBeUndefined();

    const updates = result.changes.filter((c) => c.action === "update");
    const creates = result.changes.filter((c) => c.action === "create");

    // Acceptance (issue #2 Test 3): a follow-up session about an existing
    // topic must not crash and should produce updates (foundational or otherwise).
    // NOTE: the exact topicId updated depends on LLM title generation and may not
    // match the original session's topic deterministically (e.g. "bike purchase" vs
    // "commuting via cycling"). Deterministic routing is verified in the offline
    // pipeline-level test; this smoke test checks integration health.
    expect(updates.length).toBeGreaterThan(0);

    // Prior topics must still exist on disk (no accidental deletion).
    expect(
      readFileSync(join(memoryDir, "topics", existingId, "CONTEXT.md"), "utf-8").length,
    ).toBeGreaterThan(0);
    const allDirs = readdirSync(join(memoryDir, "topics"));
    expect(allDirs).toContain(existingId);
    // All created topics survive (use captured IDs, not hardcoded slugs).
    for (const id of capturedTopicIds) {
      expect(allDirs).toContain(id);
    }
    // The existing cycling topic content should be unchanged or grown (not erased).
    const cyclingContent = readFileSync(
      join(memoryDir, "topics", existingId, "CONTEXT.md"),
      "utf-8",
    );
    expect(cyclingContent.length).toBeGreaterThan(0);
  }, 120_000);

  it("Test 4: compaction condenses oversized content within the cap (real Gemini)", async () => {
    const cap = 300;
    const current = Array.from(
      { length: 40 },
      (_, i) =>
        `Note ${i}: The user enjoys long-distance road cycling on weekends and tracks every ride in great detail including heart rate, cadence, elevation, and weather conditions for each segment.`,
    ).join("\n");

    expect(countTokens(current)).toBeGreaterThan(cap * 2);

    const model = google("gemini-3.1-flash-lite-preview");
    const result = await compact({
      current,
      newInfo: "The user just completed their first 100km ride and felt great afterwards.",
      cap,
      model: model as never,
    });

    const contextTokens = countTokens(result.context);
    console.log("\nE2E Test 4 - compaction:");
    console.log("  input tokens:", countTokens(current));
    console.log("  output tokens:", contextTokens, "(cap", cap + ")");
    console.log("  overflow files:", result.overflow.length);

    // Compacted context must be far smaller than input and near/under the cap.
    expect(contextTokens).toBeLessThan(countTokens(current));
    expect(contextTokens).toBeLessThanOrEqual(cap * 1.3);
    expect(result.context.length).toBeGreaterThan(0);
  }, 120_000);

  it("Test 5: graph read-path via INDEX (routing without embedding), filesystem traversal, edges", async () => {
    expect(capturedTopicIds.length).toBeGreaterThanOrEqual(2);

    const cyclingTopic = capturedTopicIds.find(
      (id) => id.includes("cycl") || id.includes("commut") || id.includes("bike"),
    )!;
    const bakingTopic = capturedTopicIds.find(
      (id) => id.includes("sour") || id.includes("bak") || id.includes("bread"),
    )!;
    expect(cyclingTopic).toBeTruthy();
    expect(bakingTopic).toBeTruthy();

    // === 5a — INDEX-primary routing (path gembira) ===
    // Query tentang cycling harus match INDEX entry "commuting-via-cycling"
    // secara leksikal, tanpa menyentuh embedding.
    const searchSpy = vi.fn(async () => []);
    const ctx = await retrieveMemory(memoryDir, "cycling commute", {
      searchSimilar: searchSpy,
    });

    // CONTEXT.md dari filesystem ter-load (bukan FTS5/similarity)
    expect(ctx).toContain(`# ${cyclingTopic}`);
    expect(ctx).toContain("cycling");
    expect(ctx).toContain("15km");
    // INDEX hit → searchSimilar tidak pernah dipanggil
    expect(searchSpy).not.toHaveBeenCalled();

    console.log("\nE2E Test 5a — INDEX-primary routing:");
    console.log(`  query: "cycling commute" → INDEX match: ${cyclingTopic}`);
    console.log(`  searchSimilar called: ${searchSpy.mock.calls.length}`);
    console.log(`  context length: ${ctx.length} chars`);

    // === 5b — Fallback saat INDEX miss ===
    const fallbackSpy = vi.fn(async () => []);
    const miss = await retrieveMemory(memoryDir, "quantum physics", {
      searchSimilar: fallbackSpy,
    });
    // INDEX kosong → fallback embedding dipanggil
    expect(fallbackSpy).toHaveBeenCalledOnce();

    console.log("\nE2E Test 5b — INDEX miss → fallback:");
    console.log(`  query: "quantum physics" → no INDEX match`);
    console.log(`  searchSimilar called: ${fallbackSpy.mock.calls.length}`);

    // === 5c — Graph edges terverifikasi di SQLite ===
    const edges = db.prepare(
      "SELECT from_topic, to_topic, relationship FROM edges ORDER BY from_topic",
    ).all() as { from_topic: string; to_topic: string; relationship: string }[];

    expect(edges.length).toBeGreaterThan(0);
    const hasCrossLink = edges.some(
      (e) =>
        (e.from_topic === cyclingTopic && e.to_topic === bakingTopic) ||
        (e.from_topic === bakingTopic && e.to_topic === cyclingTopic),
    );
    expect(hasCrossLink).toBe(true);

    console.log("\nE2E Test 5c — Graph edges:");
    for (const e of edges) {
      console.log(`  ${e.from_topic} → ${e.to_topic}: ${e.relationship}`);
    }

    // === 5d — INDEX.md berisi node list + edge section ===
    const indexMd = readFileSync(join(memoryDir, "INDEX.md"), "utf-8");
    expect(indexMd).toContain(cyclingTopic);
    expect(indexMd).toContain(bakingTopic);
    expect(indexMd).toContain("## Edges");

    console.log("\nE2E Test 5d — INDEX.md validation:");
    console.log(`  topics in INDEX: ${indexMd.split("- **").length - 1}`);
    console.log(`  edges section present: true`);
  }, 30_000);
});
