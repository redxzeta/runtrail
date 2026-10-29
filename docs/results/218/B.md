**case**: B

**revision**: 7942389f8d9368b18f52c37d3df99e3b4f0ac278

**patch**: 136fdd2b740137e886d09362dea28354241b24d7

**task**: Review bounded #169 help regression

**summary**: Parent-pinned patch 136fdd2b740137e886d09362dea28354241b24d7 (producer tested uncommitted bytes).
Task: #218 Case B, bounded #169 CLI help tests. Only `test/cli.test.ts` edited; no production changes or commits.

Tested revision: `7942389f8d9368b18f52c37d3df99e3b4f0ac278` plus uncommitted test patch.

Commands/outcomes:

- `pnpm exec vitest run test/cli.test.ts -t 'prints structural help offline without config'` — failed twice: 7 passed, 1 failed. `rt run --help` rejected with “Options --source, --project, and --task are required.”
- First spawn guard failed because ESM namespace exports cannot be spied on. Corrected using the mutable built-in export, with restoration.
- `pnpm exec biome check test/cli.test.ts` — passed after formatting.
- `git diff --check` — passed.
- `pnpm exec vitest run test/cli.test.ts -t 'structural help|currently rejects run --help'` — passed: 8 tests, 28 skipped, 1.67s.

Coverage: repeated structural help calls for root, context, prepare-work, run create, workflow packet, verification add and handoff accept; all seven critical option names. Missing config and zero fetch calls asserted. Separate test truthfully characterizes `run --help` rejection and proves zero spawn/fetch calls. Modified globals and built-in bindings restored.

Blocker: `run --help` contract remains defective; green characterization does not establish help acceptance.

NOT verified: complete #169 coverage, full lint/typecheck/test/build, CI, runtime activation or pilot comparability.

Reviewer next action: inspect the exact uncommitted CLI test patch, rerun the final focused command, and independently confirm the pre-Commander wrapper dispatch before separately scoping a production fix.

**nextAction**: Inspect pinned CLI patch; independently confirm pre-Commander wrapper dispatch before separately scoping a production fix.

**blockers**: run --help contract is defective; green characterization is not acceptance.

**limits**: Complete #169 coverage, full checks, exact-head CI, activation and comparability NOT verified by producer.

**reference**: https://github.com/redxzeta/runtrail/issues/169

**source**: {"thread":{"threadId":"thread:delegated-task:command%3Amcp%3A68d4cd88-b7f3-4a27-9453-23ced2453e10%3Adelegate-task%3Ad036f23c-8c1e-4297-a95c-9aea575e4b85"},"recentRuns":[{"runId":"run:thread:thread%3Adelegated-task%3Acommand%253Amcp%253A68d4cd88-b7f3-4a27-9453-23ced2453e10%253Adelegate-task%253Ad036f23c-8c1e-4297-a95c-9aea575e4b85:ordinal:1","status":"completed","completedAt":"2026-10-29T04:52:41.382Z"}],"selectedItem":"turn-item:provider:codex:native-item:msg_0a3f0d5b77fad481016ae2d1104be88198a5780001f99b6af7","position":27}
