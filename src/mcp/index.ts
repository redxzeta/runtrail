#!/usr/bin/env node
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { loadConfig, type RuntrailConfig } from "../config.js";
import { mcpToolInputSchemas } from "./toolSchemas.js";

export type RuntrailHttpClient = {
  requestJson(
    path: string,
    options?: { method?: string; body?: Record<string, unknown> }
  ): Promise<unknown>;
};

export type RuntrailHttpClientConfig = Pick<RuntrailConfig, "url" | "security">;

export const runtrailToolNames = [
  "journal_start_run",
  "journal_resume_run",
  "journal_heartbeat_run",
  "journal_pause_run",
  "journal_finish_run",
  "journal_get_context",
  "journal_create_event",
  "journal_create_open_loop",
  "journal_resolve_open_loop",
  "journal_record_decision",
  "journal_create_handoff",
  "journal_get_run_manifest",
  "journal_search",
  "journal_search_runs"
] as const;

export function createRuntrailMcpServer(
  client: RuntrailHttpClient = createHttpClient(loadMcpHttpConfig())
): McpServer {
  const server = new McpServer({
    name: "runtrail",
    version: "1.0.0"
  });

  registerLifecycleTools(server, client);

  server.registerTool(
    "journal_get_context",
    {
      title: "Get Runtrail context",
      description: "Recover bounded, compact context before starting or resuming project work",
      inputSchema: mcpToolInputSchemas.context
    },
    async (args) => mcpText(await callRuntrailTool("journal_get_context", args, client))
  );

  server.registerTool(
    "journal_create_event",
    {
      title: "Create Runtrail event",
      description: "Append a typed progress, result, or exception event to an existing run",
      inputSchema: mcpToolInputSchemas.event
    },
    async (args) => mcpText(await callRuntrailTool("journal_create_event", args, client))
  );

  server.registerTool(
    "journal_create_open_loop",
    {
      title: "Create Runtrail open loop",
      description: "Record unresolved work with optional ownership and continuation metadata",
      inputSchema: mcpToolInputSchemas.openLoop
    },
    async (args) => mcpText(await callRuntrailTool("journal_create_open_loop", args, client))
  );

  server.registerTool(
    "journal_resolve_open_loop",
    {
      title: "Resolve Runtrail open loop",
      description: "Resolve an existing Runtrail open loop",
      inputSchema: mcpToolInputSchemas.resolveOpenLoop
    },
    async (args) => mcpText(await callRuntrailTool("journal_resolve_open_loop", args, client))
  );

  server.registerTool(
    "journal_record_decision",
    {
      title: "Record Runtrail decision",
      description: "Record a project or global decision in Runtrail",
      inputSchema: mcpToolInputSchemas.decision
    },
    async (args) => mcpText(await callRuntrailTool("journal_record_decision", args, client))
  );

  server.registerTool(
    "journal_search_runs",
    {
      title: "Search Runtrail runs",
      description: "Search recent Runtrail runs",
      inputSchema: mcpToolInputSchemas.runSearch
    },
    async (args) => mcpText(await callRuntrailTool("journal_search_runs", args, client))
  );

  server.registerTool(
    "journal_create_handoff",
    {
      title: "Create Runtrail handoff",
      description: "Create a handoff for another agent or source",
      inputSchema: mcpToolInputSchemas.handoff
    },
    async (args) => mcpText(await callRuntrailTool("journal_create_handoff", args, client))
  );

  server.registerTool(
    "journal_get_run_manifest",
    {
      title: "Get Runtrail run manifest",
      description: "Get compact linked records for one Runtrail run",
      inputSchema: mcpToolInputSchemas.manifest
    },
    async (args) => mcpText(await callRuntrailTool("journal_get_run_manifest", args, client))
  );

  server.registerTool(
    "journal_search",
    {
      title: "Search Runtrail journal",
      description: "Search Runtrail runs, events, open loops, handoffs, and decisions",
      inputSchema: mcpToolInputSchemas.journalSearch
    },
    async (args) => mcpText(await callRuntrailTool("journal_search", args, client))
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
      const body = parseJson(text);

      if (!response.ok) {
        throw new Error(formatHttpError(response.status, body, config.security.token));
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
    case "journal_start_run":
      return await client.requestJson("/runs", { method: "POST", body: compact(args) });
    case "journal_resume_run":
    case "journal_heartbeat_run":
      return await client.requestJson(
        `/runs/${encodeURIComponent(requireString(args, "runId"))}/${name === "journal_resume_run" ? "resume" : "heartbeat"}`,
        { method: "POST" }
      );
    case "journal_pause_run":
    case "journal_finish_run":
      return await client.requestJson(
        `/runs/${encodeURIComponent(requireString(args, "runId"))}/${name === "journal_pause_run" ? "pause" : "finish"}`,
        { method: "POST", body: compact({ ...args, runId: undefined }) }
      );
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
          description: args.description,
          owner: args.owner,
          source: args.source,
          nextAction: args.nextAction,
          blockerRef: args.blockerRef,
          sourceRunId: args.sourceRunId
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
    case "journal_create_handoff":
      return await client.requestJson("/handoffs", {
        method: "POST",
        body: compact({
          sourceRunId: args.sourceRunId,
          fromSource: requireString(args, "fromSource"),
          toSource: args.toSource,
          project: requireString(args, "project"),
          summary: requireString(args, "summary"),
          nextAction: args.nextAction,
          category: args.category,
          tags: args.tags,
          context: args.context
        })
      });
    case "journal_get_run_manifest":
      return await client.requestJson(
        `/runs/${encodeURIComponent(requireString(args, "runId"))}/manifest`
      );
    case "journal_search": {
      const query = new URLSearchParams();
      appendOptional(query, "project", args.project);
      appendOptional(query, "source", args.source);
      appendOptional(query, "status", args.status);
      appendOptional(query, "category", args.category);
      appendOptional(query, "tag", args.tag);
      appendOptional(query, "text", args.text);
      appendOptional(query, "date_from", args.date_from);
      appendOptional(query, "date_to", args.date_to);
      appendOptional(query, "limit", args.limit);
      const suffix = query.toString();
      return await client.requestJson(`/search${suffix ? `?${suffix}` : ""}`);
    }
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

function registerLifecycleTools(server: McpServer, client: RuntrailHttpClient): void {
  for (const tool of [
    ["journal_start_run", "Start or recover a bounded Runtrail run", mcpToolInputSchemas.startRun],
    ["journal_resume_run", "Resume a paused or completed Runtrail run", mcpToolInputSchemas.runId],
    [
      "journal_heartbeat_run",
      "Refresh run liveness without creating an event",
      mcpToolInputSchemas.runId
    ],
    [
      "journal_pause_run",
      "Pause or flag an active run with an explicit status",
      mcpToolInputSchemas.pauseRun
    ],
    [
      "journal_finish_run",
      "Finish a run with a terminal status and summary",
      mcpToolInputSchemas.finishRun
    ]
  ] as const) {
    server.registerTool(
      tool[0],
      { title: tool[0], description: tool[1], inputSchema: tool[2] },
      async (args: Record<string, unknown>) =>
        mcpText(await callRuntrailTool(tool[0], args, client))
    );
  }
}

function mcpText(value: unknown) {
  return {
    content: [
      {
        type: "text" as const,
        text: JSON.stringify(value)
      }
    ]
  };
}

function parseJson(text: string): unknown {
  if (!text) {
    return undefined;
  }

  try {
    return JSON.parse(text);
  } catch {
    return undefined;
  }
}

function formatHttpError(status: number, body: unknown, token?: string): string {
  const detail = body && typeof body === "object" ? (body as Record<string, unknown>) : {};
  const error = typeof detail.error === "string" ? detail.error : undefined;
  const issues = Array.isArray(detail.issues)
    ? detail.issues
        .slice(0, 10)
        .map((issue) => formatValidationIssue(issue))
        .filter((issue): issue is string => issue !== undefined)
    : [];
  const diagnostics = [error, ...issues].filter(Boolean).join("; ");
  return redactSecrets(`Runtrail HTTP ${status}${diagnostics ? `: ${diagnostics}` : ""}`, token);
}

function redactSecrets(message: string, token?: string): string {
  let redacted = message.replace(/Bearer\s+\S+/gi, "Bearer [REDACTED]");

  if (token) {
    redacted = redacted.replaceAll(token, "[REDACTED]");
  }

  return redacted;
}

function formatValidationIssue(value: unknown): string | undefined {
  if (!value || typeof value !== "object") {
    return undefined;
  }

  const issue = value as Record<string, unknown>;
  const path = Array.isArray(issue.path) ? issue.path.map(String).join(".") : "";
  const message = typeof issue.message === "string" ? issue.message : undefined;
  return message ? `${path ? `${path}: ` : ""}${message}` : undefined;
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
