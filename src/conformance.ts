#!/usr/bin/env node
import { randomUUID } from "node:crypto";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { CallToolResultSchema } from "@modelcontextprotocol/sdk/types.js";
import Database from "better-sqlite3";
import type { Hono } from "hono";
import { enqueueOutbox, readPendingOutbox, removeOutboxRecord } from "./cli/outbox.js";
import type { RuntrailConfig } from "./config.js";
import { migrate } from "./db/migrate.js";
import { createApp } from "./index.js";
import { createRuntrailMcpBridgeServer } from "./mcp/bridge.js";
import { callRuntrailTool, type RuntrailHttpClient } from "./mcp/index.js";
import type {
  CapabilitiesManifest,
  ConformanceResult,
  WorkflowReviewPacket
} from "./shared/schemas.js";
import { setNowProvider } from "./shared/time.js";

type StepResult = ConformanceResult["profiles"][number]["steps"][number];
type ClientRequestOptions = { method?: string; body?: Record<string, unknown> };

export type ConformanceOptions = {
  output?: string;
  induceFailure?: boolean;
  onTemporaryDirectory?: (directory: string) => void;
};

export async function runConformance(options: ConformanceOptions = {}): Promise<ConformanceResult> {
  const directory = mkdtempSync(path.join(tmpdir(), "runtrail-conformance-"));
  options.onTemporaryDirectory?.(directory);
  const token = `conformance-${randomUUID()}`;
  let clock = Date.parse("2026-07-25T18:00:00.000Z");
  const restoreClock = setNowProvider(() => new Date(clock));
  let db: Database.Database | undefined;
  const baseline: StepResult[] = [];
  const continuation: StepResult[] = [];
  let capabilities: CapabilitiesManifest | undefined;
  let cleanupStatus: ConformanceResult["cleanup"]["status"] = "passed";

  const result = (): ConformanceResult => {
    const steps = [...baseline, ...continuation];
    return {
      resultSchemaVersion: "1",
      serviceProtocolVersion: "1",
      profiles: [
        { name: "baseline", version: "1", steps: baseline },
        { name: "agent-continuation-v1", version: "1", steps: continuation }
      ],
      capabilities: capabilities?.features.map(({ id }) => id) ?? [],
      summary: {
        passed: steps.filter((step) => step.result === "passed").length,
        failed: steps.filter((step) => step.result === "failed").length,
        notSupported: steps.filter((step) => step.result === "not_supported").length
      },
      cleanup: { status: cleanupStatus }
    };
  };

  try {
    db = new Database(path.join(directory, "runtrail.sqlite"));
    migrate(db);
    let app = createApp({ config: isolatedConfig(directory, token), db });
    let http = referenceClient(app, token);

    capabilities = (await http.requestJson("/meta/capabilities")) as CapabilitiesManifest;
    await step(baseline, undefined, "http", "versioned capability manifest", async () => {
      ensure(capabilities?.schemaVersion === "1", "capability schema version mismatch");
      return "schemaVersion=1";
    });
    await step(
      baseline,
      undefined,
      "direct_mcp",
      "HTTP and direct MCP capability equivalence",
      async () => {
        const direct = await callRuntrailTool("journal_get_capabilities", {}, http);
        ensure(JSON.stringify(direct) === JSON.stringify(capabilities), "direct MCP facts differ");
        return "equivalent";
      }
    );
    await step(
      baseline,
      undefined,
      "stdio_bridge",
      "HTTP and stdio bridge capability equivalence",
      async () => {
        const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
        const bridge = createRuntrailMcpBridgeServer({
          callTool: async ({ name, arguments: args }) => ({
            content: [
              {
                type: "text",
                text: JSON.stringify(
                  await callRuntrailTool(name, (args ?? {}) as Record<string, unknown>, http)
                )
              }
            ]
          })
        });
        const bridgeClient = new Client({ name: "conformance-bridge-client", version: "1" });
        try {
          await bridge.connect(serverTransport);
          await bridgeClient.connect(clientTransport);
          const response = CallToolResultSchema.parse(
            await bridgeClient.callTool({
              name: "journal_get_capabilities",
              arguments: {}
            })
          );
          const text = response.content.find((item) => item.type === "text");
          ensure(text?.type === "text", "bridge text response missing");
          ensure(text.text === JSON.stringify(capabilities), "bridge facts differ");
          return "equivalent";
        } finally {
          await bridgeClient.close();
          await bridge.close();
        }
      }
    );

    const featureSet = new Set(capabilities.features.map(({ id }) => id));
    const gated = (
      capability: string,
      transport: StepResult["transport"],
      expected: string,
      action: () => Promise<string>
    ) => step(continuation, featureSet, transport, expected, action, capability);

    const created = (await post(http, "/runs", {
      source: "agent-a",
      project: "conformance",
      agentName: "agent-a",
      agentModel: "synthetic-model",
      clientRunId: "agent-a-session",
      workKey: "internal:conformance/continuation",
      workflowId: "workflow-conformance",
      task: "synthetic continuation fixture"
    })) as { run: { id: string; version: number; lastLivenessAt: string } };
    const sourceRunId = created.run.id;
    await step(
      continuation,
      undefined,
      "http",
      "idempotent authoritative run creation",
      async () => {
        const replay = (await post(http, "/runs", {
          source: "agent-a",
          project: "conformance",
          clientRunId: "agent-a-session",
          workKey: "internal:conformance/continuation",
          workflowId: "workflow-conformance",
          task: "synthetic continuation fixture"
        })) as { run: { id: string } };
        ensure(replay.run.id === sourceRunId, "run retry created a duplicate");
        return "one run";
      }
    );

    await gated(
      "prepare_work",
      "direct_mcp",
      "fresh active conflict without start-new action",
      async () => {
        const prepared = (await callRuntrailTool(
          "journal_prepare_work",
          {
            project: "conformance",
            workKey: "internal:conformance/continuation",
            limit: 10
          },
          http
        )) as {
          conflicts: Array<{ id: string; conflictCode: string }>;
          recommendations: Array<{ actionCode: string }>;
        };
        ensure(
          prepared.conflicts.some(
            (item) => item.id === sourceRunId && item.conflictCode === "active_work_conflict"
          ),
          "fresh conflict missing"
        );
        ensure(
          !prepared.recommendations.some((item) => item.actionCode === "start_new_run"),
          "unsafe start-new recommendation"
        );
        ensure(
          prepared.recommendations.some((item) => item.actionCode === "inspect_active_conflict"),
          "inspect-conflict recommendation missing"
        );
        return "active_work_conflict";
      }
    );

    const decision = (await post(http, "/decisions", {
      project: "conformance",
      clientRecordId: "decision-1",
      title: "Synthetic direction",
      decision: "Continue through explicit handoff"
    })) as { decision: { id: string } };
    const currentDecision = (await post(http, "/decisions", {
      project: "conformance",
      clientRecordId: "decision-2",
      supersedesDecisionId: decision.decision.id,
      title: "Synthetic direction",
      decision: "Continue through the receiving run"
    })) as { decision: { id: string } };
    const loop = (await post(http, "/open-loops", {
      project: "conformance",
      clientRecordId: "loop-1",
      type: "blocked",
      title: "Synthetic blocker",
      source: "agent-a",
      sourceRunId
    })) as { openLoop: { id: string; version: number } };
    await post(http, "/verifications", verification(sourceRunId, "source-check", "verification-1"));
    const handoff = (await post(http, "/handoffs", {
      sourceRunId,
      clientRecordId: "handoff-1",
      fromSource: "agent-a",
      toSource: "agent-b",
      project: "conformance",
      summary: "Synthetic continuation"
    })) as { handoff: { id: string; version: number } };
    await step(continuation, undefined, "http", "idempotent append writes", async () => {
      const replay = (await post(http, "/decisions", {
        project: "conformance",
        clientRecordId: "decision-1",
        title: "Synthetic direction",
        decision: "Continue through explicit handoff"
      })) as { decision: { id: string } };
      ensure(replay.decision.id === decision.decision.id, "decision retry duplicated");
      return "one record per key";
    });

    await gated(
      "durable_local_outbox_replay",
      "local_client",
      "deterministic failure, durable replay, unchanged liveness",
      async () => {
        const stateEnv = { RUNTRAIL_STATE_DIR: path.join(directory, "state") } as NodeJS.ProcessEnv;
        const delayedPayload = {
          runId: sourceRunId,
          clientRecordId: "delayed-event",
          type: "progress",
          message: "synthetic delayed progress"
        };
        let failNextRequest = true;
        const faultInjectedClient: RuntrailHttpClient = {
          requestJson: async (requestPath, requestOptions) => {
            if (failNextRequest) {
              failNextRequest = false;
              throw new Error("synthetic transport unavailable");
            }
            return http.requestJson(requestPath, requestOptions);
          }
        };
        try {
          await request(faultInjectedClient, "/events", {
            method: "POST",
            body: delayedPayload
          });
          throw new Error("fault injection did not fail");
        } catch (error) {
          ensure(
            safeDiagnostic(error) === "synthetic transport unavailable",
            "unexpected injected failure"
          );
        }
        enqueueOutbox(
          {
            operation: "create_event",
            path: "/events",
            method: "POST",
            idempotencyKey: "delayed-event",
            payload: delayedPayload
          },
          stateEnv
        );
        const pending = readPendingOutbox(stateEnv).valid[0];
        ensure(pending, "outbox record missing");
        const before = (await http.requestJson(`/runs/${sourceRunId}`)) as {
          run: { lastLivenessAt: string };
        };
        await request(http, pending.record.path, {
          method: pending.record.method,
          body: pending.record.payload
        });
        await request(http, pending.record.path, {
          method: pending.record.method,
          body: pending.record.payload
        });
        removeOutboxRecord(pending.file);
        const after = (await http.requestJson(`/runs/${sourceRunId}`)) as {
          run: { lastLivenessAt: string };
        };
        const events = (await http.requestJson(`/events?runId=${sourceRunId}&limit=100`)) as {
          events: Array<{ clientRecordId?: string }>;
        };
        ensure(before.run.lastLivenessAt === after.run.lastLivenessAt, "replay revived liveness");
        ensure(
          events.events.filter((event) => event.clientRecordId === "delayed-event").length === 1,
          "replay did not preserve one authoritative event"
        );
        ensure(readPendingOutbox(stateEnv).valid.length === 0, "outbox did not drain");
        return "replayed once without liveness refresh";
      }
    );

    clock += 3_601_000;
    await gated(
      "server_authoritative_run_freshness",
      "http",
      "stale candidate without automatic mutation",
      async () => {
        const prepared = (await http.requestJson(
          "/agent/prepare-work?project=conformance&workKey=internal%3Aconformance%2Fcontinuation"
        )) as { conflicts: Array<{ id: string; freshness: { state: string } }> };
        ensure(
          prepared.conflicts.some(
            (item) => item.id === sourceRunId && item.freshness.state === "stale_candidate"
          ),
          "stale candidate missing"
        );
        const run = (await http.requestJson(`/runs/${sourceRunId}`)) as {
          run: { status: string };
        };
        ensure(run.run.status === "running", "stale run mutated automatically");
        return "stale_candidate";
      }
    );

    await step(
      continuation,
      undefined,
      "direct_mcp",
      "bounded continuation facts without raw data",
      async () => {
        const prepared = await callRuntrailTool(
          "journal_prepare_work",
          { project: "conformance", runId: sourceRunId, limit: 10 },
          http
        );
        const manifest = await callRuntrailTool(
          "journal_get_run_manifest",
          { runId: sourceRunId },
          http
        );
        const serialized = JSON.stringify({ prepared, manifest });
        ensure(serialized.includes("stale_candidate"), "stale continuation fact missing");
        ensure(serialized.includes("effectiveDecisions"), "effective decision section missing");
        ensure(serialized.includes("verification"), "verification evidence missing");
        ensure(!serialized.includes(token), "token leaked");
        return "bounded workflow, blocker, decision, evidence, and handoff facts";
      }
    );
    await gated(
      "incremental_cursors",
      "http",
      "opaque prepare-work cursor produces bounded incremental mode",
      async () => {
        const first = (await http.requestJson(
          `/agent/prepare-work?project=conformance&runId=${sourceRunId}&limit=10`
        )) as { cursor: string };
        const next = (await http.requestJson(
          `/agent/prepare-work?project=conformance&runId=${sourceRunId}&limit=10&cursor=${encodeURIComponent(first.cursor)}`
        )) as { mode: string };
        ensure(next.mode === "incremental", "incremental cursor mode missing");
        return "mode=incremental";
      }
    );
    await gated(
      "effective_decisions",
      "http",
      "current effective decision is projected",
      async () => {
        const prepared = (await http.requestJson(
          `/agent/prepare-work?project=conformance&runId=${sourceRunId}&limit=10`
        )) as { effectiveDecisions: Array<{ id: string }> };
        ensure(
          prepared.effectiveDecisions.some((item) => item.id === currentDecision.decision.id) &&
            !prepared.effectiveDecisions.some((item) => item.id === decision.decision.id),
          "current effective decision missing"
        );
        return "current decision present; superseded decision inactive";
      }
    );
    await gated(
      "typed_verification_evidence",
      "direct_mcp",
      "typed verification outcome and evidence assurance survive projection",
      async () => {
        const manifest = (await callRuntrailTool(
          "journal_get_run_manifest",
          { runId: sourceRunId },
          http
        )) as {
          manifest: {
            verifications: Array<{
              checkId: string;
              outcome: string;
              support: { type: string; exitCode?: number };
            }>;
          };
        };
        ensure(
          manifest.manifest.verifications.some(
            (item) =>
              item.checkId === "source-check" &&
              item.outcome === "passed" &&
              item.support.type === "exit_code" &&
              item.support.exitCode === 0
          ),
          "typed verification support missing"
        );
        return "passed with exit_code=0";
      }
    );
    await gated(
      "provenance_aware_readiness",
      "http",
      "readiness retains deterministic provenance and versioned references",
      async () => {
        const manifest = (await http.requestJson(`/runs/${sourceRunId}/manifest`)) as {
          manifest: {
            readiness: {
              status: string;
              findings: Array<{
                origin: string;
                sourceRefs: Array<{ version?: number }>;
              }>;
            };
          };
        };
        ensure(manifest.manifest.readiness.status === "blocked", "blocked readiness missing");
        ensure(
          manifest.manifest.readiness.findings.some(
            (finding) =>
              finding.origin === "deterministic_derivation" &&
              finding.sourceRefs.some((reference) => reference.version === loop.openLoop.version)
          ),
          "readiness provenance/version missing"
        );
        return "blocked deterministic derivation with versioned source";
      }
    );

    let targetRunId = "";
    await gated(
      "handoff_lifecycle",
      "http",
      "versioned acceptance and continuation linkage",
      async () => {
        const accepted = (await callRuntrailTool(
          "journal_accept_handoff",
          {
            id: handoff.handoff.id,
            expectedVersion: handoff.handoff.version,
            acceptedBy: "agent-b",
            run: {
              source: "agent-b",
              project: "conformance",
              agentName: "agent-b",
              agentModel: "synthetic-model",
              clientRunId: "agent-b-session",
              task: "continue synthetic work"
            }
          },
          http
        )) as {
          handoff: { version: number };
          targetRun: { id: string; continuedFromRunId: string };
        };
        targetRunId = accepted.targetRun.id;
        ensure(accepted.targetRun.continuedFromRunId === sourceRunId, "continuation link missing");
        const stale = await raw(http, `/handoffs/${handoff.handoff.id}/accept`, {
          method: "POST",
          body: { expectedVersion: 1, acceptedBy: "agent-b", targetRunId }
        });
        ensure(stale.status === 409, "second acceptance did not conflict");
        return "accepted once; stale retry=409";
      }
    );
    await gated(
      "workflow_relationships",
      "http",
      "receiving run preserves explicit workflow continuation",
      async () => {
        const workflow = (await http.requestJson(
          "/workflows/workflow-conformance/runs?project=conformance&limit=10"
        )) as { runs: Array<{ id: string; continuedFromRunId?: string }> };
        ensure(
          workflow.runs.some(
            (run) => run.id === targetRunId && run.continuedFromRunId === sourceRunId
          ),
          "workflow continuation relationship missing"
        );
        return "continuedFromRunId preserved";
      }
    );

    await gated(
      "optimistic_concurrency",
      "http",
      "stale mutation rejected with reread metadata",
      async () => {
        await request(http, `/open-loops/${loop.openLoop.id}`, {
          method: "PATCH",
          body: { expectedVersion: loop.openLoop.version, status: "resolved", resolution: "done" }
        });
        const stale = await raw(http, `/open-loops/${loop.openLoop.id}`, {
          method: "PATCH",
          body: { expectedVersion: loop.openLoop.version, status: "cancelled" }
        });
        const body = (await stale.json()) as { action?: string; current?: { version: number } };
        ensure(
          stale.status === 409 && body.action === "reread" && body.current?.version === 2,
          "unsafe stale mutation response"
        );
        return "409 action=reread";
      }
    );

    await post(http, "/verifications", verification(targetRunId, "target-check", "verification-2"));
    await post(http, `/runs/${targetRunId}/finish`, {
      expectedVersion: 1,
      status: "completed",
      summary: "synthetic completion"
    });
    await post(http, `/runs/${sourceRunId}/finish`, {
      expectedVersion: created.run.version,
      status: "completed",
      summary: "continued by agent-b"
    });
    await post(http, `/handoffs/${handoff.handoff.id}/complete`, { expectedVersion: 2 });

    let packet: WorkflowReviewPacket | undefined;
    await gated(
      "workflow_review_packet",
      "http",
      "ready versioned portable workflow packet",
      async () => {
        packet = (await http.requestJson(
          "/workflows/workflow-conformance/review-packet?project=conformance&limit=20"
        )) as WorkflowReviewPacket;
        ensure(packet.schemaVersion === "1", "packet schema mismatch");
        ensure(packet.readiness.status === "ready_for_review", "workflow not ready");
        ensure(
          packet.runs.some((run) => run.continuedFromRunId === sourceRunId),
          "continuation missing"
        );
        ensure(
          packet.verifications.every((item) => item.assurance === "evidence_backed"),
          "verification assurance lost"
        );
        ensure(
          packet.effectiveDecisions.some((item) => item.id === currentDecision.decision.id) &&
            !packet.effectiveDecisions.some((item) => item.id === decision.decision.id),
          "packet exposed a superseded decision as active"
        );
        ensure(
          packet.limitations.some((item) => item.code === "agent_identity_client_asserted"),
          "client-asserted agent provenance limitation missing"
        );
        ensure(
          Object.values(packet.truncation).every((section) => section.count <= section.limit),
          "packet section bounds missing"
        );
        ensure(
          packet.nextActions.every(
            (action) =>
              action.targetRefs.length > 0 &&
              action.targetRefs.every((target) => target.version !== undefined)
          ),
          "packet next action lacks a target or precondition"
        );
        if (options.induceFailure) throw new Error("induced advertised-capability mismatch");
        return "schema=1 readiness=ready_for_review";
      }
    );

    await step(
      continuation,
      undefined,
      "http",
      "restart persistence without duplicates",
      async () => {
        db?.close();
        db = new Database(path.join(directory, "runtrail.sqlite"));
        app = createApp({ config: isolatedConfig(directory, token), db });
        http = referenceClient(app, token);
        const reread = (await http.requestJson(
          "/workflows/workflow-conformance/review-packet?project=conformance&limit=20"
        )) as WorkflowReviewPacket;
        ensure(reread.workflow.runIds.length === 2, "restart changed authoritative runs");
        ensure(reread.readiness.status === packet?.readiness.status, "restart changed readiness");
        return "two durable runs; equivalent readiness";
      }
    );

    await step(
      continuation,
      undefined,
      "local_client",
      "redaction, bounds, and induced-failure diagnostics",
      async () => {
        const serialized = JSON.stringify(result());
        for (const forbidden of [token, "Bearer ", "private prompt", directory]) {
          ensure(!serialized.includes(forbidden), "sensitive value leaked");
        }
        return "secret-free bounded result";
      }
    );
  } finally {
    try {
      db?.close();
      restoreClock();
      rmSync(directory, { recursive: true, force: true });
    } catch {
      cleanupStatus = "failed";
    }
  }

  const final = result();
  if (options.output) {
    writeFileSync(options.output, `${JSON.stringify(final, null, 2)}\n`, { flag: "wx" });
  }
  printHuman(final);
  return final;
}

async function step(
  target: StepResult[],
  advertised: Set<string> | undefined,
  transport: StepResult["transport"],
  expected: string,
  action: () => Promise<string>,
  capability?: string
): Promise<void> {
  if (capability && capabilityGate(advertised ?? new Set(), capability) === "not_supported") {
    target.push({
      name: expected,
      capability,
      transport,
      expected,
      actual: "capability not advertised",
      result: "not_supported",
      diagnostic: "not_supported"
    });
    return;
  }
  try {
    const actual = await action();
    target.push({
      name: expected,
      capability,
      transport,
      expected,
      actual,
      result: "passed",
      diagnostic: "ok"
    });
  } catch (error) {
    target.push({
      name: expected,
      capability,
      transport,
      expected,
      actual: "mismatch",
      result: "failed",
      diagnostic: safeDiagnostic(error)
    });
  }
}

export function capabilityGate(
  advertised: ReadonlySet<string>,
  capability: string
): "run" | "not_supported" {
  return advertised.has(capability) ? "run" : "not_supported";
}

function isolatedConfig(directory: string, token: string): RuntrailConfig {
  return {
    server: { host: "127.0.0.1", port: 8787 },
    storage: {
      dbPath: path.join(directory, "runtrail.sqlite"),
      logDir: path.join(directory, "logs")
    },
    security: { authRequired: true, token },
    notifications: { discord: { enabled: false } },
    agentContext: { defaultLimit: 10, minImportance: 4, staleAfterSeconds: 3600 },
    url: "http://conformance.invalid"
  };
}

function referenceClient(app: Hono, token: string): RuntrailHttpClient {
  const adapter = {
    requestJson: async (requestPath: string, options: ClientRequestOptions = {}) =>
      request(
        {
          requestJson: async () => undefined
        },
        requestPath,
        options,
        app,
        token
      ),
    raw: async (requestPath: string, options: { method: string; body: Record<string, unknown> }) =>
      app.request(requestPath, {
        method: options.method,
        headers: {
          authorization: `Bearer ${token}`,
          "content-type": "application/json"
        },
        body: JSON.stringify(options.body)
      })
  };
  return adapter;
}

async function request(
  client: RuntrailHttpClient,
  requestPath: string,
  options: ClientRequestOptions = {},
  app?: Hono,
  token?: string
): Promise<unknown> {
  if (!app || !token) return client.requestJson(requestPath, options);
  const response = await app.request(requestPath, {
    method: options.method ?? "GET",
    headers: {
      authorization: `Bearer ${token}`,
      ...(options.body ? { "content-type": "application/json" } : {})
    },
    body: options.body ? JSON.stringify(options.body) : undefined
  });
  const body = (await response.json()) as unknown;
  if (!response.ok) throw new Error(`HTTP ${response.status}`);
  return body;
}

async function raw(
  client: RuntrailHttpClient,
  requestPath: string,
  options: { method: string; body: Record<string, unknown> }
): Promise<Response> {
  const adapter = client as RuntrailHttpClient & {
    raw?: (
      path: string,
      requestOptions: { method: string; body: Record<string, unknown> }
    ) => Promise<Response>;
  };
  if (!adapter.raw) throw new Error("raw response support unavailable");
  return adapter.raw(requestPath, options);
}

async function post(
  client: RuntrailHttpClient,
  requestPath: string,
  body: Record<string, unknown>
): Promise<unknown> {
  return request(client, requestPath, { method: "POST", body });
}

function verification(runId: string, checkId: string, clientRecordId: string) {
  return {
    runId,
    clientRecordId,
    checkId,
    kind: "test",
    outcome: "passed",
    name: "Synthetic check",
    support: { type: "exit_code", exitCode: 0 },
    completedAt: new Date("2026-07-25T18:00:00.000Z").toISOString()
  };
}

function ensure(value: unknown, message: string): asserts value {
  if (!value) throw new Error(message);
}

function safeDiagnostic(error: unknown): string {
  return error instanceof Error
    ? error.message.replace(/Bearer\s+\S+/gi, "Bearer [REDACTED]").slice(0, 160)
    : "bounded mismatch";
}

function printHuman(result: ConformanceResult): void {
  console.log(
    `Runtrail conformance: ${result.summary.passed} passed, ${result.summary.failed} failed, ${result.summary.notSupported} not supported; cleanup ${result.cleanup.status}`
  );
  for (const profile of result.profiles) {
    for (const item of profile.steps) {
      console.log(`${item.result.toUpperCase()} ${profile.name}/${item.name}: ${item.diagnostic}`);
    }
  }
}

function parseArgs(argv: string[]): ConformanceOptions {
  const options: ConformanceOptions = {};
  for (let index = 0; index < argv.length; index += 1) {
    const value = argv[index];
    if (value === "--induce-failure") options.induceFailure = true;
    else if (value === "--output") {
      const output = argv[index + 1];
      if (!output) throw new Error("--output requires a path");
      options.output = output;
      index += 1;
    } else {
      throw new Error(`Unsupported argument: ${value}`);
    }
  }
  return options;
}

if (import.meta.url === `file://${process.argv[1]}`) {
  runConformance(parseArgs(process.argv.slice(2)))
    .then((result) => {
      if (result.summary.failed > 0 || result.cleanup.status !== "passed") process.exitCode = 1;
    })
    .catch((error) => {
      console.error(safeDiagnostic(error));
      process.exitCode = 1;
    });
}
