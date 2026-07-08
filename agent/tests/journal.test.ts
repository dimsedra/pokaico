import { describe, it, expect, beforeAll } from "vitest";
import { mkdtempSync, writeFileSync, readFileSync, existsSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";

import {
  appendTurn,
  readSession,
  listSessions,
  type JournalTurn,
} from "../src/memory/journal";

let tmpDir: string;

beforeAll(() => {
  tmpDir = mkdtempSync(join(tmpdir(), "pokaico-journal-test-"));
});

describe("appendTurn", () => {
  it("appends a user turn in the expected markdown format", () => {
    const path = join(tmpDir, "test-session.md");
    const turn: JournalTurn = {
      timestamp: "14:02:11",
      role: "user",
      content: "Hello Pokai!",
    };

    writeFileSync(
      path,
      `---\nsession_id: test\nstarted_at: 2026-07-08T14:02:11+07:00\nmodel: test-model\nextracted: false\n---\n`,
    );
    appendTurn(path, turn);

    const content = readFileSync(path, "utf-8");
    expect(content).toContain("## [14:02:11] User");
    expect(content).toContain("Hello Pokai!");
  });

  it("appends a pokai turn correctly", () => {
    const path = join(tmpDir, "pokai-turn.md");
    writeFileSync(
      path,
      `---\nsession_id: pokai-test\nstarted_at: 2026-07-08T14:00:00+07:00\nmodel: test\nextracted: false\n---\n`,
    );

    appendTurn(path, {
      timestamp: "14:00:01",
      role: "pokai",
      content: "Hi there! How can I help?",
    });

    const content = readFileSync(path, "utf-8");
    expect(content).toContain("## [14:00:01] Pokai");
    expect(content).toContain("Hi there! How can I help?");
  });

  it("preserves existing content when appending", () => {
    const path = join(tmpDir, "multiple-turns.md");
    writeFileSync(
      path,
      `---\nsession_id: multi\nstarted_at: 2026-07-08T14:00:00+07:00\nmodel: test\nextracted: false\n---\n`,
    );

    appendTurn(path, { timestamp: "14:01:00", role: "user", content: "First" });
    appendTurn(path, { timestamp: "14:02:00", role: "pokai", content: "Reply" });
    appendTurn(path, { timestamp: "14:03:00", role: "user", content: "Second" });

    const content = readFileSync(path, "utf-8");
    expect(content.match(/## \[\d{2}:\d{2}:\d{2}\]/g)).toHaveLength(3);
  });
});

describe("readSession", () => {
  it("parses a journal file into structured data", () => {
    const path = join(tmpDir, "parse-test.md");
    writeFileSync(
      path,
      [
        "---",
        "session_id: abc123",
        "started_at: 2026-07-08T14:02:11+07:00",
        "model: claude-sonnet-5",
        "extracted: false",
        "---",
        "",
        "## [14:02:11] User",
        "Hello!",
        "",
        "## [14:02:19] Pokai",
        "Hi there!",
        "",
        "## [14:05:03] User",
        "How are you?",
      ].join("\n"),
    );

    const session = readSession(path);
    expect(session.sessionId).toBe("abc123");
    expect(session.model).toBe("claude-sonnet-5");
    expect(session.extracted).toBe(false);
    expect(session.turns).toHaveLength(3);
    expect(session.turns[0]).toEqual({
      timestamp: "14:02:11",
      role: "user",
      content: "Hello!",
    });
    expect(session.turns[1]).toEqual({
      timestamp: "14:02:19",
      role: "pokai",
      content: "Hi there!",
    });
  });

  it("parses multi-line turn content", () => {
    const path = join(tmpDir, "multiline.md");
    writeFileSync(
      path,
      [
        "---",
        "session_id: ml",
        "started_at: 2026-07-08T14:00:00+07:00",
        "model: t",
        "extracted: false",
        "---",
        "",
        "## [14:00:00] User",
        "Line one",
        "",
        "Line three",
      ].join("\n"),
    );

    const session = readSession(path);
    expect(session.turns[0].content).toBe("Line one\n\nLine three");
  });

  it("returns an empty turns array for a file with no turns", () => {
    const path = join(tmpDir, "empty-turns.md");
    writeFileSync(
      path,
      [
        "---",
        "session_id: empty",
        "started_at: 2026-07-08T14:00:00+07:00",
        "model: t",
        "extracted: false",
        "---",
      ].join("\n"),
    );

    const session = readSession(path);
    expect(session.turns).toEqual([]);
  });

  it("throws for missing file", () => {
    expect(() => readSession(join(tmpDir, "nope.md"))).toThrow();
  });
});

describe("listSessions", () => {
  it("returns metadata for all journal files in a directory", () => {
    const listDir = mkdtempSync(join(tmpdir(), "pokaico-list-test-"));
    writeFileSync(
      join(listDir, "2026-07-08-a.md"),
      [
        "---",
        "session_id: a",
        "started_at: 2026-07-08T10:00:00+07:00",
        "model: m1",
        "extracted: true",
        "---",
      ].join("\n"),
    );
    writeFileSync(
      join(listDir, "2026-07-08-b.md"),
      [
        "---",
        "session_id: b",
        "started_at: 2026-07-08T11:00:00+07:00",
        "model: m2",
        "extracted: false",
        "---",
      ].join("\n"),
    );

    const sessions = listSessions(listDir);
    expect(sessions).toHaveLength(2);
    expect(sessions.find((s) => s.sessionId === "a")?.extracted).toBe(true);
    expect(sessions.find((s) => s.sessionId === "b")?.model).toBe("m2");
  });

  it("returns empty array for empty directory", () => {
    const emptyDir = mkdtempSync(join(tmpdir(), "pokaico-empty-"));
    expect(listSessions(emptyDir)).toEqual([]);
  });
});

describe("edge cases", () => {
  it("parses tool turns with tool name suffix", () => {
    const path = join(tmpDir, "tool-turn.md");
    writeFileSync(
      path,
      [
        "---",
        "session_id: tool-test",
        "started_at: 2026-07-08T14:00:00+07:00",
        "model: t",
        "extracted: false",
        "---",
        "",
        "## [14:03:02] Tool: search_topics",
        '{"query": "work"}',
      ].join("\n"),
    );

    const session = readSession(path);
    expect(session.turns).toHaveLength(1);
    expect(session.turns[0].role).toBe("tool");
  });

  it("handles CRLF line endings", () => {
    const path = join(tmpDir, "crlf-test.md");
    writeFileSync(
      path,
      [
        "---",
        "session_id: crlf",
        "started_at: 2026-07-08T14:00:00+07:00",
        "model: t",
        "extracted: false",
        "---",
        "",
        "## [14:00:00] User",
        "Hello",
      ].join("\r\n"),
    );

    const session = readSession(path);
    expect(session.turns).toHaveLength(1);
    expect(session.turns[0].content).toBe("Hello");
  });

  it("handles YAML dashes in turn content", () => {
    const path = join(tmpDir, "yaml-dash.md");
    writeFileSync(
      path,
      [
        "---",
        "session_id: yaml",
        "started_at: 2026-07-08T14:00:00+07:00",
        "model: t",
        "extracted: false",
        "---",
        "",
        "## [14:00:00] User",
        "Here is a list:",
        "- item one",
        "- item two",
        "---",
        "horizontal rule in markdown",
      ].join("\n"),
    );

    const session = readSession(path);
    expect(session.turns).toHaveLength(1);
    expect(session.turns[0].content).toContain("- item one");
    expect(session.turns[0].content).toContain("horizontal rule");
  });

  it("returns undefined sessionId when frontmatter field is missing", () => {
    const path = join(tmpDir, "missing-fm.md");
    writeFileSync(
      path,
      [
        "---",
        "model: t",
        "extracted: true",
        "---",
      ].join("\n"),
    );

    const session = readSession(path);
    expect(session.sessionId).toBeUndefined();
    expect(session.model).toBe("t");
    expect(session.extracted).toBe(true);
  });

  it("skips non-.md files in listSessions", () => {
    const mixedDir = mkdtempSync(join(tmpdir(), "pokaico-mixed-"));
    writeFileSync(
      join(mixedDir, "session.md"),
      [
        "---",
        "session_id: valid",
        "started_at: 2026-07-08T14:00:00+07:00",
        "model: t",
        "extracted: false",
        "---",
      ].join("\n"),
    );
    writeFileSync(join(mixedDir, "notes.txt"), "plain text");
    writeFileSync(join(mixedDir, "data.json"), "{}");

    const sessions = listSessions(mixedDir);
    expect(sessions).toHaveLength(1);
    expect(sessions[0].sessionId).toBe("valid");
  });

  it("lists duplicate sessionIds separately", () => {
    const dupDir = mkdtempSync(join(tmpdir(), "pokaico-dup-"));
    writeFileSync(
      join(dupDir, "a.md"),
      [
        "---",
        "session_id: same-id",
        "started_at: 2026-07-08T10:00:00+07:00",
        "model: m1",
        "extracted: false",
        "---",
      ].join("\n"),
    );
    writeFileSync(
      join(dupDir, "b.md"),
      [
        "---",
        "session_id: same-id",
        "started_at: 2026-07-08T11:00:00+07:00",
        "model: m2",
        "extracted: false",
        "---",
      ].join("\n"),
    );

    const sessions = listSessions(dupDir);
    expect(sessions).toHaveLength(2);
  });
});
