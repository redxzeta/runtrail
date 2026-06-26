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

  process.on("SIGINT", () => {
    db.close();
    process.exit(0);
  });
}

if (import.meta.url === `file://${process.argv[1]}`) {
  startServer();
}
