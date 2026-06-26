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
