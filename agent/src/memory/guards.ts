import type { PokaicoDb } from "../db/client";

export function hasNewMessages(
  sessionId: string,
  db: PokaicoDb,
  latestTs: number,
): boolean {
  const row = db
    .prepare("SELECT last_extracted_message_ts FROM session_pointers WHERE session_id = ?")
    .get(sessionId) as { last_extracted_message_ts: number } | undefined;

  if (!row) return true;
  return latestTs > row.last_extracted_message_ts;
}

export function updatePointer(
  sessionId: string,
  latestTs: number,
  db: PokaicoDb,
): void {
  db.prepare(
    "INSERT INTO session_pointers(session_id, last_extracted_message_ts) VALUES (?, ?) ON CONFLICT(session_id) DO UPDATE SET last_extracted_message_ts = excluded.last_extracted_message_ts",
  ).run(sessionId, latestTs);
}