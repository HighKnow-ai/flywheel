---
phase: 01-the-board-is-the-store-of-record
verified: 2026-09-10T02:00:54Z
status: gaps_found
score: 18/20 must-haves verified
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
  - ".planning/phases/01-the-board-is-the-store-of-record/01-16-PLAN.md"
  - ".planning/phases/01-the-board-is-the-store-of-record/01-16-SUMMARY.md"
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
  - "packages/desktop/src-tauri/src/commands/menu.rs"
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
  - "packages/desktop/src/board/__tests__/menu-bridge.test.tsx"
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
  - "packages/desktop/src/state/menuSync.ts"
  - "packages/desktop/src/state/uiStore.ts"
  - "packages/desktop/src/test/setup.ts"
covered_digest: "v1:sha256:257160dc839f60c6186e8fd8541963fbd3c76ff19c0b79f43d3728bdbc40c0a0"
behavior_unverified: 0
overrides_applied: 0
re_verification:
  previous_status: human_needed
  previous_score: 17/17
  gaps_closed:
    - "G-01-1 — native macOS menu accelerators (⌘N/⌘⇧N/⌘⇧O) owned the keystroke at the OS layer and the App.tsx menu:action bridge tore down the item-detail-panel layer before dispatching, bypassing the layer guard on a keystroke; plan 01-16 removed the pre-emptive returnToBoardLayer() call and made the native menu bar itself layer-aware (MenuHandles + menu_set_action_enabled + useMenuLayerSync)"
  gaps_remaining:
    - "G-01-2 — epic pill shows a raw ULID and the epic filter chip list is incomplete once a task's epic or the project's epic set falls outside the loaded board window (unaddressed this run — no gap-closure plan exists for it)"
  regressions: []
gaps:
  - truth: "Every task's epic pill shows a human-readable `KEY Title` (never a raw internal ULID), and the FilterBar's epic chip list covers every epic in the project, regardless of how many items or epics the project holds"
    status: failed
    reason: "Confirmed unresolved in the codebase this session (no plan touched these files since G-01-2 was logged in commit b365865). BoardView.tsx's epicsById and FilterBar.tsx's epicOptions are both still derived only from items in the currently loaded board_list page (capped at commands/board.rs's DEFAULT_LIMIT = 200), and BoardRow.tsx still falls back to rendering the raw item.epicId ULID when the lookup misses. On a seeded 1,067-item / 13-epic project this is empirically observed: 6 named rows render raw ULIDs and the filter bar offers only 4 of 13 epic chips."
    artifacts:
      - path: "packages/desktop/src/board/BoardView.tsx"
        issue: "epicsById (line ~258) is Object.fromEntries(items.filter(i => i.kind === \"epic\").map(...)) over the loaded window only — confirmed unchanged by direct read this session"
      - path: "packages/desktop/src/board/BoardRow.tsx"
        issue: "epicLabel (line ~120) falls back to the raw item.epicId ULID when epicsById[item.epicId] misses — confirmed unchanged by direct read this session"
      - path: "packages/desktop/src/board/FilterBar.tsx"
        issue: "epicOptions (lines ~81-88) is built by iterating the same windowed `items` array — confirmed unchanged by direct read this session"
      - path: "packages/desktop/src-tauri/src/commands/board.rs"
        issue: "DEFAULT_LIMIT = 200 bounds the window every one of the above derivations reads from — confirmed unchanged by direct read this session"
    missing:
      - "Resolve epic labels from the project's full epic set rather than the loaded page — a dedicated list-epics/epic_list command (epics are a small, bounded set unlike tasks) or have board_list return the referenced epics alongside the page"
      - "Replace BoardRow's raw-ULID fallback with a label that can never leak an internal id, even on a lookup miss"
      - "Apply the same fix to FilterBar's chip list and ParentPicker's parent options, which read the identical derivation"
      - "Add a regression test at a volume that exceeds DEFAULT_LIMIT — every existing test in the suite runs against a handful of rows, where this defect is structurally unreachable"
      - "A gap-closure plan for G-01-2 does not exist yet — 01-UAT.md logged it (commit b365865) but no plan claims gap_ids: [G-01-2]"
human_verification:
  - test: "Launch a real `tauri dev` build. With the item detail panel open, open the View menu with the mouse while the command palette is also open, and confirm Toggle Command Palette reads visually greyed (not merely refused-but-enabled); reopen the same detail panel and go straight to the File menu to observe whether Register Project.../New Task/New Epic are greyed on the first opening or only the second (the plan's accepted, bounded one-frame window)."
    expected: "Toggle Command Palette appears greyed while the palette is open and re-enables when it closes; File items are greyed on the first opening, or at worst the second, per plan 01-16's accepted-window design decision — never permanently enabled-and-dead."
    why_human: "01-16-SUMMARY.md's own coverage item D3 explicitly flags this as unverified: orca's computer-use provider on this host reports surfaces.menubar:false / surfaces.dialogs:false, so no available tool can click the real native menu bar or read a MenuItem's visual enabled/disabled state. The underlying accelerator-inertness bug (G-01-1's actual reported symptom) WAS confirmed live via real OS-level keystrokes and is not part of this item — only the visual greying affordance remains unconfirmed."
  - test: "With a project seeded past 1,000 items (seed tooling now exists per this session's observation of a 1,067-item board used to find G-01-2), reorder, filter, search, and switch projects with the mouse untouched throughout."
    expected: "No perceptible lag or visual jank at volume."
    why_human: "01-UAT.md's test 2 remains `result: [pending]` — never completed. Server-side latency at 1,000 items is proven by perf_seed_1000.rs (re-run fresh, passing, in this session), but perceived UI lag at volume has never been observed in a running window. Note this is now known to be entangled with G-01-2: the same 1,067-item board that would be used to test this is the one where the epic-pill/filter defect was found, so this check should be re-run only after G-01-2 is closed."
---

# Phase 1: The Board Is The Store Of Record Verification Report

**Phase Goal:** Cyril runs his real project structure on Flywheel's board — epics, tasks with
individually checkable acceptance criteria, and a workflow he cannot bend — and it is still
exactly there after a crash.

**Verified:** 2026-09-10T02:00:54Z
**Status:** gaps_found
**Re-verification:** Yes — this run executed `/gsd-execute-phase 01 --gaps-only`, which ran plan
01-16 (gap_closure: true, gap_ids: [G-01-1]) and nothing else. The prior `01-VERIFICATION.md`
(dated 2026-09-09T23:10Z, status `human_needed`) predates both 01-16 and the discovery of a
second, still-open UAT gap (G-01-2, logged in commit `b365865` after that verification ran).

## Goal Achievement

This re-verification independently confirmed 01-16's claim that G-01-1 is closed, and
independently confirmed — contrary to what a summary-only read might suggest — that **G-01-2 is
NOT closed** and has no gap-closure plan in this phase directory. Per the run's own escalation
context, this phase cannot be marked verified on the strength of 01-16 alone: 01-UAT.md still
records G-01-2 with `status: failed`, and UAT test 2 (1,000+ item volume) is still `result:
[pending]`.

**G-01-1 — genuinely closed, independently confirmed.** Read `App.tsx`'s `menu:action` handler
directly: the conditional `returnToBoardLayer()` pre-emption is gone; the callback body is a
single `dispatchAction(actionId)` call, admitted or refused by the unmodified
`bindingAllowedInLayer`/`topLayer` guard exactly like a real keystroke. Confirmed
`grep -c 'returnToBoardLayer' App.tsx` (excluding comments) is `0`. Re-ran
`menu-bridge.test.tsx` in isolation this session: 17/17 pass (the first test file in this repo to
drive the real `menu:action` subscription rather than stubbing it to a no-op, per the plan's own
stated purpose). Re-ran the full desktop suite fresh: 106/106 pass across 18 files. Re-ran
`cargo build --workspace`: succeeds. `01-16-SUMMARY.md` also documents a live macOS `tauri dev`
walkthrough (via `orca computer-use`) confirming the actual reported symptom — real OS-level
⌘N/⌘⇧N/⌘⇧O left the panel open and opened nothing, ⌘K still opened the palette over the panel —
though the visual menu-bar-greying affordance (Task 3's `<human-check>` steps 2-3) could not be
confirmed by that same tool (`surfaces.menubar:false`) and is carried forward below as human
verification, consistent with the SUMMARY's own disclosure (coverage item D3).

**G-01-2 — confirmed NOT closed, by direct code read this session.** `01-UAT.md` logged this gap
(commit `b365865`, severity major) after seeding a 1,067-item / 13-epic project and observing 6
rows render raw ULIDs in place of an epic label, and the FilterBar epic-chip list showing 4 of 13
epics. No plan in this phase directory declares `gap_ids: [G-01-2]` (only 01-16, for G-01-1, ran
this session), and a direct read of the three files the UAT gap named confirms the defect is
unchanged: `BoardView.tsx`'s `epicsById` is still `Object.fromEntries(items.filter(i => i.kind
=== "epic")...)` over the currently loaded page only; `BoardRow.tsx`'s `epicLabel` still falls
back to the raw `item.epicId` string when that lookup misses; `FilterBar.tsx`'s `epicOptions` is
still built by iterating the same windowed `items` array; and `commands/board.rs`'s
`DEFAULT_LIMIT = 200` is the shared root cause bounding all three. This is not a cosmetic
nice-to-have — it directly contradicts phase Success Criterion #3 ("User searches, filters and
reorders a project holding at least 1,000 items") at the exact volume the criterion names, and it
leaks an internal identifier (a ULID) onto the primary board surface, which BOARD-01's hierarchy
display and BOARD-06's epic filter both depend on rendering correctly.

**Code review (01-REVIEW.md, this run) found 0 critical/blocker issues** on the G-01-1
gap-closure surface: no injection vectors, no hardcoded secrets, no dangerous JS sinks, no
unregistered Tauri commands, and the specific security boundary under scrutiny
(`menu_set_action_enabled`'s restriction to the four forwarded ids) checks out. It found 4
warnings (WR-01 byte-vs-character length validation, WR-02 error-shape mismatch in
`RegisterProjectFlow`, WR-03 the layer object computed twice independently in `BoardView.tsx`,
WR-04 no Rust-side test guarding the forwarded-action-id list against drift) and 2 info findings —
none of which block the phase goal, but WR-03 in particular is the same failure *class* (a guard
duplicated across two call sites that can silently drift) this phase exists to close, and is
recorded below as an anti-pattern rather than a gap since it has not yet caused an observed
defect. These four warnings were not fixed in this run (no fix plan exists for them) and are
carried forward as technical debt, not phase-blocking gaps.

**Both suites independently re-run fresh in this session** (not accepted from any SUMMARY's own
narration): `cargo test --workspace` — all binaries pass (0 failures), `cargo build --workspace`
succeeds. `npm --prefix packages/desktop run test -- --run` — 106 tests across 18 files, 0
failed. `npx vitest run --run src/board/__tests__/menu-bridge.test.tsx` — 17/17 pass in isolation.
No `TBD`/`FIXME`/`XXX`/`TODO`/`HACK`/`PLACEHOLDER` markers found in any of the 138
`covered_files` for this verification.

### Observable Truths

| # | Truth | Status | Evidence |
|---|-------|--------|----------|
| 1 | DATA-01 — every mutation writes projection + event in one transaction | ✓ VERIFIED | Unchanged; re-confirmed in this session's fresh `cargo test --workspace` run |
| 2 | DATA-02 — every entity id is a client-generated ULID, never an auto-increment int | ✓ VERIFIED | Unchanged; `db_bootstrap.rs` passes in this session's fresh run |
| 3 | DATA-03 — humans and agents are distinct actors of one model, every mutation actor-attributed | ✓ VERIFIED | Unchanged |
| 4 | DATA-05 — the event log is a gap-free, no-duplicate, resumable stream from a cursor | ✓ VERIFIED | Unchanged; `cursor_resume.rs` passes in this session's fresh run |
| 5 | DATA-07 — the database survives an unclean termination with no loss/corruption of committed work | ✓ VERIFIED | Unchanged; `crash_safety.rs` real `SIGKILL` test passes in this session's fresh run |
| 6 | DATA-08 — migrations run automatically on launch and are reversible within one version | ✓ VERIFIED | Unchanged; `migration_safety.rs` passes in this session's fresh run |
| 7 | BOARD-01a — user creates/edits epics, tasks, issues in a fixed, non-reconfigurable 3-level hierarchy | ✓ VERIFIED | Unchanged mechanism, re-confirmed |
| 8 | BOARD-01b — a task can be placed under an epic, and an issue under an epic or task, from the running UI | ✓ VERIFIED | Unchanged since prior round (G-01-EPIC-ASSIGN); `epic-assign.test.tsx`/`issue-parent.test.tsx` pass |
| 9 | BOARD-01c — an issue can never hold both an epic and a task parent at once | ✓ VERIFIED | Unchanged since prior round (CR-01); regression test passes |
| 10 | BOARD-02 — discrete, individually checkable acceptance criteria | ✓ VERIFIED | Unchanged |
| 11 | BOARD-04 — fixed Backlog→Todo→In Progress→In Review→Done workflow, no reconfiguration path | ✓ VERIFIED | Unchanged |
| 12 | BOARD-05 — reorder/reprioritize within an epic and within the backlog | ✓ VERIFIED | Unchanged |
| 13 | BOARD-06 — filter/search by text, status, epic, assignee, indexed SQL, correct at project volume named in SC #3 | ✗ **FAILED (G-01-2, unresolved)** | Server-side indexed search/filter itself works (`search_filter.rs` passes), but the epic dimension is empirically broken at the volume SC #3 names: FilterBar's epic chip list showed 4 of 13 epics on a real 1,067-item/13-epic board |
| 14 | BOARD-07a — every navigational and mutating action reachable entirely from the keyboard | ✓ VERIFIED (mechanism) | Unchanged; full live walkthrough of every named binding not run this session |
| 15 | BOARD-07b — global shortcuts are inert while the item detail panel or a row-level picker holds a trapped focus scope, including click-opened pickers | ✓ VERIFIED | Unchanged since prior round (G-01-FOCUS + CR-02) |
| 16 | BOARD-07c — a native macOS menu accelerator can never bypass the layer guard a real keystroke would obey | ✓ **VERIFIED (G-01-1 closed this run)** | `returnToBoardLayer()` removed from `App.tsx`; 17 new `menu-bridge.test.tsx` tests re-run and pass; full desktop suite (106/106) and `cargo build --workspace` re-run and pass; live macOS build confirmed the actual reported symptom per 01-16-SUMMARY.md |
| 17 | BOARD-08 — board interactions complete without perceptible lag at 1,000+ items | ✓ VERIFIED (server) | Unchanged; `perf_seed_1000.rs` re-run fresh, passing; perceived UI lag still not run live (UAT test 2 still `[pending]`) — see Human Verification |
| 18 | BOARD-09 — every item shows a chronological, actor-attributed activity trail | ✓ VERIFIED (mechanism) | Unchanged |
| 19 | BOARD-10 — user registers several local git repos as projects and switches boards, with rejected registrations surfaced, including after a successful retry | ✓ VERIFIED | Unchanged since prior round (WR-01 in the prior code review) |
| 20 | Every task's epic pill shows a human-readable `KEY Title`, never a raw internal ULID, regardless of project size | ✗ **FAILED (G-01-2, unresolved)** | `BoardRow.tsx` still falls back to the raw `item.epicId` ULID when `epicsById` (a single-window derivation) misses; confirmed unchanged by direct read this session; no gap-closure plan exists |

**Score:** 18/20 truths verified (0 present-behavior-unverified). Two truths fail on the same
root cause (G-01-2): the windowed epic-lookup derivation shared by `BoardRow.tsx` (raw-ULID
fallback), `BoardView.tsx` (`epicsById`), and `FilterBar.tsx` (`epicOptions`), all bounded by
`commands/board.rs`'s `DEFAULT_LIMIT = 200`.

### Required Artifacts

| Artifact | Expected | Status | Details |
|----------|----------|--------|---------|
| `packages/desktop/src/App.tsx` (`menu:action` bridge) | Dispatches via `bindingAllowedInLayer` only, no layer pre-emption | ✓ **VERIFIED** | `returnToBoardLayer()` call removed; confirmed by direct read and grep count = 0 |
| `packages/desktop/src/board/__tests__/menu-bridge.test.tsx` | Drives the real `menu:action` bridge (not a no-op stub), all four forwarded ids, both layers | ✓ **VERIFIED** | Exists, 17 tests, re-run in isolation this session, all pass |
| `packages/desktop/src-tauri/src/commands/menu.rs` (`menu_set_action_enabled`) | Scoped to the four forwarded ids, refuses anything else | ✓ **VERIFIED** | Exists, registered in `main.rs`'s `invoke_handler`; code review confirmed the restriction holds |
| `packages/desktop/src/state/menuSync.ts` (`useMenuLayerSync`) | Pushes the layer verdict to the native menu bar, delta-only | ✓ **VERIFIED** | Exists, mounted in `AppShell`; unit-tested for every documented transition |
| `packages/desktop/src/state/keyboard.ts` (`MENU_ACTION_IDS`, `useTopLayer`) | Renderer-side mirror of the forwarded id set; shared layer-computation hook | ✓ **VERIFIED** | Both exported, confirmed by direct read |
| `packages/desktop/src/board/BoardView.tsx` (`epicsById`) | Resolves every epic a visible task/issue references, not just the loaded window | ✗ **STUB (unfixed since G-01-2 logged)** | Still `items.filter(i => i.kind === "epic")` over the current page only — confirmed unchanged |
| `packages/desktop/src/board/BoardRow.tsx` (`epicLabel`) | Never renders a raw internal id | ✗ **STUB (unfixed since G-01-2 logged)** | Still falls back to `item.epicId` on a lookup miss — confirmed unchanged |
| `packages/desktop/src/board/FilterBar.tsx` (`epicOptions`) | Covers every epic in the project | ✗ **STUB (unfixed since G-01-2 logged)** | Still built from the same windowed `items` array — confirmed unchanged |

### Key Link Verification

| From | To | Via | Status | Details |
|------|----|----|--------|---------|
| `desktop/src/App.tsx` `menu:action` handler | `state/keyboard.ts::dispatchAction`/`bindingAllowedInLayer` | direct call, no intermediate layer mutation | ✓ **NOW WIRED (G-01-1 fix)** | Confirmed by direct read; the only change between a click and an accelerator origin is gone |
| `desktop/src/state/menuSync.ts` | `commands/menu.rs::menu_set_action_enabled` | `invokeCommand` through `adapters/tauri.ts` | ✓ WIRED | Confirmed; no direct `@tauri-apps/api` import outside the adapter (verify gate re-run, 0 hits) |
| `desktop/src/board/BoardView.tsx` (`epicsById`) | `commands/board.rs::board_list` | derived client-side from the last page fetched, NOT a dedicated epic-resolving query | ⚠️ **STATIC fallback beyond the window** | Data flows for epics inside the loaded window; outside it, the chain terminates in a raw id literal, not a query — this is G-01-2's root cause |

### Data-Flow Trace (Level 4)

| Artifact | Data Variable | Source | Produces Real Data | Status |
|----------|---------------|--------|---------------------|--------|
| `BoardRow.tsx` | `epicLabel` | `epicsById[item.epicId]` → `BoardView.tsx`'s windowed `items` → `useBoardQuery`'s `board_list` (capped at `DEFAULT_LIMIT=200`) | Only when the epic is inside the currently loaded page | ⚠️ **HOLLOW beyond the window** — falls back to the raw `item.epicId` ULID, which is real data but the WRONG data (an internal id, not a label) |
| `FilterBar.tsx` | `epicOptions` | Same windowed `items` array | Only for epics inside the loaded page | ⚠️ **HOLLOW beyond the window** — 4 of 13 epics observed on a real seeded board |

### Requirements Coverage

| Requirement | Source Plan | Description | Status | Evidence |
|-------------|------------|--------------|--------|----------|
| DATA-01 | 01-03, 01-04 | Transactional outbox | ✓ SATISFIED | Truth #1 |
| DATA-02 | 01-01, 01-03 | Client-generated ULIDs | ✓ SATISFIED | Truth #2 |
| DATA-03 | 01-03, 01-04 | Distinct human/agent actor model | ✓ SATISFIED | Truth #3 |
| DATA-05 | 01-10 | Cursor-resumable event stream | ✓ SATISFIED | Truth #4 |
| DATA-07 | 01-05 | Crash-safe persistence | ✓ SATISFIED | Truth #5 |
| DATA-08 | 01-01, 01-05 | Automatic, reversible migrations | ✓ SATISFIED | Truth #6 |
| BOARD-01 | 01-04, 01-12, 01-14, 01-15 | CRUD in fixed 3-level hierarchy, reachable from the UI, single-parent invariant | ✓ SATISFIED (creation/parenting mechanism) | Truths #7, #8, #9. Note: the hierarchy's *display* of an epic relationship (the pill) is broken at volume — see truth #20/BOARD-06 |
| BOARD-02 | 01-06 | Discrete checkable acceptance criteria | ✓ SATISFIED | Truth #10 |
| BOARD-04 | 01-04 | Fixed, non-reconfigurable workflow | ✓ SATISFIED | Truth #11 |
| BOARD-05 | 01-07 | Reorder/reprioritize | ✓ SATISFIED | Truth #12 |
| BOARD-06 | 01-08 | Filter/search across items, correct at the volume SC #3 names | ✗ **BLOCKED (G-01-2)** | Truth #13, #20 — epic filter chip completeness and epic-pill correctness both fail at 1,000+ item / 13-epic volume |
| BOARD-07 | 01-02, 01-09, 01-13, 01-14, 01-16 | Full keyboard operability, layer-gated global bindings, native menu obeys the same guard | ✓ SATISFIED (mechanism; G-01-1 closed) | Truths #14, #15, #16 |
| BOARD-08 | 01-02, 01-08 | No perceptible lag at 1,000+ items | ? NEEDS HUMAN (server-side satisfied) | Truth #17 |
| BOARD-09 | 01-10 | Chronological actor-attributed activity trail | ✓ SATISFIED (mechanism) | Truth #18 |
| BOARD-10 | 01-11, 01-15 | Register/switch multiple project boards, no silently swallowed errors | ✓ SATISFIED | Truth #19 |

No orphaned requirements: the union of every plan's `requirements:` frontmatter (01-01 through
01-16) exactly matches the 15 IDs `REQUIREMENTS.md` assigns to Phase 1 (DATA-01, DATA-02,
DATA-03, DATA-05, DATA-07, DATA-08, BOARD-01, BOARD-02, BOARD-04, BOARD-05, BOARD-06, BOARD-07,
BOARD-08, BOARD-09, BOARD-10). **`REQUIREMENTS.md` currently marks BOARD-06 `[x] Complete`; this
verification found that mark to be inaccurate** — BOARD-06 has a confirmed, unresolved
correctness defect (G-01-2) at the exact volume the phase's own Success Criterion #3 names.

### Behavioral Spot-Checks

| Behavior | Command | Result | Status |
|----------|---------|--------|--------|
| Full Rust workspace test suite is green | `cargo test --workspace` (run fresh, this session) | All test binaries pass, 0 failures | ✓ PASS |
| Full frontend test suite is green | `npm --prefix packages/desktop run test -- --run` (run fresh, this session) | 106 tests across 18 files, 0 failed | ✓ PASS |
| Full Rust workspace build is green | `cargo build --workspace` (run fresh, this session) | Finished, no errors | ✓ PASS |
| G-01-1 regression suite passes in isolation | `npx vitest run --run src/board/__tests__/menu-bridge.test.tsx` | 17/17 passed | ✓ PASS |
| No layer-teardown path remains in the menu bridge | `grep -vE '^\s*(//|\*|/\*)' App.tsx \| grep -c returnToBoardLayer` | `0` | ✓ PASS |
| All four menu accelerators still printed | `grep -vE '^\s*(//|\*|/\*)' menu.rs \| grep -c 'accelerator('` | `4` | ✓ PASS |
| G-01-2's defect is still present | Direct read of `BoardView.tsx`, `BoardRow.tsx`, `FilterBar.tsx`, `commands/board.rs` | Windowed derivation and raw-ULID fallback both unchanged | ✗ CONFIRMED UNRESOLVED |
| No debt markers in any covered file | `grep -nE "TBD\|FIXME\|XXX\|TODO\|HACK\|PLACEHOLDER"` across all 138 `covered_files` | Zero hits | ✓ PASS |

### Probe Execution

Not applicable — no `scripts/*/tests/probe-*.sh` convention in this project.

### Anti-Patterns Found

| File | Line | Pattern | Severity | Impact |
|------|------|---------|----------|--------|
| `packages/desktop/src/board/BoardRow.tsx` | ~120 | `item.epicId ? (epic ? ... : item.epicId) : ...` — raw ULID fallback leaks an internal id to the primary board surface | 🛑 Blocker (G-01-2) | Confirmed live on a 1,067-item board; drives this phase's `gaps_found` status |
| `packages/desktop/src/board/BoardView.tsx` | ~258 | `epicsById` derived from the loaded window only | 🛑 Blocker (G-01-2) | Root cause shared with `BoardRow.tsx` and `FilterBar.tsx` |
| `packages/desktop/src/board/FilterBar.tsx` | ~81-88 | `epicOptions` derived from the same windowed `items` | 🛑 Blocker (G-01-2) | 4 of 13 epics observed on the real seeded board |
| `packages/desktop/src/board/BoardView.tsx` | 393-398, 663-668 | Six-field layer object (`topLayer({...})`) constructed twice independently (keyboard path vs. CR-02 click path) | ⚠️ Warning (WR-03, this run's code review) | Same failure class this phase exists to close (a guard duplicated across entry points that can silently drift); not yet an observed defect |
| `packages/desktop/src-tauri/src/main.rs`, `menu.rs`, `state.rs` | various | `FORWARDED_MENU_ACTIONS` / `build_menu`'s item ids / `MenuHandles::get` hand-synced across 3 Rust sites + 1 TS site, no Rust-side test guards the invariant | ⚠️ Warning (WR-04, this run's code review) | Low impact today (degrades affordance, doesn't bypass the guard), but unprotected on the Rust side |
| `packages/desktop/src-tauri/src/commands/issue.rs` | 42-62 | Title/body length validation counts UTF-8 bytes, not characters | ⚠️ Warning (WR-01, this run's code review) | Rejects valid non-ASCII titles/bodies; carried forward, not this phase's core scope |
| `packages/desktop/src/projects/RegisterProjectFlow.tsx` | 104 | `(error as Error).message` on a Tauri command rejection, which is a plain string, not an `Error` — renders "undefined" | ⚠️ Warning (WR-02, this run's code review) | Pre-existing pattern, now centralized into the shared hook; carried forward |
| `packages/desktop/src-tauri/tauri.conf.json` | 23 | `"csp": null` | ⚠️ Warning (from prior round) | Deliberately open by decision; unchanged this run |
| `packages/desktop/src/board/DoneWarning.tsx` | 74 | Renders `"{checked}/{total} criteria unchecked"` | ⚠️ Warning (from prior round) | Deliberately untouched — the 01-UI-SPEC.md contract is the defect, not the code |

No `TBD`/`FIXME`/`XXX`/`TODO`/`HACK`/`PLACEHOLDER` markers found in any of the 138 files this
verification's fingerprint covers.

### Human Verification Required

1. **Visual confirmation of the menu-bar greying affordance (Task 3 of 01-16, steps 2-3)**
   **Test:** With a real `tauri dev` build, open the View menu while the command palette is open
   and confirm Toggle Command Palette reads visually greyed; reopen the item detail panel and go
   straight to the File menu to see whether the three custom items are greyed on the first
   opening or the second.
   **Expected:** Greyed while refused, per 01-16's design decision (immediate greying preferred,
   greying on the second opening is the accepted bounded window — permanently enabled-and-dead is
   a failure).
   **Why human:** `01-16-SUMMARY.md`'s own coverage item D3 discloses that `orca computer-use`'s
   macOS provider reports `surfaces.menubar:false`/`surfaces.dialogs:false` on this host, so no
   available tool can click the real menu bar or read a native `MenuItem`'s visual state. The
   underlying accelerator-inertness bug (G-01-1's actual reported symptom) WAS independently
   confirmed live and is closed; only this narrower visual-affordance check remains.

2. **1,000+ item volume — perceived lag, still unexercised live**
   **Test:** With a project seeded past 1,000 items, reorder/filter/search/switch projects with
   the mouse untouched.
   **Expected:** No perceptible lag or jank at volume.
   **Why human:** `01-UAT.md`'s test 2 is still `result: [pending]` — it has never been completed.
   `perf_seed_1000.rs` proves server-side latency (re-run fresh, passing, in this session) but not
   perceived UI lag. Note this check is now entangled with G-01-2: the 1,067-item board used to
   discover G-01-2 is exactly the kind of board this test needs, so re-run this only once G-01-2
   is fixed, to avoid conflating "lag" with "epic pills showing wrong data."

## Gaps Summary

**G-01-1 is genuinely closed** — independently re-verified in this session by direct code read,
a fresh full-suite test run (106/106 frontend, all Rust binaries green), an isolated re-run of the
17-test `menu-bridge.test.tsx` regression suite, and cross-reference against 01-16-SUMMARY.md's
own live-macOS-build evidence.

**G-01-2 blocks this phase from `passed`.** It was logged in `01-UAT.md` (commit `b365865`,
severity major) as a `status: failed` gap with no corresponding gap-closure plan anywhere in this
phase directory — `01-16` closed only `G-01-1` (its frontmatter explicitly scopes `gap_ids:
[G-01-1]`). Direct reads of `BoardView.tsx`, `BoardRow.tsx`, `FilterBar.tsx` and
`commands/board.rs` this session confirm the defect exactly as UAT described it: a task or
issue whose epic falls outside the currently loaded 200-row page renders that epic's raw internal
ULID instead of a human-readable label, and the FilterBar's epic chip list similarly only ever
shows the epics present in the loaded window (4 of 13 on the board that surfaced this gap). This
is a direct violation of the phase's own Success Criterion #3 ("User searches, filters and
reorders a project holding at least 1,000 items") at the volume the criterion itself names, and it
leaks an internal identifier onto the primary board surface — not a cosmetic nit.

`REQUIREMENTS.md` currently marks `BOARD-06` `[x] Complete`; this verification found that mark
inaccurate given the confirmed defect above, and recommends it be reverted to incomplete (or
annotated with the gap) until G-01-2 has a gap-closure plan and passes verification.

Two human-verification items are also outstanding (menu-bar visual greying confirmation, and the
still-`[pending]` 1,000+ item perceived-lag UAT test), but per the status decision tree these do
not change the overall status — `gaps_found` already applies because of G-01-2, and both human
items are preserved above for the next round.

---

_Verified: 2026-09-10T02:00:54Z_
_Verifier: Claude (gsd-verifier)_
