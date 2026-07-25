import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import Database from "better-sqlite3";
import { describe, expect, it } from "vitest";
import { LedgerRepository } from "../src/db/ledger.js";
import { migrate } from "../src/db/migrate.js";
import { evaluateWorkflowReadiness, type WorkflowReadinessInput } from "../src/shared/readiness.js";
import {
  type Decision,
  type Handoff,
  type OpenLoop,
  type PrepareWorkRunSummary,
  type VerificationEvidence,
  workflowReadinessSchema
} from "../src/shared/schemas.js";

const asOf = "2026-07-25T19:00:00.000Z";

describe("workflow readiness", () => {
  it("applies every rule in fixed precedence with bounded deterministic provenance", () => {
    const failed = verification("failed", {
      id: "ver_failed",
      completedAt: "2026-07-25T18:01:00.000Z"
    });
    const cases: Array<{
      name: string;
      input: WorkflowReadinessInput;
      status: string;
      reason: string;
      assurance?: string;
    }> = [
      {
        name: "incomplete relationships outrank blockers",
        input: state({
          workflowId: undefined,
          openLoops: [openLoop("blocked")],
          handoffs: [handoff()],
          verifications: [failed]
        }),
        status: "unknown",
        reason: "workflow_relationships_incomplete"
      },
      {
        name: "truncated inputs are not classified",
        input: state({ inputsTruncated: true }),
        status: "unknown",
        reason: "workflow_inputs_truncated",
        assurance: "unknown"
      },
      {
        name: "hard blockers outrank incomplete handoffs and include decision lineage",
        input: state({
          openLoops: [openLoop("decision_required")],
          handoffs: [handoff()],
          effectiveDecisions: [decision()],
          verifications: [failed]
        }),
        status: "blocked",
        reason: "unresolved_hard_blocker",
        assurance: "mixed"
      },
      {
        name: "incomplete handoffs outrank fresh runs",
        input: state({
          runs: [run({ status: "running", freshness: freshness("fresh") })],
          handoffs: [handoff()],
          verifications: [failed]
        }),
        status: "in_progress",
        reason: "handoff_incomplete",
        assurance: "evidence_backed"
      },
      {
        name: "fresh runs outrank failed verification",
        input: state({
          runs: [run({ status: "running", freshness: freshness("fresh") })],
          verifications: [failed]
        }),
        status: "in_progress",
        reason: "fresh_related_run_active"
      },
      {
        name: "stale candidates require inspection",
        input: state({
          runs: [run({ status: "running", freshness: freshness("stale_candidate") })],
          verifications: [failed]
        }),
        status: "unknown",
        reason: "stale_related_run_requires_inspection",
        assurance: "unknown"
      },
      {
        name: "unknown freshness requires reread",
        input: state({
          runs: [run({ status: "running", freshness: freshness("unknown") })],
          verifications: [failed]
        }),
        status: "unknown",
        reason: "related_run_freshness_unknown",
        assurance: "unknown"
      },
      {
        name: "failed verification outranks not run",
        input: state({
          verifications: [failed, verification("not_run", { checkId: "smoke" })]
        }),
        status: "needs_evidence",
        reason: "verification_failed",
        assurance: "asserted"
      },
      {
        name: "not run outranks missing dispositions",
        input: state({
          runs: [run(), run({ id: "run_2", startedAt: "2026-07-25T18:01:00.000Z" })],
          verifications: [verification("not_run")]
        }),
        status: "needs_evidence",
        reason: "required_verification_not_run",
        assurance: "unknown"
      },
      {
        name: "missing dispositions require evidence",
        input: state(),
        status: "needs_evidence",
        reason: "required_verification_missing",
        assurance: "unknown"
      },
      {
        name: "client-reported pass is ready but asserted",
        input: state({ verifications: [verification("passed")] }),
        status: "ready_for_review",
        reason: "workflow_ready_for_review",
        assurance: "asserted"
      },
      {
        name: "newer supported pass supersedes an older failed check",
        input: state({
          verifications: [
            failed,
            verification("passed", {
              id: "ver_passed",
              completedAt: "2026-07-25T18:02:00.000Z",
              support: { type: "exit_code", exitCode: 0 }
            })
          ]
        }),
        status: "ready_for_review",
        reason: "workflow_ready_for_review",
        assurance: "mixed"
      },
      {
        name: "legacy terminal state stays unknown",
        input: state({ runs: [run({ status: "cancelled" })] }),
        status: "unknown",
        reason: "legacy_workflow_unclassified",
        assurance: "unknown"
      }
    ];

    for (const testCase of cases) {
      const first = evaluateWorkflowReadiness(testCase.input);
      const second = evaluateWorkflowReadiness(testCase.input);
      expect(first, testCase.name).toEqual(second);
      expect(workflowReadinessSchema.parse(first).status, testCase.name).toBe(testCase.status);
      expect(first.reasonCodes[0], testCase.name).toBe(testCase.reason);
      if (testCase.assurance) {
        expect(first.findings[0]?.assurance, testCase.name).toBe(testCase.assurance);
      }
      if (testCase.status !== "ready_for_review") {
        expect(first.nextActions.length, testCase.name).toBeGreaterThan(0);
      }
    }

    const decisionCase = cases.find((item) => item.name.startsWith("hard blockers"));
    if (!decisionCase) throw new Error("Missing decision precedence case");
    const decisionFinding = evaluateWorkflowReadiness(decisionCase.input).findings[0];
    if (!decisionFinding) throw new Error("Missing decision finding");
    expect(decisionFinding.sourceRefs.map(({ id }) => id)).toEqual([
      "dec_current",
      "dec_previous",
      "loop_1"
    ]);
    expect(decisionFinding.sourceRefs).not.toContainEqual(
      expect.objectContaining({ id: "dec_previous", version: expect.anything() })
    );

    const manyRuns = Array.from({ length: 25 }, (_, index) =>
      run({
        id: `run_${String(index).padStart(2, "0")}`,
        version: index + 1,
        startedAt: `2026-07-25T18:${String(index).padStart(2, "0")}:00.000Z`
      })
    );
    const boundedMissing = evaluateWorkflowReadiness(state({ runs: manyRuns }));
    expect(boundedMissing.findings).toHaveLength(20);
    expect(boundedMissing.nextActions).toHaveLength(20);
    expect(boundedMissing.findings[19]?.sourceRefs[0]).toEqual(
      expect.objectContaining({ id: "run_19", version: 20 })
    );

    const boundedReady = evaluateWorkflowReadiness(
      state({
        runs: manyRuns,
        verifications: manyRuns.map((item, index) =>
          verification("passed", {
            id: `ver_${String(index).padStart(2, "0")}`,
            runId: item.id,
            checkId: "unit"
          })
        )
      })
    );
    const boundedRefs = boundedReady.findings[0]?.sourceRefs ?? [];
    expect(boundedRefs).toHaveLength(20);
    expect(boundedRefs.map(({ id }) => id)).toEqual([...boundedRefs.map(({ id }) => id)].sort());
  });

  it("recomputes the same readiness from persisted records after restart", () => {
    const directory = mkdtempSync(path.join(tmpdir(), "runtrail-readiness-"));
    const databasePath = path.join(directory, "runtrail.sqlite");
    try {
      const firstDb = new Database(databasePath);
      migrate(firstDb);
      const first = new LedgerRepository(firstDb);
      const created = first.createRun({
        source: "codex",
        project: "runtrail",
        workflowId: "workflow-restart",
        task: "Persist readiness",
        status: "running"
      }).run;
      first.updateRun(created.id, { status: "completed", expectedVersion: created.version });
      first.createVerification({
        runId: created.id,
        checkId: "unit",
        kind: "test",
        outcome: "passed",
        name: "Unit tests",
        support: { type: "exit_code", exitCode: 0 },
        completedAt: "2026-07-25T18:00:00.000Z"
      });
      const before = first.getWorkflowReadiness("workflow-restart", "runtrail", 3600, asOf);
      firstDb.close();

      const secondDb = new Database(databasePath);
      const after = new LedgerRepository(secondDb).getWorkflowReadiness(
        "workflow-restart",
        "runtrail",
        3600,
        asOf
      );
      secondDb.close();

      expect(after).toEqual(before);
      expect(after?.status).toBe("ready_for_review");
    } finally {
      rmSync(directory, { recursive: true, force: true });
    }
  });
});

function state(overrides: Partial<WorkflowReadinessInput> = {}): WorkflowReadinessInput {
  return {
    workflowId: "workflow-140",
    asOf,
    runs: [run()],
    openLoops: [],
    handoffs: [],
    effectiveDecisions: [],
    verifications: [],
    inputsTruncated: false,
    ...overrides
  };
}

function run(overrides: Partial<PrepareWorkRunSummary> = {}): PrepareWorkRunSummary {
  return {
    id: "run_1",
    source: "codex",
    project: "runtrail",
    workflowId: "workflow-140",
    status: "completed",
    version: 4,
    startedAt: "2026-07-25T18:00:00.000Z",
    updatedAt: "2026-07-25T18:00:00.000Z",
    freshness: freshness("not_applicable"),
    ...overrides
  };
}

function freshness(
  state: PrepareWorkRunSummary["freshness"]["state"]
): PrepareWorkRunSummary["freshness"] {
  return {
    state,
    staleAfterSeconds: 3600,
    asOf,
    reasonCode:
      state === "fresh"
        ? "authoritative_liveness_within_window"
        : state === "stale_candidate"
          ? "run_liveness_exceeds_window"
          : state === "unknown"
            ? "no_authoritative_liveness"
            : "terminal_status"
  };
}

function verification(
  outcome: VerificationEvidence["outcome"],
  overrides: Partial<VerificationEvidence> = {}
): VerificationEvidence {
  return {
    id: `ver_${outcome}`,
    runId: "run_1",
    checkId: "unit",
    kind: "test",
    outcome,
    name: "Unit tests",
    support:
      outcome === "not_run"
        ? { type: "unavailable", reason: "not_supported" }
        : { type: "client_reported" },
    completedAt: "2026-07-25T18:00:00.000Z",
    createdAt: "2026-07-25T18:00:00.000Z",
    ...overrides
  };
}

function openLoop(type: OpenLoop["type"]): OpenLoop {
  return {
    id: "loop_1",
    type,
    project: "runtrail",
    title: "Blocked",
    sourceRunId: "run_1",
    status: "open",
    version: 3,
    createdAt: "2026-07-25T18:00:00.000Z",
    updatedAt: "2026-07-25T18:00:00.000Z"
  };
}

function handoff(): Handoff {
  return {
    id: "handoff_1",
    sourceRunId: "run_1",
    fromSource: "codex",
    project: "runtrail",
    summary: "Continue",
    status: "pending",
    version: 2,
    createdAt: "2026-07-25T18:00:00.000Z",
    updatedAt: "2026-07-25T18:00:00.000Z"
  };
}

function decision(): Decision {
  return {
    id: "dec_current",
    project: "runtrail",
    supersedesDecisionId: "dec_previous",
    title: "Current direction",
    decision: "Use the current contract",
    state: "current",
    createdAt: "2026-07-25T18:00:00.000Z"
  };
}
