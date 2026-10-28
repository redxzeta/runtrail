import { type ChildProcessWithoutNullStreams, spawn } from "node:child_process";
import { once } from "node:events";
import { createServer, type ServerResponse } from "node:http";
import type { Socket } from "node:net";
import path from "node:path";
import { PassThrough } from "node:stream";
import { pathToFileURL } from "node:url";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { afterEach, describe, expect, it, vi } from "vitest";
import { createRuntrailMcpBridgeServer } from "../src/mcp/bridge.js";
import { bridgeLifecycle } from "../src/mcp/bridgeLifecycle.js";

const INITIALIZE = {
  jsonrpc: "2.0",
  id: 1,
  method: "initialize",
  params: {
    protocolVersion: "2025-03-26",
    capabilities: {},
    clientInfo: { name: "disposable-test", version: "1" }
  }
};
const owned: ChildProcessWithoutNullStreams[] = [];
afterEach(() => {
  for (const child of owned.splice(0))
    if (child.exitCode === null && child.signalCode === null) child.kill("SIGKILL");
  process.exitCode = 0;
  vi.useRealTimers();
});

async function upstream(mode: "ready" | "sse" | "sse-headers" | "headers" | "partial" = "ready") {
  const sockets = new Set<Socket>();
  const streams = new Set<ServerResponse>();
  let gets = 0;
  let posts = 0;
  const server = createServer(async (req, res) => {
    if (req.method === "GET") {
      gets++;
      streams.add(res);
      res.on("close", () => streams.delete(res));
      res.writeHead(200, { "content-type": "text/event-stream" });
      res.flushHeaders();
      return;
    }
    posts++;
    const chunks = [];
    for await (const chunk of req) chunks.push(chunk);
    const message = JSON.parse(Buffer.concat(chunks).toString());
    if (mode === "headers" || mode === "sse-headers") {
      res.writeHead(200, {
        "content-type": mode === "headers" ? "application/json" : "text/event-stream"
      });
      res.flushHeaders();
      return;
    }
    if (mode === "partial" && message.method === "notifications/initialized") {
      res.writeHead(500);
      res.end("synthetic failure");
      return;
    }
    if (message.method === "initialize") {
      res.writeHead(200, {
        "content-type": mode === "sse" ? "text/event-stream" : "application/json",
        "mcp-session-id": "disposable"
      });
      const result = JSON.stringify({
        jsonrpc: "2.0",
        id: message.id,
        result: {
          protocolVersion: "2025-03-26",
          capabilities: { tools: {} },
          serverInfo: { name: "disposable", version: "1" }
        }
      });
      res.end(mode === "sse" ? `event: message\ndata: ${result}\n\n` : result);
    } else {
      res.writeHead(202);
      res.end();
    }
  });
  server.on("connection", (socket) => {
    sockets.add(socket);
    socket.on("close", () => sockets.delete(socket));
  });
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  const address = server.address();
  if (!address || typeof address === "string") throw new Error("No port");
  return {
    url: `http://127.0.0.1:${address.port}/mcp`,
    sockets,
    streams,
    get gets() {
      return gets;
    },
    get posts() {
      return posts;
    },
    async close() {
      for (const socket of sockets) socket.destroy();
      await new Promise<void>((resolve) => server.close(() => resolve()));
    }
  };
}
function bridge(url: string, stalledClose = false) {
  const bridgeUrl = pathToFileURL(path.resolve("src/mcp/bridge.ts")).href;
  const args = stalledClose
    ? [
        "--import",
        "tsx",
        "--input-type=module",
        "-e",
        `
    import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';
    StreamableHTTPClientTransport.prototype.close = () => new Promise(() => {});
    setInterval(() => {}, 1000);
    process.argv[1] = ${JSON.stringify(path.resolve("src/mcp/bridge.ts"))};
    await import(${JSON.stringify(bridgeUrl)});
  `
      ]
    : ["--import", "tsx", "src/mcp/bridge.ts"];
  const child = spawn(process.execPath, args, {
    env: {
      ...process.env,
      RUNTRAIL_TOKEN: "synthetic-lifecycle-token",
      RUNTRAIL_MCP_URL: url,
      RUNTRAIL_REQUEST_TIMEOUT_MS: "300"
    },
    stdio: "pipe"
  });
  owned.push(child);
  let stdout = "";
  let stderr = "";
  child.stdout.on("data", (chunk) => {
    stdout += chunk;
  });
  child.stderr.on("data", (chunk) => {
    stderr += chunk;
  });
  const exited = once(child, "exit");
  return {
    child,
    exited,
    get stdout() {
      return stdout;
    },
    get stderr() {
      return stderr;
    }
  };
}
async function until(check: () => boolean, timeout = 3000) {
  const deadline = Date.now() + timeout;
  while (!check()) {
    if (Date.now() > deadline) throw new Error("Condition not reached");
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
}
async function promptly(exited: Promise<unknown[]>) {
  let timer: NodeJS.Timeout | undefined;
  try {
    return await Promise.race([
      exited,
      new Promise<never>((_, reject) => {
        timer = setTimeout(() => reject(new Error("Bridge failed to exit within 2s")), 2000);
      })
    ]);
  } finally {
    clearTimeout(timer);
  }
}

describe("actual bridge subprocess ownership", () => {
  it.each(["ready", "sse"] as const)(
    "repeated EOF sessions (%s) exit normally with clean protocol output and disposed sockets",
    async (mode) => {
      const service = await upstream(mode);
      try {
        for (let i = 0; i < 4; i++) {
          const run = bridge(service.url);
          run.child.stdin.write(`${JSON.stringify(INITIALIZE)}\n`);
          await until(() => run.stdout.includes('"id":1') && service.streams.size === 1).catch(
            (e) => {
              throw new Error(
                `${e.message}: stdout=${run.stdout}, stderr=${run.stderr}, posts=${service.posts}, gets=${service.gets}`
              );
            }
          );
          expect(JSON.parse(run.stdout.trim()).result.serverInfo.name).toBe("runtrail-mcp-bridge");
          run.child.stdin.end();
          expect(await promptly(run.exited)).toEqual([0, null]);
          await until(() => service.streams.size === 0 && service.sockets.size === 0);
          expect(run.stderr).toBe("");
        }
        expect(service.gets).toBe(4);
      } finally {
        await service.close();
      }
    },
    20_000
  );

  it.skipIf(process.platform === "win32").each(["SIGINT", "SIGTERM", "SIGHUP"] as const)(
    "disposes live remote connections on %s",
    async (signal) => {
      const service = await upstream();
      try {
        const run = bridge(service.url);
        run.child.stdin.write(`${JSON.stringify(INITIALIZE)}\n`);
        await until(() => service.streams.size === 1 && run.stdout.includes('"id":1'));
        run.child.kill(signal);
        const codes = { SIGINT: 130, SIGTERM: 143, SIGHUP: 129 };
        expect(await promptly(run.exited)).toEqual([codes[signal], null]);
        await until(() => service.sockets.size === 0 && service.streams.size === 0);
        expect(run.stderr).toBe("");
      } finally {
        await service.close();
      }
    }
  );

  it.each(["eof", "close", "SIGINT", "SIGTERM", "SIGHUP"] as const)(
    "handles %s during post-header stalled initialization",
    async (action) => {
      if (process.platform === "win32" && action.startsWith("SIG")) return;
      const service = await upstream("headers");
      try {
        const run = bridge(service.url);
        await until(() => service.posts === 1);
        if (action === "eof") run.child.stdin.end();
        else if (action === "close") run.child.stdin.destroy();
        else run.child.kill(action);
        await promptly(run.exited);
        await until(() => service.sockets.size === 0);
        expect(run.stdout).toBe("");
        expect(run.stderr).toBe("");
      } finally {
        await service.close();
      }
    }
  );

  it.each(["headers", "sse-headers", "partial"] as const)(
    "reports bounded initialization failure (%s) and exits on EOF",
    async (mode) => {
      const service = await upstream(mode);
      try {
        const run = bridge(service.url);
        run.child.stdin.write(`${JSON.stringify(INITIALIZE)}\n`);
        await until(() => run.stdout.includes('"id":1'));
        const result = JSON.parse(run.stdout.trim());
        expect(result.error.message).toContain("Check Runtrail service health");
        expect(result.error.message).not.toContain("synthetic-lifecycle-token");
        run.child.stdin.end();
        expect(await promptly(run.exited)).toEqual([0, null]);
        await until(() => service.sockets.size === 0);
      } finally {
        await service.close();
      }
    }
  );
});

it("preserves the SDK GET reconnect flow then cancels it at session EOF", async () => {
  const service = await upstream();
  try {
    const run = bridge(service.url);
    run.child.stdin.write(`${JSON.stringify(INITIALIZE)}\n`);
    await until(() => service.streams.size === 1 && run.stdout.includes('"id":1'));
    for (const stream of service.streams) stream.end("retry: 20\n\n");
    await until(() => service.gets === 2 && service.streams.size === 1);
    run.child.stdin.end();
    expect(await promptly(run.exited)).toEqual([0, null]);
    await until(() => service.sockets.size === 0);
    expect(service.gets).toBe(2);
  } finally {
    await service.close();
  }
});

it("aborts actual remote sockets before bounded fallback on an injected stalled SDK close", async () => {
  const service = await upstream();
  try {
    const run = bridge(service.url, true);
    run.child.stdin.write(`${JSON.stringify(INITIALIZE)}\n`);
    await until(() => service.streams.size === 1 && run.stdout.includes('"id":1'));
    run.child.stdin.end();
    await until(() => service.sockets.size === 0);
    expect(await promptly(run.exited)).toEqual([1, null]);
    expect(run.stderr).toContain("shutdown exceeded its deadline");
    expect(JSON.parse(run.stdout.trim()).id).toBe(1);
  } finally {
    await service.close();
  }
});

it("reports failed startup despite a stalled upstream closer, then owns EOF cleanup", async () => {
  const service = await upstream("headers");
  try {
    const run = bridge(service.url, true);
    run.child.stdin.write(`${JSON.stringify(INITIALIZE)}\n`);
    // Keep stdin open: failure diagnostics must not depend on EOF or a signal.
    await until(() => run.stdout.includes('"id":1'), 2500);
    const result = JSON.parse(run.stdout.trim());
    expect(result.error.message).toContain("Check Runtrail service health");
    expect(result.error.message).not.toContain("synthetic-lifecycle-token");
    await until(() => service.sockets.size === 0);
    expect(run.child.exitCode).toBeNull();
    expect(run.stderr).toBe("");
    run.child.stdin.end();
    expect(await promptly(run.exited)).toEqual([1, null]);
    expect(run.stderr).toContain("shutdown exceeded its deadline");
  } finally {
    await service.close();
  }
});

describe("bounded cleanup", () => {
  it("aborts immediately and closes all owned resources once across repeated shutdown requests", async () => {
    const input = new PassThrough();
    const lifecycle = bridgeLifecycle(input);
    const close = vi.fn(async () => {});
    lifecycle.own(close);
    const first = lifecycle.shutdown();
    expect(lifecycle.signal.aborted).toBe(true);
    expect(lifecycle.shutdown()).toBe(first);
    await first;
    expect(close).toHaveBeenCalledTimes(1);
    input.destroy();
  });
  it("attempts every closer and uses bounded fallback when remote close stalls", async () => {
    vi.useFakeTimers();
    const input = new PassThrough();
    const fallback = vi.fn();
    const lifecycle = bridgeLifecycle(input, fallback, 100);
    let release!: () => void;
    lifecycle.own(
      () =>
        new Promise<void>((resolve) => {
          release = resolve;
        })
    );
    const close = vi.fn(async () => {});
    lifecycle.own(close);
    void lifecycle.shutdown();
    await vi.advanceTimersByTimeAsync(100);
    expect(close).toHaveBeenCalledTimes(1);
    expect(fallback).toHaveBeenCalledTimes(1);
    release();
    await lifecycle.shutdown();
    input.destroy();
  });
});

it("keeps default/cap search contracts on the public bridge tool boundary", async () => {
  const remote = { callTool: vi.fn(async () => ({ content: [] })) };
  const server = createRuntrailMcpBridgeServer(remote);
  const client = new Client({ name: "limits", version: "1" });
  const [local, peer] = InMemoryTransport.createLinkedPair();
  try {
    await server.connect(peer);
    await client.connect(local);
    for (const name of ["journal_search", "journal_search_runs"]) {
      await client.callTool({ name, arguments: {} });
      expect(remote.callTool).toHaveBeenLastCalledWith({
        name,
        arguments: expect.objectContaining({ limit: 20 })
      });
      await client.callTool({ name, arguments: { limit: 50 } });
      expect(remote.callTool).toHaveBeenLastCalledWith({
        name,
        arguments: expect.objectContaining({ limit: 50 })
      });
      const calls = remote.callTool.mock.calls.length;
      expect(await client.callTool({ name, arguments: { limit: 51 } })).toMatchObject({
        isError: true
      });
      expect(remote.callTool).toHaveBeenCalledTimes(calls);
    }
  } finally {
    await client.close();
    await server.close();
  }
});
