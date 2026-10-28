import { describe, expect, it } from "vitest";
import { formatReviewReport } from "../src/cli/reviewReport.js";
import type { VerificationSupport, WorkflowReviewPacket } from "../src/shared/schemas.js";

const time = "2026-10-27T12:00:00.000Z";
const escapedTime = "2026\\-10\\-27T12\\:00\\:00\\.000Z";

function fixture(): WorkflowReviewPacket {
  const section = { count: 1, limit: 20, hasMore: false };
  return {
    schemaVersion: "1",
    asOf: time,
    workflow: {
      id: "workflow1",
      project: "runtrail",
      workKey: "issue207",
      rootRunId: "run1",
      runIds: ["run1"]
    },
    runs: [
      {
        id: "run1",
        source: "codex",
        workflowId: "workflow1",
        status: "completed",
        version: 2,
        startedAt: time,
        updatedAt: time,
        gitCommit: "abcdef1234",
        gitBranch: "feature207",
        freshness: {
          state: "not_applicable",
          asOf: time,
          staleAfterSeconds: 300,
          reasonCode: "terminal_status"
        },
        declaredAgent: {
          name: "implementer",
          model: "example-model",
          origin: "client_reported",
          assurance: "asserted"
        },
        sourceRef: { type: "run", id: "run1", version: 2 }
      }
    ],
    effectiveDecisions: [
      {
        id: "dec1",
        title: "Use existing contracts",
        supersedesDecisionId: "dec0",
        origin: "deterministic_derivation",
        assurance: "evidence_backed",
        sourceRefs: [
          { type: "decision", id: "dec0" },
          { type: "decision", id: "dec1" }
        ]
      }
    ],
    verifications: [
      {
        id: "ver1",
        runId: "run1",
        checkId: "lint",
        name: "Lint",
        kind: "lint",
        outcome: "passed",
        support: { type: "exit_code", exitCode: 0 },
        completedAt: time,
        applicability: "unknown",
        origin: "client_reported",
        assurance: "evidence_backed",
        sourceRef: { type: "verification", id: "ver1" }
      }
    ],
    artifacts: [
      {
        id: "art1",
        runId: "run1",
        kind: "report",
        sha256: "a".repeat(64),
        sizeBytes: 30,
        path: "reports/result.json",
        sourceRef: { type: "artifact", id: "art1" }
      }
    ],
    openLoops: [
      {
        id: "loop1",
        sourceRunId: "run1",
        type: "blocked",
        status: "open",
        version: 3,
        sourceRef: { type: "openLoop", id: "loop1", version: 3 }
      }
    ],
    handoffs: [
      {
        id: "handoff1",
        sourceRunId: "run1",
        targetRunId: "run2",
        fromSource: "codex",
        toSource: "reviewer",
        status: "pending",
        version: 2,
        sourceRef: { type: "handoff", id: "handoff1", version: 2 }
      }
    ],
    readiness: {
      status: "needs_evidence",
      asOf: time,
      reasonCodes: ["required_verification_missing"],
      findings: [
        {
          reasonCode: "required_verification_missing",
          origin: "deterministic_derivation",
          assurance: "mixed",
          sourceRefs: [
            {
              type: "verification",
              id: "ver1",
              origin: "client_reported",
              assurance: "evidence_backed"
            }
          ],
          caveatCodes: ["verification_client_reported"]
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
    nextActions: [
      {
        actionCode: "record_verification_disposition",
        targetRefs: [{ type: "run", id: "run1", version: 2 }],
        reasonCodes: ["required_verification_missing"],
        requiresReread: true
      }
    ],
    limitations: [
      { code: "verification_assurance_mixed" },
      { code: "section_truncated", section: "runs" }
    ],
    truncation: {
      runs: { ...section, hasMore: true },
      effectiveDecisions: { ...section },
      verifications: { ...section },
      artifacts: { ...section },
      openLoops: { ...section },
      handoffs: { ...section }
    }
  };
}

describe("workflow review Markdown", () => {
  it("renders packet evidence, references, time, changed code, provenance, actions and truncation", () => {
    const packet = fixture();
    const before = structuredClone(packet);
    const report = formatReviewReport(packet);
    expect(packet).toEqual(before);
    for (const expected of [
      "Schema 1",
      escapedTime,
      "workflow1",
      "run1 v2",
      "status completed",
      "commit abcdef1234",
      "branch feature207",
      "[manifest](/runs/run1/manifest)",
      "check lint / Lint",
      "outcome passed",
      "exit_code 0",
      "ver1",
      "dec0",
      "dec1",
      "type blocked",
      "status open",
      "loop1 v3",
      "handoff1 v2",
      "status pending",
      "a".repeat(64),
      "Hash reference only",
      "origin client\\_reported",
      "assurance evidence\\_backed",
      "assurance mixed",
      "record\\_verification\\_disposition",
      "required\\_verification\\_missing",
      "reread required: yes",
      "has more: yes (truncated)",
      "section\\_truncated; section runs",
      "current applicability unknown",
      "Completed run status does not establish verification"
    ])
      expect(report).toContain(expected);
    expect(report).not.toContain("reports/result.json");
  });

  it.each(["passed", "failed", "not_run", "not_applicable"] as const)(
    "keeps %s outcome and unknown applicability distinct",
    (outcome) => {
      const packet = fixture();
      packet.verifications[0].outcome = outcome;
      packet.verifications[0].support = { type: "client_reported" };
      const report = formatReviewReport(packet);
      expect(report).toContain(`outcome ${outcome.replaceAll("_", "\\_")}`);
      expect(report).toContain("current applicability unknown");
      if (outcome === "failed") expect(report).toContain("Failure recorded");
      if (outcome === "not_run") expect(report).toContain("Missing execution evidence");
      if (outcome === "not_applicable") expect(report).toContain("recorded disposition");
    }
  );

  it.each([
    [{ type: "client_reported" }, "client_reported (assertion)"],
    [{ type: "exit_code", exitCode: 7 }, "exit_code 7"],
    [{ type: "receipt", receiptId: "receipt1" }, "receipt reference receipt1"],
    [
      { type: "artifact_digest", artifactId: "art1", sha256: "b".repeat(64) },
      `SHA-256 reference ${"b".repeat(64)}`
    ],
    [{ type: "unavailable", reason: "not_supported" }, "unavailable (not\\_supported)"]
  ] satisfies Array<[VerificationSupport, string]>)(
    "renders support %j without upgrading it to proof",
    (support, expected) => {
      const packet = fixture();
      packet.verifications[0].support = support;
      expect(formatReviewReport(packet)).toContain(expected);
      expect(formatReviewReport(packet)).toContain(
        "Current applicability: unknown for all evidence"
      );
      expect(formatReviewReport(packet)).toContain("never proof");
    }
  );

  it.each(["in_progress", "blocked", "needs_evidence", "ready_for_review", "unknown"] as const)(
    "preserves advisory readiness %s and its provenance",
    (status) => {
      const packet = fixture();
      packet.readiness.status = status;
      expect(formatReviewReport(packet)).toContain(
        `Advisory status: ${status.replaceAll("_", "\\_")}`
      );
      expect(formatReviewReport(packet)).toContain("grants no approval or deployment authority");
    }
  );

  it.each(["fresh", "stale_candidate", "unknown", "not_applicable"] as const)(
    "preserves run freshness %s without inferring liveness from status",
    (state) => {
      const packet = fixture();
      packet.runs[0].freshness.state = state;
      packet.runs[0].freshness.reasonCode = "no_authoritative_liveness";
      expect(formatReviewReport(packet)).toContain(`Freshness ${state.replaceAll("_", "\\_")}`);
      expect(formatReviewReport(packet)).toContain("last liveness unknown");
    }
  );

  it("makes legacy changed code and missing evidence explicit rather than manufacturing proof", () => {
    const packet = fixture();
    delete packet.runs[0].gitCommit;
    delete packet.runs[0].gitBranch;
    delete packet.runs[0].declaredAgent;
    packet.verifications = [];
    packet.artifacts = [];
    packet.effectiveDecisions = [];
    packet.openLoops = [];
    packet.handoffs = [];
    packet.readiness.findings = [];
    packet.readiness.reasonCodes = [];
    packet.nextActions = [];
    const report = formatReviewReport(packet);
    for (const expected of [
      "commit unknown; branch unknown",
      "No verification evidence supplied",
      "required checks and their outcomes are unknown",
      "No artifact references supplied",
      "No readiness findings supplied",
      "does not prove absence of blockers",
      "No actions supplied"
    ]) {
      expect(report).toContain(expected);
    }
    expect(report).toContain("Agent identity, origin and assurance: unknown");
    packet.runs = [];
    expect(formatReviewReport(packet)).toContain("No runs supplied");
  });

  it("renders all handoff dispositions without additional private detail", () => {
    const packet = fixture();
    packet.handoffs = (["pending", "accepted", "completed", "declined"] as const).map((status) => ({
      ...packet.handoffs[0],
      status
    }));
    const report = formatReviewReport(packet);
    for (const status of ["pending", "accepted", "completed", "declined"])
      expect(report).toContain(`status ${status}`);
    expect(report).toContain("timestamp unknown; text omitted by packet");
  });

  it("escapes forged headings, links, HTML and controls while emitting only safe manifest links", () => {
    const packet = fixture();
    const hostile = `\n# Forged\r\n[click](https://evil.test) <img src=x onerror=bad> ${String.fromCharCode(27)}[31m\u202e`;
    packet.effectiveDecisions[0].title = hostile;
    packet.verifications[0].name = hostile;
    packet.runs[0].gitBranch = hostile;
    packet.workflow.project = hostile;
    Object.assign(packet.verifications[0].sourceRef, { url: "https://private.test/secret" });
    Object.assign(packet.runs[0], {
      task: "private task",
      hostname: "private-host",
      cwd: "/home/private"
    });
    Object.assign(packet.openLoops[0], { title: "private loop title" });
    Object.assign(packet.handoffs[0], {
      summary: "private handoff text",
      context: "private transcript"
    });
    packet.artifacts[0].path = "/home/private/report.json";
    const report = formatReviewReport(packet);
    expect(report).toContain("\\# Forged");
    expect(report).toContain("&lt;img");
    for (const excluded of [
      "\n# Forged",
      "[click](https://",
      "<img",
      String.fromCharCode(27),
      "\u202e",
      "private task",
      "private loop title",
      "private handoff text",
      "private transcript",
      "private-host",
      "/home/private",
      "https://private.test"
    ])
      expect(report).not.toContain(excluded);
    const links = report.match(/\]\(([^)]*)\)/g);
    expect(links?.every((link) => /^\]\(\/runs\/[a-zA-Z0-9_-]+\/manifest\)$/.test(link))).toBe(
      true
    );
    packet.runs[0].id = "../../private";
    packet.verifications[0].runId = "https://attacker.test/secret";
    const unsafe = formatReviewReport(packet);
    expect(unsafe).toContain("manifest link unavailable");
    expect(unsafe).not.toContain("[manifest](/runs/../../");
    expect(unsafe).not.toContain("[manifest](/runs/https");
  });

  it("preserves stable 255-character IDs and refuses unsafe source IDs explicitly", () => {
    const packet = fixture();
    const legalId = "r".repeat(255);
    packet.runs[0].id = legalId;
    packet.runs[0].sourceRef.id = legalId;
    packet.workflow.rootRunId = legalId;
    packet.workflow.runIds = [legalId];
    const report = formatReviewReport(packet);
    expect(report).toContain(`run:${legalId}`);
    expect(report).toContain(`[manifest](/runs/${legalId}/manifest)`);
    expect(report).not.toContain("[clipped]");
    packet.runs[0].sourceRef.id = "/home/private/source";
    const unsafe = formatReviewReport(packet);
    expect(unsafe).toContain("run:unavailable (unsafe source ID)");
    expect(unsafe).not.toContain("/home/private/source");
  });

  it("visibly clips long untrusted text and does not treat unknown hashes as verified artifacts", () => {
    const packet = fixture();
    packet.effectiveDecisions[0].title = "x".repeat(10000);
    delete packet.artifacts[0].sha256;
    const report = formatReviewReport(packet);
    expect(report).toContain("\\[clipped\\]");
    expect(report).not.toContain("x".repeat(321));
    expect(report).toContain("SHA-256 reference unknown");
    expect(report).toContain("contents and applicability unverified");
  });
});
