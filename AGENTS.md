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
