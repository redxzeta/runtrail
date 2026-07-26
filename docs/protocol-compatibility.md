# Protocol Compatibility and Client Support

This policy defines compatibility for the public Runtrail HTTP API, CLI, direct MCP adapter, stdio
bridge, capability manifest, and conformance result. It also separates reference-protocol evidence
from evidence produced by a real agent client.

## Version fields

Runtrail versions several contracts independently:

| Field | Meaning | Client rule |
| --- | --- | --- |
| `service.version` | Installed Runtrail package version | Use for diagnostics, not feature detection. |
| `protocol.name` and `protocol.version` | Core `runtrail-agent-ledger` behavior | Stop if the name or major version is unsupported. |
| capability `schemaVersion` | Shape of `/meta/capabilities` | Parse before using any other manifest field; stop on an unsupported version. |
| `features[].id` and `features[].version` | One optional public behavior and its contract version | Gate each optional operation by both values. |
| `schemas.workflowReviewPacket` | Workflow review-packet shape | Do not parse an unsupported packet version optimistically. |
| conformance `resultSchemaVersion` | Machine-readable test-result shape | Consumers must reject unsupported result versions. |
| conformance profile name and version | Scenario contract, currently `agent-continuation-v1` version `1` | Compare both; a different version is different evidence. |

The service version can change without changing the protocol. Conversely, a protocol, feature, or
schema version change is meaningful even if a client happens to tolerate the new shape.

## Required client behavior

Before an optional call, read `GET /meta/capabilities`, `rt capabilities --json`, or
`journal_get_capabilities`.

1. Validate the manifest `schemaVersion`, protocol name, and protocol version. On an unsupported
   value, stop the affected workflow and report a bounded local compatibility error that includes
   the unsupported version, not credentials or response bodies.
2. Build a set of `(feature id, feature version)` pairs. Ignore unknown feature identifiers.
3. Treat a missing optional feature or tool as `not_supported`. Do not infer support from the
   service version and do not call an absent MCP tool.
4. Use the advertised default and maximum limits. Clamp optional user input when safe; otherwise
   surface the server's validation error instead of retrying an unbounded request.
5. Preserve unknown response fields. For an unknown enum value, retain the raw bounded value for
   diagnostics, use an explicit `unknown` branch, and do not perform a mutation whose safety
   depends on guessing its meaning.
6. Treat `409` version conflicts and cursor errors as reread signals. Never convert them into an
   automatic takeover, replay with a guessed version, or success.
7. Treat `not_supported` conformance steps as absence, not success. Any failed step for an
   advertised capability invalidates that profile result.

Runtrail does not currently negotiate versions in request headers. Compatibility discovery is the
manifest plus the versioned schema returned by the requested resource. A client-side incompatibility
must remain distinct from authentication, transport, validation, and optimistic-conflict errors.

## Change compatibility

| Change | Protocol v1 expectation |
| --- | --- |
| Add an optional response field | Compatible. Clients ignore and preserve unknown fields where practical. |
| Add a capability identifier or optional MCP tool | Compatible. Old clients ignore it; new clients gate its use. |
| Remove or rename a field, feature identifier, or tool | Breaking. Follow deprecation and version the owning contract. |
| Add a request enum value | Compatible for clients that do not send it. Servers continue rejecting unknown request values. |
| Add a response enum value | Compatible only when clients have a safe `unknown` branch; otherwise version the owning schema or feature. |
| Change an existing enum value's meaning | Breaking. Introduce a new value and deprecate the old one. |
| Increase a maximum limit | Compatible; clients still use the manifest rather than hard-coded assumptions. |
| Decrease a default limit | Compatible only when pagination/cursors and truncation remain explicit. |
| Decrease a maximum limit | Compatibility-affecting. Deprecate the old bound and provide migration guidance. |
| Change a schema version | The old and new schemas are separate contracts. Clients stop on unsupported versions. |
| Tighten authentication, redaction, or unsafe-input rejection | May be an immediate security change; document the impact and preserve bounded errors. |

A stable feature identifier is never repurposed. A materially different behavior gets a new
feature identifier or version. Additive fields do not excuse changing established liveness,
idempotency, provenance, verification-assurance, or optimistic-concurrency semantics.

## Deprecation and removal

For a public field, enum value, tool, feature, schema, or limit:

1. Open a scoped issue describing the old contract, replacement, affected clients, and migration.
2. Announce the deprecation in release notes and this policy or the owning runbook. Because the
   current manifest has no deprecation field, do not invent one or silently change a feature's
   meaning.
3. Keep the old contract working for at least 30 days and one minor release, whichever is longer,
   unless an active security risk requires faster removal.
4. Before removal, provide focused compatibility coverage for the transition, pass every
   applicable advertised conformance step, and rerun each real-client golden path used by a support
   claim.
5. Remove only with a version change to the owning feature/schema or a new protocol major version.
   Publish the final migration note and update the support matrix in the same delivery.

An emergency security removal may shorten the window. Its release note must identify the affected
contract, safe replacement, reason for urgency, and validation evidence without disclosing secrets.

## Evidence levels

- **Implemented**: the surface exists in the repository and has focused automated coverage.
- **Conformance-covered**: the deterministic suite exercised the advertised contract. This does
  not prove a third-party client.
- **Real-client verified**: a reproducible golden path names the Runtrail commit/release, client
  version, transport, bounded operations, restart result, and sanitized outcome.
- **Documented, not verified**: setup guidance exists, but no current qualifying real-client packet
  is complete.

Evidence is version- and transport-specific. A client is never promoted by documentation alone, by
the synthetic clients in `pnpm conformance`, or by another client's success. Open defects and
partial results remain visible beside a verification claim.

## Current support matrix

| Surface or client | Implemented evidence | Conformance evidence | Real-client evidence | Current support statement |
| --- | --- | --- | --- | --- |
| HTTP API | [`test/ledger.test.ts`](../test/ledger.test.ts) | [`agent-continuation-v1`](conformance.md) and [#144](https://github.com/redxzeta/runtrail/issues/144) | Not a third-party client | Protocol v1 reference surface; implemented and conformance-covered. |
| CLI | [`test/cli.test.ts`](../test/cli.test.ts) and [`src/cli/index.ts`](../src/cli/index.ts) | The conformance runner uses the shared local outbox, but does not certify the CLI process as a transport. | Not a third-party client | Implemented and focused-test covered; not labeled a conformance transport. |
| Direct MCP adapter | [`test/mcp.test.ts`](../test/mcp.test.ts) | Direct-MCP capability equivalence and Agent B continuation in [#144](https://github.com/redxzeta/runtrail/issues/144) | Not a third-party client | Protocol v1 adapter; implemented and conformance-covered. |
| stdio bridge | [`test/mcp.test.ts`](../test/mcp.test.ts) | Bridge capability equivalence in [#144](https://github.com/redxzeta/runtrail/issues/144) | Codex packet [#89](https://github.com/redxzeta/runtrail/issues/89) and OpenClaw packet [#90](https://github.com/redxzeta/runtrail/issues/90) | Implemented and conformance-covered; two clients have verified the bridge, including the unavailable-service diagnostic fixed by [#133](https://github.com/redxzeta/runtrail/issues/133). |
| Codex | [setup runbook](mcp-client-setup-runbook.md#codex) | The underlying stdio bridge is covered; synthetic conformance is not Codex evidence. | [#89](https://github.com/redxzeta/runtrail/issues/89): Runtrail `v1.29.1`, Codex CLI `0.144.1`, lifecycle/query/restart passed | Verified only for that packet and scope. The packet predates the [#133](https://github.com/redxzeta/runtrail/issues/133) diagnostic fix, and the current full continuation profile has not been rerun in real Codex. |
| OpenClaw | [setup runbook](mcp-client-setup-runbook.md#openclaw) | The underlying stdio bridge is covered; synthetic conformance is not OpenClaw evidence. | [#90](https://github.com/redxzeta/runtrail/issues/90): Runtrail `v1.41.2` at `f630c96`, OpenClaw `2026.7.1-2`, stdio context/search/writes/manifest/restart/diagnostic passed | Real-client verified for that release, transport, and bounded operation set. Older OpenClaw `2026.1.29` lacks the required `mcp` command. |
| Claude Code | [setup runbook](mcp-client-setup-runbook.md#claude-code) | The underlying HTTP/MCP contract is covered; synthetic conformance is not Claude Code evidence. | [#91](https://github.com/redxzeta/runtrail/issues/91) is open | Documented, not yet real-client verified. |
| OpenCode | [setup runbook](mcp-client-setup-runbook.md#opencode) | The underlying HTTP/MCP contract is covered; synthetic conformance is not OpenCode evidence. | [#92](https://github.com/redxzeta/runtrail/issues/92) is open | Documented, not yet real-client verified. |

At commit `dbb9b48`, Runtrail advertises all 11 stable feature identifiers and the complete
`agent-continuation-v1` profile passed with `19 passed, 0 failed, 0 not supported` in
[PR #159](https://github.com/redxzeta/runtrail/pull/159). That supports the reference protocol
claim. It does not promote Claude Code, OpenCode, or the newer Codex continuation workflow to
real-client verified; OpenClaw's separate scoped claim is backed by [#90](https://github.com/redxzeta/runtrail/issues/90).

## Maintaining the matrix

Any PR that changes a public capability must state:

- affected version field and compatibility class from the table above;
- old/new capability, schema, tool, enum, or limit behavior;
- deprecation window and migration when compatibility-affecting;
- focused and conformance results, including every `not_supported` step;
- real-client packets rerun or explicitly left unverified;
- matrix and runbook updates required by the evidence.

Never replace an evidence link with an unversioned claim such as "works with current clients."
