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
  Not touched. status: resolved (deleted by plan 13-07, commit 2606840)
- **`PriorityPicker` has no mount inside `ItemDetailPanel`.** The detail panel prints the priority
  row read-only; the picker is mounted from `BoardView` and the command palette. Plan 13-06 asked
  only that the picker stay reachable, which it is, so nothing was added. status: open

## 13-07

- **Epic status now has no UI writer.** `StatusPicker.tsx` served epics as well as tasks, and the
  plan deletes it outright (D-19) without saying what happens to an epic's `status`. The only path
  that ever moved an epic's status was the picker; `epic_set_status` (a Tauri command) and
  `set_epic_status` (core) remain, but nothing in the renderer calls them. Epics are therefore frozen
  at the status they were created with. Needs a decision: derive epic status from its tasks, or give
  epics their own control. Not added here: the plan scopes DRFT-04 to a task's status. status: open
- **`task_set_status` and `epic_set_status` are still registered Tauri commands.** No renderer code
  calls them any more (`useSetStatus` is deleted), but they remain in `main.rs`'s `generate_handler!`
  and `capabilities/default.json`'s roster. A source gate on the Rust tree cannot see a renderer
  `invoke("task_set_status")` typed by hand. Deleting the commands (and the `set_task_status` public
  function they wrap, once nothing else uses it) is outside this plan's file list. status: open
- **`worktree_lifecycle` is flaky under parallel test threads.** Both tests set the process-wide
  `FLYWHEEL_WORKTREE_ROOT` with no lock (the comment claims "single-threaded per binary", which
  libtest does not do), so one test's scratch directory is dropped under the other. About half of
  runs fail with `failed to write the dirty file: NotFound`; `RUST_TEST_THREADS=1` passes every
  time. Predates this plan; the sibling suites (`forge_live_chain.rs`, `forge_request_body.rs`) carry
  the lock that fixes it. status: open
- **`BoardRow`'s status glyph is now `aria-hidden`.** The row's own accessible name already states
  the status, so the glyph announces nothing twice. Logged only so the next accessibility pass knows
  it was a choice. status: resolved
- **Other `subscribeBoardChanged` readers still invalidate on every event.** Plan 13-10 routes the one
  central subscription (`useBoardChangedSubscription`) by `projectId`. About thirty per-hook
  subscribers (permission requests, run lists, worktree summaries, review and forge reads, fleet,
  authoring) still ignore the payload and invalidate their own project- or task-scoped key on every
  event, so a change in one project still wakes them. They are cheap, id-keyed reads and each now
  receives the typed payload, so narrowing any of them is a one-line change per hook. Not done here:
  the plan scopes FNC-07 to the central subscription. status: resolved by 13-15 (all 28 route through `useBoardChangedInvalidation`; a gate allows three callers)
- **Account-wide dispatch queries do not refresh on a cross-project event.** `GATE_KEY` and `CAP_KEY`
  (`["board","dispatch","gate"|"cap"]`) are account-wide, and the cap carries a running-run count.
  They used to refresh through the bare `["board"]` prefix on every event; an event for another
  project now invalidates nothing (the criterion-5 requirement). The gate has its own
  `dispatch:gate_changed` event. The cap's running count can lag until the next same-project or
  broadcast event. Fix is a `subscribeBoardChanged` effect in `useDispatchCap`, which also means
  adding the export to five dispatch test mocks. status: resolved by 13-15 (`GATE_KEY` was left alone: it has its own `dispatch:gate_changed` event)
