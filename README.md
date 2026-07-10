# Runtrail

Runtrail is a self-hosted, LAN/VPN-accessible activity ledger for coding agents and scripts. It stores structured activity in SQLite and exposes it through an HTTP API and CLI.

The MVP is agent-first: structured runs, events, open loops, decisions, and compact context retrieval. Human-readable UI and deployment automation come later.

## Set Up with a Coding Agent

Give the following prompt to a coding agent that has shell access to the intended host. It keeps
the installation within Runtrail's existing [systemd/LXC](docs/systemd-lxc.md) and
[MCP client](docs/mcp-client-setup-runbook.md) runbooks while delegating the hands-on work.

```text
Set up Runtrail end to end from https://github.com/redxzeta/runtrail and connect it to my coding
agent through MCP.

Before changing anything:

1. Inspect the target host, any existing Runtrail checkout or service, the OS and architecture,
   installed Node/pnpm and container tooling, network reachability, and the MCP client I am using.
2. Read README.md, AGENTS.md, docs/systemd-lxc.md, docs/mcp-client-setup-runbook.md,
   config/runtrail.example.yaml, compose.yaml, and systemd/runtrail.service from the checkout.
3. Present the detected setup and ask me only for choices that cannot be discovered safely. Get my
   confirmation before using sudo, changing a service or firewall, binding beyond localhost, or
   exposing Runtrail outside the host. Runtrail must remain limited to a trusted LAN or VPN.

Install and configure it:

- Use the documented non-root systemd path for an Ubuntu/Debian Proxmox LXC, or the existing
  Docker/Podman Compose path when containers are the selected deployment method. Do not invent a
  new deployment path or add an installer.
- Use pnpm where repository commands are required. Keep non-secret defaults in the example YAML
  configuration and host-specific values in environment variables.
- Generate a strong random RUNTRAIL_TOKEN if one was not supplied through an existing secret
  store. Save it only in an ignored environment file or secret store with restrictive permissions.
  Never commit, log, or repeat the token in chat or in the final report.
- Start Runtrail and confirm its health endpoint succeeds from every host that needs to reach it.
- Configure my selected MCP client using the hosted Streamable HTTP endpoint when the client
  supports it, or the documented local stdio bridge for Codex or OpenClaw. MCP startup must use
  local environment/config only; it must not SSH, sudo, or scrape the server's environment file.

Verify the finished setup:

1. Confirm GET /health returns a successful response.
2. Confirm the MCP client can discover the Runtrail tools.
3. Make one authenticated read call, such as journal_search_runs with a limit of 1, and confirm it
   succeeds. Do not create sample ledger records merely to prove connectivity.
4. If a required check cannot be completed with the documented surfaces or available access, stop
   and report the exact blocker instead of weakening authentication or network protections.

Finish with a secret-free handoff that lists the deployment method, installed paths, service
management commands, Runtrail and MCP URLs, MCP client configuration location, checks performed
and their outcomes, and any remaining manual action. Do not include token values or raw
configuration that contains secrets.
```

## Local Development

Install dependencies:

```sh
pnpm install
```

Start the service:

```sh
pnpm dev
```

Check health:

```sh
curl http://127.0.0.1:8787/health
pnpm cli health
```

Fetch compact agent context:

```sh
pnpm cli context --project runtrail --limit 5 --min-importance 4
```

## Contributing

Read [CONTRIBUTING.md](CONTRIBUTING.md) before starting work. It documents the
clean-clone setup, architecture map, issue-claiming workflow, validation
commands, scope boundaries, secret-handling rules, and handoff format for
humans and coding agents.

Good starting points:

- [good first issue](https://github.com/redxzeta/runtrail/issues?q=is%3Aissue%20is%3Aopen%20label%3A%22good%20first%20issue%22)
- [help wanted](https://github.com/redxzeta/runtrail/issues?q=is%3Aissue%20is%3Aopen%20label%3A%22help%20wanted%22)

Create a run:

```sh
curl -X POST http://127.0.0.1:8787/runs \
  -H "authorization: Bearer $RUNTRAIL_TOKEN" \
  -H "content-type: application/json" \
  -d '{"source":"codex","project":"runtrail","clientRunId":"local-session-id","task":"implement runs API","category":"implementation","tags":["codex","issue-123"]}'
```

`clientRunId` is optional. When supplied, repeated creates with the same source, project, and
client identifier return the original run (`200`) instead of creating a duplicate; new runs return
`201`. Replays never overwrite the original run.

Attach an event:

```sh
curl -X POST http://127.0.0.1:8787/events \
  -H "authorization: Bearer $RUNTRAIL_TOKEN" \
  -H "content-type: application/json" \
  -d '{"runId":"run_abc123","type":"progress","message":"added tests","importance":4,"category":"implementation","tags":["tests"]}'
```

Fetch recent runs:

```sh
curl -H "authorization: Bearer $RUNTRAIL_TOKEN" \
  "http://127.0.0.1:8787/runs?project=runtrail&category=implementation&tag=codex"
```

Create an open loop:

```sh
curl -X POST http://127.0.0.1:8787/open-loops \
  -H "authorization: Bearer $RUNTRAIL_TOKEN" \
  -H "content-type: application/json" \
  -d '{"type":"blocked","project":"runtrail","title":"choose retention policy"}'
```

Resolve an open loop:

```sh
curl -X PATCH http://127.0.0.1:8787/open-loops/loop_abc123 \
  -H "authorization: Bearer $RUNTRAIL_TOKEN" \
  -H "content-type: application/json" \
  -d '{"status":"resolved","resolution":"keep structured data in SQLite"}'
```

Record a decision:

```sh
curl -X POST http://127.0.0.1:8787/decisions \
  -H "authorization: Bearer $RUNTRAIL_TOKEN" \
  -H "content-type: application/json" \
  -d '{"project":"runtrail","title":"SQLite remains source of truth","decision":"Markdown is export-only"}'
```

CLI equivalents:

```sh
pnpm cli run create --source codex --project runtrail --client-run-id local-session-id --task "implement CLI core" --category implementation --tag codex --tag issue-123
pnpm cli runs close-stale --older-than 24h
# After reviewing the dry-run candidates:
pnpm cli runs close-stale --older-than 24h --apply
pnpm cli event create --run-id run_abc123 --type progress --message "added command tests" --importance 5 --category implementation --tag tests
pnpm cli loop add --type blocked --project runtrail --title "choose retention policy"
pnpm cli loop resolve loop_abc123 --resolution "keep structured data in SQLite"
pnpm cli decision add --project runtrail --title "SQLite remains source of truth" --decision "Markdown is export-only"
pnpm cli handoff create --source-run-id run_abc123 --from-source codex --to-source openclaw --project runtrail --summary "metadata is ready" --next-action "continue with MCP tools" --category implementation --tag codex --tag issue-123
```

Wrap a command and journal its result:

```sh
pnpm cli run --source codex --project runtrail --task "fix retry logic" -- pnpm test
pnpm cli run --source codex --project runtrail --task "fix retry logic" --category implementation --tag codex --tag issue-123 -- pnpm test
```

## MCP Adapter

Runtrail can expose the HTTP API to MCP-compatible agents through MCP. Remote-capable
agents should use the hosted Streamable HTTP endpoint:

Remote endpoint: `http://127.0.0.1:8787/mcp`

Example remote MCP configuration for OpenCode:

```json
{
  "mcp": {
    "runtrail": {
      "type": "remote",
      "url": "http://127.0.0.1:8787/mcp",
      "headers": {
        "Authorization": "Bearer ${RUNTRAIL_TOKEN}"
      },
      "enabled": true
    }
  }
}
```

Claude Code can use the same `/mcp` URL with HTTP transport:

```sh
claude mcp add --transport http runtrail http://127.0.0.1:8787/mcp
```

Stdio-only agents such as Codex or OpenClaw should use the bridge. The bridge
starts locally and forwards tool calls to the hosted `/mcp` endpoint:

```sh
RUNTRAIL_MCP_URL=http://127.0.0.1:8787/mcp RUNTRAIL_TOKEN=change-me-to-a-long-random-secret pnpm mcp:bridge
```

Example stdio MCP server configuration:

```json
{
  "mcpServers": {
    "runtrail": {
      "command": "runtrail-mcp-bridge",
      "env": {
        "RUNTRAIL_MCP_URL": "http://127.0.0.1:8787/mcp",
        "RUNTRAIL_TOKEN": "change-me-to-a-long-random-secret"
      }
    }
  }
}
```

For local development, Runtrail can still expose the HTTP API to MCP-compatible
agents through a direct stdio process:

```sh
RUNTRAIL_URL=http://127.0.0.1:8787 RUNTRAIL_TOKEN=change-me-to-a-long-random-secret pnpm mcp
```

Example MCP server configuration:

```json
{
  "mcpServers": {
    "runtrail": {
      "command": "runtrail-mcp",
      "env": {
        "RUNTRAIL_URL": "http://127.0.0.1:8787",
        "RUNTRAIL_TOKEN": "change-me-to-a-long-random-secret"
      }
    }
  }
}
```

The MCP adapter is a thin HTTP client. It does not access SQLite directly.
MCP startup paths must read local environment/config only. Do not SSH, sudo, or
scrape `/etc/runtrail/runtrail.env` from an MCP startup command.

Agent continuity tools include `journal_get_context`, `journal_search`,
`journal_search_runs`, `journal_get_run_manifest`, `journal_create_handoff`,
`journal_create_event`, `journal_create_open_loop`,
`journal_resolve_open_loop`, and `journal_record_decision`.
See [docs/mcp-safe-surface.md](docs/mcp-safe-surface.md) for the proposed safe read/write tool surface and default response limits.
See [docs/agent-write-contract.md](docs/agent-write-contract.md) for the recommended cross-agent write contract.
See [docs/mcp-client-setup-runbook.md](docs/mcp-client-setup-runbook.md) for repeatable Codex, OpenClaw, Claude Code, and opencode setup and verification.

## Markdown Exports

Markdown exports are generated from the API and are not a source of truth:

```sh
pnpm cli export daily --project runtrail --date 2026-06-27 --output runtrail-daily.md
pnpm cli export project --project runtrail --output runtrail-project.md
pnpm cli export decisions --project runtrail --output runtrail-decisions.md
pnpm cli export open-loops --project runtrail --output runtrail-open-loops.md
```

Validate:

```sh
pnpm lint
pnpm typecheck
pnpm test
```

## Configuration

Runtrail uses YAML for non-secret config and environment variables for secrets.

Default config path:

```sh
config/runtrail.example.yaml
```

Override config path:

```sh
RUNTRAIL_CONFIG=/etc/runtrail/config.yaml
```

Supported environment overrides:

```sh
RUNTRAIL_HOST=0.0.0.0
RUNTRAIL_PORT=8787
RUNTRAIL_DB_PATH=./data/runtrail.sqlite
RUNTRAIL_LOG_DIR=./data/logs
RUNTRAIL_TOKEN=change-me-to-a-long-random-secret
RUNTRAIL_URL=http://127.0.0.1:8787
DISCORD_WEBHOOK_URL=
```

Do not commit real tokens or webhook URLs.

## LAN/VPN Assumption

Runtrail is intended for trusted LAN/VPN access. The example config binds to `0.0.0.0` so other machines on the trusted network can reach it during development.

## Systemd Deployment

For a non-root Ubuntu/Debian Proxmox LXC install, see [docs/systemd-lxc.md](docs/systemd-lxc.md).

## Optional Container Deployment

The primary self-hosted path can still be a normal LXC/systemd service. Containers are optional for users who prefer Docker Compose or Podman Compose.

Create a local env file from the non-secret template:

```sh
cp .env.example .env
```

Set `RUNTRAIL_TOKEN` in `.env` to a long random secret. Do not commit `.env`.

Build and run with Docker Compose:

```sh
docker compose up --build
```

Podman users can adapt the same file:

```sh
podman compose up --build
```

The Compose example mounts the named volume `runtrail-data` at `/app/data`. SQLite is stored at `/app/data/runtrail.sqlite`, and verbose log files are written under `/app/data/logs`, so both survive container restarts.

Container config still uses `config/runtrail.example.yaml` only for non-secret defaults. Secrets must come from environment variables or an ignored local env file.
