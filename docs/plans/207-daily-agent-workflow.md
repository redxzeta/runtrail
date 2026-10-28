# Daily agent workflow — issue 207

Runtrail complements T3 execution, Git code history and GitHub PR state with a
small cross-client work, evidence and handoff ledger. It records observations;
it does not confer approval or deployment authority.

## M0 inventory and baseline

Inspected base `6ceada9abdebfd8d14baa72573d36785c26ad1ff` (v1.41.3),
README, AGENTS, CONTRIBUTING, deployment runbooks, CLI, schemas and CLI tests.
Existing prepare-work/context deltas, typed verifications, readiness, workflow
packets and keyed POST outbox are the seams to extend. PR 198 only changes MCP
parity tests; PR 206 changes dependencies. Neither is incorporated here.

Baseline on Node 24.18.1 / pnpm 11.17.0:

- `pnpm lint`: passed; existing informational Biome schema version mismatch.
- `pnpm typecheck`: initial invocation panicked about missing TypeScript library
  during first dependency setup; retry after installation passed.
- `pnpm test`: 16 files, 130 tests passed.
- Build and conformance are deferred to candidate validation.

Confirmed failure path: wrapper drains the whole outbox, awaits initial run
creation and parses its server ID before spawning the command. Network/auth
failure therefore blocks development. Log stream errors are unhandled and
signal exits collapse to status 1. Reproduce with a failing regression before
changing this path.

## Dependency order and PR sequence

1. M1: fail-open capture, bounded telemetry, explicit capture limitations and
   read-only doctor. Owner integrates CLI; one isolated module writer owns
   doctor and its tests. No preflight outbox drain, no synthetic server IDs,
   no mutable PATCH replay, no automatic command replay or raw log upload.
2. M2: bounded human/JSON brief over existing prepare-work, plus Markdown
   rendering of the existing workflow packet. Keep source IDs, observations,
   truncation and advisory status visible. Revision applicability stays unknown
   wherever the current model cannot establish it.
3. M3: explicit versioned allowlisted summary import only after M1/M2 validation.
   Inspect exported T3 contracts; never scrape private databases, schedule work,
   execute imported text or advertise untested native client support.
4. M4: disposable authenticated dogfood, real failure/correction/pass, protocol
   continuation, duplicate delivery, offline capture and stale/missing evidence.
   Measure requests/manual steps and serialized bytes; report limitations.

Publish a coherent M1/M2 PR first, referencing rather than closing issue 207 if
later milestones remain. Implement phases sequentially and commit each usable
phase. Independent review must inspect the actual range and rerun capture
contracts. Resolve material findings before final handoff.

## Acceptance and containment

Run pnpm lint, typecheck, full tests, build, conformance and diff whitespace
checks; report failures exactly. Keep SQLite and transports compatible. No
dependency campaign, UI project, model/GPU requirement, scheduler, live client
configuration, host service mutation, merge or deployment. Disposable dogfood
is not runtime activation. Roll back by reverting the scoped commits; no schema
migration is planned.

## Delivery checkpoint

M1 is committed in `5bd6a99`; M2 in `8700635`. The candidate passes 208 tests,
lint, typecheck, build and 19 conformance checks. Disposable dogfood demonstrates
the original failure, corrected capture, second protocol-client continuation,
duplicates, offline capture and unknown/stale evidence. See the
[measured results and limits](../results/207-daily-workflow.md). Independent
review found no P1/P2 issues and independently passed 123 critical tests and
typecheck. M3 native T3 import remains a separate
phase; issue 207 stays open.
