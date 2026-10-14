---
phase: 10-fleet-supervision-across-every-project
plan: 01
subsystem: fleet
tags: [sqlite, rusqlite, tauri, react, tanstack-query, zustand, fleet, run-status]

requires:
  - phase: 02-one-agent-one-worktree-watched-live
    provides: agent_runs, permission_requests, SessionSurface, the agent legend channel
  - phase: 03-nothing-lost-nothing-left-running
    provides: agent_runs.acknowledged_at and the abandoned status the recovery surface reads
provides:
  - "Migration 0020: acknowledged_at backfill for historic completed/failed/interrupted runs (never abandoned), worktrees.size_bytes / size_measured_at, idx_agent_runs_fleet"
  - "query::fleet::fleet_rows, the literal-SQL cross-project read with the derived awaiting_review state"
  - "fleet_list Tauri command (no arguments, server-side cap of 200)"
  - "legend/runStatus.ts, the single run-status vocabulary and formatters"
  - "FleetSurface and useFleet, pushed into App.tsx below the session branch"
  - "open-fleet global action (Cmd+Shift+F) reachable from keystroke, palette and native menu"
affects: [10-02, 10-03, 10-04, 10-05, 10-06, 10-07, 10-08, 10-09]

actuals:
  tokens: 27673
  tasks: 3
  commits: 3
plan_head_before: 20d206f3932d2b55eb39b11b46adba1d21069d4b
commits: 3

tech-stack:
  added: []
  patterns:
    - "Derive, do not store: fleet_state is a CASE alias in one SELECT, no column"
    - "Banding and ordering in SQL (band, waiting time, id), the renderer only groups"
    - "One vocabulary module (legend/runStatus.ts) imported by every run-status surface"
    - "Fleet branch checked below activeAgentRunId so a session popped from the fleet lands on the fleet"

key-files:
  created:
    - packages/core/src/db/migrations/0020_fleet.sql
    - packages/core/src/query/fleet.rs
    - packages/core/tests/fleet_query.rs
    - packages/core/tests/fleet_perf.rs
    - packages/desktop/src-tauri/src/commands/fleet.rs
    - packages/desktop/src/legend/runStatus.ts
    - packages/desktop/src/fleet/FleetSurface.tsx
    - packages/desktop/src/fleet/useFleet.ts
    - packages/desktop/src/fleet/__tests__/fleet-surface.test.tsx
    - packages/desktop/src/state/__tests__/keyboard-fleet.test.ts
  modified:
    - packages/core/src/db/mod.rs
    - packages/core/src/query/mod.rs
    - packages/desktop/src-tauri/src/commands/mod.rs
    - packages/desktop/src-tauri/src/main.rs
    - packages/desktop/src-tauri/src/menu.rs
    - packages/desktop/src-tauri/src/state.rs
    - packages/desktop/src-tauri/capabilities/default.json
    - packages/desktop/src/adapters/tauri.ts
    - packages/desktop/src/item-detail/RunsSection.tsx
    - packages/desktop/src/session/SessionSurface.tsx
    - packages/desktop/src/state/uiStore.ts
    - packages/desktop/src/state/keyboard.ts
    - packages/desktop/src/App.tsx
    - packages/desktop/src/projects/ProjectRail.tsx
    - packages/desktop/src/projects/__tests__/project-rail.test.tsx
    - packages/desktop/src/state/__tests__/keyboard-agent.test.ts

key-decisions:
  - "Open-fleet accelerator is Cmd+Shift+F; the uniqueness test measured it free (Cmd+F is Search Board and differs by shift)"
  - "FleetSubjectKind: a task run is Task; no task with an authoring stage is Authoring; no task, no stage, an epic is Epic; nothing at all is Authoring and renders with no subject key"
  - "The ORDER BY sits in an outer select so it can name the fleet_state and blocked_since aliases instead of restating the CASE and the correlated subselect"
  - "The rail's Fleet entry is a new always-present All agents button; the Worktrees and Blocked rows stay read-only facts because their destinations are later plans"
  - "initialStatus on SessionSurface is a nullable caller-supplied value with running as the no-information fallback; the store plumbing that hands a status through is plan 10-06's"

patterns-established:
  - "Pitfall 1 closed by migration backfill and proven by an N-1 fixture carried through open_and_migrate"
  - "A type is declared once: other modules use import type { X } so the single-declaration grep stays honest"

requirements-completed: [FLEET-01, FLEET-04]

coverage:
  - id: D1
    description: "One view lists every agent run across every registered project in three fixed bands, longest-waiting first, with a deterministic id tie-break"
    requirement: FLEET-01
    verification:
      - kind: integration
        ref: "packages/core/tests/fleet_query.rs#bands_run_blocked_awaiting_review_abandoned_running_then_terminal"
        status: pass
      - kind: integration
        ref: "packages/core/tests/fleet_query.rs#rows_from_three_projects_interleave_by_waiting_time_not_by_project"
        status: pass
      - kind: integration
        ref: "packages/core/tests/fleet_query.rs#ties_on_band_and_waiting_time_order_by_id_and_repeat_identically"
        status: pass
      - kind: unit
        ref: "packages/desktop/src/fleet/__tests__/fleet-surface.test.tsx#renders the three band headers in the fixed order"
        status: pass
    human_judgment: false
  - id: D2
    description: "A first launch after migration 0020 shows only live and genuinely unacknowledged runs; a task with two unacknowledged terminal runs reads once; no-task runs are rows"
    requirement: FLEET-01
    verification:
      - kind: integration
        ref: "packages/core/tests/fleet_query.rs#migration_0020_backfills_history_so_first_launch_shows_only_live_and_abandoned_runs"
        status: pass
      - kind: integration
        ref: "packages/core/tests/fleet_perf.rs#five_hundred_backfilled_historic_runs_contribute_zero_rows"
        status: pass
      - kind: integration
        ref: "packages/core/tests/fleet_query.rs#a_task_with_two_unacknowledged_terminal_runs_reads_once_as_its_newest"
        status: pass
      - kind: integration
        ref: "packages/core/tests/fleet_query.rs#runs_with_no_task_are_first_class_rows"
        status: pass
    human_judgment: false
  - id: D3
    description: "Every run state renders a glyph plus a word from one vocabulary module; awaiting review reuses the In Review mark; interrupted is muted and sits in DONE / FAILED"
    requirement: FLEET-04
    verification:
      - kind: unit
        ref: "packages/desktop/src/fleet/__tests__/fleet-surface.test.tsx#renders one word beside its mark for each of the six states plus awaiting review"
        status: pass
      - kind: unit
        ref: "packages/desktop/src/fleet/__tests__/fleet-surface.test.tsx#puts interrupted under DONE / FAILED on the muted role, and abandoned under NEEDS YOU"
        status: pass
      - kind: unit
        ref: "packages/desktop/src/fleet/__tests__/fleet-surface.test.tsx#renders an abandoned run's word from the same map on both surfaces"
        status: pass
    human_judgment: false
  - id: D4
    description: "The fleet read stays inside the 50ms server-side budget at 5,000 agent_runs and uses idx_agent_runs_fleet"
    requirement: FLEET-01
    verification:
      - kind: integration
        ref: "packages/core/tests/fleet_perf.rs#the_fleet_read_at_5000_runs_is_under_budget_and_uses_the_index"
        status: pass
    human_judgment: false
  - id: D5
    description: "The fleet opens from the rail's Fleet row and one global binding, reachable identically from keystroke, palette and native menu, with the permission-card keys refused inside the fleet region"
    requirement: FLEET-01
    verification:
      - kind: unit
        ref: "packages/desktop/src/state/__tests__/keyboard-fleet.test.ts"
        status: pass
      - kind: unit
        ref: "packages/desktop/src/projects/__tests__/project-rail.test.tsx#renders the Fleet row as a button that opens the fleet surface"
        status: pass
    human_judgment: false
  - id: D6
    description: "How the fleet looks and reads at a glance in the running app (band header treatment, glyph and colour weight, row density)"
    verification: []
    human_judgment: true
    rationale: "Visual judgement of a rendered layout in the real WebView; no WebDriver for WKWebView. Queued per the human-verification deferral, not observed."

duration: 24min
completed: 2026-10-12
status: complete
---

# Phase 10 Plan 01: Fleet tracer Summary

**One cross-project literal-SQL read, one argument-free `fleet_list` command and one banded surface let you open every agent across every registered project, with a derived awaiting-review state, a single run-status vocabulary and a `Cmd+Shift+F` binding.**

## Performance

- **Duration:** 24 min
- **Started:** 2026-10-12T03:43:07Z
- **Completed:** 2026-10-12
- **Tasks:** 3
- **Files modified:** 26 (10 created, 16 modified)

## Accomplishments

- The fleet is end to end: migration 0020, `query::fleet::fleet_rows`, `fleet_list`, `fleetList()`, `useFleet`, `FleetSurface`, pushed into `App.tsx` below the session branch, opened from the project rail's new "All agents" button and from `Cmd+Shift+F`.
- First launch after the migration shows only live runs and genuinely unacknowledged ones: an N-1 fixture with 500 historic terminal runs returns exactly the live and abandoned rows, and the backfill leaves abandoned rows for the recovery surface.
- A task with two unacknowledged terminal runs reads once (its newest by `started_at DESC, id DESC`); abandoned appears whenever unacknowledged, matching `recovery.rs`.
- The run-status words, mark ids, colour roles, band mapping and the elapsed/count/cost formatters now exist only in `legend/runStatus.ts`; `RunsSection` and `SessionSurface` import them, and `SessionSurface` now types and renders `abandoned`.

## Task Commits

1. **Task 1: End-to-end "every agent, everywhere"** - `4bd8693` (feat)
2. **Task 2: Collapse the run-status vocabulary to one module** - `b9c7a4d` (refactor)
3. **Task 3: One global binding, plus the perf budget** - `0d34aed` (feat)

**Plan metadata:** committed with this SUMMARY (docs: complete plan)

## Choices recorded for later plans

- **Accelerator accepted for `open-fleet`:** `Cmd+Shift+F` (`CmdOrCtrl+Shift+F` on the View menu item). `keyboard-fleet.test.ts` asserts it is the only binding holding that combination in any region and that `Cmd+F` still resolves to Search Board.
- **Band headers, glyphs, colour tokens (Claude's discretion):** headers are plain `type-label` text, "NEEDS YOU", "RUNNING" and "DONE / FAILED", muted ink with a hairline under each, 28px tall; rows are 32px, a four-column grid (state mark plus word, project, subject, age) with hairline separators. Glyphs come from the existing registry only: `blocked-indicator`, `status-in-review` (awaiting review), `run-abandoned`, `run-running`, `run-completed`, `run-failed`, `run-interrupted`. Colour roles: running accent, blocked amber, completed success, failed and abandoned destructive, interrupted muted, awaiting review primary ink. No new token and no new mark.
- **Measured baseline for plan 10-03's activity cell:** `fleet_rows` at 5,000 `agent_runs` rows across four projects (debug build) took **4 ms** returning a full 200-row window, against a 50 ms budget. Query plan names **`idx_agent_runs_fleet`** (`MULTI-INDEX OR` over `status=?` and `status=? AND acknowledged_at=?`), with the per-task latest-run subselect on `idx_agent_runs_task_started` and the blocked-since subselect on `idx_permission_requests_run_status`. No `SCAN agent_runs` line.
- **Age column:** a blocked row counts from its oldest pending request, a finished or awaiting-review row from when it ended, anything else from when it started, via `formatAge` ("45s", "12m", "3h 5m", "2d").

## Decisions Made

See `key-decisions` above. The plan was followed as specified; the one interpretation call was the rail entry (a new button rather than converting the conditional Worktrees or Blocked rows, which can be absent).

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 3 - Blocking] Single-declaration grep required import form**
- **Found during:** Task 2
- **Issue:** `import { ..., type RunStatus }` in `RunsSection.tsx` and `SessionSurface.tsx` matched the plan's `grep -rl 'type RunStatus'` gate, which must find exactly one file.
- **Fix:** imported the type through a separate `import type { RunStatus } from "../legend/runStatus"` line in both files.
- **Files modified:** `item-detail/RunsSection.tsx`, `session/SessionSurface.tsx`
- **Commit:** `b9c7a4d`

**2. [Rule 1 - Bug] `in`-operator status guards accepted prototype keys**
- **Found during:** Task 2
- **Issue:** the lifted `isRunStatus` used `value in RUN_STATUS_LABELS`, which is true for `"constructor"` and `"toString"`.
- **Fix:** `isFleetState` uses `Object.prototype.hasOwnProperty.call`; `isRunStatus` builds on it and excludes `awaiting_review`.
- **Files modified:** `legend/runStatus.ts`
- **Commit:** `b9c7a4d`

**3. [Rule 3 - Blocking] `MenuHandles` and the menu bridge needed the new id**
- **Found during:** Task 3
- **Issue:** `commands/menu.rs`'s `menu_set_action_enabled` resolves ids through `MenuHandles::get`, so `useMenuLayerSync` pushing `open-fleet` would have been rejected as unrecognised. `state.rs` is in the plan; this confirms why it must carry the handle and its `get` arm, and its doc comments no longer say "five".
- **Files modified:** `state.rs`
- **Commit:** `0d34aed`

**Total deviations:** 3 auto-fixed (1 bug, 2 blocking). **Impact:** none on scope.

### Commit split note

The `open-fleet` edits to `main.rs` and `App.tsx` were made together with Task 1 and held back to keep the three task commits buildable on their own; Task 1's commit builds and tests green without them.

## Issues Encountered

None. `cargo build` reports one pre-existing `dead_code` warning on `StartRunOutcome` (`commands/agent_run.rs`), out of scope.

## Known Stubs

None. A fleet row has no click target, activity cell or spend cell by design in this plan (plans 10-03, 10-04, 10-06); the markup omits them rather than stubbing placeholder text.

## Threat Flags

None. The new surface is the plan's own register: `fleet_list` takes no arguments (T-10-01-02), `FLEET_SQL` is one literal bound through `params![]` with a grep gate for the interpolation macro (T-10-01-01), the window is clamped to 200 with an index and a 5,000-row budget test (T-10-01-03), the menu forwards only the action id (T-10-01-04), and the backfill excludes abandoned, grep-gated (T-10-01-05).

## Verification Run

- `cargo build --workspace`: clean.
- `cargo test -p core --test fleet_query --test fleet_perf --test migration_safety --test recovery_summary --test perf_seed_1000`: 12 + 2 + 6 + 7 + 3 passed.
- `cargo test -p desktop`: 105 passed.
- `npm --prefix packages/desktop test`: 77 files, 1,325 tests passed, no existing expectation edited.
- `npm --prefix packages/desktop run build`: clean.
- All the plan's grep gates pass (migration registered once, exactly two `ALTER TABLE`, no `abandoned` outside comments, no interpolation macro in `fleet.rs`, `fleet_list` once in `main.rs` and `default.json`, one `type RunStatus` file, one `formatCostUsd`, `marks.ts` untouched, `open-fleet` once in `main.rs`).
- The migration's backfill was mutation-checked: disabling the UPDATE makes `five_hundred_backfilled_historic_runs_contribute_zero_rows` fail.

## Deferred review

D6 above (visual judgement of the rendered fleet) is queued, not observed. It belongs in `.planning/DEFERRED-REVIEW.md` with `automatable: NO`, the physical reason being no WebDriver for WKWebView.

## Next Phase Readiness

Plan 10-02 can add the row click target and the activity cell on `FleetRowView`; `FleetBand` already groups consecutive rows and `legend/runStatus.ts` already exports `formatAge`, `bandForState` and `FLEET_BANDS`. Plan 10-06 owns handing `initialStatus` from a fleet row through the store to `SessionSurface`.

## Self-Check: PASSED

All ten created files exist on disk and commits `4bd8693`, `b9c7a4d` and `0d34aed` resolve.
