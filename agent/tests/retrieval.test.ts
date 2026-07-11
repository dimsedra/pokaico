import { describe, it, expect, vi } from "vitest";
import { mkdtempSync, writeFileSync, existsSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { createTopic } from "../src/memory/topics";
import { routeTopics, loadRoutedContext } from "../src/memory/retrieval";

function writeIndex(dir: string, lines: string[]): void {
  writeFileSync(
    join(dir, "INDEX.md"),
    ["# Memory Index", "", ...lines, ""].join("\n"),
    "utf-8",
  );
}

const fakeHit = (topicId: string, score = 0.9) => ({
  topicId,
  score,
  content: `content for ${topicId}`,
  sourcePath: `memory/topics/${topicId}/CONTEXT.md`,
});

describe("routeTopics (issue #2 — INDEX-primary router)", () => {
  it("routes via INDEX lexical match without calling searchSimilar", async () => {
    const dir = mkdtempSync(join(tmpdir(), "pokaico-route-"));
    writeIndex(dir, [
      "- **bike-purchase**: User bought a new bike",
      "- **fitness**: User's gym routine",
    ]);
    const searchSimilar = vi.fn();

    const result = await routeTopics(dir, "bike purchase", { searchSimilar });

    expect(result).toEqual(["bike-purchase"]);
    expect(searchSimilar).not.toHaveBeenCalled();
  });

  it("falls back to searchSimilar only when INDEX has no lexical match", async () => {
    const dir = mkdtempSync(join(tmpdir(), "pokaico-route-fb-"));
    // Neither INDEX entry lexically matches "zzz qqq", so the (secondary)
    // embedding search must run and its hit is returned.
    writeIndex(dir, [
      "- **bike-purchase**: User bought a new bike",
      "- **fitness**: User's gym routine",
    ]);
    const searchSimilar = vi.fn().mockResolvedValue([fakeHit("fitness", 0.95)]);

    const result = await routeTopics(dir, "zzz qqq", { searchSimilar });

    expect(result).toEqual(["fitness"]);
    expect(searchSimilar).toHaveBeenCalledOnce();
  });

  it("falls back entirely to searchSimilar when INDEX.md is absent", async () => {
    const dir = mkdtempSync(join(tmpdir(), "pokaico-route-fb2-"));
    const searchSimilar = vi.fn().mockResolvedValue([fakeHit("x")]);

    const result = await routeTopics(dir, "anything", { searchSimilar });

    expect(result).toEqual(["x"]);
    expect(searchSimilar).toHaveBeenCalledOnce();
  });

  it("returns [] when INDEX misses and no searchSimilar is supplied", async () => {
    const dir = mkdtempSync(join(tmpdir(), "pokaico-route-none-"));
    writeIndex(dir, ["- **bike-purchase**: User bought a new bike"]);

    const result = await routeTopics(dir, "zzz qqq unrelated");

    expect(result).toEqual([]);
  });

  it("is deterministic — identical input yields identical ordering", async () => {
    const dir = mkdtempSync(join(tmpdir(), "pokaico-route-det-"));
    writeIndex(dir, [
      "- **bike-purchase**: User bought a new bike",
      "- **fitness**: User's gym routine",
      "- **travel**: User visited Japan",
    ]);

    const a = await routeTopics(dir, "bike purchase travel");
    const b = await routeTopics(dir, "bike purchase travel");
    expect(a).toEqual(b);
  });

  it("returns [] for no-overlap query when no searchSimilar is given", async () => {
    const dir = mkdtempSync(join(tmpdir(), "pokaico-route-empty-"));
    writeIndex(dir, ["- **bike-purchase**: User bought a new bike"]);

    const result = await routeTopics(dir, "zzz qqq unrelated");
    expect(result).toEqual([]);
  });

  it("returns the INDEX-matched topic and skips the embedding call", async () => {
    const dir = mkdtempSync(join(tmpdir(), "pokaico-route-skip-"));
    writeIndex(dir, ["- **bike-purchase**: User bought a new bike"]);
    const searchSimilar = vi
      .fn()
      .mockResolvedValue([fakeHit("bike-purchase", 0.9)]);

    const result = await routeTopics(dir, "bike purchase", { searchSimilar });

    expect(result).toEqual(["bike-purchase"]);
    expect(searchSimilar).not.toHaveBeenCalled();
  });

  it("loadRoutedContext concatenates the routed topics' CONTEXT.md", async () => {
    const dir = mkdtempSync(join(tmpdir(), "pokaico-route-load-"));
    createTopic(dir, "bike-purchase", "Bike purchase context body");
    writeIndex(dir, ["- **bike-purchase**: User bought a new bike"]);

    const ctx = await loadRoutedContext(dir, "bike purchase");

    expect(ctx).toContain("# bike-purchase");
    expect(ctx).toContain("Bike purchase context body");
    expect(existsSync(join(dir, "topics", "bike-purchase", "CONTEXT.md"))).toBe(true);
    rmSync(dir, { recursive: true, force: true });
  });
});
