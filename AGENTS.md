# Runtrail Agent Instructions

Runtrail is an agent-first activity ledger. Keep changes small, structured, and validated.

## Rules

- Use `pnpm` only.
- Implement one phase at a time.
- Existing UI, Discord, MCP, Markdown export, and deployment/container surfaces may be maintained in their current scope.
- Do not expand those surfaces or add new product areas unless the active issue explicitly includes that phase.
- Store structured facts in SQLite and verbose logs as files.
- Do not store secrets in YAML or source files.
- Prefer boring TypeScript, Zod validation, and focused tests.

## Daily work and handoff

Use `pnpm cli doctor` for read-only access/state diagnosis. Before editing, use
`prepare-work` with the canonical work key. Capture commands with `pnpm cli run`
and keep its actual exit code and capture limitations. Use `brief --project ...`
(`--json` for schema v1) to continue, then create an explicit handoff with the
confirmed source run ID and next action. Review with `workflow packet --format
markdown`; JSON remains the portable packet default. See README's daily loop.

Completed runs are not verification. A recorded hash is a reference, not proof.
Verification applicability is unknown when revision/dirty-state linkage is
missing. Check bounded coverage, freshness, failed/not-run checks and source
IDs before acting. Sync is explicit; never replay shell commands or infer
permission to approve, merge, deploy or schedule. T3 native import is not yet
implemented; existing generic CLI/HTTP/MCP paths remain available.

## Validation

Before claiming completion, run:

```sh
pnpm lint
pnpm typecheck
pnpm test
```

Use `git diff --check` before a final handoff when files were edited.

## Local Config

Use `config/runtrail.example.yaml` for non-secret defaults. Override local secrets with environment variables:

```sh
RUNTRAIL_TOKEN=change-me-to-a-long-random-secret
DISCORD_WEBHOOK_URL=
```
