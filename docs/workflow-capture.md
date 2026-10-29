# Explicit capture and continuation

Use this optional lane when another client needs a bounded, portable handoff.
Same-thread work or a one-off review often needs only T3/GitHub or Markdown.
Configure `RUNTRAIL_URL` and environment `RUNTRAIL_TOKEN` once; use `pnpm cli doctor`
for setup/errors. No daemon, automatic T3 hook, source fetch or MCP tool is added.

## Source read and authoring

Read the authorized source using its supported client. Select only the following
metadata from a supported T3 `t3_thread_read` result; never save the raw response,
timeline, prompts, worktree paths or transcript. That projection is real per-item
preparation. `selected-metadata.json` is a local file, not a URL:

```json
{
  "thread": { "threadId": "mcp:aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa" },
  "recentRuns": [{
    "runId": "run:thread:mcp%3Aaaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa:ordinal:1",
    "status": "completed",
    "completedAt": "2026-10-28T04:14:22.162Z"
  }]
}
```

Supported T3 thread identities are top-level `mcp:<UUID>` and the observed
`thread:delegated-task:command%3Amcp%3A<UUID>%3Adelegate-task%3A<UUID>`.
The run must be exactly `run:thread:${encodeURIComponent(threadId)}:ordinal:<positive integer>`
and the reference exactly `t3-thread://v1/${threadId}`. Do not decode, rename,
or substitute source identities. Capture, import-work and the example exporter
all validate through the same importer contract. Bounds remain unchanged:
authored summaries allow at most 1800 characters and 12 lines; explicitly
project longer source reports into bounded authored text while retaining failures
and limits. Old terminal observations are historical, never fresh validation.

These are illustrative coordinates, not an actual source or check result. Inputs
are regular JSON files of at most 16 KiB. Extra fields are rejected, not stripped.
If selected metadata contains several runs, pass `--source-run` with the exact
run ID; no latest-run guessing occurs. Duplicate/absent selection, mismatched
thread/run and nonterminal selected sources fail before files or requests.
Unselected running runs may have `completedAt: null`; the chosen run must report
a terminal status and completion timestamp. A real handoff sent inside a still
running T3 run cannot be honestly captured here yet. Wait for an honest terminal
source or use direct access/Markdown; never forge completion or substitute a
different run to make a comparison pass.

Non-AI shell/CI callers may instead provide a strict generic v1 **source object**
with `kind`, `system`, `threadId`, `runId`, `ref`, `observedAt`, `reportedStatus` as
documented in [the importer contract](import-work-summary.md). Those coordinates
and time remain caller authored. This is not proof of source authenticity or a
way to disguise a running T3 source. Existing `import-work --file` still supports
full authored v1 envelopes when richer evidence/outcomes are needed.

## One capture operation, then one continuation read

After that unavoidable source read/projection, author a short task, summary and
next action. Include blockers and what was not checked in the summary. Do not
invent evidence from completion. Review the flags locally: the conservative
unsafe-input screen cannot detect every secret. Command-line arguments may be
visible in local process listings or shell history; use only public-safe text.

```sh
pnpm --silent cli workflow capture --source-file selected-metadata.json \
  --project runtrail --work-key github:redxzeta/runtrail#215 \
  --task "Review workflow capture" \
  --summary "Blockers: independent review pending. Evidence limits: checks unverified." \
  --next-action "Review the exact candidate and check revision applicability" \
  --evidence-ref https://github.com/redxzeta/runtrail/issues/215 \
  --save data/handoff-215.json

pnpm --silent cli brief --project runtrail --work-key github:redxzeta/runtrail#215 \
  --import-provenance --json
```

`--project` defaults to `owner/repo` only when local Git's `origin` has an exact
public GitHub SSH/HTTPS form without credentials/query/port. Otherwise supply it.
`--workflow-id` and `--task` default to the explicitly supplied canonical work key;
they are labels, not inferred prose. `--to-source` optionally targets a receiver.
Local Git HEAD and clean/modified/unknown state are recorded only as an unverified
capture-checkout reference, with **no source/check linkage**. Use `--no-git` to
omit that observation. No machine path or remote URL is saved. Repeated
`--evidence-ref` values are references with unknown outcomes and are never fetched.
There are at most 12 total evidence items, including derived source/Git references.

Capture validates through the strict existing v1 importer, observes/export-stamps
once, and publishes a fully written new envelope with owner-only file permissions
before the first HTTP write. Its directory must already exist; use a private
directory outside version control (the example uses ignored `data/`). Files,
including symlinks, are never overwritten; there is no force option. The saved
envelope is the bounded sanitized minimum, with authored text and provenance only.
It contains no full gateway response, transcripts, logs, commands or credentials.
Imported action text is inert data, not permission to run it.

Three existing authenticated POSTs confirm a run, summary event and pending
handoff. There is no multi-request transaction, evidence verification or automatic
acceptance. Success confirms storage only. Explicitly accepting a handoff and
starting a receiving run are separate, intentional operations outside this read.

The fresh `brief --import-provenance` makes **three GETs**: prepare-work, context
and one bounded project pending-handoff query. No write occurs. The optional third
query joins only same-project, ID/version-matched pending handoffs, reparses strict
v1 provenance and checks the stored payload hash/identity. JSON preserves external
source coordinates, reported status, observation time, completion-time reference,
authored task/action/blockers and evidence outcomes as unverified. Applicability
stays unknown. Markdown renders the same facts. `--limit` bounds arrays (1–20),
coverage reports omitted items and text clipping, and missing/invalid/mismatched
provenance is marked unavailable. This project query may miss work-key-scoped
handoffs when unrelated project handoffs fill its limit. Its upstream truncation
is unknown; empty output never proves no blockers or history. Reads are separate
observations, not an atomic snapshot. Default `brief` remains two GETs and has no
external import-provenance projection. HTTP/MCP schemas and tools are unchanged.

## Dry-run and uncertain retry

Append `--dry-run` to validate new capture without writing any file or making any
network request. `--save` is optional during dry-run and is not written. Dry-run
does not authenticate sources or predict remote conflicts. Its observation time
is provisional; a later new capture observes a new timestamp. It is not a saved
delivery envelope.

After an outage, partial acknowledgement or lost response, keep the original
saved file unchanged and run only:

```sh
pnpm --silent cli workflow capture --retry data/handoff-215.json
```

Retry refuses authoring/source/save overrides and never reads Git or source
metadata. It reuses saved identities, timestamps and payload; reordered object
keys retain importer semantics. Confirmed IDs describe acknowledged stages only;
`deliveryUnknown` means the failed stage may already be committed. Identical retry
recovers existing records and fills remaining stages. Changed payload under the
same identity conflicts before follow-on writes. Do not mint another identity to
conceal a retry. The workflow does not queue or drain the outbox, replay commands,
fetch references, approve, merge, deploy or schedule anything.

## Count the actual work

| Path after the same source reads | Per-item preparation | CLI invocations | Runtrail HTTP |
| --- | --- | ---: | ---: |
| Historical helper/import/brief | Metadata projection + authored work JSON | Helper (plus internal validation child), import, brief | 3 POST + 2 GET |
| Capture/default brief | Metadata projection + authored flags | Capture, brief | 3 POST + 2 GET |
| Capture/provenance brief | Metadata projection + authored flags | Capture, brief | 3 POST + 3 GET |
| Identical complete retry | Reuse saved file | Retry | 3 POST |

Setup, lookup/selection, authored text, source reads and any retry are additional
real work. Capture removes separate work-JSON authoring, helper execution and
manual redirected envelope storage; it does not eliminate metadata projection or
server calls. Extra provenance adds a GET. No total elapsed-time, token, cost,
compression or general adoption benefit follows from combining subcommands.
Functional tests are historical-source/synthetic regression evidence; prospective
fresh-reader usefulness scoring is independent and must report actual N/10.

Rollback is a code revert, without migrations. Retain ordinary imported ledger
records and user files; do not delete unrelated data or replay lifecycle actions.
