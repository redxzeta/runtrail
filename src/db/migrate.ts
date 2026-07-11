import type Database from "better-sqlite3";
import { nowIso } from "../shared/time.js";
import { schemaStatements } from "./schema.js";

const initialMigrationName = "001_initial_schema";
const idempotencyMigrationName = "002_append_record_idempotency";

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
    addColumnIfMissing(db, "agent_runs", "client_run_id", "client_run_id TEXT");
    addColumnIfMissing(db, "agent_events", "category", "category TEXT");
    addColumnIfMissing(db, "agent_events", "tags_json", "tags_json TEXT");
    addColumnIfMissing(db, "agent_events", "prev_event_hash", "prev_event_hash TEXT");
    addColumnIfMissing(db, "agent_events", "event_hash", "event_hash TEXT");
    addColumnIfMissing(db, "agent_events", "client_record_id", "client_record_id TEXT");
    addColumnIfMissing(db, "open_loops", "client_record_id", "client_record_id TEXT");
    addColumnIfMissing(db, "decisions", "client_record_id", "client_record_id TEXT");
    addColumnIfMissing(db, "handoffs", "category", "category TEXT");
    addColumnIfMissing(db, "handoffs", "tags_json", "tags_json TEXT");
    addColumnIfMissing(db, "handoffs", "client_record_id", "client_record_id TEXT");
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
      `CREATE UNIQUE INDEX IF NOT EXISTS idx_agent_runs_client_run_id
      ON agent_runs (source, project, client_run_id)
      WHERE client_run_id IS NOT NULL`
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
