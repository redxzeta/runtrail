# Open issue relevance audit — 2026-10-27 PDT

Snapshot: 2026-10-28 05:02:43 UTC, paginated GitHub REST `issues?state=open&per_page=100`, excluding pull requests: **29 issues**. Code baseline [`010c5d8`](https://github.com/redxzeta/runtrail/tree/010c5d8) includes [#208](https://github.com/redxzeta/runtrail/pull/208) at `bdd11e1c445a8f5f8c3a01fe9f39017359eb8ba4`. Issue bodies and available comments were read; linked PRs #197, #198, #206 and #208 were inspected. Evidence below identifies remaining seams, not a claim each proposal is the right next task. The direction prioritizes the daily workflow over speculative infrastructure and sweeping refactors.

Classification: **STILL_RELEVANT 9**, **NEEDS_REPRODUCTION 1**, **FIXED 0**, **DUPLICATE/SUPERSEDED 0**, **OUT_OF_SCOPE 19**. The 19 prescriptive extraction issues are not planned under the [product direction](../product-roadmap.md); this is a prioritization decision, not a technical fix. No labels or descriptions were changed. One bounded [security follow-up #210](https://github.com/redxzeta/runtrail/issues/210) was filed after maintenance supplied candidate audit evidence. A [comment on #169](https://github.com/redxzeta/runtrail/issues/169#issuecomment-6461134732) recommends focused structural help coverage. Age and product direction alone do not resolve a defect. Snapshot and reconciliation are time-bound; concurrent work can change states afterward.

| Issue | Disposition | Current evidence and prerequisite |
| --- | --- | --- |
| [#207](https://github.com/redxzeta/runtrail/issues/207) | STILL_RELEVANT | #208 delivered M1/M2; M3 real-source import and cross-client acceptance, measured usefulness and integration remain. Do not close on product direction or a partial PR. |
| [#201](https://github.com/redxzeta/runtrail/issues/201) | NEEDS_REPRODUCTION | [`bridge.ts`](https://github.com/redxzeta/runtrail/blob/010c5d8/src/mcp/bridge.ts) connects a remote client and local transport with no explicit EOF/signal shutdown in `start`; SDK behavior and resource release need a real lifecycle reproduction. Retain reported resource-impact bug. |
| [#195](https://github.com/redxzeta/runtrail/issues/195) | OUT_OF_SCOPE | Workflow/readiness remains in [`ledger.ts`](https://github.com/redxzeta/runtrail/blob/010c5d8/src/db/ledger.ts); depends on #194. Defer until justified, preserve semantics. |
| [#194](https://github.com/redxzeta/runtrail/issues/194) | OUT_OF_SCOPE | Manifest/packet assembly remains in ledger; depends on #193 and unchanged provenance/coverage contracts. |
| [#193](https://github.com/redxzeta/runtrail/issues/193) | OUT_OF_SCOPE | Context/prepare-work projection remains in ledger; depends on #192 and contract-preserving tests. |
| [#192](https://github.com/redxzeta/runtrail/issues/192) | OUT_OF_SCOPE | Decision persistence and effective-state logic remain in ledger; depends on earlier domain extractions. |
| [#191](https://github.com/redxzeta/runtrail/issues/191) | OUT_OF_SCOPE | Collaboration persistence remains in ledger; preserve idempotency and versioning if extracted. |
| [#190](https://github.com/redxzeta/runtrail/issues/190) | OUT_OF_SCOPE | Run lifecycle and relationships remain in ledger; preserve transactions and facade. |
| [#189](https://github.com/redxzeta/runtrail/issues/189) | OUT_OF_SCOPE | Ledger facade remains large (2,997 lines); parent of #190–#195. No accepted M3, brief or reliability work requires this epic; revisit only for a concrete defect or change requiring a bounded extraction. |
| [#188](https://github.com/redxzeta/runtrail/issues/188) | OUT_OF_SCOPE | Browser routes remain in [`routes/ledger.ts`](https://github.com/redxzeta/runtrail/blob/010c5d8/src/routes/ledger.ts); depends on prior route extraction. No UI expansion implied. |
| [#187](https://github.com/redxzeta/runtrail/issues/187) | OUT_OF_SCOPE | Context/search/workflow route registration remains in ledger routes; preserve API contracts. |
| [#186](https://github.com/redxzeta/runtrail/issues/186) | OUT_OF_SCOPE | Collaboration route registration remains in ledger routes; preserve auth and write contracts. |
| [#185](https://github.com/redxzeta/runtrail/issues/185) | OUT_OF_SCOPE | Run and lifecycle route registration remains in ledger routes; preserve behavior. |
| [#184](https://github.com/redxzeta/runtrail/issues/184) | OUT_OF_SCOPE | Shared ledger route support remains in the route module; prerequisite to route split. |
| [#183](https://github.com/redxzeta/runtrail/issues/183) | OUT_OF_SCOPE | Ledger routes remain concentrated (886 lines); parent of #184–#188. No accepted task requires the multi-route epic; revisit a specific seam when a concrete change warrants it. |
| [#182](https://github.com/redxzeta/runtrail/issues/182) | OUT_OF_SCOPE | Direct and bridge MCP registration remain separate ([direct](https://github.com/redxzeta/runtrail/blob/010c5d8/src/mcp/index.ts), [bridge](https://github.com/redxzeta/runtrail/blob/010c5d8/src/mcp/bridge.ts)); name parity is tracked by #171; a registry is not required for that contract. Revisit only for a demonstrated metadata or dispatch defect. |
| [#181](https://github.com/redxzeta/runtrail/issues/181) | STILL_RELEVANT | Bounded context/prepare-work paths exist; no benchmark script in [package.json](https://github.com/redxzeta/runtrail/blob/010c5d8/package.json). Deferred: run only when a specific performance question or regression needs a repeatable baseline; do not add a harness merely for its own sake. |
| [#180](https://github.com/redxzeta/runtrail/issues/180) | OUT_OF_SCOPE | Utility/export command registration remains in [`cli/index.ts`](https://github.com/redxzeta/runtrail/blob/010c5d8/src/cli/index.ts); depends on earlier CLI split. |
| [#179](https://github.com/redxzeta/runtrail/issues/179) | OUT_OF_SCOPE | Collaboration commands remain in CLI index; preserve handoff and verification behavior. |
| [#178](https://github.com/redxzeta/runtrail/issues/178) | OUT_OF_SCOPE | Run/workflow registration remains in CLI index, including new #208 commands; scope must account for current behavior. |
| [#177](https://github.com/redxzeta/runtrail/issues/177) | OUT_OF_SCOPE | CLI index remains large (1,696 lines); parent of #178–#180. #208 extracted helpers, not registration. No accepted task requires a CLI-wide split; revisit a seam when a concrete change warrants it. |
| [#176](https://github.com/redxzeta/runtrail/issues/176) | STILL_RELEVANT | [`outbox.ts`](https://github.com/redxzeta/runtrail/blob/010c5d8/src/cli/outbox.ts) quarantines; CLI has list/retry, not bounded quarantine management. Protect payloads and explicit deletion. |
| [#175](https://github.com/redxzeta/runtrail/issues/175) | STILL_RELEVANT | `enqueueOutbox` generates a new UUID; equivalent pending writes are not coalesced. Preserve conflict and data-safety semantics. |
| [#174](https://github.com/redxzeta/runtrail/issues/174) | STILL_RELEVANT | CLI outbox retry has no per-ID option; safe selection and no implicit replay remain necessary. |
| [#173](https://github.com/redxzeta/runtrail/issues/173) | OUT_OF_SCOPE | Pure parsing helpers including `parseInteger` and `parseDuration` remain in CLI index. No accepted task requires extraction; revisit if a concrete parser change needs an isolated seam. |
| [#172](https://github.com/redxzeta/runtrail/issues/172) | STILL_RELEVANT | Outbox retry rewrites counters and permissions; existing [tests](https://github.com/redxzeta/runtrail/blob/010c5d8/test/outbox.test.ts) cover safety and initial modes, not the requested multi-record repeated-retry lifecycle. [#197](https://github.com/redxzeta/runtrail/pull/197) covers secret/size boundaries, not this issue. |
| [#171](https://github.com/redxzeta/runtrail/issues/171) | STILL_RELEVANT | [#198](https://github.com/redxzeta/runtrail/pull/198) is open, not merged; its parity change is under maintenance review. Preserve the explicit public name contract as well as actual registration parity. |
| [#169](https://github.com/redxzeta/runtrail/issues/169) | STILL_RELEVANT | Broad CLI registration remains; current tests primarily exercise behavior. Narrow future coverage to critical names/options and no-network help, not full snapshots or every command. |
| [#167](https://github.com/redxzeta/runtrail/issues/167) | STILL_RELEVANT | Five entrypoints still compare `import.meta.url` to an interpolated `file://` URL; bridge uses `pathToFileURL`. Original issue reports Windows reproduction. No Windows execution was performed in this audit; retain until a cross-platform fix and real evidence. |

## Reconciliation and limitations

The before snapshot is 29; the final reconciliation below records the actual after count. #198 and #206 belong to the maintenance lane, and #207 stays open until real integration acceptance. No claim of a Windows test, bridge lifecycle reproduction, merged #198, or a complete T3 integration is made here. The extraction plans are closed as not planned because no accepted task or demonstrated defect requires the prescribed work. A new bounded issue or reopening is appropriate if a concrete need emerges. Issue #210 tracks the candidate production dependency audit, conditional on #206 disposition and a fresh exact-main audit.

Pre-disposition re-enumeration at **2026-10-28 05:04:30 UTC** returned the same 29 IDs:
167, 169, 171–182, 183–195, 201 and 207. #198 was still open at
`353e8fb543a7d6161ca5b50a73502f0f294395b0`. Maintenance subsequently repaired it at `c655d10339c3a49d369163dde2d27863af2800c9`, retaining the public tool-name assertion and contributor commit; it was still open at final reconciliation; #201 was not reproduced in
that lane. The integration owner was notified of the provisional dispositions;
recheck after concurrent merges before treating the count as current.

After the 19 individually commented NOT_PLANNED closures, a fresh paginated
enumeration at **2026-10-28 05:07:32 UTC** returned **11 open issues**: the ten
retained snapshot issues #167, #169, #171, #172, #174–#176, #181, #201 and
#207, plus new #210. GitHub's cached list briefly included two already-closed
issues; individual state and the refreshed list confirmed their closure. #198
was still open at `c655d10339c3a49d369163dde2d27863af2800c9`. Recheck after
concurrent merges.

Maintenance reported `pnpm audit --prod --json` exit 1 on #206's candidate
lockfile: 15 advisories (6 high, 7 moderate, 2 low). The refreshed candidate
head `fc9fd06c6552dde3e2231a873ae143b544ede997` retains the audited lock blob
`f2e04bbe0a6f2c0093b644da6e6f68e1222a328e`; #206 remained open when #210
was filed. This is neither a current-main clearance nor proof of exploitability.
#210 requires an exact-main re-audit after #206 is merged or otherwise disposed,
compatible minimal repairs and evidence for residual findings.

Subsequently #206 merged at [`b3853f6517ea5bb894d714e330a786af117485f3`](https://github.com/redxzeta/runtrail/commit/b3853f6517ea5bb894d714e330a786af117485f3).
The candidate audit remains a reported observation, not a fresh audit or security
clearance of current main. #210 tracks the remaining work.

## Subsequent state — 2026-10-28 05:16:35 UTC

The historical classifications above describe the original snapshot. [#198](https://github.com/redxzeta/runtrail/pull/198)
merged at [`a1b40f1`](https://github.com/redxzeta/runtrail/commit/a1b40f1) and
[#171](https://github.com/redxzeta/runtrail/issues/171) closed as completed;
the public name assertion and actual direct/bridge parity tests are retained.
A fresh paginated open-issue enumeration found **10**: #167, #169, #172, #174,
#175, #176, #181, #201, #207 and #210. This is a time-bound count, not a final
acceptance decision. [#211](https://github.com/redxzeta/runtrail/pull/211)
merged at `b9cb5e60c504a1a7e5212313c17a1a37d71a6098`; its explicit summary
import was exercised through a real gateway-derived export and fresh MCP protocol
client. The companion helper and acceptance report remain pending separate review.
#207 remains open pending integration consolidation. Native automatic hooks and
configured T3 client integration were not tested.
