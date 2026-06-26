import type Database from "better-sqlite3";
import { Hono } from "hono";
import type { RuntrailConfig } from "../config.js";
import { LedgerRepository } from "../db/ledger.js";
import {
  createEventRequestSchema,
  createRunRequestSchema,
  listEventsQuerySchema,
  listRunsQuerySchema,
  updateRunRequestSchema
} from "../shared/schemas.js";

type LedgerRouteOptions = {
  db: Database.Database;
  config: RuntrailConfig;
};

export function createLedgerRoute(options: LedgerRouteOptions): Hono {
  const route = new Hono();
  const ledger = new LedgerRepository(options.db);

  route.use("*", async (c, next) => {
    if (!options.config.security.authRequired) {
      await next();
      return;
    }

    const expectedToken = options.config.security.token;
    const authorization = c.req.header("authorization");

    if (!expectedToken || authorization !== `Bearer ${expectedToken}`) {
      return c.json({ error: "Unauthorized" }, 401);
    }

    await next();
  });

  route.post("/runs", async (c) => {
    const body = await readJson(c.req.raw);
    const parsed = createRunRequestSchema.safeParse(body);

    if (!parsed.success) {
      return c.json(formatValidationError(parsed.error), 400);
    }

    return c.json({ run: ledger.createRun(parsed.data) }, 201);
  });

  route.patch("/runs/:id", async (c) => {
    const body = await readJson(c.req.raw);
    const parsed = updateRunRequestSchema.safeParse(body);

    if (!parsed.success) {
      return c.json(formatValidationError(parsed.error), 400);
    }

    const run = ledger.updateRun(c.req.param("id"), parsed.data);

    if (!run) {
      return c.json({ error: "Run not found" }, 404);
    }

    return c.json({ run });
  });

  route.get("/runs", (c) => {
    const parsed = listRunsQuerySchema.safeParse(
      Object.fromEntries(new URL(c.req.url).searchParams)
    );

    if (!parsed.success) {
      return c.json(formatValidationError(parsed.error), 400);
    }

    return c.json({ runs: ledger.listRuns(parsed.data) });
  });

  route.get("/runs/:id", (c) => {
    const run = ledger.getRun(c.req.param("id"));

    if (!run) {
      return c.json({ error: "Run not found" }, 404);
    }

    return c.json({ run, events: ledger.listEventsForRun(run.id) });
  });

  route.post("/events", async (c) => {
    const body = await readJson(c.req.raw);
    const parsed = createEventRequestSchema.safeParse(body);

    if (!parsed.success) {
      return c.json(formatValidationError(parsed.error), 400);
    }

    const event = ledger.createEvent(parsed.data);

    if (!event) {
      return c.json({ error: "Run not found" }, 404);
    }

    return c.json({ event }, 201);
  });

  route.get("/events", (c) => {
    const parsed = listEventsQuerySchema.safeParse(
      Object.fromEntries(new URL(c.req.url).searchParams)
    );

    if (!parsed.success) {
      return c.json(formatValidationError(parsed.error), 400);
    }

    return c.json({ events: ledger.listEvents(parsed.data) });
  });

  return route;
}

async function readJson(request: Request): Promise<unknown> {
  try {
    return await request.json();
  } catch {
    return undefined;
  }
}

function formatValidationError(error: {
  issues: Array<{ path: PropertyKey[]; message: string }>;
}): {
  error: string;
  issues: Array<{ path: string; message: string }>;
} {
  return {
    error: "Invalid request",
    issues: error.issues.map((issue) => ({
      path: issue.path.join("."),
      message: issue.message
    }))
  };
}
