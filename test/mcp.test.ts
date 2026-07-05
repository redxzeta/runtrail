import { afterEach, describe, expect, it, vi } from "vitest";
import { createRuntrailMcpBridgeServer, loadBridgeConfig } from "../src/mcp/bridge.js";
import {
  callRuntrailTool,
  createHttpClient,
  createRuntrailMcpServer,
  runtrailToolNames
} from "../src/mcp/index.js";

describe("mcp adapter", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it("constructs the MCP server with the requested tool set", () => {
    const server = createRuntrailMcpServer(mockClient({ ok: true }));

    expect(server).toBeDefined();
    expect(runtrailToolNames).toEqual([
      "journal_get_context",
      "journal_create_event",
      "journal_create_open_loop",
      "journal_resolve_open_loop",
      "journal_record_decision",
      "journal_search_runs"
    ]);
  });

  it("constructs the default server from env without requiring a config file", () => {
    vi.stubEnv("RUNTRAIL_URL", "http://runtrail.test");
    vi.stubEnv("RUNTRAIL_TOKEN", "secret-token");
    vi.stubEnv("RUNTRAIL_CONFIG", "/tmp/runtrail-missing-config.yaml");

    expect(() => createRuntrailMcpServer()).not.toThrow();
  });

  it("maps context and search tools to HTTP GET requests", async () => {
    const client = mockClient({ ok: true });

    await callRuntrailTool(
      "journal_get_context",
      {
        project: "runtrail",
        limit: 5,
        min_importance: 4
      },
      client
    );
    await callRuntrailTool(
      "journal_search_runs",
      {
        project: "runtrail",
        status: "failed",
        limit: 10
      },
      client
    );

    expect(client.requestJson).toHaveBeenNthCalledWith(
      1,
      "/agent/context?project=runtrail&limit=5&min_importance=4"
    );
    expect(client.requestJson).toHaveBeenNthCalledWith(
      2,
      "/runs?project=runtrail&status=failed&limit=10"
    );
  });

  it("maps write tools to existing HTTP API endpoints", async () => {
    const client = mockClient({ ok: true });

    await callRuntrailTool(
      "journal_create_event",
      {
        runId: "run_1",
        type: "completed",
        message: "Done",
        importance: 5,
        data: { changedFiles: ["README.md"] }
      },
      client
    );
    await callRuntrailTool(
      "journal_create_open_loop",
      {
        type: "blocked",
        project: "runtrail",
        title: "Need decision"
      },
      client
    );
    await callRuntrailTool(
      "journal_resolve_open_loop",
      {
        id: "loop_1",
        resolution: "Resolved"
      },
      client
    );
    await callRuntrailTool(
      "journal_record_decision",
      {
        project: "runtrail",
        title: "Use HTTP adapter",
        decision: "MCP calls the API"
      },
      client
    );

    expect(client.requestJson).toHaveBeenNthCalledWith(
      1,
      "/events",
      expect.objectContaining({ method: "POST" })
    );
    expect(client.requestJson).toHaveBeenNthCalledWith(
      2,
      "/open-loops",
      expect.objectContaining({ method: "POST" })
    );
    expect(client.requestJson).toHaveBeenNthCalledWith(
      3,
      "/open-loops/loop_1",
      expect.objectContaining({
        method: "PATCH",
        body: {
          status: "resolved",
          resolution: "Resolved"
        }
      })
    );
    expect(client.requestJson).toHaveBeenNthCalledWith(
      4,
      "/decisions",
      expect.objectContaining({ method: "POST" })
    );
  });

  it("builds the HTTP client from URL and token without loading YAML", async () => {
    const fetchMock = vi.fn(async () => {
      return new Response(JSON.stringify({ ok: true }), { status: 200 });
    });
    vi.stubGlobal("fetch", fetchMock);
    const client = createHttpClient({
      url: "http://runtrail.test",
      security: {
        authRequired: true,
        token: "secret-token"
      }
    });

    await client.requestJson("/health");

    const [, init] = fetchMock.mock.calls[0] as unknown as [URL, { headers: Headers }];
    expect(fetchMock).toHaveBeenCalledWith(new URL("/health", "http://runtrail.test"), init);
    expect(init.headers.get("authorization")).toBe("Bearer secret-token");
  });

  it("constructs the bridge server with the Runtrail tool set", () => {
    const server = createRuntrailMcpBridgeServer({
      callTool: vi.fn()
    });

    expect(server).toBeDefined();
    expect(runtrailToolNames).toHaveLength(6);
  });

  it("fails fast when bridge config is missing", () => {
    expect(() => loadBridgeConfig({ RUNTRAIL_TOKEN: "secret-token" })).toThrow(
      "RUNTRAIL_MCP_URL is required"
    );
    expect(() => loadBridgeConfig({ RUNTRAIL_MCP_URL: "http://runtrail.test/mcp" })).toThrow(
      "RUNTRAIL_TOKEN is required"
    );
  });
});

function mockClient(result: unknown) {
  return {
    requestJson: vi.fn(async () => result)
  };
}
