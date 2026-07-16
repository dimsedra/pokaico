import { describe, it, expect, vi, beforeAll, beforeEach } from "vitest";
import { mkdtempSync, readFileSync, existsSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";

const mockGenerateText = vi.hoisted(() => vi.fn());

vi.mock("ai", () => ({
  generateText: mockGenerateText,
}));

import { generateCompanionDiary, writeDiaryEntry } from "../src/memory/diary";
import type { ConversationTurn } from "../src/memory/conversation";

let tmpDir: string;
const mockModel = {} as never;

beforeAll(() => {
  tmpDir = mkdtempSync(join(tmpdir(), "pokaico-diary-test-"));
});

beforeEach(() => {
  mockGenerateText.mockReset();
});

describe("generateCompanionDiary", () => {
  const turns: ConversationTurn[] = [
    { timestamp: "14:02:11", role: "user", content: "I got a promotion today!" },
    { timestamp: "14:02:19", role: "pokai", content: "Wow, congratulations! Tell me more." },
    { timestamp: "14:03:00", role: "user", content: "I am now the senior team lead." },
  ];

  it("should generate a cozy third-person narrative diary from turns", async () => {
    mockGenerateText.mockResolvedValue({
      text: "Today, the user shared some wonderful news about getting promoted to senior team lead. They were happy and I congratulated them.",
    });

    const diaryContent = await generateCompanionDiary(turns, mockModel);
    expect(diaryContent).toContain("senior team lead");
    expect(diaryContent).toContain("Today");
    expect(mockGenerateText).toHaveBeenCalledTimes(1);
  });

  it("should throw error if turns is empty", async () => {
    await expect(generateCompanionDiary([], mockModel)).rejects.toThrow("empty conversation");
  });
});

describe("writeDiaryEntry", () => {
  it("should write diary markdown file with correct frontmatter and content", async () => {
    const filePath = join(tmpDir, "2026-07-16-session-abc.md");
    const diaryContent = "Today, the user talked about their promotion.";
    const sessionId = "session-abc";
    const startedAt = "2026-07-16T04:00:00Z";
    const lastActiveAt = "2026-07-16T04:15:00Z";

    await writeDiaryEntry(filePath, diaryContent, sessionId, startedAt, lastActiveAt);

    expect(existsSync(filePath)).toBe(true);

    const fileText = readFileSync(filePath, "utf-8");
    expect(fileText).toContain("session_id: session-abc");
    expect(fileText).toContain("started_at: 2026-07-16T04:00:00Z");
    expect(fileText).toContain("last_active_at: 2026-07-16T04:15:00Z");
    expect(fileText).toContain(diaryContent);
  });
});
