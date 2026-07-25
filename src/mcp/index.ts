#!/usr/bin/env node
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { loadConfig, type RuntrailConfig } from "../config.js";
import {
  fetchWithTimeout,
  formatClientFailure,
  formatHttpFailure,
  parseJsonBody,
  readRequestTimeoutMs
} from "../shared/httpClient.js";
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
    "journal_prepare_work",
    {
      title: "Prepare Runtrail work",
      description: "Get bounded deterministic continuation guidance before editing",
      inputSchema: mcpToolInputSchemas.prepareWork
    },
    async (args) => mcpText(await callRuntrailTool("journal_prepare_work", args, client))
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
    "journal_record_verification",
    {
      title: "Record Runtrail verification",
      description: "Record bounded typed verification evidence for an existing run",
      inputSchema: mcpToolInputSchemas.verification
    },
    async (args) => mcpText(await callRuntrailTool("journal_record_verification", args, client))
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
    "journal_list_decisions",
    {
      title: "List Runtrail decisions",
      description: "List bounded decision history or only currently effective guidance",
      inputSchema: mcpToolInputSchemas.decisionList
    },
    async (args) => mcpText(await callRuntrailTool("journal_list_decisions", args, client))
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
    "journal_list_pending_handoffs",
    {
      title: "List pending Runtrail handoffs",
      description: "List the bounded actionable handoff inbox",
      inputSchema: mcpToolInputSchemas.pendingHandoffs
    },
    async (args) => mcpText(await callRuntrailTool("journal_list_pending_handoffs", args, client))
  );

  server.registerTool(
    "journal_accept_handoff",
    {
      title: "Accept Runtrail handoff",
      description: "Accept a pending handoff exactly once and link its receiving run",
      inputSchema: mcpToolInputSchemas.acceptHandoff
    },
    async (args) => mcpText(await callRuntrailTool("journal_accept_handoff", args, client))
  );

  server.registerTool(
    "journal_decline_handoff",
    {
      title: "Decline Runtrail handoff",
      description: "Decline a pending handoff",
      inputSchema: mcpToolInputSchemas.declineHandoff
    },
    async (args) => mcpText(await callRuntrailTool("journal_decline_handoff", args, client))
  );

  server.registerTool(
    "journal_complete_handoff",
    {
      title: "Complete Runtrail handoff",
      description: "Complete an accepted handoff",
      inputSchema: mcpToolInputSchemas.versionedHandoff
    },
    async (args) => mcpText(await callRuntrailTool("journal_complete_handoff", args, client))
  );

  server.registerTool(
    "journal_expire_handoff",
    {
      title: "Expire Runtrail handoff",
      description: "Expire a pending handoff",
      inputSchema: mcpToolInputSchemas.versionedHandoff
    },
    async (args) => mcpText(await callRuntrailTool("journal_expire_handoff", args, client))
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
    "journal_get_workflow",
    {
      title: "Get Runtrail workflow",
      description: "Get bounded related-run summaries for one explicit workflow",
      inputSchema: mcpToolInputSchemas.workflow
    },
    async (args) => mcpText(await callRuntrailTool("journal_get_workflow", args, client))
  );

  server.registerTool(
    "journal_get_workflow_review_packet",
    {
      title: "Get Runtrail workflow review packet",
      description: "Get one versioned bounded portable review packet for an explicit workflow",
      inputSchema: mcpToolInputSchemas.workflowPacket
    },
    async (args) =>
      mcpText(await callRuntrailTool("journal_get_workflow_review_packet", args, client))
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
      const timeoutMs = readRequestTimeoutMs();
      const method = options.method ?? "GET";
      const headers = new Headers();

      if (options.body) {
        headers.set("content-type", "application/json");
      }

      if (config.security.token) {
        headers.set("authorization", `Bearer ${config.security.token}`);
      }

      const context = { method, path, token: config.security.token };
      let response: Response;

      try {
        response = await fetchWithTimeout(
          new URL(path, config.url),
          {
            method: options.method,
            headers,
            body: options.body ? JSON.stringify(options.body) : undefined
          },
          timeoutMs
        );
      } catch (error) {
        throw formatClientFailure(error, timeoutMs, context);
      }

      const text = await response.text();
      const body = text ? parseJsonBody(text) : undefined;

      if (!response.ok) {
        throw formatHttpFailure(response.status, body, context);
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
    case "journal_heartbeat_run": {
      const body = compact({ expectedVersion: args.expectedVersion });
      return await client.requestJson(
        `/runs/${encodeURIComponent(requireString(args, "runId"))}/${name === "journal_resume_run" ? "resume" : "heartbeat"}`,
        Object.keys(body).length > 0 ? { method: "POST", body } : { method: "POST" }
      );
    }
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
      appendOptional(query, "limit", args.limit ?? 10);
      appendOptional(query, "min_importance", args.min_importance);
      appendOptional(query, "cursor", args.cursor);
      return await client.requestJson(`/agent/context?${query.toString()}`);
    }
    case "journal_prepare_work": {
      const query = new URLSearchParams({ project: requireString(args, "project") });
      appendOptional(query, "source", args.source);
      appendOptional(query, "workKey", args.workKey);
      appendOptional(query, "runId", args.runId);
      appendOptional(query, "category", args.category);
      if (Array.isArray(args.tags)) {
        for (const tag of args.tags) {
          if (typeof tag === "string") query.append("tag", tag);
        }
      }
      appendOptional(query, "limit", args.limit);
      appendOptional(query, "cursor", args.cursor);
      return await client.requestJson(`/agent/prepare-work?${query.toString()}`);
    }
    case "journal_create_event":
      return await client.requestJson("/events", {
        method: "POST",
        body: compact({
          runId: requireString(args, "runId"),
          clientRecordId: args.clientRecordId,
          type: requireString(args, "type"),
          message: requireString(args, "message"),
          importance: args.importance,
          category: args.category,
          tags: args.tags,
          data: args.data
        })
      });
    case "journal_record_verification":
      return await client.requestJson("/verifications", {
        method: "POST",
        body: compact({
          runId: requireString(args, "runId"),
          clientRecordId: args.clientRecordId,
          checkId: requireString(args, "checkId"),
          kind: requireString(args, "kind"),
          outcome: requireString(args, "outcome"),
          name: requireString(args, "name"),
          summary: args.summary,
          commandSummary: args.commandSummary,
          durationMs: args.durationMs,
          support: args.support,
          completedAt: requireString(args, "completedAt")
        })
      });
    case "journal_create_open_loop":
      return await client.requestJson("/open-loops", {
        method: "POST",
        body: compact({
          type: requireString(args, "type"),
          project: requireString(args, "project"),
          clientRecordId: args.clientRecordId,
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
            resolution: args.resolution,
            expectedVersion: args.expectedVersion
          })
        }
      );
    case "journal_record_decision":
      return await client.requestJson("/decisions", {
        method: "POST",
        body: compact({
          project: args.project,
          clientRecordId: args.clientRecordId,
          supersedesDecisionId: args.supersedesDecisionId,
          title: requireString(args, "title"),
          decision: requireString(args, "decision"),
          rationale: args.rationale
        })
      });
    case "journal_list_decisions": {
      const query = new URLSearchParams();
      appendOptional(query, "project", args.project);
      appendOptional(query, "includeGlobal", args.includeGlobal);
      appendOptional(query, "effectiveOnly", args.effectiveOnly);
      appendOptional(query, "limit", args.limit);
      const suffix = query.toString();
      return await client.requestJson(`/decisions${suffix ? `?${suffix}` : ""}`);
    }
    case "journal_create_handoff":
      return await client.requestJson("/handoffs", {
        method: "POST",
        body: compact({
          sourceRunId: args.sourceRunId,
          clientRecordId: args.clientRecordId,
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
    case "journal_list_pending_handoffs": {
      const query = new URLSearchParams();
      appendOptional(query, "project", args.project);
      appendOptional(query, "toSource", args.toSource);
      appendOptional(query, "limit", args.limit ?? 10);
      const suffix = query.toString();
      return await client.requestJson(`/handoffs${suffix ? `?${suffix}` : ""}`);
    }
    case "journal_accept_handoff":
      return await client.requestJson(
        `/handoffs/${encodeURIComponent(requireString(args, "id"))}/accept`,
        {
          method: "POST",
          body: compact({
            expectedVersion: args.expectedVersion,
            acceptedBy: args.acceptedBy,
            targetRunId: args.targetRunId,
            run: args.run
          })
        }
      );
    case "journal_decline_handoff":
      return await client.requestJson(
        `/handoffs/${encodeURIComponent(requireString(args, "id"))}/decline`,
        {
          method: "POST",
          body: compact({
            expectedVersion: args.expectedVersion,
            reason: args.reason
          })
        }
      );
    case "journal_complete_handoff":
    case "journal_expire_handoff": {
      const action = name === "journal_complete_handoff" ? "complete" : "expire";
      return await client.requestJson(
        `/handoffs/${encodeURIComponent(requireString(args, "id"))}/${action}`,
        {
          method: "POST",
          body: compact({ expectedVersion: args.expectedVersion })
        }
      );
    }
    case "journal_get_run_manifest":
      return await client.requestJson(
        `/runs/${encodeURIComponent(requireString(args, "runId"))}/manifest`
      );
    case "journal_get_workflow": {
      const query = new URLSearchParams({ project: requireString(args, "project") });
      appendOptional(query, "limit", args.limit);
      return await client.requestJson(
        `/workflows/${encodeURIComponent(requireString(args, "workflowId"))}/runs?${query.toString()}`
      );
    }
    case "journal_get_workflow_review_packet": {
      const query = new URLSearchParams({ project: requireString(args, "project") });
      appendOptional(query, "limit", args.limit);
      return await client.requestJson(
        `/workflows/${encodeURIComponent(requireString(args, "workflowId"))}/review-packet?${query.toString()}`
      );
    }
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
      appendOptional(query, "effectiveOnly", args.effectiveOnly);
      appendOptional(query, "limit", args.limit);
      const suffix = query.toString();
      return await client.requestJson(`/search${suffix ? `?${suffix}` : ""}`);
    }
    case "journal_search_runs": {
      const query = new URLSearchParams();
      appendOptional(query, "project", args.project);
      appendOptional(query, "workKey", args.workKey);
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
