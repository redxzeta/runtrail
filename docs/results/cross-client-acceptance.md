# Cross-client acceptance and practical examples

Runtrail demonstrated explicit, opt-in portability of an attributed summary and
next action to a fresh generic MCP client. **The first capture costs more work
than reading T3 and GitHub directly. No context-byte, token, cost or whole-path
time saving was demonstrated.** A one-off same-client review or local experiment
is simpler without this ledger.

Source reviewed: `cd04a8544c96d52eddb96de15fafd1f997601d6e` (#211), followed by
`61aabe60382c2295ea2743f10dfc83ca4a07bcbe` (#213). Original fresh base was
`010c5d8`; final dependencies came from #206 at `b3853f6`. #198 and #209 were
integrated through `a1b40f1`; #211 merged at `b9cb5e6`, followed by v1.43.0
release commit `443bb26`. Production source and dependency-lock bytes in the acceptance
checkout match the final reviewed source candidate; version-only release commits are separate. Companion changes are confined
to the example, acceptance test and this report. No production patch belongs to
the companion PR. Node 24.18.1; pnpm 11.17.0; SDK 1.30.0; Vitest 5.0.1.

## Reproduce without a model or existing service

```sh
pnpm install --frozen-lockfile
pnpm test test/acceptance-cross-client.test.ts
```

The [runnable recipe](../../examples/acceptance/README.md) explains each command
and the small export helper. The harness provisions authenticated Hono/SQLite on
an ephemeral loopback port with a generated token and private temporary storage.
It spawns actual `pnpm cli` children. It disables Discord, never uses configured
live storage, and closes/removes its temporary server/database/logs/outbox.
An optional explicitly selected `RUNTRAIL_ACCEPTANCE_REPORT` file receives only
sanitized JSONL observations. No credentials, machine paths or actual transcripts
are included in the committed fixtures/report.

The live source was obtained through supported `t3_thread_read` calls on authorized
Runtrail thread `mcp:177db0af-e762-41bc-8d06-48fa322362e5`, selected run
`run:thread:mcp%3A177db0af-e762-41bc-8d06-48fa322362e5:ordinal:2`. Its terminal
completion timestamp is `2026-10-28T04:14:22.162Z`. The attributed final summary
item at position 170 was updated `2026-10-28T04:14:22.064Z`. A real GitHub read
confirmed #208's head, merge SHA and `2026-10-28T04:59:48Z` merge time.

Only a bounded selected metadata projection was persisted as `t3-source.json`.
`t3-work.json` is an **authored paraphrase and selection**, with an explicit new
continuation instruction; it omits private prompts, paths, unrelated messages
and raw logs. It preserves actual source IDs and historical evidence observations.
This is a real source selection, followed by replayable sanitized fixture tests;
repeating the harness does not perform another live T3 read. The helper derives
the source fields and records export observation time once. The saved envelope
must remain unchanged for retries. It does not prove source authenticity.

## Observed behavior

- Real local/CI command: an assertion fails with exit 1, a disposable expectation
  is corrected, and the same check passes with exit 0. Both verification outcomes
  survive in the review packet with unknown revision applicability.
- Homelab reporting: an actual fixture command reports one successful disposable
  job, then records its observed result through `event create`. No maintenance
  operation, network probe, backup or machine modification runs.
- Deterministic experiment: seven integer samples evaluate three thresholds.
  Correct predictions are 5/7, 7/7 and 5/7 (accuracies 0.7142857142857143, 1 and
  0.7142857142857143). These actual computed metrics are recorded through the
  existing event API. They demonstrate reporting, not an evaluation engine,
  production efficacy, benchmarking or ROI.
- Recorder outage: a real child appends one marker and exits 7. It executes once;
  the wrapper returns 7, `capture=degraded`, `runId=null`. No automatic replay.
- Export helper rejects extra timeline fields, ambiguous/missing selection,
  missing completion metadata, nonterminal status, mismatched thread/run,
  malformed UUID grouping and extra ordinal suffix. It uses authoritative
  importer dry-run for envelope validation, with zero requests.
- Actual CLI import confirms run/event/handoff IDs. Identical and reordered-key
  repeats retain the same IDs and row counts. Changed payload under the same
  identity conflicts before follow-on writes. Project and source namespaces stay
  distinct. Unsafe/oversized input and dry-run make zero requests/writes.
- A summary write commits but its acknowledgement is replaced by a failure.
  The result confirms only the run ID, marks delivery uncertain, and requests
  identical retry. That retry recovers the stored event and creates the handoff
  without duplicate rows. Importer's focused tests additionally exercise lost
  acknowledgements at all three stages and malformed/missing service IDs.
- A fresh registered MCP SDK client reads prepare-work, pending handoff and run
  manifest, starts a receiving run and accepts the observed handoff version.
  Both source and receiving IDs are confirmed. Imported completion creates **zero
  verification records**. Only disposable receiving-run liveness is moved to an
  old timestamp; fresh brief reports `stale_candidate` and applicability remains
  `unknown`. This is a controlled fixture, not elapsed time or a dead-process claim.
- Instruction-like text and HTTPS references remain data. No imported command
  executes or remote reference is fetched. Source inspection and focused tests
  cover the fixed-endpoint request path and redirect rejection. Input screening
  is conservative and does not guarantee arbitrary text is public-safe.

Representative successful measurements were recorded at `2026-10-28T05:17:45.726Z`
(commands) and `2026-10-28T05:17:57.462Z` (cross-client). That envelope's export
observation was `2026-10-28T05:17:50.634Z`. Every rerun generates its own explicit
observation timestamps; source completion and observation times are distinct.

## Utility and full-path accounting

The baseline used a fresh supported gateway read of the known final item
(`afterPosition=169`, `limit=1`, `maxCharsPerItem=6000`) and:

```sh
gh pr view 208 --json number,url,state,headRefOid,mergedAt,mergeCommit
```

Known source coordinates avoid searching in this controlled comparison. Earlier
discovery took an additional T3 read; it is not hidden as a Runtrail saving.
The MCP continuation is performed by a fresh SDK client after capture; it never
reads the T3 conversation itself.

| Measured serialized payload | UTF-8 bytes |
| --- | ---: |
| Baseline T3 structured response (one selected final item plus metadata) | 3,310 |
| Baseline GitHub CLI JSON, including newline | 241 |
| Baseline source-read results total | 3,551 |
| Safe selected T3 metadata projection, compact JSON | 219 |
| Authored work/selection, compact JSON | 1,207 |
| Saved exported envelope, indented JSON plus newline | 1,729 |
| Confirmed CLI import result | 789 |
| Fresh CLI brief, default indented JSON plus newline | 6,326 |
| Five MCP serialized tool-result objects | 15,143 |
| Import + brief + five MCP result payloads | 22,258 |
| Source results + helper output + import/brief/MCP results | 27,538 |
| Identical authored task/summary/next-action projection, before/after brief | 370 / 370 |

The 370-byte projections are asserted equal. That subset is an authored
continuation selection from the sources, **not their entire original contents**.
The other rows contain different metadata/provenance and use the stated
serializations; they cannot establish a compression ratio. These are exact
observed serialized payload counts, not full network framing, transport tokens,
compressed bytes, input-plus-output model usage, latency or production savings.
IDs, timestamps, history and coverage can change sizes on another run.

Counted forward operations, excluding negative/retry test repetitions:

| Flow | Source reads | Runtrail HTTP requests | Explicit operations/preparations |
| --- | ---: | ---: | ---: |
| T3 + GitHub direct read | 2 | 0 | 2 read actions |
| Source selection/export/import, then CLI brief | 2 | 5 | 2 reads + 2 local preparations + helper + import + brief = 7 |
| Same flow, then fresh MCP receiving-run acceptance | 2 | 10 | Previous 7 + 5 MCP tool calls = 12 |

The two preparations are selecting/saving safe source metadata and authoring
the bounded work summary/next action. The helper runs one additional CLI
validation child, with **zero HTTP requests**. Import makes three HTTP requests;
brief makes two; the five MCP tools make five. Protocol initialize/connect
messages are additional in-memory transport work, not ledger HTTP requests.
The test automates these operations; the table counts their equivalent explicit
actions, not measured human keystrokes or a timed usability study.

Provisioning the disposable ledger is additional setup. The initial `doctor`
and `prepare-work` used two diagnostic commands and three HTTP reads (health,
capabilities, prepare-work). The generic tests also make extra duplicate, fault,
validation and stale-evidence calls; those are robustness checks, not the forward
utility path. No setup, selection or import effort is represented as free.

**Runtrail adds no value here:** a single toy experiment, a worker already holding
the source context, or a one-off T3/GitHub review. The direct two-read path is
cheaper than initial explicit capture. The observed extra capability is access by
a generic client to bounded actionable context and a versioned receiving-run
handoff without consuming the full prior conversation. Repeated-reader
amortization is a possible inference; no break-even point or time saving was
measured. This supports an opt-in portability workflow, not universal adoption.

## Independent review and disposition

The independent acceptance lane read the complete initial import range
`b3853f6..52115c9`, complete final range `a1b40f1..cd04a854`, all production/test/docs
changes, and the existing HTTP, SQLite uniqueness and projection seams.

| Finding | Reproduction and disposition |
| --- | --- |
| P2: malformed T3 identity accepted | Integration found extra `:ordinal:garbage` and malformed UUID grouping. Independent actual helper regression failed on `52115c9`; exact fix in `cd04a854` and helper mismatch cases passed. |
| P2: lowercase prefixed secret assignment accepted | Integration found `db_password=...` bypassed the word boundary. Independent real CLI acceptance regression failed on pre-fix release source; reviewed `443bb26..61aabe6` removes that boundary and adds four focused cases. The corrected actual CLI unsafe/retry scenario and focused unsafe-input test passed. |

No other concrete P1/P2 was found in the reviewed import ranges. The original
source verdict and checks are durable in [PR #211's independent review](https://github.com/redxzeta/runtrail/pull/211#pullrequestreview-5678081741)
and [PR #213's independent review](https://github.com/redxzeta/runtrail/pull/213#pullrequestreview-5678127278).
The companion's implementation requires independent integration-owner review;
this report is not self-approval. Hosted CI, review, merge, release and deployment
are separate evidence states.

## Coverage and validation

| Surface | Actual coverage |
| --- | --- |
| Generic CLI import/capture/brief/packet | Actual spawned CLI and harmless commands, authenticated disposable HTTP/SQLite |
| T3 source | Actual supported authorized gateway read, bounded metadata projection, authored sanitized export, actual CLI import |
| Fresh MCP client continuation | Registered SDK client/server in-memory protocol transport, authenticated real HTTP/SQLite forwarding |
| Lost response, malformed service IDs, unsafe input, scoping | Disposable real service plus explicit injected failures; focused tests and source review |
| Native configured T3 MCP startup, automatic hooks | **NOT_RUN** |
| Real homelab maintenance, production evaluation, AI/model execution | **NOT_RUN**; harmless fixtures/toy experiment only |
| Deployment, runtime activation, user MCP configuration changes | **NOT_RUN** |

Repository validation passed on reviewed import source plus the isolated harness:
`pnpm lint`, `pnpm typecheck`, `pnpm test` (23 files, 223 tests), `pnpm build`,
`pnpm conformance` (19 passed, cleanup passed), and `git diff --check`. Lint retains
the existing informational Biome schema-version notice. The complete combined run
also passed with final source-fix `61aabe6` and the added actual-CLI negative case.
Later report-only changes do not alter the tested source, dependency lock or harness.
Hosted exact-head PR checks remain separate evidence; earlier green results do not
cover later changed bytes automatically.

Rollback: revert the companion example/test/report commits. There is no migration,
dependency addition, deployed service or client configuration to undo. Import
rollback is a separate source revert; existing imported ledger records remain
ordinary records. Do not delete unrelated storage or replay lifecycle/shell actions.
The sole integration owner reviews and merges; this lane does not merge or deploy.
