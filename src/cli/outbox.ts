import { randomUUID } from "node:crypto";
import {
  chmodSync,
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  renameSync,
  statSync,
  unlinkSync,
  writeFileSync
} from "node:fs";
import { homedir, platform } from "node:os";
import path from "node:path";
import { z } from "zod";

const MAX_OUTBOX_RECORD_BYTES = 64 * 1024;

const outboxRecordSchema = z.object({
  version: z.literal(1),
  id: z.string().uuid(),
  operation: z.string().min(1).max(80),
  path: z.string().startsWith("/").max(500),
  method: z.literal("POST"),
  payload: z.record(z.string(), z.unknown()),
  idempotencyKey: z.string().min(1).max(255),
  createdAt: z.string().datetime(),
  retryCount: z.number().int().nonnegative()
});

export type OutboxRecord = z.infer<typeof outboxRecordSchema>;
export type OutboxSummary = Pick<
  OutboxRecord,
  "id" | "operation" | "createdAt" | "retryCount" | "idempotencyKey"
>;

export function outboxRoot(env: NodeJS.ProcessEnv = process.env): string {
  if (env.RUNTRAIL_STATE_DIR) return path.resolve(env.RUNTRAIL_STATE_DIR);
  if (platform() === "darwin")
    return path.join(homedir(), "Library", "Application Support", "runtrail");
  return path.join(env.XDG_STATE_HOME ?? path.join(homedir(), ".local", "state"), "runtrail");
}

export function enqueueOutbox(
  input: Pick<OutboxRecord, "operation" | "path" | "method" | "payload" | "idempotencyKey">,
  env: NodeJS.ProcessEnv = process.env
): OutboxSummary {
  assertSafePayload(input.payload);
  const record: OutboxRecord = {
    version: 1,
    id: randomUUID(),
    ...input,
    createdAt: new Date().toISOString(),
    retryCount: 0
  };
  assertSafeRecord(record);
  const pending = ensureDirectory(path.join(outboxRoot(env), "outbox", "pending"));
  const target = path.join(pending, `${record.id}.json`);
  const temporary = `${target}.tmp`;
  writeFileSync(temporary, `${JSON.stringify(record)}\n`, { mode: 0o600, flag: "wx" });
  renameSync(temporary, target);
  chmodSync(target, 0o600);
  return summarize(record);
}

export function listOutbox(env: NodeJS.ProcessEnv = process.env): OutboxSummary[] {
  return readRecords("pending", env).valid.map(({ record }) => summarize(record));
}

export function readPendingOutbox(env: NodeJS.ProcessEnv = process.env): {
  valid: Array<{ file: string; record: OutboxRecord }>;
  malformed: Array<{ file: string; error: string }>;
} {
  return readRecords("pending", env);
}

export function updateOutboxRetry(file: string, record: OutboxRecord): void {
  const updated = { ...record, retryCount: record.retryCount + 1 };
  const temporary = `${file}.tmp`;
  writeFileSync(temporary, `${JSON.stringify(updated)}\n`, { mode: 0o600 });
  renameSync(temporary, file);
  chmodSync(file, 0o600);
}

export function removeOutboxRecord(file: string): void {
  unlinkSync(file);
}

export function quarantineOutbox(
  file: string,
  reason: string,
  env: NodeJS.ProcessEnv = process.env
): void {
  const directory = ensureDirectory(path.join(outboxRoot(env), "outbox", "quarantine"));
  const name = path.basename(file);
  const target = path.join(directory, name);
  renameSync(file, target);
  chmodSync(target, 0o600);
  writeFileSync(path.join(directory, `${name}.reason`), `${reason.slice(0, 500)}\n`, {
    mode: 0o600
  });
}

function readRecords(kind: "pending", env: NodeJS.ProcessEnv) {
  const directory = path.join(outboxRoot(env), "outbox", kind);
  if (!existsSync(directory)) return { valid: [], malformed: [] };
  const valid: Array<{ file: string; record: OutboxRecord }> = [];
  const malformed: Array<{ file: string; error: string }> = [];
  for (const name of readdirSync(directory)
    .filter((item) => item.endsWith(".json"))
    .sort()) {
    const file = path.join(directory, name);
    try {
      if (statSync(file).size > MAX_OUTBOX_RECORD_BYTES) {
        throw new Error("outbox record exceeds the size limit");
      }
      const record = outboxRecordSchema.parse(JSON.parse(readFileSync(file, "utf8")));
      assertSafeRecord(record);
      valid.push({ file, record });
    } catch {
      malformed.push({ file, error: "malformed or unsafe outbox record" });
    }
  }
  return { valid, malformed };
}

function ensureDirectory(directory: string): string {
  mkdirSync(directory, { recursive: true, mode: 0o700 });
  chmodSync(directory, 0o700);
  return directory;
}

function summarize(record: OutboxRecord): OutboxSummary {
  const { id, operation, createdAt, retryCount, idempotencyKey } = record;
  return { id, operation, createdAt, retryCount, idempotencyKey };
}

function assertSafeRecord(record: OutboxRecord): void {
  const specification =
    record.operation === "create_run"
      ? { path: "/runs", key: "clientRunId" }
      : record.operation === "create_event"
        ? { path: "/events", key: "clientRecordId" }
        : record.operation === "create_open_loop"
          ? { path: "/open-loops", key: "clientRecordId" }
          : record.operation === "create_decision"
            ? { path: "/decisions", key: "clientRecordId" }
            : record.operation === "create_handoff"
              ? { path: "/handoffs", key: "clientRecordId" }
              : record.operation === "create_verification"
                ? { path: "/verifications", key: "clientRecordId" }
                : undefined;
  if (
    !specification ||
    record.path !== specification.path ||
    record.payload[specification.key] !== record.idempotencyKey
  ) {
    throw new Error("Outbox operation, path, and idempotency key do not match");
  }
  if (Buffer.byteLength(JSON.stringify(record), "utf8") > MAX_OUTBOX_RECORD_BYTES) {
    throw new Error("Outbox record exceeds the size limit");
  }
  assertSafePayload(record.payload);
}

function assertSafePayload(value: unknown, key = ""): void {
  if (/token|authorization|secret|password|environment|env/i.test(key)) {
    throw new Error("Payload contains a forbidden secret-bearing field");
  }
  if (typeof value === "string" && /Bearer\s+\S+/i.test(value)) {
    throw new Error("Payload contains authorization material");
  }
  if (Array.isArray(value)) {
    for (const item of value) assertSafePayload(item);
  } else if (value && typeof value === "object") {
    for (const [nestedKey, nestedValue] of Object.entries(value)) {
      assertSafePayload(nestedValue, nestedKey);
    }
  }
}
