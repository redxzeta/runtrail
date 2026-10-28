# Issue 207 — M1/M2 delivery evidence

Candidate code: `87006359f036131c908fdc516ddc6afcd4450e74`.
Base: `6ceada9abdebfd8d14baa72573d36785c26ad1ff` (v1.41.3).
Environment: Node 24.18.1, pnpm 11.17.0. No deployment or live client changes.

## Delivered slice

- M0 plan committed before implementation (`10b0acd`).
- M1 capture and read-only doctor (`5bd6a99`). Initial recorder failures no
  longer prevent commands from running. Telemetry budgets cover response bodies;
  no preflight/postflight outbox drain. Child exits, direct-child signal forwarding,
  log errors and incomplete remote capture have explicit outcomes.
- M2 brief and Markdown packet (`8700635`). Existing prepare-work/context and
  workflow packet remain the underlying contracts. Brief joins readable detail
  by source ID and version; newer/missing detail stays unknown. Packet additions
  are optional Git references and unknown verification applicability. No migration
  or new MCP tool is required.

## Disposable dogfood

Used a newly created authenticated Hono/SQLite instance on an ephemeral loopback
port, private temporary logs/outbox and an ephemeral token. No configured live
ledger was used. All temporary storage and generated source files were removed.
The sanitized observations are in [207-dogfood.json](207-dogfood.json).

The original CLI source was loaded from the base commit into a temporary module
and exercised with the new startup regression tests. It used candidate shared
utilities, so this is a focused original-CLI regression reproduction, not a
benchmark or complete execution of the old repository.

1. Wrapped `pnpm test test/dogfood-207-baseline.test.ts -t 'executes exactly once when initial run creation fails'`:
   three genuine regression failures, child exit 1; failure recorded remotely.
2. Removed the temporary baseline module/test; wrapped the same three regression
   cases from `test/cli.test.ts` against the corrected CLI: three passed, exit 0.
   The second run explicitly continued the failed run. Both observed process
   outcomes remained in the workflow packet.
3. A second registered MCP protocol client read the manifest and pending handoff,
   then accepted it with its observed version into a linked receiving run.
   Repeating the keyed handoff create returned the same handoff ID. A mismatched
   selected-run/source read was rejected rather than guessed.
4. Added an explicitly not-run native-client check. Packet retained failed,
   passed and not-run evidence together; every verification applicability was
   unknown. Exported the same packet as Markdown successfully.
5. Advanced only the disposable server clock by two hours: brief identified a
   running receiving run as `stale_candidate`. This is a controlled-clock fixture,
   not two hours of elapsed wall time or proof of a dead process.
6. Shut down the disposable recorder and wrapped a real command exiting 7:
   command ran once, exit 7 survived, remote ID was null, capture was degraded.
   No automatic shell replay occurred.

The failed baseline capture included temporary untracked source files. The
candidate regression ran after those files were removed. Neither scenario proves
verification applicability to a clean revision; the verification schema has no
revision/dirty-state binding. Receipt hashes and completed runs remain observations.
The generated run IDs identify this disposable experiment and are not retained
server records after cleanup.

The first dogfood harness attempt stopped after recording the regression pair
because it read the manifest envelope incorrectly. The harness was corrected and
the complete scenario rerun successfully. The earlier stalled-body test also
failed during development and led to retaining the caller's abort signal through
body consumption. These failures were not treated as successful evidence.

## Measured read cost

Limit 5; same project and selected receiving run. Compared the two original
observations with a local brief projection of those exact responses. Separately
counted the actual CLI HTTP requests. Bytes are UTF-8 serialized output, not
tokens, compression ratios, latency or a general workload benchmark.

| Flow | Manual commands | HTTP requests | Serialized bytes |
| --- | ---: | ---: | ---: |
| Existing prepare-work + context, compact JSON | 2 | 2 | 8,808 |
| Brief, compact JSON projection | 1 | 2 | 5,595 |
| Brief, default indented `--json` output | 1 | 2 | 8,081 |
| Brief, readable Markdown | 1 | 2 | 4,598 |

One fewer manual read is demonstrated. The brief does not reduce HTTP request
count, and JSON indentation materially affects byte savings. Counts and byte
sizes vary with history, identifiers, clipping and coverage metadata. The packet
report improves review readability; no packet byte-saving claim was measured.

## Coverage and validation

| Surface | Evidence |
| --- | --- |
| CLI capture and reads | Real spawned CLI/commands against authenticated disposable loopback HTTP |
| HTTP ledger | Actual Hono routes and SQLite, including keyed duplicates and versioned handoff acceptance |
| Registered MCP client | SDK client/server in-memory transport pair, forwarding to authenticated HTTP; protocol-client evidence |
| Stdio bridge | Synthetic in-memory bridge conformance; not an actual agent application's stdio session |
| T3 native completion/import | **NOT_RUN / NOT_IMPLEMENTED** |
| Deployment, runtime activation, production, live client configuration | **NOT_RUN / NOT_AUTHORIZED** |

Candidate checks passed:

```sh
pnpm lint                         # existing informational Biome schema notice
pnpm typecheck
pnpm test                         # 21 files, 208 tests
pnpm build
pnpm conformance                  # 19 passed; cleanup passed
git diff --check
```

Independent read-only review inspected the complete base-to-candidate range and
reported no concrete P1/P2 findings. It independently passed 123 critical tests
across eight files, typecheck and range whitespace checks. Later docs-only commit
`3d7eb25` was confirmed byte-identical under `src` and `test` to the reviewed code.
The independent reviewer did not rerun the full suite, lint, build, conformance,
hosted CI or native T3 integration; the full local results above are the owner's
validation. Documentation updates do not change the tested code. Hosted CI status
is separate from these local results.

## Remaining work and rollback

M3 remains: a versioned allowlisted summary import envelope, stable external
thread/run/source IDs, canonical work/workflow correlation, PR/revision references,
idempotence and user-approved source selection. The available T3 thread-reader
contract exposes attributed timeline records, but no native adapter was built or
validated. Never import full transcripts or execute imported text. No background
poller or scheduling path is planned.

M4 is complete for this local M1/M2 slice's experiments and protocol clients;
native T3 acceptance and any broader rollout decision remain open. Issue 207 must
remain open. Next action: review the candidate PR, address material findings,
then scope M3 as a separate phase. Merge and deployment require separate authority.

Rollback: revert the scoped PR/commits in reverse order. No database migration,
host mutation or user MCP configuration change needs undoing. Existing JSON
packet output stays the default and older packets remain renderable without the
new optional fields.
