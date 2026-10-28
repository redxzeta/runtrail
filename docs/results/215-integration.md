# Issue 215 implementation and results handoff

Baseline: `6fe085c4f951f7bacb890a53d1c998e02cf05142`, v1.43.1.
The sole integration owner merged the following changes serially, using
expected-head guards after independent review and six successful hosted checks.

| Delivery | Reviewed final head | Main merge |
| --- | --- | --- |
| [#216](https://github.com/redxzeta/runtrail/pull/216), dependency repair | `6257537c78b21493659d7acd23337134eea56e6b` | `0c9a35224efbbe5ffc56715e97ecf68054b3b9fe` |
| [#219](https://github.com/redxzeta/runtrail/pull/219), explicit capture/read | `c3605db8df4053568844c44db064727861f9ef7e` | `d50ab5597ae1c847be57cee3098b50f43ee2adac` |
| [#220](https://github.com/redxzeta/runtrail/pull/220), lifecycle/entrypoints | `2497c14eae5db43509ebb5e62531417ea3b74588` | `70ee90d99f9480f82b9c582f487f685bf68d7d17` |

Security owned package/lock; workflow owned capture, brief and usage guidance;
lifecycle owned bridge disposal/limits and canonical entrypoint guards; evaluation
owned the preregistered pilot and independent acceptance. The integration owner
resolved the shared CLI seam and the independently discovered startup-close
defect. Its author did not approve that production correction: the evaluation
lane independently inspected and reproduced the fix at `8348c2a`; final
`2497c14` has identical production bytes and a test-only deadline-anchor change.

## Shipped behavior

SDK 1.32.0, Hono 4.13.11, Zod 4.6.6 and four compatible transitive fixes address
the baseline production audit's 15 advisories. Fresh candidate/final audits
reported zero; this is time-bound inventory evidence, not exploitability proof.

The [capture recipe](../workflow-capture.md) builds and privately saves a strict
terminal-source envelope before delivery, then reuses identical bytes for retry.
One capture CLI makes three POSTs; one provenance brief CLI makes three GETs.
Source lookup/projection and authored summary/action remain real work; ordinary
brief remains two GETs. Reads do not accept a handoff or start work. Existing
helper/commands remain compatible, and ledger use is opt-in.

Bridge ownership now begins before upstream initialization, aborts owned
requests, closes local/upstream resources, and bounds stalled disposal. Streaming
JSON/per-SSE-event limits apply before SDK parsing; search defaults/caps remain
bounded. Actual disposable subprocess checks cover repeated sessions, EOF,
signals, partial startup, post-header stalls, reconnect and injected close stalls.
Canonical Node file-URL guards execute the existing entrypoints under escaped
paths. Linux Node 22/24 and simulated Windows paths were exercised; native
Windows execution is **NOT_RUN**.

## Validation and release boundary

Final production candidate `2497c14` passed lint, typecheck, all 267 tests in
27 files, build, 19 conformance checks with cleanup, production audit and diff
check. The final report tree is refreshed onto release main
`7f4447343c3f4a116834d7dd7cef8a0197a12400`; its exact-head
combined validation receipt is recorded in
[#217](https://github.com/redxzeta/runtrail/pull/217). Frozen install uses the
reviewed dependency lock. The existing Biome schema notice is informational.

Failures remain evidence: the original failed-startup/injected-close regression
failed before correction. One integration full run at `8348c2a` had 266 passes
and a new-test timeout including child startup; a separate independent run
passed 267. The test now observes the upstream initialize request before the
same 2.5-second diagnostic deadline; no timeout was raised or coverage removed.
The subsequent exact candidate full run passed. See the
[independent report](215-usefulness-results.md) for the full distinctions.

Release automation published v1.43.2, v1.44.0 and
[v1.44.1](https://github.com/redxzeta/runtrail/releases/tag/v1.44.1).
These are release evidence, not deployment or runtime activation. No production
service, firewall, persistent job, user MCP configuration or other project was
changed. Disposable validation resources were cleaned. Configured-service
capture failures retained their actual exit/degraded status; no remote run or
handoff identity was invented, and unrelated outbox records were not drained.

## Usefulness and remaining work

**LIMIT** use to explicit cross-tool portability where its overhead is justified.
The [preregistered pilot](215-usefulness-protocol.md) produced three fresh-reader
observations on one real continuation, but unequal authored inputs and arm order
prevent a valid comparable result: **0/10 complete scored comparisons**. An
actual same-thread skip is documented. Neither initial-capture savings nor
general adoption, tokens, cost or whole-path time savings were demonstrated.
Prior #207 portability evidence is unchanged and is not ten new cases.

#210 and #201 are closed with scoped evidence. #167 remains open for native
Windows validation; [#218](https://github.com/redxzeta/runtrail/issues/218) holds
the bounded incomplete pilot. #215 stays open and is not adoption acceptance.
Next action: review the recorded limitations and use direct T3/GitHub or Markdown
when simpler; any remaining pilot case must be distinct real work with equivalent
information for fresh readers. No later run or schedule is promised.

Rollback: revert the scoped production PR changes in reverse order and reinstall
with `pnpm install --frozen-lockfile`. There are no migrations or deployment
changes to undo. Retain ordinary ledger records/user envelopes; do not replay
commands or delete unrelated storage. Reverting #216 restores its audit findings.
