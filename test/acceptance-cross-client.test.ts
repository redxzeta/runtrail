import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { randomBytes } from "node:crypto";
import {
  appendFileSync,
  existsSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync
} from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { serve } from "@hono/node-server";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import Database from "better-sqlite3";
import { describe, expect, it } from "vitest";
import { loadConfig } from "../src/config.js";
import { migrate } from "../src/db/migrate.js";
import { createApp } from "../src/index.js";
import { createHttpClient, createRuntrailMcpServer } from "../src/mcp/index.js";

// A report file is written only when explicitly selected by the caller.
// Never emit CLI logs, environment, storage paths or credentials in the public report.
describe("disposable cross-client acceptance", () => {
  it("captures real failure/fix/pass and harmless jobs; preserves outage exit exactly once", async () => {
    const fixture = await disposable();
    try {
      await fixture.cli(["doctor", "--json"]);
      await fixture.cli(["prepare-work", "--project", project, "--work-key", workKey]);
      const input = path.join(fixture.directory, "check.json");
      writeFileSync(input, JSON.stringify({ values: [1, 2, 3], expected: 7 }));
      const failed = await fixture.wrap("fixture check before correction", ["check", input]);
      expect(failed.code).toBe(1);
      expect(failed.json.exitCode).toBe(1);
      writeFileSync(input, JSON.stringify({ values: [1, 2, 3], expected: 6 }));
      const passed = await fixture.wrap("fixture check after correction", ["check", input]);
      expect(passed.code).toBe(0);
      expect(passed.json.capture).toBe("stored");
      const jobs = path.join(fixture.directory, "jobs.json");
      writeFileSync(jobs, JSON.stringify({ disposable: true, jobs: [{ result: "ok" }] }));
      const job = await fixture.wrap("homelab fixture report", ["homelab", jobs]);
      expect(job.code).toBe(0);
      const jobResult = JSON.parse(job.stdout.split("\n")[0] ?? "{}");
      expect(
        (
          await fixture.cli([
            "event",
            "create",
            "--run-id",
            job.json.runId,
            "--type",
            "progress",
            "--importance",
            "5",
            "--message",
            "Disposable homelab fixture: 1 job ok; no maintenance performed",
            "--data-json",
            JSON.stringify(jobResult)
          ])
        ).code
      ).toBe(0);
      const experiment = await fixture.wrap("deterministic toy experiment", ["experiment"]);
      expect(experiment.code).toBe(0);
      const metrics = JSON.parse(experiment.stdout.split("\n")[0] ?? "{}").metrics;
      expect(metrics.map((item: { correct: number }) => item.correct)).toEqual([5, 7, 5]);
      expect(
        (
          await fixture.cli([
            "event",
            "create",
            "--run-id",
            experiment.json.runId,
            "--type",
            "progress",
            "--importance",
            "5",
            "--message",
            `Toy threshold correct counts: ${metrics.map((item: { correct: number }) => item.correct).join(", ")} of 7; not production efficacy`,
            "--data-json",
            JSON.stringify({ metrics })
          ])
        ).code
      ).toBe(0);
      const packet = await fixture.cli([
        "workflow",
        "packet",
        "--project",
        project,
        "--workflow-id",
        workflowId
      ]);
      const checks = packet.json.verifications;
      expect(checks.map((item: { outcome: string }) => item.outcome)).toContain("failed");
      expect(checks.map((item: { outcome: string }) => item.outcome)).toContain("passed");
      expect(JSON.stringify(checks)).toContain("unknown");
      await fixture.stop();
      const counter = path.join(fixture.directory, "once");
      const outage = await fixture.cli([
        "run",
        "--source",
        "developer",
        "--project",
        project,
        "--task",
        "outage fixture",
        "--",
        process.execPath,
        "-e",
        "require('node:fs').appendFileSync(process.argv[1], 'once\\n');process.exit(7)",
        counter
      ]);
      expect(outage.code).toBe(7);
      expect(outage.json).toMatchObject({ runId: null, capture: "degraded", exitCode: 7 });
      expect(readFileSync(counter, "utf8")).toBe("once\n");
      report("commands", {
        failedExit: failed.code,
        correctedExit: passed.code,
        outageExit: 7,
        outageExecutions: 1,
        remoteOutageRunId: null,
        toyMetrics: metrics,
        revisionApplicability: "unknown",
        nativeConfiguredClient: "NOT_RUN"
      });
    } finally {
      await fixture.close();
    }
  }, 90_000);

  it("exports actual bounded T3 metadata, imports once, and continues from a second MCP client", async () => {
    const fixture = await disposable();
    const client = new Client({ name: "acceptance-second-client", version: "1" });
    const mcp = createRuntrailMcpServer(
      createHttpClient({
        url: fixture.url,
        security: { authRequired: true, token: fixture.token }
      })
    );
    try {
      const sourceFile = "examples/acceptance/t3-source.json";
      const workFile = "examples/acceptance/t3-work.json";
      const source = JSON.parse(readFileSync(sourceFile, "utf8"));
      const work = JSON.parse(readFileSync(workFile, "utf8"));
      // Refuse ambiguity and transcript/extra fields before invoking the importer.
      const badSource = path.join(fixture.directory, "bad-source.json");
      for (const invalid of [
        { ...source, recentRuns: [] },
        { ...source, recentRuns: [...source.recentRuns, ...source.recentRuns] },
        { ...source, items: [{ text: "raw timeline forbidden" }] },
        { ...source, recentRuns: [{ ...source.recentRuns[0], status: "running" }] },
        { ...source, recentRuns: [{ ...source.recentRuns[0], completedAt: null }] },
        { ...source, thread: { threadId: "mcp:aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa" } },
        {
          ...source,
          recentRuns: [
            { ...source.recentRuns[0], runId: `${source.recentRuns[0].runId}:ordinal:garbage` }
          ]
        },
        {
          thread: { threadId: `mcp:${"-".repeat(36)}` },
          recentRuns: [
            { ...source.recentRuns[0], runId: `run:thread:mcp%3A${"-".repeat(36)}:ordinal:2` }
          ]
        }
      ]) {
        writeFileSync(badSource, JSON.stringify(invalid));
        const rejected = await execute(
          process.execPath,
          ["examples/acceptance/t3-export.mjs", "--source", badSource, "--summary", workFile],
          fixture.env
        );
        expect(rejected.code).toBe(1);
        expect(rejected.stdout).toBe("");
      }
      const exported = await execute(
        process.execPath,
        ["examples/acceptance/t3-export.mjs", "--source", sourceFile, "--summary", workFile],
        fixture.env
      );
      expect(exported.code).toBe(0);
      expect(fixture.requests).toEqual([]); // helper reuses dry-run, not a network validator
      const envelope = JSON.parse(exported.stdout);
      expect(envelope.source).toMatchObject({
        threadId: source.thread.threadId,
        runId: source.recentRuns[0].runId,
        reportedStatus: source.recentRuns[0].status
      });
      expect(Date.parse(envelope.source.observedAt)).toBeGreaterThan(
        Date.parse(source.recentRuns[0].completedAt)
      );
      const raw = exported.stdout; // preserve this observation, do not re-export on retry
      const captureStart = fixture.requests.length;
      const imported = await fixture.cli(["import-work", "--file", "-"], raw);
      const captureRequests = fixture.requests.length - captureStart;
      expect(imported.code).toBe(0);
      expect(imported.json.status).toBe("complete");
      expect(captureRequests).toBe(3);
      const ids = imported.json.confirmed as { stage: string; id: string }[];
      const runId = ids.find((item) => item.stage === "run")?.id;
      const handoffId = ids.find((item) => item.stage === "handoff")?.id;
      assert(runId && handoffId);
      const duplicate = await fixture.cli(["import-work", "--file", "-"], raw);
      expect(duplicate.json.confirmed).toEqual(ids);
      expect(fixture.count("agent_runs")).toBe(1);

      const readStart = fixture.requests.length;
      const brief = await fixture.cli(["brief", "--project", project, "--run-id", runId, "--json"]);
      expect(brief.code).toBe(0);
      expect(brief.json.evidenceApplicability).toBe("unknown");
      expect(brief.json.selectedRun.summary).toContain(work.summary);
      expect(brief.json.pendingHandoffs[0].nextAction).toBe(work.nextAction);
      expect(fixture.requests.slice(readStart).sort()).toEqual([
        "GET /agent/context",
        "GET /agent/prepare-work"
      ]);
      const prefix = "[Client-reported; unverified] ";
      const factProjection = {
        task: work.task,
        summary: work.summary,
        nextAction: work.nextAction
      };
      const briefProjection = {
        task: brief.json.selectedRun.task,
        summary: brief.json.selectedRun.summary.slice(prefix.length),
        nextAction: brief.json.pendingHandoffs[0].nextAction
      };
      expect(briefProjection).toEqual(factProjection);

      const [left, right] = InMemoryTransport.createLinkedPair();
      await mcp.connect(right);
      await client.connect(left);
      const mcpReadStart = fixture.requests.length;
      let mcpCalls = 0;
      let mcpResultBytes = 0;
      const call = async (name: string, args: Record<string, unknown>) => {
        const result = await client.callTool({ name, arguments: args });
        mcpCalls += 1;
        mcpResultBytes += Buffer.byteLength(JSON.stringify(result));
        expect(result.isError).not.toBe(true);
        const block = (result.content as { type: string; text?: string }[]).find(
          (item) => item.type === "text"
        );
        return JSON.parse(block?.text ?? "{}");
      };
      const prepared = await call("journal_prepare_work", { project, workKey, runId, limit: 5 });
      expect(prepared.pendingHandoffs.some((item: { id: string }) => item.id === handoffId)).toBe(
        true
      );
      const pending = await call("journal_list_pending_handoffs", {
        project,
        toSource: "acceptance-mcp"
      });
      const handoff = pending.handoffs.find((item: { id: string }) => item.id === handoffId);
      expect(handoff.nextAction).toBe(work.nextAction);
      const manifest = await call("journal_get_run_manifest", { runId });
      expect(manifest.manifest.verifications).toEqual([]); // completed source != verified checks
      const receiving = await call("journal_start_run", {
        source: "acceptance-mcp",
        project,
        workKey,
        workflowId,
        continuedFromRunId: runId,
        task: "Review imported acceptance handoff"
      });
      const accepted = await call("journal_accept_handoff", {
        id: handoffId,
        expectedVersion: handoff.version,
        acceptedBy: "acceptance-mcp",
        targetRunId: receiving.run.id
      });
      expect(accepted.handoff.sourceRunId).toBe(runId);
      expect(accepted.handoff.targetRunId).toBe(receiving.run.id);
      const mcpRequests = fixture.requests.length - mcpReadStart;
      expect(mcpCalls).toBe(5);
      expect(mcpRequests).toBe(5);
      // Explicitly old liveness in disposable SQLite; no elapsed-time or dead-process claim.
      fixture.db
        .prepare("UPDATE agent_runs SET last_liveness_at = ? WHERE id = ?")
        .run("2020-01-01T00:00:00.000Z", receiving.run.id);
      const stale = await fixture.cli([
        "brief",
        "--project",
        project,
        "--run-id",
        receiving.run.id,
        "--json"
      ]);
      expect(stale.json.selectedRun.freshness.state).toBe("stale_candidate");
      expect(stale.json.evidenceApplicability).toBe("unknown");
      const publicBrief = JSON.stringify(brief.json);
      expect(publicBrief).not.toContain(fixture.token);
      expect(publicBrief).not.toContain(fixture.directory);
      report("live-source-cli-and-protocol-continuation", {
        source: envelope.source,
        confirmedStages: ids.map((item) => item.stage),
        duplicateSameIds: true,
        importedVerifications: manifest.manifest.verifications.length,
        staleFixture: "stale_candidate",
        identicalFactBytes: Buffer.byteLength(JSON.stringify(factProjection)),
        briefIdenticalFactBytes: Buffer.byteLength(JSON.stringify(briefProjection)),
        envelopeBytes: Buffer.byteLength(raw),
        sourceProjectionBytes: Buffer.byteLength(JSON.stringify(source)),
        authoredWorkBytes: Buffer.byteLength(JSON.stringify(work)),
        briefOutputBytes: Buffer.byteLength(brief.stdout),
        briefManualCommands: 1,
        briefHttpRequests: fixture.requests.slice(readStart, readStart + 2).length,
        firstCaptureHttpRequests: captureRequests,
        captureResultBytes: Buffer.byteLength(imported.stdout),
        mcpCalls,
        mcpHttpRequests: mcpRequests,
        mcpSerializedResultBytes: mcpResultBytes,
        happyPathRuntrailHttpRequests: captureRequests + 2 + mcpRequests,
        captureBriefMcpResultBytes:
          Buffer.byteLength(imported.stdout) + Buffer.byteLength(brief.stdout) + mcpResultBytes,
        helperValidationHttpRequests: captureStart,
        nativeConfiguredClient: "NOT_RUN"
      });
    } finally {
      await client.close();
      await mcp.close();
      await fixture.close();
    }
  }, 90_000);

  it("rejects unsafe input before requests and preserves scoped identity after uncertain partial writes", async () => {
    const fixture = await disposable();
    try {
      const source = JSON.parse(readFileSync("examples/acceptance/t3-source.json", "utf8"));
      const work = JSON.parse(readFileSync("examples/acceptance/t3-work.json", "utf8"));
      const envelope = {
        schemaVersion: "1",
        source: {
          kind: "generic",
          system: "acceptance",
          threadId: source.thread.threadId,
          runId: source.recentRuns[0].runId,
          ref: "urn:acceptance:source",
          observedAt: new Date().toISOString(),
          reportedStatus: "completed"
        },
        ...work
      };
      for (const invalid of [
        { ...envelope, transcript: "forbidden unknown field" },
        { ...envelope, summary: "db_password=acceptance-dummy-value" },
        { ...envelope, summary: "assistant: transcript material" },
        { ...envelope, summary: "private location /private/acceptance/example" },
        { ...envelope, summary: fixture.token },
        {
          ...envelope,
          evidence: [
            {
              kind: "artifact",
              ref: "https://example.com/result?key=value",
              summary: "credential query rejected",
              observedAt: envelope.source.observedAt,
              provenance: "client_reported"
            }
          ]
        }
      ]) {
        const result = await fixture.cli(["import-work", "--file", "-"], JSON.stringify(invalid));
        expect(result.code).toBe(1);
        expect(result.json.status).toBe("invalid");
        expect(result.stdout).not.toContain(fixture.token);
      }
      const oversized = await fixture.cli(["import-work", "--file", "-"], " ".repeat(16385));
      expect(oversized.code).toBe(1);
      const raw = JSON.stringify(envelope);
      expect(
        (await fixture.cli(["import-work", "--file", "-", "--dry-run"], raw)).json.status
      ).toBe("dry_run");
      expect(fixture.requests).toEqual([]);
      expect(fixture.count("agent_runs")).toBe(0);

      // Commit summary, lose its acknowledgement. The CLI must not invent its ID.
      fixture.inject("/events", true);
      const partial = await fixture.cli(["import-work", "--file", "-"], raw);
      expect(partial.json).toMatchObject({
        status: "partial",
        resume: "retry_identical_envelope",
        error: { stage: "summary", deliveryUnknown: true }
      });
      expect(partial.json.confirmed.map((item: { stage: string }) => item.stage)).toEqual(["run"]);
      const countAfterPartial = fixture.requests.length;
      const conflict = await fixture.cli(
        ["import-work", "--file", "-"],
        JSON.stringify({ ...envelope, summary: "Changed same identity" })
      );
      expect(conflict.json.status).toBe("conflict");
      expect(fixture.requests.slice(countAfterPartial)).toEqual(["POST /runs"]);
      const recovered = await fixture.cli(["import-work", "--file", "-"], raw);
      expect(recovered.json.status).toBe("complete");
      const beforeDuplicate = fixture.count("agent_events");
      const reordered = JSON.stringify(Object.fromEntries(Object.entries(envelope).reverse()));
      const duplicate = await fixture.cli(["import-work", "--file", "-"], reordered);
      expect(duplicate.json.confirmed).toEqual(recovered.json.confirmed);
      expect(fixture.count("agent_events")).toBe(beforeDuplicate);
      expect(fixture.count("handoffs")).toBe(1);

      for (const changed of [
        { ...envelope, project: "different-acceptance-project" },
        { ...envelope, source: { ...envelope.source, system: "other-client" } }
      ])
        expect(
          (await fixture.cli(["import-work", "--file", "-"], JSON.stringify(changed))).json.status
        ).toBe("complete");
      expect(fixture.count("agent_runs")).toBe(3);
      // Untrusted instructions and URLs stay data, even when syntactically allowed.
      const untrusted = {
        ...envelope,
        source: { ...envelope.source, runId: "untrusted-text" },
        nextAction: "touch acceptance-should-not-exist",
        evidence: [
          {
            kind: "artifact",
            ref: "https://example.com/never-fetch-this",
            summary: "Reference only",
            observedAt: envelope.source.observedAt,
            provenance: "client_reported"
          }
        ]
      };
      expect(
        (await fixture.cli(["import-work", "--file", "-"], JSON.stringify(untrusted))).json.status
      ).toBe("complete");
      expect(existsSync("acceptance-should-not-exist")).toBe(false);
      report("input-and-retry", {
        invalidInputs: 7,
        validationHttpRequests: 0,
        uncertainSummaryConfirmedIds: partial.json.confirmed.length,
        recoveredIdentical: true,
        conflictingIdentity: "rejected_before_follow_on_write",
        crossProjectAndSource: "distinct",
        importedTextExecution: false,
        remoteReferenceFetch: "no fetch path in source; reference retained as data"
      });
    } finally {
      await fixture.close();
    }
  }, 90_000);
});

const project = "runtrail-acceptance";
const workKey = "github:redxzeta/runtrail#207";
const workflowId = "issue-207-acceptance";

function report(scenario: string, observations: unknown) {
  const row = JSON.stringify({ scenario, observedAt: new Date().toISOString(), observations });
  if (process.env.RUNTRAIL_ACCEPTANCE_REPORT)
    appendFileSync(process.env.RUNTRAIL_ACCEPTANCE_REPORT, `${row}\n`, { mode: 0o600 });
  console.log(row);
}

async function disposable() {
  const directory = mkdtempSync(path.join(tmpdir(), "runtrail-acceptance-"));
  const token = randomBytes(32).toString("hex");
  const config = loadConfig();
  config.security = { authRequired: true, token };
  config.storage = {
    dbPath: path.join(directory, "ledger.sqlite"),
    logDir: path.join(directory, "logs")
  };
  config.notifications.discord.enabled = false;
  const db = new Database(config.storage.dbPath);
  migrate(db);
  const app = createApp({ config, db });
  const requests: string[] = [];
  let fault: { endpoint: string; after: boolean } | undefined;
  const server = serve({
    hostname: "127.0.0.1",
    port: 0,
    fetch: async (request) => {
      const endpoint = new URL(request.url).pathname;
      requests.push(`${request.method} ${endpoint}`);
      if (request.method === "POST" && fault?.endpoint === endpoint) {
        const current = fault;
        fault = undefined;
        if (current.after) await app.fetch(request);
        return new Response(JSON.stringify({ error: "Injected disposable delivery failure" }), {
          status: 503,
          headers: { "content-type": "application/json" }
        });
      }
      return app.fetch(request);
    }
  });
  if (!server.listening) await new Promise<void>((resolve) => server.once("listening", resolve));
  const address = server.address();
  assert(address && typeof address !== "string");
  const url = `http://127.0.0.1:${address.port}`;
  const env = {
    ...process.env,
    RUNTRAIL_URL: url,
    RUNTRAIL_TOKEN: token,
    RUNTRAIL_DB_PATH: config.storage.dbPath,
    RUNTRAIL_LOG_DIR: config.storage.logDir,
    RUNTRAIL_STATE_DIR: path.join(directory, "state"),
    RUNTRAIL_REQUEST_TIMEOUT_MS: "500"
  };
  let stopped = false;
  const stop = async () => {
    if (stopped) return;
    stopped = true;
    await new Promise<void>((resolve, reject) =>
      server.close((error) => (error ? reject(error) : resolve()))
    );
  };
  const cli = async (args: string[], input?: string) => {
    const result = await command(["--silent", "cli", ...args], env, input);
    const start = result.stdout.lastIndexOf("\n{\n");
    let json = JSON.parse("{}");
    try {
      json = JSON.parse(result.stdout.slice(start < 0 ? 0 : start + 1));
    } catch {
      /* checked by callers */
    }
    return { ...result, json };
  };
  return {
    directory,
    db,
    requests,
    url,
    token,
    env,
    count(table: "agent_runs" | "agent_events" | "handoffs") {
      return (db.prepare(`SELECT count(*) AS count FROM ${table}`).get() as { count: number })
        .count;
    },
    cli,
    stop,
    inject(endpoint: string, after: boolean) {
      fault = { endpoint, after };
    },
    wrap(task: string, args: string[]) {
      return cli([
        "run",
        "--source",
        "developer",
        "--project",
        project,
        "--task",
        task,
        "--workflow-id",
        workflowId,
        "--work-key",
        workKey,
        "--",
        process.execPath,
        "examples/acceptance/fixture-job.mjs",
        ...args
      ]);
    },
    async close() {
      await stop();
      db.close();
      rmSync(directory, { recursive: true, force: true });
    }
  };
}

async function command(args: string[], env: NodeJS.ProcessEnv, input?: string) {
  return execute("pnpm", args, env, input);
}

async function execute(executable: string, args: string[], env: NodeJS.ProcessEnv, input?: string) {
  return await new Promise<{ code: number | null; stdout: string; stderr: string }>(
    (resolve, reject) => {
      const child = spawn(executable, args, { env, stdio: ["pipe", "pipe", "pipe"] });
      let stdout = "";
      let stderr = "";
      child.stdout.on("data", (chunk) => {
        stdout += chunk;
      });
      child.stderr.on("data", (chunk) => {
        stderr += chunk;
      });
      child.on("error", reject);
      child.on("close", (code) => resolve({ code, stdout, stderr }));
      child.stdin.end(input);
    }
  );
}
