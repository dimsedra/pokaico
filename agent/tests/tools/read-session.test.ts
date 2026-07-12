import { describe, it, expect } from "vitest";
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { createReadSessionTool } from "../../src/mastra/tools/read-session";

const SAMPLE_JOURNAL = `---
session_id: commute-discussion
started_at: 2026-07-11T14:00:00+07:00
model: gemini-3.1-flash-lite
extracted: true
---

## [14:00:00] User
I've been cycling to work lately.

## [14:00:10] Pokai
That's great! How far is your commute?

## [14:00:25] User
About 15km each way. Takes me 45 minutes.
`;

describe("read_session tool", () => {
  it("returns session data for an existing journal file", async () => {
    const dir = mkdtempSync(join(tmpdir(), "read-session-"));
    mkdirSync(dir, { recursive: true });
    writeFileSync(join(dir, "2026-07-11-commute-discussion.md"), SAMPLE_JOURNAL, "utf-8");

    const tool = createReadSessionTool(dir);
    const result = await tool.execute({ sessionId: "commute-discussion" });
    expect(result.found).toBe(true);
    expect(result.sessionId).toBe("commute-discussion");
    expect(result.startedAt).toBe("2026-07-11T14:00:00+07:00");
    expect(result.extracted).toBe(true);
    expect(result.turns).toHaveLength(3);
    expect(result.turns[0].role).toBe("user");
    expect(result.turns[0].content).toContain("cycling");
    expect(result.turns[1].role).toBe("pokai");
    rmSync(dir, { recursive: true, force: true });
  });

  it("returns found=false for a non-existent session", async () => {
    const dir = mkdtempSync(join(tmpdir(), "read-session-miss-"));

    const tool = createReadSessionTool(dir);
    const result = await tool.execute({ sessionId: "nonexistent" });
    expect(result.found).toBe(false);
    expect(result.sessionId).toBe("nonexistent");
    expect(result.turns).toEqual([]);
    rmSync(dir, { recursive: true, force: true });
  });

  it("returns found=false for a malformed journal file", async () => {
    const dir = mkdtempSync(join(tmpdir(), "read-session-bad-"));
    mkdirSync(dir, { recursive: true });
    writeFileSync(join(dir, "2026-07-11-bad-session.md"), "this is not a valid journal", "utf-8");

    const tool = createReadSessionTool(dir);
    const result = await tool.execute({ sessionId: "bad-session" });
    expect(result.found).toBe(false);
    expect(result.turns).toEqual([]);
    rmSync(dir, { recursive: true, force: true });
  });
});
