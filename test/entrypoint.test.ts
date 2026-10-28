import { execFileSync, spawn } from "node:child_process";
import { once } from "node:events";
import { cpSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { createServer } from "node:net";
import { tmpdir } from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { isMainModule } from "../src/shared/entrypoint.js";

it("handles absent argv, relative POSIX paths, escaping and different modules", () => {
  expect(isMainModule(import.meta.url, "")).toBe(false);
  expect(isMainModule(import.meta.url, undefined)).toBe(false);
  const filename = path.resolve("dir with spaces/é#100%?.js");
  expect(isMainModule(pathToFileURL(filename).href, filename)).toBe(true);
  expect(isMainModule(pathToFileURL(filename).href, "dir with spaces/é#100%?.js")).toBe(true);
  expect(isMainModule(pathToFileURL(filename).href, `${filename}.other`)).toBe(false);
});
it("uses Node Windows drive and UNC semantics (simulation, not native Windows execution)", () => {
  expect(
    isMainModule("file:///C:/a%20b/%C3%A9%23%25.js", "C:\\a b\\é#%.js", { windows: true })
  ).toBe(true);
  expect(
    isMainModule("file://server/share/a%20b%23.js", "\\\\server\\share\\a b#.js", { windows: true })
  ).toBe(true);
});

const entrypoints = ["index.js", "cli/index.js", "mcp/index.js", "smoke.js", "conformance.js"];
let root = "";
let built = "";
beforeAll(() => {
  execFileSync("pnpm", ["build"], { stdio: "pipe" });
  root = mkdtempSync(path.join(tmpdir(), "runtrail-entry #é%-"));
  built = path.join(root, "dist");
  cpSync("dist", built, { recursive: true });
  // Preserve package resolution without installing or acquiring anything.
  symlinkSync(path.resolve("node_modules"), path.join(root, "node_modules"), "junction");
  writeFileSync(
    path.join(root, "package.json"),
    JSON.stringify({ type: "module", version: "test" })
  );
}, 20_000);
afterAll(() => {
  if (root) rmSync(root, { recursive: true, force: true });
});

describe("built entrypoints under URL-escaped paths", () => {
  it.each(entrypoints)(
    "imports %s with no startup, output or signal-handler side effects",
    (entry) => {
      const script = `const before = ['SIGINT','SIGTERM','SIGHUP'].map(s=>process.listenerCount(s)); await import(${JSON.stringify(pathToFileURL(path.join(built, entry)).href)}); if(JSON.stringify(before)!==JSON.stringify(['SIGINT','SIGTERM','SIGHUP'].map(s=>process.listenerCount(s)))) throw Error('signal side effect');`;
      expect(
        execFileSync(process.execPath, ["--input-type=module", "-e", script], {
          env: { ...process.env, RUNTRAIL_CONFIG: path.join(root, "absent.yaml") },
          timeout: 5000,
          encoding: "utf8"
        })
      ).toBe("");
    }
  );
  it("runs the built CLI help with its existing exitOverride diagnostic", () => {
    try {
      execFileSync(process.execPath, [path.join(built, "cli/index.js"), "--help"], {
        encoding: "utf8",
        timeout: 5000,
        stdio: "pipe"
      });
      throw new Error("Expected existing CLI help exitOverride");
    } catch (error) {
      expect((error as { stdout: string }).stdout).toContain("Usage:");
      expect((error as { stderr: string }).stderr).toContain("outputHelp");
    }
  });
  it("runs built MCP stdio with a real initialize message", async () => {
    const child = spawn(process.execPath, [path.join(built, "mcp/index.js")], {
      env: { ...process.env, RUNTRAIL_URL: "http://127.0.0.1:1", RUNTRAIL_TOKEN: "disposable" },
      stdio: "pipe"
    });
    let stdout = "";
    let stderr = "";
    child.stdout.on("data", (data) => {
      stdout += data;
    });
    child.stderr.on("data", (data) => {
      stderr += data;
    });
    const exit = once(child, "exit");
    try {
      child.stdin.end(
        `${JSON.stringify({ jsonrpc: "2.0", id: 1, method: "initialize", params: { protocolVersion: "2025-03-26", capabilities: {}, clientInfo: { name: "entrypoint", version: "1" } } })}\n`
      );
      const deadline = Date.now() + 3000;
      while (!stdout.includes('"id":1')) {
        if (Date.now() > deadline) throw new Error(`No initialize response: ${stderr}`);
        await new Promise((resolve) => setTimeout(resolve, 10));
      }
      expect(JSON.parse(stdout.trim()).result.serverInfo.name).toBe("runtrail");
    } finally {
      child.kill("SIGTERM");
      await exit;
    }
  });

  it("runs the built server and serves health using disposable storage", async () => {
    const allocator = createServer();
    allocator.listen(0, "127.0.0.1");
    await once(allocator, "listening");
    const address = allocator.address();
    if (!address || typeof address === "string") throw new Error("No port");
    await new Promise<void>((resolve) => allocator.close(() => resolve()));
    const child = spawn(process.execPath, [path.join(built, "index.js")], {
      env: {
        ...process.env,
        RUNTRAIL_HOST: "127.0.0.1",
        RUNTRAIL_PORT: String(address.port),
        RUNTRAIL_DB_PATH: path.join(root, "server.sqlite"),
        RUNTRAIL_LOG_DIR: path.join(root, "logs"),
        RUNTRAIL_TOKEN: "disposable",
        DISCORD_WEBHOOK_URL: ""
      },
      stdio: "pipe"
    });
    let stdout = "";
    let stderr = "";
    child.stdout.on("data", (data) => {
      stdout += data;
    });
    child.stderr.on("data", (data) => {
      stderr += data;
    });
    const exit = once(child, "exit");
    try {
      const deadline = Date.now() + 3000;
      while (!stdout.includes("Runtrail listening")) {
        if (Date.now() > deadline) throw new Error(`Server startup failed: ${stderr}`);
        await new Promise((resolve) => setTimeout(resolve, 10));
      }
      const response = await fetch(`http://127.0.0.1:${address.port}/health`);
      expect(response.status).toBe(200);
      await response.body?.cancel();
    } finally {
      child.kill("SIGTERM");
      await exit;
    }
  });
  it.each(["smoke.js", "conformance.js"])(
    "runs built %s in its isolated scratch environment",
    (entry) => {
      const args =
        entry === "conformance.js" ? ["--output", path.join(root, "conformance.json")] : [];
      const output = execFileSync(process.execPath, [path.join(built, entry), ...args], {
        env: { ...process.env },
        encoding: "utf8",
        timeout: 20_000
      });
      expect(output.length).toBeGreaterThan(0);
    },
    25_000
  );
});
