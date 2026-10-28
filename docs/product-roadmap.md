# Product direction — 2026-10-27 PDT

## Decision

Runtrail is a small local-first ledger of attributed work outcomes, evidence and
continuation, usable from a shell without a model. T3 owns execution, conversation
and orchestration; Git and GitHub own code and PR state. Runtrail should make a
compact, portable brief and handoff useful across clients. Capture must fail open:
a recorder failure must not prevent the requested developer command from running.
The ledger is advisory, not an approval, deployment or execution authority.

## Evidence and challenge

On 2026-10-27 PDT, [T3 Code](https://t3.codes/) described agent orchestration,
per-thread branches, diffs and GitHub PR actions; its [source repository](https://github.com/pingdotgg/t3code)
is public. The available T3 gateway here exposes durable thread reads, PR actions
and budgeted context transfer; those are environment-specific capabilities, not a
claim about every installation or an export guarantee. Recreating them is not a
useful Runtrail goal. The [M1/M2 dogfood](results/207-daily-workflow.md) measured
one manual brief read instead of two, but still two HTTP requests; its synthetic
protocol client is not a native T3 integration. It does not establish universal
savings. A cross-client continuation must demonstrate value against T3 plus GitHub
alone. If it does not, narrow the product rather than add infrastructure.

[OpenTelemetry's GenAI conventions page](https://opentelemetry.io/docs/specs/semconv/gen-ai/)
points to a separate maintained repository. Traces answer observability questions;
Runtrail's handoff is an attributed work summary. Optional links or export may be
considered only for a demonstrated need. No telemetry standard compatibility is claimed.

## Priorities and support

- **Now:** cross-tool coding handoffs, concise review evidence, ordinary command
  capture, and a useful shell flow. Existing surfaces are maintained in scope.
- **Next:** M3 explicit, versioned, allowlisted T3/generic work-summary import;
  preserve unknown, stale and claimed evidence as such. Contract and real-source
  acceptance are pending in the import and acceptance lanes. Do not run or fetch
  imported content. Only proven bounded examples for CI/local builds, harmless
  homelab job outcomes and evaluations should reuse runs, events and artifacts.
- **Later:** optional trace links/export if a real need appears.
- **Not now:** agent chat or orchestration UI, scheduler, vector memory/RAG,
  automated trading, model judge/training platform, mandatory GPU/LLM, or
  production deployment gates.

| Surface | Current evidence | Limit |
| --- | --- | --- |
| Shell CLI and HTTP | Existing capture, doctor, brief, handoff and packet; see [daily loop](../README.md#daily-work-loop) | Capture may be degraded; no remote ID should be invented. |
| MCP | Existing generic direct and bridge surfaces; [client support](protocol-compatibility.md) | Synthetic protocol continuation is not native T3 acceptance. |
| T3 summary import | M3 in progress | Pending implemented contract and real-source cross-client acceptance; no import command advertised. |
| Tracing | No compatibility claim | Links/export are future possibilities only. |

For the minimum workflow, start with `doctor` and `prepare-work`, capture an actual
command with `run`, read `brief`, create a handoff using a confirmed source run ID,
and review `workflow packet`. See the executable [walkthrough](../README.md#daily-work-loop).
An unavailable recorder can leave capture incomplete; preserve the actual exit code
and do not fabricate a source ID. Check freshness, bounded coverage, failures,
not-run checks and revision applicability before relying on a report.
