export const schemaStatements = [
  `CREATE TABLE IF NOT EXISTS schema_migrations (
    id INTEGER PRIMARY KEY,
    name TEXT NOT NULL UNIQUE,
    applied_at TEXT NOT NULL
  )`,
  `CREATE TABLE IF NOT EXISTS agent_runs (
    id TEXT PRIMARY KEY,
    source TEXT NOT NULL,
    project TEXT NOT NULL,
    task TEXT NOT NULL,
    status TEXT NOT NULL,
    hostname TEXT,
    cwd TEXT,
    git_repo_path TEXT,
    git_branch TEXT,
    git_commit TEXT,
    summary TEXT,
    started_at TEXT NOT NULL,
    completed_at TEXT,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
  )`,
  `CREATE INDEX IF NOT EXISTS idx_agent_runs_project_updated_at
    ON agent_runs (project, updated_at DESC)`,
  `CREATE INDEX IF NOT EXISTS idx_agent_runs_status_updated_at
    ON agent_runs (status, updated_at DESC)`,
  `CREATE TABLE IF NOT EXISTS agent_events (
    id TEXT PRIMARY KEY,
    run_id TEXT NOT NULL,
    type TEXT NOT NULL,
    message TEXT NOT NULL,
    importance INTEGER NOT NULL,
    data_json TEXT,
    created_at TEXT NOT NULL,
    FOREIGN KEY (run_id) REFERENCES agent_runs (id) ON DELETE CASCADE
  )`,
  `CREATE INDEX IF NOT EXISTS idx_agent_events_run_id_created_at
    ON agent_events (run_id, created_at ASC)`,
  `CREATE INDEX IF NOT EXISTS idx_agent_events_created_at
    ON agent_events (created_at DESC)`
] as const;
