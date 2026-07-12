#!/usr/bin/env node
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { CallToolResultSchema } from "@modelcontextprotocol/sdk/types.js";
import {
  fetchWithTimeout,
  formatClientFailure,
  readRequestTimeoutMs,
  safePath
} from "../shared/httpClient.js";
import type { runtrailToolNames } from "./index.js";
import { mcpToolInputSchemas } from "./toolSchemas.js";

type RemoteRuntrailClient = Pick<Client, "callTool">;

export function createRuntrailMcpBridgeServer(client: RemoteRuntrailClient): McpServer {
  const server = new McpServer({
    name: "runtrail-mcp-bridge",
    version: "1.0.0"
  });

  for (const tool of [
    ["journal_start_run", mcpToolInputSchemas.startRun],
    ["journal_resume_run", mcpToolInputSchemas.runId],
    ["journal_heartbeat_run", mcpToolInputSchemas.runId],
    ["journal_pause_run", mcpToolInputSchemas.pauseRun],
    ["journal_finish_run", mcpToolInputSchemas.finishRun]
  ] as const) {
    server.registerTool(
      tool[0],
      {
        title: tool[0],
        description: "Manage an explicit Runtrail run lifecycle transition",
        inputSchema: tool[1]
      },
      async (args: Record<string, unknown>) => await forwardTool(client, tool[0], args)
    );
  }

  server.registerTool(
    "journal_get_context",
    {
      title: "Get Runtrail context",
      description: "Get compact project context from Runtrail",
      inputSchema: mcpToolInputSchemas.context
    },
    async (args) => await forwardTool(client, "journal_get_context", args)
  );

  server.registerTool(
    "journal_create_event",
    {
      title: "Create Runtrail event",
      description: "Create an event for an existing Runtrail run",
      inputSchema: mcpToolInputSchemas.event
    },
    async (args) => await forwardTool(client, "journal_create_event", args)
  );

  server.registerTool(
    "journal_create_open_loop",
    {
      title: "Create Runtrail open loop",
      description: "Create an open loop in Runtrail",
      inputSchema: mcpToolInputSchemas.openLoop
    },
    async (args) => await forwardTool(client, "journal_create_open_loop", args)
  );

  server.registerTool(
    "journal_resolve_open_loop",
    {
      title: "Resolve Runtrail open loop",
      description: "Resolve an existing open loop in Runtrail",
      inputSchema: mcpToolInputSchemas.resolveOpenLoop
    },
    async (args) => await forwardTool(client, "journal_resolve_open_loop", args)
  );

  server.registerTool(
    "journal_record_decision",
    {
      title: "Record Runtrail decision",
      description: "Record a project or global decision in Runtrail",
      inputSchema: mcpToolInputSchemas.decision
    },
    async (args) => await forwardTool(client, "journal_record_decision", args)
  );

  server.registerTool(
    "journal_search_runs",
    {
      title: "Search Runtrail runs",
      description: "Search recent Runtrail runs",
      inputSchema: mcpToolInputSchemas.runSearch
    },
    async (args) => await forwardTool(client, "journal_search_runs", args)
  );

  server.registerTool(
    "journal_create_handoff",
    {
      title: "Create Runtrail handoff",
      description: "Create a handoff for another agent or source",
      inputSchema: mcpToolInputSchemas.handoff
    },
    async (args) => await forwardTool(client, "journal_create_handoff", args)
  );

  server.registerTool(
    "journal_get_run_manifest",
    {
      title: "Get Runtrail run manifest",
      description: "Get compact linked records for one Runtrail run",
      inputSchema: mcpToolInputSchemas.manifest
    },
    async (args) => await forwardTool(client, "journal_get_run_manifest", args)
  );

  server.registerTool(
    "journal_search",
    {
      title: "Search Runtrail journal",
      description: "Search Runtrail runs, events, open loops, handoffs, and decisions",
      inputSchema: mcpToolInputSchemas.journalSearch
    },
    async (args) => await forwardTool(client, "journal_search", args)
  );

  return server;
}

async function forwardTool(
  client: RemoteRuntrailClient,
  name: (typeof runtrailToolNames)[number],
  args: Record<string, unknown>
) {
  const result = await client.callTool({
    name,
    arguments: args
  });

  return CallToolResultSchema.parse(result);
}

async function start(): Promise<void> {
  const { token, url } = loadBridgeConfig();
  const timeoutMs = readRequestTimeoutMs();
  const remoteTransport = new StreamableHTTPClientTransport(new URL(url), {
    fetch: (input: string | URL, init: RequestInit = {}) => bridgeFetch(input, init, timeoutMs),
    requestInit: {
      headers: {
        accept: "application/json, text/event-stream",
        authorization: `Bearer ${token}`
      }
    }
  });
  const client = new Client({
    name: "runtrail-mcp-bridge",
    version: "1.0.0"
  });

  await client.connect(remoteTransport);
  const server = createRuntrailMcpBridgeServer(client);
  await server.connect(new StdioServerTransport());
}

async function bridgeFetch(
  url: string | URL,
  init: RequestInit,
  timeoutMs: number
): Promise<Response> {
  try {
    return await fetchWithTimeout(url, init, timeoutMs);
  } catch (error) {
    throw formatClientFailure(error, timeoutMs, {
      method: init.method ?? "GET",
      path: safePath(url)
    });
  }
}

export function loadBridgeConfig(
  env: Partial<Record<"RUNTRAIL_MCP_URL" | "RUNTRAIL_TOKEN", string>> = process.env
): { token: string; url: string } {
  return {
    url: requiredEnv(env, "RUNTRAIL_MCP_URL"),
    token: requiredEnv(env, "RUNTRAIL_TOKEN")
  };
}

function requiredEnv(
  env: Partial<Record<"RUNTRAIL_MCP_URL" | "RUNTRAIL_TOKEN", string>>,
  name: "RUNTRAIL_MCP_URL" | "RUNTRAIL_TOKEN"
): string {
  const value = env[name];

  if (!value || value.trim().length === 0) {
    throw new Error(`${name} is required`);
  }

  return value;
}

if (import.meta.url === `file://${process.argv[1]}`) {
  start().catch((error: unknown) => {
    const message = error instanceof Error ? error.message : String(error);
    console.error(message);
    process.exit(1);
  });
}
