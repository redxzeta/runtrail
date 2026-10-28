import { accessSync, constants, readdirSync, statSync } from "node:fs";
import path from "node:path";
import { loadConfig, type RuntrailConfig } from "../config.js";
import { capabilitiesManifestSchema, healthResponseSchema } from "../shared/schemas.js";
import { outboxRoot, readPendingOutbox } from "./outbox.js";

type DoctorCheck = {
  status: "ok" | "warning" | "error" | "skipped";
  code: string;
  message: string;
};

export type DoctorReport = {
  schemaVersion: "1";
  ok: boolean;
  checks: {
    config: DoctorCheck;
    health: DoctorCheck;
    authentication: DoctorCheck;
    database: DoctorCheck;
    logs: DoctorCheck;
    state: DoctorCheck;
    outbox: DoctorCheck & {
      valid: number | null;
      malformed: number | null;
      quarantine: number | null;
    };
  };
};

const REQUEST_TIMEOUT_MS = 1500;
const MAX_RESPONSE_BYTES = 256 * 1024;
const capabilitiesIdentitySchema = capabilitiesManifestSchema.pick({
  schemaVersion: true,
  service: true,
  protocol: true
});

/** Diagnose only: never opens SQLite, creates paths, or changes outbox records. */
export async function doctorReport(): Promise<DoctorReport> {
  let config: RuntrailConfig | undefined;
  let configCheck: DoctorCheck;
  try {
    config = loadConfig();
    const url = new URL(config.url);
    if (!["http:", "https:"].includes(url.protocol) || url.username || url.password) {
      throw new Error("Invalid service URL");
    }
    configCheck = check("ok", "valid", "Configuration is valid.");
  } catch {
    config = undefined;
    configCheck = check(
      "error",
      "invalid_config",
      "Cannot load valid configuration. Check RUNTRAIL_CONFIG and environment overrides."
    );
  }

  const skipped = () =>
    check("skipped", "invalid_config", "Fix configuration before checking this item.");
  const [health, authentication] = config
    ? await Promise.all([
        probe(config, "/health"),
        config.security.token
          ? probe(config, "/meta/capabilities")
          : Promise.resolve(
              check(
                "error",
                "authentication",
                "Authenticated access is unverified. Set RUNTRAIL_TOKEN and rerun doctor."
              )
            )
      ])
    : [skipped(), skipped()];

  const stateRoot = outboxRoot();
  const checks: DoctorReport["checks"] = {
    config: configCheck,
    health,
    authentication,
    database: config ? inspectPath(config.storage.dbPath, "file") : skipped(),
    logs: config ? inspectPath(config.storage.logDir, "directory") : skipped(),
    state: inspectPath(stateRoot, "directory"),
    outbox: inspectOutbox(stateRoot)
  };
  return {
    schemaVersion: "1",
    ok: Object.values(checks).every((item) => item.status !== "error"),
    checks
  };
}

export function formatDoctor(report: DoctorReport): string {
  const labels: Record<keyof DoctorReport["checks"], string> = {
    config: "Configuration",
    health: "Service health",
    authentication: "Authenticated capabilities",
    database: "Local database",
    logs: "Local logs",
    state: "Local state",
    outbox: "Outbox"
  };
  const lines = [
    `Runtrail doctor (schema ${report.schemaVersion}): ${report.ok ? "OK" : "issues found"}`
  ];
  for (const key of Object.keys(labels) as Array<keyof typeof labels>) {
    const item = report.checks[key];
    lines.push(`${labels[key]}: ${item.status} (${item.code}) - ${item.message}`);
  }
  const { valid, malformed, quarantine } = report.checks.outbox;
  lines.push(
    `Outbox counts: valid=${valid ?? "unknown"}, malformed=${malformed ?? "unknown"}, quarantine=${quarantine ?? "unknown"}`
  );
  return lines.join("\n");
}

function check(status: DoctorCheck["status"], code: string, message: string): DoctorCheck {
  return { status, code, message };
}

function inspectPath(target: string, kind: "file" | "directory"): DoctorCheck {
  try {
    const info = statSync(target);
    if (kind === "file" ? !info.isFile() : !info.isDirectory()) {
      return check("error", "wrong_type", "Check the configured local path type.");
    }
    accessSync(
      target,
      constants.R_OK | constants.W_OK | (kind === "directory" ? constants.X_OK : 0)
    );
    return check(
      "ok",
      "accessible",
      "Existing local path has read/write access; contents were not checked."
    );
  } catch (error) {
    if (isMissing(error)) {
      return check(
        "warning",
        "missing",
        "Local path is absent; this can be expected for a remote service or unused local state."
      );
    }
    return check("error", "inaccessible", "Check permissions and the configured local path.");
  }
}

function inspectOutbox(root: string): DoctorReport["checks"]["outbox"] {
  let valid: number | null = null;
  let malformed: number | null = null;
  let quarantine: number | null = null;
  try {
    // The shared reader is read-only, but would try reading a FIFO or other special entry.
    const pending = entriesIfPresent(path.join(root, "outbox", "pending"));
    if (pending.some((entry) => entry.name.endsWith(".json") && !entry.isFile())) {
      throw new Error("Unsafe outbox entry");
    }
    const records = readPendingOutbox();
    valid = records.valid.length;
    malformed = records.malformed.length;
    quarantine = entriesIfPresent(path.join(root, "outbox", "quarantine")).filter(
      (entry) => entry.isFile() && entry.name.endsWith(".json")
    ).length;
    return {
      ...(malformed || quarantine
        ? check(
            "warning",
            "needs_attention",
            "Review malformed or quarantined records before explicitly choosing recovery. Nothing was changed."
          )
        : check("ok", "readable", "Outbox inspected without replaying or changing records.")),
      valid,
      malformed,
      quarantine
    };
  } catch {
    return {
      ...check(
        "error",
        "unreadable",
        "Check outbox permissions and ensure pending records are regular files. Nothing was changed."
      ),
      valid,
      malformed,
      quarantine
    };
  }
}

function entriesIfPresent(directory: string) {
  try {
    return readdirSync(directory, { withFileTypes: true });
  } catch (error) {
    if (isMissing(error)) return [];
    throw error;
  }
}

function isMissing(error: unknown): boolean {
  return error instanceof Error && "code" in error && error.code === "ENOENT";
}

async function probe(
  config: RuntrailConfig,
  endpoint: "/health" | "/meta/capabilities"
): Promise<DoctorCheck> {
  const signal = AbortSignal.timeout(REQUEST_TIMEOUT_MS);
  let reader: ReadableStreamDefaultReader<Uint8Array> | undefined;
  let onAbort: () => void = () => {};
  const timeout = new Promise<never>((_resolve, reject) => {
    onAbort = () => {
      void reader?.cancel().catch(() => {});
      reject(signal.reason);
    };
    signal.addEventListener("abort", onAbort, { once: true });
  });

  const request = async (): Promise<DoctorCheck> => {
    const headers = new Headers({ accept: "application/json" });
    if (endpoint !== "/health" && config.security.token) {
      headers.set("authorization", `Bearer ${config.security.token}`);
    }
    const response = await fetch(new URL(endpoint, config.url), {
      method: "GET",
      headers,
      signal,
      redirect: "error"
    });
    if (!response.ok) {
      // Never read or print error bodies, which may contain credentials or private paths.
      void response.body?.cancel().catch(() => {});
      if (response.status === 401 || response.status === 403) {
        return check(
          "error",
          "authentication",
          "Authentication failed. Check RUNTRAIL_TOKEN and server authentication settings."
        );
      }
      if (response.status === 408 || response.status === 504) {
        return check("error", "timeout", "Service timeout. Check service availability and retry.");
      }
      return check(
        "error",
        "service_error",
        "Service check failed. Check service status and protocol compatibility."
      );
    }

    reader = response.body?.getReader();
    if (!reader) return invalidResponse();
    const chunks: Uint8Array[] = [];
    let size = 0;
    try {
      while (true) {
        const { value, done } = await reader.read();
        if (done) break;
        size += value.byteLength;
        if (size > MAX_RESPONSE_BYTES) {
          void reader.cancel().catch(() => {});
          return invalidResponse();
        }
        chunks.push(value);
      }
    } finally {
      reader.releaseLock();
    }
    let body: unknown;
    try {
      body = JSON.parse(Buffer.concat(chunks).toString("utf8"));
    } catch {
      return invalidResponse();
    }
    if (endpoint === "/health") {
      return healthResponseSchema.safeParse(body).success
        ? check("ok", "healthy", "Service health succeeded; this does not verify authentication.")
        : invalidResponse();
    }
    // Check stable identity fields only; unknown additive capabilities remain compatible.
    if (!capabilitiesIdentitySchema.safeParse(body).success) return invalidResponse();
    return check("ok", "authenticated", "Authenticated capabilities request succeeded.");
  };

  try {
    return await Promise.race([request(), timeout]);
  } catch {
    return signal.aborted
      ? check("error", "timeout", "Service timeout. Check service availability and retry.")
      : check(
          "error",
          "connectivity",
          "Connection failed. Check service availability, RUNTRAIL_URL, and redirect settings."
        );
  } finally {
    signal.removeEventListener("abort", onAbort);
  }
}

function invalidResponse(): DoctorCheck {
  return check(
    "error",
    "invalid_response",
    "Unexpected service response. Check service and protocol compatibility."
  );
}
