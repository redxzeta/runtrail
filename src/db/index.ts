import { mkdirSync } from "node:fs";
import path from "node:path";
import Database from "better-sqlite3";
import type { RuntrailConfig } from "../config.js";
import { migrate } from "./migrate.js";

export function openDatabase(config: RuntrailConfig): Database.Database {
  mkdirSync(path.dirname(config.storage.dbPath), { recursive: true });
  mkdirSync(config.storage.logDir, { recursive: true });

  const db = new Database(config.storage.dbPath);
  migrate(db);
  return db;
}
