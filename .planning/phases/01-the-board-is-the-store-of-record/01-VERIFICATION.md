---
phase: 01-the-board-is-the-store-of-record
verified: 2026-09-09T17:55:00Z
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
  - ".planning/phases/01-the-board-is-the-store-of-record/01-CONTEXT.md"
  - ".planning/phases/01-the-board-is-the-store-of-record/01-RESEARCH.md"
  - ".planning/phases/01-the-board-is-the-store-of-record/01-REVIEW.md"
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
  - "packages/desktop/src/board/__tests__/filter.test.tsx"
  - "packages/desktop/src/board/__tests__/first-run.test.tsx"
  - "packages/desktop/src/board/__tests__/keyboard-nav.test.tsx"
  - "packages/desktop/src/board/__tests__/palette.test.tsx"
  - "packages/desktop/src/board/__tests__/reorder.test.tsx"
  - "packages/desktop/src/board/__tests__/workflow.test.tsx"
  - "packages/desktop/src/board/collapseStore.ts"
  - "packages/desktop/src/board/pickers/AssigneePicker.tsx"
  - "packages/desktop/src/board/pickers/EstimatePicker.tsx"
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
  - "packages/desktop/src/state/keyboard.ts"
  - "packages/desktop/src/state/uiStore.ts"
  - "packages/desktop/src/test/setup.ts"
covered_digest: "v1:sha256:71bfe3f2e5692f9b32f7c79f30bc134b39c286fe295170325b7d1f7c5166073a"
behavior_unverified: 0
overrides_applied: 0
re_verification:
  previous_status: gaps_found
  previous_score: 15/17
  gaps_closed:
    - "BOARD-01b — deleting an epic or task never fails, orphaning (not cascading) linked issues (CR-01)"
    - "BOARD-10b — a rejected registration is surfaced to the user, not silently swallowed (CR-02)"
  gaps_remaining: []
  regressions: []
human_verification:
  - test: "Launch a real `tauri dev` build and drive the entire board — create/edit/delete items, reorder, filter, search a project seeded past 1,000 items, open the command palette, register 2-3 real local repositories and switch between them with ⌘1-⌘9 — with the mouse untouched from start to finish."
    expected: "Every action from BOARD-01/02/04/05/06/07/09/10/10's plans is reachable and completes with no perceptible input lag or visual jank, matching 01-UI-SPEC.md's Performance Contract and each plan's own deferred <human-check> block."
    why_human: "Every plan from 01-04 onward (01-04 through 01-11) explicitly deferred its own live tauri dev walkthrough — its SUMMARY records 'no confirmed GUI display / agent-spawning tool available to this executor' and defers the check to /gsd-verify-work. Only 01-01/01-02/01-03 captured real tauri dev screenshots. All server-side and component-level behavior is proven by 96 passing Rust tests and 57 passing Vitest tests (both re-run fresh in this session, up from 94/51 before the gap-closure commits), but 'no perceptible lag', full mouse-free operation end to end, and the actual visual read of the rack/legend/activity trail/epic pill have still not been confirmed against a running window. This item is unchanged from the initial verification — it was never one of the two closed gaps."
---

# Phase 1: The Board Is The Store Of Record Verification Report

**Phase Goal:** Cyril runs his real project structure on Flywheel's board — epics, tasks with
individually checkable acceptance criteria, and a workflow he cannot bend — and it is still
exactly there after a crash.

**Verified:** 2026-09-09T17:55:00Z
**Status:** human_needed
**Re-verification:** Yes — after gap closure

## Goal Achievement

Both Critical defects from the initial verification (CR-01, CR-02) are now closed. This was
verified by reading the actual diff of all four `fix(01):` commits, not by trusting `SUMMARY.md`
or the commit messages' own claims, and by re-running both test suites fresh in this session.

**CR-01 (delete cascade failure) — genuinely fixed.** `packages/core/src/domain/epic.rs::delete_epic`
and `packages/core/src/domain/task.rs::delete_task` were read in full. Both now run
`UPDATE issues SET epic_id = NULL ...` / `UPDATE issues SET task_id = NULL ...` **inside the
existing transaction**, **before** `DELETE FROM epics` / `DELETE FROM tasks` — the exact ordering
that makes the fix correct, since a `NO ACTION` foreign key with `foreign_keys=ON` is checked at
the point of the `DELETE`, not at commit. `packages/core/tests/hierarchy_workflow.rs::deleting_an_epic_or_task_orphans_linked_issues_instead_of_failing`
creates an issue linked to an epic and one linked to a task, deletes each parent, and asserts both
the delete succeeds and the issue's `epic_id`/`task_id` reads back `NULL` afterward — this is a
real regression test of the previously-reproduced failure, and it passes in this session's fresh
`cargo test --workspace` run.

**CR-02 (silent registration failure) — genuinely fixed.** `RegisterProjectFlow.tsx` now exports
`useRegistrationErrorNotice(isError, error)`, a shared hook turning a rejected mutation into an
auto-clearing message. All three previously-silent entry points were read directly and confirmed
wired: `App.tsx` (line 96-97, rendered at three JSX branches), `CommandPalette.tsx` (line 139-140,
rendered via a `createPortal` in the `!open` early-return branch — necessary because `run()`
closes the palette synchronously before the async mutation can reject, and this was verified by
reading the surrounding code, not assumed), and `ProjectRail.tsx` (line 83-96, rendered at its
existing notice slot, line 182-188). `FirstRun.tsx::deriveKeyPrefix` was also read directly:
it now always emits a prefix that starts with an uppercase letter and is 2-10 characters
(digit-leading names get a `P` prefix; empty/all-punctuation names fall back to `"PRJ"`), which
was checked by hand against `core::domain::project::validate_key_prefix`'s exact rule (2-10
uppercase letters/digits, starting with a letter) and confirmed to always satisfy it for every
case the function's control flow can produce. `board/__tests__/first-run.test.tsx` is a genuine
property-style test — it mirrors `validate_key_prefix`'s regex exactly and asserts it holds
across 9 realistic directory names including digit-leading, single-character, and
punctuation-only cases — and it passes.

**Two WR items bundled into the same commits were also verified as genuinely fixed, not merely
claimed:** `BoardRow.tsx` (line 119-120) now looks up the epic via a `epicsById` map built in
`BoardView.tsx` (line 237, passed at line 548) and renders `${epic.key} ${epic.title}`, falling
back to the raw id only if the epic is outside the loaded window; `board-view.test.tsx` has a new
test (`"shows the epic's human-readable key/title in the epic pill, not the raw epic_id ULID
(WR-01)"`) asserting this directly, and it passes. `update_epic`/`update_task`/`update_issue` in
`epic.rs`/`task.rs`/`issue.rs` were all confirmed to `SELECT ... key ...` and return the real value
instead of a blank string; `hierarchy_workflow.rs::update_epic_task_and_issue_read_back_the_real_key_not_a_blank_one`
asserts this for all three and passes.

**Both test suites were re-run fresh in this session** (not trusted from the commit
message/SUMMARY counts): `cargo test --workspace` — 96 tests across 15 files, 0 failed (up from
94, the +2 being the CR-01 delete-orphan and WR-02 key-readback regression tests).
`npm --prefix packages/desktop run test -- --run` — 57 tests across 13 files, 0 failed (up from
51, the +6 being `first-run.test.tsx`'s 5 tests plus `board-view.test.tsx`'s new WR-01 test). Both
counts match what the fix commits claimed, and both are independently confirmed green in this
session, not carried forward from the prior report.

No debt markers (`TBD`/`FIXME`/`XXX`/`TODO`/`HACK`/`PLACEHOLDER`) were introduced in any of the
files touched by the four gap-closure commits.

**What is deliberately still open, and correctly not treated as a regression or a new gap** (per
the executor's own scoping, independently confirmed by reading the code): `tauri.conf.json`'s
`"csp": null` is unchanged (a real CSP needs design and verification against a running window,
which this environment cannot confirm); `DoneWarning.tsx` still reads `"{checked}/{total} criteria
unchecked"`, faithfully matching `01-UI-SPEC.md`'s own defective Copywriting Contract — the spec
is the defect, not the code, and the block/never-block mechanism is unaffected; the epic-filter
chip list is still derived from the loaded board window rather than a dedicated `epic_list`
command (a genuine BOARD-06 partial requiring a new Tauri command, correctly deferred rather than
opportunistically patched inside an unrelated gap-closure commit).

**What remains unconfirmed is unchanged from the initial verification: the live, running-window
experience.** Every plan from `01-04` through `01-11` still records that its own `<human-check>`
walkthrough was never run against a real `tauri dev` window in this execution environment. This
was never one of the two closed gaps and is carried forward honestly below, not rounded up to
passed because the automated suites are green.

### Observable Truths

| # | Truth | Status | Evidence |
|---|-------|--------|----------|
| 1 | DATA-01 — every mutation writes projection + event in one transaction | ✓ VERIFIED | Unchanged from initial verification — re-confirmed present in `epic.rs`/`task.rs` reads this session |
| 2 | DATA-02 — every entity id is a client-generated ULID, never an auto-increment int | ✓ VERIFIED | Unchanged; `db_bootstrap.rs` still 5/5 in this session's fresh run |
| 3 | DATA-03 — humans and agents are distinct actors of one model, every mutation actor-attributed | ✓ VERIFIED | Unchanged |
| 4 | DATA-05 — the event log is a gap-free, no-duplicate, resumable stream from a cursor | ✓ VERIFIED | Unchanged; `cursor_resume.rs` 5/5 in this session's fresh run |
| 5 | DATA-07 — the database survives an unclean termination with no loss/corruption of committed work | ✓ VERIFIED | Unchanged; `crash_safety.rs` real `SIGKILL` test still passes |
| 6 | DATA-08 — migrations run automatically on launch and are reversible within one version | ✓ VERIFIED | Unchanged; `migration_safety.rs` 5/5 in this session's fresh run |
| 7 | BOARD-01a — user creates and edits epics/tasks/issues in a fixed, non-reconfigurable 3-level hierarchy | ✓ VERIFIED | Unchanged |
| 8 | BOARD-01b — deleting an epic or task never fails, orphaning (not cascading) linked issues | ✓ **VERIFIED (gap closed)** | `delete_epic`/`delete_task` now `UPDATE issues SET epic_id/task_id = NULL` inside the transaction, before the `DELETE`; `hierarchy_workflow.rs::deleting_an_epic_or_task_orphans_linked_issues_instead_of_failing` is a real regression test and passes in this session's run |
| 9 | BOARD-02 — discrete, individually checkable acceptance criteria (statement + verification hint), not free prose | ✓ VERIFIED | Unchanged |
| 10 | BOARD-04 — fixed Backlog→Todo→In Progress→In Review→Done workflow, no reconfiguration path | ✓ VERIFIED | Unchanged |
| 11 | BOARD-05 — reorder/reprioritize within an epic and within the backlog (fractional rank, priority tie-break) | ✓ VERIFIED | Unchanged |
| 12 | BOARD-06 — filter/search by text, status, epic, assignee as indexed SQL, no second client-side filter path | ✓ VERIFIED | Unchanged; epic-filter-chip-window limitation still known/disclosed, not a regression |
| 13 | BOARD-07 — every navigational and mutating action reachable entirely from the keyboard | ✓ VERIFIED (mechanism) | Unchanged; full live walkthrough not run — see Human Verification |
| 14 | BOARD-08 — board interactions complete without perceptible lag at 1,000+ items | ✓ VERIFIED (server) | Unchanged; perceived UI lag not run — see Human Verification |
| 15 | BOARD-09 — every item shows a chronological, actor-attributed activity trail | ✓ VERIFIED (mechanism) | Unchanged; live visual read not run — see Human Verification |
| 16 | BOARD-10a — user registers several local git repos as projects and switches boards (⌘1-⌘9, palette, rail) | ✓ VERIFIED | Unchanged |
| 17 | BOARD-10b — a rejected registration is surfaced to the user, not silently swallowed | ✓ **VERIFIED (gap closed)** | `useRegistrationErrorNotice` wired into and rendered by all three previously-silent entry points (`App.tsx`, `CommandPalette.tsx`, `ProjectRail.tsx`), confirmed by direct code read; `deriveKeyPrefix` hardened and property-tested against 9 realistic names in `first-run.test.tsx`, which passes |

**Score:** 17/17 truths verified (0 present-behavior-unverified)

### Required Artifacts

| Artifact | Expected | Status | Details |
|----------|----------|--------|---------|
| `packages/core/src/domain/epic.rs` (`delete_epic`) | Idempotent, orphans children, never fails | ✓ **VERIFIED** | Now orphans both child tasks and linked issues before `DELETE FROM epics`, in that order, inside one transaction |
| `packages/core/src/domain/task.rs` (`delete_task`) | Idempotent, never fails | ✓ **VERIFIED** | Now orphans linked issues before `DELETE FROM tasks` |
| `packages/desktop/src/projects/RegisterProjectFlow.tsx` | Shared registration flow, error state surfaced by every caller | ✓ **VERIFIED** | `useRegistrationErrorNotice` added; all 4 callers (including `FirstRun.tsx`'s pre-existing inline pattern) now render on failure |
| `packages/desktop/src/board/BoardRow.tsx` | Epic reference rendered as human-readable key/title | ✓ **VERIFIED** | `epicsById` lookup wired in, tested |
| `packages/core/src/domain/epic.rs`/`task.rs`/`issue.rs` `update_*` | Return DTO carries the real `key`, not a blank string | ✓ **VERIFIED** | All three `SELECT ... key ...` and return it; tested |
| `packages/core/src/db/mod.rs`, `db/backup.rs` | WAL pragmas, crash safety, backup/restore | ✓ VERIFIED | Unchanged |
| `packages/core/src/domain/event.rs`, `query/events.rs` | Append-only log, cursor-resumable stream | ✓ VERIFIED | Unchanged |
| `packages/core/src/domain/acceptance_criterion.rs` | Discrete criteria CRUD | ✓ VERIFIED | Unchanged |
| `packages/core/src/ranking.rs` | Fractional-index reorder | ✓ VERIFIED | Unchanged |
| `packages/core/src/query/search.rs`, `query/filter.rs` | FTS5 search, indexed filter | ✓ VERIFIED | Unchanged |
| `packages/desktop/src/state/keyboard.ts`, `board/CommandPalette.tsx` | Single binding table, palette parity | ✓ VERIFIED | Unchanged |
| `packages/core/src/marker.rs`, `domain/project.rs` | Marker-based project identity, reconciliation | ✓ VERIFIED | Unchanged |

### Key Link Verification

| From | To | Via | Status | Details |
|------|----|----|--------|---------|
| `desktop/src-tauri/src/main.rs` | `core::db::open_and_migrate` | setup hook before any window shown | ✓ WIRED | Unchanged |
| `desktop/src/App.tsx` | `desktop/src/adapters/tauri.ts` | every invoke/listen through one seam | ✓ WIRED | Unchanged |
| `domain/task.rs` (create/delete/status) | `domain/event.rs::append_event` | same transaction | ✓ WIRED | Unchanged |
| `desktop/src/board/useBoardQuery.ts` | `board:changed` (Rust `app.emit`) | push-invalidate, no client optimism | ✓ WIRED | Unchanged |
| `desktop/src/board/BoardView.tsx` | `desktop/src/board/BoardRow.tsx` (epic display) | `epicsById` lookup mirroring `actorsById` | ✓ **NOW WIRED** | `epicsById` built in `BoardView.tsx` (line 237) and passed to `BoardRow` (line 548); `BoardRow.tsx` (line 119-120) reads it |
| `desktop/src/projects/ProjectRail.tsx`/`App.tsx`/`CommandPalette.tsx` | `useRegisterProjectFlow`'s `isError`/`error` | render on failure | ✓ **NOW WIRED** | All three call `useRegistrationErrorNotice` and render its return value in JSX |
| `domain/epic.rs::delete_epic` / `domain/task.rs::delete_task` | `issues.epic_id` / `issues.task_id` | orphan-before-delete, same transaction | ✓ **NOW WIRED** | `UPDATE issues SET epic_id/task_id = NULL` runs before the `DELETE FROM epics/tasks`, inside the same `tx` |

### Requirements Coverage

| Requirement | Source Plan | Description | Status | Evidence |
|-------------|------------|--------------|--------|----------|
| DATA-01 | 01-03, 01-04 | Transactional outbox | ✓ SATISFIED | Truth #1 |
| DATA-02 | 01-01, 01-03 | Client-generated ULIDs | ✓ SATISFIED | Truth #2 |
| DATA-03 | 01-03, 01-04 | Distinct human/agent actor model | ✓ SATISFIED | Truth #3 |
| DATA-05 | 01-10 | Cursor-resumable event stream | ✓ SATISFIED | Truth #4 |
| DATA-07 | 01-05 | Crash-safe persistence | ✓ SATISFIED | Truth #5 |
| DATA-08 | 01-01, 01-05 | Automatic, reversible migrations | ✓ SATISFIED | Truth #6 |
| BOARD-01 | 01-04 | CRUD in fixed 3-level hierarchy | ✓ **SATISFIED (gap closed)** | Truths #7 and #8 both verified |
| BOARD-02 | 01-06 | Discrete checkable acceptance criteria | ✓ SATISFIED | Truth #9 |
| BOARD-04 | 01-04 | Fixed, non-reconfigurable workflow | ✓ SATISFIED | Truth #10 |
| BOARD-05 | 01-07 | Reorder/reprioritize | ✓ SATISFIED | Truth #11 |
| BOARD-06 | 01-08 | Filter/search across items | ✓ SATISFIED | Truth #12 |
| BOARD-07 | 01-02, 01-09 | Full keyboard operability | ? NEEDS HUMAN (mechanism satisfied) | Truth #13 |
| BOARD-08 | 01-02, 01-08 | No perceptible lag at 1,000+ items | ? NEEDS HUMAN (server-side satisfied) | Truth #14 |
| BOARD-09 | 01-10 | Chronological actor-attributed activity trail | ? NEEDS HUMAN (mechanism satisfied) | Truth #15 |
| BOARD-10 | 01-11 | Register/switch multiple project boards | ✓ **SATISFIED (gap closed)** | Truths #16 and #17 both verified |

No orphaned requirements: unchanged from initial verification — the union of every plan's
`requirements:` frontmatter still exactly matches the 15 IDs `REQUIREMENTS.md` assigns to Phase 1.

### Behavioral Spot-Checks

| Behavior | Command | Result | Status |
|----------|---------|--------|--------|
| Full Rust workspace test suite is green | `cargo test --workspace` (run fresh, this session) | 96 tests across 15 files, 0 failed | ✓ PASS |
| Full frontend test suite is green | `npm --prefix packages/desktop run test -- --run` (run fresh, this session) | 57 tests across 13 files, 0 failed | ✓ PASS |
| `delete_epic`/`delete_task` orphan linked issues, never fail (CR-01 fix) | Direct source read of both functions; confirmed `UPDATE issues ... WHERE epic_id/task_id = ?` runs before `DELETE FROM epics/tasks`, same transaction | Present in both functions, correct ordering | ✓ PASS (confirms CR-01 closed) |
| `hierarchy_workflow.rs`'s CR-01 regression test passes | `cargo test --workspace` (included in the full run above) | `deleting_an_epic_or_task_orphans_linked_issues_instead_of_failing` — ok | ✓ PASS |
| Registration failures render on all 4 entry points (CR-02 fix) | `grep -n "useRegistrationErrorNotice" App.tsx CommandPalette.tsx ProjectRail.tsx` + direct read of each render path | All three call the hook and render its return value in JSX (App.tsx 3 branches, CommandPalette.tsx portal in `!open` branch, ProjectRail.tsx existing notice slot) | ✓ PASS (confirms CR-02 closed) |
| `deriveKeyPrefix` never emits an invalid prefix (CR-02 fix) | `first-run.test.tsx` (included in the full frontend run above) | 5/5 including the 9-name spread test | ✓ PASS |
| WR-01 epic pill renders human-readable key/title | `board-view.test.tsx`'s new WR-01 test (included in the full frontend run above) | Passes | ✓ PASS |
| WR-02 `update_*` returns the real key | `hierarchy_workflow.rs::update_epic_task_and_issue_read_back_the_real_key_not_a_blank_one` (included in the full run above) | Passes | ✓ PASS |
| No debt markers introduced in the four gap-closure commits' files | `grep -n -E "TBD|FIXME|XXX|TODO|HACK|PLACEHOLDER"` on all 11 touched files | Zero hits | ✓ PASS |
| Deliberately-open items unchanged, not silently fixed or regressed | Direct read of `tauri.conf.json` (`csp: null`), `DoneWarning.tsx` (still `"{checked}/{total} ... unchecked"`) | Both unchanged from initial verification, as declared | ✓ PASS |

### Probe Execution

Not applicable — no `scripts/*/tests/probe-*.sh` convention in this project.

### Anti-Patterns Found

| File | Line | Pattern | Severity | Impact |
|------|------|---------|----------|--------|
| `packages/desktop/src-tauri/tauri.conf.json`:22-24 | 22-24 | `"csp": null` — no Content-Security-Policy | ⚠️ Warning | Deliberately open by decision (needs a running window to verify safely); no live XSS vector today (plain-text titles only) |
| `packages/desktop/src/board/DoneWarning.tsx`:74 | 74 | Renders `"{checked}/{total} criteria unchecked"` — labels the CHECKED count as "unchecked" | ⚠️ Warning | Deliberately left untouched — the CONTRACT in `01-UI-SPEC.md` is the defect, not the code; block/never-block mechanism unaffected |
| `packages/desktop/src/board/FilterBar.tsx` | ~254-268 | Epic filter chips derived from the loaded board window, not a dedicated `epic_list` command | ℹ️ Info | Genuine BOARD-06 partial, correctly deferred to planned gap-closure rather than patched opportunistically here |

No `TBD`/`FIXME`/`XXX`/`TODO`/`HACK`/`PLACEHOLDER` markers found in any of the files touched by
the four gap-closure commits.

### Human Verification Required

1. **Full live keyboard-only walkthrough, no live GUI confirmation since `01-03`** (unchanged from
   initial verification — was never part of the two closed gaps)
   **Test:** Launch a real `tauri dev` build; create/edit/delete epics, tasks, issues; add and
   check acceptance criteria; move items through the full workflow; reorder within an epic and
   the backlog; search and filter a 1,000+ item project; register 2-3 real repositories and
   switch with ⌘1-⌘9 and the palette — mouse untouched throughout.
   **Expected:** Every action completes with no perceptible lag or visual jank; nothing requires
   the mouse; the rack, legend, detail panel and activity trail read correctly; a task's epic pill
   shows a human-readable key/title (WR-01, now fixed in code — confirm visually); a registration
   failure (e.g. registering the same repo twice, or a directory whose derived key already
   collides) visibly surfaces a message on all four entry points (CR-02, now fixed in code —
   confirm visually).
   **Why human:** Every plan from `01-04` through `01-11` still records that "no confirmed GUI
   display / agent-spawning tool available to this executor" and deferred its own `<human-check>`
   block. Only `01-01`-`01-03` captured real `tauri dev` screenshots. Server-side latency,
   component rendering and keyboard-binding logic are all proven by 96 passing Rust tests and 57
   passing Vitest tests, but the actual felt experience in a running window has still not been
   confirmed.

## Gaps Summary

None. Both Critical defects identified in the initial verification (CR-01: delete-cascade FK
failure; CR-02: silently swallowed registration errors) were independently re-verified against
the actual code in this session — not accepted from the SUMMARY's or commit messages' own
claims — and are genuinely closed:

- **CR-01** is closed with the correct ordering (orphan-before-delete, inside the same
  transaction) and a real regression test that creates the previously-failing scenario and
  asserts it now succeeds.
- **CR-02** is closed with a shared hook wired into and rendered by all three previously-silent
  entry points, plus a hardened `deriveKeyPrefix` that a property-style test confirms can no
  longer produce an invalid prefix.

Both fix commits also closed the two Warning-level findings (WR-01 epic pill ULID, WR-02 blank
`key` on update) bundled into the same work. Both test suites were re-run fresh in this session
(96 Rust / 57 Vitest, both 0 failed) rather than trusted from the prior counts, and both match the
executor's claimed deltas exactly.

What remains is unchanged from the initial verification and was never part of either closed gap:
the live, running-window walkthrough across roughly two-thirds of this phase's surface area has
still not been confirmed in a real `tauri dev` window in this execution environment. This is
reported as a human-verification item, not rounded up to passed.

---

_Verified: 2026-09-09T17:55:00Z_
_Verifier: Claude (gsd-verifier)_
