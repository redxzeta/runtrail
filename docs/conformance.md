# Protocol Conformance

Run the offline reference suite after installing dependencies:

```sh
pnpm conformance
```

The command creates a generated test token, temporary file-backed SQLite database, local outbox,
and authenticated in-process Runtrail service. It never reads `RUNTRAIL_URL`, user configuration,
or existing storage, and it removes all temporary state on success or failure. Time advances
through the shared clock seam; the outbox failure is injected directly, with no sleeps or network
instability.

Use `--output <path>` for the versioned JSON result. The command creates the file and will not
overwrite it. Validate cleanup and hard-failure diagnostics with:

```sh
pnpm conformance --induce-failure
```

That command intentionally fails the advertised `workflow_review_packet` step and exits nonzero
after cleanup.

## Profiles and gating

Result schema version `1` contains `baseline` and `agent-continuation-v1`, both profile version `1`.
Each bounded step records its capability, transport, expected/actual behavior, result, and safe
diagnostic. An unadvertised optional capability is `not_supported`. An advertised mismatch is
`failed`; it is never silently skipped.

The synthetic north-star path uses `agent-a` over authenticated HTTP and `agent-b` through the
direct MCP mapping against the same service. It covers capability equivalence, idempotent run and
append retries, fresh/stale work, controlled outbox replay, liveness preservation, current
decisions, blockers, typed evidence, versioned handoff acceptance, stale-write conflicts,
continuation linkage, readiness, the workflow packet, restart persistence, bounds, and redaction.
The stdio bridge step verifies the advertised forwarding contract; focused MCP tests retain
transport-level forwarding/error coverage.

Capability-owning changes must add or activate their smallest applicable profile step using the
stable feature ID from `/meta/capabilities`. Do not mark an unadvertised feature passed. Full
support claims require every advertised `agent-continuation-v1` step to pass.

The result never contains the generated token, authorization headers, raw HTTP bodies, prompts,
transcripts, command output, environment dumps, user paths, database paths, or verbose logs.
