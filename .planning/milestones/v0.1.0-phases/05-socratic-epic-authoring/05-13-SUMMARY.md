---
phase: 05-socratic-epic-authoring
plan: 13
subsystem: authoring
tags: [rust, react, authoring, prompt-rendering, kill-criterion, tdd, gap-closure]

# Dependency graph
requires:
  - phase: 05-socratic-epic-authoring
    provides: the epic-scoped context packet and its renderer (05-04), the launch sheet's authoring variant (05-10), the authoring composer and its persist-before-emit turn recording seam (05-12)
provides:
  - A developer's own stated premise, reaching the opening prompt and the transcript's first developer turn, for both a brand-new epic and a reopened one
  - A no-framing opening-prompt wording that asks the developer what they want to build instead of instructing the model to challenge a framing that was never captured
  - measure_authoring_run — a read-only, event-log-derived measurement of one authoring run's Product Kill Criterion numbers (accepted task/criterion proposals, amended-before-accept, elapsed span)
  - uat_authoring_ops measure-run — the one harness subcommand permitted to read the developer's real fleet database, read-only, no migration
  - The Product Kill Criterion's measurement protocol, written down for both arms, with no numbers recorded yet
affects: [05-VERIFICATION, 05-UAT]

# Actuals (#2632)
actuals:
  tokens: 18056
  tasks: 3
  commits: 8

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "A session input (the developer's stated premise) threaded through a renderer as a parameter, never folded into the board-state packet it primes — keeps the packet's own assembly/determinism/purity contracts untouched by a per-session value."
    - "record_authoring_turn extracted as the persist-and-emit half of send_authoring_turn, so a caller that must RECORD a turn without RELAYING it to the child process (a premise already inside the opening prompt) has a seam that does exactly that."
    - "A harness binary's one deliberately-unsafe subcommand (measure-run) dispatched from its own early branch in main(), before the shared connection helper's refusal guard and migrating open are ever reached — every other subcommand is unaffected."

key-files:
  created:
    - packages/core/tests/authoring_measurement.rs
  modified:
    - packages/core/src/epic_context_packet.rs
    - packages/core/src/query/authoring.rs
    - packages/core/tests/epic_context_packet.rs
    - packages/core/tests/authoring_lifecycle.rs
    - packages/core/tests/authoring_acceptance.rs
    - packages/core/tests/bin/uat_authoring_ops.rs
    - packages/desktop/src-tauri/src/sidecar.rs
    - packages/desktop/src-tauri/src/commands/authoring.rs
    - packages/desktop/src/adapters/tauri.ts
    - packages/desktop/src/launch-sheet/LaunchSheet.tsx
    - packages/desktop/src/launch-sheet/__tests__/launch-sheet.test.tsx
    - .planning/phases/05-socratic-epic-authoring/05-SPIKE-FINDINGS.md
    - .planning/phases/05-socratic-epic-authoring/05-VALIDATION.md

key-decisions:
  - "A blank/whitespace-only premise is treated exactly like an absent one (trimmed, then omitted) rather than rejected as an error — the plan's own Task 2 action text specifies this explicitly ('treat a blank result as absent'), and the whole point of Task 1's no-framing wording is to handle exactly the no-premise case gracefully, not to make it an error state."
  - "MAX_AUTHORING_PREMISE_LEN is its own constant (4000 chars), not a reuse of the composer's MAX_AUTHORING_TURN_TEXT_LEN (8000) — a premise is one opening statement, not free conversation, so it does not need that constant's larger ceiling."
  - "The premise is validated AFTER the already-running-session short-circuit in authoring_run_start, not before — a premise typed against an epic that is already being shaped is never even validated, since that path records nothing and sends no prompt regardless."
  - "'Amended before accept' reduces to 'amended at all, among the accepted' — amend_proposal already refuses an already-decided row, so any recorded proposal.amended event necessarily happened before that proposal's own eventual proposal.accepted event, if it has one. No separate event-ordering check was needed."
  - "The elapsed-span test backdates agent_runs.started_at and one events.occurred_at row via a direct UPDATE after the real domain-function write already happened — the same test-only timestamp-control technique epic_context_packet.rs's own stage_and_decide fixture uses, never a hand-rolled INSERT."

requirements-completed: [SHAPE-01, SHAPE-02, SHAPE-03, SHAPE-04, SHAPE-05]

coverage:
  - id: D1
    description: "The opening prompt carries a stated premise under its own heading when one exists, and asks the developer what they want to build (rather than naming a framing that does not exist) when it does not — the packet's own purity/determinism contracts unchanged by the widened render_epic_prompt(&packet, premise) signature."
    requirement: "SHAPE-01"
    verification:
      - kind: unit
        ref: "packages/core/tests/epic_context_packet.rs#a_stated_premise_carries_under_its_own_heading_and_the_closing_instruction_names_it"
        status: pass
      - kind: unit
        ref: "packages/core/tests/epic_context_packet.rs#no_premise_carries_no_premise_heading_and_the_closing_instruction_asks_instead_of_naming_a_framing"
        status: pass
      - kind: unit
        ref: "packages/core/tests/epic_context_packet.rs#a_blank_or_whitespace_only_premise_is_treated_exactly_like_no_premise_at_all"
        status: pass
    human_judgment: false
  - id: D2
    description: "A developer states the epic's premise in the launch sheet (worded for a new epic vs. a reopened one); it reaches authoring_run_start as a validated, bounded optional argument; the spawned session's opening prompt carries it; and the transcript opens with it attributed to the developer via SidecarHandle::record_authoring_turn — recorded once, never relayed a second time."
    requirement: "SHAPE-05"
    verification:
      - kind: unit
        ref: "packages/desktop/src/launch-sheet/__tests__/launch-sheet.test.tsx#submitting with a stated premise passes it as the start command's third argument"
        status: pass
      - kind: unit
        ref: "packages/desktop/src/launch-sheet/__tests__/launch-sheet.test.tsx#a premise past the length ceiling is refused with a worded error rather than truncated"
        status: pass
      - kind: unit
        ref: "packages/desktop/src/launch-sheet/__tests__/launch-sheet.test.tsx#renders a premise field worded for a brand-new epic, and still renders no permission-mode control"
        status: pass
      - kind: integration
        ref: "cargo build --workspace"
        status: pass
    human_judgment: false
  - id: D3
    description: "measure_authoring_run derives the Product Kill Criterion's in-app-arm numbers (accepted task/criterion proposals, amended-before-accept, elapsed span) from the event log the proposal lifecycle already appends — a read-only aggregate, never a recalled number."
    requirement: "SHAPE-02"
    verification:
      - kind: unit
        ref: "packages/core/tests/authoring_measurement.rs#accepted_task_and_criterion_proposals_are_both_counted"
        status: pass
      - kind: unit
        ref: "packages/core/tests/authoring_measurement.rs#an_amended_then_accepted_criterion_counts_toward_amended_before_accept_and_a_plain_accept_does_not"
        status: pass
      - kind: unit
        ref: "packages/core/tests/authoring_measurement.rs#a_run_with_no_accepted_proposals_reports_zeroes_and_no_elapsed_span_never_an_error"
        status: pass
      - kind: unit
        ref: "packages/core/tests/authoring_measurement.rs#the_elapsed_span_runs_from_the_runs_own_start_to_its_last_acceptance"
        status: pass
      - kind: unit
        ref: "packages/core/tests/authoring_measurement.rs#the_measurement_writes_nothing_the_same_call_twice_leaves_the_database_byte_identical"
        status: pass
    human_judgment: false
  - id: D4
    description: "The uat_authoring_ops measure-run subcommand reads the developer's real fleet database read-only, with no migration step, from its own early dispatch branch — every other subcommand's refusal guard and migrating open are unaffected."
    requirement: "SHAPE-02"
    verification:
      - kind: other
        ref: "grep gates: measure-run count >=2, open_and_migrate count ==1, FLYWHEEL_APP_DATA_DIR-is-not-set count ==1"
        status: pass
      - kind: manual_procedural
        ref: "manually run against a real scratch database: register-project, start-run, advance-stage, measure-run reports zeroed counts"
        status: pass
    human_judgment: false
  - id: D5
    description: "The Product Kill Criterion's measurement protocol is written down for both arms, and 05-VALIDATION.md's per-task map covers every gap-closure task across plans 05-11 through 05-13 — but the criterion itself has not been re-staged against the shipped UI yet."
    requirement: "SHAPE-01"
    verification: []
    human_judgment: true
    rationale: "Re-staging the criterion is the plan's own <human-check>: it spends real API credentials and takes two timed sittings against a real claude backend. No autonomous check can fabricate a human-paced timed comparison. Deferred and recorded as WINDOWS.md entry #17, alongside the phase's existing #13/#14/#16 entries for the same underlying live-run verification."

# Metrics
duration: 20min
completed: 2026-09-24
status: complete
---

# Phase 05 Plan 13: Premise At Turn Zero And A Derived Kill Criterion Summary

**A developer states an epic's premise before a token is spent — it reaches the opening prompt and the transcript as the first developer turn — and the Product Kill Criterion's in-app arm is now a read-only board query instead of something a human has to remember.**

## Performance

- **Duration:** 20 min
- **Started:** 2026-09-24T00:01:00Z
- **Completed:** 2026-09-24T00:22:15Z
- **Tasks:** 3
- **Files modified:** 14 (1 created, 13 modified)

## Accomplishments

- Closed the second half of gap G-05-2: `render_epic_prompt` takes the developer's stated premise as a parameter — present, it renders under its own heading and the closing instruction speaks about challenging it (unchanged wording); absent, the closing instruction now asks the developer what they want to build instead of instructing the model to challenge a framing that was never captured. The packet's own assembly, determinism and purity contracts are untouched.
- The epic-authoring launch sheet's suppressed instruction field is replaced with a premise field of its own, worded for a new epic vs. a reopened one — D-86 stays true only for the permission-mode control, which remains the sheet's one suppressed control.
- `authoring_run_start` validates the premise (trim, blank-as-absent, a 4000-character ceiling with a worded refusal), threads it into the opening prompt, and records it — after the spawn request, never relayed a second time — as the transcript's own first developer turn, via a new `SidecarHandle::record_authoring_turn` seam extracted from `send_authoring_turn`.
- Closed gap G-05-2's third item: `query::authoring::measure_authoring_run` derives the Product Kill Criterion's two in-app-arm numbers from the event log the proposal lifecycle already appends, and `uat_authoring_ops measure-run` is the one harness subcommand allowed to read the developer's real fleet database, read-only, no migration.
- The measurement protocol is written down in `05-SPIKE-FINDINGS.md` for both arms, and `05-VALIDATION.md`'s per-task map now covers all nine gap-closure tasks across plans 05-11 through 05-13.

## Task Commits

Each task followed RED → GREEN per its own `tdd="true"` gate:

1. **Task 1: A prompt that asks when it has nothing to challenge**
   - `test(05-13)` — `1cd07fa` (RED: 2/5 new prompt cases failing on real assertions against a stub that ignores the premise)
   - `feat(05-13)` — `50a87ee` (GREEN: premise section + split closing wording)
2. **Task 2: The premise reaches the prompt and the transcript**
   - `test(05-13)` — `7c36329` (RED: 4/4 new/updated launch-sheet cases failing — "Premise" not found against the pre-widening sheet)
   - `feat(05-13)` — `e10942f` (GREEN: `record_authoring_turn` seam, widened command + validation, wrapper, sheet)
3. **Task 3: The kill criterion measured from the board, not recalled**
   - `test(05-13)` — `3675750` (RED: 3/5 new measurement cases failing against a stub that returns all-zero/absent)
   - `feat(05-13)` — `66d87da` (GREEN: the real aggregation query)
   - `feat(05-13)` — `fb49098` (the harness door — `measure-run`, no dedicated RED phase; wraps an already-tested query in CLI dispatch)
   - `docs(05-13)` — `8cf9308` (the measurement protocol and the validation ledger's per-task rows)

**Plan metadata:** this commit (docs: complete plan)

_Every RED commit failed on real, distinctly-named assertions (element-not-found, count mismatches, `None` where a timestamp was expected) verified manually before the matching GREEN commit — never a compile error standing in for RED, and never skipped._

## Files Created/Modified

- `packages/core/src/epic_context_packet.rs` — `render_epic_prompt` takes `premise: Option<&str>`; the closing section's wording splits on its presence
- `packages/core/src/query/authoring.rs` — `AuthoringRunMeasurement` / `measure_authoring_run`
- `packages/core/tests/epic_context_packet.rs` — 3 new premise-behavior cases, existing calls widened
- `packages/core/tests/authoring_lifecycle.rs`, `packages/core/tests/authoring_acceptance.rs` — call sites widened to compile
- `packages/core/tests/authoring_measurement.rs` — new file, 5 cases
- `packages/core/tests/bin/uat_authoring_ops.rs` — `measure-run`'s own early dispatch branch
- `packages/desktop/src-tauri/src/sidecar.rs` — `record_authoring_turn` extracted from `send_authoring_turn`
- `packages/desktop/src-tauri/src/commands/authoring.rs` — `validate_premise`, widened `authoring_run_start`
- `packages/desktop/src/adapters/tauri.ts` — `startAuthoringRun`'s optional third argument
- `packages/desktop/src/launch-sheet/LaunchSheet.tsx` — the premise field
- `packages/desktop/src/launch-sheet/__tests__/launch-sheet.test.tsx` — 4 new cases, 1 updated
- `.planning/phases/05-socratic-epic-authoring/05-SPIKE-FINDINGS.md` — Measurement Protocol section
- `.planning/phases/05-socratic-epic-authoring/05-VALIDATION.md` — 9 new per-task rows, Manual-Only row updated

## Decisions Made

See `key-decisions` in frontmatter.

## Deviations from Plan

None — plan executed exactly as written. The RED/GREEN split within each task (stubbing the new parameter/logic before implementing it) was the plan's own `tdd="true"` requirement, not a deviation from it.

## Issues Encountered

None.

## User Setup Required

None — no external service configuration required.

## Next Phase Readiness

- Gap G-05-2 is now fully closed across plans 05-11 (drain the live arm's own starvation), 05-12 (a human voice mid-conversation) and 05-13 (a human voice at turn zero, plus a derived kill-criterion measurement).
- The Product Kill Criterion's own re-staging against the shipped UI is the phase's one remaining open verification, deferred to a deliberate human session per its own `<human-check>` (WINDOWS.md entry #17) — the mechanism (a launch-sheet premise, a composer, and a read-only `measure-run` instrument) is now in place for that session to actually happen.
- This is the last plan in phase 05 (13 of 13) — every SHAPE-01 through SHAPE-05 declaring plan now has a SUMMARY, so the shared-ID requirements gate can mark them complete.

---
*Phase: 05-socratic-epic-authoring*
*Completed: 2026-09-24*

## Self-Check: PASSED

- All 14 key files (1 created, 13 modified) confirmed present on disk.
- All 8 task/plan commits (`1cd07fa`, `50a87ee`, `7c36329`, `e10942f`, `3675750`, `66d87da`, `fb49098`, `8cf9308`) confirmed in `git log`.
- Plan-level `<verification>` re-run: `cargo test --workspace` green (0 failures); `cargo build --workspace` clean; `cargo build -p core --bin uat_authoring_ops` clean; `npm --prefix packages/desktop run test` 552/552; `npm --prefix packages/desktop run build` clean; `npm --prefix packages/sidecar test` 143/143; `radiogroup` count in `LaunchSheet.tsx` = 1; hex-literal count = 0; `invoke(` count = 0; `measure-run` count = 5 (>=2); `open_and_migrate` count = 1; `FLYWHEEL_APP_DATA_DIR is not set` count = 1; `Measurement Protocol` count = 1; the nine-gap-closure-task grep = 9.
