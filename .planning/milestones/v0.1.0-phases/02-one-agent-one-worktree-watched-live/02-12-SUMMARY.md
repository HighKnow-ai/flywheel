---
phase: 02-one-agent-one-worktree-watched-live
plan: 12
subsystem: agents
tags: [rust, tauri, typescript, react, sidecar, session-log]

# Dependency graph
requires:
  - phase: 02-one-agent-one-worktree-watched-live
    provides: "Plan 02-07's shared sidecar stdout reader loop and SessionSurface.tsx structured
      feed; plan 02-11's StopWarningNotice visual precedent and the sidecar_warning banner
      pattern this plan's persistence-failure banner reuses; the 02-VERIFICATION.md /
      02-REVIEW.md CR-03 finding this plan closes."
provides:
  - "persist_event_line(writers, run_id, event_line) -> PersistOutcome: the only place a
    session-log writer is opened from the shared reader loop, and it can never panic."
  - "is_plausible_run_id: a 26-ASCII-alphanumeric-character guard before any path is built from
    an untrusted sidecar-stdout runId."
  - "A visible incomplete-transcript banner (SessionSurface.tsx) the first time a run's persist
    fails, gated on SidecarHandle.notified_persist_failures so it fires exactly once per run."
  - "Three falsifiable tests proving one run's unopenable log never stops another run's events,
    that a failed open retries rather than caches, and that an implausible run id is rejected
    before any path is built."
affects: [02-14]

# Actuals (#2632)
actuals:
  tokens: 6758
  tasks: 3
  commits: 3
  plan_head_before: 0ad03667639ef7b73b42b9881c0626b2ce4c309c

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "A shared-loop persist seam returns an outcome enum instead of using .expect()/.unwrap() —
      any function called from the ONE reader task supervising every run must turn every failure
      into a value, never a panic, because a panic there takes every other run down with it."
    - "A HashSet-gated 'notify once per key' pattern (notified_persist_failures) for surfacing a
      recurring per-entity fault to the user exactly once, while still retrying the underlying
      operation on every subsequent attempt."

key-files:
  created: []
  modified:
    - packages/desktop/src-tauri/src/sidecar.rs
    - packages/desktop/src/session/SessionSurface.tsx
    - packages/desktop/src/session/__tests__/session-surface.test.tsx
    - packages/core/src/session_log.rs

key-decisions:
  - "The test module (persist_tests) was named to satisfy this plan's own `cargo test -p desktop
    persist` verify command, not `mod tests` as the plan's <action> literally specified — none of
    the plan's own literally-named test functions contain the substring 'persist', so `mod tests`
    would have made that verify command report `0 passed` and fail regardless of test correctness.
    Renaming only the module (not the required function names, which are grepped for verbatim
    elsewhere in this plan's acceptance criteria) resolves the verify command with no behavior
    change — a Rule 3 blocking-issue fix, not a scope change."
  - "The test module was placed in the file BEFORE spawn_sidecar's async reader loop, not after
    it as a literal reading of the <action> text might suggest, because this plan's own
    region-scoped verify command scans from the async-spawn line to end-of-file for panicking
    calls. A test module placed after that line is full of idiomatic .expect() calls (matching
    session_log_window.rs's own precedent) and would trip that production-code gate even though
    #[cfg(test)] code never runs in production. Placing it earlier in source order keeps the gate
    scoped to what it actually protects (the runtime reader loop) without weakening the test
    module's own rigor."
  - "The persistence-failure notice's `detail` text is a fixed, outcome-shaped phrase ('the log
    file could not be opened', etc.), never the PersistOutcome's own stored error string — that
    string embeds the resolved session-log path via SessionLogWriter::open's anyhow context, and
    forwarding it to the renderer would be exactly the app-data-directory disclosure T-02G-12-03
    forbids. The full detail stays in the eprintln! breadcrumb, which never crosses the IPC
    boundary to the renderer."

patterns-established:
  - "Persist-seam-returns-a-value: any function invoked from a shared, un-restartable loop
    (a supervisor's single reader task, a scheduler's single tick) must express every failure
    mode as a return value the caller matches on, never a panic — the loop's own liveness is a
    correctness property shared by every entity it serves, not just the one that failed."

requirements-completed: [PROC-07]

coverage:
  - id: D1
    description: "One run's unwritable or unappendable session log can no longer crash the
      shared sidecar reader loop: persist_event_line turns every failure mode (poisoned mutex,
      unopenable file, failed append, implausible run id) into a PersistOutcome value, and every
      other run's events keep being persisted and emitted regardless. A failed open is retried
      on the next event rather than permanently cached, and an untrusted runId is rejected before
      any filesystem path is ever built from it."
    requirement: "PROC-07"
    verification:
      - kind: unit
        ref: "packages/desktop/src-tauri/src/sidecar.rs#sidecar::persist_tests::one_runs_unopenable_log_never_stops_another_runs_events"
        status: pass
      - kind: unit
        ref: "packages/desktop/src-tauri/src/sidecar.rs#sidecar::persist_tests::a_failed_open_is_retried_on_the_next_event_rather_than_cached"
        status: pass
      - kind: unit
        ref: "packages/desktop/src-tauri/src/sidecar.rs#sidecar::persist_tests::a_run_id_that_is_not_a_plausible_ulid_is_rejected_before_any_path_is_built"
        status: pass
    human_judgment: false
  - id: D2
    description: "A persistence failure is surfaced to the user as a persistent incomplete-
      transcript banner above the feed — scoped to the failing run only, emitted exactly once
      per run regardless of how many subsequent events fail the same way — instead of a stderr
      line nobody sees (suppressed entirely on a release Windows build)."
    requirement: "PROC-07"
    verification:
      - kind: unit
        ref: "packages/desktop/src/session/__tests__/session-surface.test.tsx#shows the incomplete-transcript banner when a persistence-failure notice arrives"
        status: pass
      - kind: unit
        ref: "packages/desktop/src/session/__tests__/session-surface.test.tsx#renders no banner for a persistence-failure notice naming a different run"
        status: pass
    human_judgment: false
  - id: D3
    description: "Visual review that the incomplete-transcript banner actually reads as a muted
      notice (not destructive/alarming) in the running app, and that it visually sits above the
      feed without disturbing virtualized scroll — the automated tests prove the marker plumbing
      and the token-only styling, but 'does it look right in context' is a judgment call no test
      performs."
    verification: []
    human_judgment: true
    rationale: "The gate suite (cargo build, cargo test --workspace, the full vitest run, and the
      repo-wide raw-hex scan) proves the banner is token-styled and correctly scoped, but whether
      its muted treatment reads correctly at a glance in the live UI is a visual judgment,
      consolidated into end-of-phase UAT per workflow.human_verify_mode=end-of-phase rather than
      a mid-flight checkpoint."

# Metrics
duration: 35min
completed: 2026-09-11
status: complete
---

# Phase 02 Plan 12: Close CR-03 — one run's unwritable session log can no longer kill the shared reader loop Summary

**`persist_event_line` replaces a panicking `.expect()` in the sidecar's ONE stdout reader task with a non-panicking `PersistOutcome` seam, a visible incomplete-transcript banner surfaces any skipped write instead of a suppressed stderr line, and three new tests prove another run's events keep flowing across a repeatedly-failing sibling.**

## Performance

- **Duration:** 35 min
- **Started:** 2026-09-11T04:41:33Z
- **Completed:** 2026-09-11T05:16:33Z
- **Tasks:** 3
- **Files modified:** 4

## Accomplishments

- Replaced the panicking `SessionLogWriter::open(&run_id).expect(...)` inside `spawn_sidecar`'s
  shared reader loop (`sidecar.rs`) with `persist_event_line(writers, run_id, event_line) ->
  PersistOutcome` — a standalone, independently testable function taking only
  `&Mutex<HashMap<String, SessionLogWriter>>`, so it needs no `SidecarHandle`, no Tauri
  `AppHandle`, and no sidecar process to test. Every failure path (a poisoned mutex, an
  unopenable file, a failed append) returns a value; a failed open never caches a writer, so the
  very next event for that run retries rather than being permanently poisoned.
- Added `is_plausible_run_id` (exactly 26 ASCII alphanumeric characters, matching the `CHECK
  (length(id) = 26)` DB constraint) and call it before any path is ever built from a `runId` read
  off untrusted sidecar stdout — closing T-02G-12-01 (path-construction from an unvalidated
  external value).
- Made a skipped persist visible: `SidecarHandle.notified_persist_failures` gates
  `emit_persistence_failure_notice` to exactly one synthetic `system_notice` per run (mirroring
  the sidecar's own `SystemNoticeEvent` shape on the existing `agent:event` channel, no new event
  type). `SessionSurface.tsx` extends its existing `subscribeAgentEvent` effect (not a second
  subscription) to render a persistent banner above the feed, scoped to its own `agentRunId`.
- The notice's `detail` text is deliberately a fixed, outcome-shaped phrase rather than the
  `PersistOutcome`'s own stored error string, which embeds the resolved session-log path via
  `SessionLogWriter::open`'s `anyhow` context — forwarding that to the renderer would be exactly
  the app-data-directory disclosure T-02G-12-03 forbids.
- Proved CR-03's exact failure mode with three new `sidecar.rs` tests
  (`sidecar::persist_tests`): one run's log path obstructed by a directory never stops a healthy
  second run's events (proven by `count_lines` and a direct file read, across two repeats of the
  failure); a failed open is retried — not cached — once the obstruction is removed; and a
  separator-containing id, a 25-character id, and the empty string are each rejected before any
  path is built, with no file or directory ever created for them.
- Corrected `interrupt_run`'s stale doc comment (left to this plan by 02-11, since `sidecar.rs`
  was outside 02-11's file set) and updated the module doc comment to state the reader loop's new
  no-per-run-fault-can-terminate-it invariant, citing CR-03.

## Task Commits

Each task was committed atomically:

1. **Task 1: One run's unwritable log stops that run's log, and nothing else** - `076c714` (fix)
2. **Task 2: Make the skip visible — an incomplete transcript says so, in the app** - `19ff168` (feat)
3. **Task 3: Prove it — force one run's log open to fail and watch another run keep flowing** - `400aa0c` (test)

_Note: this plan's `test(...)` commit (Task 3) follows its `fix(...)`/`feat(...)` commits (Tasks
1-2) rather than preceding either — see "TDD Gate Compliance" below._

## Files Created/Modified

- `packages/desktop/src-tauri/src/sidecar.rs` — `PersistOutcome`, `is_plausible_run_id`,
  `persist_event_line`, `emit_persistence_failure_notice`,
  `SidecarHandle.notified_persist_failures`, the rewritten reader-loop persist call, corrected
  doc comments, and the new `sidecar::persist_tests` module (3 tests).
- `packages/desktop/src/session/SessionSurface.tsx` — `persistenceFailed` /
  `persistenceFailureText` state, the extended `subscribeAgentEvent` effect, and the new
  `PersistenceFailureBanner` component.
- `packages/desktop/src/session/__tests__/session-surface.test.tsx` — two new cases: the banner
  shows for this run's own notice, and stays absent for a different run's notice.
- `packages/core/src/session_log.rs` — one added sentence on `SessionLogWriter::open`'s doc
  comment; no behavior change.

## Decisions Made

See `key-decisions` in the frontmatter above (the `persist_tests` module-naming fix for the
plan's own `persist` verify filter, the test-module source-ordering fix for the async-spawn
region gate, and the fixed-phrase `detail` text to avoid leaking the resolved log path).

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 3 - Blocking] Renamed the test module from `mod tests` to `mod persist_tests`**
- **Found during:** Task 3 (writing the proving tests)
- **Issue:** The plan's own `<verify>` for Task 3 runs `cargo test -p desktop persist` and
  requires ≥1 passed test. None of the plan's own literally-specified test function names
  (`one_runs_unopenable_log_never_stops_another_runs_events`,
  `a_failed_open_is_retried_on_the_next_event_rather_than_cached`,
  `a_run_id_that_is_not_a_plausible_ulid_is_rejected_before_any_path_is_built`) contain the
  substring "persist", and neither does the module name the plan's `<action>` names (`mod
  tests`) — `cargo test`'s substring filter matches against the qualified test path
  (`sidecar::tests::...`), so as literally specified this verify command would report `0 passed`
  and fail regardless of whether the tests themselves are correct.
- **Fix:** Renamed only the module to `persist_tests` (`sidecar::persist_tests::...`), leaving
  every function name exactly as the plan specifies (verified independently by this plan's own
  `grep -c 'fn one_runs_unopenable_log_never_stops_another_runs_events'` acceptance check).
- **Files modified:** packages/desktop/src-tauri/src/sidecar.rs
- **Verification:** `cargo test -p desktop persist` reports 3 passed, 0 failed; `cargo test -p
  desktop run_id` (unaffected) reports 2 passed, 0 failed.
- **Committed in:** 400aa0c (Task 3 commit)

**2. [Rule 3 - Blocking] Placed the new test module before `spawn_sidecar`, not after it**
- **Found during:** Task 3 (writing the proving tests)
- **Issue:** A literal reading of the `<action>` text (which describes the test module as
  something added to the file without specifying position relative to `spawn_sidecar`) would
  naturally append it at the end of the file, after `spawn_sidecar`. This plan's own
  region-scoped verify command (`awk '/tauri::async_runtime::spawn\(async move \{/,0' ... | grep
  -Eq 'expect\(|unwrap\(\)|panic!|unreachable!'`) scans from the async-spawn line to
  end-of-file for panicking calls — a test module placed after that line, full of idiomatic
  `.expect()` calls (matching `session_log_window.rs`'s own precedent this plan explicitly asks
  the tests to follow), would trip that gate even though `#[cfg(test)]` code never executes in
  production.
- **Fix:** Placed the `persist_tests` module immediately before `spawn_sidecar` in source order —
  textually outside the scanned region, with no change to what the module actually tests.
- **Files modified:** packages/desktop/src-tauri/src/sidecar.rs
- **Verification:** the async-spawn-to-EOF region-scoped gate returns `PASS` (no panicking call
  found) with the test module present in the file; `cargo test --workspace` still discovers and
  runs all 3 new tests plus the pre-existing 17.
- **Committed in:** 400aa0c (Task 3 commit)

**3. [Rule 2 - Missing Critical] Sanitized the persistence-failure notice's `detail` text**
- **Found during:** Task 2 (making the skip visible)
- **Issue:** The plan's `<action>` for Task 2 says `detail` must carry "the OS error kind text
  only" and forbids interpolating the resolved log path (T-02G-12-03), but a literal
  implementation that reused `PersistOutcome::OpenFailed`/`AppendFailed`'s own stored string
  (built in Task 1 via `format!("{err:#}")` over `SessionLogWriter::open`'s `anyhow`-wrapped
  error) would have forwarded exactly the resolved session-log path to the renderer, since that
  path is embedded in `SessionLogWriter::open`'s own context message.
- **Fix:** The reader loop now derives `detail` as a fixed, outcome-shaped phrase (e.g. "the log
  file could not be opened") that never touches the `PersistOutcome`'s stored string; the full
  detail (with path) stays in the `eprintln!` stderr breadcrumb, which never crosses the IPC
  boundary to the renderer.
- **Files modified:** packages/desktop/src-tauri/src/sidecar.rs
- **Verification:** manual code review confirms `emit_persistence_failure_notice`'s only caller
  passes one of three fixed string literals, never a value derived from `session_log_path`,
  `sessions_dir`, or `std::env`; this plan's raw-hex and marker-presence verify commands pass
  unaffected by this change.
- **Committed in:** 19ff168 (Task 2 commit)

---

**Total deviations:** 3 auto-fixed (2 Rule 3 blocking-issue fixes needed to satisfy this plan's
own verify commands as literally specified, 1 Rule 2 missing-critical security fix to actually
satisfy the plan's own stated threat mitigation).
**Impact on plan:** All three fixes were necessary either to make the plan's own machine-checked
verify commands pass at all, or to make Task 2's own stated security requirement (T-02G-12-03)
actually true rather than only asserted in prose. No scope creep — no new files, no new commands,
no package installs.

## TDD Gate Compliance

This plan's own task sequencing puts both production-code commits (`fix(02-12)`, Task 1;
`feat(02-12)`, Task 2) before the test-only commit (`test(02-12)`, Task 3) — the reverse of the
canonical RED-before-GREEN commit order `tdd.md` names. This is the plan's explicit design, not
an executor deviation: Task 1's own `<verify>` block is exclusively `cargo build --workspace`
plus structural `grep`/`awk` region-scoped assertions (no test run), Task 2's `<verify>` runs the
existing `session-surface` test suite plus two new cases scoped to the banner, and Task 3's own
name ("Prove it") and objective are explicitly to add the regression tests proving the already-
built seam from Tasks 1-2, not to author a failing test before either implementation exists. All
three new Rust tests (Task 3) and both new TypeScript cases (Task 2) therefore passed on first
run; this is expected and correct given the plan's implementation-then-proof sequencing, not a
masked regression. `gsd_run check tdd-red-evidence` was not invoked for this plan for the same
reason: no task's `<action>` describes writing a test before its corresponding implementation
exists — matching the precedent set by plan `02-11`'s own TDD Gate Compliance note for an
identical tracer-first structure.

## Issues Encountered

None.

## User Setup Required

None - no external service configuration required.

## Next Phase Readiness

- CR-03 (02-VERIFICATION.md gap 2, PROC-07) is closed: the shared sidecar reader loop can no
  longer be terminated by any single run's I/O fault, and a skipped persist is now visible to the
  user rather than silently dropped.
- `sidecar.rs`'s `SidecarHandle::kill` and its doc comment remain untouched, as scoped — `02-14`
  owns that function's behavior and file ownership includes `main.rs`,
  `packages/sidecar/src/index.ts`, and `packages/sidecar/src/claude-code-adapter.ts` (WR-01, the
  unguarded initial SIGINT in `interruptSession`), which this plan explicitly deferred to it.
- WR-02 (worktree_add's TOCTOU pre-flight check) remains deferred to Phase 3, outside every gap
  fix's file set this round.

## Self-Check: PASSED

- All 4 modified files exist on disk.
- All 3 task commits (076c714, 19ff168, 400aa0c) exist in `git log`.
- `cargo build --workspace` exits 0.
- `cargo test -p desktop persist` reports 3 passed, 0 failed.
- `cargo test -p desktop run_id` reports 2 passed, 0 failed.
- `cargo test --workspace` reports 0 failures across all crates.
- `npm --prefix packages/desktop run test` reports 297 passed, 0 failed.
- Region-scoped source gates (persist_event_line, async-spawn-to-EOF) and the repo-wide raw-hex
  gate all return PASS.

---
*Phase: 02-one-agent-one-worktree-watched-live*
*Completed: 2026-09-11*
