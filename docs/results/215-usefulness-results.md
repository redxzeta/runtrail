# Issue 215 pilot observations

Protocol: [preregistration](215-usefulness-protocol.md). Results below are a
point-in-time record, not a claim of adoption, statistical savings or deployment.

| Case | Prospective status | Observation |
| --- | --- | --- |
| #210 repair to independent reviewer | Three-arm comparison blocked | The real review request identifies PR #216 head `6257537c78b21493659d7acd23337134eea56e6b`, asks for diff, advisory evidence, current CI and base review, and notes that bridge validation must use the merged SDK. The selected T3 message belongs to a running source run with no completion time. |
| #201/#167 repair to independent reviewer | No three-arm comparison | PR #220 review request named head `aafcd012dadd1a37283f0bc0a8986c62fc8dce93`; the selected producer run was running at observation. The authored request was 3,937 UTF-8 bytes, not a full-path saving measurement. |

On baseline `6fe085c4f951f7bacb890a53d1c998e02cf05142`, the existing export
helper rejected a bounded projection of that running source (exit 1, zero stdout
bytes). It was not possible to make a truthful terminal-source import at that
observation. This is a safety result, not a completed three-arm reader comparison.
The source was a supported T3 read of the integrator thread, position 19; the
request's service preparation had failed, and no Runtrail source run was created.
One producer message was sent; its bytes and the complete production-path
operation count were not measured. No independent reader outcome or provider
usage is inferred. Prospective scored comparisons: **0/10** at this checkpoint.

The earlier acceptance report measured two known-coordinate direct reads, seven
export/import plus brief operations and twelve for fresh MCP acceptance. Those
historical observations are neither measurements of the new workflow nor new
prospective cases. For a same-thread integration review, the reviewer already
had source context and used the direct diff and GitHub instead of duplicating
capture. This is an observed skip decision, not a scored three-arm case.

The approved proposed workflow combines capture into one CLI invocation, but
still requires source selection, metadata projection and authored content, then
three import POSTs. Its provenance-bearing brief is a second CLI invocation and
three GETs; ordinary brief uses two GETs. The focused tests observed these
request counts, and one real-source capture measured the POST bodies below;
this does not establish whole-path savings. Original #210 request payload size,
total elapsed time and provider usage were not measured.

Current recommendation: **limit** Runtrail to explicit cross-client handoffs
where a portable, attributed ledger is useful and the source is eligible. Use
direct T3/GitHub for the active #210 review request, and skip capture for simple
same-thread work. There is no demonstrated whole-path saving for the new
workflow yet. The bounded remaining pilot is tracked in [#218](https://github.com/redxzeta/runtrail/issues/218).

## Post-merge dependency verification (incomplete comparison)

The security producer's distinct source run 1 subsequently completed at
2026-10-28T14:11:58.532Z; its final item was position 62. This is a separate
eligible source from the active integration-thread message above. The genuine
continuation is lifecycle validation against the merged dependency revision.
Two fresh readers ran concurrently with Sol/high without producer memory; the
Runtrail reader used the same model and effort afterward. These are arms of one
case, not additional cases. The direct arm could inspect the source item and
selected GitHub fields; the Markdown and Runtrail arms received authored
selections with the differences described below. Presentation and order remain
confounders.

| Arm | Observed result | Cost observed |
| --- | --- | --- |
| T3 + GitHub | Identified candidate `6257537`, merge `0c9a352` and lifecycle validation, with historical checks, inventory and missing source ID limits. | One supported T3 read, one `gh pr view`, plus tool discovery. Bytes and total provider usage unmeasured. |
| Markdown | Identified the same revisions, action and limits; also inferred restoring `prepare-work` as a first prerequisite, which was not established by the handoff. | Zero reader tool calls; authoring and original message bytes were not measured. |
| Runtrail | Identified the same revisions and lifecycle action as client-reported, unverified facts. Noted unknown applicability and bounded coverage; suggested rereading/accepting but stated that this is not authorization. | One provenance brief CLI invocation, exit 0, 8,594 stdout bytes, 1.249 seconds subprocess elapsed; provider usage unmeasured. |

The GitHub command's reported elapsed time was 0.330 seconds, not whole-path
time. No per-arm total elapsed time or provider usage is available. All three
reader outcomes are reported, but the case is not scored or counted because the
information supplied was unequal. The arm order was not counterbalanced.

Candidate `c3605db8df4053568844c44db064727861f9ef7e` was independently reviewed
against `d3120d3` and tested after frozen install in a disposable checkout:
25 focused tests passed across workflow capture, brief and the existing
cross-client acceptance suite. These are functional regression evidence, not
reader usefulness or configured native-client startup evidence. The actual
completed security-producer source was captured in an authenticated disposable
loopback ledger: source metadata 219 bytes, authored summary 613 bytes, CLI
output 959 bytes, and three POST request bodies of 1105, 2766 and 2890 bytes
(responses 1548, 2883 and 3004 bytes). Setup, original authoring, and historical
send costs are not fully measured. The independent Runtrail reader completed.

The Runtrail summary omitted the Markdown arm's historical one-message and
unmeasured-bytes detail and its pointer to installed paths, advisories and
rollback. Equivalent information was not established, so this comparison remains
incomplete and does not demonstrate an advantage.

Independent review of #220 found a separate startup failure: if initialization
times out while SDK close stalls, the failure path awaits close outside the
bounded shutdown and does not deliver an initialization error while stdin stays
open. A disposable injected-stall regression failed after 2.5 seconds; this is
not a claim that a natural SDK close stall was observed. The finding was sent to
the lifecycle owner and integrator. On revised head
`8348c2a2865efef8a81961b8210ece980a383744`, an independent reproduction of the
same injected stall passed: the diagnostic arrived while stdin was open,
upstream sockets closed and EOF reached bounded cleanup. The exact-head
bridge, entrypoint and workflow focused suite passed 62 tests.
The separate local combination of #219 `c3605db` and #220 `aafcd012` passed
61 focused tests, lint, typecheck, 266 full tests, build and 19 conformance
checks; its tree was `6421998d48f8686d146b7a68c6b060a71f6e467c`. These passing
checks do not cover the failing injected-stall regression or establish the final
integration revision. Native Windows remains NOT_RUN.
