import { readFileSync, writeFileSync, readdirSync, appendFileSync } from "node:fs";
import { readFile, readdir } from "node:fs/promises";
import { join, extname } from "node:path";

export type JournalTurn = {
  timestamp: string;
  role: "user" | "pokai" | "tool";
  content: string;
  toolName?: string;
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
    const cleanLine = line.split("#")[0].trim();
    const colonIdx = cleanLine.indexOf(":");
    if (colonIdx === -1) continue;
    const key = cleanLine.slice(0, colonIdx).trim();
    const value = cleanLine.slice(colonIdx + 1).trim();
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
  const base = label.split(":")[0].trim().toLowerCase();
  if (base === "user") return "user";
  if (base === "pokai") return "pokai";
  return "tool";
}

const TURN_HEADER_RE = /^##\s+\[(\d{2}:\d{2}:\d{2})\]\s+(User|Pokai|Tool)(?:\s*:\s*(.*))?\s*$/i;

export function appendTurn(path: string, turn: JournalTurn): void {
  const label = turn.role === "tool" && turn.toolName ? `Tool: ${turn.toolName}` : roleLabel(turn.role);
  const block = `\n## [${turn.timestamp}] ${label}\n${turn.content}`;
  appendFileSync(path, block, "utf-8");
}

function normalizeEol(raw: string): string {
  return raw.replace(/\r\n/g, "\n");
}

export function parseJournalContent(raw: string): JournalSession {
  const cleanRaw = raw.replace(/^\uFEFF/, "").trimStart();
  const normalized = normalizeEol(cleanRaw);
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

  // Strict validation
  if (!fm["session_id"]) {
    throw new Error("missing required frontmatter field: session_id");
  }
  if (!fm["started_at"]) {
    throw new Error("missing required frontmatter field: started_at");
  }
  if (!fm["model"]) {
    throw new Error("missing required frontmatter field: model");
  }

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
        toolName: match[3] ? match[3].trim() : undefined,
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

export async function listSessionsAsync(journalDir: string): Promise<SessionMeta[]> {
  let entries: string[];
  try {
    entries = await readdir(journalDir);
  } catch {
    return [];
  }

  const sessionPromises = entries.map(async (entry) => {
    if (extname(entry) !== ".md") return null;
    try {
      const session = await readSessionAsync(join(journalDir, entry));
      return {
        sessionId: session.sessionId,
        startedAt: session.startedAt,
        model: session.model,
        extracted: session.extracted,
      };
    } catch {
      return null;
    }
  });

  const results = await Promise.all(sessionPromises);
  return results.filter((s): s is SessionMeta => s !== null);
}
