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
