---
phase: 04-clear-is-free
plan: 04
subsystem: board
tags: [rusqlite, acceptance-criteria, revisioning, sqlite-migration, context-packet]

requires:
  - phase: 04-clear-is-free
    provides: "plan 04-01's session_summaries table and context_packet.rs, extended (not
      rewritten) here — migration 0009 follows 0008's own append-only registration pattern"
provides:
  - "acceptance_criteria.revision/revision_of/superseded_at and agent_runs.criteria_revision_pin
    (migration 0009), all additive ADD COLUMN steps"
  - "domain::acceptance_criterion::revise_criterion/criteria_locked_for_task/
    list_current_criteria/list_revisions_for_root/CriteriaLockedError"
  - "current-revision-only reads in context_packet.rs's CRITERIA_SQL and query/mod.rs's
    CRITERIA_JOIN, so a superseded criterion never reaches an agent's packet or a board badge"
affects: [04-09]

actuals:
  tokens: 12447
  tasks: 3
  commits: 3

tech-stack:
  added: []
  patterns:
    - "One-transaction row-write-plus-event, both revise_criterion branches (copied from
      create_criterion/permission_request::create_pending_request)"
    - "Single in-place-edit statement site: update_criterion_in_tx, shared by update_criterion and
      revise_criterion's unlocked branch"
    - "Chain-root pointer (revision_of names the FIRST row, never the immediate predecessor) so the
      whole history is one indexed query, never a walk"
    - "Lock is a fact (agent_runs row existence), never a status flag a human can hand-edit"

key-files:
  created:
    - packages/core/src/db/migrations/0009_criteria_revisions.sql
  modified:
    - packages/core/src/db/mod.rs
    - packages/core/src/domain/acceptance_criterion.rs
    - packages/core/src/context_packet.rs
    - packages/core/src/query/mod.rs
    - packages/core/tests/criteria.rs

key-decisions:
  - "revision_of always points at the chain root (the criterion's original row), never the
    immediate predecessor — list_revisions_for_root is one indexed query, not a linked-list walk"
  - "criteria_locked_for_task queries agent_runs directly, never tasks.status — D-29's identical
    concern about a human hand-editing status applies equally to the revision lock"
  - "update_criterion's existing behaviour, signature and event are unchanged; it was factored into
    update_criterion_in_tx (statement-only) plus its own read/event/commit so there is exactly one
    in-place-edit statement site, shared with revise_criterion's unlocked branch"
  - "list_criteria stays the unfiltered full-history read; list_current_criteria is the new,
    explicitly-named filtered sibling — a future caller picks deliberately, not by accident"

patterns-established:
  - "Pattern: superseded-row filtering lives in the shared query constants (CRITERIA_SQL,
    CRITERIA_JOIN), never a second ad hoc filtered copy — every window query and search.rs inherit
    it for free"

requirements-completed: [BOARD-03]

coverage:
  - id: D1
    description: "Editing a criterion on a task that has ever had an agent run appends a revision
      row and leaves the original statement byte-identical, with the successor inheriting rank and
      checked; editing a criterion on a task that never had a run still edits in place with no
      revision row created"
    requirement: BOARD-03
    verification:
      - kind: integration
        ref: "tests/criteria.rs#revising_a_locked_criterion_appends_a_successor_and_leaves_the_original_byte_identical"
        status: pass
      - kind: integration
        ref: "tests/criteria.rs#revising_an_unlocked_criterion_edits_in_place"
        status: pass
      - kind: integration
        ref: "tests/criteria.rs#the_successor_inherits_rank_and_checked_across_a_revision"
        status: pass
      - kind: integration
        ref: "tests/criteria.rs#revising_twice_produces_a_three_revision_chain_sharing_one_root"
        status: pass
      - kind: integration
        ref: "tests/criteria.rs#criteria_locked_for_task_is_false_before_any_agent_run_and_true_after"
        status: pass
      - kind: integration
        ref: "tests/criteria.rs#both_revise_branches_append_exactly_one_event_and_the_locked_branch_is_criterion_revised"
        status: pass
      - kind: integration
        ref: "tests/criteria.rs#revising_an_unknown_criterion_id_returns_an_error_and_writes_nothing"
        status: pass
    human_judgment: false
  - id: D2
    description: "Every read path that shows criteria to a human or an agent — the context packet,
      the board's criteria counts, and a newly added criterion's rank — sees current revisions
      only, while the full chain stays queryable for the developer-facing history surface"
    requirement: BOARD-03
    verification:
      - kind: integration
        ref: "tests/criteria.rs#revising_one_of_three_criteria_keeps_the_packet_and_board_count_at_three_and_never_leaks_the_superseded_text"
        status: pass
      - kind: integration
        ref: "tests/criteria.rs#a_newly_added_criterion_ranks_after_the_last_current_one_not_a_superseded_row"
        status: pass
      - kind: unit
        ref: "cargo test -p core --test context_packet (10/10 pass, unchanged by this plan's filter)"
        status: pass
      - kind: unit
        ref: "cargo test -p core --test search_filter (8/8 pass, board window unaffected)"
        status: pass
    human_judgment: false

duration: 36min
completed: 2026-09-23
status: complete
---

# Phase 4 Plan 4: Criteria Immutability & Revisioning Summary

**Migration 0009 lands acceptance_criteria's revision/revision_of/superseded_at columns, `revise_criterion` decides between an in-place edit and an appended revision based on whether the parent task has ever had an agent run, and every criteria-reading path (the agent's own context packet, the board's x/y badge, a newly added criterion's rank) is restricted to current revisions only.**

## Performance

- **Duration:** 36 min
- **Started:** 2026-09-23T00:11:49Z
- **Completed:** 2026-09-23T00:48:05Z
- **Tasks:** 3
- **Files modified:** 6 (1 created, 5 modified)

## Accomplishments

- Migration `0009_criteria_revisions.sql`: four plain `ALTER TABLE ... ADD COLUMN` statements
  (`acceptance_criteria.revision`/`revision_of`/`superseded_at`, `agent_runs.criteria_revision_pin`)
  plus one supporting index — no table rebuild, no `CREATE TABLE`, matching `0007`'s own
  additive-only precedent.
- `criteria_locked_for_task` (D-76): the lock is a fact — a literal existence query against
  `agent_runs` keyed on `task_id` — never `tasks.status`, which a human can hand-edit.
- `revise_criterion` (D-77): the one write path that decides. Unlocked, it delegates to
  `update_criterion_in_tx` (the same statement site `update_criterion` now also delegates to) —
  no revision row, no marker. Locked, it mints a successor row (new `revision`, `revision_of`
  pointing at the chain root, inheriting the predecessor's `rank`/`checked`) and stamps the
  predecessor's `superseded_at` in a single-column `UPDATE` that never touches `statement`,
  appending one `criterion.revised` event carrying the before/after statement pair.
- `list_current_criteria`/`list_revisions_for_root` (D-79): the current-revision-only sibling of
  `list_criteria`, and the whole-chain read (newest first, matching on the chain root) for the
  developer-facing history surface plan 04-09 builds.
- `context_packet.rs`'s `CRITERIA_SQL` and `query/mod.rs`'s `CRITERIA_JOIN` (shared by every board
  window query and `search.rs`) both restrict to `superseded_at IS NULL` — a superseded criterion
  can never reach an agent's prompt or inflate a board row's `x/y` badge.
- `create_criterion`'s tail-rank lookup restricted to current revisions, so a newly added criterion
  ranks after the last *current* one, not a superseded row that may still sort later by rank alone.
- 9 new tests in `criteria.rs` (17 total in the file, up from 8) covering the lock fact, both
  revise branches, rank/checked inheritance across a revision, a three-revision chain sharing one
  root, per-branch event counts and payloads, the unknown-id error path, the tail-rank restriction,
  and the packet/board-count/history-chain read-path assertions together.

## Task Commits

Each task was committed atomically (with one file-coupling note below):

1. **Task 1: The additive revision schema, and the lock that is a fact rather than a flag** —
   `c451d1b` (feat) — migration + `db/mod.rs` registration. Task 1's `acceptance_criterion.rs`
   additions (struct fields, `criteria_locked_for_task`, `CriteriaLockedError`) landed in the
   Task 2 commit below — see Deviations.
2. **Task 2: revise_criterion — an edit that appends instead of overwriting** — `3ebec8b` (feat) —
   `acceptance_criterion.rs` (all of Tasks 1-3's domain-layer changes: struct fields, the lock,
   `revise_criterion`, `list_current_criteria`/`list_revisions_for_root`, the tail-rank
   restriction) plus `criteria.rs`'s new tests.
3. **Task 3: Every read path shows current revisions only** — `4572563` (feat) —
   `context_packet.rs` and `query/mod.rs`'s read-path restrictions (the file-separable half of
   Task 3; the domain-layer half is in commit 2, see Deviations).

_No plan metadata commit required beyond these three — STATE.md/ROADMAP.md updates follow in this
same session._

## Files Created/Modified

- `packages/core/src/db/migrations/0009_criteria_revisions.sql` - the revision columns and the pin column
- `packages/core/src/db/mod.rs` - registers migration 0009 (append-only, after 0008)
- `packages/core/src/domain/acceptance_criterion.rs` - `revise_criterion`, `criteria_locked_for_task`, `CriteriaLockedError`, `update_criterion_in_tx`, `list_current_criteria`, `list_revisions_for_root`, extended `AcceptanceCriterion` and every existing read/return site
- `packages/core/src/context_packet.rs` - `CRITERIA_SQL` restricted to current revisions
- `packages/core/src/query/mod.rs` - `CRITERIA_JOIN` restricted to current revisions
- `packages/core/tests/criteria.rs` - 9 new tests, `mod common;` plus a `with_scratch_worktree_root` helper for the lock/revision tests that need a real `agent_runs` row

## Decisions Made

- `revision_of` always points at the chain root, never the immediate predecessor, so
  `list_revisions_for_root` is one indexed query rather than a linked-list walk.
- `criteria_locked_for_task` queries `agent_runs` directly, mirroring D-29's identical concern that
  a human-editable status column must never be the thing that toggles a correctness guarantee.
- `update_criterion`'s existing behaviour/signature/event are unchanged; it was factored into
  `update_criterion_in_tx` (statement-only) plus its own read/event/commit, so there is exactly one
  in-place-edit statement site in the crate, shared with `revise_criterion`'s unlocked branch.
- `list_criteria` stays the unfiltered full-history read; `list_current_criteria` is the new,
  explicitly-named filtered sibling — both doc comments say which is which.

## Deviations from Plan

### Commit-granularity note (not a content deviation)

**Task boundaries could not be mapped 1:1 to file-level commits.** `packages/core/src/domain/acceptance_criterion.rs` is the single file every one of the plan's three tasks extends (Task 1's struct fields and lock, Task 2's `revise_criterion`, Task 3's tail-rank restriction and `list_current_criteria`/`list_revisions_for_root`), and it was implemented as one continuous, mutually-dependent editing pass rather than three independently-committable states (Task 2's `revise_criterion` calls Task 1's `criteria_locked_for_task`; Task 3's tail-rank fix and read helpers sit in the same functions Task 1/2 already touched). Splitting the file's diff into three commits via `git add -p` hunk selection was assessed and rejected as producing artificial intermediate states with no runtime or review benefit, at real risk of a bad hunk boundary breaking compilation mid-sequence. The three commits above instead group by what IS cleanly file-separable: migration + registration (commit 1, purely Task 1), the whole domain module plus its tests (commit 2, Tasks 1-3's `acceptance_criterion.rs` work), and the two read-path query files (commit 3, the file-separable half of Task 3). Every commit builds and passes its own scoped tests; nothing was committed in a broken intermediate state.

### Auto-fixed Issues

None — plan executed exactly as written; the `destructive_classifier.rs` migration-count test flagged in the plan's own project notes was already made migration-agnostic by plan 04-01's own deviation fix (`migration_source_list_registers_the_destructive_gate_column_exactly_once`, which asserts neither a total count nor a last-migration position) and needed no further change for 0009. Confirmed: `cargo test -p core --test destructive_classifier` — 76/76 passing.

---

**Total deviations:** 0 content deviations; 1 documented commit-granularity note (file coupling, no behavioural impact).
**Impact on plan:** None on functionality or test coverage — only on how the three tasks' work is distributed across commits.

## Issues Encountered

- **Pre-existing, unrelated test flakiness in `packages/core/tests/credentials.rs`.** Running
  `cargo test --workspace` surfaced `api_key_configured_at_is_read_from_a_database_setting_not_the_keychain`
  failing with "The specified item already exists in the keychain" — a macOS Keychain
  read/write race among that file's ~10 concurrently-run keychain-touching tests (several logged
  "has been running for over 60 seconds" during the same run), not a regression from this plan.
  Confirmed out of scope: this plan touches no file under `domain::credentials`/`credentials.rs`,
  and the test passes cleanly in isolation (`cargo test -p core --test credentials
  api_key_configured_at_is_read_from_a_database_setting_not_the_keychain` — 1/1 pass). A full
  `cargo test --workspace --no-fail-fast` run skipping only that one test name completed with zero
  other failures across every crate (core, desktop, shim). Not auto-fixed per the deviation rules'
  scope boundary (pre-existing, unrelated to this task's changes) — left as-is.

## User Setup Required

None - no external service configuration required.

## Next Phase Readiness

- BOARD-03's full write path is in place: the lock, the revision chain, and every read path
  restricted to current revisions. Plan 04-09 (deferred by this plan's own objective) still owes
  the `criterion_revise` Tauri command, the UI's "revised" marker (D-79), and D-78's
  `agent_runs.criteria_revision_pin` write path — this plan added the column but no writer for it
  yet (deliberately; the plan's own objective names 04-09 as the owner).
- `list_current_criteria`/`list_revisions_for_root` are already exposed for 04-09's Tauri command
  layer and the "revised" marker's expand-to-prior-text interaction — no interface gap to close.
- No blockers for 04-05 (the next plan by wave/dependency ordering).

---
*Phase: 04-clear-is-free*
*Completed: 2026-09-23*

## Self-Check: PASSED
