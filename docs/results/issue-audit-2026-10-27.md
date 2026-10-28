# Open issue relevance audit — 2026-10-27 PDT

Snapshot: 2026-10-28 05:02:43 UTC, paginated GitHub REST `issues?state=open&per_page=100`, excluding pull requests: **29 issues**. Code baseline [`010c5d8`](https://github.com/redxzeta/runtrail/tree/010c5d8) includes [#208](https://github.com/redxzeta/runtrail/pull/208) at `bdd11e1c445a8f5f8c3a01fe9f39017359eb8ba4`. Issue bodies and available comments were read; linked PRs #197, #198, #206 and #208 were inspected. Evidence below identifies remaining seams, not a claim each proposal is the right next task. The direction prioritizes the daily workflow over speculative infrastructure and sweeping refactors.

Classification: **STILL_RELEVANT 28**, **NEEDS_REPRODUCTION 1**, **FIXED 0**, **DUPLICATE/SUPERSEDED 0**, **OUT_OF_SCOPE 0**. All 29 retained; no closures, labels, metadata changes or follow-up issues were needed. A [comment on #169](https://github.com/redxzeta/runtrail/issues/169#issuecomment-6461134732) recommends focused structural help coverage. Age and product direction alone do not resolve a defect. Snapshot and reconciliation are time-bound; concurrent work can change states afterward.

| Issue | Disposition | Current evidence and prerequisite |
| --- | --- | --- |
| [#207](https://github.com/redxzeta/runtrail/issues/207) | STILL_RELEVANT | #208 delivered M1/M2; M3 real-source import and cross-client acceptance, measured usefulness and integration remain. Do not close on product direction or a partial PR. |
| [#201](https://github.com/redxzeta/runtrail/issues/201) | NEEDS_REPRODUCTION | [`bridge.ts`](https://github.com/redxzeta/runtrail/blob/010c5d8/src/mcp/bridge.ts) connects a remote client and local transport with no explicit EOF/signal shutdown in `start`; SDK behavior and resource release need a real lifecycle reproduction. Retain reported resource-impact bug. |
| [#195](https://github.com/redxzeta/runtrail/issues/195) | STILL_RELEVANT | Workflow/readiness remains in [`ledger.ts`](https://github.com/redxzeta/runtrail/blob/010c5d8/src/db/ledger.ts); depends on #194. Defer until justified, preserve semantics. |
| [#194](https://github.com/redxzeta/runtrail/issues/194) | STILL_RELEVANT | Manifest/packet assembly remains in ledger; depends on #193 and unchanged provenance/coverage contracts. |
| [#193](https://github.com/redxzeta/runtrail/issues/193) | STILL_RELEVANT | Context/prepare-work projection remains in ledger; depends on #192 and contract-preserving tests. |
| [#192](https://github.com/redxzeta/runtrail/issues/192) | STILL_RELEVANT | Decision persistence and effective-state logic remain in ledger; depends on earlier domain extractions. |
| [#191](https://github.com/redxzeta/runtrail/issues/191) | STILL_RELEVANT | Collaboration persistence remains in ledger; preserve idempotency and versioning if extracted. |
| [#190](https://github.com/redxzeta/runtrail/issues/190) | STILL_RELEVANT | Run lifecycle and relationships remain in ledger; preserve transactions and facade. |
| [#189](https://github.com/redxzeta/runtrail/issues/189) | STILL_RELEVANT | Ledger facade remains large (2,997 lines); parent of #190–#195. Refactor is optional maintenance, not a product milestone. |
| [#188](https://github.com/redxzeta/runtrail/issues/188) | STILL_RELEVANT | Browser routes remain in [`routes/ledger.ts`](https://github.com/redxzeta/runtrail/blob/010c5d8/src/routes/ledger.ts); depends on prior route extraction. No UI expansion implied. |
| [#187](https://github.com/redxzeta/runtrail/issues/187) | STILL_RELEVANT | Context/search/workflow route registration remains in ledger routes; preserve API contracts. |
| [#186](https://github.com/redxzeta/runtrail/issues/186) | STILL_RELEVANT | Collaboration route registration remains in ledger routes; preserve auth and write contracts. |
| [#185](https://github.com/redxzeta/runtrail/issues/185) | STILL_RELEVANT | Run and lifecycle route registration remains in ledger routes; preserve behavior. |
| [#184](https://github.com/redxzeta/runtrail/issues/184) | STILL_RELEVANT | Shared ledger route support remains in the route module; prerequisite to route split. |
| [#183](https://github.com/redxzeta/runtrail/issues/183) | STILL_RELEVANT | Ledger routes remain concentrated (886 lines); parent of #184–#188. Defer unless maintenance benefit warrants risk. |
| [#182](https://github.com/redxzeta/runtrail/issues/182) | STILL_RELEVANT | Direct and bridge MCP registration remain separate ([direct](https://github.com/redxzeta/runtrail/blob/010c5d8/src/mcp/index.ts), [bridge](https://github.com/redxzeta/runtrail/blob/010c5d8/src/mcp/bridge.ts)); depends on #171 parity protection. |
| [#181](https://github.com/redxzeta/runtrail/issues/181) | STILL_RELEVANT | Bounded context/prepare-work paths exist; no benchmark script in [package.json](https://github.com/redxzeta/runtrail/blob/010c5d8/package.json). Consider only when measurement is needed. |
| [#180](https://github.com/redxzeta/runtrail/issues/180) | STILL_RELEVANT | Utility/export command registration remains in [`cli/index.ts`](https://github.com/redxzeta/runtrail/blob/010c5d8/src/cli/index.ts); depends on earlier CLI split. |
| [#179](https://github.com/redxzeta/runtrail/issues/179) | STILL_RELEVANT | Collaboration commands remain in CLI index; preserve handoff and verification behavior. |
| [#178](https://github.com/redxzeta/runtrail/issues/178) | STILL_RELEVANT | Run/workflow registration remains in CLI index, including new #208 commands; scope must account for current behavior. |
| [#177](https://github.com/redxzeta/runtrail/issues/177) | STILL_RELEVANT | CLI index remains large (1,696 lines); parent of #178–#180. #208 extracted helpers, not registration. Defer broad refactor. |
| [#176](https://github.com/redxzeta/runtrail/issues/176) | STILL_RELEVANT | [`outbox.ts`](https://github.com/redxzeta/runtrail/blob/010c5d8/src/cli/outbox.ts) quarantines; CLI has list/retry, not bounded quarantine management. Protect payloads and explicit deletion. |
| [#175](https://github.com/redxzeta/runtrail/issues/175) | STILL_RELEVANT | `enqueueOutbox` generates a new UUID; equivalent pending writes are not coalesced. Preserve conflict and data-safety semantics. |
| [#174](https://github.com/redxzeta/runtrail/issues/174) | STILL_RELEVANT | CLI outbox retry has no per-ID option; safe selection and no implicit replay remain necessary. |
| [#173](https://github.com/redxzeta/runtrail/issues/173) | STILL_RELEVANT | Pure parsing helpers including `parseInteger` and `parseDuration` remain in CLI index. Lower priority; depends on useful behavior protection, not snapshots. |
| [#172](https://github.com/redxzeta/runtrail/issues/172) | STILL_RELEVANT | Outbox retry rewrites counters and permissions; existing [tests](https://github.com/redxzeta/runtrail/blob/010c5d8/test/outbox.test.ts) cover safety and initial modes, not the requested multi-record repeated-retry lifecycle. [#197](https://github.com/redxzeta/runtrail/pull/197) covers secret/size boundaries, not this issue. |
| [#171](https://github.com/redxzeta/runtrail/issues/171) | STILL_RELEVANT | [#198](https://github.com/redxzeta/runtrail/pull/198) is open, not merged; its parity change is under maintenance review. Preserve the explicit public name contract as well as actual registration parity. |
| [#169](https://github.com/redxzeta/runtrail/issues/169) | STILL_RELEVANT | Broad CLI registration remains; current tests primarily exercise behavior. Narrow future coverage to critical names/options and no-network help, not full snapshots or every command. |
| [#167](https://github.com/redxzeta/runtrail/issues/167) | STILL_RELEVANT | Five entrypoints still compare `import.meta.url` to an interpolated `file://` URL; bridge uses `pathToFileURL`. Original issue reports Windows reproduction. No Windows execution was performed in this audit; retain until a cross-platform fix and real evidence. |

## Reconciliation and limitations

The before snapshot is 29; see the final reconciliation below for the actual after count. #198 and #206 belong to the maintenance lane, and #207 stays open until real integration acceptance. No claim of a Windows test, bridge lifecycle reproduction, merged #198, or a complete T3 integration is made here. No issue was closed simply because a proposed refactor is low priority. No new issue is needed to restate work already tracked.

Re-enumeration at **2026-10-28 05:04:30 UTC** returned the same 29 IDs:
167, 169, 171–182, 183–195, 201 and 207. #198 was still open at
`353e8fb543a7d6161ca5b50a73502f0f294395b0`. Maintenance reported a repair in
progress to retain the public tool-name assertion; #201 was not reproduced in
that lane. The integration owner was notified of the provisional dispositions;
recheck after concurrent merges before treating the count as current.
