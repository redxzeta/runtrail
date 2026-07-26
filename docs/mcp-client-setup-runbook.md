# MCP Client Setup Runbook

Use the hosted Runtrail `/mcp` endpoint for remote-capable clients. Use a local stdio bridge only for clients that cannot connect to Streamable HTTP directly.

Do not SSH into the Runtrail LXC during MCP startup. MCP startup must read only local config and environment files.

Setup instructions do not by themselves establish client support. See the
[protocol compatibility and client support policy](protocol-compatibility.md) for the current
evidence level, version handling, and known limitations for each client and transport.

## Shared Environment

Keep secrets in an ignored local env file or secret store:

```sh
RUNTRAIL_MCP_URL=http://<runtrail-host>:8787/mcp
RUNTRAIL_URL=http://<runtrail-host>:8787
RUNTRAIL_TOKEN=<set-outside-source-control>
```

## macOS GUI credentials

A macOS application opened from Finder, Spotlight, the Dock, or at login is started by the user's
GUI `launchd` domain. It does not normally read interactive `zsh` startup files, so a token that is
available in Terminal may still be absent from a GUI MCP client. The generic pattern below stores
the token at rest in the login Keychain and uses a per-user LaunchAgent to export it into the GUI
bootstrap environment at login.

This setup is optional. Use it only when all of the following are true:

- the MCP client is a GUI application launched outside an existing terminal;
- its supported authentication configuration requires a bearer-token environment variable; and
- the variable must persist across login or application restarts.

It is not needed when the client is launched from a terminal that already has the variable, has a
native secret store or OAuth flow, or uses an existing protected stdio wrapper that loads its own
local environment file. Prefer a client-native secret mechanism when one is available.

For a qualifying GUI client, Codex is only an example. For a Codex configuration that already uses
an environment-backed bearer token, the relevant shape is:

```toml
[mcp_servers.runtrail]
url = "RUNTRAIL_MCP_URL"
bearer_token_env_var = "TOKEN_ENV_VAR"
```

Preserve the transport supported by the installed client; do not switch a working stdio setup
solely to copy this example. Replace every uppercase placeholder consistently:

- `RUNTRAIL_MCP_URL`: the existing MCP endpoint
- `TOKEN_ENV_VAR`: the variable named by the client configuration
- `KEYCHAIN_SERVICE` and `KEYCHAIN_ACCOUNT`: generic identifiers for one Keychain item
- `LAUNCH_AGENT_LABEL`: a unique reverse-DNS-style per-user label

The environment value is available to processes in the same login session after export. Keychain
protects the credential at rest, but an environment variable is not isolation from other processes
running as the same user.

### Inspect before changing anything

Confirm the endpoint, variable name, client process, and proposed locations without reading or
printing the token:

```zsh
token_env_name="TOKEN_ENV_VAR"
keychain_service="KEYCHAIN_SERVICE"
keychain_account="KEYCHAIN_ACCOUNT"
agent_label="LAUNCH_AGENT_LABEL"
agent_path="$HOME/Library/LaunchAgents/$agent_label.plist"

if /usr/bin/security find-generic-password \
  -s "$keychain_service" -a "$keychain_account" >/dev/null 2>&1; then
  print "Keychain item already exists; do not replace it without confirmation."
fi
if [[ -e "$agent_path" ]]; then
  print "LaunchAgent already exists at the proposed path; inspect it before replacement."
fi
```

An existing item or plist may belong to a working setup. Repeated setup should leave matching
state unchanged and stop for confirmation when it differs.

### Store or rotate the token

After confirming the identifiers and whether an existing item may be updated, read the credential
interactively so it is not written into shell history:

```zsh
IFS= read -r -s "new_token?Bearer token: "
print
if [[ -n "$new_token" ]]; then
  /usr/bin/security add-generic-password -U \
    -s "$keychain_service" \
    -a "$keychain_account" \
    -w "$new_token" \
    -T /usr/bin/security
else
  print -u2 "Token was empty; no Keychain change made."
fi
unset new_token
```

`-U` creates the item on first setup or updates that exact service/account pair during an approved
rotation. The token is neither echoed nor embedded in a persistent command. Do not add it to a
repository `.env`, YAML, plist, client configuration, transcript, or handoff.
macOS may request interactive approval for the Keychain change; approve only after verifying the
service/account identifiers, and treat cancellation as no completed rotation.

### Install the per-user LaunchAgent

Create `$HOME/Library/LaunchAgents/LAUNCH_AGENT_LABEL.plist` with mode `0600` only after checking
for an existing file. Replace the four placeholder strings; the plist must contain identifiers and
the lookup command, never the credential:

```xml
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN"
  "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>Label</key>
  <string>LAUNCH_AGENT_LABEL</string>
  <key>ProgramArguments</key>
  <array>
    <string>/bin/zsh</string>
    <string>-c</string>
    <string>token=$(/usr/bin/security find-generic-password -s 'KEYCHAIN_SERVICE' -a 'KEYCHAIN_ACCOUNT' -w) || exit 1; [[ -n "$token" ]] || exit 1; /bin/launchctl setenv 'TOKEN_ENV_VAR' "$token"; unset token</string>
  </array>
  <key>RunAtLoad</key>
  <true/>
</dict>
</plist>
```

Validate permissions and syntax before loading:

```zsh
/bin/chmod 600 "$agent_path"
/usr/bin/plutil -lint "$agent_path"
```

The absence of stdout/stderr paths is intentional: the lookup result must not be logged.

### Load, reload, and verify

Bootstrap the agent in the current user's GUI domain. The guarded `bootout` makes a repeated load
safe without hiding a failure from `bootstrap` or `kickstart`:

```zsh
gui_domain="gui/$(/usr/bin/id -u)"
if /bin/launchctl print "$gui_domain/$agent_label" >/dev/null 2>&1; then
  /bin/launchctl bootout "$gui_domain/$agent_label"
fi
/bin/launchctl bootstrap "$gui_domain" "$agent_path"
/bin/launchctl kickstart -k "$gui_domain/$agent_label"
```

Run each check without displaying the token:

```zsh
/usr/bin/security find-generic-password \
  -s "$keychain_service" -a "$keychain_account" >/dev/null
/usr/bin/plutil -lint "$agent_path"
/bin/launchctl print "$gui_domain/$agent_label" >/dev/null
/bin/launchctl print "$gui_domain/$agent_label" |
  /usr/bin/awk '/state =|last exit code =/'
/bin/launchctl getenv "$token_env_name" | /usr/bin/grep -q .
```

Set `runtrail_base_url` to the existing service URL without a trailing slash and verify health:

```zsh
runtrail_base_url="RUNTRAIL_BASE_URL"
/usr/bin/curl -fsS "$runtrail_base_url/health" >/dev/null
```

Fully quit the GUI MCP client—not merely its window—and reopen it after initial setup or rotation.
Use the reopened client to initialize MCP or perform one bounded authenticated read such as
`journal_search_runs` with `limit: 1`. Do not enable verbose HTTP logging or print the authorization
header. Success proves that a newly launched client inherited the variable; it does not prove the
token value should be displayed.

### Rotation and removal

For rotation, repeat the interactive `security add-generic-password -U` command, kickstart the
LaunchAgent, confirm the variable is non-empty, then fully quit and reopen the GUI client. Existing
client processes retain their old environment.

For clean removal, first quit the GUI client and confirm the exact label, plist, service, account,
and variable. Then unload before deleting:

```zsh
if /bin/launchctl print "$gui_domain/$agent_label" >/dev/null 2>&1; then
  /bin/launchctl bootout "$gui_domain/$agent_label"
fi
/bin/launchctl unsetenv "$token_env_name"
/bin/rm -- "$agent_path"
/usr/bin/security delete-generic-password \
  -s "$keychain_service" -a "$keychain_account"
```

Verify `launchctl print` fails for the removed label, `launchctl getenv` returns no value, and the
exact Keychain lookup fails. Removal takes effect for the GUI client after it is fully restarted.

### Troubleshooting

- If Terminal has the variable but the GUI client does not, confirm the client was fully quit and
  reopened after `launchctl setenv`.
- If Keychain lookup fails, confirm the exact service/account pair and that the login Keychain is
  unlocked. Unlock it interactively in Keychain Access or with `security unlock-keychain` without
  putting the Keychain password on the command line.
- If creation, rotation, or retrieval opens a Keychain approval prompt, verify the requesting
  binary and exact identifiers before approving. Do not bypass or automate the prompt.
- If `last exit code` is nonzero, run the silent Keychain-presence check as the same user. Do not
  add shell tracing or echo the lookup result.
- If `bootstrap` reports an existing service, inspect it with the bounded `launchctl print` pipeline,
  then use the guarded reload sequence. Do not use `sudo` or install a system LaunchDaemon.
- If the authenticated read fails, distinguish service health, client restart, endpoint, Keychain
  access, and MCP compatibility before rotating the token.

### Copyable agent setup prompt

```text
Configure persistent, environment-backed MCP authentication for my macOS GUI client.

Before changing anything:

1. Inspect the existing MCP client configuration and relevant client process. First determine
   whether Keychain plus a LaunchAgent is necessary: do not use it for a terminal-launched client,
   a client-native secret store or OAuth flow, or a protected stdio wrapper that already loads its
   own environment file. If it is unnecessary, explain why and stop without changing local state.
   Otherwise determine the endpoint, bearer-token environment-variable name, transport, proposed
   Keychain service/account, LaunchAgent label, and per-user plist path without reading or printing
   any secret value.
2. Use discovered values or explicit placeholders. Do not assume a username, host, token variable,
   Keychain identifier, application, or installation path.
3. Check whether the exact Keychain item and LaunchAgent already exist. Explain the proposed
   identifiers and locations, show only secret-free metadata, and obtain my confirmation before
   overwriting or deleting either item.

Implement the setup:

4. Prompt for the bearer token with hidden interactive input. Store it in the login Keychain. Never
   place it in a repository file, YAML, source, .env, plist, shell history, command output, log, or
   final report.
5. Create an idempotent per-user LaunchAgent, never a LaunchDaemon, that uses /bin/zsh,
   /usr/bin/security, and /bin/launchctl setenv to retrieve the item at login. The plist may contain
   only the Keychain identifiers, environment-variable name, and lookup/export command—not the
   credential. Leave matching existing state unchanged and stop for confirmation when it differs.
6. Set the plist to mode 0600, validate it with plutil, and safely bootout/bootstrap/kickstart it in
   gui/$(id -u). Confirm Keychain presence, plist validity, service status/exit result, and a
   non-empty launchctl environment value without displaying the value.
7. Verify the Runtrail health endpoint and one authenticated MCP initialization or bounded read
   through the fully restarted GUI client. Do not log an authorization header or raw response body.
8. Exercise repeat setup and, if I approve it, token rotation. Explain and validate clean removal
   using the exact service/account, label, plist, and environment variable.

Finish by telling me to fully quit and reopen the GUI client after installation or rotation.
Return a secret-free handoff listing created paths, identifiers (not values), validation outcomes,
restart requirements, rollback/removal commands, and manual follow-up.
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
openclaw mcp tools runtrail --include "journal_start_run,journal_resume_run,journal_heartbeat_run,journal_pause_run,journal_finish_run,journal_get_context,journal_search,journal_search_runs,journal_get_run_manifest,journal_get_workflow,journal_create_handoff,journal_list_pending_handoffs,journal_accept_handoff,journal_decline_handoff,journal_complete_handoff,journal_expire_handoff,journal_create_event,journal_create_open_loop,journal_resolve_open_loop,journal_record_decision"
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
      "oauth": false,
      "headers": {
        "Authorization": "Bearer {env:RUNTRAIL_TOKEN}"
      },
      "enabled": true
    }
  }
}
```

OpenCode substitutes `{env:RUNTRAIL_TOKEN}` at runtime; `${RUNTRAIL_TOKEN}` is not its configuration
syntax. `oauth: false` disables OAuth discovery for this static bearer-token endpoint. Keep the
non-secret definition in project or local OpenCode configuration and supply the token only through
the local environment.

Check the rendered connection status without printing the bearer header:

```sh
opencode mcp list
```

With OpenCode `1.18.5`, the status is `connected` when initialization succeeds, reports HTTP `401`
for a missing or invalid token, and reports an unable-to-connect diagnostic while Runtrail is
offline. The command exits zero for those failed statuses, so automation must not treat its exit
code alone as proof of connectivity; make one bounded MCP read before claiming success.

## Claude Code

Claude Code can use HTTP transport:

```sh
claude mcp add --transport http \
  --header='Authorization: Bearer ${RUNTRAIL_TOKEN}' \
  runtrail http://<runtrail-host>:8787/mcp
```

The single quotes preserve `${RUNTRAIL_TOKEN}` for Claude's runtime environment expansion instead
of putting the value in shell history or MCP configuration. Use `--scope local` when the server
should remain private to the current user/project, or a project `.mcp.json` with the same
placeholder when the non-secret definition should be shared. Never commit the expanded value.

Use `claude mcp list` for a redacted connection check. Claude Code `2.1.12` expands and prints
static header values in `claude mcp get`, including bearer headers, so do not run `mcp get` for an
authenticated server on that version. If it happens, treat the token as exposed and rotate it.

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
