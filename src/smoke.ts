import { type ChildProcess, spawn } from "node:child_process";
import { randomBytes } from "node:crypto";
import { mkdtempSync, rmSync } from "node:fs";
import { createServer } from "node:net";
import { tmpdir } from "node:os";
import path from "node:path";

const startupTimeoutMs = 10_000;
const shutdownTimeoutMs = 5_000;

type SmokeHooks = {
  afterHealth?: () => void;
  onTempDir?: (directory: string) => void;
  installSignalHandlers?: boolean;
};

export async function runLifecycleSmoke(hooks: SmokeHooks = {}): Promise<void> {
  const directory = mkdtempSync(path.join(tmpdir(), "runtrail-smoke-"));
  hooks.onTempDir?.(directory);
  const port = await allocatePort();
  const baseUrl = `http://127.0.0.1:${port}`;
  const token = randomBytes(32).toString("hex");
  let child: ChildProcess | undefined;

  const cleanup = async (): Promise<void> => {
    if (child && child.exitCode === null) {
      child.kill("SIGTERM");
      await waitForExit(child, shutdownTimeoutMs);
    }
    rmSync(directory, { recursive: true, force: true });
  };
  const interrupt = (): void => {
    void cleanup().finally(() => process.exit(130));
  };

  if (hooks.installSignalHandlers !== false) {
    process.once("SIGINT", interrupt);
    process.once("SIGTERM", interrupt);
  }

  try {
    child = spawn(process.execPath, ["--import", "tsx", "src/index.ts"], {
      cwd: process.cwd(),
      env: {
        ...process.env,
        RUNTRAIL_HOST: "127.0.0.1",
        RUNTRAIL_PORT: String(port),
        RUNTRAIL_URL: baseUrl,
        RUNTRAIL_DB_PATH: path.join(directory, "runtrail.sqlite"),
        RUNTRAIL_LOG_DIR: path.join(directory, "logs"),
        RUNTRAIL_TOKEN: token,
        DISCORD_WEBHOOK_URL: ""
      },
      stdio: "ignore"
    });

    await step("health readiness", async () => await waitForHealth(baseUrl));
    hooks.afterHealth?.();

    const runPayload = {
      source: "smoke",
      project: "runtrail-smoke",
      clientRunId: "deterministic-lifecycle",
      task: "verify complete agent lifecycle",
      category: "verification",
      tags: ["smoke", "lifecycle"]
    };
    const created = await step(
      "create run",
      async () => await request(baseUrl, token, "/runs", { method: "POST", body: runPayload }, 201)
    );
    const runId = readId(created, "run");
    await step(
      "heartbeat run",
      async () =>
        await request(baseUrl, token, `/runs/${encodeURIComponent(runId)}/heartbeat`, {
          method: "POST"
        })
    );

    for (const event of [
      { type: "progress", message: "Lifecycle started", importance: 4 },
      {
        type: "files_changed",
        message: "Smoke fixture changed",
        importance: 4,
        data: { changedFiles: ["smoke-fixture.txt"] }
      },
      {
        type: "command_executed",
        message: "Executed smoke command",
        importance: 4,
        data: { argv: ["node", "smoke"], exitCode: 0, durationMs: 1, logPath: "smoke.log" }
      },
      { type: "test_passed", message: "Smoke assertion passed", importance: 5 }
    ]) {
      await step(
        `record ${event.type}`,
        async () =>
          await request(
            baseUrl,
            token,
            "/events",
            {
              method: "POST",
              body: { runId, ...event, category: "verification", tags: ["smoke"] }
            },
            201
          )
      );
    }

    const loop = await step(
      "create open loop",
      async () =>
        await request(
          baseUrl,
          token,
          "/open-loops",
          {
            method: "POST",
            body: {
              type: "needs_review",
              project: "runtrail-smoke",
              title: "Review smoke lifecycle",
              source: "smoke",
              nextAction: "Resolve smoke loop",
              sourceRunId: runId
            }
          },
          201
        )
    );
    const loopId = readId(loop, "openLoop");
    await step(
      "resolve open loop",
      async () =>
        await request(baseUrl, token, `/open-loops/${encodeURIComponent(loopId)}`, {
          method: "PATCH",
          body: { status: "resolved", resolution: "Smoke lifecycle verified" }
        })
    );
    await step(
      "record decision",
      async () =>
        await request(
          baseUrl,
          token,
          "/decisions",
          {
            method: "POST",
            body: {
              project: "runtrail-smoke",
              title: "Use deterministic smoke lifecycle",
              decision: "Keep the smoke command offline and isolated"
            }
          },
          201
        )
    );
    await step(
      "record handoff",
      async () =>
        await request(
          baseUrl,
          token,
          "/handoffs",
          {
            method: "POST",
            body: {
              sourceRunId: runId,
              fromSource: "smoke",
              toSource: "maintainer",
              project: "runtrail-smoke",
              summary: "Smoke lifecycle complete",
              nextAction: "Inspect manifest"
            }
          },
          201
        )
    );
    await step(
      "finish run",
      async () =>
        await request(baseUrl, token, `/runs/${encodeURIComponent(runId)}/finish`, {
          method: "POST",
          body: { status: "completed", summary: "Smoke lifecycle complete" }
        })
    );

    const context = await step(
      "verify context",
      async () =>
        await request(baseUrl, token, "/agent/context?project=runtrail-smoke&min_importance=0")
    );
    assertIncludes(readArray(context, "recent_events"), "type", "command_executed");
    assertIncludes(readArray(context, "decisions"), "title", "Use deterministic smoke lifecycle");

    const manifest = await step(
      "verify manifest",
      async () => await request(baseUrl, token, `/runs/${encodeURIComponent(runId)}/manifest`)
    );
    const manifestBody = readRecord(manifest, "manifest");
    if (readRecord(manifestBody, "run").status !== "completed") {
      throw new Error("manifest run was not completed");
    }
    assertIncludes(readArray(manifestBody, "commands"), "exitCode", 0);
    assertIncludes(readArray(manifestBody, "tests"), "type", "test_passed");
    assertIncludes(readArray(manifestBody, "changed_files"), undefined, "smoke-fixture.txt");
    assertIncludes(readArray(manifestBody, "handoffs"), "summary", "Smoke lifecycle complete");

    const replay = await step(
      "verify idempotent replay",
      async () => await request(baseUrl, token, "/runs", { method: "POST", body: runPayload }, 200)
    );
    if (readId(replay, "run") !== runId) {
      throw new Error("replayed clientRunId returned a different run");
    }

    console.log("Smoke lifecycle passed");
  } finally {
    if (hooks.installSignalHandlers !== false) {
      process.removeListener("SIGINT", interrupt);
      process.removeListener("SIGTERM", interrupt);
    }
    await cleanup();
  }
}

async function step<T>(name: string, action: () => Promise<T>): Promise<T> {
  console.log(`Smoke: ${name}`);
  try {
    return await action();
  } catch (error) {
    throw new Error(
      `Smoke step failed (${name}): ${error instanceof Error ? error.message : "unknown error"}`
    );
  }
}

async function request(
  baseUrl: string,
  token: string,
  route: string,
  options: { method?: string; body?: Record<string, unknown> } = {},
  expectedStatus = 200
): Promise<unknown> {
  const response = await fetch(new URL(route, baseUrl), {
    method: options.method,
    headers: {
      authorization: `Bearer ${token}`,
      ...(options.body ? { "content-type": "application/json" } : {})
    },
    body: options.body ? JSON.stringify(options.body) : undefined,
    signal: AbortSignal.timeout(5_000)
  });
  if (response.status !== expectedStatus) {
    throw new Error(`HTTP ${response.status}; expected ${expectedStatus}`);
  }
  return await response.json();
}

async function waitForHealth(baseUrl: string): Promise<void> {
  const deadline = Date.now() + startupTimeoutMs;
  while (Date.now() < deadline) {
    try {
      const response = await fetch(new URL("/health", baseUrl), {
        signal: AbortSignal.timeout(500)
      });
      if (response.ok) return;
    } catch {
      // The isolated child may still be starting.
    }
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
  throw new Error("service readiness timed out");
}

async function allocatePort(): Promise<number> {
  return await new Promise((resolve, reject) => {
    const server = createServer();
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => {
      const address = server.address();
      const port = address && typeof address === "object" ? address.port : undefined;
      server.close((error) => (error || port === undefined ? reject(error) : resolve(port)));
    });
  });
}

async function waitForExit(child: ChildProcess, timeoutMs: number): Promise<void> {
  if (child.exitCode !== null) return;
  await new Promise<void>((resolve) => {
    const timeout = setTimeout(() => {
      child.kill("SIGKILL");
      resolve();
    }, timeoutMs);
    child.once("exit", () => {
      clearTimeout(timeout);
      resolve();
    });
  });
}

function readRecord(value: unknown, key: string): Record<string, unknown> {
  if (!value || typeof value !== "object" || !(key in value))
    throw new Error(`response missing ${key}`);
  const nested = (value as Record<string, unknown>)[key];
  if (!nested || typeof nested !== "object" || Array.isArray(nested))
    throw new Error(`response ${key} is invalid`);
  return nested as Record<string, unknown>;
}

function readId(value: unknown, key: string): string {
  const id = readRecord(value, key).id;
  if (typeof id !== "string") throw new Error(`response missing ${key}.id`);
  return id;
}

function readArray(value: unknown, key: string): unknown[] {
  if (!value || typeof value !== "object") throw new Error(`response missing ${key}`);
  const array = (value as Record<string, unknown>)[key];
  if (!Array.isArray(array)) throw new Error(`response ${key} is invalid`);
  return array;
}

function assertIncludes(values: unknown[], key: string | undefined, expected: unknown): void {
  const found = values.some((value) =>
    key && value && typeof value === "object"
      ? (value as Record<string, unknown>)[key] === expected
      : value === expected
  );
  if (!found) throw new Error(`expected lifecycle fact was not present`);
}

if (import.meta.url === `file://${process.argv[1]}`) {
  runLifecycleSmoke().catch((error: unknown) => {
    console.error(error instanceof Error ? error.message : "Smoke lifecycle failed");
    process.exitCode = 1;
  });
}
