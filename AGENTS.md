# Runtrail Agent Instructions

Runtrail is an agent-first activity ledger. Keep changes small, structured, and validated.

## Rules

- Use `pnpm` only.
- Implement one phase at a time.
- Do not add deployment, UI, Discord, MCP, or Markdown export work before its phase.
- Store structured facts in SQLite and verbose logs as files.
- Do not store secrets in YAML or source files.
- Prefer boring TypeScript, Zod validation, and focused tests.

## Validation

Before claiming completion, run:

```sh
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
