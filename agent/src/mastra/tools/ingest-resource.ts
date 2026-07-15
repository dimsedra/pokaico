import { createTool } from "@mastra/core/tools";
import { z } from "zod";
import { join, basename, extname } from "node:path";
import { copyFileSync, writeFileSync, mkdirSync, readFileSync, statSync, rmSync } from "node:fs";
import { VALID_TOPIC_RE, resourcesDir } from "../../memory/topics";
import { topicExists, writeResource } from "../../memory/edges";
import type { ResourceExtractor } from "../../extract/xberg";
import type { PokaicoDb } from "../../db/client";

const SAFE_RESOURCE_RE = /^[A-Za-z0-9._-]+$/;
function isSafeResource(name: string): boolean {
  return name !== "." && name !== ".." && SAFE_RESOURCE_RE.test(name) && !name.includes("..");
}

export const createIngestResourceTool = (deps: {
  memoryDir: string;
  db: PokaicoDb;
  extractor: ResourceExtractor;
}) =>
  createTool({
    id: "ingest_resource",
    description:
      "Ingest an external resource (file) into a topic. Copies the original file into the topic's resources directory, extracts text using Xberg (with optional OCR), writes a companion .md file, and records the resource link in the database. Returns the extracted text.",
    inputSchema: z.object({
      topicId: z
        .string()
        .regex(VALID_TOPIC_RE)
        .describe("Topic slug the resource belongs to, e.g. 'work'"),
      source: z
        .string()
        .describe("Absolute or relative path to the source file to ingest"),
      ocr: z
        .boolean()
        .optional()
        .describe("Whether to enable OCR for scanned documents/images (defaults to false)"),
    }),
    outputSchema: z.object({
      success: z.boolean(),
      content: z.string().nullable(),
      path: z.string().optional(),
      error: z.string().optional(),
    }),
    execute: async ({ topicId, source, ocr }, _ctx) => {
      const { memoryDir, db, extractor } = deps;

      try {
        // 1. Verify topic exists
        if (!topicExists(db, topicId)) {
          return {
            success: false,
            content: null,
            error: `Topic '${topicId}' does not exist in database`,
          };
        }

        // 2. Extract and validate filename
        const filename = basename(source);
        if (!isSafeResource(filename)) {
          return {
            success: false,
            content: null,
            error: "Invalid resource filename: must contain only alphanumeric characters, dots, underscores, or dashes",
          };
        }

        // 3. Verify source path exists, is a file, and conforms to size limits
        try {
          const stat = statSync(source);
          if (!stat.isFile()) {
            return {
              success: false,
              content: null,
              error: `Source path is not a file: ${source}`,
            };
          }
          // 20 MB size limit
          if (stat.size > 20 * 1024 * 1024) {
            return {
              success: false,
              content: null,
              error: `File exceeds maximum size limit of 20MB: ${source}`,
            };
          }
        } catch {
          return {
            success: false,
            content: null,
            error: `Source file not found: ${source}`,
          };
        }

        // 4. Resolve destination paths
        const destDir = resourcesDir(memoryDir, topicId);
        mkdirSync(destDir, { recursive: true });

        const destPath = join(destDir, filename);
        const pathInDb = `memory/topics/${topicId}/resources/${filename}`;

        // 5. Copy the original file
        copyFileSync(source, destPath);

        // 6. DB update for the original resource with transactional cleanup
        const kind = extname(filename).slice(1).toLowerCase() || "bin";
        try {
          writeResource(db, topicId, pathInDb, kind);
        } catch (dbErr) {
          // Cleanup copied file on DB write failure to avoid resource leaks
          try {
            rmSync(destPath, { force: true });
          } catch {}
          throw dbErr;
        }

        // 7. Shortcut if already a markdown file (case-insensitive)
        if (kind === "md") {
          const content = readFileSync(destPath, "utf-8");
          return {
            success: true,
            content,
            path: pathInDb,
          };
        }

        // 8. Run Xberg extraction
        try {
          const content = await extractor.extract(destPath, { ocr });
          
          // Write companion .md file
          const destCompanionPath = destPath + ".md";
          writeFileSync(destCompanionPath, content, "utf-8");

          return {
            success: true,
            content,
            path: pathInDb,
          };
        } catch (err) {
          const errorMsg = err instanceof Error ? err.message : String(err);
          return {
            success: false,
            content: null,
            path: pathInDb,
            error: errorMsg,
          };
        }
      } catch (err) {
        const errorMsg = err instanceof Error ? err.message : String(err);
        return {
          success: false,
          content: null,
          error: errorMsg,
        };
      }
    },
  });
