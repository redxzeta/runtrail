import type Database from "better-sqlite3";
import { createId } from "../shared/ids.js";
import { compareEventsForReceipts, computeEventHash } from "../shared/receipts.js";
import type {
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
  Handoff,
  JournalSearchQuery,
  JournalSearchResults,
  ListArtifactsQuery,
  ListDecisionsQuery,
  ListEventsQuery,
  ListHandoffsQuery,
  ListOpenLoopsQuery,
  ListRunsQuery,
  OpenLoop,
  RunManifest,
  UpdateOpenLoopRequest,
  UpdateRunRequest
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

function isUniqueConstraint(error: unknown): boolean {
  return (
    error instanceof Error &&
    "code" in error &&
    String(error.code).startsWith("SQLITE_CONSTRAINT_UNIQUE")
  );
}

export class LedgerRepository {
  constructor(private readonly db: Database.Database) {}

  createRun(input: CreateRunRequest): { run: AgentRun; created: boolean } {
    const timestamp = nowIso();
    const tags = normalizeTags(input.tags);
    const run: AgentRun = {
      id: createId("run"),
      source: input.source,
      project: input.project,
      clientRunId: input.clientRunId,
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
            client_run_id,
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
            started_at,
            completed_at,
            created_at,
            updated_at
          ) VALUES (
            @id,
            @source,
            @project,
            @clientRunId,
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
            @startedAt,
            @completedAt,
            @createdAt,
            @updatedAt
          )`
        )
        .run({
          ...run,
          clientRunId: toSqlValue(run.clientRunId),
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
      return { run, created: true };
    } catch (error) {
      if (!input.clientRunId || !isUniqueConstraint(error)) {
        throw error;
      }

      const existing = this.findRunByClientRunId(input.source, input.project, input.clientRunId);

      if (!existing) {
        throw error;
      }

      return { run: existing, created: false };
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
            updated_at = @completedAt
        WHERE id = @id AND status = 'running' AND updated_at < @updatedBefore`
      );

      for (const candidate of mappedCandidates) {
        const result = update.run({
          id: candidate.id,
          summary,
          completedAt,
          updatedBefore
        });

        if (result.changes === 1) {
          const updated = this.getRun(candidate.id);

          if (updated) {
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
      updatedAt: nowIso()
    };

    this.db
      .prepare(
        `UPDATE agent_runs
        SET status = @status,
            summary = @summary,
            completed_at = @completedAt,
            git_branch = @gitBranch,
            git_commit = @gitCommit,
            updated_at = @updatedAt
        WHERE id = @id`
      )
      .run({
        ...updated,
        summary: toSqlValue(updated.summary),
        completedAt: toSqlValue(updated.completedAt),
        gitBranch: toSqlValue(updated.gitBranch),
        gitCommit: toSqlValue(updated.gitCommit)
      });

    return updated;
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

  getRun(id: string): AgentRun | undefined {
    const row = this.db.prepare("SELECT * FROM agent_runs WHERE id = ?").get(id) as
      | RunRow
      | undefined;
    return row ? mapRunRow(row) : undefined;
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

  createEvent(input: CreateEventRequest): AgentEvent | undefined {
    const run = this.getRun(input.runId);

    if (!run) {
      return undefined;
    }

    const tags = normalizeTags(input.tags);
    const event: AgentEvent = {
      id: createId("evt"),
      runId: input.runId,
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

    transaction();

    const stored = this.db
      .prepare("SELECT * FROM agent_events WHERE id = ?")
      .get(event.id) as EventRow;
    return mapEventRow(stored);
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

    const timestamp = input.createdAt ?? nowIso();
    const openLoop: OpenLoop = {
      id: createId("loop"),
      type: input.type,
      project: input.project,
      title: input.title,
      description: input.description,
      owner: input.owner,
      source: input.source,
      nextAction: input.nextAction,
      blockerRef: input.blockerRef,
      sourceRunId: input.sourceRunId,
      status: "open",
      createdAt: timestamp,
      updatedAt: timestamp
    };

    this.db
      .prepare(
        `INSERT INTO open_loops (
          id,
          type,
          project,
          title,
          description,
          owner,
          source,
          next_action,
          blocker_ref,
          source_run_id,
          status,
          resolution,
          created_at,
          updated_at,
          resolved_at
        ) VALUES (
          @id,
          @type,
          @project,
          @title,
          @description,
          @owner,
          @source,
          @nextAction,
          @blockerRef,
          @sourceRunId,
          @status,
          @resolution,
          @createdAt,
          @updatedAt,
          @resolvedAt
        )`
      )
      .run({
        ...openLoop,
        description: toSqlValue(openLoop.description),
        owner: toSqlValue(openLoop.owner),
        source: toSqlValue(openLoop.source),
        nextAction: toSqlValue(openLoop.nextAction),
        blockerRef: toSqlValue(openLoop.blockerRef),
        sourceRunId: toSqlValue(openLoop.sourceRunId),
        resolution: null,
        resolvedAt: null
      });

    return openLoop;
  }

  updateOpenLoop(id: string, input: UpdateOpenLoopRequest): OpenLoop | undefined {
    const existing = this.getOpenLoop(id);

    if (!existing) {
      return undefined;
    }

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
      updatedAt: nowIso()
    };

    this.db
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
            resolved_at = @resolvedAt
        WHERE id = @id`
      )
      .run({
        ...updated,
        description: toSqlValue(updated.description),
        owner: toSqlValue(updated.owner),
        source: toSqlValue(updated.source),
        nextAction: toSqlValue(updated.nextAction),
        blockerRef: toSqlValue(updated.blockerRef),
        sourceRunId: toSqlValue(updated.sourceRunId),
        resolution: toSqlValue(updated.resolution),
        resolvedAt: toSqlValue(updated.resolvedAt)
      });

    return updated;
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
    const decision: Decision = {
      id: createId("dec"),
      project: input.project,
      title: input.title,
      decision: input.decision,
      rationale: input.rationale,
      createdAt: input.createdAt ?? nowIso()
    };

    this.db
      .prepare(
        `INSERT INTO decisions (
          id,
          project,
          title,
          decision,
          rationale,
          created_at
        ) VALUES (
          @id,
          @project,
          @title,
          @decision,
          @rationale,
          @createdAt
        )`
      )
      .run({
        ...decision,
        project: toSqlValue(decision.project),
        rationale: toSqlValue(decision.rationale)
      });

    return decision;
  }

  listDecisions(query: ListDecisionsQuery): Decision[] {
    const params: Record<string, string | number> = {
      limit: query.limit
    };
    let whereClause = "";

    if (query.project && query.includeGlobal) {
      whereClause = "WHERE project = @project OR project IS NULL";
      params.project = query.project;
    } else if (query.project) {
      whereClause = "WHERE project = @project";
      params.project = query.project;
    } else if (!query.includeGlobal) {
      whereClause = "WHERE project IS NOT NULL";
    }

    const rows = this.db
      .prepare(
        `SELECT *
        FROM decisions
        ${whereClause}
        ORDER BY created_at DESC
        LIMIT @limit`
      )
      .all(params) as DecisionRow[];

    return rows.map(mapDecisionRow);
  }

  createHandoff(input: CreateHandoffRequest): Handoff | undefined {
    if (input.sourceRunId && !this.getRun(input.sourceRunId)) {
      return undefined;
    }

    const tags = normalizeTags(input.tags);
    const handoff: Handoff = {
      id: createId("handoff"),
      sourceRunId: input.sourceRunId,
      fromSource: input.fromSource,
      toSource: input.toSource,
      project: input.project,
      summary: input.summary,
      nextAction: input.nextAction,
      category: input.category,
      tags,
      context: input.context,
      createdAt: input.createdAt ?? nowIso()
    };

    const transaction = this.db.transaction(() => {
      this.db
        .prepare(
          `INSERT INTO handoffs (
            id,
            source_run_id,
            from_source,
            to_source,
            project,
            summary,
            next_action,
            category,
            tags_json,
            context_json,
            created_at
          ) VALUES (
            @id,
            @sourceRunId,
            @fromSource,
            @toSource,
            @project,
            @summary,
            @nextAction,
            @category,
            @tagsJson,
            @contextJson,
            @createdAt
          )`
        )
        .run({
          ...handoff,
          sourceRunId: toSqlValue(handoff.sourceRunId),
          toSource: toSqlValue(handoff.toSource),
          nextAction: toSqlValue(handoff.nextAction),
          category: toSqlValue(handoff.category),
          tagsJson: tagsToJson(handoff.tags),
          contextJson: handoff.context === undefined ? null : JSON.stringify(handoff.context)
        });
      this.replaceTags("handoff_tags", "handoff_id", handoff.id, handoff.tags);
    });

    transaction();

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

    const whereClause = filters.length > 0 ? `WHERE ${filters.join(" AND ")}` : "";
    const rows = this.db
      .prepare(
        `SELECT *
        FROM handoffs
        ${whereClause}
        ORDER BY created_at DESC
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

  createArtifact(input: CreateArtifactRequest): Artifact | undefined {
    if (!this.getRun(input.runId)) {
      return undefined;
    }

    const artifact: Artifact = {
      id: createId("art"),
      runId: input.runId,
      kind: input.kind,
      path: input.path,
      sizeBytes: input.sizeBytes,
      sha256: input.sha256,
      createdAt: input.createdAt ?? nowIso()
    };

    this.db
      .prepare(
        `INSERT INTO artifacts (
          id,
          run_id,
          kind,
          path,
          size_bytes,
          sha256,
          created_at
        ) VALUES (
          @id,
          @runId,
          @kind,
          @path,
          @sizeBytes,
          @sha256,
          @createdAt
        )`
      )
      .run({
        ...artifact,
        sizeBytes: toSqlValue(artifact.sizeBytes),
        sha256: toSqlValue(artifact.sha256)
      });

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
        `SELECT *
        FROM decisions
        ${whereClause(decisionFilters)}
        ORDER BY created_at DESC
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
      events: events.map(stripEventData),
      changed_files: uniqueStrings(events.flatMap(readChangedFiles)),
      commands: events
        .filter((event) => event.type === "command_executed")
        .map(({ id, message, createdAt }) => ({ id, message, createdAt })),
      tests: events
        .filter((event) => event.type.startsWith("test_"))
        .map(({ id, type, message, createdAt }) => ({ id, type, message, createdAt })),
      open_loops: openLoops.map(mapOpenLoopRow),
      handoffs: this.listHandoffs({ sourceRunId: id, limit: 100 }),
      artifacts: this.listArtifacts({ runId: id, limit: 100 })
    };
  }

  getAgentContext(query: AgentContextQuery): AgentContext {
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
          from_source,
          to_source,
          project,
          summary,
          next_action,
          category,
          tags_json,
          NULL AS context_json,
          created_at
        FROM handoffs
        WHERE project = @project
        ORDER BY created_at DESC
        LIMIT @limit`
      )
      .all(params) as HandoffRow[];

    const decisions = this.db
      .prepare(
        `SELECT *
        FROM decisions
        WHERE project = @project OR project IS NULL
        ORDER BY created_at DESC
        LIMIT @limit`
      )
      .all(params) as DecisionRow[];

    return {
      project: query.project,
      recent_runs: recentRuns.map(mapRunRow),
      failed_runs: failedRuns.map(mapRunRow),
      recent_events: recentEvents.map(mapEventContextRow),
      recent_handoffs: handoffs.map(mapHandoffSummaryRow),
      open_loops: openLoops.map(mapOpenLoopRow),
      decisions: decisions.map(mapDecisionRow),
      next_actions: openLoops.map((loop) => loop.next_action ?? loop.title)
    };
  }
}

function deriveCompletedAt(existing: AgentRun, input: UpdateRunRequest): string | undefined {
  if (input.status && ["completed", "failed", "cancelled"].includes(input.status)) {
    return existing.completedAt ?? nowIso();
  }

  return existing.completedAt;
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
