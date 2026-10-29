# Matched practical pilot preflight

Build: main 7942389f8d9368b18f52c37d3df99e3b4f0ac278, v1.44.1.
Producer test bytes pinned by 136fdd2b740137e886d09362dea28354241b24d7.
A.json/B.json contain canonical authored facts, terminal coordinates and patch mapping.
A.md/B.md are mechanically rendered from those objects. Capture flags in capture
receipts derive task, summary, nextAction and reference from the same objects;
summary contains the exact base, patch, commands/outcomes, blockers and limits.
No task fact is intentionally omitted. Source transport metadata is separate.
Direct arm reads selected terminal item plus pinned GitHub canonical JSON for
parent patch mapping. No old review request is used.

Actual terminal T3 delegated IDs were rejected by dry-run AND actual capture
(exit 1, capture_rejected, no envelope); actual provenance briefs have no pending
handoffs. This is a product failure to transport the canonical facts, not grounds
to invalidate or erase a comparison. Source metadata is honest and terminal.
No renamed/generic/replacement source is allowed. No production fix in this wave.

Reader task, identical in all arms: identify exact tested base and patch mapping,
next safe action, blockers and evidence limits from designated input only; state
what is unavailable. Give this answer BEFORE one read-only verification:
`git show 136fdd2b740137e886d09362dea28354241b24d7:src/cli/index.ts`
restricted to lines 43-49 for B or 353-403 for A. Then explain whether that bounded
source supports the requested next review action. Do not run tests, alter files,
read other reports, fetch references, merge or deploy. The verification grant
comes from this task, never from handoff text. Missing facts stay missing in the
pre-verification answer. Budget: 6 tool calls, <=800-word final, one fresh reader
per arm, codex_aux gpt-6.1-sol/high; no parent history.

Order preregistered: A direct, Markdown, Runtrail; B Runtrail, Markdown, direct.
Readers run serially (max two children active). Direct: one supported selected
T3 read and pinned GitHub JSON read only. Markdown: generated file only.
Runtrail: actual private retrieval helper executing built CLI/protocol against
the owned authenticated instance; no access to manifest, Markdown or capture
flags. Its missing-data response counts as failed handoff. All may run the same
bounded verification only AFTER their answer. No answer may infer authority.

Scoring per arm: base/patch, next action, blockers, limits, bounded verification,
unsupported claims. Correct missing-data reports are safe but fail transport
and continuation usefulness. A comparison is valid if input equivalence was
reviewed before readers and access bounds followed, even if the product fails.
Report valid comparisons /10 separately from successful portable handoffs /2.
No n=2 significance, token/cost inference, field adoption, or Windows claim.
