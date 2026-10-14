---
phase: 09-planned-fan-out-that-does-not-collide
plan: 04
subsystem: dispatcher
tags: [settings, parallel-cap, occupancy, tauri-command, react-select]

requires:
  - phase: 09-planned-fan-out-that-does-not-collide
    provides: "plan 09-03: dispatch::occupied_slots (database-counted running + blocked runs); plan 09-01: the command roster and capability description convention"
provides:
  - "domain/settings.rs: dispatch_max_parallel / set_dispatch_max_parallel, default 3, closed range 1-8, malformed storage degrades to the default"
  - "settings_set_dispatch_max_parallel (human-only Tauri command) and DispatchCapDto on settings_get"
  - "Settings 'Parallel Agents' section: native select over 1-8 with the live occupied-slot count"
affects: [09-05 limit gate, 09-07 dispatcher tick (reads the cap), 09-09 UI]

plan_head_before: 7d3e59254b732d8f336c93f61264d39d8774aa69

actuals:
  tokens: 9713
  tasks: 2
  commits: 4

tech-stack:
  added: []
  patterns:
    - "A global setting stores in the settings table with no events row; settings.updated_by/updated_at are its audit record"
    - "A TEXT setting with no CHECK is read defensively: parse, range-filter, fall back to the default, never propagate"
    - "A closed small range is a native select, so an out-of-range value is unreachable rather than rejected"

key-files:
  created:
    - packages/core/tests/dispatch_cap.rs
    - packages/desktop/src/settings/__tests__/parallel-cap.test.tsx
  modified:
    - packages/core/src/domain/settings.rs
    - packages/desktop/src-tauri/src/commands/settings.rs
    - packages/desktop/src-tauri/src/main.rs
    - packages/desktop/src-tauri/capabilities/default.json
    - packages/desktop/src/adapters/tauri.ts
    - packages/desktop/src/settings/SettingsSurface.tsx
    - packages/desktop/src/settings/__tests__/settings-surface.test.tsx
    - packages/desktop/src/settings/__tests__/browser/admin-group.browser.test.tsx

key-decisions:
  - "The ceiling of 8 is a judgement anchored to a measurement of a different configuration, not a measurement of this one: the public report saw 8 of 13 agents fail at 13-way parallelism with no spawn staggering, while this project staggers spawns (400 ms floor) and retries lock contention. 8 is one constant (DISPATCH_MAX_PARALLEL_MAX) for the owner to change."
  - "The cap gates the dispatcher's own spawns only. agent_run_start does not consult it (grep gate), so a user's own launch is never refused and may push the live count above the cap by one."
  - "settings_get carries the cap as a nested dispatchCap { maxParallel, occupiedSlots } so Settings shows 'N of M slots in use' from one read."
  - "The set command returns the new DispatchCapDto; the control is controlled by the stored value, so a refused set snaps back with no local draft state."

patterns-established:
  - "Tauri invoke rejects with a bare string: the control's error text accepts string or Error"

requirements-completed: [PLAN-06]

coverage:
  - id: D1
    description: "The cap defaults to 3, accepts 1 and 8, refuses 0 and 9 with both bounds named and nothing stored, and a malformed or out-of-range stored value reads back as 3"
    requirement: PLAN-06
    verification:
      - kind: integration
        ref: "packages/core/tests/dispatch_cap.rs (8 tests)"
        status: pass
      - kind: unit
        ref: "packages/desktop/src-tauri/src/commands/settings.rs#the_handler_refuses_zero_and_nine_naming_both_bounds_and_accepts_one_and_eight"
        status: pass
    human_judgment: false
  - id: D2
    description: "Setting the cap writes one settings row and no events row"
    requirement: PLAN-06
    verification:
      - kind: integration
        ref: "packages/core/tests/dispatch_cap.rs#setting_the_cap_writes_one_settings_row_and_no_event"
        status: pass
    human_judgment: false
  - id: D3
    description: "Occupancy counts running and blocked runs across projects and run kinds (including authoring), excludes completed/failed/interrupted/abandoned, and survives reopening the connection"
    requirement: PLAN-06
    verification:
      - kind: integration
        ref: "packages/core/tests/dispatch_cap.rs#occupancy_counts_running_and_blocked_runs_of_every_kind_across_projects_and_only_those"
        status: pass
    human_judgment: false
  - id: D4
    description: "The Settings control renders the stored cap, offers exactly 1-8, issues one set call, shows occupancy, and snaps back with the error text on a refusal"
    requirement: PLAN-06
    verification:
      - kind: unit
        ref: "packages/desktop/src/settings/__tests__/parallel-cap.test.tsx (5 tests)"
        status: pass
    human_judgment: false
  - id: D5
    description: "A user-initiated launch is never refused by the cap"
    requirement: PLAN-06
    verification:
      - kind: command
        ref: "grep gate: agent_run.rs contains no domain::settings::dispatch_max_parallel reference (0)"
        status: pass
    human_judgment: false

duration: 20min
completed: 2026-10-09
status: complete
---

# Phase 9 Plan 04: One Global Parallel Cap, Counted From the Database Summary

**`dispatch_max_parallel` (default 3, closed range 1 to 8, malformed storage degrades to 3) with a human-only set command, occupancy reported beside it from `occupied_slots`, and a Settings select that cannot leave the range.**

## What the guarantee is, and what it is not

The cap is stored, validated and shown. **Nothing reads it to gate a spawn yet:** the dispatcher tick that compares `occupied_slots` to the cap is plan 09-07. ROADMAP criterion 4's user half ("the user caps global parallel width, and the number the dispatcher will read is the number they set") is met; its "the planner never exceeds it" half is not demonstrable until 09-07.

**The ceiling of 8 is a judgement, not a measurement.** It is anchored to a public measurement of a different configuration (8 of 13 agents failed at 13-way parallelism with no spawn staggering). This project staggers spawns and retries lock contention, so git contention is the least binding constraint here; the account's session limits and the user's review bandwidth are the binding ones. T-09-04-03 (a cap at its ceiling exhausting the account's limit) is transferred to plan 09-05's limit gate.

## Accomplishments

- `dispatch_max_parallel` falls back to 3 for an absent, non-numeric, negative, fractional, padded, overflowing or out-of-range row (nine malformed shapes tested) and never errors, so a bad row cannot panic the Settings read or a dispatcher tick.
- `set_dispatch_max_parallel` refuses 0 and 9 naming both bounds, validated in the handler first and again in core; it writes one `settings` row and zero `events` rows.
- `settings_set_dispatch_max_parallel` takes only an integer (no actor), resolves the actor server-side, is registered once in `generate_handler!` and listed in the audited capability roster with the "gates the dispatcher only" statement.
- `settings_get` now carries `dispatchCap { maxParallel, occupiedSlots }`.
- The Settings "Parallel Agents" section: native select over 1 to 8 (0 and 9 unreachable), "N of M slots in use" beside it, error text shown and value snapped back on a refusal.

## Task Commits

1. **Task 1 RED: failing tests for the global cap and occupancy** - `f41c321` (test)
2. **Task 1 GREEN: cap, command, roster** - `4d79480` (feat)
3. **Task 2 RED: failing tests for the Settings control** - `736314e` (test)
4. **Task 2 GREEN: the Settings control** - `ae7d7e2` (feat)

**Plan metadata:** the `docs(09-04)` commit following this file.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 3 - Blocking] Existing settings fixtures lacked the new required `dispatchCap` field**
- **Found during:** Task 2
- **Issue:** `SettingsDto.dispatchCap` is required, so `settings-surface.test.tsx`'s `settingsFixture` and the inline `getSettings` mock in `admin-group.browser.test.tsx` no longer matched the payload shape and would crash the new section.
- **Fix:** each fixture gained `dispatchCap: { maxParallel: 3, occupiedSlots: 0 }`. No existing assertion changed; all 63 settings tests and the full desktop suite (1234) pass.
- **Files modified:** the two test files above
- **Committed in:** `ae7d7e2`

**2. [Process] Test fixture used a non-actor `updated_by`**
- **Found during:** Task 1 GREEN: the hand-written raw settings row violated the `settings.updated_by` actor foreign key; the fixture now uses the seeded human actor. Fixed before the GREEN commit, in the same test file.

**Total deviations:** 2 (1 blocking, 1 process). **Impact:** none on scope.

## Authentication Gates

None.

## Issues Encountered

- `cargo test -p core --test credentials` was not run: it hangs on macOS keychain prompts on this machine (pre-existing, recorded in 09-01 and 09-02). `activity_trail` (5) was run and passes. This plan changes nothing the credentials suite exercises beyond adding a sibling key in the same module.
- The full `cargo test --workspace` was not run (same keychain hang). Run: `dispatch_cap` (8), `activity_trail` (5), `cargo test -p desktop settings` (2), `cargo build --workspace` (clean, one pre-existing `desktop` warning), `tsc` clean, `vite build` clean, full desktop `vitest` (1234).
- Not exercised: the Settings control against a real Tauri webview. The behavior is covered by jsdom tests with the adapter mocked; no human-only criterion was deferred, and none is added to `DEFERRED-REVIEW.md`.

## Known Stubs

None.

## Threat Flags

None. The one new command is registered, human-only, takes a bounded integer and is covered by T-09-04-01 through T-09-04-05.

## Next Phase Readiness

- Plan 09-07's dispatcher tick reads `dispatch_max_parallel(conn)` and `occupied_slots(conn)` and spawns nothing while `occupied >= cap`; a user launch above the cap is already possible by construction.
- Plan 09-05 owns the account-limit pause that T-09-04-03 transfers to.

## Self-Check: PASSED

Created files `packages/core/tests/dispatch_cap.rs` and `packages/desktop/src/settings/__tests__/parallel-cap.test.tsx` verified present. Commits `f41c321`, `4d79480`, `736314e`, `ae7d7e2` verified in `git log`; each RED precedes its GREEN. Every `<automated>` verify command was run except the keychain-bound `credentials` binary (see Issues Encountered); the three grep gates pass.
