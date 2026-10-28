import { createHash } from "node:crypto";
import { z } from "zod";

export const MAX_WORK_IMPORT_BYTES = 16 * 1024;

// A deliberately conservative screen, not a general-purpose secret detector.
function safeText(value: string): boolean {
  return (
    [...value].every((character) => {
      const code = character.codePointAt(0) ?? 0;
      return !(
        (code < 32 && code !== 10) ||
        (code >= 127 && code <= 159) ||
        (code >= 0x202a && code <= 0x202e) ||
        (code >= 0x2066 && code <= 0x2069)
      );
    }) &&
    value.split("\n").length <= 12 &&
    !/(?:bearer\s+\S+|(?:gh[pousr]_|github_pat_|sk-(?:proj-)?)[a-z0-9_-]{8,}|-----BEGIN [A-Z ]*PRIVATE KEY|(?:token|password|secret|api[_-]?key|authorization)\s*[=:]\s*\S+)/i.test(
      value
    ) &&
    !/\b[A-Z][A-Z0-9_]{2,}\s*=\s*\S+/.test(value) &&
    !/\/(?:home|users|private|root|etc|proc|var|tmp|opt|srv|mnt)\//i.test(value) &&
    !/(?:^|[\s"'`(=:])(?:\/(?!\/)[a-z0-9._~-]+(?:\/|\b)|~\/|[a-z]:[\\/]|\\\\)/i.test(value) &&
    !/(?:^|\n)\s*(?:user|assistant|system|developer|tool)\s*:|"(?:messages|transcript|environment|env)"\s*:/i.test(
      value
    )
  );
}

function text(max: number) {
  return z
    .string()
    .min(1)
    .max(max)
    .refine((value) => value === value.trim() && safeText(value), {
      message: "Unsafe or untrimmed text"
    });
}

function safeReference(value: string): boolean {
  if (/^urn:[a-z0-9][a-z0-9:._-]*$/i.test(value)) return true;
  if (/^git:[a-f0-9]{7,64}$/i.test(value)) return true;
  if (/^t3-thread:\/\/v1\/[a-z0-9:._%-]+$/i.test(value)) return true;
  if (/^repo:[a-z0-9._/-]+$/i.test(value)) {
    return !value.slice(5).startsWith("/") && !value.slice(5).split("/").includes("..");
  }
  try {
    const url = new URL(value);
    return (
      url.protocol === "https:" &&
      !url.username &&
      !url.password &&
      !url.search &&
      !url.hash &&
      !url.port &&
      /^[a-z][a-z0-9.-]+\.[a-z]{2,}$/i.test(url.hostname) &&
      !/(?:^|\.)(?:localhost|local|internal|lan)$/i.test(url.hostname) &&
      !/%(?:2f|5c|00|0a|0d)/i.test(value)
    );
  } catch {
    return false;
  }
}

const reference = text(1000).refine(safeReference, "Unsupported or unsafe reference");
const timestamp = z.string().datetime();
const sourceSchema = z.strictObject({
  kind: z.enum(["generic", "t3"]),
  system: text(40).regex(/^[a-z0-9][a-z0-9._-]*$/),
  threadId: text(255),
  runId: text(255),
  ref: reference,
  observedAt: timestamp,
  reportedStatus: z.enum(["completed", "failed", "cancelled", "interrupted"])
});

export const workImportSchema = z
  .strictObject({
    schemaVersion: z.literal("1"),
    source: sourceSchema,
    project: text(120),
    workflowId: text(255),
    workKey: text(500),
    task: text(1000),
    summary: text(1800),
    evidence: z
      .array(
        z.strictObject({
          kind: z.enum(["revision", "pull_request", "artifact", "check", "other"]),
          ref: reference,
          summary: text(300),
          observedAt: timestamp,
          provenance: z.literal("client_reported"),
          outcome: z.enum(["passed", "failed", "not_run", "unknown"]).optional()
        })
      )
      .max(12),
    nextAction: text(1000).optional(),
    handoff: z.strictObject({ toSource: text(80).optional() }).optional()
  })
  .superRefine((value, context) => {
    if (value.handoff && !value.nextAction) {
      context.addIssue({ code: "custom", message: "Handoff requires nextAction" });
    }
    if (value.source.kind === "t3") {
      const { system, threadId, runId, ref } = value.source;
      const runPrefix = `run:thread:${encodeURIComponent(threadId)}:ordinal:`;
      if (
        system !== "t3-code" ||
        !/^mcp:[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i.test(threadId) ||
        !runId.startsWith(runPrefix) ||
        !/^[1-9]\d*$/.test(runId.slice(runPrefix.length)) ||
        ref !== `t3-thread://v1/${threadId}`
      ) {
        context.addIssue({ code: "custom", message: "T3 source identity/reference mismatch" });
      }
    }
  });

export type WorkImport = z.infer<typeof workImportSchema>;

export function parseWorkImport(raw: string, token?: string): WorkImport {
  if (Buffer.byteLength(raw, "utf8") > MAX_WORK_IMPORT_BYTES) {
    throw new Error("Work summary exceeds 16384 bytes");
  }
  let value: unknown;
  try {
    value = JSON.parse(raw);
  } catch {
    throw new Error("Work summary must be valid JSON");
  }
  const parsed = workImportSchema.safeParse(value);
  if (!parsed.success) throw new Error("Invalid or unsafe work summary envelope (schema v1)");
  if (token && JSON.stringify(parsed.data).includes(token)) {
    throw new Error("Work summary contains configured authentication material");
  }
  return parsed.data;
}

function canonical(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonical).join(",")}]`;
  if (value && typeof value === "object") {
    return `{${Object.entries(value)
      .sort(([left], [right]) => left.localeCompare(right, "en"))
      .map(([key, item]) => `${JSON.stringify(key)}:${canonical(item)}`)
      .join(",")}}`;
  }
  return JSON.stringify(value);
}

function digest(value: unknown): string {
  return createHash("sha256").update(canonical(value)).digest("hex");
}

export function planWorkImport(input: WorkImport) {
  const { kind, system, threadId, runId } = input.source;
  const identity = digest([input.project, kind, system, threadId, runId]);
  return {
    clientRunId: `wi1:${identity}`,
    summaryKey: `wi1:${identity}:summary`,
    handoffKey: `wi1:${identity}:handoff`,
    payloadHash: digest(input),
    source: `work-import:${kind}:${system}`
  };
}
