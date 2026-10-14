---
phase: 01-the-board-is-the-store-of-record
plan: 14
subsystem: ui
tags: [react, zustand, radix-focus-scope, keyboard, hierarchy, gap-closure]

# Dependency graph
requires:
  - phase: 01-the-board-is-the-store-of-record
    provides: >
      plan 01-12's task_set_epic Tauri command (camelCase taskId/epicId) and
      assert_parent_in_project server-side authority; plan 01-13's layer model
      (PickerKind, LayerState, topLayer/bindingAllowedInLayer) and the
      AssigneePicker/StatusPicker Radix wiring pattern this plan mirrors
provides:
  - "board/pickers/ParentPicker.tsx — a generic id/label/group option picker portalled to document.body, the same Radix wiring as the other four pickers; reused as-is by plan 01-15 for issue parents"
  - "state/keyboard.ts: open-epic-picker action id bound to m (board-list region)"
  - "state/uiStore.ts: PickerKind gains \"epic\" — folds into the existing pickerOpen layer boolean, no new LayerState field"
  - "useBoardQuery.ts: useSetTaskEpic (invokes task_set_epic) and useCreateTask now threading epicId through task_create"
affects: ["01-15 (reuses ParentPicker for issue parents with grouped options)"]

# Actuals (#2632)
actuals:
  tokens: 7372
  tasks: 3
  commits: 3

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "ParentPicker is the generic sibling of the four fixed-option pickers (Status/Priority/Estimate/Assignee) — one component for any runtime {id, label, group?} list, so a second hierarchy-reparenting surface (plan 01-15's issue parent) reuses it instead of forking a fifth picker"
    - "TASK_ONLY_ACTION_IDS (CommandPalette.tsx) is a named set for 'board-list actions that apply only to a task,' following the same style as OVERLAY_ACTION_IDS/SELECTION_INDEPENDENT_ACTION_IDS rather than an inline special case in the generator loop"

key-files:
  created:
    - packages/desktop/src/board/pickers/ParentPicker.tsx
    - packages/desktop/src/board/__tests__/epic-assign.test.tsx
  modified:
    - packages/desktop/src/state/keyboard.ts
    - packages/desktop/src/state/uiStore.ts
    - packages/desktop/src/board/useBoardQuery.ts
    - packages/desktop/src/board/BoardView.tsx
    - packages/desktop/src/board/CommandPalette.tsx
    - packages/desktop/src/App.tsx
    - .planning/phases/01-the-board-is-the-store-of-record/01-UI-SPEC.md

key-decisions:
  - "The epic picker is bound to m ('move under' — the action, not the noun), not a reflexive first letter — s/p/e/a were already taken by status/priority/estimate/assignee, and m was the only free mnemonic key left in the board-list region"
  - "useSetTaskEpic carries no epic-kind branch (unlike useSetStatus/useSetPriority/useSetEstimate/useSetAssignee) — this action exists only for tasks, because the fixed three-level hierarchy gives an epic no epic parent of its own"
  - "ParentPicker's ParentOption carries an optional group field, rendered as a non-interactive heading before each contiguous run sharing that group — unused by this plan (epics are ungrouped) but load-bearing for plan 01-15, which needs epic/task option groups in the same list"
  - "BoardViewProps.onCreateTask gained a second epicId parameter now, always null from every call site in this plan — plan 01-15's nested quick-add is what supplies a real value"
  - "BOARD-01 stays unticked pending plan 01-15: it also declares BOARD-01 in its own PLAN.md frontmatter, so the shared-ID gate in requirements.ready-ids correctly withholds the tick until 01-15's SUMMARY exists too (issue parenting is still unwired)"

requirements-completed: []

coverage:
  - id: D1
    description: "One keystroke (m) on a selected task opens an epic picker listing every epic in the project plus an explicit No epic entry; refused (no menu) on an epic row"
    requirement: BOARD-01
    verification:
      - kind: integration
        ref: "board/__tests__/epic-assign.test.tsx#m_opens_the_epic_picker_for_a_selected_task_listing_no_epic_and_every_epic"
        status: pass
      - kind: integration
        ref: "board/__tests__/epic-assign.test.tsx#m_opens_no_menu_with_an_epic_selected"
        status: pass
    human_judgment: false
  - id: D2
    description: "Choosing an epic (or No epic) from the picker calls task_set_epic with the exact taskId/epicId argument pair, including a null epicId to clear it"
    requirement: BOARD-01
    verification:
      - kind: integration
        ref: "board/__tests__/epic-assign.test.tsx#choosing_an_epic_calls_task_set_epic_with_the_task_and_epic_ids"
        status: pass
      - kind: integration
        ref: "board/__tests__/epic-assign.test.tsx#choosing_no_epic_calls_task_set_epic_with_a_null_epic_id"
        status: pass
    human_judgment: false
  - id: D3
    description: "The picker's option list excludes the selected row itself and never offers a task as an epic option"
    verification:
      - kind: integration
        ref: "board/__tests__/epic-assign.test.tsx#the_epic_picker_option_list_excludes_the_selected_row_and_contains_no_task_rows"
        status: pass
    human_judgment: false
  - id: D4
    description: "A task carrying an epicId renders that epic's key and title in the row's epic pill, replacing the No epic fallback — the reachable non-empty state G-01-EPIC-ASSIGN's WR-01 proved could only ever be empty"
    verification:
      - kind: integration
        ref: "board/__tests__/epic-assign.test.tsx#a_task_carrying_an_epic_id_renders_that_epics_key_and_title_in_the_row_pill"
        status: pass
    human_judgment: false
  - id: D5
    description: "The same action is reachable from the ⌘K palette under its printed label (Set Epic), disabled with nothing selected or an epic selected, enabled with a task selected — never dependent on having memorised m (BOARD-07)"
    requirement: BOARD-07
    verification:
      - kind: integration
        ref: "board/__tests__/epic-assign.test.tsx#the_palette_lists_a_set_epic_command_disabled_or_enabled_by_selection"
        status: pass
    human_judgment: false
  - id: D6
    description: "01-UI-SPEC.md's Keyboard Map and palette command set sentence both name the new m binding and Set Epic — the printed contract and the running app agree"
    verification:
      - kind: other
        ref: "grep '| `m`' and 'Set Epic' in .planning/phases/01-the-board-is-the-store-of-record/01-UI-SPEC.md"
        status: pass
    human_judgment: false

# Metrics
duration: 12min
completed: 2026-09-09
status: complete
---

# Phase 01 Plan 14: Task Epic Assignment — Keystroke, Picker, and Palette Summary

**A generic `ParentPicker`, the deliberate `m` binding, `useSetTaskEpic`, and the palette's generated Set Epic command make a task's epic assignable end-to-end, closing G-01-EPIC-ASSIGN's third cause: nothing in the running renderer called plan 01-12's `task_set_epic` command until now.**

## Performance

- **Duration:** 12 min
- **Started:** 2026-09-09T13:56:57Z
- **Completed:** 2026-09-09T14:02:59Z
- **Tasks:** 3
- **Files modified:** 9 (2 created, 7 modified)

## Accomplishments

- `board/pickers/ParentPicker.tsx` (new): a generic `{id, label, group?}` option picker, same
  Radix `FocusScope`/`DismissableLayer` wiring and `document.body` portal as `AssigneePicker`/
  `StatusPicker`, with a leading "clear the parent" option and non-interactive group headings —
  purpose-built to be reused unchanged by plan 01-15 for issue parents.
- `state/keyboard.ts` gained `open-epic-picker`, bound to `m` in the board-list region (label
  "Set Epic") — placed immediately after `open-assignee-picker` so the five pickers read as one
  group, with the mnemonic reasoning ("`m` for move under") recorded in a comment.
- `state/uiStore.ts`'s `PickerKind` gained `"epic"` — no other layer-model change was needed:
  `activePicker !== null` already covers it, exactly as plan 01-13 designed for.
- `useBoardQuery.ts`: `useSetTaskEpic` invokes `task_set_epic` with camelCase `taskId`/`epicId`
  and no epic-kind branch (this action exists only for tasks); `useCreateTask` now threads
  `epicId` through `task_create` instead of silently dropping it (G-01-EPIC-ASSIGN's first
  cause).
- `BoardView.tsx`: `m` opens `ParentPicker` for a selected task (refused as a no-op on an epic
  row), with options built from the loaded window's epics excluding the picked row itself; `App.tsx`'s
  `onCreateTask` and `BoardViewProps.onCreateTask` both gained an `epicId` parameter (always
  `null` from every call site in this plan).
- `CommandPalette.tsx`: the generated "Set Epic" command opens the same `ParentPicker`, disabled
  with no selection or an epic selected (`TASK_ONLY_ACTION_IDS`, a new named set following the
  existing `OVERLAY_ACTION_IDS`/`SELECTION_INDEPENDENT_ACTION_IDS` style), enabled with a task
  selected.
- `01-UI-SPEC.md`'s Keyboard Map gained the `m` row and the palette command set sentence now
  names "Set Epic" — the printed contract and the running app agree.
- `board/__tests__/epic-assign.test.tsx` (new, 7 tests): every behavior bullet from the plan has
  a named test — keystroke opens/refuses the menu, both selections call `task_set_epic` with the
  right argument shape, the option list excludes the selected row and offers no task rows, the
  pill renders a real epic's key/title, and the palette command's `aria-disabled` tracks the
  three selection states.

## Task Commits

Each task was committed atomically:

1. **Task 1: The generic ParentPicker and the deliberate m binding for Set Epic** - `d92bfa9` (feat)
2. **Task 2: Wire the epic through creation and reparenting** - `b33e98f` (feat)
3. **Task 3: Tests that hold the assignment end to end** - `a4d7029` (test)

**Plan metadata:** committed alongside this SUMMARY (see final commit below).

## Files Created/Modified

- `packages/desktop/src/board/pickers/ParentPicker.tsx` - generic id/label/group option picker
- `packages/desktop/src/board/__tests__/epic-assign.test.tsx` - 7 new tests covering every
  behavior bullet
- `packages/desktop/src/state/keyboard.ts` - `open-epic-picker` action id, bound to `m`
- `packages/desktop/src/state/uiStore.ts` - `PickerKind` gains `"epic"`
- `packages/desktop/src/board/useBoardQuery.ts` - `useSetTaskEpic`; `useCreateTask` threads `epicId`
- `packages/desktop/src/board/BoardView.tsx` - `m` keystroke handling, `ParentPicker` render arm
- `packages/desktop/src/board/CommandPalette.tsx` - generated "Set Epic" command, `TASK_ONLY_ACTION_IDS`
- `packages/desktop/src/App.tsx` - `onCreateTask` now passes `{title, epicId}`
- `.planning/phases/01-the-board-is-the-store-of-record/01-UI-SPEC.md` - Keyboard Map `m` row,
  palette command set sentence

## Decisions Made

See `key-decisions` in the frontmatter above. The two load-bearing ones for plan 01-15:

- `ParentPicker`'s `ParentOption.group` is unused by this plan (epics render as a flat list) but
  exists specifically for 01-15's grouped epic/task option list — 01-15 must render through the
  same component, not fork a fifth picker.
- BOARD-01 stays unticked: it is a shared requirement ID with 01-15's own PLAN.md frontmatter, so
  `requirements.ready-ids`'s shared-ID gate correctly withholds the tick until 01-15's SUMMARY
  also exists (issue parenting is still unwired — the honest interim state, same reasoning 01-12
  used).

## Deviations from Plan

None - plan executed exactly as written. Two implementation-detail additions surfaced only during
test-writing (both are Rule 1/Rule 3-class fixes made while writing Task 3, not plan deviations):
the palette test needed a registered project in its `project_list` mock (the palette's own
`useBoardQuery` is gated on having a project id to query, and an empty project list left its
`selectedItem` lookup permanently empty — the disabled-state assertions would have been trivially
true for the wrong reason), and the mutation-argument assertions needed `waitFor` around the
`invokeCommand` mock call (React Query's `mutate()` invokes its `mutationFn` asynchronously, so a
synchronous check right after `fireEvent.click` raced it). Neither touched production code.

## Issues Encountered

None.

## User Setup Required

None - no external service configuration required.

## Next Phase Readiness

- `ParentPicker` is ready for 01-15 to reuse as-is for issue parents (grouped epic/task options).
- BOARD-01 remains unticked, by design, until 01-15's SUMMARY exists — the shared-ID gate in
  `requirements.ready-ids` will restore the tick automatically once both plans' `*-SUMMARY.md`
  files are present.
- Full desktop test suite: 74/74 passing (67 pre-existing + 7 new), no regressions.
  `cargo test --workspace` unaffected by this plan (no Rust changes), still green.

---
*Phase: 01-the-board-is-the-store-of-record*
*Completed: 2026-09-09*

## Self-Check: PASSED

- `packages/desktop/src/board/pickers/ParentPicker.tsx` FOUND, exports `ParentPicker` and
  `ParentOption` — confirmed via `npm run build` (tsc + vite) and direct imports in
  `BoardView.tsx`/`CommandPalette.tsx`/`epic-assign.test.tsx`.
- `packages/desktop/src/board/__tests__/epic-assign.test.tsx` FOUND (created, exists on disk).
- Commit `d92bfa9` FOUND in `git log --oneline --all`.
- Commit `b33e98f` FOUND in `git log --oneline --all`.
- Commit `a4d7029` FOUND in `git log --oneline --all`.
- `npm --prefix packages/desktop run build` — PASSED (tsc + vite build).
- `npm --prefix packages/desktop run test` — PASSED (15 files, 74 tests, 0 failed).
- `cargo test --workspace` — PASSED (untouched by this plan, all suites green).
- `01-UI-SPEC.md` contains a `| \`m\` |` Keyboard Map row and the string "Set Epic" in the
  palette command set sentence — confirmed via grep.
- All 7 `<behavior>` bullets from Task 3 have a named test in `epic-assign.test.tsx`.
