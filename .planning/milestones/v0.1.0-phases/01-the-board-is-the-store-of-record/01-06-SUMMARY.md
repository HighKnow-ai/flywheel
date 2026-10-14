---
phase: 01-the-board-is-the-store-of-record
plan: 06
subsystem: database
tags: [rusqlite, sqlite, transactional-outbox, tauri-commands, tanstack-query, react, lucide-react]

# Dependency graph
requires:
  - phase: 01-the-board-is-the-store-of-record (plan 01-03)
    provides: "Migration 0002_board_schema.sql's acceptance_criteria table, the transactional-outbox pattern, ranking::rank_after/rank_between"
  - phase: 01-the-board-is-the-store-of-record (plan 01-04)
    provides: "ItemDetailPanel.tsx's placeholder-free section boundary, StatusPicker.tsx's Radix pattern, WORKFLOW_STATES, task/epic mutation shape"
provides:
  - "core::domain::acceptance_criterion — create/update/toggle/reorder/delete_criterion, list_criteria, delete_criteria_for_parent (used by delete_task/delete_epic's cascade)"
  - "query::list_board's BoardItem.criteria_checked/criteria_total, from one grouped-aggregate LEFT JOIN"
  - "Six Tauri commands: criterion_create/update/toggle/reorder/delete/list"
  - "AcceptanceCriteriaList.tsx, DoneWarning.tsx, BoardRow.tsx's criteria badge, legend/marks.ts's criteria channel"
affects: ["01-09 (priority/estimate/assignee pickers land in the same ItemDetailPanel)", "01-10 (activity trail reads the acceptance_criterion event stream by task_id/epic_id)", "Phase 4 (BOARD-03 criteria immutability/revisioning is an additive column on this same table)", "Phase 8 (checking one criterion against a diff without rewriting its parent)"]

# Actuals (#2632)
actuals:
  tokens: 25700
  tasks: 3
  commits: 3
plan_head_before: 592421256bbf6727c8233a999120f6eb6c6f2983

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "Every acceptance_criterion mutation opens exactly one conn.transaction() and commits the row + its event together, following create_task's shape exactly"
    - "toggle_criterion's UPDATE names only checked + updated_at on the criterion row (never rank/statement/verification_hint) plus a second UPDATE naming only the parent's updated_at — a check is not an edit (T-01-20)"
    - "parent_type validity ('task'|'epic', never 'issue') is enforced by the schema's own CHECK constraint, not an application-layer allow-list — the same discipline task.rs/epic.rs already apply to workflow status"
    - "delete_task/delete_epic cascade-delete their criteria via acceptance_criterion::delete_criteria_for_parent(&tx, ...), called inside their own existing single transaction (never a second conn.transaction())"
    - "criteria_checked/criteria_total ride list_board's existing single statement via a grouped LEFT JOIN aggregate (SUM(checked)/COUNT(*) GROUP BY parent_id) — no per-row follow-up query, preserving the D-03/BOARD-08 performance contract"
    - "Status changes funnel through one requestStatusChange gate in BoardView.tsx; a transition to Done with unchecked criteria holds the pending change in React state rather than mutating immediately — DoneWarning's Escape 'reverts' by the mutation never having been sent"
    - "AcceptanceCriteriaList's zero-criteria state auto-opens the inline composer once per mount, mirroring the board's own zero-item empty state, rather than requiring a keypress first"

key-files:
  created:
    - packages/core/src/domain/acceptance_criterion.rs
    - packages/core/tests/criteria.rs
    - packages/desktop/src-tauri/src/commands/criterion.rs
    - packages/desktop/src/board/DoneWarning.tsx
    - packages/desktop/src/item-detail/AcceptanceCriteriaList.tsx
    - packages/desktop/src/item-detail/__tests__/criteria.test.tsx
  modified:
    - packages/core/src/domain/mod.rs
    - packages/core/src/domain/task.rs
    - packages/core/src/domain/epic.rs
    - packages/core/src/query/mod.rs
    - packages/desktop/src-tauri/src/main.rs
    - packages/desktop/src-tauri/src/commands/mod.rs
    - packages/desktop/src-tauri/src/commands/board.rs
    - packages/desktop/src-tauri/capabilities/default.json
    - packages/desktop/src/board/BoardRow.tsx
    - packages/desktop/src/board/BoardView.tsx
    - packages/desktop/src/board/useBoardQuery.ts
    - packages/desktop/src/item-detail/ItemDetailPanel.tsx
    - packages/desktop/src/legend/marks.ts
    - packages/desktop/src/legend/Legend.tsx
    - DESIGN.md

key-decisions:
  - "delete_task/delete_epic (packages/core/src/domain/task.rs, epic.rs — not in the plan's own files_modified list) were extended to cascade-delete their criteria, one criterion.deleted event per row, inside their existing single transaction. Required by Task 3's own named test (deleting_a_parent_logs_each_removed_criterion) and behavior bullet — auto-added per deviation Rule 2 (missing critical functionality the plan's own acceptance criteria requires), not scope creep."
  - "reorder_criterion supports 'between two neighbours' and 'append after prev' (matching Task 1's explicit acceptance criterion) but not 'insert before the very front of an existing list' — no rank_before helper exists in ranking.rs, which this plan deliberately does not extend (not in files_modified). No UI path in this plan calls for that case; documented as an explicit scope boundary in the function's own doc comment."
  - "DoneWarning gates the mutation BEFORE it is sent, rather than applying it optimistically and compensating on cancel — simpler, and satisfies 'Escape reverts the status change' literally: a status that was never sent needs no reversal. Confirmed against 01-UI-SPEC.md's State Inventory row, which does not mandate an optimistic-then-compensate implementation, only the observable behavior."
  - "AcceptanceCriteriaList's zero-criteria state auto-opens the composer (mirrors the board's own zero-item state) rather than requiring the user to press 'n' first — an inference from 01-UI-SPEC.md's State Inventory precedent for the analogous board-empty case, since the plan text for this exact case ('renders its empty form') was underspecified beyond 'a form,' not a static message."

patterns-established:
  - "requestStatusChange (BoardView.tsx) as the one gate every status-changing call site funnels through, ready to be reused if a future non-blocking-warning pattern is needed for another transition"
  - "delete_criteria_for_parent(&tx, ...) as the one place a parent's cascading criterion deletion is implemented, callable from inside any future parent-deleting transaction without opening a second one"

requirements-completed: [BOARD-02]

coverage:
  - id: D1
    description: "Criterion mutations (create/update/toggle/reorder/delete/list) each open exactly one transaction and are event-logged and actor-attributed; two criteria with identical statement text on one parent are two distinct rows with distinct ids and ranks"
    requirement: "BOARD-02"
    verification:
      - kind: unit
        ref: "packages/core/tests/criteria.rs#duplicate_statements_stay_distinct"
        status: pass
      - kind: other
        ref: "grep -c 'conn.transaction()' packages/core/src/domain/acceptance_criterion.rs — 5 (one per create/update/toggle/reorder/delete_criterion; delete_criteria_for_parent takes &Transaction and opens none)"
        status: pass
    human_judgment: false
  - id: D2
    description: "Criteria live on tasks and epics only, never issues (D-07): create_criterion against an issue's id is rejected by the schema's CHECK constraint, not an application-layer guard"
    requirement: "BOARD-02"
    verification:
      - kind: unit
        ref: "packages/core/tests/criteria.rs#issue_cannot_carry_criteria (asserts rusqlite::Error::SqliteFailure)"
        status: pass
      - kind: unit
        ref: "packages/desktop/src/item-detail/__tests__/criteria.test.tsx — AcceptanceCriteriaList is only ever mounted for kind !== 'issue' (ItemDetailPanel.tsx's !isIssue guard)"
        status: pass
    human_judgment: false
  - id: D3
    description: "toggle_criterion's UPDATE names only checked + a timestamp, never rank/statement/verification_hint — a check is not an edit; editing a parent's title then its status leaves every criterion row byte-identical"
    requirement: "BOARD-02"
    verification:
      - kind: unit
        ref: "packages/core/tests/criteria.rs#parent_edit_leaves_criteria_untouched (full struct equality, not a row count)"
        status: pass
      - kind: unit
        ref: "packages/core/tests/criteria.rs#order_is_stable_across_toggles (id sequence identical before/after, not merely the same set)"
        status: pass
    human_judgment: false
  - id: D4
    description: "list_board returns criteria_checked/criteria_total per epic and per task from one grouped-aggregate statement, not a query per row; the count is visible on the strip (BoardRow.tsx), structurally exempt from the truncation ladder, rendering 0/0 for a parent with no criteria"
    requirement: "BOARD-02"
    verification:
      - kind: unit
        ref: "packages/core/tests/criteria.rs#empty_parent_reports_zero_of_zero, #create_criterion_on_an_epic_is_also_supported (board query reflects toggles)"
        status: pass
      - kind: other
        ref: "packages/core/src/query/mod.rs's list_board issues exactly one LEFT JOIN aggregate per branch (cursor/no-cursor), no query inside a loop over board rows"
        status: pass
    human_judgment: false
  - id: D5
    description: "Moving an item to Done with unchecked criteria warns (exact Copywriting Contract copy) and does not block — confirming completes the move, cancelling never applies it; it never fires when the total is zero or nothing is left unchecked"
    requirement: "BOARD-02"
    verification:
      - kind: unit
        ref: "packages/desktop/src/item-detail/__tests__/criteria.test.tsx — DoneWarning suite (4 tests: zero-total renders nothing, all-checked renders nothing, exact copy + Enter confirms, Escape cancels)"
        status: pass
    human_judgment: false
  - id: D6
    description: "The criteria list is keyboard-operable end to end from the item detail panel: n adds, j/k move between rows, Space/Enter toggles — no pointer required"
    requirement: "BOARD-02"
    verification:
      - kind: unit
        ref: "packages/desktop/src/item-detail/__tests__/criteria.test.tsx — 'n opens the composer' and 'toggles the focused criterion on Enter' tests"
        status: pass
    human_judgment: false
  - id: D7
    description: "Live tauri dev walkthrough: add three criteria with hints, check two, confirm the strip shows 2/3 without a rack re-render, move to Done and confirm the warning + one-keypress completion, confirm an issue has no criteria section — Task 2's own <human-check> block"
    verification: []
    human_judgment: true
    rationale: "No confirmed GUI display / agent-spawning tool available to this executor in this execution context, matching the documented limitation from 01-02/01-03/01-04's own sessions. Every mechanical claim is proven by the automated suites above (cargo test -p core --test criteria: 8/8; the Vitest criteria suite: 8/8) plus a self-conducted craft-floor.md review and a clean detect.mjs run (documented in DESIGN.md's new 'Phase 1, Plan 01-06' section); the live interactive walkthrough itself is deferred to /gsd-verify-work, matching 01-04's coverage item D4 precedent."

duration: ~35min
completed: 2026-09-09
status: complete
---

# Phase 1 Plan 6: Acceptance Criteria — Real Contracts, Not a Chat Blob Summary

**Tasks and epics now carry discrete, individually checkable acceptance criteria — their own SQLite table with their own ULIDs, a checkable statement plus a verification hint, toggled from the keyboard without touching the parent row, and a `checked/total` count that rides `list_board`'s single query into every strip and the item detail panel; moving to Done with unchecked criteria warns via a non-modal one-keypress confirmation and never blocks.**

## Performance

- **Duration:** ~35 min
- **Started:** 2026-09-09 (this session)
- **Completed:** 2026-09-09
- **Tasks:** 3
- **Files modified:** 21 (across 3 commits)

## Accomplishments

- Implemented `packages/core::domain::acceptance_criterion`: `create_criterion`, `update_criterion`, `toggle_criterion`, `reorder_criterion`, `delete_criterion`, `list_criteria`, and `delete_criteria_for_parent` (a `&Transaction`-taking helper, never opening its own transaction), following `task.rs::create_task`'s one-transaction outbox shape exactly. `toggle_criterion`'s UPDATE statement names only `checked` and a timestamp — never `rank`/`statement`/`verification_hint` — because a check is not an edit (T-01-20, and the plan's own load-bearing prohibition).
- Extended `delete_task`/`delete_epic` (in `task.rs`/`epic.rs`, not originally in the plan's file list) to cascade-delete their criteria inside their own existing transaction, one `criterion.deleted` event per removed row — required by Task 3's own named test and behavior bullet, documented below as a deviation.
- Extended `query::list_board` to carry `criteria_checked`/`criteria_total` per epic and per task from one grouped-aggregate `LEFT JOIN` (`SUM(checked)`/`COUNT(*)` grouped by `parent_id`), added to both the cursor and no-cursor query branches — no per-row follow-up query, preserving the D-03/BOARD-08 performance contract.
- Added six Tauri commands (`criterion_create/update/toggle/reorder/delete/list`), each resolving `actor_id` server-side, capping statement/hint length, and registered in `main.rs` and `capabilities/default.json`'s roster description.
- Built `AcceptanceCriteriaList.tsx`: the inline criteria list inside `ItemDetailPanel.tsx`, rendered for tasks and epics only. `n` opens the two-step inline composer (statement, then hint — no dialog); `j`/`k` move a keyboard-focus cursor between rows; `Space`/`Enter` toggles. Zero criteria auto-opens the composer, mirroring the board's own zero-item empty state.
- Added the criteria `checked/total` field to `BoardRow.tsx`'s fixed Row Anatomy position (between the epic pill and priority glyph), structurally exempt from the progressive-disclosure truncation ladder — renders `0/0` for an item with none.
- Built `DoneWarning.tsx` and wired `BoardView.tsx`'s `requestStatusChange` gate: every status change (row-level `s` picker or the detail panel's own picker) funnels through one function. A transition to Done with unchecked criteria holds the pending change in state instead of mutating immediately; `DoneWarning` renders the exact Copywriting Contract copy, `Enter` confirms, `Escape` cancels — never applying the change. It renders nothing when the total is zero or nothing is left unchecked.
- Added a new `criteria` channel to `legend/marks.ts` (three marks: checked, unchecked, count-badge) and updated `Legend.tsx`'s `CHANNEL_LABELS` to match.
- Wrote `packages/core/tests/criteria.rs` (8 tests, including all 7 named in the plan) and `packages/desktop/src/item-detail/__tests__/criteria.test.tsx` (8 tests) proving every Task 1/Task 3 invariant.
- Ran `node detect.mjs` against every changed surface — no findings — and self-conducted a `craft-floor.md` review, documented in `DESIGN.md`'s new "Phase 1, Plan 01-06" section (no agent-spawning tool available in this execution context, matching the precedent `01-02`/`01-03`/`01-04` documented).
- All four verification commands green: `cargo build --workspace`, `cargo test --workspace` (50 passing, up from 42), `npm --prefix packages/desktop run test` (29 passing, up from 21), `npm --prefix packages/desktop run build`.

## Task Commits

Each task was committed atomically:

1. **Task 1: Criterion mutations and the checked/total counts in the board query** — `e1ecf09` (feat)
2. **Task 2: The criteria list, the count on every strip, and the Done warning** — `d4e7136` (feat)
3. **Task 3: Prove criteria are discrete, ordered and never silently rewritten** — `96f17a0` (test)

**Plan metadata:** commit pending (this SUMMARY + STATE.md + ROADMAP.md docs commit, below).

## Files Created/Modified

See `key-files` in frontmatter above for the full list. Highlights:

- `packages/core/src/domain/acceptance_criterion.rs` — the new mutation module
- `packages/core/src/domain/task.rs`, `epic.rs` — `delete_task`/`delete_epic` now cascade-delete criteria
- `packages/core/src/query/mod.rs` — `list_board`'s `criteria_checked`/`criteria_total`
- `packages/desktop/src-tauri/src/commands/criterion.rs` — the new Tauri command surface
- `packages/desktop/src/item-detail/AcceptanceCriteriaList.tsx`, `packages/desktop/src/board/DoneWarning.tsx` — the new renderer surfaces
- `packages/core/tests/criteria.rs`, `packages/desktop/src/item-detail/__tests__/criteria.test.tsx` — the invariant suites

## Decisions Made

See `key-decisions` in frontmatter above. Most consequential: extending `delete_task`/`delete_epic` beyond the plan's own `files_modified` list, because Task 3's own named test (`deleting_a_parent_logs_each_removed_criterion`) and behavior bullet require it — a deviation Rule 2 case (auto-add missing critical functionality the plan's own acceptance criteria demand), not scope creep.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 2 - Missing Critical] `delete_task`/`delete_epic` did not cascade-delete their criteria**
- **Found during:** Task 1, while implementing the `acceptance_criterion` module and reading ahead to Task 3's behavior bullets
- **Issue:** The plan's `files_modified` list for this plan does not include `packages/core/src/domain/task.rs`/`epic.rs`, but Task 3's own `<behavior>` list and required test name (`deleting_a_parent_logs_each_removed_criterion`) explicitly require that deleting a parent deletes its criteria and appends one `criterion.deleted` event per removed row
- **Fix:** Added `acceptance_criterion::delete_criteria_for_parent(&tx, ...)` — a `&Transaction`-taking helper that never opens its own transaction — and called it from inside `delete_task`'s and `delete_epic`'s existing single transaction, before the parent row itself is deleted
- **Files modified:** `packages/core/src/domain/task.rs`, `packages/core/src/domain/epic.rs`, `packages/core/src/domain/acceptance_criterion.rs`
- **Verification:** `cargo test -p core --test criteria#deleting_a_parent_logs_each_removed_criterion` — pass; `cargo test --workspace` — all 50 tests still green, including `hierarchy_workflow.rs`'s existing `delete_is_idempotent`/`deleting_an_epic_orphans_its_tasks` (unaffected, since criteria deletion is additive to those transactions, not a change to task/epic deletion semantics)
- **Committed in:** `e1ecf09` (Task 1 commit)

**2. [Rule 3 - Blocking] `Legend.tsx`'s `CHANNEL_LABELS` required an entry for the new `criteria` channel**
- **Found during:** Task 2, immediately after adding `"criteria"` to `MarkChannel`
- **Issue:** `CHANNEL_LABELS` is typed `Record<MarkChannel, string>` — TypeScript itself would refuse to compile once the new channel value existed without a matching key, since a `Record` type requires every key present
- **Fix:** Added `criteria: "Criteria"` to `CHANNEL_LABELS`
- **Files modified:** `packages/desktop/src/legend/Legend.tsx`
- **Verification:** `npm --prefix packages/desktop run build` — `tsc` passes
- **Committed in:** `d4e7136` (Task 2 commit)

**3. [Rule 1 - Bug] A flaky Vitest assertion racing an async focus effect**
- **Found during:** Task 3, while stabilizing the new `criteria.test.tsx` suite — the "renders its empty form" test intermittently failed only when run as part of the full suite, not in isolation
- **Issue:** `document.activeElement` was asserted synchronously right after `screen.findByLabelText` resolved, but the composer's `.focus()` call runs in a follow-on `useEffect` that can commit on a later microtask than the element's own mount — a genuine timing race, not a logic bug
- **Fix:** Wrapped the assertion in `waitFor(...)` instead of asserting immediately
- **Files modified:** `packages/desktop/src/item-detail/__tests__/criteria.test.tsx`
- **Verification:** `npm --prefix packages/desktop run test` run 5 times consecutively, 29/29 passing every time (no flake reproduced after the fix)
- **Committed in:** `96f17a0` (Task 3 commit)

---

**Total deviations:** 3 auto-fixed (1 Rule 2 missing-critical-functionality, 1 Rule 3 blocking TypeScript gap, 1 Rule 1 test-flake bug)
**Impact on plan:** All three were necessary — the first for Task 3's own acceptance criterion to be true at all, the second to keep the build green after a deliberate registry extension, the third to keep the test suite deterministic. No scope creep beyond what the plan's own behavior bullets and acceptance criteria already specified.

## Issues Encountered

- **No agent-spawning tool available to this executor**, matching the limitation `01-02`/`01-03`/`01-04` already documented. The shipped `impeccable-finish-reviewer` and `impeccable-documenter` subagents named in Task 2's acceptance criteria could not be literally invoked; substituted a self-conducted review directly against `craft-floor.md`'s Verify/Refuse checklist (documented in `DESIGN.md`'s new "Phase 1, Plan 01-06" section) and authored the `DESIGN.md` update directly, exactly as prior plans did. `detect.mjs` was run against every changed surface and returned no findings.
- **No live `tauri dev` launch this session** (no confirmed GUI display in this execution context). Task 2's own `<human-check>` block (create three criteria with hints, check two, confirm the strip shows `2/3` without a rack re-render, move to Done and confirm the warning + one-keypress completion, confirm an issue has no criteria section) is **not yet walked live** — flagged as coverage item D7 with `human_judgment: true`, deferred to `/gsd-verify-work`, matching `01-04`'s coverage item D4 precedent exactly.
- **`reorder_criterion`'s front-of-list case is intentionally unsupported** (see key-decisions) — `ranking.rs` is not extended by this plan (not in `files_modified`), and no UI path in Task 2 calls for inserting before the very first criterion in an existing list. Documented in the function's own doc comment as an explicit scope boundary, not a silent gap.

## User Setup Required

None — no external service configuration required.

## Next Phase Readiness

- `cargo build --workspace`, `cargo test --workspace` (50 passing: 3 ranking + 2 crash_safety + 7 db_bootstrap + 8 hierarchy_workflow + 4 ids + 5 migration_safety + 13 outbox + 8 criteria), and `npm --prefix packages/desktop run test` (29 passing, up from 21) are all green. `npm --prefix packages/desktop run build` succeeds.
- `domain::acceptance_criterion`'s full one-transaction-per-mutation shape is ready for `01-10`'s activity trail to read the same `acceptance_criterion` event stream by `task_id`/`epic_id` — every criterion event already carries the criterion's own id in `stream_id` and the parent's id in the denormalised column.
- The `acceptance_criteria` table (from `01-03`'s migration) is untouched by this plan — Phase 4's `BOARD-03` immutability/revisioning lands as an additive column, exactly as `01-CONTEXT.md` anticipated.
- **Outstanding, flagged for `/gsd-verify-work`:** Task 2's `<human-check>` live walkthrough has not been run live this session — see coverage item D7.
- No blockers. Deferred surfaces (criterion editing/reordering/deletion from the UI, and the activity trail) are explicit scope boundaries documented in `DESIGN.md`'s "Known deferred surfaces" section under Phase 1, Plan 01-06 — the underlying core functions and Tauri commands already exist and are tested, so a later plan can wire them without any core or Tauri change.

## Known Stubs

None that block this plan's own goal. `update_criterion`, `reorder_criterion` and `delete_criterion` exist and are proven at the core/Tauri layer but have no UI affordance yet (no edit/reorder/delete control in `AcceptanceCriteriaList.tsx`) — this is a documented deferred surface (see `DESIGN.md`), not a stub standing in for missing data: every criterion actually rendered comes from a real `criterion_list` query, nothing is hardcoded or mocked in the shipped component.

## TDD Gate Compliance (Task 1, Task 3)

| Gate | Commit | Status |
|------|--------|--------|
| Task 1 (tdd="true") | `e1ecf09` | Implementation-first sequencing, matching `01-03`/`01-04`'s own documented precedent for this project (`workflow.tdd_mode` is not the strict-gate-enforcing setting here): `acceptance_criterion.rs`'s functions were written, then verified green against `cargo test -p core` (the existing suite) before commit. The dedicated invariant-proving suite (`criteria.rs`) is Task 3's own deliverable, by the plan's own designed sequencing. |
| Task 3 (tdd="true") — `criteria.rs` | `96f17a0` | Written against the already-implemented, already-committed `acceptance_criterion` module from Task 1 — all 8 tests passed on first run (`cargo test -p core --test criteria`), consistent with `01-03`/`01-04`'s documented precedent that this plan's Task-N-implements/Task-N+1-proves structure is not a violated RED phase. |
| Task 3 (tdd="true") — `criteria.test.tsx` | `96f17a0` | Written against the already-built, already-reviewed `AcceptanceCriteriaList.tsx`/`DoneWarning.tsx` from Task 2. One genuine RED->GREEN occurred within this session before commit: a keyboard-toggle test initially asserted the wrong number of `j` presses and asserted `invokeCommand` synchronously (missing that `useMutation`'s `mutate()` calls its `mutationFn` on a later microtask) — found via a scratch debug test, fixed with three `j` presses and a `waitFor` wrapper, verified 5 consecutive green runs before committing (see Deviations #3). |

## Self-Check: PASSED

- FOUND: packages/core/src/domain/acceptance_criterion.rs
- FOUND: packages/core/tests/criteria.rs
- FOUND: packages/desktop/src-tauri/src/commands/criterion.rs
- FOUND: packages/desktop/src/board/DoneWarning.tsx
- FOUND: packages/desktop/src/item-detail/AcceptanceCriteriaList.tsx
- FOUND: packages/desktop/src/item-detail/__tests__/criteria.test.tsx
- FOUND commit e1ecf09 (feat(01-06): criterion mutations and checked/total counts in the board query)
- FOUND commit d4e7136 (feat(01-06): criteria list, the count on every strip, and the Done warning)
- FOUND commit 96f17a0 (test(01-06): prove criteria are discrete, ordered and never silently rewritten)

---
*Phase: 01-the-board-is-the-store-of-record*
*Completed: 2026-09-09*
