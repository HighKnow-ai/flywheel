---
phase: 08-review-and-merge-inside-flywheel
plan: 11
subsystem: review
tags: [rust, tauri, lock-discipline, gap-closure, cr-01]
status: complete
gap_closure: true

requires:
  - phase: 08-review-and-merge-inside-flywheel
    provides: "plan_merge, resolve_review_target, epic_request_preconditions, assemble_epic_request_draft (08-03, 08-05, 08-07); epic_task_rollup (08-09); the 08-VERIFICATION CR-01 finding this closes"
provides:
  - "merge::{MergePlanInputs, plan_merge_inputs, finish_plan, merge_commit_is_reachable}: the merge plan split into a connection-only half and a connection-free git half"
  - "review::{ReviewTargetInputs, review_target_inputs, finish_review_target}: review target resolution split the same way"
  - "forge::{EpicRequestInputs, epic_request_inputs, epic_request_blocker} and forge::request_body::{EpicDraftInputs, epic_draft_inputs, finish_epic_request_draft}"
  - "Eight command bodies rewired so no git subprocess runs while AppState.db is held"
  - "A merge.rs module header that states what is true of the code"
affects: []

requirements-completed: [REVW-04, REVW-05]

duration: "~35 min"
completed: 2026-10-06

actuals:
  tokens: 11400
  tasks: 3
  commits: 3
plan_head_before: 7ad12a0b22f47081e7099908dfb639f6a450921c

coverage:
  - deliverable: "Merge preview and merge read the board under the lock and run rev-list and diff after it is released; NothingToMerge now originates in the git half and both commands downcast it from either half"
    verification:
      - kind: test
        ref: "packages/core/tests/review_merge.rs (37 passed, no assertion edited)"
        status: pass
      - kind: command
        ref: "grep -c 'pub fn finish_plan(inputs: MergePlanInputs)' = 1; finish_plan region has 0 query_row/conn.; plan_merge_inputs region has 0 git::"
        status: pass
    human_judgment: false
  - deliverable: "The four review reads (review_files, review_file_patch, review_criteria_state, criterion_check_with_anchor) run the integrated-ancestry check after the lock is released"
    verification:
      - kind: test
        ref: "packages/core/tests/review_diff.rs (18), criterion_anchors.rs (26), context_packet.rs (26) all passed unedited"
        status: pass
      - kind: command
        ref: "finish_review_target signature count = 1; finish region 0 query_row/conn.; inputs region 0 git::/merge_commit_is_reachable; all four command regions reference the DB half"
        status: pass
    human_judgment: false
  - deliverable: "Epic request preview and open evaluate preconditions and draft against git with the lock released; the draft bytes and roll-up order are unchanged"
    verification:
      - kind: test
        ref: "packages/core/tests/epic_request_draft.rs (17, incl. draft_is_deterministic_across_two_calls, precondition_nothing_to_propose_when_the_branch_has_no_commits_ahead) and forge_live_chain.rs (19), unedited"
        status: pass
    human_judgment: false
  - deliverable: "Blocking behaviour on a slow repository is actually gone in the running app"
    human_judgment: true
    rationale: "Proved structurally, by connection-free signatures and region greps, not by driving the packaged app against a slow repository. No timing test exists."

key-files:
  created: []
  modified:
    - packages/core/src/merge.rs
    - packages/core/src/review.rs
    - packages/core/src/forge/mod.rs
    - packages/core/src/forge/request_body.rs
    - packages/desktop/src-tauri/src/commands/review.rs
    - packages/desktop/src-tauri/src/commands/forge.rs

key-decisions:
  - "Every inputs value has private fields and is built only by its DB half, so the git half can neither re-read the board nor be handed a substituted branch, path or sha. Preview and write cannot disagree about what they operated on."
  - "Forge detection from origin (a git spawn when projects.forge is NULL) is deferred out of epic_request_inputs into EpicRequestInputs::forge(), memoised in a OnceCell. The plan said epic_request_inputs holds forge_and_repo_path with no git, which is untrue on the NULL-override arm."
  - "The composed convenience functions (plan_merge, resolve_review_target, epic_request_preconditions, assemble_epic_request_draft, is_integrated) stay for core-internal and test use, documented as such. No command handler calls them."
  - "context_packet.rs stays on resolve_review_target: its per-anchor git work is WR-10, an accepted out-of-scope warning."

---

# Phase 8 Plan 11: Lock Discipline Across Merge, Review and Epic Request Summary

**The merge plan, the review-target ancestry check, the epic-request preconditions and the epic-request draft were each split into a connection-only half and a connection-free git half joined by an opaque inputs value, so no git subprocess can be spawned while the AppState.db mutex is held on any of those command paths. CR-01 is closed and `merge.rs`'s header no longer claims an invariant the code broke.**

## Accomplishments

- **Merge (8106c26).** `plan_merge_inputs` carries the four board reads, the three early `MergeRefusal`s and the epic-worktree derivation; `finish_plan` carries the `rev-list --count`, `NothingToMerge` and the file count. `merge_commit_is_reachable` is the single home of the integrated marker's two git reads, and `is_integrated` is now `integrated_merge_commit` plus it. `review_merge_precheck` and `review_merge_task` read inputs in a braced lock scope, release it, then call `finish_plan`; `NothingToMerge` is downcast from either half. `run_merge`, the per-epic guard, the re-lock and `eventNotRecorded` are untouched. The module header was rewritten to name which halves take a connection.
- **Review reads (fca3f8c).** `ReviewTargetInputs` wraps a private enum: either an already-settled target (epic scope, `NoBranch`, `NoIntegrationBranch`) or a task awaiting its ancestry check with the recorded merge commit already read. `finish_review_target` runs `merge_commit_is_reachable` and builds the same post-merge range as before. `criteria_with_anchors` now returns the unfinished inputs. All four commands keep their braced lock scope and finish outside it; `criterion_check_with_anchor` still derives the head sha from the finished target, never from the caller.
- **Epic request (670a2cc).** `epic_request_inputs` and `epic_request_blocker` preserve the four-blocker order; `epic_draft_inputs` and `finish_epic_request_draft` move the per-task `integrated_merge_commit` read under the lock and the ancestry check out of it. `render_epic_body` is unchanged. Both commands read the request inputs and, when an integration branch exists, the draft inputs in one braced scope; `forge_open_epic_request` still refuses a blocked epic by name before anything is pushed, and the redundant project-id `query_row` and separate `forge_and_repo_path` call are gone.

## Task Commits

| Task | Commit | Description |
| ---- | ------ | ----------- |
| 1 | 8106c26 | Merge plan split, `merge_commit_is_reachable`, both merge commands, corrected header |
| 2 | fca3f8c | Review target split, `criteria_with_anchors` return type, four review-read commands |
| 3 | 670a2cc | Epic request preconditions and draft split, both epic-request commands |

## Phase-8 invariants re-proved after the change

| Proof | Observed |
| ----- | -------- |
| `UPDATE (tasks\|epics)` across `merge.rs`, `review.rs`, `request_body.rs`, `commands/review.rs`, `commands/forge.rs` | 0, 0, 0, 0, 0 |
| `--force`, `force-with-lease`, `--delete` in `git.rs` | 0 |
| `git.rs` and `run_merge` | not touched; `merge_abort_if_in_progress` and the three `MergeOutcome` variants unchanged |
| Command signatures | no new renderer-supplied parameter on any command; all still take an id (and scope, path) only |
| Commands calling a composed convenience function | 0 (remaining callers: tests and `context_packet.rs`) |

## Verification

- `cargo test -p core --test review_merge`: 37 passed. `review_diff`: 18. `criterion_anchors`: 26 (20 baseline plus 08-09's 6). `epic_request_draft`: 17. `forge_live_chain`: 19. `context_packet`: 26. `forge_request_body`, `forge_degrade`, `forge_normalize`, `forge_board_flags`: 8, 6, 16, 11, all passed. No assertion in any test file was edited (`git diff` over `packages/core/tests` is empty).
- `cargo test --workspace -- --skip credential --skip api_key`: exit 0, 97 suites ok, 0 failed (the `credentials` binary blocks on the macOS keychain unattended, pre-existing per 08-03).
- `cargo build --workspace`: no `error` line (one pre-existing dead-code warning in `agent_run.rs`).
- `npm --prefix packages/desktop run test -- src/review`: 107 passed in 6 files. The three-set named in 08-09 (`src/review`, `review-doors`, `session-surface`): 168 passed, above the 157 baseline.
- Region greps: `finish_plan`, `finish_review_target`, `epic_request_blocker`, `finish_epic_request_draft` contain no `query_row`, `conn.` or `prepare(`; `plan_merge_inputs`, `review_target_inputs`, `epic_draft_inputs` contain no git call; each of the eight command regions references its DB half.

## Deviations from Plan

**1. [Rule 1 - Bug] Forge detection spawned git inside the DB half**
- **Found during:** Task 3
- **Issue:** the plan had `epic_request_inputs` hold `forge_and_repo_path`. On the stored-override-is-NULL arm that function spawns `git remote get-url origin`, so the epic-request path would still have spawned git under the lock, contradicting the plan's own truth that none can.
- **Fix:** added a private board-only `stored_forge_and_repo_path` and recomposed `forge_and_repo_path` from it (behaviour identical for every other caller). `EpicRequestInputs` carries the stored override and exposes `forge()`, which detects lazily and memoises in a `OnceCell` so the blocker check and the dispatch agree. The `forge/mod.rs` header's fourth rule gained a sentence saying the epic-request path does not rely on the older tolerance.
- **Files modified:** `packages/core/src/forge/mod.rs`
- **Commit:** 670a2cc

**2. [Plan shape] `EpicRequestInputs` has no `project_id` field**
- **Found during:** Task 3
- **Issue:** the plan listed it, but once the redundant command-side query is gone nothing reads it, and an unread private field is a dead-code warning.
- **Fix:** omitted it. `has_integration_branch()` and `repo_path()` accessors were added because the command crate cannot read the private fields, and `forge()` replaces the field the plan named.
- **Commit:** 670a2cc

**Total deviations:** 2 (1 auto-fixed bug in the plan's design, 1 omitted unused field). **Impact:** neither changes an observable output; the first makes the plan's central claim true for NULL-forge projects.

## Issues Encountered

None. The first full workspace run was backgrounded by the tool timeout and its output truncated, so it was re-run with a log file; the second run is the evidence above.

## Known Stubs

None.

## Threat Flags

None beyond the plan's `<threat_model>`. T-08-11-01 (lock across spawns) is mitigated structurally by connection-free git halves; T-08-11-02 (hand-off tampering) by private-field inputs structs; T-08-11-03 (refusal routing) by downcasting from both halves and preserving blocker order; T-08-11-04 (`run_merge` contract) by not touching it, with the 37 unedited merge tests as proof.

## Follow-up

- Out of scope and still open: WR-04 (two concurrent epic-request calls can push twice), WR-10 (per-anchor git work under the lock in `assemble_context_packet`), CR-02 error categories (plan 08-12), and the human checks.
- The `forge_request_for_task` / `forge_request_for_epic` commands and the board forge flags still call `forge_and_repo_path` under the lock, relying on the module header's documented one-bounded-spawn tolerance. Not part of this plan's three paths.
- No test measures lock hold time; the guarantee is the signature, not a timing assertion.

## Self-Check: PASSED

All six modified source files exist and are tracked; commits 8106c26, fca3f8c and 670a2cc are in `git log`; `git rev-list --count` from `plan_head_before` is 3.
