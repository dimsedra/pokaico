import { describe, it, expect } from "vitest";
import { mkdtempSync, mkdirSync, writeFileSync, existsSync, readFileSync, rmSync } from "node:fs";
import { join, basename } from "node:path";
import { tmpdir } from "node:os";
import { createIngestResourceTool } from "../../src/mastra/tools/ingest-resource";
import { createDb, closeDb } from "../../src/db/client";
import { createXbergExtractor, type ResourceExtractor } from "../../src/extract/xberg";

function fakeExtractor(opts: { text?: string; throws?: boolean } = {}) {
  const calls: { filePath: string; ocr?: boolean }[] = [];
  const impl = async (filePath: string, extractOpts?: { ocr?: boolean }): Promise<string> => {
    calls.push({ filePath, ocr: extractOpts?.ocr });
    if (opts.throws) throw new Error("xberg extractor failed");
    return opts.text ?? `extracted text from ${basename(filePath)}`;
  };
  return { extractor: { extract: impl } as unknown as ResourceExtractor, calls };
}

describe("ingest_resource tool", () => {
  it("successfully copies file, extracts content, writes companion .md, and logs to DB", async () => {
    const dir = mkdtempSync(join(tmpdir(), "ir-success-"));
    const dbPath = join(dir, "pokaico.db");
    const db = createDb(dbPath);

    // Setup active topic in DB
    db.prepare("INSERT INTO topics(id, path, summary) VALUES (?, ?, ?)")
      .run("work-topic", "topics/work-topic", "Work summary");

    // Source file to ingest
    const sourceFile = join(dir, "notes.pdf");
    writeFileSync(sourceFile, "%PDF-bytes%");

    const { extractor, calls } = fakeExtractor({ text: "Extracted PDF contents" });
    const tool = createIngestResourceTool({ memoryDir: dir, db, extractor });

    const result = await tool.execute({
      topicId: "work-topic",
      source: sourceFile,
      ocr: true,
    });

    expect(result.success).toBe(true);
    expect(result.content).toBe("Extracted PDF contents");
    expect(result.path).toBe("memory/topics/work-topic/resources/notes.pdf");
    expect(result.error).toBeUndefined();

    // Verify file copy
    const targetFile = join(dir, "topics", "work-topic", "resources", "notes.pdf");
    expect(existsSync(targetFile)).toBe(true);
    expect(readFileSync(targetFile, "utf-8")).toBe("%PDF-bytes%");

    // Verify companion markdown
    const companionFile = targetFile + ".md";
    expect(existsSync(companionFile)).toBe(true);
    expect(readFileSync(companionFile, "utf-8")).toBe("Extracted PDF contents");

    // Verify database record
    const record = db.prepare("SELECT * FROM resources WHERE id = ?")
      .get("memory/topics/work-topic/resources/notes.pdf") as any;
    expect(record).toBeDefined();
    expect(record.topic_id).toBe("work-topic");
    expect(record.kind).toBe("pdf");

    // Verify extractor was called with ocr option
    expect(calls).toHaveLength(1);
    expect(calls[0].filePath).toBe(targetFile);
    expect(calls[0].ocr).toBe(true);

    closeDb(db);
    rmSync(dir, { recursive: true, force: true });
  });

  it("handles markdown files directly without creating companion .md or calling extractor", async () => {
    const dir = mkdtempSync(join(tmpdir(), "ir-md-"));
    const dbPath = join(dir, "pokaico.db");
    const db = createDb(dbPath);

    db.prepare("INSERT INTO topics(id, path, summary) VALUES (?, ?, ?)")
      .run("notes-topic", "topics/notes-topic", "Notes summary");

    const sourceFile = join(dir, "readme.md");
    writeFileSync(sourceFile, "# Readme content");

    const { extractor, calls } = fakeExtractor();
    const tool = createIngestResourceTool({ memoryDir: dir, db, extractor });

    const result = await tool.execute({
      topicId: "notes-topic",
      source: sourceFile,
    });

    expect(result.success).toBe(true);
    expect(result.content).toBe("# Readme content");
    expect(result.path).toBe("memory/topics/notes-topic/resources/readme.md");

    const targetFile = join(dir, "topics", "notes-topic", "resources", "readme.md");
    expect(existsSync(targetFile)).toBe(true);
    expect(readFileSync(targetFile, "utf-8")).toBe("# Readme content");

    // Companion file readme.md.md should NOT exist
    expect(existsSync(targetFile + ".md")).toBe(false);

    // Extractor should not have been called
    expect(calls).toHaveLength(0);

    // Verify DB kind is md
    const record = db.prepare("SELECT * FROM resources WHERE id = ?")
      .get("memory/topics/notes-topic/resources/readme.md") as any;
    expect(record.kind).toBe("md");

    closeDb(db);
    rmSync(dir, { recursive: true, force: true });
  });

  it("fails if target topic does not exist in the database", async () => {
    const dir = mkdtempSync(join(tmpdir(), "ir-notopic-"));
    const dbPath = join(dir, "pokaico.db");
    const db = createDb(dbPath);

    const sourceFile = join(dir, "file.txt");
    writeFileSync(sourceFile, "text");

    const { extractor } = fakeExtractor();
    const tool = createIngestResourceTool({ memoryDir: dir, db, extractor });

    const result = await tool.execute({
      topicId: "missing-topic",
      source: sourceFile,
    });

    expect(result.success).toBe(false);
    expect(result.error).toContain("Topic 'missing-topic' does not exist");
    expect(result.content).toBeNull();

    closeDb(db);
    rmSync(dir, { recursive: true, force: true });
  });

  it("fails if source file does not exist on disk", async () => {
    const dir = mkdtempSync(join(tmpdir(), "ir-nosource-"));
    const dbPath = join(dir, "pokaico.db");
    const db = createDb(dbPath);

    db.prepare("INSERT INTO topics(id, path, summary) VALUES (?, ?, ?)")
      .run("topic", "topics/topic", "summary");

    const { extractor } = fakeExtractor();
    const tool = createIngestResourceTool({ memoryDir: dir, db, extractor });

    const result = await tool.execute({
      topicId: "topic",
      source: join(dir, "non-existent-file.docx"),
    });

    expect(result.success).toBe(false);
    expect(result.error).toContain("Source file not found");

    closeDb(db);
    rmSync(dir, { recursive: true, force: true });
  });

  it("handles extractor errors: copies original, logs to DB, but returns success=false with error details", async () => {
    const dir = mkdtempSync(join(tmpdir(), "ir-error-"));
    const dbPath = join(dir, "pokaico.db");
    const db = createDb(dbPath);

    db.prepare("INSERT INTO topics(id, path, summary) VALUES (?, ?, ?)")
      .run("err-topic", "topics/err-topic", "summary");

    const sourceFile = join(dir, "corrupt.pdf");
    writeFileSync(sourceFile, "bad pdf");

    const { extractor } = fakeExtractor({ throws: true });
    const tool = createIngestResourceTool({ memoryDir: dir, db, extractor });

    const result = await tool.execute({
      topicId: "err-topic",
      source: sourceFile,
    });

    expect(result.success).toBe(false);
    expect(result.error).toContain("xberg extractor failed");
    expect(result.content).toBeNull();

    // The original file should still have been copied to resources
    const targetFile = join(dir, "topics", "err-topic", "resources", "corrupt.pdf");
    expect(existsSync(targetFile)).toBe(true);

    // Companion file should NOT exist
    expect(existsSync(targetFile + ".md")).toBe(false);

    // DB record should still be written (since original was ingested)
    const record = db.prepare("SELECT * FROM resources WHERE id = ?")
      .get("memory/topics/err-topic/resources/corrupt.pdf") as any;
    expect(record).toBeDefined();
    expect(record.kind).toBe("pdf");

    closeDb(db);
    rmSync(dir, { recursive: true, force: true });
  });

  it("rejects unsafe filenames (unsafe chars, dot, double dot)", async () => {
    const dir = mkdtempSync(join(tmpdir(), "ir-unsafe-"));
    const dbPath = join(dir, "pokaico.db");
    const db = createDb(dbPath);

    db.prepare("INSERT INTO topics(id, path, summary) VALUES (?, ?, ?)")
      .run("unsafe-topic", "topics/unsafe-topic", "summary");

    const { extractor } = fakeExtractor();
    const tool = createIngestResourceTool({ memoryDir: dir, db, extractor });

    // Unsafe character in filename
    const result1 = await tool.execute({
      topicId: "unsafe-topic",
      source: "/some/path/file*name.txt",
    });
    expect(result1.success).toBe(false);
    expect(result1.error).toContain("Invalid resource filename");

    // Dot reference
    const result2 = await tool.execute({
      topicId: "unsafe-topic",
      source: "/some/path/.",
    });
    expect(result2.success).toBe(false);
    expect(result2.error).toContain("Invalid resource filename");

    // Double dot reference
    const result3 = await tool.execute({
      topicId: "unsafe-topic",
      source: "/some/path/..",
    });
    expect(result3.success).toBe(false);
    expect(result3.error).toContain("Invalid resource filename");

    closeDb(db);
    rmSync(dir, { recursive: true, force: true });
  });

  it("works with the real Xberg extractor on a text file", async () => {
    const dir = mkdtempSync(join(tmpdir(), "ir-real-"));
    const dbPath = join(dir, "pokaico.db");
    const db = createDb(dbPath);

    db.prepare("INSERT INTO topics(id, path, summary) VALUES (?, ?, ?)")
      .run("real-topic", "topics/real-topic", "Real summary");

    // Source file to ingest
    const sourceFile = join(dir, "notes.txt");
    writeFileSync(sourceFile, "Hello from real text file!");

    const extractor = createXbergExtractor();
    const tool = createIngestResourceTool({ memoryDir: dir, db, extractor });

    const result = await tool.execute({
      topicId: "real-topic",
      source: sourceFile,
    });

    expect(result.success).toBe(true);
    expect(result.content).toBe("Hello from real text file!");
    expect(result.path).toBe("memory/topics/real-topic/resources/notes.txt");

    // Verify companion markdown was written
    const targetFile = join(dir, "topics", "real-topic", "resources", "notes.txt");
    const companionFile = targetFile + ".md";
    expect(existsSync(companionFile)).toBe(true);
    expect(readFileSync(companionFile, "utf-8")).toBe("Hello from real text file!");

    closeDb(db);
    rmSync(dir, { recursive: true, force: true });
  });

  it("allows legitimate relative source paths with traversal segments like ../", async () => {
    const dir = mkdtempSync(join(tmpdir(), "ir-rel-path-"));
    const dbPath = join(dir, "pokaico.db");
    const db = createDb(dbPath);
    db.prepare("INSERT INTO topics(id, path, summary) VALUES (?, ?, ?)")
      .run("topic", "topics/topic", "summary");

    // Create source in parent directory of the temp workspace
    const parentDir = join(dir, "parent");
    mkdirSync(parentDir);
    const sourceFile = join(parentDir, "file.md");
    writeFileSync(sourceFile, "relative file content");

    // Relative source path from the execution directory (using traversal)
    const relativeSource = join(dir, "..", basename(dir), "parent", "file.md");

    const { extractor } = fakeExtractor();
    const tool = createIngestResourceTool({ memoryDir: dir, db, extractor });

    const result = await tool.execute({
      topicId: "topic",
      source: relativeSource,
    });

    expect(result.success).toBe(true);
    expect(result.content).toBe("relative file content");

    closeDb(db);
    rmSync(dir, { recursive: true, force: true });
  });

  it("handles mixed/uppercase markdown extension case-insensitively and skips extractor", async () => {
    const dir = mkdtempSync(join(tmpdir(), "ir-case-md-"));
    const dbPath = join(dir, "pokaico.db");
    const db = createDb(dbPath);
    db.prepare("INSERT INTO topics(id, path, summary) VALUES (?, ?, ?)")
      .run("topic", "topics/topic", "summary");

    const sourceFile = join(dir, "readme.MD");
    writeFileSync(sourceFile, "readme text");

    const { extractor, calls } = fakeExtractor();
    const tool = createIngestResourceTool({ memoryDir: dir, db, extractor });

    const result = await tool.execute({
      topicId: "topic",
      source: sourceFile,
    });

    expect(result.success).toBe(true);
    expect(result.content).toBe("readme text");
    expect(calls).toHaveLength(0); // Extractor not called
    const targetFile = join(dir, "topics", "topic", "resources", "readme.MD");
    expect(existsSync(targetFile + ".md")).toBe(false); // No companion .md.md written

    closeDb(db);
    rmSync(dir, { recursive: true, force: true });
  });

  it("fails if the source file size exceeds the 20MB limit", async () => {
    const dir = mkdtempSync(join(tmpdir(), "ir-size-"));
    const dbPath = join(dir, "pokaico.db");
    const db = createDb(dbPath);
    db.prepare("INSERT INTO topics(id, path, summary) VALUES (?, ?, ?)")
      .run("topic", "topics/topic", "summary");

    const sourceFile = join(dir, "large.txt");
    // Write 21MB file
    writeFileSync(sourceFile, Buffer.alloc(21 * 1024 * 1024));

    const { extractor } = fakeExtractor();
    const tool = createIngestResourceTool({ memoryDir: dir, db, extractor });

    const result = await tool.execute({
      topicId: "topic",
      source: sourceFile,
    });

    expect(result.success).toBe(false);
    expect(result.error).toContain("exceeds maximum size limit");

    closeDb(db);
    rmSync(dir, { recursive: true, force: true });
  });

  it("fails if filename is a directory dot reference '.'", async () => {
    const dir = mkdtempSync(join(tmpdir(), "ir-dot-"));
    const dbPath = join(dir, "pokaico.db");
    const db = createDb(dbPath);
    db.prepare("INSERT INTO topics(id, path, summary) VALUES (?, ?, ?)")
      .run("topic", "topics/topic", "summary");

    const { extractor } = fakeExtractor();
    const tool = createIngestResourceTool({ memoryDir: dir, db, extractor });

    const result = await tool.execute({
      topicId: "topic",
      source: ".",
    });

    expect(result.success).toBe(false);
    expect(result.error).toContain("Invalid resource filename");

    closeDb(db);
    rmSync(dir, { recursive: true, force: true });
  });

  it("fails if the source path is a directory instead of a file", async () => {
    const dir = mkdtempSync(join(tmpdir(), "ir-dir-source-"));
    const dbPath = join(dir, "pokaico.db");
    const db = createDb(dbPath);
    db.prepare("INSERT INTO topics(id, path, summary) VALUES (?, ?, ?)")
      .run("topic", "topics/topic", "summary");

    const sourceDir = join(dir, "subfolder");
    mkdirSync(sourceDir);

    const { extractor } = fakeExtractor();
    const tool = createIngestResourceTool({ memoryDir: dir, db, extractor });

    const result = await tool.execute({
      topicId: "topic",
      source: sourceDir,
    });

    expect(result.success).toBe(false);
    expect(result.error).toContain("not a file");

    closeDb(db);
    rmSync(dir, { recursive: true, force: true });
  });

  it("cleans up the copied file from disk if the database write throws an error", async () => {
    const dir = mkdtempSync(join(tmpdir(), "ir-db-fail-"));
    const dbPath = join(dir, "pokaico.db");
    const db = createDb(dbPath);
    db.prepare("INSERT INTO topics(id, path, summary) VALUES (?, ?, ?)")
      .run("topic", "topics/topic", "summary");

    const sourceFile = join(dir, "notes.pdf");
    writeFileSync(sourceFile, "%PDF%");

    const { extractor } = fakeExtractor();
    const tool = createIngestResourceTool({ memoryDir: dir, db, extractor });

    // Mock db.prepare to throw when writing to resources table
    const originalPrepare = db.prepare;
    db.prepare = function (sql: string) {
      if (sql.includes("INSERT OR REPLACE INTO resources")) {
        return {
          run: () => {
            throw new Error("db write resource failed");
          }
        } as any;
      }
      return originalPrepare.call(db, sql);
    };

    const result = await tool.execute({
      topicId: "topic",
      source: sourceFile,
    });

    expect(result.success).toBe(false);
    expect(result.error).toContain("db write resource failed");

    // The copied file should have been cleaned up and not exist
    const targetFile = join(dir, "topics", "topic", "resources", "notes.pdf");
    expect(existsSync(targetFile)).toBe(false);

    closeDb(db);
    rmSync(dir, { recursive: true, force: true });
  });
});
