---
phase: 02-one-agent-one-worktree-watched-live
verified: 2026-09-11T13:55:00Z
status: human_needed
score: 3/6 truths verified (5 roadmap success criteria + 1 project-constraint truth; 0 failed, 3 present-behavior-unverified)
covered_files:
  - .planning/REQUIREMENTS.md
  - .planning/ROADMAP.md
  - .planning/WINDOWS.md
  - .planning/phases/02-one-agent-one-worktree-watched-live/02-01-PLAN.md
  - .planning/phases/02-one-agent-one-worktree-watched-live/02-01-SUMMARY.md
  - .planning/phases/02-one-agent-one-worktree-watched-live/02-02-PLAN.md
  - .planning/phases/02-one-agent-one-worktree-watched-live/02-02-SUMMARY.md
  - .planning/phases/02-one-agent-one-worktree-watched-live/02-03-PLAN.md
  - .planning/phases/02-one-agent-one-worktree-watched-live/02-03-SUMMARY.md
  - .planning/phases/02-one-agent-one-worktree-watched-live/02-04-PLAN.md
  - .planning/phases/02-one-agent-one-worktree-watched-live/02-04-SUMMARY.md
  - .planning/phases/02-one-agent-one-worktree-watched-live/02-05-PLAN.md
  - .planning/phases/02-one-agent-one-worktree-watched-live/02-05-SUMMARY.md
  - .planning/phases/02-one-agent-one-worktree-watched-live/02-06-PLAN.md
  - .planning/phases/02-one-agent-one-worktree-watched-live/02-06-SUMMARY.md
  - .planning/phases/02-one-agent-one-worktree-watched-live/02-07-PLAN.md
  - .planning/phases/02-one-agent-one-worktree-watched-live/02-07-SUMMARY.md
  - .planning/phases/02-one-agent-one-worktree-watched-live/02-08-PLAN.md
  - .planning/phases/02-one-agent-one-worktree-watched-live/02-08-SUMMARY.md
  - .planning/phases/02-one-agent-one-worktree-watched-live/02-09-PLAN.md
  - .planning/phases/02-one-agent-one-worktree-watched-live/02-09-SUMMARY.md
  - .planning/phases/02-one-agent-one-worktree-watched-live/02-10-PLAN.md
  - .planning/phases/02-one-agent-one-worktree-watched-live/02-10-SUMMARY.md
  - .planning/phases/02-one-agent-one-worktree-watched-live/02-11-PLAN.md
  - .planning/phases/02-one-agent-one-worktree-watched-live/02-11-SUMMARY.md
  - .planning/phases/02-one-agent-one-worktree-watched-live/02-12-PLAN.md
  - .planning/phases/02-one-agent-one-worktree-watched-live/02-12-SUMMARY.md
  - .planning/phases/02-one-agent-one-worktree-watched-live/02-13-PLAN.md
  - .planning/phases/02-one-agent-one-worktree-watched-live/02-13-SUMMARY.md
  - .planning/phases/02-one-agent-one-worktree-watched-live/02-14-PLAN.md
  - .planning/phases/02-one-agent-one-worktree-watched-live/02-14-SUMMARY.md
  - .planning/phases/02-one-agent-one-worktree-watched-live/02-CONTEXT.md
  - .planning/phases/02-one-agent-one-worktree-watched-live/02-DISCUSSION-LOG.md
  - .planning/phases/02-one-agent-one-worktree-watched-live/02-PATTERNS.md
  - .planning/phases/02-one-agent-one-worktree-watched-live/02-RESEARCH.md
  - .planning/phases/02-one-agent-one-worktree-watched-live/02-REVIEW-FIX.md
  - .planning/phases/02-one-agent-one-worktree-watched-live/02-REVIEW.md
  - .planning/phases/02-one-agent-one-worktree-watched-live/02-REVIEW.pre-gap-closure.md
  - .planning/phases/02-one-agent-one-worktree-watched-live/02-UI-SPEC.md
  - .planning/phases/02-one-agent-one-worktree-watched-live/02-VALIDATION.md
  - .planning/phases/02-one-agent-one-worktree-watched-live/02-VERIFICATION.pre-gap-closure.md
  - .planning/phases/02-one-agent-one-worktree-watched-live/COVERAGE.md
  - .planning/phases/02-one-agent-one-worktree-watched-live/deferred-items.md
  - packages/core/src/db/migrations/0003_agent_runtime.sql
  - packages/core/src/db/migrations/0004_permission_gate.sql
  - packages/core/src/domain/task.rs
  - packages/core/tests/agent_run_stop_ordering.rs
  - packages/core/tests/app_exit_ordering.rs
  - packages/core/tests/task_delete_with_run_history.rs
  - packages/desktop/src-tauri/src/commands/agent_run.rs
  - packages/desktop/src-tauri/src/main.rs
  - packages/desktop/src-tauri/src/sidecar.rs
  - packages/desktop/src/adapters/tauri.ts
  - packages/desktop/src/session/SessionSurface.tsx
  - packages/desktop/src/session/__tests__/session-surface.test.tsx
  - packages/sidecar/src/claude-code-adapter.ts
  - packages/sidecar/src/index.ts
  - packages/sidecar/test/shutdown.test.mjs
covered_digest: "v1:sha256:5f71a5c6e84bd0dd3a4caa254e31efaba9f9665402cdb0145d07b82d52ccad2e"
behavior_unverified: 3
overrides_applied: 0
re_verification:
  previous_status: gaps_found
  previous_score: "1/5 roadmap success criteria fully verified (2 failed, 2 human-verification-only)"
  gaps_closed:
    - "PROC-06 / CR-04: agent_run_stop's terminal write is now unconditional on the sidecar ack (stop_agent_run_recording_first captures the interrupt Result in a local rather than propagating it with `?`); proven by two new Rust tests that stop a run whose interrupt closure always returns Err and assert the run still reaches `interrupted`, exactly once."
    - "02-07-PLAN prohibition / CR-03: the shared sidecar stdout-reader loop no longer calls `SessionLogWriter::open(...).expect(...)`. `persist_event_line` returns a `PersistOutcome` value on every path (RejectedRunId/OpenFailed/AppendFailed/Written) and never unwinds; proven by three new `persist_tests` cases showing one run's permanently-unopenable log never stops another run's events, and a failed open retries rather than caching the failure."
    - "DATA-06 / CR-01 (task deletion regression): `delete_task` now counts rows in triggers/worktrees/agent_runs/permission_requests inside its own transaction and blocks with a human-readable `anyhow::bail!` before ever reaching `DELETE FROM tasks` (D-40: block, never cascade). Proven by `task_delete_with_run_history.rs`'s three tests: blocked-with-history, still-succeeds-with-no-history, and never-a-raw-SQLite-message."
    - "CLAUDE.md orphan-process constraint / CR-02: `RunEvent::Exit` now calls `SidecarHandle::shutdown_all_sessions()` (which asks the sidecar to signal every live session's process group and waits on a bounded ack) BEFORE `SidecarHandle::kill()`. Proven by `shutdown.test.mjs`, which drives the real compiled sidecar binary as a child process, spawns two real stubborn grandchildren, and proves via `process.kill(pid, 0)` throwing ESRCH that both are gone after a `shutdown` request — plus a SIGTERM-fallback case and an idempotent-second-call case. A source-scanning gate (`app_exit_ordering.rs`) makes the shutdown-before-kill ordering a compiler-adjacent regression gate, falsifiable against a reordered/missing/commented-out fixture."
  gaps_remaining: []
  regressions:
    - "A second-round code review (02-REVIEW.md, post-gap-closure) found that 02-11's CR-04 fix had introduced a new regression: `agent_run_stop` acquired `state.db.lock()` BEFORE the up-to-30-second-blocking `interrupt_run` call, so a wedged sidecar would freeze every other command in the app (board reads, task creation, every other run's interactions) behind one Stop click — worse than the original CR-04 bug in a different dimension. This was fixed in commit `e0f532c` (interrupt resolved into a local before the lock is acquired) and independently re-verified here by direct code read plus a new falsifiable source-scanning gate, `packages/core/tests/agent_run_stop_ordering.rs`, which passes. This regression was found and fixed entirely within the gap-closure round, before this verification ran — it is recorded here for the audit trail, not as an open issue."
gaps: []
deferred: []
behavior_unverified_items:
  - truth: "PROC-07: a user watches a long-running session live and application memory stays flat rather than growing with the transcript"
    test: "Start a long-running real session on a real task, leave it streaming for several minutes, and watch RSS in Activity Monitor while the transcript grows on disk."
    expected: "RSS stays flat while the persisted log on disk keeps growing; the renderer never holds more than a bounded window."
    why_human: "The windowed-read design (session_log.rs::read_window, LOG_WINDOW_MAX_LIMIT=100; SessionSurface.tsx's @tanstack/react-virtual usage) is present and structurally sound, and this round closed the confirmed silent-drop defect (CR-03) with real tests — but actual flat-RSS behavior over a long real session can only be observed by running the packaged app, per 02-VALIDATION.md's own Manual-Only Verifications table. Unchanged from the prior verification round."
  - truth: "AGNT-06: a permission request pauses the agent, the user answers it from the board, and the agent genuinely resumes (full path through a real claude process)"
    test: "Press Start Work on a task whose work needs a permission decision, confirm the board surfaces the request and the agent is genuinely blocked, answer it, and confirm the agent resumes rather than restarting."
    expected: "The real claude process blocks on the MCP tool call, the board renders the pending request, answering it resolves the held call, and the agent continues the same turn."
    why_human: "The DB/MCP-server halves (permission_gate.rs, mcp-permission-server.ts) are proven by real automated tests, but the end-to-end path crosses the renderer and a real spawned claude process — explicitly manual-only per 02-VALIDATION.md. Execution notes also record that Claude Code's own built-in bash safety heuristic was empirically found to bypass a configured --permission-prompt-tool for commands it judges read-only, even in --permission-mode default. No gap-closure plan touched this path; unchanged from the prior verification round."
  - truth: "AGNT-03/AGNT-04: the user can point Flywheel at local Claude Code credentials or an explicit API key with nothing else in the product behaving differently"
    test: "Run the same task once under local Claude Code credentials and once with an explicit API key configured in Settings; confirm nothing else in the product behaves differently, and confirm the key never appears in `ps` or the persisted session JSONL."
    expected: "Identical argv and event-kind/order between the two modes (already proven by packages/sidecar/test/credentials.test.mjs); the API key is present in the child's environment only."
    why_human: "The structural/code-level guarantees (argv parity, env-only injection, no credential-mode branching, single resolver) are proven by real spawned-child tests. What remains unverified is whether ANTHROPIC_API_KEY reliably overrides a present local subscription session in the real claude CLI — unmeasurable in this environment (no spend-authorized key) and logged as a Phase 3 input. Unchanged from the prior verification round."
  - truth: "Plan 02-02's own manual verification step: starting a real session, pressing Stop, and confirming from a bare terminal that the worktree is intact and no process survives under it"
    test: "Start a real session, press Stop, then from a bare terminal confirm the worktree directory and its uncommitted changes are intact and no claude (or descendant) process is still running."
    expected: "Worktree intact and dirty exactly as the agent left it; no orphaned process."
    why_human: "Logged as an open unrun-verify item in .planning/WINDOWS.md (row 3), deferred to end-of-phase UAT per workflow.human_verify_mode=end-of-phase. The underlying process-group-kill mechanism is now proven at two levels — packages/sidecar/test/stop.test.mjs (single-run interrupt) and this round's shutdown.test.mjs (app-exit path) — but the packaged-app path itself has still not been observed by a human. Still open in WINDOWS.md as of this verification."
  - truth: "Plan 02-10's own manual verification step: Settings surface reachable from menu/⌘,/palette, API key save-then-hide, and allow-always rule list/revoke from a real permission request"
    test: "Open Settings from the app menu, from ⌘,, and from the command palette; save an API key and confirm it cannot be read back; grant an allow-always rule from a real permission request and confirm it appears in the table with its project and can be revoked."
    expected: "All three entry points open the same Settings surface; the saved key is never re-rendered; the granted rule appears, attributable and revocable."
    why_human: "Logged as an open unrun-verify item in .planning/WINDOWS.md (row 7), deferred to end-of-phase UAT per workflow.human_verify_mode=end-of-phase. No gap-closure plan touched this surface; still open."
human_verification:
  - test: "Start a long-running real session on a real task, leave it streaming for several minutes, and watch RSS in Activity Monitor while the transcript grows on disk."
    expected: "RSS stays flat while the persisted log keeps growing on disk."
    why_human: "Real-process memory behavior over minutes cannot be observed by static analysis; explicitly manual-only per 02-VALIDATION.md. Unchanged from the prior round."
  - test: "Press Start Work on a task whose work needs a permission decision; confirm the board surfaces the request, the agent is genuinely blocked, and answering resumes the same turn rather than restarting it."
    expected: "The real claude process blocks on the MCP tool call and resumes correctly once answered."
    why_human: "Crosses the renderer and a real spawned claude process; also subject to the noted Claude Code bash-safety-heuristic caveat that may bypass the configured permission-prompt-tool for some commands. Unchanged from the prior round."
  - test: "Run the same task once under local Claude Code credentials and once with an explicit API key configured in Settings; confirm identical product behavior and that the key never appears in `ps` or the persisted JSONL."
    expected: "No behavioral difference between the two credential paths; the key is present only in the child's environment."
    why_human: "Requires two real credential configurations on one machine; whether ANTHROPIC_API_KEY reliably overrides a present subscription session could not be measured in this environment (no spend-authorized key) and is recorded as a Phase 3 input. Unchanged from the prior round."
  - test: "Start a real session, press Stop, and confirm from a bare terminal that the worktree is intact and no process survives under it."
    expected: "Worktree intact and dirty as left; no orphaned process."
    why_human: "Open unrun-verify item, .planning/WINDOWS.md row 3 — deferred to end-of-phase UAT. Still open."
  - test: "Open Settings from the app menu, ⌘,, and the command palette; save an API key and confirm it cannot be read back; grant and revoke an allow-always rule from a real permission request."
    expected: "All entry points open the same surface; key never re-rendered; rule appears and is revocable."
    why_human: "Open unrun-verify item, .planning/WINDOWS.md row 7 — deferred to end-of-phase UAT. Still open."
---

# Phase 2: One Agent, One Worktree, Watched Live — Verification Report (Re-Verification)

**Phase Goal:** Cyril presses Start Work on a board task and watches a Claude Code session do
that task inside a git worktree that belongs to the task rather than to the session.

**Verified:** 2026-09-11
**Status:** human_needed
**Re-verification:** Yes — after gap closure (plans 02-11..02-14) and a second code-review round
(02-REVIEW.md / 02-REVIEW-FIX.md)

**Mode note:** ROADMAP.md marks this phase `mode: mvp`, but its `**Goal:**` line is not in
`As a … I want to … so that …` user-story format. Plan 02-11 explicitly flagged this and declined
to invent a user-story enrichment. The prior (pre-gap-closure) verification used the standard
goal-backward methodology against the roadmap's five numbered Success Criteria rather than an MVP
User Flow Coverage table, and this re-verification continues that same methodology for
consistency and because the gap-closure plans themselves were scoped and evaluated against those
same five criteria.

## Goal Achievement

### Re-Verification Summary

All four `gaps_found` truths from the pre-gap-closure report (`02-VERIFICATION.pre-gap-closure.md`)
were independently re-tested against the code on disk — not trusted from `02-11`..`02-14`'s own
SUMMARY.md claims — and all four are closed with real, currently-passing tests:

| Gap (pre-gap-closure) | Closing plan | Verified how |
|---|---|---|
| PROC-06/CR-04: stop can strand a run `running`/`blocked` forever | 02-11 | Read `stop_agent_run_recording_first` — interrupt result is captured in a local, never applied with `?`; ran `cargo test -p desktop stop_` → 2 passed |
| 02-07-PLAN prohibition/CR-03: one run's log-open panic silences every run's feed | 02-12 | Read `persist_event_line` — returns `PersistOutcome`, no `.expect()`/`.unwrap()` in the shared reader loop before its test module; ran `cargo test -p desktop persist_tests` → 3 passed |
| DATA-06/CR-01: task deletion breaks once agent-run history exists | 02-13 | Read `delete_task`'s D-40 block-never-cascade guard; ran `cargo test --workspace --test task_delete_with_run_history` → 3 passed against real git repos and real `start_agent_run` |
| CLAUDE.md orphan constraint/CR-02: quitting the app orphans live `claude` processes | 02-14 | Read `RunEvent::Exit` → `shutdown_all_sessions()` before `kill()`; ran `packages/sidecar/test/shutdown.test.mjs` → 4 passed against real spawned grandchild processes, proven gone via `process.kill(pid,0)` throwing ESRCH |

A second code-review round (`02-REVIEW.md`) then found that 02-11's own fix had introduced a new
regression — `agent_run_stop` acquired the app's single `Mutex<Connection>` before the up-to-30s
`interrupt_run` call, freezing every other command behind one Stop against a wedged sidecar. This
was fixed in commit `e0f532c`, independently re-verified here: `agent_run_stop`'s body now resolves
`interrupt_result` from `state.sidecar.as_ref()` **before** calling `state.db.lock()`, and a new
falsifiable source-scanning test, `packages/core/tests/agent_run_stop_ordering.rs`, makes this
ordering a permanent regression gate (`cargo test --workspace --test agent_run_stop_ordering` → 2
passed, including a fixture proving the gate actually detects a reordered violation). The
accompanying wording Warning (WR-01 in that review) was also fixed in `f1743a1` and verified: the
blocking-deletion message now names whichever of trigger/worktree/agent_run/permission_request
count is actually nonzero, rather than always naming `agent_run_count`.

**No new gaps were found in this re-verification.** The five human-verification items from the
prior report are carried forward unchanged — none of the gap-closure plans attempted to automate
them, per the prior report's own routing to `workflow.human_verify_mode: end-of-phase`.

### Observable Truths (Roadmap Success Criteria)

| # | Truth | Status | Evidence |
|---|-------|--------|----------|
| 1 | Worktree appears on a branch derived from the task identifier, chained to the epic integration branch, visible from a bare terminal | ✓ VERIFIED | Unaffected by the gap-closure round. Re-ran `cargo test --workspace --test branch_naming --test worktree_lifecycle` — both pass (real scratch git repos, real `git worktree list`). |
| 2 | User watches the agent's output stream live for a long session with flat memory | ⚠️ PRESENT_BEHAVIOR_UNVERIFIED (upgraded from ✗ FAILED) | The confirmed defect that made this FAILED before (CR-03: a single run's log-open panic silently halting every run's feed) is now closed — `persist_event_line` never panics and 3 new tests prove one run's permanently-unopenable log never stops another run's events. The remaining half of this truth — RSS staying flat over a real long-running session — was never automatable and remains routed to human verification, unchanged from the prior round. |
| 3 | Agent pauses on a permission request, user answers from the board, agent resumes | ⚠️ PRESENT_BEHAVIOR_UNVERIFIED (unchanged) | No gap-closure plan touched this path. `permission_gate.rs`'s DB/MCP-layer tests still pass; the full path through a real spawned `claude` process remains explicitly manual-only per 02-VALIDATION.md. |
| 4 | User stops a session, worktree stays intact/inspectable, and a second session reuses it — the worktree outlives the session | ✓ VERIFIED (upgraded from ✗ FAILED) | The confirmed defect (CR-04: stop could strand a run `running`/`blocked` forever if the sidecar never acked) is closed and proven: `stop_records_interrupted_even_when_the_sidecar_never_acks` and `stop_twice_with_a_dead_sidecar_appends_exactly_one_interrupted_event` both pass, plus the pre-existing `stop_lifecycle.rs`/`worktree_lifecycle.rs`/`stop.test.mjs` real-process suites still pass unmodified. The lock-ordering regression the second review round found is also fixed and gated (`agent_run_stop_ordering.rs`). A narrower manual confirmation (WINDOWS.md row 3: a bare-terminal walkthrough in the packaged app) remains open and is carried into Human Verification below — it does not gate this truth's own status, since the specific mechanism it would confirm is already proven by the real-process test suites cited above. |
| 5 | Worktree, agent run and session are distinct linked records on the task; local-credential and API-key paths behave identically | ⚠️ PRESENT_BEHAVIOR_UNVERIFIED (upgraded — one confirmed defect closed) | The "distinct linked records" half remains solidly VERIFIED, and its previously-unguarded edge case (CR-01: deleting a task with agent-run history) is now closed — `task_delete_with_run_history.rs`'s 3 tests pass, proving the block-with-a-sentence (D-40) outcome, the still-succeeds-with-no-history outcome, and that no raw SQLite constraint message ever reaches the caller. The credential-parity half is unchanged: `credentials.test.mjs`'s argv/env/event-parity tests still pass, but whether `ANTHROPIC_API_KEY` reliably overrides a present local subscription session in the real CLI remains unmeasurable in this environment and is routed to human verification. |

**Score:** 2/5 roadmap success criteria fully verified without qualification (up from 1/5); 0
failed (down from 2); 3 have solid, now-strengthened automated evidence for their structural/
mechanical half but still require human observation for their full real-process claim (down from
"2 failed + 2 human-only" to "0 failed + 3 human-only", since SC2's and SC5's previously-failing
halves are now closed).

### Additional Project-Constraint Truth (not one of the 5 numbered Success Criteria)

| # | Truth | Status | Evidence |
|---|-------|--------|----------|
| 6 | CLAUDE.md hard architectural constraint: "killing orphans... at the OS-process-tree level" — no `claude` process should survive Flywheel quitting | ✓ VERIFIED (upgraded from ✗ FAILED) | `RunEvent::Exit` now calls `SidecarHandle::shutdown_all_sessions()` before `SidecarHandle::kill()` (`main.rs:147-155`), confirmed by direct read. `shutdown_all_sessions` sends a `shutdown` op to the sidecar and blocks on a bounded ack (`SHUTDOWN_ACK_TIMEOUT`); the sidecar's handler (`index.ts` `case "shutdown"`) calls `shutdownAllSessions()`, which races each live session's `killSession` (process-group SIGINT→SIGTERM→SIGKILL escalation) against a grace timer via `Promise.all`. `shutdown.test.mjs` drives the real compiled sidecar binary, spawns two real stubborn grandchildren, and proves via `process.kill(pid, 0)` throwing `ESRCH` that both are gone after one `shutdown` request — plus a SIGTERM-fallback-net case, an empty-sessions promptly-ok case, and an idempotent-second-call case. All 4 pass. A falsifiable source-scanning gate (`app_exit_ordering.rs`, 3 tests, all pass) makes the shutdown-before-kill ordering a permanent regression gate. |

**Combined score (6 truths):** 3/6 fully verified (SC1, SC4, and the CLAUDE.md constraint truth);
3/6 present-behavior-unverified (SC2, SC3, SC5); 0/6 failed.

### Required Artifacts

| Artifact | Expected | Status | Details |
|----------|----------|--------|---------|
| `packages/desktop/src-tauri/src/commands/agent_run.rs` | `AgentRunStopDto`, `stop_agent_run_recording_first`, `agent_run_stop` (CR-04 fix + CR-01/second-review fix) | ✓ VERIFIED | Read directly (lines 246-341): interrupt result captured in a local, unconditional `interrupt_agent_run` call, status read back via `SELECT`, and the interrupt is resolved before `state.db.lock()`. `cargo test -p desktop stop_` → 2 passed; `agent_run_stop_ordering.rs` → 2 passed. |
| `packages/desktop/src-tauri/src/sidecar.rs` | `persist_event_line`, `PersistOutcome`, `emit_persistence_failure_notice` (CR-03 fix) | ✓ VERIFIED | Read directly (lines 308-420): no `.expect()`/`.unwrap()` anywhere in the shared reader loop or persist path; `persist_tests` module (3 tests) passes, proving one run's unopenable log never stops another run's events and a failed open retries rather than being cached. |
| `packages/core/src/domain/task.rs` | `delete_task` with D-40 block-never-cascade semantics (CR-01 fix) | ✓ VERIFIED | Read directly (lines 210-296): four bound `COUNT(*)` probes inside the transaction, `anyhow::bail!` naming whichever count is nonzero (post-WR-01-fix wording), before ever reaching `DELETE FROM tasks`. `task_delete_with_run_history.rs` (3 tests) passes. |
| `packages/desktop/src-tauri/src/main.rs` | `RunEvent::Exit` calling `shutdown_all_sessions()` before `kill()` (CR-02 fix) | ✓ VERIFIED | Read directly (lines 147-156). `app_exit_ordering.rs` (3 tests) passes, including a falsifiable-reordering self-test. |
| `packages/sidecar/src/index.ts` | `shutdown` op handler, `shutdownAllSessions()`, SIGTERM/stdin-close fallback nets | ✓ VERIFIED | Read directly (lines 47-241); `shutdown.test.mjs` (4 tests) passes against the real compiled binary. |
| `packages/sidecar/src/claude-code-adapter.ts` | `interruptSession`'s SIGINT now guarded (WR-01, folded into 02-14) | ✓ VERIFIED | Read directly (lines 382-401): the initial `process.kill(-pid, "SIGINT")` is now wrapped in `try {...} catch {...}`, matching the SIGTERM escalation's existing guard. |
| `packages/core/tests/agent_run_stop_ordering.rs` | New falsifiable source-scanning regression gate (second-review fix) | ✓ VERIFIED | Read in full; 2 tests pass, including a deliberately-reordered fixture proving the gate is falsifiable, not just structurally present. |
| `.planning/phases/02-one-agent-one-worktree-watched-live/deferred-items.md` | First item corrected from `open` to `resolved` (02-11 Task 3) | ✓ VERIFIED | Read directly; the `ItemDetailPanel.tsx` hex-literal no longer exists at HEAD (now `var(--text-primary-rack)`), and the repo-wide raw-hex gate returns `0`. |

All artifacts from the original 10 plans (`02-01`..`02-10`) that were previously VERIFIED remain
unchanged in this round; not re-audited here beyond the regression checks embedded in the full
test-suite runs below.

### Key Link Verification

| From | To | Via | Status | Details |
|------|----|----|--------|---------|
| `commands/agent_run.rs` (`agent_run_stop`) | `domain/agent_run.rs` (`interrupt_agent_run`) | Unconditional call, interrupt result captured in a local | ✓ WIRED | Confirmed by direct read: no `?` or early return on the interrupt closure's result. |
| `commands/agent_run.rs` (`agent_run_stop`) | `state.db` (`Mutex<Connection>`) | Lock acquired AFTER the interrupt call resolves | ✓ WIRED (regression fixed) | Confirmed by direct read and by `agent_run_stop_ordering.rs`'s passing source-scanning gate. |
| `sidecar.rs` (shared reader loop) | `persist_event_line` | Every stdout event line routes through it; no panic path | ✓ WIRED | Confirmed by direct read; loop continues (`while let Some(event) = rx.recv().await`) regardless of `PersistOutcome`. |
| `domain/task.rs` (`delete_task`) | `triggers`/`worktrees`/`agent_runs`/`permission_requests` | Bound `COUNT(*)` probes before `DELETE FROM tasks` | ✓ WIRED | Confirmed by direct read and passing tests. |
| `main.rs` (`RunEvent::Exit`) | `sidecar.rs` (`shutdown_all_sessions`, then `kill()`) | Sequential, shutdown before kill | ✓ WIRED | Confirmed by direct read and `app_exit_ordering.rs`'s passing gate. |
| `sidecar.rs` (`shutdown_all_sessions`) | `packages/sidecar/src/index.ts` (`op: "shutdown"`) | Sidecar stdio request/ack protocol | ✓ WIRED | Confirmed by direct read of both sides; `shutdown.test.mjs` proves it end-to-end against the real compiled binary. |
| `index.ts` (`shutdownAllSessions`) | `claude-code-adapter.ts` (`killSession`) | Process-group signal escalation, raced against a grace timer | ✓ WIRED | Confirmed by direct read; `shutdown.test.mjs` proves real grandchild processes are gone afterward. |

### Requirements Coverage

| Requirement | Description | Status | Evidence |
|---|---|---|---|
| DATA-04 | Generic trigger record, `user_action` implemented, `schedule`/`webhook` schema-only | ✓ SATISFIED | Unchanged; `02-01`'s edge-probe tests still pass. |
| DATA-06 | Worktrees/runs/sessions/summaries/artifacts as first-class records | ✓ SATISFIED (upgraded from ⚠️ SATISFIED WITH GAP) | CR-01 closed — `delete_task` no longer breaks once a task has agent-run history; D-40's block-never-cascade decision is implemented and tested. |
| WORK-01 | Start Work creates a dedicated worktree | ✓ SATISFIED | Unchanged. |
| WORK-02 | Fixed branch topology (task → epic-integration → trunk) | ✓ SATISFIED | Unchanged. |
| WORK-08 | Worktree persists across many sessions, removed only on explicit action | ✓ SATISFIED | Unchanged. |
| LINK-01 | Branch name derives from task identifier, recognisable from CLI | ✓ SATISFIED | Unchanged. |
| PROC-01 | Each session is a separate OS process in its own worktree | ✓ SATISFIED | Unchanged, and its app-exit-cleanup boundary is now also closed (CR-02, mapped to the additional constraint truth #6 above). |
| PROC-02 | Supervisor never reads its own cwd; explicit absolute paths only | ✓ SATISFIED | Unchanged. |
| PROC-06 | User can interrupt/stop at any time, worktree left consistent | ✓ SATISFIED (upgraded from ✗ BLOCKED) | CR-04 closed and gated against regression by `agent_run_stop_ordering.rs`. |
| PROC-07 | Live streaming without unbounded memory growth | ⚠️ SATISFIED WITH HUMAN ITEM (upgraded from ✗ BLOCKED) | CR-03's silent-drop defect closed with real tests; the flat-memory runtime claim itself remains human-verification-only, unchanged. |
| AGNT-01 | Single adapter interface, no backend branching | ✓ SATISFIED | Unchanged. |
| AGNT-02 | Claude Code adapter normalises stream-json | ✓ SATISFIED | Unchanged. |
| AGNT-03 | Local Claude Code credentials, never leaving the machine | ⚠️ NEEDS HUMAN | Unchanged — code-level guarantee proven; real end-to-end parity not exercised here. |
| AGNT-04 | Explicit API-key path as first-class alternative | ⚠️ NEEDS HUMAN | Unchanged — structural/behavioral tests pass; override reliability unmeasurable here. |
| AGNT-06 | Permission requests block the agent until answered | ⚠️ NEEDS HUMAN (DB/MCP half SATISFIED) | Unchanged. |

No orphaned requirements — all 15 IDs mapped to this phase in REQUIREMENTS.md are declared in at
least one plan's frontmatter (`02-01` through `02-14`).

**Advisory (documentation hygiene, not a code gap):** `.planning/REQUIREMENTS.md`'s "By
Requirement" status table (lines ~217-271) currently shows DATA-04, WORK-01, WORK-02, WORK-08,
LINK-01, PROC-02, AGNT-01, AGNT-02, AGNT-03, AGNT-04 and AGNT-06 as `Gaps Found`, while DATA-06,
PROC-01, PROC-06 and PROC-07 show `Complete` — the inverse of what this and the pre-gap-closure
verification actually found (those four were the ones with confirmed defects; the others were
already satisfied). This table appears to reflect an in-progress reconciliation (see commit
`d52e9e7`, "revert premature Complete requirements after gaps found") rather than the current,
code-verified state, and should be reconciled by the orchestrator once this report's findings are
accepted — it is not evidence of an actual regression in those ten requirements, all of which were
independently re-confirmed satisfied in this pass (see table above).

### Anti-Patterns Found

| File | Line | Pattern | Severity | Impact |
|---|---|---|---|---|
| `.planning/WINDOWS.md` | row 4 | Ledger still marks the `ItemDetailPanel.tsx:219` hex-literal item `open`, though `deferred-items.md` and the code itself confirm it was corrected in plan 02-11 Task 3 (verified above) | ℹ️ Info | Doc-hygiene only — the underlying code issue is genuinely resolved (repo-wide raw-hex gate returns `0`); the cross-phase ledger simply was not updated to reflect the 02-11 correction. Recommend flipping row 4 to `fixed`. |
| `.planning/WINDOWS.md` | row 2 | Pre-existing, unrelated `FLYWHEEL_WORKTREE_ROOT` test-isolation race in `worktree_lifecycle.rs`, open since plan 02-01 | ℹ️ Info | Not part of any of the four gaps closed this round; carried forward unchanged, out of scope for this re-verification. |
| `.planning/WINDOWS.md` | row 6 | Pre-existing `WorktreeSummary.tsx` "missing from disk" clause deferred to Phase 3 | ℹ️ Info | Not part of this round's scope; explicitly deferred to Phase 3 (WORK-06) per its own record. |

No debt markers (`TBD`/`FIXME`/`XXX`/`TODO`/`HACK`/`PLACEHOLDER`) found in any of the files touched
by plans `02-11`..`02-14` or the two review-fix commits (`agent_run.rs`, `sidecar.rs`, `main.rs`,
`task.rs`, `tauri.ts`, `SessionSurface.tsx`, `index.ts`, `claude-code-adapter.ts`). No new stub
patterns (empty handlers, `return null`/`{}`/`[]` on a rendered path, hardcoded-empty props) found
in the gap-closure diff.

### Behavioral Spot-Checks

| Behavior | Command | Result | Status |
|---|---|---|---|
| Full Rust workspace suite | `cargo build --workspace` then `cargo test --workspace` | Build exits 0; every test binary reports `test result: ok`, 0 failed, across all Rust suites (branch/worktree/permission/credentials/task-delete/app-exit/stop-ordering/etc.) | ✓ PASS |
| Full desktop (TS/React) suite | `npm --prefix packages/desktop test` | 28 test files, 297 tests, all passed | ✓ PASS |
| Full sidecar (Node) suite | `npm --prefix packages/sidecar test` | 28 tests, all passed (0 fail) — includes `shutdown.test.mjs`'s 4 real-process cases | ✓ PASS |
| CR-04 fix, isolated | `cargo test -p desktop stop_` | 2 passed — a dead-sidecar closure still reaches `interrupted`, exactly once on a repeat call | ✓ PASS |
| CR-03 fix, isolated | `cargo test -p desktop persist_tests` | 3 passed — one run's unopenable log never stops another run's events; a failed open retries, not caches | ✓ PASS |
| CR-01 fix, isolated | `cargo test --workspace --test task_delete_with_run_history` | 3 passed — blocked-with-history, succeeds-with-no-history, never-a-raw-SQLite-message | ✓ PASS |
| CR-02 fix, isolated | `node --test packages/sidecar/test/shutdown.test.mjs` | 4 passed — real grandchild processes proven gone via `process.kill(pid,0)` throwing ESRCH after a `shutdown` op, plus SIGTERM/empty/idempotent cases | ✓ PASS |
| Second-review lock-ordering fix | `cargo test --workspace --test agent_run_stop_ordering` | 2 passed — the interrupt call precedes `.lock()` in the real source, and the gate is falsifiable against a reordered fixture | ✓ PASS |
| Second-review app-exit ordering gate | `cargo test --workspace --test app_exit_ordering` | 3 passed | ✓ PASS |
| Raw-hex token gate (repo-wide) | `grep -rlE '#[0-9a-fA-F]{6}' packages/desktop/src \| grep -vcE '...'` | `0` | ✓ PASS |

### Probe Execution

No `scripts/*/tests/probe-*.sh` conventions or phase-declared probes found for this phase. Skipped.

### Human Verification Required

See `human_verification` in frontmatter — 5 items, all carried forward unchanged from the
pre-gap-closure report because none of the gap-closure plans attempted to automate them (by design,
per `workflow.human_verify_mode: end-of-phase`):

1. Flat-memory long-session observation (PROC-07) — the silent-drop code defect is now closed, but
   the RSS-stays-flat claim itself remains an unavoidable manual observation.
2. Full permission-gate pause/resume through a real `claude` process (AGNT-06), with the noted
   Claude Code bash-safety-heuristic caveat.
3. Local-vs-API-key real-world parity including `ANTHROPIC_API_KEY` override reliability
   (AGNT-03/04, unmeasurable in this environment).
4. Plan 02-02's own deferred bare-terminal stop verification (WINDOWS.md row 3) — still open.
5. Plan 02-10's own deferred Settings walkthrough (WINDOWS.md row 7) — still open.

### Gaps Summary

**No gaps remain from this re-verification.** All four confirmed defects from the pre-gap-closure
report (CR-01 task-deletion regression, CR-02 orphaned processes on app exit, CR-03 shared-reader
panic silencing every run's feed, CR-04 stop stranding a run in a stuck state) were independently
re-tested against the code on disk — not trusted from any plan's SUMMARY.md — and all four are
closed with real, currently-passing behavioral tests, several of which exercise real spawned OS
processes (`shutdown.test.mjs`'s grandchild-teardown proof) or real git repositories
(`task_delete_with_run_history.rs`, `worktree_lifecycle.rs`).

A second code-review round found and this verification independently confirmed a fix for one
additional regression introduced by the CR-04 fix itself (a lock-ordering issue that would have
frozen the whole app behind one Stop click against a wedged sidecar) — that fix is in place, tested,
and now gated against reintroduction by a dedicated falsifiable source-scanning test.

The reason overall status is `human_needed` rather than `passed` is exclusively the five
pre-existing, unautomatable human-verification items — none of which are new, none of which were
claimed closed by any gap-closure plan, and all of which were explicitly and correctly deferred to
end-of-phase UAT by the phase's own `workflow.human_verify_mode: end-of-phase` design from the
start. Per the routing rule this agent follows: if a human-verification item is the only thing
standing between this phase and `passed`, the correct status is `human_needed`, not `passed` and
not `gaps_found` — that is exactly the case here.

One documentation-hygiene item is worth the orchestrator's attention before considering this phase
fully closed: `.planning/REQUIREMENTS.md`'s per-requirement status table currently shows the
inverse of the actual, code-verified state (see Advisory note above) and should be reconciled.

---

_Verified: 2026-09-11T13:55:00Z_
_Verifier: Claude (gsd-verifier)_
