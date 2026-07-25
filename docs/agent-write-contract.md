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

Runs may optionally declare `agentName` and `agentModel`. `source` continues to identify the
integration or client. `agentName` is a client-declared logical role or configured display identity
(maximum 120 characters), while `agentModel` is the client-declared active model identifier
(maximum 255 characters). Both are informational assertions, not authenticated identities.
Integrations may populate them only from a documented structured field or explicit local
configuration; when either value is unavailable, omit it rather than infer it from prompts,
transcripts, command output, processes, or private configuration. Idempotent run replay returns the
original values without applying retry payload changes.

Append-oriented writes may include a stable, non-secret `clientRecordId`. A retry with the same key
returns the original event, open loop, decision, handoff, artifact, or verification without changing its payload
or timestamps. The key is scoped by record type and its stable owner:

- Events, artifacts, and verifications: `runId` plus `clientRecordId`.
- Open loops and handoffs: `project` plus `clientRecordId`.
- Decisions: `project` (or the global decision scope) plus `clientRecordId`.

The same key may be reused in a different record type, run, or project without collision. Clients
that omit `clientRecordId` keep the existing append behavior. Keys are bounded identifiers, not
payload hashes: never derive them from prompts, logs, environment values, credentials, or other
secret-bearing content.

## Verification Evidence

Use `POST /verifications`, `rt verification add`, or `journal_record_verification` for bounded
structured checks. Every record has a stable `checkId`, one kind (`test`, `lint`, `typecheck`,
`build`, `smoke`, or `custom`), and one explicit outcome (`passed`, `failed`, `not_run`, or
`not_applicable`). The run manifest returns these records oldest-first in `verifications`.

Evidence support is explicit: `client_reported`, an `exit_code`, a bounded receipt reference, an
artifact SHA-256 digest, or `unavailable` with `not_provided`/`not_supported`. `not_run` and
`not_applicable` cannot carry execution or artifact proof. These facts remain client assertions;
Runtrail does not infer success from a command name, summary, event status, or terminal run state.
Omit unknown evidence rather than scraping logs. Never place stdout, stderr, prompts, transcripts,
credentials, headers, environment data, private paths, or unbounded arguments in verification
fields.

## Effective Decisions

A new decision may set `supersedesDecisionId` to one existing decision in the same project or the
same global scope. The prior row remains immutable and readable with `state: "superseded"` plus its
`replacingDecisionId`; the replacement is `current`. Runtrail never infers this relationship from
titles or text. History reads and search include both states by default, while `effectiveOnly=true`
returns current guidance ordered by `createdAt` descending and then ID descending. Compact context
and prepare-work expose only current project and global decisions. Use `rt decision list
--effective-only` or `journal_list_decisions` before acting on guidance.

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

## Workflow Readiness

Workflow reads, targeted prepare-work responses, and run manifests expose the same canonical
`readiness` object. Read it directly with
`GET /workflows/:workflowId/readiness?project=<project>` or
`rt workflow readiness --workflow-id <id> --project <project>`. The projection is advisory: it
never completes work, retries checks, changes handoffs, or blocks an external action.

Origins are `client_reported`, `server_observed`, and `deterministic_derivation`. Assurance is
independent and uses `asserted`, `evidence_backed`, `mixed`, or `unknown`; readiness never upgrades
weaker input. The pure projection applies these rules:

| Input | Origin | Assurance |
| --- | --- | --- |
| Run lifecycle and version | `server_observed` | `asserted` |
| Open-loop claim and version | `client_reported` | `asserted` |
| Handoff transition and version | `server_observed` | `evidence_backed` |
| Persisted decision lineage | `server_observed` | `evidence_backed` |
| Verification with `client_reported` support | `client_reported` | `asserted` |
| Verification with exit code, receipt, or artifact digest | `client_reported` | `evidence_backed` |
| Verification with unavailable support | `client_reported` | `unknown` |
| Readiness finding | `deterministic_derivation` | weakest/combined assurance of its references |

Effective replacement decisions reference both prior and current IDs as lineage, but only the
current decision is actionable. For repeated `(runId, checkId)` verification, the latest
`completedAt` and ID wins. A terminal run never implies verification success.

Rules use this fixed precedence:

1. incomplete relationships or bounded-input truncation → `unknown`
2. blocked runs or unresolved hard/decision loops → `blocked`
3. pending or accepted handoffs → `in_progress`
4. fresh nonterminal related runs → `in_progress`
5. stale-candidate or unknown-freshness related runs → `unknown`
6. failed verification → `needs_evidence`
7. explicit `not_run` → `needs_evidence`
8. missing verification disposition → `needs_evidence`
9. terminal runs with explicit nonblocking dispositions → `ready_for_review`
10. unclassifiable legacy state → `unknown`

Stable reason codes are `workflow_relationships_incomplete`, `workflow_inputs_truncated`,
`related_run_blocked`, `unresolved_hard_blocker`, `handoff_incomplete`,
`fresh_related_run_active`, `stale_related_run_requires_inspection`,
`related_run_freshness_unknown`, `verification_failed`, `required_verification_not_run`,
`required_verification_missing`, `workflow_ready_for_review`, and
`legacy_workflow_unclassified`. Actions reuse `inspect_active_conflict`, `inspect_stale_run`,
`resolve_blocker`, `complete_handoff`, `record_verification_disposition`,
`rerun_failed_verification`, `inspect_effective_decision`, and `stop_and_reread`.

Each finding contains at most 20 deterministically ordered `sourceRefs` with `type`, `id`, optional
current `version`, origin, and assurance. Findings and actions are also capped at 20. Caveats use
`verification_client_reported`, `verification_support_unavailable`,
`workflow_inputs_truncated`, and `legacy_relationships_missing`. No readiness response embeds raw
records, event data, summaries, logs, prompts, transcripts, credentials, headers, environment
data, or private paths. Older unlinked runs remain readable and return conservative `unknown`.

## Incremental Context

`journal_get_context` and `journal_prepare_work` return an opaque versioned `cursor`. Supplying that
cursor on the next read returns `mode: "incremental"` and a bounded `changes` envelope for runs,
events, open loops, handoffs, and decisions. Context incremental mode leaves the legacy full-context
arrays empty; prepare-work retains its bounded current safety snapshot so recommendations never rely
on partial state.

Cursors are scoped to the normalized query and contain only a version, a query fingerprint, and
server-owned numeric change positions. They contain no record data, timestamps, database paths, or
SQL. Limits may change between reads without invalidating a cursor. When a section is truncated,
use the returned cursor again until that section is empty. Server sequences and record-ID
tie-breakers prevent equal or client-dated timestamps from skipping or repeating records.

An invalid, unsupported, or wrong-query cursor returns `invalid_cursor` with
`action: "retry_without_cursor"`. Restart with a full read rather than guessing or editing the
cursor.

## Local Outbox and Replay

The CLI queues only failed append creates carrying `clientRunId` or `clientRecordId`. Network
errors, timeouts, HTTP 408/429, and 5xx responses are retryable; permanent 4xx responses are
quarantined. Run lifecycle mutations and unkeyed writes are never queued. Each owner-only JSON file
contains the operation, route, safe payload, idempotency key, creation time, and retry count—never
the bearer token, authorization headers, environment contents, or verbose logs. Records are capped
at 64 KiB.

Use `rt outbox list` for bounded metadata and `rt outbox retry` or `rt sync` for explicit replay.
Successful authoritative responses remove the pending record. Malformed records move to quarantine
with a bounded reason. Replaying duplicates is safe because the original idempotency key and payload
are preserved. Delayed event replay never updates `lastLivenessAt`; only explicit heartbeat or
resume does.

The command wrapper attempts queued telemetry at safe post-command boundaries. A telemetry or sync
failure is reported as unsynced work but never replaces the wrapped command's exit status.

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
