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
    const idempotencyMigration = db
      .prepare("SELECT name FROM schema_migrations WHERE id = ?")
      .get(2) as { name: string } | undefined;
    const tables = db
      .prepare("SELECT name FROM sqlite_master WHERE type = 'table' ORDER BY name")
      .all() as Array<{ name: string }>;
    const indexes = db
      .prepare("SELECT name FROM sqlite_master WHERE type = 'index' ORDER BY name")
      .all() as Array<{ name: string }>;
    db.close();

    expect(existsSync(config.storage.dbPath)).toBe(true);
    expect(migration?.name).toBe("001_initial_schema");
    expect(idempotencyMigration?.name).toBe("002_append_record_idempotency");
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
      "recovery_receipts",
      "schema_migrations"
    ]);
    expect(indexes.map((index) => index.name)).toContain(
      "idx_agent_runs_project_status_updated_at"
    );
    expect(indexes.map((index) => index.name)).toContain("idx_agent_run_tags_tag_run_id");
    expect(indexes.map((index) => index.name)).toContain("idx_handoff_tags_tag_handoff_id");
    expect(indexes.map((index) => index.name)).toContain("idx_agent_runs_client_run_id");
    expect(indexes.map((index) => index.name)).toContain("idx_agent_runs_project_work_key_status");
    expect(indexes.map((index) => index.name)).toContain("idx_agent_events_client_record_id");
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
      );
      CREATE TABLE decisions (
        id TEXT PRIMARY KEY,
        project TEXT,
        title TEXT NOT NULL,
        decision TEXT NOT NULL,
        rationale TEXT,
        created_at TEXT NOT NULL
      );
      CREATE TABLE artifacts (
        id TEXT PRIMARY KEY,
        run_id TEXT NOT NULL,
        kind TEXT NOT NULL,
        path TEXT NOT NULL,
        size_bytes INTEGER,
        sha256 TEXT,
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
    const decisionColumns = db.prepare("PRAGMA table_info(decisions)").all() as Array<{
      name: string;
    }>;
    const artifactColumns = db.prepare("PRAGMA table_info(artifacts)").all() as Array<{
      name: string;
    }>;
    const indexes = db
      .prepare("SELECT name FROM sqlite_master WHERE type = 'index'")
      .all() as Array<{ name: string }>;
    db.close();

    expect(runColumns.map((column) => column.name)).toEqual(
      expect.arrayContaining(["category", "tags_json", "client_run_id", "work_key"])
    );
    expect(eventColumns.map((column) => column.name)).toEqual(
      expect.arrayContaining([
        "category",
        "tags_json",
        "prev_event_hash",
        "event_hash",
        "client_record_id"
      ])
    );
    expect(handoffColumns.map((column) => column.name)).toEqual(
      expect.arrayContaining(["category", "tags_json", "client_record_id"])
    );
    expect(loopColumns.map((column) => column.name)).toEqual(
      expect.arrayContaining([
        "owner",
        "source",
        "next_action",
        "blocker_ref",
        "source_run_id",
        "client_record_id"
      ])
    );
    expect(decisionColumns.map((column) => column.name)).toContain("client_record_id");
    expect(artifactColumns.map((column) => column.name)).toContain("client_record_id");
    expect(indexes.map((index) => index.name)).toEqual(
      expect.arrayContaining([
        "idx_agent_events_client_record_id",
        "idx_open_loops_client_record_id",
        "idx_decisions_client_record_id",
        "idx_handoffs_client_record_id",
        "idx_artifacts_client_record_id"
      ])
    );
  });

  it("enforces client run uniqueness after migrating an existing database", () => {
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
      )
    `);

    migrate(db);
    const insert = db.prepare(
      `INSERT INTO agent_runs
      (id, source, project, client_run_id, task, status, started_at, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, 'running', ?, ?, ?)`
    );
    const timestamp = "2026-07-01T00:00:00.000Z";
    insert.run("run_1", "codex", "runtrail", "session-1", "first", timestamp, timestamp, timestamp);

    expect(() =>
      insert.run(
        "run_2",
        "codex",
        "runtrail",
        "session-1",
        "second",
        timestamp,
        timestamp,
        timestamp
      )
    ).toThrow(/UNIQUE constraint failed/);
    expect(() =>
      insert.run("run_3", "codex", "other", "session-1", "third", timestamp, timestamp, timestamp)
    ).not.toThrow();
    expect(() =>
      insert.run("run_4", "codex", "runtrail", null, "fourth", timestamp, timestamp, timestamp)
    ).not.toThrow();
    expect(() =>
      insert.run("run_5", "codex", "runtrail", null, "fifth", timestamp, timestamp, timestamp)
    ).not.toThrow();
    db.close();
  });
});
