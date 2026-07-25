import { createRequire } from "node:module";
import type { CapabilitiesManifest, CapabilityFeatureId } from "./schemas.js";

export const RUNTRAIL_TOOL_NAMES = [
  "journal_start_run",
  "journal_resume_run",
  "journal_heartbeat_run",
  "journal_pause_run",
  "journal_finish_run",
  "journal_get_context",
  "journal_prepare_work",
  "journal_create_event",
  "journal_record_verification",
  "journal_create_open_loop",
  "journal_resolve_open_loop",
  "journal_record_decision",
  "journal_list_decisions",
  "journal_create_handoff",
  "journal_list_pending_handoffs",
  "journal_accept_handoff",
  "journal_decline_handoff",
  "journal_complete_handoff",
  "journal_expire_handoff",
  "journal_get_run_manifest",
  "journal_get_workflow",
  "journal_get_workflow_review_packet",
  "journal_get_capabilities",
  "journal_search",
  "journal_search_runs"
] as const;

export const RUNTRAIL_CAPABILITY_FEATURES = [
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
] as const satisfies readonly CapabilityFeatureId[];

const packageVersion = (createRequire(import.meta.url)("../../package.json") as { version: string })
  .version;

export const RUNTRAIL_CAPABILITIES: CapabilitiesManifest = {
  schemaVersion: "1",
  service: { name: "runtrail", version: packageVersion },
  protocol: { name: "runtrail-agent-ledger", version: "1" },
  schemas: { capabilities: "1", workflowReviewPacket: "1" },
  features: RUNTRAIL_CAPABILITY_FEATURES.map((id) => ({ id, version: "1" })),
  mcp: {
    transports: ["streamable_http", "stdio_bridge"],
    tools: [...RUNTRAIL_TOOL_NAMES]
  },
  limits: {
    runs: { default: 50, maximum: 100 },
    workflowRuns: { default: 20, maximum: 50 },
    context: { default: 10, maximum: 50 },
    prepareWork: { default: 10, maximum: 20 },
    journalSearch: { default: 20, maximum: 50 },
    workflowReviewPacket: { default: 20, maximum: 50 }
  },
  semantics: {
    capabilityClaims: "protocol_support",
    verificationEvidence: "recorded_client_evidence"
  }
};
