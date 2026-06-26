import { z } from "zod";

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
  "cancelled"
]);

export const createRunRequestSchema = z.object({
  source: z.string().trim().min(1).max(80),
  project: z.string().trim().min(1).max(120),
  task: z.string().trim().min(1).max(1000),
  status: runStatusSchema.default("running"),
  hostname: z.string().trim().min(1).max(255).optional(),
  cwd: z.string().trim().min(1).max(1000).optional(),
  gitRepoPath: z.string().trim().min(1).max(1000).optional(),
  gitBranch: z.string().trim().min(1).max(255).optional(),
  gitCommit: z.string().trim().min(1).max(80).optional(),
  summary: z.string().trim().min(1).max(2000).optional(),
  startedAt: z.string().datetime().optional()
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

export const createEventRequestSchema = z.object({
  runId: z.string().trim().min(1),
  type: eventTypeSchema,
  message: z.string().trim().min(1).max(4000),
  importance: z.number().int().min(0).max(10).default(3),
  data: z.unknown().optional(),
  createdAt: z.string().datetime().optional()
});

export const listRunsQuerySchema = z.object({
  project: z.string().trim().min(1).max(120).optional(),
  status: runStatusSchema.optional(),
  limit: z.coerce.number().int().positive().max(100).default(50)
});

export const listEventsQuerySchema = z.object({
  runId: z.string().trim().min(1).optional(),
  limit: z.coerce.number().int().positive().max(200).default(100)
});

export type RunStatus = z.infer<typeof runStatusSchema>;
export type EventType = z.infer<typeof eventTypeSchema>;
export type CreateRunRequest = z.infer<typeof createRunRequestSchema>;
export type UpdateRunRequest = z.infer<typeof updateRunRequestSchema>;
export type CreateEventRequest = z.infer<typeof createEventRequestSchema>;
export type ListRunsQuery = z.infer<typeof listRunsQuerySchema>;
export type ListEventsQuery = z.infer<typeof listEventsQuerySchema>;

export type AgentRun = {
  id: string;
  source: string;
  project: string;
  task: string;
  status: RunStatus;
  hostname?: string;
  cwd?: string;
  gitRepoPath?: string;
  gitBranch?: string;
  gitCommit?: string;
  summary?: string;
  startedAt: string;
  completedAt?: string;
  createdAt: string;
  updatedAt: string;
};

export type AgentEvent = {
  id: string;
  runId: string;
  type: EventType;
  message: string;
  importance: number;
  data?: unknown;
  createdAt: string;
};
