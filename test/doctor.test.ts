import * as fs from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { doctorReport, formatDoctor } from "../src/cli/doctor.js";
import { RUNTRAIL_CAPABILITIES } from "../src/shared/capabilities.js";

vi.mock("node:fs", async (importOriginal) => {
  const actual = await importOriginal<typeof import("node:fs")>();
  return {
    ...actual,
    accessSync: vi.fn(actual.accessSync),
    readFileSync: vi.fn(actual.readFileSync)
  };
});

const secret = "doctor-placeholder-secret";
const serviceUrl = "http://private-doctor.test:8787/private?secret=value";
let directory: string;
let configPath: string;
let database: string;
let logs: string;
let state: string;

beforeEach(() => {
  directory = fs.mkdtempSync(path.join(tmpdir(), "runtrail-doctor-"));
  configPath = path.join(directory, "config.yaml");
  database = path.join(directory, "database.sqlite");
  logs = path.join(directory, "logs");
  state = path.join(directory, "state");
  for (const key of [
    "RUNTRAIL_HOST",
    "RUNTRAIL_PORT",
    "RUNTRAIL_AGENT_STALE_AFTER_SECONDS",
    "RUNTRAIL_REQUEST_TIMEOUT_MS"
  ])
    vi.stubEnv(key, undefined);
  vi.stubEnv("RUNTRAIL_CONFIG", configPath);
  vi.stubEnv("RUNTRAIL_URL", serviceUrl);
  vi.stubEnv("RUNTRAIL_TOKEN", secret);
  vi.stubEnv("DISCORD_WEBHOOK_URL", `https://private-webhook.test/${secret}`);
  vi.stubEnv("RUNTRAIL_DB_PATH", database);
  vi.stubEnv("RUNTRAIL_LOG_DIR", logs);
  vi.stubEnv("RUNTRAIL_STATE_DIR", state);
  fs.writeFileSync(configPath, fs.readFileSync("config/runtrail.example.yaml", "utf8"));
  fs.writeFileSync(database, "deliberately not SQLite; never open or migrate this");
  fs.mkdirSync(logs);
  fs.mkdirSync(state);
  vi.stubGlobal("fetch", vi.fn(healthyFetch));
  vi.clearAllMocks();
});

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
  fs.rmSync(directory, { recursive: true, force: true });
});

describe("read-only doctor", () => {
  it("separately verifies health and authenticated capabilities without opening local storage", async () => {
    const before = snapshot(directory);
    vi.mocked(fs.readFileSync).mockClear();
    const report = await doctorReport();
    expect(report).toMatchObject({
      schemaVersion: "1",
      ok: true,
      checks: {
        config: { status: "ok" },
        health: { status: "ok", code: "healthy" },
        authentication: { status: "ok", code: "authenticated" },
        database: { status: "ok" },
        logs: { status: "ok" },
        state: { status: "ok" },
        outbox: { status: "ok", valid: 0, malformed: 0, quarantine: 0 }
      }
    });
    expect(fs.readFileSync).toHaveBeenCalledTimes(1);
    expect(fs.readFileSync).toHaveBeenCalledWith(configPath, "utf8");
    expect(fs.accessSync).toHaveBeenCalledWith(database, fs.constants.R_OK | fs.constants.W_OK);
    for (const target of [logs, state]) {
      expect(fs.accessSync).toHaveBeenCalledWith(
        target,
        fs.constants.R_OK | fs.constants.W_OK | fs.constants.X_OK
      );
    }
    expect(snapshot(directory)).toEqual(before);
    expect(fetch).toHaveBeenCalledTimes(2);
    for (const [url, init] of vi.mocked(fetch).mock.calls) {
      expect(init).toMatchObject({
        method: "GET",
        redirect: "error",
        signal: expect.any(AbortSignal)
      });
      expect(new URL(String(url)).search).toBe("");
      expect(new Headers(init?.headers).get("authorization")).toBe(
        new URL(String(url)).pathname === "/health" ? null : `Bearer ${secret}`
      );
    }
    expect(formatDoctor(report)).toContain("Authenticated capabilities: ok");
    assertRedacted(report);
  });

  it("reports absent local paths without creating them", async () => {
    fs.rmSync(database);
    fs.rmSync(logs, { recursive: true });
    fs.rmSync(state, { recursive: true });
    const before = snapshot(directory);
    const report = await doctorReport();
    for (const key of ["database", "logs", "state"] as const) {
      expect(report.checks[key]).toMatchObject({ status: "warning", code: "missing" });
    }
    expect(report.checks.outbox).toMatchObject({ valid: 0, malformed: 0, quarantine: 0 });
    expect(snapshot(directory)).toEqual(before);
  });

  it("identifies wrong path types and inaccessible paths without leaking filesystem errors", async () => {
    fs.rmSync(database);
    fs.mkdirSync(database);
    fs.rmSync(logs, { recursive: true });
    fs.writeFileSync(logs, "not a directory");
    vi.mocked(fs.accessSync).mockImplementationOnce(() => {
      throw Object.assign(new Error(`${secret} ${state}`), { code: "EACCES" });
    });
    const report = await doctorReport();
    expect(report.ok).toBe(false);
    expect(report.checks.database.code).toBe("wrong_type");
    expect(report.checks.logs.code).toBe("wrong_type");
    expect(report.checks.state.code).toBe("inaccessible");
    assertRedacted(report);
  });

  it.each([401, 403])(
    "does not treat healthy service as authentication proof (%s)",
    async (status) => {
      vi.stubGlobal(
        "fetch",
        vi.fn(async (url: URL) =>
          url.pathname === "/health"
            ? healthyFetch(url)
            : new Response(`${secret} ${directory} ${serviceUrl}`, { status })
        )
      );
      const report = await doctorReport();
      expect(report.ok).toBe(false);
      expect(report.checks.health.status).toBe("ok");
      expect(report.checks.authentication).toMatchObject({
        status: "error",
        code: "authentication"
      });
      assertRedacted(report);
    }
  );

  it("can authenticate even when the independent health request fails", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: URL) => {
        if (url.pathname === "/health") throw new Error(`${secret} ${serviceUrl} ${directory}`);
        return healthyFetch(url);
      })
    );
    const report = await doctorReport();
    expect(report.checks.health.code).toBe("connectivity");
    expect(report.checks.authentication.code).toBe("authenticated");
    expect(report.ok).toBe(false);
    assertRedacted(report);
  });

  it("leaves authenticated access unverified without a token, even if auth is locally disabled", async () => {
    vi.stubEnv("RUNTRAIL_TOKEN", "");
    fs.writeFileSync(
      configPath,
      fs.readFileSync(configPath, "utf8").replace("authRequired: true", "authRequired: false")
    );
    const report = await doctorReport();
    expect(report.checks.health.status).toBe("ok");
    expect(report.checks.authentication).toMatchObject({ status: "error", code: "authentication" });
    expect(fetch).toHaveBeenCalledTimes(1);
  });

  it.each(["yaml", "schema", "environment", "url", "credentials", "missing"])(
    "contains malformed config diagnostics without echoing values (%s)",
    async (kind) => {
      if (kind === "yaml") fs.writeFileSync(configPath, `server: [${secret}`);
      if (kind === "schema") fs.writeFileSync(configPath, `server: ${secret}`);
      if (kind === "environment") vi.stubEnv("RUNTRAIL_PORT", secret);
      if (kind === "url") vi.stubEnv("RUNTRAIL_URL", `file:///${secret}`);
      if (kind === "credentials") vi.stubEnv("RUNTRAIL_URL", `https://user:${secret}@private.test`);
      if (kind === "missing") fs.rmSync(configPath);
      const before = snapshot(directory);
      const report = await doctorReport();
      expect(report.ok).toBe(false);
      expect(report.checks.config.code).toBe("invalid_config");
      for (const key of ["health", "authentication", "database", "logs"] as const) {
        expect(report.checks[key].status).toBe("skipped");
      }
      expect(report.checks.state.status).toBe("ok");
      expect(report.checks.outbox.valid).toBe(0);
      expect(fetch).not.toHaveBeenCalled();
      expect(snapshot(directory)).toEqual(before);
      assertRedacted(report);
    }
  );

  it("counts valid, malformed, unsafe and quarantined records without changing their bytes or metadata", async () => {
    const pending = path.join(state, "outbox", "pending");
    const quarantine = path.join(state, "outbox", "quarantine");
    fs.mkdirSync(pending, { recursive: true, mode: 0o700 });
    fs.mkdirSync(quarantine, { mode: 0o700 });
    const record = {
      version: 1,
      id: "11111111-1111-4111-8111-111111111111",
      operation: "create_event",
      path: "/events",
      method: "POST",
      payload: { clientRecordId: "private-key", message: "private-event" },
      idempotencyKey: "private-key",
      createdAt: "2026-10-27T00:00:00.000Z",
      retryCount: 3
    };
    fs.writeFileSync(path.join(pending, "valid.json"), JSON.stringify(record), { mode: 0o600 });
    fs.writeFileSync(path.join(pending, "malformed.json"), `{${secret}`);
    fs.writeFileSync(
      path.join(pending, "unsafe.json"),
      JSON.stringify({
        ...record,
        payload: { ...record.payload, token: secret }
      })
    );
    fs.writeFileSync(path.join(pending, "oversized.json"), "x".repeat(65 * 1024));
    fs.writeFileSync(path.join(pending, "ignored.tmp"), secret);
    fs.writeFileSync(path.join(quarantine, "quarantined.json"), secret);
    fs.writeFileSync(path.join(quarantine, "quarantined.json.reason"), secret);
    const before = snapshot(directory);
    const report = await doctorReport();
    expect(report.checks.outbox).toMatchObject({
      status: "warning",
      valid: 1,
      malformed: 3,
      quarantine: 1
    });
    expect(formatDoctor(report)).toContain("valid=1, malformed=3, quarantine=1");
    expect(snapshot(directory)).toEqual(before);
    assertRedacted(report);
    expect(JSON.stringify(report)).not.toMatch(
      /private-key|private-event|unsafe.json|quarantined.json/
    );
  });

  it("does not try reading symlinked pending records", async () => {
    const pending = path.join(state, "outbox", "pending");
    fs.mkdirSync(pending, { recursive: true });
    fs.symlinkSync(database, path.join(pending, "link.json"));
    const report = await doctorReport();
    expect(report.checks.outbox).toMatchObject({
      status: "error",
      code: "unreadable",
      valid: null,
      malformed: null,
      quarantine: null
    });
    expect(fs.readFileSync).not.toHaveBeenCalledWith(database, expect.anything());
    assertRedacted(report);
  });

  it("reports unknown counts when the outbox layout cannot be read", async () => {
    fs.writeFileSync(path.join(state, "outbox"), secret);
    const report = await doctorReport();
    expect(report.checks.outbox).toMatchObject({
      status: "error",
      valid: null,
      malformed: null,
      quarantine: null
    });
    expect(formatDoctor(report)).toContain("valid=unknown");
    assertRedacted(report);
  });

  it.each(["headers", "body"])("bounds HTTP %s with a 1500ms abort signal", async (stage) => {
    vi.useFakeTimers();
    // Native AbortSignal.timeout uses internal timers; substitute only its clock here.
    const signals: AbortSignal[] = [];
    const timeoutSpy = vi.spyOn(AbortSignal, "timeout").mockImplementation((milliseconds) => {
      const controller = new AbortController();
      signals.push(controller.signal);
      setTimeout(
        () => controller.abort(new DOMException("timed out", "TimeoutError")),
        milliseconds
      );
      return controller.signal;
    });
    vi.stubEnv("RUNTRAIL_REQUEST_TIMEOUT_MS", "60000");
    const cancel = vi.fn();
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => {
        if (stage === "headers") return new Promise<Response>(() => {});
        return new Response(
          new ReadableStream({
            start(controller) {
              controller.enqueue(new TextEncoder().encode('{"ok":'));
            },
            cancel
          })
        );
      })
    );
    const pending = doctorReport();
    await vi.advanceTimersByTimeAsync(1499);
    expect(signals.every((signal) => !signal.aborted)).toBe(true);
    await vi.advanceTimersByTimeAsync(1);
    const report = await pending;
    expect(timeoutSpy).toHaveBeenCalledTimes(2);
    expect(timeoutSpy).toHaveBeenCalledWith(1500);
    expect(report.checks.health.code).toBe("timeout");
    expect(report.checks.authentication.code).toBe("timeout");
    if (stage === "body") expect(cancel).toHaveBeenCalledTimes(2);
    assertRedacted(report);
  });

  it.each([
    "invalid_json",
    "wrong_service",
    "oversized",
    "server_error",
    "redirect",
    "gateway_timeout"
  ])("returns generic secret-free HTTP diagnostics (%s)", async (kind) => {
    const status =
      kind === "server_error"
        ? 500
        : kind === "redirect"
          ? 302
          : kind === "gateway_timeout"
            ? 504
            : 200;
    const contents =
      kind === "oversized"
        ? secret.repeat(30_000)
        : kind === "wrong_service"
          ? JSON.stringify({ ok: true, service: secret })
          : secret;
    const responses: Response[] = [];
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => {
        const response = new Response(contents, { status });
        vi.spyOn(response.body as ReadableStream, "getReader");
        responses.push(response);
        return response;
      })
    );
    const report = await doctorReport();
    expect(report.ok).toBe(false);
    const expected =
      kind === "gateway_timeout"
        ? "timeout"
        : status !== 200
          ? "service_error"
          : "invalid_response";
    expect(report.checks.health.code).toBe(expected);
    expect(report.checks.authentication.code).toBe(expected);
    if (status !== 200) {
      for (const response of responses) expect(response.body?.getReader).not.toHaveBeenCalled();
    }
    assertRedacted(report);
  });
});

async function healthyFetch(url: URL | RequestInfo): Promise<Response> {
  return Response.json(
    new URL(String(url)).pathname === "/health"
      ? { ok: true, service: "runtrail", privateExtra: secret }
      : { ...RUNTRAIL_CAPABILITIES, privateExtra: secret }
  );
}

function assertRedacted(report: Awaited<ReturnType<typeof doctorReport>>): void {
  for (const output of [JSON.stringify(report), formatDoctor(report)]) {
    for (const value of [
      secret,
      directory,
      serviceUrl,
      "private-doctor.test",
      "private-webhook.test"
    ]) {
      expect(output).not.toContain(value);
    }
  }
}

function snapshot(root: string): unknown[] {
  return fs
    .readdirSync(root)
    .sort()
    .map((name) => {
      const target = path.join(root, name);
      const stat = fs.lstatSync(target);
      return {
        name,
        mode: stat.mode,
        mtime: stat.mtimeMs,
        ctime: stat.ctimeMs,
        contents: stat.isDirectory() ? snapshot(target) : fs.readFileSync(target).toString("base64")
      };
    });
}
