import { spawn } from "node:child_process";
import { createWriteStream } from "node:fs";
import { constants } from "node:os";

// Capturing output must never determine whether the developer's command runs.
export async function captureCommand(command: string[], logPath?: string) {
  let logStored = Boolean(logPath);
  let signal: NodeJS.Signals | null = null;
  const log = logPath ? createWriteStream(logPath, { flags: "a", mode: 0o600 }) : undefined;
  const loseLog = () => {
    logStored = false;
    log?.destroy();
  };
  log?.on("error", loseLog);
  const logClosed = log
    ? new Promise<void>((resolve) => log.once("close", resolve))
    : Promise.resolve();

  const exitCode = await new Promise<number>((resolve) => {
    const child = spawn(command[0], command.slice(1), {
      cwd: process.cwd(),
      env: process.env,
      stdio: ["inherit", "pipe", "pipe"],
      shell: false
    });
    const forwardInt = () => child.kill("SIGINT");
    const forwardTerm = () => child.kill("SIGTERM");
    process.on("SIGINT", forwardInt);
    process.on("SIGTERM", forwardTerm);
    const writeLog = (chunk: Buffer) => {
      // Stop local capture instead of buffering unbounded output on slow storage.
      if (log && logStored && !log.write(chunk)) loseLog();
    };
    child.stdout.on("data", (chunk: Buffer) => {
      process.stdout.write(chunk);
      writeLog(chunk);
    });
    child.stderr.on("data", (chunk: Buffer) => {
      process.stderr.write(chunk);
      writeLog(chunk);
    });
    let spawnExitCode: number | undefined;
    child.on("error", (error: NodeJS.ErrnoException) => {
      spawnExitCode = error.code === "ENOENT" ? 127 : error.code === "EACCES" ? 126 : 1;
    });
    child.on("close", (code, childSignal) => {
      process.off("SIGINT", forwardInt);
      process.off("SIGTERM", forwardTerm);
      signal = childSignal;
      log?.end();
      resolve(spawnExitCode ?? code ?? (childSignal ? 128 + constants.signals[childSignal] : 1));
    });
  });
  await logClosed;
  return { exitCode, signal, logStored };
}
