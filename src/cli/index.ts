#!/usr/bin/env node
import { execFileSync, spawn } from "node:child_process";
import { createWriteStream, mkdirSync, writeFileSync } from "node:fs";
import { hostname } from "node:os";
import path from "node:path";
import { Command } from "commander";
import { loadConfig } from "../config.js";
import { healthResponseSchema } from "../shared/schemas.js";

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
    .option("--output <path>", "Write Markdown to a file")
    .action(exportOpenLoops);

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

async function wrapRun(
  command: string[],
  options: {
    source: string;
    project: string;
    task: string;
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
      startedAt: new Date().toISOString()
    })
  });
  const runId = readResponseId(created, "run");
  const logPath = path.join(config.storage.logDir, `${runId}.log`);

  mkdirSync(config.storage.logDir, { recursive: true });

  const exitCode = await runCommand(command, logPath);
  const gitAfter = readGitSnapshot(cwd);
  const changedFiles = gitAfter.repoPath ? readChangedFiles(cwd) : [];
  const status = exitCode === 0 ? "completed" : "failed";

  await requestJson("/events", {
    method: "POST",
    body: {
      runId,
      type: status,
      message: exitCode === 0 ? "Command completed" : `Command failed with exit code ${exitCode}`,
      importance: exitCode === 0 ? 5 : 8,
      data: {
        exitCode,
        logPath,
        changedFiles,
        gitBefore,
        gitAfter
      }
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
  const options: { source?: string; project?: string; task?: string } = {};
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

    if (value === "--source" || value === "--project" || value === "--task") {
      const next = args[index + 1];

      if (!next) {
        throw new Error(`Missing value for ${value}`);
      }

      options[value.slice(2) as keyof typeof options] = next;
      index += 1;
      continue;
    }

    command.push(value);
    parsingCommand = true;
  }

  await wrapRun(command, {
    source: options.source ?? "",
    project: options.project ?? "",
    task: options.task ?? ""
  });
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

async function exportDaily(options: {
  project: string;
  date: string;
  output?: string;
}): Promise<void> {
  const query = new URLSearchParams({
    project: options.project,
    limit: "100"
  });
  const runs = readArray(await requestJson(`/runs?${query.toString()}`), "runs").filter((run) =>
    String(readField(run, "startedAt")).startsWith(options.date)
  );

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

async function exportOpenLoops(options: { project?: string; output?: string }): Promise<void> {
  const query = new URLSearchParams();
  appendQuery(query, "project", options.project);
  const openLoops = readArray(
    await requestJson(`/open-loops${query.toString() ? `?${query.toString()}` : ""}`),
    "openLoops"
  );

  writeMarkdown(["# Open loops export", "", renderOpenLoops(openLoops)].join("\n"), options.output);
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
    return execFileSync("git", args, {
      cwd,
      encoding: "utf8",
      stdio: ["ignore", "pipe", "ignore"]
    }).trim();
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
