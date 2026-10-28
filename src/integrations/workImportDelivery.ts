import { parseWorkImport, planWorkImport } from "./workImport.js";

export type ImportRequest = (path: string, body: Record<string, unknown>) => Promise<unknown>;

type Stage = "validation" | "run" | "summary" | "handoff";
type Confirmed = { stage: Exclude<Stage, "validation">; id: string };

export type WorkImportResult = {
  schemaVersion: "1";
  status: "invalid" | "dry_run" | "complete" | "conflict" | "partial" | "failed";
  plan?: ReturnType<typeof planWorkImport>;
  confirmed: Confirmed[];
  error?: { stage: Stage; code: string; message: string; deliveryUnknown: boolean };
  resume: "retry_identical_envelope" | "resolve_conflict" | "fix_input" | "none";
  semantics: "client_reported_unverified";
};

class ImportConflict extends Error {}

// No local state/outbox: dependent writes need confirmed server IDs. Retrying the
// original envelope reuses server uniqueness keys, including after a lost reply.
export async function importWork(
  raw: string,
  request: ImportRequest,
  options: { dryRun?: boolean; token?: string } = {}
): Promise<WorkImportResult> {
  const result: WorkImportResult = {
    schemaVersion: "1",
    status: "invalid",
    confirmed: [],
    resume: "fix_input",
    semantics: "client_reported_unverified"
  };
  let stage: Stage = "validation";
  try {
    const input = parseWorkImport(raw, options.token);
    const plan = planWorkImport(input);
    result.plan = plan;
    result.resume = "none";
    if (options.dryRun) {
      result.status = "dry_run";
      return result;
    }
    stage = "run";
    const runBody = {
      source: plan.source,
      project: input.project,
      clientRunId: plan.clientRunId,
      workKey: input.workKey,
      workflowId: input.workflowId,
      task: input.task,
      status:
        input.source.reportedStatus === "interrupted" ? "cancelled" : input.source.reportedStatus,
      summary: `[Client-reported; unverified] ${input.summary}`,
      category: "work-import-v1",
      // This creation-only field guards the entire envelope, even if delivery
      // stops before the summary event. Never use mutable summary/status as guard.
      tags: [`import-sha256:${plan.payloadHash}`],
      startedAt: input.source.observedAt
    };
    const runResponse = await request("/runs", runBody);
    const run = record(runResponse, "run");
    assertMatches(run, {
      source: runBody.source,
      project: runBody.project,
      clientRunId: runBody.clientRunId,
      workKey: runBody.workKey,
      workflowId: runBody.workflowId,
      task: runBody.task,
      category: runBody.category,
      tags: runBody.tags,
      startedAt: runBody.startedAt
    });
    result.confirmed.push({ stage, id: run.id });

    stage = "summary";
    const provenance = {
      schemaVersion: "1",
      payloadHash: plan.payloadHash,
      semantics: "client_reported_unverified",
      envelope: input
    };
    const eventBody = {
      runId: run.id,
      clientRecordId: plan.summaryKey,
      type: "progress",
      message: `[Client-reported ${input.source.reportedStatus}; unverified] ${input.summary}`,
      importance: 3,
      category: "work-import-v1",
      data: provenance,
      createdAt: input.source.observedAt
    };
    const event = record(await request("/events", eventBody), "event");
    assertMatches(event, eventBody);
    result.confirmed.push({ stage, id: event.id });

    if (input.handoff) {
      stage = "handoff";
      const handoffBody = {
        sourceRunId: run.id,
        clientRecordId: plan.handoffKey,
        fromSource: plan.source,
        ...(input.handoff.toSource ? { toSource: input.handoff.toSource } : {}),
        project: input.project,
        summary: runBody.summary,
        nextAction: input.nextAction,
        category: "work-import-v1",
        context: provenance,
        createdAt: input.source.observedAt
      };
      const handoff = record(await request("/handoffs", handoffBody), "handoff");
      // Mutable handoff lifecycle fields are intentionally neither checked nor replayed.
      assertMatches(handoff, handoffBody);
      result.confirmed.push({ stage, id: handoff.id });
    }
    result.status = "complete";
    return result;
  } catch (error) {
    const conflict = error instanceof ImportConflict;
    const validation = stage === "validation";
    result.status = validation
      ? "invalid"
      : conflict
        ? "conflict"
        : result.confirmed.length
          ? "partial"
          : "failed";
    result.resume = validation
      ? "fix_input"
      : conflict
        ? "resolve_conflict"
        : "retry_identical_envelope";
    result.error = {
      stage,
      code: validation ? "invalid_input" : conflict ? "identity_conflict" : "request_failed",
      message: validation
        ? error instanceof Error
          ? error.message
          : "Invalid work summary"
        : conflict
          ? "Stored identity has different content; no update was applied. Use the original envelope or a distinct source run identity for distinct work."
          : "Delivery failed or its response could not be confirmed. Check service access, then retry the identical envelope; the failed stage may already be stored.",
      deliveryUnknown: !validation && !conflict
    };
    return result;
  }
}

function record(response: unknown, key: string): Record<string, unknown> & { id: string } {
  if (!response || typeof response !== "object") throw new Error("Invalid service response");
  const item = (response as Record<string, unknown>)[key];
  if (
    !item ||
    typeof item !== "object" ||
    !("id" in item) ||
    typeof item.id !== "string" ||
    !item.id
  ) {
    throw new Error("Service did not confirm an ID");
  }
  return item as Record<string, unknown> & { id: string };
}

function assertMatches(record: Record<string, unknown>, expected: Record<string, unknown>): void {
  for (const [key, value] of Object.entries(expected)) {
    if (!sameValue(record[key], value)) throw new ImportConflict();
  }
}

function sameValue(left: unknown, right: unknown): boolean {
  if (left === right) return true;
  if (Array.isArray(left) && Array.isArray(right)) {
    return (
      left.length === right.length && left.every((item, index) => sameValue(item, right[index]))
    );
  }
  if (left && right && typeof left === "object" && typeof right === "object") {
    const a = Object.entries(left);
    const b = Object.entries(right);
    return (
      a.length === b.length &&
      a.every(([key, value]) => sameValue(value, (right as Record<string, unknown>)[key]))
    );
  }
  return false;
}
