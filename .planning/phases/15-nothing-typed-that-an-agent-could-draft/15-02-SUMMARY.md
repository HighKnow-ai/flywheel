---
phase: 15-nothing-typed-that-an-agent-could-draft
plan: 02
subsystem: planning
tags: [rust, rusqlite, git-ls-files, mcp, submit_plan, uat-harness, file-set, undeclared]

requires:
  - phase: 09-parallel-fan-out
    provides: "render_planning_prompt, store_submitted_plan, the submit_plan MCP tool and the per-task file-set declaration"
  - phase: 13-nothing-new-escapes-the-fence
    provides: "uat_fanout_ops bridge, the Ledger-style honesty rule from uat-10"
provides:
  - "observe_branch: every standalone live-chain lookup carries the fake.invoked() guard structurally"
  - "render_planning_prompt(packet, file_listing): a git ls-files listing bounded by PLANNING_LISTING_CEILING (2000) with a stated not-shown count, and the `undeclared` instruction"
  - "git::tracked_files: git ls-files -z through git_at, tracked paths only, no libgit2"
  - "SubmittedTask.undeclared: a task stays planned with no entries, no edge and a null-after task.file_set_declared event"
  - "submit_plan wire and tool description carry `undeclared`, validated as a boolean"
  - "uat-14-planner-file-set.mjs: --self-test, --offline (both run here) and --live (written, run by 15-04)"
  - "uat_fanout_ops plan-setup / plan-start / plan-submit / plan-readback"
affects: [15-04, 15-05, drafting-engine, wave-plan-sheet]

actuals:
  tokens: 19300
  tasks: 3
  commits: 3
plan_head_before: f4cb531e907788a7886b7628e5d99cbe5dbbb8a9

tech-stack:
  added: []
  patterns:
    - "A guard that must accompany a call is built into the one helper that makes the call"
    - "An honesty ledger: only measure() can stamp a row observed; the formatter refuses an unstamped one"
    - "Undecidable is a submission flag plus an event, never a column"

key-files:
  created:
    - packages/core/tests/file_set_undeclared.rs
    - scripts/uat/uat-14-planner-file-set.mjs
    - .planning/phases/15-nothing-typed-that-an-agent-could-draft/deferred-items.md
  modified:
    - packages/core/tests/forge_live_chain.rs
    - packages/core/src/epic_context_packet.rs
    - packages/core/src/domain/dispatch_plan.rs
    - packages/core/src/dispatch_exec.rs
    - packages/core/src/git.rs
    - packages/core/tests/dispatch_plan.rs
    - packages/core/tests/bin/uat_fanout_ops.rs
    - packages/sidecar/src/mcp-permission-server.ts
    - packages/sidecar/src/adapter.ts
    - packages/sidecar/test/submit-plan-wire.test.mjs

key-decisions:
  - "undeclared is a serde(default) submission field plus a task.file_set_declared event with a null after; no column, no migration (count stays 24)"
  - "An undeclared task never reaches declare_file_set_in_tx, so a hand-declared set it already held is left alone rather than cleared"
  - "The listing is read in begin_planning_run_with with no lock held, from the epic worktree, and a failed git ls-files fails the planning start rather than briefing the model with an empty listing"
  - "The harness bridge extends uat_fanout_ops (already owns epic and plan setup) rather than adding a new binary and a Cargo.toml entry"

requirements-completed: [DRFT-01]

coverage:
  - id: D1
    description: "Every standalone live-chain test reaches its fake before trusting a result, routed through one helper"
    verification:
      - kind: integration
        ref: "packages/core/tests/forge_live_chain.rs (19 tests)"
        status: pass
    human_judgment: false
  - id: D2
    description: "The planning prompt carries a real git ls-files listing, states truncation, and offers `undeclared`"
    requirement: DRFT-01
    verification:
      - kind: integration
        ref: "packages/core/tests/file_set_undeclared.rs#the_prompt_carries_the_listing_and_tells_the_model_to_answer_undeclared_rather_than_invent"
        status: pass
      - kind: integration
        ref: "packages/core/tests/file_set_undeclared.rs#a_listing_longer_than_the_ceiling_states_how_many_paths_are_not_shown"
        status: pass
    human_judgment: false
  - id: D3
    description: "undeclared is storable, distinct from empty, keeps the task planned, produces no edge, and records a null-after event"
    requirement: DRFT-01
    verification:
      - kind: integration
        ref: "packages/core/tests/file_set_undeclared.rs (10 tests)"
        status: pass
      - kind: integration
        ref: "packages/sidecar/test/submit-plan-wire.test.mjs"
        status: pass
    human_judgment: false
  - id: D4
    description: "A re-runnable harness scores DRFT-01's clauses honestly; the live arm is written but unrun"
    requirement: DRFT-01
    verification:
      - kind: other
        ref: "node scripts/uat/uat-14-planner-file-set.mjs --self-test"
        status: pass
      - kind: other
        ref: "node scripts/uat/uat-14-planner-file-set.mjs --offline"
        status: pass
    human_judgment: true
    rationale: "The --live arm is unexercised: whether a real planner declares real files is plan 15-04's measurement, not this plan's."

duration: 45min
completed: 2026-10-16
status: complete
---

# Phase 15 Plan 02: Planner file-set instrument Summary

**The planning run is briefed with a real `git ls-files` listing and may answer `undeclared`, a task it cannot decide stays in the wave plan declaring nothing, and `uat-14-planner-file-set.mjs` scores DRFT-01's clauses with an honesty ledger so a later live run is provable.**

## Performance

- **Duration:** about 45 min
- **Completed:** 2026-10-16T04:37Z
- **Tasks:** 3
- **Files modified:** 14 (3 created)

## Accomplishments

- `forge_live_chain.rs`: `observe_branch` pairs `request_for_branch_at` with the `fake.invoked()` assertion. All seven standalone call sites route through it; `assert_open_to_merged_chain` is unchanged. The folded todo moved to `done/`.
- `render_planning_prompt` gains a `## Files In This Repository` section, bounded by `PLANNING_LISTING_CEILING` with a stated count of paths not shown, plus one paragraph naming `undeclared` as the honest answer. The listing comes from the new `git::tracked_files` (`git ls-files -z` through `git_at`); `git2` is in no manifest.
- `SubmittedTask.undeclared` exempts a task from `EmptyFileList`, keeps it `planned` in its wave (never `skipped`), declares no entries and so makes no edge, and appends one `task.file_set_declared` event with a null `after`. `undeclared` with files is `Malformed`; empty files without the flag is still `EmptyFileList`.
- The `submit_plan` wire passes `undeclared` through, validated as a boolean, and the tool description tells the model an invented file set is worse than none.
- `uat-14-planner-file-set.mjs`: `--self-test` and `--offline` pass; `--live` is written and refuses to start without `--artifact`.

## Task Commits

1. **Task 1: live-chain guard** - `d969f861` (test)
2. **Task 2: listing and `undeclared`** - `b5b050c8` (feat)
3. **Task 3: measurement harness** - `399997e3` (feat)

## Decisions Made

See `key-decisions` above. One to carry forward: because an undeclared task skips `declare_file_set_in_tx`, an earlier hand-declared set on that task survives a plan that calls it undeclared.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 3 - Blocking] Edited `packages/core/tests/bin/uat_fanout_ops.rs`, which the plan did not list**
- **Found during:** Task 3
- **Issue:** The plan requires the script to drive the real writer through a `uat_*_ops` subcommand, but no existing bridge could start a planning run, submit a plan or read one back.
- **Fix:** Added `plan-setup`, `plan-start`, `plan-submit`, `plan-readback` to the bridge that already owns epic and plan setup, instead of a new binary plus a `Cargo.toml` entry.
- **Commit:** `399997e3`

**2. [Rule 1 - Bug] Updated three existing tests broken by the signature and wire changes**
- **Found during:** Task 2
- **Issue:** `dispatch_plan.rs`'s `roster_prompt` rendered with an empty listing while a real start renders the repository's, breaking `two_renders_of_the_same_board_state_are_byte_identical`; `SubmittedTask` literals needed the new field; `submit-plan-wire.test.mjs` deep-compared tasks without `undeclared`.
- **Fix:** `roster_prompt` now passes `git::tracked_files` of the fixture repo; literals and wire assertions carry `undeclared: false`.
- **Commit:** `b5b050c8`

**3. [Process] Task 2's tests were written after the implementation**
- The plan marked Task 2 `tdd="true"`; the orchestrator ran with `TDD_MODE=false`. No RED commit exists. The ten tests in `file_set_undeclared.rs` pin every behavior in the plan's list (Tests 1-8 plus the wire default), but they were not seen to fail first.

**Total deviations:** 2 auto-fixed (1 blocking, 1 bug), 1 process note.

## Issues Encountered

Two pre-existing sidecar failures, logged in `deferred-items.md` and not fixed: `adapter.test.mjs` reads a phase-05 log whose directory no longer exists, and `scope-hook-live.test.mjs` failed once in the full run and passed on an isolated rerun.

## Known Stubs

None. The `--live` arm has never run, and its evidence-gathering has therefore never been exercised against a real session; that is its stated state, not a stub.

## For plan 15-04

- Register this MANUAL line in `scripts/uat/run-all.sh` (this plan did not touch that file):
  `node scripts/uat/uat-14-planner-file-set.mjs --live --artifact <phase-dir>/15-LIVE-PLANNER-FILE-SET.json`
- `--live` runs against a scratch repository with a six-file tree, not the developer's real one. If the live artifact must name files of a real repository, that is a choice for 15-04's decision checkpoint; registering a real repo into the scratch database would cut an integration branch in it.
- `--live` denies any permission request other than the pre-approved `submit_plan` and records the denials in the artifact.

## Threat Flags

None. The only new input crossing a boundary is `undeclared`, covered by T-15-06 (refused when combined with files).

## Self-Check: PASSED

Created files exist, all three task commits are present, `request_for_branch_at(` appears only in the helper and `assert_open_to_merged_chain`, `git2` is absent from every manifest, the migration count is 24, and `run-all.sh` is untouched.
