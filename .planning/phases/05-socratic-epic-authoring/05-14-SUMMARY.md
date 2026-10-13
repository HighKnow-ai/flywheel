---
phase: 05-socratic-epic-authoring
plan: 14
subsystem: authoring
tags: [rust, tauri, sidecar, transcript-integrity, tdd, gap-closure]

# Dependency graph
requires:
  - phase: 05-socratic-epic-authoring
    provides: plan 05-12's developer-typed-turn seam (send_authoring_turn, authoring_turn_send) and plan 05-13's premise-recording extraction (record_authoring_turn)
provides:
  - A `developer_turn` transcript row that names a turn the transport ACCEPTED, never merely an attempted one
  - A visible (not stderr-only) notice when a session-log persist fails during a turn, gated to one per run
affects: [05-VERIFICATION.md truth #7, 05-REVIEW.md CR-01/WR-04]

# Actuals (#2632)
actuals:
  tokens: 6847
  tasks: 2
  commits: 4
plan_head_before: 5288376

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "AuthoringTurnSink trait as a seam over AppHandle<Wry> for unit-testing emit/notify behavior without a constructible Tauri handle"
    - "Delivery-first-then-record ordering for a transcript row that must name only ACCEPTED turns"
    - "Single free-function detail mapper shared between two call sites to prevent wording drift"

key-files:
  created: []
  modified:
    - packages/desktop/src-tauri/src/sidecar.rs
    - packages/desktop/src-tauri/src/commands/authoring.rs

key-decisions:
  - "A developer_turn row is defined as naming a DELIVERED turn (transport accepted), not an ATTEMPTED one — the reorder-only fix, not a delivery-status field on the transcript line (assumption_delta_decision, already made by the plan)"
  - "AuthoringTurnSink trait exists solely because AppHandle is AppHandle<Wry> and this crate enables no Tauri test feature — documented in the trait's own doc comment so it is not later deleted as ceremony"
  - "send_authoring_turn and record_authoring_turn keep their exact public signatures and become one-line delegations to the new sink-generic methods, so commands/authoring.rs needed zero call-site edits"

requirements-completed: [SHAPE-01]

coverage:
  - id: D1
    description: "A turn whose delivery fails leaves zero session-log lines and zero emitted events; a successful retry of the same turn leaves exactly one of each; two successful deliveries with different text leave two rows"
    requirement: "SHAPE-01"
    verification:
      - kind: unit
        ref: "packages/desktop/src-tauri/src/sidecar.rs#authoring_turn_delivery_failure_records_no_row_and_a_successful_retry_records_exactly_one"
        status: pass
      - kind: unit
        ref: "packages/desktop/src-tauri/src/sidecar.rs#authoring_turn_delivery_failure_emits_nothing_onto_the_agent_event_channel"
        status: pass
      - kind: unit
        ref: "packages/desktop/src-tauri/src/sidecar.rs#authoring_turn_two_delivered_turns_leave_two_rows"
        status: pass
    human_judgment: false
  - id: D2
    description: "Recording a turn without relaying it (the premise-recording call site's own shape) still persists and emits exactly one row, unaffected by the reorder"
    requirement: "SHAPE-01"
    verification:
      - kind: unit
        ref: "packages/desktop/src-tauri/src/sidecar.rs#authoring_turn_recorded_without_relaying_still_leaves_exactly_one_row"
        status: pass
    human_judgment: false
  - id: D3
    description: "A session-log persist failure during a turn produces exactly one visible notice per run (never one per turn), while the turn event itself is still emitted"
    requirement: "SHAPE-01"
    verification:
      - kind: unit
        ref: "packages/desktop/src-tauri/src/sidecar.rs#authoring_turn_persist_failure_surfaces_a_notice_not_only_stderr"
        status: pass
      - kind: unit
        ref: "packages/desktop/src-tauri/src/sidecar.rs#authoring_turn_persist_failure_surfaces_exactly_one_notice_per_run"
        status: pass
    human_judgment: false
  - id: D4
    description: "The persistence-failure notice text never discloses a filesystem path, app-data directory, or environment value"
    requirement: "SHAPE-01"
    verification:
      - kind: other
        ref: "test \"$(grep -c 'Flywheel could not write this session' packages/desktop/src-tauri/src/sidecar.rs)\" = \"1\" — the wording exists exactly once, meaning the turn path reuses the one helper whose text is already bound by the no-path-disclosure rule rather than inventing a second message"
        status: pass
    human_judgment: false

duration: ~22min
completed: 2026-09-24
status: complete
---

# Phase 05 Plan 14: Delivery-Gated Authoring Turns Summary

**A `developer_turn` transcript row is now written only after the sidecar accepted delivery — not before — closing the phase's one failed must-have truth, plus a matching fix that makes a session-log persist failure visible to the developer instead of stderr-only.**

## Performance

- **Duration:** ~22 min
- **Started:** ~2026-09-24T02:04:00Z (approximate — not captured at spawn)
- **Completed:** 2026-09-24T02:26:14Z
- **Tasks:** 2
- **Files modified:** 2

## Accomplishments

- `SidecarHandle::send_authoring_turn_via` attempts delivery to the child process FIRST and propagates a delivery error with `?` before any persist or emit — on the `Err` path nothing is recorded, closing `05-VERIFICATION.md` truth #7 / CR-01.
- A failed-then-retried turn leaves exactly one transcript row, never two, and two genuinely different successful turns still leave two rows — the gate suppresses failures only, never legitimate turns.
- `AuthoringTurnSink` trait lets the ordering and the notify-on-persist-failure behavior be unit-tested without a constructible `AppHandle<Wry>` — a `RecordingSink` test double stands in for the renderer.
- A session-log persist failure during a turn now surfaces one `system_notice` per run through the sink (closing WR-04), reusing the shared reader loop's existing `notified_persist_failures` dedup set and the existing `emit_persistence_failure_notice` wording — never a second message text, never a filesystem path.
- The `PersistOutcome` → detail-string mapping is now written in exactly one place (`persist_failure_detail`), called by both the shared reader loop's own branch and the new turn-recording path, so the two can never drift into different wording.
- Six new Rust unit tests exist in `persist_tests`, all passing; `cargo test -p desktop` (41/41), `cargo build --workspace`, and `npm --prefix packages/desktop run test` (552/552) all pass.

## Task Commits

Each task followed the RED → GREEN TDD cycle, producing two commit pairs:

1. **Task 1 RED:** `b99ed83` — `test(05-14): add failing tests for delivery-gated authoring turns` (test)
2. **Task 1 GREEN:** `2ad5e85` — `feat(05-14): gate the developer_turn transcript row on delivery success` (feat)
3. **Task 2 RED:** `911bbb9` — `test(05-14): add failing tests for a visible session-log persist failure` (test)
4. **Task 2 GREEN:** `9c6d37f` — `feat(05-14): surface a session-log persist failure during a turn (WR-04)` (feat)

No separate metadata-only commit exists yet — this SUMMARY and STATE.md updates are committed together as this plan's closing commit.

## Files Created/Modified

- `packages/desktop/src-tauri/src/sidecar.rs` — `AuthoringTurnSink` trait + `AppHandle` impl, `send_authoring_turn_via`/`record_authoring_turn_into` (sink-generic, delivery-gated), `without_child_for_tests` test constructor, `persist_failure_detail` shared mapper, six new unit tests, and the reader loop's inline detail-mapping match replaced by a call to the shared mapper.
- `packages/desktop/src-tauri/src/commands/authoring.rs` — doc-comment-only update on `authoring_turn_send` naming the decided "delivered, not attempted" identity; no code change (call site already correct).

## Decisions Made

- **A `developer_turn` row names a DELIVERED turn, not an ATTEMPTED one** — the plan's own `assumption_delta_decision` (`promote`), implemented as a pure reorder plus a testability seam rather than a delivery-status field on the transcript line (which would have required a three-state renderer and touched every existing persisted line).
- **`AuthoringTurnSink` is a trait, not a direct `&AppHandle` parameter**, because `AppHandle` is `AppHandle<Wry>` and this crate enables no Tauri `test` feature — documented inline so a future reader does not delete it as unnecessary indirection.
- **`send_authoring_turn`/`record_authoring_turn` keep their exact public signatures** and become one-line delegations to the new sink-generic methods — `commands/authoring.rs` needed zero call-site edits, verified by grep (`send_authoring_turn` still appears exactly 4 times: three best-effort relays plus `authoring_turn_send`).

## Deviations from Plan

### Auto-fixed Issues

None — no Rule 1/2/3 auto-fixes were needed; the plan's own design (seam, ordering, shared mapper) was implementable as specified.

### Documented Discrepancy (not a code deviation)

**Task 1's `<verify>` block expects `cargo test -p desktop authoring_turn` to report "fewer than 6 passed" as its failure threshold** ("the two pre-existing builder tests plus this task's four"). In the actual pre-existing test suite, only ONE of the two builder tests matches the substring filter `authoring_turn` —
`authoring_turn_line_carries_type_run_id_text_and_origin` does, but
`two_builder_calls_with_different_turn_ids_never_collide_on_one_feed_key` does not contain that substring. The real, correct post-fix run therefore reports **5 passed**, not 6 (verified: `cargo test -p desktop authoring_turn` → `test result: ok. 5 passed; 0 failed`). Renaming either pre-existing test to force a 6th match would violate this same task's own acceptance criterion ("no test removed or renamed from the pre-existing set"), so the count was left as the plan's own miscount rather than "fixed" by renaming a test. The substantive gate — zero failures, `cargo test -p desktop` fully green (41/41), `cargo build --workspace` clean — holds. Recorded here as a plan-authoring inaccuracy, not a code defect.

---

**Total deviations:** 0 auto-fixed. 1 documented plan-verification-count discrepancy (no code impact).
**Impact on plan:** None on correctness or scope; the discrepancy is purely in one `<verify>` block's arithmetic, not in the shipped behavior.

## Issues Encountered

None.

## Authentication Gates

None encountered.

## Known Stubs

None.

## Threat Flags

None — this plan's changes stay entirely within the `<threat_model>` the plan already declared (T-05-14-01 through T-05-14-06 and T-05-14-SC), introducing no new trust boundary, endpoint, or schema change.

## User Setup Required

None - no external service configuration required.

## Next Phase Readiness

- The phase's one failed must-have truth (`05-VERIFICATION.md` truth #7 / CR-01) and WR-04 are both closed by this plan, each with genuine RED-then-GREEN test evidence (not retrofitted tests against already-correct code).
- Remaining phase 05 gap-closure items per `05-REVIEW.md`/the gap-closure plan set: WR-05 (undetermined proposal read ordering, `05-15-PLAN.md`) and WR-06 (dishonest LIVE reporting, `05-16-PLAN.md`) are unaffected by this plan and remain open for their own plans.
- No blockers for the next gap-closure plan in this round.

## Self-Check: PASSED

- `packages/desktop/src-tauri/src/sidecar.rs` — FOUND
- `packages/desktop/src-tauri/src/commands/authoring.rs` — FOUND
- Commit `b99ed83` (test, Task 1 RED) — FOUND in `git log --oneline --all`
- Commit `2ad5e85` (feat, Task 1 GREEN) — FOUND in `git log --oneline --all`
- Commit `911bbb9` (test, Task 2 RED) — FOUND in `git log --oneline --all`
- Commit `9c6d37f` (feat, Task 2 GREEN) — FOUND in `git log --oneline --all`
- All plan-level `<acceptance_criteria>` and `<verify>` commands re-run and passing (see Task Commits and Accomplishments above)

---
*Phase: 05-socratic-epic-authoring*
*Completed: 2026-09-24*
