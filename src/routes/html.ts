import type {
  AgentEvent,
  AgentRun,
  Artifact,
  Decision,
  Handoff,
  HandoffSummary,
  JournalSearchQuery,
  JournalSearchResults,
  OpenLoop,
  RunManifest
} from "../shared/schemas.js";

export function page(title: string, sections: string[]): string {
  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>${escapeHtml(title)} - Runtrail</title>
  <style>
    :root { color-scheme: light; --ink: #18212f; --muted: #667085; --line: #d8dee8; --brand: #175cd3; --panel: #fff; }
    * { box-sizing: border-box; }
    body { color: var(--ink); font: 15px/1.5 system-ui, sans-serif; margin: 0; background: #f4f6f8; }
    header, main { margin: 0 auto; max-width: 1120px; padding: 24px; }
    header { background: var(--panel); border-bottom: 1px solid var(--line); max-width: none; }
    header > * { margin-left: auto; margin-right: auto; max-width: 1072px; }
    nav { display: flex; flex-wrap: wrap; gap: 8px 18px; }
    nav a, main a { color: var(--brand); }
    h1 { font-size: 28px; margin: 0 0 12px; }
    h2 { font-size: 18px; margin: 24px 0 8px; }
    section { background: var(--panel); border: 1px solid var(--line); border-radius: 12px; margin: 18px 0; overflow-x: auto; padding: 0 18px 14px; }
    table { border-collapse: collapse; min-width: 680px; width: 100%; }
    th, td { border-bottom: 1px solid var(--line); padding: 10px 8px; text-align: left; vertical-align: top; }
    th { color: var(--muted); font-size: 12px; text-transform: uppercase; }
    button { background: var(--brand); border: 0; border-radius: 6px; color: white; cursor: pointer; padding: 8px 12px; }
    input { border: 1px solid #98a2b3; border-radius: 6px; font: inherit; max-width: 100%; padding: 8px; }
    .meta, .empty { color: var(--muted); }
    .meta { font-size: 13px; }
    .badge { background: #eef4ff; border-radius: 999px; color: #1849a9; display: inline-block; font-size: 12px; font-weight: 650; padding: 2px 8px; }
    .cards { display: grid; gap: 12px; grid-template-columns: repeat(4, minmax(0, 1fr)); }
    .card { background: var(--panel); border: 1px solid var(--line); border-radius: 12px; padding: 16px; }
    .card strong { display: block; font-size: 26px; }
    .card span { color: var(--muted); }
    .login { margin: 10vh auto; max-width: 420px; }
    .login label, .login input { display: block; width: 100%; }
    .login button { margin-top: 14px; width: 100%; }
    @media (max-width: 700px) {
      header, main { padding: 16px; }
      h1 { font-size: 24px; }
      .cards { grid-template-columns: repeat(2, minmax(0, 1fr)); }
      table { min-width: 600px; }
    }
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

export function dashboardSummary(items: Array<{ label: string; value: number }>): string {
  return `<div class="cards">${items
    .map(
      (item) =>
        `<div class="card"><strong>${item.value}</strong><span>${escapeHtml(item.label)}</span></div>`
    )
    .join("")}</div>`;
}

export function loginPage(error?: string): string {
  return page("Sign in", [
    `<section class="login"><p>Use the configured Runtrail token to open the dashboard.</p>${
      error ? `<p role="alert">${escapeHtml(error)}</p>` : ""
    }<form method="post" action="/login"><label>Runtrail token<input type="password" name="token" required autocomplete="current-password"></label><button type="submit">Sign in</button></form></section>`
  ]);
}

export function runList(runs: AgentRun[], title = "Runs"): string {
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
            <td><span class="badge">${escapeHtml(run.status)}</span></td>
            <td>${escapeHtml(run.summary ?? "")}</td>
            <td>${link(`/projects/${encodeURIComponent(run.project)}`, run.project)}</td>
            <td class="meta">${escapeHtml(run.updatedAt)}</td>
          </tr>`
        )
        .join("")}</tbody>
    </table>
  </section>`;
}

export function runDetail(run: AgentRun, events: AgentEvent[], manifest?: RunManifest): string {
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

export function openLoopList(openLoops: OpenLoop[], title = "Open loops"): string {
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
            <td><span class="badge">${escapeHtml(loop.type)}</span></td>
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

export function groupedOpenLoopList(openLoops: OpenLoop[]): string[] {
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
    ),
    openLoopList(
      openLoops.filter((loop) => loop.type === "follow_up"),
      "Follow up"
    ),
    openLoopList(
      openLoops.filter((loop) => loop.type === "risk"),
      "Risk"
    )
  ];
}

export function handoffList(handoffs: Array<Handoff | HandoffSummary>, title: string): string {
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

export function summaryList(runs: AgentRun[]): string {
  const summaries = runs.filter((run) => run.summary);

  if (summaries.length === 0) {
    return section("Latest summaries", ['<p class="empty">No summaries found.</p>']);
  }

  return section(
    "Latest summaries",
    summaries.map((run) => `<p>${escapeHtml(run.summary ?? "")}</p>`)
  );
}

export function decisionList(decisions: Decision[]): string {
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

export function searchForm(
  query: Pick<
    JournalSearchQuery,
    "project" | "source" | "status" | "text" | "date_from" | "date_to"
  >
): string {
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

export function searchResults(results: JournalSearchResults): string {
  return [
    runList(results.runs, "Run results"),
    eventList(results.events, "Event results"),
    openLoopList(results.open_loops, "Open loop results"),
    handoffList(results.handoffs, "Handoff results"),
    decisionList(results.decisions)
  ].join("");
}

function section(title: string, items: string[]): string {
  return `<section><h2>${escapeHtml(title)}</h2>${items.join(" ")}</section>`;
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

function stringList(title: string, values: string[]): string {
  if (values.length === 0) {
    return section(title, [`<p class="empty">No ${escapeHtml(title.toLowerCase())} found.</p>`]);
  }

  return section(
    title,
    values.map((value) => `<p>${escapeHtml(value)}</p>`)
  );
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
