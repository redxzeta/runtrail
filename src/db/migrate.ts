import type Database from "better-sqlite3";
import { nowIso } from "../shared/time.js";
import { schemaStatements } from "./schema.js";

const migrationName = "001_initial_schema";

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

    db.prepare(
      "INSERT OR IGNORE INTO schema_migrations (id, name, applied_at) VALUES (?, ?, ?)"
    ).run(1, migrationName, nowIso());
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
