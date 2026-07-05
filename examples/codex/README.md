# Codex Runtrail Examples

Use the Runtrail wrapper around Codex tasks that should leave recoverable context.

```sh
export RUNTRAIL_URL=http://127.0.0.1:8787
export RUNTRAIL_TOKEN=change-me-to-a-long-random-secret

rt run \
  --source codex \
  --project runtrail \
  --task "implement event API" \
  -- codex "implement event API"
```

For interactive shells:

```sh
alias codexj='rt run --source codex'
codexj --project runtrail --task "review open loops" -- codex "summarize blockers and next actions"
```

Wrappers are preferred over agent self-reporting because Runtrail still captures the run outcome and log path when Codex exits non-zero, loses context, or stops before posting a handoff.

When Codex uses Runtrail MCP directly, include the continuity tools in the
server allowlist: `journal_get_context`, `journal_search`,
`journal_search_runs`, `journal_get_run_manifest`, `journal_create_handoff`,
`journal_create_event`, `journal_create_open_loop`,
`journal_resolve_open_loop`, and `journal_record_decision`.
