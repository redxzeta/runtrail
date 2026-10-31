import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { randomBytes } from "node:crypto";
import { existsSync, mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { serve } from "@hono/node-server";
import Database from "better-sqlite3";
import { describe, expect, it } from "vitest";
import type { BriefReport } from "../src/cli/brief.js";
import { loadConfig } from "../src/config.js";
import { migrate } from "../src/db/migrate.js";
import { createApp } from "../src/index.js";
import type { WorkImportResult } from "../src/integrations/workImportDelivery.js";

const threadId = "mcp:aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa";
const runId = (ordinal: number) => `run:thread:${encodeURIComponent(threadId)}:ordinal:${ordinal}`;
const metadata = (ordinal = 1) => ({
  thread: { threadId },
  recentRuns: [
    { runId: runId(ordinal), status: "completed", completedAt: "2026-10-28T04:14:22.162Z" }
  ]
});
const workKey = "github:redxzeta/runtrail#215";

describe("explicit workflow capture and fresh CLI continuation", () => {
  it("saves before authenticated delivery, keeps authored context and provenance in a read-only fresh process", async () => {
    const f = await disposable();
    try {
      const captured = await f.cli(f.capture());
      expect(captured.code).toBe(0);
      expect(captured.json).toMatchObject({ status: "complete", envelopeSaved: true });
      expect(f.requests).toEqual(["POST /runs", "POST /events", "POST /handoffs"]);
      const raw = readFileSync(f.saved, "utf8");
      const envelope = JSON.parse(raw);
      expect(envelope).toMatchObject({
        schemaVersion: "1",
        project: "workflow-test",
        workflowId: workKey,
        workKey,
        source: { kind: "t3", threadId, runId: runId(1), reportedStatus: "completed" },
        nextAction: "Review the exact diff; obtain independent check evidence before acting."
      });
      expect(envelope.source.ref).toBe(`t3-thread://v1/${threadId}`);
      expect(envelope.evidence[0].summary).toContain("2026-10-28T04:14:22.162Z");
      expect(envelope.evidence[1]).toMatchObject({ kind: "revision", outcome: "unknown" });
      expect(envelope.evidence[1].summary).toContain("No source/check linkage");
      if (process.platform !== "win32") expect(statSync(f.saved).mode & 0o777).toBe(0o600);
      const before = f.counts();
      f.requests.length = 0;
      const briefArgs = ["brief", "--project", "workflow-test", "--work-key", workKey];
      const basic = await f.cli([...briefArgs, "--json"]);
      expect(basic.code).toBe(0);
      expect(f.requests.sort()).toEqual(["GET /agent/context", "GET /agent/prepare-work"]);
      expect(basic.json.pendingHandoffs[0]).not.toHaveProperty("clientReport");
      f.requests.length = 0;
      const read = await f.cli([...briefArgs, "--import-provenance", "--json"]);
      expect(read.code).toBe(0);
      expect(f.requests.sort()).toEqual([
        "GET /agent/context",
        "GET /agent/prepare-work",
        "GET /handoffs"
      ]);
      expect(read.json.evidenceApplicability).toBe("unknown");
      expect(read.json.pendingHandoffs[0]).toMatchObject({
        status: "pending",
        clientReport: {
          status: "available",
          report: {
            assurance: "unverified",
            evidenceApplicability: "unknown",
            source: envelope.source,
            summary: envelope.summary,
            nextAction: envelope.nextAction,
            evidence: expect.arrayContaining([
              expect.objectContaining({ ref: envelope.evidence[1].ref, outcome: "unknown" })
            ])
          }
        }
      });
      const markdown = await f.cli([...briefArgs, "--import-provenance"]);
      expect(markdown.stdout).toContain("Blockers\\: review pending");
      expect(markdown.stdout).toContain("unverified");
      expect(markdown.stdout).toContain("not execution completion");
      expect(markdown.stdout).toContain("t3\\-thread");
      expect(markdown.stdout).toContain(envelope.evidence[1].ref.replaceAll(":", "\\:"));
      expect(f.counts()).toEqual(before); // no receiving run, accept or verification write
      expect(readFileSync(f.saved, "utf8")).toBe(raw);
      expect(JSON.stringify(read.json)).not.toContain(f.directory);
      expect(JSON.stringify(read.json)).not.toContain(f.token);
    } finally {
      await f.close();
    }
  }, 60_000);

  it.each(["A", "B"])(
    "replays frozen #221 Case %s with complete safe summary fidelity",
    async (name) => {
      const facts = JSON.parse(readFileSync(`docs/results/218/${name}.json`, "utf8"));
      const summary = facts.summary.replace(/\s+/g, " ").trim();
      const f = await disposable();
      try {
        writeFileSync(
          f.source,
          JSON.stringify({
            thread: facts.source.thread,
            recentRuns: facts.source.recentRuns
          }),
          { mode: 0o600 }
        );
        const args = f.capture();
        for (const [flag, value] of [
          ["--task", facts.task],
          ["--summary", summary],
          ["--next-action", facts.nextAction]
        ])
          args[args.indexOf(flag) + 1] = value;
        args.push("--evidence-ref", facts.reference);
        const captured = await f.cli(args);
        expect(captured.code).toBe(0);
        expect(f.requests).toEqual(["POST /runs", "POST /events", "POST /handoffs"]);
        const raw = readFileSync(f.saved, "utf8");
        const envelope = JSON.parse(raw);
        expect(envelope.summary).toBe(summary);
        expect(envelope.source.threadId).toBe(facts.source.thread.threadId);
        expect(envelope.source.runId).toBe(facts.source.recentRuns[0].runId);
        expect(envelope.evidence[0].summary).toContain(facts.source.recentRuns[0].completedAt);
        expect(statSync(f.directory).mode & 0o777).toBe(0o700);
        expect(statSync(f.saved).mode & 0o777).toBe(0o600);
        const counts = f.counts();
        const retry = await f.cli(["workflow", "capture", "--retry", f.saved]);
        expect(retry.json.confirmed).toEqual(captured.json.confirmed);
        expect(f.counts()).toEqual(counts);
        const deliveryRequests = [...f.requests];
        expect(deliveryRequests.filter((request) => request.startsWith("POST "))).toHaveLength(6);
        const before = f.rows();
        f.requests.length = 0;
        const briefArgs = [
          "brief",
          "--project",
          "workflow-test",
          "--work-key",
          workKey,
          "--import-provenance"
        ];
        const json = await f.cli([...briefArgs, "--json"]);
        const markdown = await f.cli(briefArgs);
        expect(json.code).toBe(0);
        expect(markdown.code).toBe(0);
        const report = json.json.pendingHandoffs[0].clientReport?.report;
        expect(report).toMatchObject({
          source: envelope.source,
          task: facts.task,
          summary,
          nextAction: facts.nextAction,
          assurance: "unverified",
          evidenceApplicability: "unknown"
        });
        const escaped = summary
          .replace(/[\\`*_{}[\]()#+.!|:~=-]/g, "\\$&")
          .replace(/&/g, "&amp;")
          .replace(/</g, "&lt;")
          .replace(/>/g, "&gt;");
        expect(markdown.stdout).toContain(escaped);
        expect(summary).toContain("Blocker");
        expect(summary).toContain("NOT verified");
        expect(json.json.textClipped).toBe(true); // ordinary short projections remain bounded
        expect(f.requests).toEqual([
          "GET /agent/prepare-work",
          "GET /agent/context",
          "GET /handoffs",
          "GET /agent/prepare-work",
          "GET /agent/context",
          "GET /handoffs"
        ]);
        expect(f.rows()).toEqual(before);
        expect(readFileSync(f.saved, "utf8")).toBe(raw);
        for (const output of [json.stdout, markdown.stdout]) {
          expect(output).not.toContain(f.directory);
          expect(output).not.toContain(f.token);
        }
        console.info(
          JSON.stringify({
            case: name,
            confirmed: captured.json.confirmed,
            counts,
            summaryCharacters: summary.length,
            exactSafeSummary: true,
            markdownEscapedSummary: true,
            requests: {
              post: deliveryRequests.filter((request) => request.startsWith("POST ")).length,
              get: f.requests.filter((request) => request.startsWith("GET ")).length
            },
            cliInvocations: f.invocations(),
            immutableEnvelope: true,
            readOnlyRows: true
          })
        );
      } finally {
        await f.close();
      }
    },
    60_000
  );

  it("rejects ambiguity, running/unsafe/raw inputs and overwrite; dry-run makes zero requests or files", async () => {
    const f = await disposable();
    try {
      for (const invalid of [
        { ...metadata(), items: [{ text: "forbidden raw timeline" }] },
        { ...metadata(), thread: { threadId, worktreePath: "private" } },
        { ...metadata(), recentRuns: [metadata().recentRuns[0], metadata(2).recentRuns[0]] },
        { ...metadata(), recentRuns: [metadata().recentRuns[0], metadata().recentRuns[0]] },
        { ...metadata(), recentRuns: [{ runId: runId(1), status: "running", completedAt: null }] },
        { ...metadata(), recentRuns: [{ ...metadata().recentRuns[0], completedAt: null }] },
        { ...metadata(), thread: { threadId: "mcp:bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb" } }
      ]) {
        writeFileSync(f.source, JSON.stringify(invalid));
        const result = await f.cli([...f.capture(), "--dry-run"]);
        expect(result.code).toBe(1);
        expect(result.json.status).toBe("invalid");
        expect(existsSync(f.saved)).toBe(false);
      }
      writeFileSync(
        f.source,
        JSON.stringify({
          ...metadata(),
          recentRuns: [
            metadata().recentRuns[0],
            { runId: runId(2), status: "running", completedAt: null }
          ]
        })
      );
      const stale = await f.cli([...f.capture(), "--source-run", runId(3), "--dry-run"]);
      expect(stale.json.status).toBe("invalid");
      expect(existsSync(f.saved)).toBe(false);
      expect(f.requests).toEqual([]);
      const nonterminal = await f.cli([...f.capture(), "--source-run", runId(2), "--dry-run"]);
      expect(nonterminal.json.status).toBe("invalid");
      const dry = await f.cli([...f.capture(), "--source-run", runId(1), "--dry-run"]);
      expect(dry.json.status).toBe("dry_run");
      expect(existsSync(f.saved)).toBe(false);
      writeFileSync(f.source, JSON.stringify(metadata()));
      for (const summary of [
        "db_password=do-not-store-this",
        f.token,
        "/home/private/checkout",
        "`/0600`",
        '"/secret/file"',
        "`C:\\private\\file`",
        "`\\\\server\\share\\file`",
        "assistant: transcript",
        "x".repeat(1801)
      ]) {
        const args = f.capture();
        args[args.indexOf("--summary") + 1] = summary;
        const result = await f.cli(args);
        expect(result.json.status).toBe("invalid");
        expect(result.stdout).not.toContain(summary);
      }
      writeFileSync(f.source, "x".repeat(16385));
      expect((await f.cli(f.capture())).code).toBe(1);
      expect(f.requests).toEqual([]);
      expect(existsSync(f.saved)).toBe(false);
      writeFileSync(f.source, JSON.stringify(metadata()));
      writeFileSync(f.saved, "original", { mode: 0o600 });
      expect((await f.cli(f.capture())).code).toBe(1);
      expect(readFileSync(f.saved, "utf8")).toBe("original");
      expect(f.requests).toEqual([]);
    } finally {
      await f.close();
    }
  }, 90_000);

  it("recovers online outage and every committed lost response using identical private bytes; conflicts stop before follow-on writes", async () => {
    const f = await disposable();
    try {
      // Outage before storage is distinct from a lost response after commit.
      f.fault("/runs", false);
      const outage = await f.cli(f.capture());
      expect(outage.json).toMatchObject({
        status: "failed",
        envelopeSaved: true,
        confirmed: [],
        resume: "retry_identical_envelope"
      });
      const raw = readFileSync(f.saved, "utf8");
      expect((await f.cli(["workflow", "capture", "--retry", f.saved])).json.status).toBe(
        "complete"
      );
      expect(readFileSync(f.saved, "utf8")).toBe(raw);
      for (const [index, endpoint] of ["/runs", "/events", "/handoffs"].entries()) {
        writeFileSync(f.source, JSON.stringify(metadata(index + 2)));
        const saved = path.join(f.directory, `retry-${index}.json`);
        f.fault(endpoint, true);
        const partial = await f.cli(f.capture(saved));
        expect(partial.code).toBe(1);
        expect(partial.json.error?.deliveryUnknown).toBe(true);
        expect(partial.json.confirmed).toHaveLength(index);
        const original = readFileSync(saved, "utf8");
        const retry = await f.cli(["workflow", "capture", "--retry", saved]);
        expect(retry.json.status).toBe("complete");
        const rows = f.counts();
        const reordered = path.join(f.directory, `reordered-${index}.json`);
        writeFileSync(
          reordered,
          JSON.stringify(Object.fromEntries(Object.entries(JSON.parse(original)).reverse())),
          { mode: 0o600 }
        );
        const repeat = await f.cli(["workflow", "capture", "--retry", reordered]);
        expect(repeat.json.confirmed).toEqual(retry.json.confirmed);
        expect(f.counts()).toEqual(rows);
        expect(readFileSync(saved, "utf8")).toBe(original);
      }
      const changed = path.join(f.directory, "changed.json");
      writeFileSync(
        changed,
        JSON.stringify({ ...JSON.parse(raw), summary: "Changed authored payload" }),
        { mode: 0o600 }
      );
      f.requests.length = 0;
      const conflict = await f.cli(["workflow", "capture", "--retry", changed]);
      expect(conflict.json.status).toBe("conflict");
      expect(f.requests).toEqual(["POST /runs"]);
      f.requests.length = 0;
      const mutateRetry = await f.cli([
        "workflow",
        "capture",
        "--retry",
        f.saved,
        "--summary",
        "changed"
      ]);
      expect(mutateRetry.code).toBe(1);
      expect(f.requests).toEqual([]);
      expect(existsSync(path.join(f.directory, "state"))).toBe(false); // no outbox writes/drain
    } finally {
      await f.close();
    }
  }, 90_000);
});

async function disposable() {
  const directory = mkdtempSync(path.join(tmpdir(), "runtrail-workflow-"));
  const token = randomBytes(32).toString("hex");
  const config = loadConfig();
  config.security = { authRequired: true, token };
  config.notifications.discord.enabled = false;
  config.storage = {
    dbPath: path.join(directory, "ledger.sqlite"),
    logDir: path.join(directory, "logs")
  };
  const db = new Database(config.storage.dbPath);
  migrate(db);
  const app = createApp({ config, db });
  const requests: string[] = [];
  let cliInvocations = 0;
  let fault: { endpoint: string; after: boolean } | undefined;
  const source = path.join(directory, "source.json");
  const saved = path.join(directory, "envelope.json");
  writeFileSync(source, JSON.stringify(metadata()), { mode: 0o600 });
  const server = serve({
    hostname: "127.0.0.1",
    port: 0,
    fetch: async (request) => {
      const endpoint = new URL(request.url).pathname;
      requests.push(`${request.method} ${endpoint}`);
      if (request.method === "POST") {
        // The actual child must publish its retry envelope before the first write.
        expect(existsSync(saved) || endpoint !== "/runs").toBe(true);
      }
      if (fault?.endpoint === endpoint) {
        const current = fault;
        fault = undefined;
        if (current.after) await app.fetch(request);
        return new Response(JSON.stringify({ error: "Disposable failure" }), {
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
  const env = {
    ...process.env,
    RUNTRAIL_URL: `http://127.0.0.1:${address.port}`,
    RUNTRAIL_TOKEN: token,
    RUNTRAIL_DB_PATH: config.storage.dbPath,
    RUNTRAIL_LOG_DIR: config.storage.logDir,
    RUNTRAIL_STATE_DIR: path.join(directory, "state"),
    RUNTRAIL_REQUEST_TIMEOUT_MS: "1000"
  };
  return {
    directory,
    token,
    source,
    saved,
    requests,
    fault(endpoint: string, after: boolean) {
      fault = { endpoint, after };
    },
    capture(file = saved) {
      return [
        "workflow",
        "capture",
        "--source-file",
        source,
        "--project",
        "workflow-test",
        "--work-key",
        workKey,
        "--task",
        "Review workflow capture",
        "--summary",
        "Blockers: review pending. Evidence limits: no independent checks or revision linkage.",
        "--next-action",
        "Review the exact diff; obtain independent check evidence before acting.",
        "--save",
        file
      ];
    },
    rows() {
      return ["agent_runs", "agent_events", "handoffs", "verification_evidence"].map((table) =>
        db.prepare(`SELECT * FROM ${table} ORDER BY id`).all()
      );
    },
    counts() {
      return Object.fromEntries(
        ["agent_runs", "agent_events", "handoffs", "verification_evidence"].map((table) => [
          table,
          db.prepare(`SELECT count(*) AS n FROM ${table}`).get()
        ])
      );
    },
    invocations: () => cliInvocations,
    cli(args: string[]) {
      cliInvocations += 1;
      return execute(args, env);
    },
    async close() {
      await new Promise<void>((resolve, reject) =>
        server.close((error) => (error ? reject(error) : resolve()))
      );
      db.close();
      rmSync(directory, { recursive: true, force: true });
    }
  };
}

function execute(
  args: string[],
  env: NodeJS.ProcessEnv
): Promise<{
  code: number | null;
  stdout: string;
  json: WorkImportResult & BriefReport & { envelopeSaved: boolean };
}> {
  return new Promise((resolve, reject) => {
    const child = spawn("pnpm", ["--silent", "cli", ...args], {
      env,
      stdio: ["ignore", "pipe", "pipe"]
    });
    let stdout = "";
    let stderr = "";
    child.stdout.on("data", (chunk) => {
      stdout += chunk;
    });
    child.stderr.on("data", (chunk) => {
      stderr += chunk;
    });
    child.on("error", reject);
    child.on("close", (code) => {
      let json = {} as WorkImportResult & BriefReport & { envelopeSaved: boolean };
      try {
        json = JSON.parse(stdout);
      } catch {
        /* Markdown and syntax errors are asserted by callers. */
      }
      if (!stdout && code !== 0) reject(new Error(`CLI failed without JSON: ${stderr}`));
      else resolve({ code, stdout, json });
    });
  });
}
