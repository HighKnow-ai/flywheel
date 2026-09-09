---
phase: 01-the-board-is-the-store-of-record
verified: 2026-09-09T23:10:00Z
status: human_needed
score: 17/17 must-haves verified
covered_files:
  - ".planning/REQUIREMENTS.md"
  - ".planning/phases/01-the-board-is-the-store-of-record/01-01-PLAN.md"
  - ".planning/phases/01-the-board-is-the-store-of-record/01-01-SUMMARY.md"
  - ".planning/phases/01-the-board-is-the-store-of-record/01-02-PLAN.md"
  - ".planning/phases/01-the-board-is-the-store-of-record/01-02-SUMMARY.md"
  - ".planning/phases/01-the-board-is-the-store-of-record/01-03-PLAN.md"
  - ".planning/phases/01-the-board-is-the-store-of-record/01-03-SUMMARY.md"
  - ".planning/phases/01-the-board-is-the-store-of-record/01-04-PLAN.md"
  - ".planning/phases/01-the-board-is-the-store-of-record/01-04-SUMMARY.md"
  - ".planning/phases/01-the-board-is-the-store-of-record/01-05-PLAN.md"
  - ".planning/phases/01-the-board-is-the-store-of-record/01-05-SUMMARY.md"
  - ".planning/phases/01-the-board-is-the-store-of-record/01-06-PLAN.md"
  - ".planning/phases/01-the-board-is-the-store-of-record/01-06-SUMMARY.md"
  - ".planning/phases/01-the-board-is-the-store-of-record/01-07-PLAN.md"
  - ".planning/phases/01-the-board-is-the-store-of-record/01-07-SUMMARY.md"
  - ".planning/phases/01-the-board-is-the-store-of-record/01-08-PLAN.md"
  - ".planning/phases/01-the-board-is-the-store-of-record/01-08-SUMMARY.md"
  - ".planning/phases/01-the-board-is-the-store-of-record/01-09-PLAN.md"
  - ".planning/phases/01-the-board-is-the-store-of-record/01-09-SUMMARY.md"
  - ".planning/phases/01-the-board-is-the-store-of-record/01-10-PLAN.md"
  - ".planning/phases/01-the-board-is-the-store-of-record/01-10-SUMMARY.md"
  - ".planning/phases/01-the-board-is-the-store-of-record/01-11-PLAN.md"
  - ".planning/phases/01-the-board-is-the-store-of-record/01-11-SUMMARY.md"
  - ".planning/phases/01-the-board-is-the-store-of-record/01-12-PLAN.md"
  - ".planning/phases/01-the-board-is-the-store-of-record/01-12-SUMMARY.md"
  - ".planning/phases/01-the-board-is-the-store-of-record/01-13-PLAN.md"
  - ".planning/phases/01-the-board-is-the-store-of-record/01-13-SUMMARY.md"
  - ".planning/phases/01-the-board-is-the-store-of-record/01-14-PLAN.md"
  - ".planning/phases/01-the-board-is-the-store-of-record/01-14-SUMMARY.md"
  - ".planning/phases/01-the-board-is-the-store-of-record/01-15-PLAN.md"
  - ".planning/phases/01-the-board-is-the-store-of-record/01-15-SUMMARY.md"
  - ".planning/phases/01-the-board-is-the-store-of-record/01-CONTEXT.md"
  - ".planning/phases/01-the-board-is-the-store-of-record/01-RESEARCH.md"
  - ".planning/phases/01-the-board-is-the-store-of-record/01-REVIEW-FIX.md"
  - ".planning/phases/01-the-board-is-the-store-of-record/01-REVIEW.md"
  - ".planning/phases/01-the-board-is-the-store-of-record/01-UAT.md"
  - ".planning/phases/01-the-board-is-the-store-of-record/01-UI-SPEC.md"
  - "DESIGN.md"
  - "packages/core/Cargo.toml"
  - "packages/core/src/db/backup.rs"
  - "packages/core/src/db/migrations/0002_board_schema.sql"
  - "packages/core/src/db/mod.rs"
  - "packages/core/src/domain/acceptance_criterion.rs"
  - "packages/core/src/domain/actor.rs"
  - "packages/core/src/domain/epic.rs"
  - "packages/core/src/domain/event.rs"
  - "packages/core/src/domain/issue.rs"
  - "packages/core/src/domain/mod.rs"
  - "packages/core/src/domain/project.rs"
  - "packages/core/src/domain/task.rs"
  - "packages/core/src/lib.rs"
  - "packages/core/src/marker.rs"
  - "packages/core/src/query/events.rs"
  - "packages/core/src/query/filter.rs"
  - "packages/core/src/query/mod.rs"
  - "packages/core/src/query/search.rs"
  - "packages/core/src/ranking.rs"
  - "packages/core/tests/activity_trail.rs"
  - "packages/core/tests/bin/crash_harness.rs"
  - "packages/core/tests/common/mod.rs"
  - "packages/core/tests/crash_safety.rs"
  - "packages/core/tests/criteria.rs"
  - "packages/core/tests/cursor_resume.rs"
  - "packages/core/tests/db_bootstrap.rs"
  - "packages/core/tests/fixtures/README.md"
  - "packages/core/tests/hierarchy_workflow.rs"
  - "packages/core/tests/migration_safety.rs"
  - "packages/core/tests/outbox.rs"
  - "packages/core/tests/perf_seed_1000.rs"
  - "packages/core/tests/project_reconciliation.rs"
  - "packages/core/tests/ranking.rs"
  - "packages/core/tests/search_filter.rs"
  - "packages/desktop/package-lock.json"
  - "packages/desktop/package.json"
  - "packages/desktop/src-tauri/Cargo.toml"
  - "packages/desktop/src-tauri/capabilities/default.json"
  - "packages/desktop/src-tauri/src/commands/actor.rs"
  - "packages/desktop/src-tauri/src/commands/board.rs"
  - "packages/desktop/src-tauri/src/commands/criterion.rs"
  - "packages/desktop/src-tauri/src/commands/epic.rs"
  - "packages/desktop/src-tauri/src/commands/events.rs"
  - "packages/desktop/src-tauri/src/commands/issue.rs"
  - "packages/desktop/src-tauri/src/commands/mod.rs"
  - "packages/desktop/src-tauri/src/commands/project.rs"
  - "packages/desktop/src-tauri/src/commands/task.rs"
  - "packages/desktop/src-tauri/src/main.rs"
  - "packages/desktop/src-tauri/src/menu.rs"
  - "packages/desktop/src-tauri/src/state.rs"
  - "packages/desktop/src/App.css"
  - "packages/desktop/src/App.tsx"
  - "packages/desktop/src/adapters/tauri.ts"
  - "packages/desktop/src/board/BoardRow.tsx"
  - "packages/desktop/src/board/BoardView.tsx"
  - "packages/desktop/src/board/CommandPalette.tsx"
  - "packages/desktop/src/board/DeleteConfirm.tsx"
  - "packages/desktop/src/board/DoneWarning.tsx"
  - "packages/desktop/src/board/FilterBar.tsx"
  - "packages/desktop/src/board/FirstRun.tsx"
  - "packages/desktop/src/board/IssuesLane.tsx"
  - "packages/desktop/src/board/QuickAdd.tsx"
  - "packages/desktop/src/board/StatusBand.tsx"
  - "packages/desktop/src/board/__tests__/board-view.test.tsx"
  - "packages/desktop/src/board/__tests__/epic-assign.test.tsx"
  - "packages/desktop/src/board/__tests__/filter.test.tsx"
  - "packages/desktop/src/board/__tests__/first-run.test.tsx"
  - "packages/desktop/src/board/__tests__/issue-parent.test.tsx"
  - "packages/desktop/src/board/__tests__/keyboard-nav.test.tsx"
  - "packages/desktop/src/board/__tests__/layer-guard.test.tsx"
  - "packages/desktop/src/board/__tests__/palette.test.tsx"
  - "packages/desktop/src/board/__tests__/reorder.test.tsx"
  - "packages/desktop/src/board/__tests__/workflow.test.tsx"
  - "packages/desktop/src/board/collapseStore.ts"
  - "packages/desktop/src/board/pickers/AssigneePicker.tsx"
  - "packages/desktop/src/board/pickers/EstimatePicker.tsx"
  - "packages/desktop/src/board/pickers/ParentPicker.tsx"
  - "packages/desktop/src/board/pickers/PriorityPicker.tsx"
  - "packages/desktop/src/board/pickers/StatusPicker.tsx"
  - "packages/desktop/src/board/useBoardQuery.ts"
  - "packages/desktop/src/item-detail/AcceptanceCriteriaList.tsx"
  - "packages/desktop/src/item-detail/ActivityTrail.tsx"
  - "packages/desktop/src/item-detail/ItemDetailPanel.tsx"
  - "packages/desktop/src/item-detail/__tests__/activity-trail.test.tsx"
  - "packages/desktop/src/item-detail/__tests__/criteria.test.tsx"
  - "packages/desktop/src/legend/Legend.tsx"
  - "packages/desktop/src/legend/marks.ts"
  - "packages/desktop/src/projects/ProjectRail.tsx"
  - "packages/desktop/src/projects/ProjectUnreachable.tsx"
  - "packages/desktop/src/projects/RegisterProjectFlow.tsx"
  - "packages/desktop/src/projects/__tests__/project-rail.test.tsx"
  - "packages/desktop/src/projects/__tests__/register-project-flow.test.tsx"
  - "packages/desktop/src/state/keyboard.ts"
  - "packages/desktop/src/state/uiStore.ts"
  - "packages/desktop/src/test/setup.ts"
covered_digest: "v1:sha256:932815197029c560a95b0d8b17c3f39a1dac911cea0c18a492ef038012847a87"
behavior_unverified: 0
overrides_applied: 0
re_verification:
  previous_status: human_needed
  previous_score: 17/17
  gaps_closed:
    - "G-01-EPIC-ASSIGN — BOARD-01's fixed three-level hierarchy was structurally unreachable from the UI (found by live UAT after the previous verification pass): task epic assignment (task_set_epic + m keystroke + ParentPicker + palette Set Epic) and issue parenting (issue_set_parent + IssuesLane parent button + grouped ParentPicker + quick-add Tab nesting) are now both wired end to end, and both creation paths carry the parent id through instead of dropping it"
    - "G-01-FOCUS — global keyboard shortcuts fired while the item detail panel held a trapped focus scope: a shared topLayer()/bindingAllowedInLayer() guard in state/keyboard.ts now gates every global binding and the board-list container's own key handler"
    - "CR-01 (post-gap-closure code review) — create_issue could silently hold both epic_id and task_id at once, contradicting the single-parent invariant IssueParent documents; fixed by making the combination unrepresentable at the type level (IssueParent::from_ids)"
    - "CR-02 (post-gap-closure code review) — IssuesLane's new parent-picker button opened a trapped FocusScope via a raw onClick, bypassing the very layer guard G-01-FOCUS built; fixed by gating the click handler behind the same topLayer()/bindingAllowedInLayer() computation the keyboard paths use"
    - "WR-01 (post-gap-closure code review) — useRegistrationErrorNotice's error message never cleared after a successful retry; fixed by explicitly clearing the message when isError flips back to false"
    - "WR-02 (post-gap-closure code review) — IssueParent::parse silently discarded a parent_id supplied without a parent_kind, treating it as a silent detach; fixed by rejecting the combination as a malformed request"
  gaps_remaining: []
  regressions: []
human_verification:
  - test: "Launch a real `tauri dev` build and, with the mouse untouched, exercise the newly-built hierarchy UI specifically: select a task and press `m` to open the epic picker, assign and clear an epic; open an issue row's parent button (Tab-reachable, not click) and set/change/detach its parent through the grouped Epics/Tasks menu; open the item detail panel and confirm Cmd-N/Cmd-Shift-N/Cmd-F/bare `/`/Cmd-1..9/Cmd-Shift-O are all inert while it is open, and Cmd-K still opens the palette over it without stealing focus."
    expected: "Every action completes with no perceptible lag or visual jank; the epic pill and issue parent button show real key/title values, not placeholders; no global shortcut ever lands typed input in the wrong surface while the detail panel is trapped; clicking a different issue's parent button while the detail panel is open does nothing (CR-02's fix) rather than opening a second trapped picker."
    why_human: "This exact UI did not exist when the phase's one live UAT round ran (01-UAT.md, test 2's 'visual read' predates plans 01-12 through 01-15 and is what surfaced G-01-EPIC-ASSIGN/G-01-FOCUS in the first place) and no live tauri dev session has run since. All of it is proven by 114 passing Rust tests and 89 passing Vitest tests (including layer-guard.test.tsx's two new click-path regression tests for CR-02), independently re-run fresh in this session, plus direct reads of every changed line — but the felt, running-window experience of this specific new surface has never been observed."
  - test: "With a project seeded past 1,000 items (no seed tooling exists yet per 01-UAT.md's own note), reorder, filter, search, and switch projects with the mouse untouched throughout."
    expected: "No perceptible lag or visual jank at volume."
    why_human: "Carried forward unchanged from the initial verification and from 01-UAT.md's test 1, which explicitly recorded this volume clause as not exercised ('Board held 1 project / 1 task / 1 issue'). Server-side latency at 1,000 items is proven by `perf_seed_1000.rs` (search under 50ms, composite index confirmed used), re-run fresh and passing in this session, but perceived UI lag at that volume has never been observed in a running window."
---

# Phase 1: The Board Is The Store Of Record Verification Report

**Phase Goal:** Cyril runs his real project structure on Flywheel's board — epics, tasks with
individually checkable acceptance criteria, and a workflow he cannot bend — and it is still
exactly there after a crash.

**Verified:** 2026-09-09T23:10:00Z
**Status:** human_needed
**Re-verification:** Yes — after gap closure (G-01-EPIC-ASSIGN, G-01-FOCUS) and a subsequent
post-gap-closure code review (CR-01, CR-02, WR-01, WR-02), all four review findings fixed.

## Goal Achievement

This re-verification covers ground the prior `01-VERIFICATION.md` (dated earlier the same day)
could not: after that pass, a live UAT round (`01-UAT.md`) drove a real `tauri dev` build and
found the fixed three-level hierarchy structurally unreachable (`G-01-EPIC-ASSIGN`) and global
keyboard shortcuts leaking through the item detail panel's trapped focus scope
(`G-01-FOCUS`). Four gap-closure plans (01-12 through 01-15) closed both, a code review of that
diff (`01-REVIEW.md`) found two further Critical defects and two Warnings that survived into the
closure work itself, and a fix pass (`01-REVIEW-FIX.md`) closed all four. Every claim below was
checked directly against the code and by independently re-running both test suites and both
builds in this session — not accepted from `SUMMARY.md`, the review report, or the fix report's
own narration.

**G-01-EPIC-ASSIGN — genuinely closed.** Read `packages/core/src/domain/task.rs::set_epic` and
`packages/core/src/domain/issue.rs::set_parent`/`IssueParent` in full: both run inside a
transaction, both call the shared `assert_parent_in_project` before writing, and `set_parent`
derives `epic_id`/`task_id` from a single enum variant so a two-parent row cannot be
constructed. `task_set_epic`/`issue_set_parent` are registered in `main.rs`'s
`generate_handler!` with the exact snake_case parameter names Tauri auto-converts to the
camelCase (`taskId`/`epicId`, `issueId`/`parentKind`/`parentId`) the frontend hooks
(`useSetTaskEpic`, `useSetIssueParent` in `useBoardQuery.ts`) send — confirmed by reading both
sides of the boundary, not by trusting a mocked `invoke`. `useCreateTask`/`useCreateIssue` now
thread `epicId`/`epicId`+`taskId` through `task_create`/`issue_create` instead of dropping them
(the first of G-01-EPIC-ASSIGN's three root causes). `m` opens `ParentPicker` for a selected task
(`BoardView.tsx`); every issue row renders a Tab-reachable parent button (`IssuesLane.tsx`) that
opens the same picker with grouped Epics/Tasks options. `REQUIREMENTS.md`'s BOARD-01 line is
reticked with no gap parenthetical. `epic-assign.test.tsx` (7 tests) and `issue-parent.test.tsx`
(10 tests) were both re-run individually in this session and pass.

**G-01-FOCUS — genuinely closed.** `state/keyboard.ts` gained a pure `topLayer()`/
`bindingAllowedInLayer()` model, consulted by `useGlobalBindings` (every global keystroke) and by
`BoardView.tsx`'s board-list container handler — replacing five independently-guarded call sites
with one shared decision. `ItemDetailPanel.tsx` takes an optional `trapped` prop so the palette
can render over the panel without two trapped `FocusScope`s. `layer-guard.test.tsx` (10 tests)
covers every named G-01-FOCUS instance via `fireEvent.keyDown` against a live DOM, re-run
individually in this session and passing.

**CR-01 (create_issue's single-parent invariant) — genuinely closed.** `IssueParent::from_ids`
(new) rejects `(Some(epic), Some(task))` before `create_issue` is ever called; `issue_create`
(the Tauri command) calls it before locking the connection. Read `create_issue`'s signature
directly: it now takes one `parent: IssueParent` argument, not two independent `Option`s — the
invalid state is unrepresentable at the type level, not merely unchecked. The regression test
`create_issue_rejects_both_an_epic_id_and_a_task_id_supplied_together` was run individually
(`cargo test -p core --test hierarchy_workflow ... --exact`) and passes. **Deliberately not
added:** a schema-level `CHECK (epic_id IS NULL OR task_id IS NULL)` — confirmed absent from
`0002_board_schema.sql` by direct read. This is a reasonable, disclosed deferral: SQLite has no
`ALTER TABLE ADD CONSTRAINT`, so adding it now would require a full table-recreate migration, and
the type-level fix already closes the gap for every code-layer caller (core-layer callers and the
one Tauri command can no longer construct the invalid state). Only a hand-crafted raw SQL insert
bypassing the Rust layer entirely could still violate it — no such caller exists today. Agreed
sufficient for this phase; worth revisiting as defence-in-depth if an out-of-process writer is
ever added.

**CR-02 (IssuesLane's unguarded parent-picker click) — genuinely closed.** Read
`BoardView.tsx`'s `onOpenParentPicker` callback directly: it now computes `topLayer(...)` from
`paletteOpen`/`detailItemId`/`activePicker`/`deleteTarget`/`pendingDone`/`quickAddOpen` and
returns early unless the layer is `"board"` or `"quick-add"` — the identical check
`handleContainerKeyDown` already uses for every keyboard-driven picker. Two new tests in
`layer-guard.test.tsx` — the negative case (detail panel open, click does nothing) and the
positive case (nothing else open, click still works) — were run individually in this session and
pass; this is the first test coverage in that file exercising a click path rather than
`fireEvent.keyDown`, closing the exact blind spot the review found.

**WR-01 (stale registration error notice) — genuinely closed.** Read
`useRegistrationErrorNotice` directly: the effect's `if (!isError)` branch now explicitly calls
`setMessage(null)` before returning, instead of returning without clearing. The new
`register-project-flow.test.tsx` (3 tests, previously zero coverage for this hook) was run as
part of the full suite and passes.

**WR-02 (IssueParent::parse silently discarding a bare parent_id) — genuinely closed.** Read the
`parse` match directly: `(None, Some(_))` is now `Err(...)`, not folded into the `(None, _) =>
Ok(Self::None)` catch-all. `parse_rejects_parent_id_without_parent_kind` and five sibling tests
(previously zero unit tests on `parse`) were run as part of the full suite and pass.

**Both test suites were re-run fresh and independently in this session** (not carried forward
from the fix report's own counts): `cargo test --workspace` — 114 tests across 17 binaries, 0
failed. `npm --prefix packages/desktop run test -- --run` — 89 tests across 17 files, 0 failed,
matching `01-REVIEW-FIX.md`'s claimed post-fix count exactly. `cargo build --workspace` and `npm
--prefix packages/desktop run build` were also independently re-run and both succeeded with no
new warnings beyond the pre-existing chunk-size notice.

No debt markers (`TBD`/`FIXME`/`XXX`/`TODO`/`HACK`/`PLACEHOLDER`) were found in any of the 27
files touched between the gap-closure plan doc (`ab8326f`) and the fix-report commit (`cebfb4e`).

**What remains deliberately open, correctly not treated as a regression or a new gap:**
`tauri.conf.json`'s `"csp": null` is unchanged; `DoneWarning.tsx` still renders `"{checked}/
{total} criteria unchecked"`, faithfully matching `01-UI-SPEC.md`'s own defective Copywriting
Contract; the epic/task-filter and parent-option lists (`FilterBar.tsx`'s epic chips, the new
`ParentPicker`/quick-add indent target) are all still derived from the loaded board window rather
than a dedicated `epic_list`/`task_list` command — `01-15-SUMMARY.md` explicitly discloses this
as sharing one root cause with the pre-existing `FilterBar.tsx` limitation. None of these were
silently fixed or silently reintroduced; all were checked by direct read against their prior
state.

### Observable Truths

| # | Truth | Status | Evidence |
|---|-------|--------|----------|
| 1 | DATA-01 — every mutation writes projection + event in one transaction | ✓ VERIFIED | Unchanged; re-confirmed present in `task::set_epic`/`issue::set_parent`/`create_issue` reads this session, all inside one `tx` |
| 2 | DATA-02 — every entity id is a client-generated ULID, never an auto-increment int | ✓ VERIFIED | Unchanged; `db_bootstrap.rs` in this session's fresh 114-test run |
| 3 | DATA-03 — humans and agents are distinct actors of one model, every mutation actor-attributed | ✓ VERIFIED | Unchanged |
| 4 | DATA-05 — the event log is a gap-free, no-duplicate, resumable stream from a cursor | ✓ VERIFIED | Unchanged; `cursor_resume.rs` in this session's fresh run |
| 5 | DATA-07 — the database survives an unclean termination with no loss/corruption of committed work | ✓ VERIFIED | Unchanged; `crash_safety.rs` real `SIGKILL` test still passes; UAT test 3 confirmed this live (pre-kill/post-relaunch snapshots identical) |
| 6 | DATA-08 — migrations run automatically on launch and are reversible within one version | ✓ VERIFIED | Unchanged; `migration_safety.rs` in this session's fresh run |
| 7 | BOARD-01a — user creates/edits epics, tasks, issues in a fixed, non-reconfigurable 3-level hierarchy | ✓ VERIFIED | Unchanged mechanism |
| 8 | BOARD-01b — a task can be placed under an epic, and an issue under an epic or task, from the running UI | ✓ **VERIFIED (G-01-EPIC-ASSIGN closed)** | `task_set_epic`/`issue_set_parent` genuinely wired end to end (keystroke/button → mutation → command → domain), confirmed by direct code read on both sides of the Tauri boundary; 17 new tests across `epic-assign.test.tsx`/`issue-parent.test.tsx` run individually and pass |
| 9 | BOARD-01c — an issue can never hold both an epic and a task parent at once, at creation or reparenting | ✓ **VERIFIED (CR-01 closed)** | `IssueParent::from_ids` rejects the combination before `create_issue` is called; `create_issue`'s signature makes the invalid state unrepresentable; regression test run individually and passes; schema-level `CHECK` deliberately deferred, agreed sufficient given the type-level fix |
| 10 | BOARD-02 — discrete, individually checkable acceptance criteria (statement + verification hint), not free prose | ✓ VERIFIED | Unchanged |
| 11 | BOARD-04 — fixed Backlog→Todo→In Progress→In Review→Done workflow, no reconfiguration path | ✓ VERIFIED | Unchanged |
| 12 | BOARD-05 — reorder/reprioritize within an epic and within the backlog (fractional rank, priority tie-break) | ✓ VERIFIED | Unchanged |
| 13 | BOARD-06 — filter/search by text, status, epic, assignee as indexed SQL, no second client-side filter path | ✓ VERIFIED | Unchanged; single-window epic/task-option limitation still known/disclosed, not a regression |
| 14 | BOARD-07a — every navigational and mutating action reachable entirely from the keyboard | ✓ VERIFIED (mechanism) | Unchanged; full live walkthrough not run — see Human Verification |
| 15 | BOARD-07b — global shortcuts are inert while the item detail panel or a row-level picker holds a trapped focus scope, including click-opened pickers | ✓ **VERIFIED (G-01-FOCUS + CR-02 closed)** | Shared `topLayer()`/`bindingAllowedInLayer()` guard read directly, consulted by every `useGlobalBindings` binding, the board-list container, and (after CR-02's fix) the new click-driven `IssuesLane` parent button; 12 regression tests (10 keyboard-path + 2 click-path) run individually and pass |
| 16 | BOARD-08 — board interactions complete without perceptible lag at 1,000+ items | ✓ VERIFIED (server) | Unchanged; `perf_seed_1000.rs` re-run fresh, passing; perceived UI lag at volume not run live — see Human Verification |
| 17 | BOARD-09 — every item shows a chronological, actor-attributed activity trail | ✓ VERIFIED (mechanism) | Unchanged; UAT test 2 confirmed the visual direction live (rack/legend/trail/pill) prior to this round's UI additions |
| 18 | BOARD-10 — user registers several local git repos as projects and switches boards, with rejected registrations surfaced (not silently swallowed), including after a successful retry | ✓ **VERIFIED (WR-01 closed)** | `useRegistrationErrorNotice` wired into all three previously-fragile entry points; WR-01's stuck-notice-after-retry bug fixed and covered by 3 new tests, re-run and passing |

**Score:** 18/18 truths verified (0 present-behavior-unverified). One truth (#9) was newly split
out of the prior round's BOARD-01 truth because CR-01 specifically concerns a correctness
invariant the prior verification pass had no visibility into.

### Required Artifacts

| Artifact | Expected | Status | Details |
|----------|----------|--------|---------|
| `packages/core/src/domain/task.rs` (`set_epic`) | Reparent/orphan a task's epic, no-op on redundant call, same-project check | ✓ **VERIFIED** | Read in full; transactional, calls `assert_parent_in_project`, no-ops correctly |
| `packages/core/src/domain/issue.rs` (`IssueParent`, `set_parent`, `from_ids`, `parse`) | Single-parent-at-a-time reparenting; creation-path invariant unrepresentable; malformed pairs rejected | ✓ **VERIFIED** | Read in full; both CR-01 and WR-02 fixes present and match the review-fix report exactly |
| `packages/desktop/src-tauri/src/commands/task.rs`/`issue.rs` (`task_set_epic`, `issue_set_parent`, `issue_create`) | Registered Tauri commands with argument names matching the frontend hooks | ✓ **VERIFIED** | Registered in `main.rs`'s `generate_handler!`; parameter names verified to camelCase-match `useSetTaskEpic`/`useSetIssueParent`/`useCreateIssue` |
| `packages/desktop/src/board/pickers/ParentPicker.tsx` | Generic id/label/group option picker, reused for both epic and issue-parent kinds | ✓ **VERIFIED** | Exists, exports confirmed, used by both `BoardView.tsx` picker-render arms |
| `packages/desktop/src/board/IssuesLane.tsx` | Focusable parent button per issue row | ✓ **VERIFIED** | Renders button with `aria-label`, calls `onOpenParentPicker`, layer-guarded at the call site (CR-02 fix) |
| `packages/desktop/src/state/keyboard.ts` (`topLayer`, `bindingAllowedInLayer`) | Single shared fire/do-not-fire decision for every global binding and click-driven picker | ✓ **VERIFIED** | Consulted by `useGlobalBindings`, `BoardView`'s container handler, and (post-CR-02) the `IssuesLane` parent-button click handler |
| `packages/desktop/src/projects/RegisterProjectFlow.tsx` (`useRegistrationErrorNotice`) | Clears its error message on a successful retry | ✓ **VERIFIED** | WR-01 fix present; explicit `setMessage(null)` on the `!isError` branch |
| `packages/core/src/db/migrations/0002_board_schema.sql` | No `CHECK` constraint preventing both `epic_id` and `task_id` on `issues` | ℹ️ Disclosed deferral | Confirmed absent by direct read; type-level fix covers all code-layer callers, agreed sufficient |
| `packages/core/src/db/mod.rs`, `db/backup.rs` | WAL pragmas, crash safety, backup/restore | ✓ VERIFIED | Unchanged |
| `packages/core/src/domain/event.rs`, `query/events.rs` | Append-only log, cursor-resumable stream | ✓ VERIFIED | Unchanged |
| `packages/core/src/ranking.rs` | Fractional-index reorder | ✓ VERIFIED | Unchanged |
| `packages/core/src/query/search.rs`, `query/filter.rs` | FTS5 search, indexed filter | ✓ VERIFIED | Unchanged |

### Key Link Verification

| From | To | Via | Status | Details |
|------|----|----|--------|---------|
| `desktop/src/board/BoardView.tsx` (`m` keystroke) | `task_set_epic` | `useSetTaskEpic` mutation | ✓ **NOW WIRED** | Argument names confirmed to match on both sides |
| `desktop/src/board/IssuesLane.tsx` (parent button) | `issue_set_parent` | `useSetIssueParent` mutation | ✓ **NOW WIRED** | Argument names confirmed to match on both sides |
| `desktop/src/board/useBoardQuery.ts` (`useCreateTask`/`useCreateIssue`) | `task_create`/`issue_create` | `epicId`/`epicId`+`taskId` now threaded through, not dropped | ✓ **NOW WIRED** | Confirmed by direct read of both mutation functions |
| `desktop/src/board/BoardView.tsx` (`onOpenParentPicker`) | `state/keyboard.ts::topLayer`/`bindingAllowedInLayer` | layer check before opening a trapped `FocusScope` via click | ✓ **NOW WIRED (CR-02 fix)** | Confirmed present at the exact call site the review flagged as missing it |
| `packages/core/src/domain/issue.rs::create_issue` | `IssueParent::from_ids` | rejects a two-parent request before the connection is locked | ✓ **NOW WIRED (CR-01 fix)** | `issue_create` Tauri command calls `from_ids` and propagates its error |
| `desktop/src-tauri/src/main.rs` | `core::db::open_and_migrate` | setup hook before any window shown | ✓ WIRED | Unchanged |
| `domain/task.rs` (create/delete/status/set_epic) | `domain/event.rs::append_event` | same transaction | ✓ WIRED | Unchanged, and confirmed again for `set_epic` this session |

### Requirements Coverage

| Requirement | Source Plan | Description | Status | Evidence |
|-------------|------------|--------------|--------|----------|
| DATA-01 | 01-03, 01-04 | Transactional outbox | ✓ SATISFIED | Truth #1 |
| DATA-02 | 01-01, 01-03 | Client-generated ULIDs | ✓ SATISFIED | Truth #2 |
| DATA-03 | 01-03, 01-04 | Distinct human/agent actor model | ✓ SATISFIED | Truth #3 |
| DATA-05 | 01-10 | Cursor-resumable event stream | ✓ SATISFIED | Truth #4 |
| DATA-07 | 01-05 | Crash-safe persistence | ✓ SATISFIED | Truth #5, UAT test 3 |
| DATA-08 | 01-01, 01-05 | Automatic, reversible migrations | ✓ SATISFIED | Truth #6 |
| BOARD-01 | 01-04, 01-12, 01-14, 01-15 | CRUD in fixed 3-level hierarchy, reachable from the UI, single-parent invariant | ✓ **SATISFIED (gap + review findings closed)** | Truths #7, #8, #9 all verified |
| BOARD-02 | 01-06 | Discrete checkable acceptance criteria | ✓ SATISFIED | Truth #10 |
| BOARD-04 | 01-04 | Fixed, non-reconfigurable workflow | ✓ SATISFIED | Truth #11 |
| BOARD-05 | 01-07 | Reorder/reprioritize | ✓ SATISFIED | Truth #12 |
| BOARD-06 | 01-08 | Filter/search across items | ✓ SATISFIED | Truth #13 |
| BOARD-07 | 01-02, 01-09, 01-13, 01-14 | Full keyboard operability, layer-gated global bindings | ? NEEDS HUMAN (mechanism satisfied) | Truths #14, #15 |
| BOARD-08 | 01-02, 01-08 | No perceptible lag at 1,000+ items | ? NEEDS HUMAN (server-side satisfied) | Truth #16 |
| BOARD-09 | 01-10 | Chronological actor-attributed activity trail | ? NEEDS HUMAN (mechanism satisfied; UAT test 2 confirmed visual direction pre-dating this round's UI additions) | Truth #17 |
| BOARD-10 | 01-11, 01-15 (WR-01) | Register/switch multiple project boards, no silently swallowed errors | ✓ SATISFIED | Truth #18 |

No orphaned requirements: the union of every plan's `requirements:` frontmatter (01-01 through
01-15) exactly matches the 15 IDs `REQUIREMENTS.md` assigns to Phase 1 (DATA-01, DATA-02,
DATA-03, DATA-05, DATA-07, DATA-08, BOARD-01, BOARD-02, BOARD-04, BOARD-05, BOARD-06, BOARD-07,
BOARD-08, BOARD-09, BOARD-10).

### Behavioral Spot-Checks

| Behavior | Command | Result | Status |
|----------|---------|--------|--------|
| Full Rust workspace test suite is green | `cargo test --workspace` (run fresh, this session) | 114 tests across 17 binaries, 0 failed | ✓ PASS |
| Full frontend test suite is green | `npm --prefix packages/desktop run test -- --run` (run fresh, this session) | 89 tests across 17 files, 0 failed | ✓ PASS |
| Full Rust workspace build is green | `cargo build --workspace` (run fresh, this session) | Finished, no errors | ✓ PASS |
| Full frontend build is green | `npm --prefix packages/desktop run build` (run fresh, this session) | `tsc && vite build` succeeded, no type errors | ✓ PASS |
| CR-01 regression test passes in isolation | `cargo test -p core --test hierarchy_workflow create_issue_rejects_both_an_epic_id_and_a_task_id_supplied_together -- --exact` | ok | ✓ PASS |
| CR-02 regression tests pass in isolation | `npx vitest run -t "clicking_the_issue_lane_parent_button"` | 2 passed | ✓ PASS |
| WR-01/epic-assign/issue-parent/layer-guard tests pass in isolation | `npx vitest run epic-assign issue-parent layer-guard` | 29 passed across 3 files | ✓ PASS |
| `task_set_epic`/`issue_set_parent` are registered and argument-matched | Direct read of `main.rs`'s `generate_handler!` plus both command signatures plus both frontend hooks | camelCase argument names match on both sides of the Tauri boundary | ✓ PASS |
| No schema `CHECK` constraint added for the single-parent invariant (disclosed deferral) | Direct read of `0002_board_schema.sql`'s `issues` table | Confirmed absent, as declared in `01-REVIEW-FIX.md` | ✓ PASS (deferral confirmed accurate) |
| No debt markers introduced between the gap-closure plan and the fix-report commit | `grep -n -E "TBD\|FIXME\|XXX\|TODO\|HACK\|PLACEHOLDER"` on all 27 files touched in that range | Zero hits | ✓ PASS |
| Deliberately-open items unchanged, not silently fixed or regressed | Direct read of `tauri.conf.json` (`csp: null`), `DoneWarning.tsx` (still `"{checked}/{total} ... unchecked"`) | Both unchanged, as declared | ✓ PASS |

### Probe Execution

Not applicable — no `scripts/*/tests/probe-*.sh` convention in this project.

### Anti-Patterns Found

| File | Line | Pattern | Severity | Impact |
|------|------|---------|----------|--------|
| `packages/desktop/src-tauri/tauri.conf.json`:23 | 23 | `"csp": null` — no Content-Security-Policy | ⚠️ Warning | Deliberately open by decision (needs a running window to verify safely); no live XSS vector today (plain-text titles only) |
| `packages/desktop/src/board/DoneWarning.tsx`:74 | 74 | Renders `"{checked}/{total} criteria unchecked"` — labels the CHECKED count as "unchecked" | ⚠️ Warning | Deliberately left untouched — the CONTRACT in `01-UI-SPEC.md` is the defect, not the code |
| `packages/core/src/db/migrations/0002_board_schema.sql` `issues` table | 79-92 | No `CHECK (epic_id IS NULL OR task_id IS NULL)` | ℹ️ Info | Deliberate, disclosed deferral (CR-01 fix report); type-level fix covers every code-layer caller today |
| `packages/desktop/src/board/pickers/ParentPicker.tsx` / `IssuesLane.tsx` parent button / quick-add indent target | — | Options/targets derived from the loaded board window, not a dedicated `epic_list`/`task_list` command | ℹ️ Info | Known, disclosed limitation shared with the pre-existing `FilterBar.tsx` epic-filter-chip limitation; not new scope |

No `TBD`/`FIXME`/`XXX`/`TODO`/`HACK`/`PLACEHOLDER` markers found in any of the 27 files touched
between the gap-closure plan doc and the fix-report commit.

### Human Verification Required

1. **Live confirmation of the new hierarchy and layer-guard UI (never observed in a running
   window)**
   **Test:** Launch a real `tauri dev` build. Select a task, press `m`, assign and clear an
   epic. Open an issue row's parent button (via Tab, not click) and set/change/detach its parent
   through the grouped Epics/Tasks menu. Open the item detail panel and confirm every global
   shortcut (Cmd-N, Cmd-Shift-N, Cmd-F, bare `/`, Cmd-1..9, Cmd-Shift-O) is inert while it is
   open, that Cmd-K still opens the palette over it without stealing focus, and that clicking a
   different issue's parent button while the panel is open does nothing.
   **Expected:** Every action completes with no perceptible lag or jank; the epic pill and issue
   parent button show real key/title values; no shortcut lands typed input in the wrong surface;
   the CR-02 click-path guard actually holds in a real DOM, not just jsdom.
   **Why human:** This UI did not exist when the phase's one live UAT round ran — `01-UAT.md`'s
   test 2 is what surfaced G-01-EPIC-ASSIGN and G-01-FOCUS in the first place, before plans 01-12
   through 01-15 and the code-review fixes existed. No live session has run since. 114 Rust tests
   and 89 Vitest tests (independently re-run fresh this session) prove the mechanism; the felt
   experience has not been observed.

2. **1,000+ item volume — perceived lag, still unexercised live**
   **Test:** With a project seeded past 1,000 items, reorder/filter/search/switch projects with
   the mouse untouched.
   **Expected:** No perceptible lag or jank at volume.
   **Why human:** Carried forward unchanged — `01-UAT.md`'s test 1 explicitly recorded this
   clause as not exercised (no seed tooling exists; the board held 1/1/1 items during that
   round). `perf_seed_1000.rs` proves server-side latency (re-run fresh, passing) but not
   perceived UI lag.

## Gaps Summary

None. Every item this re-verification was asked to check — the two UAT-discovered gaps
(G-01-EPIC-ASSIGN, G-01-FOCUS) and the four post-gap-closure code-review findings (CR-01, CR-02,
WR-01, WR-02) — was independently re-verified against the actual code in this session, not
accepted from any report's own narration:

- **G-01-EPIC-ASSIGN** is closed: both reparenting paths are wired end to end from keystroke/
  button through to the domain layer, both creation paths carry the parent id, and 17 new tests
  cover it.
- **G-01-FOCUS** is closed: one shared layer-guard function gates every global binding.
- **CR-01** is closed: the single-parent invariant is unrepresentable at the type level on the
  creation path, matching what `set_parent` already guaranteed on the reparenting path. The
  schema-level `CHECK` constraint alternative was deliberately not added — confirmed absent, and
  agreed to be a reasonable, disclosed deferral rather than a live hole, since no caller today can
  bypass the Rust layer.
- **CR-02** is closed: the exact click path the review found unguarded now goes through the same
  layer check every keyboard path already used, with new regression coverage for the specific
  blind spot (click, not keydown) that let it slip past the prior suite.
- **WR-01** and **WR-02** are both closed, each with new test coverage where none existed before.

Both test suites and both builds were independently re-run fresh in this session (114 Rust tests,
89 Vitest tests, 0 failures; both builds green) rather than trusted from any prior report's
counts, and every number matches what `01-REVIEW-FIX.md` claimed.

What remains is the live, running-window experience of the phase's newest surface area (the
hierarchy-assignment UI and the layer-guard click-path fix) plus the still-unexercised 1,000+
item volume clause carried forward from the original UAT round. Neither is a gap in the code —
both are reported as human-verification items, not rounded up to passed.

---

_Verified: 2026-09-09T23:10:00Z_
_Verifier: Claude (gsd-verifier)_
