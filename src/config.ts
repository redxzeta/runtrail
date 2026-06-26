import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { parse } from "yaml";
import { z } from "zod";

const yamlConfigSchema = z.object({
  server: z.object({
    host: z.string(),
    port: z.number().int().positive()
  }),
  storage: z.object({
    dbPath: z.string(),
    logDir: z.string()
  }),
  security: z.object({
    authRequired: z.boolean()
  }),
  notifications: z.object({
    discord: z.object({
      enabled: z.boolean()
    })
  }),
  agentContext: z.object({
    defaultLimit: z.number().int().positive(),
    minImportance: z.number().int().min(0)
  })
});

export const runtrailConfigSchema = yamlConfigSchema.extend({
  security: yamlConfigSchema.shape.security.extend({
    token: z.string().optional()
  }),
  notifications: z.object({
    discord: yamlConfigSchema.shape.notifications.shape.discord.extend({
      webhookUrl: z.string().optional()
    })
  }),
  url: z.string()
});

export type RuntrailConfig = z.infer<typeof runtrailConfigSchema>;

export function defaultConfigPath(): string {
  return process.env.RUNTRAIL_CONFIG ?? path.resolve("config/runtrail.example.yaml");
}

export function loadConfig(configPath = defaultConfigPath()): RuntrailConfig {
  if (!existsSync(configPath)) {
    throw new Error(`Config file not found: ${configPath}`);
  }

  const yamlConfig = yamlConfigSchema.parse(parse(readFileSync(configPath, "utf8")));
  const host = process.env.RUNTRAIL_HOST ?? yamlConfig.server.host;
  const port = parsePort(process.env.RUNTRAIL_PORT, yamlConfig.server.port);

  return runtrailConfigSchema.parse({
    ...yamlConfig,
    server: {
      host,
      port
    },
    storage: {
      dbPath: process.env.RUNTRAIL_DB_PATH ?? yamlConfig.storage.dbPath,
      logDir: process.env.RUNTRAIL_LOG_DIR ?? yamlConfig.storage.logDir
    },
    security: {
      ...yamlConfig.security,
      token: emptyToUndefined(process.env.RUNTRAIL_TOKEN)
    },
    notifications: {
      discord: {
        ...yamlConfig.notifications.discord,
        webhookUrl: emptyToUndefined(process.env.DISCORD_WEBHOOK_URL)
      }
    },
    url: process.env.RUNTRAIL_URL ?? `http://${host}:${port}`
  });
}

function parsePort(value: string | undefined, fallback: number): number {
  if (!value) {
    return fallback;
  }

  const port = Number(value);
  if (!Number.isInteger(port) || port <= 0) {
    throw new Error(`Invalid RUNTRAIL_PORT: ${value}`);
  }

  return port;
}

function emptyToUndefined(value: string | undefined): string | undefined {
  return value && value.trim().length > 0 ? value : undefined;
}
