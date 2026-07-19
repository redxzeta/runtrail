# MCP Client Setup Runbook

Use the hosted Runtrail `/mcp` endpoint for remote-capable clients. Use a local stdio bridge only for clients that cannot connect to Streamable HTTP directly.

Do not SSH into the Runtrail LXC during MCP startup. MCP startup must read only local config and environment files.

## Shared Environment

Keep secrets in an ignored local env file or secret store:

```sh
RUNTRAIL_MCP_URL=http://<runtrail-host>:8787/mcp
RUNTRAIL_URL=http://<runtrail-host>:8787
RUNTRAIL_TOKEN=<set-outside-source-control>
```

## Codex

Codex uses a stdio bridge. Build and link the bridge executable from a trusted Runtrail checkout:

```sh
pnpm install --frozen-lockfile
pnpm build
pnpm link --global
command -v runtrail-mcp-bridge
```

Put the token in a local env file, then point Codex at a local wrapper:

```toml
[mcp_servers.runtrail]
command = "/home/<user>/.local/bin/runtrail-mcp"
startup_timeout_sec = 10
```

The wrapper should source the local env file and execute the bridge:

```sh
#!/usr/bin/env sh
set -eu
env_file="${RUNTRAIL_MCP_ENV:-$HOME/.config/runtrail/mcp.env}"
if [ -f "$env_file" ]; then
  set -a
  . "$env_file"
  set +a
fi
exec runtrail-mcp-bridge
```

The MCP bridge provides explicit journal tools. For automatic structured lifecycle telemetry, use
the separate first-party adapter in `examples/codex/`. It reads the same local-only secret boundary,
never retrieves configuration through SSH or sudo, and remains fail-open when Runtrail is
unavailable.

## OpenClaw

OpenClaw also uses the stdio bridge:

```sh
openclaw mcp set runtrail '{"command":"/home/<user>/.local/bin/runtrail-mcp","args":[]}'
openclaw mcp tools runtrail --include "journal_start_run,journal_resume_run,journal_heartbeat_run,journal_pause_run,journal_finish_run,journal_get_context,journal_search,journal_search_runs,journal_get_run_manifest,journal_create_handoff,journal_create_event,journal_create_open_loop,journal_resolve_open_loop,journal_record_decision"
openclaw mcp reload
```

## opencode

opencode can use the hosted remote endpoint directly:

```json
{
  "mcp": {
    "runtrail": {
      "type": "remote",
      "url": "http://<runtrail-host>:8787/mcp",
      "headers": {
        "Authorization": "Bearer ${RUNTRAIL_TOKEN}"
      },
      "enabled": true
    }
  }
}
```

## Claude Code

Claude Code can use HTTP transport:

```sh
claude mcp add --transport http runtrail http://<runtrail-host>:8787/mcp
```

Keep the bearer token in the client-supported local secret mechanism. Do not paste real tokens into repo files.

## Verification

Verify the service first:

```sh
curl -fsS http://<runtrail-host>:8787/health
```

Verify OpenClaw can see Runtrail tools:

```sh
openclaw mcp status
openclaw mcp probe runtrail
```

Verify Codex loaded the configured stdio bridge, then approve one bounded read call in a Codex
session:

```sh
codex mcp get runtrail
codex
# Ask Codex: Use Runtrail journal_search_runs for project <project> with limit 1.
```

The result should contain at most one run for the requested project. If the tool is absent, check
the wrapper path and `command -v runtrail-mcp-bridge`. If startup fails, verify Runtrail health and
the local `RUNTRAIL_MCP_URL` before changing client configuration.

Verify one MCP read call from a Node environment with `@modelcontextprotocol/sdk` installed:

```js
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";

const client = new Client({ name: "runtrail-verify", version: "1.0.0" });
const transport = new StreamableHTTPClientTransport(new URL(process.env.RUNTRAIL_MCP_URL), {
  requestInit: { headers: { authorization: `Bearer ${process.env.RUNTRAIL_TOKEN}` } }
});
await client.connect(transport);
console.log((await client.listTools()).tools.map((tool) => tool.name).sort());
await client.callTool({ name: "journal_search_runs", arguments: { project: "runtrail", limit: 1 } });
await client.close();
```

Successful verification proves both tool discovery and one read call. For stdio bridge clients, run the same client with `StdioClientTransport` and the local bridge command.

## After Merges

After merging Runtrail MCP or bridge changes:

1. Update the Runtrail LXC with the normal deployment helper.
2. Confirm `/health` returns `ok`.
3. Refresh any copied standalone bridge files on client hosts.
4. Reload OpenClaw MCP runtimes with `openclaw mcp reload`.
5. Re-run tool discovery and `journal_search_runs`.

The deployed service and each client host can drift independently; always verify both sides.
