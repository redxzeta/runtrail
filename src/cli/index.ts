#!/usr/bin/env node
import { Command } from "commander";
import { loadConfig } from "../config.js";
import { healthResponseSchema } from "../shared/schemas.js";

export async function runCli(argv = process.argv): Promise<void> {
  const program = new Command();

  program
    .name("rt")
    .description("Runtrail CLI")
    .showHelpAfterError()
    .exitOverride();

  program.command("health").description("Check Runtrail service health").action(health);

  await program.parseAsync(argv);
}

async function health(): Promise<void> {
  const config = loadConfig();
  const response = await fetch(new URL("/health", config.url));

  if (!response.ok) {
    throw new Error(`Health check failed: HTTP ${response.status}`);
  }

  const parsed = healthResponseSchema.parse(await response.json());
  console.log(JSON.stringify(parsed, null, 2));
}

if (import.meta.url === `file://${process.argv[1]}`) {
  runCli().catch((error: unknown) => {
    const message = error instanceof Error ? error.message : String(error);
    console.error(message);
    process.exit(1);
  });
}
