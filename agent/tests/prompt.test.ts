import { describe, it, expect, beforeAll } from "vitest";
import { mkdtempSync, writeFileSync, mkdirSync } from "node:fs";
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
