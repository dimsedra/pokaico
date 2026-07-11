import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { createDb, closeDb, type PokaicoDb } from "../src/db/client";
import { writeEdge, writeResource, linkCoOccurring, topicExists } from "../src/memory/edges";

describe("edges", () => {
  let db: PokaicoDb;
  let dir: string;

  function seedTopic(id: string) {
    db.prepare(
      "INSERT OR IGNORE INTO topics(id, path, summary, token_count, updated_at) VALUES (?, ?, '', 0, 0)",
    ).run(id, `memory/topics/${id}/CONTEXT.md`);
  }

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), "edges-test-"));
    db = createDb(join(dir, "test.db"));
  });

  afterEach(() => {
    closeDb(db);
    rmSync(dir, { recursive: true, force: true });
  });

  it("writes a topic-to-topic edge when both topics exist", () => {
    seedTopic("cycling");
    seedTopic("fitness");

    expect(writeEdge(db, "cycling", "fitness", "related-to")).toBe(true);

    const row = db
      .prepare("SELECT relationship FROM edges WHERE from_topic = ? AND to_topic = ?")
      .get("cycling", "fitness") as { relationship: string };
    expect(row.relationship).toBe("related-to");
  });

  it("refuses to write an edge to a non-existent topic (FK safety)", () => {
    seedTopic("cycling");
    expect(writeEdge(db, "cycling", "ghost", "related-to")).toBe(false);

    const count = db.prepare("SELECT COUNT(*) c FROM edges").get() as { c: number };
    expect(count.c).toBe(0);
  });

  it("refuses self-edges", () => {
    seedTopic("cycling");
    expect(writeEdge(db, "cycling", "cycling", "related-to")).toBe(false);
  });

  it("is idempotent for the same edge", () => {
    seedTopic("a");
    seedTopic("b");
    writeEdge(db, "a", "b", "related-to");
    writeEdge(db, "a", "b", "related-to");

    const count = db.prepare("SELECT COUNT(*) c FROM edges").get() as { c: number };
    expect(count.c).toBe(1);
  });

  it("records an overflow resource for a topic", () => {
    seedTopic("proj");
    writeResource(db, "proj", "memory/topics/proj/resources/details.md", "md");

    const row = db
      .prepare("SELECT topic_id, kind FROM resources WHERE path = ?")
      .get("memory/topics/proj/resources/details.md") as { topic_id: string; kind: string };
    expect(row.topic_id).toBe("proj");
    expect(row.kind).toBe("md");
  });

  it("links co-occurring topics pairwise and bidirectionally", () => {
    seedTopic("a");
    seedTopic("b");
    seedTopic("c");

    linkCoOccurring(db, ["a", "b", "c"]);

    const count = db.prepare("SELECT COUNT(*) c FROM edges").get() as { c: number };
    // 3 unordered pairs * 2 directions = 6
    expect(count.c).toBe(6);
  });

  it("linkCoOccurring skips topics that do not exist", () => {
    seedTopic("a");
    linkCoOccurring(db, ["a", "missing"]);

    const count = db.prepare("SELECT COUNT(*) c FROM edges").get() as { c: number };
    expect(count.c).toBe(0);
  });

  it("topicExists reflects presence", () => {
    seedTopic("here");
    expect(topicExists(db, "here")).toBe(true);
    expect(topicExists(db, "nope")).toBe(false);
  });
});
