# Disposable command and cross-client examples

Run from the repository root after `pnpm install --frozen-lockfile`:

```sh
pnpm test test/acceptance-cross-client.test.ts
```

This provisions an authenticated SQLite/Hono ledger on an ephemeral loopback
port, chooses an ephemeral token internally, spawns actual `pnpm cli` commands,
then closes the server and removes its storage. It uses no model, preconfigured
service, background job or user MCP configuration. A report can be explicitly
selected with `RUNTRAIL_ACCEPTANCE_REPORT`; it contains only sanitized observations,
never CLI logs, credentials or storage paths. Do not point that variable at an
existing file: observations append.

The first scenario demonstrates three ordinary uses of the existing API:

1. Local/CI verification: a real Node assertion checks a disposable sum fixture.
   Its wrong expectation fails with exit 1. Correcting that expectation passes;
   both captured verification outcomes remain visible with unknown revision
   applicability. An unavailable recorder still executes a child once and
   preserves exit 7 with no invented remote run ID.
2. Homelab reporting: a disposable job-result fixture reports one successful job.
   No maintenance, backup, network probe or machine operation is performed.
3. Experiment summary: seven fixed integer samples evaluate three thresholds
   against the predicate `x*x >= 4`. Correct predictions are 5, 7 and 5; metrics
   come from the executed experiment and are recorded using `event create`.
   This toy demonstrates reporting, not production efficacy or performance.

The tiny fixture command also runs directly without Runtrail:

```sh
node examples/acceptance/fixture-job.mjs experiment
```

For an **explicitly selected disposable ledger**, the underlying capture pattern is:

```sh
pnpm cli run --source developer --project disposable-examples \
  --task "toy threshold experiment" --workflow-id toy-experiment \
  -- node examples/acceptance/fixture-job.mjs experiment
pnpm cli brief --project disposable-examples --json
```

Capture observes the child's process result. The harness separately records the
actual computed metrics using `event create --data-json`; captured completion
alone does not assert those metrics, revision applicability or independent truth.

## Supported explicit T3 export recipe

Use the supported `t3_thread_read` gateway on an authorized Runtrail thread.
Choose a specific terminal run explicitly. Project its response in memory;
persist **only** these fields, never the raw timeline or full tool response:

```js
const selected = result.structuredContent.recentRuns.find((run) => run.runId === selectedRunId);
const metadata = {
  thread: { threadId: result.structuredContent.thread.threadId },
  recentRuns: [{ runId: selected.runId, status: selected.status, completedAt: selected.completedAt }]
};
```

`t3-source.json` is that exact projection from a real supported gateway read of
Runtrail's completed #208 implementation thread. `t3-work.json` contains a
deliberately authored, paraphrased selection and continuation instruction. Source
IDs, source timestamps and GitHub revision facts are retained; private prompts,
paths, logs, unrelated timeline items and implementation details are omitted.
Its old `evidence.observedAt` timestamps describe the historical source selection.
The helper derives all source identity fields and records a **new export observation
time**; terminal completion time is never substituted for that time.

```sh
node examples/acceptance/t3-export.mjs \
  --source examples/acceptance/t3-source.json \
  --summary examples/acceptance/t3-work.json > envelope.json
pnpm cli import-work --file envelope.json
pnpm cli brief --project runtrail-acceptance --work-key github:redxzeta/runtrail#207 --json
```

Use the latter two commands only against your selected disposable ledger; the
test above performs this whole path automatically. The helper validates through
the implemented `import-work --dry-run`, with zero requests. It rejects extra
timeline fields, oversized files, missing completion metadata, nonterminal runs
and ambiguous selection. It does not authenticate source truth or retrieve T3
itself. Save the exported envelope once and retry **that exact file** after an
uncertain delivery; re-exporting changes the observation time and conflicts with
the existing identity. Review helper output before public use; conservative
input screening is not a guarantee that arbitrary text contains no private facts.

The second scenario imports that helper output and uses a fresh registered MCP
SDK protocol client to read work/handoff/manifest, start a receiving run, and
accept the observed handoff version. Transport is in-memory client/server,
forwarding to authenticated real HTTP/SQLite. This is live-source CLI integration
plus protocol-client coverage. Native T3 configured MCP startup and automatic
hooks are **NOT_RUN**. Imported terminal status creates no verification records.
Old liveness is injected only into the disposable receiving run to demonstrate
staleness; it is not elapsed wall time or proof of a dead process.

The third scenario covers unsafe/oversized input, no-request dry-run, a committed
summary whose acknowledgement is lost, identical retry, conflicting identity,
project/source isolation and inert instruction/reference text. No URL in imported
text is fetched, and no command is selected from imported content.

Runtrail is optional here. A single local experiment or a same-client review that
already has T3/GitHub context is simpler without export, import and another ledger.
The useful cross-tool case is a fresh generic client receiving a bounded next
action and confirmed source linkage after someone explicitly captures the work.
See [measured results](../../docs/results/cross-client-acceptance.md) for overhead
and coverage limits. No production ROI, token/cost or elapsed-time saving is claimed.
