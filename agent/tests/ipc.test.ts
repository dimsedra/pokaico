import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { Readable, Writable } from "node:stream";
import { mkdtempSync, writeFileSync, mkdirSync, readFileSync, existsSync, rmSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { startIPCListener, createConversationSessionFile } from "../src/ipc";

class MockReadable extends Readable {
  _read() {}
  pushLine(line: string) {
    this.push(line + "\n");
  }
  endStream() {
    this.push(null);
  }
}

class MockWritable extends Writable {
  lines: string[] = [];
  private onLineWritten?: () => void;

  _write(chunk: any, encoding: string, callback: (error?: Error | null) => void) {
    const data = chunk.toString();
    const split = data.split("\n");
    for (const s of split) {
      if (s.trim()) {
        this.lines.push(s.trim());
        if (this.onLineWritten) {
          const resolve = this.onLineWritten;
          this.onLineWritten = undefined;
          resolve();
        }
      }
    }
    callback();
  }

  waitForLine(): Promise<void> {
    return new Promise((resolve) => {
      if (this.lines.length > 0) {
        resolve();
      } else {
        this.onLineWritten = resolve;
      }
    });
  }

  clear() {
    this.lines = [];
    this.onLineWritten = undefined;
  }
}

describe("startIPCListener", () => {
  let tmpDir: string;
  let conversationDir: string;
  let activeListeners: any[] = [];

  beforeEach(() => {
    tmpDir = mkdtempSync(join(tmpdir(), "pokaico-ipc-test-"));
    conversationDir = join(tmpDir, "conversation");
    mkdirSync(conversationDir);
    activeListeners = [];
  });

  afterEach(() => {
    for (const listener of activeListeners) {
      if (listener && typeof listener.close === "function") {
        listener.close();
      }
    }
    rmSync(tmpDir, { recursive: true, force: true });
  });

  it("handles a successful chat command, writes conversation turns, and responds to stdout", async () => {
    const stdin = new MockReadable();
    const stdout = new MockWritable();
    const mockAgent = {
      generate: vi.fn().mockResolvedValue({
        text: "Response from Pokai!",
        steps: [],
      }),
    } as any;
    const runPipeline = vi.fn().mockResolvedValue({ success: true });

    const listener = startIPCListener({
      stdin,
      stdout,
      getAgent: () => mockAgent,
      conversationDir,
      runPipeline,
      getModelName: () => "google/gemini-1.5-flash",
    });
    activeListeners.push(listener);

    stdin.pushLine(JSON.stringify({
      id: "req-1",
      command: "chat",
      args: {
        message: "Hello Pokai",
        sessionId: "session-abc",
      },
    }));

    await stdout.waitForLine();

    expect(stdout.lines).toHaveLength(1);
    const resp = JSON.parse(stdout.lines[0]);
    expect(resp.id).toBe("req-1");
    expect(resp.success).toBe(true);
    expect(resp.data.response).toBe("Response from Pokai!");

    const files = readdirSync(conversationDir);
    expect(files).toHaveLength(1);
    expect(files[0]).toContain("session-abc");

    const content = readFileSync(join(conversationDir, files[0]), "utf-8");
    expect(content).toContain("User\nHello Pokai");
    expect(content).toContain("Pokai\nResponse from Pokai!");
    expect(content).toContain("session_id: session-abc");
    expect(content).toContain("last_active_at:");

    expect(runPipeline).toHaveBeenCalledWith("session-abc");
  });

  it("returns an error if no model is configured (agent is null)", async () => {
    const stdin = new MockReadable();
    const stdout = new MockWritable();

    const listener = startIPCListener({
      stdin,
      stdout,
      getAgent: () => null,
      conversationDir,
      runPipeline: vi.fn(),
      getModelName: () => "google/gemini-1.5-flash",
    });
    activeListeners.push(listener);

    stdin.pushLine(JSON.stringify({
      id: "req-2",
      command: "chat",
      args: {
        message: "Hello",
        sessionId: "session-abc",
      },
    }));

    await stdout.waitForLine();

    expect(stdout.lines).toHaveLength(1);
    const resp = JSON.parse(stdout.lines[0]);
    expect(resp.id).toBe("req-2");
    expect(resp.success).toBe(false);
    expect(resp.error).toContain("No model configured");
  });

  it("logs tool execution turns chronologically in the conversation file", async () => {
    const stdin = new MockReadable();
    const stdout = new MockWritable();
    const mockAgent = {
      generate: vi.fn().mockResolvedValue({
        text: "Here is the list of topics.",
        steps: [
          {
            toolCalls: [
              {
                toolCallId: "tc-1",
                toolName: "list_topics",
                args: {},
              },
            ],
            toolResults: [
              {
                toolCallId: "tc-1",
                result: ["work", "personal"],
              },
            ],
          },
        ],
      }),
    } as any;

    const listener = startIPCListener({
      stdin,
      stdout,
      getAgent: () => mockAgent,
      conversationDir,
      runPipeline: vi.fn().mockResolvedValue({ success: true }),
      getModelName: () => "google/gemini-1.5-flash",
    });
    activeListeners.push(listener);

    stdin.pushLine(JSON.stringify({
      id: "req-3",
      command: "chat",
      args: {
        message: "Show me my topics",
        sessionId: "session-tools",
      },
    }));

    await stdout.waitForLine();

    expect(stdout.lines).toHaveLength(1);
    const files = readdirSync(conversationDir);
    const conversationContent = readFileSync(join(conversationDir, files[0]), "utf-8");

    expect(conversationContent).toContain("User\nShow me my topics");
    expect(conversationContent).toContain("Tool: list_topics\n[\n  \"work\",\n  \"personal\"\n]");
    expect(conversationContent).toContain("Pokai\nHere is the list of topics.");
  });

  it("responds with failure response on malformed JSON or invalid commands", async () => {
    const stdin = new MockReadable();
    const stdout = new MockWritable();

    const listener = startIPCListener({
      stdin,
      stdout,
      getAgent: () => ({}) as any,
      conversationDir,
      runPipeline: vi.fn(),
      getModelName: () => "google/gemini-1.5-flash",
    });
    activeListeners.push(listener);

    // Malformed JSON
    stdin.pushLine("{ malformed json }");
    await stdout.waitForLine();
    expect(stdout.lines).toHaveLength(1);
    expect(JSON.parse(stdout.lines[0]).success).toBe(false);

    // Clear and push next
    stdout.clear();
    stdin.pushLine(JSON.stringify({ id: "req-4", command: "unsupported", args: {} }));
    await stdout.waitForLine();
    expect(stdout.lines).toHaveLength(1);
    const resp2 = JSON.parse(stdout.lines[0]);
    expect(resp2.id).toBe("req-4");
    expect(resp2.success).toBe(false);
    expect(resp2.error).toContain("Unknown command");
  });

  it("createConversationSessionFile reuses existing session file even on different dates (prevents midnight splitting)", () => {
    const sessionId = "mid-session-123";
    const pastFilePath = join(conversationDir, `2026-01-01-${sessionId}.md`);
    writeFileSync(pastFilePath, "existing content", "utf-8");

    const resolvedPath = createConversationSessionFile(conversationDir, sessionId, "test-model");
    expect(resolvedPath).toBe(pastFilePath);

    const files = readdirSync(conversationDir);
    expect(files).toHaveLength(1);
    expect(files[0]).toBe(`2026-01-01-${sessionId}.md`);
  });

  it("verifies local timezone timestamps in created session files and parsed conversation session turns", async () => {
    const stdin = new MockReadable();
    const stdout = new MockWritable();
    const mockAgent = {
      generate: vi.fn().mockResolvedValue({
        text: "Response from Pokai!",
        steps: [],
      }),
    } as any;
    const runPipeline = vi.fn().mockResolvedValue({ success: true });

    const listener = startIPCListener({
      stdin,
      stdout,
      getAgent: () => mockAgent,
      conversationDir,
      runPipeline,
      getModelName: () => "google/gemini-1.5-flash",
    });
    activeListeners.push(listener);

    // 1. Send chat message
    stdin.pushLine(JSON.stringify({
      id: "req-local-tz",
      command: "chat",
      args: {
        message: "Hello timezone test",
        sessionId: "session-local-tz",
      },
    }));

    await stdout.waitForLine();

    // 2. Read the created markdown file
    const files = readdirSync(conversationDir);
    const createdFile = files.find(f => f.includes("session-local-tz"));
    expect(createdFile).toBeDefined();
    const filePath = join(conversationDir, createdFile!);
    const markdownContent = readFileSync(filePath, "utf-8");

    // Extract time from ## [HH:mm:ss] User
    const match = markdownContent.match(/##\s+\[(\d{2}:\d{2}:\d{2})\]\s+User/);
    expect(match).not.toBeNull();
    const fileTimestamp = match![1];

    // Verify it matches current local time (HH:mm:ss) within a few seconds tolerance
    const localNow = new Date();
    const pad = (n: number) => n.toString().padStart(2, "0");
    const expectedLocalTime = `${pad(localNow.getHours())}:${pad(localNow.getMinutes())}`;
    
    // Check hours and minutes to avoid flaky tests on second transitions
    expect(fileTimestamp.slice(0, 5)).toBe(expectedLocalTime);

    // 3. Re-read and parse conversation content to simulate switching session and loading back
    const { parseConversationContent } = await import("../src/memory/conversation");
    const parsedSession = parseConversationContent(markdownContent);

    expect(parsedSession.turns).toHaveLength(2); // User + Pokai
    expect(parsedSession.turns[0].timestamp).toBe(fileTimestamp);
    expect(parsedSession.turns[0].timestamp.slice(0, 5)).toBe(expectedLocalTime);
  });
});
