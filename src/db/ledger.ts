import { createHash } from "node:crypto";
import type Database from "better-sqlite3";
import { createId } from "../shared/ids.js";
import { compareEventsForReceipts, computeEventHash } from "../shared/receipts.js";
import type {
  AcceptHandoffRequest,
  AgentContext,
  AgentContextQuery,
  AgentEvent,
  AgentRun,
  Artifact,
  CloseStaleRunsRequest,
  CreateArtifactRequest,
  CreateDecisionRequest,
  CreateEventRequest,
  CreateHandoffRequest,
  CreateOpenLoopRequest,
  CreateRunRequest,
  Decision,
  DeclineHandoffRequest,
  FinishRunRequest,
  Handoff,
  HandoffStatus,
  IncrementalContextChanges,
  JournalSearchQuery,
  JournalSearchResults,
  ListArtifactsQuery,
  ListDecisionsQuery,
  ListEventsQuery,
  ListHandoffsQuery,
  ListOpenLoopsQuery,
  ListRunsQuery,
  OpenLoop,
  PauseRunRequest,
  PrepareWorkConflict,
  PrepareWorkDecision,
  PrepareWorkHandoff,
  PrepareWorkManifestSummary,
  PrepareWorkOpenLoop,
  PrepareWorkQuery,
  PrepareWorkRecommendation,
  PrepareWorkResponse,
  PrepareWorkRunSummary,
  RecoveryReceipt,
  RunConflict,
  RunFreshness,
  RunManifest,
  UpdateOpenLoopRequest,
  UpdateRunRequest,
  WorkflowRunSummary,
  WorkflowRunsQuery
} from "../shared/schemas.js";
import { nowIso } from "../shared/time.js";
import {
  type ArtifactRow,
  type DecisionRow,
  type EventRow,
  type HandoffRow,
  mapArtifactRow,
  mapDecisionRow,
  mapEventContextRow,
  mapEventRow,
  mapHandoffRow,
  mapHandoffSummaryRow,
  mapOpenLoopRow,
  mapRunRow,
  normalizeTags,
  normalizeTimestamp,
  type OpenLoopRow,
  type RunRow,
  readChangedFiles,
  searchFilters,
  searchParams,
  stripEventData,
  tagsToJson,
  toSqlValue,
  uniqueStrings,
  whereClause
} from "./ledgerHelpers.js";

const exceptionalEventTypes = ["blocked", "failed", "needs_review", "decision_required"];
const exceptionalEventParams = exceptionalEventTypes.map((_, index) => `@exceptional${index}`);
const decisionProjection = `decisions.*,
  CASE WHEN EXISTS (
    SELECT 1 FROM decisions replacement
    WHERE replacement.supersedes_decision_id = decisions.id
  ) THEN 'superseded' ELSE 'current' END AS state,
  (
    SELECT replacement.id FROM decisions replacement
    WHERE replacement.supersedes_decision_id = decisions.id
    ORDER BY replacement.created_at DESC, replacement.id DESC
    LIMIT 1
  ) AS replacing_decision_id`;

function isUniqueConstraint(error: unknown): boolean {
  return (
    error instanceof Error &&
    "code" in error &&
    String(error.code).startsWith("SQLITE_CONSTRAINT_UNIQUE")
  );
}

type VersionedRecord = AgentRun | OpenLoop | Handoff;

export class VersionConflictError extends Error {
  readonly current: Pick<VersionedRecord, "id" | "status" | "updatedAt" | "version">;

  constructor(
    readonly recordType: "run" | "openLoop" | "handoff",
    readonly expectedVersion: number,
    current: VersionedRecord
  ) {
    super(
      `Expected ${recordType} version ${expectedVersion}, current version is ${current.version}`
    );
    this.name = "VersionConflictError";
    this.current = {
      id: current.id,
      status: current.status,
      updatedAt: current.updatedAt,
      version: current.version
    };
  }
}

export class RunRelationshipError extends Error {
  constructor(
    readonly code: "missing_reference" | "project_mismatch" | "workflow_mismatch",
    readonly field: "parentRunId" | "continuedFromRunId" | "workflowId",
    readonly referenceId: string
  ) {
    super(`Invalid ${field}: ${code}`);
    this.name = "RunRelationshipError";
  }
}

export class ContextCursorError extends Error {
  readonly code = "invalid_cursor";
  readonly action = "retry_without_cursor";

  constructor(message = "Cursor is invalid, unsupported, or belongs to a different query") {
    super(message);
    this.name = "ContextCursorError";
  }
}

export class DecisionSupersessionError extends Error {
  constructor(
    readonly code:
      | "missing_reference"
      | "scope_mismatch"
      | "self_reference"
      | "cycle"
      | "already_superseded",
    readonly referenceId: string,
    readonly replacingDecisionId?: string
  ) {
    super(`Invalid supersedesDecisionId: ${code}`);
    this.name = "DecisionSupersessionError";
  }
}

export class LedgerRepository {
  constructor(private readonly db: Database.Database) {}

  createRun(input: CreateRunRequest): {
    run: AgentRun;
    created: boolean;
    recovery?: RecoveryReceipt;
    conflicts: RunConflict[];
  } {
    if (input.clientRunId) {
      const existing = this.findRunByClientRunId(input.source, input.project, input.clientRunId);
      if (existing) {
        return this.recoverExistingRun(existing);
      }
    }

    const relationships = this.resolveRunRelationships(input);
    const timestamp = nowIso();
    const tags = normalizeTags(input.tags);
    const run: AgentRun = {
      id: createId("run"),
      source: input.source,
      project: input.project,
      agentName: input.agentName,
      agentModel: input.agentModel,
      clientRunId: input.clientRunId,
      workKey: input.workKey,
      ...relationships,
      task: input.task,
      status: input.status,
      hostname: input.hostname,
      cwd: input.cwd,
      gitRepoPath: input.gitRepoPath,
      gitBranch: input.gitBranch,
      gitCommit: input.gitCommit,
      summary: input.summary,
      category: input.category,
      tags,
      version: 1,
      lastLivenessAt: timestamp,
      startedAt: input.startedAt ?? timestamp,
      createdAt: timestamp,
      updatedAt: timestamp
    };

    const transaction = this.db.transaction(() => {
      this.db
        .prepare(
          `INSERT INTO agent_runs (
            id,
            source,
            project,
            agent_name,
            agent_model,
            client_run_id,
            work_key,
            workflow_id,
            parent_run_id,
            continued_from_run_id,
            task,
            status,
            hostname,
            cwd,
            git_repo_path,
            git_branch,
            git_commit,
            summary,
            category,
            tags_json,
            version,
            last_liveness_at,
            started_at,
            completed_at,
            created_at,
            updated_at
          ) VALUES (
            @id,
            @source,
            @project,
            @agentName,
            @agentModel,
            @clientRunId,
            @workKey,
            @workflowId,
            @parentRunId,
            @continuedFromRunId,
            @task,
            @status,
            @hostname,
            @cwd,
            @gitRepoPath,
            @gitBranch,
            @gitCommit,
            @summary,
            @category,
            @tagsJson,
            @version,
            @lastLivenessAt,
            @startedAt,
            @completedAt,
            @createdAt,
            @updatedAt
          )`
        )
        .run({
          ...run,
          agentName: toSqlValue(run.agentName),
          agentModel: toSqlValue(run.agentModel),
          clientRunId: toSqlValue(run.clientRunId),
          workKey: toSqlValue(run.workKey),
          workflowId: toSqlValue(run.workflowId),
          parentRunId: toSqlValue(run.parentRunId),
          continuedFromRunId: toSqlValue(run.continuedFromRunId),
          hostname: toSqlValue(run.hostname),
          cwd: toSqlValue(run.cwd),
          gitRepoPath: toSqlValue(run.gitRepoPath),
          gitBranch: toSqlValue(run.gitBranch),
          gitCommit: toSqlValue(run.gitCommit),
          summary: toSqlValue(run.summary),
          category: toSqlValue(run.category),
          tagsJson: tagsToJson(run.tags),
          completedAt: null
        });
      this.replaceTags("agent_run_tags", "run_id", run.id, run.tags);
    });

    try {
      transaction();
      const recovery = input.clientRunId
        ? this.recordRecovery(run, "create_new", this.findPreviousRun(run))
        : undefined;
      if (recovery) this.ensureRecoveryOutcome(run, recovery);
      return { run, created: true, recovery, conflicts: this.findActiveWorkConflicts(run) };
    } catch (error) {
      if (!input.clientRunId || !isUniqueConstraint(error)) {
        throw error;
      }

      const existing = this.findRunByClientRunId(input.source, input.project, input.clientRunId);

      if (!existing) {
        throw error;
      }

      return this.recoverExistingRun(existing);
    }
  }

  closeStaleRuns(input: CloseStaleRunsRequest): {
    candidates: AgentRun[];
    closed: AgentRun[];
  } {
    const updatedBefore = normalizeTimestamp(input.updatedBefore);
    const candidates = this.db
      .prepare(
        `SELECT *
        FROM agent_runs
        WHERE status = 'running' AND updated_at < @updatedBefore
        ORDER BY updated_at ASC
        LIMIT @limit`
      )
      .all({ updatedBefore, limit: input.limit }) as RunRow[];
    const mappedCandidates = candidates.map(mapRunRow);

    if (!input.apply || mappedCandidates.length === 0) {
      return { candidates: mappedCandidates, closed: [] };
    }

    const completedAt = nowIso();
    const summary = `Closed as stale after no activity since before ${updatedBefore}.`;
    const closed = this.db.transaction(() => {
      const results: AgentRun[] = [];
      const update = this.db.prepare(
        `UPDATE agent_runs
        SET status = 'cancelled',
            summary = @summary,
            completed_at = @completedAt,
            updated_at = @completedAt,
            version = version + 1
        WHERE id = @id
          AND status = 'running'
          AND updated_at < @updatedBefore
          AND version = @expectedVersion`
      );

      for (const candidate of mappedCandidates) {
        const result = update.run({
          id: candidate.id,
          summary,
          completedAt,
          updatedBefore,
          expectedVersion: candidate.version
        });

        if (result.changes === 1) {
          const updated = this.getRun(candidate.id);

          if (updated) {
            if (updated.clientRunId) {
              this.recordRecovery(
                updated,
                "mark_stale",
                undefined,
                `No activity since before ${updatedBefore}`
              );
            }
            results.push(updated);
          }
        }
      }

      return results;
    })();

    return { candidates: mappedCandidates, closed };
  }

  updateRun(id: string, input: UpdateRunRequest): AgentRun | undefined {
    const existing = this.getRun(id);

    if (!existing) {
      return undefined;
    }

    assertExpectedVersion("run", existing, input.expectedVersion);

    const updated: AgentRun = {
      ...existing,
      status: input.status ?? existing.status,
      summary: input.summary === undefined ? existing.summary : (input.summary ?? undefined),
      completedAt:
        input.completedAt === undefined
          ? deriveCompletedAt(existing, input)
          : (input.completedAt ?? undefined),
      gitBranch:
        input.gitBranch === undefined ? existing.gitBranch : (input.gitBranch ?? undefined),
      gitCommit:
        input.gitCommit === undefined ? existing.gitCommit : (input.gitCommit ?? undefined),
      version: existing.version + 1,
      updatedAt: nowIso()
    };

    const result = this.db
      .prepare(
        `UPDATE agent_runs
        SET status = @status,
            summary = @summary,
            completed_at = @completedAt,
            git_branch = @gitBranch,
            git_commit = @gitCommit,
            updated_at = @updatedAt,
            version = version + 1
        WHERE id = @id
          ${input.expectedVersion === undefined ? "" : "AND version = @expectedVersion"}`
      )
      .run({
        ...updated,
        expectedVersion: input.expectedVersion,
        summary: toSqlValue(updated.summary),
        completedAt: toSqlValue(updated.completedAt),
        gitBranch: toSqlValue(updated.gitBranch),
        gitCommit: toSqlValue(updated.gitCommit)
      });

    if (result.changes === 0) {
      const current = this.getRun(id);
      if (current && input.expectedVersion !== undefined) {
        throw new VersionConflictError("run", input.expectedVersion, current);
      }
      return undefined;
    }

    return this.getRun(id);
  }

  heartbeatRun(id: string, expectedVersion?: number): LifecycleResult {
    const run = this.getRun(id);
    if (!run) return { error: "Run not found" };
    assertExpectedVersion("run", run, expectedVersion);
    if (isTerminal(run.status)) return { error: `Cannot heartbeat ${run.status} run` };
    return {
      run: this.updateRunWithLiveness(id, {
        expectedVersion,
        summary: run.summary ?? null
      }) as AgentRun
    };
  }

  resumeRun(id: string, expectedVersion?: number): LifecycleResult {
    const run = this.getRun(id);
    if (!run) return { error: "Run not found" };
    assertExpectedVersion("run", run, expectedVersion);
    if (run.status === "cancelled") return { error: "Cannot resume cancelled run" };
    return {
      run: this.updateRunWithLiveness(id, {
        expectedVersion,
        status: "running",
        summary: run.summary ?? null,
        completedAt: null
      }) as AgentRun
    };
  }

  private updateRunWithLiveness(id: string, input: UpdateRunRequest): AgentRun | undefined {
    return this.db.transaction(() => {
      const updated = this.updateRun(id, input);
      if (!updated) return undefined;
      this.db.prepare("UPDATE agent_runs SET last_liveness_at = ? WHERE id = ?").run(nowIso(), id);
      return this.getRun(id);
    })();
  }

  pauseRun(id: string, input: PauseRunRequest): LifecycleResult {
    const run = this.getRun(id);
    if (!run) return { error: "Run not found" };
    assertExpectedVersion("run", run, input.expectedVersion);
    if (isTerminal(run.status)) return { error: `Cannot pause ${run.status} run` };
    return {
      run: this.updateRun(id, {
        expectedVersion: input.expectedVersion,
        status: input.status,
        summary: input.summary
      }) as AgentRun
    };
  }

  finishRun(id: string, input: FinishRunRequest): LifecycleResult {
    const run = this.getRun(id);
    if (!run) return { error: "Run not found" };
    assertExpectedVersion("run", run, input.expectedVersion);
    if (isTerminal(run.status)) {
      return run.status === input.status
        ? { run }
        : { error: `Run already terminal as ${run.status}` };
    }
    return {
      run: this.updateRun(id, {
        expectedVersion: input.expectedVersion,
        status: input.status,
        summary: input.summary,
        completedAt: input.completedAt,
        gitBranch: input.gitBranch,
        gitCommit: input.gitCommit
      }) as AgentRun
    };
  }

  listRuns(query: ListRunsQuery): AgentRun[] {
    const filters: string[] = [];
    const params: Record<string, string | number> = {
      limit: query.limit
    };

    if (query.project) {
      filters.push("project = @project");
      params.project = query.project;
    }

    if (query.workKey) {
      filters.push("work_key = @workKey");
      params.workKey = query.workKey;
    }

    if (query.status) {
      filters.push("status = @status");
      params.status = query.status;
    }

    if (query.category) {
      filters.push("category = @category");
      params.category = query.category;
    }

    if (query.tag) {
      filters.push(
        "EXISTS (SELECT 1 FROM agent_run_tags WHERE agent_run_tags.run_id = agent_runs.id AND agent_run_tags.tag = @tag)"
      );
      params.tag = query.tag;
    }

    if (query.started_from) {
      filters.push("started_at >= @startedFrom");
      params.startedFrom = normalizeTimestamp(query.started_from);
    }

    if (query.started_to) {
      filters.push("started_at < @startedTo");
      params.startedTo = normalizeTimestamp(query.started_to);
    }

    const whereClause = filters.length > 0 ? `WHERE ${filters.join(" AND ")}` : "";
    const rows = this.db
      .prepare(
        `SELECT *
        FROM agent_runs
        ${whereClause}
        ORDER BY updated_at DESC
        LIMIT @limit`
      )
      .all(params) as RunRow[];

    return rows.map(mapRunRow);
  }

  listWorkflowRuns(
    workflowId: string,
    query: WorkflowRunsQuery
  ): { runs: WorkflowRunSummary[]; truncated: boolean } {
    const rows = this.db
      .prepare(
        `SELECT *
        FROM agent_runs
        WHERE project = @project AND workflow_id = @workflowId
        ORDER BY started_at ASC, id ASC
        LIMIT @limit`
      )
      .all({
        project: query.project,
        workflowId,
        limit: query.limit + 1
      }) as RunRow[];
    const truncated = rows.length > query.limit;

    return {
      runs: rows.slice(0, query.limit).map(mapRunRow).map(toWorkflowRunSummary),
      truncated
    };
  }

  private findActiveWorkConflicts(run: AgentRun): RunConflict[] {
    if (!run.workKey) return [];

    const rows = this.db
      .prepare(
        `SELECT * FROM agent_runs
        WHERE project = @project
          AND work_key = @workKey
          AND id != @id
          AND status NOT IN ('completed', 'failed', 'cancelled')
        ORDER BY updated_at DESC
        LIMIT 10`
      )
      .all({ project: run.project, workKey: run.workKey, id: run.id }) as RunRow[];
    return rows
      .map(mapRunRow)
      .map(({ id, source, project, workKey, task, status, version, updatedAt }) => ({
        id,
        source,
        project,
        workKey,
        task,
        status,
        version,
        updatedAt
      }));
  }

  getRun(id: string): AgentRun | undefined {
    const row = this.db.prepare("SELECT * FROM agent_runs WHERE id = ?").get(id) as
      | RunRow
      | undefined;
    return row ? mapRunRow(row) : undefined;
  }

  private resolveRunRelationships(
    input: CreateRunRequest
  ): Pick<AgentRun, "workflowId" | "parentRunId" | "continuedFromRunId"> {
    const references = [
      ["parentRunId", input.parentRunId],
      ["continuedFromRunId", input.continuedFromRunId]
    ] as const;
    const referencedRuns: Array<{
      field: "parentRunId" | "continuedFromRunId";
      run: AgentRun;
    }> = [];

    for (const [field, referenceId] of references) {
      if (!referenceId) continue;
      const run = this.getRun(referenceId);
      if (!run) {
        throw new RunRelationshipError("missing_reference", field, referenceId);
      }
      if (run.project !== input.project) {
        throw new RunRelationshipError("project_mismatch", field, referenceId);
      }
      referencedRuns.push({ field, run });
    }

    const referencedWorkflowIds = [
      ...new Set(
        referencedRuns
          .map(({ run }) => run.workflowId)
          .filter((workflowId): workflowId is string => workflowId !== undefined)
      )
    ];
    if (referencedWorkflowIds.length > 1) {
      const reference = referencedRuns.find(
        ({ run }) => run.workflowId !== referencedWorkflowIds[0]
      );
      throw new RunRelationshipError(
        "workflow_mismatch",
        reference?.field ?? "workflowId",
        reference?.run.id ?? input.workflowId ?? ""
      );
    }
    const referencedWorkflowId = referencedWorkflowIds[0];
    if (input.workflowId && referencedWorkflowId && input.workflowId !== referencedWorkflowId) {
      throw new RunRelationshipError("workflow_mismatch", "workflowId", input.workflowId);
    }

    return {
      workflowId: input.workflowId ?? referencedWorkflowId,
      parentRunId: input.parentRunId,
      continuedFromRunId: input.continuedFromRunId
    };
  }

  private findRunByClientRunId(
    source: string,
    project: string,
    clientRunId: string
  ): AgentRun | undefined {
    const row = this.db
      .prepare(
        `SELECT * FROM agent_runs
        WHERE source = ? AND project = ? AND client_run_id = ?`
      )
      .get(source, project, clientRunId) as RunRow | undefined;
    return row ? mapRunRow(row) : undefined;
  }

  private recoverExistingRun(existing: AgentRun): {
    run: AgentRun;
    created: false;
    recovery: RecoveryReceipt;
    conflicts: RunConflict[];
  } {
    const action = existing.status === "running" ? "reuse" : "reopen";
    const recovery = this.recordRecovery(existing, action);
    this.ensureRecoveryOutcome(existing, recovery);
    return {
      run: existing,
      created: false,
      recovery,
      conflicts: this.findActiveWorkConflicts(existing)
    };
  }

  private recordRecovery(
    run: AgentRun,
    action: RecoveryReceipt["action"],
    previousRunId?: string,
    staleReason?: string
  ): RecoveryReceipt {
    const receipt: RecoveryReceipt = {
      id: createId("rcv"),
      clientRunId: run.clientRunId ?? "",
      workspaceIdentity: normalizeWorkspaceIdentity(run),
      selectedRunId: run.id,
      previousRunId,
      action,
      staleReason,
      createdAt: nowIso()
    };
    this.db
      .prepare(
        `INSERT OR IGNORE INTO recovery_receipts
      (id, client_run_id, workspace_identity, selected_run_id, previous_run_id, action, stale_reason, created_at)
      VALUES (@id, @clientRunId, @workspaceIdentity, @selectedRunId, @previousRunId, @action, @staleReason, @createdAt)`
      )
      .run({
        ...receipt,
        previousRunId: toSqlValue(receipt.previousRunId),
        staleReason: toSqlValue(receipt.staleReason)
      });
    return this.listRecoveryReceipts(run.id).find((item) => item.action === action) ?? receipt;
  }

  private ensureRecoveryOutcome(run: AgentRun, receipt: RecoveryReceipt): void {
    const existing = this.db
      .prepare("SELECT id FROM agent_events WHERE run_id = ? AND type = 'recovery_outcome' LIMIT 1")
      .get(run.id);
    if (existing) return;
    this.createEvent({
      runId: run.id,
      type: "recovery_outcome",
      message: "Authoritative session run selected",
      importance: 4,
      category: "recovery",
      tags: ["recovery", receipt.action],
      data: { workspaceIdentity: receipt.workspaceIdentity }
    });
  }

  private findPreviousRun(run: AgentRun): string | undefined {
    const identity = normalizeWorkspaceIdentity(run);
    return this.listRuns({ project: run.project, limit: 100 }).find(
      (candidate) => candidate.id !== run.id && normalizeWorkspaceIdentity(candidate) === identity
    )?.id;
  }

  private listRecoveryReceipts(runId: string): RecoveryReceipt[] {
    const rows = this.db
      .prepare("SELECT * FROM recovery_receipts WHERE selected_run_id = ? ORDER BY rowid ASC")
      .all(runId) as RecoveryReceiptRow[];
    return rows.map(mapRecoveryReceipt);
  }

  createEvent(input: CreateEventRequest): AgentEvent | undefined {
    return this.createEventResult(input).event;
  }

  createEventResult(input: CreateEventRequest): {
    event: AgentEvent | undefined;
    created: boolean;
  } {
    const run = this.getRun(input.runId);

    if (!run) {
      return { event: undefined, created: false };
    }

    const tags = normalizeTags(input.tags);
    const event: AgentEvent = {
      id: createId("evt"),
      runId: input.runId,
      clientRecordId: input.clientRecordId,
      type: input.type,
      message: input.message,
      importance: input.importance,
      category: input.category,
      tags,
      data: input.data,
      createdAt: input.createdAt ?? nowIso()
    };

    const transaction = this.db.transaction(() => {
      this.db
        .prepare(
          `INSERT INTO agent_events (
            id,
            run_id,
            client_record_id,
            type,
            message,
            importance,
            category,
            tags_json,
            data_json,
            prev_event_hash,
            event_hash,
            created_at
          ) VALUES (
            @id,
            @runId,
            @clientRecordId,
            @type,
            @message,
            @importance,
            @category,
            @tagsJson,
            @dataJson,
            NULL,
            NULL,
            @createdAt
          )`
        )
        .run({
          ...event,
          clientRecordId: toSqlValue(event.clientRecordId),
          category: toSqlValue(event.category),
          tagsJson: tagsToJson(event.tags),
          dataJson: event.data === undefined ? null : JSON.stringify(event.data)
        });
      this.replaceTags("agent_event_tags", "event_id", event.id, event.tags);

      this.db
        .prepare("UPDATE agent_runs SET updated_at = ? WHERE id = ?")
        .run(event.createdAt, event.runId);

      this.recomputeEventHashes(event.runId);
    });

    try {
      transaction();
    } catch (error) {
      if (!input.clientRecordId || !isUniqueConstraint(error)) {
        throw error;
      }

      const existing = this.db
        .prepare("SELECT * FROM agent_events WHERE run_id = ? AND client_record_id = ?")
        .get(input.runId, input.clientRecordId) as EventRow | undefined;

      if (!existing) {
        throw error;
      }

      return { event: mapEventRow(existing), created: false };
    }

    const stored = this.db
      .prepare("SELECT * FROM agent_events WHERE id = ?")
      .get(event.id) as EventRow;
    return { event: mapEventRow(stored), created: true };
  }

  private replaceTags(
    table: "agent_run_tags" | "agent_event_tags" | "handoff_tags",
    idColumn: "run_id" | "event_id" | "handoff_id",
    id: string,
    tags: string[] | undefined
  ): void {
    this.db.prepare(`DELETE FROM ${table} WHERE ${idColumn} = ?`).run(id);

    if (!tags) {
      return;
    }

    const insert = this.db.prepare(`INSERT INTO ${table} (${idColumn}, tag) VALUES (?, ?)`);

    for (const tag of tags) {
      insert.run(id, tag);
    }
  }

  private recomputeEventHashes(runId: string): void {
    const rows = this.db
      .prepare(
        `SELECT *
        FROM agent_events
        WHERE run_id = ?
        ORDER BY created_at ASC, id ASC`
      )
      .all(runId) as EventRow[];
    let previousHash: string | undefined;

    for (const event of rows.map(mapEventRow).sort(compareEventsForReceipts)) {
      const eventHash = computeEventHash(event, previousHash);
      this.db
        .prepare("UPDATE agent_events SET prev_event_hash = ?, event_hash = ? WHERE id = ?")
        .run(previousHash ?? null, eventHash, event.id);
      previousHash = eventHash;
    }
  }

  listEvents(query: ListEventsQuery): AgentEvent[] {
    const params: Record<string, string | number> = {
      limit: query.limit
    };
    const whereClause = query.runId ? "WHERE run_id = @runId" : "";

    if (query.runId) {
      params.runId = query.runId;
    }

    const rows = this.db
      .prepare(
        `SELECT *
        FROM agent_events
        ${whereClause}
        ORDER BY created_at DESC
        LIMIT @limit`
      )
      .all(params) as EventRow[];

    return rows.map(mapEventRow);
  }

  listEventsForRun(runId: string): AgentEvent[] {
    const rows = this.db
      .prepare(
        `SELECT *
        FROM agent_events
        WHERE run_id = ?
        ORDER BY created_at ASC`
      )
      .all(runId) as EventRow[];

    return rows.map(mapEventRow);
  }

  createOpenLoop(input: CreateOpenLoopRequest): OpenLoop | undefined {
    if (input.sourceRunId && !this.getRun(input.sourceRunId)) {
      return undefined;
    }

    const timestamp = nowIso();
    const openLoop: OpenLoop = {
      id: createId("loop"),
      type: input.type,
      project: input.project,
      clientRecordId: input.clientRecordId,
      title: input.title,
      description: input.description,
      owner: input.owner,
      source: input.source,
      nextAction: input.nextAction,
      blockerRef: input.blockerRef,
      sourceRunId: input.sourceRunId,
      status: "open",
      version: 1,
      createdAt: input.createdAt ?? timestamp,
      updatedAt: timestamp
    };

    try {
      this.db
        .prepare(
          `INSERT INTO open_loops (
            id, type, project, client_record_id, title, description, owner, source,
            next_action, blocker_ref, source_run_id, status, resolution, created_at,
            updated_at, resolved_at, version
          ) VALUES (
            @id, @type, @project, @clientRecordId, @title, @description, @owner, @source,
            @nextAction, @blockerRef, @sourceRunId, @status, @resolution, @createdAt,
            @updatedAt, @resolvedAt, @version
          )`
        )
        .run({
          ...openLoop,
          clientRecordId: toSqlValue(openLoop.clientRecordId),
          description: toSqlValue(openLoop.description),
          owner: toSqlValue(openLoop.owner),
          source: toSqlValue(openLoop.source),
          nextAction: toSqlValue(openLoop.nextAction),
          blockerRef: toSqlValue(openLoop.blockerRef),
          sourceRunId: toSqlValue(openLoop.sourceRunId),
          resolution: null,
          resolvedAt: null
        });
    } catch (error) {
      if (!input.clientRecordId || !isUniqueConstraint(error)) {
        throw error;
      }

      const existing = this.db
        .prepare("SELECT * FROM open_loops WHERE project = ? AND client_record_id = ?")
        .get(input.project, input.clientRecordId) as OpenLoopRow | undefined;
      if (!existing) throw error;
      return mapOpenLoopRow(existing);
    }

    return openLoop;
  }

  updateOpenLoop(id: string, input: UpdateOpenLoopRequest): OpenLoop | undefined {
    const existing = this.getOpenLoop(id);

    if (!existing) {
      return undefined;
    }

    assertExpectedVersion("openLoop", existing, input.expectedVersion);

    if (input.sourceRunId && !this.getRun(input.sourceRunId)) {
      return undefined;
    }

    const updated: OpenLoop = {
      ...existing,
      status: input.status ?? existing.status,
      title: input.title ?? existing.title,
      description:
        input.description === undefined ? existing.description : (input.description ?? undefined),
      owner: input.owner === undefined ? existing.owner : (input.owner ?? undefined),
      source: input.source === undefined ? existing.source : (input.source ?? undefined),
      nextAction:
        input.nextAction === undefined ? existing.nextAction : (input.nextAction ?? undefined),
      blockerRef:
        input.blockerRef === undefined ? existing.blockerRef : (input.blockerRef ?? undefined),
      sourceRunId:
        input.sourceRunId === undefined ? existing.sourceRunId : (input.sourceRunId ?? undefined),
      resolution:
        input.resolution === undefined ? existing.resolution : (input.resolution ?? undefined),
      resolvedAt:
        input.resolvedAt === undefined
          ? deriveResolvedAt(existing, input)
          : (input.resolvedAt ?? undefined),
      version: existing.version + 1,
      updatedAt: nowIso()
    };

    const result = this.db
      .prepare(
        `UPDATE open_loops
        SET status = @status,
            title = @title,
            description = @description,
            owner = @owner,
            source = @source,
            next_action = @nextAction,
            blocker_ref = @blockerRef,
            source_run_id = @sourceRunId,
            resolution = @resolution,
            updated_at = @updatedAt,
            resolved_at = @resolvedAt,
            version = version + 1
        WHERE id = @id
          ${input.expectedVersion === undefined ? "" : "AND version = @expectedVersion"}`
      )
      .run({
        ...updated,
        expectedVersion: input.expectedVersion,
        description: toSqlValue(updated.description),
        owner: toSqlValue(updated.owner),
        source: toSqlValue(updated.source),
        nextAction: toSqlValue(updated.nextAction),
        blockerRef: toSqlValue(updated.blockerRef),
        sourceRunId: toSqlValue(updated.sourceRunId),
        resolution: toSqlValue(updated.resolution),
        resolvedAt: toSqlValue(updated.resolvedAt)
      });

    if (result.changes === 0) {
      const current = this.getOpenLoop(id);
      if (current && input.expectedVersion !== undefined) {
        throw new VersionConflictError("openLoop", input.expectedVersion, current);
      }
      return undefined;
    }

    return this.getOpenLoop(id);
  }

  listOpenLoops(query: ListOpenLoopsQuery): OpenLoop[] {
    const filters: string[] = ["status = @status"];
    const params: Record<string, string | number> = {
      status: query.status,
      limit: query.limit
    };

    if (query.project) {
      filters.push("project = @project");
      params.project = query.project;
    }

    if (query.type) {
      filters.push("type = @type");
      params.type = query.type;
    }

    if (query.owner) {
      filters.push("owner = @owner");
      params.owner = query.owner;
    }

    if (query.source) {
      filters.push("source = @source");
      params.source = query.source;
    }

    if (query.sourceRunId) {
      filters.push("source_run_id = @sourceRunId");
      params.sourceRunId = query.sourceRunId;
    }

    const rows = this.db
      .prepare(
        `SELECT *
        FROM open_loops
        WHERE ${filters.join(" AND ")}
        ORDER BY updated_at DESC
        LIMIT @limit`
      )
      .all(params) as OpenLoopRow[];

    return rows.map(mapOpenLoopRow);
  }

  getOpenLoop(id: string): OpenLoop | undefined {
    const row = this.db.prepare("SELECT * FROM open_loops WHERE id = ?").get(id) as
      | OpenLoopRow
      | undefined;
    return row ? mapOpenLoopRow(row) : undefined;
  }

  createDecision(input: CreateDecisionRequest): Decision {
    const replay = input.clientRecordId
      ? this.findDecisionByClientRecordId(input.project, input.clientRecordId)
      : undefined;
    if (replay) return replay;

    const decision: Decision = {
      id: createId("dec"),
      project: input.project,
      clientRecordId: input.clientRecordId,
      supersedesDecisionId: input.supersedesDecisionId,
      title: input.title,
      decision: input.decision,
      rationale: input.rationale,
      state: "current",
      createdAt: input.createdAt ?? nowIso()
    };
    if (input.supersedesDecisionId) {
      this.validateDecisionSupersession(decision);
    }

    try {
      this.db
        .prepare(
          `INSERT INTO decisions (
            id, project, client_record_id, supersedes_decision_id,
            title, decision, rationale, created_at
          ) VALUES (
            @id, @project, @clientRecordId, @supersedesDecisionId,
            @title, @decision, @rationale, @createdAt
          )`
        )
        .run({
          ...decision,
          project: toSqlValue(decision.project),
          clientRecordId: toSqlValue(decision.clientRecordId),
          supersedesDecisionId: toSqlValue(decision.supersedesDecisionId),
          rationale: toSqlValue(decision.rationale)
        });
    } catch (error) {
      if (isUniqueConstraint(error)) {
        const existing = input.clientRecordId
          ? this.findDecisionByClientRecordId(input.project, input.clientRecordId)
          : undefined;
        if (existing) return existing;
        if (input.supersedesDecisionId) {
          const replacement = this.findDecisionReplacement(input.supersedesDecisionId);
          if (replacement) {
            throw new DecisionSupersessionError(
              "already_superseded",
              input.supersedesDecisionId,
              replacement.id
            );
          }
        }
      }
      throw error;
    }

    return decision;
  }

  getDecision(id: string): Decision | undefined {
    const row = this.db
      .prepare(`SELECT ${decisionProjection} FROM decisions WHERE decisions.id = ?`)
      .get(id) as DecisionRow | undefined;
    return row ? mapDecisionRow(row) : undefined;
  }

  listDecisions(query: ListDecisionsQuery): Decision[] {
    const params: Record<string, string | number> = {
      limit: query.limit
    };
    const filters: string[] = [];

    if (query.project && query.includeGlobal) {
      filters.push("(decisions.project = @project OR decisions.project IS NULL)");
      params.project = query.project;
    } else if (query.project) {
      filters.push("decisions.project = @project");
      params.project = query.project;
    } else if (!query.includeGlobal) {
      filters.push("decisions.project IS NOT NULL");
    }
    if (query.effectiveOnly) {
      filters.push(
        "NOT EXISTS (SELECT 1 FROM decisions replacement WHERE replacement.supersedes_decision_id = decisions.id)"
      );
    }

    const rows = this.db
      .prepare(
        `SELECT ${decisionProjection}
        FROM decisions
        ${whereClause(filters)}
        ORDER BY decisions.created_at DESC, decisions.id DESC
        LIMIT @limit`
      )
      .all(params) as DecisionRow[];

    return rows.map(mapDecisionRow);
  }

  private findDecisionByClientRecordId(
    project: string | undefined,
    clientRecordId: string
  ): Decision | undefined {
    const row = this.db
      .prepare(
        `SELECT ${decisionProjection}
        FROM decisions
        WHERE decisions.project IS ? AND decisions.client_record_id = ?`
      )
      .get(project ?? null, clientRecordId) as DecisionRow | undefined;
    return row ? mapDecisionRow(row) : undefined;
  }

  private findDecisionReplacement(id: string): Decision | undefined {
    const row = this.db
      .prepare(
        `SELECT ${decisionProjection}
        FROM decisions
        WHERE decisions.supersedes_decision_id = ?
        ORDER BY decisions.created_at DESC, decisions.id DESC
        LIMIT 1`
      )
      .get(id) as DecisionRow | undefined;
    return row ? mapDecisionRow(row) : undefined;
  }

  private validateDecisionSupersession(decision: Decision): void {
    const referenceId = decision.supersedesDecisionId as string;
    if (referenceId === decision.id) {
      throw new DecisionSupersessionError("self_reference", referenceId);
    }
    const referenced = this.getDecision(referenceId);
    if (!referenced) {
      throw new DecisionSupersessionError("missing_reference", referenceId);
    }
    if ((referenced.project ?? null) !== (decision.project ?? null)) {
      throw new DecisionSupersessionError("scope_mismatch", referenceId);
    }
    const seen = new Set([decision.id]);
    let current: Decision | undefined = referenced;
    while (current) {
      if (seen.has(current.id)) {
        throw new DecisionSupersessionError("cycle", referenceId);
      }
      seen.add(current.id);
      current = current.supersedesDecisionId
        ? this.getDecision(current.supersedesDecisionId)
        : undefined;
    }

    const replacement = this.findDecisionReplacement(referenceId);
    if (replacement) {
      throw new DecisionSupersessionError("already_superseded", referenceId, replacement.id);
    }
  }

  createHandoff(input: CreateHandoffRequest): Handoff | undefined {
    if (input.sourceRunId && !this.getRun(input.sourceRunId)) {
      return undefined;
    }

    const tags = normalizeTags(input.tags);
    const timestamp = input.createdAt ?? nowIso();
    const handoff: Handoff = {
      id: createId("handoff"),
      sourceRunId: input.sourceRunId,
      clientRecordId: input.clientRecordId,
      fromSource: input.fromSource,
      toSource: input.toSource,
      project: input.project,
      summary: input.summary,
      nextAction: input.nextAction,
      category: input.category,
      tags,
      context: input.context,
      status: "pending",
      version: 1,
      createdAt: timestamp,
      updatedAt: timestamp
    };

    const transaction = this.db.transaction(() => {
      this.db
        .prepare(
          `INSERT INTO handoffs (
            id,
            source_run_id,
            client_record_id,
            from_source,
            to_source,
            project,
            summary,
            next_action,
            category,
            tags_json,
            context_json,
            status,
            version,
            created_at,
            updated_at
          ) VALUES (
            @id,
            @sourceRunId,
            @clientRecordId,
            @fromSource,
            @toSource,
            @project,
            @summary,
            @nextAction,
            @category,
            @tagsJson,
            @contextJson,
            @status,
            @version,
            @createdAt,
            @updatedAt
          )`
        )
        .run({
          ...handoff,
          sourceRunId: toSqlValue(handoff.sourceRunId),
          clientRecordId: toSqlValue(handoff.clientRecordId),
          toSource: toSqlValue(handoff.toSource),
          nextAction: toSqlValue(handoff.nextAction),
          category: toSqlValue(handoff.category),
          tagsJson: tagsToJson(handoff.tags),
          contextJson: handoff.context === undefined ? null : JSON.stringify(handoff.context)
        });
      this.replaceTags("handoff_tags", "handoff_id", handoff.id, handoff.tags);
    });

    try {
      transaction();
    } catch (error) {
      if (!input.clientRecordId || !isUniqueConstraint(error)) {
        throw error;
      }

      const existing = this.db
        .prepare("SELECT * FROM handoffs WHERE project = ? AND client_record_id = ?")
        .get(input.project, input.clientRecordId) as HandoffRow | undefined;
      if (!existing) throw error;
      return mapHandoffRow(existing);
    }

    return handoff;
  }

  listHandoffs(query: ListHandoffsQuery): Handoff[] {
    const filters: string[] = [];
    const params: Record<string, string | number> = {
      limit: query.limit
    };

    if (query.project) {
      filters.push("project = @project");
      params.project = query.project;
    }

    if (query.sourceRunId) {
      filters.push("source_run_id = @sourceRunId");
      params.sourceRunId = query.sourceRunId;
    }

    if (query.toSource) {
      filters.push("to_source = @toSource");
      params.toSource = query.toSource;
    }

    if (query.status !== "all") {
      filters.push("status = @status");
      params.status = query.status;
    }

    const whereClause = filters.length > 0 ? `WHERE ${filters.join(" AND ")}` : "";
    const rows = this.db
      .prepare(
        `SELECT *
        FROM handoffs
        ${whereClause}
        ORDER BY updated_at DESC, id DESC
        LIMIT @limit`
      )
      .all(params) as HandoffRow[];

    return rows.map(mapHandoffRow);
  }

  getHandoff(id: string): Handoff | undefined {
    const row = this.db.prepare("SELECT * FROM handoffs WHERE id = ?").get(id) as
      | HandoffRow
      | undefined;
    return row ? mapHandoffRow(row) : undefined;
  }

  acceptHandoff(id: string, input: AcceptHandoffRequest): HandoffLifecycleResult {
    return this.db.transaction(() => {
      const handoff = this.getHandoff(id);
      if (!handoff) return { error: "Handoff not found" };
      assertExpectedVersion("handoff", handoff, input.expectedVersion);
      if (handoff.status !== "pending") {
        return { error: `Cannot accept ${handoff.status} handoff` };
      }

      let targetRun: AgentRun | undefined;
      if (input.targetRunId) {
        targetRun = this.getRun(input.targetRunId);
        if (!targetRun) return { error: "Target run not found" };
        if (targetRun.project !== handoff.project) {
          return { error: "Target run must belong to the handoff project" };
        }
      } else if (input.run) {
        if (input.run.project !== handoff.project) {
          return { error: "Receiving run must belong to the handoff project" };
        }
        if (
          handoff.sourceRunId &&
          input.run.continuedFromRunId &&
          input.run.continuedFromRunId !== handoff.sourceRunId
        ) {
          return { error: "Receiving run must continue from the handoff source run" };
        }

        targetRun = this.createRun({
          ...input.run,
          continuedFromRunId: input.run.continuedFromRunId ?? handoff.sourceRunId
        }).run;
      }

      if (!targetRun) return { error: "Receiving run is required" };
      const timestamp = nowIso();
      const result = this.db
        .prepare(
          `UPDATE handoffs
          SET status = 'accepted',
              accepted_by = @acceptedBy,
              accepted_at = @acceptedAt,
              target_run_id = @targetRunId,
              updated_at = @updatedAt,
              version = version + 1
          WHERE id = @id
            AND status = 'pending'
            AND version = @expectedVersion`
        )
        .run({
          id,
          acceptedBy: input.acceptedBy,
          acceptedAt: timestamp,
          targetRunId: targetRun.id,
          updatedAt: timestamp,
          expectedVersion: input.expectedVersion
        });

      if (result.changes === 0) {
        const current = this.getHandoff(id);
        if (current) throw new VersionConflictError("handoff", input.expectedVersion, current);
        return { error: "Handoff not found" };
      }

      return { handoff: this.getHandoff(id) as Handoff, targetRun };
    })();
  }

  declineHandoff(id: string, input: DeclineHandoffRequest): HandoffLifecycleResult {
    return this.transitionHandoff(id, "pending", "declined", input.expectedVersion, {
      declineReason: input.reason
    });
  }

  completeHandoff(id: string, expectedVersion: number): HandoffLifecycleResult {
    return this.transitionHandoff(id, "accepted", "completed", expectedVersion);
  }

  expireHandoff(id: string, expectedVersion: number): HandoffLifecycleResult {
    return this.transitionHandoff(id, "pending", "expired", expectedVersion);
  }

  private transitionHandoff(
    id: string,
    fromStatus: HandoffStatus,
    toStatus: HandoffStatus,
    expectedVersion: number,
    options: { declineReason?: string } = {}
  ): HandoffLifecycleResult {
    const handoff = this.getHandoff(id);
    if (!handoff) return { error: "Handoff not found" };
    assertExpectedVersion("handoff", handoff, expectedVersion);
    if (handoff.status !== fromStatus) {
      return { error: `Cannot mark ${handoff.status} handoff as ${toStatus}` };
    }

    const timestamp = nowIso();
    const result = this.db
      .prepare(
        `UPDATE handoffs
        SET status = @toStatus,
            completed_at = @completedAt,
            decline_reason = @declineReason,
            updated_at = @updatedAt,
            version = version + 1
        WHERE id = @id
          AND status = @fromStatus
          AND version = @expectedVersion`
      )
      .run({
        id,
        fromStatus,
        toStatus,
        completedAt: toStatus === "completed" ? timestamp : null,
        declineReason: toSqlValue(options.declineReason),
        updatedAt: timestamp,
        expectedVersion
      });

    if (result.changes === 0) {
      const current = this.getHandoff(id);
      if (current) throw new VersionConflictError("handoff", expectedVersion, current);
      return { error: "Handoff not found" };
    }

    return { handoff: this.getHandoff(id) as Handoff };
  }

  createArtifact(input: CreateArtifactRequest): Artifact | undefined {
    if (!this.getRun(input.runId)) {
      return undefined;
    }

    const artifact: Artifact = {
      id: createId("art"),
      runId: input.runId,
      clientRecordId: input.clientRecordId,
      kind: input.kind,
      path: input.path,
      sizeBytes: input.sizeBytes,
      sha256: input.sha256,
      createdAt: input.createdAt ?? nowIso()
    };

    try {
      this.db
        .prepare(
          `INSERT INTO artifacts (
            id, run_id, client_record_id, kind, path, size_bytes, sha256, created_at
          ) VALUES (
            @id, @runId, @clientRecordId, @kind, @path, @sizeBytes, @sha256, @createdAt
          )`
        )
        .run({
          ...artifact,
          clientRecordId: toSqlValue(artifact.clientRecordId),
          sizeBytes: toSqlValue(artifact.sizeBytes),
          sha256: toSqlValue(artifact.sha256)
        });
    } catch (error) {
      if (!input.clientRecordId || !isUniqueConstraint(error)) {
        throw error;
      }

      const existing = this.db
        .prepare("SELECT * FROM artifacts WHERE run_id = ? AND client_record_id = ?")
        .get(input.runId, input.clientRecordId) as ArtifactRow | undefined;
      if (!existing) throw error;
      return mapArtifactRow(existing);
    }

    return artifact;
  }

  listArtifacts(query: ListArtifactsQuery): Artifact[] {
    const filters: string[] = [];
    const params: Record<string, string | number> = {
      limit: query.limit
    };

    if (query.runId) {
      filters.push("run_id = @runId");
      params.runId = query.runId;
    }

    if (query.kind) {
      filters.push("kind = @kind");
      params.kind = query.kind;
    }

    const whereClause = filters.length > 0 ? `WHERE ${filters.join(" AND ")}` : "";
    const rows = this.db
      .prepare(
        `SELECT *
        FROM artifacts
        ${whereClause}
        ORDER BY created_at DESC
        LIMIT @limit`
      )
      .all(params) as ArtifactRow[];

    return rows.map(mapArtifactRow);
  }

  searchJournal(query: JournalSearchQuery): JournalSearchResults {
    const params = searchParams(query);
    const runFilters = searchFilters(query, "agent_runs", ["task", "summary", "project", "source"]);
    const eventFilters = searchFilters(query, "agent_events", ["message"], "agent_runs");
    const openLoopFilters = searchFilters(query, "open_loops", [
      "title",
      "description",
      "next_action",
      "blocker_ref",
      "project",
      "source",
      "owner"
    ]);
    const handoffFilters = searchFilters(query, "handoffs", [
      "summary",
      "next_action",
      "project",
      "from_source",
      "to_source"
    ]);
    const decisionFilters = searchFilters(query, "decisions", [
      "title",
      "decision",
      "rationale",
      "project"
    ]);
    if (query.effectiveOnly) {
      decisionFilters.push(
        "NOT EXISTS (SELECT 1 FROM decisions replacement WHERE replacement.supersedes_decision_id = decisions.id)"
      );
    }

    const runs = this.db
      .prepare(
        `SELECT *
        FROM agent_runs
        ${whereClause(runFilters)}
        ORDER BY updated_at DESC
        LIMIT @limit`
      )
      .all(params) as RunRow[];
    const events = this.db
      .prepare(
        `SELECT agent_events.*
        FROM agent_events
        INNER JOIN agent_runs ON agent_runs.id = agent_events.run_id
        ${whereClause(eventFilters)}
        ORDER BY agent_events.created_at DESC
        LIMIT @limit`
      )
      .all(params) as EventRow[];
    const openLoops = this.db
      .prepare(
        `SELECT *
        FROM open_loops
        ${whereClause(openLoopFilters)}
        ORDER BY updated_at DESC
        LIMIT @limit`
      )
      .all(params) as OpenLoopRow[];
    const handoffs = this.db
      .prepare(
        `SELECT *
        FROM handoffs
        ${whereClause(handoffFilters)}
        ORDER BY created_at DESC
        LIMIT @limit`
      )
      .all(params) as HandoffRow[];
    const decisions = this.db
      .prepare(
        `SELECT ${decisionProjection}
        FROM decisions
        ${whereClause(decisionFilters)}
        ORDER BY decisions.created_at DESC, decisions.id DESC
        LIMIT @limit`
      )
      .all(params) as DecisionRow[];

    return {
      runs: runs.map(mapRunRow),
      events: events.map(mapEventContextRow),
      open_loops: openLoops.map(mapOpenLoopRow),
      handoffs: handoffs.map(mapHandoffRow),
      decisions: decisions.map(mapDecisionRow)
    };
  }

  getRunManifest(id: string): RunManifest | undefined {
    const run = this.getRun(id);

    if (!run) {
      return undefined;
    }

    const events = this.listEventsForRun(id);
    const openLoops = this.db
      .prepare(
        `SELECT *
        FROM open_loops
        WHERE source_run_id = @runId
        ORDER BY updated_at DESC`
      )
      .all({ runId: id }) as OpenLoopRow[];

    return {
      run,
      advisory_conflicts: this.findActiveWorkConflicts(run),
      events: events.map(stripEventData),
      changed_files: uniqueStrings(events.flatMap(readChangedFiles)),
      commands: events
        .filter((event) => event.type === "command_executed")
        .map(projectCommandEvidence),
      tests: events
        .filter((event) => event.type.startsWith("test_"))
        .map(({ id, type, message, createdAt }) => ({ id, type, message, createdAt })),
      open_loops: openLoops.map(mapOpenLoopRow),
      handoffs: this.listHandoffs({ sourceRunId: id, status: "all", limit: 100 }),
      artifacts: this.listArtifacts({ runId: id, limit: 100 }),
      recovery_receipts: this.listRecoveryReceipts(id)
    };
  }

  prepareWork(query: PrepareWorkQuery, staleAfterSeconds: number): PrepareWorkResponse | undefined {
    const asOf = nowIso();
    const selected = query.runId ? this.getRun(query.runId) : undefined;
    if (
      query.runId &&
      (!selected ||
        selected.project !== query.project ||
        (query.source !== undefined && selected.source !== query.source) ||
        (query.workKey !== undefined && selected.workKey !== query.workKey) ||
        (query.category !== undefined && selected.category !== query.category) ||
        query.tags.some((tag) => !selected.tags?.includes(tag)))
    ) {
      return undefined;
    }
    const cursorEnvelope = this.contextCursorEnvelope(
      {
        kind: "prepare-work",
        project: query.project,
        source: query.source,
        workKey: query.workKey,
        runId: query.runId,
        category: query.category,
        tags: [...query.tags].sort()
      },
      query.cursor,
      query.project,
      query.limit
    );

    const runFilters = ["project = @project"];
    const runParams: Record<string, string | number> = {
      project: query.project,
      limit: query.limit + 1
    };
    if (query.source) {
      runFilters.push("source = @source");
      runParams.source = query.source;
    }
    if (query.workKey) {
      runFilters.push("work_key = @workKey");
      runParams.workKey = query.workKey;
    }
    if (query.category) {
      runFilters.push("category = @category");
      runParams.category = query.category;
    }
    if (selected) {
      runFilters.push("id != @selectedRunId");
      runParams.selectedRunId = selected.id;
    }
    for (const [index, tag] of query.tags.entries()) {
      const key = `tag${index}`;
      runFilters.push(
        `EXISTS (SELECT 1 FROM agent_run_tags WHERE agent_run_tags.run_id = agent_runs.id AND agent_run_tags.tag = @${key})`
      );
      runParams[key] = tag;
    }

    const relevantResult = takeBounded(
      (
        this.db
          .prepare(
            `SELECT * FROM agent_runs
            WHERE ${runFilters.join(" AND ")}
            ORDER BY updated_at DESC, id ASC
            LIMIT @limit`
          )
          .all(runParams) as RunRow[]
      ).map(mapRunRow),
      query.limit
    );

    const selectedSummary = selected
      ? toPrepareWorkRunSummary(selected, asOf, staleAfterSeconds)
      : undefined;
    const relevantRuns = relevantResult.items.map((run) =>
      toPrepareWorkRunSummary(run, asOf, staleAfterSeconds)
    );
    const conflictWorkKey = query.workKey ?? selected?.workKey;
    const conflictResult = conflictWorkKey
      ? takeBounded(
          (
            this.db
              .prepare(
                `SELECT * FROM agent_runs
                WHERE project = @project
                  AND work_key = @workKey
                  AND (@selectedRunId IS NULL OR id != @selectedRunId)
                  AND status NOT IN ('completed', 'failed', 'cancelled')
                ORDER BY updated_at DESC, id ASC
                LIMIT @limit`
              )
              .all({
                project: query.project,
                workKey: conflictWorkKey,
                selectedRunId: selected?.id ?? null,
                limit: query.limit + 1
              }) as RunRow[]
          ).map(mapRunRow),
          query.limit
        )
      : { items: [], truncated: false };
    const conflicts = conflictResult.items.map((run): PrepareWorkConflict => {
      const summary = toPrepareWorkRunSummary(run, asOf, staleAfterSeconds);
      return {
        ...summary,
        conflictCode:
          summary.freshness.state === "fresh"
            ? "active_work_conflict"
            : summary.freshness.state === "stale_candidate"
              ? "stale_work_warning"
              : "work_freshness_unknown"
      };
    });

    const workflowResult = selected?.workflowId
      ? takeBounded(
          (
            this.db
              .prepare(
                `SELECT * FROM agent_runs
                WHERE project = @project AND workflow_id = @workflowId AND id != @selectedRunId
                ORDER BY started_at ASC, id ASC
                LIMIT @limit`
              )
              .all({
                project: query.project,
                workflowId: selected.workflowId,
                selectedRunId: selected.id,
                limit: query.limit + 1
              }) as RunRow[]
          ).map(mapRunRow),
          query.limit
        )
      : { items: [], truncated: false };
    const workflowRuns = workflowResult.items.map((run) =>
      toPrepareWorkRunSummary(run, asOf, staleAfterSeconds)
    );

    const handoffFilters = ["project = @project", "status = 'pending'"];
    const handoffParams: Record<string, string | number> = {
      project: query.project,
      limit: query.limit + 1
    };
    if (selected && query.source) {
      handoffFilters.push("(source_run_id = @selectedRunId OR to_source = @source)");
      handoffParams.selectedRunId = selected.id;
      handoffParams.source = query.source;
    } else if (selected) {
      handoffFilters.push("source_run_id = @selectedRunId");
      handoffParams.selectedRunId = selected.id;
    } else if (query.source) {
      handoffFilters.push("to_source = @source");
      handoffParams.source = query.source;
    }
    const handoffResult = takeBounded(
      (
        this.db
          .prepare(
            `SELECT * FROM handoffs
            WHERE ${handoffFilters.join(" AND ")}
            ORDER BY updated_at DESC, id ASC
            LIMIT @limit`
          )
          .all(handoffParams) as HandoffRow[]
      ).map(mapHandoffRow),
      query.limit
    );
    const pendingHandoffs = handoffResult.items.map(toPrepareWorkHandoff);

    const loopFilters = ["project = @project", "status = 'open'"];
    const loopParams: Record<string, string | number> = {
      project: query.project,
      limit: query.limit + 1
    };
    if (selected && query.source) {
      loopFilters.push("(source_run_id = @selectedRunId OR source = @source)");
      loopParams.selectedRunId = selected.id;
      loopParams.source = query.source;
    } else if (selected) {
      loopFilters.push("source_run_id = @selectedRunId");
      loopParams.selectedRunId = selected.id;
    } else if (query.source) {
      loopFilters.push("source = @source");
      loopParams.source = query.source;
    }
    const loopResult = takeBounded(
      (
        this.db
          .prepare(
            `SELECT * FROM open_loops
            WHERE ${loopFilters.join(" AND ")}
            ORDER BY updated_at DESC, id ASC
            LIMIT @limit`
          )
          .all(loopParams) as OpenLoopRow[]
      ).map(mapOpenLoopRow),
      query.limit
    );
    const openLoops = loopResult.items.map(toPrepareWorkOpenLoop);
    const effectiveDecisionResult = takeBounded(
      this.listDecisions({
        project: query.project,
        includeGlobal: true,
        effectiveOnly: true,
        limit: query.limit + 1
      }),
      query.limit
    );
    const effectiveDecisions = effectiveDecisionResult.items.map(toPrepareWorkDecision);

    const recommendationsResult = takeBounded(
      prepareWorkRecommendations(selectedSummary, conflicts, pendingHandoffs, openLoops),
      query.limit
    );
    const truncatedSections = [
      ["relevantRuns", relevantResult.truncated],
      ["workflowRuns", workflowResult.truncated],
      ["conflicts", conflictResult.truncated],
      ["pendingHandoffs", handoffResult.truncated],
      ["openLoops", loopResult.truncated],
      ["effectiveDecisions", effectiveDecisionResult.truncated],
      ["recommendations", recommendationsResult.truncated]
    ] as const;
    const warningLimit = Math.min(query.limit, 6);
    const warningResult = takeBounded(
      truncatedSections
        .filter(([, truncated]) => truncated)
        .map(([section]) => ({ code: "section_truncated" as const, section })),
      warningLimit
    );
    const manifestRun = selected ?? relevantResult.items[0];

    return {
      project: query.project,
      asOf,
      staleAfterSeconds,
      ...cursorEnvelope,
      selectedRun: selectedSummary,
      relevantRuns,
      workflowRuns,
      conflicts,
      pendingHandoffs,
      openLoops,
      effectiveDecisions,
      latestManifest: manifestRun ? this.getPrepareWorkManifestSummary(manifestRun) : undefined,
      recommendations: recommendationsResult.items,
      warnings: warningResult.items,
      sections: {
        relevantRuns: sectionMeta(query.limit, relevantRuns.length, relevantResult.truncated),
        workflowRuns: sectionMeta(query.limit, workflowRuns.length, workflowResult.truncated),
        conflicts: sectionMeta(query.limit, conflicts.length, conflictResult.truncated),
        pendingHandoffs: sectionMeta(query.limit, pendingHandoffs.length, handoffResult.truncated),
        openLoops: sectionMeta(query.limit, openLoops.length, loopResult.truncated),
        effectiveDecisions: sectionMeta(
          query.limit,
          effectiveDecisions.length,
          effectiveDecisionResult.truncated
        ),
        recommendations: sectionMeta(
          query.limit,
          recommendationsResult.items.length,
          recommendationsResult.truncated
        ),
        warnings: sectionMeta(warningLimit, warningResult.items.length, warningResult.truncated)
      }
    };
  }

  private getPrepareWorkManifestSummary(run: AgentRun): PrepareWorkManifestSummary {
    const row = this.db
      .prepare(
        `SELECT
          (SELECT COUNT(*) FROM agent_events WHERE run_id = @runId) AS event_count,
          (SELECT COUNT(*) FROM open_loops WHERE source_run_id = @runId) AS open_loop_count,
          (SELECT COUNT(*) FROM handoffs WHERE source_run_id = @runId) AS handoff_count,
          (SELECT COUNT(*) FROM artifacts WHERE run_id = @runId) AS artifact_count,
          (SELECT MAX(created_at) FROM agent_events WHERE run_id = @runId) AS last_event_at`
      )
      .get({ runId: run.id }) as {
      event_count: number;
      open_loop_count: number;
      handoff_count: number;
      artifact_count: number;
      last_event_at: string | null;
    };
    return {
      runId: run.id,
      status: run.status,
      eventCount: row.event_count,
      openLoopCount: row.open_loop_count,
      handoffCount: row.handoff_count,
      artifactCount: row.artifact_count,
      lastEventAt: row.last_event_at ?? undefined
    };
  }

  private contextCursorEnvelope(
    scope: Record<string, unknown>,
    cursor: string | undefined,
    project: string,
    limit: number
  ): {
    mode: "full" | "incremental";
    cursor: string;
    changes?: IncrementalContextChanges;
  } {
    const scopeHash = createHash("sha256").update(JSON.stringify(scope)).digest("base64url");
    if (!cursor) {
      const row = this.db
        .prepare("SELECT COALESCE(MAX(sequence), 0) AS sequence FROM ledger_changes")
        .get() as {
        sequence: number;
      };
      return {
        mode: "full",
        cursor: encodeContextCursor(scopeHash, {
          runs: row.sequence,
          events: row.sequence,
          openLoops: row.sequence,
          handoffs: row.sequence,
          decisions: row.sequence
        })
      };
    }

    const parsed = decodeContextCursor(cursor, scopeHash);
    const sections = {} as IncrementalContextChanges["sections"];
    const next = { ...parsed.sections };
    const idsByType = {} as Record<ContextChangeType, string[]>;
    for (const type of contextChangeTypes) {
      const result = this.changedRecordIds(
        type,
        project,
        parsed.sections[type],
        limit,
        type === "decisions"
      );
      idsByType[type] = result.ids;
      next[type] = result.sequence;
      sections[type] = {
        limit,
        count: result.ids.length,
        truncated: result.truncated
      };
    }

    return {
      mode: "incremental",
      cursor: encodeContextCursor(scopeHash, next),
      changes: {
        runs: this.rowsByIds<RunRow>("agent_runs", idsByType.runs)
          .map(mapRunRow)
          .map(toIncrementalRun),
        events: this.rowsByIds<EventRow>("agent_events", idsByType.events)
          .map(mapEventContextRow)
          .map(toIncrementalEvent),
        openLoops: this.rowsByIds<OpenLoopRow>("open_loops", idsByType.openLoops)
          .map(mapOpenLoopRow)
          .map(toIncrementalOpenLoop),
        handoffs: this.rowsByIds<HandoffRow>("handoffs", idsByType.handoffs)
          .map(mapHandoffSummaryRow)
          .map(toIncrementalHandoff),
        decisions: this.rowsByIds<DecisionRow>("decisions", idsByType.decisions)
          .map(mapDecisionRow)
          .map(({ id, project, supersedesDecisionId, state, replacingDecisionId, createdAt }) => ({
            id,
            project,
            supersedesDecisionId,
            state,
            replacingDecisionId,
            createdAt
          })),
        sections
      }
    };
  }

  private changedRecordIds(
    type: ContextChangeType,
    project: string,
    after: number,
    limit: number,
    includeGlobal: boolean
  ): { ids: string[]; sequence: number; truncated: boolean } {
    const rows = this.db
      .prepare(
        `SELECT record_id, MAX(sequence) AS sequence
        FROM ledger_changes
        WHERE record_type = @type
          AND sequence > @after
          AND (project = @project ${includeGlobal ? "OR project IS NULL" : ""})
        GROUP BY record_id
        ORDER BY sequence ASC, record_id ASC
        LIMIT @limit`
      )
      .all({ type, after, project, limit: limit + 1 }) as Array<{
      record_id: string;
      sequence: number;
    }>;
    const delivered = rows.slice(0, limit);
    return {
      ids: delivered.map((row) => row.record_id),
      sequence: delivered.at(-1)?.sequence ?? after,
      truncated: rows.length > limit
    };
  }

  private rowsByIds<T extends { id: string }>(
    table: "agent_runs" | "agent_events" | "open_loops" | "handoffs" | "decisions",
    ids: string[]
  ): T[] {
    if (ids.length === 0) return [];
    const placeholders = ids.map(() => "?").join(", ");
    const rows = this.db
      .prepare(`SELECT * FROM ${table} WHERE id IN (${placeholders})`)
      .all(...ids) as T[];
    const order = new Map(ids.map((id, index) => [id, index]));
    return rows.sort((left, right) => (order.get(left.id) ?? 0) - (order.get(right.id) ?? 0));
  }

  getAgentContext(query: AgentContextQuery): AgentContext {
    const cursorEnvelope = this.contextCursorEnvelope(
      {
        kind: "context",
        project: query.project,
        minImportance: query.min_importance
      },
      query.cursor,
      query.project,
      query.limit
    );
    if (cursorEnvelope.mode === "incremental") {
      return {
        project: query.project,
        recent_runs: [],
        failed_runs: [],
        recent_events: [],
        pending_handoffs: [],
        recent_handoffs: [],
        open_loops: [],
        decisions: [],
        next_actions: [],
        ...cursorEnvelope
      };
    }
    const params = {
      project: query.project,
      limit: query.limit,
      minImportance: query.min_importance,
      ...Object.fromEntries(
        exceptionalEventTypes.map((type, index) => [`exceptional${index}`, type])
      )
    };

    const recentRuns = this.db
      .prepare(
        `SELECT *
        FROM agent_runs
        WHERE project = @project
        ORDER BY updated_at DESC
        LIMIT @limit`
      )
      .all(params) as RunRow[];

    const recentEvents = this.db
      .prepare(
        `SELECT
          agent_events.id,
          agent_events.run_id,
          agent_events.type,
          agent_events.message,
          agent_events.importance,
          agent_events.category,
          agent_events.tags_json,
          NULL AS data_json,
          agent_events.created_at
        FROM agent_events
        INNER JOIN agent_runs ON agent_runs.id = agent_events.run_id
        WHERE agent_runs.project = @project
          AND (
            agent_events.importance >= @minImportance
            OR agent_events.type IN (${exceptionalEventParams.join(", ")})
          )
        ORDER BY agent_events.created_at DESC
        LIMIT @limit`
      )
      .all(params) as EventRow[];

    const failedRuns = this.db
      .prepare(
        `SELECT *
        FROM agent_runs
        WHERE project = @project
          AND status = 'failed'
        ORDER BY updated_at DESC
        LIMIT @limit`
      )
      .all(params) as RunRow[];

    const openLoops = this.db
      .prepare(
        `SELECT *
        FROM open_loops
        WHERE project = @project
          AND status = 'open'
        ORDER BY updated_at DESC
        LIMIT @limit`
      )
      .all(params) as OpenLoopRow[];

    const handoffs = this.db
      .prepare(
        `SELECT
          id,
          source_run_id,
          client_record_id,
          from_source,
          to_source,
          project,
          summary,
          next_action,
          category,
          tags_json,
          NULL AS context_json,
          status,
          accepted_by,
          accepted_at,
          target_run_id,
          completed_at,
          decline_reason,
          version,
          created_at,
          updated_at
        FROM handoffs
        WHERE project = @project
        ORDER BY updated_at DESC
        LIMIT @limit`
      )
      .all(params) as HandoffRow[];

    const pendingHandoffs = this.db
      .prepare(
        `SELECT *
        FROM handoffs
        WHERE project = @project
          AND status = 'pending'
        ORDER BY updated_at DESC
        LIMIT @limit`
      )
      .all(params) as HandoffRow[];

    const decisions = this.db
      .prepare(
        `SELECT ${decisionProjection}
        FROM decisions
        WHERE (decisions.project = @project OR decisions.project IS NULL)
          AND NOT EXISTS (
            SELECT 1 FROM decisions replacement
            WHERE replacement.supersedes_decision_id = decisions.id
          )
        ORDER BY decisions.created_at DESC, decisions.id DESC
        LIMIT @limit`
      )
      .all(params) as DecisionRow[];

    return {
      project: query.project,
      recent_runs: recentRuns.map(mapRunRow),
      failed_runs: failedRuns.map(mapRunRow),
      recent_events: recentEvents.map(mapEventContextRow),
      pending_handoffs: pendingHandoffs.map(mapHandoffSummaryRow),
      recent_handoffs: handoffs.map(mapHandoffSummaryRow),
      open_loops: openLoops.map(mapOpenLoopRow),
      decisions: decisions.map(mapDecisionRow),
      next_actions: openLoops.map((loop) => loop.next_action ?? loop.title),
      ...cursorEnvelope
    };
  }
}

const contextChangeTypes = ["runs", "events", "openLoops", "handoffs", "decisions"] as const;
type ContextChangeType = (typeof contextChangeTypes)[number];
type ContextCursorSections = Record<ContextChangeType, number>;
type ContextCursorPayload = { version: 1; scope: string; sections: ContextCursorSections };

function encodeContextCursor(scope: string, sections: ContextCursorSections): string {
  return Buffer.from(JSON.stringify({ version: 1, scope, sections })).toString("base64url");
}

function decodeContextCursor(cursor: string, expectedScope: string): ContextCursorPayload {
  try {
    const parsed = JSON.parse(Buffer.from(cursor, "base64url").toString("utf8")) as unknown;
    if (!isRecord(parsed) || parsed.version !== 1 || parsed.scope !== expectedScope) {
      throw new ContextCursorError();
    }
    const sections = parsed.sections;
    if (
      !isRecord(sections) ||
      contextChangeTypes.some(
        (type) =>
          !Number.isSafeInteger(sections[type]) ||
          typeof sections[type] !== "number" ||
          sections[type] < 0
      )
    ) {
      throw new ContextCursorError();
    }
    return parsed as ContextCursorPayload;
  } catch (error) {
    if (error instanceof ContextCursorError) throw error;
    throw new ContextCursorError();
  }
}

function toIncrementalRun(run: AgentRun): IncrementalContextChanges["runs"][number] {
  const {
    id,
    source,
    project,
    workKey,
    workflowId,
    parentRunId,
    continuedFromRunId,
    status,
    category,
    tags,
    version,
    startedAt,
    updatedAt
  } = run;
  return {
    id,
    source,
    project,
    workKey,
    workflowId,
    parentRunId,
    continuedFromRunId,
    status,
    category,
    tags,
    version,
    startedAt,
    updatedAt
  };
}

function toIncrementalEvent(
  event: Omit<AgentEvent, "data">
): IncrementalContextChanges["events"][number] {
  const { id, runId, type, importance, category, tags, createdAt } = event;
  return { id, runId, type, importance, category, tags, createdAt };
}

function toIncrementalOpenLoop(openLoop: OpenLoop): IncrementalContextChanges["openLoops"][number] {
  const { id, type, project, owner, source, sourceRunId, status, version, updatedAt } = openLoop;
  return { id, type, project, owner, source, sourceRunId, status, version, updatedAt };
}

function toIncrementalHandoff(handoff: Handoff): IncrementalContextChanges["handoffs"][number] {
  const {
    id,
    sourceRunId,
    fromSource,
    toSource,
    project,
    status,
    targetRunId,
    version,
    updatedAt
  } = handoff;
  return {
    id,
    sourceRunId,
    fromSource,
    toSource,
    project,
    status,
    targetRunId,
    version,
    updatedAt
  };
}

type RecoveryReceiptRow = {
  id: string;
  client_run_id: string;
  workspace_identity: string;
  selected_run_id: string;
  previous_run_id: string | null;
  action: RecoveryReceipt["action"];
  stale_reason: string | null;
  created_at: string;
};

type LifecycleResult = { run: AgentRun; error?: never } | { run?: never; error: string };
type HandoffLifecycleResult =
  | { handoff: Handoff; targetRun?: AgentRun; error?: never }
  | { handoff?: never; targetRun?: never; error: string };

function isTerminal(status: AgentRun["status"]): boolean {
  return ["completed", "failed", "cancelled"].includes(status);
}

function toPrepareWorkRunSummary(
  run: AgentRun,
  asOf: string,
  staleAfterSeconds: number
): PrepareWorkRunSummary {
  return {
    id: run.id,
    source: run.source,
    project: run.project,
    workKey: run.workKey,
    workflowId: run.workflowId,
    parentRunId: run.parentRunId,
    continuedFromRunId: run.continuedFromRunId,
    status: run.status,
    category: run.category,
    tags: run.tags,
    version: run.version,
    startedAt: run.startedAt,
    updatedAt: run.updatedAt,
    freshness: classifyRunFreshness(run, asOf, staleAfterSeconds)
  };
}

function classifyRunFreshness(
  run: AgentRun,
  asOf: string,
  staleAfterSeconds: number
): RunFreshness {
  const base = { staleAfterSeconds, asOf };
  if (isTerminal(run.status)) {
    return { ...base, state: "not_applicable", reasonCode: "terminal_status" };
  }
  if (!run.lastLivenessAt) {
    return { ...base, state: "unknown", reasonCode: "no_authoritative_liveness" };
  }

  const staleBoundary = Date.parse(asOf) - staleAfterSeconds * 1000;
  if (Date.parse(run.lastLivenessAt) < staleBoundary) {
    return {
      ...base,
      state: "stale_candidate",
      lastLivenessAt: run.lastLivenessAt,
      reasonCode: "run_liveness_exceeds_window"
    };
  }
  return {
    ...base,
    state: "fresh",
    lastLivenessAt: run.lastLivenessAt,
    reasonCode: "authoritative_liveness_within_window"
  };
}

function toPrepareWorkHandoff(handoff: Handoff): PrepareWorkHandoff {
  return {
    id: handoff.id,
    sourceRunId: handoff.sourceRunId,
    fromSource: handoff.fromSource,
    toSource: handoff.toSource,
    status: handoff.status,
    version: handoff.version,
    updatedAt: handoff.updatedAt
  };
}

function toPrepareWorkOpenLoop(openLoop: OpenLoop): PrepareWorkOpenLoop {
  return {
    id: openLoop.id,
    type: openLoop.type,
    owner: openLoop.owner,
    source: openLoop.source,
    sourceRunId: openLoop.sourceRunId,
    status: openLoop.status,
    version: openLoop.version,
    updatedAt: openLoop.updatedAt
  };
}

function toPrepareWorkDecision(decision: Decision): PrepareWorkDecision {
  const { id, project, supersedesDecisionId, title, state, createdAt } = decision;
  return { id, project, supersedesDecisionId, title, state, createdAt };
}

function prepareWorkRecommendations(
  selected: PrepareWorkRunSummary | undefined,
  conflicts: PrepareWorkConflict[],
  handoffs: PrepareWorkHandoff[],
  openLoops: PrepareWorkOpenLoop[]
): PrepareWorkRecommendation[] {
  const recommendations: PrepareWorkRecommendation[] = [];
  const blockingLoops = openLoops.filter((loop) =>
    ["blocked", "decision_required", "failed_unresolved"].includes(loop.type)
  );
  for (const conflict of conflicts) {
    recommendations.push({
      actionCode:
        conflict.freshness.state === "fresh"
          ? "inspect_active_conflict"
          : conflict.freshness.state === "stale_candidate"
            ? "inspect_stale_run"
            : "stop_and_reread",
      targetRefs: [{ type: "run", id: conflict.id, version: conflict.version }],
      reasonCodes: [
        conflict.freshness.state === "fresh"
          ? "fresh_nonterminal_same_work_key"
          : conflict.freshness.state === "stale_candidate"
            ? "run_liveness_exceeds_window"
            : "run_liveness_unknown"
      ],
      requiresReread: true
    });
  }
  for (const openLoop of blockingLoops) {
    recommendations.push({
      actionCode: "resolve_blocker",
      targetRefs: [{ type: "openLoop", id: openLoop.id, version: openLoop.version }],
      reasonCodes: ["blocking_open_loop"],
      requiresReread: true
    });
  }
  for (const handoff of handoffs) {
    recommendations.push({
      actionCode: "accept_handoff",
      targetRefs: [{ type: "handoff", id: handoff.id, version: handoff.version }],
      reasonCodes: ["pending_targeted_handoff"],
      requiresReread: true
    });
  }
  if (selected) {
    if (selected.status === "failed") {
      recommendations.push({
        actionCode: "inspect_failed_manifest",
        targetRefs: [{ type: "run", id: selected.id, version: selected.version }],
        reasonCodes: ["selected_run_failed"],
        requiresReread: true
      });
    } else if (selected.freshness.state === "unknown") {
      recommendations.push({
        actionCode: "stop_and_reread",
        targetRefs: [{ type: "run", id: selected.id, version: selected.version }],
        reasonCodes: ["run_liveness_unknown"],
        requiresReread: true
      });
    } else if (selected.freshness.state === "stale_candidate") {
      recommendations.push({
        actionCode: "inspect_stale_run",
        targetRefs: [{ type: "run", id: selected.id, version: selected.version }],
        reasonCodes: ["run_liveness_exceeds_window"],
        requiresReread: true
      });
    } else if (selected.freshness.state === "not_applicable") {
      if (conflicts.length === 0 && handoffs.length === 0 && blockingLoops.length === 0) {
        recommendations.push({
          actionCode: "start_new_run",
          targetRefs: [{ type: "run", id: selected.id, version: selected.version }],
          reasonCodes: ["selected_run_terminal"],
          requiresReread: false
        });
      }
    } else {
      recommendations.push({
        actionCode: "resume_run",
        targetRefs: [{ type: "run", id: selected.id, version: selected.version }],
        reasonCodes: ["selected_run_can_resume"],
        requiresReread: true
      });
    }
  }
  if (!selected && conflicts.length === 0 && handoffs.length === 0 && blockingLoops.length === 0) {
    recommendations.push({
      actionCode: "start_new_run",
      targetRefs: [],
      reasonCodes: ["no_conflicting_or_blocked_work"],
      requiresReread: false
    });
  }
  return recommendations;
}

function takeBounded<T>(items: T[], limit: number): { items: T[]; truncated: boolean } {
  return { items: items.slice(0, limit), truncated: items.length > limit };
}

function sectionMeta(limit: number, count: number, truncated: boolean) {
  return { limit, count, truncated };
}

function toWorkflowRunSummary(run: AgentRun): WorkflowRunSummary {
  return {
    id: run.id,
    source: run.source,
    project: run.project,
    task: run.task,
    status: run.status,
    workflowId: run.workflowId,
    parentRunId: run.parentRunId,
    continuedFromRunId: run.continuedFromRunId,
    version: run.version,
    startedAt: run.startedAt,
    updatedAt: run.updatedAt
  };
}

function assertExpectedVersion(
  recordType: "run" | "openLoop" | "handoff",
  current: VersionedRecord,
  expectedVersion: number | undefined
): void {
  if (expectedVersion !== undefined && expectedVersion !== current.version) {
    throw new VersionConflictError(recordType, expectedVersion, current);
  }
}

function mapRecoveryReceipt(row: RecoveryReceiptRow): RecoveryReceipt {
  return {
    id: row.id,
    clientRunId: row.client_run_id,
    workspaceIdentity: row.workspace_identity,
    selectedRunId: row.selected_run_id,
    previousRunId: row.previous_run_id ?? undefined,
    action: row.action,
    staleReason: row.stale_reason ?? undefined,
    createdAt: row.created_at
  };
}

function normalizeWorkspaceIdentity(run: AgentRun): string {
  const value = run.gitRepoPath ?? run.cwd ?? run.project;
  return value.trim().replaceAll("\\", "/").replace(/\/+$/, "").toLowerCase();
}

function deriveCompletedAt(existing: AgentRun, input: UpdateRunRequest): string | undefined {
  if (input.status && ["completed", "failed", "cancelled"].includes(input.status)) {
    return existing.completedAt ?? nowIso();
  }

  return existing.completedAt;
}

function projectCommandEvidence(event: AgentEvent): RunManifest["commands"][number] {
  const data = isRecord(event.data) ? event.data : {};
  const argv = Array.isArray(data.argv)
    ? data.argv.filter((value): value is string => typeof value === "string")
    : undefined;

  return {
    id: event.id,
    message: event.message,
    createdAt: event.createdAt,
    argv,
    exitCode: typeof data.exitCode === "number" ? data.exitCode : undefined,
    durationMs: typeof data.durationMs === "number" ? data.durationMs : undefined,
    logPath: typeof data.logPath === "string" ? data.logPath : undefined,
    gitBefore: isRecord(data.gitBefore) ? data.gitBefore : undefined,
    gitAfter: isRecord(data.gitAfter) ? data.gitAfter : undefined
  };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function deriveResolvedAt(existing: OpenLoop, input: UpdateOpenLoopRequest): string | undefined {
  if (input.status === "resolved" || input.status === "cancelled") {
    return existing.resolvedAt ?? nowIso();
  }

  if (input.status === "open") {
    return undefined;
  }

  return existing.resolvedAt;
}
