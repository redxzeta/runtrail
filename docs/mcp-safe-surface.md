# MCP Safe Surface

Runtrail's MCP adapter is a thin HTTP client. It should expose small, filtered journal operations and must not return the entire ledger by default.

## Defaults

- Require `RUNTRAIL_URL` and `RUNTRAIL_TOKEN` from the MCP process environment.
- Expose hosted MCP over Streamable HTTP at `/mcp` for remote-capable agents.
- Use `RUNTRAIL_MCP_URL` and `RUNTRAIL_TOKEN` for stdio bridge processes.
- Never SSH, sudo, or scrape live env files from MCP startup commands.
- Default every list-style tool to `limit: 10`; cap caller-provided limits at `50`.
- Require `project` for project-context and open-loop list tools.
- Return compact event and handoff shapes by default; fetch full detail only through explicit id-based tools.
- Keep write tools append-oriented or narrow state transitions. Do not expose raw SQL, bulk deletes, config mutation, or unfiltered journal dumps.

## Proposed Tools

| Tool | Mode | HTTP route | Input | Output |
| --- | --- | --- | --- | --- |
| `journal_search_runs` | Read-only | `GET /runs` | `{ project?: string, status?: string, category?: string, tag?: string, limit?: number }` | `{ runs: AgentRun[] }` capped and ordered by recent update |
| `journal_get_run_manifest` | Read-only | `GET /runs/:id/manifest` | `{ runId: string }` | Compact run manifest with linked events, changed files, commands, tests, open loops, handoffs, and artifacts |
| `journal_get_context` | Read-only | `GET /agent/context` | `{ project: string, limit?: number, min_importance?: number }` | Compact project context with recent runs, failed runs, compact events, compact handoffs, open loops, decisions, and next actions |
| `journal_search` | Read-only | `GET /search` | `{ project?: string, source?: string, status?: string, category?: string, tag?: string, text?: string, date_from?: string, date_to?: string, limit?: number }` | Compact runs, events, open loops, handoffs, and decisions matching the filters |
| `journal_create_event` | Write | `POST /events` | `{ runId: string, type: EventType, message: string, importance?: number, category?: string, tags?: string[], data?: object }` | `{ event: AgentEvent }` |
| `journal_create_handoff` | Write | `POST /handoffs` | `{ sourceRunId?: string, fromSource: string, toSource?: string, project: string, summary: string, nextAction?: string, category?: string, tags?: string[], context?: object }` | `{ handoff: Handoff }` |
| `journal_create_open_loop` | Write | `POST /open-loops` | `{ type: OpenLoopType, project: string, title: string, description?: string, owner?: string, source?: string, nextAction?: string, blockerRef?: string, sourceRunId?: string }` | `{ openLoop: OpenLoop }` |
| `journal_resolve_open_loop` | Write | `PATCH /open-loops/:id` | `{ id: string, resolution?: string }` | `{ openLoop: OpenLoop }` with status set to `resolved` |
| `journal_record_decision` | Write | `POST /decisions` | `{ project?: string, title: string, decision: string, rationale?: string }` | `{ decision: Decision }` |

## Schema Notes

- Reuse the Zod-backed HTTP schemas from `src/shared/schemas.ts`; MCP schemas should be narrower only when the tool intentionally hides API fields.
- `AgentEventWithoutData` means `id`, `runId`, `type`, `message`, `importance`, and `createdAt`.
- Compact handoff output means `id`, `sourceRunId`, `fromSource`, `toSource`, `project`, `summary`, `nextAction`, `category`, `tags`, and `createdAt`; omit `context` unless a future explicit detail tool is added.
- Date filters use ISO datetimes and are normalized by the service before SQLite comparisons.

## Guardrails

- MCP list tools must reject or clamp large limits instead of forwarding unbounded requests.
- Read tools should prefer project/status/date filters over free-form broad search.
- Write tools must preserve the service's bearer auth boundary and HTTP validation; MCP should not duplicate database access.
- Any future tool that can create or resolve state should be named as a write-capable tool and documented here before implementation.
