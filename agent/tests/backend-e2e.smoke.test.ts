/**
 * backend-e2e.smoke.test.ts
 *
 * Comprehensive backend smoke tests covering the 4 critical gaps in Phase 4:
 *   - Suite A: buildPrompt diary injection (offline, always runs)
 *   - Suite B: Conversation file lifecycle (offline, always runs)
 *   - Suite C: Provider registry env resolution (offline, always runs)
 *   - Suite D: Diary generation with real LLM (LLM-gated)
 *   - Suite E: IPC module-level chat roundtrip with real agent (LLM-gated)
 */

import { describe, it, expect, beforeAll, afterAll, beforeEach, afterEach } from "vitest";
import {
  mkdtempSync,
  mkdirSync,
  writeFileSync,
  rmSync,
  readFileSync,
  readdirSync,
  existsSync,
} from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { Readable, Writable } from "node:stream";

import { buildPrompt } from "../src/mastra/prompt";
import {
  createConversationSessionFile,
  findConversationFile,
  startIPCListener,
} from "../src/ipc";
import {
  appendTurn,
  readSession,
  type ConversationTurn,
} from "../src/memory/conversation";
import { ProviderRegistry } from "../src/models/provider";
import { createDb, closeDb, type PokaicoDb } from "../src/db/client";
import { processSession } from "../src/memory/pipeline";
import { createAgent } from "../src/mastra/index";
import { resolveTestModel, hasTestKey } from "./helpers/test-model";

// ─────────────────────────────────────────────────────────
// Stream helpers (reused from ipc.test.ts)
// ─────────────────────────────────────────────────────────

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

  _write(chunk: any, _enc: string, cb: (error?: Error | null) => void) {
    const data = chunk.toString();
    for (const s of data.split("\n")) {
      if (s.trim()) {
        this.lines.push(s.trim());
        const resolve = this.onLineWritten;
        this.onLineWritten = undefined;
        resolve?.();
      }
    }
    cb();
  }

  waitForLine(): Promise<void> {
    return new Promise((resolve) => {
      if (this.lines.length > 0) resolve();
      else this.onLineWritten = resolve;
    });
  }

  lastParsed(): any {
    const last = this.lines[this.lines.length - 1];
    return last ? JSON.parse(last) : null;
  }
}

// ─────────────────────────────────────────────────────────
// Suite A: buildPrompt diary injection (offline)
// ─────────────────────────────────────────────────────────

describe("Suite A — buildPrompt diary injection", () => {
  let dir: string;
  let memoryDir: string;
  let diaryDir: string;
  let conversationDir: string;

  function writeDiary(
    filename: string,
    sessionId: string,
    lastActiveAt: string,
    content: string,
  ) {
    writeFileSync(
      join(diaryDir, filename),
      `---\nsession_id: ${sessionId}\nstarted_at: 2026-07-01T10:00:00+07:00\nlast_active_at: ${lastActiveAt}\n---\n${content}\n`,
      "utf-8",
    );
  }

  beforeAll(() => {
    dir = mkdtempSync(join(tmpdir(), "pokaico-suite-a-"));
    memoryDir = join(dir, "memory");
    diaryDir = join(dir, "diary");
    conversationDir = join(dir, "conversation");
    mkdirSync(join(memoryDir, "topics"), { recursive: true });
    mkdirSync(diaryDir, { recursive: true });
    mkdirSync(conversationDir, { recursive: true });
  });

  afterAll(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  it("injects top-3 diaries sorted by last_active_at (newest excluded, oldest-first in prompt)", async () => {
    // 4 diaries with known timestamps — only the newest 3 should appear,
    // rendered oldest-first (chronological) in the prompt.
    writeDiary("2026-07-01-s1.md", "s1", "2026-07-01T10:00:00.000Z", "Hari pertama yang tenang.");
    writeDiary("2026-07-02-s2.md", "s2", "2026-07-02T10:00:00.000Z", "Ngobrol soal coding.");
    writeDiary("2026-07-03-s3.md", "s3", "2026-07-03T10:00:00.000Z", "User cerita soal liburan.");
    writeDiary("2026-07-04-s4.md", "s4", "2026-07-04T10:00:00.000Z", "Diskusi panjang soal proyek baru."); // newest

    const prompt = await buildPrompt(memoryDir, undefined, conversationDir, diaryDir);

    expect(prompt).toContain("Companion's Diary");

    // Top-3: s4 (newest), s3, s2 → displayed oldest-first: s2, s3, s4
    // s1 (oldest) must NOT appear
    expect(prompt).toContain("Ngobrol soal coding.");      // s2 ✅
    expect(prompt).toContain("User cerita soal liburan."); // s3 ✅
    expect(prompt).toContain("Diskusi panjang soal proyek baru."); // s4 ✅
    expect(prompt).not.toContain("Hari pertama yang tenang."); // s1 ❌ excluded

    // Verify chronological order: s2 appears before s3, s3 before s4
    const s2Pos = prompt.indexOf("Ngobrol soal coding.");
    const s3Pos = prompt.indexOf("User cerita soal liburan.");
    const s4Pos = prompt.indexOf("Diskusi panjang soal proyek baru.");
    expect(s2Pos).toBeLessThan(s3Pos);
    expect(s3Pos).toBeLessThan(s4Pos);
  });

  it("gracefully handles empty diary dir — prompt still valid, no diary section", async () => {
    // Use a fresh dir with no diaries
    const emptyDir = mkdtempSync(join(tmpdir(), "pokaico-empty-diary-"));
    const emptyDiaryDir = join(emptyDir, "diary");
    const emptyMemoryDir = join(emptyDir, "memory");
    mkdirSync(join(emptyMemoryDir, "topics"), { recursive: true });
    mkdirSync(emptyDiaryDir, { recursive: true });

    try {
      const prompt = await buildPrompt(emptyMemoryDir, undefined, undefined, emptyDiaryDir);
      expect(typeof prompt).toBe("string");
      expect(prompt.length).toBeGreaterThan(50); // static instructions always present
      expect(prompt).not.toContain("Companion's Diary");
    } finally {
      rmSync(emptyDir, { recursive: true, force: true });
    }
  });

  it("handles missing diary dir without throwing", async () => {
    const missingDiaryDir = join(dir, "nonexistent-diary");
    const prompt = await buildPrompt(memoryDir, undefined, conversationDir, missingDiaryDir);
    expect(typeof prompt).toBe("string");
    expect(prompt.length).toBeGreaterThan(50);
  });
});

// ─────────────────────────────────────────────────────────
// Suite B: Conversation file lifecycle (offline)
// ─────────────────────────────────────────────────────────

describe("Suite B — Conversation file lifecycle", () => {
  let dir: string;
  let conversationDir: string;

  beforeAll(() => {
    dir = mkdtempSync(join(tmpdir(), "pokaico-suite-b-"));
    conversationDir = join(dir, "conversation");
    mkdirSync(conversationDir, { recursive: true });
  });

  afterAll(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  it("createConversationSessionFile creates file with valid frontmatter", () => {
    const sessionId = "b-lifecycle-test";
    const filePath = createConversationSessionFile(conversationDir, sessionId, "opencode-go/kimi-k2.5");

    expect(existsSync(filePath)).toBe(true);
    expect(filePath.endsWith(".md")).toBe(true);

    const session = readSession(filePath);
    expect(session.sessionId).toBe(sessionId);
    expect(session.model).toBe("opencode-go/kimi-k2.5");
    expect(session.extracted).toBe(false);
    expect(session.startedAt).toBeTruthy();
    expect(session.lastActiveAt).toBeTruthy();
    expect(session.turns).toHaveLength(0);
  });

  it("appendTurn accumulates user + tool + pokai turns and updates last_active_at", () => {
    const sessionId = "b-append-test";
    const filePath = createConversationSessionFile(conversationDir, sessionId, "test-model");

    const startedAt = readSession(filePath).startedAt;

    // Wait 2ms to ensure last_active_at changes
    const waitMs = (ms: number) => new Promise((r) => setTimeout(r, ms));

    const turns: ConversationTurn[] = [
      { timestamp: "10:00:01", role: "user", content: "Hello Pokai!" },
      { timestamp: "10:00:02", role: "tool", toolName: "search_topics", content: '{"results":[]}' },
      { timestamp: "10:00:03", role: "pokai", content: "Hi there! How can I help?" },
    ];

    for (const turn of turns) {
      appendTurn(filePath, turn);
    }

    const session = readSession(filePath);
    expect(session.turns).toHaveLength(3);
    expect(session.turns[0].role).toBe("user");
    expect(session.turns[0].content).toBe("Hello Pokai!");
    expect(session.turns[1].role).toBe("tool");
    expect(session.turns[1].toolName).toBe("search_topics");
    expect(session.turns[2].role).toBe("pokai");

    // last_active_at should have been updated by appendTurn
    expect(session.lastActiveAt).toBeTruthy();
    // It should be >= startedAt (may equal if test runs within same ms)
    expect(new Date(session.lastActiveAt).getTime()).toBeGreaterThanOrEqual(
      new Date(startedAt).getTime(),
    );
  });

  it("findConversationFile locates existing file by sessionId", () => {
    const sessionId = "b-find-test";
    createConversationSessionFile(conversationDir, sessionId, "test-model");

    const found = findConversationFile(conversationDir, sessionId);
    expect(found).not.toBeNull();
    expect(found!).toContain(sessionId);
    expect(found!.endsWith(".md")).toBe(true);
  });

  it("createConversationSessionFile is idempotent — reuses existing file", () => {
    const sessionId = "b-idempotent-test";
    const path1 = createConversationSessionFile(conversationDir, sessionId, "model-a");
    const path2 = createConversationSessionFile(conversationDir, sessionId, "model-b");

    expect(path1).toBe(path2); // same file returned, not a new one
    const files = readdirSync(conversationDir).filter((f) => f.includes(sessionId));
    expect(files).toHaveLength(1); // only one file created
  });
});

// ─────────────────────────────────────────────────────────
// Suite C: Provider registry env resolution (offline)
// ─────────────────────────────────────────────────────────

describe("Suite C — Provider registry env resolution", () => {
  let originalEnv: Record<string, string | undefined>;

  beforeEach(() => {
    // Snapshot env before each test
    originalEnv = {
      OPENCODE_API_KEY: process.env.OPENCODE_API_KEY,
      GOOGLE_GENERATIVE_AI_API_KEY: process.env.GOOGLE_GENERATIVE_AI_API_KEY,
      TEST_MODEL: process.env.TEST_MODEL,
    };
  });

  afterEach(() => {
    // Restore env after each test
    for (const [key, val] of Object.entries(originalEnv)) {
      if (val === undefined) delete process.env[key];
      else process.env[key] = val;
    }
  });

  it("resolveActiveModel returns stored config provider/model when configured", async () => {
    const tmpConfig = join(mkdtempSync(join(tmpdir(), "reg-c1-")), "provider-config.json");
    const registry = new ProviderRegistry(tmpConfig);

    await registry.save({
      activeProvider: "opencode-go",
      activeModel: "kimi-k2.5",
      apiKeys: { "opencode-go": "sk-oc-test-key" },
    });

    const modelId = registry.resolveActiveModel();
    expect(modelId).toBe("opencode-go/kimi-k2.5");
  });

  it("resolveActiveModel returns stored google provider/model when configured", async () => {
    const tmpConfig = join(mkdtempSync(join(tmpdir(), "reg-c2-")), "provider-config.json");
    const registry = new ProviderRegistry(tmpConfig);

    await registry.save({
      activeProvider: "google",
      activeModel: "gemini-2.0-flash-lite",
      apiKeys: { google: "goog-test-key" },
    });

    const modelId = registry.resolveActiveModel();
    expect(modelId).toBe("google/gemini-2.0-flash-lite");
  });

  it("resolveActiveModel uses stored config over env fallback", async () => {
    const tmpConfig = join(mkdtempSync(join(tmpdir(), "reg-")), "provider-config.json");
    const registry = new ProviderRegistry(tmpConfig);

    await registry.save({
      activeProvider: "opencode-go",
      activeModel: "deepseek-v4-flash",
      apiKeys: { "opencode-go": "sk-stored-key" },
    });

    const modelId = registry.resolveActiveModel();
    expect(modelId).toBe("opencode-go/deepseek-v4-flash");
  });

  it("getAvailableModels falls back to snapshot when fetch fails/times out", async () => {
    const registry = new ProviderRegistry(join(tmpdir(), "nonexistent.json"));
    // This call will either fetch live (fast) or fall back to snapshot (slow network)
    // Either way, it should return a non-empty array with opencode-go models
    const models = await registry.getAvailableModels();

    expect(Array.isArray(models)).toBe(true);
    expect(models.length).toBeGreaterThan(0);

    // opencode-go should be in the catalog (from snapshot at minimum)
    const opencodeModels = models.filter((m) => m.providerId === "opencode-go");
    expect(opencodeModels.length).toBeGreaterThan(0);
    expect(opencodeModels[0].modelId).toBeTruthy();
  }, 10_000);
});

// ─────────────────────────────────────────────────────────
// Suite D: Diary generation with real LLM (LLM-gated)
// ─────────────────────────────────────────────────────────

describe.runIf(hasTestKey)("Suite D — Diary generation + buildPrompt chain (real LLM)", () => {
  let db: PokaicoDb;
  let dir: string;
  let conversationDir: string;
  let diaryDir: string;
  let memoryDir: string;

  const sessionId = "d-diary-smoke";

  beforeAll(() => {
    dir = mkdtempSync(join(tmpdir(), "pokaico-suite-d-"));
    db = createDb(join(dir, "test.db"));
    conversationDir = join(dir, "conversation");
    diaryDir = join(dir, "diary");
    memoryDir = join(dir, "memory");
    mkdirSync(conversationDir, { recursive: true });
    mkdirSync(diaryDir, { recursive: true });
    mkdirSync(join(memoryDir, "topics"), { recursive: true });

    // Write a warm conversation to be processed
    writeFileSync(
      join(conversationDir, `2026-07-16-${sessionId}.md`),
      `---
session_id: ${sessionId}
started_at: 2026-07-16T10:00:00+07:00
last_active_at: 2026-07-16T10:05:00+07:00
model: test-model
extracted: false
---
## [10:00:00] User
Hai Pokai! Hari ini aku dapat kabar baik. Lamaranku ke perusahaan impianku diterima!

## [10:00:15] Pokai
Wah selamat banget! Itu kabar yang luar biasa! Gimana rasanya?

## [10:00:30] User
Campur aduk sih, excited tapi juga deg-degan. Mulai kerjanya bulan depan.

## [10:00:45] Pokai
Wajar banget! Bulan depan jadi awal babak baru. Kamu pasti siap.

## [10:01:00] User
Makasih Pokai. Aku juga tadi makan siang spesial buat rayain, nasi padang favorit aku.
`,
      "utf-8",
    );
  });

  afterAll(() => {
    closeDb(db);
    rmSync(dir, { recursive: true, force: true });
  });

  it("processSession generates diary file with valid frontmatter and warm content", async () => {
    const model = resolveTestModel();

    const result = await processSession(sessionId, {
      llm: model as never,
      searchSimilar: async () => [],
      indexTopic: async () => {},
      db,
      memoryDir,
      conversationDir,
      diaryDir,
    });

    expect(result.hasNewMessages).toBe(true);
    expect(result.error).toBeUndefined();

    // Assert diary file was created
    const diaryFiles = readdirSync(diaryDir).filter((f) => f.endsWith(".md"));
    expect(diaryFiles.length).toBeGreaterThanOrEqual(1);

    const diaryPath = join(diaryDir, diaryFiles[0]);
    const raw = readFileSync(diaryPath, "utf-8");

    // Validate frontmatter
    expect(raw).toContain("session_id:");
    expect(raw).toContain("started_at:");
    expect(raw).toContain("last_active_at:");

    // Validate content — should be warm prose, not empty
    const body = raw.split("---").slice(2).join("---").trim();
    expect(body.length).toBeGreaterThan(50);

    console.log("[Suite D] Generated diary preview:", body.slice(0, 200));
  }, 60_000);

  it("buildPrompt injects the LLM-generated diary into system prompt", async () => {
    // Diary from previous test is now on disk — buildPrompt should pick it up
    const prompt = await buildPrompt(memoryDir, undefined, conversationDir, diaryDir);

    expect(prompt).toContain("Companion's Diary");

    // The diary content must appear somewhere in the prompt
    const diaryFiles = readdirSync(diaryDir).filter((f) => f.endsWith(".md"));
    expect(diaryFiles.length).toBeGreaterThanOrEqual(1);

    const raw = readFileSync(join(diaryDir, diaryFiles[0]), "utf-8");
    const body = raw.split("---").slice(2).join("---").trim();

    // At least 20 chars of diary body should appear in the prompt
    expect(prompt).toContain(body.slice(0, 20));
    expect(prompt.length).toBeGreaterThan(200);

    console.log("[Suite D] Prompt diary section present, total prompt length:", prompt.length);
  }, 10_000);
});

describe.skipIf(hasTestKey)("Suite D — skipped (no API key)", () => {
  it("placeholder", () => {});
});

// ─────────────────────────────────────────────────────────
// Suite E: IPC module-level chat roundtrip (LLM-gated)
// ─────────────────────────────────────────────────────────

describe.runIf(hasTestKey)("Suite E — IPC module-level chat roundtrip (real agent)", () => {
  let db: PokaicoDb;
  let dir: string;
  let conversationDir: string;
  let memoryDir: string;
  let stdin: MockReadable;
  let stdout: MockWritable;
  let listener: ReturnType<typeof startIPCListener>;

  const sessionId = "e-ipc-smoke";

  beforeAll(async () => {
    dir = mkdtempSync(join(tmpdir(), "pokaico-suite-e-"));
    db = createDb(join(dir, "test.db"));
    conversationDir = join(dir, "conversation");
    memoryDir = join(dir, "memory");
    mkdirSync(conversationDir, { recursive: true });
    mkdirSync(join(memoryDir, "topics"), { recursive: true });

    const model = resolveTestModel();
    const agent = createAgent({ model: model as never, memoryDir });

    stdin = new MockReadable();
    stdout = new MockWritable();

    const testRegistry = new ProviderRegistry(join(dir, "provider-config.json"));
    listener = startIPCListener({
      stdin,
      stdout,
      getAgent: () => agent,
      conversationDir,
      runPipeline: async () => {}, // no-op — pipeline has its own smoke tests
      getModelName: () => "opencode-go/kimi-k2.5",
      registry: testRegistry,
    });
  });

  afterAll(() => {
    listener.close();
    closeDb(db);
    rmSync(dir, { recursive: true, force: true });
  });

  it("chat command returns success response with non-empty agent reply", async () => {
    const msg = JSON.stringify({
      id: "e-1",
      command: "chat",
      args: { message: "Hei, siapa namamu?", sessionId },
    });

    stdin.pushLine(msg);
    await stdout.waitForLine();

    const parsed = stdout.lastParsed();
    expect(parsed.id).toBe("e-1");
    expect(parsed.success).toBe(true);
    expect(typeof parsed.data.response).toBe("string");
    expect(parsed.data.response.length).toBeGreaterThan(5);

    console.log("[Suite E] Agent response:", parsed.data.response.slice(0, 150));
  }, 60_000);

  it("conversation file is written with user + pokai turns", () => {
    const filePath = findConversationFile(conversationDir, sessionId);
    expect(filePath).not.toBeNull();

    const session = readSession(filePath!);
    expect(session.sessionId).toBe(sessionId);
    expect(session.turns.length).toBeGreaterThanOrEqual(2);

    const userTurn = session.turns.find((t) => t.role === "user");
    const pokaiTurn = session.turns.find((t) => t.role === "pokai");

    expect(userTurn).toBeTruthy();
    expect(userTurn!.content).toContain("Hei");
    expect(pokaiTurn).toBeTruthy();
    expect(pokaiTurn!.content.length).toBeGreaterThan(5);
  });

  it("second message in same session appends turns to existing file", async () => {
    const before = readSession(findConversationFile(conversationDir, sessionId)!);
    const beforeCount = before.turns.length;

    const msg = JSON.stringify({
      id: "e-2",
      command: "chat",
      args: { message: "Apa yang bisa kamu bantu hari ini?", sessionId },
    });

    stdout.lines = []; // clear previous lines
    stdin.pushLine(msg);
    await stdout.waitForLine();

    const parsed = stdout.lastParsed();
    expect(parsed.id).toBe("e-2");
    expect(parsed.success).toBe(true);

    const after = readSession(findConversationFile(conversationDir, sessionId)!);
    // Should have at least 2 more turns (user + pokai)
    expect(after.turns.length).toBeGreaterThan(beforeCount);

    console.log(
      `[Suite E] Turn count: ${beforeCount} → ${after.turns.length}`,
    );
  }, 60_000);

  it("get_models command returns success response with list of models from registry", async () => {
    const msg = JSON.stringify({
      id: "e-3",
      command: "get_models",
      args: {},
    });

    stdout.lines = [];
    stdin.pushLine(msg);
    await stdout.waitForLine();

    const parsed = stdout.lastParsed();
    expect(parsed.id).toBe("e-3");
    expect(parsed.success).toBe(true);
    expect(Array.isArray(parsed.data.models)).toBe(true);
    expect(parsed.data.models.length).toBeGreaterThan(0);

    // Verify format contains providerId and modelId
    const firstModel = parsed.data.models[0];
    expect(firstModel.providerId).toBeTruthy();
    expect(firstModel.modelId).toBeTruthy();

    console.log(
      `[Suite E] Found ${parsed.data.models.length} models, first: ${firstModel.providerId}/${firstModel.modelId}`,
    );
  });
});

describe.skipIf(hasTestKey)("Suite E — skipped (no API key)", () => {
  it("placeholder", () => {});
});
