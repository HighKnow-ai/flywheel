---
phase: 13-nothing-new-escapes-the-fence
plan: 07
subsystem: core
tags: [rust, sqlite, status-derivation, forward-only-floor, scheduler, react, drft-04]

requires:
  - phase: 13-05
    provides: spine pin (tasks DDL untouched here) and the crate-wide table-name interpolation gate
  - phase: 13-06
    provides: create_task at `todo`, and `backlog` meaning only "proposed by an agent, not yet accepted"
provides:
  - "status_derivation: BAND_ORDER, band_rank, derive_candidate (pure), derive_status_in_tx / derive_status (the one writer of tasks.status)"
  - "forward-only as one `max(candidate, current)` comparison, level-based for worktree and merge, edge-based for in_review"
  - "ensure_worktree and the worktree-removal transaction derive status in the transaction that owns the row"
  - "the scheduler cold tick derives every tracked worktree on the existing tick (no new job)"
  - "start_agent_run's raw UPDATE tasks SET status and its task.status_changed event deleted (F5, D-13)"
  - "StatusPicker.tsx deleted; status is read-only on the card; DoneWarning.tsx deleted with it"
  - "no_agent_status_write.rs: two-sided source gate, trigger-point behaviour tests, picker-absence assertion"
affects: [13-08, 13-09, 13-10, 13-11, fnc-04, phase-14]

actuals:
  tokens: 38800
  tasks: 4
  commits: 6
plan_head_before: 9c5adb9cfbcb9dc0a7aa6390ba4b080b88653241
commits: 6

tech-stack:
  added: []
  patterns:
    - "a column with one writer is guarded by a source gate scanning for the raw statement outside the writer's file, plus a planted-violation twin"
    - "a derived value is hybrid when one of its inputs is a human-overridable edge: levels for facts that stay true, an edge for the one fact a human may decline"
    - "a deletion is the proof of absence: a Rust-side assertion walks the TS tree for the deleted component's name"

key-files:
  created:
    - packages/core/src/status_derivation.rs
    - packages/core/tests/status_derivation.rs
    - packages/core/tests/no_agent_status_write.rs
  modified:
    - packages/core/src/lib.rs
    - packages/core/src/forge/transitions.rs
    - packages/core/src/domain/agent_run.rs
    - packages/core/src/domain/worktree.rs
    - packages/desktop/src-tauri/src/scheduler.rs
    - packages/core/tests/agent_tracer.rs
    - packages/core/tests/forge_live_chain.rs
    - packages/desktop/src/board/BoardRow.tsx
    - packages/desktop/src/board/BoardView.tsx
    - packages/desktop/src/board/CommandPalette.tsx
    - packages/desktop/src/board/useBoardQuery.ts
    - packages/desktop/src/item-detail/ItemDetailPanel.tsx
    - packages/desktop/src/state/keyboard.ts
    - packages/desktop/src/state/uiStore.ts
  deleted:
    - packages/desktop/src/board/pickers/StatusPicker.tsx
    - packages/desktop/src/board/DoneWarning.tsx
    - packages/desktop/src/board/__tests__/done-warning.test.tsx

key-decisions:
  - "Task 1 (owner, in session, 2026-10-15): option 1, stay-lowered. D-11 upheld; the plan's Task 2 behaviour case 9 (raise again) is SUPERSEDED and was not implemented."
  - "The deriver is level-based for worktree and merge and edge-based for in_review. derive_status_in_tx takes a `review_edge` flag that only apply_forge_observation can set, because only it sees the baseline change."
  - "derive_status_in_tx returns a three-way Derivation (Unchanged / Wrote / Refused) instead of Option<String>, so the compare-and-swap refusal is surfaced and the forge-skipped trace survives."
  - "The worktree is read only for a card still below in_progress (the only band it can contribute), so a steady-state tick spends no git calls on the deriver."
  - "A git read error while looking for the worktree counts as 'not shown to exist': the deriver never writes on ambiguous evidence and the next tick retries."
  - "The scheduler's cold tick passes expected_status None: it holds the connection throughout, so there is no lock-release window to guard."
  - "BoardRow's status glyph is aria-hidden: the row's accessible name already states the status."

patterns-established:
  - "Pass an edge to a level-based function as an explicit flag from the one caller that observed it; do not re-derive the edge from a stored level"

requirements-completed: [DRFT-04]

coverage:
  - id: D1
    description: "tasks.status has exactly one writer: no raw UPDATE tasks SET status exists outside domain/task.rs, and the gate can fail"
    requirement: DRFT-04
    verification:
      - kind: unit
        ref: "packages/core/tests/no_agent_status_write.rs#no_module_outside_set_task_status_in_tx_writes_tasks_status"
        status: pass
      - kind: unit
        ref: "packages/core/tests/no_agent_status_write.rs#the_status_write_gate_fires_on_a_planted_raw_update"
        status: pass
    human_judgment: false
  - id: D2
    description: "The deriver's floor holds: done is terminal, a closed-unmerged or absent forge request never moves a card backwards, backlog is never promoted without a signal"
    requirement: DRFT-04
    verification:
      - kind: unit
        ref: "packages/core/tests/status_derivation.rs#a_merge_moves_in_review_to_done_and_reading_it_again_writes_nothing"
        status: pass
      - kind: unit
        ref: "packages/core/tests/status_derivation.rs#a_closed_unmerged_request_leaves_the_card_in_review"
        status: pass
      - kind: unit
        ref: "packages/core/tests/status_derivation.rs#a_forge_request_going_absent_after_a_merge_never_moves_a_done_card_backwards"
        status: pass
    human_judgment: false
  - id: D3
    description: "The owner's stay-lowered decision: after request_changes lowers a card, a tick with the forge unchanged does not raise it again"
    requirement: DRFT-04
    verification:
      - kind: unit
        ref: "packages/core/tests/status_derivation.rs#a_declined_card_stays_lowered_while_the_forge_is_unchanged"
        status: pass
    human_judgment: false
  - id: D4
    description: "The compare-and-swap carries over: a stale expected_status refuses the write and leaves a skipped trace on a forge edge"
    requirement: DRFT-04
    verification:
      - kind: unit
        ref: "packages/core/tests/status_derivation.rs#a_stale_expected_status_refuses_the_write_and_says_so"
        status: pass
      - kind: unit
        ref: "packages/core/tests/status_derivation.rs#a_refused_forge_edge_leaves_the_skipped_trace_in_the_activity_trail"
        status: pass
    human_judgment: false
  - id: D5
    description: "Creating a worktree moves todo to in_progress in the same transaction; removing one never un-starts work; starting a run writes no status"
    requirement: DRFT-04
    verification:
      - kind: unit
        ref: "packages/core/tests/no_agent_status_write.rs#creating_a_worktree_moves_todo_to_in_progress_in_the_same_transaction"
        status: pass
      - kind: unit
        ref: "packages/core/tests/no_agent_status_write.rs#removing_a_worktree_never_un_starts_the_work"
        status: pass
      - kind: unit
        ref: "packages/core/tests/no_agent_status_write.rs#starting_a_run_appends_its_started_event_and_no_status_event"
        status: pass
      - kind: unit
        ref: "packages/core/tests/no_agent_status_write.rs#starting_a_run_leaves_a_todo_band_to_the_deriver"
        status: pass
    human_judgment: false
  - id: D6
    description: "The cold tick derives every tracked worktree once and has nothing to say on the next tick"
    requirement: DRFT-04
    verification:
      - kind: unit
        ref: "packages/core/tests/no_agent_status_write.rs#a_cold_tick_derives_every_tracked_worktree_once"
        status: pass
    human_judgment: false
  - id: D7
    description: "Status is read-only on the card and the picker is gone from the tree, asserted from both Rust and the renderer"
    requirement: DRFT-04
    verification:
      - kind: unit
        ref: "packages/core/tests/no_agent_status_write.rs#no_status_picker_component_exists_in_the_desktop_tree"
        status: pass
      - kind: unit
        ref: "packages/desktop/src/board/__tests__/workflow.test.tsx#status is a read-only value on the card: stated in the row's name, offering no control"
        status: pass
      - kind: unit
        ref: "packages/desktop/src/item-detail/__tests__/finish.test.tsx#status is a read-only value: no control of any kind, and no caret (DRFT-04, D-19)"
        status: pass
    human_judgment: false
  - id: D8
    description: "The detail panel and the row read acceptably as a bare status value instead of a control"
    requirement: DRFT-04
    verification: []
    human_judgment: true
    rationale: "Whether a read-only status value reads as intended in the live panel and row is a visual judgment no assertion makes; the browser-arm captures that used to show the picker were removed, not re-run."

duration: 105min
completed: 2026-10-15
status: complete
---

# Phase 13 Plan 07: Derived Task Status Summary

**`tasks.status` has one writer, a deriver that takes `max(candidate, current)` over `backlog < todo < in_progress < in_review < done` from worktree and forge facts, with the `in_review` promotion kept edge-based so a declined card stays declined; the raw write in `start_agent_run` and `StatusPicker.tsx` are deleted.**

## Performance

- **Duration:** about 105 min (this continuation; the prior agent's Task 1 checkpoint is not counted)
- **Completed:** 2026-10-15
- **Tasks:** 4 (Task 1 satisfied by the owner's answer, Tasks 2-4 executed)
- **Files modified:** 45 in the diff against the plan's base, 18 of them tests

## Task 1: the decision, as taken

The prior agent halted at Task 1 with a contradiction: the plan's D-11 said the deriver must never move a
card past a band the human declined it into, while its Task 2 behaviour case 9 said the next tick would
compute `in_review` again and "the floor permits it". Raising again and honouring the decline cannot both
hold.

- **Decided by:** the owner, in session, on **2026-10-15**, option 1, "stay-lowered".
- **Band order, verbatim:** `backlog < todo < in_progress < in_review < done`.
- **Confirmed unchanged:** the deriver writes `max(candidate, current)`; `done` is terminal by virtue of the
  floor with no separate rule; the floor binds the deriver only; `request_changes` remains the single human
  act allowed to lower `in_review` to `in_progress`; the deriver never performs `backlog -> todo` (that rides
  the acceptance of the task, as 13-06 built).
- **No manual override or recompute control is in scope.** None was added (deferred in 13-CONTEXT).
- **D-11 upheld; Task 2 case 9 SUPERSEDED.** It was not implemented. The deriver is level-based for
  `worktree present -> in_progress` and `merged -> done`, and edge-based for `forge Open -> in_review`: it
  promotes only on the call where the forge state itself changed, which is what the edge detector in
  `transitions.rs` already did and documented as deliberate. The accepted cost is that the deriver keeps a
  forge baseline comparison and is not uniformly level-based. It was not refactored for tidiness.
- **Pinned by a test, not only by code:**
  `status_derivation.rs#a_declined_card_stays_lowered_while_the_forge_is_unchanged` drives a card to
  `in_review`, calls `request_changes`, ticks twice with the forge still `Open`, asserts `in_progress`
  throughout, then asserts only a forge change (a merge) moves it.

No further contradiction was found in the plan.

## Accomplishments

- One deriver module owns the column: a pure `derive_candidate`, a floor of one `max`, the
  `expected_status` compare-and-swap carried over unchanged, and a write that goes through
  `set_task_status_in_tx` and nothing else.
- `apply_forge_observation` no longer writes a status. It tells the deriver whether this call is the review
  edge and keeps every event it wrote before, including the skipped-write trace and the unmet-criteria event.
- Worktree create and remove, and the scheduler's cold tick, are the other trigger points. No new job was
  registered (the `Job::new|cron` count in `scheduler.rs` is 7 before and after).
- F5 is gone: `start_agent_run` no longer writes a status or appends `task.status_changed`. Deleted, not
  allow-listed.
- `StatusPicker.tsx` is deleted with every route to it; the row states its status in its accessible name, the
  detail panel prints it as a bare value, and `request_changes` keeps its control.

## Task Commits

1. **Task 1: confirm the floor** - no commit (decision checkpoint, answered by the owner)
2. **Task 2: the deriver** - `b29c2ad` (test), `41ab897` (feat)
3. **Task 3: trigger points, F5 deleted** - `1510506` (test), `2606840` (feat)
4. **Task 4: StatusPicker deleted** - `2b33078` (test), `f5ca08b` (feat)

**Plan metadata:** the docs commit that carries this file.

### TDD Gate Compliance

- **Task 2 RED is a compile failure**, and is stated as the legitimate new-module exception rather than
  faked: `core::status_derivation` did not exist, so `tests/status_derivation.rs` could not build before the
  module did. GREEN: 19 tests pass.
- **Tasks 3 and 4 RED were established from the pre-change source, not by running the old tree.** At the
  commit each test sits on, `agent_run.rs:233` still held the raw write, `ensure_worktree` did not derive, and
  `StatusPicker.tsx` still existed with four importers. A second full relink of the ~125 test binaries to
  watch them fail was judged more expensive than the evidence. This is a weaker RED than an executed one.

## Files Created/Modified

- `packages/core/src/status_derivation.rs` - the deriver
- `packages/core/src/forge/transitions.rs` - hands the status question to the deriver; header rewritten
- `packages/core/src/domain/worktree.rs` - derives at create and at remove, in the owning transaction
- `packages/core/src/domain/agent_run.rs` - the raw write and its event deleted
- `packages/desktop/src-tauri/src/scheduler.rs` - cold tick derives per tracked worktree
- `packages/core/tests/status_derivation.rs` (19 tests), `no_agent_status_write.rs` (8 tests)
- Renderer: `BoardRow`, `BoardView`, `CommandPalette`, `ItemDetailPanel`, `useBoardQuery`, `keyboard.ts`,
  `uiStore.ts` lose every status-setting route; `StatusPicker.tsx` and `DoneWarning.tsx` are deleted.

## Decisions Made

See `key-decisions`. In short: stay-lowered (owner), hybrid level/edge, a three-way `Derivation`, a worktree
read only where it can matter, and a git read error counted as "not shown to exist".

## Deviations from Plan

### Owner-resolved

**1. [Plan contradiction] Task 2 behaviour case 9 superseded by D-11** - see "Task 1" above. The plan
signature `derive_status_in_tx(tx, task_id, actor_id, expected_status)` therefore gained a fifth parameter,
`review_edge: bool`, and returns `Derivation` instead of `Option<String>`.

### Auto-fixed Issues

**2. [Rule 3 - Blocking] Existing tests encoded the old attribution and the old "idle until observed" state**
- **Found during:** Task 2 and Task 3
- **Issue:** `agent_tracer.rs` asserted the in-progress move was attributed to the agent actor; two
  `forge_live_chain.rs` cases asserted a task with a real worktree stayed `todo`. Both described exactly the
  behaviour this plan deletes (an agent-attributed write; a card with a worktree sitting at `todo`).
- **Fix:** `agent_tracer` now asserts one derived move attributed to the human who started the work and none
  to the agent; the two chain cases assert `in_progress`.
- **Files modified:** `packages/core/tests/agent_tracer.rs`, `packages/core/tests/forge_live_chain.rs`
- **Committed in:** `2606840`, `41ab897`

**3. [Rule 3 - Blocking] A cascade of renderer tests and one `?raw` source read depended on DoneWarning and
the picker**
- **Found during:** Task 4
- **Issue:** `DoneWarning` was reachable only through the picker's move to Done, so it is dead; five other
  files imported it or read its source, and `PickerKind`/`ActionId`/`pendingDone` carried a status member used
  as the example value in four layer tests.
- **Fix:** removed `pendingDone` from the layer model, re-pointed the layer tests at `"priority"`, dropped
  the four source assertions and two browser-arm cases about `DoneWarning`, and removed the `s` letter from
  the keyboard-agent letter list. `.detail-value-control` CSS went with its only control.
- **Verification:** `vitest run` 89 files / 1466 tests pass (baseline 90 / 1481, the difference being the
  deleted subjects); `tsc --noEmit` shows only the two pre-existing `brand-rule.test.ts` errors.

**Total deviations:** 1 owner-resolved, 2 auto-fixed (Rule 3). **Impact:** no scope creep; each change is a
direct consequence of D-09, D-13 or D-19.

### `DoneWarning.tsx` verdict (required by Task 4)

**Deleted.** Evidence: it was rendered from exactly one place, `BoardView`'s `pendingDone`, and `pendingDone`
was set from exactly one place, `requestStatusChange`, called only by the picker's `onSelect` and the detail
panel's `onSetStatus`. With both gone nothing can raise it. It is not reachable from `request_changes` or the
review surface.

## Issues Encountered

- **`cargo test -p core` with a space-joined `$T` in zsh passes one argument, not many.** The first
  scoped run (60 min) executed every test binary with a filter that matched nothing, so it proved nothing and
  was discarded. Re-run with an argument array: 53 test binaries, 832 passed, 1 failed. The failure is
  `worktree_lifecycle::a_worktree_survives_two_runs_with_an_epic`, a pre-existing race on the process-wide
  `FLYWHEEL_WORKTREE_ROOT` (both tests set it with no lock); it passes 3/3 with `RUST_TEST_THREADS=1`.
  Logged in `deferred-items.md`.
- `cargo check --workspace` passes. The one warning (an unused field on `StartRunOutcome` in the desktop
  crate) is not from this plan.

## Needs a decision (not blocking this plan)

- **Epic status is now frozen.** `StatusPicker.tsx` served epics as well as tasks, and D-19 deletes it
  without saying what epics do instead. Nothing in the renderer now moves an epic's status. See
  `deferred-items.md` (13-07). This is the one consequence of the plan the owner may not have intended.
- **`task_set_status` and `epic_set_status` remain registered Tauri commands.** No renderer code calls them
  now, but they are still IPC-reachable. Removal is outside this plan's file list.

## Known Stubs

None.

## Threat Flags

None. Nothing new reaches the network, auth, or a trust boundary; one write path was removed.

## User Setup Required

None - no external service configuration required.

## Next Phase Readiness

- 13-08 onwards can rely on `tasks.status` having one writer and on `backlog` meaning only "proposed".
- The browser-arm tests (`vitest.browser*.config.ts`) were edited for the deletions but not run: they need a
  real WebKit and are excluded from `vitest run`.

## Self-Check: PASSED

- Created files exist: `status_derivation.rs`, `tests/status_derivation.rs`, `tests/no_agent_status_write.rs`.
- Deleted files are gone from the index: `StatusPicker.tsx`, `DoneWarning.tsx`, `done-warning.test.tsx`.
- All six commits are in `git log` on this branch (`b29c2ad`, `41ab897`, `1510506`, `2606840`, `2b33078`,
  `f5ca08b`); `commits: 6` was measured with `git rev-list --count` from the persisted ledger.
- Acceptance greps: raw `UPDATE tasks SET status` outside `task.rs` = 0; `agent_run.rs` "status" 76 -> 63 and
  no `task.status_changed` there; `derive_status_in_tx` in `worktree.rs` = 3, in `scheduler.rs` = 1; cron/job
  count 7 -> 7; `BAND_ORDER` declared once; no `FROM worktrees` in the deriver.
- `spine_pin` (4), `pm_vocabulary_gate` (4), `dispatch_auto_merge` (64), `change_flags` (10),
  `status_derivation` (19), `no_agent_status_write` (8) all pass.

---
*Phase: 13-nothing-new-escapes-the-fence*
*Completed: 2026-10-15*
