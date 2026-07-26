# OpenClaw Runtrail Examples

Use the Runtrail wrapper when OpenClaw work should be durable across machines and agents.

Before configuring MCP, confirm the installed OpenClaw release exposes the client registry:

```sh
openclaw --version
openclaw mcp --help
```

The golden path was verified with OpenClaw `2026.7.1-2`. OpenClaw `2026.1.29` does not expose the
`mcp` command. If `openclaw mcp --help` fails, update OpenClaw and use a Node release accepted by
that OpenClaw package; do not bypass its runtime safety check.

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

After saving the stdio bridge from the
[MCP client setup runbook](../../docs/mcp-client-setup-runbook.md#openclaw), verify the configured
client path before an agent turn:

```sh
openclaw mcp status --verbose
openclaw mcp doctor runtrail --probe
openclaw mcp probe runtrail --json
```

`probe` should report the filtered Runtrail tools with no diagnostics. After a Runtrail restart,
run `openclaw mcp reload` and probe again. An unavailable service should produce a bounded
`Runtrail POST /mcp connection error` that recommends checking service health and
`RUNTRAIL_MCP_URL`; it must not include the bearer token.
