import { describe, it, expect, beforeAll } from "vitest";
import { mkdtempSync, writeFileSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { buildPrompt } from "../src/mastra/prompt";

let tmpDir: string;
let memoryDir: string;
let diaryDir: string;

beforeAll(() => {
  tmpDir = mkdtempSync(join(tmpdir(), "pokaico-prompt-test-"));
  memoryDir = join(tmpDir, "memory");
  diaryDir = join(tmpDir, "diary");

  mkdirSync(memoryDir, { recursive: true });
  mkdirSync(join(memoryDir, "topics"), { recursive: true });
  mkdirSync(diaryDir, { recursive: true });
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

    const prompt = await buildPrompt(memoryDir, undefined, undefined, diaryDir);

    // Verify it contains basic static instructions
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
    const emptyDiaryDir = join(tmpDir, "empty-diary");

    const prompt = await buildPrompt(emptyMemoryDir, undefined, undefined, emptyDiaryDir);

    expect(prompt).toContain("Pokai");
    expect(prompt).toContain("(No profile information recorded yet.)");
    expect(prompt).toContain("(No background information recorded yet.)");
    expect(prompt).toContain("(No recurring patterns detected yet.)");
  });
});

describe("buildPrompt - companion diary accumulation", () => {
  it("should retrieve top 3 diaries sorted by last_active_at descending and inject them chronologically", async () => {
    const histDiaryDir = join(tmpDir, "hist-diary");
    mkdirSync(histDiaryDir, { recursive: true });

    // We will create 4 diary files:
    // A: last active 1 hour ago
    // B: last active 2 hours ago
    // C: last active 3 hours ago
    // D: last active 4 hours ago
    // The top 3 should be A, B, and C. D should be excluded.
    // Chronologically oldest first: C (last active 3h ago) -> B (last active 2h ago) -> A (last active 1h ago).

    const pathA = join(histDiaryDir, "diary-a.md");
    const pathB = join(histDiaryDir, "diary-b.md");
    const pathC = join(histDiaryDir, "diary-c.md");
    const pathD = join(histDiaryDir, "diary-d.md");

    writeFileSync(
      pathA,
      `---
session_id: sessA
started_at: 2026-07-16T10:00:00Z
last_active_at: 2026-07-16T10:30:00Z
---
Diary entry A content.
`,
      "utf-8"
    );

    writeFileSync(
      pathB,
      `---
session_id: sessB
started_at: 2026-07-16T09:00:00Z
last_active_at: 2026-07-16T09:30:00Z
---
Diary entry B content.
`,
      "utf-8"
    );

    writeFileSync(
      pathC,
      `---
session_id: sessC
started_at: 2026-07-16T08:00:00Z
last_active_at: 2026-07-16T08:30:00Z
---
Diary entry C content.
`,
      "utf-8"
    );

    writeFileSync(
      pathD,
      `---
session_id: sessD
started_at: 2026-07-16T07:00:00Z
last_active_at: 2026-07-16T07:30:00Z
---
Diary entry D content.
`,
      "utf-8"
    );

    const prompt = await buildPrompt(memoryDir, undefined, undefined, histDiaryDir);

    expect(prompt).toContain("Companion's Diary");
    expect(prompt).toContain("Diary entry A content.");
    expect(prompt).toContain("Diary entry B content.");
    expect(prompt).toContain("Diary entry C content.");
    expect(prompt).not.toContain("Diary entry D content.");

    // Verify chronological order (oldest first): C -> B -> A
    const idxC = prompt.indexOf("Diary entry C content.");
    const idxB = prompt.indexOf("Diary entry B content.");
    const idxA = prompt.indexOf("Diary entry A content.");

    expect(idxC).toBeLessThan(idxB);
    expect(idxB).toBeLessThan(idxA);
  });
});

describe("buildPrompt - error shielding", () => {
  it("should handle completely missing diaryDir gracefully", async () => {
    const missingDiaryDir = join(tmpDir, "completely-missing-diary-dir");
    const prompt = await buildPrompt(memoryDir, undefined, undefined, missingDiaryDir);
    expect(prompt).toContain("Pokai");
    expect(prompt).not.toContain("Companion's Diary");
  });

  it("should skip corrupted diary files without throwing", async () => {
    const corruptDiaryDir = join(tmpDir, "corrupt-diary");
    mkdirSync(corruptDiaryDir, { recursive: true });

    const pathCorrupt = join(corruptDiaryDir, "corrupt.md");
    const pathValid = join(corruptDiaryDir, "valid.md");

    writeFileSync(pathCorrupt, "corrupt yaml frontmatter\n---\nDiary corrupt", "utf-8");
    writeFileSync(
      pathValid,
      `---
session_id: val
started_at: 2026-07-16T12:00:00Z
last_active_at: 2026-07-16T12:30:00Z
---
Valid diary content here.
`,
      "utf-8"
    );

    const prompt = await buildPrompt(memoryDir, undefined, undefined, corruptDiaryDir);
    expect(prompt).toContain("Valid diary content here.");
    expect(prompt).not.toContain("Diary corrupt");
  });
});
