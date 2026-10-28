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
