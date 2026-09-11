---
phase: 02-one-agent-one-worktree-watched-live
plan: 14
subsystem: agents
tags: [typescript, node-child-process, process-groups, rust, tauri, gap-closure]

# Dependency graph
requires:
  - phase: 02-one-agent-one-worktree-watched-live
    provides: "Plan 02-12's SidecarHandle shape (pending_acks, capability_probe's send/register/recv_timeout template, PersistOutcome/persist_event_line left untouched), and 02-02's interrupt-then-force process-group vocabulary this plan's shutdown op reuses."
provides:
  - "The sidecar `shutdown` op — tears down every live session's process group on request, on SIGTERM, and on stdin-EOF"
  - "SidecarHandle::shutdown_all_sessions — the Rust core's send-then-block-on-ack call, bounded by its own SHUTDOWN_ACK_TIMEOUT"
  - "main.rs's RunEvent::Exit arm now signals every live session BEFORE killing the sidecar, machine-verified by a source-order gate"
  - "WR-01 closed: interruptSession's initial SIGINT is guarded against the natural-exit race"
  - "SidecarHandle::kill's doc comment corrected — it no longer claims to reach child sessions"
affects: []

# Actuals (#2632)
actuals:
  tokens: 7952
  tasks: 3
  commits: 3
  plan_head_before: ab5b93b967d3bebe3debdc4e171adce869da81f1

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "Signal-all-then-wait via Promise.all over per-run Promise.race: async functions execute synchronously up to their own first `await`, so mapping killSession(runId) over every live run id (without awaiting each individually first) sends every process-group signal before any single grace timer resolves — never 'signal one, wait, signal next'."
    - "A two-tier ack-timeout ceiling for the same request/response mechanism (pending_acks + std::sync::mpsc): a long ceiling (INTERRUPT_ACK_TIMEOUT, 30s) for a user-initiated action that can tolerate waiting, and a short, dedicated ceiling (SHUTDOWN_ACK_TIMEOUT, 3s) for the same mechanism used during application exit, where the OS and the user both expect the app to go away promptly."
    - "Real-process test cleanup scoped to individually-verified pids (via a computed process-group id from `ps -o pgid=`) instead of a global `pkill -f <fixture path>` — the latter collides with a sibling test file exercising the SAME shared fixture concurrently under node's default multi-file test-runner parallelism."

key-files:
  created:
    - packages/sidecar/test/shutdown.test.mjs
    - packages/core/tests/app_exit_ordering.rs
  modified:
    - packages/sidecar/src/index.ts
    - packages/sidecar/src/claude-code-adapter.ts
    - packages/desktop/src-tauri/src/sidecar.rs
    - packages/desktop/src-tauri/src/main.rs

key-decisions:
  - "shutdownAllSessions relies on JS's own synchronous-until-first-await execution order (Array.prototype.map calling every async killSession(runId) in sequence before any of them yields) instead of an explicit two-phase 'collect promises, then signal' construction — simpler, and the ordering guarantee is the same the language already gives for free."
  - "SHUTDOWN_ACK_TIMEOUT is a dedicated 3s constant, not a reuse of the existing 30s INTERRUPT_ACK_TIMEOUT — this wait happens during application exit, where a 30s ceiling would make a wedged sidecar hold the whole app open for half a minute on quit."
  - "shutdown.test.mjs's safety net computes each grandchild's real process-group id via `ps -o pgid=` and signals that directly, rather than copying stop.test.mjs's own global `pkill -f <fake-claude path>` pattern — see Deviations."
  - "main.rs logs (never propagates) a shutdown_all_sessions failure with eprintln! before calling kill() unconditionally — an app-exit path must never be blockable by a wedged or crashed sidecar, so the failure is visible to a developer but structurally cannot skip the kill."

requirements-completed: [PROC-01, PROC-06]

coverage:
  - id: D1
    description: "A shutdown request with two live stubborn sessions tears down both process groups (including a grandchild only a group signal can reach), acking killed: 2"
    requirement: PROC-01
    verification:
      - kind: integration
        ref: "packages/sidecar/test/shutdown.test.mjs#a shutdown request tears down two stubborn sessions and both of their grandchildren"
        status: pass
    human_judgment: false
  - id: D2
    description: "A shutdown request against a sidecar with zero live sessions is a clean, prompt, successful no-op (killed: 0) — the PROC-01 empty edge"
    requirement: PROC-01
    verification:
      - kind: integration
        ref: "packages/sidecar/test/shutdown.test.mjs#a shutdown request against a sidecar with no live sessions acks ok with killed 0, promptly"
        status: pass
    human_judgment: false
  - id: D3
    description: "A second shutdown request immediately after the first is idempotent (killed: 0)"
    verification:
      - kind: integration
        ref: "packages/sidecar/test/shutdown.test.mjs#a second shutdown request immediately after the first is idempotent (killed 0)"
        status: pass
    human_judgment: false
  - id: D4
    description: "SIGTERM to the sidecar process (the fallback net, for anything that terminates it politely rather than sending the explicit shutdown request) tears down a stubborn session's grandchild before the sidecar itself exits"
    verification:
      - kind: integration
        ref: "packages/sidecar/test/shutdown.test.mjs#SIGTERM to the sidecar process tears down a stubborn session's grandchild"
        status: pass
    human_judgment: false
  - id: D5
    description: "The supervisor's RunEvent::Exit handler signals every live session's process group strictly BEFORE killing the sidecar's own process — the PROC-01 ordering edge — machine-verified against the real main.rs source, not asserted by a comment"
    requirement: PROC-01
    verification:
      - kind: integration
        ref: "packages/core/tests/app_exit_ordering.rs#run_event_exit_signals_sessions_before_killing_the_sidecar"
        status: pass
      - kind: integration
        ref: "packages/core/tests/app_exit_ordering.rs#a_reordered_fixture_trips_the_ordering_gate"
        status: pass
    human_judgment: false
  - id: D6
    description: "WR-01: interruptSession's initial process-group SIGINT no longer surfaces a spurious interrupt failure when the session exits naturally in the gap between the liveness check and the signal"
    verification:
      - kind: other
        ref: "grep-scoped structural gate: interruptSession's method body holds two guarded (try/catch) blocks, verified via awk region scan; full pre-existing stop.test.mjs suite (10 stop-path cases, including the exact already-exited and stubborn-escalation paths this guard sits next to) stays green"
        status: pass
    human_judgment: true
    rationale: "The exact race window this guard closes (the child process exiting between session.closedEventEmitted's check and process.kill's call) is a true race condition with no deterministic trigger — no test in this plan forces that narrow timing window. The guard is structurally proven present (two try/catch blocks in the method) and the full pre-existing interrupt test suite continues to pass unchanged, but the specific race itself is not force-provoked and observed failing-then-passing."
  - id: D7
    description: "App exit is never held open indefinitely on a wedged or non-responding sidecar: shutdown_all_sessions is bounded by SHUTDOWN_ACK_TIMEOUT (3s) and, whatever its outcome, kill() is unconditionally reached next"
    verification:
      - kind: other
        ref: "cargo build --workspace (SHUTDOWN_ACK_TIMEOUT compiles and is used); app_exit_ordering.rs's sidecar_rs_declares_a_bounded_shutdown_ack_timeout; main.rs's kill() call is unconditionally reachable (no ?, return, or continue between the shutdown call and it, confirmed by direct source reading)"
        status: pass
    human_judgment: true
    rationale: "The timeout ceiling and the unconditional-kill-reachability property are both structurally proven (a real constant, a real unconditional call site), but no test in this plan simulates an actual sidecar that never acks the shutdown request end-to-end through the real Rust SidecarHandle — that would require a fake/hung sidecar binary, which is out of this plan's scope. The equivalent JS-side promptness (killed: 0 for an empty shutdown resolving well under 1s) IS directly tested (D2)."
  - id: D8
    description: "SidecarHandle::kill's doc comment states what it actually does (signals only the sidecar's own process) instead of falsely claiming it reaches child sessions by extension, and points readers at shutdown_all_sessions"
    verification: []
    human_judgment: true
    rationale: "A doc-comment correctness claim has no automated assertion in this plan (no test parses doc comments) — verified by direct code review of the diff, confirming the old 'by extension' language is gone and the new comment names shutdown_all_sessions and cites CR-02."

duration: 25min
completed: 2026-09-11
status: complete
---

# Phase 2 Plan 14: Quitting Flywheel now signals every live session's process group before the sidecar dies Summary

**A new sidecar `shutdown` op (plus SIGTERM and stdin-EOF fallback nets) tears down every live `claude` session's process group; the Rust supervisor's `RunEvent::Exit` handler calls it BEFORE killing the sidecar, machine-verified by a source-order gate; and a real multi-process test proves two stubborn sessions' grandchildren are actually gone (`ESRCH`) after it runs.**

## Performance

- **Duration:** 25 min
- **Started:** 2026-09-11T05:02:38Z (approx, per STATE.md session continuity)
- **Completed:** 2026-09-11T05:18:11Z
- **Tasks:** 3/3 completed
- **Files modified:** 6 (4 modified, 2 created)

## Accomplishments

- **The sidecar can now be told to end every session it is driving**: `shutdownAllSessions()` snapshots live run ids, races each `killSession` call against a 2-second grace window per session, swallows per-run rejections so one unknown/already-dead session cannot abort the rest, and returns the count. Wired into a new `"shutdown"` request/ack (`{ killed: <count> }`), plus two independent fallback nets — a SIGTERM handler and a stdin-close (`rl.on("close")`) handler — both honestly documented as unable to help against a SIGKILL, which is exactly what the Rust side's `kill()` sends.
- **The Rust supervisor now reaches the sessions before it reaches the sidecar**: `SidecarHandle::shutdown_all_sessions` sends the request and blocks on the ack via the existing `pending_acks` mechanism (mirroring `capability_probe`'s own send/register/`recv_timeout` shape), bounded by a new, deliberately-short `SHUTDOWN_ACK_TIMEOUT` (3s, vs. the 30s `INTERRUPT_ACK_TIMEOUT`) since this wait happens during application exit. `main.rs`'s `RunEvent::Exit` arm now calls it first, logs (never propagates) a failure, and always proceeds to `kill()` regardless.
- **`kill()`'s doc comment no longer lies**: it used to claim killing the sidecar reaches every child session "by extension" — corrected to state plainly that it signals only the sidecar's own single process, and that reaching sessions is `shutdown_all_sessions`' job, which must run first.
- **WR-01 closed in the same pass**: `interruptSession`'s initial `process.kill(-pid, "SIGINT")` is now guarded in a `try`/`catch`, matching the SIGTERM escalation a few lines below it — a session that exits naturally in the race window between the liveness check and the signal no longer surfaces a spurious interrupt failure.
- **A real multi-process proof, not a mock**: `shutdown.test.mjs` spawns the actual `node dist/index.js` sidecar binary as a child process (the first test in this suite to drive the sidecar over its real stdin/stdout protocol rather than importing the adapter directly), spawns two stubborn sessions with real grandchildren via the existing `fake-claude.mjs` fixture, and asserts both grandchild pids are `ESRCH` after one `shutdown` request — plus the empty-shutdown, idempotent-shutdown, and SIGTERM-fallback-net cases. `app_exit_ordering.rs` is a source-scanning gate (in `supervisor_cwd.rs`'s own style) proving `main.rs` calls `shutdown_all_sessions` strictly before `.kill()`, falsified by a seeded reordered/missing/comment-only fixture.

## Task Commits

Each task was committed atomically. This plan carried `tdd="true"` on all three tasks, but — matching plan `02-12`'s own precedent in this same phase — Tasks 1 and 2's own `<verify>` blocks are exclusively build/structural (grep/awk) gates with no test run of their own; the actual falsifying tests are Task 3's explicit "prove it" deliverable, authored against the already-built implementation. See "TDD Gate Compliance" below.

1. **Task 1: The sidecar learns how to shut every session down** — `a434671` (feat)
2. **Task 2: The supervisor reaches the sessions before it kills the sidecar** — `ce425ff` (feat)
3. **Task 3: Prove it — a real sidecar, two stubborn sessions, two grandchildren, all gone** — `80cbe56` (test)

**Plan metadata:** (this commit)

## Files Created/Modified

- `packages/sidecar/src/index.ts` — `ShutdownRequest`, `SHUTDOWN_SESSION_GRACE_MS`, `shutdownAllSessions`, the `"shutdown"` case, and the SIGTERM + stdin-close fallback nets.
- `packages/sidecar/src/claude-code-adapter.ts` — WR-01's guard on `interruptSession`'s initial SIGINT.
- `packages/desktop/src-tauri/src/sidecar.rs` — `SHUTDOWN_ACK_TIMEOUT`, `SidecarHandle::shutdown_all_sessions`, and `kill()`'s corrected doc comment. `persist_event_line`/`PersistOutcome` and the reader loop (02-12's work) are byte-identical to what that plan left, confirmed by `git diff`.
- `packages/desktop/src-tauri/src/main.rs` — `RunEvent::Exit` now calls `shutdown_all_sessions()` before `kill()`.
- `packages/sidecar/test/shutdown.test.mjs` — new, the real-process proof.
- `packages/core/tests/app_exit_ordering.rs` — new, the source-order gate.

## Decisions Made

See `key-decisions` in the frontmatter above.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 1 - Bug] `main.rs`'s exit-handler `eprintln!` accidentally duplicated the literal `shutdown_all_sessions` string, tripping the plan's own exactly-once verify gate**
- **Found during:** Task 2, running the plan's own `<verify>` command `grep -v '^[[:space:]]*//' main.rs | grep -c 'shutdown_all_sessions'` immediately after the first implementation pass.
- **Issue:** The first draft's failure-log message was `eprintln!("shutdown_all_sessions failed during app exit: {err:#}")`, which put a second non-comment occurrence of the literal string into the string content of the `eprintln!` call itself (the real call site being the first occurrence) — the plan's own gate requires exactly one, to guarantee the exit handler references the shutdown call exactly once outside a comment.
- **Fix:** Reworded the log message to `"failed to signal live agent sessions during app exit: {err:#}"`, which conveys the same information without repeating the function's name.
- **Files modified:** `packages/desktop/src-tauri/src/main.rs`
- **Verification:** `grep -v '^[[:space:]]*//' main.rs | grep -c 'shutdown_all_sessions'` returns `1`; `cargo build --workspace` clean.
- **Committed in:** `ce425ff` (Task 2's own commit — caught before the commit was made, not a follow-up fix).

**2. [Rule 1 - Bug] The first draft of `shutdown.test.mjs`'s cleanup safety net collided with `stop.test.mjs`'s own concurrently-running stubborn-session test**
- **Found during:** Task 3, first full `npm --prefix packages/sidecar run test` run after `shutdown.test.mjs` passed on its own (`node --test packages/sidecar/test/shutdown.test.mjs`, 4/4 green in isolation).
- **Issue:** The plan's own `<action>` explicitly directs copying `stop.test.mjs`'s `after()` `pkill -f <fake-claude path>` safety net "for both the fake CLI and the grandchild's `setInterval` signature". Both test files exercise the SAME shared fixture (`fake-claude.mjs`), and Node's test runner runs multiple test files concurrently as separate worker processes by default. `shutdown.test.mjs`'s own tests finish in well under a second, so its `after()` hook fires — and its `pkill -f` matches ANY process running that fixture system-wide, not just this file's own — while `stop.test.mjs`'s much slower "interrupting a stubborn session escalates to a group SIGTERM" test (~5s) is still mid-flight in a sibling worker process. The result was a real, reproducible failure: that test's grandchild was killed by the sibling file's safety net before its own force-step assertion could observe it, failing with "Missing expected exception" on a run where nothing was actually wrong with the interrupt-then-force logic under test.
- **Fix:** Replaced the global `pkill -f` pattern match with a safety net scoped to pids THIS FILE's own tests individually discovered and tracked (`trackedGrandchildPids`), resolving each one's real process-GROUP id via `ps -o pgid=` before signalling it directly — this can never reach a process this file did not itself spawn and verify the pid of, regardless of what else is running concurrently on the machine.
- **Files modified:** `packages/sidecar/test/shutdown.test.mjs`
- **Verification:** `npm --prefix packages/sidecar run test` run 3 times in a row, 28/28 passing each time (was 27/28 with the collision reproduced once); `ps aux | grep fake-claude` confirmed clean after each run.
- **Committed in:** `80cbe56` (Task 3's own commit — the collision was found and fixed before this file was ever committed, so no separate fix commit exists).

---

**Total deviations:** 2 auto-fixed (both Rule 1 — bugs this task's own changes exposed, fixed and verified before proceeding, no scope creep).
**Impact on plan:** Both were necessary for the plan's own verify commands (grep exactly-once gate; `npm run test` terminating with 0 failures) to actually pass, not just appear to on a lucky run. No behavior change to the shipped shutdown mechanism itself — both fixes are to the exit-handler's log message text and to test-cleanup scoping, respectively.

## TDD Gate Compliance

This plan's task sequencing puts both production-code commits (`feat(02-14)`, Tasks 1-2) before the
test-only commit (`test(02-14)`, Task 3) — the reverse of the canonical RED-before-GREEN commit
order `tdd.md` names. This is the plan's own explicit design, not an executor deviation, and
follows the exact precedent set by this same phase's `02-12-SUMMARY.md`: Task 1's `<verify>` is
`npm --prefix packages/sidecar run build` plus structural grep/awk assertions (no test run); Task
2's `<verify>` is `cargo build --workspace` plus structural grep assertions and the pre-existing
`cargo test --workspace` suite; Task 3's own name ("Prove it") and its explicit objective are to
add the falsifying real-process tests proving the already-built Tasks 1-2 seam, not to author a
failing test before either implementation exists. All tests in `shutdown.test.mjs` and
`app_exit_ordering.rs` therefore passed on first run against the already-complete implementation —
expected and correct given this plan's implementation-then-proof sequencing, not a masked
regression. `gsd_run check tdd-red-evidence` was not invoked for the same reason: no task's
`<action>` describes writing a test before its corresponding implementation exists.

## Issues Encountered

None beyond the deviations documented above.

## User Setup Required

None — no external service configuration required.

## Next Phase Readiness

- `02-VERIFICATION.md` gap 4 (CR-02) is closed: `RunEvent::Exit` now sends the sidecar a
  kill-all-sessions instruction and waits a bounded moment for it to signal every live session's
  process group before killing the sidecar itself, and `shutdown.test.mjs` + `app_exit_ordering.rs`
  prove it against real processes and the real source, respectively. `kill()`'s false doc comment
  is corrected.
- WR-01 is closed in the same pass (`claude-code-adapter.ts`).
- This was the last plan in Phase 02's gap-closure round (all four `02-VERIFICATION.md` gaps —
  CR-02 here, CR-03 in `02-12`, CR-04/D-40 in `02-11`/`02-13` — are now closed). Phase 02 is ready
  for a fresh `/gsd-verify-work` / verification pass to confirm the round closed cleanly.
- Deferred, unchanged from `02-14-PLAN.md`'s own "Adjacent Open Items" section: WR-02
  (`worktree_add`'s TOCTOU pre-flight check) remains out of scope for this round, owned by Phase 3.
- T-02G-14-04 (accepted in the plan's own threat model): a session ended by app exit closes without
  a recorded terminal database write — `RunEvent::Exit` is past the point where a DB write can be
  reliably committed. Phase 3 ("Nothing Lost, Nothing Left Running") owns crash/exit-time run
  reconciliation, which is where that terminal write belongs.

---
*Phase: 02-one-agent-one-worktree-watched-live*
*Completed: 2026-09-11*

## Self-Check: PASSED

All 6 `files_modified` paths verified present on disk with `[ -f ]`. All 3 task commits
(`a434671`, `ce425ff`, `80cbe56`) verified present in `git log --oneline --all`. Every
acceptance criterion across Tasks 1-3 re-run and passing:
`npm --prefix packages/sidecar run build` (clean, no `error TS`); the four grep/awk structural
gates (`"shutdown"` count 2, `interruptSession` region holds 2 `try {` blocks, exactly one
`process.on("SIGTERM"`, exactly one `rl.on("close"`); `cargo build --workspace` (clean);
`grep -c 'pub fn shutdown_all_sessions'` = 1, `grep -c 'SHUTDOWN_ACK_TIMEOUT'` = 3;
`main.rs`'s non-comment `shutdown_all_sessions` reference count = 1; `node --test
packages/sidecar/test/shutdown.test.mjs` (4/4 pass); `npm --prefix packages/sidecar run test`
(28/28 pass, run 3x consecutively with no hang and no leaked processes — confirmed via
`ps aux | grep fake-claude`); `cargo test -p core --test app_exit_ordering` (3/3 pass);
`cargo test --workspace` (0 failures); `npm --prefix packages/desktop run test` (28 files,
297/297 pass, unaffected by this plan's Rust-only changes to `main.rs`/`sidecar.rs`); `git diff`
confirmed `packages/sidecar/src/adapter.ts` untouched (AGNT-01) and `sidecar.rs`'s reader loop /
`persist_event_line` byte-identical to what `02-12` left, apart from the new constant, the new
function, and the `kill()` doc comment.
