import { afterEach, describe, expect, it, vi } from "vitest";
import { runCli } from "../src/cli/index.js";

describe("cli", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
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

  it("creates runs, events, loops, and decisions through the API", async () => {
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
      "ship cli"
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
      "Need review"
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

    expect(fetchMock).toHaveBeenNthCalledWith(
      1,
      new URL("/runs", "http://runtrail.test"),
      expect.objectContaining({
        method: "POST",
        body: JSON.stringify({
          source: "codex",
          project: "runtrail",
          task: "ship cli"
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
          data: { files: ["src/cli/index.ts"] }
        })
      })
    );
    expect(fetchMock).toHaveBeenNthCalledWith(
      3,
      new URL("/open-loops", "http://runtrail.test"),
      expect.objectContaining({ method: "POST" })
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
});

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
  return output;
}
