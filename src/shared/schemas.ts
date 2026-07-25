import { z } from "zod";

const queryBooleanSchema = z
  .union([z.boolean(), z.enum(["true", "false"])])
  .transform((value) => value === true || value === "true");

export const healthResponseSchema = z.object({
  ok: z.literal(true),
  service: z.literal("runtrail")
});
export const capabilityFeatureIdSchema = z.enum([
  "optimistic_concurrency",
  "workflow_relationships",
  "handoff_lifecycle",
  "prepare_work",
  "server_authoritative_run_freshness",
  "incremental_cursors",
  "durable_local_outbox_replay",
  "effective_decisions",
  "typed_verification_evidence",
  "provenance_aware_readiness",
  "workflow_review_packet"
]);
const capabilityLimitSchema = z.object({
  default: z.number().int().positive(),
  maximum: z.number().int().positive()
});
export const capabilitiesManifestSchema = z.object({
  schemaVersion: z.literal("1"),
  service: z.object({
    name: z.literal("runtrail"),
    version: z.string().regex(/^\d+\.\d+\.\d+$/)
  }),
  protocol: z.object({
    name: z.literal("runtrail-agent-ledger"),
    version: z.literal("1")
  }),
  schemas: z.object({
    capabilities: z.literal("1"),
    workflowReviewPacket: z.literal("1")
  }),
  features: z.array(
    z.object({
      id: capabilityFeatureIdSchema,
      version: z.literal("1")
    })
  ),
  mcp: z.object({
    transports: z.array(z.enum(["streamable_http", "stdio_bridge"])),
    tools: z.array(z.string().min(1))
  }),
  limits: z.object({
    runs: capabilityLimitSchema,
    workflowRuns: capabilityLimitSchema,
    context: capabilityLimitSchema,
    prepareWork: capabilityLimitSchema,
    journalSearch: capabilityLimitSchema,
    workflowReviewPacket: capabilityLimitSchema
  }),
  semantics: z.object({
    capabilityClaims: z.literal("protocol_support"),
    verificationEvidence: z.literal("recorded_client_evidence")
  })
});
export const conformanceResultSchema = z.object({
  resultSchemaVersion: z.literal("1"),
  serviceProtocolVersion: z.literal("1"),
  profiles: z.array(
    z.object({
      name: z.enum(["baseline", "agent-continuation-v1"]),
      version: z.literal("1"),
      steps: z.array(
        z.object({
          name: z.string(),
          capability: z.string().optional(),
          transport: z.enum(["http", "direct_mcp", "stdio_bridge", "local_client"]),
          expected: z.string(),
          actual: z.string(),
          result: z.enum(["passed", "failed", "not_supported"]),
          diagnostic: z.string().max(160)
        })
      )
    })
  ),
  capabilities: z.array(capabilityFeatureIdSchema),
  summary: z.object({
    passed: z.number().int().nonnegative(),
    failed: z.number().int().nonnegative(),
    notSupported: z.number().int().nonnegative()
  }),
  cleanup: z.object({ status: z.enum(["passed", "failed"]) })
});

export type HealthResponse = z.infer<typeof healthResponseSchema>;
export type CapabilityFeatureId = z.infer<typeof capabilityFeatureIdSchema>;
export type CapabilitiesManifest = z.infer<typeof capabilitiesManifestSchema>;
export type ConformanceResult = z.infer<typeof conformanceResultSchema>;

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
export const handoffStatusSchema = z.enum([
  "pending",
  "accepted",
  "completed",
  "declined",
  "expired"
]);
const tagSchema = z.string().trim().min(1).max(80);
const tagsSchema = z.array(tagSchema).max(20).optional();
const categorySchema = z.string().trim().min(1).max(80).optional();
const clientRecordIdSchema = z.string().trim().min(1).max(255).optional();
const workKeySchema = z.string().trim().min(1).max(500).optional();
const runRelationshipIdSchema = z.string().trim().min(1).max(255).optional();
const expectedVersionSchema = z.number().int().positive().optional();
const requiredExpectedVersionSchema = z.number().int().positive();

export const createRunRequestSchema = z.object({
  source: z.string().trim().min(1).max(80),
  project: z.string().trim().min(1).max(120),
  agentName: z.string().trim().min(1).max(120).optional(),
  agentModel: z.string().trim().min(1).max(255).optional(),
  clientRunId: z.string().trim().min(1).max(255).optional(),
  workKey: workKeySchema,
  workflowId: runRelationshipIdSchema,
  parentRunId: runRelationshipIdSchema,
  continuedFromRunId: runRelationshipIdSchema,
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
    expectedVersion: expectedVersionSchema,
    status: runStatusSchema.optional(),
    summary: z.string().trim().min(1).max(2000).nullable().optional(),
    completedAt: z.string().datetime().nullable().optional(),
    gitBranch: z.string().trim().min(1).max(255).nullable().optional(),
    gitCommit: z.string().trim().min(1).max(80).nullable().optional()
  })
  .refine((value) => Object.keys(value).some((key) => key !== "expectedVersion"), {
    message: "At least one field is required"
  });

export const pauseRunRequestSchema = z.object({
  expectedVersion: expectedVersionSchema,
  status: z.enum(["paused", "blocked", "needs_review", "decision_required"]),
  summary: z.string().trim().min(1).max(2000).optional()
});

export const finishRunRequestSchema = z.object({
  expectedVersion: expectedVersionSchema,
  status: z.enum(["completed", "failed", "cancelled"]),
  summary: z.string().trim().min(1).max(2000),
  completedAt: z.string().datetime().optional(),
  gitBranch: z.string().trim().min(1).max(255).optional(),
  gitCommit: z.string().trim().min(1).max(80).optional()
});

export const versionedMutationRequestSchema = z.object({
  expectedVersion: expectedVersionSchema
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

export const workflowRunsQuerySchema = z.object({
  project: z.string().trim().min(1).max(120),
  limit: z.coerce.number().int().positive().max(50).default(20)
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
    expectedVersion: expectedVersionSchema,
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
  .refine((value) => Object.keys(value).some((key) => key !== "expectedVersion"), {
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
  supersedesDecisionId: z.string().trim().min(1).max(255).optional(),
  title: z.string().trim().min(1).max(240),
  decision: z.string().trim().min(1).max(4000),
  rationale: z.string().trim().min(1).max(4000).optional(),
  createdAt: z.string().datetime().optional()
});

export const listDecisionsQuerySchema = z.object({
  project: z.string().trim().min(1).max(120).optional(),
  includeGlobal: queryBooleanSchema.default(true),
  effectiveOnly: queryBooleanSchema.default(false),
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
  toSource: z.string().trim().min(1).max(80).optional(),
  status: z.union([handoffStatusSchema, z.literal("all")]).default("pending"),
  limit: z.coerce.number().int().positive().max(100).default(50)
});

export const acceptHandoffRequestSchema = z
  .object({
    expectedVersion: requiredExpectedVersionSchema,
    acceptedBy: z.string().trim().min(1).max(120),
    targetRunId: z.string().trim().min(1).max(255).optional(),
    run: createRunRequestSchema.optional()
  })
  .superRefine((value, context) => {
    if ((value.targetRunId === undefined) === (value.run === undefined)) {
      context.addIssue({
        code: "custom",
        message: "Exactly one of targetRunId or run is required"
      });
    }
  });

export const declineHandoffRequestSchema = z.object({
  expectedVersion: requiredExpectedVersionSchema,
  reason: z.string().trim().min(1).max(1000).optional()
});

export const completeHandoffRequestSchema = z.object({
  expectedVersion: requiredExpectedVersionSchema
});

export const expireHandoffRequestSchema = z.object({
  expectedVersion: requiredExpectedVersionSchema
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

export const verificationKindSchema = z.enum([
  "test",
  "lint",
  "typecheck",
  "build",
  "smoke",
  "custom"
]);
export const verificationOutcomeSchema = z.enum(["passed", "failed", "not_run", "not_applicable"]);
export const verificationSupportSchema = z.discriminatedUnion("type", [
  z.object({ type: z.literal("client_reported") }).strict(),
  z
    .object({
      type: z.literal("exit_code"),
      exitCode: z.number().int().min(0).max(255)
    })
    .strict(),
  z
    .object({
      type: z.literal("receipt"),
      receiptId: z.string().trim().min(1).max(255)
    })
    .strict(),
  z
    .object({
      type: z.literal("artifact_digest"),
      artifactId: z.string().trim().min(1).max(255).optional(),
      sha256: z
        .string()
        .trim()
        .regex(/^[a-fA-F0-9]{64}$/)
    })
    .strict(),
  z
    .object({
      type: z.literal("unavailable"),
      reason: z.enum(["not_provided", "not_supported"])
    })
    .strict()
]);
export const createVerificationRequestSchema = z
  .object({
    runId: z.string().trim().min(1).max(255),
    clientRecordId: clientRecordIdSchema,
    checkId: z.string().trim().min(1).max(120),
    kind: verificationKindSchema,
    outcome: verificationOutcomeSchema,
    name: z.string().trim().min(1).max(240),
    summary: z.string().trim().min(1).max(1000).optional(),
    commandSummary: z.string().trim().min(1).max(500).optional(),
    durationMs: z.number().int().nonnegative().max(604_800_000).optional(),
    support: verificationSupportSchema,
    completedAt: z.string().datetime()
  })
  .strict()
  .superRefine((value, context) => {
    if (
      ["not_run", "not_applicable"].includes(value.outcome) &&
      !["client_reported", "unavailable"].includes(value.support.type)
    ) {
      context.addIssue({
        code: "custom",
        path: ["support"],
        message: "Not-run dispositions cannot carry execution or artifact support"
      });
    }
    if (value.support.type === "exit_code") {
      if (value.outcome === "passed" && value.support.exitCode !== 0) {
        context.addIssue({
          code: "custom",
          path: ["support", "exitCode"],
          message: "Passed exit-code evidence requires exit code 0"
        });
      }
      if (value.outcome === "failed" && value.support.exitCode === 0) {
        context.addIssue({
          code: "custom",
          path: ["support", "exitCode"],
          message: "Failed exit-code evidence requires a nonzero exit code"
        });
      }
    }
  });

export const listVerificationsQuerySchema = z.object({
  runId: z.string().trim().min(1).max(255),
  limit: z.coerce.number().int().positive().max(100).default(50)
});

export const provenanceOriginSchema = z.enum([
  "client_reported",
  "server_observed",
  "deterministic_derivation"
]);
export const provenanceAssuranceSchema = z.enum([
  "asserted",
  "evidence_backed",
  "mixed",
  "unknown"
]);
export const readinessStatusSchema = z.enum([
  "in_progress",
  "blocked",
  "needs_evidence",
  "ready_for_review",
  "unknown"
]);
export const readinessReasonCodeSchema = z.enum([
  "workflow_relationships_incomplete",
  "workflow_inputs_truncated",
  "related_run_blocked",
  "unresolved_hard_blocker",
  "handoff_incomplete",
  "fresh_related_run_active",
  "stale_related_run_requires_inspection",
  "related_run_freshness_unknown",
  "verification_failed",
  "required_verification_not_run",
  "required_verification_missing",
  "workflow_ready_for_review",
  "legacy_workflow_unclassified"
]);
export const readinessActionCodeSchema = z.enum([
  "inspect_active_conflict",
  "inspect_stale_run",
  "resolve_blocker",
  "complete_handoff",
  "record_verification_disposition",
  "rerun_failed_verification",
  "inspect_effective_decision",
  "stop_and_reread"
]);
export const readinessCaveatCodeSchema = z.enum([
  "verification_client_reported",
  "verification_support_unavailable",
  "workflow_inputs_truncated",
  "legacy_relationships_missing"
]);
const readinessRecordTypeSchema = z.enum([
  "run",
  "handoff",
  "openLoop",
  "decision",
  "verification"
]);
export const readinessSourceRefSchema = z.object({
  type: readinessRecordTypeSchema,
  id: z.string().trim().min(1).max(255),
  version: z.number().int().positive().optional(),
  origin: provenanceOriginSchema,
  assurance: provenanceAssuranceSchema
});
export const readinessTargetRefSchema = readinessSourceRefSchema.pick({
  type: true,
  id: true,
  version: true
});
export const readinessFindingSchema = z.object({
  reasonCode: readinessReasonCodeSchema,
  origin: z.literal("deterministic_derivation"),
  assurance: provenanceAssuranceSchema,
  sourceRefs: z.array(readinessSourceRefSchema).max(20),
  caveatCodes: z.array(readinessCaveatCodeSchema).max(20)
});
export const readinessNextActionSchema = z.object({
  actionCode: readinessActionCodeSchema,
  targetRefs: z.array(readinessTargetRefSchema).max(20),
  requiresReread: z.boolean()
});
export const workflowReadinessSchema = z.object({
  status: readinessStatusSchema,
  reasonCodes: z.array(readinessReasonCodeSchema).max(20),
  findings: z.array(readinessFindingSchema).max(20),
  nextActions: z.array(readinessNextActionSchema).max(20),
  asOf: z.string().datetime()
});
export const workflowReadinessQuerySchema = z.object({
  project: z.string().trim().min(1).max(120)
});
export const workflowReviewPacketQuerySchema = z.object({
  project: z.string().trim().min(1).max(120),
  limit: z.coerce.number().int().positive().max(50).default(20)
});

const packetSourceRefSchema = z.object({
  type: z.enum(["run", "openLoop", "handoff", "decision", "verification", "artifact"]),
  id: z.string().trim().min(1).max(255),
  version: z.number().int().positive().optional()
});
const packetRunSchema = z.object({
  id: z.string(),
  source: z.string(),
  workKey: z.string().optional(),
  workflowId: z.string(),
  parentRunId: z.string().optional(),
  continuedFromRunId: z.string().optional(),
  status: runStatusSchema,
  version: z.number().int().positive(),
  startedAt: z.string().datetime(),
  updatedAt: z.string().datetime(),
  freshness: z.object({
    state: z.enum(["fresh", "stale_candidate", "unknown", "not_applicable"]),
    lastLivenessAt: z.string().datetime().optional(),
    staleAfterSeconds: z.number().int().positive(),
    asOf: z.string().datetime(),
    reasonCode: z.enum([
      "authoritative_liveness_within_window",
      "run_liveness_exceeds_window",
      "no_authoritative_liveness",
      "terminal_status"
    ])
  }),
  declaredAgent: z
    .object({
      name: z.string().optional(),
      model: z.string().optional(),
      origin: z.literal("client_reported"),
      assurance: z.literal("asserted")
    })
    .optional(),
  sourceRef: packetSourceRefSchema
});
const packetDecisionSchema = z.object({
  id: z.string(),
  project: z.string().optional(),
  title: z.string(),
  supersedesDecisionId: z.string().optional(),
  origin: z.literal("deterministic_derivation"),
  assurance: z.literal("evidence_backed"),
  sourceRefs: z.array(packetSourceRefSchema).max(2)
});
const packetVerificationSchema = z.object({
  id: z.string(),
  runId: z.string(),
  checkId: z.string(),
  kind: verificationKindSchema,
  outcome: verificationOutcomeSchema,
  name: z.string(),
  support: verificationSupportSchema,
  completedAt: z.string().datetime(),
  origin: z.literal("client_reported"),
  assurance: provenanceAssuranceSchema,
  sourceRef: packetSourceRefSchema
});
const packetArtifactSchema = z.object({
  id: z.string(),
  runId: z.string(),
  kind: z.string(),
  path: z.string().optional(),
  sizeBytes: z.number().int().nonnegative().optional(),
  sha256: z.string().optional(),
  sourceRef: packetSourceRefSchema
});
const packetOpenLoopSchema = z.object({
  id: z.string(),
  type: openLoopTypeSchema,
  sourceRunId: z.string().optional(),
  status: z.literal("open"),
  version: z.number().int().positive(),
  sourceRef: packetSourceRefSchema
});
const packetHandoffSchema = z.object({
  id: z.string(),
  sourceRunId: z.string().optional(),
  targetRunId: z.string().optional(),
  fromSource: z.string(),
  toSource: z.string().optional(),
  status: handoffStatusSchema,
  version: z.number().int().positive(),
  sourceRef: packetSourceRefSchema
});
const packetSectionSchema = z.enum([
  "runs",
  "effectiveDecisions",
  "verifications",
  "artifacts",
  "openLoops",
  "handoffs"
]);
const packetSectionMetaSchema = z.object({
  limit: z.number().int().positive().max(50),
  count: z.number().int().nonnegative(),
  hasMore: z.boolean()
});
const packetLimitationSchema = z.object({
  code: z.enum([
    "agent_identity_client_asserted",
    "verification_client_asserted",
    "verification_assurance_mixed",
    "workflow_relationship_incomplete",
    "run_freshness_unknown",
    "legacy_record_incomplete",
    "section_truncated",
    "unsafe_artifact_path_omitted"
  ]),
  section: packetSectionSchema.optional()
});
const packetNextActionSchema = readinessNextActionSchema.extend({
  reasonCodes: z.array(readinessReasonCodeSchema).max(20)
});
export const workflowReviewPacketSchema = z.object({
  schemaVersion: z.literal("1"),
  asOf: z.string().datetime(),
  workflow: z.object({
    id: z.string(),
    project: z.string(),
    workKey: z.string().optional(),
    rootRunId: z.string(),
    runIds: z.array(z.string()).max(50)
  }),
  runs: z.array(packetRunSchema).max(50),
  effectiveDecisions: z.array(packetDecisionSchema).max(50),
  verifications: z.array(packetVerificationSchema).max(50),
  artifacts: z.array(packetArtifactSchema).max(50),
  openLoops: z.array(packetOpenLoopSchema).max(50),
  handoffs: z.array(packetHandoffSchema).max(50),
  readiness: workflowReadinessSchema,
  nextActions: z.array(packetNextActionSchema).max(20),
  limitations: z.array(packetLimitationSchema).max(50),
  truncation: z.record(packetSectionSchema, packetSectionMetaSchema)
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
  effectiveOnly: queryBooleanSchema.default(false),
  limit: z.coerce.number().int().positive().max(50).default(20)
});

export const agentContextQuerySchema = z.object({
  project: z.string().trim().min(1).max(120),
  limit: z.coerce.number().int().positive().max(50).default(10),
  min_importance: z.coerce.number().int().min(0).max(10).default(4),
  cursor: z.string().trim().min(1).max(2048).optional()
});

export const prepareWorkQuerySchema = z.object({
  project: z.string().trim().min(1).max(120),
  source: z.string().trim().min(1).max(80).optional(),
  workKey: workKeySchema,
  runId: z.string().trim().min(1).max(255).optional(),
  category: categorySchema,
  tags: z.array(tagSchema).max(10).default([]),
  limit: z.coerce.number().int().positive().max(20).default(10),
  cursor: z.string().trim().min(1).max(2048).optional()
});

export type RunStatus = z.infer<typeof runStatusSchema>;
export type EventType = z.infer<typeof eventTypeSchema>;
export type OpenLoopType = z.infer<typeof openLoopTypeSchema>;
export type OpenLoopStatus = z.infer<typeof openLoopStatusSchema>;
export type HandoffStatus = z.infer<typeof handoffStatusSchema>;
export type CreateRunRequest = z.infer<typeof createRunRequestSchema>;
export type CloseStaleRunsRequest = z.infer<typeof closeStaleRunsRequestSchema>;
export type UpdateRunRequest = z.infer<typeof updateRunRequestSchema>;
export type PauseRunRequest = z.infer<typeof pauseRunRequestSchema>;
export type FinishRunRequest = z.infer<typeof finishRunRequestSchema>;
export type CreateEventRequest = z.infer<typeof createEventRequestSchema>;
export type ListRunsQuery = z.infer<typeof listRunsQuerySchema>;
export type WorkflowRunsQuery = z.infer<typeof workflowRunsQuerySchema>;
export type ListEventsQuery = z.infer<typeof listEventsQuerySchema>;
export type CreateOpenLoopRequest = z.infer<typeof createOpenLoopRequestSchema>;
export type UpdateOpenLoopRequest = z.infer<typeof updateOpenLoopRequestSchema>;
export type ListOpenLoopsQuery = z.infer<typeof listOpenLoopsQuerySchema>;
export type CreateDecisionRequest = z.infer<typeof createDecisionRequestSchema>;
export type ListDecisionsQuery = z.infer<typeof listDecisionsQuerySchema>;
export type CreateHandoffRequest = z.infer<typeof createHandoffRequestSchema>;
export type ListHandoffsQuery = z.infer<typeof listHandoffsQuerySchema>;
export type AcceptHandoffRequest = z.infer<typeof acceptHandoffRequestSchema>;
export type DeclineHandoffRequest = z.infer<typeof declineHandoffRequestSchema>;
export type CreateArtifactRequest = z.infer<typeof createArtifactRequestSchema>;
export type ListArtifactsQuery = z.infer<typeof listArtifactsQuerySchema>;
export type VerificationKind = z.infer<typeof verificationKindSchema>;
export type VerificationOutcome = z.infer<typeof verificationOutcomeSchema>;
export type VerificationSupport = z.infer<typeof verificationSupportSchema>;
export type CreateVerificationRequest = z.infer<typeof createVerificationRequestSchema>;
export type ListVerificationsQuery = z.infer<typeof listVerificationsQuerySchema>;
export type ProvenanceOrigin = z.infer<typeof provenanceOriginSchema>;
export type ProvenanceAssurance = z.infer<typeof provenanceAssuranceSchema>;
export type ReadinessStatus = z.infer<typeof readinessStatusSchema>;
export type ReadinessReasonCode = z.infer<typeof readinessReasonCodeSchema>;
export type ReadinessActionCode = z.infer<typeof readinessActionCodeSchema>;
export type ReadinessCaveatCode = z.infer<typeof readinessCaveatCodeSchema>;
export type ReadinessSourceRef = z.infer<typeof readinessSourceRefSchema>;
export type ReadinessTargetRef = z.infer<typeof readinessTargetRefSchema>;
export type ReadinessFinding = z.infer<typeof readinessFindingSchema>;
export type ReadinessNextAction = z.infer<typeof readinessNextActionSchema>;
export type WorkflowReadiness = z.infer<typeof workflowReadinessSchema>;
export type WorkflowReviewPacketQuery = z.infer<typeof workflowReviewPacketQuerySchema>;
export type WorkflowReviewPacket = z.infer<typeof workflowReviewPacketSchema>;
export type JournalSearchQuery = z.infer<typeof journalSearchQuerySchema>;
export type AgentContextQuery = z.infer<typeof agentContextQuerySchema>;
export type PrepareWorkQuery = z.infer<typeof prepareWorkQuerySchema>;

export type AgentRun = {
  id: string;
  source: string;
  project: string;
  agentName?: string;
  agentModel?: string;
  clientRunId?: string;
  workKey?: string;
  workflowId?: string;
  parentRunId?: string;
  continuedFromRunId?: string;
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
  version: number;
  lastLivenessAt?: string;
  startedAt: string;
  completedAt?: string;
  createdAt: string;
  updatedAt: string;
};

export type WorkflowRunSummary = Pick<
  AgentRun,
  | "id"
  | "source"
  | "project"
  | "task"
  | "status"
  | "workflowId"
  | "parentRunId"
  | "continuedFromRunId"
  | "version"
  | "startedAt"
  | "updatedAt"
>;

export type RunConflict = Pick<
  AgentRun,
  "id" | "source" | "project" | "workKey" | "task" | "status" | "version" | "updatedAt"
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
  version: number;
  createdAt: string;
  updatedAt: string;
  resolvedAt?: string;
};

export type Decision = {
  id: string;
  project?: string;
  clientRecordId?: string;
  supersedesDecisionId?: string;
  title: string;
  decision: string;
  rationale?: string;
  state: "current" | "superseded";
  replacingDecisionId?: string;
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
  status: HandoffStatus;
  acceptedBy?: string;
  acceptedAt?: string;
  targetRunId?: string;
  completedAt?: string;
  declineReason?: string;
  version: number;
  createdAt: string;
  updatedAt: string;
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

export type VerificationEvidence = {
  id: string;
  runId: string;
  clientRecordId?: string;
  checkId: string;
  kind: VerificationKind;
  outcome: VerificationOutcome;
  name: string;
  summary?: string;
  commandSummary?: string;
  durationMs?: number;
  support: VerificationSupport;
  completedAt: string;
  createdAt: string;
};

export type AgentContext = {
  project: string;
  recent_runs: AgentRun[];
  failed_runs: AgentRun[];
  recent_events: Array<Omit<AgentEvent, "data">>;
  pending_handoffs: HandoffSummary[];
  recent_handoffs: HandoffSummary[];
  open_loops: OpenLoop[];
  decisions: Decision[];
  next_actions: string[];
  mode: "full" | "incremental";
  cursor: string;
  changes?: IncrementalContextChanges;
};

export type IncrementalContextChanges = {
  runs: Array<
    Pick<
      AgentRun,
      | "id"
      | "source"
      | "project"
      | "workKey"
      | "workflowId"
      | "parentRunId"
      | "continuedFromRunId"
      | "status"
      | "category"
      | "tags"
      | "version"
      | "startedAt"
      | "updatedAt"
    >
  >;
  events: Array<
    Pick<AgentEvent, "id" | "runId" | "type" | "importance" | "category" | "tags" | "createdAt">
  >;
  openLoops: Array<
    Pick<
      OpenLoop,
      | "id"
      | "type"
      | "project"
      | "owner"
      | "source"
      | "sourceRunId"
      | "status"
      | "version"
      | "updatedAt"
    >
  >;
  handoffs: Array<
    Pick<
      Handoff,
      | "id"
      | "sourceRunId"
      | "fromSource"
      | "toSource"
      | "project"
      | "status"
      | "targetRunId"
      | "version"
      | "updatedAt"
    >
  >;
  decisions: Array<
    Pick<
      Decision,
      "id" | "project" | "supersedesDecisionId" | "state" | "replacingDecisionId" | "createdAt"
    >
  >;
  sections: Record<
    "runs" | "events" | "openLoops" | "handoffs" | "decisions",
    { limit: number; count: number; truncated: boolean }
  >;
};

export type RunFreshness = {
  state: "fresh" | "stale_candidate" | "unknown" | "not_applicable";
  lastLivenessAt?: string;
  staleAfterSeconds: number;
  asOf: string;
  reasonCode:
    | "authoritative_liveness_within_window"
    | "run_liveness_exceeds_window"
    | "no_authoritative_liveness"
    | "terminal_status";
};

export type PrepareWorkRunSummary = Pick<
  AgentRun,
  | "id"
  | "source"
  | "project"
  | "workKey"
  | "workflowId"
  | "parentRunId"
  | "continuedFromRunId"
  | "status"
  | "category"
  | "tags"
  | "version"
  | "startedAt"
  | "updatedAt"
> & { freshness: RunFreshness };

export type PrepareWorkConflict = PrepareWorkRunSummary & {
  conflictCode: "active_work_conflict" | "stale_work_warning" | "work_freshness_unknown";
};

export type PrepareWorkTargetRef = {
  type: "run" | "handoff" | "openLoop";
  id: string;
  version: number;
};

export type PrepareWorkRecommendation = {
  actionCode:
    | "inspect_active_conflict"
    | "inspect_stale_run"
    | "resume_run"
    | "accept_handoff"
    | "resolve_blocker"
    | "inspect_failed_manifest"
    | "start_new_run"
    | "stop_and_reread";
  targetRefs: PrepareWorkTargetRef[];
  reasonCodes: Array<
    | "fresh_nonterminal_same_work_key"
    | "run_liveness_exceeds_window"
    | "run_liveness_unknown"
    | "blocking_open_loop"
    | "pending_targeted_handoff"
    | "selected_run_failed"
    | "selected_run_can_resume"
    | "selected_run_terminal"
    | "no_conflicting_or_blocked_work"
  >;
  requiresReread: boolean;
};

export type PrepareWorkHandoff = Pick<
  Handoff,
  "id" | "sourceRunId" | "fromSource" | "toSource" | "status" | "version" | "updatedAt"
>;

export type PrepareWorkOpenLoop = Pick<
  OpenLoop,
  "id" | "type" | "owner" | "source" | "sourceRunId" | "status" | "version" | "updatedAt"
>;

export type PrepareWorkDecision = Pick<
  Decision,
  "id" | "project" | "supersedesDecisionId" | "title" | "state" | "createdAt"
>;

export type PrepareWorkManifestSummary = {
  runId: string;
  status: RunStatus;
  eventCount: number;
  openLoopCount: number;
  handoffCount: number;
  artifactCount: number;
  lastEventAt?: string;
};

type PrepareWorkSectionMeta = {
  limit: number;
  count: number;
  truncated: boolean;
};

type PrepareWorkSectionName =
  | "relevantRuns"
  | "workflowRuns"
  | "conflicts"
  | "pendingHandoffs"
  | "openLoops"
  | "effectiveDecisions"
  | "recommendations"
  | "warnings";

export type PrepareWorkResponse = {
  project: string;
  asOf: string;
  staleAfterSeconds: number;
  mode: "full" | "incremental";
  cursor: string;
  changes?: IncrementalContextChanges;
  selectedRun?: PrepareWorkRunSummary;
  relevantRuns: PrepareWorkRunSummary[];
  workflowRuns: PrepareWorkRunSummary[];
  conflicts: PrepareWorkConflict[];
  pendingHandoffs: PrepareWorkHandoff[];
  openLoops: PrepareWorkOpenLoop[];
  effectiveDecisions: PrepareWorkDecision[];
  latestManifest?: PrepareWorkManifestSummary;
  readiness?: WorkflowReadiness;
  recommendations: PrepareWorkRecommendation[];
  warnings: Array<{ code: "section_truncated"; section: PrepareWorkSectionName }>;
  sections: {
    relevantRuns: PrepareWorkSectionMeta;
    workflowRuns: PrepareWorkSectionMeta;
    conflicts: PrepareWorkSectionMeta;
    pendingHandoffs: PrepareWorkSectionMeta;
    openLoops: PrepareWorkSectionMeta;
    effectiveDecisions: PrepareWorkSectionMeta;
    recommendations: PrepareWorkSectionMeta;
    warnings: PrepareWorkSectionMeta;
  };
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
  verifications: VerificationEvidence[];
  recovery_receipts: RecoveryReceipt[];
  readiness: WorkflowReadiness;
};

export type JournalSearchResults = {
  runs: AgentRun[];
  events: Array<Omit<AgentEvent, "data">>;
  open_loops: OpenLoop[];
  handoffs: Handoff[];
  decisions: Decision[];
};
