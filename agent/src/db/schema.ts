export const SCHEMA_SQL = [
  `CREATE TABLE IF NOT EXISTS sessions (
    id TEXT PRIMARY KEY,
    path TEXT NOT NULL,
    model TEXT,
    started_at INTEGER,
    extracted INTEGER DEFAULT 0
  )`,

  `CREATE TABLE IF NOT EXISTS topics (
    id TEXT PRIMARY KEY,
    path TEXT NOT NULL,
    summary TEXT,
    token_count INTEGER DEFAULT 0,
    is_foundational INTEGER DEFAULT 0,
    updated_at INTEGER
  )`,

  `CREATE TABLE IF NOT EXISTS edges (
    from_topic TEXT REFERENCES topics(id),
    to_topic TEXT REFERENCES topics(id),
    relationship TEXT,
    PRIMARY KEY (from_topic, to_topic, relationship)
  )`,

  `CREATE TABLE IF NOT EXISTS resources (
    id TEXT PRIMARY KEY,
    topic_id TEXT REFERENCES topics(id),
    path TEXT NOT NULL,
    kind TEXT,
    updated_at INTEGER
  )`,

  `CREATE TABLE IF NOT EXISTS session_pointers (
    session_id TEXT PRIMARY KEY,
    last_extracted_message_ts INTEGER
  )`,

  `CREATE VIRTUAL TABLE IF NOT EXISTS chunk_fts USING fts5(
    content,
    topic_id UNINDEXED,
    source_path UNINDEXED
  )`,

  `CREATE VIRTUAL TABLE IF NOT EXISTS chunk_vec USING vec0(
    embedding float[768]
  )`,
];
