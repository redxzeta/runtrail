# Codex Hook Adapter

`runtrail-codex-hook` records Codex lifecycle and supported tool activity through Runtrail's HTTP
API. It is observability-only: an invalid payload, missing configuration, network error, or Runtrail
error produces one concise local diagnostic and exits successfully so Codex work continues.

Codex may launch matching hooks concurrently. The adapter sends Codex's `session_id` as
`clientRunId`, relies on Runtrail's idempotent create contract, and atomically writes one local state
file per hashed session identifier. It never uses one shared active-run file.

## Install

Build Runtrail and link its executable from a trusted checkout:

```sh
pnpm install --frozen-lockfile
pnpm build
pnpm link --global
command -v runtrail-codex-hook
```

Create the local environment file. The default path is `~/.config/runtrail/codex.env`; override it
with `RUNTRAIL_CODEX_ENV` when needed.

```sh
install -d -m 700 "$HOME/.config/runtrail"
install -m 600 examples/codex/codex.env.example "$HOME/.config/runtrail/codex.env"
${EDITOR:-vi} "$HOME/.config/runtrail/codex.env"
```

Set `RUNTRAIL_URL` and `RUNTRAIL_TOKEN` locally. Optionally set `RUNTRAIL_PROJECT` when the git root
name is not the desired project name. Do not put the token in `hooks.json`, a repository env file,
or shell command arguments.

Merge the entries from [hooks.example.json](./hooks.example.json) into `~/.codex/hooks.json`, or
copy the file when no user hooks exist:

```sh
install -d -m 700 "$HOME/.codex"
install -m 600 examples/codex/hooks.example.json "$HOME/.codex/hooks.json"
```

Codex loads hooks from user and trusted project configuration and runs hook commands with the
session working directory. Hook definitions must be reviewed after installation or any change.
Restart Codex, open `/hooks`, inspect the source and exact command, and trust the four Runtrail
handlers. See the current [Codex hooks reference](https://learn.chatgpt.com/codex/hooks) for the
configuration, trust, concurrency, and stdin payload contract.

## Event Mapping and Data Boundary

| Codex input | Runtrail output | Persisted metadata |
| --- | --- | --- |
| `SessionStart` startup/resume/clear/compact | `started`; run reopened if needed | allowlisted start source |
| `UserPromptSubmit` | `started`; same run reopened for a new turn | no prompt text |
| `PostToolUse` for `Bash` | `command_executed` | executable plus safe subcommand only |
| Recognized test command | `test_started`, then `test_passed` or `test_failed` when the result is deterministic | sanitized command summary only |
| `PostToolUse` for `apply_patch` | `files_changed` | repository-relative paths from local git state |
| `Stop` | `completed`; run status completed | fixed lifecycle summary only |

Codex `Stop` is turn-scoped. A later prompt or resume for the same `session_id` reopens the same
Runtrail run; it does not create another run. A distinct Codex session creates a distinct run.

The adapter deliberately ignores prompt text, assistant messages, transcript paths, tool output,
arbitrary tool arguments, environment values, authorization headers, and unknown payload fields.
It does not read transcripts or invoke SSH or sudo. Local git metadata is collected with argument
arrays, and changed paths come from the local repository rather than hook-provided patch content.

## Verify

Check the service and hook trust first:

```sh
curl -fsS "$RUNTRAIL_URL/health"
codex
# In Codex: /hooks
```

Start one Codex session, edit a tracked file, and run a recognizable test command such as
`pnpm test`. After the turn stops, find the run and inspect its manifest:

```sh
curl -fsS -H "authorization: Bearer $RUNTRAIL_TOKEN" \
  "$RUNTRAIL_URL/runs?project=<project>&tag=codex&limit=1"
curl -fsS -H "authorization: Bearer $RUNTRAIL_TOKEN" \
  "$RUNTRAIL_URL/runs/<run-id>/manifest"
```

The manifest should contain non-empty `changed_files`, `commands`, and `tests`, and the run should
be `completed`. Resume the same Codex session and confirm the run id is unchanged. Start a separate
session and confirm it receives a new run id. Local per-session state is stored with mode `0600`
under `~/.local/state/runtrail/codex` by default.

After a merge, deploy Runtrail through the normal LXC update path and verify `/health` before
installing or refreshing the local adapter. Service deployment and client installation are separate
boundaries; verify both.

## Roll Back

Remove only the Runtrail matcher groups from `~/.codex/hooks.json`, restart Codex, and confirm they
are absent in `/hooks`. Then unlink the local executable if it is no longer used:

```sh
pnpm unlink --global runtrail
```

The local env and state directories may be removed after the hooks are disabled. Rollback does not
require a Runtrail database change and does not affect other MCP or HTTP clients.
