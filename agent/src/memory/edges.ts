import type { PokaicoDb } from "../db/client";
import type { CompactEdge } from "./types";

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

export function getEdges(db: PokaicoDb, topicId: string): CompactEdge[] {
  const outgoing = db.prepare(
    "SELECT to_topic AS toTopic, relationship, reason FROM edges WHERE from_topic = ?",
  ).all(topicId) as CompactEdge[];
  const incoming = db.prepare(
    "SELECT from_topic AS toTopic, relationship, reason FROM edges WHERE to_topic = ?",
  ).all(topicId) as CompactEdge[];
  // Dedup by (toTopic, relationship), preferring outgoing (directional)
  const seen = new Set<string>();
  return [...outgoing, ...incoming].filter((e) => {
    const key = `${e.toTopic}:${e.relationship}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
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
