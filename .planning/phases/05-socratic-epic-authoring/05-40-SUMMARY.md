---
phase: 05-socratic-epic-authoring
plan: 40
subsystem: authoring
tags: [rust, node, stage-gate, tdd, contract-test, gap-closure, sqlite]

# Dependency graph
requires:
  - phase: 05-socratic-epic-authoring (plan 05-03)
    provides: the D-88 stage machine (`AuthoringStage`, `transition_stage`'s T-05-03-05 marker-write ordering) and the shipped `stage-gate-hook.ts` this plan's write-side fix now agrees with from session start
provides:
  - A run created by `start_authoring_run` now has a readable D-88 stage marker on disk naming `challenge`, immediately, before any stage transition
  - A first end-to-end contract test (`authoring_stage_marker_contract.rs`) spanning the real Rust write path and the shipped, compiled Node hook — the test shape no prior round in this phase had
  - A corrected gap report: the refusal `01M3DNC0G9CYAWSD8DYEGTRP8C` hit comes from `stage-gate-hook.ts`'s `failClosed`, not `mcp-permission-server.ts`
  - A provable distinction between the two stage-gate denial reasons (`denyForChallengeStage` vs `failClosed`), asserted in `authoring-stage-gate.test.mjs` against the shipped hook
affects: [06-agent-authored-backlog]

# Actuals (#2632)
actuals:
  tokens: 4842
  tasks: 3
  commits: 3
plan_head_before: 7020aaa23a41451b246a560369ca2c4b9c882253

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "A marker/database-row pair that two different processes each read must be written inside the SAME transaction, as the LAST step before commit, with a write failure bailing before commit — copied verbatim from `transition_stage`'s existing T-05-03-05 rule onto `start_authoring_run` rather than inventing a second ordering contract for the same invariant."
    - "A gap report is a hypothesis, not a fact — this plan's own Task 1 corrected the round's gap report before writing any fix, naming the actual emitting file (`stage-gate-hook.ts`) instead of the one the report blamed (`mcp-permission-server.ts`)."
    - "When two test files each fabricate the other's half of a contract (one hand-writes the marker file, the other hand-inserts the database state each side actually produces), the fix is a third test that drives BOTH real code paths together end to end, not a patch to either fabricating test."

key-files:
  created:
    - packages/core/tests/authoring_stage_marker_contract.rs
  modified:
    - packages/core/src/domain/authoring_session.rs
    - packages/sidecar/test/authoring-stage-gate.test.mjs

key-decisions:
  - "The marker write in `start_authoring_run` reuses `write_authoring_stage` directly rather than routing through `transition_stage` (which asserts `task_id.is_none()` behavior specific to an in-flight guarded transition) — `start_authoring_run` has no prior stage to guard against, so it calls the same low-level write function `transition_stage` itself calls, copying only the ORDERING rule (last write before commit, bail before commit on failure), not the guarded-UPDATE machinery that exists for a different problem (concurrent double-transition)."
  - "No existing test file needed a new scratch-runtime-dir wrapper. Several callers of `start_authoring_run` across the workspace (`authoring_measurement.rs`, `perf_seed_1000.rs`, `authoring_board_read.rs`, `epic_context_packet.rs`) do not override `FLYWHEEL_RUNTIME_DIR`, so this change makes them additionally write real marker files to the default app-data runtime directory during test runs — exactly as several of the ALREADY-wrapped test files already did via `advance_stage`'s pre-existing marker write. `cargo test --workspace` exits 0 with this left as-is; tightening those files' isolation is a hygiene improvement out of this plan's scope (no test failed, so Rule 3's blocking-issue trigger did not fire), not a correctness gap this plan's `must_haves` name."

requirements-completed: [SHAPE-01, SHAPE-02, SHAPE-03, SHAPE-04]

coverage:
  - id: D1
    description: "A run created by start_authoring_run has a readable authoring stage marker on disk naming `challenge`, immediately, before any stage transition has happened."
    requirement: SHAPE-02
    verification:
      - kind: integration
        ref: "packages/core/tests/authoring_stage_marker_contract.rs#marker_is_readable_immediately_after_start_authoring_run"
        status: pass
    human_judgment: false
  - id: D2
    description: "The shipped, compiled stage-gate hook, run against a marker a real start_authoring_run produced, denies a propose call with the challenge-stage reason — not the fail-closed reason — proving the write and read sides now agree end to end."
    requirement: SHAPE-02
    verification:
      - kind: integration
        ref: "packages/core/tests/authoring_stage_marker_contract.rs#a_challenge_stage_run_is_denied_by_the_shipped_hook_with_the_challenge_reason"
        status: pass
    human_judgment: false
  - id: D3
    description: "A marker-write failure at session start surfaces as an Err and leaves no agent_runs row behind — a started authoring run can never exist without its marker."
    requirement: SHAPE-02
    verification:
      - kind: integration
        ref: "packages/core/tests/authoring_stage_marker_contract.rs#a_marker_write_failure_at_start_leaves_no_agent_run_row"
        status: pass
    human_judgment: false
  - id: D4
    description: "The hook's two denial reasons (challenge-stage vs fail-closed) are asserted provably distinct strings, with both cases still denying and both still exiting non-zero — the fail-closed posture is unweakened."
    requirement: SHAPE-02
    verification:
      - kind: integration
        ref: "packages/sidecar/test/authoring-stage-gate.test.mjs#a legitimately-challenging run and a run whose marker cannot be read are denied for DIFFERENT reasons"
        status: pass
    human_judgment: false
  - id: D5
    description: "No regression anywhere in the workspace: every existing authoring/stage test, every sidecar test, and advance_stage's own T-05-03-05 rollback contract all still pass unchanged."
    verification:
      - kind: unit
        ref: "cargo test -p core --test authoring_stage (9 passing)"
        status: pass
      - kind: other
        ref: "cargo test --workspace (0 failures)"
        status: pass
      - kind: other
        ref: "npm --prefix packages/sidecar test (181 passing, baseline 180)"
        status: pass
    human_judgment: false
  - id: D6
    description: "The finding — which side of the marker contract was wrong (write), which side was correct (read), the gap report's mis-named artifact, and why nine rounds of green tests did not catch it — is recorded in the contract test's own module doc comment, where the next reader of this code will hit it."
    requirement: SHAPE-01
    verification:
      - kind: other
        ref: "grep -c '01M3DNC0G9CYAWSD8DYEGTRP8C' + 'authoring_stage.rs' + 'stage-gate-hook' in authoring_stage_marker_contract.rs, each >= 1 (all four plan-declared <verify> gates on Task 1's file)"
        status: pass
    human_judgment: false

duration: ~35min
completed: 2026-09-26
status: complete
---

# Phase 5 Plan 40: Gap-closure round 10's most important item — the authoring stage marker is now written at session start

**`start_authoring_run` now writes the D-88 runtime stage marker as the last step before commit, closing the gap where a challenge-stage propose call was denied with an infrastructure-defect message instead of the actionable "keep challenging" reason — proven end to end against the shipped, compiled Node hook, not just the database row.**

## Performance

- **Duration:** ~35 min
- **Started:** 2026-09-26
- **Completed:** 2026-09-26
- **Tasks:** 3
- **Files modified:** 3 (1 created, 2 modified)

## Accomplishments

- `packages/core/tests/authoring_stage_marker_contract.rs` (new): states the finding — the WRITE side of the marker contract was wrong, not the READ side — in a module doc comment naming the corrected gap-report artifact (`stage-gate-hook.ts`, not `mcp-permission-server.ts`), the live corroboration from run `01M3DNC0G9CYAWSD8DYEGTRP8C`, and why `authoring_stage.rs` and `authoring-stage-gate.test.mjs` each missed it for nine rounds. Three tests: the marker is readable immediately after start, the SHIPPED compiled hook denies a real start's propose call with the challenge-stage reason (never the fail-closed one), and a marker-write failure at start leaves zero `agent_runs` rows.
- `packages/core/src/domain/authoring_session.rs`: `start_authoring_run` now calls `write_authoring_stage` as the last step of its transaction before `commit`, bailing with an `Err` naming "runtime marker" on `RuntimeIo::WriteFailed` — copying `transition_stage`'s own T-05-03-05 ordering rule exactly. The read side (`stage-gate-hook.ts`, `read_authoring_stage`) is untouched.
- `packages/sidecar/test/authoring-stage-gate.test.mjs`: a new test proves the challenge-stage and fail-closed denial reasons are provably distinct strings, with both cases still denying and both still exiting non-zero. The module doc comment now names `authoring_stage_marker_contract.rs` as the test owning the write-side contract this file's hand-written marker fixtures cannot prove.

## Task Commits

Each task was committed atomically:

1. **Task 1: State the finding — an end-to-end contract test committed RED** - `8d3b837` (test)
2. **Task 2: Tracer — write the stage marker at session start** - `4022dca` (feat)
3. **Task 3: Close the blind spot — provably distinct denial reasons** - `52c6fe0` (test)

**Plan metadata:** commit pending (this SUMMARY + STATE.md/ROADMAP.md, committed immediately after this file).

## RED Observation (Task 1, verbatim)

`cargo test -p core --test authoring_stage_marker_contract`, run immediately after Task 1's commit and before any change to `authoring_session.rs`:

```
running 3 tests
test a_challenge_stage_run_is_denied_by_the_shipped_hook_with_the_challenge_reason ... FAILED
test a_marker_write_failure_at_start_leaves_no_agent_run_row ... FAILED
test marker_is_readable_immediately_after_start_authoring_run ... FAILED

failures:

---- a_challenge_stage_run_is_denied_by_the_shipped_hook_with_the_challenge_reason stdout ----
thread '...' panicked at packages/core/tests/authoring_stage_marker_contract.rs:196:9:
a legitimately-challenging run must be denied by denyForChallengeStage, whose reason names the stage — got "Flywheel could not verify the authoring stage allows this call (no authoring stage marker could be read for this run) — refusing it."

---- a_marker_write_failure_at_start_leaves_no_agent_run_row stdout ----
thread '...' panicked at packages/core/tests/authoring_stage_marker_contract.rs:224:14:
a marker-write failure at start must surface as an Err, not a silent success: AgentRun { id: "01M3DTJM8PEP1WBKKP0Y5VFC4J", ... authoring_stage: Some("challenge") }

---- marker_is_readable_immediately_after_start_authoring_run stdout ----
thread '...' panicked at packages/core/tests/authoring_stage_marker_contract.rs:160:9:
assertion `left == right` failed: a run just created by start_authoring_run must have a readable stage marker naming `challenge`, before any stage transition — this is the write-side gap G-05-8(b) found
  left: None
 right: Some("challenge")

test result: FAILED. 0 passed; 3 failed; 0 ignored; 0 measured; 0 filtered out; finished in 0.13s
```

All three failed for the diagnosed reason — the first (`marker_is_readable_immediately_after_start_authoring_run`) is the load-bearing assertion the plan named. This RED confirmed the finding was correct before any production code changed.

## Files Created/Modified

- `packages/core/tests/authoring_stage_marker_contract.rs` — new contract test binary owning the write-side marker contract; three tests plus two helpers (`stage_gate_hook_script`, `run_shipped_stage_gate_hook`) spawning the shipped compiled hook as a real process.
- `packages/core/src/domain/authoring_session.rs` — `start_authoring_run` gains the marker write (2 non-comment `write_authoring_stage` call sites total across the file: this one and `transition_stage`'s pre-existing one) and a doc-comment paragraph naming why it belongs here.
- `packages/sidecar/test/authoring-stage-gate.test.mjs` — new test proving the two denial reasons are distinct; module doc comment extended naming the Rust contract test.

## Decisions Made

See `key-decisions` in the frontmatter above.

## Deviations from Plan

None — plan executed exactly as written. Every `<verify>` command and acceptance criterion for all three tasks passed; no `<precondition>` was unmet (`packages/sidecar/dist/stage-gate-hook.js` already existed); no auto-fix cycles were needed.

## Issues Encountered

None.

## User Setup Required

None — no external service configuration required.

## Threat Flags

None. All five threats in this plan's own `<threat_model>` are addressed by the plan as written: T-05-40-01 (the start-path write routes through the same `write_authoring_stage` with its `is_ulid` guard — no new path-formatting site was added), T-05-40-02 (the fail-closed paths are still denied by Task 3's own new test), T-05-40-03 (the hook's own-environment-only resolution was not touched), T-05-40-04 (`no_sidecar_source_names_the_human_only_advance_path` still passes — verified above in the workspace test run), T-05-40-SC (no package-manager install in this plan; verified: no `Cargo.toml` or `packages/sidecar/package.json` diff).

## Next Phase Readiness

- Gap `G-05-8(b)` is closed: an authoring session started in the challenge stage now carries a readable marker from the first instant, and the shipped hook denies its propose calls with the actionable "keep challenging" reason rather than the "your run is broken" one. The next live authoring run that stays in challenge should no longer be able to reproduce the transcript's `01M3DNC0G9CYAWSD8DYEGTRP8C` failure — that claim is itself unverified until a live run happens (SHAPE-01/SHAPE-02's own flagged assumptions, carried forward from this plan's `<flagged_assumptions>` — this round changes nothing about live dialogue quality, only whether the board is reachable once a developer advances the stage).
- `G-05-8(a)` (`AskUserQuestion` invisible in the live harness) is untouched by this plan — it belongs to whatever plan in this round addresses the harness/UI side of that gap, not this one.
- `advance_stage`/`return_to_stage` remain the only production callers of `write_authoring_stage`'s sibling call site (the guarded transition), and `no_sidecar_source_names_the_human_only_advance_path` still confirms no agent-reachable caller exists anywhere in the workspace.

---
*Phase: 05-socratic-epic-authoring*
*Completed: 2026-09-26*

## Self-Check: PASSED

- FOUND: packages/core/tests/authoring_stage_marker_contract.rs
- FOUND: packages/core/src/domain/authoring_session.rs
- FOUND: packages/sidecar/test/authoring-stage-gate.test.mjs
- FOUND commit: 8d3b837
- FOUND commit: 4022dca
- FOUND commit: 52c6fe0
- `cargo test -p core --test authoring_stage_marker_contract`: 3 passed, 0 failed
- `cargo test -p core --test authoring_stage`: 9 passed, 0 failed
- `cargo test --workspace`: 0 failures anywhere in the workspace
- `npm --prefix packages/sidecar test`: 181 passed, 0 failed (baseline 180)
- `grep -c 'write_authoring_stage' authoring_session.rs` (non-comment): 2
- `grep -cE 'format!\(.*(SELECT|INSERT|UPDATE|DELETE)' authoring_session.rs` (non-comment): 0
- `grep -c 'failClosed(' stage-gate-hook.ts`: 6; `grep -c 'denyForChallengeStage' stage-gate-hook.ts`: 2 (read side byte-unchanged)
- `git status --porcelain -- packages/core/src packages/sidecar/src` at Task 1's own done-check: empty (no production file touched before Task 2)
- `plan_head_before` (`7020aaa`) → `HEAD`: 3 commits (matches 3 tasks)
