import { describe, expect, it } from "vitest";
import { buildBrief, formatBrief } from "../src/cli/brief.js";
import type {
  AgentContext,
  AgentRun,
  PrepareWorkResponse,
  PrepareWorkRunSummary,
  RunFreshness
} from "../src/shared/schemas.js";

const time = "2026-10-27T12:00:00.000Z";
const earlier = "2026-10-27T11:00:00.000Z";

function run(id = "run1", version = 2): AgentRun {
  return {
    id,
    source: "codex",
    project: "runtrail",
    task: `Implement ${id}`,
    summary: "Focused change",
    status: "running",
    version,
    startedAt: earlier,
    createdAt: earlier,
    updatedAt: time,
    hostname: "private-host",
    cwd: "/home/private/work",
    gitRepoPath: "/private/repository"
  };
}

function summary(id = "run1", state: RunFreshness["state"] = "unknown"): PrepareWorkRunSummary {
  return {
    id,
    source: "codex",
    project: "runtrail",
    status: "running",
    version: 2,
    startedAt: earlier,
    updatedAt: time,
    freshness: {
      state,
      staleAfterSeconds: 300,
      asOf: time,
      reasonCode:
        state === "unknown"
          ? "no_authoritative_liveness"
          : state === "stale_candidate"
            ? "run_liveness_exceeds_window"
            : state === "fresh"
              ? "authoritative_liveness_within_window"
              : "terminal_status",
      ...(state === "fresh" || state === "stale_candidate" ? { lastLivenessAt: earlier } : {})
    }
  };
}

function fixture(): { prepared: PrepareWorkResponse; context: AgentContext } {
  const decision = {
    id: "dec1",
    title: "Use the existing contract",
    decision: "Keep transport unchanged",
    state: "current" as const,
    createdAt: time
  };
  const loop = {
    id: "loop1",
    type: "blocked" as const,
    project: "runtrail",
    title: "Need evidence",
    nextAction: "Record a check",
    status: "open" as const,
    version: 2,
    createdAt: earlier,
    updatedAt: time
  };
  const handoff = {
    id: "handoff1",
    fromSource: "codex",
    toSource: "reviewer",
    project: "runtrail",
    summary: "Review scoped changes",
    nextAction: "Inspect diff",
    status: "pending" as const,
    version: 2,
    createdAt: earlier,
    updatedAt: time
  };
  const context: AgentContext = {
    project: "runtrail",
    mode: "full",
    cursor: "opaque-private-cursor",
    recent_runs: [run()],
    failed_runs: [],
    recent_events: [
      {
        id: "event1",
        runId: "run1",
        type: "test_failed",
        message: "Focused test failed",
        importance: 5,
        createdAt: time
      },
      {
        id: "noise",
        runId: "run1",
        type: "progress",
        message: "low importance",
        importance: 1,
        createdAt: time
      }
    ],
    pending_handoffs: [handoff],
    recent_handoffs: [],
    open_loops: [loop],
    decisions: [decision],
    next_actions: ["private unrelated action"]
  };
  const meta = { limit: 20, count: 1, truncated: false };
  const prepared: PrepareWorkResponse = {
    project: "runtrail",
    mode: "full",
    cursor: "opaque-prepared-cursor",
    asOf: time,
    staleAfterSeconds: 300,
    relevantRuns: [summary()],
    workflowRuns: [],
    conflicts: [],
    pendingHandoffs: [structuredClone(handoff)],
    openLoops: [structuredClone(loop)],
    effectiveDecisions: [structuredClone(decision)],
    recommendations: [
      {
        actionCode: "resolve_blocker",
        targetRefs: [{ type: "openLoop", id: "loop1", version: 2 }],
        reasonCodes: ["blocking_open_loop"],
        requiresReread: true
      }
    ],
    warnings: [],
    readiness: {
      status: "needs_evidence",
      asOf: time,
      reasonCodes: ["required_verification_missing"],
      findings: [
        {
          reasonCode: "required_verification_missing",
          origin: "deterministic_derivation",
          assurance: "unknown",
          sourceRefs: [
            { type: "run", id: "run1", version: 2, origin: "client_reported", assurance: "unknown" }
          ],
          caveatCodes: ["verification_support_unavailable"]
        }
      ],
      nextActions: [
        {
          actionCode: "record_verification_disposition",
          targetRefs: [{ type: "run", id: "run1", version: 2 }],
          requiresReread: true
        }
      ]
    },
    sections: {
      relevantRuns: { ...meta },
      workflowRuns: { ...meta, count: 0 },
      conflicts: { ...meta, count: 0 },
      pendingHandoffs: { ...meta },
      openLoops: { ...meta },
      effectiveDecisions: { ...meta },
      recommendations: { ...meta },
      warnings: { ...meta, count: 0 }
    }
  };
  return { prepared, context };
}

describe("daily work brief", () => {
  it("shows bounded relevant work by default without inventing a selected run", () => {
    const { prepared, context } = fixture();
    prepared.relevantRuns.push(summary("failed1"));
    context.failed_runs.push({ ...run("failed1"), status: "failed" });
    context.recent_runs.push(run("unrelated"));
    const report = buildBrief(prepared, context, 20);
    expect(report.schemaVersion).toBe("1");
    expect(report.selectedRun).toBeNull();
    expect(report.relevantRuns.map(({ id, task }) => [id, task])).toEqual([
      ["run1", "Implement run1"],
      ["failed1", "Implement failed1"]
    ]);
    expect(JSON.stringify(report)).not.toContain("unrelated");
    const markdown = formatBrief(report);
    expect(markdown).toContain("## Relevant work (bounded prepare-work scope)");
    expect(markdown).toContain("Implement run1");
    expect(markdown).toContain("project-scoped, not work-key-scoped");
    expect(markdown).toContain("no selected run supplied");
    expect(markdown).toContain("2026\\-10\\-27T12\\:00\\:00\\.000Z");
  });

  it("projects prepared IDs with context text, times, provenance and actionable targets", () => {
    const { prepared, context } = fixture();
    prepared.selectedRun = summary();
    context.decisions.push({
      ...context.decisions[0],
      id: "unprepared",
      decision: "Do not show me"
    });
    const report = buildBrief(prepared, context, 20);
    expect(report.selectedRun).toMatchObject({
      id: "run1",
      task: "Implement run1",
      summary: "Focused change",
      detailStatus: "matched",
      evidenceApplicability: "unknown"
    });
    expect(report.effectiveDecisions).toEqual([
      expect.objectContaining({ id: "dec1", decision: "Keep transport unchanged", createdAt: time })
    ]);
    expect(report.blockers[0]).toMatchObject({
      title: "Need evidence",
      nextAction: "Record a check",
      updatedAt: time
    });
    expect(report.pendingHandoffs[0]).toMatchObject({
      summary: "Review scoped changes",
      nextAction: "Inspect diff",
      updatedAt: time
    });
    expect(report.recommendations[0]).toMatchObject({
      asOf: time,
      targetRefs: [{ type: "openLoop", id: "loop1", version: 2 }]
    });
    const markdown = formatBrief(report);
    for (const expected of [
      "dec1",
      "loop1 v2",
      "handoff1 v2",
      "Need evidence",
      "Inspect diff",
      "assurance unknown",
      "origin client\\_reported",
      "required\\_verification\\_missing",
      "record\\_verification\\_disposition",
      "reread required: yes"
    ])
      expect(markdown).toContain(expected);
    expect(markdown).not.toContain("Do not show me");
  });

  it.each(["fresh", "stale_candidate", "unknown", "not_applicable"] as const)(
    "preserves %s freshness and unknown applicability even for completed work",
    (state) => {
      const { prepared, context } = fixture();
      prepared.selectedRun = { ...summary("run1", state), status: "completed" };
      const report = buildBrief(prepared, context, 20);
      expect(report.selectedRun?.freshness).toEqual({
        ...prepared.selectedRun.freshness,
        lastLivenessAt: prepared.selectedRun.freshness.lastLivenessAt ?? null
      });
      expect(report.selectedRun?.evidenceApplicability).toBe("unknown");
      expect(formatBrief(report)).toContain("does not establish verification");
      expect(formatBrief(report)).toContain("current applicability: unknown");
    }
  );

  it("marks missing and newer context honestly, including default relevant-work version mismatches", () => {
    const { prepared, context } = fixture();
    prepared.selectedRun = summary("missing");
    context.recent_runs[0].version = 3;
    context.open_loops[0].version = 3;
    context.pending_handoffs = [];
    context.decisions = [];
    const report = buildBrief(prepared, context, 20);
    expect(report.selectedRun).toMatchObject({ task: null, detailStatus: "missing" });
    expect(report.relevantRuns[0]).toMatchObject({
      task: null,
      summary: null,
      detailStatus: "version_mismatch"
    });
    expect(report.blockers[0]).toMatchObject({ title: null, detailStatus: "version_mismatch" });
    expect(report.pendingHandoffs[0]).toMatchObject({ summary: null, detailStatus: "missing" });
    expect(report.effectiveDecisions[0]).toMatchObject({
      title: "Use the existing contract",
      decision: null,
      detailStatus: "missing"
    });
    expect(formatBrief(report)).toContain("decision text missing from context");
  });

  it("ignores context from another project and handles incremental or absent evidence without claiming idle", () => {
    const { prepared, context } = fixture();
    context.project = "elsewhere";
    context.mode = "incremental";
    prepared.readiness = undefined;
    const report = buildBrief(prepared, context, 1);
    expect(report.relevantRuns[0].task).toBeNull();
    expect(report.recentEvents).toEqual([]);
    expect(report.readiness).toMatchObject({ status: "unknown", asOf: null, findings: [] });
    expect(report.coverage).toMatchObject({
      atomic: false,
      context: { scope: "project", coverage: "unknown", projectMatches: false, mode: "incremental" }
    });
    const markdown = formatBrief(report);
    expect(markdown).toContain("not an atomic snapshot");
    expect(markdown).toContain("not proof of idle work");
    expect(markdown).toContain("coverage incomplete");
  });

  it("bounds every section, nested refs and text, distinguishing upstream and local truncation", () => {
    const { prepared, context } = fixture();
    prepared.relevantRuns = Array.from({ length: 25 }, (_, index) => summary(`run${index}`));
    prepared.openLoops = Array.from({ length: 25 }, (_, index) => ({
      ...prepared.openLoops[0],
      id: `loop${index}`
    }));
    prepared.sections.relevantRuns.truncated = true;
    prepared.recommendations[0].targetRefs.push({ type: "run", id: "run1", version: 2 });
    context.recent_runs[0].task = "x".repeat(5000);
    const report = buildBrief(prepared, context, 1);
    expect(report.relevantRuns).toHaveLength(1);
    expect(report.blockers).toHaveLength(1);
    expect(report.coverage.projection.relevantRuns).toEqual({
      available: 25,
      returned: 1,
      omitted: 24,
      sourceTruncated: true
    });
    expect(report.coverage.projection.blockers.sourceTruncated).toBe(false);
    expect(report.coverage.projection.recentEvents.sourceTruncated).toBeNull();
    expect(report.coverage.projection["recommendations.0.targetRefs"].omitted).toBe(1);
    prepared.relevantRuns[0] = summary();
    const clipped = buildBrief(prepared, context, 1);
    expect(clipped.relevantRuns[0].task).toHaveLength(320);
    expect(clipped.relevantRuns[0].task).toContain("[clipped]");
    expect(clipped.textClipped).toBe(true);
    expect(formatBrief(clipped)).toContain("omitted 24");
    expect(JSON.stringify(clipped).length).toBeLessThan(12000);
  });

  it("keeps low importance exceptional events, orders events by time, and omits raw command messages", () => {
    const { prepared, context } = fixture();
    context.recent_events.push(
      {
        id: "failure",
        runId: "anotherwork",
        type: "failed",
        message: "Failure",
        importance: 0,
        createdAt: earlier
      },
      {
        id: "cmd",
        runId: "run1",
        type: "command_executed",
        message: "private-argv --token secret",
        importance: 7,
        createdAt: time
      }
    );
    const report = buildBrief(prepared, context, 20);
    expect(report.recentEvents.map(({ id }) => id)).toEqual(["cmd", "event1", "failure"]);
    expect(report.recentEvents[0].message).toBe("Command details omitted (privacy)");
    expect(JSON.stringify(report)).not.toContain("private-argv");
    expect(report.recentEvents[2].runId).toBe("anotherwork");
  });

  it("omits private fields and control characters, redacts machine paths, and cannot forge Markdown structure", () => {
    const { prepared, context } = fixture();
    const hostile = `\n# Forged\r\n[click](javascript:alert(1)) <script>bad</script> ${String.fromCharCode(27)}[31m\u202e`;
    context.recent_runs[0].task = `${hostile} /home/private/task C:\\private\\file /secret`;
    context.pending_handoffs[0].summary = hostile;
    context.decisions[0].decision = hostile;
    context.recent_events[0].message = hostile;
    Object.assign(context.pending_handoffs[0], { context: { transcript: "private-transcript" } });
    const before = structuredClone({ prepared, context });
    const report = buildBrief(prepared, context, 20);
    expect({ prepared, context }).toEqual(before);
    const serialized = JSON.stringify(report);
    const markdown = formatBrief(report);
    for (const privateValue of [
      "private-host",
      "/home/private",
      "private/repository",
      "private-transcript",
      "opaque-private-cursor",
      "opaque-prepared-cursor",
      "C:\\private",
      "/secret",
      "private unrelated action"
    ]) {
      expect(serialized).not.toContain(privateValue);
      expect(markdown).not.toContain(privateValue);
    }
    expect(markdown).not.toContain("\n# Forged");
    expect(markdown).not.toContain("[click](javascript:");
    expect(markdown).not.toContain("<script>");
    expect(markdown).toContain("&lt;script&gt;");
    expect(markdown).toContain("\\# Forged");
    expect(markdown).not.toContain(String.fromCharCode(27));
    expect(markdown).not.toContain("\u202e");
  });

  it("preserves 255-character stable IDs and marks unsafe IDs unavailable without rewriting them", () => {
    const { prepared, context } = fixture();
    const legalId = "r".repeat(255);
    prepared.selectedRun = summary(legalId);
    context.recent_runs = [run(legalId)];
    const report = buildBrief(prepared, context, 20);
    expect(report.selectedRun?.id).toBe(legalId);
    expect(report.selectedRun?.sourceRef.id).toBe(legalId);
    expect(report.unsafeSourceIdsOmitted).toBe(false);
    expect(formatBrief(report)).toContain(legalId);
    prepared.selectedRun = summary("/home/private/source");
    const unsafe = buildBrief(prepared, context, 20);
    expect(unsafe.selectedRun?.id).toBe("unavailable (unsafe source ID)");
    expect(unsafe.unsafeSourceIdsOmitted).toBe(true);
    expect(JSON.stringify(unsafe)).not.toContain("/home/private/source");
    expect(unsafe.selectedRun?.id).not.toBe("[path omitted]");
  });

  it.each([0, -1, 21, 1.5, Number.NaN, Number.POSITIVE_INFINITY])(
    "rejects invalid limit %s",
    (limit) => {
      const { prepared, context } = fixture();
      expect(() => buildBrief(prepared, context, limit)).toThrow("integer from 1 to 20");
    }
  );
});
