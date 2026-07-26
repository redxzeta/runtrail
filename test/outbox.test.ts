import { mkdirSync, mkdtempSync, rmSync, statSync, writeFileSync } from "node:fs";
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
    const earlier = record({
      id: "22222222-2222-4222-8222-222222222222",
      createdAt: "2026-07-26T00:00:00.000Z",
      idempotencyKey: "event-earlier"
    });
    const equalHigherId = record({
      id: "33333333-3333-4333-8333-333333333333",
      createdAt: "2026-07-26T01:00:00.000Z",
      idempotencyKey: "event-equal-high"
    });
    const equalLowerId = record({
      id: "11111111-1111-4111-8111-111111111111",
      createdAt: "2026-07-26T01:00:00.000Z",
      idempotencyKey: "event-equal-low"
    });

    writeRecord(path.join(pendingDir, "a-later.json"), later);
    writeFileSync(path.join(pendingDir, "b-malformed.json"), "{", { mode: 0o600 });
    writeRecord(path.join(pendingDir, "c-equal-high.json"), equalHigherId);
    writeRecord(path.join(pendingDir, "d-earlier.json"), earlier);
    writeRecord(path.join(pendingDir, "e-equal-low.json"), equalLowerId);

    const pending = readPendingOutbox(env);

    expect(pending.valid.map(({ record }) => record.id)).toEqual([
      earlier.id,
      equalLowerId.id,
      equalHigherId.id,
      later.id
    ]);
    expect(listOutbox(env).map(({ id }) => id)).toEqual([
      earlier.id,
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
});

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
