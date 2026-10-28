import { afterEach, describe, expect, it, vi } from "vitest";
import { boundedBridgeFetch } from "../src/mcp/bridgeFetch.js";

const encoder = new TextEncoder();
function response(chunks: string[], type = "application/json") {
  let reads = 0;
  let cancelled = false;
  const body = new ReadableStream<Uint8Array>(
    {
      pull(output) {
        reads++;
        const chunk = chunks.shift();
        if (chunk === undefined) output.close();
        else output.enqueue(encoder.encode(chunk));
      },
      cancel() {
        cancelled = true;
      }
    },
    { highWaterMark: 0 }
  );
  vi.stubGlobal(
    "fetch",
    vi.fn(async () => new Response(body, { headers: { "content-type": type } }))
  );
  return {
    get reads() {
      return reads;
    },
    get cancelled() {
      return cancelled;
    }
  };
}
const signal = () => new AbortController().signal;
afterEach(() => {
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

describe("bridge response consumption", () => {
  it("bounds decoded chunked JSON before parsing, cancels upstream and stops reading", async () => {
    const source = response(['{"x":"', "éééé", "unconsumed".repeat(100)]);
    const result = await boundedBridgeFetch("http://localhost/mcp", {}, signal(), 1000, {
      maxBytes: 12
    });
    await expect(result.json()).rejects.toThrow("exceeds 12 bytes");
    expect(source.cancelled).toBe(true);
    expect(source.reads).toBe(2);
  });

  it.each(["\n", "\r", "\r\n"])(
    "bounds SSE per event with split %j line endings",
    async (newline) => {
      const data = `data: é${newline}${newline}`;
      const source = response(Array.from(data.repeat(20)), "text/event-stream");
      const result = await boundedBridgeFetch(
        "http://localhost/mcp",
        { method: "GET" },
        signal(),
        1000,
        { maxBytes: 15 }
      );
      expect(await result.text()).toBe(data.repeat(20));
      expect(source.cancelled).toBe(false);
    }
  );

  it("rejects a multiline SSE event across chunks without reading the remaining stream", async () => {
    const source = response(
      ["data: 123\r", "\ndata: 456\r\n", "data: never-read"],
      "text/event-stream"
    );
    const result = await boundedBridgeFetch("http://localhost/mcp", {}, signal(), 1000, {
      maxBytes: 16
    });
    await expect(result.text()).rejects.toThrow("exceeds 16 bytes");
    expect(source.reads).toBe(2);
    expect(source.cancelled).toBe(true);
  });

  it("preserves request headers, method, body and SDK redirect policy", async () => {
    response(["{}"]);
    const sdk = new AbortController();
    const init: RequestInit = {
      method: "POST",
      body: "{}",
      headers: { "mcp-protocol-version": "2025-03-26" },
      redirect: "manual",
      signal: sdk.signal
    };
    const result = await boundedBridgeFetch("http://localhost/mcp", init, signal(), 1000);
    expect(vi.mocked(fetch).mock.calls[0][1]).toMatchObject({
      method: "POST",
      body: "{}",
      headers: init.headers,
      redirect: "manual"
    });
    expect(await result.json()).toEqual({});
  });

  it("times out a stalled body after headers and cancels it", async () => {
    vi.useFakeTimers();
    const source = response([]);
    const body = new ReadableStream<Uint8Array>({
      cancel() {
        cancelled = true;
      }
    });
    let cancelled = false;
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response(body))
    );
    const result = await boundedBridgeFetch("http://localhost/mcp", {}, signal(), 100);
    const read = expect(result.text()).rejects.toThrow("timed out after 100ms");
    await vi.advanceTimersByTimeAsync(100);
    await read;
    expect(cancelled).toBe(true);
    expect(source.reads).toBe(0);
  });

  it.each(["GET", "POST"])(
    "keeps established %s SSE alive across deadlines with SDK/lifetime cancellation",
    async (method) => {
      vi.useFakeTimers();
      const owner = new AbortController();
      let cancelled = false;
      vi.stubGlobal(
        "fetch",
        vi.fn(
          async () =>
            new Response(
              new ReadableStream({
                cancel() {
                  cancelled = true;
                }
              }),
              { headers: { "content-type": "Text/Event-Stream; charset=utf-8" } }
            )
        )
      );
      const result = await boundedBridgeFetch(
        "http://localhost/mcp",
        { method },
        owner.signal,
        100
      );
      const read = expect(result.text()).rejects.toThrow();
      await vi.advanceTimersByTimeAsync(500);
      expect(cancelled).toBe(false);
      owner.abort();
      await read;
      expect(cancelled).toBe(true);
    }
  );
});
