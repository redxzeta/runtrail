import type Database from "better-sqlite3";
import { nowIso } from "../shared/time.js";
import { schemaStatements } from "./schema.js";

const initialMigrationName = "001_initial_schema";
const idempotencyMigrationName = "002_append_record_idempotency";
const workKeyMigrationName = "003_run_work_keys";
const optimisticConcurrencyMigrationName = "004_optimistic_concurrency";
const workflowRelationshipsMigrationName = "005_workflow_relationships";
const handoffLifecycleMigrationName = "006_handoff_lifecycle";
const prepareWorkMigrationName = "007_authoritative_run_liveness";
const contextCursorMigrationName = "008_incremental_context_cursors";
const agentProvenanceMigrationName = "009_agent_provenance";
const effectiveDecisionsMigrationName = "010_effective_decisions";

export function migrate(db: Database.Database): void {
  const transaction = db.transaction(() => {
    for (const statement of schemaStatements) {
      db.exec(statement);
    }

    addColumnIfMissing(db, "open_loops", "owner", "owner TEXT");
    addColumnIfMissing(db, "open_loops", "source", "source TEXT");
    addColumnIfMissing(db, "open_loops", "next_action", "next_action TEXT");
    addColumnIfMissing(db, "open_loops", "blocker_ref", "blocker_ref TEXT");
    addColumnIfMissing(db, "open_loops", "source_run_id", "source_run_id TEXT");
    addColumnIfMissing(db, "agent_runs", "category", "category TEXT");
    addColumnIfMissing(db, "agent_runs", "tags_json", "tags_json TEXT");
    addColumnIfMissing(db, "agent_runs", "agent_name", "agent_name TEXT");
    addColumnIfMissing(db, "agent_runs", "agent_model", "agent_model TEXT");
    addColumnIfMissing(db, "agent_runs", "client_run_id", "client_run_id TEXT");
    addColumnIfMissing(db, "agent_runs", "work_key", "work_key TEXT");
    addColumnIfMissing(db, "agent_runs", "workflow_id", "workflow_id TEXT");
    addColumnIfMissing(db, "agent_runs", "parent_run_id", "parent_run_id TEXT");
    addColumnIfMissing(db, "agent_runs", "continued_from_run_id", "continued_from_run_id TEXT");
    addColumnIfMissing(db, "agent_runs", "version", "version INTEGER NOT NULL DEFAULT 1");
    addColumnIfMissing(db, "agent_runs", "last_liveness_at", "last_liveness_at TEXT");
    addColumnIfMissing(db, "agent_events", "category", "category TEXT");
    addColumnIfMissing(db, "agent_events", "tags_json", "tags_json TEXT");
    addColumnIfMissing(db, "agent_events", "prev_event_hash", "prev_event_hash TEXT");
    addColumnIfMissing(db, "agent_events", "event_hash", "event_hash TEXT");
    addColumnIfMissing(db, "agent_events", "client_record_id", "client_record_id TEXT");
    addColumnIfMissing(db, "open_loops", "client_record_id", "client_record_id TEXT");
    addColumnIfMissing(db, "open_loops", "version", "version INTEGER NOT NULL DEFAULT 1");
    addColumnIfMissing(db, "decisions", "client_record_id", "client_record_id TEXT");
    addColumnIfMissing(
      db,
      "decisions",
      "supersedes_decision_id",
      "supersedes_decision_id TEXT REFERENCES decisions(id)"
    );
    addColumnIfMissing(db, "handoffs", "category", "category TEXT");
    addColumnIfMissing(db, "handoffs", "tags_json", "tags_json TEXT");
    addColumnIfMissing(db, "handoffs", "client_record_id", "client_record_id TEXT");
    addColumnIfMissing(db, "handoffs", "status", "status TEXT NOT NULL DEFAULT 'pending'");
    addColumnIfMissing(db, "handoffs", "accepted_by", "accepted_by TEXT");
    addColumnIfMissing(db, "handoffs", "accepted_at", "accepted_at TEXT");
    addColumnIfMissing(db, "handoffs", "target_run_id", "target_run_id TEXT");
    addColumnIfMissing(db, "handoffs", "completed_at", "completed_at TEXT");
    addColumnIfMissing(db, "handoffs", "decline_reason", "decline_reason TEXT");
    addColumnIfMissing(db, "handoffs", "version", "version INTEGER NOT NULL DEFAULT 1");
    addColumnIfMissing(db, "handoffs", "updated_at", "updated_at TEXT NOT NULL DEFAULT ''");
    db.exec("UPDATE handoffs SET updated_at = created_at WHERE updated_at = ''");
    addColumnIfMissing(db, "artifacts", "client_record_id", "client_record_id TEXT");
    db.exec(
      "CREATE INDEX IF NOT EXISTS idx_agent_runs_category_updated_at ON agent_runs (category, updated_at DESC)"
    );
    db.exec(
      "CREATE INDEX IF NOT EXISTS idx_agent_events_category_created_at ON agent_events (category, created_at DESC)"
    );
    db.exec(
      "CREATE INDEX IF NOT EXISTS idx_handoffs_category_created_at ON handoffs (category, created_at DESC)"
    );
    db.exec(
      "CREATE INDEX IF NOT EXISTS idx_handoffs_project_status_updated_at ON handoffs (project, status, updated_at DESC)"
    );
    db.exec(
      `CREATE UNIQUE INDEX IF NOT EXISTS idx_agent_runs_client_run_id
      ON agent_runs (source, project, client_run_id)
      WHERE client_run_id IS NOT NULL`
    );
    db.exec(
      `CREATE INDEX IF NOT EXISTS idx_agent_runs_project_work_key_status
      ON agent_runs (project, work_key, status, updated_at DESC)`
    );
    db.exec(
      `CREATE INDEX IF NOT EXISTS idx_agent_runs_project_workflow_started_at
      ON agent_runs (project, workflow_id, started_at ASC, id ASC)`
    );
    db.exec(
      `CREATE UNIQUE INDEX IF NOT EXISTS idx_agent_events_client_record_id
      ON agent_events (run_id, client_record_id)
      WHERE client_record_id IS NOT NULL`
    );
    db.exec(
      `CREATE UNIQUE INDEX IF NOT EXISTS idx_open_loops_client_record_id
      ON open_loops (project, client_record_id)
      WHERE client_record_id IS NOT NULL`
    );
    db.exec(
      `CREATE UNIQUE INDEX IF NOT EXISTS idx_decisions_client_record_id
      ON decisions (COALESCE(project, ''), client_record_id)
      WHERE client_record_id IS NOT NULL`
    );
    db.exec(
      `CREATE UNIQUE INDEX IF NOT EXISTS idx_decisions_supersedes
      ON decisions (supersedes_decision_id)
      WHERE supersedes_decision_id IS NOT NULL`
    );
    db.exec(
      `CREATE UNIQUE INDEX IF NOT EXISTS idx_handoffs_client_record_id
      ON handoffs (project, client_record_id)
      WHERE client_record_id IS NOT NULL`
    );
    db.exec(
      `CREATE UNIQUE INDEX IF NOT EXISTS idx_artifacts_client_record_id
      ON artifacts (run_id, client_record_id)
      WHERE client_record_id IS NOT NULL`
    );

    db.prepare(
      "INSERT OR IGNORE INTO schema_migrations (id, name, applied_at) VALUES (?, ?, ?)"
    ).run(1, initialMigrationName, nowIso());
    db.prepare(
      "INSERT OR IGNORE INTO schema_migrations (id, name, applied_at) VALUES (?, ?, ?)"
    ).run(2, idempotencyMigrationName, nowIso());
    db.prepare(
      "INSERT OR IGNORE INTO schema_migrations (id, name, applied_at) VALUES (?, ?, ?)"
    ).run(3, workKeyMigrationName, nowIso());
    db.prepare(
      "INSERT OR IGNORE INTO schema_migrations (id, name, applied_at) VALUES (?, ?, ?)"
    ).run(4, optimisticConcurrencyMigrationName, nowIso());
    db.prepare(
      "INSERT OR IGNORE INTO schema_migrations (id, name, applied_at) VALUES (?, ?, ?)"
    ).run(5, workflowRelationshipsMigrationName, nowIso());
    db.prepare(
      "INSERT OR IGNORE INTO schema_migrations (id, name, applied_at) VALUES (?, ?, ?)"
    ).run(6, handoffLifecycleMigrationName, nowIso());
    db.prepare(
      "INSERT OR IGNORE INTO schema_migrations (id, name, applied_at) VALUES (?, ?, ?)"
    ).run(7, prepareWorkMigrationName, nowIso());
    db.prepare(
      "INSERT OR IGNORE INTO schema_migrations (id, name, applied_at) VALUES (?, ?, ?)"
    ).run(8, contextCursorMigrationName, nowIso());
    db.prepare(
      "INSERT OR IGNORE INTO schema_migrations (id, name, applied_at) VALUES (?, ?, ?)"
    ).run(9, agentProvenanceMigrationName, nowIso());
    db.prepare(
      "INSERT OR IGNORE INTO schema_migrations (id, name, applied_at) VALUES (?, ?, ?)"
    ).run(10, effectiveDecisionsMigrationName, nowIso());
  });

  transaction();
}

function addColumnIfMissing(
  db: Database.Database,
  table: string,
  column: string,
  definition: string
): void {
  const columns = db.prepare(`PRAGMA table_info(${table})`).all() as Array<{ name: string }>;

  if (columns.some((existing) => existing.name === column)) {
    return;
  }

  db.exec(`ALTER TABLE ${table} ADD COLUMN ${definition}`);
}
