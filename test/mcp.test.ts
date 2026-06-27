import { describe, expect, it, vi } from "vitest";
import { callRuntrailTool, createRuntrailMcpServer, runtrailToolNames } from "../src/mcp/index.js";

describe("mcp adapter", () => {
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
});

function mockClient(result: unknown) {
  return {
    requestJson: vi.fn(async () => result)
  };
}
