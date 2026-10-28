import { RequestTimeoutError } from "../shared/httpClient.js";

// Decoded bytes: cap before the SDK's JSON/SSE parser allocates a full payload.
// SSE is bounded per event, allowing a persistent stream of bounded messages.
export const BRIDGE_RESPONSE_BYTES = 8 * 1024 * 1024;

export async function boundedBridgeFetch(
  url: string | URL,
  init: RequestInit,
  lifetime: AbortSignal,
  timeoutMs: number,
  {
    maxBytes = BRIDGE_RESPONSE_BYTES,
    startup = false
  }: { maxBytes?: number; startup?: boolean } = {}
): Promise<Response> {
  const controller = new AbortController();
  const signal = AbortSignal.any([
    lifetime,
    controller.signal,
    ...(init.signal ? [init.signal] : [])
  ]);
  const timer = setTimeout(
    () => controller.abort(new RequestTimeoutError(`request timed out after ${timeoutMs}ms`)),
    timeoutMs
  );
  timer.unref();
  let reader: ReadableStreamDefaultReader<Uint8Array> | undefined;
  let finished = false;
  const dispose = () => {
    finished = true;
    clearTimeout(timer);
    signal.removeEventListener("abort", onAbort);
  };
  const onAbort = () => {
    dispose();
    void reader?.cancel(signal.reason).catch(() => {});
  };
  try {
    const response = await fetch(url, { ...init, signal });
    if (!response.body) {
      dispose();
      return response;
    }
    const sse =
      response.headers.get("content-type")?.split(";")[0].trim().toLowerCase() ===
      "text/event-stream";
    // Preserve SDK streaming/reconnect/request deadlines once initialized. The
    // startup POST still has a deadline through its initialize response body.
    if (sse && (!startup || (init.method ?? "GET").toUpperCase() === "GET")) clearTimeout(timer);
    reader = response.body.getReader();
    signal.addEventListener("abort", onAbort, { once: true });
    let bytes = 0;
    let lineBytes = 0;
    let afterCR = false;
    const stream = new ReadableStream<Uint8Array>({
      async pull(output) {
        try {
          signal.throwIfAborted();
          const chunk = await reader?.read();
          signal.throwIfAborted();
          if (!chunk || chunk.done) {
            dispose();
            output.close();
            return;
          }
          if (sse) {
            // CR, LF and CRLF are legal SSE line endings, even across chunks.
            for (const byte of chunk.value) {
              if (++bytes > maxBytes)
                throw new Error(`Runtrail bridge response exceeds ${maxBytes} bytes`);
              if (afterCR && byte === 10) {
                afterCR = false;
                continue;
              }
              afterCR = false;
              if (byte === 13 || byte === 10) {
                if (lineBytes === 0) bytes = 0;
                lineBytes = 0;
                afterCR = byte === 13;
              } else lineBytes++;
            }
          } else {
            bytes += chunk.value.byteLength;
            if (bytes > maxBytes)
              throw new Error(`Runtrail bridge response exceeds ${maxBytes} bytes`);
          }
          output.enqueue(chunk.value);
        } catch (error) {
          dispose();
          controller.abort(error);
          void reader?.cancel(error).catch(() => {});
          output.error(error);
        }
      },
      cancel(reason) {
        dispose();
        return reader?.cancel(reason);
      }
    });
    return new Response(stream, {
      status: response.status,
      statusText: response.statusText,
      headers: response.headers
    });
  } catch (error) {
    dispose();
    throw controller.signal.aborted ? controller.signal.reason : error;
  } finally {
    if (finished) clearTimeout(timer);
  }
}
