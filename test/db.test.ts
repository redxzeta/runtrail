import { existsSync, mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import Database from "better-sqlite3";
import { describe, expect, it } from "vitest";
import { loadConfig } from "../src/config.js";
import { openDatabase } from "../src/db/index.js";
import { migrate } from "../src/db/migrate.js";

describe("database", () => {
  it("creates and migrates the configured SQLite database", () => {
    const dir = mkdtempSync(path.join(tmpdir(), "runtrail-db-"));
    const config = loadConfig();
    config.storage.dbPath = path.join(dir, "runtrail.sqlite");
    config.storage.logDir = path.join(dir, "logs");

    const db = openDatabase(config);
    const migration = db.prepare("SELECT name FROM schema_migrations WHERE id = ?").get(1) as
      | { name: string }
      | undefined;
    const tables = db
      .prepare("SELECT name FROM sqlite_master WHERE type = 'table' ORDER BY name")
      .all() as Array<{ name: string }>;
    const indexes = db
      .prepare("SELECT name FROM sqlite_master WHERE type = 'index' ORDER BY name")
      .all() as Array<{ name: string }>;
    db.close();

    expect(existsSync(config.storage.dbPath)).toBe(true);
    expect(migration?.name).toBe("001_initial_schema");
    expect(tables.map((table) => table.name)).toEqual([
      "agent_events",
      "agent_runs",
      "artifacts",
      "decisions",
      "handoffs",
      "open_loops",
      "schema_migrations"
    ]);
    expect(indexes.map((index) => index.name)).toContain(
      "idx_agent_runs_project_status_updated_at"
    );
  });

  it("adds open loop collaboration columns to existing databases", () => {
    const db = new Database(":memory:");
    db.exec(`
      CREATE TABLE open_loops (
        id TEXT PRIMARY KEY,
        type TEXT NOT NULL,
        project TEXT NOT NULL,
        title TEXT NOT NULL,
        description TEXT,
        status TEXT NOT NULL,
        resolution TEXT,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        resolved_at TEXT
      )
    `);

    migrate(db);
    const columns = db.prepare("PRAGMA table_info(open_loops)").all() as Array<{ name: string }>;
    db.close();

    expect(columns.map((column) => column.name)).toEqual(
      expect.arrayContaining(["owner", "source", "next_action", "blocker_ref", "source_run_id"])
    );
  });
});
