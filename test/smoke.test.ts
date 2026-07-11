import { existsSync } from "node:fs";
import { describe, expect, it, vi } from "vitest";
import { runLifecycleSmoke } from "../src/smoke.js";

describe("lifecycle smoke", () => {
  it("completes the isolated lifecycle", async () => {
    vi.spyOn(console, "log").mockImplementation(() => undefined);
    await expect(runLifecycleSmoke({ installSignalHandlers: false })).resolves.toBeUndefined();
  });

  it("terminates the child and removes temporary data after failure", async () => {
    vi.spyOn(console, "log").mockImplementation(() => undefined);
    let directory = "";

    await expect(
      runLifecycleSmoke({
        installSignalHandlers: false,
        onTempDir: (value) => {
          directory = value;
        },
        afterHealth: () => {
          throw new Error("injected failure");
        }
      })
    ).rejects.toThrow("injected failure");

    expect(directory).not.toBe("");
    expect(existsSync(directory)).toBe(false);
  });
});
