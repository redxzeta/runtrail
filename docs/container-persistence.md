# Docker Compose Persistence Check

This procedure proves that structured Runtrail state survives container restart and recreation
through the existing named volume. It uses a generated token and uniquely named disposable Compose
project, volume, and ledger project. Never run it against an existing Compose project or volume.

## Prerequisites

Start from a clean checkout. Docker Desktop or Docker Engine must be running, with Compose v2,
`curl`, `jq`, and `openssl` available:

```sh
git status --short
git rev-parse HEAD
docker version
docker compose version
```

Record the commit, OS/architecture, Docker client/engine, and Compose versions in the sanitized
result. Stop if the checkout is dirty, the daemon is unavailable, or disposable isolation cannot
be confirmed.

## Isolated configuration

Run these commands in one `zsh` or Bash session. Choose an unused host port; the container still
listens on 8787 internally.

```sh
compose_project="runtrail-persistence-$(date +%Y%m%d%H%M%S)-$$"
volume_name="${compose_project}_runtrail-data"
ledger_project="${compose_project}-ledger"
host_port="${RUNTRAIL_TEST_HOST_PORT:-18787}"
base_url="http://127.0.0.1:${host_port}"

export RUNTRAIL_HOST_PORT="$host_port"
export RUNTRAIL_TOKEN="$(openssl rand -hex 32)"
```

The token command, not its result, may remain in shell history. Disable shell tracing and never run
`docker compose config` in published output because rendered configuration can contain the token.

Confirm the generated project and volume do not already exist:

```sh
if docker volume inspect "$volume_name" >/dev/null 2>&1; then
  echo "Refusing to use existing volume: $volume_name" >&2
  return 1 2>/dev/null || exit 1
fi
if docker ps -a \
  --filter "label=com.docker.compose.project=$compose_project" \
  --format '{{.ID}}' | grep -q .; then
  echo "Refusing to use existing Compose project: $compose_project" >&2
  return 1 2>/dev/null || exit 1
fi
```

Use this helper so the authorization value is supplied through curl's standard-input config
rather than pasted into commands or printed:

```sh
rt_curl() {
  curl --silent --show-error --fail-with-body --config - "$@" <<EOF
header = "authorization: Bearer $RUNTRAIL_TOKEN"
EOF
}

wait_for_health() {
  for attempt in $(seq 1 60); do
    curl -fsS "$base_url/health" >/dev/null 2>&1 && return 0
    sleep 1
  done
  return 1
}
```

## Build and record a lifecycle

Build and start only the disposable project, then confirm Compose owns the expected volume:

```sh
docker compose -p "$compose_project" up -d --build
wait_for_health
test "$(docker volume inspect \
  --format '{{ index .Labels "com.docker.compose.project" }}' \
  "$volume_name")" = "$compose_project"
```

Create one run, typed event, decision, open loop, and handoff. All identifiers and facts are
synthetic and remain in shell variables:

```sh
run_response="$(rt_curl -X POST "$base_url/runs" \
  -H 'content-type: application/json' \
  --data "$(jq -nc --arg project "$ledger_project" '{
    source:"compose-validation",
    project:$project,
    clientRunId:"persistence-run",
    workflowId:"persistence-workflow",
    task:"container persistence validation",
    category:"ops",
    tags:["container-persistence"]
  }')")"
run_id="$(printf '%s' "$run_response" | jq -er '.run.id')"

event_response="$(rt_curl -X POST "$base_url/events" \
  -H 'content-type: application/json' \
  --data "$(jq -nc --arg runId "$run_id" '{
    runId:$runId,
    clientRecordId:"persistence-event",
    type:"test_passed",
    message:"synthetic persistence check",
    importance:5,
    category:"ops",
    tags:["container-persistence"]
  }')")"
event_id="$(printf '%s' "$event_response" | jq -er '.event.id')"

decision_response="$(rt_curl -X POST "$base_url/decisions" \
  -H 'content-type: application/json' \
  --data "$(jq -nc --arg project "$ledger_project" '{
    project:$project,
    clientRecordId:"persistence-decision",
    title:"Synthetic persistence decision",
    decision:"Retain the named volume during recreation"
  }')")"
decision_id="$(printf '%s' "$decision_response" | jq -er '.decision.id')"

loop_response="$(rt_curl -X POST "$base_url/open-loops" \
  -H 'content-type: application/json' \
  --data "$(jq -nc --arg project "$ledger_project" --arg runId "$run_id" '{
    project:$project,
    clientRecordId:"persistence-loop",
    type:"follow_up",
    title:"Synthetic persistence follow-up",
    source:"compose-validation",
    sourceRunId:$runId
  }')")"
loop_id="$(printf '%s' "$loop_response" | jq -er '.openLoop.id')"

handoff_response="$(rt_curl -X POST "$base_url/handoffs" \
  -H 'content-type: application/json' \
  --data "$(jq -nc --arg project "$ledger_project" --arg runId "$run_id" '{
    project:$project,
    clientRecordId:"persistence-handoff",
    sourceRunId:$runId,
    fromSource:"compose-validation",
    toSource:"future-validation",
    summary:"Synthetic persisted handoff"
  }')")"
handoff_id="$(printf '%s' "$handoff_response" | jq -er '.handoff.id')"
```

## Reusable state assertions

Define one verifier that checks direct lifecycle reads, bounded context, journal search, and the run
manifest without printing raw responses:

```sh
verify_persisted_state() {
  response="$(rt_curl "$base_url/runs/$run_id")"
  printf '%s' "$response" | jq -e \
    --arg run "$run_id" --arg event "$event_id" \
    '.run.id == $run and ([.events[].id] | index($event)) != null' >/dev/null

  response="$(rt_curl --get "$base_url/decisions" \
    --data-urlencode "project=$ledger_project" --data-urlencode 'limit=50')"
  printf '%s' "$response" | jq -e --arg id "$decision_id" \
    '([.decisions[].id] | index($id)) != null' >/dev/null

  response="$(rt_curl --get "$base_url/open-loops" \
    --data-urlencode "project=$ledger_project" --data-urlencode 'limit=50')"
  printf '%s' "$response" | jq -e --arg id "$loop_id" \
    '([.openLoops[].id] | index($id)) != null' >/dev/null

  response="$(rt_curl --get "$base_url/handoffs" \
    --data-urlencode "project=$ledger_project" \
    --data-urlencode 'status=all' --data-urlencode 'limit=50')"
  printf '%s' "$response" | jq -e --arg id "$handoff_id" \
    '([.handoffs[].id] | index($id)) != null' >/dev/null

  response="$(rt_curl --get "$base_url/agent/context" \
    --data-urlencode "project=$ledger_project" \
    --data-urlencode 'limit=10' --data-urlencode 'min_importance=0')"
  printf '%s' "$response" | jq -e \
    --arg run "$run_id" --arg decision "$decision_id" \
    --arg loop "$loop_id" --arg handoff "$handoff_id" \
    '([.. | strings] | index($run)) != null
      and ([.. | strings] | index($decision)) != null
      and ([.. | strings] | index($loop)) != null
      and ([.. | strings] | index($handoff)) != null' >/dev/null

  response="$(rt_curl --get "$base_url/search" \
    --data-urlencode "project=$ledger_project" \
    --data-urlencode 'text=Synthetic' --data-urlencode 'limit=20')"
  printf '%s' "$response" | jq -e \
    --arg decision "$decision_id" --arg loop "$loop_id" --arg handoff "$handoff_id" \
    '([.. | strings] | index($decision)) != null
      and ([.. | strings] | index($loop)) != null
      and ([.. | strings] | index($handoff)) != null' >/dev/null

  response="$(rt_curl "$base_url/runs/$run_id/manifest")"
  printf '%s' "$response" | jq -e \
    --arg run "$run_id" --arg event "$event_id" \
    --arg loop "$loop_id" --arg handoff "$handoff_id" \
    '.manifest.run.id == $run
      and ([.manifest.events[].id] | index($event)) != null
      and ([.manifest.open_loops[].id] | index($loop)) != null
      and ([.manifest.handoffs[].id] | index($handoff)) != null' >/dev/null
}

verify_persisted_state
```

## Restart and recreate

A restart must retain both the container identifier and every structured fact:

```sh
container_before_restart="$(docker compose -p "$compose_project" ps -q runtrail)"
docker compose -p "$compose_project" restart runtrail
wait_for_health
test "$(docker compose -p "$compose_project" ps -q runtrail)" = "$container_before_restart"
verify_persisted_state
```

Force recreation without `--volumes` or `down -v`. The container identifier must change while the
state assertions still pass:

```sh
container_before_recreate="$(docker compose -p "$compose_project" ps -q runtrail)"
docker compose -p "$compose_project" up -d --force-recreate --no-deps runtrail
wait_for_health
container_after_recreate="$(docker compose -p "$compose_project" ps -q runtrail)"
test -n "$container_after_recreate"
test "$container_after_recreate" != "$container_before_recreate"
verify_persisted_state
```

Record only pass/fail outcomes and whether identifiers matched. Do not publish the token, rendered
Compose configuration, authorization header, raw response bodies, database, volume contents, or
logs.

## Confirmed cleanup

First verify the volume's Compose project label. Display the exact disposable targets and require
the operator to type the generated project name before deletion:

```sh
test "$(docker volume inspect \
  --format '{{ index .Labels "com.docker.compose.project" }}' \
  "$volume_name")" = "$compose_project"

printf 'Delete disposable Compose project %s and volume %s? Type the project name: ' \
  "$compose_project" "$volume_name"
read -r confirmation
test "$confirmation" = "$compose_project"

docker compose -p "$compose_project" down --volumes --remove-orphans
unset RUNTRAIL_TOKEN
```

Confirm no project container, network, or volume remains:

```sh
! docker volume inspect "$volume_name" >/dev/null 2>&1
! docker ps -a \
  --filter "label=com.docker.compose.project=$compose_project" \
  --format '{{.ID}}' | grep -q .
! docker network ls \
  --filter "label=com.docker.compose.project=$compose_project" \
  --format '{{.ID}}' | grep -q .
```

If any earlier step fails, keep the exact variables in the current shell, inspect only the
disposable project, and use this same confirmed cleanup. Never substitute another project name or
use a broad volume prune.

## Troubleshooting

- If the host port is occupied, choose another `RUNTRAIL_TEST_HOST_PORT`; do not stop an unrelated
  service.
- If the build fails in Corepack signature verification, confirm the Dockerfile uses the pinned
  current Node 22 patch. Do not disable signature verification.
- If authentication fails, recreate the disposable project with the same generated token still in
  the shell; never inspect or publish rendered container environment.
- If state disappears only after recreation, confirm the command omitted `--volumes` and that the
  inspected volume carries the exact disposable Compose project label.
- Podman observations may be recorded separately, but this procedure and its support claim are for
  Docker Compose.
