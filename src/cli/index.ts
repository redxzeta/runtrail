#!/usr/bin/env node
import { execFileSync, spawn } from "node:child_process";
import { createWriteStream, mkdirSync, writeFileSync } from "node:fs";
import { hostname } from "node:os";
import path from "node:path";
import { Command } from "commander";
import { loadConfig } from "../config.js";
import { verifyEventChain } from "../shared/receipts.js";
import { type AgentEvent, healthResponseSchema } from "../shared/schemas.js";

export async function runCli(argv = process.argv): Promise<void> {
  if (argv[2] === "run" && argv[3] !== "create") {
    await wrapRunFromArgv(argv.slice(3));
    return;
  }

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

  const run = program.command("run").description("Wrap a command in a Runtrail run");
  run
    .command("create")
    .description("Create a run")
    .requiredOption("--source <source>", "Run source")
    .requiredOption("--project <project>", "Project name")
    .requiredOption("--task <task>", "Task summary")
    .option("--client-run-id <clientRunId>", "Stable client session identifier")
    .option("--status <status>", "Initial status")
    .option("--summary <summary>", "Run summary")
    .option("--category <category>", "Run category")
    .option("--tag <tag>", "Run tag", collectOption, [])
    .action(createRun);

  const runs = program.command("runs").description("Manage run lifecycle recovery");
  runs
    .command("close-stale")
    .description("Report or close stale running records")
    .requiredOption("--older-than <duration>", "Minimum inactivity, for example 30m, 24h, or 7d")
    .option("--limit <limit>", "Maximum runs to inspect", parseInteger, 100)
    .option("--apply", "Mark candidates cancelled", false)
    .action(closeStaleRuns);

  const event = program.command("event").description("Manage events");
  event
    .command("create")
    .description("Create an event")
    .requiredOption("--run-id <runId>", "Run ID")
    .requiredOption("--type <type>", "Event type")
    .requiredOption("--message <message>", "Event message")
    .option("--importance <importance>", "Importance from 0 to 10", parseInteger)
    .option("--category <category>", "Event category")
    .option("--tag <tag>", "Event tag", collectOption, [])
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
    .option("--owner <owner>", "Responsible owner")
    .option("--source <source>", "Source integration")
    .option("--next-action <nextAction>", "Recommended next action")
    .option("--blocker-ref <blockerRef>", "Blocking issue or dependency")
    .option("--source-run-id <sourceRunId>", "Source run ID")
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

  const handoff = program.command("handoff").description("Manage handoffs");
  handoff
    .command("create")
    .description("Create a handoff")
    .requiredOption("--from-source <fromSource>", "Source handing off work")
    .requiredOption("--project <project>", "Project name")
    .requiredOption("--summary <summary>", "Handoff summary")
    .option("--source-run-id <sourceRunId>", "Source run ID")
    .option("--to-source <toSource>", "Target source")
    .option("--next-action <nextAction>", "Recommended next action")
    .option("--category <category>", "Handoff category")
    .option("--tag <tag>", "Handoff tag", collectOption, [])
    .option("--context-json <json>", "Additional handoff context as JSON")
    .action(createHandoff);

  const exportCommand = program.command("export").description("Export Markdown summaries");
  exportCommand
    .command("daily")
    .description("Export a daily run summary")
    .requiredOption("--project <project>", "Project name")
    .option("--date <date>", "YYYY-MM-DD date", today())
    .option("--output <path>", "Write Markdown to a file")
    .action(exportDaily);
  exportCommand
    .command("project")
    .description("Export project context")
    .requiredOption("--project <project>", "Project name")
    .option("--output <path>", "Write Markdown to a file")
    .action(exportProject);
  exportCommand
    .command("decisions")
    .description("Export decisions")
    .option("--project <project>", "Project name")
    .option("--output <path>", "Write Markdown to a file")
    .action(exportDecisions);
  exportCommand
    .command("open-loops")
    .description("Export open loops")
    .option("--project <project>", "Project name")
    .option("--owner <owner>", "Filter by owner")
    .option("--source <source>", "Filter by source")
    .option("--source-run-id <sourceRunId>", "Filter by source run ID")
    .option("--output <path>", "Write Markdown to a file")
    .action(exportOpenLoops);

  const verify = program.command("verify").description("Verify tamper-evident receipts");
  verify
    .command("run")
    .description("Verify event receipts for a run")
    .argument("<runId>")
    .action(verifyRun);

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
  clientRunId?: string;
  status?: string;
  summary?: string;
  category?: string;
  tag?: string[];
}): Promise<void> {
  printJson(
    await requestJson("/runs", {
      method: "POST",
      body: compact({
        source: options.source,
        project: options.project,
        clientRunId: options.clientRunId,
        task: options.task,
        status: options.status,
        summary: options.summary,
        category: options.category,
        tags: optionTags(options.tag)
      })
    })
  );
}

async function closeStaleRuns(options: {
  olderThan: string;
  limit: number;
  apply: boolean;
}): Promise<void> {
  const durationMs = parseDuration(options.olderThan);
  const updatedBefore = new Date(Date.now() - durationMs).toISOString();

  printJson(
    await requestJson("/runs/close-stale", {
      method: "POST",
      body: {
        updatedBefore,
        apply: options.apply,
        limit: options.limit
      }
    })
  );
}

async function wrapRun(
  command: string[],
  options: {
    source: string;
    project: string;
    task: string;
    category?: string;
    tags?: string[];
  }
): Promise<void> {
  if (!options.source || !options.project || !options.task) {
    throw new Error("Options --source, --project, and --task are required");
  }

  if (command[0] === "--") {
    command = command.slice(1);
  }

  if (command.length === 0) {
    throw new Error("A command is required after --");
  }

  const config = loadConfig();
  const cwd = process.cwd();
  const gitBefore = readGitSnapshot(cwd);
  const created = await requestJson("/runs", {
    method: "POST",
    body: compact({
      source: options.source,
      project: options.project,
      task: options.task,
      hostname: hostname(),
      cwd,
      gitRepoPath: gitBefore.repoPath,
      gitBranch: gitBefore.branch,
      gitCommit: gitBefore.commit,
      category: options.category,
      tags: options.tags,
      startedAt: new Date().toISOString()
    })
  });
  const runId = readResponseId(created, "run");
  const logPath = path.join(config.storage.logDir, `${runId}.log`);

  mkdirSync(config.storage.logDir, { recursive: true });

  const commandStartedAt = Date.now();
  const exitCode = await runCommand(command, logPath);
  const durationMs = Date.now() - commandStartedAt;
  const gitAfter = readGitSnapshot(cwd);
  const changedFiles = gitAfter.repoPath ? readChangedFiles(cwd) : [];
  const status = exitCode === 0 ? "completed" : "failed";

  await requestJson("/events", {
    method: "POST",
    body: {
      runId,
      type: "command_executed",
      message: `Executed ${path.basename(command[0] ?? "command")}`,
      importance: exitCode === 0 ? 4 : 7,
      category: options.category,
      tags: options.tags,
      data: {
        argv: sanitizeCommandArgv(command),
        exitCode,
        durationMs,
        logPath,
        gitBefore,
        gitAfter
      }
    }
  });
  if (changedFiles.length > 0) {
    await requestJson("/events", {
      method: "POST",
      body: {
        runId,
        type: "files_changed",
        message: `${changedFiles.length} file${changedFiles.length === 1 ? "" : "s"} changed`,
        importance: 4,
        category: options.category,
        tags: options.tags,
        data: { changedFiles }
      }
    });
  }
  await requestJson("/events", {
    method: "POST",
    body: {
      runId,
      type: status,
      message: exitCode === 0 ? "Command completed" : `Command failed with exit code ${exitCode}`,
      importance: exitCode === 0 ? 5 : 8,
      category: options.category,
      tags: options.tags,
      data: { exitCode }
    }
  });
  await requestJson(`/runs/${encodeURIComponent(runId)}`, {
    method: "PATCH",
    body: compact({
      status,
      summary: exitCode === 0 ? "Command completed" : `Command failed with exit code ${exitCode}`,
      completedAt: new Date().toISOString(),
      gitBranch: gitAfter.branch,
      gitCommit: gitAfter.commit
    })
  });

  printJson({ runId, status, exitCode, logPath });
  process.exitCode = exitCode;
}

async function wrapRunFromArgv(args: string[]): Promise<void> {
  const options: {
    category?: string;
    source?: string;
    project?: string;
    tag?: string[];
    task?: string;
  } = {};
  const command: string[] = [];
  let parsingCommand = false;

  for (let index = 0; index < args.length; index += 1) {
    const value = args[index];

    if (parsingCommand) {
      command.push(value);
      continue;
    }

    if (value === "--") {
      parsingCommand = true;
      continue;
    }

    if (
      value === "--source" ||
      value === "--project" ||
      value === "--task" ||
      value === "--category"
    ) {
      const next = args[index + 1];

      if (!next) {
        throw new Error(`Missing value for ${value}`);
      }

      if (value === "--source") {
        options.source = next;
      } else if (value === "--project") {
        options.project = next;
      } else if (value === "--task") {
        options.task = next;
      } else {
        options.category = next;
      }
      index += 1;
      continue;
    }

    if (value === "--tag") {
      const next = args[index + 1];

      if (!next) {
        throw new Error(`Missing value for ${value}`);
      }

      options.tag = [...(options.tag ?? []), next];
      index += 1;
      continue;
    }

    command.push(value);
    parsingCommand = true;
  }

  await wrapRun(command, {
    source: options.source ?? "",
    project: options.project ?? "",
    task: options.task ?? "",
    category: options.category,
    tags: optionTags(options.tag)
  });
}

async function createEvent(options: {
  runId: string;
  type: string;
  message: string;
  importance?: number;
  category?: string;
  tag?: string[];
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
        category: options.category,
        tags: optionTags(options.tag),
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
  owner?: string;
  source?: string;
  nextAction?: string;
  blockerRef?: string;
  sourceRunId?: string;
}): Promise<void> {
  printJson(
    await requestJson("/open-loops", {
      method: "POST",
      body: compact({
        type: options.type,
        project: options.project,
        title: options.title,
        description: options.description,
        owner: options.owner,
        source: options.source,
        nextAction: options.nextAction,
        blockerRef: options.blockerRef,
        sourceRunId: options.sourceRunId
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

async function createHandoff(options: {
  sourceRunId?: string;
  fromSource: string;
  toSource?: string;
  project: string;
  summary: string;
  nextAction?: string;
  category?: string;
  tag?: string[];
  contextJson?: string;
}): Promise<void> {
  printJson(
    await requestJson("/handoffs", {
      method: "POST",
      body: compact({
        sourceRunId: options.sourceRunId,
        fromSource: options.fromSource,
        toSource: options.toSource,
        project: options.project,
        summary: options.summary,
        nextAction: options.nextAction,
        category: options.category,
        tags: optionTags(options.tag),
        context: options.contextJson
          ? parseJsonOption(options.contextJson, "--context-json")
          : undefined
      })
    })
  );
}

async function exportDaily(options: {
  project: string;
  date: string;
  output?: string;
}): Promise<void> {
  const startedFrom = `${options.date}T00:00:00.000Z`;
  const startedTo = new Date(Date.parse(startedFrom) + 24 * 60 * 60 * 1000).toISOString();
  const query = new URLSearchParams({
    project: options.project,
    started_from: startedFrom,
    started_to: startedTo,
    limit: "100"
  });
  const runs = readArray(await requestJson(`/runs?${query.toString()}`), "runs");

  writeMarkdown(
    [`# ${options.project} daily export - ${options.date}`, "", renderRuns(runs)].join("\n"),
    options.output
  );
}

async function exportProject(options: { project: string; output?: string }): Promise<void> {
  const query = new URLSearchParams({ project: options.project });
  const context = asRecord(await requestJson(`/agent/context?${query.toString()}`));

  writeMarkdown(
    [
      `# ${options.project} project export`,
      "",
      renderRuns(readArray(context, "recent_runs")),
      renderOpenLoops(readArray(context, "open_loops")),
      renderDecisions(readArray(context, "decisions")),
      renderNextActions(readStringArray(context, "next_actions"))
    ].join("\n"),
    options.output
  );
}

async function exportDecisions(options: { project?: string; output?: string }): Promise<void> {
  const query = new URLSearchParams();
  appendQuery(query, "project", options.project);
  const decisions = readArray(
    await requestJson(`/decisions${query.toString() ? `?${query.toString()}` : ""}`),
    "decisions"
  );

  writeMarkdown(["# Decisions export", "", renderDecisions(decisions)].join("\n"), options.output);
}

async function exportOpenLoops(options: {
  project?: string;
  owner?: string;
  source?: string;
  sourceRunId?: string;
  output?: string;
}): Promise<void> {
  const query = new URLSearchParams();
  appendQuery(query, "project", options.project);
  appendQuery(query, "owner", options.owner);
  appendQuery(query, "source", options.source);
  appendQuery(query, "sourceRunId", options.sourceRunId);
  const openLoops = readArray(
    await requestJson(`/open-loops${query.toString() ? `?${query.toString()}` : ""}`),
    "openLoops"
  );

  writeMarkdown(["# Open loops export", "", renderOpenLoops(openLoops)].join("\n"), options.output);
}

async function verifyRun(runId: string): Promise<void> {
  const response = await requestJson(`/runs/${encodeURIComponent(runId)}`);
  const events = readArray(response, "events").map(readEvent);
  const result = verifyEventChain(events);

  printJson({ runId, ...result });

  if (result.status !== "pass") {
    process.exitCode = 1;
  }
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

function parseDuration(value: string): number {
  const match = /^(\d+)(s|m|h|d)$/.exec(value.trim());

  if (!match) {
    throw new Error(`Expected a duration such as 30m, 24h, or 7d; got: ${value}`);
  }

  const amount = Number(match[1]);
  const units: Record<string, number> = {
    s: 1_000,
    m: 60_000,
    h: 3_600_000,
    d: 86_400_000
  };

  if (!Number.isSafeInteger(amount) || amount <= 0) {
    throw new Error(`Duration must be greater than zero; got: ${value}`);
  }

  return amount * (units[match[2] ?? ""] ?? 0);
}

function collectOption(value: string, previous: string[]): string[] {
  return [...previous, value];
}

function compact(input: Record<string, unknown>): Record<string, unknown> {
  return Object.fromEntries(Object.entries(input).filter(([, value]) => value !== undefined));
}

function optionTags(tags: string[] | undefined): string[] | undefined {
  return tags && tags.length > 0 ? tags : undefined;
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

function writeMarkdown(markdown: string, output?: string): void {
  if (output) {
    writeFileSync(output, `${markdown.trimEnd()}\n`);
    console.log(`Wrote ${output}`);
    return;
  }

  console.log(markdown.trimEnd());
}

function renderRuns(runs: Record<string, unknown>[]): string {
  if (runs.length === 0) {
    return "## Runs\n\nNo runs found.\n";
  }

  return [
    "## Runs",
    "",
    ...runs.map(
      (run) =>
        `- ${readField(run, "status")} ${readField(run, "task")} (${readField(run, "id")})` +
        renderOptional(`project: ${readField(run, "project")}`) +
        renderOptional(`summary: ${readField(run, "summary")}`)
    ),
    ""
  ].join("\n");
}

function renderOpenLoops(openLoops: Record<string, unknown>[]): string {
  if (openLoops.length === 0) {
    return "## Open loops\n\nNo open loops found.\n";
  }

  return [
    "## Open loops",
    "",
    ...openLoops.map(
      (loop) =>
        `- ${readField(loop, "type")} ${readField(loop, "title")} (${readField(loop, "id")})` +
        renderOptional(`project: ${readField(loop, "project")}`) +
        renderOptional(`description: ${readField(loop, "description")}`)
    ),
    ""
  ].join("\n");
}

function renderDecisions(decisions: Record<string, unknown>[]): string {
  if (decisions.length === 0) {
    return "## Decisions\n\nNo decisions found.\n";
  }

  return [
    "## Decisions",
    "",
    ...decisions.map(
      (decision) =>
        `- ${readField(decision, "title")}: ${readField(decision, "decision")}` +
        renderOptional(`project: ${readField(decision, "project")}`) +
        renderOptional(`rationale: ${readField(decision, "rationale")}`)
    ),
    ""
  ].join("\n");
}

function renderNextActions(nextActions: string[]): string {
  if (nextActions.length === 0) {
    return "## Next actions\n\nNo next actions found.\n";
  }

  return ["## Next actions", "", ...nextActions.map((action) => `- ${String(action)}`), ""].join(
    "\n"
  );
}

function renderOptional(value: string): string {
  return value.endsWith(": ") ? "" : `; ${value}`;
}

function readArray(source: unknown, key: string): Record<string, unknown>[] {
  const value = asRecord(source)[key];
  return Array.isArray(value) ? value.map(asRecord) : [];
}

function readStringArray(source: unknown, key: string): string[] {
  const value = asRecord(source)[key];
  return Array.isArray(value)
    ? value.filter((item): item is string => typeof item === "string")
    : [];
}

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" ? (value as Record<string, unknown>) : {};
}

function readField(source: Record<string, unknown>, key: string): string {
  const value = source[key];
  return typeof value === "string" && value.length > 0 ? value : "";
}

function readEvent(source: Record<string, unknown>): AgentEvent {
  return {
    id: readRequiredField(source, "id"),
    runId: readRequiredField(source, "runId"),
    type: readRequiredField(source, "type") as AgentEvent["type"],
    message: readRequiredField(source, "message"),
    importance: readNumberField(source, "importance"),
    data: source.data,
    prevEventHash: readOptionalField(source, "prevEventHash"),
    eventHash: readOptionalField(source, "eventHash"),
    createdAt: readRequiredField(source, "createdAt")
  };
}

function readRequiredField(source: Record<string, unknown>, key: string): string {
  const value = readOptionalField(source, key);

  if (!value) {
    throw new Error(`API response event missing ${key}`);
  }

  return value;
}

function readOptionalField(source: Record<string, unknown>, key: string): string | undefined {
  const value = source[key];
  return typeof value === "string" && value.length > 0 ? value : undefined;
}

function readNumberField(source: Record<string, unknown>, key: string): number {
  const value = source[key];

  if (typeof value !== "number") {
    throw new Error(`API response event missing numeric ${key}`);
  }

  return value;
}

function appendQuery(query: URLSearchParams, key: string, value: string | undefined): void {
  if (value) {
    query.set(key, value);
  }
}

function today(): string {
  return new Date().toISOString().slice(0, 10);
}

function readResponseId(response: unknown, key: string): string {
  const envelope = response as Record<string, unknown> | undefined;
  const value = envelope?.[key];

  if (value && typeof value === "object" && "id" in value) {
    const id = (value as { id: unknown }).id;

    if (typeof id === "string") {
      return id;
    }
  }

  throw new Error(`API response did not include ${key}.id`);
}

async function runCommand(command: string[], logPath: string): Promise<number> {
  const [executable, ...args] = command;
  const log = createWriteStream(logPath, { flags: "a" });

  return await new Promise((resolve, reject) => {
    const child = spawn(executable, args, {
      cwd: process.cwd(),
      env: process.env,
      stdio: ["inherit", "pipe", "pipe"],
      shell: false
    });

    child.stdout.on("data", (chunk: Buffer) => {
      process.stdout.write(chunk);
      log.write(chunk);
    });
    child.stderr.on("data", (chunk: Buffer) => {
      process.stderr.write(chunk);
      log.write(chunk);
    });
    child.on("error", (error) => {
      log.end();
      reject(error);
    });
    child.on("close", (code) => {
      log.end();
      resolve(code ?? 1);
    });
  });
}

const secretBearingFlags = new Set([
  "--api-key",
  "--authorization",
  "--password",
  "--secret",
  "--token",
  "--webhook-url"
]);

function sanitizeCommandArgv(command: string[]): string[] {
  const sanitized: string[] = [];
  let redactNext = false;

  for (const rawArg of command.slice(0, 100)) {
    const arg = rawArg.slice(0, 1000);

    if (redactNext) {
      sanitized.push("[REDACTED]");
      redactNext = false;
      continue;
    }

    const separator = arg.indexOf("=");
    const flag = (separator === -1 ? arg : arg.slice(0, separator)).toLowerCase();

    if (secretBearingFlags.has(flag)) {
      sanitized.push(separator === -1 ? arg : `${arg.slice(0, separator)}=[REDACTED]`);
      redactNext = separator === -1;
      continue;
    }

    sanitized.push(arg);
  }

  return sanitized;
}

function readGitSnapshot(cwd: string): {
  repoPath?: string;
  branch?: string;
  commit?: string;
} {
  const repoPath = readGitValue(cwd, ["rev-parse", "--show-toplevel"]);

  if (!repoPath) {
    return {};
  }

  return {
    repoPath,
    branch: readGitValue(cwd, ["branch", "--show-current"]),
    commit: readGitValue(cwd, ["rev-parse", "HEAD"])
  };
}

function readChangedFiles(cwd: string): string[] {
  const status = readGitValue(cwd, ["status", "--short"]);

  if (!status) {
    return [];
  }

  return status
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean);
}

function readGitValue(cwd: string, args: string[]): string | undefined {
  try {
    const value = execFileSync("git", args, {
      cwd,
      encoding: "utf8",
      stdio: ["ignore", "pipe", "ignore"]
    }).trim();

    return value.length > 0 ? value : undefined;
  } catch {
    return undefined;
  }
}

if (import.meta.url === `file://${process.argv[1]}`) {
  runCli().catch((error: unknown) => {
    const message = error instanceof Error ? error.message : String(error);
    console.error(message);
    process.exit(1);
  });
}
