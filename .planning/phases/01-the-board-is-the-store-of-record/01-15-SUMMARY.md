---
phase: 01-the-board-is-the-store-of-record
plan: 15
subsystem: board
tags: [react, zustand, tanstack-query, hierarchy, gap-closure]

# Dependency graph
requires:
  - phase: 01-the-board-is-the-store-of-record
    provides: >
      plan 01-12's issue_set_parent Tauri command (camelCase issueId/parentKind/parentId) and
      assert_parent_in_project server-side authority; plan 01-13's layer model (PickerKind,
      LayerState, topLayer/bindingAllowedInLayer); plan 01-14's generic ParentPicker (id/label/
      group options), useSetTaskEpic, and the m/ParentPicker/useCreateTask epicId patterns this
      plan mirrors for the issue half of the hierarchy
provides:
  - "useBoardQuery.ts: useSetIssueParent (invokes issue_set_parent) and useCreateIssue now
    threading epicId/taskId through issue_create instead of dropping them"
  - "IssuesLane.tsx: a focusable parent button per issue row (parent key or 'No parent')"
  - "BoardView.tsx: the 'issue-parent' picker kind, resolved from `issues` and rendered through
    plan 01-14's ParentPicker with grouped Epics/Tasks options"
  - "QuickAdd.tsx: opt-in indentTarget/indented/onIndentChange props — Tab/Shift+Tab nest a new
    task under the selection-implied epic before creation"
  - "CommandPalette.tsx: Create Issue files the new issue under the current selection"
affects: []

# Actuals (#2632)
actuals:
  tokens: 10033
  tasks: 3
  commits: 3

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "The 'issue-parent' picker kind resolves its subject from `issues` ahead of the picker
      render switch, while the other five kinds keep resolving from `selectableItems` — one
      subject-resolution branch, not a duplicated render block, for a kind whose subject is
      never a BoardItem"
    - "parentsById (BoardView) is one item-id -> {key,title,kind} lookup covering BOTH epics and
      tasks, keyed exactly like epicsById's single-window derivation, so IssuesLane needs no
      second tasksById map to resolve an issue's epicId-or-taskId parent"
    - "QuickAdd's Tab/Shift+Tab nesting is opt-in via three props (indentTarget/indented/
      onIndentChange) all being supplied — a caller that supplies none of them (IssuesLane's own
      quick-add) keeps native Tab moving focus out of the region, unchanged"

key-files:
  created:
    - packages/desktop/src/board/__tests__/issue-parent.test.tsx
  modified:
    - packages/desktop/src/state/uiStore.ts
    - packages/desktop/src/board/useBoardQuery.ts
    - packages/desktop/src/board/IssuesLane.tsx
    - packages/desktop/src/board/BoardView.tsx
    - packages/desktop/src/board/CommandPalette.tsx
    - packages/desktop/src/board/QuickAdd.tsx
    - .planning/phases/01-the-board-is-the-store-of-record/01-UI-SPEC.md
    - .planning/REQUIREMENTS.md

key-decisions:
  - "PickerKind gains 'issue-parent' (uiStore.ts) — folds into the existing pickerOpen layer
    boolean exactly as plan 01-14's 'epic' kind did; no LayerState change needed (01-13's design
    intent held)"
  - "parentsById is keyed by item id (epic id or task id), not by issue id — IssuesLane looks an
    issue's epicId ?? taskId up against it directly, the same single-window derivation epicsById
    already uses, with the same known limitation"
  - "QuickAdd's onCreate signature gained a second epicId: string | null argument universally —
    IssuesLane's 1-arg onCreateIssue is still a valid callback (TS accepts fewer parameters), so
    it needed no change to keep working"
  - "01-UI-SPEC.md's Quick-add table (Keyboard Map) is the only location corrected — the Quick-add
    (D-09) section's own prose paragraph, which carries the identical wrong wording, was left
    untouched per the plan's explicit 'change nothing else in that document' scope boundary"
  - "The two Create Issue palette tests wait on the palette's board-query cache directly
    (queryClient.getQueryData) rather than on a DOM-inferred readiness proxy — the DOM proxy
    (an item-dependent picker's aria-disabled) was a false positive whenever the default-kind
    branch happened to match the expected disabled value regardless of whether the query had
    actually resolved, which is what made the first version of these two tests flaky"

requirements-completed: [BOARD-01]

coverage:
  - id: D1
    description: "Every issue row renders a focusable parent button — 'No parent' when the issue has neither an epic nor a task, the parent's key when it has one"
    requirement: BOARD-01
    verification:
      - kind: integration
        ref: "board/__tests__/issue-parent.test.tsx#an_issue_row_renders_no_parent_or_the_parents_key"
        status: pass
    human_judgment: false
  - id: D2
    description: "Activating the parent button opens a 'Set parent' menu with a No parent entry, an Epics group listing every epic, and a Tasks group listing every task"
    requirement: BOARD-01
    verification:
      - kind: integration
        ref: "board/__tests__/issue-parent.test.tsx#activating_the_parent_button_opens_a_set_parent_menu_with_no_parent_epics_and_tasks_groups"
        status: pass
    human_judgment: false
  - id: D3
    description: "Choosing a task, an epic, or No parent calls issue_set_parent with the exact issueId/parentKind/parentId argument shape, including the detach (null/null) path"
    requirement: BOARD-01
    verification:
      - kind: integration
        ref: "board/__tests__/issue-parent.test.tsx#choosing_a_task_calls_issue_set_parent_with_the_issue_and_task_ids"
        status: pass
      - kind: integration
        ref: "board/__tests__/issue-parent.test.tsx#choosing_an_epic_calls_issue_set_parent_with_a_parent_kind_of_epic"
        status: pass
      - kind: integration
        ref: "board/__tests__/issue-parent.test.tsx#choosing_no_parent_calls_issue_set_parent_with_a_null_kind_and_id"
        status: pass
    human_judgment: false
  - id: D4
    description: "The palette's Create Issue command carries the current selection's id through as taskId or epicId — the second half of G-01-EPIC-ASSIGN's first cause"
    requirement: BOARD-01
    verification:
      - kind: integration
        ref: "board/__tests__/issue-parent.test.tsx#running_create_issue_from_the_palette_with_a_task_selected_passes_taskId"
        status: pass
      - kind: integration
        ref: "board/__tests__/issue-parent.test.tsx#running_create_issue_from_the_palette_with_an_epic_selected_passes_epicId"
        status: pass
    human_judgment: false
  - id: D5
    description: "Quick-add's Tab nests a new task under the selection-implied epic, shows the epic's key before Enter, and Shift+Tab removes the nesting before Enter; Tab does nothing while composing an epic"
    requirement: BOARD-01
    verification:
      - kind: integration
        ref: "board/__tests__/issue-parent.test.tsx#with_an_epic_selected_tab_in_quick_add_shows_the_epic_and_enter_carries_its_id"
        status: pass
      - kind: integration
        ref: "board/__tests__/issue-parent.test.tsx#shift_tab_clears_the_nesting_before_enter"
        status: pass
      - kind: integration
        ref: "board/__tests__/issue-parent.test.tsx#with_quick_add_open_for_an_epic_tab_changes_nothing"
        status: pass
    human_judgment: false
  - id: D6
    description: "01-UI-SPEC.md's Quick-add table describes selection-implied nesting, with a note explaining the correction, and documents the Issues lane's parent affordance"
    verification:
      - kind: other
        ref: "grep -n 'selection implies' and 'parent affordance' .planning/phases/01-the-board-is-the-store-of-record/01-UI-SPEC.md"
        status: pass
    human_judgment: false

# Metrics
duration: 15min
completed: 2026-09-09
status: complete
---

# Phase 01 Plan 15: Issue Parenting, Quick-Add Nesting, and the Restored BOARD-01 Tick Summary

**The issue half of the fixed hierarchy — a focusable parent button on every issue row, reparent/detach through a grouped `ParentPicker`, both creation paths (`task_create`, `issue_create`) now carrying the ids they were dropping, and the last third of G-01-EPIC-ASSIGN closed.**

## Performance

- **Duration:** ~15 min
- **Started:** 2026-09-09T22:07:00Z
- **Completed:** 2026-09-09T22:22:53Z
- **Tasks:** 3
- **Files modified:** 9 (1 created, 8 modified)

## Accomplishments

- `useSetIssueParent` (new) invokes plan 01-12's `issue_set_parent` command with the exact
  camelCase `issueId`/`parentKind`/`parentId` arguments it expects; `useCreateIssue` now threads
  `epicId`/`taskId` through `issue_create` instead of silently dropping both — the second half of
  G-01-EPIC-ASSIGN's first cause (the live database held an issue with both columns NULL because
  nothing ever sent them).
- `IssuesLane.tsx` renders one focusable parent button per issue row, between title and kind
  label, showing the parent's key or a "No parent" fallback — the same idiom `BoardRow`'s epic
  pill already uses, reachable by Tab since the lane is not virtualized.
- `BoardView.tsx` resolves the `"issue-parent"` picker kind from `issues` (never `selectableItems`,
  since an issue is never a `BoardItem`) ahead of the existing picker-render switch, and renders
  plan 01-14's `ParentPicker` with two labelled groups — every epic, then every task — reusing the
  component rather than forking a second picker.
- `QuickAdd.tsx` gained opt-in `indentTarget`/`indented`/`onIndentChange` props: Tab nests the row
  under the target (rendering a small key chip ahead of the input), Shift+Tab removes it, both
  only when the props are supplied — `IssuesLane`'s own always-mounted quick-add supplies none of
  them and keeps native Tab unchanged. `onCreate` now carries the resolved epic id through to
  `onCreateTask`.
- `BoardView.tsx` derives the indent target from the current selection (the selected epic, or the
  selected task's own epic via `epicsById`), always `null` while composing an epic — the same rule
  the `m` keystroke already applies.
- `CommandPalette.tsx`'s "Create Issue" command files the new issue under the current selection
  (`epicId` for an epic, `taskId` for a task, neither with no selection) — the real caller that
  makes `useCreateIssue`'s new parameters live, not just a test double.
- `01-UI-SPEC.md`'s Quick-add table (Keyboard Map) now describes selection-implied nesting, with a
  note explaining why the original "nearest epic row above" wording was corrected (quick-add is
  pinned to the top of Backlog — there is never a row above it), and the Issues lane's parent
  affordance is now documented in the Board list section.
- `packages/desktop/src/board/__tests__/issue-parent.test.tsx` (new, 10 tests): every behavior
  bullet from the plan has a named test, asserting command argument names as well as values so a
  mis-cased key still fails.
- `.planning/REQUIREMENTS.md`'s BOARD-01 line is reticked with no gap parenthetical — restored to
  its pre-01-12 wording, backed by this file plus plan 01-14's `epic-assign.test.tsx`.

## Task Commits

Each task was committed atomically:

1. **Task 1: The issue parenting path — hook, lane affordance, and the grouped picker** - `31b326b` (feat)
2. **Task 2: Quick-add nesting, and correcting the Keyboard Map row that promises an unreachable indent target** - `bc1d4b0` (feat)
3. **Task 3: Tests for both parenting paths, and restoring the BOARD-01 tick with evidence** - `e0e6533` (test)

**Plan metadata:** committed alongside this SUMMARY (see final commit below).

## Files Created/Modified

- `packages/desktop/src/state/uiStore.ts` - `PickerKind` gains `"issue-parent"`
- `packages/desktop/src/board/useBoardQuery.ts` - `useSetIssueParent`; `useCreateIssue` threads `epicId`/`taskId`
- `packages/desktop/src/board/IssuesLane.tsx` - `parentsById`/`onOpenParentPicker` props, parent button per row
- `packages/desktop/src/board/BoardView.tsx` - `parentsById` derivation, `"issue-parent"` picker render arm, quick-add indent target/state
- `packages/desktop/src/board/CommandPalette.tsx` - "Create Issue" carries `epicId`/`taskId` from selection
- `packages/desktop/src/board/QuickAdd.tsx` - `indentTarget`/`indented`/`onIndentChange` props, indent chip, `onCreate(title, epicId)`
- `packages/desktop/src/board/__tests__/issue-parent.test.tsx` - 10 new tests covering every behavior bullet
- `.planning/phases/01-the-board-is-the-store-of-record/01-UI-SPEC.md` - Quick-add table correction, Issues parent-affordance documentation
- `.planning/REQUIREMENTS.md` - BOARD-01 reticked, gap parenthetical removed

## Decisions Made

See `key-decisions` in the frontmatter above. The two load-bearing ones for future plans:

- `parentsById` is keyed by item id (any epic's or task's own `id`), not by issue id — a second
  `tasksById` mirroring `epicsById` was unnecessary once the lookup was framed this way.
- The Quick-add table correction is scoped to the Keyboard Map table only, per the plan's explicit
  "change nothing else in that document" — the Quick-add (D-09) prose paragraph carries the
  identical stale "nearest epic row above" wording and was deliberately left untouched; a future
  plan touching that section should reconcile it.

## Deviations from Plan

None - plan executed exactly as written. One test-writing note (not a plan deviation, no
production code touched): the first version of the two "Create Issue from the palette" tests used
a DOM-inferred readiness proxy (an item-dependent picker's `aria-disabled`) to wait for the
palette's own async board query to resolve before clicking. That proxy was a false positive for
the task-selected case — its default (pre-load) kind computation happened to already match the
expected post-load value, so the wait resolved without actually waiting, producing an
intermittent race. Replaced with a direct `queryClient.getQueryData(...)` check against the exact
cache key the palette's board query resolves under, which is unconditionally reliable regardless
of which item is selected. Verified stable across 5 repeated runs of the full suite before
proceeding.

---

**Total deviations:** 0
**Impact on plan:** None — the test-timing fix above touched only test code, not the behavior it verifies.

## Issues Encountered

None beyond the test-flakiness note above, resolved before this plan's tests were considered done.

## User Setup Required

None - no external service configuration required.

## Known Stubs

- **Single-window parent options (issue and task nesting alike).** The `ParentPicker`'s epic/task
  options (Task 1) and quick-add's indent target (Task 2) are both derived from the currently
  loaded board window (`items`), the same single-window derivation `epicsById` and `FilterBar.tsx`'s
  epic filter chips already use. An epic or task outside that window cannot be offered as a parent
  from either surface. This is the same cause `01-VERIFICATION.md` already tracks for the
  epic-filter-chip limitation (row 12 / the `FilterBar.tsx` info note) — both share one root cause
  (no dedicated `epic_list`/`task_list` command independent of the board window) and one eventual
  fix (adding that command). Not a regression introduced by this plan; not fixed by it either,
  consistent with how the prior instance was left.

## Next Phase Readiness

- G-01-EPIC-ASSIGN is fully closed: a task can be placed under an epic (plan 01-14) and an issue
  under an epic or a task (this plan), from the keyboard, with the result visible on the row; the
  parent survives creation through both `task_create` (plan 01-14) and `issue_create` (this plan);
  the Keyboard Map matches what ships; BOARD-01 is ticked with two test suites behind it.
- No blockers. The single-window limitation above is a known, disclosed stub shared with an
  existing tracked limitation — not new scope for a future plan to discover cold.

---
*Phase: 01-the-board-is-the-store-of-record*
*Completed: 2026-09-09*

## Self-Check: PASSED

All 10 files listed in "Files Created/Modified" (plus this SUMMARY.md) FOUND on disk; all 3 task
commits (`31b326b`, `bc1d4b0`, `e0e6533`) FOUND in `git log --oneline --all`. `npm --prefix
packages/desktop run build` PASSED (tsc + vite build). `npm --prefix packages/desktop run test`
PASSED (16 files, 84 tests, 0 failed — 74 pre-existing plus 10 new in `issue-parent.test.tsx`).
`cargo test --workspace` PASSED (untouched by this plan, all suites green). The BOARD-01 line in
`.planning/REQUIREMENTS.md` confirmed ticked (`- [x]`) with no gap parenthetical. All 8
`<behavior>` bullets from Task 3 have a named test in `issue-parent.test.tsx`.
