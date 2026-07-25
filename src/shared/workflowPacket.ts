import { classifyRunFreshness } from "./freshness.js";
import { verificationAssurance } from "./readiness.js";
import type {
  AgentRun,
  Artifact,
  Decision,
  Handoff,
  OpenLoop,
  VerificationEvidence,
  WorkflowReadiness,
  WorkflowReviewPacket
} from "./schemas.js";

export const WORKFLOW_PACKET_SCHEMA_VERSION = "1";

type PacketSection =
  | "runs"
  | "effectiveDecisions"
  | "verifications"
  | "artifacts"
  | "openLoops"
  | "handoffs";

export type BoundedPacketSection<T> = {
  items: T[];
  hasMore: boolean;
};

export type WorkflowReviewPacketInput = {
  workflowId: string;
  project: string;
  asOf: string;
  limit: number;
  staleAfterSeconds: number;
  runs: BoundedPacketSection<AgentRun>;
  effectiveDecisions: BoundedPacketSection<Decision>;
  verifications: BoundedPacketSection<VerificationEvidence>;
  artifacts: BoundedPacketSection<Artifact>;
  openLoops: BoundedPacketSection<OpenLoop>;
  handoffs: BoundedPacketSection<Handoff>;
  readiness: WorkflowReadiness;
};

export function assembleWorkflowReviewPacket(
  input: WorkflowReviewPacketInput
): WorkflowReviewPacket {
  const runs = [...input.runs.items]
    .sort(compareStarted)
    .slice(0, input.limit)
    .map((run) => ({
      id: run.id,
      source: run.source,
      workKey: run.workKey,
      workflowId: input.workflowId,
      parentRunId: run.parentRunId,
      continuedFromRunId: run.continuedFromRunId,
      status: run.status,
      version: run.version,
      startedAt: run.startedAt,
      updatedAt: run.updatedAt,
      freshness: classifyRunFreshness(run, input.asOf, input.staleAfterSeconds),
      declaredAgent:
        run.agentName || run.agentModel
          ? {
              name: run.agentName,
              model: run.agentModel,
              origin: "client_reported" as const,
              assurance: "asserted" as const
            }
          : undefined,
      sourceRef: { type: "run" as const, id: run.id, version: run.version }
    }));
  const runIds = new Set(runs.map(({ id }) => id));
  const unsafeArtifactPath = input.artifacts.items.some(
    (artifact) => !isSafeArtifactPath(artifact.path)
  );
  const limitations: WorkflowReviewPacket["limitations"] = [];
  if (runs.some((run) => run.declaredAgent)) {
    limitations.push({ code: "agent_identity_client_asserted" });
  }
  if (input.verifications.items.length > 0) {
    limitations.push({ code: "verification_client_asserted" });
  }
  const verificationAssurances = new Set(input.verifications.items.map(verificationAssurance));
  if (
    verificationAssurances.size > 1 ||
    input.readiness.findings.some((finding) => finding.assurance === "mixed")
  ) {
    limitations.push({ code: "verification_assurance_mixed" });
  }
  if (
    runs.some(
      (run) =>
        (run.parentRunId && !runIds.has(run.parentRunId)) ||
        (run.continuedFromRunId && !runIds.has(run.continuedFromRunId))
    )
  ) {
    limitations.push({ code: "workflow_relationship_incomplete" });
  }
  if (runs.some((run) => run.freshness.state === "unknown")) {
    limitations.push({ code: "run_freshness_unknown" });
  }
  if (runs.length === 0) {
    limitations.push({ code: "legacy_record_incomplete" });
  }
  if (unsafeArtifactPath) {
    limitations.push({ code: "unsafe_artifact_path_omitted", section: "artifacts" });
  }

  const sections: PacketSection[] = [
    "runs",
    "effectiveDecisions",
    "verifications",
    "artifacts",
    "openLoops",
    "handoffs"
  ];
  const truncation = Object.fromEntries(
    sections.map((section) => {
      const value = input[section];
      const hasMore = value.hasMore || value.items.length > input.limit;
      if (hasMore) limitations.push({ code: "section_truncated", section });
      return [
        section,
        { limit: input.limit, count: Math.min(value.items.length, input.limit), hasMore }
      ];
    })
  ) as WorkflowReviewPacket["truncation"];
  const root = runs.find((run) => !run.parentRunId && !run.continuedFromRunId) ?? runs[0];
  if (!root) throw new Error("Workflow review packet requires at least one run");

  return {
    schemaVersion: WORKFLOW_PACKET_SCHEMA_VERSION,
    asOf: input.asOf,
    workflow: {
      id: input.workflowId,
      project: input.project,
      workKey: root.workKey ?? runs.find((run) => run.workKey)?.workKey,
      rootRunId: root.id,
      runIds: runs.map(({ id }) => id)
    },
    runs,
    effectiveDecisions: [...input.effectiveDecisions.items]
      .sort(compareCreated)
      .slice(0, input.limit)
      .map((decision) => ({
        id: decision.id,
        project: decision.project,
        title: decision.title,
        supersedesDecisionId: decision.supersedesDecisionId,
        origin: "deterministic_derivation",
        assurance: "evidence_backed",
        sourceRefs: [
          ...(decision.supersedesDecisionId
            ? [{ type: "decision" as const, id: decision.supersedesDecisionId }]
            : []),
          { type: "decision" as const, id: decision.id }
        ]
      })),
    verifications: [...input.verifications.items]
      .sort(compareCompleted)
      .slice(0, input.limit)
      .map((verification) => ({
        id: verification.id,
        runId: verification.runId,
        checkId: verification.checkId,
        kind: verification.kind,
        outcome: verification.outcome,
        name: verification.name,
        support: verification.support,
        completedAt: verification.completedAt,
        origin: "client_reported",
        assurance: verificationAssurance(verification),
        sourceRef: { type: "verification", id: verification.id }
      })),
    artifacts: [...input.artifacts.items]
      .sort(compareCreated)
      .slice(0, input.limit)
      .map((artifact) => ({
        id: artifact.id,
        runId: artifact.runId,
        kind: artifact.kind,
        path: isSafeArtifactPath(artifact.path) ? artifact.path : undefined,
        sizeBytes: artifact.sizeBytes,
        sha256: artifact.sha256,
        sourceRef: { type: "artifact", id: artifact.id }
      })),
    openLoops: [...input.openLoops.items]
      .sort(compareUpdated)
      .slice(0, input.limit)
      .map((loop) => ({
        id: loop.id,
        type: loop.type,
        sourceRunId: loop.sourceRunId,
        status: "open",
        version: loop.version,
        sourceRef: { type: "openLoop", id: loop.id, version: loop.version }
      })),
    handoffs: [...input.handoffs.items]
      .sort(compareUpdated)
      .slice(0, input.limit)
      .map((handoff) => ({
        id: handoff.id,
        sourceRunId: handoff.sourceRunId,
        targetRunId: handoff.targetRunId,
        fromSource: handoff.fromSource,
        toSource: handoff.toSource,
        status: handoff.status,
        version: handoff.version,
        sourceRef: { type: "handoff", id: handoff.id, version: handoff.version }
      })),
    readiness: input.readiness,
    nextActions: input.readiness.nextActions.map((action) => ({
      ...action,
      reasonCodes: input.readiness.reasonCodes
    })),
    limitations: uniqueLimitations(limitations),
    truncation
  };
}

function isSafeArtifactPath(value: string): boolean {
  if (!value || value.startsWith("/") || value.startsWith("\\") || /^[a-zA-Z]:[\\/]/.test(value)) {
    return false;
  }
  return !value.split(/[\\/]/).includes("..");
}

function uniqueLimitations(
  items: WorkflowReviewPacket["limitations"]
): WorkflowReviewPacket["limitations"] {
  const unique = new Map(items.map((item) => [`${item.code}\0${item.section ?? ""}`, item]));
  return [...unique.values()].sort(
    (left, right) =>
      left.code.localeCompare(right.code) || (left.section ?? "").localeCompare(right.section ?? "")
  );
}

function compareStarted(left: AgentRun, right: AgentRun): number {
  return left.startedAt.localeCompare(right.startedAt) || left.id.localeCompare(right.id);
}

function compareCreated(
  left: { createdAt: string; id: string },
  right: { createdAt: string; id: string }
): number {
  return left.createdAt.localeCompare(right.createdAt) || left.id.localeCompare(right.id);
}

function compareCompleted(left: VerificationEvidence, right: VerificationEvidence): number {
  return left.completedAt.localeCompare(right.completedAt) || left.id.localeCompare(right.id);
}

function compareUpdated(
  left: { updatedAt: string; id: string },
  right: { updatedAt: string; id: string }
): number {
  return left.updatedAt.localeCompare(right.updatedAt) || left.id.localeCompare(right.id);
}
