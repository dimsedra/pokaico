import Database from "better-sqlite3";
import type { Database as DatabaseType } from "better-sqlite3";
import * as sqliteVec from "sqlite-vec";
import { SCHEMA_SQL } from "./schema";

export type PokaicoDb = DatabaseType;

export function createDb(path: string): PokaicoDb {
  const db = new Database(path);

  sqliteVec.load(db);

  for (const sql of SCHEMA_SQL) {
    db.exec(sql);
  }

  db.pragma("journal_mode = WAL");

  return db;
}

export function closeDb(db: PokaicoDb): void {
  db.close();
}
