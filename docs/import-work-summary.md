# Bounded work-summary import (v1)

Runtrail accepts explicit, client-reported summaries from generic tools and a bounded
T3 export. It records meaningful work and continuation context using the existing
run, event and handoff APIs. It never executes imported text or retrieves referenced
URLs/files. Completion is not verification, approval, merge or deployment evidence.

```sh
pnpm cli import-work --file work.json --dry-run
pnpm cli import-work --file work.json
# stdin is explicit; stdout is always a versioned JSON result
cat work.json | pnpm --silent cli import-work --file -
pnpm cli brief --project runtrail --work-key 'github:redxzeta/runtrail#207' --json
pnpm cli workflow packet --project runtrail --workflow-id runtrail-207 --format markdown
```

Use the existing `RUNTRAIL_URL`/`RUNTRAIL_TOKEN` configuration and authentication.
Dry-run validates and computes keys without network requests, local state, outbox
writes, or loading service configuration. It does not predict remote identity
conflicts or authenticate the claimed source. Keep the saved envelope unchanged
for delivery and retries. CLI argument syntax errors use the existing Commander
error behavior; envelope/read/delivery results are JSON, with exit code 1 on failure.

For the shorter interactive CLI/agent path, use [workflow capture](workflow-capture.md)
with selected metadata plus authored flags. It reuses this exact v1 contract,
exclusively saves an owner-only envelope before delivery and retries saved bytes.
The older helper below remains compatible for explicit authored JSON exports.

## Exact envelope

`src/integrations/workImport.ts` exports the authoritative Zod schema. Only the
following fields are accepted, including within nested objects. Maximum input is
16,384 UTF-8 bytes (including whitespace), one envelope per invocation, 12 evidence
references, 12 lines per text field. Strings must already be trimmed. Over-limit
input fails rather than being silently truncated.

```json
{
  "schemaVersion": "1",
  "source": {
    "kind": "generic",
    "system": "local-ci",
    "threadId": "build-job",
    "runId": "attempt-1",
    "ref": "urn:local-ci:build-job:attempt-1",
    "observedAt": "2026-10-28T05:00:00.000Z",
    "reportedStatus": "completed"
  },
  "project": "runtrail",
  "workflowId": "runtrail-207",
  "workKey": "github:redxzeta/runtrail#207",
  "task": "Build report",
  "summary": "Client reports build completed. Check evidence remains unavailable.",
  "evidence": [
    {
      "kind": "check",
      "ref": "urn:local-ci:build-job:check-1",
      "summary": "Result unavailable; inspect the original source.",
      "observedAt": "2026-10-28T05:00:00.000Z",
      "provenance": "client_reported",
      "outcome": "unknown"
    }
  ],
  "nextAction": "Review actual check results before continuing.",
  "handoff": { "toSource": "reviewer" }
}
```

| Field | Contract |
| --- | --- |
| `schemaVersion` | Exactly string `"1"`. |
| `source.kind` | `generic` or `t3`. |
| `source.system` | 1–40 lowercase letters, digits, dots, underscores or hyphens; starts with letter/digit. Stable client/source namespace. |
| `source.threadId`, `source.runId` | Each 1–255 characters. Stable external grouping and execution identity, independent of Runtrail server IDs. |
| `source.ref` | Safe source reference, at most 1000 characters. |
| `source.observedAt` | UTC ISO datetime when this source report was observed/exported; not an independently witnessed completion time. |
| `source.reportedStatus` | `completed`, `failed`, `cancelled` or `interrupted`. Running snapshots/lifecycle updates are unsupported. |
| `project`, `workflowId`, `workKey` | Required correlation, max 120/255/500 characters respectively. Workflow/work keys are caller-assigned canonical strings; no guessing from conversation text. |
| `task`, `summary` | Required bounded authored text, max 1000/1800 characters. |
| `evidence` | Required array, zero to 12 references. Each has `kind`, `ref`, `summary` (max 300), `observedAt`, `provenance`. |
| Evidence `kind` | `revision`, `pull_request`, `artifact`, `check` or `other`. |
| Evidence `provenance` | Exactly `client_reported`. No trusted-observer claims. |
| Evidence `outcome` | Optional `passed`, `failed`, `not_run` or `unknown`; remains an attributed reference, never a verification record. |
| `nextAction` | Optional authored text, max 1000 characters. Stored in summary event even without a handoff. |
| `handoff` | Optional object with optional `toSource` (1–80). Requires `nextAction`; `{}` creates a handoff available to any client. |

References allow `urn:<identifier>`, `git:<7–64 hex revision>`,
`repo:<relative/path>` without parent traversal, `t3-thread://v1/<id>`, or HTTPS
with a public-style DNS name and no credentials, port, query or fragment. Local
paths, `file:`, HTTP, IP/private host references and arbitrary schemes are rejected.
These are references only; even a valid hash or passing outcome proves nothing.

The importer rejects control/bidi characters, obvious authorization/key/password
material, uppercase environment assignments, absolute host paths and transcript
markers. The configured environment token is also rejected anywhere in the parsed
envelope. This conservative screen is not a universal secret detector: author a
small public-safe summary, review it locally, and never feed raw logs, environment
dumps, transcripts or credentials. Unknown properties are rejected, not dropped.
Imported instructions remain untrusted data for every receiving client.

## T3 source mapping and small export helper

The supported path is **gateway read → sanitized allowlisted export → explicit
CLI import → fresh client brief/handoff**. Native hooks and live client MCP
configuration are **NOT_RUN and out of scope**. This does not claim an automatically
wired T3 integration. No database/transcript scraping, daemon or webhook is used.

The actual T3 gateway `t3_thread_read` contract was checked against authorized
Runtrail thread `mcp:177db0af-e762-41bc-8d06-48fa322362e5`. Relevant fields are
`thread.threadId` and selected terminal `recentRuns[].runId`, `status`,
`completedAt`; the gateway also exposes unrelated/private metadata that must not
be included. A completed source run observed through that read was
`run:thread:mcp%3A177db0af-e762-41bc-8d06-48fa322362e5:ordinal:2`, completed
`2026-10-28T04:14:22.162Z`. This documents the source contract, not a check result.

The acceptance lane owns `examples/acceptance/t3-export.mjs` and its runnable
fixtures/assertions. Once that companion lands, use:

```sh
node examples/acceptance/t3-export.mjs --source metadata.json --summary work.json > envelope.json
pnpm cli import-work --file envelope.json --dry-run
pnpm cli import-work --file envelope.json
```

`metadata.json` is an intentionally selected projection, not the raw tool result:

```json
{
  "thread": { "threadId": "mcp:177db0af-e762-41bc-8d06-48fa322362e5" },
  "recentRuns": [{
    "runId": "run:thread:mcp%3A177db0af-e762-41bc-8d06-48fa322362e5:ordinal:2",
    "status": "completed",
    "completedAt": "2026-10-28T04:14:22.162Z"
  }]
}
```

`work.json` holds the authored project/workflow/work-key/task/summary/evidence and
optional next action/handoff fields. The helper derives source IDs, terminal
status, source reference and a single export observation timestamp; no copying
IDs/timestamps each turn is required. Save its output once for retries. It validates
through this CLI's no-write dry-run rather than duplicating the schema.

For `source.kind=t3`, `system` must be `t3-code`, `threadId` must be an `mcp:` UUID,
`runId` must match the gateway's
`run:thread:<encodeURIComponent(threadId)>:ordinal:<positive integer>` identity,
and `ref` must be exactly `t3-thread://v1/<threadId>`. Other T3 identity forms or
nonterminal statuses require a future explicitly versioned mapping. The mapping
checks correlation, not authenticity; the report remains client-reported.

## Identity, partial delivery and retry

Identity is scoped to **project + source kind/system/thread ID/run ID**. The
canonical JSON identity is SHA-256 hashed into `wi1:<hash>`. Server source is
`work-import:<kind>:<system>`. Summary/handoff keys add `:summary`/`:handoff`.
Object key order/JSON whitespace do not matter; array order and every parsed value
do. The full payload hash is stored in an initial creation-only run tag
`import-sha256:<hash>`. Existing run fields and that tag must match before any
follow-on write. The server's unique source/project/client-run key makes concurrent
first delivery choose one payload; a different payload receives `identity_conflict`.
Changing observation time, summary, evidence, work key or workflow is a conflict,
not an update. Preserve the original envelope, or use a genuinely distinct external
run identity for distinct work. Never mint another ID merely to disguise a retry.

The importer performs up to three existing authenticated POSTs:

1. `/runs`: terminal state with `[Client-reported; unverified]` summary and
   `work-import-v1` category. `interrupted` maps to `cancelled`; exact original
   status remains in the envelope. Existing API run recovery creates its usual
   recovery event/receipt. No mutable lifecycle calls are replayed.
2. `/events`: one `progress` event containing the envelope, payload hash and
   `client_reported_unverified` semantics. Its observation time is explicit.
3. Optional `/handoffs`: linked to the **confirmed server run ID**, with stable
   key and the same attributed provenance. An accepted/completed handoff is never
   reset to pending by reimport.

Run `startedAt` uses the observation timestamp as a report-record time, **not** the
external execution's start. Existing API creation does not set `completedAt` for
terminal creates; the importer makes no completion-time claim. Source references,
revision hashes and evidence outcomes stay in event/handoff provenance; imported
completion text creates no artifacts or verifications. Readiness/briefs retain
the existing missing-check, stale and unknown-applicability limitations.

There is no transaction across HTTP calls. A failed response may follow a
committed write. JSON `confirmed` contains only acknowledged and matched server
IDs, `error.stage` identifies `validation`, `run`, `summary` or `handoff`, and
`deliveryUnknown` explicitly marks uncertainty. `status` is `invalid`, `dry_run`,
`complete`, `conflict`, `partial` or `failed`; `resume` is `fix_input`,
`retry_identical_envelope`, `resolve_conflict` or `none`. `complete` means all
requested import records were confirmed, not that the work or evidence is true.
The result returns hashes/keys, never the original text, tokens or local file paths.

After connectivity/auth/service repair, retry the **identical saved envelope**.
Existing server keys return the same records and fill any missing later stage.
Conflicts stop before follow-on writes; they never silently overwrite stored work.
The existing outbox cannot sequence this dependent chain, so import neither queues
nor drains it. There is no fake server ID, automatic background retry, source URL
fetch or command replay. Retain the input locally until delivery is confirmed.

## Validation and rollback

`pnpm exec vitest run test/workImport.test.ts` exercises bounds, schema, dry-run,
unsafe material, distinct identities, conflicting payloads, authenticated disposable
HTTP, committed-write/lost-response recovery, and inert commands/references. Run
repository lint/typecheck/full suite/build/conformance before delivery. Independent
acceptance owns helper assertions, real gateway export, fresh second-client
continuation and measured utility; this module's tests alone do not establish them.

Rollback is a code revert; no migrations or new server schemas are introduced.
Imported records remain existing ledger records. Do not replay handoff/run lifecycle
operations or delete unrelated user data as a rollback shortcut. No deployment or
user MCP configuration change is included.
