import { describe, it, expect } from "vitest";
import { mkdtempSync, writeFileSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { readSession } from "../../src/memory/conversation";

describe("E1: ## [HH:MM:ss] inside turn content — FIXED", () => {
  it("correctly keeps false header as content after fix", () => {
    const dir = mkdtempSync(join(tmpdir(), "edge-e1-fixed-"));
    const path = join(dir, "test.md");

    writeFileSync(
      path,
      `---
session_id: e1-test
started_at: 2026-07-09T14:00:00+07:00
model: test
extracted: false
---
## [14:00:00] User
Here's my log for today:
## [14:02:11] Something happened
Then we continued normally.`,
      "utf-8",
    );

    const session = readSession(path);

    // After fix: 1 turn with ALL content intact
    expect(session.turns.length).toBe(1);
    expect(session.turns[0].role).toBe("user");
    expect(session.turns[0].content).toContain("## [14:02:11] Something happened");
    expect(session.turns[0].content).toContain("Then we continued normally.");

    rmSync(dir, { recursive: true, force: true });
  });

  it("correctly identifies undefined role as content", () => {
    const dir = mkdtempSync(join(tmpdir(), "edge-e1b-fixed-"));
    const path = join(dir, "test.md");

    writeFileSync(
      path,
      `---
session_id: e1b
started_at: 2026-07-09T10:00:00+07:00
model: test
extracted: false
---
## [10:00:00] User
I reviewed the logs.
## [10:05:00] Everything looks fine
No issues found.`,
      "utf-8",
    );

    const session = readSession(path);

    // After fix: 1 turn, "Everything looks fine" is NOT a valid role label
    // so the line stays as content
    expect(session.turns.length).toBe(1);
    expect(session.turns[0].content).toContain("## [10:05:00] Everything looks fine");
    expect(session.turns[0].content).toContain("No issues found.");

    rmSync(dir, { recursive: true, force: true });
  });
});
