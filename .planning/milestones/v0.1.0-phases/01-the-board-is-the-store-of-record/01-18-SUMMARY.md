---
phase: 01-the-board-is-the-store-of-record
plan: 18
subsystem: board
tags: [react, tanstack-query, rust, rusqlite, vitest, epic-roster, filter, picker]

requires:
  - phase: 01-the-board-is-the-store-of-record
    provides: "the epic roster triad (list_epics/epic_list_all/useEpics/epicsQueryKey) plan 01-17 built, and BoardRow's roster-sourced epic pill"
provides:
  - "packages/desktop/src/board/FilterBar.tsx — FilterBarProps.projectId (replaces FilterBarProps.items), epic chips sourced from useEpics, no client-side access to the loaded window at all"
  - "packages/desktop/src/board/BoardView.tsx — parentsById's epic half, the Set epic picker's options, and the Set parent picker's Epics group all resolve against the project's full epic roster instead of the loaded window"
  - "packages/core/tests/epic_roster.rs — the roster's total-order, tie-break, idempotency, empty-project and non-ASCII-encoding contract, pinned against an explicitly written expected sequence"
  - "01-UI-SPEC.md — the Unknown epic copy, the epic pill's three-outcome contract, and the project-wide (not window-wide) epic filter coverage, recorded rather than left undocumented"
affects: []

actuals:
  tokens: 11100
  tasks: 3
  commits: 3
plan_head_before: f2503ea437cc10a06bd155d33799c94d9a9470c7

tech-stack:
  added: []
  patterns:
    - "picker option lists and chip rows resolve labels from a project-scoped roster query, never from the windowed board page — the same pattern BoardRow's epic pill established in plan 01-17, now extended to every remaining epic-label surface"
    - "roster-membership-first kind resolution: an id is treated as an epic if it is present in the roster, falling back to the windowed items lookup only for tasks (the unbounded set D-03's windowing exists for)"

key-files:
  created: []
  modified:
    - packages/desktop/src/board/FilterBar.tsx
    - packages/desktop/src/App.tsx
    - packages/desktop/src/board/BoardView.tsx
    - packages/desktop/src/board/__tests__/filter.test.tsx
    - packages/desktop/src/board/__tests__/layer-guard.test.tsx
    - packages/desktop/src/board/__tests__/epic-assign.test.tsx
    - packages/desktop/src/board/__tests__/issue-parent.test.tsx
    - packages/desktop/src/board/__tests__/epic-roster.test.tsx
    - packages/core/tests/epic_roster.rs
    - .planning/phases/01-the-board-is-the-store-of-record/01-UI-SPEC.md

key-decisions:
  - "FilterBar loses its items prop entirely rather than merely ignoring it — the windowed derivation is structurally unavailable (tsc-enforced), not just unused, per the plan's own design-decision note"
  - "parentsById's epic half is the roster merged over the windowed items (roster wins on collision); the task half stays windowed, deliberately — tasks are the unbounded set D-03's windowing exists for, and this is accepted debt recorded in 01-17's assumption-delta, not an oversight"
  - "issue-parent's onSelect decides a chosen id's parent kind by testing roster membership FIRST, falling back to the windowed items lookup only for a miss — this is what lets an out-of-window epic reparent correctly instead of being silently misfiled as a task"
  - "epic_roster.rs's five new tests each write raw INSERT statements (a new insert_epic_with test helper) rather than using create_epic, because create_epic has no way to express an explicit (status, priority, rank) tuple or a deliberate tie — the ordering/tie-break contract cannot be tested through the domain API alone"
  - "roster_order_is_the_board_total_order asserts an explicitly hand-computed expected sequence, never one produced by re-running list_epics' own ORDER_BY comparator — a test that reused the implementation's sort would prove nothing"

requirements-completed: [BOARD-06, BOARD-01]

coverage:
  - id: D1
    description: "The FilterBar epic chip row lists every epic in the project (13 on a real board), not only the epics present in the currently loaded window, and survives a composed filter that empties the window"
    requirement: BOARD-06
    verification:
      - kind: unit
        ref: "packages/desktop/src/board/__tests__/epic-roster.test.tsx#FilterBar epic chips (01-18-PLAN.md Task 1, G-01-2) > lists every epic in the project, not only those in the loaded window"
        status: pass
      - kind: unit
        ref: "packages/desktop/src/board/__tests__/epic-roster.test.tsx#FilterBar epic chips (01-18-PLAN.md Task 1, G-01-2) > renders the chips in the roster's order"
        status: pass
      - kind: manual_procedural
        ref: "Task 3 human-check step 3, real THRE dogfooding project: THRE-17 chip stayed present after composing it with an In Review status filter that returned zero matching rows"
        status: pass
    human_judgment: false
  - id: D2
    description: "FilterBar can no longer read the loaded window at all — the items prop is removed from FilterBarProps and replaced by projectId"
    requirement: BOARD-06
    verification:
      - kind: other
        ref: "grep gate: grep -rn '<FilterBar' packages/desktop/src | grep -c 'items=' = 0 (was 4 at HEAD)"
        status: pass
      - kind: other
        ref: "npm --prefix packages/desktop run build (tsc) — no call site can pass the removed prop"
        status: pass
    human_judgment: false
  - id: D3
    description: "The Set epic picker and the Set parent picker's Epics group both offer every epic in the project, excluding the picked row itself where applicable, regardless of which epics are in the loaded window"
    requirement: BOARD-01
    verification:
      - kind: unit
        ref: "packages/desktop/src/board/__tests__/epic-roster.test.tsx#offers an epic that is not in the loaded window as a Set epic option"
        status: pass
      - kind: unit
        ref: "packages/desktop/src/board/__tests__/epic-roster.test.tsx#never offers the picked row as its own epic"
        status: pass
      - kind: unit
        ref: "packages/desktop/src/board/__tests__/epic-roster.test.tsx#offers an out-of-window epic in the Set parent picker's Epics group"
        status: pass
      - kind: manual_procedural
        ref: "Task 3 human-check steps 4 and 5, real THRE dogfooding project: Set epic picker offered all 13 epics for an out-of-window-epic task, and a newly quick-added epic appeared in both the chip row and the picker without reloading"
        status: pass
    human_judgment: false
  - id: D4
    description: "An issue whose parent epic sits outside the loaded window renders that epic's KEY Title on its parent button instead of No parent"
    requirement: BOARD-01
    verification:
      - kind: unit
        ref: "packages/desktop/src/board/__tests__/epic-roster.test.tsx#resolves an issue's out-of-window parent epic on its lane button"
        status: pass
    human_judgment: false
  - id: D5
    description: "The roster's order is total, specified and asserted against an explicit expected sequence; equal-ranking epics survive as separate adjacent entries at both small and above-DEFAULT_LIMIT volume; the read writes nothing; an empty project is a valid empty roster; a non-ASCII/combining-mark title round-trips byte-identically"
    requirement: BOARD-06
    verification:
      - kind: integration
        ref: "packages/core/tests/epic_roster.rs#roster_order_is_the_board_total_order"
        status: pass
      - kind: integration
        ref: "packages/core/tests/epic_roster.rs#roster_tie_breaks_equal_ranks_by_id_and_drops_neither"
        status: pass
      - kind: integration
        ref: "packages/core/tests/epic_roster.rs#roster_repeats_exactly_and_writes_nothing"
        status: pass
      - kind: integration
        ref: "packages/core/tests/epic_roster.rs#roster_is_empty_for_a_project_with_no_epics"
        status: pass
      - kind: integration
        ref: "packages/core/tests/epic_roster.rs#roster_returns_non_ascii_titles_unchanged"
        status: pass
    human_judgment: false
  - id: D6
    description: "The Unknown epic copy, the epic pill's three-outcome contract, and the project-wide epic filter coverage are recorded in 01-UI-SPEC.md, attributed to plan 01-18 (G-01-2)"
    verification:
      - kind: other
        ref: "grep gate: grep -c 'Unknown epic' 01-UI-SPEC.md >= 2"
        status: pass
    human_judgment: false

duration: 30min
completed: 2026-09-10
status: complete
---

# Phase 01 Plan 18: Epic Filter and Picker Roster Adoption Summary

**Removed the windowed epic derivation from the three sites plan 01-17 left standing — `FilterBar`'s chip row, the `Set epic` picker, and the `Set parent` picker's Epics group — closing UAT gap G-01-2 end to end and proving the roster's ordering/tie-break/idempotency/encoding contract in Rust.**

## Performance

- **Duration:** ~30 min (includes a live `tauri dev` GUI verification pass against the real 917-task/13-epic dogfooding project)
- **Started:** 2026-09-10T04:29:00Z (approx.)
- **Completed:** 2026-09-10T04:52:00Z (approx.)
- **Tasks:** 3
- **Files modified:** 10 (9 code, 1 planning artifact)

## Accomplishments

- `FilterBar.tsx`'s `epicOptions` now derives from `useEpics(projectId)` instead of filtering the loaded window's `items` for `kind === "epic"` — the chip row is a property of the project, not of the scroll position or of any other active filter. `FilterBarProps.items` is gone; `tsc` proves no call site can hand it the window.
- `BoardView.tsx`'s `parentsById` epic half, the `Set epic` picker's option list, and the `issue-parent` picker's Epics group all resolve against the same roster `epicsById`/`FilterBar` already use — the last three sites in the app that could still read a windowed epic derivation.
- `issue-parent`'s `onSelect` now decides a chosen id's parent kind by testing roster membership *before* falling back to the windowed `items` lookup, so an out-of-window epic can never be silently misfiled as a task.
- `packages/core/tests/epic_roster.rs` grew from 3 to 8 tests: an explicitly hand-computed total-order assertion, a tie-break test proven at both small and above-`DEFAULT_LIMIT` volume, a pure-read idempotency proof (unchanged `events` count and `epics.updated_at` across two calls), an empty-project case, and a non-ASCII/combining-mark title round-trip.
- `01-UI-SPEC.md` now documents the `Unknown epic` copy, the epic pill's three-outcome contract and label source, and the project-wide (not window-wide) epic filter coverage — all attributed to plan `01-18` (G-01-2).
- Task 3's `<human-check>` was completed on a live `npm run tauri dev` build against the owner's real seeded project (917 tasks, 13 epics, key prefix `THRE`) — see "Human-Check Results" below.

## Task Commits

Each task was committed atomically:

1. **Task 1: The epic filter chips become a property of the project, not the scroll position** - `f3d0b34` (feat)
2. **Task 2: Both parent pickers and the issues lane resolve epics from the roster** - `2eb71c3` (feat)
3. **Task 3: Pin the roster's ordering, tie-break, idempotency and encoding contract, and record the new copy in the UI-SPEC** - `20a1c96` (test)

_Tasks 1 and 2 carry `tdd="true"`. Following the pattern 01-17-SUMMARY.md established for this project: each task's RED phase was verified genuinely failing in the working tree before the GREEN implementation landed (see "Deviations" below for how each RED was confirmed), then squashed into one commit per task per this project's established per-task commit convention — the RED evidence is recorded in this SUMMARY rather than as a separate `test(...)` commit. Task 3 (`type="auto"`, no `tdd` flag) is a single `test` commit because its own deliverable is entirely new Rust tests plus documentation._

## Files Created/Modified

- `packages/desktop/src/board/FilterBar.tsx` - `FilterBarProps.projectId` replaces `items`; chips sourced from `useEpics`
- `packages/desktop/src/App.tsx` - `<FilterBar projectId={projectId} …>` instead of `items={boardQuery.data.items}`
- `packages/desktop/src/board/BoardView.tsx` - `parentsById`'s epic half, the `Set epic` picker, and the `issue-parent` picker's Epics group all roster-sourced; `onSelect` tests roster membership first
- `packages/desktop/src/board/__tests__/filter.test.tsx` - two `<FilterBar>` renders updated to the new prop
- `packages/desktop/src/board/__tests__/layer-guard.test.tsx` - render updated to `projectId="proj-1"`
- `packages/desktop/src/board/__tests__/epic-assign.test.tsx` - three assertions converted to await the roster's async settling (exact option-label array preserved)
- `packages/desktop/src/board/__tests__/issue-parent.test.tsx` - `epic_list_all` mock added; two assertions converted to await the roster's async settling
- `packages/desktop/src/board/__tests__/epic-roster.test.tsx` - 11 new tests: 6 for `FilterBar`'s chip row, 5 for the pickers and the issues-lane parent button
- `packages/core/tests/epic_roster.rs` - `insert_epic_with` test helper plus 5 new tests (ordering, tie-break, idempotency, empty-project, non-ASCII)
- `.planning/phases/01-the-board-is-the-store-of-record/01-UI-SPEC.md` - Copywriting Contract row, Row Anatomy note, Board list Filters bullet

## Decisions Made

See `key-decisions` in frontmatter — summarized: `FilterBar` loses `items` entirely (structural, not discipline-based) rather than merely ignoring it; `parentsById`'s task half stays windowed by design (accepted debt from 01-17); `issue-parent`'s kind resolution tests roster membership first; the Rust ordering/tie-break tests bypass `create_epic` via a new `insert_epic_with` helper because `create_epic`'s API cannot express an explicit `(status, priority, rank)` tuple or a deliberate tie; and the total-order test's expected sequence is hand-computed, never re-derived from the implementation's own comparator.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 1 - Bug] Fixed a genuine async-settling race in three existing picker tests**
- **Found during:** Task 2, running `epic-assign.test.tsx` and `issue-parent.test.tsx` against the roster-sourced `Set epic`/`Set parent` pickers
- **Issue:** Once the picker option lists were re-pointed at the async `useEpics` roster query (instead of the synchronous `items` prop), tests that opened a picker via `fireEvent.keyDown`/`fireEvent.click` and immediately asserted on its contents raced the roster's promise resolution — `screen.findByRole("menu", …)` succeeds as soon as the menu DOM node exists (even with only "No epic" rendered), not once the roster has settled, so a synchronous `getByText(...)` right after could read a stale, incomplete option list.
- **Fix:** Converted the racing assertions to `await within(menu).findByText(...)` (or `await screen.findByText(...)` for the click target), which polls until the roster-sourced option actually renders — the same pattern `epic-assign.test.tsx`'s own `a_task_carrying_an_epic_id_renders_that_epics_key_and_title_in_the_row_pill` test already used for the roster-sourced pill (added in 01-17). Every final assertion (the exact `["No epic", "FLY-1 First Epic", "FLY-2 Second Epic"]` array, the `Epics`/`Tasks` group labels, etc.) is byte-identical to what the plan specified — only the wait mechanism changed.
- **Files modified:** `packages/desktop/src/board/__tests__/epic-assign.test.tsx`, `packages/desktop/src/board/__tests__/issue-parent.test.tsx`, `packages/desktop/src/board/__tests__/epic-roster.test.tsx` (my own new Task 2 tests had the identical race and got the identical fix before ever being committed)
- **Verification:** Full desktop suite green (127/127) after the fix; each affected test re-run individually to confirm it passes for the right reason (roster resolved, not a lucky race)
- **Committed in:** `2eb71c3` (Task 2 commit)

---

**Total deviations:** 1 auto-fixed (1 bug — a test-timing race exposed by, not introduced by, the roster source-swap).
**Impact on plan:** No scope creep. The fix only makes existing/new tests correctly wait for the same async data source `BoardRow`'s pill (01-17) had already established as the precedent for waiting.

## Human-Check Results

Task 3's `<human-check>` was run on a live `npm run tauri dev` build (macOS) against the real seeded project the owner uses for dogfooding (`.flywheel/project.json`'s registered `threadfin` project at `/Users/cymarechal/Library/Application Support/Flywheel/flywheel.db` — key prefix `THRE`, 917 tasks + 13 epics; the plan's cited "1,067-item" count has since drifted with ordinary use, but the epic count matches exactly). Driven via Orca's `computer-use` accessibility surface (native window, not a browser) since no project skill existed yet for launching this Tauri app — the app resolved to a real, interactable window on the first attempt with no patches needed.

1. **Rows THRE-33, THRE-38, THRE-43, THRE-48, THRE-53, THRE-58:** every pill read a human-readable `KEY Title` (`THRE-9 Diff review surface`, `THRE-14 Search and filtering`, `THRE-7 Agent session supervision`, `THRE-12 Relay client seam`, `THRE-17 Migrations and backups`, `THRE-10 Event log and outbox` respectively). None read a 26-character identifier or `Unknown epic`.
2. **Epic chip count:** 13 epic chips plus the `No epic` chip — matching the project's exact 13-epic roster.
3. **Composed-filter case:** selected the `THRE-17 Migrations and backups` epic chip, then the `In Review` status chip (THRE-17 has zero `in_review` tasks, so every band showed 0). The `THRE-17` chip remained present and selected throughout — the exact case the old `FilterBar` doc comment documented as a known limitation. Filters cleared afterward.
4. **`Set epic` picker on an out-of-window-epic task:** selected `THRE-53` (epic `THRE-17`) and pressed `m`. All 13 epics were offered, including `THRE-17` itself (shown selected). Closed with Escape, no change made.
5. **Live quick-add roster update:** created a new epic (`⌘⇧N`, title "G-01-2 verification epic") without reloading. The new epic's chip appeared in the filter bar immediately, and re-opening the `Set epic` picker on `THRE-53` offered it too. The verification epic was then deleted (`⌘⌫` → confirmed) to leave the owner's real project data unchanged; confirmed removed both in the app and via a direct `SELECT COUNT(*) FROM epics WHERE key='THRE-1078'` (returned 0).

All five checks passed with no deviation from expected behavior. `01-UAT.md` test 2 (perceived lag at 1,000+ items) was not re-run, per the plan's own instruction — it remains a separate, still-pending item to be exercised by the owner after this plan lands.

## Issues Encountered

- Synthetic key-press delivery via the accessibility API landed on the currently DOM-focused element rather than the app's global `window` keydown listener when that focused element was a stale row container left over from a prior `click --element-index`. Pressing `m` a second time (after clicking the target row again so it held live DOM focus) delivered correctly and opened the picker. Not a defect in the app — an artifact of how `computer-use`'s synthetic input targets accessibility focus versus a real click's DOM focus — worked around by re-clicking the row immediately before each key press.

## User Setup Required

None - no external service configuration required.

## Next Phase Readiness

- G-01-2 is fully closed: every epic-label surface in the app (pill, chip row, both picker option lists, issues-lane parent button) resolves against the one project-wide roster; no windowed epic derivation remains anywhere in `packages/desktop/src`.
- `BOARD-06` and `BOARD-01` — both declared by 01-17 and this plan — are now ready to mark `Complete`; this is the last plan declaring either id.
- The task half of `parentsById` (and the `issue-parent` picker's Tasks group) remains windowed by design — accepted debt recorded in `01-17-PLAN.md`'s assumption-delta block. A per-id task parent-resolution command would close it; that is a different, unplanned gap.
- No blockers for the next phase. `01-UAT.md` test 2 (perceived lag at 1,000+ items) remains pending, to be re-run by the owner now that G-01-2's own symptom is confirmed resolved.

---
*Phase: 01-the-board-is-the-store-of-record*
*Completed: 2026-09-10*

## Self-Check: PASSED

All key files confirmed present on disk (`FilterBar.tsx`, `BoardView.tsx`, `epic_roster.rs`,
`01-UI-SPEC.md`). All three task commit hashes (`f3d0b34`, `2eb71c3`, `20a1c96`) confirmed present
in `git log`. All plan-level `<verification>` commands re-run clean: `cargo test -p core --test
epic_roster` (8/8), `cargo test --workspace` (all green), `npm run build` (no TS errors), `npm run
test -- --run` (127/127, 19/19 files), both grep gates (no `items=` at any `<FilterBar>` call
site, no executable `item.kind === "epic"` line in `BoardView.tsx`), and the `Unknown epic`
UI-SPEC gate (2 occurrences). Task 3's `<human-check>` was executed on a live build against the
real seeded project and all five steps passed — see "Human-Check Results" above.
