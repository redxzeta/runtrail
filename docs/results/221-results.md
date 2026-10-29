# #221 repair and post-fix replay addendum

The historical #218 baseline remains **2/10 valid comparisons, 0/2 portable
handoffs**. This addendum replays those same two cases; it adds no prospective
cases. Frozen A/B files, original failed receipts and producer observations are
unchanged. Production source fix: `1dca129` (full build pin in `221/post-fix.json`).
CLI/help and minimal dependency repair are separately reviewed in PR #223.

## Source contract and reproduction

On baseline `a2ceec9348d17243ee46be64831e8e837c18afbd`, actual built CLI captures
rejected both original raw reports and whitespace-bounded reports, before any
HTTP request, saved envelope or ledger write (`221/baseline.json`). Independent
schema diagnosis found TWO causes: unsupported delegated IDs and 19/20 summary
lines exceeding the unchanged 12-line bound. Therefore identity support alone
does not make the original raw capture flags acceptable.

The fix admits only the observed delegated UUID grammar alongside top-level
UUID sources. Exact encoded run association and reference correlation, strict
fields, lengths, secret screening, terminal statuses, conflicts and retry keys
remain unchanged. Workflow capture and the example exporter already delegate to
the same import-work schema; neither needs a second identity parser. Selected
absent/stale coordinates and nonterminal runs remain refused. Historical terminal
sources remain allowed as historical observations; age is not attestation.

## Actual replay

An authenticated disposable loopback Hono/SQLite instance used environment-only
random credentials, a private temp directory, private immutable envelopes and
Discord disabled. Original thread IDs, ordinal runs, completed statuses and
completion times were retained. Authored summaries replaced whitespace runs with
one space, preserving all logical observations within existing bounds. No source
was renamed, disguised as generic, or declared newly tested.

| Case | Capture + saved retry | Fresh reader categories | Exact summary projection |
| --- | --- | --- | --- |
| A | PASS, same confirmed IDs/counts | All four recovered | FAIL: permission text partially path-redacted |
| B | PASS, same confirmed IDs/counts | All four recovered | PASS |

Both fresh Sol/high readers received only a fresh built-CLI provenance retrieval,
then gave revision/parent-patch mapping, next safe action, blockers and evidence
limits before their task-authorized bounded source read. No producer or previous
reader answers were supplied. Narrative blockers survived despite empty derived
blocker arrays. Both identified unknown applicability and unverified historical
checks; neither inferred authority. Selected responses and source pins are in
`221/reader-A.json` and `221/reader-B.json`.

**2/2 bounded handoffs captured and key categories recovered; 1/2 exact summary
projections; 0/2 unchanged raw summaries accepted.** Case A remains a product
projection failure: `0700`/`0600` becomes partially `[path omitted]`. It is not
excluded or silently corrected. Strict complete-fidelity success is **1/2**, not
2/2. Keep #221 open for this explicit residual rather than claim complete replay
acceptance. Keep #169 open for broader missing help groups, and #215/#218 open
for genuine future pilot needs. No schedules or promised future measurements.

Receipts retain actual subprocess elapsed/stdout bytes and envelope bytes;
GET request/response body bytes exclude headers. All brief reads made only GETs
and left ledger counts unchanged. Capture/retry request timing was not retained;
three-stage confirmed IDs do not constitute a complete whole-path cost meter.
One initial replay assertion expected exact A summary equality and failed on the
path redaction above; the successful rerun records that discrepancy as failure.
The rerun is functional diagnosis, not another scored pilot case. Provider token
usage, cost, setup/authoring duration and whole-path savings were not measured.

## Validation and delivery

Source-only focused regressions: 11 importer tests and 3 actual capture workflow
tests passed; lint, typecheck, build and diff-check passed. Full combined checks,
independent review, current-head CI and merge evidence follow in the PR delivery
receipt. These do not refresh original producer checks at `7942389` plus an
uncommitted test patch later pinned as `136fdd2`; byte equivalence remains unproven.

Official upstream advisory GHSA-rmxm-3fg6-px4f affects @hono/node-server
>=1.19.10 <2.1.3; patched 2.1.3. It concerns double-decoding in serveStatic.
Source imports serve and no serveStatic use was found: installed presence alone
is not proof of reachable vulnerability. PR #223 repairs the manifest minimum
and lock resolution only; its final audit and combined inventory are reported
separately. No blanket updates, overrides, suppressions or deployment.

Rollback: revert the scoped production commits through a reviewed PR. No schema
migration or activation is involved. Retain ordinary ledger records and immutable
user envelopes. Cleanup is restricted to owned disposable replay resources;
other worktrees and runtime/client configuration remain untouched.

Combined candidate validation at `b2e332f6db57ed9a95248cdf238a0e1a26aa9249`
passed frozen install, lint, typecheck, **280 tests in 27 files** (99.40 seconds),
build, **19 conformance checks, cleanup passed**, production audit **zero
reported advisories**, and diff-check. Registry inspection independently confirmed
2.1.3 requires Node >=20, peer Hono ^4; SDK 1.32.0 accepts node-server
^1.19.9 || ^2.0.5. The upstream advisory was read directly, not inferred from audit.

Fresh Terra/high reviewed the complete baseline-to-combined diff and separate
PR223 exact head with no P1/P2 findings, and verified reader answer-before-check
order from supported activity. Its tests/install/audit/CI were NOT_RUN.
PR223 merged with expected-head guard at
`916ba1e441e2e6c4cdbc698a3fc3885fef4fcfc7`; six exact-head checks passed.
Merging that current base produced `0a1bfd74552646586f01d879d8c28c0fde9ad9b3`
with the **identical tree** as reviewed/tested `b2e332f`.

The built combined candidate was then rechecked against the same frozen A/B
logical facts, not scored as new cases (`221/combined.json`). Both captures,
private envelopes, duplicate saved retries and GET-only briefs passed; the same
A projection loss remains. Separate historical top-level positive control passed
in its own project. Invalid source made zero requests/files/row changes. An
unavailable-recorder command executed **once**, preserved exit **7**, and used
only private temporary state. Health 200 and unauthenticated runs 401 were checked.
These functional controls are not reader evidence or whole-path saving claims.
