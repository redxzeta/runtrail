import type {
  AgentEvent,
  AgentRun,
  Artifact,
  Decision,
  Handoff,
  HandoffSummary,
  JournalSearchQuery,
  OpenLoop
} from "../shared/schemas.js";

export type RunRow = {
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
  category: string | null;
  tags_json: string | null;
  started_at: string;
  completed_at: string | null;
  created_at: string;
  updated_at: string;
};

export type EventRow = {
  id: string;
  run_id: string;
  type: AgentEvent["type"];
  message: string;
  importance: number;
  category: string | null;
  tags_json: string | null;
  data_json: string | null;
  prev_event_hash: string | null;
  event_hash: string | null;
  created_at: string;
};

export type OpenLoopRow = {
  id: string;
  type: OpenLoop["type"];
  project: string;
  title: string;
  description: string | null;
  owner: string | null;
  source: string | null;
  next_action: string | null;
  blocker_ref: string | null;
  source_run_id: string | null;
  status: OpenLoop["status"];
  resolution: string | null;
  created_at: string;
  updated_at: string;
  resolved_at: string | null;
};

export type DecisionRow = {
  id: string;
  project: string | null;
  title: string;
  decision: string;
  rationale: string | null;
  created_at: string;
};

export type HandoffRow = {
  id: string;
  source_run_id: string | null;
  from_source: string;
  to_source: string | null;
  project: string;
  summary: string;
  next_action: string | null;
  category: string | null;
  tags_json: string | null;
  context_json: string | null;
  created_at: string;
};

export type ArtifactRow = {
  id: string;
  run_id: string;
  kind: string;
  path: string;
  size_bytes: number | null;
  sha256: string | null;
  created_at: string;
};

export function toSqlValue<T>(value: T | undefined): T | null {
  return value === undefined ? null : value;
}

export function mapRunRow(row: RunRow): AgentRun {
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
    category: row.category ?? undefined,
    tags: parseTags(row.tags_json),
    startedAt: row.started_at,
    completedAt: row.completed_at ?? undefined,
    createdAt: row.created_at,
    updatedAt: row.updated_at
  };
}

export function mapEventRow(row: EventRow): AgentEvent {
  return {
    id: row.id,
    runId: row.run_id,
    type: row.type,
    message: row.message,
    importance: row.importance,
    category: row.category ?? undefined,
    tags: parseTags(row.tags_json),
    data: row.data_json ? JSON.parse(row.data_json) : undefined,
    prevEventHash: row.prev_event_hash ?? undefined,
    eventHash: row.event_hash ?? undefined,
    createdAt: row.created_at
  };
}

export function mapEventContextRow(row: EventRow): Omit<AgentEvent, "data"> {
  return stripEventData({
    id: row.id,
    runId: row.run_id,
    type: row.type,
    message: row.message,
    importance: row.importance,
    category: row.category ?? undefined,
    tags: parseTags(row.tags_json),
    createdAt: row.created_at
  });
}

export function mapOpenLoopRow(row: OpenLoopRow): OpenLoop {
  return {
    id: row.id,
    type: row.type,
    project: row.project,
    title: row.title,
    description: row.description ?? undefined,
    owner: row.owner ?? undefined,
    source: row.source ?? undefined,
    nextAction: row.next_action ?? undefined,
    blockerRef: row.blocker_ref ?? undefined,
    sourceRunId: row.source_run_id ?? undefined,
    status: row.status,
    resolution: row.resolution ?? undefined,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    resolvedAt: row.resolved_at ?? undefined
  };
}

export function mapDecisionRow(row: DecisionRow): Decision {
  return {
    id: row.id,
    project: row.project ?? undefined,
    title: row.title,
    decision: row.decision,
    rationale: row.rationale ?? undefined,
    createdAt: row.created_at
  };
}

export function mapHandoffRow(row: HandoffRow): Handoff {
  return {
    id: row.id,
    sourceRunId: row.source_run_id ?? undefined,
    fromSource: row.from_source,
    toSource: row.to_source ?? undefined,
    project: row.project,
    summary: row.summary,
    nextAction: row.next_action ?? undefined,
    category: row.category ?? undefined,
    tags: parseTags(row.tags_json),
    context: row.context_json ? JSON.parse(row.context_json) : undefined,
    createdAt: row.created_at
  };
}

export function mapHandoffSummaryRow(row: HandoffRow): HandoffSummary {
  return {
    id: row.id,
    sourceRunId: row.source_run_id ?? undefined,
    fromSource: row.from_source,
    toSource: row.to_source ?? undefined,
    project: row.project,
    summary: row.summary,
    nextAction: row.next_action ?? undefined,
    category: row.category ?? undefined,
    tags: parseTags(row.tags_json),
    createdAt: row.created_at
  };
}

export function mapArtifactRow(row: ArtifactRow): Artifact {
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

export function stripEventData(event: AgentEvent): Omit<AgentEvent, "data"> {
  return {
    id: event.id,
    runId: event.runId,
    type: event.type,
    message: event.message,
    importance: event.importance,
    category: event.category,
    tags: event.tags,
    createdAt: event.createdAt
  };
}

export function readChangedFiles(event: AgentEvent): string[] {
  if (!event.data || typeof event.data !== "object" || !("changedFiles" in event.data)) {
    return [];
  }

  const changedFiles = (event.data as { changedFiles: unknown }).changedFiles;

  if (!Array.isArray(changedFiles)) {
    return [];
  }

  return changedFiles.filter((file): file is string => typeof file === "string");
}

export function uniqueStrings(values: string[]): string[] {
  return [...new Set(values)];
}

export function searchParams(query: JournalSearchQuery): Record<string, string | number> {
  return {
    limit: query.limit,
    project: query.project ?? "",
    source: query.source ?? "",
    status: query.status ?? "",
    category: query.category ?? "",
    tag: query.tag ?? "",
    dateFrom: query.date_from ? normalizeTimestamp(query.date_from) : "",
    dateTo: query.date_to ? normalizeTimestamp(query.date_to) : "",
    text: query.text ? `%${escapeLike(query.text)}%` : ""
  };
}

export function normalizeTimestamp(value: string): string {
  return new Date(value).toISOString();
}

export function searchFilters(
  query: JournalSearchQuery,
  table: string,
  textColumns: string[],
  runTable = table
): string[] {
  const filters: string[] = [];

  if (query.project) {
    filters.push(`${runTable}.project = @project`);
  }

  if (query.source) {
    if (table === "handoffs") {
      filters.push("(handoffs.from_source = @source OR handoffs.to_source = @source)");
    } else if (table === "open_loops") {
      filters.push("open_loops.source = @source");
    } else if (table !== "decisions") {
      filters.push(`${runTable}.source = @source`);
    }
  }

  if (query.status) {
    if (table === "agent_runs" || table === "open_loops") {
      filters.push(`${table}.status = @status`);
    } else if (table === "agent_events") {
      filters.push(`${runTable}.status = @status`);
    }
  }

  if (query.category) {
    if (table === "agent_runs" || table === "agent_events" || table === "handoffs") {
      filters.push(`${table}.category = @category`);
    } else {
      filters.push("1 = 0");
    }
  }

  if (query.tag) {
    if (table === "agent_runs") {
      filters.push(
        "EXISTS (SELECT 1 FROM agent_run_tags WHERE agent_run_tags.run_id = agent_runs.id AND agent_run_tags.tag = @tag)"
      );
    } else if (table === "agent_events") {
      filters.push(
        "EXISTS (SELECT 1 FROM agent_event_tags WHERE agent_event_tags.event_id = agent_events.id AND agent_event_tags.tag = @tag)"
      );
    } else if (table === "handoffs") {
      filters.push(
        "EXISTS (SELECT 1 FROM handoff_tags WHERE handoff_tags.handoff_id = handoffs.id AND handoff_tags.tag = @tag)"
      );
    } else {
      filters.push("1 = 0");
    }
  }

  if (query.date_from) {
    filters.push(`${dateColumn(table)} >= @dateFrom`);
  }

  if (query.date_to) {
    filters.push(`${dateColumn(table)} < @dateTo`);
  }

  if (query.text) {
    filters.push(
      `(${textColumns.map((column) => `${table}.${column} LIKE @text ESCAPE '\\'`).join(" OR ")})`
    );
  }

  return filters;
}

export function normalizeTags(tags: string[] | undefined): string[] | undefined {
  if (!tags) {
    return undefined;
  }

  const normalized = uniqueStrings(tags.map((tag) => tag.trim()).filter((tag) => tag.length > 0));

  return normalized.length > 0 ? normalized : undefined;
}

export function tagsToJson(tags: string[] | undefined): string | null {
  return tags ? JSON.stringify(tags) : null;
}

function parseTags(value: string | null): string[] | undefined {
  if (!value) {
    return undefined;
  }

  const parsed = JSON.parse(value);

  return Array.isArray(parsed) && parsed.length > 0 ? parsed : undefined;
}

export function whereClause(filters: string[]): string {
  return filters.length > 0 ? `WHERE ${filters.join(" AND ")}` : "";
}

function dateColumn(table: string): string {
  if (table === "agent_runs") {
    return "agent_runs.started_at";
  }

  return `${table}.created_at`;
}

function escapeLike(value: string): string {
  return value.replaceAll("\\", "\\\\").replaceAll("%", "\\%").replaceAll("_", "\\_");
}
