# Agent Write Contract

This contract makes Runtrail useful when a different agent needs to continue work later. Agents should write small, structured facts to Runtrail while keeping verbose logs in files.

## Required Fields

Every agent run should include:

- `source`: agent or runtime, such as `codex`, `openclaw`, `claude-code`, or `opencode`.
- `project`: stable project name, such as `runtrail` or `ice-council`.
- `task`: short work description.
- `category`: one of `implementation`, `review`, `debug`, `deploy`, `research`, `planning`, or `ops`.
- `tags`: stable search tags, such as `codex`, `openclaw`, `claude-code`, `opencode`, `runtrail`, `ice-council`, `issue-N`, `pr-N`, `mcp`, or `lxc`.

When available, wrappers should also capture host, cwd, git repo path, branch, commit, changed files, command exit code, and log path.

## When To Write

- Start a run when an agent begins a scoped task.
- Write events for material progress, file changes, commands, tests, failures, and decisions that affect continuation.
- Write a handoff when another agent or future session should continue the task.
- Write an open loop when work is blocked, needs review, needs a decision, or has a follow-up that should not be lost.
- Write a decision when a durable architectural or operational choice is made.

Use `summary` for what happened, `nextAction` for the next concrete step, and `blockedReason` inside event or handoff context when work cannot continue.

## Continuation Query

Before continuing work, an agent should query in this order:

1. `journal_get_context` with the target `project`.
2. `journal_search` with `project` plus relevant `tag`, `category`, `issue-N`, or `pr-N`.
3. `journal_get_run_manifest` for the most relevant run.
4. Open loops and recent handoffs from the context or search results.

The goal is to recover the current branch, issue/PR, changed files, tests run, blocked reason, and next action before editing.

## Copyable Snippets

Codex `AGENTS.md` snippet:

```md
When working in this repo, write Runtrail entries with source `codex`, project `<project>`, a category, and stable tags such as `codex`, `issue-N`, and `pr-N`. Before continuing existing work, query Runtrail context and relevant handoffs. At handoff, record summary, nextAction, branch, changedFiles, testsRun, and blockedReason if blocked.
```

OpenClaw local instruction snippet:

```md
Use Runtrail for durable task continuity. Prefer `rt run --source openclaw --project <project> --task <task> --category <category> --tag openclaw --tag issue-N -- <command>` for command work. Use Runtrail MCP for context, search, manifests, events, open loops, decisions, and handoffs.
```

Claude Code hook snippet:

```sh
rt event create --run-id "$RUNTRAIL_RUN_ID" --type progress --message "Claude Code made progress" --importance 4 --category implementation --tag claude-code --tag issue-N
rt handoff create --source-run-id "$RUNTRAIL_RUN_ID" --from-source claude-code --to-source codex --project "$RUNTRAIL_PROJECT" --summary "Ready for continuation" --next-action "Review changed files and run tests" --category implementation --tag claude-code --tag issue-N
```

opencode MCP snippet:

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

Secrets must stay in environment variables, ignored env files, or secret stores. Do not commit real tokens, webhook URLs, or host-only secret paths to docs, source, YAML, or examples.
