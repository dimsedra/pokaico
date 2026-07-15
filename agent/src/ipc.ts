import { createInterface } from "node:readline";
import { Readable, Writable } from "node:stream";
import { existsSync, writeFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import type { Agent } from "@mastra/core/agent";
import { appendTurn, type JournalTurn } from "./memory/journal";

export type IPCMessage = {
  id: string;
  command: string;
  args: any;
};

/**
 * Searches the journal directory for an existing session file.
 * Helps prevent session split bugs across midnight calendar transitions.
 */
export function findJournalFile(journalDir: string, sessionId: string): string | null {
  if (!existsSync(journalDir)) return null;
  try {
    const entries = readdirSync(journalDir);
    // Escape sessionId for regex safety
    const escaped = sessionId.replace(/[-\/\\^$*+?.()|[\]{}]/g, "\\$&");
    const regex = new RegExp(`^\\d{4}-\\d{2}-\\d{2}-${escaped}\\.md$`);
    for (const entry of entries) {
      if (regex.test(entry)) {
        return join(journalDir, entry);
      }
    }
  } catch (err) {
    console.error("[pokaico-agent] findJournalFile failed:", err);
  }
  return null;
}

export function createJournalSessionFile(
  journalDir: string,
  sessionId: string,
  modelName: string,
): string {
  const existing = findJournalFile(journalDir, sessionId);
  if (existing) {
    return existing;
  }

  const dateStr = new Date().toISOString().split("T")[0]; // YYYY-MM-DD
  const filename = `${dateStr}-${sessionId}.md`;
  const filePath = join(journalDir, filename);

  const startedAt = new Date().toISOString();
  const frontmatter = `---
session_id: ${sessionId}
started_at: ${startedAt}
model: ${modelName}
extracted: false
---
`;
  writeFileSync(filePath, frontmatter, "utf-8");
  return filePath;
}

export function startIPCListener(deps: {
  stdin: Readable;
  stdout: Writable;
  getAgent: () => Agent | null;
  journalDir: string;
  runPipeline: (sessionId: string) => Promise<any>;
  getModelName: () => string;
}) {
  const { stdin, stdout, getAgent, journalDir, runPipeline, getModelName } = deps;
  const rl = createInterface({
    input: stdin,
    output: undefined,
    terminal: false,
  });

  rl.on("close", () => {
    if (!process.env.VITEST) {
      process.exit(0);
    }
  });

  rl.on("line", async (line) => {
    if (!line.trim()) return;

    let msgId = "unknown";
    try {
      let msg: IPCMessage;
      try {
        msg = JSON.parse(line) as IPCMessage;
        msgId = msg.id || msgId;
      } catch (err) {
        stdout.write(
          JSON.stringify({
            id: msgId,
            success: false,
            error: "Invalid JSON format: " + (err instanceof Error ? err.message : String(err)),
          }) + "\n"
        );
        return;
      }

      if (msg.command !== "chat") {
        stdout.write(
          JSON.stringify({
            id: msgId,
            success: false,
            error: `Unsupported command: "${msg.command}"`,
          }) + "\n"
        );
        return;
      }

      const { message, sessionId } = msg.args || {};
      if (typeof message !== "string" || typeof sessionId !== "string") {
        stdout.write(
          JSON.stringify({
            id: msgId,
            success: false,
            error: "Missing or invalid arguments: message and sessionId must be strings",
          }) + "\n"
        );
        return;
      }

      const agent = getAgent();
      if (!agent) {
        stdout.write(
          JSON.stringify({
            id: msgId,
            success: false,
            error: "No model configured. Please configure an active model and provider in settings.",
          }) + "\n"
        );
        return;
      }

      // 1. Create/Ensure journal file exists
      const filePath = createJournalSessionFile(journalDir, sessionId, getModelName());

      // 2. Append User turn (use UTC HH:mm:ss to prevent timezone discrepancies)
      const userTimestamp = new Date().toISOString().slice(11, 19);
      const userTurn: JournalTurn = {
        timestamp: userTimestamp,
        role: "user",
        content: message,
      };
      appendTurn(filePath, userTurn);

      // 3. Generate Agent response
      let result: any;
      try {
        result = await agent.generate(message, {
          memory: {
            thread: sessionId,
          },
        });
      } catch (genErr) {
        stdout.write(
          JSON.stringify({
            id: msgId,
            success: false,
            error: genErr instanceof Error ? genErr.message : String(genErr),
          }) + "\n"
        );
        return;
      }

      // 4. Extract and append Tool turns from steps
      if (result.steps && result.steps.length > 0) {
        for (const step of result.steps) {
          if (step.toolCalls && step.toolCalls.length > 0) {
            for (const tc of step.toolCalls) {
              const toolResult = step.toolResults?.find(
                (tr: any) => tr.toolCallId === tc.toolCallId
              );
              const rawResult = toolResult ? toolResult.result : "";
              const content =
                typeof rawResult === "object"
                  ? JSON.stringify(rawResult, null, 2)
                  : String(rawResult);

              const toolTimestamp = new Date().toISOString().slice(11, 19);
              const toolTurn: JournalTurn = {
                timestamp: toolTimestamp,
                role: "tool",
                toolName: tc.toolName,
                content,
              };
              appendTurn(filePath, toolTurn);
            }
          }
        }
      }

      // 5. Append Assistant (Pokai) turn
      const agentResponseText = result.text || "";
      const agentTimestamp = new Date().toISOString().slice(11, 19);
      const agentTurn: JournalTurn = {
        timestamp: agentTimestamp,
        role: "pokai",
        content: agentResponseText,
      };
      appendTurn(filePath, agentTurn);

      // 6. Write success response to stdout
      stdout.write(
        JSON.stringify({
          id: msgId,
          success: true,
          data: {
            response: agentResponseText,
          },
        }) + "\n"
      );

      // 7. Trigger pipeline in background
      runPipeline(sessionId).catch((err) => {
        console.error(`[pokaico-agent] Background pipeline error:`, err);
      });

    } catch (err) {
      stdout.write(
        JSON.stringify({
          id: msgId,
          success: false,
          error: err instanceof Error ? err.message : String(err),
        }) + "\n"
      );
    }
  });

  return {
    close: () => {
      rl.close();
    },
  };
}
