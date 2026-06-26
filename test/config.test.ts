import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { defaultConfigPath, loadConfig } from "../src/config.js";

const originalEnv = { ...process.env };

afterEach(() => {
  process.env = { ...originalEnv };
  vi.unstubAllEnvs();
});

describe("config", () => {
  it("loads the example YAML config", () => {
    const config = loadConfig();

    expect(config.server.host).toBe("0.0.0.0");
    expect(config.server.port).toBe(8787);
    expect(config.storage.dbPath).toBe("./data/runtrail.sqlite");
    expect(config.security.authRequired).toBe(true);
  });

  it("uses RUNTRAIL_CONFIG for the default config path", () => {
    const filePath = writeTempConfig({ port: 9999 });
    vi.stubEnv("RUNTRAIL_CONFIG", filePath);

    expect(defaultConfigPath()).toBe(filePath);
    expect(loadConfig().server.port).toBe(9999);
  });

  it("applies supported environment overrides", () => {
    vi.stubEnv("RUNTRAIL_HOST", "127.0.0.1");
    vi.stubEnv("RUNTRAIL_PORT", "9000");
    vi.stubEnv("RUNTRAIL_DB_PATH", "/tmp/runtrail.sqlite");
    vi.stubEnv("RUNTRAIL_LOG_DIR", "/tmp/runtrail-logs");
    vi.stubEnv("RUNTRAIL_TOKEN", "test-token");
    vi.stubEnv("RUNTRAIL_URL", "http://runtrail.test");
    vi.stubEnv("DISCORD_WEBHOOK_URL", "https://discord.test/webhook");

    const config = loadConfig();

    expect(config.server.host).toBe("127.0.0.1");
    expect(config.server.port).toBe(9000);
    expect(config.storage.dbPath).toBe("/tmp/runtrail.sqlite");
    expect(config.storage.logDir).toBe("/tmp/runtrail-logs");
    expect(config.security.token).toBe("test-token");
    expect(config.url).toBe("http://runtrail.test");
    expect(config.notifications.discord.webhookUrl).toBe("https://discord.test/webhook");
  });
});

function writeTempConfig(options: { port: number }): string {
  const dir = mkdtempSync(path.join(tmpdir(), "runtrail-config-"));
  const filePath = path.join(dir, "config.yaml");
  writeFileSync(
    filePath,
    `server:
  host: "0.0.0.0"
  port: ${options.port}
storage:
  dbPath: "./data/runtrail.sqlite"
  logDir: "./data/logs"
security:
  authRequired: true
notifications:
  discord:
    enabled: false
agentContext:
  defaultLimit: 10
  minImportance: 3
`
  );
  return filePath;
}
