---
phase: 09-planned-fan-out-that-does-not-collide
plan: 03
subsystem: dispatcher
tags: [file-set, overlap, waves, ordering-edges, dispatch-plan, why, rusqlite]

requires:
  - phase: 09-planned-fan-out-that-does-not-collide
    provides: "plan 09-01: the file_set matcher (parse_entry, covers), task_file_set_entries, migration 0019's dispatch tables; plan 09-02: list_entries_for_task over the database rows"
provides:
  - "file_set::overlaps / collisions / Collision: the one overlap implementation, symmetric, case-fold passed in"
  - "dispatch.rs: DISPATCH_TASK_STATES, DISPATCH_PLAN_STATES, normalise_waves, edges_for_plan, planned_tasks, why, occupied_slots, in_flight_declared_sets"
  - "domain/dispatch_plan.rs: plan, task and edge CRUD plus approve_plan, the one transaction that freezes edges and records task.sequenced events"
affects: [09-04 slot gate, 09-05, 09-06 widen re-check, 09-07 dispatcher, 09-08 widen path, 09-09 UI]

plan_head_before: a1c126cc42be4d6a3bd5337009c42b09a5a4b239

actuals:
  tokens: 13864
  tasks: 2
  commits: 4

tech-stack:
  added: []
  patterns:
    - "Edge orientation is the sorted order itself: sort by (wave, board rank, task id) and pair i<j inside a wave, so orientation is total and cycles cannot exist"
    - "Read the frozen record first: why() answers from dispatch_edges and falls back to plan rows only when no edge exists"
    - "Do subprocess work (core.ignorecase) before opening the write transaction; the in-transaction function takes the flag as a parameter"

key-files:
  created:
    - packages/core/src/dispatch.rs
    - packages/core/src/domain/dispatch_plan.rs
    - packages/core/tests/dispatch_plan.rs
  modified:
    - packages/core/src/file_set.rs
    - packages/core/tests/file_set_overlap.rs
    - packages/core/src/lib.rs
    - packages/core/src/domain/mod.rs

key-decisions:
  - "Equality is a collision: two dirs overlap iff either string prefixes the other (both end in a separator, so a/ vs a_x/ is disjoint); a file overlaps a dir only through covers"
  - "Only the colliding pair is ordered (D-158); a three-task wave with one collision yields exactly one edge"
  - "The edge's colliding paths are stored as a JSON array of {before, after} objects, where before is the predecessor's entry; the task.sequenced event carries the same shape and is attributed to the WAITING task"
  - "approve_plan is draft-only and fails loudly on a duplicate edge rather than skipping it; a pre-seeded edge is how the forced mid-transaction failure is produced"
  - "in_flight_declared_sets counts running and blocked runs and omits a live task with no declared set (unarmed, D-150)"

patterns-established:
  - "approve_plan / approve_plan_with split: the wrapper reads the repo's case-fold flag outside the transaction"

requirements-completed: [PLAN-02, PLAN-03, PLAN-07]

coverage:
  - id: D1
    description: "Every pair of candidate parallel tasks in a wave is checked for declared file-set overlap, and only the colliding pair is ordered"
    requirement: PLAN-02
    verification:
      - kind: integration
        ref: "packages/core/tests/dispatch_plan.rs#a_wave_of_three_with_one_collision_yields_exactly_one_edge_and_the_third_is_untouched"
        status: pass
      - kind: unit
        ref: "packages/core/tests/file_set_overlap.rs#the_overlap_truth_table_holds_in_both_argument_orders (20 rows, both argument orders)"
        status: pass
    human_judgment: false
  - id: D2
    description: "Edge orientation is stable (rank, then task id), deterministic over input order, and one-task or cross-wave inputs earn no edge"
    requirement: PLAN-03
    verification:
      - kind: unit
        ref: "packages/core/tests/dispatch_plan.rs#orientation_follows_board_rank_over_task_id, #equal_ranks_are_ordered_by_ascending_task_id, #edge_computation_is_deterministic_whatever_the_input_order, #identical_sets_in_different_waves_yield_no_edge"
        status: pass
    human_judgment: false
  - id: D3
    description: "A user can ask why two tasks were sequenced and gets the colliding paths frozen at approval, not a recomputation; widen, different-wave and disjoint answers are distinct"
    requirement: PLAN-07
    verification:
      - kind: integration
        ref: "packages/core/tests/dispatch_plan.rs (six why_* tests, run with -- why)"
        status: pass
    human_judgment: false
  - id: D4
    description: "Edges, task.sequenced events, the approved event and the status commit in one transaction or not at all"
    requirement: PLAN-03
    verification:
      - kind: integration
        ref: "packages/core/tests/dispatch_plan.rs#a_failure_part_way_through_approval_leaves_no_edges_no_events_and_a_draft_plan"
        status: pass
    human_judgment: false
  - id: D5
    description: "Case variants are sequenced exactly when the repository is case-insensitive; the DISPATCH_* constants mirror migration 0019's CHECK lists"
    requirement: PLAN-02
    verification:
      - kind: integration
        ref: "packages/core/tests/dispatch_plan.rs#the_case_fold_flag_decides_whether_case_variants_are_sequenced, #approving_with_case_folding_on_sequences_case_variants, #the_state_lists_each_have_one_declaration_and_the_migration_mirrors_them"
        status: pass
    human_judgment: false

duration: 25min
completed: 2026-10-09
status: complete
---

# Phase 9 Plan 03: Overlap Algebra, Per-Pair Ordering Edges and the Recorded Why Summary

**`overlaps`/`collisions` beside `covers` in the single matcher, a pure wave and edge computation that orders only the colliding pair by board rank then task id, and an approval transaction that freezes each edge's colliding paths so "why is this one waiting?" answers with what was acted on.**

## What the guarantee is, and what it is not

The overlap check compares the declared sets as stored. It is a plan-time prediction, not proof two tasks cannot collide: a task with no declared set is unarmed (D-150), has nothing to compare, and gets no edge. A `Bash` write outside a declared set is not seen here either; it is caught after the fact by plan 09-02's close-time backstop. T-09-03-05 (an undeclared manual launch colliding with a planned task) is accepted as the plan stated: `in_flight_declared_sets` can only see declared sets, and the residual falls to the merge-conflict path.

## Accomplishments

- `file_set::overlaps` covers exactly three cases (file/file equal, file/dir through `covers`, dir/dir by prefix either way) and is asserted symmetric over a 20-row table in both argument orders. `collisions` returns pairs in first-set-then-second-set declared order and carries both entries by reference so the caller names the paths. `file_set.rs` still performs no I/O.
- `edges_for_plan` sorts by (wave, rank, id) and pairs inside each wave, so the result is independent of input order and orientation is a total order. A pair in different waves is never enumerated. This is the difference from the GSD-core model, which downgrades the whole wave.
- `approve_plan` normalises waves, writes each edge with frozen `colliding_paths`, appends one `task.sequenced` event per edge (attributed to the waiting task) and a `dispatch_plan.approved` event, and flips the status, all in one transaction.
- `why` reads the stored edge first (either argument order), then falls back to `DifferentWaves`, `DisjointSets` or `NotInPlan`. After the declared sets are changed so they would no longer collide, `why` still returns the approved paths.
- `occupied_slots` and `in_flight_declared_sets` are database reads for plans 09-04, 09-06 and 09-07.

## Task Commits

1. **Task 1 RED: failing truth table for overlaps and collisions** - `2ac65c6` (test)
2. **Task 1 GREEN: overlaps and collisions in the single matcher** - `c589c39` (feat)
3. **Task 2 RED: failing tests for waves, edges, approval and why** - `ea67c7f` (test)
4. **Task 2 GREEN: waves, per-pair edges, frozen approval, why** - `6f3fb16` (feat)

**Plan metadata:** the `docs(09-03)` commit following this file.

## Files Created/Modified

- `packages/core/src/file_set.rs` - `overlaps`, `collisions`, `Collision`, one `ponytail:` ceiling comment on the quadratic enumeration
- `packages/core/src/dispatch.rs` - the pure and read-only half; no `Command`, no git
- `packages/core/src/domain/dispatch_plan.rs` - CRUD, `insert_edge_in_tx`, `approve_plan` / `approve_plan_with`, `read_plan`, `read_edges`; never writes `tasks.status`
- `packages/core/tests/file_set_overlap.rs` (36 tests, up from 29) and `packages/core/tests/dispatch_plan.rs` (28 tests)
- `packages/core/src/lib.rs`, `packages/core/src/domain/mod.rs` - module declarations

## Decisions Made

See `key-decisions`. One implementation note: `insert_edge_in_tx` is public because the live widen path (plan 09-08, cause `widen`) writes through the same function and the widen test uses it.

## Deviations from Plan

### Auto-fixed Issues

**1. [Process] Signatures beyond the plan's list**
- The plan names `approve_plan(conn, plan_id, actor_id)`. A second function `approve_plan_with(conn, plan_id, actor_id, fold_case, now)` was added so the case-fold-on path and a fixed clock are testable without a real case-insensitive repository, and `approve_plan` reads `core.ignorecase` before the write transaction opens. `insert_edge_in_tx`, `planned_tasks`, `PlanTaskInput` and the `EDGE_CAUSE_*` constants were also added; all are needed by the listed behaviour.
- **Files modified:** `packages/core/src/dispatch.rs`, `packages/core/src/domain/dispatch_plan.rs`

**2. [Rule 2 - Missing critical] Draft-only and same-epic guards**
- **Issue:** nothing in the plan stopped `replace_plan_tasks_in_tx` from storing a task of another epic or re-approving an approved plan, either of which would put a foreign task's edges on the board or duplicate every `task.sequenced` event.
- **Fix:** both are refused with a named error, validated before anything is deleted; each has a test.

**Total deviations:** 2 (1 process, 1 missing critical). **Impact:** none on scope; both support the plan's own acceptance criteria.

## Unresolved Planner Assumption (carried forward)

**A-09-03-01 (unresolved).** PLAN-07 says the user can *ask* why two tasks were sequenced. The deterministic edge probe could not classify the edge axis for a question-answering requirement. This plan proceeded on the assumption that "can ask" means both at approval time (inline on the wave plan) and after the fact (from the recorded event and frozen edge row), per D-157. `why` serves both call sites; if the owner meant only one, the other call site is unnecessary but nothing here is wrong. No behaviour was guessed from the unclassified row. No user-facing surface for asking exists yet; plan 09-09 owns it, so PLAN-07 is satisfied at the data and read layer only.

## Authentication Gates

None.

## Issues Encountered

- The full `packages/core` suite was not run (it exceeds 30 minutes on this machine and hangs on keychain prompts in `credentials`, as in 09-01 and 09-02). Run instead: `file_set_overlap` (36), `dispatch_plan` (28, six under `-- why`), `migration_safety`, `status_transitions`, `ranking`, `supervisor_cwd`, `runtime_context_call_sites`, `db_bootstrap`, `scope_events`, `scope_marker_contract`, `perf_seed_1000`, plus `cargo build --workspace` and the three grep gates. All pass.
- `cargo build --workspace` still reports one pre-existing `desktop` warning; none from the new files.
- Plan-level `cargo test --workspace` was therefore not run in full.

## Known Stubs

None.

## Threat Flags

None. No new endpoint, auth path or file access; the only new write surface is the plan tables migration `0019` already created.

## Next Phase Readiness

- Plan 09-04 can call `occupied_slots`; plans 09-06 and 09-07 can call `in_flight_declared_sets`.
- Plan 09-08's widen path writes `cause = 'widen'` edges through `insert_edge_in_tx`; `why` already reports that cause.
- Nothing yet moves `dispatch_plan_tasks.state` out of `planned`; that is the dispatcher tick (09-07).

## Self-Check: PASSED

Created files verified present: `packages/core/src/dispatch.rs`, `packages/core/src/domain/dispatch_plan.rs`, `packages/core/tests/dispatch_plan.rs`. Commits `2ac65c6`, `c589c39`, `ea67c7f`, `6f3fb16` verified in `git log`; each RED precedes its GREEN. Every `<automated>` verify command in both tasks was run and passes, including the `-- why` filter (6 passed), the three source grep gates and `grep -c 'pub mod dispatch;'` = 1.
