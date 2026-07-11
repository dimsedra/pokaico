import type { PokaicoDb } from "../db/client";

export function topicExists(db: PokaicoDb, topicId: string): boolean {
  return !!db.prepare("SELECT 1 FROM topics WHERE id = ?").get(topicId);
}

export function writeEdge(
  db: PokaicoDb,
  fromTopic: string,
  toTopic: string,
  relationship: string,
  reason?: string,
): boolean {
  if (fromTopic === toTopic) return false;
  if (!topicExists(db, fromTopic) || !topicExists(db, toTopic)) return false;

  db.prepare(
    "INSERT OR IGNORE INTO edges(from_topic, to_topic, relationship, reason) VALUES (?, ?, ?, ?)",
  ).run(fromTopic, toTopic, relationship, reason ?? null);
  return true;
}

export function writeResource(
  db: PokaicoDb,
  topicId: string,
  path: string,
  kind: string = "md",
): void {
  if (!topicExists(db, topicId)) return;
  db.prepare(
    "INSERT OR REPLACE INTO resources(id, topic_id, path, kind, updated_at) VALUES (?, ?, ?, ?, ?)",
  ).run(path, topicId, path, kind, Math.floor(Date.now() / 1000));
}
