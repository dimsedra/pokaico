import { describe, it, expect } from "vitest";
import { mkdtempSync, mkdirSync, readFileSync, rmSync, existsSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { applyChanges } from "../../src/memory/writer";

describe("E3: consecutive topic updates replace CONTEXT.md (compact-on-update)", () => {
  it("keeps only the latest compacted content, no append accumulation", async () => {
    const dir = mkdtempSync(join(tmpdir(), "edge-e3-"));
    const memoryDir = join(dir, "memory");
    mkdirSync(join(memoryDir, "topics"), { recursive: true });

    await applyChanges(
      [{ topicId: "growing-topic", action: "create", content: "Initial state: topic about learning." }],
      memoryDir,
      "s1", 1000,
    );

    for (let i = 1; i <= 50; i++) {
      await applyChanges(
        [{ topicId: "growing-topic", action: "update", content: `Update #${i}: More learning progress recorded here.` }],
        memoryDir,
        `s${i + 1}`, 2000 + i,
      );
    }

    const content = readFileSync(join(memoryDir, "topics", "growing-topic", "CONTEXT.md"), "utf-8");
    const resourcesDir = join(memoryDir, "topics", "growing-topic", "resources");

    // Update replaces the file with the (already-compacted) content — no append/merge.
    expect(content.trim()).toBe("[src:s51:2050]\n\nUpdate #50: More learning progress recorded here.");
    expect(content).not.toContain("Initial state");
    expect(content).not.toContain("Update #1:");
    // No overflow supplied → no resources/ directory created.
    expect(existsSync(resourcesDir)).toBe(false);

    rmSync(dir, { recursive: true, force: true });
  });

  it("writes overflow to resources/ when the update carries overflow", async () => {
    const dir = mkdtempSync(join(tmpdir(), "edge-e3-overflow-"));
    const memoryDir = join(dir, "memory");
    mkdirSync(join(memoryDir, "topics"), { recursive: true });

    await applyChanges(
      [{ topicId: "spilling-topic", action: "create", content: "Lean summary." }],
      memoryDir,
      "s1", 1000,
    );

    await applyChanges(
      [
        {
          topicId: "spilling-topic",
          action: "update",
          content: "Lean summary. See [notes](resources/details.md).",
          overflow: [{ filename: "details.md", content: "Overflowed detail.", relationship: "has-detailed-notes" }],
        },
      ],
      memoryDir,
      "s2", 2000,
    );

    const resource = readFileSync(join(memoryDir, "topics", "spilling-topic", "resources", "details.md"), "utf-8");
    expect(resource).toBe("Overflowed detail.");

    rmSync(dir, { recursive: true, force: true });
  });
});

describe("E8: Path traversal via topicId in writer", () => {
  it("rejects ../ in topicId and writes nothing outside memoryDir", async () => {
    const dir = mkdtempSync(join(tmpdir(), "edge-e8-"));
    const memoryDir = join(dir, "memory");
    mkdirSync(join(memoryDir, "topics"), { recursive: true });

    await expect(
      applyChanges(
        [{ topicId: "../../escaped-file", action: "create", content: "Should NOT be outside!" }],
        memoryDir,
        "malicious", 9999,
      ),
    ).rejects.toThrow(/Invalid topicId/);

    expect(existsSync(join(dir, "escaped-file.txt"))).toBe(false);
    expect(existsSync(join(dir, "escaped-file", "CONTEXT.md"))).toBe(false);

    rmSync(dir, { recursive: true, force: true });
  });

  it("rejects an absolute Windows path in topicId", async () => {
    const dir = mkdtempSync(join(tmpdir(), "edge-e8b-"));
    const memoryDir = join(dir, "memory");
    mkdirSync(join(memoryDir, "topics"), { recursive: true });

    await expect(
      applyChanges(
        [{ topicId: "C:\\hijacked-path", action: "create", content: "Absolute path attack!" }],
        memoryDir,
        "malicious", 9999,
      ),
    ).rejects.toThrow(/Invalid topicId/);

    expect(existsSync("C:\\hijacked-path\\CONTEXT.md")).toBe(false);

    rmSync(dir, { recursive: true, force: true });
  });
});
