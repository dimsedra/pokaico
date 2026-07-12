import { createTool } from "@mastra/core/tools";
import { z } from "zod";
import { join } from "node:path";
import { existsSync, readFileSync } from "node:fs";
import { VALID_TOPIC_RE, resourcesDir } from "../../memory/topics";
import type { ResourceExtractor } from "../../extract/xberg";

// Resource filenames are flat entries inside a topic's resources/ dir — no
// path separators, no ".." segments (path-traversal guard). Topic slug is
// already constrained by VALID_TOPIC_RE.
const SAFE_RESOURCE_RE = /^[^\/\\]+$/;
function isSafeResource(name: string): boolean {
  return SAFE_RESOURCE_RE.test(name) && !name.includes("..");
}

export const createReadResourceTool = (deps: {
  memoryDir: string;
  extractor: ResourceExtractor;
}) =>
  createTool({
    id: "read_resource",
    description:
      "Read a resource file belonging to a topic. Reads the companion .md (produced earlier by extraction) when present; otherwise extracts clean text from the original file via Xberg. Returns the text so the agent can use doc content in context.",
    inputSchema: z.object({
      topicId: z
        .string()
        .regex(VALID_TOPIC_RE)
        .describe("Topic slug the resource belongs to, e.g. 'work'"),
      resource: z
        .string()
        .refine(isSafeResource, "must be a flat filename with no path separators or '..'")
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

      // Fast path: the companion .md already holds Xberg-normalized text.
      const companion = `${base}.md`;
      if (existsSync(companion)) {
        return { content: readFileSync(companion, "utf-8"), exists: true, source: "companion-md" as const };
      }

      // Fallback: original blob present → extract clean text via Xberg.
      if (existsSync(base)) {
        try {
          const content = await extractor.extract(base);
          return { content, exists: true, source: "extracted" as const };
        } catch (err) {
          return {
            content: null,
            exists: true,
            source: "extracted" as const,
            error: err instanceof Error ? err.message : String(err),
          };
        }
      }

      return { content: null, exists: false, source: null };
    },
  });
