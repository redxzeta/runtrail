# Agent Write Contract

This contract makes Runtrail useful when a different agent needs to continue work later. Agents should write small, structured facts to Runtrail while keeping verbose logs in files.

## Required Fields

Every agent run should include:

- `source`: agent or runtime, such as `codex`, `openclaw`, `claude-code`, or `opencode`.
- `project`: stable project name, such as `runtrail` or `ice-council`.
- `task`: short work description.
- `category`: one of `implementation`, `review`, `debug`, `deploy`, `research`, `planning`, or `ops`.
- `tags`: stable search tags, such as `codex`, `openclaw`, `claude-code`, `opencode`, `runtrail`, `ice-council`, `issue-N`, `pr-N`, `mcp`, or `lxc`.

Automatic integrations should also send a stable, non-secret `clientRunId` for the local agent
session. Runtrail scopes this identifier by `source` and `project`. The first `POST /runs` returns
`201`; retries with the same tuple return `200` and the original `{ run }` without changing its
task, status, git metadata, or timestamps. Continue that run through events and `PATCH /runs/:id`.
Clients that omit `clientRunId` keep the non-idempotent create behavior.

Append-oriented writes may include a stable, non-secret `clientRecordId`. A retry with the same key
returns the original event, open loop, decision, handoff, or artifact without changing its payload
or timestamps. The key is scoped by record type and its stable owner:

- Events and artifacts: `runId` plus `clientRecordId`.
- Open loops and handoffs: `project` plus `clientRecordId`.
- Decisions: `project` (or the global decision scope) plus `clientRecordId`.

The same key may be reused in a different record type, run, or project without collision. Clients
that omit `clientRecordId` keep the existing append behavior. Keys are bounded identifiers, not
payload hashes: never derive them from prompts, logs, environment values, credentials, or other
secret-bearing content.

## Mutable Record Versions

Runs, open loops, and handoffs include a positive integer `version`, initialized to `1`. Clients
should reread the record, send that value as `expectedVersion` with lifecycle or update requests,
and retain the new version returned after a successful mutation. A successful mutation increments
the version exactly once. Append-only event creation does not increment it.

For run and open-loop updates, `expectedVersion` remains optional during rollout so existing clients
continue to work with last-write-wins behavior. Handoff transitions require it. A stale precondition
returns `409 Conflict` with `recordType`, `expectedVersion`, compact current `id`, `status`,
`version`, and `updatedAt` fields, plus `action: "reread"`. On conflict, reread the record and decide
whether the mutation is still valid; do not retry blindly with a substituted version.

## Workflow Relationships

Runs may declare three immutable relationships at creation:

- `workflowId` groups planning, implementation, review, retry, and continuation runs under one
  caller-selected stable identifier.
- `parentRunId` identifies the run that delegated or spawned this child run.
- `continuedFromRunId` identifies the previous run whose work this new run continues.

Parent and continuation references must already exist in the same project. A linked run inherits the
referenced run's `workflowId` when the caller omits one; conflicting workflow IDs are rejected.
Because relationships are create-time-only and point to existing runs, API-created relationship
cycles cannot occur. Retrying `POST /runs` with the same `clientRunId` returns the original run and
is not a continuation; create a new run with `continuedFromRunId` for a new agent session.

Use `GET /workflows/:workflowId/runs?project=<project>` or `journal_get_workflow` for a bounded,
oldest-first summary of the related runs.

## Handoff Lifecycle

New handoffs start as `pending`. Their summary, context, source run, and routing metadata remain
immutable. The recipient accepts with the current `expectedVersion`, its bounded `acceptedBy`
identity, and either an existing `targetRunId` or a receiving-run create payload. Server-created
receiving runs continue from the handoff's source run and inherit its workflow relationship.

Only explicit transitions are allowed: `pending` to `accepted`, `declined`, or `expired`, and
`accepted` to `completed`. Acceptance uses a compare-and-swap update, so concurrent recipients
cannot both accept the same version. The default handoff list and `journal_list_pending_handoffs`
return only actionable pending records; use `status=all`, another explicit status, or journal search
for audit history. Project context exposes `pending_handoffs` separately from
`recent_handoffs`.

Automatic session creation records an allowlisted recovery receipt in the selected run manifest.
Receipts identify the client session, normalized workspace, selected run, action, optional previous
run, and bounded stale reason. `create_new`, `reuse`, `reopen`, and `mark_stale` decisions remain
auditable, while compact context contains only one `recovery_outcome` event for the authoritative
run. Retries must not be reported as fresh progress, and receipts never contain prompts, tool output,
credentials, environment values, or arbitrary hook payloads.

When available, wrappers should also capture host, cwd, git repo path, branch, commit, changed files, command exit code, and log path.

## When To Write

- Start a run when an agent begins a scoped task.
- Write events for material progress, file changes, commands, tests, failures, and decisions that affect continuation.
- Write a handoff when another agent or future session should continue the task.
- Write an open loop when work is blocked, needs review, needs a decision, or has a follow-up that should not be lost.
- Write a decision when a durable architectural or operational choice is made.

Use `summary` for what happened, `nextAction` for the next concrete step, and `blockedReason` inside event or handoff context when work cannot continue.

## Stale Session Recovery

Inspect stale `running` records through the HTTP-backed CLI. Durations use `s`, `m`, `h`, or `d`:

```sh
rt runs close-stale --older-than 24h
```

The command is a dry run by default and prints every candidate. Review that output, then repeat
with `--apply` to mark only runs whose `updatedAt` is strictly older than the boundary as
`cancelled`. Applied records receive a generated completion timestamp and an explicit stale-session
summary. Recent runs and terminal runs are never selected, and Runtrail does not run an automatic
startup sweeper.

```sh
rt runs close-stale --older-than 24h --apply
```

## Authoritative Liveness

`lastLivenessAt` is a nullable server-owned timestamp. Runtrail initializes it when a run is
created and refreshes it only after an explicit heartbeat or successful resume. Events, client
timestamps, idempotent replay, handoffs, searches, and arbitrary run updates never refresh it.
Terminal runs have `not_applicable` freshness; migrated legacy runs without a trustworthy signal
remain `unknown`.

Prepare-work compares this timestamp with the instance-wide
`agentContext.staleAfterSeconds` setting (default `3600`, environment override
`RUNTRAIL_AGENT_STALE_AFTER_SECONDS`). A signal exactly on the boundary is still `fresh`; only an
older signal is a `stale_candidate`. Staleness is advisory and never cancels, resumes, reassigns, or
accepts work automatically.

## Continuation Query

Before editing, call `journal_prepare_work` (or `GET /agent/prepare-work` / `rt prepare-work`) with
the project and any known source, work key, run ID, category, or tags. A run ID targets that run and
its workflow context. The response uses one server `asOf`, separates lifecycle status from
freshness, returns bounded sections and current optimistic versions, and omits tasks, record bodies,
logs, prompts, credentials, environment data, and private paths.

Handle the stable action codes without executing them implicitly:

- `inspect_active_conflict`, `inspect_stale_run`, or `inspect_failed_manifest`: reread the referenced run.
- `resolve_blocker`: inspect the referenced open loop.
- `accept_handoff`: reread and explicitly accept with the referenced handoff version.
- `resume_run`: explicitly resume with the referenced run version.
- `start_new_run`: no conflicting or blocked work was found in the bounded response.
- `stop_and_reread`: freshness is unknown or another ambiguity makes starting unsafe.

Reason codes are also bounded: `fresh_nonterminal_same_work_key`,
`run_liveness_exceeds_window`, `run_liveness_unknown`, `blocking_open_loop`,
`pending_targeted_handoff`, `selected_run_failed`, `selected_run_can_resume`,
`selected_run_terminal`, and `no_conflicting_or_blocked_work`.

Use `journal_search`, `journal_get_context`, and `journal_get_run_manifest` only when the
prepare-work recommendation calls for more detail. A recommendation is advisory and never performs
a mutation.

## Copyable Snippets

Codex `AGENTS.md` snippet:

```md
When working in this repo, write Runtrail entries with source `codex`, project `<project>`, a category, and stable tags such as `codex`, `issue-N`, and `pr-N`. Before continuing existing work, query Runtrail context and relevant handoffs. At handoff, record summary, nextAction, branch, changedFiles, testsRun, and blockedReason if blocked.
```

OpenClaw local instruction snippet:

```md
Use Runtrail for durable task continuity. Prefer `rt run --source openclaw --project <project> --task <task> --category <category> --tag openclaw --tag issue-N -- <command>` for command work. Use Runtrail MCP for context, search, manifests, events, open loops, decisions, and handoffs.
```

Claude Code hook snippet:

```sh
rt event create --run-id "$RUNTRAIL_RUN_ID" --type progress --message "Claude Code made progress" --importance 4 --category implementation --tag claude-code --tag issue-N
rt handoff create --source-run-id "$RUNTRAIL_RUN_ID" --from-source claude-code --to-source codex --project "$RUNTRAIL_PROJECT" --summary "Ready for continuation" --next-action "Review changed files and run tests" --category implementation --tag claude-code --tag issue-N
```

opencode MCP snippet:

```json
{
  "mcp": {
    "runtrail": {
      "type": "remote",
      "url": "http://127.0.0.1:8787/mcp",
      "headers": {
        "Authorization": "Bearer ${RUNTRAIL_TOKEN}"
      },
      "enabled": true
    }
  }
}
```

Secrets must stay in environment variables, ignored env files, or secret stores. Do not commit real tokens, webhook URLs, or host-only secret paths to docs, source, YAML, or examples.
