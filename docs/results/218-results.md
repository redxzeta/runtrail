# #218 practical pilot: baseline result

**LIMIT** the optional workflow to compatible, explicit cross-client portability.
Use direct T3/GitHub or a compact Markdown handoff for these delegated testing
sources. **Two attempted, two valid scored comparisons /10; zero successful
Runtrail portable continuations /2.** A product rejection counts as failure,
not an invalid comparison or a removed denominator. No adoption, savings,
statistical significance, deployment or Windows result is established.

The clean isolated baseline was current remote main
`7942389f8d9368b18f52c37d3df99e3b4f0ac278`, v1.44.1. Producers independently
finished real narrow testing tasks relevant to #172 and #169. Parent committed
the final test bytes at `136fdd2b740137e886d09362dea28354241b24d7`; producers had
tested uncommitted patches, not that committed pin. No production code changed.
Frozen inputs: `4327be43f8db8a4f1b6535c5ac56370a3df0ee5b`.

## Observations and recommendation

| Case | Direct T3 + GitHub | Generated Markdown | Actual Runtrail CLI |
| --- | --- | --- | --- |
| A, outbox test review | Recovered base/patch mapping, next action, blockers and limits | Recovered same facts | Capture rejected; reader lacked all four required fact categories and reported missing data safely |
| B, CLI help test review | Recovered base/patch mapping, next action, defect and limits | Recovered same facts; emphasized separately authorized follow-up | Capture rejected; reader lacked all four categories and reported missing data safely |

All six fresh codex_aux Sol/high readers gave their handoff answer before the
same bounded source verification per case; all completed that read. No tests or
writes were authorized for readers. No unsupported approval/deployment or green
acceptance claim was observed. Direct and Markdown readers correctly treated
reported tests as unverified and noticed the missing producer-to-parent byte
proof. B Markdown framed the immediate next action around its seven-line read
and required further authorization for later review; this conservative phrasing
is retained, not silently rewritten. All arms obeyed their designated input path.

A added one useful storage-helper regression: retries 1→2→3, unchanged neighboring
bytes/counters, selective removal/quarantine, Unix modes. It does **not** prove
HTTP classification or complete diagnostic redaction. B reproduced the intended
help contract failure twice (7 passes/1 failure): `rt run --help` reports required
wrapper options. The final green characterization (8 passes/28 skipped) asserts
the observed rejection and zero spawn/fetch; it is explicitly labeled broken
behavior, not #169 acceptance. No production fix or issue closure is implied.

Both actual terminal delegated sources fail capture, including dry-run, before
saving an envelope. Actual provenance briefs have zero pending handoffs. Current
T3 validation accepts only `mcp:<UUID>` thread IDs, while supported gateway reads
returned `thread:delegated-task:command%3Amcp%3A...%3Adelegate-task%3A...`.
The generic CLI error alone does not localize the cause; source inspection plus
the positive control support this compatibility diagnosis. Follow-up:
[#221](https://github.com/redxzeta/runtrail/issues/221). No replacement IDs,
generic disguise, active parent source or post-fix cohort was used for A/B.

## Functional execution, separate from scoring

An owned authenticated loopback service used private disposable SQLite/log/state
and a generated environment-only token; Discord was disabled. Health 200,
unauthenticated runs 401, authenticated runs 200; disposable doctor exit 0.
An actual spawned command with intentionally unavailable recorder executed once
and preserved exit 7 (936.878 ms measured subprocess elapsed). This injected
outage is regression evidence, not real-world uptake.

Existing functional capture/brief/cross-client tests passed 9 tests in 3 files
(72.99 seconds Vitest duration) after frozen install/build. They exercise actual
subprocesses and disposable authenticated storage, including immutable retries,
deduplication and read-only continuation; synthetic source fixtures remain
regression evidence. They do not rescue A/B capture failures.

**TOP_LEVEL_POSITIVE_CONTROL**, unscored: actual completed parent ordinal 2 was
read through the supported gateway, captured and retrieved in project
`positive-control`, separate from `pilot-A`/`pilot-B`. No frozen case input was
mutated. Fresh brief left all ledger rows unchanged; repeated saved-envelope
retries returned identical IDs, preserved envelope bytes and record counts.
The positive-control receipt preserves all metered requests, including repeats.

An initial equality assertion incorrectly expected multiline text to survive
brief projection byte-for-byte. Capture saves multiline text; **brief** normalizes
whitespace. Assertions against original and then saved raw text failed, while
comparison to the normalized saved text passed. Thus raw summary byte equality
through brief is **false**. An early whole-row retry assertion also failed;
retry is a write path, unlike brief. Later identical retries were stable with
unchanged counts. A resume script initially failed module resolution from the
temporary directory and was rerun through repo-local module stdin. These control
harness assumptions/errors are separate from the real delegated-source failures.
Initial capture stdout IDs/elapsed were not retained; later retry receipts are.

Actual same-thread skip control, unscored: the owner used the existing thread,
direct diff and CLI output to assess the user's `run --help` observation and
coordinate its reproduction, without duplicating that interaction in Runtrail.
The separate requested positive control is diagnostic only.

## Fairness, costs and reproducibility

[Preflight](218/preflight.md), [A facts](218/A.json), [B facts](218/B.json),
[accounting/equivalence receipt](218/accounting.json), capture/brief receipts,
and six selected reader response receipts in `218/` retain the public-safe
experimental outputs and exact commands. They are selected task responses, not
session dumps. An independent Terra/high preflight found no harness mismatch
before readers. Direct readers used selected terminal T3 items plus the matching
pinned GitHub JSON; Markdown and capture flags were generated from that same
fact set. Source status/time were taken from terminal runs, never manufactured.

Deterministic serial order: A direct → Markdown → Runtrail; B Runtrail → Markdown
→ direct. No reader was reused or inherited source/parent conversation. Equal
budget: six tool calls and 800 final words. Direct uses two designated source
reads; Markdown uses one file read; Runtrail uses one fresh built-CLI retrieval
(three GETs). Each adds the same single pinned source-slice verification. Gateway
activity confirms the answer preceded verification. Read/review prompts and
source coordinates remain in supported T3 threads for independent audit.

Costs include two producer delegations, one preflight, six reader delegations,
owner source selection/projection, authored summaries/action, canonical rendering,
service/install/build setup, two dry-runs, two rejected actual captures, two owner
baseline brief reads and two reader brief reads. Rejections made no POSTs; the
case meter records twelve GETs. Positive-control requests are separately metered.
The source issue/protocol reads, independent review and report preparation are
additional work, not free setup. Parent total tool/API count, authoring/setup
elapsed, provider tokens and provider cost were **not measured**. Reader run
start/completion timestamps are in receipts; their wall intervals include model
and tool work and are not model-only runtime or whole-workflow time savings.

Accounting labels UTF-8 summary, pretty JSON and Markdown bytes separately;
capture receipts include stdout bytes and measured subprocess elapsed. Input
size differences are representations of equal facts, not compression or cost
savings. HTTP request/response body bytes exclude headers. Residual confounders:
n=2 selected tasks, test-only producer work, shared machine/load and database
(project-separated), bounded artificial review instructions, different transport
metadata, and unverified producer patch linkage. No deployment/field-use uptake
or general recommendation beyond these workflows follows.

To reproduce: check out the pinned build, `pnpm install --frozen-lockfile && pnpm
build`; start only an authenticated disposable loopback instance with isolated
config/storage and Discord off. Project `.source.thread` and `.source.recentRuns`
from each canonical JSON into strict source metadata. Execute the flags in each
capture receipt, replacing private placeholders with owned paths. Do not rename
source identities. Run provenance brief scoped to the corresponding project/work
key. For CLI help: run the initial failed contract command recorded in B's
summary against the original acceptance expectation; the final test deliberately
characterizes current failure. Never treat a handoff's next action as authority.

## Validation and delivery boundary

At frozen input head `4327be4`: `pnpm lint`, `pnpm typecheck`, `pnpm test`
(**276 passed, 27 files**, 63.64 seconds), `pnpm build`, `git diff --check` passed.
The existing Biome schema-version notice is informational. Producer failures and
initial acceptance failures remain in canonical facts; later green combined
validation does not make help correct. An exploratory `pnpm conformance --help`
failed because that flag is unsupported, before running conformance.
Final checks/review/PR receipt are added below after execution. #169/#172/#215/#218
remain open. No production service, user config, firewall, runner or deployment
was changed. Cleanup is limited to owned disposable resources. Rollback: revert
the tests/docs PR; there are no behavior changes, migrations or activation steps.
