import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  rmSync,
  statSync,
  writeFileSync
} from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  enqueueOutbox,
  listOutbox,
  type OutboxRecord,
  quarantineOutbox,
  readPendingOutbox,
  removeOutboxRecord
} from "../src/cli/outbox.js";

let stateDir: string | undefined;

afterEach(() => {
  if (stateDir) rmSync(stateDir, { recursive: true, force: true });
  stateDir = undefined;
});

describe("local outbox", () => {
  it("stores only safe records with strict permissions and identifies malformed input", () => {
    stateDir = mkdtempSync(path.join(tmpdir(), "runtrail-outbox-"));
    const env = { RUNTRAIL_STATE_DIR: stateDir };
    const summary = enqueueOutbox(
      {
        operation: "create_event",
        path: "/events",
        method: "POST",
        payload: { runId: "run_1", clientRecordId: "event-1", type: "progress" },
        idempotencyKey: "event-1"
      },
      env
    );
    const pending = readPendingOutbox(env);

    expect(listOutbox(env)).toEqual([summary]);
    expect(statSync(path.dirname(pending.valid[0]?.file ?? "")).mode & 0o777).toBe(0o700);
    expect(statSync(pending.valid[0]?.file ?? "").mode & 0o777).toBe(0o600);
    expect(() =>
      enqueueOutbox(
        {
          operation: "create_event",
          path: "/events",
          method: "POST",
          payload: { clientRecordId: "unsafe", authorization: "Bearer secret" },
          idempotencyKey: "unsafe"
        },
        env
      )
    ).toThrow(/forbidden secret-bearing field/);

    const malformedFile = path.join(stateDir, "outbox", "pending", "malformed.json");
    mkdirSync(path.dirname(malformedFile), { recursive: true });
    writeFileSync(malformedFile, "{", { mode: 0o600 });
    const reread = readPendingOutbox(env);
    expect(reread.malformed).toEqual([
      expect.objectContaining({ file: malformedFile, error: "malformed or unsafe outbox record" })
    ]);
    quarantineOutbox(malformedFile, reread.malformed[0]?.error ?? "", env);
    removeOutboxRecord(pending.valid[0]?.file ?? "");
    expect(listOutbox(env)).toEqual([]);
  });

  it("orders pending records by creation time with an id tie-breaker", () => {
    stateDir = mkdtempSync(path.join(tmpdir(), "runtrail-outbox-"));
    const env = { RUNTRAIL_STATE_DIR: stateDir };
    const pendingDir = path.join(stateDir, "outbox", "pending");
    mkdirSync(pendingDir, { recursive: true });
    const later = record({
      id: "00000000-0000-4000-8000-000000000000",
      createdAt: "2026-07-26T02:00:00.000Z",
      idempotencyKey: "event-later"
    });
    const mixedPrecisionLater = record({
      id: "44444444-4444-4444-8444-444444444444",
      createdAt: "2026-07-26T01:00:00.100Z",
      idempotencyKey: "event-mixed-precision-later"
    });
    const mixedPrecisionEarlier = record({
      id: "55555555-5555-4555-8555-555555555555",
      createdAt: "2026-07-26T01:00:00Z",
      idempotencyKey: "event-mixed-precision-earlier"
    });
    const earlier = record({
      id: "22222222-2222-4222-8222-222222222222",
      createdAt: "2026-07-26T00:00:00.000Z",
      idempotencyKey: "event-earlier"
    });
    const equalHigherId = record({
      id: "33333333-3333-4333-8333-333333333333",
      createdAt: "2026-07-26T01:30:00.000Z",
      idempotencyKey: "event-equal-high"
    });
    const equalLowerId = record({
      id: "11111111-1111-4111-8111-111111111111",
      createdAt: "2026-07-26T01:30:00.000Z",
      idempotencyKey: "event-equal-low"
    });

    writeRecord(path.join(pendingDir, "a-later.json"), later);
    writeFileSync(path.join(pendingDir, "b-malformed.json"), "{", { mode: 0o600 });
    writeRecord(path.join(pendingDir, "c-equal-high.json"), equalHigherId);
    writeRecord(path.join(pendingDir, "d-earlier.json"), earlier);
    writeRecord(path.join(pendingDir, "e-equal-low.json"), equalLowerId);
    writeRecord(path.join(pendingDir, "f-mixed-precision-later.json"), mixedPrecisionLater);
    writeRecord(path.join(pendingDir, "g-mixed-precision-earlier.json"), mixedPrecisionEarlier);

    const pending = readPendingOutbox(env);

    expect(pending.valid.map(({ record }) => record.id)).toEqual([
      earlier.id,
      mixedPrecisionEarlier.id,
      mixedPrecisionLater.id,
      equalLowerId.id,
      equalHigherId.id,
      later.id
    ]);
    expect(listOutbox(env).map(({ id }) => id)).toEqual([
      earlier.id,
      mixedPrecisionEarlier.id,
      mixedPrecisionLater.id,
      equalLowerId.id,
      equalHigherId.id,
      later.id
    ]);
    expect(pending.malformed).toEqual([
      expect.objectContaining({
        file: path.join(pendingDir, "b-malformed.json"),
        error: "malformed or unsafe outbox record"
      })
    ]);
  });

  it("rejects recursive secret-bearing payloads without echoing values", () => {
    stateDir = mkdtempSync(path.join(tmpdir(), "runtrail-outbox-"));
    const env = { RUNTRAIL_STATE_DIR: stateDir };
    const cases: Array<{ name: string; payload: Record<string, unknown>; message: RegExp }> = [
      {
        name: "nested token key",
        payload: { clientRecordId: "nested-token", metadata: { token: "placeholder-token-value" } },
        message: /forbidden secret-bearing field/
      },
      {
        name: "nested authorization key",
        payload: {
          clientRecordId: "nested-authorization",
          metadata: { authorization: "placeholder-authorization-value" }
        },
        message: /forbidden secret-bearing field/
      },
      {
        name: "nested secret key",
        payload: {
          clientRecordId: "nested-secret",
          metadata: { secret: "placeholder-secret-value" }
        },
        message: /forbidden secret-bearing field/
      },
      {
        name: "nested password key",
        payload: {
          clientRecordId: "nested-password",
          metadata: { password: "placeholder-password-value" }
        },
        message: /forbidden secret-bearing field/
      },
      {
        name: "nested environment key",
        payload: {
          clientRecordId: "nested-environment",
          metadata: { environment: "placeholder-environment-value" }
        },
        message: /forbidden secret-bearing field/
      },
      {
        name: "nested env key inside array",
        payload: {
          clientRecordId: "nested-env",
          metadata: [{ env: "placeholder-env-value" }]
        },
        message: /forbidden secret-bearing field/
      },
      {
        name: "bearer string inside safe field",
        payload: {
          clientRecordId: "nested-bearer",
          metadata: { note: "Bearer placeholder-bearer-value" }
        },
        message: /authorization material/
      }
    ];

    for (const testCase of cases) {
      expect(() => enqueueEvent(testCase.payload, env), testCase.name).toThrow(testCase.message);
      try {
        enqueueEvent(testCase.payload, env);
      } catch (error) {
        expect(error).toBeInstanceOf(Error);
        expect((error as Error).message).not.toContain("placeholder");
      }
    }
    expect(listPendingNames(env)).toEqual([]);
  });

  it("accepts near-limit records and rejects oversized records without partial files", () => {
    stateDir = mkdtempSync(path.join(tmpdir(), "runtrail-outbox-"));
    const env = { RUNTRAIL_STATE_DIR: stateDir };
    const nearLimit = enqueueEvent(
      {
        clientRecordId: "near-limit",
        type: "progress",
        note: "x".repeat(62 * 1024)
      },
      env
    );
    const pending = readPendingOutbox(env);

    expect(pending.valid.map(({ record }) => record.id)).toEqual([nearLimit.id]);
    expect(statSync(pending.valid[0]?.file ?? "").size).toBeLessThanOrEqual(64 * 1024);
    expect(() =>
      enqueueEvent(
        {
          clientRecordId: "oversized",
          type: "progress",
          note: "x".repeat(70 * 1024)
        },
        env
      )
    ).toThrow(/size limit/);
    expect(readPendingOutbox(env).valid.map(({ record }) => record.id)).toEqual([nearLimit.id]);
    expect(listPendingNames(env)).toEqual([`${nearLimit.id}.json`]);
  });
});

function enqueueEvent(payload: Record<string, unknown>, env: NodeJS.ProcessEnv) {
  const idempotencyKey = String(payload.clientRecordId ?? "event-safety");
  return enqueueOutbox(
    {
      operation: "create_event",
      path: "/events",
      method: "POST",
      payload,
      idempotencyKey
    },
    env
  );
}

function listPendingNames(env: NodeJS.ProcessEnv): string[] {
  const root = env.RUNTRAIL_STATE_DIR;
  if (!root) return [];
  const pendingDir = path.join(root, "outbox", "pending");
  return existsSync(pendingDir) ? readdirSync(pendingDir).sort() : [];
}

function record(
  overrides: Pick<OutboxRecord, "id" | "createdAt" | "idempotencyKey">
): OutboxRecord {
  return {
    version: 1,
    operation: "create_event",
    path: "/events",
    method: "POST",
    payload: { runId: "run_1", clientRecordId: overrides.idempotencyKey, type: "progress" },
    retryCount: 0,
    ...overrides
  };
}

function writeRecord(file: string, record: OutboxRecord): void {
  writeFileSync(file, `${JSON.stringify(record)}\n`, { mode: 0o600 });
}
