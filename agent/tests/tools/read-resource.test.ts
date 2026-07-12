import { describe, it, expect } from "vitest";
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { createReadResourceTool } from "../../src/mastra/tools/read-resource";
import type { ResourceExtractor } from "../../src/extract/xberg";

// Fake extractor: returns canned text without touching Xberg/Rust. Counts calls.
function fakeExtractor(opts: { text?: string; throws?: boolean } = {}) {
  const calls: string[] = [];
  const impl = async (p: string): Promise<string> => {
    calls.push(p);
    if (opts.throws) throw new Error("xberg boom");
    return opts.text ?? `extracted:${p}`;
  };
  return { extractor: { extract: impl } as ResourceExtractor, calls };
}

describe("read_resource tool", () => {
  it("reads the companion .md without calling the extractor", async () => {
    const dir = mkdtempSync(join(tmpdir(), "rr-companion-"));
    const rd = join(dir, "topics", "work", "resources");
    mkdirSync(rd, { recursive: true });
    writeFileSync(join(rd, "calendar.pdf.md"), "Clean calendar text.");
    writeFileSync(join(rd, "calendar.pdf"), "%PDF-raw-bytes%");

    const { extractor, calls } = fakeExtractor();
    const tool = createReadResourceTool({ memoryDir: dir, extractor });
    const result = await tool.execute({ topicId: "work", resource: "calendar.pdf" });

    expect(result.exists).toBe(true);
    expect(result.source).toBe("companion-md");
    expect(result.content).toBe("Clean calendar text.");
    expect(calls.length).toBe(0);
    rmSync(dir, { recursive: true, force: true });
  });

  it("falls back to the extractor on the original when no companion .md", async () => {
    const dir = mkdtempSync(join(tmpdir(), "rr-fallback-"));
    const rd = join(dir, "topics", "research", "resources");
    mkdirSync(rd, { recursive: true });
    writeFileSync(join(rd, "paper.docx"), "<docx raw>");

    const { extractor, calls } = fakeExtractor({ text: "Extracted docx body." });
    const tool = createReadResourceTool({ memoryDir: dir, extractor });
    const result = await tool.execute({ topicId: "research", resource: "paper.docx" });

    expect(result.exists).toBe(true);
    expect(result.source).toBe("extracted");
    expect(result.content).toBe("Extracted docx body.");
    expect(calls).toEqual([join(rd, "paper.docx")]);
    rmSync(dir, { recursive: true, force: true });
  });

  it("returns exists=false when neither companion nor original exists", async () => {
    const dir = mkdtempSync(join(tmpdir(), "rr-missing-"));
    mkdirSync(join(dir, "topics", "x", "resources"), { recursive: true });

    const { extractor } = fakeExtractor();
    const tool = createReadResourceTool({ memoryDir: dir, extractor });
    const result = await tool.execute({ topicId: "x", resource: "ghost.pdf" });

    expect(result.exists).toBe(false);
    expect(result.content).toBeNull();
    expect(result.source).toBeNull();
    rmSync(dir, { recursive: true, force: true });
  });

  it("rejects path traversal in resource", async () => {
    const dir = mkdtempSync(join(tmpdir(), "rr-traverse-"));
    mkdirSync(join(dir, "topics", "x"), { recursive: true });

    const { extractor } = fakeExtractor();
    const tool = createReadResourceTool({ memoryDir: dir, extractor });
    const result = (await tool.execute({ topicId: "x", resource: "../../etc/passwd" })) as {
      error?: boolean;
      message?: string;
    };
    expect(result.error).toBe(true);
    expect(result.message ?? "").toContain("resource");
    rmSync(dir, { recursive: true, force: true });
  });

  it("reads a .md resource directly without double-suffixing", async () => {
    const dir = mkdtempSync(join(tmpdir(), "rr-md-"));
    const rd = join(dir, "topics", "notes", "resources");
    mkdirSync(rd, { recursive: true });
    writeFileSync(join(rd, "ideas.md"), "Markdown ideas.");

    const { extractor, calls } = fakeExtractor();
    const tool = createReadResourceTool({ memoryDir: dir, extractor });
    const result = await tool.execute({ topicId: "notes", resource: "ideas.md" });

    expect(result.exists).toBe(true);
    expect(result.source).toBe("companion-md");
    expect(result.content).toBe("Markdown ideas.");
    expect(calls.length).toBe(0);
    rmSync(dir, { recursive: true, force: true });
  });

  it("returns empty content (no error) when the extractor yields an empty string", async () => {
    const dir = mkdtempSync(join(tmpdir(), "rr-empty-"));
    const rd = join(dir, "topics", "x", "resources");
    mkdirSync(rd, { recursive: true });
    writeFileSync(join(rd, "doc.pdf"), "%PDF%");

    const { extractor } = fakeExtractor({ text: "" });
    const tool = createReadResourceTool({ memoryDir: dir, extractor });
    const result = await tool.execute({ topicId: "x", resource: "doc.pdf" });

    expect(result.exists).toBe(true);
    expect(result.source).toBe("extracted");
    expect(result.content).toBe("");
    expect(result.error).toBeUndefined();
    rmSync(dir, { recursive: true, force: true });
  });

  it("rejects control-character filenames at the schema layer", async () => {
    const dir = mkdtempSync(join(tmpdir(), "rr-ctrl-"));
    mkdirSync(join(dir, "topics", "x"), { recursive: true });

    const { extractor } = fakeExtractor();
    const tool = createReadResourceTool({ memoryDir: dir, extractor });
    const result = (await tool.execute({ topicId: "x", resource: "a\x00b" })) as {
      error?: boolean;
      message?: string;
    };
    expect(result.error).toBe(true);
    expect(result.message ?? "").toContain("resource");
    rmSync(dir, { recursive: true, force: true });
  });

  it("degrades gracefully when the extractor throws", async () => {
    const dir = mkdtempSync(join(tmpdir(), "rr-extractfail-"));
    const rd = join(dir, "topics", "x", "resources");
    mkdirSync(rd, { recursive: true });
    writeFileSync(join(rd, "doc.pdf"), "%PDF%");

    const { extractor } = fakeExtractor({ throws: true });
    const tool = createReadResourceTool({ memoryDir: dir, extractor });
    const result = await tool.execute({ topicId: "x", resource: "doc.pdf" });

    expect(result.exists).toBe(true);
    expect(result.source).toBeNull();
    expect(result.content).toBeNull();
    expect(typeof result.error).toBe("string");
    rmSync(dir, { recursive: true, force: true });
  });
});
