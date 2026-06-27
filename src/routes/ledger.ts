import type Database from "better-sqlite3";
import { Hono } from "hono";
import type { RuntrailConfig } from "../config.js";
import { LedgerRepository } from "../db/ledger.js";
import {
  type AgentEvent,
  type AgentRun,
  agentContextQuerySchema,
  createDecisionRequestSchema,
  createEventRequestSchema,
  createOpenLoopRequestSchema,
  createRunRequestSchema,
  type Decision,
  listDecisionsQuerySchema,
  listEventsQuerySchema,
  listOpenLoopsQuerySchema,
  listRunsQuerySchema,
  type OpenLoop,
  updateOpenLoopRequestSchema,
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

  route.get("/", (c) =>
    c.html(
      page("Runtrail", [
        section("Context recovery", [
          link("/runs", "Recent runs"),
          link("/open-loops", "Open loops"),
          link("/decisions", "Decisions"),
          link("/errors", "Failed runs")
        ])
      ])
    )
  );

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

    const runs = ledger.listRuns(parsed.data);

    if (wantsHtml(c.req.raw)) {
      return c.html(page("Runs", [runList(runs)]));
    }

    return c.json({ runs });
  });

  route.get("/runs/:id", (c) => {
    const run = ledger.getRun(c.req.param("id"));

    if (!run) {
      return c.json({ error: "Run not found" }, 404);
    }

    const events = ledger.listEventsForRun(run.id);

    if (wantsHtml(c.req.raw)) {
      return c.html(page(run.task, [runDetail(run, events)]));
    }

    return c.json({ run, events });
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

  route.post("/open-loops", async (c) => {
    const body = await readJson(c.req.raw);
    const parsed = createOpenLoopRequestSchema.safeParse(body);

    if (!parsed.success) {
      return c.json(formatValidationError(parsed.error), 400);
    }

    return c.json({ openLoop: ledger.createOpenLoop(parsed.data) }, 201);
  });

  route.get("/open-loops", (c) => {
    const parsed = listOpenLoopsQuerySchema.safeParse(
      Object.fromEntries(new URL(c.req.url).searchParams)
    );

    if (!parsed.success) {
      return c.json(formatValidationError(parsed.error), 400);
    }

    const openLoops = ledger.listOpenLoops(parsed.data);

    if (wantsHtml(c.req.raw)) {
      return c.html(page("Open loops", [openLoopList(openLoops)]));
    }

    return c.json({ openLoops });
  });

  route.patch("/open-loops/:id", async (c) => {
    const body = await readJson(c.req.raw);
    const parsed = updateOpenLoopRequestSchema.safeParse(body);

    if (!parsed.success) {
      return c.json(formatValidationError(parsed.error), 400);
    }

    const openLoop = ledger.updateOpenLoop(c.req.param("id"), parsed.data);

    if (!openLoop) {
      return c.json({ error: "Open loop not found" }, 404);
    }

    return c.json({ openLoop });
  });

  route.post("/decisions", async (c) => {
    const body = await readJson(c.req.raw);
    const parsed = createDecisionRequestSchema.safeParse(body);

    if (!parsed.success) {
      return c.json(formatValidationError(parsed.error), 400);
    }

    return c.json({ decision: ledger.createDecision(parsed.data) }, 201);
  });

  route.get("/decisions", (c) => {
    const parsed = listDecisionsQuerySchema.safeParse(
      Object.fromEntries(new URL(c.req.url).searchParams)
    );

    if (!parsed.success) {
      return c.json(formatValidationError(parsed.error), 400);
    }

    const decisions = ledger.listDecisions(parsed.data);

    if (wantsHtml(c.req.raw)) {
      return c.html(page("Decisions", [decisionList(decisions)]));
    }

    return c.json({ decisions });
  });

  route.get("/agent/context", (c) => {
    const parsed = agentContextQuerySchema.safeParse(
      Object.fromEntries(new URL(c.req.url).searchParams)
    );

    if (!parsed.success) {
      return c.json(formatValidationError(parsed.error), 400);
    }

    return c.json(ledger.getAgentContext(parsed.data));
  });

  route.get("/projects/:project", (c) => {
    const project = c.req.param("project");
    const runs = ledger.listRuns({ project, limit: 25 });
    const openLoops = ledger.listOpenLoops({ project, status: "open", limit: 25 });
    const decisions = ledger.listDecisions({ project, includeGlobal: true, limit: 25 });

    return c.html(
      page(`Project: ${project}`, [runList(runs), openLoopList(openLoops), decisionList(decisions)])
    );
  });

  route.get("/errors", (c) => {
    const runs = ledger.listRuns({ status: "failed", limit: 50 });
    return c.html(page("Failed runs", [runList(runs)]));
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

function wantsHtml(request: Request): boolean {
  return request.headers.get("accept")?.includes("text/html") ?? false;
}

function page(title: string, sections: string[]): string {
  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>${escapeHtml(title)} - Runtrail</title>
  <style>
    body { color: #1f2933; font: 15px/1.5 system-ui, sans-serif; margin: 0; background: #f7f8fa; }
    header, main { margin: 0 auto; max-width: 960px; padding: 24px; }
    header { border-bottom: 1px solid #d9dee7; }
    nav a, main a { color: #0f5e9c; margin-right: 14px; }
    h1 { font-size: 28px; margin: 0 0 12px; }
    h2 { font-size: 18px; margin: 24px 0 8px; }
    table { border-collapse: collapse; width: 100%; }
    th, td { border-bottom: 1px solid #d9dee7; padding: 8px; text-align: left; vertical-align: top; }
    .meta { color: #5b6776; font-size: 13px; }
    .empty { color: #5b6776; }
  </style>
</head>
<body>
  <header>
    <h1>${escapeHtml(title)}</h1>
    <nav>
      ${link("/", "Home")}
      ${link("/runs", "Runs")}
      ${link("/open-loops", "Open loops")}
      ${link("/decisions", "Decisions")}
      ${link("/errors", "Errors")}
    </nav>
  </header>
  <main>${sections.join("\n")}</main>
</body>
</html>`;
}

function section(title: string, items: string[]): string {
  return `<section><h2>${escapeHtml(title)}</h2>${items.join(" ")}</section>`;
}

function runList(runs: AgentRun[]): string {
  if (runs.length === 0) {
    return section("Runs", ['<p class="empty">No runs found.</p>']);
  }

  return `<section>
    <h2>Runs</h2>
    <table>
      <thead><tr><th>Task</th><th>Status</th><th>Summary</th><th>Project</th><th>Updated</th></tr></thead>
      <tbody>${runs
        .map(
          (run) => `<tr>
            <td>${link(`/runs/${encodeURIComponent(run.id)}`, run.task)}</td>
            <td>${escapeHtml(run.status)}</td>
            <td>${escapeHtml(run.summary ?? "")}</td>
            <td>${link(`/projects/${encodeURIComponent(run.project)}`, run.project)}</td>
            <td class="meta">${escapeHtml(run.updatedAt)}</td>
          </tr>`
        )
        .join("")}</tbody>
    </table>
  </section>`;
}

function runDetail(run: AgentRun, events: AgentEvent[]): string {
  return `<section>
    <h2>${escapeHtml(run.status)}</h2>
    <p>${escapeHtml(run.summary ?? run.task)}</p>
    <p class="meta">${escapeHtml(run.source)} / ${escapeHtml(run.project)} / ${escapeHtml(
      run.startedAt
    )}</p>
  </section>
  <section>
    <h2>Events</h2>
    ${
      events.length === 0
        ? '<p class="empty">No events found.</p>'
        : `<table>
          <thead><tr><th>Type</th><th>Message</th><th>Importance</th><th>Created</th></tr></thead>
          <tbody>${events
            .map(
              (event) => `<tr>
                <td>${escapeHtml(event.type)}</td>
                <td>${escapeHtml(event.message)}</td>
                <td>${event.importance}</td>
                <td class="meta">${escapeHtml(event.createdAt)}</td>
              </tr>`
            )
            .join("")}</tbody>
        </table>`
    }
  </section>`;
}

function openLoopList(openLoops: OpenLoop[]): string {
  if (openLoops.length === 0) {
    return section("Open loops", ['<p class="empty">No open loops found.</p>']);
  }

  return `<section>
    <h2>Open loops</h2>
    <table>
      <thead><tr><th>Title</th><th>Type</th><th>Project</th><th>Updated</th></tr></thead>
      <tbody>${openLoops
        .map(
          (loop) => `<tr>
            <td>${escapeHtml(loop.title)}</td>
            <td>${escapeHtml(loop.type)}</td>
            <td>${link(`/projects/${encodeURIComponent(loop.project)}`, loop.project)}</td>
            <td class="meta">${escapeHtml(loop.updatedAt)}</td>
          </tr>`
        )
        .join("")}</tbody>
    </table>
  </section>`;
}

function decisionList(decisions: Decision[]): string {
  if (decisions.length === 0) {
    return section("Decisions", ['<p class="empty">No decisions found.</p>']);
  }

  return `<section>
    <h2>Decisions</h2>
    <table>
      <thead><tr><th>Title</th><th>Decision</th><th>Project</th><th>Created</th></tr></thead>
      <tbody>${decisions
        .map(
          (decision) => `<tr>
            <td>${escapeHtml(decision.title)}</td>
            <td>${escapeHtml(decision.decision)}</td>
            <td>${decision.project ? escapeHtml(decision.project) : "global"}</td>
            <td class="meta">${escapeHtml(decision.createdAt)}</td>
          </tr>`
        )
        .join("")}</tbody>
    </table>
  </section>`;
}

function link(href: string, label: string): string {
  return `<a href="${escapeHtml(href)}">${escapeHtml(label)}</a>`;
}

function escapeHtml(value: string): string {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}
