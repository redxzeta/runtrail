import type { AgentRun, RunFreshness } from "./schemas.js";

export function classifyRunFreshness(
  run: AgentRun,
  asOf: string,
  staleAfterSeconds: number
): RunFreshness {
  const base = { staleAfterSeconds, asOf };
  if (["completed", "failed", "cancelled"].includes(run.status)) {
    return { ...base, state: "not_applicable", reasonCode: "terminal_status" };
  }
  if (!run.lastLivenessAt) {
    return { ...base, state: "unknown", reasonCode: "no_authoritative_liveness" };
  }

  const staleBoundary = Date.parse(asOf) - staleAfterSeconds * 1000;
  if (Date.parse(run.lastLivenessAt) < staleBoundary) {
    return {
      ...base,
      state: "stale_candidate",
      lastLivenessAt: run.lastLivenessAt,
      reasonCode: "run_liveness_exceeds_window"
    };
  }
  return {
    ...base,
    state: "fresh",
    lastLivenessAt: run.lastLivenessAt,
    reasonCode: "authoritative_liveness_within_window"
  };
}
