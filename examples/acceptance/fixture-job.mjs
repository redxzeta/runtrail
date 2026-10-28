import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

// All inputs and commands are chosen locally, never from ledger/imported text.
const [mode, file] = process.argv.slice(2);
if (mode === "check") {
  const fixture = JSON.parse(readFileSync(file, "utf8"));
  const actual = fixture.values.reduce((sum, value) => sum + value, 0);
  assert.equal(actual, fixture.expected, "fixture sum differs from expectation");
  console.log(JSON.stringify({ check: "fixture-sum", actual, passed: true }));
} else if (mode === "homelab") {
  const fixture = JSON.parse(readFileSync(file, "utf8"));
  assert.equal(fixture.disposable, true);
  assert.equal(
    fixture.jobs.every((job) => job.result === "ok"),
    true
  );
  console.log(JSON.stringify({ kind: "fixture-job-report", jobs: fixture.jobs.length, ok: true }));
} else if (mode === "experiment") {
  const samples = [-3, -2, -1, 0, 1, 2, 3];
  const metrics = [1, 2, 3].map((threshold) => {
    const correct = samples.filter((x) => Math.abs(x) >= threshold === x * x >= 4).length;
    return { threshold, correct, samples: samples.length, accuracy: correct / samples.length };
  });
  console.log(JSON.stringify({ experiment: "toy-threshold-classification", metrics }));
} else {
  throw new Error("Expected check <fixture>, homelab <fixture>, or experiment");
}
