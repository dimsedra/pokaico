import type { PokaicoDb } from "../db/client";

export function topicExists(db: PokaicoDb, topicId: string): boolean {
  return !!db.prepare("SELECT 1 FROM topics WHERE id = ?").get(topicId);
}

export function writeEdge(
  db: PokaicoDb,
  fromTopic: string,
  toTopic: string,
  relationship: string,
): boolean {
  if (fromTopic === toTopic) return false;
  if (!topicExists(db, fromTopic) || !topicExists(db, toTopic)) return false;

  db.prepare(
    "INSERT OR IGNORE INTO edges(from_topic, to_topic, relationship) VALUES (?, ?, ?)",
  ).run(fromTopic, toTopic, relationship);
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

export function linkCoOccurring(
  db: PokaicoDb,
  topicIds: string[],
  relationship: string = "related-to",
): void {
  const existing = [...new Set(topicIds)].filter((t) => topicExists(db, t));
  for (let i = 0; i < existing.length; i++) {
    for (let j = i + 1; j < existing.length; j++) {
      writeEdge(db, existing[i], existing[j], relationship);
      writeEdge(db, existing[j], existing[i], relationship);
    }
  }
}
