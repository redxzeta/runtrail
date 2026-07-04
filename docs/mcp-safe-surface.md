# MCP Safe Surface

Runtrail's MCP adapter is a thin HTTP client. It should expose small, filtered journal operations and must not return the entire ledger by default.

## Defaults

- Require `RUNTRAIL_URL` and `RUNTRAIL_TOKEN` from the MCP process environment.
- Default every list-style tool to `limit: 10`; cap caller-provided limits at `50`.
- Require `project` for project-context and open-loop list tools.
- Return compact event and handoff shapes by default; fetch full detail only through explicit id-based tools.
- Keep write tools append-oriented or narrow state transitions. Do not expose raw SQL, bulk deletes, config mutation, or unfiltered journal dumps.

## Proposed Tools

| Tool | Mode | HTTP route | Input | Output |
| --- | --- | --- | --- | --- |
| `journal_recent_runs` | Read-only | `GET /runs` | `{ project?: string, status?: string, started_from?: string, started_to?: string, limit?: number }` | `{ runs: AgentRun[] }` capped and ordered by recent update |
| `journal_get_run` | Read-only | `GET /runs/:id` | `{ id: string }` | `{ run: AgentRun, events: AgentEventWithoutData[] }` plus compact related records when implemented |
| `journal_get_context` | Read-only | `GET /agent/context` | `{ project: string, limit?: number, min_importance?: number }` | Compact project context with recent runs, failed runs, compact events, compact handoffs, open loops, decisions, and next actions |
| `journal_list_open_loops` | Read-only | `GET /open-loops` | `{ project: string, type?: OpenLoopType, status?: OpenLoopStatus, limit?: number }` | `{ openLoops: OpenLoop[] }` scoped to one project by default |
| `journal_create_event` | Write | `POST /events` | `{ runId: string, type: EventType, message: string, importance?: number, data?: object }` | `{ event: AgentEvent }` |
| `journal_create_handoff` | Write | `POST /handoffs` | `{ sourceRunId?: string, fromSource: string, toSource?: string, project: string, summary: string, nextAction?: string, context?: object }` | `{ handoff: Handoff }` |
| `journal_resolve_open_loop` | Write | `PATCH /open-loops/:id` | `{ id: string, resolution?: string }` | `{ openLoop: OpenLoop }` with status set to `resolved` |

## Schema Notes

- Reuse the Zod-backed HTTP schemas from `src/shared/schemas.ts`; MCP schemas should be narrower only when the tool intentionally hides API fields.
- `AgentEventWithoutData` means `id`, `runId`, `type`, `message`, `importance`, and `createdAt`.
- Compact handoff output means `id`, `sourceRunId`, `fromSource`, `toSource`, `project`, `summary`, `nextAction`, and `createdAt`; omit `context` unless a future explicit detail tool is added.
- Date filters use ISO datetimes and are normalized by the service before SQLite comparisons.

## Guardrails

- MCP list tools must reject or clamp large limits instead of forwarding unbounded requests.
- Read tools should prefer project/status/date filters over free-form broad search.
- Write tools must preserve the service's bearer auth boundary and HTTP validation; MCP should not duplicate database access.
- Any future tool that can create or resolve state should be named as a write-capable tool and documented here before implementation.
