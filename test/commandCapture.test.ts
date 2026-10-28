import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { createServer } from "node:http";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { captureCommand } from "../src/cli/commandCapture.js";
import { runCli } from "../src/cli/index.js";
import { enqueueOutbox, readPendingOutbox } from "../src/cli/outbox.js";

describe("fail-open command capture", () => {
  const directories: string[] = [];
  const temporary = () => {
    const directory = mkdtempSync(path.join(tmpdir(), "runtrail-capture-"));
    directories.push(directory);
    return directory;
  };
  afterEach(() => {
    process.exitCode = undefined;
    vi.restoreAllMocks();
    vi.unstubAllEnvs();
    for (const directory of directories.splice(0))
      rmSync(directory, { recursive: true, force: true });
  });

  it("preserves self-signalled child status and executable-not-found semantics", async () => {
    const result = await captureCommand([
      process.execPath,
      "-e",
      "process.kill(process.pid, 'SIGTERM')"
    ]);
    expect(result).toMatchObject({ exitCode: 143, signal: "SIGTERM" });
    expect(await captureCommand([path.join(temporary(), "absent")])).toMatchObject({
      exitCode: 127
    });
  });

  it("forwards parent termination to the child and removes signal handlers", async () => {
    const baseline = process.listenerCount("SIGTERM");
    const running = captureCommand([process.execPath, "-e", "setInterval(() => {}, 1000)"]);
    process.emit("SIGTERM");
    expect(await running).toMatchObject({ exitCode: 143, signal: "SIGTERM" });
    expect(process.listenerCount("SIGTERM")).toBe(baseline);
  });

  it("continues when log storage errors and awaits successful log flush", async () => {
    const directory = temporary();
    expect(
      await captureCommand([process.execPath, "-e", "process.exit(7)"], directory)
    ).toMatchObject({
      exitCode: 7,
      logStored: false
    });
    const file = path.join(directory, "capture.log");
    await captureCommand([process.execPath, "-e", "process.stdout.write('captured')"], file);
    expect(readFileSync(file, "utf8")).toBe("captured");
  });

  it.each([false, true])(
    "bounds stalled HTTP headers/body (%s) and never drains queued writes",
    async (headersSent) => {
      const directory = temporary();
      vi.stubEnv("RUNTRAIL_STATE_DIR", directory);
      vi.stubEnv("RUNTRAIL_LOG_DIR", path.join(directory, "logs"));
      vi.stubEnv("RUNTRAIL_TOKEN", "");
      vi.stubEnv("RUNTRAIL_REQUEST_TIMEOUT_MS", "100");
      enqueueOutbox({
        operation: "create_run",
        path: "/runs",
        method: "POST",
        idempotencyKey: "unrelated",
        payload: {
          source: "developer",
          project: "unrelated",
          task: "pending",
          clientRunId: "unrelated"
        }
      });
      const requests: string[] = [];
      const server = createServer((request, response) => {
        requests.push(request.url ?? "");
        if (headersSent) {
          response.writeHead(201, { "content-type": "application/json" });
          response.write('{"run":');
        }
      });
      await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
      const address = server.address();
      if (!address || typeof address === "string") throw new Error("No test address");
      vi.stubEnv("RUNTRAIL_URL", `http://127.0.0.1:${address.port}`);
      vi.spyOn(console, "error").mockImplementation(() => undefined);
      vi.spyOn(console, "log").mockImplementation(() => undefined);
      const marker = path.join(directory, "once");
      const started = Date.now();
      try {
        await runCli([
          "node",
          "rt",
          "run",
          "--source",
          "developer",
          "--project",
          "runtrail",
          "--task",
          "timeout",
          "--",
          process.execPath,
          "-e",
          `require('node:fs').appendFileSync(${JSON.stringify(marker)}, 'once'); process.exit(9)`
        ]);
        expect(readFileSync(marker, "utf8")).toBe("once");
        expect(process.exitCode).toBe(9);
        expect(Date.now() - started).toBeLessThan(3000);
        expect(requests).toEqual(["/runs"]);
        expect(
          readPendingOutbox().valid.some(
            ({ record }) => record.idempotencyKey === "unrelated" && record.retryCount === 0
          )
        ).toBe(true);
      } finally {
        server.closeAllConnections();
        await new Promise<void>((resolve) => server.close(() => resolve()));
      }
    }
  );

  it("rejects invalid wrapper options before executing", async () => {
    const marker = path.join(temporary(), "must-not-exist");
    writeFileSync(marker, "unchanged");
    await expect(
      runCli([
        "node",
        "rt",
        "run",
        "--source",
        "developer",
        "--project",
        "runtrail",
        "--task",
        " ",
        "--",
        process.execPath,
        "-e",
        `require('node:fs').writeFileSync(${JSON.stringify(marker)}, 'executed')`
      ])
    ).rejects.toThrow();
    expect(readFileSync(marker, "utf8")).toBe("unchanged");
  });
});
