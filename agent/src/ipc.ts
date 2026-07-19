import { createInterface } from "node:readline";
import { Readable, Writable } from "node:stream";
import { existsSync, writeFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import type { Agent } from "@mastra/core/agent";
import { appendTurn, type ConversationTurn } from "./memory/conversation";
import type { ProviderRegistry } from "./models/provider";

export type IPCMessage = {
  id: string;
  command: string;
  args: any;
};

/**
 * Searches the conversation directory for an existing session file.
 * Helps prevent session split bugs across midnight calendar transitions.
 */
export function findConversationFile(conversationDir: string, sessionId: string): string | null {
  if (!existsSync(conversationDir)) return null;
  try {
    const entries = readdirSync(conversationDir);
    // Escape sessionId for regex safety
    const escaped = sessionId.replace(/[-\/\\^$*+?.()|[\]{}]/g, "\\$&");
    const regex = new RegExp(`^\\d{4}-\\d{2}-\\d{2}-${escaped}\\.md$`);
    for (const entry of entries) {
      if (regex.test(entry)) {
        return join(conversationDir, entry);
      }
    }
  } catch (err) {
    console.error("[pokaico-agent] findConversationFile failed:", err);
  }
  return null;
}

function getLocalISOString(): string {
  const tzoffset = new Date().getTimezoneOffset() * 60000;
  const localISOTime = new Date(Date.now() - tzoffset).toISOString().slice(0, -1);
  const offset = new Date().getTimezoneOffset();
  const absOffset = Math.abs(offset);
  const sign = offset <= 0 ? "+" : "-";
  const pad = (n: number) => n.toString().padStart(2, "0");
  const offsetHours = pad(Math.floor(absOffset / 60));
  const offsetMinutes = pad(absOffset % 60);
  return `${localISOTime}${sign}${offsetHours}:${offsetMinutes}`;
}

export function createConversationSessionFile(
  conversationDir: string,
  sessionId: string,
  modelName: string,
): string {
  const existing = findConversationFile(conversationDir, sessionId);
  if (existing) {
    return existing;
  }

  const localISO = getLocalISOString();
  const dateStr = localISO.split("T")[0]; // YYYY-MM-DD
  const filename = `${dateStr}-${sessionId}.md`;
  const filePath = join(conversationDir, filename);

  const frontmatter = `---
session_id: ${sessionId}
started_at: ${localISO}
last_active_at: ${localISO}
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
  conversationDir: string;
  runPipeline: (sessionId: string) => Promise<any>;
  getModelName: () => string;
  registry: ProviderRegistry;
}) {
  const { stdin, stdout, getAgent, conversationDir, runPipeline, getModelName, registry } = deps;
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

      if (msg.command === "get_models") {
        try {
          const models = await registry.getAvailableModels();
          stdout.write(
            JSON.stringify({
              id: msgId,
              success: true,
              data: { models },
            }) + "\n"
          );
        } catch (err) {
          stdout.write(
            JSON.stringify({
              id: msgId,
              success: false,
              error: err instanceof Error ? err.message : String(err),
            }) + "\n"
          );
        }
        return;
      }

      if (msg.command !== "chat") {
        stdout.write(
          JSON.stringify({
            id: msgId,
            success: false,
            error: `Unknown command: ${msg.command}`,
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

      // 1. Create/Ensure conversation file exists
      const filePath = createConversationSessionFile(conversationDir, sessionId, getModelName());

      // 2. Append User turn (use local HH:mm:ss)
      const userTimestamp = new Date().toTimeString().slice(0, 8);
      const userTurn: ConversationTurn = {
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

              const toolTimestamp = new Date().toTimeString().slice(0, 8);
              const toolTurn: ConversationTurn = {
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

      // 5. Extract & strip Companion Emotion metadata from response
      const rawText = result.text || "";
      const { cleanText, expression, moodText } = extractCompanionEmotion(rawText);

      const agentTimestamp = new Date().toTimeString().slice(0, 8);
      const agentTurn: ConversationTurn = {
        timestamp: agentTimestamp,
        role: "pokai",
        content: cleanText,
      };
      appendTurn(filePath, agentTurn);

      // 6. Write success response to stdout
      stdout.write(
        JSON.stringify({
          id: msgId,
          success: true,
          data: {
            response: cleanText,
            expression,
            moodText,
          },
        }) + "\n"
      );

      // 7. Trigger pipeline in background
      runPipeline(sessionId).catch((err) => {
        console.error(`[pokaico-agent] Background pipeline error:`, err);
      });

    } catch (outerErr) {
      stdout.write(
        JSON.stringify({
          id: msgId,
          success: false,
          error: "Fatal listener error: " + (outerErr instanceof Error ? outerErr.message : String(outerErr)),
        }) + "\n"
      );
    }
  });

  return rl;
}

export interface ExtractedEmotion {
  cleanText: string;
  expression: string;
  moodText: string;
}

const VALID_EXPRESSIONS = new Set(["idle", "happy", "excited", "surprised", "thinking", "sad"]);

export function extractCompanionEmotion(rawText: string): ExtractedEmotion {
  let cleanText = rawText || "";
  let expression = "idle";
  let moodText = "Shroomy is listening";

  const emotionBlockRegex = /```json-emotion\s*([\s\S]*?)\s*```/g;
  let match: RegExpExecArray | null = null;

  let lastJsonStr: string | null = null;
  while ((match = emotionBlockRegex.exec(rawText)) !== null) {
    lastJsonStr = match[1];
  }

  // Strip all ```json-emotion ... ``` blocks
  cleanText = cleanText.replace(emotionBlockRegex, "").trim();

  // Strip dangling unclosed ```json-emotion defensives
  cleanText = cleanText.replace(/```json-emotion[\s\S]*$/, "").trim();

  if (lastJsonStr) {
    try {
      const parsed = JSON.parse(lastJsonStr);
      if (parsed && typeof parsed === "object") {
        if (typeof parsed.expression === "string" && VALID_EXPRESSIONS.has(parsed.expression.toLowerCase())) {
          expression = parsed.expression.toLowerCase();
        }
        if (typeof parsed.moodText === "string" && parsed.moodText.trim()) {
          moodText = parsed.moodText.trim();
        }
      }
    } catch {
      expression = "idle";
      moodText = "Shroomy is listening";
    }
  }

  return { cleanText, expression, moodText };
}
