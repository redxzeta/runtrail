# Issue 215 usefulness pilot protocol

Registered before scoring; shared with the integration and workflow owners on
2026-10-28. This is a small operational pilot, not a benchmark or adoption claim.

## Eligible work and comparison

Target ten distinct, naturally occurring cross-client continuations on real
Runtrail work. Candidate handoffs are #210 dependency repair to reviewer,
#201/#167 bridge repair to reviewer or verifier, and the workflow implementation
to acceptance; include substantive followups only when they actually arise. A
same-thread or one-off task should be included where skipping Runtrail is the
expected choice. Do not split work, count fixture replays, or count a historical
source selection as prospective use. Report the actual completed N/10 and
separately label retrospective replays, synthetic checks, and field use.

For each available case compare supported T3 plus GitHub, a portable Markdown
handoff, and Runtrail. The arms receive the same logical task and available
information. Fresh independent readers receive no producer thread memory or
prior solution; record precisely the context, exclusions, order and any model,
effort, access or selection confounds. Counterbalance order or use separate
readers. A missing arm is missing evidence, not a pass or a zero-cost result.

## Rubric and accounting

Record whether the reader identifies the correct source revision, a practical
next action, blockers and evidence limits. Flag incorrect or missing facts,
rediscovery, stale evidence presented as current, and any inferred permission
to act. A completed run or hash does not itself establish verification. Check
the resulting answer against the source and name uncertainty; do not roll the
criteria into a score that hides correctness failures.

Count setup once and, per case and arm, source lookup, selection, authored work,
export, storage, retrieval, retries and resulting tool/API operations. Record
payload bytes when observable and elapsed time only when measured. Record actual
provider usage only when available; smaller text is not token or cost savings.
Include all attempts and the cost of repeat readers. Describe which operations
were removed and the total remaining overhead, including setup and authoring.

Recommend keep, limit, or stop based on a specific demonstrated use and its
correctness and cost, including where direct access or Markdown wins. Do not
generalize from a small selected sample. If fewer than ten valid cases are
available, publish the observed results and coordinate a bounded remaining
pilot issue with the integration owner; do not schedule or promise a run.

## Acceptance boundary

Review the actual workflow diff and test the candidate exact revision after
dependency updates. Exercise strict input and provenance, scoped selection,
duplicate/conflict and immutable retry, offline capture, oversized input,
read-only continuation side effects, old commands and secret-free persistence.
Use actual CLI/MCP against authenticated disposable loopback storage and clean
owned resources. Label source-read plus CLI testing accurately; native hooks,
configured live client startup and deployment require separate evidence.
