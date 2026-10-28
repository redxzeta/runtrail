# Issue 215 pilot observations

Protocol: [preregistration](215-usefulness-protocol.md). Results below are a
point-in-time record, not a claim of adoption, statistical savings or deployment.

| Case | Prospective status | Observation |
| --- | --- | --- |
| #210 repair to independent reviewer | Three-arm comparison blocked | The real review request identifies PR #216 head `6257537c78b21493659d7acd23337134eea56e6b`, asks for diff, advisory evidence, current CI and base review, and notes that bridge validation must use the merged SDK. The selected T3 message belongs to a running source run with no completion time. |

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
prospective cases. A same-thread, one-off review with its context already in
hand is a reason to skip capture, but has not yet been counted as a pilot case.

The approved proposed workflow combines capture into one CLI invocation, but
still requires source selection, metadata projection and authored content, then
three import POSTs. Its provenance-bearing brief is a second CLI invocation and
three GETs; ordinary brief uses two GETs. These are contract counts pending
candidate measurement, not an observed improvement. Payload sizes, elapsed time
and provider usage for this prospective case were not measured.

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
Two fresh readers ran concurrently with Sol/high, without producer memory; a
third Runtrail reader and candidate acceptance are pending. They are arms of one
case, not additional cases. Both received the task and the same selected
producer facts plus the GitHub merge observation; the direct arm could inspect
the source item and selected GitHub fields, while the Markdown arm received a
paraphrase. Different presentation and concurrent order remain confounders.

| Arm | Observed result | Cost observed |
| --- | --- | --- |
| T3 + GitHub | Identified candidate `6257537`, merge `0c9a352` and lifecycle validation, with historical checks, inventory and missing source ID limits. | One supported T3 read, one `gh pr view`, plus tool discovery. Bytes and total provider usage unmeasured. |
| Markdown | Identified the same revisions, action and limits; also inferred restoring `prepare-work` as a first prerequisite, which was not established by the handoff. | Zero reader tool calls; authoring and original message bytes were not measured. |
| Runtrail | Pending candidate and independent reader. | Not measured. |

The GitHub command's reported elapsed time was 0.330 seconds, not whole-path
time. No per-arm total elapsed time or provider usage is available. The case is
not scored or counted until equivalent Runtrail information and its reader
outcome are assessed.

Candidate `c3605db8df4053568844c44db064727861f9ef7e` was independently reviewed
against `d3120d3` and tested after frozen install in a disposable checkout:
25 focused tests passed across workflow capture, brief and the existing
cross-client acceptance suite. These are functional regression evidence, not
reader usefulness or configured native-client startup evidence. The actual
completed security-producer source was captured in an authenticated disposable
loopback ledger: source metadata 219 bytes, authored summary 613 bytes, CLI
output 959 bytes, and three POST request bodies of 1105, 2766 and 2890 bytes
(responses 1548, 2883 and 3004 bytes). Setup, original authoring, and historical
send costs are not fully measured. The independent Runtrail reader is pending.

The Runtrail summary omitted the Markdown arm's historical one-message and
unmeasured-bytes detail and its pointer to installed paths, advisories and
rollback. Equivalent information has therefore not been established. Preserve
this as an incomplete comparison unless a fresh comparable read resolves it.
