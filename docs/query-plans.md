# Query Plan Notes

## 2026-07-04 context and search baseline

Measured with `EXPLAIN QUERY PLAN` against the current SQLite schema in an in-memory database.

Context endpoints were mostly covered by existing indexes:

- Recent runs: `idx_agent_runs_project_updated_at`
- Open loops: `idx_open_loops_project_status_updated_at`
- Handoffs: `idx_handoffs_project_created_at`
- Decisions: `idx_decisions_project_created_at`, with a temporary sort for `project = ? OR project IS NULL`

Two `agent_runs` paths filtered by both `project` and `status` but used only `idx_agent_runs_status_updated_at`:

- Failed runs in `/agent/context`
- Run results in `/search` when project, source, status, and text filters are present

Adding `idx_agent_runs_project_status_updated_at (project, status, updated_at DESC)` changed both plans to:

```text
SEARCH agent_runs USING INDEX idx_agent_runs_project_status_updated_at (project=? AND status=?)
```

No cache or FTS change was added. Search text filters still use `%term%` `LIKE` predicates, so broader full-text search should be considered separately only after real data volume justifies it.
