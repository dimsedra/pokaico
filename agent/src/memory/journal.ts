import { readFileSync, writeFileSync, readdirSync, appendFileSync } from "node:fs";
import { readFile } from "node:fs/promises";
import { join, extname } from "node:path";

export type JournalTurn = {
  timestamp: string;
  role: "user" | "pokai" | "tool";
  content: string;
};

export type JournalSession = {
  sessionId: string;
  startedAt: string;
  model: string;
  extracted: boolean;
  turns: JournalTurn[];
};

export type SessionMeta = {
  sessionId: string;
  startedAt: string;
  model: string;
  extracted: boolean;
};

function parseFrontmatter(lines: string[]): Record<string, string> {
  const meta: Record<string, string> = {};
  for (const line of lines) {
    const colonIdx = line.indexOf(":");
    if (colonIdx === -1) continue;
    const key = line.slice(0, colonIdx).trim();
    const value = line.slice(colonIdx + 1).trim();
    // Only take up to first colon for the key; keep everything after as value
    meta[key] = value;
  }
  return meta;
}

function roleLabel(role: JournalTurn["role"]): string {
  if (role === "user") return "User";
  if (role === "pokai") return "Pokai";
  return "Tool";
}

function parseRole(label: string): JournalTurn["role"] {
  // Label can be "User", "Pokai", or "Tool: tool_name"
  const base = label.split(":")[0].trim();
  if (base === "User") return "user";
  if (base === "Pokai") return "pokai";
  return "tool";
}

const TURN_HEADER_RE = /^## \[(\d{2}:\d{2}:\d{2})\] (User|Pokai|Tool)(?:: .*)?$/;

export function appendTurn(path: string, turn: JournalTurn): void {
  const block = `\n## [${turn.timestamp}] ${roleLabel(turn.role)}\n${turn.content}`;
  appendFileSync(path, block, "utf-8");
}

function normalizeEol(raw: string): string {
  return raw.replace(/\r\n/g, "\n");
}

export function parseJournalContent(raw: string): JournalSession {
  const normalized = normalizeEol(raw);
  const lines = normalized.split("\n");

  if (lines.length < 2 || lines[0] !== "---") {
    throw new Error(`missing frontmatter`);
  }

  const fmEnd = lines.indexOf("---", 1);
  if (fmEnd === -1) {
    throw new Error(`unclosed frontmatter`);
  }

  const fmLines = lines.slice(1, fmEnd);
  const fm = parseFrontmatter(fmLines);

  const turns: JournalTurn[] = [];
  let currentTurn: JournalTurn | null = null;

  for (let i = fmEnd + 1; i < lines.length; i++) {
    const line = lines[i];
    const match = line.match(TURN_HEADER_RE);

    if (match) {
      if (currentTurn) {
        currentTurn.content = currentTurn.content.trimEnd();
        turns.push(currentTurn);
      }
      currentTurn = {
        timestamp: match[1],
        role: parseRole(match[2]),
        content: "",
      };
    } else if (currentTurn) {
      currentTurn.content += (currentTurn.content ? "\n" : "") + line;
    }
  }

  if (currentTurn) {
    currentTurn.content = currentTurn.content.trimEnd();
    turns.push(currentTurn);
  }

  return {
    sessionId: fm["session_id"],
    startedAt: fm["started_at"],
    model: fm["model"],
    extracted: fm["extracted"] === "true",
    turns,
  };
}

export function readSession(path: string): JournalSession {
  const raw = readFileSync(path, "utf-8");
  try {
    return parseJournalContent(raw);
  } catch (err) {
    throw new Error(`Invalid journal file: ${(err as Error).message} in ${path}`);
  }
}

export async function readSessionAsync(path: string): Promise<JournalSession> {
  const raw = await readFile(path, "utf-8");
  try {
    return parseJournalContent(raw);
  } catch (err) {
    throw new Error(`Invalid journal file: ${(err as Error).message} in ${path}`);
  }
}

export function listSessions(journalDir: string): SessionMeta[] {
  let entries: string[];
  try {
    entries = readdirSync(journalDir);
  } catch {
    return [];
  }

  const sessions: SessionMeta[] = [];
  for (const entry of entries) {
    if (extname(entry) !== ".md") continue;
    try {
      const session = readSession(join(journalDir, entry));
      sessions.push({
        sessionId: session.sessionId,
        startedAt: session.startedAt,
        model: session.model,
        extracted: session.extracted,
      });
    } catch {
      // skip files that can't be parsed
    }
  }
  return sessions;
}
