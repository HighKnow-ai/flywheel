---
phase: 07-the-board-tells-the-git-truth
plan: 07
subsystem: git-integration
tags: [rust, forge, status-transitions, tokio-cron-scheduler, events]

requires:
  - phase: 07-the-board-tells-the-git-truth (plan 07-03)
    provides: "forge::{Forge, ForgeState, CiResult, ForgeRequest, ForgeError} and forge::request_for_branch — the normalized forge model and dispatch point this plan composes against"
  - phase: 07-the-board-tells-the-git-truth (plan 07-06)
    provides: "scheduler.rs's three existing jobs, the lock-read-drop-emit ordering, and the eprintln-not-panic failure policy this plan's fourth job follows"
provides:
  - "domain::task::set_task_status_in_tx — the transaction-scoped status writer, with set_task_status now a thin wrapper delegating to it unchanged"
  - "query::forge::{ForgeBaseline, latest_forge_baseline} — the restart-safe baseline, derived from the append-only events log, no new column"
  - "forge::transitions::{apply_forge_observation, TransitionOutcome, EVENT_FORGE_STATE_CHANGED, EVENT_FORGE_CI_FAILED, EVENT_DONE_WITH_UNMET_CRITERIA} — the edge detector: forward-only, two transitions, never touches a criterion row"
  - "git_facts::FORGE_POLL_SECS and scheduler.rs's fourth job, polling the forge on its own 120s cadence"
affects: [07-08, 07-09]

actuals:
  tokens: 13400
  tasks: 3
  commits: 3
plan_head_before: 89ce8d71a0692e1c47527e7c764c82502d877460

tech-stack:
  added: []
  patterns:
    - "In-transaction composition via the crate's *_in_tx idiom: set_task_status_in_tx is extracted exactly like accept_proposal_in_tx/interrupt_agent_run_in_tx, so apply_forge_observation can write a status change inside its own single transaction instead of nesting a second conn.transaction()"
    - "Baseline-as-full-snapshot payload: every forge event (forge.state_changed and forge.ci_failed alike) carries the FULL current (state, ci) observation in its payload, not just the one field its own event type names changing — so latest_forge_baseline can always reconstruct the complete pair from whichever single row is most recent, by id ordering"
    - "Terminal-state guard for forward-only semantics: once a task's baseline has observed Merged, the edge detector's whole state-comparison block is skipped — no event, no status write — for any later observation including an absent one, which is what makes 'forward-only' also mean 'never un-merges a task'"
    - "Fully-qualified call sites over a use import, chosen specifically so a literal grep count (set_task_status_in_tx == 2) asserts the real invariant (exactly two status-writing call sites) rather than being inflated by an import line — same technique 07-06's record_outside_commits used for the same reason"

key-files:
  created:
    - packages/core/src/forge/transitions.rs
    - packages/core/src/query/forge.rs
    - packages/core/tests/status_transitions.rs
  modified:
    - packages/core/src/domain/task.rs
    - packages/core/src/forge/mod.rs
    - packages/core/src/query/mod.rs
    - packages/core/src/git_facts.rs
    - packages/desktop/src-tauri/src/scheduler.rs

key-decisions:
  - "TrackedWorktree gained a branch field (git_facts.rs) so the forge job's per-worktree loop needs no second worktrees lookup — a minimal, additive extension to a struct already used by the hot/cold ticks, with no change to their own field access patterns"
  - "The forge job resolves the system actor once per tick, not once per observation — matching run_hot_tick/run_cold_tick's own established shape in this exact file, rather than the plan's illustrative per-call system_actor(&conn)?.id pseudocode"
  - "The forge job's emit goes through the existing shared emit_board_changed(app) helper rather than writing a second literal 'board:changed' call site — see Deviations below"

requirements-completed: [LINK-07]

coverage:
  - id: D1
    description: "Opening a pull or merge request moves its task to In Review, and merging it moves the task to Done — once each, forward only, stamped with the system actor"
    requirement: "LINK-07"
    verification:
      - kind: unit
        ref: "packages/core/tests/status_transitions.rs#open_against_a_none_baseline_moves_to_in_review_and_appends_one_event, #merged_against_an_open_baseline_moves_to_done_and_appends_one_event, #merged_against_a_none_baseline_still_reaches_done, #every_event_this_function_writes_carries_the_system_actor"
        status: pass
    human_judgment: false
  - id: D2
    description: "A transition fires only on an observed forge-state CHANGE against a baseline read from the events log, and a manual board move afterwards is never re-asserted away by a later identical observation"
    requirement: "LINK-07"
    verification:
      - kind: unit
        ref: "packages/core/tests/status_transitions.rs#open_against_an_open_baseline_writes_nothing_at_all, #a_manual_move_back_survives_a_subsequent_identical_observation"
        status: pass
    human_judgment: false
  - id: D3
    description: "Changes requested, closed-without-merging and a CI failure each raise an events row and move nothing; once merged, nothing (including an absent observation) ever moves the task again"
    requirement: "LINK-07"
    verification:
      - kind: unit
        ref: "packages/core/tests/status_transitions.rs#changes_requested_against_an_open_baseline_appends_an_event_and_leaves_status_untouched, #closed_unmerged_appends_an_event_and_leaves_status_untouched, #ci_failed_against_a_non_failed_baseline_appends_an_event_and_calls_no_status_writer, #ci_failed_against_an_already_failed_baseline_appends_no_second_event, #none_against_a_merged_baseline_writes_nothing_and_moves_nothing"
        status: pass
    human_judgment: false
  - id: D4
    description: "A merge carries a task to Done even with unchecked acceptance criteria, raising an events row naming the unmet count without touching any criterion row"
    requirement: "LINK-07"
    verification:
      - kind: unit
        ref: "packages/core/tests/status_transitions.rs#merged_with_unmet_criteria_names_the_count_and_touches_no_criterion_row, #merged_with_all_criteria_checked_appends_no_unmet_criteria_event"
        status: pass
    human_judgment: false
  - id: D5
    description: "The baseline survives an application restart (derived from the append-only events log, not in-memory state), and both the open and merged transitions still land across a database reopen between the two observations"
    requirement: "LINK-07"
    verification:
      - kind: unit
        ref: "packages/core/tests/status_transitions.rs#baseline_survives_reopening_the_database, #restart_between_the_open_and_merged_observations_still_produces_both_transitions"
        status: pass
    human_judgment: false
  - id: D6
    description: "Every status write goes through set_task_status_in_tx (one UPDATE tasks SET status site in the whole crate), and set_task_status's own public behaviour is unchanged by the extraction"
    requirement: "LINK-07"
    verification:
      - kind: unit
        ref: "packages/core/tests/status_transitions.rs#set_task_status_behavior_is_unchanged_by_the_extraction, #invalid_status_is_still_rejected_by_the_schema_after_the_extraction; packages/core/tests/hierarchy_workflow.rs (18 tests, unchanged)"
        status: pass
    human_judgment: false
  - id: D7
    description: "A fourth scheduler job polls the forge on its own 120s cadence, decoupled from the three git-facts ticks, skipping a forge read error entirely rather than applying it as an observation"
    requirement: "LINK-07"
    verification:
      - kind: other
        ref: "cargo build --workspace; cargo test --workspace; structural greps (new_repeated_async count == 4, apply_forge_observation count == 1, FORGE_POLL_SECS count == 1, no .unwrap()/.expect( in a job closure, no ForgeError-then-apply_forge_observation pairing)"
        status: pass
    human_judgment: true
    rationale: "No automated test drives the scheduler's actual tick against a running Tauri app against a real GitHub/GitLab PR. Proven structurally (compiles, wires the fourth job, the edge detector's own unit suite covers every transition the job delegates to) and by status_transitions.rs's hermetic coverage of apply_forge_observation itself. A human running the packaged app against a real PR and watching In Review/Done land within one 120s poll is the real proof of this phase's LINK-07 success criterion — appropriate for end-of-phase UAT per 07-RESEARCH.md's own confidence note on the live CLI arm, not a gap in this plan's own scope."

duration: 50min
completed: 2026-10-02
status: complete
---

# Phase 7 Plan 7: The Board Tells The Git Truth — Status Transitions Summary

**A transaction-scoped status writer, a restart-safe forge baseline read from the append-only events log, and an edge-triggered detector that moves a task to In Review on open and Done on merge — forward only, never re-asserting a level, wired into a fourth 120s scheduler job.**

## Performance

- **Duration:** 50 min
- **Started:** ~2026-10-02T10:40:00Z
- **Completed:** 2026-10-02T11:29:36Z
- **Tasks:** 3
- **Files modified:** 8 (3 created, 5 modified)

## Accomplishments

- `domain::task::set_task_status_in_tx` — extracted byte-equivalent from `set_task_status`'s body (the no-op guard, the `UPDATE`, the `next_sequence` allocation, the `task.status_changed` event with its `field`/`before`/`after`/`label` payload); `set_task_status` is now a thin wrapper opening a transaction, calling the new function, and committing — signature and observable behaviour unchanged, proven by both the new suite and the pre-existing `hierarchy_workflow.rs` suite
- `query::forge::{ForgeBaseline, latest_forge_baseline}` — the restart-safe baseline derived from the most recent forge-kind `events` row, by `id` ordering; a malformed payload degrades to the default rather than erroring the read; no new column, no migration
- `forge::transitions::apply_forge_observation` — one transaction per observation: reads the baseline, compares against the newly observed `(state, ci)` pair, writes `in_review` on an Open/ChangesRequested edge from `None`, writes `done` on a Merged edge from anything (naming any unmet acceptance criteria without touching a criterion row), appends a `forge.ci_failed` event on a new CI failure, and — the terminal-state guard — skips the whole comparison once the baseline has observed a merge, so nothing (including an absent later observation) ever moves a merged task again
- `packages/core/tests/status_transitions.rs` — 21 tests covering Task 1's baseline reader and `set_task_status`'s unchanged behaviour, and Task 2's full edge-detector `<behavior>` contract (both forward edges, all three non-moving observations, forward-only/terminal semantics, the manual-move-survives-a-repeat-poll case, the unmet-criteria count, and two restart-across-reopen scenarios), against synthetic `ForgeRequest` values — no subprocess, no network
- `git_facts::FORGE_POLL_SECS` (120s) and a fourth `scheduler.rs` job: for every tracked worktree, reads the forge state for its branch and hands the observation to `apply_forge_observation` with the system actor resolved once per tick; a forge read error is skipped entirely (never applied as an observation); emits `board:changed` only when something actually transitioned

## Task Commits

Each task was committed atomically:

1. **Task 1: The transaction-scoped status writer and the restart-safe baseline** - `60a76f3` (feat)
2. **Task 2: The edge detector — two forward moves, three observations that move nothing** - `f16bbc7` (feat)
3. **Task 3: The fourth scheduler job — poll the forge on its own cadence** - `f791e3e` (feat)

_No separate RED/GREEN/REFACTOR commits: `workflow.tdd_mode` is off for this run, so the hard TDD gate was not enforced. Both `tdd="true"` tasks were implemented with their proving tests written and passing in the same commit as the implementation they prove — same convention 07-01/07-03/07-06 used._

## Files Created/Modified

- `packages/core/src/domain/task.rs` — `set_task_status_in_tx` extracted; `set_task_status` now delegates
- `packages/core/src/query/forge.rs` — `ForgeBaseline`, `latest_forge_baseline`
- `packages/core/src/query/mod.rs` — `pub mod forge;`
- `packages/core/src/forge/mod.rs` — `pub mod transitions;`
- `packages/core/src/forge/transitions.rs` — the edge detector
- `packages/core/tests/status_transitions.rs` — 21 tests
- `packages/core/src/git_facts.rs` — `FORGE_POLL_SECS`; `TrackedWorktree` gained a `branch` field
- `packages/desktop/src-tauri/src/scheduler.rs` — the fourth job, `run_forge_tick`

## Decisions Made

See `key-decisions` in the frontmatter above — the `TrackedWorktree.branch` extension, resolving the system actor once per tick (matching the file's own established shape rather than the plan's illustrative per-call pseudocode), and routing the forge job's emit through the existing shared `emit_board_changed` helper.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 1 - Bug] `tasks.last_forge_state` literal string tripped the acceptance grep it was denying**
- **Found during:** Task 1, running the acceptance-criteria grep for `query/forge.rs`
- **Issue:** The module header comment stated "there is deliberately no `tasks.last_forge_state` column" — the grep checking for that forbidden column name matched the denial prose itself, since grep has no notion of negation-in-English
- **Fix:** Reworded the comment to describe the same fact ("no added column on the `tasks` table remembering the last observed state") without the literal substring
- **Files modified:** `packages/core/src/query/forge.rs`
- **Verification:** `grep -c 'tasks.last_forge_state' packages/core/src/query/forge.rs` is `0`
- **Committed in:** `60a76f3` (Task 1 commit)

**2. [Rule 3 - Blocking] `FORGE_POLL_SECS` and `TrackedWorktree`'s branch field live in `git_facts.rs`, which Task 1/Task 3's own `<files>` lists never name**
- **Found during:** Task 3, implementing the plan's own explicit action text ("Add `pub const FORGE_POLL_SECS`... to `packages/core/src/git_facts.rs`'s existing constant block"; "reads the task's branch from its worktree row")
- **Issue:** Task 3's declared `<files>` is `packages/desktop/src-tauri/src/scheduler.rs` only, but its own action text requires editing `packages/core/src/git_facts.rs` for the cadence constant, and the forge job needs each worktree's branch, which `TrackedWorktree` (also in `git_facts.rs`) did not carry
- **Fix:** Edited `git_facts.rs` as the action text required: added `FORGE_POLL_SECS` beside the three existing cadence constants, and added a `branch: String` field to `TrackedWorktree` plus the matching `SELECT`/struct-literal change in both `tracked_worktrees` SQL variants — additive, no existing caller's field-access pattern changed
- **Files modified:** `packages/core/src/git_facts.rs`
- **Verification:** `cargo build --workspace` and `cargo test --workspace` both exit 0; no other construction site of `TrackedWorktree` exists in the workspace (grepped)
- **Committed in:** `f791e3e` (Task 3 commit)

### Literal Acceptance Criterion Substituted (per the plan's own acceptance-criteria-note)

**3. `grep -c 'board:changed' scheduler.rs` literal count of `2` could not be satisfied without duplicating the event-name literal**
- **Found during:** Task 3, running the acceptance-criteria grep
- **Issue:** The literal criterion expects the substring `board:changed` to appear twice in `scheduler.rs` after adding the forge job. The file's own existing architecture (and its own header comment, unchanged by this plan: "emits the shared board-invalidation event (see `emit_board_changed`)... never add a second Tauri event name") keeps exactly ONE literal definition of the event name, called from every tick via the shared `emit_board_changed(app)` helper — true before this plan (count `1`, three callers) and after it (count `1`, four callers).
- **Real invariant verified instead:** the forge job emits the shared board-invalidation event, following the identical at-most-once-per-tick-only-on-change discipline the other three jobs already use, with no second push channel — asserted by: `emit_board_changed(app)` is called from `run_forge_tick` (one new call site, grepped), the literal `"board:changed"` string still appears exactly once in the whole file (the single shared definition), and `cargo build --workspace`/`cargo test --workspace` both pass with the fourth job registered and wired.
- **Why not reshaped:** Writing a second literal `app.emit("board:changed", ...)` call directly in `run_forge_tick` to satisfy the count would duplicate the event-name string the module's own header comment explicitly says must have one definition — strictly worse code to satisfy a text-matching count, exactly what the plan's own acceptance-criteria-note instructs against.
- **Logged to:** `.planning/WINDOWS.md` as a `deviation` entry.

---

**Total deviations:** 3 (1 bug — a self-contradicting grep/prose pairing in a doc comment; 1 blocking — two files touched outside a task's own declared `<files>` list because the task's own action text required it, mirroring 07-03's precedent for the identical situation; 1 literal-criterion substitution — documented per the plan's own acceptance-criteria-note rather than reshaping working code to satisfy a text count).
**Impact on plan:** None affected scope, correctness, or any of the plan's real `<behavior>`/`<decisions_resolved>` guarantees. All three are either corrections to planning-doc artifacts or principled refusals to let a literal grep count override established architecture.

## Issues Encountered

- **The live forge-poll path (a real `gh`/`glab` PR observed through a running packaged app) is not exercised by this plan's own test suite** — see coverage D7's `rationale`. `apply_forge_observation` itself is exhaustively covered hermetically (21 tests); what remains unproven here is the scheduler's own tick loop against a real CLI and a real database lock, which plan 07-08's/end-of-phase UAT is positioned to exercise against a real GitHub/GitLab repository.
- A `cargo test --workspace` background run stalled mid-suite on an unrelated, pre-existing child test process (`open_worktree-*`) that showed zero CPU activity for several minutes — re-run in isolation (`cargo test -p core --test open_worktree`), it passed cleanly in under a second, confirming this was an environment/process-spawn hiccup unrelated to this plan's changes, not a real hang. The subsequent full `cargo test --workspace` run completed with exit code 0.

## User Setup Required

None - no external service configuration required.

## Next Phase Readiness

- `forge::transitions::apply_forge_observation`/`TransitionOutcome` and `query::forge::latest_forge_baseline`/`ForgeBaseline` are stable, independently callable symbols — plan 07-08 (item-panel rendering) and 07-09 (request creation) can import them directly with no further groundwork from this plan.
- `LINK-07` is this plan's only requirement and no sibling plan in this phase also declares it (confirmed via a grep across the phase's `*-PLAN.md` files), so `requirements.mark-complete` flips it to `Complete` immediately on this SUMMARY's existence — no shared-ID gate wait.
- The transition half of phase success criterion 3 holds: opening a pull/merge request moves the task to In Review and merging it moves the task to Done, once each, forward only, stamped with the system actor, surviving an application restart, and never re-asserted over a user's own move — proven by `status_transitions.rs`'s 21 tests and `cargo test --workspace` (exit 0).
- No blockers.

## Self-Check: PASSED

All created/modified files verified present on disk; all three task commits (`60a76f3`, `f16bbc7`, `f791e3e`) verified present in `git log`.

---
*Phase: 07-the-board-tells-the-git-truth*
*Completed: 2026-10-02*
