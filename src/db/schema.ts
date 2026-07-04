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
    ON agent_events (created_at DESC)`,
  `CREATE TABLE IF NOT EXISTS open_loops (
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
  )`,
  `CREATE INDEX IF NOT EXISTS idx_open_loops_project_status_updated_at
    ON open_loops (project, status, updated_at DESC)`,
  `CREATE INDEX IF NOT EXISTS idx_open_loops_status_updated_at
    ON open_loops (status, updated_at DESC)`,
  `CREATE TABLE IF NOT EXISTS decisions (
    id TEXT PRIMARY KEY,
    project TEXT,
    title TEXT NOT NULL,
    decision TEXT NOT NULL,
    rationale TEXT,
    created_at TEXT NOT NULL
  )`,
  `CREATE INDEX IF NOT EXISTS idx_decisions_project_created_at
    ON decisions (project, created_at DESC)`,
  `CREATE INDEX IF NOT EXISTS idx_decisions_created_at
    ON decisions (created_at DESC)`,
  `CREATE TABLE IF NOT EXISTS handoffs (
    id TEXT PRIMARY KEY,
    source_run_id TEXT,
    from_source TEXT NOT NULL,
    to_source TEXT,
    project TEXT NOT NULL,
    summary TEXT NOT NULL,
    next_action TEXT,
    context_json TEXT,
    created_at TEXT NOT NULL,
    FOREIGN KEY (source_run_id) REFERENCES agent_runs (id) ON DELETE SET NULL
  )`,
  `CREATE INDEX IF NOT EXISTS idx_handoffs_project_created_at
    ON handoffs (project, created_at DESC)`,
  `CREATE INDEX IF NOT EXISTS idx_handoffs_source_run_id_created_at
    ON handoffs (source_run_id, created_at DESC)`,
  `CREATE TABLE IF NOT EXISTS artifacts (
    id TEXT PRIMARY KEY,
    run_id TEXT NOT NULL,
    kind TEXT NOT NULL,
    path TEXT NOT NULL,
    size_bytes INTEGER,
    sha256 TEXT,
    created_at TEXT NOT NULL,
    FOREIGN KEY (run_id) REFERENCES agent_runs (id) ON DELETE CASCADE
  )`,
  `CREATE INDEX IF NOT EXISTS idx_artifacts_run_id_created_at
    ON artifacts (run_id, created_at DESC)`,
  `CREATE INDEX IF NOT EXISTS idx_artifacts_kind_created_at
    ON artifacts (kind, created_at DESC)`
] as const;
