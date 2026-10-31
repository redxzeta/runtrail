# #221 permission fidelity repair

Base: `ee4ab5e161867d5f74c3b7fc9580580db405a24d` (fresh origin/main before editing).
Implementation and replay pin: `2a209a34083a966675881dec2c01be151b9a9404`.
Later report commits change documentation only.

## Reproduction and change

The new focused test failed before the fix: ``Unix `0700`/`0600` permissions.``
projected to ``Unix `0700`[path omitted] permissions.`` The existing path matcher
starts at the separator slash following the closing backtick. The historical
capture/stored-provenance receipts already preserve the complete A summary;
`buildBrief` loses text, and `formatBrief` sanitizes projected text again.

The only behavior change recognizes a standalone pair of backticked four-digit
POSIX octal modes before path matching. It does not exempt numeric paths or
change capture, import schemas, payload hashes, retries, limits or Markdown
escaping. Existing path alternatives consume prefixed paths before the pair.
Ambiguous slash/backslash/word/backtick continuations remain redacted. Positive
privacy controls include numeric POSIX paths, quoted/backticked POSIX paths,
Windows drive paths, UNC paths, prefixed pairs and trailing path components.
Capture rejects private paths before requests/storage; existing secret, URL,
control, transcript and environment screening remains unchanged.

## Same-case replay

The spawned CLI (`pnpm --silent cli`, using the actual TypeScript entry point)
ran against authenticated disposable loopback SQLite with Discord disabled,
a generated environment-only token, private logs/state paths and owner-only
source/envelope files in a 0700 directory. Only whitespace in the frozen
`218/A.json` and `218/B.json` summaries was normalized, as disclosed previously.
Original delegated IDs, ordinal runs, terminal statuses and completion times
were retained. No new source observation or producer validation is claimed.

Both saved envelopes retain the exact authored summaries. Identical saved-byte
retry returns the same three confirmed IDs with unchanged record counts.
JSON provenance retains source identity, task, complete safe summary, next action,
narrative blockers and evidence limits. Markdown contains the entire correctly
escaped summary, including A's permission pair. Short ordinary projections still
clip and report clipping; the 1800-character provenance summary bound is intact.
Both brief invocations use three GETs each and leave all rows of agent_runs,
agent_events, handoffs and verification_evidence unchanged. Token and disposable
path values are absent from outputs. These are functional assertions, not fresh
reader usefulness scores.

Final replay observations are in [221/fidelity.json](221/fidelity.json).
Per case: four measured CLI invocations, six POSTs (capture plus retry), six GETs
(JSON plus Markdown). Across A/B: eight invocations, twelve POSTs, twelve GETs.
This excludes setup, other safety tests, failed runs and review. Total owner/tool
operations, elapsed setup/authoring, tokens and cost were not measured; no savings
claim follows. Existing cross-client outage regression runs a harmless child once
while recording is unavailable and preserves exit 7; this is an injected control.

Historical results remain **2/10 comparisons, 0/2 baseline portable handoffs**;
prior bounded replay **2/2 category recovery, 1/2 exact summary** remains historical.
This replay yields **2/2 complete safe summaries** with unchanged logical inputs;
it contributes zero new prospective handoffs. Original raw multiline summaries
still exceed the unchanged 12-line bound. #169/#215/#218 and Windows qualification
remain separate; Linux path-string tests do not establish native Windows support.

## Validation, limits and cleanup

Before repair, focused permission test: one failure, 19 skipped. Initial focused
four-file validation: 31 passed. While adding measured receipt counts, a missing
local variable caused typecheck failure and two replay test failures (281 other
full-suite tests passed). A separate receipt extraction run failed at the same
variable. Those failures are retained here; the variable was fixed before final
validation. No assertion was weakened and no timeout was raised.

Final validation and independent exact-head review are recorded in the linked PR.
Conformance: 19 passed, cleanup passed. Production audit: zero advisories.
Frozen install, lint, typecheck and build passed; the existing Biome schema-version
notice is informational. At the implementation/replay pin, `pnpm test --reporter=verbose` passed all
**283 tests in 27 files** (91.89 seconds), including the single-execution
exit-7 outage control. `git diff --check` passed.

Each fixture closes only its own loopback listener and database and removes only
its own temporary directory (SQLite, logs, source, envelope and state). Immutable
means unchanged throughout delivery/retry/read; disposable copies are deleted at
fixture cleanup. No production service, client, host, schedule, deployment or
unrelated worktree was changed. The bound worktree is retained for inspection.
Rollback: revert this scoped code/test repair through a reviewed PR; no schema
migration or runtime activation is involved. Retain ordinary user ledger records
and saved envelopes.
