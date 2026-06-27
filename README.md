# Runtrail

Runtrail is a self-hosted, LAN/VPN-accessible activity ledger for coding agents and scripts. It stores structured activity in SQLite and exposes it through an HTTP API and CLI.

The MVP is agent-first: structured runs, events, open loops, decisions, and compact context retrieval. Human-readable UI and deployment automation come later.

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

Create a run:

```sh
curl -X POST http://127.0.0.1:8787/runs \
  -H "authorization: Bearer $RUNTRAIL_TOKEN" \
  -H "content-type: application/json" \
  -d '{"source":"codex","project":"runtrail","task":"implement runs API"}'
```

Attach an event:

```sh
curl -X POST http://127.0.0.1:8787/events \
  -H "authorization: Bearer $RUNTRAIL_TOKEN" \
  -H "content-type: application/json" \
  -d '{"runId":"run_abc123","type":"progress","message":"added tests","importance":4}'
```

Fetch recent runs:

```sh
curl -H "authorization: Bearer $RUNTRAIL_TOKEN" \
  "http://127.0.0.1:8787/runs?project=runtrail"
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
pnpm cli run create --source codex --project runtrail --task "implement CLI core"
pnpm cli event create --run-id run_abc123 --type progress --message "added command tests" --importance 5
pnpm cli loop add --type blocked --project runtrail --title "choose retention policy"
pnpm cli loop resolve loop_abc123 --resolution "keep structured data in SQLite"
pnpm cli decision add --project runtrail --title "SQLite remains source of truth" --decision "Markdown is export-only"
```

Wrap a command and journal its result:

```sh
pnpm cli run --source codex --project runtrail --task "fix retry logic" -- pnpm test
```

## MCP Adapter

Runtrail can expose the HTTP API to MCP-compatible agents through a separate stdio process:

```sh
RUNTRAIL_URL=http://127.0.0.1:8787 RUNTRAIL_TOKEN=change-me-to-a-long-random-secret pnpm mcp
```

Example MCP server configuration:

```json
{
  "mcpServers": {
    "runtrail": {
      "command": "pnpm",
      "args": ["mcp"],
      "env": {
        "RUNTRAIL_URL": "http://127.0.0.1:8787",
        "RUNTRAIL_TOKEN": "change-me-to-a-long-random-secret"
      }
    }
  }
}
```

The MCP adapter is a thin HTTP client. It does not access SQLite directly.

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
