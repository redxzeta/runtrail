import { afterEach, describe, expect, it, vi } from "vitest";
import { createHttpClient } from "../src/mcp/index.js";
import {
  fetchWithTimeout,
  formatClientFailure,
  formatHttpFailure,
  readRequestTimeoutMs
} from "../src/shared/httpClient.js";

const clientConfig = {
  url: "http://runtrail.test",
  security: { authRequired: true, token: "secret-token" }
};

describe("shared httpClient", () => {
  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllEnvs();
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it("uses the default timeout when the env override is unset", () => {
    expect(readRequestTimeoutMs({})).toBe(15_000);
  });

  it("reads the configured timeout override from the environment", () => {
    expect(readRequestTimeoutMs({ RUNTRAIL_REQUEST_TIMEOUT_MS: "2500" })).toBe(2500);
  });

  it("rejects invalid timeout overrides", () => {
    expect(() => readRequestTimeoutMs({ RUNTRAIL_REQUEST_TIMEOUT_MS: "nope" })).toThrow(
      "Invalid RUNTRAIL_REQUEST_TIMEOUT_MS"
    );
    expect(() => readRequestTimeoutMs({ RUNTRAIL_REQUEST_TIMEOUT_MS: "10" })).toThrow(
      "Invalid RUNTRAIL_REQUEST_TIMEOUT_MS"
    );
  });

  it("aborts the underlying fetch after the timeout elapses", async () => {
    vi.useFakeTimers();
    let capturedSignal: AbortSignal | undefined;
    vi.stubGlobal(
      "fetch",
      vi.fn((_: unknown, init: RequestInit) => {
        capturedSignal = init.signal ?? undefined;
        return new Promise<Response>((_resolve, reject) => {
          init.signal?.addEventListener(
            "abort",
            () => {
              reject(Object.assign(new Error("aborted"), { name: "AbortError" }));
            },
            { once: true }
          );
        });
      })
    );

    const pending = fetchWithTimeout("http://runtrail.test/health", {}, 500).catch(
      (error) => error
    );
    await vi.advanceTimersByTimeAsync(500);
    const settled = await pending;
    expect(settled).toBeInstanceOf(Error);
    expect((settled as Error).message).toBe("aborted");
    expect(capturedSignal?.aborted).toBe(true);
  });

  it("clears the abort timer when the fetch resolves before the timeout", async () => {
    vi.useFakeTimers();
    const clearSpy = vi.spyOn(globalThis, "clearTimeout");
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response("{}", { status: 200 }))
    );

    const response = await fetchWithTimeout("http://runtrail.test/health", {}, 5000);
    expect(response.status).toBe(200);
    expect(clearSpy).toHaveBeenCalled();
    expect(vi.getTimerCount()).toBe(0);
  });

  it("returns a timeout diagnostic that names the method and safe path", () => {
    const abortError = Object.assign(new Error("aborted"), { name: "AbortError" });
    const error = formatClientFailure(abortError, 1500, {
      method: "post",
      path: "/events",
      token: "secret-token"
    });
    expect(error.message).toBe("Runtrail POST /events timeout after 1500ms");
  });

  it("labels connection failures with the underlying error code and redacts secrets", () => {
    const err = Object.assign(new Error("connect ECONNREFUSED 127.0.0.1:8787 secret-token"), {
      code: "ECONNREFUSED"
    });
    const message = formatClientFailure(err, 15_000, {
      method: "GET",
      path: "/health",
      token: "secret-token"
    }).message;
    expect(message).toContain("Runtrail GET /health connection error (ECONNREFUSED)");
    expect(message).toContain("[REDACTED]");
    expect(message).not.toContain("secret-token");
  });

  it("classifies validation errors and preserves API issues", () => {
    const message = formatHttpFailure(
      400,
      {
        error: "Invalid input",
        issues: [{ path: ["type"], message: "Invalid enum value" }]
      },
      { method: "POST", path: "/events" }
    ).message;
    expect(message).toBe(
      "Runtrail POST /events HTTP 400 (validation): Invalid input; type: Invalid enum value"
    );
  });

  it("classifies authentication errors distinctly from validation errors", () => {
    const message = formatHttpFailure(
      401,
      { error: "Unauthorized" },
      { method: "GET", path: "/agent/context" }
    ).message;
    expect(message).toBe("Runtrail GET /agent/context HTTP 401 (authentication): Unauthorized");
  });

  it("classifies server errors as server_error", () => {
    const message = formatHttpFailure(503, undefined, {
      method: "GET",
      path: "/health"
    }).message;
    expect(message).toBe("Runtrail GET /health HTTP 503 (server_error)");
  });

  it("surfaces configured timeouts to the MCP HTTP client for connection failures", async () => {
    vi.stubEnv("RUNTRAIL_REQUEST_TIMEOUT_MS", "1234");
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => {
        throw Object.assign(new Error("connect ECONNREFUSED"), { code: "ECONNREFUSED" });
      })
    );
    const client = createHttpClient(clientConfig);
    await expect(client.requestJson("/health")).rejects.toThrow(
      "Runtrail GET /health connection error (ECONNREFUSED): connect ECONNREFUSED"
    );
  });

  it("reports timeout diagnostics through the MCP HTTP client", async () => {
    vi.stubEnv("RUNTRAIL_REQUEST_TIMEOUT_MS", "250");
    vi.stubGlobal(
      "fetch",
      vi.fn(
        (_: unknown, init: RequestInit) =>
          new Promise<Response>((_resolve, reject) => {
            init.signal?.addEventListener(
              "abort",
              () => {
                reject(Object.assign(new Error("aborted"), { name: "AbortError" }));
              },
              { once: true }
            );
          })
      )
    );
    const client = createHttpClient(clientConfig);
    vi.useFakeTimers();
    const pending = client
      .requestJson("/events", { method: "POST", body: { a: 1 } })
      .catch((error) => error);
    await vi.advanceTimersByTimeAsync(250);
    const settled = await pending;
    expect(settled).toBeInstanceOf(Error);
    expect((settled as Error).message).toBe("Runtrail POST /events timeout after 250ms");
  });

  it("returns parsed JSON on successful HTTP responses", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response(JSON.stringify({ ok: true }), { status: 200 }))
    );
    const client = createHttpClient(clientConfig);
    await expect(client.requestJson("/health")).resolves.toEqual({ ok: true });
  });
});
