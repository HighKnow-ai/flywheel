# Phase 13 deferred items

Out-of-scope discoveries, logged and not fixed (executor scope boundary).

## 13-03

- **`npx tsc --noEmit` in `packages/desktop` exits non-zero on a pre-existing error.**
  `src/theme/__tests__/brand-rule.test.ts(2,10)` and `(2,22)` report `TS2305: Module 'node:fs' has no
  exported member 'existsSync' / 'globSync'`. The file was last touched by `ac8715e` and is not
  modified by plan 13-03; the errors come from the installed Node type definitions, not from the
  estimate removal. Every other file type-checks clean. `vitest` runs that test file and passes.

## 13-06

- **The agent-facing `propose_item` MCP tool cannot carry a priority yet.** Core now accepts an
  opt-in `priority` on task and epic proposal payloads (staged with its rationale, applied on human
  accept), but `packages/sidecar/src/mcp-permission-server.ts` has no `priority` property in
  `proposeItemToolDefinition`, so an agent cannot reach the new field through the tool today. The
  plan's file list is core and one desktop picker only. status: open
- **A second raw `UPDATE tasks SET status` exists outside `set_task_status_in_tx`.**
  `packages/core/src/domain/agent_run.rs:233` sets `in_progress` when a run starts. It predates this
  plan; plan 13-06's acceptance grep expects exactly one such statement and does not account for it.
  Not touched. status: open
- **`PriorityPicker` has no mount inside `ItemDetailPanel`.** The detail panel prints the priority
  row read-only; the picker is mounted from `BoardView` and the command palette. Plan 13-06 asked
  only that the picker stay reachable, which it is, so nothing was added. status: open
