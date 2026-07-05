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
      "agent_event_tags",
      "agent_events",
      "agent_run_tags",
      "agent_runs",
      "artifacts",
      "decisions",
      "handoff_tags",
      "handoffs",
      "open_loops",
      "schema_migrations"
    ]);
    expect(indexes.map((index) => index.name)).toContain(
      "idx_agent_runs_project_status_updated_at"
    );
    expect(indexes.map((index) => index.name)).toContain("idx_agent_run_tags_tag_run_id");
    expect(indexes.map((index) => index.name)).toContain("idx_handoff_tags_tag_handoff_id");
  });

  it("adds collaboration and metadata columns to existing databases", () => {
    const db = new Database(":memory:");
    db.exec(`
      CREATE TABLE agent_runs (
        id TEXT PRIMARY KEY,
        source TEXT NOT NULL,
        project TEXT NOT NULL,
        task TEXT NOT NULL,
        status TEXT NOT NULL,
        started_at TEXT NOT NULL,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );
      CREATE TABLE agent_events (
        id TEXT PRIMARY KEY,
        run_id TEXT NOT NULL,
        type TEXT NOT NULL,
        message TEXT NOT NULL,
        importance INTEGER NOT NULL,
        data_json TEXT,
        created_at TEXT NOT NULL
      );
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
      );
      CREATE TABLE handoffs (
        id TEXT PRIMARY KEY,
        source_run_id TEXT,
        from_source TEXT NOT NULL,
        to_source TEXT,
        project TEXT NOT NULL,
        summary TEXT NOT NULL,
        next_action TEXT,
        context_json TEXT,
        created_at TEXT NOT NULL
      )
    `);

    migrate(db);
    const runColumns = db.prepare("PRAGMA table_info(agent_runs)").all() as Array<{ name: string }>;
    const eventColumns = db.prepare("PRAGMA table_info(agent_events)").all() as Array<{
      name: string;
    }>;
    const handoffColumns = db.prepare("PRAGMA table_info(handoffs)").all() as Array<{
      name: string;
    }>;
    const loopColumns = db.prepare("PRAGMA table_info(open_loops)").all() as Array<{
      name: string;
    }>;
    db.close();

    expect(runColumns.map((column) => column.name)).toEqual(
      expect.arrayContaining(["category", "tags_json"])
    );
    expect(eventColumns.map((column) => column.name)).toEqual(
      expect.arrayContaining(["category", "tags_json", "prev_event_hash", "event_hash"])
    );
    expect(handoffColumns.map((column) => column.name)).toEqual(
      expect.arrayContaining(["category", "tags_json"])
    );
    expect(loopColumns.map((column) => column.name)).toEqual(
      expect.arrayContaining(["owner", "source", "next_action", "blocker_ref", "source_run_id"])
    );
  });
});
