import { afterEach, describe, expect, it, vi } from "vitest";
import { runCli } from "../src/cli/index.js";

describe("cli", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it("prints health response JSON", async () => {
    vi.stubEnv("RUNTRAIL_URL", "http://runtrail.test");
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => {
        return new Response(
          JSON.stringify({
            ok: true,
            service: "runtrail"
          }),
          {
            status: 200,
            headers: {
              "content-type": "application/json"
            }
          }
        );
      })
    );
    const output: string[] = [];
    vi.spyOn(console, "log").mockImplementation((message: string) => {
      output.push(message);
    });

    await runCli(["node", "rt", "health"]);

    expect(fetch).toHaveBeenCalledWith(new URL("/health", "http://runtrail.test"));
    expect(JSON.parse(output.join("\n"))).toEqual({
      ok: true,
      service: "runtrail"
    });
  });
});
