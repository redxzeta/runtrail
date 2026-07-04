# Claude Code Hook Examples

These examples show hook commands that post lifecycle events to Runtrail. Keep Claude-specific behavior in hook configuration; the Runtrail service should remain generic.

Set local environment first:

```sh
export RUNTRAIL_URL=http://127.0.0.1:8787
export RUNTRAIL_TOKEN=change-me-to-a-long-random-secret
export RUNTRAIL_RUN_ID=run_existing_from_wrapper
```

Post lifecycle events with the CLI:

```sh
rt event create --run-id "$RUNTRAIL_RUN_ID" --type started --message "Claude Code session started" --importance 4
rt event create --run-id "$RUNTRAIL_RUN_ID" --type decision_required --message "Claude Code needs input" --importance 8
rt event create --run-id "$RUNTRAIL_RUN_ID" --type files_changed --message "Claude Code changed files" --importance 5
rt event create --run-id "$RUNTRAIL_RUN_ID" --type completed --message "Claude Code completed" --importance 6
rt event create --run-id "$RUNTRAIL_RUN_ID" --type failed --message "Claude Code failed" --importance 9
```

Use `rt run --source claude-code --project <project> --task <task> -- claude ...` when possible. Hooks are useful for intermediate notifications; the wrapper is still the source of truth for start/end state, exit code, host, cwd, git metadata, and log artifacts.
