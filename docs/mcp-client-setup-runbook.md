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

Codex uses a stdio bridge. Put the token in a local env file, then point Codex at a local wrapper:

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
exec node "$HOME/.local/share/runtrail-mcp/bridge.js"
```

## OpenClaw

OpenClaw also uses the stdio bridge:

```sh
openclaw mcp set runtrail '{"command":"/home/<user>/.local/bin/runtrail-mcp","args":[]}'
openclaw mcp tools runtrail --include "journal_get_context,journal_search,journal_search_runs,journal_get_run_manifest,journal_create_handoff,journal_create_event,journal_create_open_loop,journal_resolve_open_loop,journal_record_decision"
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
