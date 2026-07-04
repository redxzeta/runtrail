import { createHash } from "node:crypto";
import type { AgentEvent } from "./schemas.js";

export type ReceiptVerificationResult =
  | { status: "pass"; checkedEvents: number }
  | { status: "fail"; checkedEvents: number; eventId: string; reason: string }
  | { status: "unverifiable"; checkedEvents: number; eventId: string; reason: string };

export function computeEventHash(
  event: Omit<AgentEvent, "eventHash">,
  prevEventHash: string | undefined
): string {
  return createHash("sha256")
    .update(
      canonicalJson({
        id: event.id,
        runId: event.runId,
        type: event.type,
        message: event.message,
        importance: event.importance,
        data: event.data ?? null,
        createdAt: event.createdAt,
        prevEventHash: prevEventHash ?? null
      })
    )
    .digest("hex");
}

export function verifyEventChain(events: AgentEvent[]): ReceiptVerificationResult {
  const ordered = [...events].sort(compareEventsForReceipts);
  let previousHash: string | undefined;

  for (let index = 0; index < ordered.length; index += 1) {
    const event = ordered[index];

    if (!event.eventHash) {
      return {
        status: "unverifiable",
        checkedEvents: index,
        eventId: event.id,
        reason: "missing event hash"
      };
    }

    if ((event.prevEventHash ?? undefined) !== previousHash) {
      return {
        status: "fail",
        checkedEvents: index,
        eventId: event.id,
        reason: "previous hash does not match chain"
      };
    }

    const expectedHash = computeEventHash(event, previousHash);

    if (event.eventHash !== expectedHash) {
      return {
        status: "fail",
        checkedEvents: index,
        eventId: event.id,
        reason: "event hash does not match event content"
      };
    }

    previousHash = event.eventHash;
  }

  return { status: "pass", checkedEvents: ordered.length };
}

export function compareEventsForReceipts(left: AgentEvent, right: AgentEvent): number {
  return left.createdAt.localeCompare(right.createdAt) || left.id.localeCompare(right.id);
}

function canonicalJson(value: unknown): string {
  return JSON.stringify(canonicalize(value));
}

function canonicalize(value: unknown): unknown {
  if (Array.isArray(value)) {
    return value.map(canonicalize);
  }

  if (value && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>)
        .filter(([, entry]) => entry !== undefined)
        .sort(([left], [right]) => left.localeCompare(right))
        .map(([key, entry]) => [key, canonicalize(entry)])
    );
  }

  return value;
}
