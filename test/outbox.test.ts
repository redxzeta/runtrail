import { mkdirSync, mkdtempSync, rmSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  enqueueOutbox,
  listOutbox,
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
});
