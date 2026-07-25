# MCP Safe Surface

Runtrail's MCP adapter is a thin HTTP client. It should expose small, filtered journal operations and must not return the entire ledger by default.

## Defaults

- Require `RUNTRAIL_URL` and `RUNTRAIL_TOKEN` from the MCP process environment.
- Expose hosted MCP over Streamable HTTP at `/mcp` for remote-capable agents.
- Use `RUNTRAIL_MCP_URL` and `RUNTRAIL_TOKEN` for stdio bridge processes.
- Never SSH, sudo, or scrape live env files from MCP startup commands.
- Default every list-style tool to `limit: 10`; cap prepare-work at `20` and other caller-provided
  limits at `50`.
- Require `project` for project-context and open-loop list tools.
- Return compact event and handoff shapes by default; fetch full detail only through explicit id-based tools.
- Keep write tools append-oriented or narrow state transitions. Do not expose raw SQL, bulk deletes, config mutation, or unfiltered journal dumps.

## Proposed Tools

| Tool | Mode | HTTP route | Input | Output |
| --- | --- | --- | --- | --- |
| `journal_search_runs` | Read-only | `GET /runs` | `{ project?: string, workKey?: string, status?: string, category?: string, tag?: string, limit?: number }` | `{ runs: AgentRun[] }` capped and ordered by recent update |
| `journal_start_run` | Write | `POST /runs` | Bounded run identity and task fields, including optional `workKey`, `workflowId`, `parentRunId`, and `continuedFromRunId` | `{ run, recovery?, conflicts }` |
| `journal_resume_run` | Write | `POST /runs/:id/resume` | `{ runId, expectedVersion? }` | `{ run }` |
| `journal_heartbeat_run` | Write | `POST /runs/:id/heartbeat` | `{ runId, expectedVersion? }` | `{ run }` without a new event |
| `journal_pause_run` | Write | `POST /runs/:id/pause` | `{ runId, expectedVersion?, status, summary? }` | `{ run }` |
| `journal_finish_run` | Write | `POST /runs/:id/finish` | `{ runId, expectedVersion?, status, summary, completedAt?, gitBranch?, gitCommit? }` | `{ run }` |
| `journal_get_run_manifest` | Read-only | `GET /runs/:id/manifest` | `{ runId: string }` | Compact run manifest with linked events, changed files, commands, tests, open loops, handoffs, artifacts, verifications, and canonical readiness |
| `journal_get_workflow` | Read-only | `GET /workflows/:workflowId/runs` | `{ workflowId: string, project: string, limit?: number }` | Bounded oldest-first related-run summaries, explicit truncation, and canonical readiness |
| `journal_get_context` | Read-only | `GET /agent/context` | `{ project: string, limit?: number, min_importance?: number, cursor?: string }` | Compact full context, or bounded changed runs, events, open loops, handoffs, and decisions after an opaque cursor |
| `journal_prepare_work` | Read-only | `GET /agent/prepare-work` | `{ project: string, source?: string, workKey?: string, runId?: string, category?: string, tags?: string[], limit?: number, cursor?: string }` | Bounded lifecycle, effective decision summaries, authoritative freshness, canonical readiness for a selected run, stable advisory actions, and an optional incremental change envelope |
| `journal_search` | Read-only | `GET /search` | `{ project?: string, source?: string, status?: string, category?: string, tag?: string, text?: string, date_from?: string, date_to?: string, effectiveOnly?: boolean, limit?: number }` | Compact runs, events, open loops, handoffs, and all or effective-only decisions matching the filters |
| `journal_create_event` | Write | `POST /events` | `{ runId: string, clientRecordId?: string, type: EventType, message: string, importance?: number, category?: string, tags?: string[], data?: object }` | `{ event: AgentEvent }` |
| `journal_record_verification` | Write | `POST /verifications` | Bounded typed check, outcome, support, and completion time for one run | `{ verification: VerificationEvidence }` |
| `journal_create_handoff` | Write | `POST /handoffs` | `{ sourceRunId?: string, clientRecordId?: string, fromSource: string, toSource?: string, project: string, summary: string, nextAction?: string, category?: string, tags?: string[], context?: object }` | `{ handoff: Handoff }` |
| `journal_list_pending_handoffs` | Read-only | `GET /handoffs` | `{ project?: string, toSource?: string, limit?: number }` | Pending handoffs only, bounded to 50 |
| `journal_accept_handoff` | Write | `POST /handoffs/:id/accept` | `{ id, expectedVersion, acceptedBy, targetRunId?, run? }` with exactly one receiving-run option | Accepted handoff and receiving run |
| `journal_decline_handoff` | Write | `POST /handoffs/:id/decline` | `{ id, expectedVersion, reason? }` | Declined handoff |
| `journal_complete_handoff` | Write | `POST /handoffs/:id/complete` | `{ id, expectedVersion }` | Completed handoff |
| `journal_expire_handoff` | Write | `POST /handoffs/:id/expire` | `{ id, expectedVersion }` | Expired handoff |
| `journal_create_open_loop` | Write | `POST /open-loops` | `{ type: OpenLoopType, project: string, clientRecordId?: string, title: string, description?: string, owner?: string, source?: string, nextAction?: string, blockerRef?: string, sourceRunId?: string }` | `{ openLoop: OpenLoop }` |
| `journal_resolve_open_loop` | Write | `PATCH /open-loops/:id` | `{ id: string, expectedVersion?: number, resolution?: string }` | `{ openLoop: OpenLoop }` with status set to `resolved` |
| `journal_record_decision` | Write | `POST /decisions` | `{ project?: string, clientRecordId?: string, supersedesDecisionId?: string, title: string, decision: string, rationale?: string }` | `{ decision: Decision }` |
| `journal_list_decisions` | Read-only | `GET /decisions` | `{ project?: string, includeGlobal?: boolean, effectiveOnly?: boolean, limit?: number }` | Bounded decision history or current guidance with explicit derived state |

## Schema Notes

- Reuse the Zod-backed HTTP schemas from `src/shared/schemas.ts`; MCP schemas should be narrower only when the tool intentionally hides API fields.
- `AgentEventWithoutData` means `id`, `runId`, `type`, `message`, `importance`, and `createdAt`.
- Compact handoff output also includes lifecycle status, receiving-run linkage, version, and lifecycle timestamps; omit `context`.
- Date filters use ISO datetimes and are normalized by the service before SQLite comparisons.
- `clientRecordId` is an optional non-secret idempotency key. Its ownership scope is documented in `docs/agent-write-contract.md`.
- Verification support is explicit and client-reported. Never infer success from names, summaries,
  event status, or run status, and never send raw command output or secret-bearing material.
- `workKey` is an optional stable work identifier. Prefer a namespaced canonical value such as
  `github:owner/repository#123`, `linear:TEAM-123`, or `internal:project/item`; Runtrail does not
  require a specific external issue system.
- Start-run conflicts are advisory, limited to ten recently updated nonterminal runs in the same
  project with the same work key, and never include the authoritative run returned by a replay.
- Mutable run, open-loop, and handoff tools should send the last observed `version` as `expectedVersion`.
  Stale writes return the HTTP conflict unchanged through MCP so the agent can reread safely.
- Run relationships are immutable and explicit: `parentRunId` means delegation/child lineage,
  `continuedFromRunId` means a new run continuing a previous run, and `workflowId` groups related
  runs without scheduling them.
- Prepare-work uses the server-owned `lastLivenessAt` signal and configured freshness window.
  Append timestamps cannot revive a run. `stale_candidate` and every recommendation remain
  advisory; unknown freshness produces `stop_and_reread`, never automatic new work.
- Prepare-work summaries omit tasks, summaries, event bodies, handoff context, open-loop prose,
  logs, prompts, credentials, headers, environment data, and private paths.
- Workflow, prepare-work, manifest, direct MCP, and stdio-bridge reads preserve the same readiness
  status, reason codes, findings, actions, provenance, versions, and `asOf`. Readiness is a bounded
  deterministic projection, not an MCP-side policy decision.
- Context cursors use server-owned change sequences rather than client timestamps. The opaque token
  contains only a version, query fingerprint, and per-section numeric positions; invalid or
  wrong-query cursors fail with `retry_without_cursor`.

## Guardrails

- MCP list tools must reject or clamp large limits instead of forwarding unbounded requests.
- Read tools should prefer project/status/date filters over free-form broad search.
- Write tools must preserve the service's bearer auth boundary and HTTP validation; MCP should not duplicate database access.
- Any future tool that can create or resolve state should be named as a write-capable tool and documented here before implementation.
