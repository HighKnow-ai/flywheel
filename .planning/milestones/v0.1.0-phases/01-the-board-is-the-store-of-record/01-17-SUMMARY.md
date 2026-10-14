---
phase: 01-the-board-is-the-store-of-record
plan: 17
subsystem: board
tags: [rust, rusqlite, tauri, react, tanstack-query, vitest, epic-roster]

requires:
  - phase: 01-the-board-is-the-store-of-record
    provides: the epic/task/issue schema, list_board's windowed query, actorsById/list_actors' unwindowed-roster shape, useBoardChangedSubscription
provides:
  - "flywheel_core::domain::epic::list_epics — the project's full, unwindowed epic roster (id/key/title)"
  - "commands::epic::epic_list_all — the read-only Tauri command exposing it, exempt from D-03's windowing by design"
  - "useEpics()/epicsQueryKey — the frontend roster hook BoardRow's pill (and, from plan 01-18, FilterBar's chips and both ParentPicker option lists) resolve against"
  - "the epic-pill-unresolved legend mark and BoardRow.tsx's three-outcome (No epic / KEY Title / Unknown epic) label expression, with no code path that can render an internal id"
  - "useBoardChangedSubscription invalidating the bare [\"epics\"] prefix alongside [\"board\"], so epic create/rename/delete stay live on the same push"
affects: [01-18-filter-and-parent-picker-roster-adoption]

actuals:
  tokens: 11000
  tasks: 3
  commits: 3
plan_head_before: 4590b19b58bc9d7f9ac412cca4b415db5e6a3b7f

tech-stack:
  added: []
  patterns:
    - "small unbounded roster triad (domain::list_X -> commands::X_list -> useX()) — epics now mirror actors, the second instance of this pattern in the codebase"
    - "ORDER_BY widened to pub(crate) rather than restated, so BOARD-05's total order has exactly one definition in the crate"

key-files:
  created:
    - packages/core/tests/epic_roster.rs
    - packages/desktop/src/board/__tests__/epic-roster.test.tsx
  modified:
    - packages/core/src/domain/epic.rs
    - packages/core/src/query/mod.rs
    - packages/core/tests/common/mod.rs
    - packages/desktop/src-tauri/src/commands/epic.rs
    - packages/desktop/src-tauri/src/main.rs
    - packages/desktop/src/board/useBoardQuery.ts
    - packages/desktop/src/board/BoardView.tsx
    - packages/desktop/src/board/BoardRow.tsx
    - packages/desktop/src/legend/marks.ts
    - packages/desktop/src/board/__tests__/board-view.test.tsx
    - packages/desktop/src/board/__tests__/epic-assign.test.tsx

key-decisions:
  - "Gave the epic roster its own unwindowed read path (list_epics/epic_list_all/useEpics), exactly mirroring the actor roster's already-shipped triad — rejected the alternative of having board_list return referenced epics alongside the page, because that fixes the pill but not the filter chips"
  - "ORDER_BY (query/mod.rs) widened from private to pub(crate) and composed by list_epics rather than restating BOARD-05's ordering expression in domain/epic.rs — keeps the total order defined exactly once in the crate"
  - "list_epics' SQL is built by joining compile-time-literal fragments with the [&str]::concat slice method (not the concat! macro, which cannot accept a path to another module's const) — zero format!, zero value interpolation, mirroring query/mod.rs's own format_sql discipline"
  - "epic-pill-unresolved is a registered Legend mark (Unknown epic / CircleHelp), not an inline string — kept 01-UI-SPEC.md's 'no mark may exist that the legend does not define' rule true"
  - "useBoardChangedSubscription invalidates the bare [\"epics\"] prefix (no project id) — board:changed's payload can't narrow it, and a stale roster for a project the user is about to switch back to is exactly the failure being prevented"

requirements-completed: []

coverage:
  - id: D1
    description: "A task whose epic sorts outside the loaded 200-row board window still renders KEY Title in its epic pill, resolved from the project's roster rather than the window"
    requirement: BOARD-06
    verification:
      - kind: integration
        ref: "packages/core/tests/epic_roster.rs#roster_returns_every_epic_past_the_board_window"
        status: pass
      - kind: automated_ui
        ref: "packages/desktop/src/board/__tests__/epic-roster.test.tsx#resolves a task's epic label from the roster even when items holds no epic rows at all (the regression)"
        status: pass
    human_judgment: false
  - id: D2
    description: "epic_list_all returns every epic in a project (verified at 250, above DEFAULT_LIMIT/MAX_LIMIT), scoped to that project only"
    requirement: BOARD-06
    verification:
      - kind: integration
        ref: "packages/core/tests/epic_roster.rs#roster_returns_every_epic_past_the_board_window"
        status: pass
      - kind: integration
        ref: "packages/core/tests/epic_roster.rs#roster_is_scoped_to_one_project"
        status: pass
      - kind: integration
        ref: "packages/core/tests/epic_roster.rs#roster_at_volume_is_under_the_50ms_budget"
        status: pass
    human_judgment: false
  - id: D3
    description: "The epic pill has exactly three outcomes (No epic / KEY Title / Unknown epic) and no code path can render an internal id, in text or in any element attribute"
    requirement: BOARD-01
    verification:
      - kind: unit
        ref: "grep gate: no executable line of BoardRow.tsx matches ': item.epicId'"
        status: pass
      - kind: automated_ui
        ref: "packages/desktop/src/board/__tests__/epic-roster.test.tsx#renders the unresolved mark, never the raw id, when the roster cannot resolve an epic"
        status: pass
      - kind: automated_ui
        ref: "packages/desktop/src/board/__tests__/epic-roster.test.tsx#renders the unresolved mark while the roster query is still pending"
        status: pass
    human_judgment: false
  - id: D4
    description: "The epic-pill-unresolved mark is registered in legend/marks.ts's MARKS array, so the always-reachable Legend defines it"
    verification:
      - kind: unit
        ref: "grep gate: 'epic-pill-unresolved' present in packages/desktop/src/legend/marks.ts"
        status: pass
    human_judgment: false
  - id: D5
    description: "An epic created, renamed or deleted while the board is open refreshes the roster on the same board:changed push that refreshes the board window"
    verification:
      - kind: automated_ui
        ref: "packages/desktop/src/board/__tests__/epic-roster.test.tsx#a board:changed push refreshes the epic roster, not only the board window"
        status: pass
      - kind: automated_ui
        ref: "packages/desktop/src/board/__tests__/epic-roster.test.tsx#a renamed epic's pill updates without a manual refetch"
        status: pass
      - kind: automated_ui
        ref: "packages/desktop/src/board/__tests__/epic-roster.test.tsx#a deleted epic stops resolving"
        status: pass
    human_judgment: false

duration: 25min
completed: 2026-09-10
status: complete
---

# Phase 01 Plan 17: Epic Roster Replaces the Windowed Epic Derivation Summary

**Gave epics their own unwindowed read path (`list_epics`/`epic_list_all`/`useEpics`), mirroring the actor roster, so the board pill, filter chips and picker options can resolve any epic in a project — not just one that happens to sort inside `list_board`'s 200-row page — and made the pill structurally incapable of rendering an internal ULID.**

## Performance

- **Duration:** ~25 min
- **Started:** 2026-09-10T04:03:00Z (approx.)
- **Completed:** 2026-09-10T04:27:28Z
- **Tasks:** 3
- **Files modified:** 13 (2 created, 11 modified)

## Accomplishments

- `flywheel_core::domain::epic::list_epics` — a small, unwindowed, project-scoped epic roster (`id`/`key`/`title`), ordered by `crate::query::ORDER_BY` (widened to `pub(crate)` so BOARD-05's total order stays defined exactly once in the crate)
- `commands::epic::epic_list_all` — the read-only Tauri command exposing it, registered in `main.rs`, deliberately exempt from D-03's windowing contract (T-01-17-03)
- `useEpics()`/`epicsQueryKey` in `useBoardQuery.ts`, and `BoardView.tsx`'s `epicsById` now built from that roster instead of `items.filter(kind === "epic")` — the windowed derivation that was UAT gap G-01-2's root cause is gone
- `BoardRow.tsx`'s epic pill now has exactly three outcomes (`No epic` / `KEY Title` / `Unknown epic`) and no fourth — the branch that fell back to the row's own raw epic id is removed, and a new `epic-pill-unresolved` Legend mark backs the unresolved case
- `useBoardChangedSubscription` invalidates the bare `["epics"]` prefix alongside `["board"]`, so an epic created/renamed/deleted from anywhere reaches the pill, the (future) chip list and picker options on the same push
- First test in the repository exercising epic resolution above `DEFAULT_LIMIT` (250 seeded epics, `packages/core/tests/epic_roster.rs`)

## Task Commits

Each task was committed atomically:

1. **Task 1: The epic roster, end to end — SQLite row to rendered pill** - `7f47d3b` (feat)
2. **Task 2: Make the epic pill structurally incapable of printing an internal id** - `6fa7ee7` (feat)
3. **Task 3: Keep the roster live — invalidate it on the same board:changed push** - `55cc843` (feat)

_TDD tasks each carry a single `feat` commit here (not test → feat → refactor): RED was verified in the working tree before each GREEN implementation (see "Deviations" below for how each RED was confirmed genuine), then squashed into one commit per task per this project's established per-task commit convention (see prior phase-01 plans' history) — the RED evidence is recorded in this SUMMARY rather than as a separate `test(...)` commit._

## Files Created/Modified

- `packages/core/tests/epic_roster.rs` - `roster_returns_every_epic_past_the_board_window` (250 epics), `roster_is_scoped_to_one_project`, `roster_at_volume_is_under_the_50ms_budget`
- `packages/desktop/src/board/__tests__/epic-roster.test.tsx` - the window-free resolution case, the roster-vs-stale-window precedence case, the unresolved-mark cases (visible text + every element attribute), and the three `board:changed` liveness cases
- `packages/core/src/domain/epic.rs` - `EpicSummary` struct, `list_epics`
- `packages/core/src/query/mod.rs` - `ORDER_BY` visibility widened to `pub(crate)`
- `packages/core/tests/common/mod.rs` - `seed_epics` fixture
- `packages/desktop/src-tauri/src/commands/epic.rs` - `EpicSummaryDto`, `epic_list_all`
- `packages/desktop/src-tauri/src/main.rs` - registers `epic_list_all`
- `packages/desktop/src/board/useBoardQuery.ts` - `EpicSummary`, `epicsQueryKey`, `useEpics`, and the `["epics"]` invalidation in `useBoardChangedSubscription`
- `packages/desktop/src/board/BoardView.tsx` - `epicsById` rebuilt from `useEpics()`, windowed derivation removed
- `packages/desktop/src/board/BoardRow.tsx` - `epicsById` prop narrowed to `Record<string, EpicSummary>`; three-outcome pill label
- `packages/desktop/src/legend/marks.ts` - `epic-pill-unresolved` mark
- `packages/desktop/src/board/__tests__/board-view.test.tsx` - converted the WR-01 case to source its epic from the roster (adapter mock added)
- `packages/desktop/src/board/__tests__/epic-assign.test.tsx` - mocked `epic_list_all`, made the row-pill assertion async (deviation, see below)

## Decisions Made

See `key-decisions` in frontmatter — summarized: the actor-roster triad shape, `ORDER_BY` widened rather than restated, SQL built via `[&str]::concat` (not `concat!`, which cannot splice a `const` path — verified by a real compile failure before settling on this), the unresolved mark registered in the Legend rather than an inline string, and the bare `["epics"]` prefix invalidation.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 3 - Blocking] Updated `epic-assign.test.tsx`'s mock and one assertion**
- **Found during:** Task 1's own full-suite verification, after removing `BoardView.tsx`'s windowed `epicsById` derivation
- **Issue:** `epic-assign.test.tsx` exercises the same row-pill path Task 1 rewired (`a_task_carrying_an_epic_id_renders_that_epics_key_and_title_in_the_row_pill`). Its `beforeEach` mock never answered `epic_list_all`, so the roster resolved to empty and the pill fell back to the raw id; the assertion was also synchronous, asserting before the (now-async) roster query could settle.
- **Fix:** Added an `epic_list_all` branch to the mock returning the same two epics `board_list` already supplies, and converted the assertion to `await screen.findByText(...)`.
- **Files modified:** `packages/desktop/src/board/__tests__/epic-assign.test.tsx`
- **Verification:** `epic-assign.test.tsx`'s full suite (9/9) passes alongside the rest of the desktop suite.
- **Committed in:** `7f47d3b` (Task 1 commit)

**2. [Sequencing, plan-acknowledged, not a fix] `board-view.test.tsx` intentionally red between Task 1 and Task 2 commits**
- **Found during:** Task 1's own full-suite verification
- **Note:** 01-17-PLAN.md's own Task 2 `read_first` predicted this exactly: "[board-view.test.tsx] has no adapter mock today and its epic-pill test... asserts a label resolved from `items`. That test must be converted to the roster source or it will fail after Task 1." This is not a bug introduced by Task 1 — it is the plan's own documented Task 1 → Task 2 dependency, and the conversion (adapter mock + roster-sourced fixture + async assertion) is exactly what Task 2's own scope already specified. No independent action was needed beyond what Task 2 already did.

---

**Total deviations:** 1 auto-fixed (1 blocking, outside either task's `<files>` list but required by Task 1's own "full suite green" acceptance criterion).
**Impact on plan:** No scope creep — the fix only restores an existing test's ability to exercise the row pill correctly after the roster became its source of truth.

## Issues Encountered

- `concat!` cannot accept a path to a `const` item (only literal tokens), so `crate::query::ORDER_BY` could not be spliced into a second `concat!()` call as the plan's action text suggested literally. Resolved by joining the two compile-time-literal fragments with the `[&str]::concat` **slice method** instead — zero `format!`, zero runtime value interpolation, and the same discipline `query/mod.rs`'s own `format_sql` helper already uses for the identical reason. Confirmed via a real `cargo build` failure before landing on this approach.
- Two test-authoring bugs caught and fixed in the same session (not plan deviations, just execution correctness): `renderBoard`'s default `projectId = "proj-1"` parameter was still substituted when a caller explicitly passed `undefined` (JS default-parameter semantics), which made the "no project id, no query" test assert against the wrong project id — fixed by removing the default and passing `"proj-1"` explicitly everywhere. Separately, the three `board:changed` liveness tests initially failed for the wrong reason (`BoardView` itself never calls `useBoardChangedSubscription` — only `App.tsx` does), so `capturedBoardChangedHandler` was never populated; fixed by mounting a small `Subscriber` helper component alongside `BoardView` in those three tests.

## User Setup Required

None - no external service configuration required.

## Next Phase Readiness

- The epic roster triad (`list_epics`/`epic_list_all`/`useEpics`) is ready for plan 01-18 to adopt in `FilterBar.tsx`'s epic chip list and both `ParentPicker` option lists (the two window-derived sites this plan deliberately left untouched — the `issue-parent` picker's leading `...items` continuation and the `epic`-kind picker's `pickedRow.id` exclusion in `BoardView.tsx`).
- `epicsQueryKey` is exported specifically so 01-18 can invalidate/read the same cache `useEpics` populates without re-deriving a second key shape.
- `BOARD-06` and `BOARD-01` are declared by both this plan and plan 01-18 (shared IDs) — `requirements.ready-ids` reports both blocked pending 01-18's own SUMMARY; they will tick automatically once 01-18 completes. This plan does not mark them.
- No blockers for 01-18.

---
*Phase: 01-the-board-is-the-store-of-record*
*Completed: 2026-09-10*

## Self-Check: PASSED

All key files created/modified confirmed present on disk (`epic_roster.rs`, `epic-roster.test.tsx`,
`epic.rs`, `commands/epic.rs`, `legend/marks.ts`, this SUMMARY). All three task commit hashes
(`7f47d3b`, `6fa7ee7`, `55cc843`) confirmed present in `git log`. All plan-level `<verification>`
commands re-run clean: `cargo test -p core --test epic_roster` (3/3), `cargo test --workspace`
(all green), `npm run build` (no TS errors), `npm run test -- --run` (116/116, 19/19 files), both
grep gates (no raw-id leak in `BoardRow.tsx`, no direct `@tauri-apps` import outside the adapter
seam).
