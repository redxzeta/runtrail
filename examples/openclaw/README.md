# OpenClaw Runtrail Examples

Use the Runtrail wrapper when OpenClaw work should be durable across machines and agents.

```sh
export RUNTRAIL_URL=http://127.0.0.1:8787
export RUNTRAIL_TOKEN=change-me-to-a-long-random-secret

rt run \
  --source openclaw \
  --project ice-council \
  --task "research candidate handoff" \
  --category research \
  --tag openclaw \
  --tag ice-council \
  -- openclaw run "research today's candidate set"
```

For interactive shells:

```sh
alias clawj='rt run --source openclaw'
clawj --project ice-council --task "submit-only preflight" --category ops --tag openclaw --tag submit-only -- openclaw run "prepare submit-only preflight"
```

Wrappers are preferred over agent self-reporting because they record command start, exit status, cwd, host, git metadata, changed files, and log artifact metadata even when the agent fails before writing a final summary.

When OpenClaw uses Runtrail MCP directly, include the continuity tools in the
server tool filter: `journal_get_context`, `journal_search`,
`journal_search_runs`, `journal_get_run_manifest`, `journal_create_handoff`,
`journal_create_event`, `journal_create_open_loop`,
`journal_resolve_open_loop`, and `journal_record_decision`.
