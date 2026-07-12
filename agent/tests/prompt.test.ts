import { describe, it, expect, beforeAll } from "vitest";
import { mkdtempSync, writeFileSync, mkdirSync, utimesSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { buildPrompt } from "../src/mastra/prompt";

let tmpDir: string;
let memoryDir: string;
let journalDir: string;

beforeAll(() => {
  tmpDir = mkdtempSync(join(tmpdir(), "pokaico-prompt-test-"));
  memoryDir = join(tmpDir, "memory");
  journalDir = join(tmpDir, "journal");

  mkdirSync(memoryDir, { recursive: true });
  mkdirSync(join(memoryDir, "topics"), { recursive: true });
  mkdirSync(journalDir, { recursive: true });
});

describe("buildPrompt - basic assembly", () => {
  it("should compile static instructions, INDEX.md, and foundational topics", async () => {
    // Write mock INDEX.md
    writeFileSync(join(memoryDir, "INDEX.md"), "# Memory Index\n- topic-a: Description A", "utf-8");

    // Write foundational topics
    const profileDir = join(memoryDir, "topics", "user-profile");
    const backgroundDir = join(memoryDir, "topics", "user-background");
    const patternsDir = join(memoryDir, "topics", "user-patterns");

    mkdirSync(profileDir, { recursive: true });
    mkdirSync(backgroundDir, { recursive: true });
    mkdirSync(patternsDir, { recursive: true });

    writeFileSync(join(profileDir, "CONTEXT.md"), "Cognitive preference: text", "utf-8");
    writeFileSync(join(backgroundDir, "CONTEXT.md"), "Name: John Doe", "utf-8");
    writeFileSync(join(patternsDir, "CONTEXT.md"), "User often requests code", "utf-8");

    const prompt = await buildPrompt(memoryDir, undefined, journalDir);

    // Verify it contains basic static instructions (like Pokai identity)
    expect(prompt).toContain("Pokai");
    
    // Verify it contains INDEX.md content
    expect(prompt).toContain("Memory Index");
    expect(prompt).toContain("topic-a: Description A");

    // Verify it contains foundational topics
    expect(prompt).toContain("Cognitive preference: text");
    expect(prompt).toContain("Name: John Doe");
    expect(prompt).toContain("User often requests code");
  });

  it("should handle missing files gracefully with placeholders", async () => {
    const emptyMemoryDir = join(tmpDir, "empty-memory");
    const emptyJournalDir = join(tmpDir, "empty-journal");

    const prompt = await buildPrompt(emptyMemoryDir, undefined, emptyJournalDir);

    expect(prompt).toContain("Pokai");
    expect(prompt).toContain("(No profile information recorded yet.)");
    expect(prompt).toContain("(No background information recorded yet.)");
    expect(prompt).toContain("(No recurring patterns detected yet.)");
  });
});

describe("buildPrompt - recent history accumulation", () => {
  it("should accumulate the last N turns across multiple sessions chronologically", async () => {
    const histJournalDir = join(tmpDir, "hist-journal");
    mkdirSync(histJournalDir, { recursive: true });

    const path1 = join(histJournalDir, "2026-07-08-session1.md");
    const path2 = join(histJournalDir, "2026-07-08-session2.md");

    // Write older session (session1)
    writeFileSync(
      path1,
      [
        "---",
        "session_id: sess1",
        "started_at: 2026-07-08T10:00:00+07:00",
        "model: test",
        "extracted: false",
        "---",
        "",
        "## [10:00:01] User",
        "Message 1",
        "",
        "## [10:00:02] Pokai",
        "Message 2",
        "",
        "## [10:00:03] User",
        "Message 3",
      ].join("\n"),
      "utf-8"
    );

    // Write newer session (session2)
    writeFileSync(
      path2,
      [
        "---",
        "session_id: sess2",
        "started_at: 2026-07-08T11:00:00+07:00",
        "model: test",
        "extracted: false",
        "---",
        "",
        "## [11:00:01] User",
        "Message 4",
        "",
        "## [11:00:02] Pokai",
        "Message 5",
      ].join("\n"),
      "utf-8"
    );

    // Set modification times explicitly (path2 is newer than path1)
    const now = Date.now();
    utimesSync(path1, new Date(now - 10000), new Date(now - 10000));
    utimesSync(path2, new Date(now), new Date(now));

    const prompt = await buildPrompt(memoryDir, undefined, histJournalDir);

    // Verify recent history section exists in the prompt
    expect(prompt).toContain("Recent Conversation History");

    // Verify it contains the accumulated turns in chronological order
    // Expected turns gathered: Message 2, Message 3 (from sess1) + Message 4, Message 5 (from sess2)
    // (since default history capacity is 10, it gathers all 5 turns)
    expect(prompt).toContain("User: Message 1");
    expect(prompt).toContain("Pokai: Message 2");
    expect(prompt).toContain("User: Message 3");
    expect(prompt).toContain("User: Message 4");
    expect(prompt).toContain("Pokai: Message 5");

    // Verify order of appearance: Message 3 must appear before Message 4
    const idx3 = prompt.indexOf("Message 3");
    const idx4 = prompt.indexOf("Message 4");
    expect(idx3).toBeLessThan(idx4);
  });

  it("should sort sessions alphabetically as a tie-breaker if mtimeMs is identical", async () => {
    const tieJournalDir = join(tmpDir, "tie-journal");
    mkdirSync(tieJournalDir, { recursive: true });

    // Filenames: session-bbb.md vs session-aaa.md (bbb.md is alphabetically larger/later)
    const pathA = join(tieJournalDir, "2026-07-08-session-aaa.md");
    const pathB = join(tieJournalDir, "2026-07-08-session-bbb.md");

    writeFileSync(
      pathA,
      [
        "---",
        "session_id: sessA",
        "started_at: 2026-07-08T10:00:00+07:00",
        "model: test",
        "extracted: false",
        "---",
        "",
        "## [10:00:01] User",
        "From Session A",
      ].join("\n"),
      "utf-8"
    );

    writeFileSync(
      pathB,
      [
        "---",
        "session_id: sessB",
        "started_at: 2026-07-08T11:00:00+07:00",
        "model: test",
        "extracted: false",
        "---",
        "",
        "## [11:00:01] User",
        "From Session B",
      ].join("\n"),
      "utf-8"
    );

    // Set identical modification times
    const sameTime = new Date();
    utimesSync(pathA, sameTime, sameTime);
    utimesSync(pathB, sameTime, sameTime);

    const prompt = await buildPrompt(memoryDir, undefined, tieJournalDir);

    // Since bbb.md is alphabetically larger, in descending order bbb.md is treated as "newer" (latest).
    // So session B turns should be chronologically AFTER session A turns in the prompt chunk alignment.
    // Index of "From Session A" should be less than "From Session B".
    const idxA = prompt.indexOf("From Session A");
    const idxB = prompt.indexOf("From Session B");
    expect(idxA).toBeLessThan(idxB);
  });
});

describe("buildPrompt - error shielding", () => {
  it("should handle completely missing journalDir gracefully", async () => {
    const missingJournalDir = join(tmpDir, "completely-missing-journal-dir");
    // Do not create this folder. readdir(missingJournalDir) will throw ENOENT.

    const prompt = await buildPrompt(memoryDir, undefined, missingJournalDir);
    expect(prompt).toContain("Pokai");
    // Should not contain recent history block since it's empty/missing
    expect(prompt).not.toContain("Recent Conversation History");
  });

  it("should skip corrupted journal files and parse valid ones without throwing", async () => {
    const corruptJournalDir = join(tmpDir, "corrupt-journal");
    mkdirSync(corruptJournalDir, { recursive: true });

    const pathCorrupt = join(corruptJournalDir, "2026-07-08-corrupt.md");
    const pathValid = join(corruptJournalDir, "2026-07-08-valid.md");

    // Write corrupted file (no frontmatter)
    writeFileSync(pathCorrupt, "This file is completely corrupt\n## [10:00:00] User\nHello", "utf-8");

    // Write valid file
    writeFileSync(
      pathValid,
      [
        "---",
        "session_id: val",
        "started_at: 2026-07-08T12:00:00+07:00",
        "model: test",
        "extracted: false",
        "---",
        "",
        "## [12:00:00] User",
        "Valid message here",
      ].join("\n"),
      "utf-8"
    );

    // Make corrupt.md newer so it would normally be processed first
    const now = Date.now();
    utimesSync(pathCorrupt, new Date(now), new Date(now));
    utimesSync(pathValid, new Date(now - 10000), new Date(now - 10000));

    const prompt = await buildPrompt(memoryDir, undefined, corruptJournalDir);

    expect(prompt).toContain("Pokai");
    // Should contain the valid message
    expect(prompt).toContain("Valid message here");
  });
});


