# Contributing

Runtrail is an agent-first activity ledger. Contributions should be small,
bounded by an issue, and easy for a human or coding agent to verify from a clean
checkout.

## Prerequisites

- Node.js 22.
- pnpm 11.5.2. Use pnpm only.
- Git.

From a clean clone:

```sh
git clone https://github.com/redxzeta/runtrail.git
cd runtrail
pnpm install
pnpm lint
pnpm typecheck
pnpm test
pnpm build
```

Start the service locally:

```sh
pnpm dev
```

Check the service:

```sh
curl http://127.0.0.1:8787/health
pnpm cli health
```

## Architecture Map

- `src/index.ts`: Hono application setup, route registration, config loading,
  SQLite opening, and server shutdown handling.
- `src/routes/`: HTTP route surfaces for health, ledger APIs, HTML, and MCP.
- `src/cli/index.ts`: `rt` CLI commands, command wrapping, Markdown exports,
  stale-run recovery, and receipt verification.
- `src/mcp/`: MCP stdio server and bridge adapters. These call the HTTP surface
  and must not read SQLite directly.
- `src/db/`: SQLite opening, migrations, schema statements, ledger repository
  methods, and row-mapping helpers.
- `src/shared/`: shared IDs, Zod schemas, timestamps, and receipt hashing.
- `src/config.ts`: YAML config parsing plus environment overrides for secrets
  and runtime settings.
- `config/runtrail.example.yaml`: non-secret defaults.
- `docs/`: design notes, MCP setup runbooks, safe-surface guidance, and the
  agent write contract.
- `test/`: Vitest coverage for routes, config, CLI, database behavior, MCP, and
  examples.

Structured facts belong in SQLite. Verbose logs belong in files. Markdown
exports are generated output, not the source of truth.

## Claiming Work

Before starting:

1. Pick an open issue, preferably one labeled `good first issue` or
   `help wanted`.
2. Read the issue body, comments, linked pull requests, and the read-first files
   listed by the issue.
3. Check whether the issue is assigned, already claimed in comments, or covered
   by an open pull request.
4. Comment that you would like to work on it before editing.
5. Wait for maintainer confirmation when the issue is already claimed,
   ambiguous, broad, or likely to overlap with active work.

If you discover unrelated work, open or suggest a separate issue. Do not expand
the current pull request to include it.

## Read-First Workflow

For every issue:

1. Read `AGENTS.md`, this guide, `README.md`, and
   `.github/pull_request_template.md`.
2. Read the files named in the issue before editing.
3. Restate the issue scope and out-of-scope boundaries in your notes or pull
   request.
4. Make the smallest change that satisfies the acceptance criteria.
5. Run the required validation from the repository root.
6. Prepare a handoff that lists changed files, commands run, outcomes, and
   remaining risks.

Coding agents should preserve this order. Do not infer permission to change
application behavior, schemas, migrations, deployment, UI, Discord, MCP, or
Markdown exports unless the active issue explicitly includes that surface.

## Phase And Product Boundaries

Runtrail is developed one phase at a time. Existing UI, Discord, MCP, Markdown
export, and deployment/container surfaces may be maintained in their current
scope. Do not expand those surfaces or add new product areas unless the active
issue explicitly includes that phase.

Keep pull requests limited to one issue and one phase. If a fix touches a
shared contract, update the relevant docs or agent instructions in the same
pull request.

## Code Conventions

- Use pnpm only. Do not add npm, Yarn, or Bun lockfiles.
- Use TypeScript.
- Prefer boring, explicit code over clever abstractions.
- Use Zod for runtime input validation and shared request/response contracts.
- Keep SQLite schema and migrations deliberate. Add tests for migration or
  repository changes.
- Store structured facts in SQLite and verbose logs as files.
- Use environment variables or ignored local env files for secrets.
- Keep examples non-secret and local-development safe.
- Use Conventional Commit pull request titles, such as `docs: add contributor
  guide` or `fix: handle stale run recovery`.

## Secret Handling

Never commit real secrets, tokens, webhook URLs, authorization headers, prompts,
private ledger data, raw tool output, or host-only secret paths.

Safe examples may use placeholders such as:

```sh
RUNTRAIL_TOKEN=change-me-to-a-long-random-secret
DISCORD_WEBHOOK_URL=
```

Non-secret defaults belong in `config/runtrail.example.yaml`. Secret overrides
belong in environment variables, ignored env files, or a secret store.

## Validation

Run these from the repository root before claiming completion:

```sh
pnpm lint
pnpm typecheck
pnpm test
pnpm build
git diff --check
```

If a command cannot run, report the exact command, failure, and environment
blocker. Do not mark validation as complete unless it actually passed.

## Pull Request Checklist

Use the pull request template and include:

- Current phase.
- Linked issue.
- Out-of-scope boundaries.
- Changed files and why they changed.
- Validation commands and outcomes.
- Any documentation or agent-instruction updates.
- Whether the pull request should create a release after merge.

Use a Conventional Commit title so semantic-release can determine release
impact.

## Handoff Template

Use this structure when handing work to a human, maintainer, or another agent:

```md
## Handoff

- Issue:
- Branch:
- Files changed:
- Scope completed:
- Out of scope:
- Validation:
- Documentation links checked:
- Intentional duplicated wording:
- Remaining risks:
- Follow-up issues:
```

For duplicated wording, call out whether it came from `AGENTS.md`, the pull
request template, or the active issue. Duplication is acceptable when it keeps
the contribution workflow usable without requiring readers to jump between
files.

## Useful Issue Filters

- [Good first issues](https://github.com/redxzeta/runtrail/issues?q=is%3Aissue%20is%3Aopen%20label%3A%22good%20first%20issue%22)
- [Help wanted issues](https://github.com/redxzeta/runtrail/issues?q=is%3Aissue%20is%3Aopen%20label%3A%22help%20wanted%22)
