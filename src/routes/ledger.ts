import type Database from "better-sqlite3";
import { Hono } from "hono";
import type { RuntrailConfig } from "../config.js";
import { LedgerRepository } from "../db/ledger.js";
import {
  type AgentEvent,
  type AgentRun,
  type Artifact,
  agentContextQuerySchema,
  createArtifactRequestSchema,
  createDecisionRequestSchema,
  createEventRequestSchema,
  createHandoffRequestSchema,
  createOpenLoopRequestSchema,
  createRunRequestSchema,
  type Decision,
  type Handoff,
  type JournalSearchResults,
  journalSearchQuerySchema,
  listArtifactsQuerySchema,
  listDecisionsQuerySchema,
  listEventsQuerySchema,
  listHandoffsQuerySchema,
  listOpenLoopsQuerySchema,
  listRunsQuerySchema,
  type OpenLoop,
  type RunManifest,
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

  route.get("/", (c) => c.redirect("/today"));

  route.get("/today", (c) => {
    const today = new Date().toISOString().slice(0, 10);
    const recentRuns = ledger.listRuns({ limit: 100 });
    const completedToday = recentRuns.filter(
      (run) => run.status === "completed" && run.completedAt?.startsWith(today)
    );
    const failedToday = recentRuns.filter(
      (run) => run.status === "failed" && run.completedAt?.startsWith(today)
    );
    const inProgress = recentRuns.filter((run) => run.status === "running");
    const openLoops = ledger.listOpenLoops({ status: "open", limit: 100 });

    return c.html(
      page("Today", [
        runList(inProgress, "In progress"),
        runList(completedToday, "Completed today"),
        runList(failedToday, "Failed today"),
        openLoopList(
          openLoops.filter((loop) => loop.type === "needs_review"),
          "Needs review"
        ),
        openLoopList(
          openLoops.filter((loop) => loop.type === "decision_required"),
          "Decision required"
        ),
        openLoopList(
          openLoops.filter((loop) => loop.type === "blocked"),
          "Blocked"
        )
      ])
    );
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

    const runs = ledger.listRuns(parsed.data);

    if (wantsHtml(c.req.raw)) {
      return c.html(page("Runs", [runList(runs)]));
    }

    return c.json({ runs });
  });

  route.get("/runs/:id/manifest", (c) => {
    const manifest = ledger.getRunManifest(c.req.param("id"));

    if (!manifest) {
      return c.json({ error: "Run not found" }, 404);
    }

    return c.json({ manifest });
  });

  route.get("/runs/:id", (c) => {
    const run = ledger.getRun(c.req.param("id"));

    if (!run) {
      return c.json({ error: "Run not found" }, 404);
    }

    if (wantsHtml(c.req.raw)) {
      const manifest = ledger.getRunManifest(run.id);
      return c.html(page(run.task, [runDetail(run, ledger.listEventsForRun(run.id), manifest)]));
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

    notifyDiscord(options.config, ledger.getRun(event.runId), event);

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

    const openLoop = ledger.createOpenLoop(parsed.data);

    if (!openLoop) {
      return c.json({ error: "Source run not found" }, 404);
    }

    return c.json({ openLoop }, 201);
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
      return c.html(page("Open loops", groupedOpenLoopList(openLoops)));
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

  route.post("/open-loops/:id/resolve", async (c) => {
    const body = await c.req.parseBody();
    const resolution = body.resolution;
    const openLoop = ledger.updateOpenLoop(c.req.param("id"), {
      status: "resolved",
      resolution: typeof resolution === "string" && resolution.trim() ? resolution : "Resolved"
    });

    if (!openLoop) {
      return c.json({ error: "Open loop not found" }, 404);
    }

    return c.redirect("/open-loops");
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

  route.get("/search", (c) => {
    const parsed = journalSearchQuerySchema.safeParse(
      Object.fromEntries(new URL(c.req.url).searchParams)
    );

    if (!parsed.success) {
      return c.json(formatValidationError(parsed.error), 400);
    }

    const results = ledger.searchJournal(parsed.data);

    if (wantsHtml(c.req.raw)) {
      return c.html(page("Search", [searchForm(parsed.data), searchResults(results)]));
    }

    return c.json({ results });
  });

  route.post("/handoffs", async (c) => {
    const body = await readJson(c.req.raw);
    const parsed = createHandoffRequestSchema.safeParse(body);

    if (!parsed.success) {
      return c.json(formatValidationError(parsed.error), 400);
    }

    const handoff = ledger.createHandoff(parsed.data);

    if (!handoff) {
      return c.json({ error: "Source run not found" }, 404);
    }

    return c.json({ handoff }, 201);
  });

  route.get("/handoffs", (c) => {
    const parsed = listHandoffsQuerySchema.safeParse(
      Object.fromEntries(new URL(c.req.url).searchParams)
    );

    if (!parsed.success) {
      return c.json(formatValidationError(parsed.error), 400);
    }

    return c.json({ handoffs: ledger.listHandoffs(parsed.data) });
  });

  route.get("/handoffs/:id", (c) => {
    const handoff = ledger.getHandoff(c.req.param("id"));

    if (!handoff) {
      return c.json({ error: "Handoff not found" }, 404);
    }

    return c.json({ handoff });
  });

  route.post("/artifacts", async (c) => {
    const body = await readJson(c.req.raw);
    const parsed = createArtifactRequestSchema.safeParse(body);

    if (!parsed.success) {
      return c.json(formatValidationError(parsed.error), 400);
    }

    const artifact = ledger.createArtifact(parsed.data);

    if (!artifact) {
      return c.json({ error: "Run not found" }, 404);
    }

    return c.json({ artifact }, 201);
  });

  route.get("/artifacts", (c) => {
    const parsed = listArtifactsQuerySchema.safeParse(
      Object.fromEntries(new URL(c.req.url).searchParams)
    );

    if (!parsed.success) {
      return c.json(formatValidationError(parsed.error), 400);
    }

    return c.json({ artifacts: ledger.listArtifacts(parsed.data) });
  });

  route.get("/projects/:project", (c) => {
    const project = c.req.param("project");
    const runs = ledger.listRuns({ project, limit: 25 });
    const openLoops = ledger.listOpenLoops({ project, status: "open", limit: 25 });
    const decisions = ledger.listDecisions({ project, includeGlobal: true, limit: 25 });
    const context = ledger.getAgentContext({ project, limit: 25, min_importance: 4 });

    return c.html(
      page(`Project: ${project}`, [
        runList(runs, "Recent runs"),
        openLoopList(openLoops, "Unresolved open loops"),
        handoffList(context.recent_handoffs, "Recent handoffs"),
        runList(context.failed_runs, "Recent failures"),
        summaryList(runs),
        decisionList(decisions)
      ])
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
      ${link("/today", "Today")}
      ${link("/runs", "Runs")}
      ${link("/search", "Search")}
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

function runList(runs: AgentRun[], title = "Runs"): string {
  if (runs.length === 0) {
    return section(title, ['<p class="empty">No runs found.</p>']);
  }

  return `<section>
    <h2>${escapeHtml(title)}</h2>
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

function runDetail(run: AgentRun, events: AgentEvent[], manifest?: RunManifest): string {
  const failure = findFailure(events);
  const nextActions = manifest?.open_loops.map((loop) => loop.nextAction ?? loop.title) ?? [];

  return `<section>
    <h2>${escapeHtml(run.status)}</h2>
    <p>${escapeHtml(run.summary ?? run.task)}</p>
    <p class="meta">${escapeHtml(run.source)} / ${escapeHtml(run.project)} / ${escapeHtml(
      run.startedAt
    )}</p>
    ${
      failure
        ? `<p><strong>Failure:</strong> ${escapeHtml(failure.message)}${failure.exitCode === undefined ? "" : ` (exit ${failure.exitCode})`}</p>`
        : ""
    }
  </section>
  ${stringList("Changed files", manifest?.changed_files ?? [])}
  ${stringList("Next actions", nextActions)}
  ${artifactList(manifest?.artifacts ?? [])}
  ${openLoopList(manifest?.open_loops ?? [], "Open loops from this run")}
  ${handoffList(manifest?.handoffs ?? [], "Handoffs from this run")}
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

function openLoopList(openLoops: OpenLoop[], title = "Open loops"): string {
  if (openLoops.length === 0) {
    return section(title, ['<p class="empty">No open loops found.</p>']);
  }

  return `<section>
    <h2>${escapeHtml(title)}</h2>
    <table>
      <thead><tr><th>Title</th><th>Type</th><th>Next action</th><th>Project</th><th>Updated</th><th>Resolve</th></tr></thead>
      <tbody>${openLoops
        .map(
          (loop) => `<tr>
            <td>${escapeHtml(loop.title)}</td>
            <td>${escapeHtml(loop.type)}</td>
            <td>${escapeHtml(loop.nextAction ?? "")}</td>
            <td>${link(`/projects/${encodeURIComponent(loop.project)}`, loop.project)}</td>
            <td class="meta">${escapeHtml(loop.updatedAt)}</td>
            <td>
              <form method="post" action="/open-loops/${escapeHtml(loop.id)}/resolve">
                <input type="hidden" name="resolution" value="Resolved from UI">
                <button type="submit">Resolve</button>
              </form>
            </td>
          </tr>`
        )
        .join("")}</tbody>
    </table>
  </section>`;
}

function groupedOpenLoopList(openLoops: OpenLoop[]): string[] {
  return [
    openLoopList(
      openLoops.filter((loop) => loop.type === "needs_review"),
      "Needs review"
    ),
    openLoopList(
      openLoops.filter((loop) => loop.type === "decision_required"),
      "Decision required"
    ),
    openLoopList(
      openLoops.filter((loop) => loop.type === "blocked"),
      "Blocked"
    ),
    openLoopList(
      openLoops.filter((loop) => loop.type === "failed_unresolved"),
      "Failed / unresolved"
    ),
    openLoopList(
      openLoops.filter((loop) => loop.type === "ready_to_deploy"),
      "Ready to deploy"
    )
  ];
}

function handoffList(handoffs: Handoff[], title: string): string {
  if (handoffs.length === 0) {
    return section(title, ['<p class="empty">No handoffs found.</p>']);
  }

  return `<section>
    <h2>${escapeHtml(title)}</h2>
    <table>
      <thead><tr><th>Summary</th><th>From</th><th>To</th><th>Next action</th><th>Created</th></tr></thead>
      <tbody>${handoffs
        .map(
          (handoff) => `<tr>
            <td>${escapeHtml(handoff.summary)}</td>
            <td>${escapeHtml(handoff.fromSource)}</td>
            <td>${escapeHtml(handoff.toSource ?? "")}</td>
            <td>${escapeHtml(handoff.nextAction ?? "")}</td>
            <td class="meta">${escapeHtml(handoff.createdAt)}</td>
          </tr>`
        )
        .join("")}</tbody>
    </table>
  </section>`;
}

function artifactList(artifacts: Artifact[]): string {
  if (artifacts.length === 0) {
    return section("Artifacts", ['<p class="empty">No artifacts found.</p>']);
  }

  return `<section>
    <h2>Artifacts</h2>
    <table>
      <thead><tr><th>Kind</th><th>Path</th><th>Size</th><th>SHA-256</th></tr></thead>
      <tbody>${artifacts
        .map(
          (artifact) => `<tr>
            <td>${escapeHtml(artifact.kind)}</td>
            <td>${escapeHtml(artifact.path)}</td>
            <td>${artifact.sizeBytes ?? ""}</td>
            <td class="meta">${escapeHtml(artifact.sha256 ?? "")}</td>
          </tr>`
        )
        .join("")}</tbody>
    </table>
  </section>`;
}

function summaryList(runs: AgentRun[]): string {
  const summaries = runs.filter((run) => run.summary);

  if (summaries.length === 0) {
    return section("Latest summaries", ['<p class="empty">No summaries found.</p>']);
  }

  return section(
    "Latest summaries",
    summaries.map((run) => `<p>${escapeHtml(run.summary ?? "")}</p>`)
  );
}

function stringList(title: string, values: string[]): string {
  if (values.length === 0) {
    return section(title, [`<p class="empty">No ${escapeHtml(title.toLowerCase())} found.</p>`]);
  }

  return section(
    title,
    values.map((value) => `<p>${escapeHtml(value)}</p>`)
  );
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

function searchForm(query: {
  project?: string;
  source?: string;
  status?: string;
  text?: string;
  date_from?: string;
  date_to?: string;
}): string {
  return `<section>
    <h2>Search</h2>
    <form method="get" action="/search">
      <p><label>Text <input name="text" value="${escapeHtml(query.text ?? "")}"></label></p>
      <p><label>Project <input name="project" value="${escapeHtml(query.project ?? "")}"></label></p>
      <p><label>Source <input name="source" value="${escapeHtml(query.source ?? "")}"></label></p>
      <p><label>Status <input name="status" value="${escapeHtml(query.status ?? "")}"></label></p>
      <p><label>Date from <input name="date_from" value="${escapeHtml(query.date_from ?? "")}"></label></p>
      <p><label>Date to <input name="date_to" value="${escapeHtml(query.date_to ?? "")}"></label></p>
      <button type="submit">Search</button>
    </form>
  </section>`;
}

function searchResults(results: JournalSearchResults): string {
  return [
    runList(results.runs, "Run results"),
    eventList(results.events, "Event results"),
    openLoopList(results.open_loops, "Open loop results"),
    handoffList(results.handoffs, "Handoff results"),
    decisionList(results.decisions)
  ].join("");
}

function eventList(events: Array<Omit<AgentEvent, "data">>, title: string): string {
  if (events.length === 0) {
    return section(title, ['<p class="empty">No events found.</p>']);
  }

  return `<section>
    <h2>${escapeHtml(title)}</h2>
    <table>
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

function notifyDiscord(config: RuntrailConfig, run: AgentRun | undefined, event: AgentEvent): void {
  const webhookUrl = config.notifications.discord.webhookUrl;

  if (!config.notifications.discord.enabled || !webhookUrl || !isNotifiable(event.type) || !run) {
    return;
  }

  const changedFiles = readChangedFiles(event.data);
  const fields = [
    `project: ${run.project}`,
    `source: ${run.source}`,
    `status: ${event.type}`,
    `run: ${run.id}`
  ];

  if (run.summary) {
    fields.push(`summary: ${run.summary}`);
  }

  if (changedFiles.length > 0) {
    fields.push(`changed files: ${changedFiles.join(", ")}`);
  }

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 2000);
  timeout.unref?.();

  void fetch(webhookUrl, {
    method: "POST",
    headers: {
      "content-type": "application/json"
    },
    signal: controller.signal,
    body: JSON.stringify({
      content: `Runtrail ${event.type}: ${run.task}\n${fields.join("\n")}`
    })
  })
    .catch(() => {
      // Notification delivery must never block journal writes.
    })
    .finally(() => clearTimeout(timeout));
}

function isNotifiable(type: AgentEvent["type"]): boolean {
  return ["failed", "completed", "blocked", "needs_review", "decision_required"].includes(type);
}

function findFailure(events: AgentEvent[]): { message: string; exitCode?: number } | undefined {
  let event: AgentEvent | undefined;

  for (let index = events.length - 1; index >= 0; index -= 1) {
    if (events[index]?.type === "failed") {
      event = events[index];
      break;
    }
  }

  if (!event) {
    return undefined;
  }

  return {
    message: event.message,
    exitCode: readExitCode(event.data)
  };
}

function readExitCode(data: unknown): number | undefined {
  if (!data || typeof data !== "object" || !("exitCode" in data)) {
    return undefined;
  }

  const exitCode = (data as { exitCode: unknown }).exitCode;
  return typeof exitCode === "number" ? exitCode : undefined;
}

function readChangedFiles(data: unknown): string[] {
  if (!data || typeof data !== "object" || !("changedFiles" in data)) {
    return [];
  }

  const changedFiles = (data as { changedFiles: unknown }).changedFiles;

  if (!Array.isArray(changedFiles)) {
    return [];
  }

  return changedFiles.filter((file): file is string => typeof file === "string");
}
