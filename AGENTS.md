# Runtrail Agent Instructions

Runtrail is a local-first, tool-neutral work and evidence ledger for humans, scripts, and agents. Keep changes small, structured, and validated; see [product direction](docs/product-roadmap.md).

## Rules

- Use `pnpm` only.
- Implement one phase at a time.
- Existing UI, Discord, MCP, Markdown export, and deployment/container surfaces may be maintained in their current scope.
- Do not expand those surfaces or add new product areas unless the active issue explicitly includes that phase.
- Store structured facts in SQLite and verbose logs as files.
- Do not store secrets in YAML or source files.
- Prefer boring TypeScript, Zod validation, and focused tests.

## Daily work and handoff

Runtrail use is opt-in for useful cross-tool handoffs; skip it when the current
thread or a plain handoff is simpler. Run `pnpm cli doctor` during setup or when
access fails. For an explicit terminal-source handoff, use `workflow capture`
with selected metadata and authored summary/next action, then continue with
`brief --project ... --work-key ... --import-provenance` (add `--json` for schema
v1). Keep the saved envelope unchanged and use `workflow capture --retry` after
uncertain delivery. See the [capture guide](docs/workflow-capture.md).

Use `prepare-work` when its advisory working set helps; it is not a mandatory
pre-edit ritual. For commands worth recording, `pnpm cli run` preserves the actual
exit code and capture limitations. An explicit handoff needs a confirmed source
run ID and authored next action. Review with `workflow packet --format markdown`
when a review packet is useful; JSON remains the portable packet default.

Completed runs are not verification. A recorded hash is a reference, not proof.
Verification applicability is unknown when revision/dirty-state linkage is
missing. Check bounded coverage, freshness, failed/not-run checks and source
IDs before acting. Sync is explicit; never replay shell commands or infer
permission to approve, merge, deploy or schedule. Explicit T3/generic summary
import is available through the [versioned CLI contract](docs/import-work-summary.md);
native automatic T3 hooks and configured-client integration have not been tested.

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
