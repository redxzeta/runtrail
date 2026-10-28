import { createReadStream } from "node:fs";
import type { Command } from "commander";
import { MAX_WORK_IMPORT_BYTES } from "../integrations/workImport.js";
import { type ImportRequest, importWork } from "../integrations/workImportDelivery.js";

export function registerImportWork(program: Command, request: ImportRequest): void {
  program
    .command("import-work")
    .description("Import a bounded, client-reported work summary; always prints JSON")
    .requiredOption("--file <file>", "Explicit JSON file, or - for stdin (maximum 16 KiB)")
    .option("--dry-run", "Validate and plan only, with no requests or writes", false)
    .action(async (options: { file: string; dryRun: boolean }) => {
      let raw: string;
      try {
        raw = await readInput(options.file);
      } catch {
        console.log(
          JSON.stringify(
            {
              schemaVersion: "1",
              status: "invalid",
              confirmed: [],
              error: {
                stage: "validation",
                code: "input_unreadable_or_oversize",
                message:
                  "Cannot read bounded input; use a readable JSON file or stdin of at most 16384 bytes.",
                deliveryUnknown: false
              },
              resume: "fix_input",
              semantics: "client_reported_unverified"
            },
            null,
            2
          )
        );
        process.exitCode = 1;
        return;
      }
      const result = await importWork(raw, request, {
        dryRun: options.dryRun,
        token: process.env.RUNTRAIL_TOKEN
      });
      console.log(JSON.stringify(result, null, 2));
      if (result.status !== "complete" && result.status !== "dry_run") process.exitCode = 1;
    });
}

async function readInput(file: string): Promise<string> {
  const stream = file === "-" ? process.stdin : createReadStream(file);
  const chunks: Buffer[] = [];
  let size = 0;
  try {
    for await (const chunk of stream) {
      const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
      size += buffer.length;
      if (size > MAX_WORK_IMPORT_BYTES) throw new Error("Oversize input");
      chunks.push(buffer);
    }
    return Buffer.concat(chunks).toString("utf8");
  } finally {
    if (file !== "-") stream.destroy();
  }
}
