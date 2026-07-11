#!/usr/bin/env node
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { CallToolResultSchema } from "@modelcontextprotocol/sdk/types.js";
import { z } from "zod";
import type { runtrailToolNames } from "./index.js";

type RemoteRuntrailClient = Pick<Client, "callTool">;
const bridgeFetchTimeoutMs = 5_000;

export function createRuntrailMcpBridgeServer(client: RemoteRuntrailClient): McpServer {
  const server = new McpServer({
    name: "runtrail-mcp-bridge",
    version: "1.0.0"
  });

  server.registerTool(
    "journal_get_context",
    {
      title: "Get Runtrail context",
      description: "Get compact project context from Runtrail",
      inputSchema: {
        project: z.string(),
        limit: z.number().int().positive().optional(),
        min_importance: z.number().int().min(0).max(10).optional()
      }
    },
    async (args) => await forwardTool(client, "journal_get_context", args)
  );

  server.registerTool(
    "journal_create_event",
    {
      title: "Create Runtrail event",
      description: "Create an event for an existing Runtrail run",
      inputSchema: {
        runId: z.string(),
        type: z.string(),
        message: z.string(),
        importance: z.number().int().min(0).max(10).optional(),
        category: z.string().optional(),
        tags: z.array(z.string()).optional(),
        data: z.record(z.string(), z.unknown()).optional()
      }
    },
    async (args) => await forwardTool(client, "journal_create_event", args)
  );

  server.registerTool(
    "journal_create_open_loop",
    {
      title: "Create Runtrail open loop",
      description: "Create an open loop in Runtrail",
      inputSchema: {
        type: z.string(),
        project: z.string(),
        title: z.string(),
        description: z.string().optional(),
        owner: z.string().optional(),
        source: z.string().optional(),
        nextAction: z.string().optional(),
        blockerRef: z.string().optional(),
        sourceRunId: z.string().optional()
      }
    },
    async (args) => await forwardTool(client, "journal_create_open_loop", args)
  );

  server.registerTool(
    "journal_resolve_open_loop",
    {
      title: "Resolve Runtrail open loop",
      description: "Resolve an existing open loop in Runtrail",
      inputSchema: {
        id: z.string(),
        resolution: z.string().optional()
      }
    },
    async (args) => await forwardTool(client, "journal_resolve_open_loop", args)
  );

  server.registerTool(
    "journal_record_decision",
    {
      title: "Record Runtrail decision",
      description: "Record a project or global decision in Runtrail",
      inputSchema: {
        project: z.string().optional(),
        title: z.string(),
        decision: z.string(),
        rationale: z.string().optional()
      }
    },
    async (args) => await forwardTool(client, "journal_record_decision", args)
  );

  server.registerTool(
    "journal_search_runs",
    {
      title: "Search Runtrail runs",
      description: "Search recent Runtrail runs",
      inputSchema: {
        project: z.string().optional(),
        status: z.string().optional(),
        category: z.string().optional(),
        tag: z.string().optional(),
        limit: z.number().int().positive().optional()
      }
    },
    async (args) => await forwardTool(client, "journal_search_runs", args)
  );

  server.registerTool(
    "journal_create_handoff",
    {
      title: "Create Runtrail handoff",
      description: "Create a handoff for another agent or source",
      inputSchema: {
        fromSource: z.string(),
        project: z.string(),
        summary: z.string(),
        sourceRunId: z.string().optional(),
        toSource: z.string().optional(),
        nextAction: z.string().optional(),
        category: z.string().optional(),
        tags: z.array(z.string()).optional(),
        context: z.record(z.string(), z.unknown()).optional()
      }
    },
    async (args) => await forwardTool(client, "journal_create_handoff", args)
  );

  server.registerTool(
    "journal_get_run_manifest",
    {
      title: "Get Runtrail run manifest",
      description: "Get compact linked records for one Runtrail run",
      inputSchema: {
        runId: z.string()
      }
    },
    async (args) => await forwardTool(client, "journal_get_run_manifest", args)
  );

  server.registerTool(
    "journal_search",
    {
      title: "Search Runtrail journal",
      description: "Search Runtrail runs, events, open loops, handoffs, and decisions",
      inputSchema: {
        project: z.string().optional(),
        source: z.string().optional(),
        status: z.string().optional(),
        category: z.string().optional(),
        tag: z.string().optional(),
        text: z.string().optional(),
        date_from: z.string().optional(),
        date_to: z.string().optional(),
        limit: z.number().int().positive().optional()
      }
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
  const remoteTransport = new StreamableHTTPClientTransport(new URL(url), {
    fetch: fetchWithTimeout,
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

async function fetchWithTimeout(url: string | URL, init: RequestInit = {}): Promise<Response> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), bridgeFetchTimeoutMs);

  init.signal?.addEventListener("abort", () => controller.abort(), { once: true });

  try {
    return await fetch(url, {
      ...init,
      signal: controller.signal
    });
  } finally {
    clearTimeout(timeout);
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
