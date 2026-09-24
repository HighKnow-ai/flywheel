---
phase: 05-socratic-epic-authoring
plan: 17
subsystem: testing
tags: [rust, sqlite, uat-harness, node, product-kill-criterion, gap-closure]

# Dependency graph
requires:
  - phase: 05-socratic-epic-authoring
    provides: "05-13's measure_authoring_run/measure-run (the in-app arm's board-derived elapsedMinutes); 05-16's uat-08 evidence-sheet/self-test idioms (renderChallengeEvidenceSheet, FLYWHEEL_UAT_EVIDENCE_DIR, check(label, fn))"
provides:
  - "list_recent_authoring_runs + RecentAuthoringRun (packages/core/src/query/authoring.rs): the newest-first, bounded, read-only run picker"
  - "uat_authoring_ops recent-authoring-runs / measure-board-counts: two read-only CLI subcommands sharing the measure-run early-dispatch block, before open_conn(), never migrating"
  - "scripts/uat/uat-09-product-kill-criterion.mjs: computeKillCriterionVerdict / renderKillCriterionSheet / formatTerminalArmBrief, --self-test / --list-runs / --in-app-run, writing 05-KILL-CRITERION.md"
  - "05-VALIDATION.md's Manual-Only Verifications table rewritten to name commands + evidence files instead of hand-run procedures"
affects: [05-verify-work, product-decision-on-authoring-surface-layout]

# Actuals (#2632)
actuals:
  tokens: 12368
  tasks: 3
  commits: 4

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "Read-only CLI subcommands against the developer's REAL fleet database dispatch from ONE early match arm (before open_conn()/FLYWHEEL_APP_DATA_DIR), matched once rather than as stacked equality checks — extended, not duplicated, from 05-13's measure-run precedent"
    - "A comparison instrument's verdict function returns `indeterminate` rather than defaulting, with strict inequalities (never >=) on both clauses of an AND rule, so a tie can never be misread as the more consequential branch"
    - "Every number a comparison sheet prints is attributed to its source (board-derived / operator-supplied / instrument-measured) so a later reader can tell measurement from testimony"

key-files:
  created:
    - scripts/uat/uat-09-product-kill-criterion.mjs
  modified:
    - packages/core/src/query/authoring.rs
    - packages/core/tests/authoring_measurement.rs
    - packages/core/tests/bin/uat_authoring_ops.rs
    - scripts/uat/run-all.sh
    - .planning/phases/05-socratic-epic-authoring/05-VALIDATION.md
    - .planning/phases/05-socratic-epic-authoring/05-SPIKE-FINDINGS.md

key-decisions:
  - "The Product Kill Criterion's verdict rule reads only the in-app arm's own accepted-criteria amendment rate (never the terminal arm's hand-counted reworded count) — matching 05-SPIKE-FINDINGS.md's changes_the_plan_when clause verbatim; the terminal arm's reworded count is still recorded on the sheet for context, just outside the formula"
  - "uat-09's no-args mode exits 3 (SKIP) with a usage line rather than attempting a live run, so a bare invocation from scripts/uat/run-all.sh never blocks on stdin waiting for an operator who isn't there"
  - "The RED-phase failure for list_recent_authoring_runs is a Rust compile error (E0432, unresolved import), not a runtime test failure — accepted as valid RED evidence for a new-symbol addition per the 03-VERIFICATION.md precedent already recorded in STATE.md, since gsd_run check tdd-red-evidence is TAP-specific and cannot parse cargo output"

requirements-completed: [SHAPE-01, SHAPE-02]

coverage:
  - id: D1
    description: "list_recent_authoring_runs / RecentAuthoringRun: the newest-first, bounded, tie-stable run picker a developer uses instead of reading a run id off a UI surface"
    requirement: "SHAPE-02"
    verification:
      - kind: integration
        ref: "packages/core/tests/authoring_measurement.rs#recent_authoring_runs_lists_only_authoring_runs_newest_first"
        status: pass
      - kind: integration
        ref: "packages/core/tests/authoring_measurement.rs#recent_authoring_runs_includes_a_closed_run_with_its_terminal_status"
        status: pass
      - kind: integration
        ref: "packages/core/tests/authoring_measurement.rs#recent_authoring_runs_is_bounded_and_stable_when_two_runs_share_a_start"
        status: pass
    human_judgment: false
  - id: D2
    description: "Two read-only uat_authoring_ops subcommands (recent-authoring-runs, measure-board-counts) sharing one early dispatch block with measure-run, never migrating the real fleet database; board-counts's three queries extracted so the migrating and read-only branches cannot drift apart"
    requirement: "SHAPE-02"
    verification:
      - kind: unit
        ref: "cargo build -p core --bin uat_authoring_ops"
        status: pass
      - kind: other
        ref: "grep -c open_and_migrate packages/core/tests/bin/uat_authoring_ops.rs == 1"
        status: pass
      - kind: other
        ref: "grep -c 'FLYWHEEL_APP_DATA_DIR is not set' packages/core/tests/bin/uat_authoring_ops.rs == 1"
        status: pass
    human_judgment: false
  - id: D3
    description: "uat-09-product-kill-criterion.mjs: one command per arm, one file, a verdict computed by the criterion's own strict-inequality rule, with the tie/one-half/zero-criteria edges pinned by an offline self-test"
    requirement: "SHAPE-01"
    verification:
      - kind: unit
        ref: "node scripts/uat/uat-09-product-kill-criterion.mjs --self-test (12/12 checks pass)"
        status: pass
      - kind: other
        ref: "node --check scripts/uat/uat-09-product-kill-criterion.mjs"
        status: pass
    human_judgment: false
  - id: D4
    description: "05-VALIDATION.md's Manual-Only Verifications table and 05-SPIKE-FINDINGS.md's Measurement Protocol pointer name commands and evidence files instead of hand-run procedures, closing 05-VERIFICATION.md's two human_needed entries down to one command plus one reading act each"
    requirement: "SHAPE-01"
    verification: []
    human_judgment: true
    rationale: "Whether the ledger reads as genuinely un-run-yet (never implying an arm has already happened) and whether the two remaining human-check judgements are correctly scoped is an editorial/transparency judgment about prose, not something a grep alone proves; the grep-based <verify> checks below cover the structural half (file names present, section not duplicated) but the wording itself needs a human read."

# Metrics
duration: 25min
completed: 2026-09-24
status: complete
---

# Phase 5 Plan 17: Read-Only Kill-Criterion Instrument and Ledger Pointer Summary

**Turned the Product Kill Criterion's hand-run stopwatch-and-transcription protocol into two
read-only Rust CLI subcommands plus a Node comparison script that computes the verdict by the
criterion's own strict-inequality rule and writes both arms to one tracked file.**

## Performance

- **Duration:** 25 min
- **Started:** 2026-09-24T03:16:00Z (approx.)
- **Completed:** 2026-09-24T03:30:36Z
- **Tasks:** 3
- **Files modified:** 7 (1 created, 6 modified)

## Accomplishments

- `list_recent_authoring_runs`/`RecentAuthoringRun` (`packages/core/src/query/authoring.rs`): a
  newest-first, bounded, `id`-tie-broken read of every authoring run — running or closed — so a
  developer finds a run id from the terminal, never off a UI surface. Three new integration tests
  cover the authoring-vs-ordinary-run filter, a closed run's terminal status, and stability under a
  shared `started_at`.
- Two new `uat_authoring_ops` subcommands, `recent-authoring-runs` and `measure-board-counts`,
  dispatched from the SAME early read-only match arm `measure-run` already occupied — restructured
  into one small match rather than three stacked equality checks, with the invariant ("read-only,
  never migrates, never needs the scratch override") stated once in a comment. `board-counts`'s
  three inline count queries were extracted into `board_counts_json` so the migrating and
  read-only branches call the identical statements.
- `scripts/uat/uat-09-product-kill-criterion.mjs`: `computeKillCriterionVerdict` (the criterion's
  own rule — `option-b` only when the in-app arm is STRICTLY slower AND its amendment rate is
  STRICTLY more than one half; `indeterminate`, never a division, on missing minutes, fewer than
  three accepted task proposals, or zero accepted criterion proposals), `renderKillCriterionSheet`
  (every number attributed to board-derived / operator-supplied / instrument-measured), and
  `formatTerminalArmBrief` — all three pure and exercised by a 12-check offline `--self-test`.
  `--list-runs` and `--in-app-run <runId> [--terminal-project <projectId>] [--in-app-minutes <n>]`
  drive the live comparison and write `05-KILL-CRITERION.md`. Listed in `scripts/uat/run-all.sh`
  beside `uat-08`.
- `05-VALIDATION.md`'s Manual-Only Verifications table rewritten so each of its three rows names a
  runnable command, an evidence file, and the one human act left. `05-SPIKE-FINDINGS.md`'s
  Measurement Protocol section gained a one-paragraph pointer at its head naming the instrument,
  with the protocol prose itself left as the normative description and no fabricated result added.

## Task Commits

Each task was committed atomically (Task 1 followed the RED/GREEN TDD cycle):

1. **Task 1 (RED): failing tests for `list_recent_authoring_runs`** — `80763e2` (test)
2. **Task 1 (GREEN): read-only run picker and board-count instruments** — `aaced22` (feat)
3. **Task 2: product kill criterion comparison instrument** — `f5cac2c` (feat)
4. **Task 3: validation ledger points at commands, not procedures** — `811ccf5` (docs)

**Plan metadata:** committed alongside this SUMMARY.

_TDD task (Task 1) produced 2 commits (test → feat); no REFACTOR commit was needed — the GREEN
implementation needed no cleanup pass._

## Files Created/Modified

- `packages/core/src/query/authoring.rs` — `list_recent_authoring_runs` + `RecentAuthoringRun`
- `packages/core/tests/authoring_measurement.rs` — three new tests plus a `with_scratch_worktree_root` fixture guard
- `packages/core/tests/bin/uat_authoring_ops.rs` — two new read-only subcommands, `board_counts_json` extraction, restructured early dispatch match, updated usage header
- `scripts/uat/uat-09-product-kill-criterion.mjs` — new: the comparison instrument
- `scripts/uat/run-all.sh` — lists `uat-09` beside `uat-08`
- `.planning/phases/05-socratic-epic-authoring/05-VALIDATION.md` — Manual-Only Verifications table rewritten
- `.planning/phases/05-socratic-epic-authoring/05-SPIKE-FINDINGS.md` — Measurement Protocol pointer paragraph added

## Decisions Made

- The kill-criterion's verdict formula reads only the in-app arm's own amendment rate (not the
  terminal arm's hand-counted reworded figure), matching `05-SPIKE-FINDINGS.md`'s
  `changes_the_plan_when` clause literally — the terminal arm's reworded count is still captured
  and printed on the sheet for context, but plays no role in the computed verdict.
- `uat-09`'s no-argument invocation exits 3 (SKIP) with a usage line instead of blocking on stdin,
  so listing it in `run-all.sh` never hangs a run with no operator present.
- Task 1's RED phase is a Rust compile error (unresolved import), which is the correct RED
  evidence for a brand-new public function/struct pair — mirrors the precedent already recorded in
  STATE.md for Phase 3's cargo-test RED phases, since `gsd_run check tdd-red-evidence` cannot parse
  `cargo test` output.

## Deviations from Plan

None — plan executed exactly as written. The plan's own read-only contract, threat-model
mitigations, and self-test edge cases were all implemented as specified with no scope changes.

## Issues Encountered

`cargo test --workspace` exceeded the harness's 120-second foreground timeout and was moved to a
background job by the tool; it completed successfully (0 failures) about a minute later while Task
2's work proceeded in parallel. No functional issue — noted only because it is the one place this
plan's execution didn't fit cleanly inside a single foreground command.

## User Setup Required

None — no external service configuration required.

## Next Phase Readiness

- Both of `05-VERIFICATION.md`'s `human_needed` entries now resolve to one command plus one
  reading act each, with a tracked evidence file (`05-LIVE-CHALLENGE-TRANSCRIPT.md`,
  `05-KILL-CRITERION.md`) for the next verification pass to read.
- Neither live arm has actually been run yet — this plan built and proved the instruments
  offline/structurally; running `node scripts/uat/uat-08-socratic-authoring.mjs` and
  `node scripts/uat/uat-09-product-kill-criterion.mjs --list-runs` / `--in-app-run ...` against a
  real `claude` binary and a real epic is the remaining work, exactly as named in this plan's own
  `<human-check>` blocks (Task 3's `<verify>`).
- This is the last plan of Phase 5's gap-closure round (wave 3 of 3, plans 05-14/05-15/05-16
  already landed) — `/gsd-verify-work 05` is the next step once the two live judgements above are
  performed.

## Self-Check: PASSED

- FOUND: scripts/uat/uat-09-product-kill-criterion.mjs
- FOUND: `list_recent_authoring_runs` in packages/core/src/query/authoring.rs
- FOUND: commit 80763e2 (test — RED)
- FOUND: commit aaced22 (feat — GREEN, Task 1)
- FOUND: commit f5cac2c (feat, Task 2)
- FOUND: commit 811ccf5 (docs, Task 3)

---
*Phase: 05-socratic-epic-authoring*
*Completed: 2026-09-24*
