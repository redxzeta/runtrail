import type {
  Decision,
  Handoff,
  OpenLoop,
  PrepareWorkRunSummary,
  ProvenanceAssurance,
  ProvenanceOrigin,
  ReadinessActionCode,
  ReadinessCaveatCode,
  ReadinessFinding,
  ReadinessNextAction,
  ReadinessReasonCode,
  ReadinessSourceRef,
  ReadinessStatus,
  ReadinessTargetRef,
  VerificationEvidence,
  WorkflowReadiness
} from "./schemas.js";

const MAX_OUTPUT_ITEMS = 20;
const hardLoopTypes = new Set(["blocked", "decision_required", "failed_unresolved"]);
const derivedOrigin = "deterministic_derivation" satisfies ProvenanceOrigin;

export type WorkflowReadinessInput = {
  workflowId?: string;
  asOf: string;
  runs: PrepareWorkRunSummary[];
  openLoops: OpenLoop[];
  handoffs: Handoff[];
  effectiveDecisions: Decision[];
  verifications: VerificationEvidence[];
  inputsTruncated: boolean;
};

export function evaluateWorkflowReadiness(input: WorkflowReadinessInput): WorkflowReadiness {
  const runs = [...input.runs].sort(compareRuns);
  const runRefs = runs.map(runSourceRef);
  const relationshipProblem = relationshipProblemFor(input.workflowId, runs);

  if (relationshipProblem || input.inputsTruncated) {
    const reasonCode: ReadinessReasonCode = relationshipProblem
      ? "workflow_relationships_incomplete"
      : "workflow_inputs_truncated";
    return result(
      "unknown",
      input.asOf,
      [
        finding(reasonCode, runRefs, "unknown", [
          relationshipProblem ? "legacy_relationships_missing" : "workflow_inputs_truncated"
        ])
      ],
      [action("stop_and_reread", runRefs, true)]
    );
  }

  const blockedRuns = runs.filter((run) =>
    ["blocked", "decision_required", "failed"].includes(run.status)
  );
  const hardLoops = input.openLoops
    .filter((loop) => loop.status === "open" && hardLoopTypes.has(loop.type))
    .sort(compareRecords);
  if (blockedRuns.length > 0 || hardLoops.length > 0) {
    const findings: ReadinessFinding[] = [
      ...blockedRuns.map((run) => finding("related_run_blocked", [runSourceRef(run)])),
      ...hardLoops.map((loop) => {
        const refs = [loopSourceRef(loop)];
        if (loop.type === "decision_required") {
          refs.push(...input.effectiveDecisions.flatMap(decisionSourceRefs));
        }
        return finding("unresolved_hard_blocker", refs);
      })
    ];
    const actions: ReadinessNextAction[] = [
      ...blockedRuns.map((run) => action("stop_and_reread", [runSourceRef(run)], true)),
      ...hardLoops.map((loop) => action("resolve_blocker", [loopSourceRef(loop)], true))
    ];
    if (
      hardLoops.some((loop) => loop.type === "decision_required") &&
      input.effectiveDecisions.length > 0
    ) {
      actions.push(
        ...input.effectiveDecisions.map((decision) =>
          action("inspect_effective_decision", [decisionSourceRef(decision)], true)
        )
      );
    }
    return result("blocked", input.asOf, findings, actions);
  }

  const incompleteHandoffs = input.handoffs
    .filter((handoff) => ["pending", "accepted"].includes(handoff.status))
    .sort(compareRecords);
  if (incompleteHandoffs.length > 0) {
    return result(
      "in_progress",
      input.asOf,
      incompleteHandoffs.map((handoff) =>
        finding("handoff_incomplete", [handoffSourceRef(handoff)])
      ),
      incompleteHandoffs.map((handoff) =>
        action("complete_handoff", [handoffSourceRef(handoff)], true)
      )
    );
  }

  const activeRuns = runs.filter((run) => !isTerminal(run.status));
  const freshRuns = activeRuns.filter((run) => run.freshness.state === "fresh");
  if (freshRuns.length > 0) {
    return result(
      "in_progress",
      input.asOf,
      freshRuns.map((run) => finding("fresh_related_run_active", [runSourceRef(run)])),
      freshRuns.map((run) => action("inspect_active_conflict", [runSourceRef(run)], true))
    );
  }

  const staleRuns = activeRuns.filter((run) => run.freshness.state === "stale_candidate");
  if (staleRuns.length > 0) {
    return result(
      "unknown",
      input.asOf,
      staleRuns.map((run) =>
        finding("stale_related_run_requires_inspection", [runSourceRef(run)], "unknown")
      ),
      staleRuns.map((run) => action("inspect_stale_run", [runSourceRef(run)], true))
    );
  }

  const unknownRuns = activeRuns.filter((run) => run.freshness.state === "unknown");
  if (unknownRuns.length > 0) {
    return result(
      "unknown",
      input.asOf,
      unknownRuns.map((run) =>
        finding("related_run_freshness_unknown", [runSourceRef(run)], "unknown")
      ),
      unknownRuns.map((run) => action("stop_and_reread", [runSourceRef(run)], true))
    );
  }

  const effectiveVerifications = latestVerifications(input.verifications);
  const failed = effectiveVerifications.filter((item) => item.outcome === "failed");
  if (failed.length > 0) {
    return result(
      "needs_evidence",
      input.asOf,
      failed.map((item) => finding("verification_failed", [verificationSourceRef(item)])),
      failed.map((item) => action("rerun_failed_verification", [verificationSourceRef(item)], true))
    );
  }

  const notRun = effectiveVerifications.filter((item) => item.outcome === "not_run");
  if (notRun.length > 0) {
    return result(
      "needs_evidence",
      input.asOf,
      notRun.map((item) => finding("required_verification_not_run", [verificationSourceRef(item)])),
      notRun.map((item) =>
        action("record_verification_disposition", [verificationSourceRef(item)], true)
      )
    );
  }

  const reviewableRuns = runs.filter((run) => run.status !== "cancelled");
  const runIdsWithDisposition = new Set(effectiveVerifications.map((item) => item.runId));
  const missing = reviewableRuns.filter((run) => !runIdsWithDisposition.has(run.id));
  if (missing.length > 0) {
    return result(
      "needs_evidence",
      input.asOf,
      missing.map((run) =>
        finding("required_verification_missing", [runSourceRef(run)], "unknown")
      ),
      missing.map((run) => action("record_verification_disposition", [runSourceRef(run)], true))
    );
  }

  if (reviewableRuns.length > 0 && effectiveVerifications.length > 0) {
    return result(
      "ready_for_review",
      input.asOf,
      [
        finding("workflow_ready_for_review", [
          ...reviewableRuns.map(runSourceRef),
          ...effectiveVerifications.map(verificationSourceRef)
        ])
      ],
      []
    );
  }

  return result(
    "unknown",
    input.asOf,
    [finding("legacy_workflow_unclassified", runRefs, "unknown", ["legacy_relationships_missing"])],
    [action("stop_and_reread", runRefs, true)]
  );
}

function result(
  status: ReadinessStatus,
  asOf: string,
  findings: ReadinessFinding[],
  nextActions: ReadinessNextAction[]
): WorkflowReadiness {
  const boundedFindings = findings.slice(0, MAX_OUTPUT_ITEMS);
  return {
    status,
    reasonCodes: [...new Set(boundedFindings.map((item) => item.reasonCode))],
    findings: boundedFindings,
    nextActions: nextActions.slice(0, MAX_OUTPUT_ITEMS),
    asOf
  };
}

function finding(
  reasonCode: ReadinessReasonCode,
  sourceRefs: ReadinessSourceRef[],
  assurance?: ProvenanceAssurance,
  extraCaveats: ReadinessCaveatCode[] = []
): ReadinessFinding {
  const refs = uniqueSourceRefs(sourceRefs).slice(0, MAX_OUTPUT_ITEMS);
  return {
    reasonCode,
    origin: derivedOrigin,
    assurance: assurance ?? aggregateAssurance(refs),
    sourceRefs: refs,
    caveatCodes: [
      ...new Set([...refs.flatMap(referenceCaveats), ...extraCaveats])
    ].sort() as ReadinessCaveatCode[]
  };
}

function action(
  actionCode: ReadinessActionCode,
  sourceRefs: ReadinessSourceRef[],
  requiresReread: boolean
): ReadinessNextAction {
  const targetRefs: ReadinessTargetRef[] = uniqueSourceRefs(sourceRefs)
    .slice(0, MAX_OUTPUT_ITEMS)
    .map(({ type, id, version }) => ({ type, id, version }));
  return { actionCode, targetRefs, requiresReread };
}

function latestVerifications(items: VerificationEvidence[]): VerificationEvidence[] {
  const latest = new Map<string, VerificationEvidence>();
  for (const item of [...items].sort(compareVerifications)) {
    latest.set(`${item.runId}\0${item.checkId}`, item);
  }
  return [...latest.values()].sort(compareVerifications);
}

function relationshipProblemFor(
  workflowId: string | undefined,
  runs: PrepareWorkRunSummary[]
): boolean {
  if (!workflowId || runs.length === 0 || runs.some((run) => run.workflowId !== workflowId)) {
    return true;
  }
  const ids = new Set(runs.map((run) => run.id));
  if (
    runs.some(
      (run) =>
        (run.parentRunId !== undefined && !ids.has(run.parentRunId)) ||
        (run.continuedFromRunId !== undefined && !ids.has(run.continuedFromRunId))
    )
  ) {
    return true;
  }
  const edges = new Map(
    runs.map((run) => [
      run.id,
      [run.parentRunId, run.continuedFromRunId].filter((id): id is string => id !== undefined)
    ])
  );
  const visiting = new Set<string>();
  const visited = new Set<string>();
  const hasCycle = (id: string): boolean => {
    if (visiting.has(id)) return true;
    if (visited.has(id)) return false;
    visiting.add(id);
    for (const reference of edges.get(id) ?? []) {
      if (hasCycle(reference)) return true;
    }
    visiting.delete(id);
    visited.add(id);
    return false;
  };
  return runs.some((run) => hasCycle(run.id));
}

function runSourceRef(run: PrepareWorkRunSummary): ReadinessSourceRef {
  return {
    type: "run",
    id: run.id,
    version: run.version,
    origin: "server_observed",
    assurance: "asserted"
  };
}

function loopSourceRef(loop: OpenLoop): ReadinessSourceRef {
  return {
    type: "openLoop",
    id: loop.id,
    version: loop.version,
    origin: "client_reported",
    assurance: "asserted"
  };
}

function handoffSourceRef(handoff: Handoff): ReadinessSourceRef {
  return {
    type: "handoff",
    id: handoff.id,
    version: handoff.version,
    origin: "server_observed",
    assurance: "evidence_backed"
  };
}

function decisionSourceRef(decision: Decision): ReadinessSourceRef {
  return persistedDecisionRef(decision.id);
}

function decisionSourceRefs(decision: Decision): ReadinessSourceRef[] {
  return [
    ...(decision.supersedesDecisionId ? [persistedDecisionRef(decision.supersedesDecisionId)] : []),
    decisionSourceRef(decision)
  ];
}

function persistedDecisionRef(id: string): ReadinessSourceRef {
  return {
    type: "decision",
    id,
    origin: "server_observed",
    assurance: "evidence_backed"
  };
}

function verificationSourceRef(item: VerificationEvidence): ReadinessSourceRef {
  return {
    type: "verification",
    id: item.id,
    origin: "client_reported",
    assurance: verificationAssurance(item)
  };
}

export function verificationAssurance(item: VerificationEvidence): ProvenanceAssurance {
  return item.support.type === "unavailable"
    ? "unknown"
    : item.support.type === "client_reported"
      ? "asserted"
      : "evidence_backed";
}

function aggregateAssurance(refs: ReadinessSourceRef[]): ProvenanceAssurance {
  if (refs.length === 0 || refs.some((reference) => reference.assurance === "unknown")) {
    return "unknown";
  }
  const levels = new Set(refs.map((reference) => reference.assurance));
  return levels.size === 1 ? (refs[0]?.assurance ?? "unknown") : "mixed";
}

function referenceCaveats(reference: ReadinessSourceRef): ReadinessCaveatCode[] {
  if (reference.type !== "verification") return [];
  return reference.assurance === "unknown"
    ? ["verification_client_reported", "verification_support_unavailable"]
    : ["verification_client_reported"];
}

function uniqueSourceRefs(refs: ReadinessSourceRef[]): ReadinessSourceRef[] {
  const byKey = new Map<string, ReadinessSourceRef>();
  for (const reference of refs) {
    byKey.set(`${reference.type}\0${reference.id}\0${reference.version ?? 0}`, reference);
  }
  return [...byKey.values()].sort(compareSourceRefs);
}

function compareSourceRefs(left: ReadinessSourceRef, right: ReadinessSourceRef): number {
  return (
    left.type.localeCompare(right.type) ||
    left.id.localeCompare(right.id) ||
    (left.version ?? 0) - (right.version ?? 0)
  );
}

function compareRuns(left: PrepareWorkRunSummary, right: PrepareWorkRunSummary): number {
  return left.startedAt.localeCompare(right.startedAt) || left.id.localeCompare(right.id);
}

function compareRecords(left: { id: string }, right: { id: string }): number {
  return left.id.localeCompare(right.id);
}

function compareVerifications(left: VerificationEvidence, right: VerificationEvidence): number {
  return left.completedAt.localeCompare(right.completedAt) || left.id.localeCompare(right.id);
}

function isTerminal(status: PrepareWorkRunSummary["status"]): boolean {
  return ["completed", "failed", "cancelled"].includes(status);
}
