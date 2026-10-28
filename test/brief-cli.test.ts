import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import Database from "better-sqlite3";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { runCli } from "../src/cli/index.js";
import { loadConfig } from "../src/config.js";
import { migrate } from "../src/db/migrate.js";
import { createApp } from "../src/index.js";

describe("daily CLI reads against authenticated ledger", () => {
  let db: Database.Database;
  let directory: string;
  let runId: string;
  let output: string[];
  let reads: string[];
  beforeEach(async () => {
    directory = mkdtempSync(path.join(tmpdir(), "runtrail-brief-cli-"));
    vi.stubEnv("RUNTRAIL_URL", "http://runtrail.test");
    vi.stubEnv("RUNTRAIL_TOKEN", "test-only-placeholder");
    db = new Database(":memory:");
    migrate(db);
    const app = createApp({ config: loadConfig(), db });
    reads = [];
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: URL, init?: RequestInit) => {
        reads.push(url.pathname);
        return await app.request(url, init);
      })
    );
    const post = async (endpoint: string, body: Record<string, unknown>) => {
      const response = await app.request(`http://runtrail.test${endpoint}`, {
        method: "POST",
        headers: {
          authorization: "Bearer test-only-placeholder",
          "content-type": "application/json"
        },
        body: JSON.stringify(body)
      });
      expect(response.ok).toBe(true);
      return (await response.json()) as { run: { id: string } };
    };
    const created = await post("/runs", {
      source: "developer",
      project: "daily",
      task: "Check capture behavior",
      workKey: "github:redxzeta/runtrail#207",
      workflowId: "daily-workflow",
      gitCommit: "0123456789abcdef",
      cwd: "/private/machine/checkout"
    });
    runId = created.run.id;
    await post("/events", {
      runId,
      type: "progress",
      importance: 5,
      message: "Added outage regression"
    });
    await post("/verifications", {
      runId,
      checkId: "native-client",
      kind: "custom",
      outcome: "not_run",
      name: "Native client",
      support: { type: "unavailable", reason: "not_supported" },
      completedAt: new Date().toISOString()
    });
    output = [];
    vi.spyOn(console, "log").mockImplementation((message: string) => output.push(message));
  });
  afterEach(() => {
    db.close();
    rmSync(directory, { recursive: true, force: true });
    vi.unstubAllEnvs();
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it("reads a versioned brief with actual task and event text using existing endpoints", async () => {
    await runCli(["node", "rt", "brief", "--project", "daily", "--run-id", runId, "--json"]);
    const report = JSON.parse(output[0] ?? "{}");
    expect(report).toMatchObject({
      schemaVersion: "1",
      evidenceApplicability: "unknown",
      selectedRun: { id: runId, task: "Check capture behavior" }
    });
    expect(report.recentEvents[0]).toMatchObject({ message: "Added outage regression" });
    expect(reads.sort()).toEqual(["/agent/context", "/agent/prepare-work"]);
    expect(output[0]).not.toContain("/private/machine");
  });

  it("shows relevant work without requiring a run ID", async () => {
    await runCli([
      "node",
      "rt",
      "brief",
      "--project",
      "daily",
      "--work-key",
      "github:redxzeta/runtrail#207"
    ]);
    expect(output[0]).toContain("Check capture behavior");
    expect(output[0]).toContain("unknown");
  });

  it("renders the existing packet with revision refs and not-run evidence, preserving output files", async () => {
    const file = path.join(directory, "review.md");
    const args = [
      "node",
      "rt",
      "workflow",
      "packet",
      "--project",
      "daily",
      "--workflow-id",
      "daily-workflow",
      "--format",
      "markdown",
      "--output",
      file
    ];
    await runCli(args);
    const markdown = readFileSync(file, "utf8");
    expect(markdown).toContain("0123456789abcdef");
    expect(markdown).toContain("unknown");
    expect(markdown.toLowerCase().replaceAll("\\", "")).toContain("not_run");
    expect(markdown).not.toContain("/private/machine");
    expect(reads).toEqual(["/workflows/daily-workflow/review-packet"]);
    await expect(runCli(args)).rejects.toThrow("Refusing to overwrite");
    expect(readFileSync(file, "utf8")).toBe(markdown);
  });
});
