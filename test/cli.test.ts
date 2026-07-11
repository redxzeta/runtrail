import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { runCli } from "../src/cli/index.js";
import { computeEventHash } from "../src/shared/receipts.js";
import type { AgentEvent } from "../src/shared/schemas.js";

describe("cli", () => {
  afterEach(() => {
    process.exitCode = undefined;
    if (tempDir) {
      rmSync(tempDir, { recursive: true, force: true });
      tempDir = undefined;
    }
    vi.unstubAllEnvs();
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
    vi.useRealTimers();
  });

  it("prints health response JSON", async () => {
    vi.stubEnv("RUNTRAIL_URL", "http://runtrail.test");
    vi.stubEnv("RUNTRAIL_TOKEN", "");
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => {
        return new Response(
          JSON.stringify({
            ok: true,
            service: "runtrail"
          }),
          {
            status: 200,
            headers: {
              "content-type": "application/json"
            }
          }
        );
      })
    );
    const output: string[] = [];
    vi.spyOn(console, "log").mockImplementation((message: string) => {
      output.push(message);
    });

    await runCli(["node", "rt", "health"]);

    expect(fetch).toHaveBeenCalledWith(
      new URL("/health", "http://runtrail.test"),
      expect.objectContaining({
        method: undefined
      })
    );
    expect(JSON.parse(output.join("\n"))).toEqual({
      ok: true,
      service: "runtrail"
    });
  });

  it("fetches project context with query options", async () => {
    const fetchMock = mockFetch({
      project: "runtrail",
      recent_runs: [],
      recent_events: [],
      open_loops: [],
      decisions: [],
      next_actions: []
    });
    const output = captureOutput();

    await runCli([
      "node",
      "rt",
      "context",
      "--project",
      "runtrail",
      "--limit",
      "5",
      "--min-importance",
      "6"
    ]);

    expect(fetchMock).toHaveBeenCalledWith(
      new URL("/agent/context?project=runtrail&limit=5&min_importance=6", "http://runtrail.test"),
      expect.any(Object)
    );
    expect(JSON.parse(output.join("\n"))).toEqual(
      expect.objectContaining({
        project: "runtrail"
      })
    );
  });

  it("creates runs, events, loops, decisions, and handoffs through the API", async () => {
    const fetchMock = mockFetch({ ok: true });
    captureOutput();

    await runCli([
      "node",
      "rt",
      "run",
      "create",
      "--source",
      "codex",
      "--project",
      "runtrail",
      "--task",
      "ship cli",
      "--client-run-id",
      "session-82",
      "--category",
      "implementation",
      "--tag",
      "cli",
      "--tag",
      "metadata"
    ]);
    await runCli([
      "node",
      "rt",
      "event",
      "create",
      "--run-id",
      "run_1",
      "--type",
      "progress",
      "--message",
      "wired commands",
      "--importance",
      "5",
      "--category",
      "implementation",
      "--tag",
      "cli",
      "--data-json",
      '{"files":["src/cli/index.ts"]}'
    ]);
    await runCli([
      "node",
      "rt",
      "loop",
      "add",
      "--type",
      "blocked",
      "--project",
      "runtrail",
      "--title",
      "Need review",
      "--description",
      "Review collaboration fields",
      "--owner",
      "maintainer",
      "--source",
      "codex",
      "--next-action",
      "Review payload",
      "--blocker-ref",
      "issue-105",
      "--source-run-id",
      "run_1"
    ]);
    await runCli(["node", "rt", "loop", "resolve", "loop_1", "--resolution", "Reviewed"]);
    await runCli([
      "node",
      "rt",
      "decision",
      "add",
      "--project",
      "runtrail",
      "--title",
      "Use CLI",
      "--decision",
      "Expose HTTP API through rt"
    ]);
    await runCli([
      "node",
      "rt",
      "handoff",
      "create",
      "--source-run-id",
      "run_1",
      "--from-source",
      "codex",
      "--to-source",
      "openclaw",
      "--project",
      "runtrail",
      "--summary",
      "Continue CLI metadata",
      "--next-action",
      "Verify wrapper flags",
      "--category",
      "implementation",
      "--tag",
      "cli",
      "--tag",
      "issue-79",
      "--context-json",
      '{"changedFiles":["src/cli/index.ts"]}'
    ]);

    expect(fetchMock).toHaveBeenNthCalledWith(
      1,
      new URL("/runs", "http://runtrail.test"),
      expect.objectContaining({
        method: "POST",
        body: JSON.stringify({
          source: "codex",
          project: "runtrail",
          clientRunId: "session-82",
          task: "ship cli",
          category: "implementation",
          tags: ["cli", "metadata"]
        })
      })
    );
    expect(fetchMock).toHaveBeenNthCalledWith(
      2,
      new URL("/events", "http://runtrail.test"),
      expect.objectContaining({
        method: "POST",
        body: JSON.stringify({
          runId: "run_1",
          type: "progress",
          message: "wired commands",
          importance: 5,
          category: "implementation",
          tags: ["cli"],
          data: { files: ["src/cli/index.ts"] }
        })
      })
    );
    expect(fetchMock).toHaveBeenNthCalledWith(
      3,
      new URL("/open-loops", "http://runtrail.test"),
      expect.objectContaining({
        method: "POST",
        body: JSON.stringify({
          type: "blocked",
          project: "runtrail",
          title: "Need review",
          description: "Review collaboration fields",
          owner: "maintainer",
          source: "codex",
          nextAction: "Review payload",
          blockerRef: "issue-105",
          sourceRunId: "run_1"
        })
      })
    );
    expect(fetchMock).toHaveBeenNthCalledWith(
      4,
      new URL("/open-loops/loop_1", "http://runtrail.test"),
      expect.objectContaining({
        method: "PATCH",
        body: JSON.stringify({
          status: "resolved",
          resolution: "Reviewed"
        })
      })
    );
    expect(fetchMock).toHaveBeenNthCalledWith(
      5,
      new URL("/decisions", "http://runtrail.test"),
      expect.objectContaining({ method: "POST" })
    );
    expect(fetchMock).toHaveBeenNthCalledWith(
      6,
      new URL("/handoffs", "http://runtrail.test"),
      expect.objectContaining({
        method: "POST",
        body: JSON.stringify({
          sourceRunId: "run_1",
          fromSource: "codex",
          toSource: "openclaw",
          project: "runtrail",
          summary: "Continue CLI metadata",
          nextAction: "Verify wrapper flags",
          category: "implementation",
          tags: ["cli", "issue-79"],
          context: { changedFiles: ["src/cli/index.ts"] }
        })
      })
    );
  });

  it("reports stale runs by default and requires --apply to close them", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-07-09T12:00:00.000Z"));
    const fetchMock = mockFetch({
      dryRun: true,
      updatedBefore: "2026-07-08T12:00:00.000Z",
      candidateCount: 1,
      closedCount: 0,
      candidates: [{ id: "run_stale" }],
      closed: []
    });
    const output = captureOutput();

    await runCli(["node", "rt", "runs", "close-stale", "--older-than", "24h"]);
    await runCli([
      "node",
      "rt",
      "runs",
      "close-stale",
      "--older-than",
      "7d",
      "--limit",
      "25",
      "--apply"
    ]);

    expect(fetchMock).toHaveBeenNthCalledWith(
      1,
      new URL("/runs/close-stale", "http://runtrail.test"),
      expect.objectContaining({
        method: "POST",
        body: JSON.stringify({
          updatedBefore: "2026-07-08T12:00:00.000Z",
          apply: false,
          limit: 100
        })
      })
    );
    expect(fetchMock).toHaveBeenNthCalledWith(
      2,
      new URL("/runs/close-stale", "http://runtrail.test"),
      expect.objectContaining({
        method: "POST",
        body: JSON.stringify({
          updatedBefore: "2026-07-02T12:00:00.000Z",
          apply: true,
          limit: 25
        })
      })
    );
    expect(JSON.parse(output[0] ?? "{}")).toEqual(expect.objectContaining({ candidateCount: 1 }));
  });

  it("rejects invalid stale-run durations before calling the API", async () => {
    const fetchMock = mockFetch({ ok: true });

    await expect(
      runCli(["node", "rt", "runs", "close-stale", "--older-than", "yesterday"])
    ).rejects.toThrow("Expected a duration such as 30m, 24h, or 7d");
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("sends bearer token and reports useful HTTP errors", async () => {
    vi.stubEnv("RUNTRAIL_URL", "http://runtrail.test");
    vi.stubEnv("RUNTRAIL_TOKEN", "secret-token");
    const fetchMock = vi.fn(async () => {
      return new Response(JSON.stringify({ error: "Unauthorized" }), { status: 401 });
    });
    vi.stubGlobal("fetch", fetchMock);

    await expect(runCli(["node", "rt", "context", "--project", "runtrail"])).rejects.toThrow(
      "HTTP 401: Unauthorized"
    );

    const [, init] = fetchMock.mock.calls[0] as unknown as [URL, { headers: Headers }];
    const headers = init.headers;
    expect(headers.get("authorization")).toBe("Bearer secret-token");
  });

  it("rejects invalid event data JSON before calling the API", async () => {
    const fetchMock = mockFetch({ ok: true });

    await expect(
      runCli([
        "node",
        "rt",
        "event",
        "create",
        "--run-id",
        "run_1",
        "--type",
        "progress",
        "--message",
        "bad data",
        "--data-json",
        "{"
      ])
    ).rejects.toThrow("Invalid JSON for --data-json");
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("verifies run event receipts", async () => {
    const events = addReceiptChain([
      {
        id: "evt_1",
        runId: "run_1",
        type: "progress",
        message: "captured work",
        importance: 4,
        createdAt: "2026-06-26T09:00:00.000Z"
      }
    ]);
    const fetchMock = mockFetch({ run: { id: "run_1" }, events });
    const output = captureOutput();

    await runCli(["node", "rt", "verify", "run", "run_1"]);

    expect(fetchMock).toHaveBeenCalledWith(
      new URL("/runs/run_1", "http://runtrail.test"),
      expect.any(Object)
    );
    expect(JSON.parse(output.join("\n"))).toEqual({
      runId: "run_1",
      status: "pass",
      checkedEvents: 1
    });
    expect(process.exitCode).toBeUndefined();
  });

  it("fails receipt verification when event content changes", async () => {
    const [event] = addReceiptChain([
      {
        id: "evt_1",
        runId: "run_1",
        type: "progress",
        message: "captured work",
        importance: 4,
        createdAt: "2026-06-26T09:00:00.000Z"
      }
    ]);
    mockFetch({
      run: { id: "run_1" },
      events: [{ ...event, message: "changed after receipt" }]
    });
    const output = captureOutput();

    await runCli(["node", "rt", "verify", "run", "run_1"]);

    expect(JSON.parse(output.join("\n"))).toEqual({
      runId: "run_1",
      status: "fail",
      checkedEvents: 0,
      eventId: "evt_1",
      reason: "event hash does not match event content"
    });
    expect(process.exitCode).toBe(1);
  });

  it("reports runs without event receipts as unverifiable", async () => {
    mockFetch({
      run: { id: "run_1" },
      events: [
        {
          id: "evt_1",
          runId: "run_1",
          type: "progress",
          message: "old event",
          importance: 4,
          createdAt: "2026-06-26T09:00:00.000Z"
        }
      ]
    });
    const output = captureOutput();

    await runCli(["node", "rt", "verify", "run", "run_1"]);

    expect(JSON.parse(output.join("\n"))).toEqual({
      runId: "run_1",
      status: "unverifiable",
      checkedEvents: 0,
      eventId: "evt_1",
      reason: "missing event hash"
    });
    expect(process.exitCode).toBe(1);
  });

  it("wraps a successful command in a completed run", async () => {
    const fetchMock = mockRunWrapperFetch();
    vi.stubEnv("RUNTRAIL_LOG_DIR", "./data/test-cli-logs");
    const output = captureOutput();

    await runCli([
      "node",
      "rt",
      "run",
      "--source",
      "codex",
      "--project",
      "runtrail",
      "--task",
      "wrapper success",
      "--category",
      "implementation",
      "--tag",
      "codex",
      "--tag",
      "issue-72",
      "--",
      process.execPath,
      "-e",
      "process.stdout.write('wrapped ok')",
      "--",
      "--token",
      "super-secret",
      "--api-key=also-secret"
    ]);

    expect(process.exitCode).toBe(0);
    expect(output.join("\n")).toContain("wrapped ok");
    expect(fetchMock).toHaveBeenNthCalledWith(
      1,
      new URL("/runs", "http://runtrail.test"),
      expect.objectContaining({
        method: "POST",
        body: expect.stringContaining('"task":"wrapper success"')
      })
    );
    const createRunBody = JSON.parse(String(fetchMock.mock.calls[0]?.[1]?.body)) as {
      category?: string;
      tags?: string[];
    };
    expect(createRunBody.category).toBe("implementation");
    expect(createRunBody.tags).toEqual(["codex", "issue-72"]);
    const eventBodies = fetchMock.mock.calls
      .filter(([url]) => (url as URL).pathname === "/events")
      .map(([, init]) => JSON.parse(String(init?.body)) as Record<string, unknown>);
    expect(eventBodies[0]?.type).toBe("command_executed");
    expect(eventBodies.at(-1)?.type).toBe("completed");
    expect(eventBodies.filter((body) => body.type === "files_changed").length).toBeLessThanOrEqual(
      1
    );
    const commandEventBody = eventBodies[0] as {
      category?: string;
      tags?: string[];
      data?: { argv?: string[]; exitCode?: number; durationMs?: number; logPath?: string };
    };
    expect(commandEventBody.category).toBe("implementation");
    expect(commandEventBody.tags).toEqual(["codex", "issue-72"]);
    expect(commandEventBody.data).toEqual(
      expect.objectContaining({
        argv: [
          process.execPath,
          "-e",
          "process.stdout.write('wrapped ok')",
          "--",
          "--token",
          "[REDACTED]",
          "--api-key=[REDACTED]"
        ],
        exitCode: 0,
        durationMs: expect.any(Number),
        logPath: expect.any(String)
      })
    );
    expect(JSON.stringify(commandEventBody)).not.toContain("super-secret");
    expect(JSON.stringify(commandEventBody)).not.toContain("also-secret");
    expect(fetchMock).toHaveBeenCalledWith(
      new URL("/runs/run_wrap", "http://runtrail.test"),
      expect.objectContaining({
        method: "PATCH",
        body: expect.stringContaining('"status":"completed"')
      })
    );
    expect(JSON.parse(output.at(-1) ?? "{}")).toEqual(
      expect.objectContaining({
        runId: "run_wrap",
        status: "completed",
        exitCode: 0
      })
    );
  });

  it("wraps a failed command in a failed run and preserves exit code", async () => {
    const fetchMock = mockRunWrapperFetch();
    vi.stubEnv("RUNTRAIL_LOG_DIR", "./data/test-cli-logs");
    captureOutput();

    await runCli([
      "node",
      "rt",
      "run",
      "--source",
      "codex",
      "--project",
      "runtrail",
      "--task",
      "wrapper failure",
      "--",
      process.execPath,
      "-e",
      "process.exit(7)"
    ]);

    expect(process.exitCode).toBe(7);
    const eventBodies = fetchMock.mock.calls
      .filter(([url]) => (url as URL).pathname === "/events")
      .map(([, init]) => JSON.parse(String(init?.body)) as Record<string, unknown>);
    expect(eventBodies[0]).toEqual(
      expect.objectContaining({
        type: "command_executed",
        data: expect.objectContaining({ exitCode: 7 })
      })
    );
    expect(eventBodies.at(-1)).toEqual(
      expect.objectContaining({ type: "failed", data: { exitCode: 7 } })
    );
    expect(fetchMock).toHaveBeenCalledWith(
      new URL("/runs/run_wrap", "http://runtrail.test"),
      expect.objectContaining({
        method: "PATCH",
        body: expect.stringContaining('"status":"failed"')
      })
    );
  });

  it("exports project context as Markdown", async () => {
    const fetchMock = mockFetch({
      project: "runtrail",
      recent_runs: [
        {
          id: "run_1",
          status: "completed",
          task: "ship exports",
          project: "runtrail",
          summary: "Markdown generated"
        }
      ],
      open_loops: [{ id: "loop_1", type: "blocked", title: "Resolve export path" }],
      decisions: [{ title: "SQLite source", decision: "Markdown is export-only" }],
      next_actions: ["Review export output"]
    });
    const output = captureOutput();

    await runCli(["node", "rt", "export", "project", "--project", "runtrail"]);

    expect(fetchMock).toHaveBeenCalledWith(
      new URL("/agent/context?project=runtrail", "http://runtrail.test"),
      expect.any(Object)
    );
    expect(output.join("\n")).toContain("# runtrail project export");
    expect(output.join("\n")).toContain("ship exports");
    expect(output.join("\n")).toContain("Markdown is export-only");
    expect(output.join("\n")).toContain("Review export output");
  });

  it("exports daily Markdown using server-side started date filters", async () => {
    const fetchMock = mockFetch({
      runs: [
        {
          id: "run_1",
          status: "completed",
          task: "ship export",
          project: "runtrail",
          startedAt: "2026-06-27T12:00:00.000Z"
        }
      ]
    });
    const output = captureOutput();

    await runCli([
      "node",
      "rt",
      "export",
      "daily",
      "--project",
      "runtrail",
      "--date",
      "2026-06-27"
    ]);

    expect(fetchMock).toHaveBeenCalledWith(
      new URL(
        "/runs?project=runtrail&started_from=2026-06-27T00%3A00%3A00.000Z&started_to=2026-06-28T00%3A00%3A00.000Z&limit=100",
        "http://runtrail.test"
      ),
      expect.any(Object)
    );
    expect(output.join("\n")).toContain("# runtrail daily export - 2026-06-27");
    expect(output.join("\n")).toContain("ship export");
  });

  it("writes decision exports to a Markdown file", async () => {
    mockFetch({
      decisions: [{ title: "SQLite source", decision: "Markdown is generated from API data" }]
    });
    tempDir = mkdtempSync(path.join(tmpdir(), "runtrail-cli-"));
    const outputPath = path.join(tempDir, "decisions.md");
    const output = captureOutput();

    await runCli(["node", "rt", "export", "decisions", "--output", outputPath]);

    expect(output).toEqual([`Wrote ${outputPath}`]);
    expect(readFileSync(outputPath, "utf8")).toContain("# Decisions export");
    expect(readFileSync(outputPath, "utf8")).toContain("Markdown is generated from API data");
  });

  it("forwards collaboration filters for open-loop exports", async () => {
    const fetchMock = mockFetch({ openLoops: [] });
    captureOutput();

    await runCli([
      "node",
      "rt",
      "export",
      "open-loops",
      "--project",
      "runtrail",
      "--owner",
      "maintainer",
      "--source",
      "codex",
      "--source-run-id",
      "run_1"
    ]);

    expect(fetchMock).toHaveBeenCalledWith(
      new URL(
        "/open-loops?project=runtrail&owner=maintainer&source=codex&sourceRunId=run_1",
        "http://runtrail.test"
      ),
      expect.any(Object)
    );
  });
});

let tempDir: string | undefined;

function mockFetch(body: unknown): ReturnType<typeof vi.fn> {
  vi.stubEnv("RUNTRAIL_URL", "http://runtrail.test");
  vi.stubEnv("RUNTRAIL_TOKEN", "");
  const fetchMock = vi.fn(async () => {
    return new Response(JSON.stringify(body), {
      status: 200,
      headers: {
        "content-type": "application/json"
      }
    });
  });
  vi.stubGlobal("fetch", fetchMock);
  return fetchMock;
}

function captureOutput(): string[] {
  const output: string[] = [];
  vi.spyOn(console, "log").mockImplementation((message: string) => {
    output.push(message);
  });
  vi.spyOn(process.stdout, "write").mockImplementation((chunk: string | Uint8Array) => {
    output.push(String(chunk));
    return true;
  });
  return output;
}

function mockRunWrapperFetch(): ReturnType<typeof vi.fn> {
  vi.stubEnv("RUNTRAIL_URL", "http://runtrail.test");
  vi.stubEnv("RUNTRAIL_TOKEN", "");
  const fetchMock = vi.fn(async (url: URL) => {
    if (url.pathname === "/runs") {
      return new Response(JSON.stringify({ run: { id: "run_wrap" } }), { status: 201 });
    }

    if (url.pathname === "/events") {
      return new Response(JSON.stringify({ event: { id: "evt_wrap" } }), { status: 201 });
    }

    return new Response(JSON.stringify({ run: { id: "run_wrap" } }), { status: 200 });
  });
  vi.stubGlobal("fetch", fetchMock);
  return fetchMock;
}

function addReceiptChain(events: AgentEvent[]): AgentEvent[] {
  let previousHash: string | undefined;

  return events.map((event) => {
    const eventHash = computeEventHash(event, previousHash);
    const withReceipt = {
      ...event,
      prevEventHash: previousHash,
      eventHash
    };
    previousHash = eventHash;
    return withReceipt;
  });
}
