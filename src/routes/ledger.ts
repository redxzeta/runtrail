import { createHmac, timingSafeEqual } from "node:crypto";
import type Database from "better-sqlite3";
import { type Context, Hono } from "hono";
import type { RuntrailConfig } from "../config.js";
import { LedgerRepository } from "../db/ledger.js";
import {
  type AgentEvent,
  type AgentRun,
  agentContextQuerySchema,
  closeStaleRunsRequestSchema,
  createArtifactRequestSchema,
  createDecisionRequestSchema,
  createEventRequestSchema,
  createHandoffRequestSchema,
  createOpenLoopRequestSchema,
  createRunRequestSchema,
  finishRunRequestSchema,
  journalSearchQuerySchema,
  listArtifactsQuerySchema,
  listDecisionsQuerySchema,
  listEventsQuerySchema,
  listHandoffsQuerySchema,
  listOpenLoopsQuerySchema,
  listRunsQuerySchema,
  pauseRunRequestSchema,
  updateOpenLoopRequestSchema,
  updateRunRequestSchema
} from "../shared/schemas.js";
import {
  dashboardSummary,
  decisionList,
  groupedOpenLoopList,
  handoffList,
  loginPage,
  openLoopList,
  page,
  runDetail,
  runList,
  searchForm,
  searchResults,
  summaryList
} from "./html.js";

type LedgerRouteOptions = {
  db: Database.Database;
  config: RuntrailConfig;
};

export function createLedgerRoute(options: LedgerRouteOptions): Hono {
  const route = new Hono();
  const ledger = new LedgerRepository(options.db);

  route.get("/login", (c) => c.html(loginPage()));
  route.post("/login", async (c) => {
    const body = await c.req.parseBody();
    const token = body.token;
    const expectedToken = options.config.security.token;

    if (typeof token !== "string" || !expectedToken || !safeEqual(token, expectedToken)) {
      return c.html(loginPage("Invalid token."), 401);
    }

    c.header("Set-Cookie", browserCookie(expectedToken, c.req.header("x-forwarded-proto")));
    return c.redirect("/today");
  });

  route.use("*", async (c, next) => {
    if (!options.config.security.authRequired) {
      await next();
      return;
    }

    const expectedToken = options.config.security.token;
    const authorization = c.req.header("authorization");
    const browserAuthenticated = readCookie(c.req.header("cookie"), "runtrail_session")
      ? safeEqual(
          readCookie(c.req.header("cookie"), "runtrail_session") ?? "",
          sessionValue(expectedToken ?? "")
        )
      : false;

    if (!expectedToken || (authorization !== `Bearer ${expectedToken}` && !browserAuthenticated)) {
      if (wantsHtml(c.req.raw)) return c.redirect("/login");
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
        dashboardSummary([
          { label: "In progress", value: inProgress.length },
          { label: "Completed today", value: completedToday.length },
          { label: "Failed today", value: failedToday.length },
          { label: "Open loops", value: openLoops.length }
        ]),
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

    const result = ledger.createRun(parsed.data);
    return c.json({ run: result.run, recovery: result.recovery }, result.created ? 201 : 200);
  });

  route.post("/runs/close-stale", async (c) => {
    const body = await readJson(c.req.raw);
    const parsed = closeStaleRunsRequestSchema.safeParse(body);

    if (!parsed.success) {
      return c.json(formatValidationError(parsed.error), 400);
    }

    const result = ledger.closeStaleRuns(parsed.data);
    return c.json({
      dryRun: !parsed.data.apply,
      updatedBefore: parsed.data.updatedBefore,
      candidateCount: result.candidates.length,
      closedCount: result.closed.length,
      ...result
    });
  });

  route.post("/runs/:id/heartbeat", (c) =>
    lifecycleResponse(c, ledger.heartbeatRun(c.req.param("id")))
  );
  route.post("/runs/:id/resume", (c) => lifecycleResponse(c, ledger.resumeRun(c.req.param("id"))));
  route.post("/runs/:id/pause", async (c) => {
    const parsed = pauseRunRequestSchema.safeParse(await readJson(c.req.raw));
    if (!parsed.success) return c.json(formatValidationError(parsed.error), 400);
    return lifecycleResponse(c, ledger.pauseRun(c.req.param("id"), parsed.data));
  });
  route.post("/runs/:id/finish", async (c) => {
    const parsed = finishRunRequestSchema.safeParse(await readJson(c.req.raw));
    if (!parsed.success) return c.json(formatValidationError(parsed.error), 400);
    return lifecycleResponse(c, ledger.finishRun(c.req.param("id"), parsed.data));
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

    const { event, created } = ledger.createEventResult(parsed.data);

    if (!event) {
      return c.json({ error: "Run not found" }, 404);
    }

    if (created) {
      notifyDiscord(options.config, ledger.getRun(event.runId), event);
    }

    return c.json({ event }, created ? 201 : 200);
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

function sessionValue(token: string): string {
  return createHmac("sha256", token).update("runtrail-browser-session-v1").digest("base64url");
}

function browserCookie(token: string, forwardedProto?: string): string {
  const secure = forwardedProto === "https" ? "; Secure" : "";
  return `runtrail_session=${sessionValue(token)}; Path=/; HttpOnly; SameSite=Strict; Max-Age=43200${secure}`;
}

function readCookie(header: string | undefined, name: string): string | undefined {
  return header
    ?.split(";")
    .map((part) => part.trim().split("="))
    .find(([key]) => key === name)
    ?.slice(1)
    .join("=");
}

function safeEqual(actual: string, expected: string): boolean {
  const actualBuffer = Buffer.from(actual);
  const expectedBuffer = Buffer.from(expected);
  return (
    actualBuffer.length === expectedBuffer.length && timingSafeEqual(actualBuffer, expectedBuffer)
  );
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

function lifecycleResponse(c: Context, result: { run?: AgentRun; error?: string }): Response {
  if (result.run) return c.json({ run: result.run });
  return c.json(
    { error: result.error ?? "Invalid lifecycle transition" },
    result.error === "Run not found" ? 404 : 409
  );
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
