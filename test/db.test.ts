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
    const concurrencyMigration = db
      .prepare("SELECT name FROM schema_migrations WHERE id = ?")
      .get(4) as { name: string } | undefined;
    const workflowMigration = db
      .prepare("SELECT name FROM schema_migrations WHERE id = ?")
      .get(5) as { name: string } | undefined;
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
    expect(concurrencyMigration?.name).toBe("004_optimistic_concurrency");
    expect(workflowMigration?.name).toBe("005_workflow_relationships");
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
    expect(indexes.map((index) => index.name)).toContain(
      "idx_agent_runs_project_workflow_started_at"
    );
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
    db.exec(`
      INSERT INTO agent_runs (
        id, source, project, task, status, started_at, created_at, updated_at
      ) VALUES (
        'run_legacy', 'codex', 'runtrail', 'legacy run', 'running',
        '2026-07-01T00:00:00.000Z', '2026-07-01T00:00:00.000Z',
        '2026-07-01T00:00:00.000Z'
      );
      INSERT INTO open_loops (
        id, type, project, title, status, created_at, updated_at
      ) VALUES (
        'loop_legacy', 'blocked', 'runtrail', 'legacy loop', 'open',
        '2026-07-01T00:00:00.000Z', '2026-07-01T00:00:00.000Z'
      )
      ;
      INSERT INTO handoffs (
        id, from_source, project, summary, created_at
      ) VALUES (
        'handoff_legacy', 'codex', 'runtrail', 'legacy handoff',
        '2026-07-01T00:00:00.000Z'
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
    const runVersion = db.prepare("SELECT version FROM agent_runs LIMIT 1").get() as
      | { version: number }
      | undefined;
    const loopVersion = db.prepare("SELECT version FROM open_loops LIMIT 1").get() as
      | { version: number }
      | undefined;
    const migratedHandoff = db
      .prepare("SELECT status, version, updated_at FROM handoffs LIMIT 1")
      .get() as { status: string; version: number; updated_at: string } | undefined;
    db.close();

    expect(runColumns.map((column) => column.name)).toEqual(
      expect.arrayContaining([
        "category",
        "tags_json",
        "client_run_id",
        "work_key",
        "workflow_id",
        "parent_run_id",
        "continued_from_run_id",
        "version"
      ])
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
      expect.arrayContaining([
        "category",
        "tags_json",
        "client_record_id",
        "status",
        "accepted_by",
        "accepted_at",
        "target_run_id",
        "completed_at",
        "decline_reason",
        "version",
        "updated_at"
      ])
    );
    expect(loopColumns.map((column) => column.name)).toEqual(
      expect.arrayContaining([
        "owner",
        "source",
        "next_action",
        "blocker_ref",
        "source_run_id",
        "client_record_id",
        "version"
      ])
    );
    expect(runVersion?.version).toBe(1);
    expect(loopVersion?.version).toBe(1);
    expect(migratedHandoff).toEqual({
      status: "pending",
      version: 1,
      updated_at: "2026-07-01T00:00:00.000Z"
    });
    expect(decisionColumns.map((column) => column.name)).toContain("client_record_id");
    expect(artifactColumns.map((column) => column.name)).toContain("client_record_id");
    expect(indexes.map((index) => index.name)).toEqual(
      expect.arrayContaining([
        "idx_agent_events_client_record_id",
        "idx_open_loops_client_record_id",
        "idx_decisions_client_record_id",
        "idx_handoffs_client_record_id",
        "idx_handoffs_project_status_updated_at",
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
