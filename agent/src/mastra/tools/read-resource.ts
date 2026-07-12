import { createTool } from "@mastra/core/tools";
import { z } from "zod";
import { join } from "node:path";
import { readFileSync } from "node:fs";
import { VALID_TOPIC_RE, resourcesDir } from "../../memory/topics";
import type { ResourceExtractor } from "../../extract/xberg";

// Resource filenames are flat entries inside a topic's resources/ dir. A positive
// allowlist (not a blocklist) keeps path separators, "..", and control bytes
// (e.g. NUL) out — path-traversal / invalid-arg hardening.
const SAFE_RESOURCE_RE = /^[A-Za-z0-9._-]+$/;
function isSafeResource(name: string): boolean {
  return SAFE_RESOURCE_RE.test(name) && !name.includes("..");
}

// Read directly; a missing file (ENOENT) is "not present", anything else
// (race, permission) propagates to the outer guard. Avoids the
// existsSync→readFileSync TOCTOU window.
function tryRead(path: string): string | null {
  try {
    return readFileSync(path, "utf-8");
  } catch (err) {
    if (err instanceof Error && (err as NodeJS.ErrnoException).code === "ENOENT") return null;
    throw err;
  }
}

function errorMessage(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

export const createReadResourceTool = (deps: {
  memoryDir: string;
  extractor: ResourceExtractor;
}) =>
  createTool({
    id: "read_resource",
    description:
      "Read a resource file belonging to a topic. Markdown resources are read directly; for other formats it reads the companion .md (produced earlier by extraction) when present, otherwise extracts clean text from the original file via Xberg. Returns the text so the agent can use doc content in context.",
    inputSchema: z.object({
      topicId: z
        .string()
        .regex(VALID_TOPIC_RE)
        .describe("Topic slug the resource belongs to, e.g. 'work'"),
      resource: z
        .string()
        .refine(isSafeResource, "must be a flat filename with no path separators, '..', or control characters")
        .describe("Resource filename, e.g. 'calendar.pdf' (companion is 'calendar.pdf.md')"),
    }),
    outputSchema: z.object({
      content: z.string().nullable(),
      exists: z.boolean(),
      source: z.enum(["companion-md", "extracted"]).nullable(),
      error: z.string().optional(),
    }),
    execute: async ({ topicId, resource }, _ctx) => {
      const { memoryDir, extractor } = deps;
      const base = join(resourcesDir(memoryDir, topicId), resource);

      try {
        // Markdown resources are already clean text — read directly.
        if (resource.endsWith(".md")) {
          const content = tryRead(base);
          return content === null
            ? { content: null, exists: false, source: null }
            : { content, exists: true, source: "companion-md" as const };
        }

        // Fast path: the companion .md already holds Xberg-normalized text.
        const companion = tryRead(`${base}.md`);
        if (companion !== null) {
          return { content: companion, exists: true, source: "companion-md" as const };
        }

        // Fallback: original blob present → extract clean text via Xberg.
        if (tryRead(base) === null) {
          return { content: null, exists: false, source: null };
        }
        try {
          const content = await extractor.extract(base);
          return { content, exists: true, source: "extracted" as const };
        } catch (err) {
          return { content: null, exists: true, source: null, error: errorMessage(err) };
        }
      } catch (err) {
        // FS race / invalid path arg (e.g. control byte) — degrade gracefully.
        return { content: null, exists: false, source: null, error: errorMessage(err) };
      }
    },
  });
