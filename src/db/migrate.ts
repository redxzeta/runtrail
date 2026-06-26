import type Database from "better-sqlite3";
import { nowIso } from "../shared/time.js";
import { schemaStatements } from "./schema.js";

const migrationName = "001_initial_schema";

export function migrate(db: Database.Database): void {
  const transaction = db.transaction(() => {
    for (const statement of schemaStatements) {
      db.exec(statement);
    }

    db.prepare(
      "INSERT OR IGNORE INTO schema_migrations (id, name, applied_at) VALUES (?, ?, ?)"
    ).run(1, migrationName, nowIso());
  });

  transaction();
}
