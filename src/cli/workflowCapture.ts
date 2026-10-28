import { execFileSync } from "node:child_process";
import { randomUUID } from "node:crypto";
import {
  closeSync,
  constants,
  fstatSync,
  fsyncSync,
  linkSync,
  openSync,
  readSync,
  unlinkSync,
  writeFileSync
} from "node:fs";
import type { Command } from "commander";
import { z } from "zod";
import {
  MAX_WORK_IMPORT_BYTES,
  parseWorkImport,
  type WorkImport
} from "../integrations/workImport.js";
import { type ImportRequest, importWork } from "../integrations/workImportDelivery.js";

const terminal = z.enum(["completed", "failed", "cancelled", "interrupted"]);
const t3Metadata = z.strictObject({
  thread: z.strictObject({ threadId: z.string().max(255) }),
  recentRuns: z
    .array(
      z.strictObject({
        runId: z.string().max(255),
        status: z.string().max(40),
        completedAt: z.string().datetime().nullable()
      })
    )
    .min(1)
    .max(50)
});

type CaptureOptions = {
  sourceFile?: string;
  sourceRun?: string;
  project?: string;
  workKey?: string;
  workflowId?: string;
  task?: string;
  summary?: string;
  nextAction?: string;
  toSource?: string;
  evidenceRef: string[];
  git: boolean;
  save?: string;
  retry?: string;
  dryRun: boolean;
};

export function registerWorkflowCapture(workflow: Command, request: ImportRequest): void {
  workflow
    .command("capture")
    .description("Save and import one explicitly authored handoff; JSON output")
    .option("--source-file <file>", "Bounded selected T3 metadata or generic v1 source JSON")
    .option("--source-run <id>", "Exact T3 run ID (required when metadata has multiple runs)")
    .option("--project <project>", "Project; defaults to owner/repo from a public GitHub origin")
    .option("--work-key <key>", "Caller-selected canonical work key; required for new capture")
    .option("--workflow-id <id>", "Workflow identifier; defaults to the work key")
    .option("--task <text>", "Authored task; defaults to the work key")
    .option("--summary <text>", "Authored summary, including blockers and evidence limitations")
    .option("--next-action <text>", "Explicit authored next action; never executed")
    .option("--to-source <source>", "Optional receiving client")
    .option("--evidence-ref <ref>", "Unverified reference (repeatable); never fetched", collect, [])
    .option("--no-git", "Omit local Git revision/dirty-state reference")
    .option("--save <file>", "New immutable owner-only envelope; existing files are never replaced")
    .option("--retry <file>", "Deliver the identical saved envelope; no other capture flags")
    .option("--dry-run", "Validate only; zero network requests and zero files written", false)
    .action(async (options: CaptureOptions, command: Command) => {
      let raw: string;
      let saved = false;
      try {
        if (options.retry) {
          if (
            Object.keys(command.opts()).some(
              (key) =>
                !["retry", "dryRun"].includes(key) && command.getOptionValueSource(key) === "cli"
            )
          )
            throw new CaptureError("Retry accepts only --retry and optional --dry-run.");
          raw = readBoundedFile(options.retry);
        } else {
          if (!options.sourceFile || !options.workKey || !options.summary || !options.nextAction)
            throw new CaptureError(
              "New capture requires --source-file, --work-key, --summary and --next-action."
            );
          if (!options.save && !options.dryRun)
            throw new CaptureError(
              "New delivery requires --save; use --retry for an existing envelope."
            );
          raw = buildEnvelope(options);
        }
        // Authoritative validation precedes ALL persistence and network activity.
        parseWorkImport(raw, process.env.RUNTRAIL_TOKEN);
        if (!options.retry && !options.dryRun) {
          saveExclusive(options.save as string, raw);
          saved = true;
        }
      } catch (error) {
        console.log(
          JSON.stringify(
            {
              schemaVersion: "1",
              status: "invalid",
              confirmed: [],
              envelopeSaved: false,
              error: {
                stage: "capture",
                code: "capture_rejected",
                // Only our fixed validation messages; fs/Zod errors can contain private input.
                message:
                  error instanceof CaptureError
                    ? error.message
                    : "Capture rejected. Check bounded metadata, authored input, required flags and an unused writable save path.",
                deliveryUnknown: false
              },
              resume: "fix_input",
              semantics: "client_reported_unverified"
            },
            null,
            2
          )
        );
        process.exitCode = 1;
        return;
      }
      const result = await importWork(raw, request, {
        dryRun: options.dryRun,
        token: process.env.RUNTRAIL_TOKEN
      });
      console.log(
        JSON.stringify(
          {
            ...result,
            envelopeSaved: saved,
            retryEnvelope: Boolean(options.retry),
            captureNote: options.dryRun
              ? "Validation only; no file saved. New capture will observe a new timestamp. Remote conflicts are unknown."
              : "Retain the original saved envelope. Retry with --retry; do not recapture after uncertain delivery."
          },
          null,
          2
        )
      );
      if (result.status !== "complete" && result.status !== "dry_run") process.exitCode = 1;
    });
}

class CaptureError extends Error {}

function buildEnvelope(options: CaptureOptions): string {
  const metadata: unknown = JSON.parse(readBoundedFile(options.sourceFile as string));
  const observedAt = new Date().toISOString();
  let source: WorkImport["source"];
  const evidence: WorkImport["evidence"] = [];
  if (metadata && typeof metadata === "object" && "thread" in metadata) {
    const selected = t3Metadata.parse(metadata);
    const prefix = `run:thread:${encodeURIComponent(selected.thread.threadId)}:ordinal:`;
    if (
      selected.recentRuns.some(
        (run) => !run.runId.startsWith(prefix) || !/^[1-9]\d*$/.test(run.runId.slice(prefix.length))
      )
    )
      throw new CaptureError("T3 thread/run identity mismatch.");
    if (!options.sourceRun && selected.recentRuns.length !== 1)
      throw new CaptureError("Ambiguous T3 metadata: select exactly one run with --source-run.");
    const runs = options.sourceRun
      ? selected.recentRuns.filter((run) => run.runId === options.sourceRun)
      : selected.recentRuns;
    if (runs.length !== 1)
      throw new CaptureError("Source selection must match exactly one T3 run.");
    const run = runs[0];
    if (!terminal.safeParse(run.status).success || !run.completedAt)
      throw new CaptureError(
        "Selected source must be terminal with a reported completion timestamp. Running sources are unsupported."
      );
    source = {
      kind: "t3",
      system: "t3-code",
      threadId: selected.thread.threadId,
      runId: run.runId,
      ref: `t3-thread://v1/${selected.thread.threadId}`,
      observedAt,
      reportedStatus: terminal.parse(run.status)
    };
    evidence.push({
      kind: "other",
      ref: source.ref,
      summary: `Source-reported completion: ${run.completedAt}; not independent verification.`,
      observedAt,
      provenance: "client_reported"
    });
  } else {
    if (options.sourceRun) throw new CaptureError("--source-run selects T3 metadata only.");
    // Generic callers explicitly supply existing v1 source fields, including their
    // own observation and stable identities. This is attribution, not attestation.
    source = metadata as WorkImport["source"];
    if (source?.kind !== "generic")
      throw new CaptureError("Use selected T3 metadata or a generic v1 source object.");
  }
  for (const ref of options.evidenceRef)
    evidence.push({
      kind: "other",
      ref,
      summary: "Caller-selected reference; outcome and applicability unknown.",
      observedAt,
      provenance: "client_reported",
      outcome: "unknown"
    });
  if (options.git) {
    const revision = git(["rev-parse", "--verify", "HEAD"]);
    if (revision && /^[a-f0-9]{40,64}$/.test(revision)) {
      const state = git(["status", "--porcelain", "--untracked-files=normal"]);
      evidence.push({
        kind: "revision",
        ref: `git:${revision}`,
        summary: `Capture checkout reference only; dirty state ${state === undefined ? "unknown" : state ? "modified" : "clean"}. No source/check linkage; applicability unknown.`,
        observedAt,
        provenance: "client_reported",
        outcome: "unknown"
      });
    }
  }
  const input = {
    schemaVersion: "1",
    source,
    project: options.project ?? githubProject(),
    workflowId: options.workflowId ?? options.workKey,
    workKey: options.workKey,
    task: options.task ?? options.workKey,
    summary: options.summary,
    evidence,
    nextAction: options.nextAction,
    handoff: options.toSource ? { toSource: options.toSource } : {}
  };
  return `${JSON.stringify(parseWorkImport(JSON.stringify(input), process.env.RUNTRAIL_TOKEN), null, 2)}\n`;
}

function git(args: string[]): string | undefined {
  try {
    return execFileSync("git", ["--no-optional-locks", ...args], {
      encoding: "utf8",
      timeout: 1500,
      maxBuffer: 8192,
      stdio: ["ignore", "pipe", "ignore"]
    }).trim();
  } catch {
    return undefined;
  }
}

function githubProject(): string | undefined {
  const remote = git(["config", "--get", "remote.origin.url"]);
  // Exact public host, no credentials, queries, ports, arbitrary URL fetching or paths.
  const match = remote?.match(
    /^(?:git@github\.com:|https:\/\/github\.com\/)([a-zA-Z0-9_-]+)\/([a-zA-Z0-9_.-]+?)(?:\.git)?$/
  );
  return match ? `${match[1]}/${match[2]}` : undefined;
}

function collect(value: string, previous: string[]): string[] {
  return [...previous, value];
}

function readBoundedFile(file: string): string {
  const fd = openSync(file, constants.O_RDONLY | constants.O_NONBLOCK);
  try {
    if (!fstatSync(fd).isFile()) throw new Error("Not a regular file");
    const buffer = Buffer.alloc(MAX_WORK_IMPORT_BYTES + 1);
    let size = 0;
    while (size < buffer.length) {
      const read = readSync(fd, buffer, size, buffer.length - size, null);
      if (!read) break;
      size += read;
    }
    if (size > MAX_WORK_IMPORT_BYTES) throw new Error("Oversize input");
    return buffer.subarray(0, size).toString("utf8");
  } finally {
    closeSync(fd);
  }
}

function saveExclusive(file: string, raw: string): void {
  // Publish a fully written file atomically without replacing an existing target
  // (including symlinks). A failed local save sends no requests.
  const temporary = `${file}.${randomUUID()}.tmp`;
  const fd = openSync(temporary, "wx", 0o600);
  try {
    writeFileSync(fd, raw, "utf8");
    fsyncSync(fd);
    linkSync(temporary, file);
  } finally {
    closeSync(fd);
    unlinkSync(temporary);
  }
}
