import Database from "better-sqlite3";
import { afterEach, describe, expect, it, vi } from "vitest";
import { loadConfig, type RuntrailConfig } from "../src/config.js";
import { LedgerRepository } from "../src/db/ledger.js";
import { migrate } from "../src/db/migrate.js";
import { createApp } from "../src/index.js";
import { verifyEventChain } from "../src/shared/receipts.js";

const databases: Database.Database[] = [];

afterEach(() => {
  while (databases.length > 0) {
    databases.pop()?.close();
  }
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
  vi.useRealTimers();
});

describe("ledger routes", () => {
  it("requires a bearer token when auth is enabled", async () => {
    const app = createTestApp({ authRequired: true, token: "secret-token" });

    const missingToken = await app.request("/runs", {
      method: "POST",
      body: JSON.stringify(validRunRequest()),
      headers: { "content-type": "application/json" }
    });
    const invalidToken = await app.request("/runs", {
      method: "POST",
      body: JSON.stringify(validRunRequest()),
      headers: {
        "content-type": "application/json",
        authorization: "Bearer wrong-token"
      }
    });

    expect(missingToken.status).toBe(401);
    expect(invalidToken.status).toBe(401);
  });

  it("creates, lists, fetches, and updates runs", async () => {
    const app = createTestApp();
    const createdResponse = await postJson(app, "/runs", validRunRequest());

    expect(createdResponse.status).toBe(201);
    const created = (await createdResponse.json()) as { run: { id: string; status: string } };
    expect(created.run.id).toMatch(/^run_/);
    expect(created.run.status).toBe("running");

    const listResponse = await app.request("/runs?project=ice-council", {
      headers: authHeaders()
    });
    const listed = (await listResponse.json()) as { runs: Array<{ id: string }> };

    expect(listResponse.status).toBe(200);
    expect(listed.runs).toHaveLength(1);
    expect(listed.runs[0]?.id).toBe(created.run.id);

    const updateResponse = await app.request(`/runs/${created.run.id}`, {
      method: "PATCH",
      body: JSON.stringify({ status: "completed", summary: "Run finished" }),
      headers: authHeaders()
    });
    const updated = (await updateResponse.json()) as {
      run: { id: string; status: string; completedAt: string; summary: string };
    };

    expect(updateResponse.status).toBe(200);
    expect(updated.run.status).toBe("completed");
    expect(updated.run.summary).toBe("Run finished");
    expect(updated.run.completedAt).toEqual(expect.any(String));

    const fetchedResponse = await app.request(`/runs/${created.run.id}`, {
      headers: authHeaders()
    });
    const fetched = (await fetchedResponse.json()) as {
      run: { id: string; status: string };
      events: unknown[];
    };

    expect(fetchedResponse.status).toBe(200);
    expect(fetched.run.id).toBe(created.run.id);
    expect(fetched.run.status).toBe("completed");
    expect(fetched.events).toEqual([]);
  });

  it("replays client run creation without mutating the original record", async () => {
    const app = createTestApp();
    const firstResponse = await postJson(app, "/runs", {
      ...validRunRequest(),
      clientRunId: "session-82",
      summary: "original summary"
    });
    const replayResponse = await postJson(app, "/runs", {
      ...validRunRequest(),
      clientRunId: "session-82",
      task: "replacement task",
      status: "failed",
      summary: "replacement summary",
      gitCommit: "replacement"
    });
    const first = (await firstResponse.json()) as { run: { id: string } };
    const replay = (await replayResponse.json()) as {
      run: { id: string; task: string; status: string; summary: string; gitCommit: string };
    };

    expect(firstResponse.status).toBe(201);
    expect(replayResponse.status).toBe(200);
    expect(replay.run).toEqual(
      expect.objectContaining({
        id: first.run.id,
        task: "Implement the ledger API",
        status: "running",
        summary: "original summary",
        gitCommit: "abc123"
      })
    );
  });

  it("creates exactly one run for concurrent requests with the same client identity", async () => {
    const app = createTestApp();
    const payload = { ...validRunRequest(), clientRunId: "concurrent-session" };
    const responses = await Promise.all([
      postJson(app, "/runs", payload),
      postJson(app, "/runs", payload),
      postJson(app, "/runs", payload)
    ]);
    const bodies = (await Promise.all(responses.map((response) => response.json()))) as Array<{
      run: { id: string };
    }>;
    const listed = (await (
      await app.request("/runs?project=ice-council", { headers: authHeaders() })
    ).json()) as { runs: Array<{ id: string }> };

    expect(responses.map((response) => response.status).sort()).toEqual([200, 200, 201]);
    expect(new Set(bodies.map((body) => body.run.id))).toHaveProperty("size", 1);
    expect(listed.runs).toHaveLength(1);
  });

  it("preserves create behavior when clientRunId is omitted", async () => {
    const app = createTestApp();
    const responses = await Promise.all([
      postJson(app, "/runs", validRunRequest()),
      postJson(app, "/runs", validRunRequest())
    ]);
    const bodies = (await Promise.all(responses.map((response) => response.json()))) as Array<{
      run: { id: string };
    }>;

    expect(responses.map((response) => response.status)).toEqual([201, 201]);
    expect(new Set(bodies.map((body) => body.run.id))).toHaveProperty("size", 2);
  });

  it("reports stale runs by default and applies only across the strict activity boundary", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-07-01T00:00:00.000Z"));
    const app = createTestApp();
    const old = (await (
      await postJson(app, "/runs", { ...validRunRequest(), task: "old running" })
    ).json()) as { run: { id: string } };
    const terminal = (await (
      await postJson(app, "/runs", { ...validRunRequest(), task: "old terminal" })
    ).json()) as { run: { id: string } };
    await app.request(`/runs/${terminal.run.id}`, {
      method: "PATCH",
      body: JSON.stringify({ status: "completed" }),
      headers: authHeaders()
    });

    vi.setSystemTime(new Date("2026-07-03T00:00:00.000Z"));
    const recent = (await (
      await postJson(app, "/runs", { ...validRunRequest(), task: "recent running" })
    ).json()) as { run: { id: string } };
    const boundary = (await (
      await postJson(app, "/runs", { ...validRunRequest(), task: "boundary running" })
    ).json()) as { run: { id: string } };

    const dryRun = await postJson(app, "/runs/close-stale", {
      updatedBefore: "2026-07-03T00:00:00.000Z"
    });
    const dryBody = (await dryRun.json()) as {
      dryRun: boolean;
      candidateCount: number;
      closedCount: number;
      candidates: Array<{ id: string }>;
    };

    expect(dryBody).toEqual(
      expect.objectContaining({ dryRun: true, candidateCount: 1, closedCount: 0 })
    );
    expect(dryBody.candidates.map((run) => run.id)).toEqual([old.run.id]);

    vi.setSystemTime(new Date("2026-07-04T00:00:00.000Z"));
    const applied = await postJson(app, "/runs/close-stale", {
      updatedBefore: "2026-07-03T00:00:00.000Z",
      apply: true
    });
    const appliedBody = (await applied.json()) as {
      dryRun: boolean;
      candidateCount: number;
      closedCount: number;
      closed: Array<{ id: string; status: string; summary: string; completedAt: string }>;
    };

    expect(appliedBody).toEqual(
      expect.objectContaining({ dryRun: false, candidateCount: 1, closedCount: 1 })
    );
    expect(appliedBody.closed).toEqual([
      expect.objectContaining({
        id: old.run.id,
        status: "cancelled",
        summary: "Closed as stale after no activity since before 2026-07-03T00:00:00.000Z.",
        completedAt: "2026-07-04T00:00:00.000Z"
      })
    ]);

    for (const id of [terminal.run.id, recent.run.id, boundary.run.id]) {
      const response = await app.request(`/runs/${id}`, { headers: authHeaders() });
      const body = (await response.json()) as { run: { status: string } };
      expect(body.run.status).not.toBe("cancelled");
    }
  });

  it("normalizes run date filters before SQLite text comparison", async () => {
    const app = createTestApp();
    await postJson(app, "/runs", {
      ...validRunRequest(),
      task: "exclusive boundary run",
      startedAt: "2026-06-28T00:00:00.000Z"
    });

    const response = await app.request(
      "/runs?project=ice-council&started_to=2026-06-28T00:00:00Z",
      {
        headers: authHeaders()
      }
    );
    const body = (await response.json()) as { runs: Array<{ task: string }> };

    expect(response.status).toBe(200);
    expect(body.runs).toEqual([]);
  });

  it("stores omitted run metadata as nullable SQLite values", async () => {
    const app = createTestApp();
    const createdResponse = await postJson(app, "/runs", {
      source: "codex",
      project: "runtrail",
      task: "minimal run"
    });
    const created = (await createdResponse.json()) as {
      run: { id: string; hostname?: string; gitBranch?: string };
    };

    expect(createdResponse.status).toBe(201);
    expect(created.run.hostname).toBeUndefined();
    expect(created.run.gitBranch).toBeUndefined();

    const fetchedResponse = await app.request(`/runs/${created.run.id}`, {
      headers: authHeaders()
    });
    const fetched = (await fetchedResponse.json()) as {
      run: { hostname?: string; cwd?: string; gitBranch?: string; summary?: string };
    };

    expect(fetchedResponse.status).toBe(200);
    expect(fetched.run).not.toHaveProperty("hostname");
    expect(fetched.run).not.toHaveProperty("cwd");
    expect(fetched.run).not.toHaveProperty("gitBranch");
    expect(fetched.run).not.toHaveProperty("summary");
  });

  it("stores run metadata and filters runs by category and tag", async () => {
    const app = createTestApp();
    await postJson(app, "/runs", {
      ...validRunRequest(),
      task: "remote mcp bridge",
      category: "implementation",
      tags: ["mcp", "codex", "mcp"]
    });
    await postJson(app, "/runs", {
      ...validRunRequest(),
      task: "deployment check",
      category: "deploy",
      tags: ["lxc"]
    });

    const response = await app.request(
      "/runs?project=ice-council&category=implementation&tag=mcp",
      {
        headers: authHeaders()
      }
    );
    const body = (await response.json()) as {
      runs: Array<{ task: string; category?: string; tags?: string[] }>;
    };

    expect(response.status).toBe(200);
    expect(body.runs).toEqual([
      expect.objectContaining({
        task: "remote mcp bridge",
        category: "implementation",
        tags: ["mcp", "codex"]
      })
    ]);
  });

  it("creates and lists events attached to a run", async () => {
    const app = createTestApp();
    const run = (await (await postJson(app, "/runs", validRunRequest())).json()) as {
      run: { id: string };
    };
    const eventResponse = await postJson(app, "/events", {
      runId: run.run.id,
      type: "progress",
      message: "Read the route patterns",
      importance: 5,
      category: "implementation",
      tags: ["api", "mcp", "api"],
      createdAt: "2026-06-26T09:30:00.000Z",
      data: {
        files: ["src/index.ts"]
      }
    });

    expect(eventResponse.status).toBe(201);
    const created = (await eventResponse.json()) as {
      event: {
        id: string;
        runId: string;
        category?: string;
        tags?: string[];
        data: { files: string[] };
      };
    };
    expect(created.event.id).toMatch(/^evt_/);
    expect(created.event.runId).toBe(run.run.id);
    expect(created.event.category).toBe("implementation");
    expect(created.event.tags).toEqual(["api", "mcp"]);
    expect(created.event.data.files).toEqual(["src/index.ts"]);

    const fetchedResponse = await app.request(`/runs/${run.run.id}`, {
      headers: authHeaders()
    });
    const fetched = (await fetchedResponse.json()) as {
      run: { updatedAt: string };
      events: Array<{ id: string; message: string; category?: string; tags?: string[] }>;
    };

    expect(fetched.run.updatedAt).toBe("2026-06-26T09:30:00.000Z");
    expect(fetched.events).toEqual([
      expect.objectContaining({
        id: created.event.id,
        message: "Read the route patterns",
        category: "implementation",
        tags: ["api", "mcp"]
      })
    ]);

    const listedResponse = await app.request(`/events?runId=${run.run.id}`, {
      headers: authHeaders()
    });
    const listed = (await listedResponse.json()) as {
      events: Array<{ id: string; message: string }>;
    };

    expect(listed.events).toHaveLength(1);
    expect(listed.events[0]?.id).toBe(created.event.id);
  });

  it("adds stable event receipts and detects tampering", () => {
    const db = new Database(":memory:");
    databases.push(db);
    migrate(db);
    const ledger = new LedgerRepository(db);
    const { run } = ledger.createRun({
      source: "codex",
      project: "ice-council",
      task: "Implement the ledger API",
      status: "running"
    });
    const first = ledger.createEvent({
      runId: run.id,
      type: "progress",
      message: "first event",
      importance: 4,
      createdAt: "2026-06-26T09:00:00.000Z"
    });
    ledger.createEvent({
      runId: run.id,
      type: "completed",
      message: "second event",
      importance: 5,
      data: { ok: true },
      createdAt: "2026-06-26T09:05:00.000Z"
    });

    const events = ledger.listEvents({ runId: run.id, limit: 10 });
    const repeated = ledger.listEvents({ runId: run.id, limit: 10 });

    expect(first?.eventHash).toMatch(/^[a-f0-9]{64}$/);
    expect(repeated.map((event) => event.eventHash)).toEqual(
      events.map((event) => event.eventHash)
    );
    expect(verifyEventChain(events)).toEqual({ status: "pass", checkedEvents: 2 });

    db.prepare("UPDATE agent_events SET message = ? WHERE id = ?").run("tampered event", first?.id);

    expect(verifyEventChain(ledger.listEvents({ runId: run.id, limit: 10 }))).toEqual(
      expect.objectContaining({
        status: "fail",
        eventId: first?.id,
        reason: "event hash does not match event content"
      })
    );
  });

  it("returns useful errors for invalid payloads and missing records", async () => {
    const app = createTestApp();

    const invalidRun = await postJson(app, "/runs", {
      source: "",
      project: "ice-council",
      task: "test"
    });
    const invalidBody = (await invalidRun.json()) as {
      error: string;
      issues: Array<{ path: string; message: string }>;
    };

    expect(invalidRun.status).toBe(400);
    expect(invalidBody.error).toBe("Invalid request");
    expect(invalidBody.issues).toEqual([
      expect.objectContaining({
        path: "source"
      })
    ]);

    const missingRun = await postJson(app, "/events", {
      runId: "run_missing",
      type: "started",
      message: "No run"
    });

    expect(missingRun.status).toBe(404);
    expect(await missingRun.json()).toEqual({ error: "Run not found" });
  });

  it("creates, lists, and resolves open loops", async () => {
    const app = createTestApp();
    const run = (await (await postJson(app, "/runs", validRunRequest())).json()) as {
      run: { id: string };
    };
    const createdResponse = await postJson(app, "/open-loops", {
      type: "ready_to_deploy",
      project: "runtrail",
      title: "Need API decision",
      description: "Choose the lifecycle shape",
      owner: "operator",
      source: "codex",
      nextAction: "Review and deploy",
      blockerRef: "PR #123",
      sourceRunId: run.run.id,
      createdAt: "2026-06-26T10:00:00.000Z"
    });

    expect(createdResponse.status).toBe(201);
    const created = (await createdResponse.json()) as {
      openLoop: {
        id: string;
        status: string;
        type: string;
        project: string;
        owner: string;
        source: string;
        nextAction: string;
        blockerRef: string;
        sourceRunId: string;
      };
    };
    expect(created.openLoop.id).toMatch(/^loop_/);
    expect(created.openLoop.status).toBe("open");
    expect(created.openLoop.type).toBe("ready_to_deploy");
    expect(created.openLoop.project).toBe("runtrail");
    expect(created.openLoop.owner).toBe("operator");
    expect(created.openLoop.source).toBe("codex");
    expect(created.openLoop.nextAction).toBe("Review and deploy");
    expect(created.openLoop.blockerRef).toBe("PR #123");
    expect(created.openLoop.sourceRunId).toBe(run.run.id);

    await postJson(app, "/open-loops", {
      type: "blocked",
      project: "runtrail",
      title: "Blocked item"
    });
    const cancelledResponse = await postJson(app, "/open-loops", {
      type: "failed_unresolved",
      project: "runtrail",
      title: "Cancelled item"
    });
    const cancelled = (await cancelledResponse.json()) as { openLoop: { id: string } };

    const openListResponse = await app.request(
      "/open-loops?project=runtrail&type=ready_to_deploy",
      {
        headers: authHeaders()
      }
    );
    const openList = (await openListResponse.json()) as {
      openLoops: Array<{ id: string; status: string; type: string }>;
    };

    expect(openListResponse.status).toBe(200);
    expect(openList.openLoops).toEqual([
      expect.objectContaining({
        id: created.openLoop.id,
        status: "open",
        type: "ready_to_deploy"
      })
    ]);

    for (const filter of [
      "owner=operator",
      "source=codex",
      `sourceRunId=${encodeURIComponent(run.run.id)}`
    ]) {
      const filteredResponse = await app.request(`/open-loops?project=runtrail&${filter}`, {
        headers: authHeaders()
      });
      const filtered = (await filteredResponse.json()) as {
        openLoops: Array<{ id: string }>;
      };
      expect(filteredResponse.status).toBe(200);
      expect(filtered.openLoops).toEqual([expect.objectContaining({ id: created.openLoop.id })]);
    }

    const cancelResponse = await app.request(`/open-loops/${cancelled.openLoop.id}`, {
      method: "PATCH",
      body: JSON.stringify({ status: "cancelled", resolution: "No longer needed" }),
      headers: authHeaders()
    });
    const cancelBody = (await cancelResponse.json()) as {
      openLoop: { status: string; resolution: string; resolvedAt: string };
    };

    expect(cancelResponse.status).toBe(200);
    expect(cancelBody.openLoop.status).toBe("cancelled");
    expect(cancelBody.openLoop.resolution).toBe("No longer needed");
    expect(cancelBody.openLoop.resolvedAt).toEqual(expect.any(String));

    const resolvedResponse = await app.request(`/open-loops/${created.openLoop.id}`, {
      method: "PATCH",
      body: JSON.stringify({
        status: "resolved",
        resolution: "Use open/resolved lifecycle",
        resolvedAt: "2026-06-26T10:15:00.000Z"
      }),
      headers: authHeaders()
    });
    const resolved = (await resolvedResponse.json()) as {
      openLoop: { id: string; status: string; resolution: string; resolvedAt: string };
    };

    expect(resolvedResponse.status).toBe(200);
    expect(resolved.openLoop.status).toBe("resolved");
    expect(resolved.openLoop.resolution).toBe("Use open/resolved lifecycle");
    expect(resolved.openLoop.resolvedAt).toBe("2026-06-26T10:15:00.000Z");

    const defaultList = (await (
      await app.request("/open-loops?project=runtrail", {
        headers: authHeaders()
      })
    ).json()) as { openLoops: unknown[] };
    const resolvedList = (await (
      await app.request("/open-loops?project=runtrail&status=resolved", {
        headers: authHeaders()
      })
    ).json()) as { openLoops: Array<{ id: string }> };
    const cancelledList = (await (
      await app.request("/open-loops?project=runtrail&status=cancelled", {
        headers: authHeaders()
      })
    ).json()) as { openLoops: Array<{ id: string }> };

    expect(defaultList.openLoops).toEqual([expect.objectContaining({ title: "Blocked item" })]);
    expect(resolvedList.openLoops).toEqual([
      expect.objectContaining({
        id: created.openLoop.id
      })
    ]);
    expect(cancelledList.openLoops).toEqual([
      expect.objectContaining({
        id: cancelled.openLoop.id
      })
    ]);
  });

  it("records and lists project and global decisions", async () => {
    const app = createTestApp();
    const globalResponse = await postJson(app, "/decisions", {
      title: "Store Markdown as exports only",
      decision: "SQLite remains the source of truth",
      rationale: "Agents need structured state",
      createdAt: "2026-06-26T10:00:00.000Z"
    });
    const projectResponse = await postJson(app, "/decisions", {
      project: "runtrail",
      title: "Use Hono route modules",
      decision: "Keep ledger routes in the existing API module",
      createdAt: "2026-06-26T10:05:00.000Z"
    });

    expect(globalResponse.status).toBe(201);
    expect(projectResponse.status).toBe(201);

    const global = (await globalResponse.json()) as {
      decision: { id: string; project?: string; title: string };
    };
    const project = (await projectResponse.json()) as {
      decision: { id: string; project: string; title: string };
    };

    expect(global.decision.id).toMatch(/^dec_/);
    expect(global.decision.project).toBeUndefined();
    expect(project.decision.id).toMatch(/^dec_/);
    expect(project.decision.project).toBe("runtrail");

    const withGlobalResponse = await app.request("/decisions?project=runtrail", {
      headers: authHeaders()
    });
    const withGlobal = (await withGlobalResponse.json()) as {
      decisions: Array<{ id: string; title: string }>;
    };

    expect(withGlobal.decisions.map((decision) => decision.id)).toEqual([
      project.decision.id,
      global.decision.id
    ]);

    const projectOnlyResponse = await app.request(
      "/decisions?project=runtrail&includeGlobal=false",
      {
        headers: authHeaders()
      }
    );
    const projectOnly = (await projectOnlyResponse.json()) as {
      decisions: Array<{ id: string }>;
    };

    expect(projectOnly.decisions).toEqual([
      expect.objectContaining({
        id: project.decision.id
      })
    ]);
  });

  it("creates, lists, and fetches handoffs", async () => {
    const app = createTestApp();
    const run = (await (await postJson(app, "/runs", validRunRequest())).json()) as {
      run: { id: string };
    };
    const createdResponse = await postJson(app, "/handoffs", {
      sourceRunId: run.run.id,
      fromSource: "codex",
      toSource: "openclaw",
      project: "ice-council",
      summary: "API work is ready for operator review",
      nextAction: "Review changed routes",
      category: "implementation",
      tags: ["mcp", "issue-79", "mcp"],
      context: {
        changedFiles: ["src/routes/ledger.ts"]
      },
      createdAt: "2026-07-03T12:00:00.000Z"
    });

    expect(createdResponse.status).toBe(201);
    const created = (await createdResponse.json()) as {
      handoff: {
        id: string;
        sourceRunId: string;
        fromSource: string;
        toSource: string;
        category: string;
        tags: string[];
        context: { changedFiles: string[] };
      };
    };

    expect(created.handoff.id).toMatch(/^handoff_/);
    expect(created.handoff.sourceRunId).toBe(run.run.id);
    expect(created.handoff.fromSource).toBe("codex");
    expect(created.handoff.toSource).toBe("openclaw");
    expect(created.handoff.category).toBe("implementation");
    expect(created.handoff.tags).toEqual(["mcp", "issue-79"]);
    expect(created.handoff.context.changedFiles).toEqual(["src/routes/ledger.ts"]);

    const listedResponse = await app.request(`/handoffs?project=ice-council`, {
      headers: authHeaders()
    });
    const listed = (await listedResponse.json()) as {
      handoffs: Array<{ id: string; nextAction: string }>;
    };

    expect(listedResponse.status).toBe(200);
    expect(listed.handoffs).toEqual([
      expect.objectContaining({
        id: created.handoff.id,
        nextAction: "Review changed routes"
      })
    ]);

    const fetchedResponse = await app.request(`/handoffs/${created.handoff.id}`, {
      headers: authHeaders()
    });
    const fetched = (await fetchedResponse.json()) as {
      handoff: { id: string; summary: string; category: string; tags: string[] };
    };

    expect(fetchedResponse.status).toBe(200);
    expect(fetched.handoff).toEqual(
      expect.objectContaining({
        id: created.handoff.id,
        summary: "API work is ready for operator review",
        category: "implementation",
        tags: ["mcp", "issue-79"]
      })
    );
  });

  it("creates and lists artifact metadata", async () => {
    const app = createTestApp();
    const run = (await (await postJson(app, "/runs", validRunRequest())).json()) as {
      run: { id: string };
    };
    const createdResponse = await postJson(app, "/artifacts", {
      runId: run.run.id,
      kind: "log",
      path: "data/logs/run_123.log",
      sizeBytes: 42,
      sha256: "a".repeat(64),
      createdAt: "2026-07-03T12:05:00.000Z"
    });

    expect(createdResponse.status).toBe(201);
    const created = (await createdResponse.json()) as {
      artifact: { id: string; runId: string; path: string; sizeBytes: number; sha256: string };
    };

    expect(created.artifact.id).toMatch(/^art_/);
    expect(created.artifact.runId).toBe(run.run.id);
    expect(created.artifact.path).toBe("data/logs/run_123.log");
    expect(created.artifact.sizeBytes).toBe(42);

    const listedResponse = await app.request(`/artifacts?runId=${run.run.id}`, {
      headers: authHeaders()
    });
    const listed = (await listedResponse.json()) as {
      artifacts: Array<{ id: string; sha256: string }>;
    };

    expect(listedResponse.status).toBe(200);
    expect(listed.artifacts).toEqual([
      expect.objectContaining({
        id: created.artifact.id,
        sha256: "a".repeat(64)
      })
    ]);
  });

  it("returns compact run manifests with linked records", async () => {
    const app = createTestApp();
    const run = (await (await postJson(app, "/runs", validRunRequest())).json()) as {
      run: { id: string };
    };

    await postJson(app, "/events", {
      runId: run.run.id,
      type: "command_executed",
      message: "pnpm test",
      importance: 5,
      data: {
        argv: ["pnpm", "test"],
        exitCode: 1,
        durationMs: 1234,
        logPath: "data/logs/run.log",
        gitBefore: { commit: "abc" },
        gitAfter: { commit: "def" },
        changedFiles: ["src/db/ledger.ts"],
        stdout: "x".repeat(1000)
      }
    });
    await postJson(app, "/events", {
      runId: run.run.id,
      type: "test_passed",
      message: "ledger tests passed",
      importance: 5,
      data: {
        changedFiles: ["test/ledger.test.ts"]
      }
    });
    await postJson(app, "/open-loops", {
      type: "needs_review",
      project: "ice-council",
      title: "Review manifest output",
      sourceRunId: run.run.id
    });
    await postJson(app, "/handoffs", {
      sourceRunId: run.run.id,
      fromSource: "codex",
      project: "ice-council",
      summary: "Manifest ready"
    });
    await postJson(app, "/artifacts", {
      runId: run.run.id,
      kind: "log",
      path: "data/logs/run.log",
      sizeBytes: 1000,
      sha256: "b".repeat(64)
    });

    const response = await app.request(`/runs/${run.run.id}/manifest`, {
      headers: authHeaders()
    });
    const body = (await response.json()) as {
      manifest: {
        run: { id: string };
        events: Array<{ message: string; data?: unknown }>;
        changed_files: string[];
        commands: Array<{
          message: string;
          argv?: string[];
          exitCode?: number;
          durationMs?: number;
          logPath?: string;
          gitBefore?: Record<string, unknown>;
          gitAfter?: Record<string, unknown>;
        }>;
        tests: Array<{ message: string }>;
        open_loops: Array<{ title: string }>;
        handoffs: Array<{ summary: string }>;
        artifacts: Array<{ kind: string; path: string; sizeBytes: number; sha256: string }>;
      };
    };

    expect(response.status).toBe(200);
    expect(body.manifest.run.id).toBe(run.run.id);
    expect(body.manifest.changed_files).toEqual(["src/db/ledger.ts", "test/ledger.test.ts"]);
    expect(body.manifest.events[0]).not.toHaveProperty("data");
    expect(body.manifest.commands).toEqual([
      expect.objectContaining({
        message: "pnpm test",
        argv: ["pnpm", "test"],
        exitCode: 1,
        durationMs: 1234,
        logPath: "data/logs/run.log",
        gitBefore: { commit: "abc" },
        gitAfter: { commit: "def" }
      })
    ]);
    expect(body.manifest.commands[0]).not.toHaveProperty("stdout");
    expect(body.manifest.tests).toEqual([
      expect.objectContaining({ message: "ledger tests passed" })
    ]);
    expect(body.manifest.open_loops).toEqual([
      expect.objectContaining({ title: "Review manifest output" })
    ]);
    expect(body.manifest.handoffs).toEqual([
      expect.objectContaining({ summary: "Manifest ready" })
    ]);
    expect(body.manifest.artifacts).toEqual([
      expect.objectContaining({
        kind: "log",
        path: "data/logs/run.log",
        sizeBytes: 1000,
        sha256: "b".repeat(64)
      })
    ]);
  });

  it("validates open loop and decision payloads", async () => {
    const app = createTestApp();
    const invalidLoop = await postJson(app, "/open-loops", {
      type: "todo",
      project: "runtrail",
      title: "Invalid"
    });
    const missingLoop = await app.request("/open-loops/loop_missing", {
      method: "PATCH",
      body: JSON.stringify({ status: "resolved" }),
      headers: authHeaders()
    });
    const invalidDecision = await postJson(app, "/decisions", {
      title: "Missing decision"
    });
    const missingSourceRun = await postJson(app, "/open-loops", {
      type: "blocked",
      project: "runtrail",
      title: "Missing source run",
      sourceRunId: "run_missing"
    });

    expect(invalidLoop.status).toBe(400);
    expect(await invalidLoop.json()).toEqual(
      expect.objectContaining({
        error: "Invalid request"
      })
    );
    expect(missingLoop.status).toBe(404);
    expect(await missingLoop.json()).toEqual({ error: "Open loop not found" });
    expect(missingSourceRun.status).toBe(404);
    expect(await missingSourceRun.json()).toEqual({ error: "Source run not found" });
    expect(invalidDecision.status).toBe(400);
  });

  it("validates handoff and artifact payloads", async () => {
    const app = createTestApp();
    const invalidHandoff = await postJson(app, "/handoffs", {
      fromSource: "codex",
      project: "runtrail",
      summary: ""
    });
    const missingRunHandoff = await postJson(app, "/handoffs", {
      sourceRunId: "run_missing",
      fromSource: "codex",
      project: "runtrail",
      summary: "Continue work"
    });
    const invalidArtifact = await postJson(app, "/artifacts", {
      runId: "run_missing",
      kind: "log",
      path: "data/logs/run.log",
      sha256: "not-a-sha"
    });

    expect(invalidHandoff.status).toBe(400);
    expect(await invalidHandoff.json()).toEqual(
      expect.objectContaining({
        error: "Invalid request"
      })
    );
    expect(missingRunHandoff.status).toBe(404);
    expect(await missingRunHandoff.json()).toEqual({ error: "Source run not found" });
    expect(invalidArtifact.status).toBe(400);
  });

  it("returns compact agent context for a project", async () => {
    const app = createTestApp();
    const run = (await (await postJson(app, "/runs", validRunRequest())).json()) as {
      run: { id: string };
    };

    await postJson(app, "/events", {
      runId: run.run.id,
      type: "progress",
      message: "low noise",
      importance: 1,
      createdAt: "2026-06-26T10:00:00.000Z"
    });
    await postJson(app, "/events", {
      runId: run.run.id,
      type: "progress",
      message: "metadata omitted",
      importance: 4,
      createdAt: "2026-06-26T10:04:00.000Z"
    });
    await postJson(app, "/events", {
      runId: run.run.id,
      type: "blocked",
      message: "needs operator input",
      importance: 7,
      category: "implementation",
      tags: ["issue-104", "context", "issue-104"],
      createdAt: "2026-06-26T10:05:00.000Z",
      data: {
        largeLog: "x".repeat(1000)
      }
    });
    await app.request(`/runs/${run.run.id}`, {
      method: "PATCH",
      body: JSON.stringify({ status: "failed", summary: "Needs follow-up" }),
      headers: authHeaders()
    });
    await postJson(app, "/open-loops", {
      type: "blocked",
      project: "ice-council",
      title: "Confirm live host path",
      nextAction: "Check host readiness"
    });
    await postJson(app, "/decisions", {
      title: "Global retention policy",
      decision: "Keep durable structured state",
      createdAt: "2026-06-26T10:01:00.000Z"
    });
    await postJson(app, "/decisions", {
      project: "ice-council",
      title: "Use concise context",
      decision: "Agents read compact context first",
      createdAt: "2026-06-26T10:06:00.000Z"
    });
    await postJson(app, "/handoffs", {
      sourceRunId: run.run.id,
      fromSource: "codex",
      project: "ice-council",
      summary: "Metadata omitted",
      createdAt: "2026-06-26T10:06:30.000Z"
    });
    await postJson(app, "/handoffs", {
      sourceRunId: run.run.id,
      fromSource: "codex",
      toSource: "openclaw",
      project: "ice-council",
      summary: "Continue from failed API run",
      nextAction: "Inspect failure event",
      category: "handoff",
      tags: ["issue-104", "openclaw", "issue-104"],
      context: {
        runId: run.run.id
      },
      createdAt: "2026-06-26T10:07:00.000Z"
    });
    await postJson(app, "/handoffs", {
      fromSource: "codex",
      project: "other-project",
      summary: "Should not be included"
    });

    const response = await app.request("/agent/context?project=ice-council&min_importance=4", {
      headers: authHeaders()
    });
    const context = (await response.json()) as {
      project: string;
      recent_runs: Array<{ id: string }>;
      failed_runs: Array<{ id: string; summary: string }>;
      recent_events: Array<{
        message: string;
        category?: string;
        tags?: string[];
        data?: unknown;
      }>;
      recent_handoffs: Array<{
        summary: string;
        nextAction: string;
        category?: string;
        tags?: string[];
        context?: unknown;
      }>;
      open_loops: Array<{ title: string }>;
      decisions: Array<{ title: string }>;
      next_actions: string[];
    };

    expect(response.status).toBe(200);
    expect(context.project).toBe("ice-council");
    expect(context.recent_runs).toEqual([expect.objectContaining({ id: run.run.id })]);
    expect(context.recent_events).toEqual([
      expect.objectContaining({
        message: "needs operator input",
        category: "implementation",
        tags: ["issue-104", "context"]
      }),
      expect.objectContaining({ message: "metadata omitted" })
    ]);
    expect(context.recent_events[1]).not.toHaveProperty("category");
    expect(context.recent_events[1]).not.toHaveProperty("tags");
    expect(context.recent_events[0]).not.toHaveProperty("data");
    expect(context.failed_runs).toEqual([
      expect.objectContaining({ id: run.run.id, summary: "Needs follow-up" })
    ]);
    expect(context.recent_handoffs).toEqual([
      expect.objectContaining({
        summary: "Continue from failed API run",
        nextAction: "Inspect failure event",
        category: "handoff",
        tags: ["issue-104", "openclaw"]
      }),
      expect.objectContaining({ summary: "Metadata omitted" })
    ]);
    expect(context.recent_handoffs[1]).not.toHaveProperty("category");
    expect(context.recent_handoffs[1]).not.toHaveProperty("tags");
    expect(context.recent_handoffs[0]).not.toHaveProperty("context");
    expect(context.open_loops).toEqual([
      expect.objectContaining({ title: "Confirm live host path" })
    ]);
    expect(context.decisions.map((decision) => decision.title)).toEqual([
      "Use concise context",
      "Global retention policy"
    ]);
    expect(context.next_actions).toEqual(["Check host readiness"]);
  });

  it("searches journal records with text, date, project, source, and status filters", async () => {
    const app = createTestApp();
    const run = (await (
      await postJson(app, "/runs", {
        ...validRunRequest(),
        project: "runtrail",
        source: "codex",
        task: "needle run task",
        category: "implementation",
        tags: ["mcp", "search"],
        startedAt: "2026-07-01T10:00:00.000Z"
      })
    ).json()) as { run: { id: string } };
    await postJson(app, "/runs", {
      ...validRunRequest(),
      project: "other",
      source: "codex",
      task: "needle wrong project",
      startedAt: "2026-07-01T10:00:00.000Z"
    });
    await postJson(app, "/events", {
      runId: run.run.id,
      type: "progress",
      message: "needle event",
      category: "implementation",
      tags: ["mcp"],
      createdAt: "2026-07-01T10:05:00.000Z"
    });
    await postJson(app, "/open-loops", {
      type: "blocked",
      project: "runtrail",
      title: "needle loop",
      source: "codex",
      createdAt: "2026-07-01T10:06:00.000Z"
    });
    await postJson(app, "/handoffs", {
      fromSource: "codex",
      project: "runtrail",
      summary: "needle handoff",
      category: "implementation",
      tags: ["mcp", "handoff", "mcp"],
      createdAt: "2026-07-01T10:07:00.000Z"
    });
    await postJson(app, "/decisions", {
      project: "runtrail",
      title: "needle decision",
      decision: "Use simple SQLite search",
      createdAt: "2026-07-01T10:08:00.000Z"
    });

    const query =
      "project=runtrail&source=codex&text=needle&date_from=2026-07-01T00:00:00.000Z&date_to=2026-07-02T00:00:00.000Z";
    const response = await app.request(`/search?${query}`, {
      headers: authHeaders()
    });
    const body = (await response.json()) as {
      results: {
        runs: Array<{ task: string }>;
        events: Array<{ message: string }>;
        open_loops: Array<{ title: string }>;
        handoffs: Array<{ summary: string }>;
        decisions: Array<{ title: string }>;
      };
    };

    expect(response.status).toBe(200);
    expect(body.results.runs).toEqual([expect.objectContaining({ task: "needle run task" })]);
    expect(body.results.events).toEqual([expect.objectContaining({ message: "needle event" })]);
    expect(body.results.open_loops).toEqual([expect.objectContaining({ title: "needle loop" })]);
    expect(body.results.handoffs).toEqual([expect.objectContaining({ summary: "needle handoff" })]);
    expect(body.results.decisions).toEqual([expect.objectContaining({ title: "needle decision" })]);

    const htmlResponse = await app.request(`/search?${query}`, {
      headers: {
        ...authHeaders(),
        accept: "text/html"
      }
    });
    const html = await htmlResponse.text();

    expect(htmlResponse.status).toBe(200);
    expect(html).toContain("Run results");
    expect(html).toContain("needle handoff");

    const statusResponse = await app.request("/search?project=runtrail&status=running", {
      headers: authHeaders()
    });
    const statusBody = (await statusResponse.json()) as {
      results: { runs: Array<{ task: string }>; events: Array<{ message: string }> };
    };

    expect(statusBody.results.runs).toEqual([expect.objectContaining({ task: "needle run task" })]);
    expect(statusBody.results.events).toEqual([
      expect.objectContaining({ message: "needle event" })
    ]);

    const metadataResponse = await app.request(
      "/search?project=runtrail&category=implementation&tag=mcp",
      {
        headers: authHeaders()
      }
    );
    const metadataBody = (await metadataResponse.json()) as {
      results: {
        runs: Array<{ task: string; tags?: string[] }>;
        events: Array<{ message: string; tags?: string[] }>;
        handoffs: Array<{ summary: string; tags?: string[] }>;
        open_loops: unknown[];
      };
    };

    expect(metadataBody.results.runs).toEqual([
      expect.objectContaining({ task: "needle run task", tags: ["mcp", "search"] })
    ]);
    expect(metadataBody.results.events).toEqual([
      expect.objectContaining({ message: "needle event", tags: ["mcp"] })
    ]);
    expect(metadataBody.results.handoffs).toEqual([
      expect.objectContaining({ summary: "needle handoff", tags: ["mcp", "handoff"] })
    ]);
    expect(metadataBody.results.open_loops).toEqual([]);

    await app.request(`/runs/${run.run.id}`, {
      method: "PATCH",
      body: JSON.stringify({ status: "completed" }),
      headers: authHeaders()
    });

    const failedStatusResponse = await app.request("/search?project=runtrail&status=failed", {
      headers: authHeaders()
    });
    const failedStatusBody = (await failedStatusResponse.json()) as {
      results: { events: Array<{ message: string }> };
    };

    expect(failedStatusBody.results.events).toEqual([]);
  });

  it("keeps low-importance exceptional events in agent context", async () => {
    const app = createTestApp();
    const run = (await (await postJson(app, "/runs", validRunRequest())).json()) as {
      run: { id: string };
    };

    await postJson(app, "/events", {
      runId: run.run.id,
      type: "blocked",
      message: "blocked with default importance"
    });

    const response = await app.request("/agent/context?project=ice-council&min_importance=4", {
      headers: authHeaders()
    });
    const context = (await response.json()) as {
      recent_events: Array<{ message: string; importance: number }>;
    };

    expect(response.status).toBe(200);
    expect(context.recent_events).toEqual([
      expect.objectContaining({
        message: "blocked with default importance",
        importance: 3
      })
    ]);
  });

  it("renders server-side context recovery pages without changing JSON APIs", async () => {
    const app = createTestApp();
    const run = (await (await postJson(app, "/runs", validRunRequest())).json()) as {
      run: { id: string };
    };
    await postJson(app, "/events", {
      runId: run.run.id,
      type: "failed",
      message: "Command failed",
      importance: 8,
      data: {
        exitCode: 1,
        changedFiles: ["src/routes/ledger.ts"]
      }
    });
    await app.request(`/runs/${run.run.id}`, {
      method: "PATCH",
      body: JSON.stringify({ status: "failed", summary: "Needs inspection" }),
      headers: authHeaders()
    });
    const loopResponse = await postJson(app, "/open-loops", {
      type: "blocked",
      project: "ice-council",
      title: "Resolve production blocker",
      nextAction: "Inspect failed run",
      sourceRunId: run.run.id
    });
    const loop = (await loopResponse.json()) as { openLoop: { id: string } };
    await postJson(app, "/handoffs", {
      sourceRunId: run.run.id,
      fromSource: "codex",
      toSource: "openclaw",
      project: "ice-council",
      summary: "Review failed UI run",
      nextAction: "Check route output"
    });
    await postJson(app, "/open-loops", {
      type: "follow_up",
      project: "ice-council",
      title: "Schedule follow-up"
    });
    await postJson(app, "/open-loops", {
      type: "risk",
      project: "ice-council",
      title: "Track deployment risk"
    });
    await postJson(app, "/artifacts", {
      runId: run.run.id,
      kind: "log",
      path: "data/logs/ui-run.log",
      sizeBytes: 10
    });
    await postJson(app, "/decisions", {
      project: "ice-council",
      title: "Keep UI simple",
      decision: "Use server-rendered HTML"
    });

    const jsonResponse = await app.request("/runs", { headers: authHeaders() });
    expect(jsonResponse.headers.get("content-type")).toContain("application/json");
    expect(await jsonResponse.json()).toEqual({
      runs: [expect.objectContaining({ id: run.run.id })]
    });

    const pages = await Promise.all(
      [
        "/today",
        "/runs",
        `/runs/${run.run.id}`,
        "/projects/ice-council",
        "/open-loops",
        "/decisions",
        "/errors"
      ].map(async (path) => {
        const response = await app.request(path, {
          headers: {
            ...authHeaders(),
            accept: "text/html"
          }
        });
        return { path, response, body: await response.text() };
      })
    );

    for (const page of pages) {
      expect(page.response.status, page.path).toBe(200);
      expect(page.response.headers.get("content-type"), page.path).toContain("text/html");
      expect(page.body, page.path).toContain("<!doctype html>");
      expect(page.body, page.path).toContain("Runtrail");
    }

    const rootResponse = await app.request("/", {
      headers: {
        ...authHeaders(),
        accept: "text/html"
      }
    });

    expect(rootResponse.status).toBe(302);
    expect(rootResponse.headers.get("location")).toBe("/today");
    expect(pages.find((page) => page.path === "/today")?.body).toContain("Failed today");
    expect(pages.find((page) => page.path === "/runs")?.body).toContain("Implement the ledger API");
    expect(pages.find((page) => page.path === `/runs/${run.run.id}`)?.body).toContain(
      "Command failed"
    );
    expect(pages.find((page) => page.path === `/runs/${run.run.id}`)?.body).toContain(
      "src/routes/ledger.ts"
    );
    expect(pages.find((page) => page.path === `/runs/${run.run.id}`)?.body).toContain(
      "data/logs/ui-run.log"
    );
    expect(pages.find((page) => page.path === `/runs/${run.run.id}`)?.body).toContain(
      "Review failed UI run"
    );
    expect(pages.find((page) => page.path === "/open-loops")?.body).toContain(
      "Resolve production blocker"
    );
    expect(pages.find((page) => page.path === "/open-loops")?.body).toContain("Inspect failed run");
    expect(pages.find((page) => page.path === "/open-loops")?.body).toContain("Schedule follow-up");
    expect(pages.find((page) => page.path === "/open-loops")?.body).toContain(
      "Track deployment risk"
    );
    expect(pages.find((page) => page.path === "/projects/ice-council")?.body).toContain(
      "Recent handoffs"
    );
    expect(pages.find((page) => page.path === "/projects/ice-council")?.body).toContain(
      "Review failed UI run"
    );
    expect(pages.find((page) => page.path === "/decisions")?.body).toContain("Keep UI simple");
    expect(pages.find((page) => page.path === "/errors")?.body).toContain("Needs inspection");

    const resolveResponse = await app.request(`/open-loops/${loop.openLoop.id}/resolve`, {
      method: "POST",
      body: new URLSearchParams({ resolution: "Reviewed from test" }),
      headers: {
        ...authHeaders(),
        "content-type": "application/x-www-form-urlencoded"
      }
    });
    const resolvedList = (await (
      await app.request("/open-loops?project=ice-council&status=resolved", {
        headers: authHeaders()
      })
    ).json()) as { openLoops: Array<{ id: string; resolution: string }> };

    expect(resolveResponse.status).toBe(302);
    expect(resolveResponse.headers.get("location")).toBe("/open-loops");
    expect(resolvedList.openLoops).toEqual([
      expect.objectContaining({
        id: loop.openLoop.id,
        resolution: "Reviewed from test"
      })
    ]);
  });

  it("sends Discord notifications only for high-signal events", async () => {
    const fetchMock = vi.fn(async () => new Response("", { status: 204 }));
    vi.stubGlobal("fetch", fetchMock);
    const app = createTestApp(
      {},
      {
        notifications: {
          discord: {
            enabled: true,
            webhookUrl: "https://discord.test/webhook"
          }
        }
      }
    );
    const run = (await (
      await postJson(app, "/runs", {
        ...validRunRequest(),
        summary: "Investigate failing command"
      })
    ).json()) as { run: { id: string } };

    const lowSignal = await postJson(app, "/events", {
      runId: run.run.id,
      type: "progress",
      message: "Still working",
      importance: 2
    });
    const failed = await postJson(app, "/events", {
      runId: run.run.id,
      type: "failed",
      message: "Command failed",
      importance: 8,
      data: {
        changedFiles: ["src/cli/index.ts"]
      }
    });

    expect(lowSignal.status).toBe(201);
    expect(failed.status).toBe(201);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(fetchMock).toHaveBeenCalledWith(
      "https://discord.test/webhook",
      expect.objectContaining({
        method: "POST",
        body: expect.stringContaining("src/cli/index.ts")
      })
    );
  });

  it("does not fail journal writes when Discord notification delivery fails", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => {
        throw new Error("network down");
      })
    );
    const app = createTestApp(
      {},
      {
        notifications: {
          discord: {
            enabled: true,
            webhookUrl: "https://discord.test/webhook"
          }
        }
      }
    );
    const run = (await (await postJson(app, "/runs", validRunRequest())).json()) as {
      run: { id: string };
    };
    const response = await postJson(app, "/events", {
      runId: run.run.id,
      type: "needs_review",
      message: "Review required",
      importance: 7
    });

    expect(response.status).toBe(201);
    expect(await response.json()).toEqual({
      event: expect.objectContaining({
        type: "needs_review"
      })
    });
  });
});

function createTestApp(
  security: Partial<RuntrailConfig["security"]> = {},
  config: Partial<RuntrailConfig> = {}
): ReturnType<typeof createApp> {
  const db = new Database(":memory:");
  databases.push(db);
  migrate(db);
  const baseConfig = loadConfig();

  return createApp({
    db,
    config: {
      ...baseConfig,
      ...config,
      notifications: {
        ...baseConfig.notifications,
        ...config.notifications,
        discord: {
          ...baseConfig.notifications.discord,
          ...config.notifications?.discord
        }
      },
      security: {
        authRequired: true,
        token: "test-token",
        ...security
      }
    }
  });
}

function validRunRequest(): Record<string, string> {
  return {
    source: "codex",
    project: "ice-council",
    task: "Implement the ledger API",
    hostname: "agent-host",
    cwd: "/home/agent/dev/runtrail",
    gitRepoPath: "/home/agent/dev/runtrail",
    gitBranch: "feat/phase-2-runs-events-api",
    gitCommit: "abc123"
  };
}

async function postJson(
  app: ReturnType<typeof createApp>,
  path: string,
  body: unknown
): Promise<Response> {
  return app.request(path, {
    method: "POST",
    body: JSON.stringify(body),
    headers: authHeaders()
  });
}

function authHeaders(): Record<string, string> {
  return {
    "content-type": "application/json",
    authorization: "Bearer test-token"
  };
}
