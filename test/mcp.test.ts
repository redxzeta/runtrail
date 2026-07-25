import { afterEach, describe, expect, it, vi } from "vitest";
import { createRuntrailMcpBridgeServer, loadBridgeConfig } from "../src/mcp/bridge.js";
import {
  callRuntrailTool,
  createHttpClient,
  createRuntrailMcpServer,
  runtrailToolNames
} from "../src/mcp/index.js";
import { mcpToolInputSchemas } from "../src/mcp/toolSchemas.js";

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
      "journal_start_run",
      "journal_resume_run",
      "journal_heartbeat_run",
      "journal_pause_run",
      "journal_finish_run",
      "journal_get_context",
      "journal_prepare_work",
      "journal_create_event",
      "journal_record_verification",
      "journal_create_open_loop",
      "journal_resolve_open_loop",
      "journal_record_decision",
      "journal_list_decisions",
      "journal_create_handoff",
      "journal_list_pending_handoffs",
      "journal_accept_handoff",
      "journal_decline_handoff",
      "journal_complete_handoff",
      "journal_expire_handoff",
      "journal_get_run_manifest",
      "journal_get_workflow",
      "journal_get_workflow_review_packet",
      "journal_get_capabilities",
      "journal_search",
      "journal_search_runs"
    ]);
  });

  it("maps explicit lifecycle tools to narrow HTTP endpoints", async () => {
    const client = mockClient({ run: { id: "run_1" } });
    await callRuntrailTool(
      "journal_start_run",
      {
        source: "codex",
        project: "runtrail",
        clientRunId: "s1",
        workKey: "github:redxzeta/runtrail#110",
        workflowId: "workflow-112",
        parentRunId: "run_parent",
        continuedFromRunId: "run_previous",
        task: "work"
      },
      client
    );
    await callRuntrailTool("journal_resume_run", { runId: "run_1", expectedVersion: 2 }, client);
    await callRuntrailTool("journal_heartbeat_run", { runId: "run_1", expectedVersion: 3 }, client);
    await callRuntrailTool(
      "journal_pause_run",
      { runId: "run_1", expectedVersion: 4, status: "needs_review", summary: "Review" },
      client
    );
    await callRuntrailTool(
      "journal_finish_run",
      { runId: "run_1", expectedVersion: 5, status: "completed", summary: "Done" },
      client
    );

    expect(client.requestJson.mock.calls).toEqual([
      [
        "/runs",
        {
          method: "POST",
          body: {
            source: "codex",
            project: "runtrail",
            clientRunId: "s1",
            workKey: "github:redxzeta/runtrail#110",
            workflowId: "workflow-112",
            parentRunId: "run_parent",
            continuedFromRunId: "run_previous",
            task: "work"
          }
        }
      ],
      ["/runs/run_1/resume", { method: "POST", body: { expectedVersion: 2 } }],
      ["/runs/run_1/heartbeat", { method: "POST", body: { expectedVersion: 3 } }],
      [
        "/runs/run_1/pause",
        {
          method: "POST",
          body: { expectedVersion: 4, status: "needs_review", summary: "Review" }
        }
      ],
      [
        "/runs/run_1/finish",
        { method: "POST", body: { expectedVersion: 5, status: "completed", summary: "Done" } }
      ]
    ]);
  });

  it("reuses strict shared schemas and bounds list limits", () => {
    expect(mcpToolInputSchemas.event.type.safeParse("not-an-event").success).toBe(false);
    expect(mcpToolInputSchemas.openLoop.type.safeParse("not-a-loop").success).toBe(false);
    expect(mcpToolInputSchemas.runSearch.status.safeParse("not-a-status").success).toBe(false);
    expect(mcpToolInputSchemas.journalSearch.limit.safeParse(51).success).toBe(false);
    expect(mcpToolInputSchemas.journalSearch.limit.safeParse(50).success).toBe(true);
    expect(mcpToolInputSchemas.runId.expectedVersion.safeParse(0).success).toBe(false);
    expect(mcpToolInputSchemas.runId.expectedVersion.safeParse(1).success).toBe(true);
    expect(mcpToolInputSchemas.prepareWork.limit.safeParse(21).success).toBe(false);
  });

  it("maps prepare-work to the bounded HTTP read", async () => {
    const client = mockClient({ project: "runtrail" });

    await callRuntrailTool(
      "journal_prepare_work",
      {
        project: "runtrail",
        source: "codex",
        workKey: "github:redxzeta/runtrail#114",
        runId: "run_1",
        category: "implementation",
        tags: ["agent", "context"],
        limit: 5
      },
      client
    );

    expect(client.requestJson).toHaveBeenCalledWith(
      "/agent/prepare-work?project=runtrail&source=codex&workKey=github%3Aredxzeta%2Fruntrail%23114&runId=run_1&category=implementation&tag=agent&tag=context&limit=5"
    );
  });

  it("constructs the default server from env without requiring a config file", () => {
    vi.stubEnv("RUNTRAIL_URL", "http://runtrail.test");
    vi.stubEnv("RUNTRAIL_TOKEN", "secret-token");
    vi.stubEnv("RUNTRAIL_CONFIG", "/tmp/runtrail-missing-config.yaml");

    expect(() => createRuntrailMcpServer()).not.toThrow();
  });

  it("maps context and search tools to HTTP GET requests", async () => {
    const readiness = {
      status: "ready_for_review",
      reasonCodes: ["workflow_ready_for_review"],
      findings: [],
      nextActions: [],
      asOf: "2026-07-25T19:00:00.000Z"
    };
    const client = mockClient({ readiness });

    await callRuntrailTool(
      "journal_get_context",
      {
        project: "runtrail",
        limit: 5,
        min_importance: 4,
        cursor: "cursor-1"
      },
      client
    );
    await callRuntrailTool(
      "journal_search",
      {
        project: "runtrail",
        source: "codex",
        status: "failed",
        category: "implementation",
        tag: "mcp",
        text: "handoff",
        date_from: "2026-07-01T00:00:00.000Z",
        date_to: "2026-07-02T00:00:00.000Z",
        effectiveOnly: true,
        limit: 10
      },
      client
    );
    await callRuntrailTool(
      "journal_search_runs",
      {
        project: "runtrail",
        workKey: "github:redxzeta/runtrail#110",
        status: "failed",
        category: "implementation",
        tag: "mcp",
        limit: 10
      },
      client
    );
    const workflow = await callRuntrailTool(
      "journal_get_workflow",
      {
        workflowId: "workflow-112",
        project: "runtrail",
        limit: 10
      },
      client
    );
    const packet = await callRuntrailTool(
      "journal_get_workflow_review_packet",
      {
        workflowId: "workflow-112",
        project: "runtrail",
        limit: 10
      },
      client
    );
    const capabilities = await callRuntrailTool("journal_get_capabilities", {}, client);

    expect(client.requestJson).toHaveBeenNthCalledWith(
      1,
      "/agent/context?project=runtrail&limit=5&min_importance=4&cursor=cursor-1"
    );
    expect(client.requestJson).toHaveBeenNthCalledWith(
      2,
      "/search?project=runtrail&source=codex&status=failed&category=implementation&tag=mcp&text=handoff&date_from=2026-07-01T00%3A00%3A00.000Z&date_to=2026-07-02T00%3A00%3A00.000Z&effectiveOnly=true&limit=10"
    );
    expect(client.requestJson).toHaveBeenNthCalledWith(
      3,
      "/runs?project=runtrail&workKey=github%3Aredxzeta%2Fruntrail%23110&status=failed&category=implementation&tag=mcp&limit=10"
    );
    expect(client.requestJson).toHaveBeenNthCalledWith(
      4,
      "/workflows/workflow-112/runs?project=runtrail&limit=10"
    );
    expect(workflow).toEqual({ readiness });
    expect(client.requestJson).toHaveBeenNthCalledWith(
      5,
      "/workflows/workflow-112/review-packet?project=runtrail&limit=10"
    );
    expect(packet).toEqual({ readiness });
    expect(client.requestJson).toHaveBeenNthCalledWith(6, "/meta/capabilities");
    expect(capabilities).toEqual({ readiness });
  });

  it("maps write tools to existing HTTP API endpoints", async () => {
    const client = mockClient({ ok: true });

    await callRuntrailTool(
      "journal_create_event",
      {
        runId: "run_1",
        clientRecordId: "event-mcp-1",
        type: "completed",
        message: "Done",
        importance: 5,
        category: "implementation",
        tags: ["mcp", "docs"],
        data: { changedFiles: ["README.md"] }
      },
      client
    );
    await callRuntrailTool(
      "journal_create_open_loop",
      {
        type: "blocked",
        project: "runtrail",
        clientRecordId: "loop-mcp-1",
        title: "Need decision",
        description: "Choose lifecycle shape",
        owner: "maintainer",
        source: "codex",
        nextAction: "Review proposal",
        blockerRef: "issue-105",
        sourceRunId: "run_1"
      },
      client
    );
    await callRuntrailTool(
      "journal_record_verification",
      {
        runId: "run_1",
        clientRecordId: "verification-mcp-1",
        checkId: "unit",
        kind: "test",
        outcome: "passed",
        name: "unit tests",
        support: { type: "exit_code", exitCode: 0 },
        completedAt: "2026-07-01T00:00:00.000Z"
      },
      client
    );
    await callRuntrailTool(
      "journal_resolve_open_loop",
      {
        id: "loop_1",
        expectedVersion: 3,
        resolution: "Resolved"
      },
      client
    );
    await callRuntrailTool(
      "journal_record_decision",
      {
        project: "runtrail",
        clientRecordId: "decision-mcp-1",
        supersedesDecisionId: "dec_previous",
        title: "Use HTTP adapter",
        decision: "MCP calls the API"
      },
      client
    );
    await callRuntrailTool(
      "journal_create_handoff",
      {
        sourceRunId: "run_1",
        clientRecordId: "handoff-mcp-1",
        fromSource: "codex",
        toSource: "openclaw",
        project: "runtrail",
        summary: "Continue MCP docs",
        nextAction: "Verify OpenClaw tool filter",
        category: "implementation",
        tags: ["mcp", "docs"],
        context: { changedFiles: ["README.md"] }
      },
      client
    );
    await callRuntrailTool(
      "journal_get_run_manifest",
      {
        runId: "run_1"
      },
      client
    );

    expect(client.requestJson).toHaveBeenNthCalledWith(
      1,
      "/events",
      expect.objectContaining({
        method: "POST",
        body: expect.objectContaining({
          category: "implementation",
          clientRecordId: "event-mcp-1",
          tags: ["mcp", "docs"]
        })
      })
    );
    expect(client.requestJson).toHaveBeenNthCalledWith(2, "/open-loops", {
      method: "POST",
      body: {
        type: "blocked",
        project: "runtrail",
        clientRecordId: "loop-mcp-1",
        title: "Need decision",
        description: "Choose lifecycle shape",
        owner: "maintainer",
        source: "codex",
        nextAction: "Review proposal",
        blockerRef: "issue-105",
        sourceRunId: "run_1"
      }
    });
    expect(client.requestJson).toHaveBeenNthCalledWith(
      3,
      "/verifications",
      expect.objectContaining({
        method: "POST",
        body: expect.objectContaining({
          clientRecordId: "verification-mcp-1",
          support: { type: "exit_code", exitCode: 0 }
        })
      })
    );
    expect(client.requestJson).toHaveBeenNthCalledWith(
      4,
      "/open-loops/loop_1",
      expect.objectContaining({
        method: "PATCH",
        body: {
          status: "resolved",
          resolution: "Resolved",
          expectedVersion: 3
        }
      })
    );
    expect(client.requestJson).toHaveBeenNthCalledWith(
      5,
      "/decisions",
      expect.objectContaining({
        method: "POST",
        body: {
          project: "runtrail",
          clientRecordId: "decision-mcp-1",
          supersedesDecisionId: "dec_previous",
          title: "Use HTTP adapter",
          decision: "MCP calls the API"
        }
      })
    );
    expect(client.requestJson).toHaveBeenNthCalledWith(
      6,
      "/handoffs",
      expect.objectContaining({
        method: "POST",
        body: {
          sourceRunId: "run_1",
          clientRecordId: "handoff-mcp-1",
          fromSource: "codex",
          toSource: "openclaw",
          project: "runtrail",
          summary: "Continue MCP docs",
          nextAction: "Verify OpenClaw tool filter",
          category: "implementation",
          tags: ["mcp", "docs"],
          context: { changedFiles: ["README.md"] }
        }
      })
    );
    expect(client.requestJson).toHaveBeenNthCalledWith(7, "/runs/run_1/manifest");
  });

  it("maps effective decision reads to the bounded HTTP endpoint", async () => {
    const client = mockClient({ decisions: [] });

    await callRuntrailTool(
      "journal_list_decisions",
      { project: "runtrail", includeGlobal: false, effectiveOnly: true, limit: 5 },
      client
    );

    expect(client.requestJson).toHaveBeenCalledWith(
      "/decisions?project=runtrail&includeGlobal=false&effectiveOnly=true&limit=5"
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

  it("maps handoff lifecycle tools to versioned HTTP endpoints", async () => {
    const client = mockClient({ handoff: { id: "handoff_1" } });

    await callRuntrailTool(
      "journal_list_pending_handoffs",
      { project: "runtrail", toSource: "openclaw", limit: 5 },
      client
    );
    await callRuntrailTool(
      "journal_accept_handoff",
      {
        id: "handoff_1",
        expectedVersion: 1,
        acceptedBy: "openclaw-agent",
        targetRunId: "run_2"
      },
      client
    );
    await callRuntrailTool(
      "journal_decline_handoff",
      { id: "handoff_2", expectedVersion: 1, reason: "Unavailable" },
      client
    );
    await callRuntrailTool(
      "journal_complete_handoff",
      { id: "handoff_1", expectedVersion: 2 },
      client
    );
    await callRuntrailTool(
      "journal_expire_handoff",
      { id: "handoff_3", expectedVersion: 1 },
      client
    );

    expect(client.requestJson).toHaveBeenNthCalledWith(
      1,
      "/handoffs?project=runtrail&toSource=openclaw&limit=5"
    );
    expect(client.requestJson).toHaveBeenNthCalledWith(2, "/handoffs/handoff_1/accept", {
      method: "POST",
      body: {
        expectedVersion: 1,
        acceptedBy: "openclaw-agent",
        targetRunId: "run_2"
      }
    });
    expect(client.requestJson).toHaveBeenNthCalledWith(3, "/handoffs/handoff_2/decline", {
      method: "POST",
      body: { expectedVersion: 1, reason: "Unavailable" }
    });
    expect(client.requestJson).toHaveBeenNthCalledWith(4, "/handoffs/handoff_1/complete", {
      method: "POST",
      body: { expectedVersion: 2 }
    });
    expect(client.requestJson).toHaveBeenNthCalledWith(5, "/handoffs/handoff_3/expire", {
      method: "POST",
      body: { expectedVersion: 1 }
    });
  });

  it("preserves bounded API diagnostics without exposing authorization secrets", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(
        async () =>
          new Response(
            JSON.stringify({
              error: "Invalid request using secret-token or Bearer leaked-value",
              issues: [{ path: ["type"], message: "Invalid enum value" }]
            }),
            { status: 400 }
          )
      )
    );
    const client = createHttpClient({
      url: "http://runtrail.test",
      security: { authRequired: true, token: "secret-token" }
    });

    await expect(client.requestJson("/events")).rejects.toThrow(
      "Runtrail GET /events HTTP 400 (validation): Invalid request using [REDACTED] or Bearer [REDACTED] type: Invalid enum value"
    );
  });

  it("constructs the bridge server with the Runtrail tool set", () => {
    const server = createRuntrailMcpBridgeServer({
      callTool: vi.fn()
    });

    expect(server).toBeDefined();
    expect(runtrailToolNames).toHaveLength(25);
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
