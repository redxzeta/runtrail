import { describe, expect, it } from "vitest";
import {
  RUNTRAIL_CAPABILITIES,
  RUNTRAIL_CAPABILITY_FEATURES,
  RUNTRAIL_TOOL_NAMES
} from "../src/shared/capabilities.js";
import {
  agentContextQuerySchema,
  capabilitiesManifestSchema,
  journalSearchQuerySchema,
  listRunsQuerySchema,
  prepareWorkQuerySchema,
  workflowReviewPacketQuerySchema,
  workflowRunsQuerySchema
} from "../src/shared/schemas.js";

describe("capabilities manifest", () => {
  it("stays versioned, deterministic, secret-free, and aligned with validation", () => {
    expect(capabilitiesManifestSchema.parse(RUNTRAIL_CAPABILITIES)).toEqual(RUNTRAIL_CAPABILITIES);
    expect(RUNTRAIL_CAPABILITIES.features.map(({ id }) => id)).toEqual([
      ...RUNTRAIL_CAPABILITY_FEATURES
    ]);
    expect(RUNTRAIL_CAPABILITIES.mcp.tools).toEqual([...RUNTRAIL_TOOL_NAMES]);

    const limits = [
      ["runs", listRunsQuerySchema, {}],
      ["workflowRuns", workflowRunsQuerySchema, { project: "runtrail" }],
      ["context", agentContextQuerySchema, { project: "runtrail" }],
      ["prepareWork", prepareWorkQuerySchema, { project: "runtrail" }],
      ["journalSearch", journalSearchQuerySchema, {}],
      ["workflowReviewPacket", workflowReviewPacketQuerySchema, { project: "runtrail" }]
    ] as const;
    for (const [name, schema, base] of limits) {
      const advertised = RUNTRAIL_CAPABILITIES.limits[name];
      expect(schema.parse(base).limit, name).toBe(advertised.default);
      expect(schema.safeParse({ ...base, limit: advertised.maximum }).success, name).toBe(true);
      expect(schema.safeParse({ ...base, limit: advertised.maximum + 1 }).success, name).toBe(
        false
      );
    }

    const serialized = JSON.stringify(RUNTRAIL_CAPABILITIES);
    for (const excluded of [
      "token",
      "authorization",
      "database",
      "projectName",
      "RUNTRAIL_",
      "/Users/",
      "private"
    ]) {
      expect(serialized.toLowerCase()).not.toContain(excluded.toLowerCase());
    }
  });
});
