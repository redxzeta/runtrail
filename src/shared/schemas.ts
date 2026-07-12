import { z } from "zod";

const queryBooleanSchema = z
  .union([z.boolean(), z.enum(["true", "false"])])
  .transform((value) => value === true || value === "true");

export const healthResponseSchema = z.object({
  ok: z.literal(true),
  service: z.literal("runtrail")
});

export type HealthResponse = z.infer<typeof healthResponseSchema>;

export const runStatusSchema = z.enum([
  "running",
  "completed",
  "failed",
  "blocked",
  "needs_review",
  "decision_required",
  "paused",
  "cancelled"
]);

export const eventTypeSchema = z.enum([
  "started",
  "progress",
  "files_changed",
  "command_executed",
  "test_started",
  "test_passed",
  "test_failed",
  "needs_review",
  "decision_required",
  "completed",
  "failed",
  "blocked",
  "cancelled",
  "recovery_outcome"
]);

export const openLoopTypeSchema = z.enum([
  "blocked",
  "needs_review",
  "decision_required",
  "failed_unresolved",
  "ready_to_deploy",
  "follow_up",
  "risk"
]);

export const openLoopStatusSchema = z.enum(["open", "resolved", "cancelled"]);
const tagSchema = z.string().trim().min(1).max(80);
const tagsSchema = z.array(tagSchema).max(20).optional();
const categorySchema = z.string().trim().min(1).max(80).optional();
const clientRecordIdSchema = z.string().trim().min(1).max(255).optional();
const workKeySchema = z.string().trim().min(1).max(500).optional();

export const createRunRequestSchema = z.object({
  source: z.string().trim().min(1).max(80),
  project: z.string().trim().min(1).max(120),
  clientRunId: z.string().trim().min(1).max(255).optional(),
  workKey: workKeySchema,
  task: z.string().trim().min(1).max(1000),
  status: runStatusSchema.default("running"),
  hostname: z.string().trim().min(1).max(255).optional(),
  cwd: z.string().trim().min(1).max(1000).optional(),
  gitRepoPath: z.string().trim().min(1).max(1000).optional(),
  gitBranch: z.string().trim().min(1).max(255).optional(),
  gitCommit: z.string().trim().min(1).max(80).optional(),
  summary: z.string().trim().min(1).max(2000).optional(),
  category: categorySchema,
  tags: tagsSchema,
  startedAt: z.string().datetime().optional()
});

export const closeStaleRunsRequestSchema = z.object({
  updatedBefore: z.string().datetime(),
  apply: z.boolean().default(false),
  limit: z.number().int().positive().max(100).default(100)
});

export const updateRunRequestSchema = z
  .object({
    status: runStatusSchema.optional(),
    summary: z.string().trim().min(1).max(2000).nullable().optional(),
    completedAt: z.string().datetime().nullable().optional(),
    gitBranch: z.string().trim().min(1).max(255).nullable().optional(),
    gitCommit: z.string().trim().min(1).max(80).nullable().optional()
  })
  .refine((value) => Object.keys(value).length > 0, {
    message: "At least one field is required"
  });

export const pauseRunRequestSchema = z.object({
  status: z.enum(["paused", "blocked", "needs_review", "decision_required"]),
  summary: z.string().trim().min(1).max(2000).optional()
});

export const finishRunRequestSchema = z.object({
  status: z.enum(["completed", "failed", "cancelled"]),
  summary: z.string().trim().min(1).max(2000),
  completedAt: z.string().datetime().optional(),
  gitBranch: z.string().trim().min(1).max(255).optional(),
  gitCommit: z.string().trim().min(1).max(80).optional()
});

export const createEventRequestSchema = z.object({
  runId: z.string().trim().min(1),
  clientRecordId: clientRecordIdSchema,
  type: eventTypeSchema,
  message: z.string().trim().min(1).max(4000),
  importance: z.number().int().min(0).max(10).default(3),
  category: categorySchema,
  tags: tagsSchema,
  data: z.unknown().optional(),
  createdAt: z.string().datetime().optional()
});

export const listRunsQuerySchema = z.object({
  project: z.string().trim().min(1).max(120).optional(),
  workKey: workKeySchema,
  status: runStatusSchema.optional(),
  category: categorySchema,
  tag: tagSchema.optional(),
  started_from: z.string().datetime().optional(),
  started_to: z.string().datetime().optional(),
  limit: z.coerce.number().int().positive().max(100).default(50)
});

export const listEventsQuerySchema = z.object({
  runId: z.string().trim().min(1).optional(),
  limit: z.coerce.number().int().positive().max(200).default(100)
});

export const createOpenLoopRequestSchema = z.object({
  type: openLoopTypeSchema,
  project: z.string().trim().min(1).max(120),
  clientRecordId: clientRecordIdSchema,
  title: z.string().trim().min(1).max(240),
  description: z.string().trim().min(1).max(4000).optional(),
  owner: z.string().trim().min(1).max(120).optional(),
  source: z.string().trim().min(1).max(80).optional(),
  nextAction: z.string().trim().min(1).max(1000).optional(),
  blockerRef: z.string().trim().min(1).max(1000).optional(),
  sourceRunId: z.string().trim().min(1).optional(),
  createdAt: z.string().datetime().optional()
});

export const updateOpenLoopRequestSchema = z
  .object({
    status: openLoopStatusSchema.optional(),
    title: z.string().trim().min(1).max(240).optional(),
    description: z.string().trim().min(1).max(4000).nullable().optional(),
    owner: z.string().trim().min(1).max(120).nullable().optional(),
    source: z.string().trim().min(1).max(80).nullable().optional(),
    nextAction: z.string().trim().min(1).max(1000).nullable().optional(),
    blockerRef: z.string().trim().min(1).max(1000).nullable().optional(),
    sourceRunId: z.string().trim().min(1).nullable().optional(),
    resolution: z.string().trim().min(1).max(4000).nullable().optional(),
    resolvedAt: z.string().datetime().nullable().optional()
  })
  .refine((value) => Object.keys(value).length > 0, {
    message: "At least one field is required"
  });

export const listOpenLoopsQuerySchema = z.object({
  project: z.string().trim().min(1).max(120).optional(),
  status: openLoopStatusSchema.default("open"),
  type: openLoopTypeSchema.optional(),
  owner: z.string().trim().min(1).max(120).optional(),
  source: z.string().trim().min(1).max(80).optional(),
  sourceRunId: z.string().trim().min(1).optional(),
  limit: z.coerce.number().int().positive().max(100).default(50)
});

export const createDecisionRequestSchema = z.object({
  project: z.string().trim().min(1).max(120).optional(),
  clientRecordId: clientRecordIdSchema,
  title: z.string().trim().min(1).max(240),
  decision: z.string().trim().min(1).max(4000),
  rationale: z.string().trim().min(1).max(4000).optional(),
  createdAt: z.string().datetime().optional()
});

export const listDecisionsQuerySchema = z.object({
  project: z.string().trim().min(1).max(120).optional(),
  includeGlobal: queryBooleanSchema.default(true),
  limit: z.coerce.number().int().positive().max(100).default(50)
});

export const createHandoffRequestSchema = z.object({
  sourceRunId: z.string().trim().min(1).optional(),
  clientRecordId: clientRecordIdSchema,
  fromSource: z.string().trim().min(1).max(80),
  toSource: z.string().trim().min(1).max(80).optional(),
  project: z.string().trim().min(1).max(120),
  summary: z.string().trim().min(1).max(2000),
  nextAction: z.string().trim().min(1).max(1000).optional(),
  category: categorySchema,
  tags: tagsSchema,
  context: z.unknown().optional(),
  createdAt: z.string().datetime().optional()
});

export const listHandoffsQuerySchema = z.object({
  project: z.string().trim().min(1).max(120).optional(),
  sourceRunId: z.string().trim().min(1).optional(),
  limit: z.coerce.number().int().positive().max(100).default(50)
});

export const createArtifactRequestSchema = z.object({
  runId: z.string().trim().min(1),
  clientRecordId: clientRecordIdSchema,
  kind: z.string().trim().min(1).max(80),
  path: z.string().trim().min(1).max(1000),
  sizeBytes: z.number().int().nonnegative().optional(),
  sha256: z
    .string()
    .trim()
    .regex(/^[a-fA-F0-9]{64}$/)
    .optional(),
  createdAt: z.string().datetime().optional()
});

export const listArtifactsQuerySchema = z.object({
  runId: z.string().trim().min(1).optional(),
  kind: z.string().trim().min(1).max(80).optional(),
  limit: z.coerce.number().int().positive().max(100).default(50)
});

export const journalSearchQuerySchema = z.object({
  project: z.string().trim().min(1).max(120).optional(),
  source: z.string().trim().min(1).max(80).optional(),
  status: z.string().trim().min(1).max(80).optional(),
  category: categorySchema,
  tag: tagSchema.optional(),
  text: z.string().trim().min(1).max(200).optional(),
  date_from: z.string().datetime().optional(),
  date_to: z.string().datetime().optional(),
  limit: z.coerce.number().int().positive().max(50).default(20)
});

export const agentContextQuerySchema = z.object({
  project: z.string().trim().min(1).max(120),
  limit: z.coerce.number().int().positive().max(50).default(10),
  min_importance: z.coerce.number().int().min(0).max(10).default(4)
});

export type RunStatus = z.infer<typeof runStatusSchema>;
export type EventType = z.infer<typeof eventTypeSchema>;
export type OpenLoopType = z.infer<typeof openLoopTypeSchema>;
export type OpenLoopStatus = z.infer<typeof openLoopStatusSchema>;
export type CreateRunRequest = z.infer<typeof createRunRequestSchema>;
export type CloseStaleRunsRequest = z.infer<typeof closeStaleRunsRequestSchema>;
export type UpdateRunRequest = z.infer<typeof updateRunRequestSchema>;
export type PauseRunRequest = z.infer<typeof pauseRunRequestSchema>;
export type FinishRunRequest = z.infer<typeof finishRunRequestSchema>;
export type CreateEventRequest = z.infer<typeof createEventRequestSchema>;
export type ListRunsQuery = z.infer<typeof listRunsQuerySchema>;
export type ListEventsQuery = z.infer<typeof listEventsQuerySchema>;
export type CreateOpenLoopRequest = z.infer<typeof createOpenLoopRequestSchema>;
export type UpdateOpenLoopRequest = z.infer<typeof updateOpenLoopRequestSchema>;
export type ListOpenLoopsQuery = z.infer<typeof listOpenLoopsQuerySchema>;
export type CreateDecisionRequest = z.infer<typeof createDecisionRequestSchema>;
export type ListDecisionsQuery = z.infer<typeof listDecisionsQuerySchema>;
export type CreateHandoffRequest = z.infer<typeof createHandoffRequestSchema>;
export type ListHandoffsQuery = z.infer<typeof listHandoffsQuerySchema>;
export type CreateArtifactRequest = z.infer<typeof createArtifactRequestSchema>;
export type ListArtifactsQuery = z.infer<typeof listArtifactsQuerySchema>;
export type JournalSearchQuery = z.infer<typeof journalSearchQuerySchema>;
export type AgentContextQuery = z.infer<typeof agentContextQuerySchema>;

export type AgentRun = {
  id: string;
  source: string;
  project: string;
  clientRunId?: string;
  workKey?: string;
  task: string;
  status: RunStatus;
  hostname?: string;
  cwd?: string;
  gitRepoPath?: string;
  gitBranch?: string;
  gitCommit?: string;
  summary?: string;
  category?: string;
  tags?: string[];
  startedAt: string;
  completedAt?: string;
  createdAt: string;
  updatedAt: string;
};

export type RunConflict = Pick<
  AgentRun,
  "id" | "source" | "project" | "workKey" | "task" | "status" | "updatedAt"
>;

export type AgentEvent = {
  id: string;
  runId: string;
  clientRecordId?: string;
  type: EventType;
  message: string;
  importance: number;
  category?: string;
  tags?: string[];
  data?: unknown;
  prevEventHash?: string;
  eventHash?: string;
  createdAt: string;
};

export type OpenLoop = {
  id: string;
  type: OpenLoopType;
  project: string;
  clientRecordId?: string;
  title: string;
  description?: string;
  owner?: string;
  source?: string;
  nextAction?: string;
  blockerRef?: string;
  sourceRunId?: string;
  status: OpenLoopStatus;
  resolution?: string;
  createdAt: string;
  updatedAt: string;
  resolvedAt?: string;
};

export type Decision = {
  id: string;
  project?: string;
  clientRecordId?: string;
  title: string;
  decision: string;
  rationale?: string;
  createdAt: string;
};

export type Handoff = {
  id: string;
  sourceRunId?: string;
  clientRecordId?: string;
  fromSource: string;
  toSource?: string;
  project: string;
  summary: string;
  nextAction?: string;
  category?: string;
  tags?: string[];
  context?: unknown;
  createdAt: string;
};

export type HandoffSummary = Omit<Handoff, "context">;

export type Artifact = {
  id: string;
  runId: string;
  clientRecordId?: string;
  kind: string;
  path: string;
  sizeBytes?: number;
  sha256?: string;
  createdAt: string;
};

export type AgentContext = {
  project: string;
  recent_runs: AgentRun[];
  failed_runs: AgentRun[];
  recent_events: Array<Omit<AgentEvent, "data">>;
  recent_handoffs: HandoffSummary[];
  open_loops: OpenLoop[];
  decisions: Decision[];
  next_actions: string[];
};

export type RecoveryReceipt = {
  id: string;
  clientRunId: string;
  workspaceIdentity: string;
  selectedRunId: string;
  previousRunId?: string;
  action: "reuse" | "reopen" | "mark_stale" | "create_new";
  staleReason?: string;
  createdAt: string;
};

export type RunManifest = {
  run: AgentRun;
  advisory_conflicts: RunConflict[];
  events: Array<Omit<AgentEvent, "data">>;
  changed_files: string[];
  commands: Array<
    Pick<AgentEvent, "id" | "message" | "createdAt"> & {
      argv?: string[];
      exitCode?: number;
      durationMs?: number;
      logPath?: string;
      gitBefore?: Record<string, unknown>;
      gitAfter?: Record<string, unknown>;
    }
  >;
  tests: Array<Pick<AgentEvent, "id" | "type" | "message" | "createdAt">>;
  open_loops: OpenLoop[];
  handoffs: Handoff[];
  artifacts: Artifact[];
  recovery_receipts: RecoveryReceipt[];
};

export type JournalSearchResults = {
  runs: AgentRun[];
  events: Array<Omit<AgentEvent, "data">>;
  open_loops: OpenLoop[];
  handoffs: Handoff[];
  decisions: Decision[];
};
