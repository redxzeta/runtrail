import { describe, expect, it } from "vitest";
import { createApp } from "../src/index.js";

describe("health route", () => {
  it("returns the Runtrail health response", async () => {
    const response = await createApp().request("/health");

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({
      ok: true,
      service: "runtrail"
    });
  });
});
