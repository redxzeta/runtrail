import type { Readable } from "node:stream";

const SHUTDOWN_TIMEOUT_MS = 1_000;
// Match the SDK stdio default frame budget while initialization is pending.
const STARTUP_INPUT_BYTES = 10 * 1024 * 1024;

/** Own only this bridge's handles. Install before the first asynchronous connect. */
export function bridgeLifecycle(
  stdin: Readable = process.stdin,
  fallback: () => void = () => {
    console.error("Runtrail bridge shutdown exceeded its deadline");
    process.exit(1);
  },
  timeoutMs = SHUTDOWN_TIMEOUT_MS
) {
  const controller = new AbortController();
  const closers: Array<() => Promise<void>> = [];
  let stopping: Promise<void> | undefined;
  let stopped = false;
  const buffered: Buffer[] = [];
  let bufferedBytes = 0;
  const bufferInput = (chunk: Buffer) => {
    bufferedBytes += chunk.length;
    if (bufferedBytes > STARTUP_INPUT_BYTES) {
      void shutdown(1);
    } else {
      buffered.push(chunk);
    }
  };
  const onEnd = () => void shutdown();
  const onError = () => void shutdown(1);
  const signals = { SIGINT: 130, SIGTERM: 143, SIGHUP: 129 } as const;
  const handlers = Object.entries(signals).map(([signal, code]) => {
    const handler = () => void shutdown(code);
    process.on(signal, handler);
    return { signal, handler };
  });
  stdin.on("end", onEnd);
  stdin.on("close", onEnd);
  stdin.on("error", onError);
  // Read now to observe EOF during upstream initialization. Replay bounded input
  // into the SDK transport once ready; never drop an early initialize request.
  stdin.on("data", bufferInput);

  function shutdown(code = 0): Promise<void> {
    if (stopping) return stopping;
    let done!: () => void;
    stopping = new Promise<void>((resolve) => {
      done = resolve;
    });
    stopped = true;
    process.exitCode = code;
    controller.abort();
    stdin.off("data", bufferInput);
    buffered.length = 0;
    stdin.pause();
    const timer = setTimeout(fallback, timeoutMs);
    timer.unref();
    void Promise.allSettled(closers.map((close) => Promise.resolve().then(close))).then(
      (results) => {
        clearTimeout(timer);
        if (results.some((result) => result.status === "rejected")) process.exitCode = 1;
        stdin.off("end", onEnd);
        stdin.off("close", onEnd);
        stdin.off("error", onError);
        for (const { signal, handler } of handlers) process.off(signal, handler);
        done();
      }
    );
    return stopping;
  }

  return {
    signal: controller.signal,
    get stopped() {
      return stopped;
    },
    own(close: () => Promise<void>) {
      closers.push(close);
    },
    shutdown,
    releaseInput() {
      stdin.pause();
      stdin.off("data", bufferInput);
      for (let i = buffered.length - 1; i >= 0; i--) stdin.unshift(buffered[i]);
      buffered.length = 0;
    }
  };
}
