import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import Database from "better-sqlite3";
import { describe, expect, it } from "vitest";
import { LedgerRepository } from "../src/db/ledger.js";
import { migrate } from "../src/db/migrate.js";
import {
  type AgentRun,
  type Artifact,
  type Decision,
  type Handoff,
  type OpenLoop,
  type VerificationEvidence,
  type WorkflowReadiness,
  workflowReviewPacketSchema
} from "../src/shared/schemas.js";
import {
  assembleWorkflowReviewPacket,
  type WorkflowReviewPacketInput
} from "../src/shared/workflowPacket.js";

const asOf = "2026-07-25T19:30:00.000Z";

describe("workflow review packet", () => {
  it("projects deterministic bounded portable facts without flattening provenance", () => {
    const input = packetInput();
    const packet = assembleWorkflowReviewPacket(input);
    expect(packet).toEqual(assembleWorkflowReviewPacket(input));
    expect(workflowReviewPacketSchema.parse(packet)).toEqual(packet);
    expect(packet.workflow).toEqual({
      id: "workflow-142",
      project: "runtrail",
      workKey: "github:redxzeta/runtrail#142",
      rootRunId: "run_root",
      runIds: ["run_root", "run_child", "run_continue", "run_unknown"]
    });
    expect(packet.runs.map((run) => run.freshness.state)).toEqual([
      "not_applicable",
      "fresh",
      "stale_candidate",
      "unknown"
    ]);
    expect(packet.runs[0]).toEqual(
      expect.objectContaining({
        version: 4,
        declaredAgent: {
          name: "implementation-agent",
          model: "gpt-5.6",
          origin: "client_reported",
          assurance: "asserted"
        },
        sourceRef: { type: "run", id: "run_root", version: 4 }
      })
    );
    expect(packet.effectiveDecisions[0]).toEqual(
      expect.objectContaining({
        id: "dec_current",
        sourceRefs: [
          { type: "decision", id: "dec_previous" },
          { type: "decision", id: "dec_current" }
        ]
      })
    );
    expect(packet.verifications.map(({ assurance }) => assurance)).toEqual([
      "asserted",
      "evidence_backed",
      "unknown"
    ]);
    expect(packet.handoffs.map(({ status }) => status)).toEqual([
      "pending",
      "accepted",
      "completed",
      "declined"
    ]);
    expect(packet.artifacts).toEqual([
      expect.objectContaining({ id: "art_safe", path: "reports/result.json" }),
      expect.not.objectContaining({ path: expect.anything() })
    ]);
    expect(packet.nextActions[0]).toEqual(
      expect.objectContaining({
        actionCode: "resolve_blocker",
        reasonCodes: ["unresolved_hard_blocker"],
        targetRefs: [{ type: "openLoop", id: "loop_1", version: 3 }]
      })
    );
    const serialized = JSON.stringify(packet);
    for (const excluded of [
      "private prompt",
      "private transcript",
      "private decision",
      "/Users/private"
    ]) {
      expect(serialized).not.toContain(excluded);
    }

    for (const status of [
      "in_progress",
      "blocked",
      "needs_evidence",
      "ready_for_review",
      "unknown"
    ] as const) {
      const readiness = readinessFor(status);
      expect(assembleWorkflowReviewPacket({ ...input, readiness }).readiness).toEqual(readiness);
    }

    const bounded = assembleWorkflowReviewPacket({ ...input, limit: 1 });
    expect(bounded.runs).toHaveLength(1);
    expect(bounded.handoffs).toHaveLength(1);
    expect(bounded.truncation.runs).toEqual({ limit: 1, count: 1, hasMore: true });
    expect(bounded.limitations).toContainEqual({ code: "section_truncated", section: "runs" });
    expect(bounded.readiness.status).toBe("blocked");
  });

  it("rebuilds the same packet after a SQLite restart", () => {
    const directory = mkdtempSync(path.join(tmpdir(), "runtrail-packet-"));
    const databasePath = path.join(directory, "runtrail.sqlite");
    try {
      const firstDb = new Database(databasePath);
      migrate(firstDb);
      const first = new LedgerRepository(firstDb);
      const run = first.createRun({
        source: "codex",
        project: "runtrail",
        workflowId: "workflow-restart",
        task: "Persist packet",
        status: "completed"
      }).run;
      first.createVerification({
        runId: run.id,
        checkId: "unit",
        kind: "test",
        outcome: "passed",
        name: "Unit tests",
        support: { type: "exit_code", exitCode: 0 },
        completedAt: "2026-07-25T19:29:00.000Z"
      });
      const before = first.getWorkflowReviewPacket(
        "workflow-restart",
        { project: "runtrail", limit: 20 },
        3600,
        asOf
      );
      firstDb.close();

      const secondDb = new Database(databasePath);
      const after = new LedgerRepository(secondDb).getWorkflowReviewPacket(
        "workflow-restart",
        { project: "runtrail", limit: 20 },
        3600,
        asOf
      );
      secondDb.close();
      expect(after).toEqual(before);
    } finally {
      rmSync(directory, { recursive: true, force: true });
    }
  });
});

function packetInput(): WorkflowReviewPacketInput {
  return {
    workflowId: "workflow-142",
    project: "runtrail",
    asOf,
    limit: 50,
    staleAfterSeconds: 3600,
    runs: {
      items: [
        run("run_unknown", "paused", {
          parentRunId: "run_root",
          startedAt: "2026-07-25T19:03:00.000Z"
        }),
        run("run_continue", "paused", {
          continuedFromRunId: "run_child",
          lastLivenessAt: "2026-07-25T18:00:00.000Z",
          startedAt: "2026-07-25T19:02:00.000Z"
        }),
        run("run_child", "running", {
          parentRunId: "run_root",
          lastLivenessAt: "2026-07-25T19:00:00.000Z",
          startedAt: "2026-07-25T19:01:00.000Z"
        }),
        run("run_root", "completed", {
          agentName: "implementation-agent",
          agentModel: "gpt-5.6",
          workKey: "github:redxzeta/runtrail#142",
          task: "private prompt",
          summary: "private transcript",
          version: 4
        })
      ],
      hasMore: false
    },
    effectiveDecisions: {
      items: [
        {
          id: "dec_current",
          project: "runtrail",
          supersedesDecisionId: "dec_previous",
          title: "Current direction",
          decision: "private decision",
          state: "current",
          createdAt: "2026-07-25T19:04:00.000Z"
        } satisfies Decision
      ],
      hasMore: false
    },
    verifications: {
      items: [
        verification("ver_asserted", "run_root", "passed", { type: "client_reported" }),
        verification("ver_backed", "run_child", "failed", { type: "exit_code", exitCode: 1 }),
        verification("ver_unknown", "run_continue", "not_run", {
          type: "unavailable",
          reason: "not_supported"
        })
      ],
      hasMore: false
    },
    artifacts: {
      items: [
        artifact("art_safe", "reports/result.json"),
        artifact("art_private", "/Users/private/runtrail.log")
      ],
      hasMore: false
    },
    openLoops: {
      items: [
        {
          id: "loop_1",
          type: "blocked",
          project: "runtrail",
          title: "private prompt",
          sourceRunId: "run_child",
          status: "open",
          version: 3,
          createdAt: "2026-07-25T19:05:00.000Z",
          updatedAt: "2026-07-25T19:05:00.000Z"
        } satisfies OpenLoop
      ],
      hasMore: false
    },
    handoffs: {
      items: (["pending", "accepted", "completed", "declined"] as const).map((status, index) => ({
        id: `handoff_${index}`,
        sourceRunId: "run_root",
        targetRunId: status === "pending" ? undefined : "run_child",
        fromSource: "codex",
        toSource: "openclaw",
        project: "runtrail",
        summary: "private transcript",
        status,
        version: index + 1,
        createdAt: `2026-07-25T19:0${index}:00.000Z`,
        updatedAt: `2026-07-25T19:0${index}:00.000Z`
      })) satisfies Handoff[],
      hasMore: false
    },
    readiness: readinessFor("blocked")
  };
}

function run(id: string, status: AgentRun["status"], overrides: Partial<AgentRun> = {}): AgentRun {
  return {
    id,
    source: "codex",
    project: "runtrail",
    workflowId: "workflow-142",
    task: "Safe task",
    status,
    version: 1,
    startedAt: "2026-07-25T19:00:00.000Z",
    createdAt: "2026-07-25T19:00:00.000Z",
    updatedAt: "2026-07-25T19:00:00.000Z",
    ...overrides
  };
}

function verification(
  id: string,
  runId: string,
  outcome: VerificationEvidence["outcome"],
  support: VerificationEvidence["support"]
): VerificationEvidence {
  return {
    id,
    runId,
    checkId: id,
    kind: "test",
    outcome,
    name: "Check",
    summary: "private transcript",
    support,
    completedAt: `2026-07-25T19:${id === "ver_asserted" ? "01" : id === "ver_backed" ? "02" : "03"}:00.000Z`,
    createdAt: "2026-07-25T19:00:00.000Z"
  };
}

function artifact(id: string, artifactPath: string): Artifact {
  return {
    id,
    runId: "run_root",
    kind: "report",
    path: artifactPath,
    createdAt: id === "art_safe" ? "2026-07-25T19:01:00.000Z" : "2026-07-25T19:02:00.000Z"
  };
}

function readinessFor(status: WorkflowReadiness["status"]): WorkflowReadiness {
  return {
    status,
    reasonCodes: ["unresolved_hard_blocker"],
    findings: [
      {
        reasonCode: "unresolved_hard_blocker",
        origin: "deterministic_derivation",
        assurance: "asserted",
        sourceRefs: [
          {
            type: "openLoop",
            id: "loop_1",
            version: 3,
            origin: "client_reported",
            assurance: "asserted"
          }
        ],
        caveatCodes: []
      }
    ],
    nextActions: [
      {
        actionCode: "resolve_blocker",
        targetRefs: [{ type: "openLoop", id: "loop_1", version: 3 }],
        requiresReread: true
      }
    ],
    asOf
  };
}
