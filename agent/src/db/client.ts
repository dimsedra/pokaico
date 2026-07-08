import Database from "better-sqlite3";
import type { Database as DatabaseType } from "better-sqlite3";
import * as sqliteVec from "sqlite-vec";
import { mkdirSync } from "node:fs";
import { dirname } from "node:path";
import { SCHEMA_SQL } from "./schema";

export type PokaicoDb = DatabaseType;

export class DbError extends Error {
  constructor(message: string, cause?: unknown) {
    super(message, { cause });
    this.name = "DbError";
  }
}

export function createDb(path: string): PokaicoDb {
  try {
    mkdirSync(dirname(path), { recursive: true });
  } catch {
    throw new DbError(`Cannot create database directory for: ${path}`);
  }

  let db: PokaicoDb;
  try {
    db = new Database(path);
  } catch (err) {
    throw new DbError(`Cannot open database at: ${path}`, err);
  }

  try {
    sqliteVec.load(db);
    for (const sql of SCHEMA_SQL) {
      db.exec(sql);
    }
    db.pragma("journal_mode = WAL");
    db.pragma("foreign_keys = ON");
  } catch (err) {
    db.close();
    throw new DbError("Database initialization failed", err);
  }

  return db;
}

export function closeDb(db: PokaicoDb): void {
  db.close();
}
