#!/usr/bin/env node
import { execFileSync } from "node:child_process";
import { createHash, randomUUID } from "node:crypto";
import { mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { homedir, hostname } from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";

type CodexHookInput = {
  sessionId: string;
  cwd: string;
  eventName: "SessionStart" | "UserPromptSubmit" | "PostToolUse" | "Stop";
  source?: "startup" | "resume" | "clear" | "compact";
  turnId?: string;
  toolName?: string;
  toolUseId?: string;
  toolCommand?: string;
  toolSucceeded?: boolean;
};

type AdapterConfig = {
  url: URL;
  token?: string;
  project?: string;
  stateDir: string;
};

type RunResponse = {
  run: {
    id: string;
    status: string;
  };
};

type SessionState = {
  version: 1;
  sessionHash: string;
  runId: string;
  project: string;
  cwd: string;
  updatedAt: string;
};

type HookRuntime = {
  env?: NodeJS.ProcessEnv;
  fetch?: typeof globalThis.fetch;
  stderr?: (message: string) => void;
};

const envKeys = new Set([
  "RUNTRAIL_URL",
  "RUNTRAIL_TOKEN",
  "RUNTRAIL_PROJECT",
  "RUNTRAIL_CODEX_STATE_DIR"
]);
const testCommands = new Set(["test", "vitest", "jest", "pytest"]);
const safePackageCommands = new Set([
  "add",
  "build",
  "check",
  "exec",
  "install",
  "lint",
  "run",
  "test",
  "typecheck"
]);

export async function handleCodexHook(rawInput: unknown, runtime: HookRuntime = {}): Promise<void> {
  const input = parseHookInput(rawInput);
  const env = loadEnvironment(runtime.env ?? process.env);
  const config = readConfig(env);
  const fetchImpl = runtime.fetch ?? globalThis.fetch;
  const git = readGitContext(input.cwd);
  const project = config.project ?? git.project ?? path.basename(input.cwd);
  const run = await requestJson<RunResponse>(config, fetchImpl, "/runs", {
    method: "POST",
    body: {
      source: "codex",
      project,
      clientRunId: input.sessionId,
      task: `Codex session for ${project}`,
      hostname: hostname(),
      cwd: input.cwd,
      gitRepoPath: git.root,
      gitBranch: git.branch,
      gitCommit: git.commit,
      category: "implementation",
      tags: ["codex", "hook"]
    }
  });

  writeSessionState(config.stateDir, input, run.run.id, project);

  switch (input.eventName) {
    case "SessionStart":
      await markRunning(config, fetchImpl, run.run);
      await createEvent(config, fetchImpl, run.run.id, {
        type: "started",
        message: `Codex session ${input.source ?? "started"}`,
        importance: 4,
        data: input.source ? { source: input.source } : undefined
      });
      return;
    case "UserPromptSubmit":
      await markRunning(config, fetchImpl, run.run);
      await createEvent(config, fetchImpl, run.run.id, {
        type: "started",
        message: "Codex turn started",
        importance: 3
      });
      return;
    case "PostToolUse":
      await recordToolUse(config, fetchImpl, input, run.run.id, git.root);
      return;
    case "Stop": {
      const completedAt = new Date().toISOString();
      await createEvent(config, fetchImpl, run.run.id, {
        type: "completed",
        message: "Codex turn completed",
        importance: 5
      });
      await requestJson(config, fetchImpl, `/runs/${encodeURIComponent(run.run.id)}`, {
        method: "PATCH",
        body: {
          status: "completed",
          summary: "Codex turn completed",
          completedAt
        }
      });
    }
  }
}

export async function runCodexHook(rawInput: unknown, runtime: HookRuntime = {}): Promise<void> {
  try {
    await handleCodexHook(rawInput, runtime);
  } catch (error) {
    const message = error instanceof AdapterError ? error.message : "unexpected adapter failure";
    (runtime.stderr ?? ((diagnostic) => process.stderr.write(`${diagnostic}\n`)))(
      `runtrail-codex-hook: ${message}`
    );
  }
}

async function recordToolUse(
  config: AdapterConfig,
  fetchImpl: typeof globalThis.fetch,
  input: CodexHookInput,
  runId: string,
  gitRoot: string | undefined
): Promise<void> {
  if (input.toolName === "apply_patch") {
    const changedFiles = gitRoot ? readChangedFiles(gitRoot) : [];

    if (changedFiles.length > 0) {
      await createEvent(config, fetchImpl, runId, {
        type: "files_changed",
        message: `Codex changed ${changedFiles.length} file${changedFiles.length === 1 ? "" : "s"}`,
        importance: 5,
        data: { changedFiles }
      });
    }
    return;
  }

  if (input.toolName !== "Bash" || !input.toolCommand) {
    return;
  }

  const command = summarizeCommand(input.toolCommand);
  await createEvent(config, fetchImpl, runId, {
    type: "command_executed",
    message: command,
    importance: 4
  });

  if (!isTestCommand(command)) {
    return;
  }

  await createEvent(config, fetchImpl, runId, {
    type: "test_started",
    message: `${command} started`,
    importance: 4
  });

  if (input.toolSucceeded !== undefined) {
    await createEvent(config, fetchImpl, runId, {
      type: input.toolSucceeded ? "test_passed" : "test_failed",
      message: `${command} ${input.toolSucceeded ? "passed" : "failed"}`,
      importance: input.toolSucceeded ? 5 : 8
    });
  }
}

async function markRunning(
  config: AdapterConfig,
  fetchImpl: typeof globalThis.fetch,
  run: RunResponse["run"]
): Promise<void> {
  if (run.status === "running") {
    return;
  }

  await requestJson(config, fetchImpl, `/runs/${encodeURIComponent(run.id)}`, {
    method: "PATCH",
    body: {
      status: "running",
      summary: null,
      completedAt: null
    }
  });
}

async function createEvent(
  config: AdapterConfig,
  fetchImpl: typeof globalThis.fetch,
  runId: string,
  event: {
    type: string;
    message: string;
    importance: number;
    data?: Record<string, unknown>;
  }
): Promise<void> {
  await requestJson(config, fetchImpl, "/events", {
    method: "POST",
    body: {
      runId,
      type: event.type,
      message: event.message,
      importance: event.importance,
      category: "implementation",
      tags: ["codex", "hook"],
      data: event.data
    }
  });
}

function parseHookInput(rawInput: unknown): CodexHookInput {
  const input = asRecord(rawInput);
  const sessionId = readRequiredString(input, "session_id");
  const cwd = path.resolve(readRequiredString(input, "cwd"));
  const eventName = readRequiredString(input, "hook_event_name");

  if (!["SessionStart", "UserPromptSubmit", "PostToolUse", "Stop"].includes(eventName)) {
    throw new AdapterError("unsupported hook event");
  }

  const toolInput = asRecord(input.tool_input);
  return {
    sessionId,
    cwd,
    eventName: eventName as CodexHookInput["eventName"],
    source: readStartSource(input.source),
    turnId: readOptionalString(input, "turn_id"),
    toolName: readOptionalString(input, "tool_name"),
    toolUseId: readOptionalString(input, "tool_use_id"),
    toolCommand: readOptionalString(toolInput, "command"),
    toolSucceeded: readToolSucceeded(input.tool_response)
  };
}

function readToolSucceeded(value: unknown): boolean | undefined {
  const response = asRecord(value);
  const exitCode = response.exit_code ?? response.exitCode;

  if (typeof exitCode === "number") {
    return exitCode === 0;
  }
  if (typeof response.success === "boolean") {
    return response.success;
  }
  if (typeof response.status === "string") {
    if (["passed", "success", "completed"].includes(response.status)) {
      return true;
    }
    if (["failed", "error"].includes(response.status)) {
      return false;
    }
  }
  return undefined;
}

function summarizeCommand(command: string): string {
  const firstLine = command.split(/\r?\n/, 1)[0]?.trim() ?? "";
  const tokens = firstLine.split(/\s+/).filter(Boolean);

  while (tokens[0] && /^[A-Za-z_][A-Za-z0-9_]*=/.test(tokens[0])) {
    tokens.shift();
  }

  const executable =
    path.basename(tokens[0] ?? "command").replace(/[^A-Za-z0-9._-]/g, "") || "command";
  const subcommand = (tokens[1] ?? "").replace(/[^A-Za-z0-9:_-]/g, "");

  if (
    ["pnpm", "npm", "yarn", "bun"].includes(executable) &&
    (safePackageCommands.has(subcommand) ||
      /^(?:test|lint|check|build|typecheck):/.test(subcommand))
  ) {
    const runner = (tokens[2] ?? "").replace(/[^A-Za-z0-9:_-]/g, "");

    if (subcommand === "exec" && ["vitest", "jest"].includes(runner)) {
      return `${executable} exec ${runner}`;
    }
    return `${executable} ${subcommand}`;
  }
  if (["go", "cargo"].includes(executable) && subcommand === "test") {
    return `${executable} test`;
  }
  if (["pytest", "vitest", "jest"].includes(executable)) {
    return executable;
  }
  return `${executable} command`;
}

function isTestCommand(command: string): boolean {
  const tokens = command.split(" ");
  return tokens.some((token) => testCommands.has(token) || token.startsWith("test:"));
}

function readGitContext(cwd: string): {
  root?: string;
  project?: string;
  branch?: string;
  commit?: string;
} {
  try {
    const root = git(cwd, ["rev-parse", "--show-toplevel"]);
    return {
      root,
      project: path.basename(root),
      branch: git(cwd, ["branch", "--show-current"]) || undefined,
      commit: git(cwd, ["rev-parse", "HEAD"]) || undefined
    };
  } catch {
    return {};
  }
}

function readChangedFiles(root: string): string[] {
  try {
    const tracked = [
      ...gitNullList(root, ["diff", "--name-only", "-z"]),
      ...gitNullList(root, ["diff", "--cached", "--name-only", "-z"]),
      ...gitNullList(root, ["ls-files", "--others", "--exclude-standard", "-z"])
    ];
    return [...new Set(tracked)].sort();
  } catch {
    return [];
  }
}

function git(cwd: string, args: string[]): string {
  return execFileSync("git", args, {
    cwd,
    encoding: "utf8",
    stdio: ["ignore", "pipe", "ignore"],
    timeout: 2_000
  }).trim();
}

function gitNullList(cwd: string, args: string[]): string[] {
  return execFileSync("git", args, {
    cwd,
    encoding: "utf8",
    stdio: ["ignore", "pipe", "ignore"],
    timeout: 2_000
  })
    .split("\0")
    .filter(Boolean);
}

function loadEnvironment(source: NodeJS.ProcessEnv): NodeJS.ProcessEnv {
  const env = { ...source };
  const envPath = source.RUNTRAIL_CODEX_ENV ?? path.join(homedir(), ".config/runtrail/codex.env");

  try {
    const contents = readFileSync(envPath, "utf8");

    for (const line of contents.split(/\r?\n/)) {
      const match = /^(?:export\s+)?([A-Z0-9_]+)=(.*)$/.exec(line.trim());

      if (!match || !envKeys.has(match[1] ?? "") || env[match[1] ?? ""] !== undefined) {
        continue;
      }

      const key = match[1] as string;
      const rawValue = match[2] ?? "";
      env[key] = unquote(rawValue.trim());
    }
  } catch {
    // The local env file is optional; process environment values remain authoritative.
  }
  return env;
}

function readConfig(env: NodeJS.ProcessEnv): AdapterConfig {
  if (!env.RUNTRAIL_URL) {
    throw new AdapterError("RUNTRAIL_URL is not configured");
  }

  const url = new URL(env.RUNTRAIL_URL);
  if (!["http:", "https:"].includes(url.protocol)) {
    throw new AdapterError("RUNTRAIL_URL must use http or https");
  }

  return {
    url,
    token: env.RUNTRAIL_TOKEN || undefined,
    project: env.RUNTRAIL_PROJECT || undefined,
    stateDir: env.RUNTRAIL_CODEX_STATE_DIR ?? path.join(homedir(), ".local/state/runtrail/codex")
  };
}

function writeSessionState(
  stateDir: string,
  input: CodexHookInput,
  runId: string,
  project: string
): void {
  mkdirSync(stateDir, { recursive: true, mode: 0o700 });
  const sessionHash = createHash("sha256").update(input.sessionId).digest("hex");
  const target = path.join(stateDir, `${sessionHash}.json`);
  const temporary = path.join(stateDir, `.${sessionHash}.${process.pid}.${randomUUID()}.tmp`);
  const state: SessionState = {
    version: 1,
    sessionHash,
    runId,
    project,
    cwd: input.cwd,
    updatedAt: new Date().toISOString()
  };

  writeFileSync(temporary, `${JSON.stringify(state)}\n`, {
    encoding: "utf8",
    mode: 0o600,
    flag: "wx"
  });
  renameSync(temporary, target);
}

async function requestJson<T = unknown>(
  config: AdapterConfig,
  fetchImpl: typeof globalThis.fetch,
  requestPath: string,
  options: { method: string; body: Record<string, unknown> }
): Promise<T> {
  const headers = new Headers({ "content-type": "application/json" });
  if (config.token) {
    headers.set("authorization", `Bearer ${config.token}`);
  }

  const response = await fetchImpl(new URL(requestPath, config.url), {
    method: options.method,
    headers,
    body: JSON.stringify(removeUndefined(options.body))
  });

  if (!response.ok) {
    throw new AdapterError(`Runtrail returned HTTP ${response.status}`);
  }

  return (await response.json()) as T;
}

function removeUndefined(input: Record<string, unknown>): Record<string, unknown> {
  return Object.fromEntries(Object.entries(input).filter(([, value]) => value !== undefined));
}

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" ? (value as Record<string, unknown>) : {};
}

function readRequiredString(input: Record<string, unknown>, key: string): string {
  const value = readOptionalString(input, key);
  if (!value) {
    throw new AdapterError(`hook input is missing ${key}`);
  }
  return value;
}

function readOptionalString(input: Record<string, unknown>, key: string): string | undefined {
  const value = input[key];
  return typeof value === "string" && value.length > 0 ? value : undefined;
}

function readStartSource(value: unknown): CodexHookInput["source"] {
  return ["startup", "resume", "clear", "compact"].includes(String(value))
    ? (value as CodexHookInput["source"])
    : undefined;
}

function unquote(value: string): string {
  if (
    value.length >= 2 &&
    ((value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'")))
  ) {
    return value.slice(1, -1);
  }
  return value;
}

class AdapterError extends Error {}

async function main(): Promise<void> {
  let rawInput: unknown;

  try {
    rawInput = JSON.parse(readFileSync(0, "utf8"));
  } catch {
    rawInput = undefined;
  }

  await runCodexHook(rawInput);
  process.stdout.write('{"continue":true}\n');
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  await main();
}
