import { createTool } from "@mastra/core/tools";
import { z } from "zod";
import { readdirSync } from "node:fs";
import { join } from "node:path";
import { readSession } from "../../memory/conversation";

export const createReadSessionTool = (conversationDir: string) =>
  createTool({
    id: "read_session",
    description: "Read the raw conversation transcript for a session. Returns structured turns with timestamps, roles, and content.",
    inputSchema: z.object({
      sessionId: z.string().describe("Session ID from the conversation filename, e.g. 'commute-discussion'"),
    }),
    execute: async ({ sessionId }, _ctx) => {
      const notFound = { sessionId, startedAt: "", model: "", extracted: false, turns: [], found: false as const };

      let files: string[];
      try {
        files = readdirSync(conversationDir);
      } catch {
        return notFound;
      }

      const match = files.find((f) => f.endsWith(`${sessionId}.md`));
      if (!match) return notFound;

      try {
        const session = readSession(join(conversationDir, match));
        return {
          sessionId: session.sessionId,
          startedAt: session.startedAt,
          model: session.model,
          extracted: session.extracted,
          turns: session.turns,
          found: true as const,
        };
      } catch {
        return notFound;
      }
    },
  });
