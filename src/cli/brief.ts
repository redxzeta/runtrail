import type { AgentContext, PrepareWorkResponse } from "../shared/schemas.js";

const MAX_TEXT = 320;
const SECTION_NAMES = [
  "relevantRuns",
  "workflowRuns",
  "conflicts",
  "pendingHandoffs",
  "openLoops",
  "effectiveDecisions",
  "recommendations",
  "warnings"
] as const;

type ProjectionCoverage = {
  available: number;
  returned: number;
  omitted: number;
  sourceTruncated: boolean | null;
};

/** A bounded allowlist projection. Context and prepare-work are separate observations. */
export function buildBrief(prepared: PrepareWorkResponse, context: AgentContext, limit: number) {
  if (!Number.isInteger(limit) || limit < 1 || limit > 20) {
    throw new RangeError("Brief limit must be an integer from 1 to 20");
  }
  let textClipped = false;
  let unsafeSourceIdsOmitted = false;
  const text = (value: string, maximum = MAX_TEXT): string => {
    const clean = cleanText(value);
    if (clean.length <= maximum) return clean;
    textClipped = true;
    return `${clean.slice(0, maximum - 10)} [clipped]`;
  };
  const id = (value: string): string => {
    if (/^[a-zA-Z0-9_.:-]{1,255}$/.test(value)) return value;
    unsafeSourceIdsOmitted = true;
    return "unavailable (unsafe source ID)";
  };
  const projection: Record<string, ProjectionCoverage> = {};
  const take = <T>(name: string, items: T[], sourceTruncated: boolean | null = false): T[] => {
    const result = items.slice(0, limit);
    if (!name.includes(".") || result.length < items.length)
      projection[name] = {
        available: items.length,
        returned: result.length,
        omitted: items.length - result.length,
        sourceTruncated
      };
    return result;
  };
  const ref = (item: { type: string; id: string; version?: number }) => ({
    type: text(item.type),
    id: id(item.id),
    ...(item.version === undefined ? {} : { version: item.version })
  });
  const freshness = (value: PrepareWorkResponse["relevantRuns"][number]["freshness"]) => ({
    state: value.state,
    lastLivenessAt: value.lastLivenessAt ? text(value.lastLivenessAt) : null,
    staleAfterSeconds: value.staleAfterSeconds,
    asOf: text(value.asOf),
    reasonCode: value.reasonCode
  });
  const sameProject = prepared.project === context.project;
  const runs = sameProject ? [...context.recent_runs, ...context.failed_runs] : [];
  const sourceStatus = (found: { version: number } | undefined, version: number) =>
    !found
      ? ("missing" as const)
      : found.version === version
        ? ("matched" as const)
        : ("version_mismatch" as const);
  const projectRun = (run: PrepareWorkResponse["relevantRuns"][number]) => {
    const matched = runs.find((item) => item.id === run.id && item.version === run.version);
    const found = matched ?? runs.find((item) => item.id === run.id);
    return {
      id: id(run.id),
      source: text(run.source),
      status: run.status,
      version: run.version,
      startedAt: text(run.startedAt),
      updatedAt: text(run.updatedAt),
      task: matched ? text(matched.task) : null,
      summary: matched?.summary ? text(matched.summary) : null,
      detailStatus: sourceStatus(found, run.version),
      freshness: freshness(run.freshness),
      evidenceApplicability: "unknown" as const,
      sourceRef: ref({ type: "run", id: run.id, version: run.version })
    };
  };
  const selectedRun = prepared.selectedRun ? projectRun(prepared.selectedRun) : null;
  const relevantRuns = take(
    "relevantRuns",
    prepared.relevantRuns,
    prepared.sections.relevantRuns.truncated
  ).map(projectRun);
  const recentEvents = take(
    "recentEvents",
    (sameProject ? context.recent_events : [])
      .filter(
        (event) =>
          event.importance >= 4 ||
          ["blocked", "failed", "needs_review", "decision_required"].includes(event.type)
      )
      .sort((a, b) => b.createdAt.localeCompare(a.createdAt) || a.id.localeCompare(b.id)),
    null
  ).map((event) => ({
    id: id(event.id),
    runId: id(event.runId),
    type: event.type,
    importance: event.importance,
    // Command argv is not an appropriate portable brief, even when put in a message.
    message:
      event.type === "command_executed" ? "Command details omitted (privacy)" : text(event.message),
    createdAt: text(event.createdAt),
    sourceRef: ref({ type: "event", id: event.id })
  }));
  const effectiveDecisions = take(
    "effectiveDecisions",
    prepared.effectiveDecisions,
    prepared.sections.effectiveDecisions.truncated
  ).map((decision) => {
    const detail = sameProject
      ? context.decisions.find(
          (item) =>
            item.id === decision.id &&
            item.state === "current" &&
            item.createdAt === decision.createdAt
        )
      : undefined;
    return {
      id: id(decision.id),
      title: text(decision.title),
      decision: detail ? text(detail.decision) : null,
      detailStatus: detail ? ("matched" as const) : ("missing" as const),
      createdAt: text(decision.createdAt),
      supersedesDecisionId: decision.supersedesDecisionId
        ? id(decision.supersedesDecisionId)
        : null,
      sourceRef: ref({ type: "decision", id: decision.id })
    };
  });
  const blockers = take("blockers", prepared.openLoops, prepared.sections.openLoops.truncated).map(
    (loop) => {
      const found = sameProject
        ? context.open_loops.find((item) => item.id === loop.id)
        : undefined;
      const detail = found?.version === loop.version ? found : undefined;
      return {
        id: id(loop.id),
        type: loop.type,
        status: loop.status,
        version: loop.version,
        title: detail ? text(detail.title) : null,
        nextAction: detail?.nextAction ? text(detail.nextAction) : null,
        detailStatus: sourceStatus(found, loop.version),
        updatedAt: text(loop.updatedAt),
        sourceRef: ref({ type: "openLoop", id: loop.id, version: loop.version })
      };
    }
  );
  const handoffs = sameProject ? [...context.pending_handoffs, ...context.recent_handoffs] : [];
  const pendingHandoffs = take(
    "pendingHandoffs",
    prepared.pendingHandoffs,
    prepared.sections.pendingHandoffs.truncated
  ).map((handoff) => {
    const detail = handoffs.find(
      (item) => item.id === handoff.id && item.version === handoff.version
    );
    const found = detail ?? handoffs.find((item) => item.id === handoff.id);
    return {
      id: id(handoff.id),
      status: handoff.status,
      version: handoff.version,
      fromSource: text(handoff.fromSource),
      toSource: handoff.toSource ? text(handoff.toSource) : null,
      summary: detail ? text(detail.summary) : null,
      nextAction: detail?.nextAction ? text(detail.nextAction) : null,
      detailStatus: sourceStatus(found, handoff.version),
      updatedAt: text(handoff.updatedAt),
      sourceRef: ref({ type: "handoff", id: handoff.id, version: handoff.version })
    };
  });
  const conflicts = take(
    "conflicts",
    prepared.conflicts,
    prepared.sections.conflicts.truncated
  ).map((run) => ({
    id: id(run.id),
    status: run.status,
    version: run.version,
    updatedAt: text(run.updatedAt),
    conflictCode: run.conflictCode,
    freshness: freshness(run.freshness),
    sourceRef: ref({ type: "run", id: run.id, version: run.version })
  }));
  const recommendations = take(
    "recommendations",
    prepared.recommendations,
    prepared.sections.recommendations.truncated
  ).map((action, index) => ({
    actionCode: action.actionCode,
    reasonCodes: take(`recommendations.${index}.reasonCodes`, action.reasonCodes),
    targetRefs: take(`recommendations.${index}.targetRefs`, action.targetRefs).map(ref),
    requiresReread: action.requiresReread,
    asOf: text(prepared.asOf)
  }));
  const ready = prepared.readiness;
  const readiness = {
    status: ready?.status ?? "unknown",
    asOf: ready ? text(ready.asOf) : null,
    reasonCodes: take("readiness.reasonCodes", ready?.reasonCodes ?? []),
    findings: take("readiness.findings", ready?.findings ?? []).map((finding, index) => ({
      reasonCode: finding.reasonCode,
      origin: finding.origin,
      assurance: finding.assurance,
      sourceRefs: take(`readiness.${index}.sourceRefs`, finding.sourceRefs).map((item) => ({
        ...ref(item),
        origin: item.origin,
        assurance: item.assurance
      })),
      caveatCodes: take(`readiness.${index}.caveatCodes`, finding.caveatCodes)
    })),
    nextActions: take("readiness.nextActions", ready?.nextActions ?? []).map((action, index) => ({
      actionCode: action.actionCode,
      targetRefs: take(`readiness.nextActions.${index}.targetRefs`, action.targetRefs).map(ref),
      requiresReread: action.requiresReread
    }))
  };
  const warnings = take("warnings", prepared.warnings, prepared.sections.warnings.truncated).map(
    ({ code, section }) => ({ code, section })
  );
  const project = text(prepared.project);
  const asOf = text(prepared.asOf);
  return {
    schemaVersion: "1" as const,
    project,
    asOf,
    selectedRun,
    relevantRuns,
    recentEvents,
    effectiveDecisions,
    blockers,
    pendingHandoffs,
    conflicts,
    readiness,
    recommendations,
    warnings,
    evidenceApplicability: "unknown" as const,
    coverage: {
      limit,
      atomic: false as const,
      context: {
        mode: context.mode,
        coverage: "unknown" as const,
        scope: "project" as const,
        projectMatches: sameProject
      },
      preparedMode: prepared.mode,
      nestedArraysBoundedBy: limit,
      prepared: Object.fromEntries(
        SECTION_NAMES.map((name) => {
          const section = prepared.sections[name];
          return [
            name,
            { limit: section.limit, count: section.count, truncated: section.truncated }
          ];
        })
      ),
      projection
    },
    textClipped,
    unsafeSourceIdsOmitted,
    advisories: [
      "Advisory observations only; reread source records before acting.",
      "Prepare-work and context are separate bounded queries with different scopes, not an atomic snapshot.",
      "Context has no full coverage metadata; omitted or empty history is not proof of idle work.",
      "Completed run status does not establish verification or current applicability.",
      "Evidence applicability is unknown: verification records do not bind revision or dirty worktree state.",
      "Text is clipped when marked; machine paths and command details are omitted."
    ]
  };
}

export type BriefReport = ReturnType<typeof buildBrief>;

export function formatBrief(report: BriefReport): string {
  const s = markdown;
  const ref = (value: { type: string; id: string; version?: number }) =>
    `${s(value.type)}:${s(value.id)}${value.version === undefined ? "" : ` v${value.version}`}`;
  const refs = (values: Array<{ type: string; id: string; version?: number }>) =>
    values.map(ref).join(", ") || "none supplied";
  const lines = [
    "# Work brief",
    `Project: ${s(report.project)} | as of ${s(report.asOf)} | schema 1`,
    "",
    "## Selected work"
  ];
  const run = report.selectedRun;
  if (run) {
    lines.push(
      `- ${ref(run.sourceRef)}: ${s(run.status)}; ${s(run.task ?? "task unknown (missing context)")}`
    );
    lines.push(
      `- Summary: ${s(run.summary ?? "unknown")}; context: ${s(run.detailStatus)}; started ${s(run.startedAt)}; updated ${s(run.updatedAt)}.`
    );
    lines.push(
      `- Freshness: ${s(run.freshness.state)} (${s(run.freshness.reasonCode)}); last liveness ${s(run.freshness.lastLivenessAt ?? "unknown")}; observed ${s(run.freshness.asOf)}; window ${run.freshness.staleAfterSeconds}s.`
    );
  } else
    lines.push("- Unknown: no selected run supplied. Empty history does not establish idle work.");
  const section = (title: string, items: string[]) => {
    lines.push(
      "",
      `## ${title}`,
      ...(items.length
        ? items.map((item) => `- ${item}`)
        : ["- None in this bounded observation; coverage incomplete."])
    );
  };
  section(
    "Relevant work (bounded prepare-work scope)",
    report.relevantRuns.map(
      (item) =>
        `${ref(item.sourceRef)}; ${s(item.status)}; ${s(item.task ?? "task unknown (missing context)")}; summary ${s(item.summary ?? "unknown")}; context ${s(item.detailStatus)}; started ${s(item.startedAt)}; updated ${s(item.updatedAt)}; freshness ${s(item.freshness.state)} (${s(item.freshness.reasonCode)}) as of ${s(item.freshness.asOf)}`
    )
  );
  section(
    "Recent meaningful events (project-scoped, not work-key-scoped)",
    report.recentEvents.map(
      (event) =>
        `${ref(event.sourceRef)}; run:${s(event.runId)}; ${s(event.type)} at ${s(event.createdAt)}: ${s(event.message)}`
    )
  );
  section(
    "Effective decisions",
    report.effectiveDecisions.map(
      (decision) =>
        `${ref(decision.sourceRef)} at ${s(decision.createdAt)}: ${s(decision.title)} — ${s(decision.decision ?? "decision text missing from context")}${decision.supersedesDecisionId ? `; supersedes decision:${s(decision.supersedesDecisionId)}` : ""}`
    )
  );
  section(
    "Blockers and open loops",
    report.blockers.map(
      (loop) =>
        `${ref(loop.sourceRef)}; ${s(loop.type)} / ${s(loop.status)}; updated ${s(loop.updatedAt)}: ${s(loop.title ?? "text missing from context")} (${s(loop.detailStatus)}); action: ${s(loop.nextAction ?? "unknown")}`
    )
  );
  section(
    "Pending handoffs",
    report.pendingHandoffs.map(
      (handoff) =>
        `${ref(handoff.sourceRef)}; ${s(handoff.status)}; ${s(handoff.fromSource)} → ${s(handoff.toSource ?? "unknown")}; updated ${s(handoff.updatedAt)}: ${s(handoff.summary ?? "text missing from context")} (${s(handoff.detailStatus)}); action: ${s(handoff.nextAction ?? "unknown")}`
    )
  );
  section(
    "Conflicts",
    report.conflicts.map(
      (conflict) =>
        `${ref(conflict.sourceRef)}; ${s(conflict.status)}; ${s(conflict.conflictCode)}; freshness ${s(conflict.freshness.state)} (${s(conflict.freshness.reasonCode)}) as of ${s(conflict.freshness.asOf)}; updated ${s(conflict.updatedAt)}`
    )
  );
  lines.push(
    "",
    "## Readiness and evidence gaps",
    `Status: ${s(report.readiness.status)}; as of ${s(report.readiness.asOf ?? "unknown")}; current applicability: unknown.`,
    `Reasons: ${report.readiness.reasonCodes.map(s).join(", ") || "unknown (no findings supplied)"}.`
  );
  for (const finding of report.readiness.findings) {
    lines.push(
      `- ${s(finding.reasonCode)}; origin ${s(finding.origin)}; assurance ${s(finding.assurance)}; sources ${refs(finding.sourceRefs)}; caveats ${finding.caveatCodes.map(s).join(", ") || "none supplied"}.`
    );
    for (const source of finding.sourceRefs)
      lines.push(
        `  - ${ref(source)}; origin ${s(source.origin)}; assurance ${s(source.assurance)}.`
      );
  }
  section(
    "Recommended actions",
    report.recommendations.map(
      (action) =>
        `${s(action.actionCode)}; targets ${refs(action.targetRefs)}; reasons ${action.reasonCodes.map(s).join(", ") || "unknown"}; reread required: ${action.requiresReread ? "yes" : "no"}; as of ${s(action.asOf)}`
    )
  );
  for (const action of report.readiness.nextActions)
    lines.push(
      `- Readiness action: ${s(action.actionCode)}; targets ${refs(action.targetRefs)}; reread required: ${action.requiresReread ? "yes" : "no"}.`
    );
  lines.push(
    "",
    "## Coverage and advisories",
    `Context mode: ${s(report.coverage.context.mode)}; full coverage: unknown; project matches: ${report.coverage.context.projectMatches ? "yes" : "no"}. Prepare-work mode: ${s(report.coverage.preparedMode)}.`
  );
  for (const [name, meta] of Object.entries(report.coverage.prepared))
    lines.push(
      `- Prepared ${s(name)}: ${meta.count} returned; limit ${meta.limit}; truncated: ${meta.truncated ? "yes" : "no"}.`
    );
  for (const [name, meta] of Object.entries(report.coverage.projection))
    lines.push(
      `- Projection ${s(name)}: ${meta.returned}/${meta.available} available; omitted ${meta.omitted}; source truncated: ${meta.sourceTruncated === null ? "unknown" : meta.sourceTruncated ? "yes" : "no"}.`
    );
  for (const warning of report.warnings) lines.push(`- ${s(warning.code)}: ${s(warning.section)}.`);
  lines.push(
    `- Text clipped: ${report.textClipped ? "yes" : "no"}; unsafe source IDs omitted: ${report.unsafeSourceIdsOmitted ? "yes" : "no"}.`,
    ...report.advisories.map((item) => `- ${s(item)}`)
  );
  return lines.join("\n");
}

function cleanText(value: string): string {
  return value
    .replace(/[\p{Cc}\p{Cf}\p{Zl}\p{Zp}]/gu, " ")
    .replace(/(?:[a-zA-Z]:[\\/]|\\\\)[^\s<>"']+|(?<![\w:])\/[^\s<>"']+/g, "[path omitted]")
    .replace(/\s+/g, " ")
    .trim();
}

function markdown(value: string): string {
  return cleanText(value)
    .replace(/[\\`*_{}[\]()#+.!|:~=-]/g, "\\$&")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}
