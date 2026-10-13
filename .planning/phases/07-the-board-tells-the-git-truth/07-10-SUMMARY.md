---
phase: 07-the-board-tells-the-git-truth
plan: 10
subsystem: infra
tags: [rust, subprocess, timeout, git, gh, glab, reliability]

# Dependency graph
requires:
  - phase: 07-the-board-tells-the-git-truth
    provides: the gh/glab/git adapter functions (spawn_gh, spawn_glab, spawn_git) this plan reroutes through a shared guard
provides:
  - "A single bounded-wait function (`proc::output_with_timeout`) every git/forge subprocess in the workspace routes through"
  - "A fixed wall-clock ceiling per CLI family: GIT_TIMEOUT_SECS=120s, FORGE_CLI_TIMEOUT_SECS=30s"
affects: [07-11 (lock-scope gap closure — depends on the ceiling existing before narrowing the mutex hold time)]

actuals:
  tokens: 5658
  tasks: 2
  commits: 3

tech-stack:
  added: []
  patterns:
    - "Bounded-wait subprocess guard: one function (`proc::output_with_timeout`) takes an already-built `Command`, never constructs its own, and every spawn helper hands it their command instead of calling `.output()`/`.spawn()` directly."
    - "On timeout, reader/writer threads are deliberately abandoned (not joined) rather than aborted — Rust's std threads cannot be forcibly cancelled, so joining them on the timeout path risks blocking on a surviving grandchild that inherited the pipe descriptors."

key-files:
  created:
    - packages/core/src/proc.rs
    - packages/core/tests/subprocess_timeout.rs
  modified:
    - packages/core/src/lib.rs
    - packages/core/src/forge/github.rs
    - packages/core/src/forge/gitlab.rs
    - packages/core/src/git.rs

key-decisions:
  - "Ceilings are GIT_TIMEOUT_SECS=120s and FORGE_CLI_TIMEOUT_SECS=30s, taken directly from code review WR-02's proposed figures rather than independently researched (plan frontmatter marks the estimate confidence low for this reason)."
  - "On a timeout, the guard abandons (drops, does not join) the stdout/stderr/stdin worker threads after killing and reaping the direct child, instead of waiting for them to finish draining. Joining them on that path reintroduces an unbounded wait whenever the direct child forked a surviving descendant that inherited the pipe write end — discovered empirically during this plan's own verification (see Deviations)."
  - "The guard only ever signals the pid its own `spawn()` call returned — never a process group and never a pid looked up elsewhere — per the plan's T-07-10-05 prohibition. This means a grandchild a spawned CLI forks (a shell wrapper's trailing command, a credential helper, a transport subprocess) is not itself killed; only the direct child is. Accepted as the deliberate scope of this plan."

requirements-completed: [LINK-02, LINK-08, LINK-09]

coverage:
  - id: D1
    description: "A gh/glab/git child process that stops making progress is killed at its CLI family's fixed wall-clock ceiling and surfaces as a bounded error, never a hang"
    requirement: "LINK-02"
    verification:
      - kind: unit
        ref: "packages/core/tests/subprocess_timeout.rs#hung_child_is_killed_within_its_ceiling_and_reports_timed_out"
        status: pass
      - kind: integration
        ref: "packages/core/tests/subprocess_timeout.rs#gh_request_for_branch_against_a_hung_gh_returns_bounded_error (--ignored)"
        status: pass
      - kind: integration
        ref: "packages/core/tests/subprocess_timeout.rs#glab_request_for_branch_against_a_hung_glab_returns_bounded_error (--ignored)"
        status: pass
    human_judgment: false
  - id: D2
    description: "No forge or git CLI can block waiting for an interactive prompt — standard input is closed, never inherited, when no payload is supplied"
    requirement: "LINK-08"
    verification:
      - kind: unit
        ref: "packages/core/tests/subprocess_timeout.rs#child_with_no_stdin_payload_sees_closed_stdin_not_a_hang"
        status: pass
    human_judgment: false
  - id: D3
    description: "A child that completes inside its ceiling returns output identical to the previous unbounded wait, and every pre-existing git/forge/worktree test still passes unchanged"
    requirement: "LINK-09"
    verification:
      - kind: unit
        ref: "packages/core/tests/subprocess_timeout.rs#fast_child_returns_unchanged_output"
        status: pass
      - kind: unit
        ref: "packages/core/tests/subprocess_timeout.rs#git_at_still_succeeds_normally_on_a_real_repository"
        status: pass
      - kind: integration
        ref: "cargo test --workspace (0 failures across all suites, run in isolation)"
        status: pass
    human_judgment: false
  - id: D4
    description: "Exactly one function performs the bounded wait and all three spawn helpers (spawn_gh, spawn_glab, spawn_git) route through it, with no unbounded capture call left in any of the three adapters"
    verification:
      - kind: other
        ref: "grep -rln 'output_with_timeout' packages/core/src/ lists exactly proc.rs, git.rs, forge/github.rs, forge/gitlab.rs"
        status: pass
      - kind: other
        ref: "grep -rv '^\\s*//' packages/core/src/forge/github.rs packages/core/src/forge/gitlab.rs packages/core/src/git.rs | grep -cE '\\.output\\(\\)|\\.spawn\\(\\)' == 0"
        status: pass
    human_judgment: false
  - id: D5
    description: "A child whose output exceeds the OS pipe buffer still completes rather than deadlocking the guard (stdout/stderr drained on dedicated threads concurrently with the deadline watch)"
    verification:
      - kind: unit
        ref: "packages/core/tests/subprocess_timeout.rs#child_output_larger_than_pipe_buffer_still_completes"
        status: pass
    human_judgment: false
  - id: D6
    description: "A git read that returns an empty result (no remote configured) still returns its empty success inside the ceiling rather than being reported as a timeout"
    verification:
      - kind: integration
        ref: "packages/core/tests/git_facts.rs#fetch_origin_skips_without_fetching_when_no_remote_is_configured"
        status: pass
    human_judgment: false
  - id: D7
    description: "The guard never kills a process it did not itself spawn — no pid is looked up, parsed, or received from anywhere but this function's own spawn() call"
    verification: []
    human_judgment: true
    rationale: "This is a structural property of proc.rs's own code (it holds only the Child its own cmd.spawn() returned, and calls kill()/wait() on that value alone) rather than something an automated test can observe from outside the process — no test can distinguish 'killed the right pid' from 'killed a pid that happened to be the same' without OS-level process-tree inspection, which this plan did not add. Verified by code reading during this execution."

# Metrics
duration: 46min
completed: 2026-10-05
status: complete
---

# Phase 7 Plan 10: Bounded Subprocess Timeout Guard Summary

**One `proc::output_with_timeout` function, with per-CLI ceilings (git 120s, gh/glab 30s), that every git/forge spawn helper now routes through — so a hung `gh`, `glab`, or `git` child is killed and surfaces as a bounded error instead of blocking its caller forever.**

## Performance

- **Duration:** ~46 min
- **Completed:** 2026-10-05T14:21:26+08:00
- **Tasks:** 2
- **Files modified:** 6 (2 created, 4 modified)

## Accomplishments

- Added `packages/core/src/proc.rs`: the one bounded-wait function (`output_with_timeout`) and its two ceiling constants (`GIT_TIMEOUT_SECS=120`, `FORGE_CLI_TIMEOUT_SECS=30`), registered in `lib.rs`.
- Rewrote `spawn_gh` (`forge/github.rs`), `spawn_glab` (`forge/gitlab.rs`) and `spawn_git` (`git.rs`) to build their `Command` and hand it to the guard instead of calling `.output()`/`.spawn()` directly — signatures and return types unchanged, so every existing caller is untouched.
- Proved the guard end to end: a `gh`/`glab` stub that never exits is killed within its ceiling and `request_for_branch` surfaces a `ForgeError` instead of hanging (two `#[ignore]`d 30-second tests, run explicitly via `-- --ignored`).
- Proved the guard does not change the success path: fast children return byte-identical output, a real `git_at` call against a fresh repository still succeeds, and the entire pre-existing workspace test suite (`cargo test --workspace`) still passes with zero failures.

## Task Commits

1. **Task 1: One bounded wait, proven end to end on the `gh` path** - `80e56f5` (feat)
2. **Task 2: Route the remaining two spawn helpers through the same guard** - `99abb90` (feat)

**Plan metadata:** (this commit)

## Files Created/Modified

- `packages/core/src/proc.rs` - The bounded-wait guard: spawns the caller's already-built `Command`, drains stdout/stderr on dedicated threads, writes/closes stdin off the calling thread, polls for exit against a deadline, and kills+reaps on timeout.
- `packages/core/tests/subprocess_timeout.rs` - Guard-level unit tests (fast exit, hang+kill, large output, stdin closed/supplied) plus end-to-end `#[ignore]`d arms for `gh` and `glab`, plus a real-repository `git_at` success check.
- `packages/core/src/lib.rs` - Registers `pub mod proc;` alphabetically between `marker` and `query`.
- `packages/core/src/forge/github.rs` - `spawn_gh` now routes through the guard with `FORGE_CLI_TIMEOUT_SECS`; removed the now-dead manual piped-stdin write/wait branch and its now-unused `Write`/`Stdio` imports.
- `packages/core/src/forge/gitlab.rs` - `spawn_glab` now routes through the guard with `FORGE_CLI_TIMEOUT_SECS`.
- `packages/core/src/git.rs` - `spawn_git` now routes through the guard with `GIT_TIMEOUT_SECS`, keeping `-C <repo_path>` as the first two arguments (the structural property `supervisor_cwd.rs` asserts) and the existing `.with_context(...)` spawn-failure message.

## Decisions Made

- Ceilings (120s git / 30s forge CLI) are code review WR-02's own proposed figures, not independently researched — the plan's `estimate.confidence: low` flags this explicitly.
- On timeout, the guard kills and reaps the direct child, then **abandons** (drops without joining) the stdout/stderr/stdin worker threads rather than waiting for them — see Deviations below for why this was necessary, not just a style choice.
- The guard signals only the pid its own `spawn()` call returned, never a process group — a grandchild the spawned CLI itself forks is not killed. Accepted as this plan's deliberate scope (T-07-10-05's prohibition against signalling any pid the guard did not itself receive from its own spawn call).

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 1 - Bug] Timeout path joined reader/writer threads, silently defeating the ceiling for any child that forks a surviving descendant**
- **Found during:** Task 1's own verification loop, before the first commit — the `#[ignore]`d `gh` end-to-end test returned after ~40 seconds instead of the expected ~30, failing its own elapsed-time assertion.
- **Issue:** The first implementation of `output_with_timeout` called `.join()` on the stdout/stderr (and stdin) worker threads on the timeout path, after `kill()`+`wait()` on the direct child. A shell-script stub (`#!/bin/sh\nsleep 40`) executed as a file causes `/bin/sh` to fork a child process for the final `sleep` rather than exec-replacing itself (confirmed independently via `ps -o pid,ppid` on a manually-launched copy of the same script) — that forked `sleep` inherits a copy of the write end of the stdout/stderr pipes. Killing the direct child (`/bin/sh`) does not close the grandchild's copy, so the reader thread's `read_to_end()` blocks until the grandchild exits on its own (here, at the full 40-second mark) — exactly the unbounded wait this plan exists to eliminate.
- **Fix:** On the timeout path, the function now kills+reaps the direct child and then `drop()`s the reader/writer `JoinHandle`s instead of joining them. The threads keep running in the background and exit once their pipe actually closes; the function itself returns bounded by `timeout`, never later. The success path (child exited normally) is unaffected — it still joins all three threads, since the direct child having exited is the common case and losing their output there would defeat the function's purpose.
- **Files modified:** `packages/core/src/proc.rs`
- **Verification:** Re-ran the previously-failing `gh` end-to-end test (`cargo test -p core --test subprocess_timeout -- --ignored`) — returns in ~30.0s, not ~40s. Added a second, equivalent `glab` end-to-end arm in Task 2, which also returns within its ceiling.
- **Committed in:** `80e56f5` (fix was made before Task 1's commit, so the commit contains the corrected implementation directly — no separate fix-up commit was needed)

---

**Total deviations:** 1 auto-fixed (1 bug).
**Impact on plan:** Necessary for the plan's own core correctness guarantee — a guard whose timeout path can itself be made to wait forever by a shell-wrapped stub does not close verification Gap 1's second `missing:` item. No scope creep: the fix is contained entirely inside `proc.rs`'s existing function body, with no change to its public signature, the two ceiling constants, or any caller.

## Issues Encountered

None beyond the deviation documented above.

## User Setup Required

None - no external service configuration required.

## Next Phase Readiness

- Every `gh`, `glab` and `git` subprocess in the workspace now has a hard wall-clock ceiling; a hung child can no longer starve its caller indefinitely.
- Plan 07-11 (the lock-scope half of the same verification gap) can now narrow `AppState.db`'s mutex hold time around these calls without reintroducing an unbounded wait underneath it — the ceiling this plan adds is a precondition for that plan's own fix to be meaningful.
- No blockers.

---
*Phase: 07-the-board-tells-the-git-truth*
*Completed: 2026-10-05*

## Self-Check: PASSED

- FOUND: packages/core/src/proc.rs
- FOUND: packages/core/tests/subprocess_timeout.rs
- FOUND commit 80e56f5 (Task 1)
- FOUND commit 99abb90 (Task 2)
