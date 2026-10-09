---
phase: 09-planned-fan-out-that-does-not-collide
plan: 05
subsystem: dispatcher
tags: [rate-limit, limit-gate, adapter-seam, settings, backoff, agnt-05]

requires:
  - phase: 09-planned-fan-out-that-does-not-collide
    provides: "plan 09-02: the pattern for turning an adapter signal into a board event with a bounded best-effort notice (handler/process split, run identity from the database); plan 09-04: the global-setting pattern (settings row, no events row, malformed value degrades) and the cap this gate is kept separate from"
provides:
  - "rateLimitTier at the adapter seam: a normalised open / warning / rejected tier derived from the top-level status only; rate_limit assistant errors map to rejected"
  - "limit_gate.rs: GateState (open / warning / paused), resetsAt normalisation, write-on-change, the reject floor, may_spawn / may_advance / may_merge, resume_if_due, resume_now, clear_expired_warning, hold_for_limit"
  - "sidecar.rs: handle_inbound_rate_limit / process_inbound_rate_limit, one reader-chain branch"
  - "dispatch.gate_changed event on the triggering run's project stream, written in the same transaction as the gate row"
affects: [09-07 dispatcher tick (reads the gate, calls resume_if_due / clear_expired_warning), 09-09 UI (gate banner, Resume now action)]

plan_head_before: ad6556d71f6c971379a2372c17e427e113d433a1

actuals:
  tokens: 14200
  tasks: 2
  commits: 4

tech-stack:
  added: []
  patterns:
    - "The supervisor reads a normalised tier the adapter seam computed; limit_gate.rs names no backend and reads no wire field (source-grep gated)"
    - "A pure gate over one stored row plus an injected clock: the tick that will drive it owns no timer and no state of its own"
    - "Two exits from a pause (the wire's reset instant, the user's word), and one memory (resumed_at on the open state) that turns a would-be retry loop into a manual pause"
    - "A malformed stored gate reads as open and never errors"

key-files:
  created:
    - packages/core/src/limit_gate.rs
    - packages/core/tests/dispatch_limit_gate.rs
    - packages/sidecar/test/rate-limit-wire.test.mjs
  modified:
    - packages/core/src/lib.rs
    - packages/sidecar/src/adapter.ts
    - packages/sidecar/src/claude-code-adapter.ts
    - packages/sidecar/test/fake-claude.mjs
    - packages/desktop/src-tauri/src/sidecar.rs
    - .planning/DEFERRED-REVIEW.md

key-decisions:
  - "The gate refuses nothing that a user does. It is read only by the dispatcher (may_spawn / may_advance); agent_run_start, merges and every other user action never consult it. A user-initiated launch is therefore never refused by the limit gate, exactly as it is never refused by the 09-04 cap. This is deliberate: the user is the clock for their own launches and sees the reason on screen. A launch the user makes that is itself rejected still pauses the gate for autonomous dispatch."
  - "The gate is separate from the 09-04 cap and does not read it. The cap bounds how many sessions the dispatcher keeps running; the gate bounds whether it may start any at all because the account says so."
  - "resetsAt absent or malformed pauses with no resume instant and only a manual resume clears it. No probe, no guessed wait."
  - "A rejection within DISPATCH_REJECT_FLOOR_SECS (120) of a time-driven resume pauses for manual resume, regardless of what reset time the wire reports then. Chosen over the narrower 'only when the new reset is also past' because the acceptance criterion states it that way and a manual pause is the cheap failure."
  - "A known reset only ever EXTENDS an existing timed pause, never shortens it, and upgrades an unknown-reset pause; two alternating windows cannot flap the row."
  - "Only one warning is tracked at a time (ponytail comment in code): a second window's warning is ignored until the first clears."
  - "The open state carries resumed_at (the time-driven resume's own memory) in the same single row, so the floor survives a restart without a second key."
  - "A rate_limit error on an assistant message carries rateLimitTier on the assistant_text event rather than becoming a separate rate_limit event, so the agent's visible text is not lost; the reader branch fires on type rate_limit or on the presence of rateLimitTier."
  - "settings.rs was not modified (the plan listed it): the gate reuses the existing pub(crate) upsert_setting / read_setting helpers unchanged."

patterns-established:
  - "Gate decisions are functions of (stored row, injected now): read_gate is pure, resume_if_due is the one persisted time-driven transition"

requirements-completed: [AGNT-05]

coverage:
  - id: D1
    description: "The observed allowed event, with its overage status reading rejected, reads as tier open and changes nothing and writes nothing"
    requirement: AGNT-05
    verification:
      - kind: unit
        ref: "packages/sidecar/test/rate-limit-wire.test.mjs#the observed allowed event, overage status rejected and all, reads as tier open"
        status: pass
      - kind: integration
        ref: "packages/core/tests/dispatch_limit_gate.rs#the_observed_allowed_event_after_the_seam_changes_nothing_and_writes_nothing"
        status: pass
    human_judgment: false
  - id: D2
    description: "A constructed rejected event (or an assistant message with a rate_limit error) pauses new dispatch, naming the window and the real resume instant when the wire gave one, or saying the reset time is unknown when it did not"
    requirement: AGNT-05
    verification:
      - kind: integration
        ref: "packages/core/tests/dispatch_limit_gate.rs (a_rejected_signal_* , a_reset_already_in_the_past_pauses_for_zero_time)"
        status: pass
      - kind: unit
        ref: "packages/desktop/src-tauri/src/sidecar.rs#rate_limit_tests (4 tests)"
        status: pass
    human_judgment: true
    rationale: "Every hard-tier assertion runs against a fixture constructed from the documented shape. No hard limit has ever been observed live in this project; whether a real one presents that way is unconfirmed and queued as D-REV-32."
  - id: D3
    description: "Fifty identical signals write the gate row once; a pause changes no agent run and sends no interrupt; the gate survives reopening the database"
    requirement: AGNT-05
    verification:
      - kind: integration
        ref: "packages/core/tests/dispatch_limit_gate.rs (fifty_identical_signals_write_the_gate_row_exactly_once, fifty_identical_past_reset_signals_also_write_once, pausing_changes_no_agent_run_*, a_paused_gate_reads_paused_after_reopening_the_database)"
        status: pass
      - kind: command
        ref: "source gates: limit_gate.rs has 0 raw-wire fields, 0 lifecycle calls, 0 process or sleep constructs"
        status: pass
    human_judgment: false
  - id: D4
    description: "A reset in the past resumes once and a second rejection inside the floor pauses for manual resume, so the loop cannot become a blind retry; a manual resume clears either paused variant"
    requirement: AGNT-05
    verification:
      - kind: integration
        ref: "packages/core/tests/dispatch_limit_gate.rs (a_past_reset_resumes_once_and_a_second_rejection_cannot_loop, resume_if_due_resumes_exactly_once_and_arms_the_reject_floor, a_manual_resume_opens_the_gate_from_both_paused_variants_and_from_a_warning)"
        status: pass
    human_judgment: false
  - id: D5
    description: "The warning tier lets the running wave spawn, refuses to advance the cursor, is keyed by limit window, and clears by a same-window allowed event or by its reset passing"
    requirement: AGNT-05
    verification:
      - kind: integration
        ref: "packages/core/tests/dispatch_limit_gate.rs (a_warning_* , an_allowed_signal_for_the_same_window_*)"
        status: pass
    human_judgment: false
  - id: D6
    description: "A paused gate permits a merge and refuses a spawn; a task whose run ended on the limit reads held_by_limit, not failed"
    requirement: AGNT-05
    verification:
      - kind: integration
        ref: "packages/core/tests/dispatch_limit_gate.rs (a_paused_gate_permits_a_merge_*, a_task_held_by_the_limit_reads_held_not_failed_*)"
        status: pass
    human_judgment: false

duration: 45min
completed: 2026-10-09
status: complete
---

# Phase 9 Plan 05: The Account-Limit Gate Summary

**A normalised open / warning / rejected tier computed at the adapter seam from the top-level status alone, and a single-row gate in the Rust core that pauses new dispatch (never running work), resumes at the reset time the wire reported or on the user's word, and cannot be turned into a retry loop.**

## What is verified, and what is not

**No hard rate limit has ever been observed live in this project.** The `rejected` tier is built from the documented shape (a top-level `status` of `rejected`, and an assistant message whose error is `rate_limit`). Every hard-tier assertion in this plan, in both languages, runs against a constructed fixture. What the gate does when it receives that shape is tested; that a real limit arrives in that shape is not. If it arrives differently the adapter yields no tier (an unrecognised status is never guessed at) and dispatch would not pause. That residual is recorded as **D-REV-32** in `.planning/DEFERRED-REVIEW.md`. The plan said it was already queued; it was not, so this plan added it.

What is real: the `allowed` event with an overage status of `rejected` (the negative fixture, which must not pause) and the `allowed_warning` event (the warning fixture) are both captures from live runs.

## What the gate refuses, and what it does not

- **Autonomous dispatch only.** The gate exposes `may_spawn`, `may_advance` and `may_merge` for the dispatcher tick (plan 09-07) to read. **Nothing reads them yet**, so today the gate is recorded and shown but gates nothing: ROADMAP criterion 5's "dispatch backs off" half is not demonstrable until 09-07 calls these. The detection, the state and the resume rules are complete and tested.
- **A user-initiated launch is never refused.** `agent_run_start`, merges and every user action do not consult the gate. This is deliberate and mirrors the 09-04 cap. If the user launches a run that the backend then rejects, that rejection still pauses the gate for the dispatcher.
- **The gate is not the cap.** 09-04's cap bounds concurrency; this gate bounds whether any autonomous spawn may start because the account says no. Neither reads the other.
- **Running sessions are never touched.** The module contains no agent-run write, interrupt, signal, process construction or sleep (three source-grep gates assert it), and a test asserts a `running` run is still `running` after a pause.

## Accomplishments

- `rateLimitTier(status)` is an exact match on the top-level status (`allowed` / `allowed_warning` / `rejected`); anything else yields no tier. The rate-limit event carries `tier`; an assistant message with error `rate_limit` carries `rateLimitTier: "rejected"` and keeps its text.
- `normalise_resets_at`: above 1e11 is milliseconds, positive at or below is seconds, anything else (string, zero, negative, null, bool) is absent.
- `apply_rate_limit_signal` writes only on a state change. A past reset pauses for zero time; an absent one pauses with no resume instant ("the reset time is unknown"); a later real reset extends or upgrades a pause and never shortens one.
- Reject floor (120 s): `resume_if_due` persists the time-driven resume once and records when; a rejection inside the floor after it becomes a manual pause that no reset time turns back into a timed one. `resume_now` forgets the floor.
- Warning keyed by limit window: cleared by a same-window allowed event or by its reset passing (`clear_expired_warning`), not by a different window's, and not stored if its reset is already past.
- `apply_rate_limit_signal_for_run` appends one `dispatch.gate_changed` event to the triggering run's project stream in the same transaction as the gate row; an unknown run still updates the gate.
- `sidecar.rs`: one reader-chain branch, a handler that logs and continues on any failure, a DB-only process function covered by four tests, and a `dispatch:gate_changed` UI event on a state change.
- `hold_for_limit` sets a task's dispatch state to `held_by_limit` (not `failed`) so a later resume can start a fresh run on the same worktree.

## Task Commits

1. **Task 1 RED:** `b143b42` (test) - sidecar tier fixtures and core gate tests, inert stubs
2. **Task 1 GREEN:** `52298c9` (feat) - adapter tier, gate state machine, reader branch
3. **Task 2 RED:** `9360462` (test) - warning tier and resume tests
4. **Task 2 GREEN:** `438ab02` (feat) - warning, permissions, the two exits, `hold_for_limit`

**Plan metadata:** the `docs(09-05)` commits following this file (SUMMARY plus the D-REV-32 register entry; then the roadmap).

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 2 - Missing critical] The plan's "already queued in DEFERRED-REVIEW.md" was not true**
- **Found during:** SUMMARY
- **Issue:** the unobserved hard-limit residual was claimed to be queued; `.planning/DEFERRED-REVIEW.md` had no such entry, and the project rule is that nothing is dropped.
- **Fix:** appended D-REV-32 with `truth`, `why_deferred` (physical: a limit cannot be produced on demand), `risk_if_wrong` and an honest `automatable: PARTLY`.
- **Files modified:** `.planning/DEFERRED-REVIEW.md`

**2. [Rule 3 - Blocking] Signatures and placement differ from the plan text**
- `apply_rate_limit_signal` takes `&mut Connection` and resolves the system actor itself; a sibling `apply_rate_limit_signal_for_run` adds the event so the gate row and its event commit together (DATA-01).
- `read_gate(conn, now)` is the pure effective read; `resume_if_due` is the one persisted time-driven transition. The plan names `clear_expired_warning` and `resume_now`; `resume_if_due`, `may_spawn`, `may_advance`, `may_merge` and `hold_for_limit` were added because the plan's behaviours need a named place.
- `settings.rs` is unchanged (listed in the plan's files): the existing helpers were enough.
- The desktop process function's tests live in `sidecar.rs` (`rate_limit_tests`), and `scope_denied_tests::seeded_run` became `pub(super)` to share the fixture.

### Design choices worth review

- The reader branch fires on `type == "rate_limit"` or on a present `rateLimitTier`, because a hard limit may arrive on an assistant message. The two events use two field names (`tier`, `rateLimitTier`); `LimitSignal::from_event` accepts either.
- A warning arriving within the reject floor of a time-driven resume is ignored, so it cannot erase the floor's memory; the next response re-reports it.

**Total deviations:** 2 (1 missing critical, 1 blocking). **Impact:** none on scope.

## Authentication Gates

None.

## Issues Encountered

- `cargo test --workspace` was **not** run: the full `packages/core` suite takes over 30 minutes here and `credentials` / `forge_live_*` hang on keychain prompts or live network (pre-existing, recorded in 09-01 to 09-04). Run instead: `dispatch_limit_gate` (32), `recovery_statuses` (6), `status_transitions` (22), `crash_safety` (2), `dispatch_cap` (8), `dispatch_plan` (28), `scope_events` (15), `activity_trail` (5), `cargo test -p desktop rate_limit_tests` (4), `cargo build --workspace` (clean), `npm --prefix packages/sidecar test` (265 pass, 4 skipped, 0 fail), `npx tsc --noEmit` for the desktop frontend (clean), and the five source and routing grep gates.
- The sidecar suite must run through `npm test`, which supplies `FLYWHEEL_RUNTIME_DIR`; running `node --test` bare makes real-stream session tests close with a notice instead of events.
- Not exercised: a real `claude` run producing a limit line (impossible on demand; see above), and the renderer: nothing listens for `dispatch:gate_changed` yet and there is no Tauri command for `resume_now`. The banner and the Resume action are plan 09-09 and the tick is 09-07.

## Known Stubs

None. `resume_now` and `hold_for_limit` have no caller yet by design (09-07 and 09-09), not as placeholders.

## Threat Flags

None. The only new surface is an inbound event the existing reader already carried (`rate_limit`) now writing one settings row and one event, covered by T-09-05-01 through T-09-05-06; T-09-05-07 is accepted and queued as D-REV-32.

## Next Phase Readiness

- Plan 09-07's tick calls `resume_if_due` and `clear_expired_warning` each pass, then `read_gate(conn, now)` and branches on `may_spawn` / `may_advance` / `may_merge`; it calls `hold_for_limit` for a run that closed because of the limit.
- Plan 09-09 needs a Tauri command around `resume_now(conn, human_actor)` (human-only, bounded) and a listener for `dispatch:gate_changed`; the reason text is `GateState::message()`.

## Self-Check: PASSED

`packages/core/src/limit_gate.rs`, `packages/core/tests/dispatch_limit_gate.rs` and `packages/sidecar/test/rate-limit-wire.test.mjs` exist. Commits `b143b42`, `52298c9`, `9360462` and `438ab02` exist, and each RED precedes its GREEN. Every `<automated>` verify command was run except `cargo test --workspace` (see Issues Encountered).
