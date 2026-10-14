---
phase: 10-fleet-supervision-across-every-project
plan: 02
subsystem: fleet
tags: [rust, proc, sidecar, claude-code-adapter, scheduler, forge, regression]
requires:
  - phase: 07-forge-truth
    provides: output_with_timeout, forge_tick_targets
  - phase: 02-one-agent-one-worktree-watched-live
    provides: normaliseStreamEvent and the session feed
provides:
  - "output_with_timeout reports a child that exits at its deadline with its real status"
  - "normaliseStreamEvents and emitStreamEvents: ordered multi-event normalisation with one sequence number per event"
  - "forge_tick_targets memoises a failed resolution, one attempt and one log line per project per tick"
affects: [10-03, 10-04, 10-05]
requirements-completed: [FLEET-01, WORK-07]
actuals:
  tokens: 4672
  tasks: 3
  commits: 3
plan_head_before: 3bde66e58988c80b6206727d0a6f35379b77a4c2
commits: 3
key-files:
  created:
    - packages/core/tests/proc_timeout_boundary.rs
  modified:
    - packages/core/src/proc.rs
    - packages/sidecar/src/claude-code-adapter.ts
    - packages/sidecar/test/adapter.test.mjs
    - packages/desktop/src-tauri/src/scheduler.rs
key-decisions:
  - "Deadline race fixed by reading the clock before the exit check, which keeps exactly one try_wait"
  - "normaliseStreamEvents emits one event per text/tool_use block when a line holds more than one; every other line is exactly [normaliseStreamEvent(...)]"
  - "Scheduler test goes through an injected resolver, not the memoised map"
duration: 20min
completed: 2026-10-12
status: complete
---

# Phase 10 Plan 02: Three folded defects Summary

**A deadline-race fix in `proc.rs`, an ordered multi-event stream normaliser in the Claude Code adapter, and a memoised forge-resolution failure in the scheduler, each with its own regression test.**

## What was built

1. **Deadline race (`9c24512`).** `output_with_timeout` read the clock after its exit check, so a child exiting in that gap was killed and reported as `TimedOut`. The loop now reads `expired` before `try_wait` and only gives up when the exit check made at or past the deadline still finds the child running. The file still has exactly one `try_wait`. Timeout constant, kill mechanics and polling interval are unchanged.
2. **Dropped narration (`5da53b3`).** New exported `normaliseStreamEvents` returns the ordered events for a line. An assistant line with more than one `text` / `tool_use` block yields one event per block in source order; every other line returns `[normaliseStreamEvent(...)]`. Each per-block event is built by `normaliseStreamEvent` itself on a one-block copy of the line, so field rules stay in one place. New exported `emitStreamEvents` is the single code path both stdout loops now call: it advances `session.nextSeq` past the extra events, so no two events share a sequence number. `normaliseStreamEvent` and its tests are untouched.
3. **Forge retry per worktree (`53c60e9`).** The per-tick `resolved` map now stores `Option<(Forge, PathBuf)>` and is written on both arms; the failure is logged on the first attempt only. `forge_tick_targets` delegates to `forge_tick_targets_with`, which takes the resolver as a parameter.

## Things a later reader needs

- **Timeout defect reach.** `output_with_timeout` wraps git and forge subprocesses (`spawn_git`, `spawn_gh`, `spawn_glab`). It never interprets agent-run terminal status, so there is no run-status bug behind this todo. Its reach in this phase is the porcelain read and `git worktree remove` in the inventory and reclaim paths.
- **Honest limit of the timeout test.** The window the fix closes is a few instructions wide. No test can force the old ordering to lose it on demand, so `proc_timeout_boundary.rs` pins the three outcomes (success, non-zero, genuine hang with no surviving pid) and runs the near-deadline cases ten times each. It is a pinning test and it was not shown to fail against the old ordering.
- **Process group.** The plan's behaviour list says the kill path terminates the whole process group. The code kills and reaps the direct child only, by design (T-07-10-05, documented in the function). That was left as it is; the test asserts the direct child does not survive.
- **Scheduler test seam.** It asserts through an injected resolver (a function parameter, `forge_tick_targets_with`), counting attempts directly: one attempt for a project with three tracked worktrees. The memoised map is local to the function and cannot be inspected from outside. The log line count is not asserted.
- **Sidecar rebuild.** `npm --prefix packages/sidecar run build` was run (clean `tsc`) and the adapter tests ran against the fresh `dist`. `packages/desktop/src-tauri/binaries/flywheel-sidecar-aarch64-apple-darwin` is a tracked 3.8 KB dev-time stub, not a packaged Node binary, so there was no bundled artifact to regenerate in this repo.
- **Known under-lock spawn.** A first resolution can still spawn `git remote get-url origin` while the database lock is held. Memoising bounds it to one spawn per project per tick. Recorded as a `ponytail:` note on `forge_tick_targets_with`; moving the spawn out from under the lock is not done here.
- **Wider than the plan's wording.** Two text blocks with no tool call now emit both (previously only the first was read). The plan only specified lines with a tool call, but dropping the second narration block is the same defect.
- **Stale line numbers.** Call sites were two (`startSession` and the authoring session loop), not the three the plan names; both now call `emitStreamEvents`.

## Deviations from Plan

None - plan executed exactly as written, apart from the two interpretation notes above (a resolver parameter on the scheduler function, and the general multi-block rule).

## Verification run

- `cargo test -p core --test proc_timeout_boundary`: 3 passed.
- `cargo test -p core --test git_retry --test lock_contention --test crash_safety`: 31 + 2 + 6 passed.
- `grep -v '^[[:space:]]*//' packages/core/src/proc.rs | grep -c try_wait`: 1.
- `npm --prefix packages/sidecar run build`: clean. `node --test test/adapter.test.mjs` with `FLYWHEEL_RUNTIME_DIR` and `FLYWHEEL_HEARTBEAT_STALE_MS` set: 60 passed, 0 failed (55 before, 5 added). The diff to `adapter.test.mjs` only adds lines. `rate-limit-wire`, `stop`, `permission`, `ask-user-question` and `summary-report` also pass (38). The full sidecar suite was not run (it drives the real `claude` binary).
- `cargo test -p desktop`: 106 passed. `cargo build --workspace`: clean. No tick-constant lines in the scheduler diff.

## Known Stubs

None.

## Threat Flags

None.

## Self-Check: PASSED

`packages/core/tests/proc_timeout_boundary.rs` exists; commits `9c24512`, `5da53b3` and `53c60e9` resolve; every acceptance criterion in the plan was re-run and passes.
