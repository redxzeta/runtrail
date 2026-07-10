import { execFileSync } from "node:child_process";
import { mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import Database from "better-sqlite3";
import { afterEach, describe, expect, it, vi } from "vitest";
import { loadConfig } from "../src/config.js";
import { migrate } from "../src/db/migrate.js";
import { createApp } from "../src/index.js";
import { handleCodexHook, runCodexHook } from "../src/integrations/codexHook.js";

const tempDirs: string[] = [];
const databases: Database.Database[] = [];

afterEach(() => {
  for (const dir of tempDirs.splice(0)) {
    rmSync(dir, { recursive: true, force: true });
  }
  for (const database of databases.splice(0)) {
    database.close();
  }
  vi.restoreAllMocks();
});

describe("Codex hook adapter", () => {
  it("keeps one run per session and emits structured, secret-free manifest events", async () => {
    const repo = createGitRepo();
    const stateDir = createTempDir("runtrail-codex-state-");
    const server = createRuntrailServer();
    const env = adapterEnv(stateDir);
    const base = {
      session_id: "codex-session-1",
      cwd: repo,
      model: "secret-model-field",
      permission_mode: "bypassPermissions",
      authorization: "Bearer should-never-persist"
    };

    await Promise.all([
      handleCodexHook(
        { ...base, hook_event_name: "SessionStart", source: "startup" },
        { env, fetch: server.fetch }
      ),
      handleCodexHook(
        { ...base, hook_event_name: "SessionStart", source: "resume" },
        { env, fetch: server.fetch }
      ),
      handleCodexHook(
        {
          ...base,
          hook_event_name: "UserPromptSubmit",
          turn_id: "turn-1",
          prompt: "secret prompt that must never persist"
        },
        { env, fetch: server.fetch }
      )
    ]);

    writeFileSync(path.join(repo, "src.ts"), "export const changed = true;\n");
    writeFileSync(path.join(repo, "new.test.ts"), "export const tested = true;\n");
    await handleCodexHook(
      {
        ...base,
        hook_event_name: "PostToolUse",
        turn_id: "turn-1",
        tool_name: "apply_patch",
        tool_use_id: "tool-edit",
        tool_input: {
          command: "*** secret patch body ***",
          apiKey: "tool-input-secret"
        },
        tool_response: { output: "tool-output-secret" },
        arbitrary: { nestedSecret: "arbitrary-secret" }
      },
      { env, fetch: server.fetch }
    );
    await handleCodexHook(
      {
        ...base,
        hook_event_name: "PostToolUse",
        turn_id: "turn-1",
        tool_name: "Bash",
        tool_use_id: "tool-test",
        tool_input: {
          command:
            "RUNTRAIL_TOKEN=super-secret API_KEY=also-secret pnpm test -- --api-key top-secret"
        },
        tool_response: {
          exit_code: 0,
          stdout: "test-output-secret",
          stderr: "test-error-secret"
        }
      },
      { env, fetch: server.fetch }
    );
    await handleCodexHook(
      { ...base, hook_event_name: "Stop", turn_id: "turn-1", last_assistant_message: "secret" },
      { env, fetch: server.fetch }
    );

    const runCreates = server.requests.filter(
      (request) => request.path === "/runs" && request.method === "POST"
    );
    const events = server.requests
      .filter((request) => request.path === "/events")
      .map((request) => request.body);
    const persisted = JSON.stringify(server.requests);
    const stateFiles = readdirSync(stateDir).filter((name) => name.endsWith(".json"));
    const state = JSON.parse(readFileSync(path.join(stateDir, stateFiles[0] ?? ""), "utf8")) as {
      runId: string;
      sessionHash: string;
    };

    expect(server.runs).toHaveLength(1);
    expect(new Set(runCreates.map((request) => request.body.clientRunId))).toEqual(
      new Set(["codex-session-1"])
    );
    expect(stateFiles).toHaveLength(1);
    expect(state.runId).toBe(server.runs[0]?.id);
    expect(state.sessionHash).toMatch(/^[a-f0-9]{64}$/);
    expect(events).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          type: "files_changed",
          data: { changedFiles: ["new.test.ts", "src.ts"] }
        }),
        expect.objectContaining({ type: "command_executed", message: "pnpm test" }),
        expect.objectContaining({ type: "test_started", message: "pnpm test started" }),
        expect.objectContaining({ type: "test_passed", message: "pnpm test passed" }),
        expect.objectContaining({ type: "completed", message: "Codex turn completed" })
      ])
    );
    expect(server.runs[0]).toEqual(expect.objectContaining({ status: "completed" }));

    for (const secret of [
      "secret prompt",
      "should-never-persist",
      "secret patch body",
      "tool-input-secret",
      "tool-output-secret",
      "super-secret",
      "also-secret",
      "top-secret",
      "test-output-secret",
      "test-error-secret",
      "arbitrary-secret",
      "secret-model-field"
    ]) {
      expect(persisted).not.toContain(secret);
    }
  });

  it("produces non-empty changed-file, command, and test manifest sections", async () => {
    const repo = createGitRepo();
    const stateDir = createTempDir("runtrail-codex-state-");
    const db = new Database(":memory:");
    databases.push(db);
    migrate(db);
    const config = loadConfig();
    config.security.authRequired = true;
    config.security.token = "local-test-token";
    const app = createApp({ db, config });
    const fetchApp = ((url: URL | RequestInfo, init?: RequestInit) => {
      const parsed = url instanceof URL ? url : new URL(String(url));
      return app.request(`${parsed.pathname}${parsed.search}`, init);
    }) as typeof globalThis.fetch;
    const env = adapterEnv(stateDir);
    const base = {
      session_id: "manifest-session",
      cwd: repo
    };

    await handleCodexHook(
      { ...base, hook_event_name: "SessionStart", source: "startup" },
      { env, fetch: fetchApp }
    );
    writeFileSync(path.join(repo, "src.ts"), "export const manifest = true;\n");
    await handleCodexHook(
      {
        ...base,
        hook_event_name: "PostToolUse",
        tool_name: "apply_patch",
        tool_use_id: "edit-1",
        tool_input: { command: "redacted by adapter" },
        tool_response: {}
      },
      { env, fetch: fetchApp }
    );
    await handleCodexHook(
      {
        ...base,
        hook_event_name: "PostToolUse",
        tool_name: "Bash",
        tool_use_id: "test-1",
        tool_input: { command: "pnpm test -- test/codex-hook.test.ts" },
        tool_response: { exit_code: 0, stdout: "not persisted" }
      },
      { env, fetch: fetchApp }
    );
    await handleCodexHook(
      { ...base, hook_event_name: "Stop", turn_id: "turn-1" },
      { env, fetch: fetchApp }
    );

    const runList = await app.request("/runs?project=adapter-project&limit=1", {
      headers: { authorization: "Bearer local-test-token" }
    });
    const listed = (await runList.json()) as { runs: Array<{ id: string; status: string }> };
    const manifestResponse = await app.request(`/runs/${listed.runs[0]?.id}/manifest`, {
      headers: { authorization: "Bearer local-test-token" }
    });
    const body = (await manifestResponse.json()) as {
      manifest: {
        changed_files: string[];
        commands: Array<{ message: string }>;
        tests: Array<{ type: string; message: string }>;
      };
    };

    expect(listed.runs[0]).toEqual(expect.objectContaining({ status: "completed" }));
    expect(body.manifest.changed_files).toEqual(["src.ts"]);
    expect(body.manifest.commands).toEqual([expect.objectContaining({ message: "pnpm test" })]);
    expect(body.manifest.tests).toEqual([
      expect.objectContaining({ type: "test_started", message: "pnpm test started" }),
      expect.objectContaining({ type: "test_passed", message: "pnpm test passed" })
    ]);
  });

  it("reopens the same run for a later turn and creates a new run for a distinct session", async () => {
    const repo = createGitRepo();
    const stateDir = createTempDir("runtrail-codex-state-");
    const server = createRuntrailServer();
    const env = adapterEnv(stateDir);

    for (const event of ["SessionStart", "Stop", "UserPromptSubmit", "Stop"] as const) {
      await handleCodexHook(
        {
          session_id: "session-one",
          cwd: repo,
          hook_event_name: event,
          ...(event === "SessionStart" ? { source: "startup" } : {})
        },
        { env, fetch: server.fetch }
      );
    }
    await handleCodexHook(
      {
        session_id: "session-two",
        cwd: repo,
        hook_event_name: "SessionStart",
        source: "startup"
      },
      { env, fetch: server.fetch }
    );

    expect(server.runs).toHaveLength(2);
    expect(server.runs.find((run) => run.clientRunId === "session-one")).toEqual(
      expect.objectContaining({ status: "completed" })
    );
    expect(server.runs.find((run) => run.clientRunId === "session-two")).toEqual(
      expect.objectContaining({ status: "running" })
    );
    expect(readdirSync(stateDir).filter((name) => name.endsWith(".json"))).toHaveLength(2);
  });

  it("fails open with a concise diagnostic when Runtrail is unavailable", async () => {
    const diagnostics: string[] = [];

    await expect(
      runCodexHook(
        {
          session_id: "session-unavailable",
          cwd: process.cwd(),
          hook_event_name: "SessionStart",
          source: "startup",
          prompt: "must not appear"
        },
        {
          env: adapterEnv(createTempDir("runtrail-codex-state-")),
          fetch: vi.fn(async () => {
            throw new Error("network error with token=secret");
          }),
          stderr: (message) => diagnostics.push(message)
        }
      )
    ).resolves.toBeUndefined();
    expect(diagnostics).toEqual(["runtrail-codex-hook: unexpected adapter failure"]);
  });
});

function createRuntrailServer(): {
  fetch: typeof globalThis.fetch;
  requests: Array<{ path: string; method: string; body: Record<string, unknown> }>;
  runs: Array<{ id: string; source: string; project: string; clientRunId: string; status: string }>;
} {
  const requests: Array<{ path: string; method: string; body: Record<string, unknown> }> = [];
  const runs: Array<{
    id: string;
    source: string;
    project: string;
    clientRunId: string;
    status: string;
  }> = [];
  const fetchMock = vi.fn(async (url: URL | RequestInfo, init?: RequestInit) => {
    const parsedUrl = url instanceof URL ? url : new URL(String(url));
    const body = JSON.parse(String(init?.body ?? "{}")) as Record<string, unknown>;
    const method = init?.method ?? "GET";
    requests.push({ path: parsedUrl.pathname, method, body });

    if (parsedUrl.pathname === "/runs" && method === "POST") {
      let run = runs.find(
        (candidate) =>
          candidate.source === body.source &&
          candidate.project === body.project &&
          candidate.clientRunId === body.clientRunId
      );
      if (!run) {
        run = {
          id: `run_${runs.length + 1}`,
          source: String(body.source),
          project: String(body.project),
          clientRunId: String(body.clientRunId),
          status: "running"
        };
        runs.push(run);
      }
      return jsonResponse({ run }, 200);
    }

    if (parsedUrl.pathname.startsWith("/runs/") && method === "PATCH") {
      const run = runs.find((candidate) => candidate.id === parsedUrl.pathname.split("/").at(-1));
      if (run && typeof body.status === "string") {
        run.status = body.status;
      }
      return jsonResponse({ run });
    }

    return jsonResponse({ event: { id: `evt_${requests.length}` } }, 201);
  });

  return { fetch: fetchMock as typeof globalThis.fetch, requests, runs };
}

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" }
  });
}

function adapterEnv(stateDir: string): NodeJS.ProcessEnv {
  return {
    RUNTRAIL_URL: "http://runtrail.test:8787",
    RUNTRAIL_TOKEN: "local-test-token",
    RUNTRAIL_PROJECT: "adapter-project",
    RUNTRAIL_CODEX_STATE_DIR: stateDir
  };
}

function createGitRepo(): string {
  const repo = createTempDir("runtrail-codex-repo-");
  execFileSync("git", ["init", "-q"], { cwd: repo });
  execFileSync("git", ["config", "user.email", "test@example.com"], { cwd: repo });
  execFileSync("git", ["config", "user.name", "Runtrail Test"], { cwd: repo });
  writeFileSync(path.join(repo, "src.ts"), "export const initial = true;\n");
  execFileSync("git", ["add", "src.ts"], { cwd: repo });
  execFileSync("git", ["commit", "-qm", "initial"], { cwd: repo });
  return repo;
}

function createTempDir(prefix: string): string {
  const dir = mkdtempSync(path.join(tmpdir(), prefix));
  tempDirs.push(dir);
  return dir;
}
