import { serve } from "@hono/node-server";
import { Hono } from "hono";
import { loadConfig } from "./config.js";
import { openDatabase } from "./db/index.js";
import { createHealthRoute } from "./routes/health.js";

export function createApp(): Hono {
  const app = new Hono();
  app.route("/health", createHealthRoute());
  return app;
}

export function startServer(): void {
  const config = loadConfig();
  const db = openDatabase(config);
  const app = createApp();
  let shuttingDown = false;

  serve(
    {
      fetch: app.fetch,
      hostname: config.server.host,
      port: config.server.port
    },
    (info) => {
      console.log(`Runtrail listening on http://${info.address}:${info.port}`);
    }
  );

  const shutdown = (): void => {
    if (shuttingDown) {
      return;
    }

    shuttingDown = true;
    db.close();
    process.exit(0);
  };

  process.once("SIGINT", shutdown);
  process.once("SIGTERM", shutdown);
}

if (import.meta.url === `file://${process.argv[1]}`) {
  startServer();
}
