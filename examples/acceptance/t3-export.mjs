import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { closeSync, openSync, readSync } from "node:fs";

// Explicit local files only. Never contact T3, discover storage or execute source text.
const args = process.argv.slice(2);
try {
  assert.equal(args.length, 4);
  assert.equal(args[0], "--source");
  assert.equal(args[2], "--summary");
  const readBounded = (file) => {
    const fd = openSync(file, "r");
    try {
      const buffer = Buffer.alloc(16385);
      let size = 0;
      while (size < buffer.length) {
        const read = readSync(fd, buffer, size, buffer.length - size, null);
        if (read === 0) break;
        size += read;
      }
      assert(size <= 16384);
      return JSON.parse(buffer.subarray(0, size).toString("utf8"));
    } finally {
      closeSync(fd);
    }
  };
  const source = readBounded(args[1]);
  assert.deepEqual(Object.keys(source).sort(), ["recentRuns", "thread"]);
  assert.deepEqual(Object.keys(source.thread), ["threadId"]);
  assert(Array.isArray(source.recentRuns));
  assert.equal(source.recentRuns.length, 1, "Select exactly one source run explicitly");
  const run = source.recentRuns[0];
  assert.deepEqual(Object.keys(run).sort(), ["completedAt", "runId", "status"]);
  assert(["completed", "failed", "cancelled", "interrupted"].includes(run.status));
  assert(typeof run.completedAt === "string" && /^\d{4}-\d\d-\d\dT.*Z$/.test(run.completedAt));
  assert(Number.isFinite(Date.parse(run.completedAt)));
  const summary = readBounded(args[3]);
  const allowed = [
    "project",
    "workflowId",
    "workKey",
    "task",
    "summary",
    "evidence",
    "nextAction",
    "handoff"
  ];
  assert(Object.keys(summary).every((key) => allowed.includes(key)));
  const envelope = {
    schemaVersion: "1",
    source: {
      kind: "t3",
      system: "t3-code",
      threadId: source.thread.threadId,
      runId: run.runId,
      ref: `t3-thread://v1/${source.thread.threadId}`,
      observedAt: new Date().toISOString(),
      reportedStatus: run.status
    },
    ...summary
  };
  const raw = JSON.stringify(envelope, null, 2);
  // Reuse the implemented schema; this command must make zero requests.
  const checked = spawnSync(
    "pnpm",
    ["--silent", "cli", "import-work", "--file", "-", "--dry-run"],
    {
      input: raw,
      encoding: "utf8",
      timeout: 15000,
      maxBuffer: 32768
    }
  );
  assert.equal(checked.status, 0, "Runtrail import validation failed");
  assert.equal(JSON.parse(checked.stdout).status, "dry_run");
  console.log(raw);
} catch {
  console.error(
    "Export rejected. Use bounded selected T3 metadata and an allowlisted authored summary; run import-work --dry-run for sanitized validation details."
  );
  process.exitCode = 1;
}
