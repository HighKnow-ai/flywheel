---
phase: 04-clear-is-free
plan: 10
subsystem: board
tags: [rusqlite, tauri-commands, react, acceptance-criteria, revisioning, tdd]

requires:
  - phase: 04-clear-is-free
    provides: "plan 04-04's revise_criterion/criteria_locked_for_task/list_current_criteria/
      list_revisions_for_root and the acceptance_criteria.revision/revision_of/superseded_at +
      agent_runs.criteria_revision_pin columns (migration 0009)"
  - phase: 04-clear-is-free
    provides: "plan 04-09's desktop adapter seam conventions (tauri.ts DTO/wrapper pattern) and
      the item-detail panel surfaces this plan extends"
provides:
  - "criterion_revise/criterion_revisions Tauri commands (packages/desktop/src-tauri/src/commands/criterion.rs),
    the desktop write/read surface for D-76/D-77"
  - "The inline criterion edit affordance and the quiet 'revised' marker
    (packages/desktop/src/item-detail/AcceptanceCriteriaList.tsx) — D-79's developer-facing surface"
  - "pin_criteria_revisions/criteria_revision_pin_for_run (packages/core/src/domain/agent_run.rs)
    and agent_run_start's write-once pin call — D-78's non-repudiation half"
affects: [04-11]

actuals:
  tokens: 12300
  tasks: 3
  commits: 4
  plan_head_before: 4f38a20

tech-stack:
  added: []
  patterns:
    - "Command-layer consolidation: criterion_update now resolves its own None-means-unchanged
      patch semantics, then delegates to the SAME revise_criterion write path criterion_revise
      calls — exactly one function in the command layer ever calls into the criterion edit write
      path, enforced by a crate-wide grep gate."
    - "Lazy, activation-gated history read: RevisedMarker's criterion_revisions query carries
      enabled: expanded, so a task with many criteria issues zero history queries on mount and
      exactly one per marker a developer actually opens (T-04-27)."
    - "Write-once pin via a guarded UPDATE (WHERE criteria_revision_pin IS NULL) rather than a
      read-then-write check — a single atomic statement makes double-write races structurally
      impossible instead of merely unlikely."

key-files:
  created:
    - packages/core/tests/criteria_pin.rs
  modified:
    - packages/desktop/src-tauri/src/commands/criterion.rs
    - packages/desktop/src-tauri/src/main.rs
    - packages/desktop/src/adapters/tauri.ts
    - packages/desktop/src/item-detail/AcceptanceCriteriaList.tsx
    - packages/desktop/src/item-detail/__tests__/criteria.test.tsx
    - packages/core/src/domain/agent_run.rs
    - packages/desktop/src-tauri/src/commands/agent_run.rs

key-decisions:
  - "criterion_list (the item detail panel's own read) switched from list_criteria to
    list_current_criteria (deviation, Rule 1) — plan 04-04 restricted every OTHER human/agent
    read path to current revisions but never reached this one, because nothing could trigger a
    revision from the UI until this plan's edit affordance existed. Left unfixed, revising a
    criterion would render the superseded row as a phantom duplicate list item and over-count
    the checked/total badge."
  - "AcceptanceCriteriaList.tsx had no pre-existing edit affordance to 'point at' revise_criterion
    (deviation, Rule 2) — the plan assumed one existed. Built one from scratch: a Pencil button
    plus an 'e' keyboard shortcut open an inline statement+hint edit (single step, unlike add's
    sequential reveal, since both fields are already known), Enter submits via the new
    reviseCriterion mutation, Escape cancels — no confirmation dialog anywhere in the path (D-77)."
  - "tauri.ts gained a distinct AcceptanceCriterionDto type (not a reuse of the file's existing,
    differently-scoped CriterionDto, which mirrors a different same-named Rust struct in
    commands/agent_run.rs) plus reviseCriterion/criterionRevisions wrapper functions — added per
    Task 1's own files_modified and acceptance criteria, even though AcceptanceCriteriaList.tsx
    itself calls invokeCommand directly for these commands (matching its own established
    convention for every other criterion command, and 04-PATTERNS.md's explicit guidance)."
  - "RevisedMarker's expand affordance shows only PRIOR statements (filters out the row matching
    the currently-displayed criterion id) — the current statement is already visible in the row
    itself, so the expand list is real history, not a redundant restatement."
  - "pin_criteria_revisions never opens its own transaction — a single WHERE ... IS NULL-guarded
    UPDATE is already atomic, and wrapping it in a transaction would add nothing but overhead."

patterns-established:
  - "Guarded single-statement write-once columns: WHERE <column> IS NULL on the UPDATE itself,
    not a separate SELECT-then-UPDATE check — the pattern plan 04-11's own read of this column
    should follow if it ever needs a similar once-only write."

requirements-completed: [BOARD-03]

coverage:
  - id: D1
    description: "Editing a criterion (locked or unlocked) is one uninterrupted action — Pencil
      button or 'e' keyboard shortcut opens an inline edit, Enter submits via criterion_revise,
      no confirmation dialog stands between the edit and the mutation firing"
    requirement: BOARD-03
    verification:
      - kind: unit
        ref: "src/item-detail/__tests__/criteria.test.tsx#calls the revise wrapper, never the old update wrapper, with no confirmation dialog"
        status: pass
      - kind: unit
        ref: "src/item-detail/__tests__/criteria.test.tsx#Escape cancels the edit without calling the revise wrapper"
        status: pass
      - kind: integration
        ref: "cargo test -p core --test criteria (17/17, plan 04-04's revise_criterion contract unregressed)"
        status: pass
    human_judgment: false
  - id: D2
    description: "A criterion with a predecessor shows a quiet 'revised' marker that expands to
      the prior statements, oldest first; an unrevised criterion shows no marker at all; the
      history query is disabled until the marker is activated"
    requirement: BOARD-03
    verification:
      - kind: unit
        ref: "src/item-detail/__tests__/criteria.test.tsx#renders the marker for a criterion with a predecessor and not for an unrevised one"
        status: pass
      - kind: unit
        ref: "src/item-detail/__tests__/criteria.test.tsx#activating the marker renders the prior statement text, oldest first"
        status: pass
    human_judgment: false
  - id: D3
    description: "Exactly one code path in the command layer turns a developer's criterion edit
      into a database write (criterion_update and criterion_revise both delegate to
      revise_criterion), closing T-04-26"
    requirement: BOARD-03
    verification:
      - kind: other
        ref: "grep -v '^[[:space:]]*//' packages/desktop/src-tauri/src/commands/criterion.rs | grep -c update_criterion == 0"
        status: pass
      - kind: other
        ref: "grep -c criterion_update packages/desktop/src/item-detail/AcceptanceCriteriaList.tsx == 0"
        status: pass
    human_judgment: false
  - id: D4
    description: "Every run records exactly which criterion revisions its briefing carried,
      written once and never rewritten — a revision landing mid-run leaves the live run's pin
      byte-identical; the next run's pin picks up the successor; a zero-criteria task pins an
      empty array, distinguishable from a never-pinned (None) run"
    requirement: BOARD-03
    verification:
      - kind: unit
        ref: "cargo test -p core --test criteria_pin (5/5): starting_a_run_pins_exactly_the_current_criteria_in_rank_order"
        status: pass
      - kind: unit
        ref: "cargo test -p core --test criteria_pin#revising_a_criterion_mid_run_leaves_the_live_runs_pin_byte_identical"
        status: pass
      - kind: unit
        ref: "cargo test -p core --test criteria_pin#starting_a_second_run_after_the_revision_pins_the_successor_with_the_others_unchanged"
        status: pass
      - kind: unit
        ref: "cargo test -p core --test criteria_pin#a_task_with_zero_criteria_writes_an_empty_pin_not_a_null_one"
        status: pass
      - kind: unit
        ref: "cargo test -p core --test criteria_pin#reading_the_pin_for_a_run_that_was_never_pinned_returns_none_not_an_empty_set"
        status: pass
      - kind: other
        ref: "grep -v '^[[:space:]]*//' packages/desktop/src-tauri/src/commands/agent_run.rs | grep -c pin_criteria_revisions == 1"
        status: pass
    human_judgment: false
  - id: D5
    description: "The full desktop and Rust workspace test suites, plus both builds, stay green"
    verification:
      - kind: other
        ref: "npm --prefix packages/desktop run test (453 passed, up from 449 in plan 04-09)"
        status: pass
      - kind: other
        ref: "npm --prefix packages/desktop run build (clean)"
        status: pass
      - kind: other
        ref: "cargo build --workspace (clean)"
        status: pass
      - kind: other
        ref: "cargo test --workspace (55 test result: ok blocks, 0 FAILED once the one confirmed pre-existing, unrelated flake is skipped — see Issues Encountered)"
        status: pass
    human_judgment: false

duration: 62min
completed: 2026-09-23
status: complete
---

# Phase 4 Plan 10: Criterion Revisions Get Surfaces — the Edit, the Marker, and the Run's Own Pin Summary

**`criterion_revise`/`criterion_revisions` Tauri commands, an inline criterion edit affordance with a quiet "revised" marker built from scratch (none existed to extend), and `pin_criteria_revisions`/`criteria_revision_pin_for_run` recording exactly which criterion revisions each agent run's briefing carried, written once and never rewritten — proven by a 5-test TDD RED→GREEN cycle.**

## Performance

- **Duration:** 62 min
- **Started:** 2026-09-23T12:10:00Z (approx.)
- **Completed:** 2026-09-23T13:12:00Z
- **Tasks:** 3
- **Files modified:** 8 (1 created, 7 modified)

## Accomplishments

- `criterion_revise`/`criterion_revisions` (Rust, `commands/criterion.rs`): the desktop write
  surface for D-76/D-77 and the read-only history surface for D-79, both registered in `main.rs`.
  `CriterionDto` gained `revision`/`revisionOf`/`supersededAt`. `criterion_update` now resolves
  its own `None`-means-unchanged patch semantics and delegates to the same `revise_criterion`
  write path `criterion_revise` calls — exactly one command-layer function ever calls into the
  crate's edit write path (T-04-26), enforced by a grep gate.
- `criterion_list` restricted from `list_criteria` to `list_current_criteria` (deviation, Rule 1
  — see below): the item detail panel's own criteria read now sees current revisions only,
  matching every other read path plan 04-04 already restricted.
- The inline criterion edit affordance (`AcceptanceCriteriaList.tsx`) — a Pencil button and an
  `e` keyboard shortcut open a single-step statement+hint edit, Enter submits via a new
  `reviseCriterion` mutation calling `criterion_revise`, Escape cancels, no confirmation dialog
  anywhere (D-77). Built from scratch (deviation, Rule 2 — see below): no edit affordance existed
  for the plan to "point at" `revise_criterion`.
- `RevisedMarker`: a quiet `revised` badge, styled from `var(--text-muted-rack)` only, rendered
  beside a criterion whose `revisionOf` is non-null. Activating it fetches `criterion_revisions`
  lazily (`enabled: expanded`) and shows the prior statements only, oldest first, each with its
  revision number — the current statement (already visible in the row) is filtered out.
- `pin_criteria_revisions`/`criteria_revision_pin_for_run` (Rust, `domain/agent_run.rs`): a
  write-once JSON-array pin on `agent_runs.criteria_revision_pin`, guarded by a single
  `WHERE criteria_revision_pin IS NULL` `UPDATE` rather than a read-then-write check. `None`
  distinguishes a never-pinned run from `Some(vec![])` (a zero-criteria task's real, empty pin).
  `agent_run_start` calls it with `list_current_criteria`'s own rank-ordered ids — the same order
  `CRITERIA_SQL` uses — while the database lock is still held, before the spawn request.
- Full TDD RED→GREEN cycle for Task 3: `criteria_pin.rs` (205 lines, 5 tests) written against
  compileable-but-behaviorally-wrong stubs first (4/5 tests failed on genuine assertion
  mismatches; the 5th coincidentally passed, a legitimate result — see TDD Gate Compliance
  below), then made to pass by the real implementation. No REFACTOR commit — the GREEN
  implementation needed no cleanup.
- 4 new frontend tests (`criteria.test.tsx`, 12 total in the file, up from 8) covering the
  marker's presence/absence, lazy history expansion, the revise-not-update call, and the
  no-confirmation-dialog assertion.

## Task Commits

Each task was committed atomically (Task 3 as a TDD RED/GREEN pair, no REFACTOR needed):

1. **Task 1: The two commands — revise, and read the history** — `c0a20fa` (feat)
2. **Task 2: The quiet revised marker — visible to the developer, invisible to every agent** — `0c4f57d` (feat)
3. **Task 3 RED: failing tests for the criteria revision pin** — `f3e9269` (test)
4. **Task 3 GREEN: implement the criteria revision pin** — `ce5cbf0` (feat)

**Plan metadata:** commit follows this SUMMARY.

## TDD Gate Compliance

| Gate | Commit | Status |
|------|--------|--------|
| RED | `f3e9269` (`test(04-10): ...`) | ✅ 4/5 tests failed on genuine assertion mismatches against a compileable, deliberately-incomplete stub (writes nothing, always reads `None`). The 5th test ("never-pinned returns `None`") coincidentally passed — the stub's trivial always-`None` behavior legitimately satisfies that one specific case; this is not a sign of a weak test, since the other 4 assertions prove the stub was genuinely wrong for every behavior the implementation actually had to add. |
| GREEN | `ce5cbf0` (`feat(04-10): ...`) | ✅ All 5 tests pass after the real implementation. |
| REFACTOR | — | Not needed; no cleanup opportunity identified after GREEN. |

Verified manually against the INVALID_RED criteria (no compile errors, no zero-test discovery,
no unrelated failures, every failure a genuine assertion mismatch) rather than via
`gsd_run check tdd-red-evidence`, which is TAP-specific and cannot parse `cargo test` output —
matching this same phase's own prior precedent (plan 03, per STATE.md).

## Files Created/Modified

- `packages/core/tests/criteria_pin.rs` - 5 tests proving D-78's five behaviors
- `packages/desktop/src-tauri/src/commands/criterion.rs` - `criterion_revise`, `criterion_revisions`, widened `CriterionDto`, consolidated `criterion_update`, `criterion_list` restricted to current revisions
- `packages/desktop/src-tauri/src/main.rs` - registers the two new commands
- `packages/desktop/src/adapters/tauri.ts` - `AcceptanceCriterionDto`, `reviseCriterion`, `criterionRevisions`
- `packages/desktop/src/item-detail/AcceptanceCriteriaList.tsx` - the inline edit affordance, `RevisedMarker`, widened `CriterionDto`
- `packages/desktop/src/item-detail/__tests__/criteria.test.tsx` - 4 new tests
- `packages/core/src/domain/agent_run.rs` - `pin_criteria_revisions`, `criteria_revision_pin_for_run`
- `packages/desktop/src-tauri/src/commands/agent_run.rs` - `agent_run_start` pins before the spawn request

## Decisions Made

See `key-decisions` in the frontmatter above — summarised: (1) `criterion_list` restricted to
current revisions (a correctness fix this plan's own UI made reachable for the first time), (2)
the edit affordance built from scratch rather than extended, (3) `tauri.ts` gained a distinct
`AcceptanceCriterionDto` type and wrapper functions per Task 1's own scope, even though the
component itself keeps calling `invokeCommand` directly (matching its own established
convention), (4) the "revised" marker shows prior wording only, never a redundant restatement of
the current row, (5) the pin write is a single guarded `UPDATE`, no transaction needed.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 1 - Bug] `criterion_list` restricted from `list_criteria` to `list_current_criteria`**
- **Found during:** Task 2 (building the edit affordance and marker)
- **Issue:** Plan 04-04 restricted `context_packet.rs`'s `CRITERIA_SQL` and `query/mod.rs`'s
  `CRITERIA_JOIN` to current revisions, but `criterion_list` — the item detail panel's own read —
  was never touched, because nothing in the UI could reach a locked criterion's revise path yet.
  This plan's edit affordance is exactly what makes that gap observable: revising a criterion via
  the new UI would leave the superseded row rendered as a second, phantom list item, and the
  header's checked/total badge would over-count.
- **Fix:** `criterion_list` now calls `list_current_criteria` instead of `list_criteria`.
- **Files modified:** `packages/desktop/src-tauri/src/commands/criterion.rs`
- **Verification:** `cargo build --workspace` (clean); `criteria.test.tsx`'s marker tests exercise
  a criteria list containing both a current and (via the separate `criterion_revisions` read) a
  superseded row, confirming the two reads stay correctly scoped.
- **Committed in:** `0c4f57d` (Task 2 commit)

**2. [Rule 2 - Missing Critical] Built the inline criterion edit affordance from scratch**
- **Found during:** Task 2 (reading `AcceptanceCriteriaList.tsx` per the task's own `read_first`)
- **Issue:** Task 2's action text instructs "point the existing edit affordance's mutation at
  `reviseCriterion`" — but the file had no edit affordance at all (only add, toggle, and reorder
  existed). Without one, this plan's own must-have ("the developer types an edit to a locked
  criterion and gets an edit") is unreachable — the whole plan's objective depends on it existing.
- **Fix:** Added a Pencil icon button plus an `e` keyboard shortcut (mirroring the file's existing
  `n`/`j`/`k` keyboard-operable convention) that open a single-step inline statement+hint edit,
  submitted via a new `reviseCriterion` mutation following `toggleCriterion`'s exact
  `useMutation`/`invokeCommand`/`invalidateQueries` shape, with no confirmation dialog.
- **Files modified:** `packages/desktop/src/item-detail/AcceptanceCriteriaList.tsx`
- **Verification:** 2 new tests (`criteria.test.tsx`) directly assert the edit calls
  `criterion_revise` and never `criterion_update`, that no dialog appears, and that Escape cancels
  without mutating.
- **Committed in:** `0c4f57d` (Task 2 commit)

---

**Total deviations:** 2 auto-fixed (1 Rule 1 — correctness bug this plan's own UI made reachable
for the first time; 1 Rule 2 — missing critical functionality without which the plan's own
objective could not be met).
**Impact on plan:** Both fixes were necessary for the plan's stated must-haves to actually hold.
No scope creep — both stay inside the plan's own declared `files_modified`.

## Issues Encountered

- **Pre-existing, unrelated test flakiness in `packages/core/tests/worktree_lifecycle.rs`.**
  `cargo test --workspace` surfaced `a_worktree_survives_two_runs_with_an_epic` failing with
  `fatal: not a git repository` under full-workspace concurrent test execution, reproducing on
  two consecutive full runs. Confirmed out of scope: this plan touches no file under
  `domain::worktree`/`git.rs`, and the test passes cleanly in isolation
  (`cargo test -p core --test worktree_lifecycle` — 2/2 pass). A full
  `cargo test --workspace --no-fail-fast -- --skip a_worktree_survives_two_runs_with_an_epic` run
  completed with 55 `test result: ok` blocks and zero other failures across every crate — matching
  the same class of pre-existing, environment-race flakiness this phase's project notes already
  document for `credentials.rs`'s Keychain concurrency flake. Not auto-fixed (out of scope, per
  the deviation rules' scope boundary) — left as-is.

## User Setup Required

None - no external service configuration required.

## Next Phase Readiness

- BOARD-03 closes end to end: the lock (plan 04-04), the revision chain and its read-path
  filtering (plan 04-04, extended here to `criterion_list`), the developer-facing edit and marker
  surfaces (this plan), and the run-level pin (this plan) are all in place.
- `criteria_revision_pin_for_run`'s `None`/`Some(vec![])` distinction is exactly the input plan
  04-11's third drift detector needs (comparing a run's pin against the current revision set) —
  no interface gap to close.
- CTX-06 (also declared by this plan) stays "Gaps Found" in the traceability table until plans
  04-11 and 04-12 — the other declaring plans — finish; `requirements.ready-ids` confirms only
  BOARD-03 is ready to mark complete from this plan.
- No blockers for 04-11.

---
*Phase: 04-clear-is-free*
*Completed: 2026-09-23*

## Self-Check: PASSED

- FOUND: packages/core/tests/criteria_pin.rs
- FOUND: packages/desktop/src-tauri/src/commands/criterion.rs
- FOUND: packages/desktop/src-tauri/src/main.rs
- FOUND: packages/desktop/src/adapters/tauri.ts
- FOUND: packages/desktop/src/item-detail/AcceptanceCriteriaList.tsx
- FOUND: packages/desktop/src/item-detail/__tests__/criteria.test.tsx
- FOUND: packages/core/src/domain/agent_run.rs
- FOUND: packages/desktop/src-tauri/src/commands/agent_run.rs
- FOUND commit c0a20fa in git log
- FOUND commit 0c4f57d in git log
- FOUND commit f3e9269 in git log
- FOUND commit ce5cbf0 in git log
- `cargo test -p core --test criteria_pin`: 5 passed, 0 failed
- `cargo test -p core --test criteria`: 17 passed, 0 failed
- `npm --prefix packages/desktop run test -- src/item-detail/__tests__/criteria.test.tsx`: 12 passed, 0 failed
- `npm --prefix packages/desktop run test`: 453 passed, 0 failed (32 test files)
- `npm --prefix packages/desktop run build`: clean
- `cargo build --workspace`: clean
- `cargo test --workspace`: 55 "test result: ok" blocks, 0 FAILED (1 pre-existing, unrelated,
  isolation-confirmed flake in `worktree_lifecycle.rs` skipped — see Issues Encountered)
