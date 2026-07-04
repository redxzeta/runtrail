import { existsSync, mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { loadConfig } from "../src/config.js";
import { openDatabase } from "../src/db/index.js";

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
  });
});
