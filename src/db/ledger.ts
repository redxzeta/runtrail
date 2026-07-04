import type Database from "better-sqlite3";
import { createId } from "../shared/ids.js";
import type {
  AgentContext,
  AgentContextQuery,
  AgentEvent,
  AgentRun,
  Artifact,
  CreateArtifactRequest,
  CreateDecisionRequest,
  CreateEventRequest,
  CreateHandoffRequest,
  CreateOpenLoopRequest,
  CreateRunRequest,
  Decision,
  Handoff,
  ListArtifactsQuery,
  ListDecisionsQuery,
  ListEventsQuery,
  ListHandoffsQuery,
  ListOpenLoopsQuery,
  ListRunsQuery,
  OpenLoop,
  UpdateOpenLoopRequest,
  UpdateRunRequest
} from "../shared/schemas.js";
import { nowIso } from "../shared/time.js";

type RunRow = {
  id: string;
  source: string;
  project: string;
  task: string;
  status: AgentRun["status"];
  hostname: string | null;
  cwd: string | null;
  git_repo_path: string | null;
  git_branch: string | null;
  git_commit: string | null;
  summary: string | null;
  started_at: string;
  completed_at: string | null;
  created_at: string;
  updated_at: string;
};

type EventRow = {
  id: string;
  run_id: string;
  type: AgentEvent["type"];
  message: string;
  importance: number;
  data_json: string | null;
  created_at: string;
};

type OpenLoopRow = {
  id: string;
  type: OpenLoop["type"];
  project: string;
  title: string;
  description: string | null;
  status: OpenLoop["status"];
  resolution: string | null;
  created_at: string;
  updated_at: string;
  resolved_at: string | null;
};

type DecisionRow = {
  id: string;
  project: string | null;
  title: string;
  decision: string;
  rationale: string | null;
  created_at: string;
};

type HandoffRow = {
  id: string;
  source_run_id: string | null;
  from_source: string;
  to_source: string | null;
  project: string;
  summary: string;
  next_action: string | null;
  context_json: string | null;
  created_at: string;
};

type ArtifactRow = {
  id: string;
  run_id: string;
  kind: string;
  path: string;
  size_bytes: number | null;
  sha256: string | null;
  created_at: string;
};

const exceptionalEventTypes = ["blocked", "failed", "needs_review", "decision_required"];
const exceptionalEventParams = exceptionalEventTypes.map((_, index) => `@exceptional${index}`);

export class LedgerRepository {
  constructor(private readonly db: Database.Database) {}

  createRun(input: CreateRunRequest): AgentRun {
    const timestamp = nowIso();
    const run: AgentRun = {
      id: createId("run"),
      source: input.source,
      project: input.project,
      task: input.task,
      status: input.status,
      hostname: input.hostname,
      cwd: input.cwd,
      gitRepoPath: input.gitRepoPath,
      gitBranch: input.gitBranch,
      gitCommit: input.gitCommit,
      summary: input.summary,
      startedAt: input.startedAt ?? timestamp,
      createdAt: timestamp,
      updatedAt: timestamp
    };

    this.db
      .prepare(
        `INSERT INTO agent_runs (
          id,
          source,
          project,
          task,
          status,
          hostname,
          cwd,
          git_repo_path,
          git_branch,
          git_commit,
          summary,
          started_at,
          completed_at,
          created_at,
          updated_at
        ) VALUES (
          @id,
          @source,
          @project,
          @task,
          @status,
          @hostname,
          @cwd,
          @gitRepoPath,
          @gitBranch,
          @gitCommit,
          @summary,
          @startedAt,
          @completedAt,
          @createdAt,
          @updatedAt
        )`
      )
      .run({
        ...run,
        hostname: toSqlValue(run.hostname),
        cwd: toSqlValue(run.cwd),
        gitRepoPath: toSqlValue(run.gitRepoPath),
        gitBranch: toSqlValue(run.gitBranch),
        gitCommit: toSqlValue(run.gitCommit),
        summary: toSqlValue(run.summary),
        completedAt: null
      });

    return run;
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

    if (query.started_from) {
      filters.push("started_at >= @startedFrom");
      params.startedFrom = query.started_from;
    }

    if (query.started_to) {
      filters.push("started_at < @startedTo");
      params.startedTo = query.started_to;
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

  createEvent(input: CreateEventRequest): AgentEvent | undefined {
    const run = this.getRun(input.runId);

    if (!run) {
      return undefined;
    }

    const event: AgentEvent = {
      id: createId("evt"),
      runId: input.runId,
      type: input.type,
      message: input.message,
      importance: input.importance,
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
            data_json,
            created_at
          ) VALUES (
            @id,
            @runId,
            @type,
            @message,
            @importance,
            @dataJson,
            @createdAt
          )`
        )
        .run({
          ...event,
          dataJson: event.data === undefined ? null : JSON.stringify(event.data)
        });

      this.db
        .prepare("UPDATE agent_runs SET updated_at = ? WHERE id = ?")
        .run(event.createdAt, event.runId);
    });

    transaction();

    return event;
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

  createOpenLoop(input: CreateOpenLoopRequest): OpenLoop {
    const timestamp = input.createdAt ?? nowIso();
    const openLoop: OpenLoop = {
      id: createId("loop"),
      type: input.type,
      project: input.project,
      title: input.title,
      description: input.description,
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

    const updated: OpenLoop = {
      ...existing,
      status: input.status ?? existing.status,
      title: input.title ?? existing.title,
      description:
        input.description === undefined ? existing.description : (input.description ?? undefined),
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
            resolution = @resolution,
            updated_at = @updatedAt,
            resolved_at = @resolvedAt
        WHERE id = @id`
      )
      .run({
        ...updated,
        description: toSqlValue(updated.description),
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

    const handoff: Handoff = {
      id: createId("handoff"),
      sourceRunId: input.sourceRunId,
      fromSource: input.fromSource,
      toSource: input.toSource,
      project: input.project,
      summary: input.summary,
      nextAction: input.nextAction,
      context: input.context,
      createdAt: input.createdAt ?? nowIso()
    };

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
          @contextJson,
          @createdAt
        )`
      )
      .run({
        ...handoff,
        sourceRunId: toSqlValue(handoff.sourceRunId),
        toSource: toSqlValue(handoff.toSource),
        nextAction: toSqlValue(handoff.nextAction),
        contextJson: handoff.context === undefined ? null : JSON.stringify(handoff.context)
      });

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
        `SELECT agent_events.*
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
        `SELECT *
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
      recent_handoffs: handoffs.map(mapHandoffRow),
      open_loops: openLoops.map(mapOpenLoopRow),
      decisions: decisions.map(mapDecisionRow),
      next_actions: openLoops.map((loop) => loop.title)
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
  if (input.status === "resolved") {
    return existing.resolvedAt ?? nowIso();
  }

  if (input.status === "open") {
    return undefined;
  }

  return existing.resolvedAt;
}

function toSqlValue<T>(value: T | undefined): T | null {
  return value === undefined ? null : value;
}

function mapRunRow(row: RunRow): AgentRun {
  return {
    id: row.id,
    source: row.source,
    project: row.project,
    task: row.task,
    status: row.status,
    hostname: row.hostname ?? undefined,
    cwd: row.cwd ?? undefined,
    gitRepoPath: row.git_repo_path ?? undefined,
    gitBranch: row.git_branch ?? undefined,
    gitCommit: row.git_commit ?? undefined,
    summary: row.summary ?? undefined,
    startedAt: row.started_at,
    completedAt: row.completed_at ?? undefined,
    createdAt: row.created_at,
    updatedAt: row.updated_at
  };
}

function mapEventRow(row: EventRow): AgentEvent {
  return {
    id: row.id,
    runId: row.run_id,
    type: row.type,
    message: row.message,
    importance: row.importance,
    data: row.data_json ? JSON.parse(row.data_json) : undefined,
    createdAt: row.created_at
  };
}

function mapEventContextRow(row: EventRow): Omit<AgentEvent, "data"> {
  return {
    id: row.id,
    runId: row.run_id,
    type: row.type,
    message: row.message,
    importance: row.importance,
    createdAt: row.created_at
  };
}

function mapOpenLoopRow(row: OpenLoopRow): OpenLoop {
  return {
    id: row.id,
    type: row.type,
    project: row.project,
    title: row.title,
    description: row.description ?? undefined,
    status: row.status,
    resolution: row.resolution ?? undefined,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    resolvedAt: row.resolved_at ?? undefined
  };
}

function mapDecisionRow(row: DecisionRow): Decision {
  return {
    id: row.id,
    project: row.project ?? undefined,
    title: row.title,
    decision: row.decision,
    rationale: row.rationale ?? undefined,
    createdAt: row.created_at
  };
}

function mapHandoffRow(row: HandoffRow): Handoff {
  return {
    id: row.id,
    sourceRunId: row.source_run_id ?? undefined,
    fromSource: row.from_source,
    toSource: row.to_source ?? undefined,
    project: row.project,
    summary: row.summary,
    nextAction: row.next_action ?? undefined,
    context: row.context_json ? JSON.parse(row.context_json) : undefined,
    createdAt: row.created_at
  };
}

function mapArtifactRow(row: ArtifactRow): Artifact {
  return {
    id: row.id,
    runId: row.run_id,
    kind: row.kind,
    path: row.path,
    sizeBytes: row.size_bytes ?? undefined,
    sha256: row.sha256 ?? undefined,
    createdAt: row.created_at
  };
}
