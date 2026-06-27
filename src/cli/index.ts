#!/usr/bin/env node
import { Command } from "commander";
import { loadConfig } from "../config.js";
import { healthResponseSchema } from "../shared/schemas.js";

export async function runCli(argv = process.argv): Promise<void> {
  const program = new Command();

  program.name("rt").description("Runtrail CLI").showHelpAfterError().exitOverride();

  program.command("health").description("Check Runtrail service health").action(health);
  program
    .command("context")
    .description("Fetch compact project context")
    .requiredOption("--project <project>", "Project name")
    .option("--limit <limit>", "Maximum items per section", parseInteger)
    .option("--min-importance <importance>", "Minimum event importance", parseInteger)
    .action(context);

  const run = program.command("run").description("Manage runs");
  run
    .command("create")
    .description("Create a run")
    .requiredOption("--source <source>", "Run source")
    .requiredOption("--project <project>", "Project name")
    .requiredOption("--task <task>", "Task summary")
    .option("--status <status>", "Initial status")
    .option("--summary <summary>", "Run summary")
    .action(createRun);

  const event = program.command("event").description("Manage events");
  event
    .command("create")
    .description("Create an event")
    .requiredOption("--run-id <runId>", "Run ID")
    .requiredOption("--type <type>", "Event type")
    .requiredOption("--message <message>", "Event message")
    .option("--importance <importance>", "Importance from 0 to 10", parseInteger)
    .option("--data-json <json>", "Additional event data as JSON")
    .action(createEvent);

  const loop = program.command("loop").description("Manage open loops");
  loop
    .command("add")
    .description("Add an open loop")
    .requiredOption("--type <type>", "Open loop type")
    .requiredOption("--project <project>", "Project name")
    .requiredOption("--title <title>", "Open loop title")
    .option("--description <description>", "Open loop details")
    .action(addLoop);
  loop
    .command("resolve")
    .description("Resolve an open loop")
    .argument("<id>", "Open loop ID")
    .option("--resolution <resolution>", "Resolution notes")
    .action(resolveLoop);

  const decision = program.command("decision").description("Manage decisions");
  decision
    .command("add")
    .description("Record a decision")
    .requiredOption("--title <title>", "Decision title")
    .requiredOption("--decision <decision>", "Decision text")
    .option("--project <project>", "Project name")
    .option("--rationale <rationale>", "Decision rationale")
    .action(addDecision);

  await program.parseAsync(argv);
}

async function health(): Promise<void> {
  const parsed = healthResponseSchema.parse(await requestJson("/health"));
  printJson(parsed);
}

async function context(options: {
  project: string;
  limit?: number;
  minImportance?: number;
}): Promise<void> {
  const query = new URLSearchParams({ project: options.project });

  if (options.limit !== undefined) {
    query.set("limit", String(options.limit));
  }

  if (options.minImportance !== undefined) {
    query.set("min_importance", String(options.minImportance));
  }

  printJson(await requestJson(`/agent/context?${query.toString()}`));
}

async function createRun(options: {
  source: string;
  project: string;
  task: string;
  status?: string;
  summary?: string;
}): Promise<void> {
  printJson(
    await requestJson("/runs", {
      method: "POST",
      body: compact({
        source: options.source,
        project: options.project,
        task: options.task,
        status: options.status,
        summary: options.summary
      })
    })
  );
}

async function createEvent(options: {
  runId: string;
  type: string;
  message: string;
  importance?: number;
  dataJson?: string;
}): Promise<void> {
  printJson(
    await requestJson("/events", {
      method: "POST",
      body: compact({
        runId: options.runId,
        type: options.type,
        message: options.message,
        importance: options.importance,
        data: options.dataJson ? parseJsonOption(options.dataJson, "--data-json") : undefined
      })
    })
  );
}

async function addLoop(options: {
  type: string;
  project: string;
  title: string;
  description?: string;
}): Promise<void> {
  printJson(
    await requestJson("/open-loops", {
      method: "POST",
      body: compact({
        type: options.type,
        project: options.project,
        title: options.title,
        description: options.description
      })
    })
  );
}

async function resolveLoop(id: string, options: { resolution?: string }): Promise<void> {
  printJson(
    await requestJson(`/open-loops/${encodeURIComponent(id)}`, {
      method: "PATCH",
      body: compact({
        status: "resolved",
        resolution: options.resolution
      })
    })
  );
}

async function addDecision(options: {
  title: string;
  decision: string;
  project?: string;
  rationale?: string;
}): Promise<void> {
  printJson(
    await requestJson("/decisions", {
      method: "POST",
      body: compact({
        project: options.project,
        title: options.title,
        decision: options.decision,
        rationale: options.rationale
      })
    })
  );
}

async function requestJson(
  path: string,
  options: { method?: string; body?: Record<string, unknown> } = {}
): Promise<unknown> {
  const config = loadConfig();
  const headers = new Headers();

  if (options.body) {
    headers.set("content-type", "application/json");
  }

  if (config.security.token) {
    headers.set("authorization", `Bearer ${config.security.token}`);
  }

  const response = await fetch(new URL(path, config.url), {
    method: options.method,
    body: options.body ? JSON.stringify(options.body) : undefined,
    headers
  });
  const text = await response.text();
  const body = text ? parseResponseBody(text) : undefined;

  if (!response.ok) {
    throw new Error(formatHttpError(response.status, body));
  }

  return body;
}

function parseInteger(value: string): number {
  const parsed = Number(value);

  if (!Number.isInteger(parsed)) {
    throw new Error(`Expected an integer, got: ${value}`);
  }

  return parsed;
}

function compact(input: Record<string, unknown>): Record<string, unknown> {
  return Object.fromEntries(Object.entries(input).filter(([, value]) => value !== undefined));
}

function parseJsonOption(value: string, optionName: string): unknown {
  try {
    return JSON.parse(value);
  } catch {
    throw new Error(`Invalid JSON for ${optionName}`);
  }
}

function parseResponseBody(text: string): unknown {
  try {
    return JSON.parse(text);
  } catch {
    return text;
  }
}

function formatHttpError(status: number, body: unknown): string {
  if (body && typeof body === "object" && "error" in body) {
    return `HTTP ${status}: ${String(body.error)}`;
  }

  if (typeof body === "string" && body.length > 0) {
    return `HTTP ${status}: ${body}`;
  }

  return `HTTP ${status}`;
}

function printJson(value: unknown): void {
  console.log(JSON.stringify(value, null, 2));
}

if (import.meta.url === `file://${process.argv[1]}`) {
  runCli().catch((error: unknown) => {
    const message = error instanceof Error ? error.message : String(error);
    console.error(message);
    process.exit(1);
  });
}
