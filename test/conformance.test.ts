import { existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { capabilityGate, runConformance } from "../src/conformance.js";
import { conformanceResultSchema } from "../src/shared/schemas.js";

describe("conformance runner", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
    vi.restoreAllMocks();
  });

  it("isolates, gates, serializes, redacts, and cleans success and failure runs", async () => {
    const outputDirectory = mkdtempSync(path.join(tmpdir(), "runtrail-conformance-test-"));
    const temporaryDirectories: string[] = [];
    vi.stubEnv("RUNTRAIL_URL", "https://live.example.invalid");
    vi.stubEnv("RUNTRAIL_DB_PATH", "/private/live.sqlite");
    vi.spyOn(console, "log").mockImplementation(() => undefined);
    try {
      const successPath = path.join(outputDirectory, "success.json");
      const success = await runConformance({
        output: successPath,
        onTemporaryDirectory: (directory) => temporaryDirectories.push(directory)
      });
      expect(conformanceResultSchema.parse(success)).toEqual(success);
      expect(success).toEqual(
        expect.objectContaining({
          resultSchemaVersion: "1",
          serviceProtocolVersion: "1",
          summary: expect.objectContaining({ failed: 0, notSupported: 0 }),
          cleanup: { status: "passed" }
        })
      );
      expect(success.profiles.map(({ name }) => name)).toEqual([
        "baseline",
        "agent-continuation-v1"
      ]);
      expect(
        success.profiles
          .flatMap(({ steps }) => steps)
          .filter(({ capability }) => capability)
          .every(({ result }) => result === "passed")
      ).toBe(true);
      expect(
        [
          ...new Set(
            success.profiles
              .flatMap(({ steps }) => steps)
              .flatMap(({ capability }) => (capability ? [capability] : []))
          )
        ].sort()
      ).toEqual([...success.capabilities].sort());
      expect(conformanceResultSchema.parse(JSON.parse(readFileSync(successPath, "utf8")))).toEqual(
        success
      );

      const failurePath = path.join(outputDirectory, "failure.json");
      const failure = await runConformance({
        output: failurePath,
        induceFailure: true,
        onTemporaryDirectory: (directory) => temporaryDirectories.push(directory)
      });
      expect(failure.summary.failed).toBe(1);
      expect(failure.cleanup.status).toBe("passed");
      expect(
        failure.profiles.flatMap(({ steps }) => steps).find(({ result }) => result === "failed")
      ).toEqual(
        expect.objectContaining({
          capability: "workflow_review_packet",
          diagnostic: "induced advertised-capability mismatch"
        })
      );
      expect(conformanceResultSchema.parse(JSON.parse(readFileSync(failurePath, "utf8")))).toEqual(
        failure
      );
      expect(capabilityGate(new Set(), "prepare_work")).toBe("not_supported");
      expect(capabilityGate(new Set(["prepare_work"]), "prepare_work")).toBe("run");
      for (const directory of temporaryDirectories) expect(existsSync(directory)).toBe(false);

      const serialized = `${readFileSync(successPath, "utf8")}${readFileSync(failurePath, "utf8")}`;
      for (const forbidden of [
        "https://live.example.invalid",
        "/private/live.sqlite",
        "Bearer ",
        process.env.HOME ?? ""
      ]) {
        if (forbidden) expect(serialized).not.toContain(forbidden);
      }
    } finally {
      rmSync(outputDirectory, { recursive: true, force: true });
    }
  });
});
