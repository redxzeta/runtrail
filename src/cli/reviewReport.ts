import type { VerificationSupport, WorkflowReviewPacket } from "../shared/schemas.js";

/** Render only the packet's portable allowlist; never fetch omitted private detail. */
export function formatReviewReport(packet: WorkflowReviewPacket): string {
  const s = safeText;
  const reference = (ref: { type: string; id: string; version?: number }) =>
    `${s(ref.type)}:${safeId(ref.id)}${ref.version === undefined ? "" : ` v${ref.version}`}`;
  const references = (refs: Array<{ type: string; id: string; version?: number }>) =>
    refs.map(reference).join(", ") || "none supplied";
  const lines = [
    "# Workflow review report",
    `Schema 1 | as of ${s(packet.asOf)}`,
    `Workflow: ${safeId(packet.workflow.id)}; project: ${s(packet.workflow.project)}; work key: ${s(packet.workflow.workKey ?? "unknown")}; root run: ${safeId(packet.workflow.rootRunId)}.`,
    `Related run IDs: ${packet.workflow.runIds.map(safeId).join(", ") || "none supplied"}.`,
    "",
    "Advisory observations only. Reread sources before acting; this report grants no approval or deployment authority.",
    "Current applicability: unknown for all evidence. Verification records do not bind revision or dirty worktree state.",
    "Completed run status does not establish verification. Artifact hashes are references, never proof of correctness or current applicability.",
    "Task, loop and handoff free text is intentionally absent from this packet. No additional context was fetched.",
    "",
    "## Runs and changed-code references"
  ];
  if (!packet.runs.length)
    lines.push("- No runs supplied; workflow coverage and changed code are unknown.");
  for (const run of packet.runs) {
    // These additive packet fields may be absent in older server responses.
    const code: { gitCommit?: string; gitBranch?: string } = run;
    lines.push(
      `- ${reference(run.sourceRef)}; status ${s(run.status)}; source ${s(run.source)}; workflow ${safeId(run.workflowId)}; work key ${s(run.workKey ?? "unknown")}; ${manifest(run.id)}.`,
      `  - Started ${s(run.startedAt)}; updated ${s(run.updatedAt)}; parent ${safeId(run.parentRunId ?? "unknown")}; continued from ${safeId(run.continuedFromRunId ?? "unknown")}.`,
      `  - Freshness ${s(run.freshness.state)} (${s(run.freshness.reasonCode)}); last liveness ${s(run.freshness.lastLivenessAt ?? "unknown")}; observed ${s(run.freshness.asOf)}; window ${run.freshness.staleAfterSeconds}s.`,
      `  - Changed-code references: commit ${s(code.gitCommit ?? "unknown")}; branch ${s(code.gitBranch ?? "unknown")}; dirty worktree unknown; current applicability unknown.`
    );
    if (run.declaredAgent) {
      lines.push(
        `  - Declared agent ${s(run.declaredAgent.name ?? "unknown")}; model ${s(run.declaredAgent.model ?? "unknown")}; origin ${s(run.declaredAgent.origin)}; assurance ${s(run.declaredAgent.assurance)}.`
      );
    } else lines.push("  - Agent identity, origin and assurance: unknown (not supplied).");
  }
  lines.push("", "## Checks, failures and missing evidence");
  if (!packet.verifications.length)
    lines.push(
      "- No verification evidence supplied; required checks and their outcomes are unknown."
    );
  for (const check of packet.verifications) {
    lines.push(
      `- ${reference(check.sourceRef)}; check ${safeId(check.checkId)} / ${s(check.name)}; kind ${s(check.kind)}; outcome ${s(check.outcome)}; completed ${s(check.completedAt)}.`,
      `  - Run ${safeId(check.runId)}; ${manifest(check.runId)}; origin ${s(check.origin)}; assurance ${s(check.assurance)}; support ${supportText(check.support)}; current applicability unknown.`
    );
    if (check.outcome === "failed")
      lines.push(
        "  - Failure recorded. Inspect the source manifest and rerun or record a disposition before relying on this check."
      );
    if (check.outcome === "not_run")
      lines.push(
        "  - Missing execution evidence: not_run. Record a disposition or perform the required check."
      );
    if (check.outcome === "not_applicable")
      lines.push(
        "  - not_applicable is a recorded disposition; its applicability to current work remains unknown."
      );
  }
  lines.push("", "## Effective decisions");
  if (!packet.effectiveDecisions.length)
    lines.push("- No effective decisions supplied in this bounded packet.");
  for (const decision of packet.effectiveDecisions) {
    lines.push(
      `- ${safeId(decision.id)}: ${s(decision.title)}; supersedes ${decision.supersedesDecisionId ? safeId(decision.supersedesDecisionId) : "none supplied"}; origin ${s(decision.origin)}; assurance ${s(decision.assurance)}; sources ${references(decision.sourceRefs)}; timestamp unknown (not supplied).`
    );
  }
  lines.push("", "## Blockers and open loops");
  if (!packet.openLoops.length)
    lines.push("- None supplied; an empty bounded section does not prove absence of blockers.");
  for (const loop of packet.openLoops) {
    lines.push(
      `- ${reference(loop.sourceRef)}; type ${s(loop.type)}; status ${s(loop.status)}; source run ${safeId(loop.sourceRunId ?? "unknown")}${loop.sourceRunId ? `; ${manifest(loop.sourceRunId)}` : ""}; timestamp unknown; text omitted by packet.`
    );
  }
  lines.push("", "## Handoffs");
  if (!packet.handoffs.length) lines.push("- No handoffs supplied in this bounded packet.");
  for (const handoff of packet.handoffs) {
    lines.push(
      `- ${reference(handoff.sourceRef)}; status ${s(handoff.status)}; ${s(handoff.fromSource)} → ${s(handoff.toSource ?? "unknown")}; source run ${safeId(handoff.sourceRunId ?? "unknown")}; target run ${safeId(handoff.targetRunId ?? "unknown")}; timestamp unknown; text omitted by packet.`
    );
  }
  lines.push("", "## Artifact references");
  if (!packet.artifacts.length) lines.push("- No artifact references supplied.");
  for (const artifact of packet.artifacts) {
    lines.push(
      `- ${reference(artifact.sourceRef)}; run ${safeId(artifact.runId)}; kind ${s(artifact.kind)}; size ${artifact.sizeBytes ?? "unknown"}; SHA-256 reference ${s(artifact.sha256 ?? "unknown")}; timestamp unknown. Hash reference only; contents and applicability unverified.`
    );
  }
  lines.push(
    "",
    "## Readiness and provenance",
    `Advisory status: ${s(packet.readiness.status)}; as of ${s(packet.readiness.asOf)}.`,
    `Reason codes: ${packet.readiness.reasonCodes.map(s).join(", ") || "none supplied"}.`
  );
  if (!packet.readiness.findings.length)
    lines.push("- No readiness findings supplied; assurance and evidence gaps are unknown.");
  for (const finding of packet.readiness.findings) {
    lines.push(
      `- ${s(finding.reasonCode)}; origin ${s(finding.origin)}; assurance ${s(finding.assurance)}; caveats ${finding.caveatCodes.map(s).join(", ") || "none supplied"}.`
    );
    for (const source of finding.sourceRefs) {
      lines.push(
        `  - ${reference(source)}; origin ${s(source.origin)}; assurance ${s(source.assurance)}.`
      );
    }
    if (!finding.sourceRefs.length) lines.push("  - Source references missing.");
  }
  lines.push("", "## Next actions");
  if (!packet.nextActions.length)
    lines.push("- No actions supplied; reread source records before choosing work.");
  for (const action of packet.nextActions) {
    lines.push(
      `- ${s(action.actionCode)}; targets ${references(action.targetRefs)}; reasons ${action.reasonCodes.map(s).join(", ") || "none supplied"}; reread required: ${action.requiresReread ? "yes" : "no"}.`
    );
  }
  lines.push("", "## Coverage and limitations");
  for (const [section, meta] of Object.entries(packet.truncation)) {
    lines.push(
      `- ${s(section)}: ${meta.count} returned; limit ${meta.limit}; has more: ${meta.hasMore ? "yes (truncated)" : "no reported"}.`
    );
  }
  for (const limitation of packet.limitations) {
    lines.push(
      `- ${s(limitation.code)}${limitation.section ? `; section ${s(limitation.section)}` : ""}.`
    );
  }
  lines.push(
    "- Bounded workflow observation; omitted records, relationships and newer observations may change readiness. Empty history is not idle proof."
  );
  return lines.join("\n");
}

function supportText(support: VerificationSupport): string {
  switch (support.type) {
    case "client_reported":
      return "client_reported (assertion)";
    case "exit_code":
      return `exit_code ${support.exitCode}`;
    case "receipt":
      return `receipt reference ${safeId(support.receiptId)}`;
    case "artifact_digest":
      return `artifact_digest reference ${safeId(support.artifactId ?? "unknown")}; SHA-256 reference ${safeText(support.sha256)}`;
    case "unavailable":
      return `unavailable (${safeText(support.reason)})`;
  }
}

function manifest(id: string): string {
  if (!/^[a-zA-Z0-9_.:-]{1,255}$/.test(id) || id === "." || id === "..")
    return "manifest link unavailable (invalid run ID)";
  return `[manifest](/runs/${encodeURIComponent(id)}/manifest)`;
}

function safeId(value: string): string {
  return /^[a-zA-Z0-9_.:-]{1,255}$/.test(value)
    ? safeText(value)
    : "unavailable (unsafe source ID)";
}

function safeText(value: string): string {
  const clean = value
    .replace(/[\p{Cc}\p{Cf}\p{Zl}\p{Zp}]/gu, " ")
    .replace(/(?:[a-zA-Z]:[\\/]|\\\\)[^\s<>"']+|(?<![\w:])\/[^\s<>"']+/g, "[path omitted]")
    .replace(/\s+/g, " ")
    .trim();
  const clipped = clean.length > 320 ? `${clean.slice(0, 310)} [clipped]` : clean;
  return clipped
    .replace(/[\\`*_{}[\]()#+.!|:~=-]/g, "\\$&")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}
