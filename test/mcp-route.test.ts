import Database from "better-sqlite3";
import { afterEach, describe, expect, it, vi } from "vitest";
import { loadConfig, type RuntrailConfig } from "../src/config.js";
import { migrate } from "../src/db/migrate.js";
import { createApp } from "../src/index.js";

const databases: Database.Database[] = [];

describe("remote mcp route", () => {
  afterEach(() => {
    for (const db of databases) {
      db.close();
    }

    databases.length = 0;
    vi.unstubAllGlobals();
  });

  it("requires bearer auth when auth is enabled", async () => {
    const app = createTestApp();

    const response = await app.request("/mcp", {
      method: "POST",
      headers: {
        accept: "application/json, text/event-stream",
        "content-type": "application/json"
      },
      body: JSON.stringify(initializeRequest())
    });

    expect(response.status).toBe(401);
    expect(await response.json()).toEqual({ error: "Unauthorized" });
  });

  it("answers initialize over Streamable HTTP", async () => {
    const app = createTestApp();

    const response = await app.request("/mcp", {
      method: "POST",
      headers: {
        accept: "application/json, text/event-stream",
        authorization: "Bearer test-token",
        "content-type": "application/json"
      },
      body: JSON.stringify(initializeRequest())
    });

    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body).toEqual(
      expect.objectContaining({
        id: 1,
        jsonrpc: "2.0",
        result: expect.objectContaining({
          serverInfo: expect.objectContaining({
            name: "runtrail"
          })
        })
      })
    );
  });
});

function createTestApp(security: Partial<RuntrailConfig["security"]> = {}) {
  const db = new Database(":memory:");
  databases.push(db);
  migrate(db);
  const baseConfig = loadConfig();

  return createApp({
    db,
    config: {
      ...baseConfig,
      url: "http://runtrail.test",
      security: {
        authRequired: true,
        token: "test-token",
        ...security
      }
    }
  });
}

function initializeRequest() {
  return {
    jsonrpc: "2.0",
    id: 1,
    method: "initialize",
    params: {
      protocolVersion: "2025-06-18",
      capabilities: {},
      clientInfo: {
        name: "runtrail-test",
        version: "0.0.0"
      }
    }
  };
}
