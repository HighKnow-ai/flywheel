---
phase: 03-nothing-lost-nothing-left-running
plan: 06
subsystem: process-supervision
tags: [rust, sysinfo, tauri, launch-reconciliation, orphan-recovery]

# Dependency graph
requires:
  - phase: 03-02
    provides: "runtime_protocol.rs's on-disk KillRecord/RunDescriptor and read_kill_record/list_run_descriptors — this plan's classification reads both"
  - phase: 03-03
    provides: "AgentRunStatus::Abandoned and mark_abandoned's already-terminal guard (D-49) — this plan's reconciler relies on it entirely for idempotency"
provides:
  - "reconcile_agent_runs — the launch-time three-way classification (killed / dead-without-a-record / genuinely-alive) for every running/blocked agent_runs row"
  - "process_is_alive(pid, start_time) — pid-reuse-safe liveness via sysinfo, reconciling a real cross-language millisecond/second unit mismatch found while implementing this"
  - "kill_orphan / OrphanKillOutcome — the process-group kill verb, always recording abandoned regardless of whether the signal landed"
  - "AppState.pending_orphans + agent_runs_pending_orphans/orphan_kill Tauri commands + adapters/tauri.ts wrappers + usePendingOrphans hook — the render-facing half plan 03-10's modal drives"
affects: [03-10, 03-11, phase-3-verification]

actuals:
  tokens: 18910
  tasks: 3
  commits: 3
plan_head_before: 97b9229d34b0eb0be3a301cd05aa22fbfcb193a1

tech-stack:
  added:
    - "sysinfo 0.39.6 (exact-pinned, packages/core) — pid-reuse-safe process liveness, approved via this plan's Task 1 package-legitimacy checkpoint"
    - "libc 0.2 (packages/core) — process-group SIGKILL (kill_orphan), mirroring watchdog.ts's own negative-pid convention"
  patterns:
    - "Launch-time reconciliation surfaces, never repairs, never resumes — reconcile_agent_runs joins domain::project::reconcile_projects and domain::worktree::reconcile_worktrees as the third launch-time classifier following the same one-transaction-per-changed-row shape"
    - "A domain-layer outcome struct (OrphanKillOutcome) carries an honest killed:false rather than the Tauri layer inferring success from the absence of an error — mirrors AgentRunStopDto's own CR-04 shape"

key-files:
  created:
    - packages/core/tests/launch_reconciliation.rs
  modified:
    - packages/core/Cargo.toml
    - packages/core/src/runtime_protocol.rs
    - packages/core/src/domain/agent_run.rs
    - packages/desktop/src-tauri/src/main.rs
    - packages/desktop/src-tauri/src/state.rs
    - packages/desktop/src-tauri/src/commands/agent_run.rs
    - packages/desktop/src-tauri/capabilities/default.json
    - packages/desktop/src/adapters/tauri.ts
    - packages/desktop/src/board/useBoardQuery.ts

key-decisions:
  - "Task 1 package-legitimacy checkpoint APPROVED for sysinfo, pinned at exact version 0.39.6 (no caret, no range). Approval evidence: crates.io repository github.com/GuillaumeGomez/sysinfo, first published 2015-07-25, version 0.39.6 published 2026-07-09 (not yanked), 200,533,837 total downloads, MIT license; Process::start_time() and refresh_processes/ProcessesToUpdate confirmed present on the installed version. The hand-rolled per-platform fallback RESEARCH.md's Don't-Hand-Roll table names was explicitly declined."
  - "process_is_alive converts sysinfo's whole-SECONDS start_time() to MILLISECONDS before comparing against a recorded RunDescriptor/KillRecord start_time — found by reading both real on-disk writers (packages/sidecar/src/watchdog.ts's processStartTimeMs, claude-code-adapter.ts's readOsProcessStartTimeMs), which both write milliseconds. A literal same-unit comparison, as a strict reading of this plan's own <behavior> text implies, would have classified every genuinely live process as dead, defeating PROC-05 entirely. Documented as a Rule 1 auto-fix below."
  - "kill_orphan signals the process GROUP via libc::kill(-pid, SIGKILL) on Unix, mirroring watchdog.ts's own process.kill(-process.pid, \"SIGKILL\") force step; a no-op stub ships for non-Unix targets, reporting an honest killed:false rather than a signal it cannot send."
  - "orphan_kill (the Tauri command) checks pending_orphans membership BEFORE calling the domain kill_orphan, so a second kill for an already-resolved run_id returns a not-found error without re-signalling or writing a redundant abandoned record."
  - "orphan_kill's ~200ms post-signal wait is held across state.db.lock(), deliberately diverging from agent_run_stop's CR-01 discipline of resolving an external wait before locking the database — that discipline exists to protect against a sidecar's up-to-30s wait; kill_orphan's own bound is two orders of magnitude smaller, so the tradeoff of restructuring the already-tested domain kill_orphan signature was not worth taking."

requirements-completed: [PROC-05]

coverage:
  - id: D1
    description: "Every agent_runs row still running/blocked at launch is classified into exactly one of three outcomes: killed-by-its-watchdog, dead-without-a-kill-record, or genuinely-still-alive"
    requirement: "PROC-05"
    verification:
      - kind: integration
        ref: "packages/core/tests/launch_reconciliation.rs#a_running_row_with_a_kill_record_is_abandoned_with_the_recorded_reason_and_not_a_live_orphan"
        status: pass
      - kind: integration
        ref: "packages/core/tests/launch_reconciliation.rs#a_running_row_with_no_kill_record_and_a_live_process_stays_running_and_is_a_live_orphan"
        status: pass
      - kind: integration
        ref: "packages/core/tests/launch_reconciliation.rs#a_running_row_with_no_kill_record_and_a_dead_process_is_abandoned_with_no_reason"
        status: pass
      - kind: integration
        ref: "packages/core/tests/launch_reconciliation.rs#a_blocked_row_is_classified_by_the_same_three_way_rule_as_a_running_row"
        status: pass
    human_judgment: false
  - id: D2
    description: "A recycled pid is never mistaken for a live orphan; liveness is decided by pid AND recorded start time together"
    requirement: "PROC-05"
    verification:
      - kind: unit
        ref: "packages/core/tests/launch_reconciliation.rs#process_is_alive_returns_false_when_the_start_time_does_not_match_pid_reuse_safety"
        status: pass
      - kind: unit
        ref: "packages/core/tests/launch_reconciliation.rs#process_is_alive_returns_true_for_a_genuinely_live_process_with_the_correct_start_time"
        status: pass
    human_judgment: false
  - id: D3
    description: "Nothing is silently resumed — no code path in reconcile_agent_runs starts, resumes, or re-spawns a process, and a genuinely alive run is written to no status at all"
    requirement: "PROC-05"
    verification:
      - kind: unit
        ref: "packages/core/tests/launch_reconciliation.rs#no_resume_call_survives_in_reconcile_agent_runs"
        status: pass
      - kind: integration
        ref: "packages/core/tests/launch_reconciliation.rs#a_running_row_with_no_kill_record_and_a_live_process_stays_running_and_is_a_live_orphan (asserts status stays 'running')"
        status: pass
    human_judgment: false
  - id: D4
    description: "A run already at a real terminal status is never rewritten; a second reconciliation pass over unchanged state writes nothing and appends no event"
    requirement: "PROC-05"
    verification:
      - kind: integration
        ref: "packages/core/tests/launch_reconciliation.rs#an_already_terminal_row_is_never_rewritten_and_a_second_call_appends_no_event"
        status: pass
    human_judgment: false
  - id: D5
    description: "kill_orphan terminates the orphan's process group, always records abandoned, and honestly reports killed:false when the process survives the signal"
    requirement: "PROC-05"
    verification:
      - kind: integration
        ref: "packages/core/tests/launch_reconciliation.rs#kill_orphan_kills_a_genuinely_alive_process_and_records_abandoned"
        status: pass
      - kind: integration
        ref: "packages/core/tests/launch_reconciliation.rs#kill_orphan_still_records_abandoned_when_the_process_is_already_gone"
        status: pass
      - kind: unit
        ref: "packages/desktop/src-tauri/src/commands/agent_run.rs#retain_pending_orphan_unless_killed_removes_only_the_matching_row_on_success"
        status: pass
    human_judgment: false
  - id: D6
    description: "The renderer can read the pending-orphan list and kill one by agent_run_id only — never a renderer-supplied pid"
    requirement: "PROC-05"
    verification:
      - kind: other
        ref: "cargo build --workspace and npm --prefix packages/desktop run build (IPC seam typechecks end to end)"
        status: pass
    human_judgment: true
    rationale: "The full orphan-recovery modal UI is plan 03-10's own deliverable; this plan only proves the data/command seam compiles and behaves correctly at the domain/command layer. Visual/interactive confirmation of the modal itself belongs to 03-10's own UAT."

duration: 55min
completed: 2026-09-15
status: complete
---

# Phase 3 Plan 6: Launch-Time Orphan Classification Summary

**Every agent run left running or blocked by a crashed session is classified at launch into killed, dead, or genuinely alive — with a real cross-language millisecond/second unit bug fixed along the way, and a kill verb that never lies about whether the signal landed.**

## Performance

- **Duration:** 55 min
- **Started:** 2026-09-15T (continuation from an approved Task 1 checkpoint)
- **Completed:** 2026-09-15
- **Tasks:** 3
- **Files modified:** 11 (1 created, 10 modified)

## Accomplishments

- `sysinfo` crate approved and pinned at exact version `0.39.6` after independent re-verification against the live crates.io API (Task 1 checkpoint).
- `reconcile_agent_runs` (packages/core/src/domain/agent_run.rs) sorts every `running`/`blocked` agent run into killed-by-watchdog, dead-without-a-record, or genuinely-alive — the third case is written to no status at all and returned as a `LiveOrphan` for the user to decide.
- `process_is_alive` fixes a real cross-language unit mismatch: `packages/sidecar`'s watchdog and adapter both write `start_time` in epoch milliseconds, while `sysinfo::Process::start_time()` reports whole seconds. A literal same-unit comparison would have classified every genuinely live process as dead.
- `kill_orphan` signals the recorded process's whole process group and always writes `abandoned`, honestly reporting `killed: false` when the process survives the signal.
- The launch classification is now wired end to end: `main.rs`'s `setup()` runs it after `reconcile_worktrees` and before `spawn_sidecar`, stores the result on `AppState.pending_orphans`, and the desktop IPC seam (`agent_runs_pending_orphans`/`orphan_kill` commands, `adapters/tauri.ts` wrappers, `usePendingOrphans` hook) is ready for plan 03-10's recovery modal.

## Task Commits

Each task was committed atomically:

1. **Task 1: Package legitimacy gate for `sysinfo`** - `4f8f4cc` (chore) — checkpoint approved by the user; `cargo add sysinfo=0.39.6` performed and pinned.
2. **Task 2: Classify every in-flight run at launch** - `541bb3b` (feat) — `reconcile_agent_runs`, `process_is_alive`, `clear_run_runtime_files`, `kill_orphan`, and `packages/core/tests/launch_reconciliation.rs` (16 tests).
3. **Task 3: Carry the orphan list to the renderer, and give it a kill verb** - `1967f88` (feat) — `AppState.pending_orphans`, the two Tauri commands, capability roster update, `adapters/tauri.ts` wrappers, `usePendingOrphans` hook.

**Plan metadata:** (this commit)

## Files Created/Modified

- `packages/core/tests/launch_reconciliation.rs` - 16 tests covering all three classifications, pid-reuse safety, idempotency, the no-resume source gate, and both `kill_orphan` outcomes
- `packages/core/Cargo.toml` - pins `sysinfo = "=0.39.6"` and adds `libc = "0.2"`, both with explanatory comments
- `packages/core/src/runtime_protocol.rs` - `process_is_alive`, `clear_run_runtime_files`, `contention_dir` helper
- `packages/core/src/domain/agent_run.rs` - `LiveOrphan`, `reconcile_agent_runs`, `OrphanKillOutcome`, `kill_orphan`, `send_group_kill_signal`
- `packages/desktop/src-tauri/src/main.rs` - calls `reconcile_agent_runs` in `setup()`, registers the two new commands
- `packages/desktop/src-tauri/src/state.rs` - `AppState.pending_orphans`
- `packages/desktop/src-tauri/src/commands/agent_run.rs` - `PendingOrphanDto`, `agent_runs_pending_orphans`, `OrphanKillDto`, `orphan_kill`, `retain_pending_orphan_unless_killed`
- `packages/desktop/src-tauri/capabilities/default.json` - roster comment updated with both new commands
- `packages/desktop/src/adapters/tauri.ts` - `PendingOrphanDto`, `OrphanKillDto`, `pendingOrphans()`, `orphanKill()`
- `packages/desktop/src/board/useBoardQuery.ts` - `usePendingOrphans()`

## Decisions Made

See `key-decisions` in frontmatter for the full list. The load-bearing one: `process_is_alive` reconciles sysinfo's whole-seconds `start_time()` against the milliseconds both `watchdog.ts` and `claude-code-adapter.ts` actually write on disk — this was not called out anywhere in the plan's own text and would have silently broken PROC-05's entire purpose (every genuinely live orphan misclassified as dead) had it gone unnoticed.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 1 - Bug] Reconciled a cross-language start_time unit mismatch (milliseconds vs. seconds)**
- **Found during:** Task 2, while reading `packages/sidecar/src/watchdog.ts` and `claude-code-adapter.ts` per the task's own `<read_first>` instruction to confirm the real on-disk contract before writing `process_is_alive`.
- **Issue:** Both JS writers record `start_time` in epoch MILLISECONDS (`Date.now()` / `Date.parse(ps -o lstart=)`), but `sysinfo::Process::start_time()` (confirmed directly against the installed crate's own source and doc comment) returns whole SECONDS since the epoch. A literal implementation of the plan's `<behavior>` text ("returns true only when ... its reported start time equals the recorded one") would compare a seconds value against a milliseconds value and never match for any real process, classifying every genuinely alive orphan as dead-without-a-record.
- **Fix:** `process_is_alive` multiplies sysinfo's `start_time()` by 1000 before comparing, documented in the function's own doc comment with both writers named. Verified with a real spawned child process and a real read of its own start time (see `real_start_time_ms` in the test file, which computes the "ground truth" the same way production code does, then round-trips it through `process_is_alive`).
- **Files modified:** `packages/core/src/runtime_protocol.rs`
- **Verification:** `process_is_alive_returns_true_for_a_genuinely_live_process_with_the_correct_start_time` and `process_is_alive_returns_false_when_the_start_time_does_not_match_pid_reuse_safety`
- **Committed in:** `541bb3b` (Task 2 commit)

**2. [Rule 3 - Blocking] Added `.process_group(0)` to the test fixture's spawned child**
- **Found during:** Task 2's own `kill_orphan_kills_a_genuinely_alive_process_and_records_abandoned` test, which initially failed with `killed: false` against a real, live spawned process.
- **Issue:** A plain `Command::new("sleep").spawn()` child inherits the TEST BINARY's own process group rather than becoming its own group leader. `kill_orphan`'s `libc::kill(-pid, SIGKILL)` targets the group led by `pid` — which, without an explicit group change, is not the group the child actually belongs to — so the signal silently missed the process it was meant to kill.
- **Fix:** The test fixture's `spawn_long_lived_child` now calls `.process_group(0)` (`std::os::unix::process::CommandExt`), making the spawned child its own process-group leader — mirroring production's real shape, where `watchdog.ts` becomes its own group leader via Node's `detached: true`.
- **Files modified:** `packages/core/tests/launch_reconciliation.rs`
- **Verification:** Both `kill_orphan` tests pass with a real spawned process.
- **Committed in:** `541bb3b` (Task 2 commit)

---

**Total deviations:** 2 auto-fixed (1 bug, 1 blocking). **Impact:** Both were necessary for `process_is_alive`/`kill_orphan` to function correctly against real processes rather than only against synthetic test doubles; neither expands scope beyond what Task 2/3 already required.

## Issues Encountered

None beyond the two deviations documented above.

## User Setup Required

None - no external service configuration required.

## Next Phase Readiness

- `reconcile_agent_runs`, `process_is_alive`, `kill_orphan`, `AppState.pending_orphans`, and both Tauri commands are ready for plan 03-10's orphan-recovery modal to consume directly via `usePendingOrphans`/`orphanKill`.
- Plan 03-10 should invalidate the `pending-orphans` query key explicitly after each successful kill, per `usePendingOrphans`'s own doc comment (it is deliberately not wired to `subscribeBoardChanged`).
- No blockers. `cargo test --workspace` remains fully green (274+16 core tests, 322 desktop tests) after this plan's additions.

---
*Phase: 03-nothing-lost-nothing-left-running*
*Completed: 2026-09-15*

## Self-Check: PASSED

All key files verified present on disk (`packages/core/tests/launch_reconciliation.rs`, `Cargo.toml`, `runtime_protocol.rs`, `domain/agent_run.rs`, `main.rs`, `state.rs`, `commands/agent_run.rs`, `capabilities/default.json`, `adapters/tauri.ts`, `useBoardQuery.ts`). All three task commits (`4f8f4cc`, `541bb3b`, `1967f88`) verified present in `git log`. `cargo test -p core --test launch_reconciliation` (16/16 pass), `cargo test --workspace` (all green), `cargo build --workspace`, and `npm --prefix packages/desktop run build`/`npm test` (322/322 pass) all re-confirmed before this SUMMARY was written.
