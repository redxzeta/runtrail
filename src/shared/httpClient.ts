const DEFAULT_REQUEST_TIMEOUT_MS = 15_000;
const MIN_REQUEST_TIMEOUT_MS = 100;

export type RequestDiagnosticContext = {
  method: string;
  path: string;
  token?: string;
};

export function readRequestTimeoutMs(
  env: NodeJS.ProcessEnv = process.env,
  fallback = DEFAULT_REQUEST_TIMEOUT_MS
): number {
  const raw = env.RUNTRAIL_REQUEST_TIMEOUT_MS;

  if (raw === undefined || raw.trim() === "") {
    return fallback;
  }

  const parsed = Number(raw);

  if (!Number.isFinite(parsed) || parsed < MIN_REQUEST_TIMEOUT_MS) {
    throw new Error(
      `Invalid RUNTRAIL_REQUEST_TIMEOUT_MS: ${raw} (must be a number >= ${MIN_REQUEST_TIMEOUT_MS})`
    );
  }

  return Math.floor(parsed);
}

export class RequestTimeoutError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "RequestTimeoutError";
  }
}

export class RequestAbortedError extends Error {
  constructor(message = "request aborted by caller") {
    super(message);
    this.name = "RequestAbortedError";
  }
}

export async function fetchWithTimeout(
  url: string | URL,
  init: RequestInit,
  timeoutMs: number
): Promise<Response> {
  const externalSignal = init.signal ?? undefined;

  if (externalSignal?.aborted) {
    throw new RequestAbortedError();
  }

  const controller = new AbortController();
  let timedOut = false;
  const timer = setTimeout(() => {
    timedOut = true;
    controller.abort();
  }, timeoutMs);
  timer.unref?.();

  const onExternalAbort = () => controller.abort();
  externalSignal?.addEventListener("abort", onExternalAbort);

  try {
    return await fetch(url, {
      ...init,
      signal: controller.signal
    });
  } catch (error) {
    if (timedOut) {
      throw new RequestTimeoutError(`request timed out after ${timeoutMs}ms`);
    }

    if (externalSignal?.aborted) {
      throw new RequestAbortedError();
    }

    throw error;
  } finally {
    clearTimeout(timer);
    externalSignal?.removeEventListener("abort", onExternalAbort);
  }
}

export function safePath(url: string | URL): string {
  if (url instanceof URL) {
    return url.pathname;
  }

  try {
    return new URL(url).pathname;
  } catch {
    const raw = String(url);
    const questionMark = raw.indexOf("?");
    return questionMark >= 0 ? raw.slice(0, questionMark) : raw;
  }
}

export function formatClientFailure(
  error: unknown,
  timeoutMs: number,
  context: RequestDiagnosticContext
): Error {
  const method = context.method.toUpperCase();
  const path = safePath(context.path);
  const label = `Runtrail ${method} ${path}`;

  if (error instanceof RequestTimeoutError) {
    return new Error(redactSecrets(`${label} timeout after ${timeoutMs}ms`, context.token));
  }

  if (error instanceof RequestAbortedError) {
    return new Error(redactSecrets(`${label} aborted by caller`, context.token));
  }

  const code = extractErrorCode(error);
  const detail = extractErrorMessage(error) ?? "network error";

  if (code) {
    return new Error(
      redactSecrets(`${label} connection error (${code}): ${detail}`, context.token)
    );
  }

  return new Error(redactSecrets(`${label} connection error: ${detail}`, context.token));
}

export function formatHttpFailure(
  status: number,
  body: unknown,
  context: RequestDiagnosticContext
): Error {
  const method = context.method.toUpperCase();
  const path = safePath(context.path);
  const kind = classifyHttpStatus(status);
  const diagnostics = extractHttpDiagnostics(body);
  const detail = diagnostics ? `: ${diagnostics}` : "";
  return new Error(
    redactSecrets(`Runtrail ${method} ${path} HTTP ${status} (${kind})${detail}`, context.token)
  );
}

function classifyHttpStatus(status: number): string {
  if (status === 401 || status === 403) {
    return "authentication";
  }

  if (status === 400 || status === 422) {
    return "validation";
  }

  if (status === 404) {
    return "not_found";
  }

  if (status === 408 || status === 504) {
    return "timeout";
  }

  if (status === 429) {
    return "rate_limited";
  }

  if (status >= 500) {
    return "server_error";
  }

  return "http_error";
}

function extractHttpDiagnostics(body: unknown): string | undefined {
  if (!body || typeof body !== "object") {
    if (typeof body === "string" && body.length > 0) {
      return body;
    }
    return undefined;
  }

  const detail = body as Record<string, unknown>;
  const error = typeof detail.error === "string" ? detail.error : undefined;
  const issues = Array.isArray(detail.issues)
    ? detail.issues
        .slice(0, 10)
        .map((issue) => formatValidationIssue(issue))
        .filter((issue): issue is string => issue !== undefined)
    : [];
  const parts = [error, ...issues].filter(Boolean);
  return parts.length > 0 ? parts.join("; ") : undefined;
}

function formatValidationIssue(value: unknown): string | undefined {
  if (!value || typeof value !== "object") {
    return undefined;
  }

  const issue = value as Record<string, unknown>;
  const path = Array.isArray(issue.path) ? issue.path.map(String).join(".") : "";
  const message = typeof issue.message === "string" ? issue.message : undefined;
  return message ? `${path ? `${path}: ` : ""}${message}` : undefined;
}

export function redactSecrets(message: string, token?: string): string {
  let redacted = message.replace(/Bearer\s+\S+/gi, "Bearer [REDACTED]");

  if (token) {
    redacted = redacted.replaceAll(token, "[REDACTED]");
  }

  return redacted;
}

function extractErrorCode(error: unknown): string | undefined {
  if (!error || typeof error !== "object") {
    return undefined;
  }

  const err = error as { code?: unknown; cause?: unknown };

  if (typeof err.code === "string") {
    return err.code;
  }

  if (err.cause && typeof err.cause === "object") {
    const cause = err.cause as { code?: unknown };
    if (typeof cause.code === "string") {
      return cause.code;
    }
  }

  return undefined;
}

function extractErrorMessage(error: unknown): string | undefined {
  if (error instanceof Error) {
    return error.message;
  }

  if (typeof error === "string") {
    return error;
  }

  return undefined;
}

export function parseJsonBody(text: string): unknown {
  if (!text) {
    return undefined;
  }

  try {
    return JSON.parse(text);
  } catch {
    return text;
  }
}
