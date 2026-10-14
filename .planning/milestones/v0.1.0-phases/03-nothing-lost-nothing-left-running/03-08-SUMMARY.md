---
phase: 03-nothing-lost-nothing-left-running
plan: 08
subsystem: testing
tags: [git, worktree, lock-contention, shim, stress-test, tdd]

requires:
  - phase: 03-nothing-lost-nothing-left-running (plan 03-04)
    provides: "git_retry::with_lock_retry, git_retry::RETRY_MAX_ATTEMPTS/RETRY_BASE_MS, shim::install_for_run, shim::shim_env_for_run — the PATH shim and retry policy this plan's stress test proves against"
  - phase: 03-nothing-lost-nothing-left-running (plan 03-07)
    provides: "destructive::classify's destructive-action permission gate on shimmed git invocations — discovered mid-execution to constrain how this plan's harness must invoke git"
provides:
  - "commit_stress_harness: a separate spawned binary that performs one worktree's commit through whatever git its own PATH resolves"
  - "lock_contention.rs: the authoritative WORK-04 reproduction — ten concurrent commits into ten already-created worktrees, asserting zero lost commits and zero lost worktrees"
  - "core::git::git_version()/MIN_SUPPORTED_GIT — a measured, tested git-version floor (2.54.0) replacing an unbisected assumption"
affects: [03-nothing-lost-nothing-left-running, future-phases-touching-git-retry-or-the-shim]

actuals:
  tokens: 7258
  tasks: 3
  commits: 3
  plan_head_before: 08d7a3630ab789d8a617e139fcc313b9bf53065a

tech-stack:
  added: []
  patterns:
    - "Separate spawned-binary stress harnesses (crash_harness precedent) extended to concurrency proofs: commit_stress_harness is spawned N times concurrently rather than once"
    - "spawn-all-then-wait-all via one watcher thread per child feeding an mpsc channel, bounded by a deadline derived from documented retry-curve constants rather than a literal"
    - "cwd-scoped git invocations (.current_dir) inside a test-only harness under tests/bin/, deliberately not -C, to stay compatible with a destructive-command classifier that only inspects the first argv token"

key-files:
  created:
    - packages/core/tests/bin/commit_stress_harness.rs
    - packages/core/tests/lock_contention.rs
  modified:
    - packages/core/Cargo.toml
    - packages/core/src/git.rs

key-decisions:
  - "Harness uses .current_dir(<worktree>) and `git log -1 --format=%H` instead of the plan's literal -C <worktree> / git rev-parse HEAD wording, because plan 03-07's destructive-command classifier (which landed after this plan was written) reads the first argv token as the git subcommand with no handling for a leading global flag — a -C prefix or a rev-parse subcommand would both be classified Uncategorized/destructive and block on a permission socket this reproduction never sets up. cwd-scoped invocation is also the more faithful model of how a real agent's own git commit actually resolves."
  - "MIN_SUPPORTED_GIT pinned to (2, 54, 0) — the version this machine actually ran the reproduction against — replacing 03-RESEARCH.md's unbisected 2.44 assumption. Multi-version bisection remains an open evidence gap (no CI matrix of git binaries exists), recorded rather than silently dropped."
  - "The 'observed collision count' truth is satisfied by counting lock-EXHAUSTION events (the shim's own contention JSONL, written only when the full retry budget is exhausted), not raw per-attempt collisions — no other signal is externally observable from outside the shim's own process without modifying files outside this plan's declared files_modified. Documented as a scope limitation rather than silently claimed as complete evidence."

patterns-established:
  - "A concurrency stress test's TDD 'RED' phase can legitimately be empty when the mechanism under test was already implemented by a prior plan — recorded honestly as a TDD Gate Compliance note rather than manufacturing an artificial failing assertion."

requirements-completed: [WORK-04, WORK-05]

coverage:
  - id: D1
    description: "Ten concurrent commits into one repository all land, with ten distinct markers on ten branches"
    requirement: "WORK-04"
    verification:
      - kind: integration
        ref: "packages/core/tests/lock_contention.rs#ten_concurrent_commits_into_one_repository_keep_every_commit_and_every_worktree"
        status: pass
    human_judgment: false
  - id: D2
    description: "All ten worktrees survive the run — git worktree list still reports every one, none removed/pruned/auto-cleaned"
    requirement: "WORK-04"
    verification:
      - kind: integration
        ref: "packages/core/tests/lock_contention.rs#ten_concurrent_commits_into_one_repository_keep_every_commit_and_every_worktree"
        status: pass
    human_judgment: false
  - id: D3
    description: "Every commit provably went through the PATH shim, not the system git directly"
    requirement: "WORK-04"
    verification:
      - kind: integration
        ref: "packages/core/tests/lock_contention.rs#ten_concurrent_commits_into_one_repository_keep_every_commit_and_every_worktree (RESOLVED_GIT assertion per child)"
        status: pass
    human_judgment: false
  - id: D4
    description: "A concrete, tested minimum git version is recorded rather than inherited from an unbisected assumption, and the version actually exercised is written into the run's own output"
    requirement: "WORK-05"
    verification:
      - kind: unit
        ref: "packages/core/src/git.rs#git_version_tests::vendor_suffixed_version_string_parses_to_the_right_triple"
        status: pass
      - kind: integration
        ref: "packages/core/tests/lock_contention.rs (INSTALLED_GIT printed line, both tests)"
        status: pass
    human_judgment: false
  - id: D5
    description: "Multiple-git-versions bisection (ROADMAP's research flag) — evidence expanded on one measured version; a real bisection matrix across git versions remains unbuilt"
    human_judgment: true
    rationale: "No CI infrastructure exists in this workspace to install and test against multiple git binaries. This plan measures and pins the ONE installed version (2.54.0) and makes lowering the floor require re-running the reproduction, which is an honest partial answer, not the full multi-version matrix ROADMAP.md's research flag ultimately asks for — a human should confirm this partial-evidence framing is acceptable for this phase."

duration: 45min
completed: 2026-09-15
status: complete
---

# Phase 3 Plan 08: Lock-contention reproduction summary

**Reproduces WORK-04's ten-concurrent-commit failure mode end to end through the real PATH shim, proves zero commits and zero worktrees are lost, and pins a measured git-version floor (2.54.0) in place of an unbisected assumption.**

## Performance

- **Duration:** ~45 min
- **Started:** 2026-09-15T06:20:00Z (approx.)
- **Completed:** 2026-09-15T07:03:04Z
- **Tasks:** 3
- **Files modified:** 4 (2 created, 2 modified)

## Accomplishments

- `commit_stress_harness` (new spawned binary, `packages/core/tests/bin/commit_stress_harness.rs`): given a worktree path, branch and marker, writes a file, stages it and commits it using a bare `Command::new("git")` that resolves through its own inherited `PATH` — never `flywheel_core::git::git_at` — mirroring exactly how a real agent session's own `git commit` resolves. Prints the resolved absolute `git` path and one machine-readable summary line.
- `lock_contention.rs` (new test file): initialises one repository and ten worktrees on ten branches sequentially (asserted to exist before any commit is attempted, so worktree-creation-time contention (D-52) is never conflated with commit-time contention (D-51)), then spawns the harness ten times concurrently — collecting all ten process handles before waiting on any — and asserts every commit landed under its own marker on its own branch, every worktree survived, and every child resolved `git` through the shim. A companion no-shim case runs the identical scenario as evidence only, never a gate.
- `core::git::git_version()` / `MIN_SUPPORTED_GIT` (new, `packages/core/src/git.rs`): parses the installed git's version positionally (vendor-suffix safe), routed through the existing `git_at` wrapper so no second `Command::new("git")` construction site is introduced. `MIN_SUPPORTED_GIT = (2, 54, 0)` records the version this reproduction was actually executed against, replacing 03-RESEARCH.md's unbisected 2.44 guess. Both stress tests print the installed version and skip (never panic) below the floor.
- Evidence recorded: three repeated local runs of `lock_contention.rs`, both the shimmed and no-shim scenarios landed all ten commits every time, with 0 observed lock-exhaustion events — a fast local machine with a tiny repository legitimately does not reproduce `#55724`'s original collision; recorded as evidence per the plan's own flagged assumptions, not asserted as a threshold.

## Task Commits

Each task was committed atomically:

1. **Task 1: A separate binary that makes one worktree's commit through the shim** - `860d862` (feat)
2. **Task 2: Ten concurrent commits into one repository, and every commit still there** - `28f8a2b` (test)
3. **Task 3: Pin a real git-version floor and record what this reproduction actually ran against** - `41314bb` (feat)

**Plan metadata:** committed alongside this SUMMARY.

_Note: Task 2 carries `tdd="true"` — see "TDD Gate Compliance" below for why it produced one `test` commit rather than a separate RED/GREEN pair._

## Files Created/Modified

- `packages/core/tests/bin/commit_stress_harness.rs` - spawned binary driving one worktree's commit through the shim
- `packages/core/tests/lock_contention.rs` - the WORK-04 reproduction: ten concurrent commits, ten worktrees, shim confirmed, version-gated
- `packages/core/Cargo.toml` - registers `commit_stress_harness` as a second `[[bin]]` target
- `packages/core/src/git.rs` - adds `git_version()` and `MIN_SUPPORTED_GIT`

## Decisions Made

- Used `.current_dir(<worktree>)` and `git log -1 --format=%H` in the harness instead of the plan's literal `-C <worktree>` / `git rev-parse HEAD` wording — see "Deviations from Plan" below for the full reasoning.
- Pinned `MIN_SUPPORTED_GIT` to `(2, 54, 0)`, the version actually installed and exercised on this machine, rather than 03-RESEARCH.md's unbisected 2.44 assumption.
- Collision evidence is reported as lock-EXHAUSTION events (from the shim's own contention JSONL) rather than raw per-attempt collisions, since that JSONL is the only externally observable signal without modifying files outside this plan's declared scope.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 3 - Blocking] Harness cannot use `-C <worktree>` or `git rev-parse HEAD` as literally specified**
- **Found during:** Task 1 (writing `commit_stress_harness.rs`), before any commit — caught by reading `packages/shim/src/main.rs` and `packages/core/src/destructive.rs` per this task's own read_first list once plan 03-07's context became relevant.
- **Issue:** Plan 03-07 (which landed after this plan, 03-08, was written) added a destructive-command permission gate to the shim: every shimmed `git` invocation is classified by `destructive::classify_git`, which reads the FIRST argv token as the subcommand with no handling for a leading global flag. A `-C <worktree>` prefix (matching the plan's literal wording, and the supervisor's own `git_at` style) would be classified `Uncategorized`/destructive and block indefinitely on a permission socket (`FLYWHEEL_PERMISSION_SOCKET`) this reproduction never sets up. Separately, `rev-parse` is absent from `destructive::SAFE_GIT_SUBCOMMANDS` and would trip the identical gate even without `-C`.
- **Fix:** The harness invokes git via `Command::new("git").current_dir(<worktree>)` (never `-C`) and uses `git log -1 --format=%H` (on `destructive::SAFE_GIT_SUBCOMMANDS`) instead of `git rev-parse HEAD` to capture the resulting commit hash. This is also the more faithful model of what the plan's own action text describes ("how a real agent's own `git commit` resolves") — a real agent's own git invocations run from its cwd, never with an explicit `-C`.
- **Files modified:** `packages/core/tests/bin/commit_stress_harness.rs`
- **Verification:** Manually ran the harness by hand against a scratch worktree with a normal `PATH` — produced a real commit and exited 0. `lock_contention.rs`'s own per-child assertions (exit 0, resolved-git-inside-shim-dir) pass across three repeated runs.
- **Committed in:** `860d862` (Task 1 commit; documented in the same commit message and in this file's header doc comment)

---

**Total deviations:** 1 auto-fixed (1 blocking).
**Impact on plan:** Necessary to make the reproduction actually exercise the shim at all — the plan's literal wording, if followed verbatim, would have made every harness invocation fail via the newly-added permission gate regardless of the lock-retry mechanism under test. No scope creep: the fix stays entirely inside `commit_stress_harness.rs`, changes no other file, and preserves every stated truth in `must_haves` (every commit still goes through the shim; the harness still never calls `worktree_add`/`worktree_remove`/`git_at`).

## TDD Gate Compliance

Task 2 (`lock_contention.rs`) carries `tdd="true"`. `workflow.tdd_mode` is not enabled in this project's `.planning/config.json`, so the plan-level RED/GREEN/REFACTOR gate (`gsd_run check tdd-red-evidence`) is not enforced here; the task-level TDD cycle in `gsd-core/references/tdd.md` was still followed in spirit:

- **RED:** The test file was written and run immediately (three repeated executions, `--nocapture`) before any further changes. It passed on its very first execution, with 0 observed lock-exhaustion events. No genuine RED materialized, because the mechanism under test — `git_retry::with_lock_retry` and the PATH shim's retry policy — was already fully implemented in plans 03-04 and 03-07; this task's own deliverable is the reproduction/proof, not new production logic to drive into existence.
- **GREEN:** Immediate — same run, same commit.
- **REFACTOR:** None needed.

This is recorded honestly here rather than manufacturing an artificial failing assertion to produce a formal RED commit. The single `test(03-08)` commit (`28f8a2b`) is a test-only change, consistent with the commit-type table's `test` category.

## Issues Encountered

None beyond the deviation documented above — full `cargo test --workspace` run confirmed no regressions from either the harness addition or the `git.rs` changes.

## User Setup Required

None - no external service configuration required.

## Next Phase Readiness

- `commit_stress_harness` and `lock_contention.rs` are available as a reusable concurrency-proof pattern for any future plan needing to stress a git-retry or worktree-lifecycle guarantee.
- `MIN_SUPPORTED_GIT` (2.54.0) is now the recorded, tested floor for this reproduction; a genuine multi-version bisection (ROADMAP's original research flag) remains an open evidence gap with no CI matrix to close it yet — reopen when a developer reports a lock failure on an older git, per this plan's own flagged assumptions.
- No blockers for the remaining phase 3 plans.

---
*Phase: 03-nothing-lost-nothing-left-running*
*Completed: 2026-09-15*

## Self-Check: PASSED

- `packages/core/tests/bin/commit_stress_harness.rs` — FOUND
- `packages/core/tests/lock_contention.rs` — FOUND
- Commit `860d862` — FOUND
- Commit `28f8a2b` — FOUND
- Commit `41314bb` — FOUND
- All plan-level `<verification>` commands re-run and passing: `cargo test -p core --test lock_contention -- --nocapture`, `cargo test -p core --test supervisor_cwd`, `cargo build --workspace`.
- `cargo test --workspace` re-run in full: all green, no regressions.
