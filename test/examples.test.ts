import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

describe("examples", () => {
  it("keeps Claude Code hook JSON parseable", () => {
    const json = readFileSync(
      join(process.cwd(), "examples/claude-code-hooks/hooks.example.json"),
      "utf8"
    );

    expect(() => JSON.parse(json)).not.toThrow();
  });
});
