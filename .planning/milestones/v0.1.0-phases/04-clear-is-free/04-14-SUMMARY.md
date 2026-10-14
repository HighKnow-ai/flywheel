---
phase: 04-clear-is-free
plan: 14
subsystem: context-reconstitution
tags: [rust, node-test, five-cycle, ctx-07, compaction, drift, mcp-permission-server]

requires:
  - phase: 04-clear-is-free
    provides: "every prior plan's write path this harness drives through, unmodified: 04-01's
      create_summary/list_summaries_for_task, 04-05's compact_summaries/VERBATIM_WINDOW, 04-08's
      ContextPacket.compaction and render_prompt's folded/verbatim split, 04-11's detect_drift, and
      04-03's report_summary socket surface"
provides:
  - "packages/core/tests/five_cycle_reconstitution.rs — a ten-cycle synthetic harness proving CTX-07
    end to end: criteria byte-identical at cycle five and cycle ten, every decision retained
    (including folded ones, asserted on rendered output), exactly ten append-only summary rows, and
    six named context-quality metrics (bounded verbatim carry, no narrative leakage, decision
    retention under folding, per-cycle determinism, zero drift false positives, growth confined to
    the folded region) asserted at every cycle rather than once at the end"
  - "packages/sidecar/test/five-cycle.test.mjs — five real report_summary calls over one real
    startPermissionServer socket, proving the write surface survives repetition without leaking a
    connection or disturbing the shared permission gate"
  - "packages/sidecar/test/socket-test-helpers.mjs — the socket-driving helpers factored out of
    summary-report.test.mjs so both summary test files share exactly one copy"
affects: []

actuals:
  tokens: 9673
  tasks: 3
  commits: 3
  plan_head_before: 05f72f23a0becca635bc2f9ea59c1b0bce7b9fa0

tech-stack:
  added: []
  patterns:
    - "A single private cycle driver (run_one_cycle), reused by every test in the file rather than
      re-implemented per test — one function walks start_agent_run/create_summary/close_agent_run,
      the same production write path a real session uses, so a regression in that path fails every
      test in this file, not a bypassed raw-SQL stand-in"
    - "Zero-padded cycle markers (cycle-01 not cycle-1) so no marker string is ever a Rust-string
      prefix of another cycle's marker — an unpadded cycle-1 marker is a substring of cycle-10's,
      which made an early draft's leakage-absence assertion spuriously pass by accidentally
      matching inside cycle 10's own text; found by a real failing test, not anticipated"
    - "extract_verbatim_region isolates the region a growth assertion is actually about (between
      the Prior Sessions/verbatim heading and the next top-level heading) rather than measuring the
      whole rendered prompt, which legitimately grows as the folded region grows too"

key-files:
  created:
    - packages/core/tests/five_cycle_reconstitution.rs
    - packages/sidecar/test/five-cycle.test.mjs
    - packages/sidecar/test/socket-test-helpers.mjs
  modified:
    - packages/sidecar/test/summary-report.test.mjs

key-decisions:
  - "Cycle markers/decision ids are zero-padded to two digits (cycle-01..cycle-10) — an unpadded
    cycle-1 marker is a Rust-string prefix of cycle-10's, so an absence assertion for a folded
    cycle's marker spuriously matched inside a later verbatim cycle's own text. Found by a real
    failing test after the first draft, not anticipated by the plan."
  - "A client socket that never enters flowing mode (no reader attached, no resume()) never emits
    'close' for the far side's FIN, even after the far side has already ended the connection — a
    real ~17-minute apparent hang in an early draft of the sidecar test's 'connections close
    cleanly' case traced to this, not to a server-side bug. Fixed with an explicit client.resume()
    rather than attaching an unused readline consumer, since the test asserts closure, not content."
  - "The shared socket-driving helpers (waitForListening, writeLineAndAwaitClose) were factored out
    of summary-report.test.mjs into a new socket-test-helpers.mjs module, per the plan's own
    instruction — neither function was exported by the original file, so importing them directly
    was not an option; the new module is deliberately named without a .test.mjs suffix so npm
    test's node --test test/*.test.mjs glob never picks it up as a test file of its own."
  - "DriftInputs in the zero-false-positive test are built directly from the assembled packet at
    each cycle (real_changed_paths = the latest summary's own claimed files, head_ref = None,
    working_tree_dirty = false, pinned_criterion_ids = the current criterion ids) rather than
    through assemble_context_packet_with_extras and a real git diff — this harness makes no process
    or network call anywhere, per the plan's own prohibition, so 'honest' inputs are constructed to
    trivially match rather than derived from a real worktree."

patterns-established:
  - "A five/ten-cycle synthetic harness is the template for any future phase that needs to prove a
    property holds across repeated sessions without paying for a live model call: drive the real
    domain write path in a loop, assert at multiple points (not only at the end), and give every
    written value a unique, position-derived marker so absence/presence assertions are unambiguous."

requirements-completed: [CTX-07, CTX-04, CTX-02]

coverage:
  - id: D1
    description: "One task driven through ten session cycles via the real start_agent_run/
      create_summary/close_agent_run write path (never raw SQL); acceptance criteria are
      byte-identical at cycle five and cycle ten against a pre-cycle-one baseline; every decision
      id written across all ten cycles is present in the final packet with none extra or missing;
      the summary row count is exactly ten at the end and the first cycle's own row is
      byte-identical to what it was written with"
    requirement: CTX-07
    verification:
      - kind: integration
        ref: "tests/five_cycle_reconstitution.rs#criteria_statements_are_byte_identical_at_cycle_five_and_cycle_ten"
        status: pass
      - kind: integration
        ref: "tests/five_cycle_reconstitution.rs#every_decision_recorded_across_ten_cycles_is_present_in_the_packet_at_cycle_ten"
        status: pass
      - kind: integration
        ref: "tests/five_cycle_reconstitution.rs#the_summary_row_count_for_the_task_is_exactly_ten_at_the_end"
        status: pass
      - kind: integration
        ref: "tests/five_cycle_reconstitution.rs#the_first_cycles_summary_content_is_byte_identical_at_the_end"
        status: pass
      - kind: other
        ref: "cargo test -p core --test five_cycle_reconstitution (10/10 passed, ~2.2s, no process/network)"
        status: pass
    human_judgment: false
  - id: D2
    description: "Six context-quality metrics ROADMAP.md's Phase 4 Notes named as a ship gate,
      each asserted at every cycle rather than once at the end: bounded verbatim carry (exactly
      five summaries carried verbatim from cycle six through ten), no narrative leakage (folded
      cycles' prose absent from the rendered prompt, verbatim cycles' present), decision retention
      under folding (all ten decision markers present in the rendered output at cycle ten,
      including folded ones), per-cycle determinism (two assemblies and two renders equal at every
      cycle), zero drift false positives (detect_drift over honest inputs returns empty at every
      cycle), and growth confined to the folded region (the verbatim region's byte length at cycle
      ten is within 10% of cycle five's)"
    requirement: CTX-07
    verification:
      - kind: integration
        ref: "tests/five_cycle_reconstitution.rs#bounded_verbatim_carry_is_exactly_five_from_cycle_six_through_cycle_ten"
        status: pass
      - kind: integration
        ref: "tests/five_cycle_reconstitution.rs#folded_summaries_narrative_is_absent_from_the_rendered_prompt_at_cycle_ten"
        status: pass
      - kind: integration
        ref: "tests/five_cycle_reconstitution.rs#every_decision_including_folded_ones_appears_in_the_rendered_prompt_at_cycle_ten"
        status: pass
      - kind: integration
        ref: "tests/five_cycle_reconstitution.rs#two_assemblies_and_two_renders_are_byte_identical_at_every_one_of_the_ten_cycles"
        status: pass
      - kind: integration
        ref: "tests/five_cycle_reconstitution.rs#ten_honest_cycles_fire_zero_drift_warnings_at_every_cycle"
        status: pass
      - kind: integration
        ref: "tests/five_cycle_reconstitution.rs#growth_between_cycle_five_and_cycle_ten_is_confined_to_the_folded_region"
        status: pass
      - kind: other
        ref: "cargo test -p core --test five_cycle_reconstitution (10 tests, 0 failed, finished in ~2.2s — under the plan's 30s ceiling)"
        status: pass
      - kind: other
        ref: "cargo test -p core --test compaction (12/12 passed, unregressed)"
        status: pass
    human_judgment: false
  - id: D3
    description: "Five successive report_summary payloads driven over one real
      startPermissionServer socket, each on its own fresh connection, exactly as the standalone MCP
      server issues one connection per tool call: onSummary fires five times in order with fields
      intact, every connection closes with none left in the permission gate's pending map, onNotice
      never fires for a summary, and a routine permission request on a sixth connection still stays
      held open until resolved — the regression that would matter most, since a summary path that
      slowly corrupts the gate would be invisible until a human was asked a question and never got
      one"
    verification:
      - kind: integration
        ref: "sidecar/test/five-cycle.test.mjs#five summary payloads over one server, each on its own connection, fire onSummary five times in order with fields intact"
        status: pass
      - kind: integration
        ref: "sidecar/test/five-cycle.test.mjs#every one of the five summary connections closes cleanly and none is left held"
        status: pass
      - kind: integration
        ref: "sidecar/test/five-cycle.test.mjs#the permission held-request path still works after five summary calls: a sixth connection stays held open until resolved"
        status: pass
      - kind: integration
        ref: "sidecar/test/five-cycle.test.mjs#onNotice never fires for any of the five summary payloads"
        status: pass
      - kind: other
        ref: "npm --prefix packages/sidecar test (108/108 passed, 0 failed, including all 4 five-cycle tests and all 5 summary-report tests)"
        status: pass
    human_judgment: false
  - id: D4
    description: "The whole phase stays green after this plan's additions: the Rust workspace, the
      sidecar suite, and the desktop suite"
    verification:
      - kind: other
        ref: "cargo build --workspace (clean)"
        status: pass
      - kind: other
        ref: "cargo test --workspace (58 test binaries, 0 FAILED lines, includes both historically
          flaky files — credentials.rs and worktree_lifecycle.rs — passing this run)"
        status: pass
      - kind: other
        ref: "npm --prefix packages/desktop run test (463 passed, 32 test files)"
        status: pass
      - kind: other
        ref: "npm --prefix packages/sidecar test (108 passed, 0 failed)"
        status: pass
    human_judgment: false

duration: 40min
completed: 2026-09-23
status: complete
---

# Phase 4 Plan 14: Five-Cycle Reconstitution Summary

**A ten-cycle synthetic Rust harness drives the real create_summary/compaction/drift write path and proves CTX-07's headline claim — criteria and decisions survive byte-identical past the fifth-cycle fold, with zero drift false positives — while a five-call sidecar harness proves the report_summary socket survives repetition without corrupting the shared permission gate.**

## Performance

- **Duration:** 40 min
- **Started:** 2026-09-23T06:20:00Z (approx.)
- **Completed:** 2026-09-23T06:55:00Z
- **Tasks:** 3
- **Files modified:** 4 (3 created, 1 modified)

## Accomplishments

- `packages/core/tests/five_cycle_reconstitution.rs` (569 lines, 10 tests): a private `run_one_cycle`
  helper drives ten cycles through `start_agent_run`/`create_summary`/`close_agent_run` — the exact
  production write path, never a raw SQL insert. Task 1's four tests prove the falsifying property
  itself: the criteria vector is byte-identical at cycle five and cycle ten against a baseline
  captured before cycle one; every decision id written across all ten cycles is present in the final
  packet, with none extra or missing; the summary row count is exactly ten; and the first cycle's own
  row is untouched after nine more cycles landed on top of it.
- Task 2's six tests turn ROADMAP.md's "context-quality metrics" research flag into named assertions,
  each checked at every cycle rather than once at the end: bounded verbatim carry (exactly five
  summaries carried verbatim from cycle six on), no narrative leakage (a folded cycle's prose marker
  is genuinely absent from the rendered prompt, not merely unrendered elsewhere — found and fixed a
  marker-prefix collision bug along the way), decision retention under folding read from the RENDERED
  output rather than the struct, per-cycle determinism (two assemblies and two renders equal at every
  one of the ten cycles), zero drift false positives (`detect_drift` over honestly-constructed inputs
  returns empty at all ten cycles), and growth confined to the folded region (a dedicated
  `extract_verbatim_region` helper isolates the region rather than measuring the whole prompt).
- `packages/sidecar/test/five-cycle.test.mjs` (4 tests) drives five real `report_summary` payloads
  over one real `startPermissionServer` socket, each on its own fresh connection: `onSummary` fires
  five times in order with fields intact, every connection closes with none left in the pending map,
  `onNotice` never fires, and a sixth connection carrying a routine permission request still stays
  held open until `resolvePermission` answers it.
- `packages/sidecar/test/socket-test-helpers.mjs` (new): the `waitForListening`/
  `writeLineAndAwaitClose` helpers factored out of `summary-report.test.mjs` (which defined them
  locally, unexported) so both summary test files import one shared copy instead of risking two
  copies drifting apart.

## Task Commits

Each task was committed atomically:

1. **Task 1: Ten cycles, one task, criteria byte-identical from first to last** - `b61e970` (test)
2. **Task 2: The context-quality metrics the roadmap asked for, asserted per cycle** - `d867c3b` (test)
3. **Task 3: Five real tool calls over a real socket — the write surface under repetition** - `6f7d574` (test)

**Plan metadata:** commit follows this SUMMARY.

## Files Created/Modified

- `packages/core/tests/five_cycle_reconstitution.rs` - the phase's headline evidence: 10 tests, no
  process/network call, driven through the real write path
- `packages/sidecar/test/five-cycle.test.mjs` - 4 tests proving the report_summary socket survives
  five real calls without leaking a connection or disturbing the permission gate
- `packages/sidecar/test/socket-test-helpers.mjs` - `waitForListening`/`writeLineAndAwaitClose`,
  shared by both summary test files
- `packages/sidecar/test/summary-report.test.mjs` - now imports the shared helpers instead of
  defining its own local copies

## Decisions Made

See `key-decisions` in the frontmatter above — summarised: (1) markers are zero-padded to avoid a
substring-collision false pass, found by a real failing test; (2) a client socket that never enters
flowing mode never emits `close`, traced from an apparent ~17-minute hang to a missing `resume()`
call, not a server bug; (3) the shared socket helpers were factored into a new, non-`.test.mjs`
module since neither original function was exported; (4) `DriftInputs` for the zero-false-positive
test are built directly from the assembled packet rather than through a real git diff, keeping this
harness's own no-process/no-network contract.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 1 - Bug] Fixed a marker-prefix collision in the Rust harness's leakage-absence assertion**
- **Found during:** Task 2 (`folded_summaries_narrative_is_absent_from_the_rendered_prompt_at_cycle_ten`)
- **Issue:** `decision_id_for_cycle`/`prose_marker_for_cycle`/`decision_marker_for_cycle` originally
  formatted the cycle number unpadded (`cycle-1-decision`). Because `"cycle-1-decision"` is a Rust
  `String::contains` PREFIX of `"cycle-10-decision"`, the test's `!prompt.contains(marker_for_cycle(1))`
  assertion spuriously matched inside cycle 10's own (correctly present, verbatim) text — the test
  failed for the right underlying reason (a real bug in the test's own marker scheme), not a product
  defect.
- **Fix:** Zero-padded every cycle-derived marker/id to two digits (`cycle-01`..`cycle-10`), which
  makes every marker in the file a genuinely non-overlapping substring of every other.
- **Files modified:** `packages/core/tests/five_cycle_reconstitution.rs`
- **Verification:** `cargo test -p core --test five_cycle_reconstitution` — 10/10 passing after the fix.
- **Committed in:** `d867c3b` (Task 2 commit)

**2. [Rule 1 - Bug] Fixed a real hang in the sidecar harness's "connections close cleanly" test**
- **Found during:** Task 3, running the full `npm --prefix packages/sidecar test` suite
- **Issue:** An early draft of the "every one of the five summary connections closes cleanly" test
  created a client socket, wrote the payload, and awaited only a `'close'` event — with no reader
  attached (no `'data'` listener, no `resume()`, no `readline`). A Node socket in paused mode never
  emits `'end'`/`'close'` for the far side's FIN until its buffered data is actually consumed, so the
  test hung indefinitely (surfaced as an apparent ~17-minute stall while diagnosing what turned out to
  be the real, legitimately-slow `destructive-gate.test.mjs` suite running concurrently in an earlier
  full-suite attempt, then isolated to this specific test once run alone).
- **Fix:** Added an explicit `client.resume()` right after the connection is created, putting the
  socket into flowing mode so the short receipt-acknowledgement line drains and `'close'` fires
  normally.
- **Files modified:** `packages/sidecar/test/five-cycle.test.mjs`
- **Verification:** the isolated two-file run (`node --test test/five-cycle.test.mjs
  test/summary-report.test.mjs`) went from hanging past 60s to 9/9 passing in ~2.4s; the full sidecar
  suite subsequently ran 108/108 passing in ~87.6s.
- **Committed in:** `6f7d574` (Task 3 commit)

---

**Total deviations:** 2 auto-fixed (both Rule 1 — bugs found and fixed in this plan's own new test
code during its own verification loop, not in any prior plan's production code).
**Impact on plan:** Both fixes are internal to this plan's own test harnesses; neither touches
production code from any prior plan. No scope creep.

## Issues Encountered

- Running the full `npm --prefix packages/sidecar test` suite genuinely takes ~87-90 seconds even
  when healthy — several pre-existing tests in `destructive-gate.test.mjs`, `permission.test.mjs` and
  `real-claude-argv.test.mjs` spawn real subprocesses with multi-second-to-tens-of-seconds waits by
  design (the longest single test in the suite runs ~37s). An early attempt to run the suite mistook
  this real, low-CPU-but-long-wall-clock duration for a hang and was investigated at length before
  the actual hang (see Deviation 2 above) was isolated to this plan's own new test file, run in
  isolation. The full suite's true state (108/108 passing, 0 failed) was confirmed both via a
  completed background run and a subsequent clean foreground run.
- No live model call or spawned `claude` session was used anywhere in this plan's own new harnesses,
  per the plan's own prohibition and WINDOWS.md rows 11/12's flakiness record — both new test files
  are fully synthetic/socket-level.

## User Setup Required

None - no external service configuration required.

## Next Phase Readiness

- CTX-07 is closed: the thesis that the board can reconstitute a context across repeated sessions,
  with acceptance criteria unchanged and decisions retained even past the compaction fold, now has
  automated, repeatable evidence rather than a single happy-path demonstration.
- This is the last plan in Phase 4 (`/clear` Is Free). `cargo build --workspace`,
  `cargo test --workspace` (58 binaries, 0 FAILED), `npm --prefix packages/sidecar test` (108/108),
  and `npm --prefix packages/desktop run test` (463/463) are all green — phase-level verification is
  the next step.
- No blockers.

---
*Phase: 04-clear-is-free*
*Completed: 2026-09-23*

## Self-Check: PASSED
