import { z } from "zod";
import {
  agentContextQuerySchema,
  createDecisionRequestSchema,
  createEventRequestSchema,
  createHandoffRequestSchema,
  createOpenLoopRequestSchema,
  createRunRequestSchema,
  finishRunRequestSchema,
  journalSearchQuerySchema,
  listRunsQuerySchema,
  openLoopStatusSchema,
  pauseRunRequestSchema,
  runStatusSchema,
  updateOpenLoopRequestSchema
} from "../shared/schemas.js";

const idSchema = z.string().trim().min(1);
const mcpLimitSchema = z.number().int().positive().max(50).optional();

export const mcpToolInputSchemas = {
  startRun: {
    source: createRunRequestSchema.shape.source,
    project: createRunRequestSchema.shape.project,
    clientRunId: createRunRequestSchema.shape.clientRunId,
    task: createRunRequestSchema.shape.task,
    cwd: createRunRequestSchema.shape.cwd,
    gitRepoPath: createRunRequestSchema.shape.gitRepoPath,
    gitBranch: createRunRequestSchema.shape.gitBranch,
    gitCommit: createRunRequestSchema.shape.gitCommit,
    category: createRunRequestSchema.shape.category,
    tags: createRunRequestSchema.shape.tags
  },
  runId: { runId: idSchema },
  pauseRun: { runId: idSchema, ...pauseRunRequestSchema.shape },
  finishRun: { runId: idSchema, ...finishRunRequestSchema.shape },
  context: {
    project: agentContextQuerySchema.shape.project,
    limit: mcpLimitSchema,
    min_importance: agentContextQuerySchema.shape.min_importance.optional()
  },
  event: {
    runId: createEventRequestSchema.shape.runId,
    type: createEventRequestSchema.shape.type,
    message: createEventRequestSchema.shape.message,
    importance: createEventRequestSchema.shape.importance.optional(),
    category: createEventRequestSchema.shape.category,
    tags: createEventRequestSchema.shape.tags,
    data: z.record(z.string(), z.unknown()).optional()
  },
  openLoop: {
    type: createOpenLoopRequestSchema.shape.type,
    project: createOpenLoopRequestSchema.shape.project,
    title: createOpenLoopRequestSchema.shape.title,
    description: createOpenLoopRequestSchema.shape.description,
    owner: createOpenLoopRequestSchema.shape.owner,
    source: createOpenLoopRequestSchema.shape.source,
    nextAction: createOpenLoopRequestSchema.shape.nextAction,
    blockerRef: createOpenLoopRequestSchema.shape.blockerRef,
    sourceRunId: createOpenLoopRequestSchema.shape.sourceRunId
  },
  resolveOpenLoop: {
    id: idSchema,
    resolution: updateOpenLoopRequestSchema.shape.resolution.unwrap().optional()
  },
  decision: {
    project: createDecisionRequestSchema.shape.project,
    title: createDecisionRequestSchema.shape.title,
    decision: createDecisionRequestSchema.shape.decision,
    rationale: createDecisionRequestSchema.shape.rationale
  },
  runSearch: {
    project: listRunsQuerySchema.shape.project,
    status: listRunsQuerySchema.shape.status,
    category: listRunsQuerySchema.shape.category,
    tag: listRunsQuerySchema.shape.tag,
    limit: mcpLimitSchema
  },
  handoff: {
    sourceRunId: createHandoffRequestSchema.shape.sourceRunId,
    fromSource: createHandoffRequestSchema.shape.fromSource,
    toSource: createHandoffRequestSchema.shape.toSource,
    project: createHandoffRequestSchema.shape.project,
    summary: createHandoffRequestSchema.shape.summary,
    nextAction: createHandoffRequestSchema.shape.nextAction,
    category: createHandoffRequestSchema.shape.category,
    tags: createHandoffRequestSchema.shape.tags,
    context: z.record(z.string(), z.unknown()).optional()
  },
  manifest: { runId: idSchema },
  journalSearch: {
    project: journalSearchQuerySchema.shape.project,
    source: journalSearchQuerySchema.shape.source,
    status: z.union([runStatusSchema, openLoopStatusSchema]).optional(),
    category: journalSearchQuerySchema.shape.category,
    tag: journalSearchQuerySchema.shape.tag,
    text: journalSearchQuerySchema.shape.text,
    date_from: journalSearchQuerySchema.shape.date_from,
    date_to: journalSearchQuerySchema.shape.date_to,
    limit: mcpLimitSchema
  }
} as const;
