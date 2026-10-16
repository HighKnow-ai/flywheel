---
phase: 15-nothing-typed-that-an-agent-could-draft
plan: 03
subsystem: dispatch
tags: [limit-gate, rate-limit, state-badge, needs-you, uat-harness, vitest, rusqlite]
requires:
  - phase: 09-agent-fan-out
    provides: limit_gate.rs (AGNT-05), DispatchGateLine, held_by_limit task state
  - phase: 14-cycles-on-screen-state-in-colour
    provides: STATE_VOCABULARY, the five state classes and the --state-* token gate
provides:
  - dispatch_limit_floor.rs pinning the reject floor and reset-precision edges of the gate
  - held_by_limit in STATE_VOCABULARY on blocked's class and mark (no sixth class)
  - StateBadge optional label prop; WavePlanSheet draws a limit-held task through StateBadge
  - uat-15-account-limit.mjs with --self-test and --offline arms (and an unrun --live arm)
  - uat_fanout_ops gate-setup / gate-apply / gate-read bridge subcommands
affects: [15-04 live limit burn, 18 signal budget]
actuals:
  tokens: 13777
  tasks: 3
  commits: 4
plan_head_before: 2c2b4423e9c4fc4cf64020565fc4ee189f556c2f
tech-stack:
  added: []
  patterns:
    - "observed is reserved for a LiveObservation built from a live SidecarClient's events; offline verification is `passed`"
    - "a wire shape is derived from the committed capture by spreading it, never hand-typed"
key-files:
  created:
    - packages/core/tests/dispatch_limit_floor.rs
    - packages/desktop/src/dispatch/__tests__/limit-surface.test.tsx
    - scripts/uat/uat-15-account-limit.mjs
  modified:
    - packages/desktop/src/legend/StateBadge.tsx
    - packages/desktop/src/legend/__tests__/state-badge.test.tsx
    - packages/desktop/src/dispatch/WavePlanSheet.tsx
    - packages/core/tests/bin/uat_fanout_ops.rs
key-decisions:
  - "held_by_limit is a vocabulary key on blocked's class and mark, so StateClass still has exactly five members, asserted by test"
  - "The harness distinguishes passed (verified offline) from observed (a real backend delivered it); a constructed Rejected line is labelled constructed"
  - "limit_gate.rs and DispatchGateLine.tsx are unmodified"
requirements-completed: [DRFT-12]
coverage:
  - id: D1
    description: "Reject floor pinned at FLOOR-1, FLOOR and FLOOR+1 after a time-driven resume, read from DISPATCH_REJECT_FLOOR_SECS"
    requirement: DRFT-12
    verification:
      - kind: integration
        ref: "packages/core/tests/dispatch_limit_floor.rs#a_rejection_exactly_at_the_floor_falls_on_the_outside_and_pauses_with_the_wires_reset_instant"
        status: pass
    human_judgment: false
  - id: D2
    description: "normalise_resets_at pinned below, at and above the millisecond threshold, and for absent, non-numeric, NaN, negative and zero values"
    requirement: DRFT-12
    verification:
      - kind: integration
        ref: "packages/core/tests/dispatch_limit_floor.rs#the_millisecond_threshold_mirror_is_the_edge_the_code_implements"
        status: pass
    human_judgment: false
  - id: D3
    description: "A gate transition leaves every agent_runs.status identical"
    requirement: DRFT-12
    verification:
      - kind: integration
        ref: "packages/core/tests/dispatch_limit_floor.rs#applying_a_rejected_signal_leaves_every_agent_run_status_byte_identical"
        status: pass
    human_judgment: false
  - id: D4
    description: "A limit-held task is drawn in the needs-you class with blocked's glyph and the word 'Held by the account limit'; the vocabulary has exactly five classes"
    requirement: DRFT-12
    verification:
      - kind: unit
        ref: "packages/desktop/src/dispatch/__tests__/limit-surface.test.tsx and packages/desktop/src/legend/__tests__/state-badge.test.tsx"
        status: pass
    human_judgment: false
  - id: D5
    description: "Offline harness replays the real capture through the production seam and refuses to call the unexercised Rejected tier observed"
    requirement: DRFT-12
    verification:
      - kind: other
        ref: "node scripts/uat/uat-15-account-limit.mjs --self-test; node scripts/uat/uat-15-account-limit.mjs --offline"
        status: pass
    human_judgment: false
  - id: D6
    description: "The --live arm captures a real Rejected tier and records it"
    requirement: DRFT-12
    verification: []
    human_judgment: true
    rationale: "Written but never run: it spends subscription capacity and belongs to plan 15-04 after its decision checkpoint"
duration: 13min
completed: 2026-10-16
status: complete
---

# Phase 15 Plan 03: The account-limit gate's contracts, surface and offline harness Summary

**The gate's reject-floor and reset-precision edges are pinned at both sides, a limit-held task now draws in the existing needs-you class with no sixth class, and `uat-15-account-limit.mjs` replays the one real capture through the production seam while making `observed` unreachable for anything a real backend did not send.**

## Performance

- **Duration:** 13 min
- **Started:** 2026-10-16T04:38:40Z
- **Completed:** 2026-10-16T04:51:44Z
- **Tasks:** 3
- **Files modified:** 7

## Accomplishments

- Reject floor pinned at 119 / 120 / 121 seconds after a real time-driven resume (read from `DISPATCH_REJECT_FLOOR_SECS`, no bare literal): inside the floor pauses for manual resume with no resume instant, at and past it pauses on the wire's reset instant.
- `normalise_resets_at` pinned just below, at and just above the millisecond threshold, plus absent, non-numeric, NaN, negative and zero values (all `None`). `limit_gate.rs` is unmodified.
- `held_by_limit` joins `STATE_VOCABULARY` on `blocked`'s class and mark; a test asserts the distinct classes are exactly the five named. `DispatchGateLine` is proven to cover both paused variants and the open gate.
- The harness's offline arm reports (a) and (d) `not-measured`, (b) and (c) `passed`, labels the derived rejected line CONSTRUCTED, and reports criterion 6 NOT CLOSED. A warning-tier observation cannot close it even with every other clause passing.

## Task Commits

1. **Task 1: gate numeric contracts** - `d4408551` (test; characterisation of an unchanged gate, see TDD note)
2. **Task 2: limit-held task in needs-you** - `9faaffce` (test, RED) then `f2a916ee` (feat, GREEN)
3. **Task 3: offline harness** - `25d66809` (feat)

**Plan metadata:** committed after this file (docs: complete plan)

## TDD Gate Compliance

- **Task 2:** RED `9faaffce` failed on four planned assertions (`stateClassOf("held_by_limit")` read `quiet`, no `data-state-class` on the wave plan, no vocabulary key, no `label` prop); GREEN `f2a916ee` passes them. The DispatchGateLine cases and the five-class guard passed already in RED because they pin existing behaviour.
- **Task 1:** no honest RED exists. The task writes tests for a gate it is forbidden to change, so every test passes on first run. As substitute evidence, temporarily mutating `limit_gate.rs` (`<` to `<=` on the floor, `>` to `>=` on the millisecond threshold) failed 3 of the 14 tests; the file was then restored with `git checkout -- <file>` and the diff confirmed empty. Task 1 therefore has a single `test(15-03)` commit and no `feat`, which the end-of-phase TDD review will report.
- **Task 3** carries no `tdd="true"` attribute.

## Files Created/Modified

- `packages/core/tests/dispatch_limit_floor.rs` - 14 boundary and precision tests plus the run-status invariance test
- `packages/desktop/src/dispatch/__tests__/limit-surface.test.tsx` - held task in needs-you on the wave plan, DispatchGateLine cases, no literal colour
- `packages/desktop/src/legend/__tests__/state-badge.test.tsx` - five-class guard, held_by_limit equals blocked, label prop
- `packages/desktop/src/legend/StateBadge.tsx` - `held_by_limit` key and optional `label` prop
- `packages/desktop/src/dispatch/WavePlanSheet.tsx` - a `held_by_limit` task draws through `StateBadge`; other states stay plain text
- `packages/core/tests/bin/uat_fanout_ops.rs` - `gate-setup`, `gate-apply`, `gate-read`
- `scripts/uat/uat-15-account-limit.mjs` - the harness

## Decisions Made

- Offline verification is reported `passed`, not `observed`. The plan's own wording asked (b) and (c) for "a real verdict" while forbidding `observed` for anything not received from a real backend; a separate status resolves the conflict without weakening either rule.
- The harness derives its rejected line by spreading the committed `allowed_warning` capture with a replaced status, and finds the nested notice object by shape, so the script never spells the wire key (the plan's grep requires zero `rate_limit_info` occurrences).

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 2 - Missing critical] The vocabulary key alone drew nothing**
- **Found during:** Task 2
- **Issue:** the plan assumed `rowVariant` would style a `held_by_limit` task "for free" and `WavePlanSheet`'s label would be "the word beside the glyph". `WavePlanSheet` renders `stateLabel(task.state)` as bare text and never calls `StateBadge`, and `StateBadge`'s own word for a non-fleet state is the mark label ("Blocked"), not "Held by the account limit". Without wiring, the new key was dead code and D-34's surface would not exist.
- **Fix:** `StateBadge` takes an optional `label`; `WavePlanSheet` draws a `held_by_limit` task through `StateBadge` with `stateLabel(...)` as that label. All other states are untouched.
- **Files modified:** `StateBadge.tsx`, `WavePlanSheet.tsx` (the latter is not in the plan's `files_modified`)
- **Verification:** `limit-surface.test.tsx` (RED then GREEN); 332 tests across `src/dispatch`, `src/legend` and the three theme gates pass; `tsc --noEmit` clean.
- **Committed in:** `f2a916ee`

**2. [Rule 3 - Blocking] The harness needed a Rust bridge the plan did not list**
- **Found during:** Task 3
- **Issue:** "via a `uat_*_ops` subcommand" named no file, and none of the existing bridges could apply a limit signal. Writing a second parser in JS would break the plan's own rule that the harness drives the production seam.
- **Fix:** `gate-setup`, `gate-apply` and `gate-read` added to `uat_fanout_ops.rs` (test-only binary), which call `LimitSignal::from_event`, `apply_rate_limit_signal_for_run` and `read_gate` directly. Smoke-tested by hand, then through the offline arm; `uat-14 --offline` still passes.
- **Files modified:** `packages/core/tests/bin/uat_fanout_ops.rs`
- **Committed in:** `25d66809`

### Plan statements that disagree with the code (asserted as implemented)

- **`may_advance` under `Paused`.** The plan says `may_spawn` is false and `may_advance` stays true. The code is `may_advance == gate.is_open()`, so a pause makes both false (a warning is the only state with spawn true and advance false). Task 1's test and the offline arm assert the implemented behaviour, and the test's name and comment record the discrepancy. `limit_gate.rs` was not moved.
- **Exactly 120 seconds.** The comparison is `now - resumed_at < FLOOR`, so 120 falls outside the floor and pauses on the wire's reset instant. Named in the test.
- **`MILLISECONDS_THRESHOLD` is private.** Task 1 mirrors it once as `MS_THRESHOLD`; `the_millisecond_threshold_mirror_is_the_edge_the_code_implements` fails if the two drift.
- **The plan's no-argument verify command.** `node ... 2>&1 | tail -6; test $? -ne 0` tests `tail`'s exit status, not the script's. The script itself exits 2 with no argument (and with `--live` missing its arguments); verified directly.

---

**Total deviations:** 2 auto-fixed (1 Rule 2, 1 Rule 3), 4 plan/code disagreements recorded.
**Impact on plan:** both fixes were needed for the plan's stated goal; neither touches `limit_gate.rs`, `DispatchGateLine.tsx` or `run-all.sh`.

## Issues Encountered

None beyond the above.

## Known Stubs

None. The `--live` arm is complete code that has never been executed (see below); it is not a stub.

## Handoff to plan 15-04

- **`run-all.sh` MANUAL line (not added here, 15-04 owns the edit):**
  `node scripts/uat/uat-15-account-limit.mjs --live --artifact <phase-dir>/15-LIVE-LIMIT-BURN.json --fixture scripts/uat/fixtures/live-limit-rejected.json --max-minutes 90`
- **The `--live` arm has never run.** It is modelled on `uat-14`'s live body and passed a syntax load, nothing more. Expect to fix it on first contact: how `raw` is carried on sidecar `rate_limit` events, and whether the burn prompt actually drains the window.
- **Redaction (T-15-15).** The live arm writes only the raw lines of events that carried a tier, not the transcript, but 15-04 owns the rule for what it commits.
- **Clause (a) closes only at `rejected`.** If the burn yields only a warning, `observed` is printed for (a) and criterion 6 still reports NOT CLOSED.

## Threat Flags

None. The new bridge subcommands are test-only, refuse to run without the scratch environment variables, and open no network surface.

## User Setup Required

None - no external service configuration required.

## Next Phase Readiness

Ready for 15-04. The surface, boundary tests and offline harness exist; the live burn and its decision checkpoint do not.

## Self-Check: PASSED

- Created files exist: `dispatch_limit_floor.rs`, `limit-surface.test.tsx`, `uat-15-account-limit.mjs` - FOUND
- Commits `d4408551`, `9faaffce`, `f2a916ee`, `25d66809` - FOUND
- `git diff --name-only 2c2b4423..HEAD` lists neither `limit_gate.rs`, `DispatchGateLine.tsx` nor `run-all.sh`
- `cargo test -p core --test dispatch_limit_floor --test dispatch_limit_gate --test dispatch_cap`: 14 + 8 + 31 passed
- Desktop dispatch, legend and theme-gate suites: 332 passed; `tsc --noEmit` clean; no literal colours in changed files
- `--self-test` and `--offline` exit 0; no argument exits 2; zero `rate_limit_info` occurrences
