---
phase: 10-fleet-supervision-across-every-project
plan: 04
subsystem: fleet
tags: [rust, tauri, react, sqlite, fleet, spend, acknowledge]

requires:
  - phase: 10-fleet-supervision-across-every-project
    provides: "10-01 fleet_rows, FleetSurface, runStatus.ts formatters; 10-03 async fleet_list, shared feed wording"
  - phase: 03-nothing-lost-nothing-left-running
    provides: "agent_runs.acknowledged_at and the abandoned acknowledge the recovery surface reads"
provides:
  - "domain::agent_run::acknowledge_run and ACKNOWLEDGEABLE_STATUSES: the one acknowledge statement, widened to abandoned, completed, failed, interrupted"
  - "agent_run_acknowledge calling it; agent_run_acknowledge_many (cap 200, per-id result)"
  - "FleetList.visible_cost_usd: the visible rows' recorded cost summed by the read, None when none has one"
  - "FleetSurface SpendCell, FleetFooter, per-row Dismiss, band-header Dismiss finished"
  - "adapters/tauri.ts agentRunAcknowledgeMany and FleetListDto.visibleCostUsd"
affects: [10-05, 10-06, 10-07]

requirements-completed: [AGNT-08, FLEET-01]

actuals:
  tokens: 20761
  tasks: 2
  commits: 2
plan_head_before: 14213021e3c55029d43dc1da8efa0f295d66fc98
commits: 2

tech-stack:
  added: []
  patterns:
    - "One statement, many callers: the status guard sits in the UPDATE's own WHERE, bound from a single const"
    - "Aggregate in the read, never the renderer: visible_cost_usd"
    - "Blank is the absence treatment for spend; the dash stays reserved for age and unreadable activity"

key-files:
  created:
    - packages/desktop/src/fleet/__tests__/fleet-spend.test.tsx
  modified:
    - packages/core/src/domain/agent_run.rs
    - packages/core/src/query/fleet.rs
    - packages/core/tests/fleet_query.rs
    - packages/core/tests/recovery_summary.rs
    - packages/desktop/src-tauri/src/commands/agent_run.rs
    - packages/desktop/src-tauri/src/commands/fleet.rs
    - packages/desktop/src-tauri/src/main.rs
    - packages/desktop/src-tauri/capabilities/default.json
    - packages/desktop/src/adapters/tauri.ts
    - packages/desktop/src/fleet/FleetSurface.tsx
    - packages/desktop/src/fleet/__tests__/fleet-surface.test.tsx
    - packages/desktop/src/fleet/__tests__/fleet-activity.test.tsx

key-decisions:
  - "acknowledge_run takes no actor and a shared &Connection: the statement it replaces wrote one timestamp and appended no event, so an actor would be an unused parameter"
  - "The statement adds AND acknowledged_at IS NULL, so a second acknowledge keeps the first timestamp and reports false"
  - "No dismiss key was bound: a fleet row has no selection model yet, so a key has nothing to aim at; Dismiss is a focusable button"
  - "Open Question 2 resolved by the explicit-dismiss recommendation; moving a task to Done deliberately does not clear its row"

duration: 25min
completed: 2026-10-12
status: complete

coverage:
  - id: D1
    description: "One acknowledge statement accepts abandoned, completed, failed and interrupted runs, refuses live runs, keeps the first timestamp, and returns false for an unknown id"
    requirement: FLEET-01
    verification:
      - kind: integration
        ref: "packages/core/tests/fleet_query.rs#acknowledging_each_terminal_status_removes_the_run_from_the_fleet"
        status: pass
      - kind: integration
        ref: "packages/core/tests/fleet_query.rs#a_live_run_cannot_be_acknowledged"
        status: pass
      - kind: integration
        ref: "packages/core/tests/fleet_query.rs#acknowledging_twice_keeps_the_first_timestamp_and_an_unknown_id_is_refused"
        status: pass
    human_judgment: false
  - id: D2
    description: "The recovery surface's own count is unchanged: its fixture now calls the core function and its pre-existing assertions pass untouched"
    requirement: FLEET-01
    verification:
      - kind: integration
        ref: "packages/core/tests/recovery_summary.rs"
        status: pass
    human_judgment: false
  - id: D3
    description: "Moving a task to Done does not acknowledge its run; the row re-reads as plain completed"
    requirement: FLEET-01
    verification:
      - kind: integration
        ref: "packages/core/tests/fleet_query.rs#moving_a_task_to_done_does_not_clear_its_row_it_re_reads_as_plain_completed"
        status: pass
    human_judgment: false
  - id: D4
    description: "Spend is NULL for a live run, kept for a failed run, and visible_cost_usd is None with no costed row and the exact sum otherwise"
    requirement: AGNT-08
    verification:
      - kind: integration
        ref: "packages/core/tests/fleet_query.rs#spend_projects_null_for_a_live_run_and_its_cost_for_a_failed_one"
        status: pass
      - kind: integration
        ref: "packages/core/tests/fleet_query.rs#visible_cost_is_none_without_a_costed_row_and_the_exact_sum_otherwise"
        status: pass
    human_judgment: false
  - id: D5
    description: "The spend cell is blank while running and when never recorded, the footer is labelled an estimate and not a billed amount, Dismiss exists on terminal rows only, and clicking a row acknowledges nothing"
    requirement: AGNT-08
    verification:
      - kind: unit
        ref: "packages/desktop/src/fleet/__tests__/fleet-spend.test.tsx"
        status: pass
    human_judgment: false
  - id: D6
    description: "The spend column, footer and Dismiss buttons read well at row density in the real WebView, and a real button press clears the row end to end"
    verification: []
    human_judgment: true
    rationale: "Aesthetic fit in a WKWebView with no WebDriver, and no test drives the real Tauri round trip. Queued as D-REV-49, not observed."
---

# Phase 10 Plan 04: Spend, estimate footer and dismiss Summary

**Every finished fleet row now shows its recorded cost and tokens, the footer totals the visible spend and says it is Flywheel's own estimate, and a finished run leaves the fleet only when the user dismisses it, through one acknowledge statement shared by the command and the tests.**

## What was built

1. **`acknowledge_run` (`e376524`).** One `UPDATE` in `domain/agent_run.rs`, with the status guard in its own `WHERE` as `status IN (?, ?, ?, ?)` bound from `ACKNOWLEDGEABLE_STATUSES` (`abandoned`, `completed`, `failed`, `interrupted`). A live run is refused by the statement itself. The command's inline SQL is gone; `recovery_summary.rs` no longer mirrors the SQL and calls the function, with its existing assertions unchanged. `agent_run_acknowledge_many` loops the same function, capped at 200 ids, one result per id. The capability roster describes the real guard and lists the new command, and `main.rs` registers it once.
2. **Spend and dismiss (`9f73ea1`).** `fleet_rows` sums the non-NULL costs of the rows it returns into `visible_cost_usd` (`None` when there are none), carried through `FleetListDto`. `SpendCell` renders `formatCostUsd` for a finished row and an empty span otherwise. `FleetFooter` renders the total or nothing. Terminal rows get a Dismiss button; the DONE / FAILED band header gets "Dismiss finished".

## Recorded choices

- **Dismiss key: none was bound.** The plan asked for a key distinct from Enter, `a`, `d` and shift-`a`. A fleet row has no selection model yet (plan 10-06 owns row focus and opening), so a key would have no row to act on. Dismiss is a real `<button>`, reachable by Tab and activated by the browser's own Enter or Space on that focused button. That cannot collide with the permission card's keys, since it binds nothing in `keyboard.ts`. Revisit when 10-06 adds selection.
- **Footer wording, exact:** `Estimated spend, this fleet: $1.7500 (Flywheel's own estimate from a bundled price table, not a billed amount)`. Hidden entirely when no visible row has a cost.
- **Tokens were shown, and labelled.** The cell reads `1,234,567 in incl. cache · 890 out`, with a tooltip saying input tokens include cache reads and so exceed the prompt size. The cost span's tooltip says it is an estimated cost.
- **Blank, not a dash, is spend's absence treatment.** `formatAge` and the activity cell already use the dash for other meanings. The live-row guard is in the renderer as well as in the data, asserted with a live row that carries a cost.
- **Open Question 2 resolved by the explicit-dismiss recommendation.** Opening a session, a refresh and a restart acknowledge nothing; moving a task to Done does not clear the row, which re-reads as plain `completed` (pinned in `fleet_query.rs`). Rows have no open target yet, so the "clicking a row acknowledges nothing" test guards the future 10-06 click path.
- **Dismiss is offered on every terminal run,** including `abandoned` and awaiting-review rows, since `acknowledge_run` accepts them. "Dismiss finished" is scoped to the DONE / FAILED band only, so it never clears NEEDS YOU rows in bulk.

## Deviations from Plan

**1. [Rule 1 - Simplification] `acknowledge_run` has no `actor_id` and takes `&Connection`**
- **Found during:** Task 1
- **Issue:** the plan's signature carried `&mut Connection` and an `actor_id`, but the statement it replaces wrote one timestamp and appended no event, and the plan says not to add one. The actor would be an unused parameter.
- **Fix:** `acknowledge_run(conn: &Connection, agent_run_id: &str) -> anyhow::Result<bool>`. The command resolves no actor for it.
- **Files modified:** `domain/agent_run.rs`, `commands/agent_run.rs`

**2. [Rule 1 - Behaviour tightening] Added `AND acknowledged_at IS NULL`**
- **Found during:** Task 1
- **Issue:** the old statement rewrote the timestamp on every call; the plan requires the first timestamp to survive a second acknowledge.
- **Fix:** the guard is in the statement. For an abandoned run the only change is that a repeat acknowledge no longer moves the stamp.

**3. [Rule 3 - Blocking] The `SET acknowledged_at` count gate reads 2, not 1**
- **Found during:** Task 1 verification
- **Issue:** `grep -rl 'SET acknowledged_at' packages/core/src ...` also matches `0020_fleet.sql`, the one-off historic backfill from plan 10-01, which is a migration and not a runtime statement.
- **Fix:** none. Exactly one runtime `UPDATE agent_runs SET acknowledged_at` exists in the repository, in `domain/agent_run.rs`, and none remains in `commands/agent_run.rs`.

**4. [Rule 3 - Blocking] Existing fleet test helpers needed the new DTO field**
- **Found during:** Task 2
- **Fix:** `fleet-surface.test.tsx` and `fleet-activity.test.tsx` helpers set `visibleCostUsd: null`. No expectation changed.

**Total deviations:** 4 (2 simplifications and tightenings, 2 blocking). **Impact:** none on scope.

## Verification run

- `cargo test -p core --test fleet_query --test recovery_summary --test activity_trail --test discard_lifecycle`: 19, 12, 5 and 7 passed.
- `cargo test -p desktop`: 110 passed. `cargo build --workspace`: clean apart from the pre-existing `StartRunOutcome` dead-code warning.
- `npm --prefix packages/desktop test`: 79 files, 1,352 tests passed. `npm --prefix packages/desktop run build`: clean.
- Gates: no acknowledge `UPDATE` in `commands/agent_run.rs`; `UPDATE agent_runs SET` count in `recovery_summary.rs` is 0; `ACKNOWLEDGEABLE_STATUSES` appears at least twice; the old "guarded to the abandoned status" sentence is gone from `default.json`; `agent_run_acknowledge_many` appears once in `main.rs`; `visible_cost_usd` is declared and computed in `fleet.rs`; no `reduce(` or `.sum(` in `FleetSurface.tsx`.

## Known Stubs

None.

## Threat Flags

None. The register's items are in place: the guard inside the statement (T-10-04-01), the 200-id cap and per-id results (T-10-04-02), recovery tests run against the shared function (T-10-04-03), and the estimate label asserted on the rendered footer (T-10-04-05). The batch command takes ids only and no actor.

## Deferred review

D6 is queued as D-REV-49 in `.planning/DEFERRED-REVIEW.md` with `automatable: PARTLY`. It was not observed.

## Self-Check: PASSED

`fleet-spend.test.tsx` exists, and commits `e376524` and `9f73ea1` resolve.
