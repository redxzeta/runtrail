import Database from "better-sqlite3";
import { afterEach, describe, expect, it } from "vitest";
import { loadConfig, type RuntrailConfig } from "../src/config.js";
import { migrate } from "../src/db/migrate.js";
import { createApp } from "../src/index.js";

const databases: Database.Database[] = [];

afterEach(() => {
  while (databases.length > 0) {
    databases.pop()?.close();
  }
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
      createdAt: "2026-06-26T09:30:00.000Z",
      data: {
        files: ["src/index.ts"]
      }
    });

    expect(eventResponse.status).toBe(201);
    const created = (await eventResponse.json()) as {
      event: { id: string; runId: string; data: { files: string[] } };
    };
    expect(created.event.id).toMatch(/^evt_/);
    expect(created.event.runId).toBe(run.run.id);
    expect(created.event.data.files).toEqual(["src/index.ts"]);

    const fetchedResponse = await app.request(`/runs/${run.run.id}`, {
      headers: authHeaders()
    });
    const fetched = (await fetchedResponse.json()) as {
      run: { updatedAt: string };
      events: Array<{ id: string; message: string }>;
    };

    expect(fetched.run.updatedAt).toBe("2026-06-26T09:30:00.000Z");
    expect(fetched.events).toEqual([
      expect.objectContaining({
        id: created.event.id,
        message: "Read the route patterns"
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
    const createdResponse = await postJson(app, "/open-loops", {
      type: "blocked",
      project: "runtrail",
      title: "Need API decision",
      description: "Choose the lifecycle shape",
      createdAt: "2026-06-26T10:00:00.000Z"
    });

    expect(createdResponse.status).toBe(201);
    const created = (await createdResponse.json()) as {
      openLoop: { id: string; status: string; type: string; project: string };
    };
    expect(created.openLoop.id).toMatch(/^loop_/);
    expect(created.openLoop.status).toBe("open");
    expect(created.openLoop.type).toBe("blocked");
    expect(created.openLoop.project).toBe("runtrail");

    const openListResponse = await app.request("/open-loops?project=runtrail", {
      headers: authHeaders()
    });
    const openList = (await openListResponse.json()) as {
      openLoops: Array<{ id: string; status: string }>;
    };

    expect(openListResponse.status).toBe(200);
    expect(openList.openLoops).toEqual([
      expect.objectContaining({
        id: created.openLoop.id,
        status: "open"
      })
    ]);

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

    expect(defaultList.openLoops).toEqual([]);
    expect(resolvedList.openLoops).toEqual([
      expect.objectContaining({
        id: created.openLoop.id
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

    expect(invalidLoop.status).toBe(400);
    expect(await invalidLoop.json()).toEqual(
      expect.objectContaining({
        error: "Invalid request"
      })
    );
    expect(missingLoop.status).toBe(404);
    expect(await missingLoop.json()).toEqual({ error: "Open loop not found" });
    expect(invalidDecision.status).toBe(400);
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
      type: "blocked",
      message: "needs operator input",
      importance: 7,
      createdAt: "2026-06-26T10:05:00.000Z"
    });
    await postJson(app, "/open-loops", {
      type: "blocked",
      project: "ice-council",
      title: "Confirm live host path"
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

    const response = await app.request("/agent/context?project=ice-council&min_importance=4", {
      headers: authHeaders()
    });
    const context = (await response.json()) as {
      project: string;
      recent_runs: Array<{ id: string }>;
      recent_events: Array<{ message: string }>;
      open_loops: Array<{ title: string }>;
      decisions: Array<{ title: string }>;
      next_actions: string[];
    };

    expect(response.status).toBe(200);
    expect(context.project).toBe("ice-council");
    expect(context.recent_runs).toEqual([expect.objectContaining({ id: run.run.id })]);
    expect(context.recent_events).toEqual([
      expect.objectContaining({ message: "needs operator input" })
    ]);
    expect(context.open_loops).toEqual([
      expect.objectContaining({ title: "Confirm live host path" })
    ]);
    expect(context.decisions.map((decision) => decision.title)).toEqual([
      "Use concise context",
      "Global retention policy"
    ]);
    expect(context.next_actions).toEqual(["Confirm live host path"]);
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
      importance: 8
    });
    await app.request(`/runs/${run.run.id}`, {
      method: "PATCH",
      body: JSON.stringify({ status: "failed", summary: "Needs inspection" }),
      headers: authHeaders()
    });
    await postJson(app, "/open-loops", {
      type: "blocked",
      project: "ice-council",
      title: "Resolve production blocker"
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
        "/",
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

    expect(pages.find((page) => page.path === "/runs")?.body).toContain("Implement the ledger API");
    expect(pages.find((page) => page.path === `/runs/${run.run.id}`)?.body).toContain(
      "Command failed"
    );
    expect(pages.find((page) => page.path === "/open-loops")?.body).toContain(
      "Resolve production blocker"
    );
    expect(pages.find((page) => page.path === "/decisions")?.body).toContain("Keep UI simple");
    expect(pages.find((page) => page.path === "/errors")?.body).toContain("Needs inspection");
  });
});

function createTestApp(
  security: Partial<RuntrailConfig["security"]> = {}
): ReturnType<typeof createApp> {
  const db = new Database(":memory:");
  databases.push(db);
  migrate(db);

  return createApp({
    db,
    config: {
      ...loadConfig(),
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
