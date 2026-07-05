#!/usr/bin/env node
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";
import { loadConfig, type RuntrailConfig } from "../config.js";

export type RuntrailHttpClient = {
  requestJson(
    path: string,
    options?: { method?: string; body?: Record<string, unknown> }
  ): Promise<unknown>;
};

export type RuntrailHttpClientConfig = Pick<RuntrailConfig, "url" | "security">;

export const runtrailToolNames = [
  "journal_get_context",
  "journal_create_event",
  "journal_create_open_loop",
  "journal_resolve_open_loop",
  "journal_record_decision",
  "journal_search_runs"
] as const;

export function createRuntrailMcpServer(
  client: RuntrailHttpClient = createHttpClient(loadMcpHttpConfig())
): McpServer {
  const server = new McpServer({
    name: "runtrail",
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
    async (args) => mcpText(await callRuntrailTool("journal_get_context", args, client))
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
    async (args) => mcpText(await callRuntrailTool("journal_create_event", args, client))
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
        description: z.string().optional()
      }
    },
    async (args) => mcpText(await callRuntrailTool("journal_create_open_loop", args, client))
  );

  server.registerTool(
    "journal_resolve_open_loop",
    {
      title: "Resolve Runtrail open loop",
      description: "Resolve an existing Runtrail open loop",
      inputSchema: {
        id: z.string(),
        resolution: z.string().optional()
      }
    },
    async (args) => mcpText(await callRuntrailTool("journal_resolve_open_loop", args, client))
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
    async (args) => mcpText(await callRuntrailTool("journal_record_decision", args, client))
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
    async (args) => mcpText(await callRuntrailTool("journal_search_runs", args, client))
  );

  return server;
}

export function createHttpClient(config: RuntrailHttpClientConfig): RuntrailHttpClient {
  return {
    async requestJson(path, options = {}) {
      const headers = new Headers();

      if (options.body) {
        headers.set("content-type", "application/json");
      }

      if (config.security.token) {
        headers.set("authorization", `Bearer ${config.security.token}`);
      }

      const response = await fetch(new URL(path, config.url), {
        method: options.method,
        headers,
        body: options.body ? JSON.stringify(options.body) : undefined
      });
      const text = await response.text();
      const body = text ? JSON.parse(text) : undefined;

      if (!response.ok) {
        throw new Error(`Runtrail HTTP ${response.status}`);
      }

      return body;
    }
  };
}

export async function callRuntrailTool(
  name: string,
  args: Record<string, unknown>,
  client: RuntrailHttpClient
): Promise<unknown> {
  switch (name) {
    case "journal_get_context": {
      const query = new URLSearchParams({
        project: requireString(args, "project")
      });
      appendOptional(query, "limit", args.limit);
      appendOptional(query, "min_importance", args.min_importance);
      return await client.requestJson(`/agent/context?${query.toString()}`);
    }
    case "journal_create_event":
      return await client.requestJson("/events", {
        method: "POST",
        body: compact({
          runId: requireString(args, "runId"),
          type: requireString(args, "type"),
          message: requireString(args, "message"),
          importance: args.importance,
          category: args.category,
          tags: args.tags,
          data: args.data
        })
      });
    case "journal_create_open_loop":
      return await client.requestJson("/open-loops", {
        method: "POST",
        body: compact({
          type: requireString(args, "type"),
          project: requireString(args, "project"),
          title: requireString(args, "title"),
          description: args.description
        })
      });
    case "journal_resolve_open_loop":
      return await client.requestJson(
        `/open-loops/${encodeURIComponent(requireString(args, "id"))}`,
        {
          method: "PATCH",
          body: compact({
            status: "resolved",
            resolution: args.resolution
          })
        }
      );
    case "journal_record_decision":
      return await client.requestJson("/decisions", {
        method: "POST",
        body: compact({
          project: args.project,
          title: requireString(args, "title"),
          decision: requireString(args, "decision"),
          rationale: args.rationale
        })
      });
    case "journal_search_runs": {
      const query = new URLSearchParams();
      appendOptional(query, "project", args.project);
      appendOptional(query, "status", args.status);
      appendOptional(query, "category", args.category);
      appendOptional(query, "tag", args.tag);
      appendOptional(query, "limit", args.limit);
      const suffix = query.toString();
      return await client.requestJson(`/runs${suffix ? `?${suffix}` : ""}`);
    }
    default:
      throw new Error(`Unknown tool: ${name}`);
  }
}

function mcpText(value: unknown) {
  return {
    content: [
      {
        type: "text" as const,
        text: JSON.stringify(value, null, 2)
      }
    ]
  };
}

function requireString(args: Record<string, unknown>, name: string): string {
  const value = args[name];

  if (typeof value !== "string" || value.trim().length === 0) {
    throw new Error(`Missing required string argument: ${name}`);
  }

  return value;
}

function appendOptional(query: URLSearchParams, name: string, value: unknown): void {
  if (value !== undefined && value !== null) {
    query.set(name, String(value));
  }
}

function compact(input: Record<string, unknown>): Record<string, unknown> {
  return Object.fromEntries(Object.entries(input).filter(([, value]) => value !== undefined));
}

async function start(): Promise<void> {
  const server = createRuntrailMcpServer();
  await server.connect(new StdioServerTransport());
}

function loadMcpHttpConfig(): RuntrailHttpClientConfig {
  const url = process.env.RUNTRAIL_URL;

  if (url) {
    return {
      url,
      security: {
        authRequired: true,
        token: emptyToUndefined(process.env.RUNTRAIL_TOKEN)
      }
    };
  }

  return loadConfig();
}

function emptyToUndefined(value: string | undefined): string | undefined {
  return value && value.trim().length > 0 ? value : undefined;
}

if (import.meta.url === `file://${process.argv[1]}`) {
  start().catch((error: unknown) => {
    const message = error instanceof Error ? error.message : String(error);
    console.error(message);
    process.exit(1);
  });
}
