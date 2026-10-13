---
phase: 04-clear-is-free
plan: 11
subsystem: context-reconstitution
tags: [rust, drift-detection, context-packet, ctx-06]

requires:
  - phase: 04-clear-is-free
    provides: "04-07's DiffSoFar/PacketExtras/assemble_context_packet_with_extras seam and
      diff_stat_and_names; 04-10's criteria_revision_pin_for_run and the None/Some(vec![])
      distinction; 04-08's ContextPacket.compaction/decisions accumulation"
provides:
  - "drift::DriftKind/DriftWarning/DriftInputs/detect_drift — four fact-based detectors
    (claimed-files, staleness, criteria-revision, decision-read-back), pure, no I/O, no
    semantics, run in a fixed order"
  - "context_packet::ContextPacket.drift and render_prompt's '## Warnings' section, placed
    immediately after the task description and before the epic section"
  - "commands::agent_run::packet_extras_for — the command-layer read that composes both the diff
    and the drift from the same git facts, calling detect_drift exactly once and storing nothing"
  - "git::diff_stat_and_names now reads with rename detection disabled (--no-renames), so a
    legitimately moved file appears under both its old and its new path"
affects: [04-12]

actuals:
  tokens: 15723
  tasks: 3
  commits: 3
  plan_head_before: 9c011a6005723bfbc022af0d9d65a090bf0802ba

tech-stack:
  added: []
  patterns:
    - "Fact-only detector module, no fixture, no database (mirrors compaction.rs): DriftInputs
      carries borrowed slices only, detect_drift is a pure function of that struct, and every
      sentence is composed once here so the rendered briefing and any future DTO read the same
      words."
    - "Single-call-site composition seam: packet_extras_for (widened from diff_extras_for) is the
      ONE place in the command layer that reads git and calls detect_drift, reusing the diff
      section's own git reads for the claimed-files and staleness detectors rather than issuing a
      second pair of calls."
    - "None vs empty-set distinction carried end to end: a task with no run yet, or a run
      predating the criteria_revision_pin column, reaches DriftInputs.pinned_criterion_ids as
      None — never as an empty Vec — so the revision detector's silence is structural, not
      coincidental."

key-files:
  created:
    - packages/core/src/drift.rs
    - packages/core/tests/drift.rs
  modified:
    - packages/core/src/lib.rs
    - packages/core/src/context_packet.rs
    - packages/core/src/compaction.rs
    - packages/core/tests/compaction.rs
    - packages/core/src/git.rs
    - packages/core/tests/diff_so_far.rs
    - packages/desktop/src-tauri/src/commands/agent_run.rs

key-decisions:
  - "SummaryEntry (context_packet.rs) gained acknowledged_decisions/diff_ref fields — the plan's
    own detectors need the latest summary's values of both, but the packet's read projection
    never carried them even though session_summaries and SessionSummary already do. Extended
    SUMMARIES_SQL and its row mapping to select them (Rule 3 — a blocking compile gap in the
    plan's own DriftInputs contract, not an addition beyond scope)."
  - "The read-back detector checks unacknowledged ids before fabricated ids, firing at most one
    warning even when a summary both drops a real id and invents a fake one — the plan's own
    'at most one warning per detector' rule left this case implicit; unacknowledged is checked
    first because a real decision going unacknowledged is the more serious integrity failure."
  - "detect_drift's set-difference outputs (entered/left criterion ids) are sorted before
    rendering — HashSet iteration order is not stable across calls even for the same input, so
    without sorting the purity/determinism test would be flaky rather than reliably green."
  - "diff_stat_and_names(--no-renames) resolves 04-CONTEXT.md's open item on renamed files:
    without it, a moved file's old path would never appear in the real changed-path list at all
    (rename detection collapses a move to the new path alone), so an honest agent claim of the
    old path would falsely fire the claimed-files detector on every legitimate move."
  - "head_ref is resolved via git_at(worktree_path, [\"rev-parse\", \"HEAD\"]) directly in
    agent_run.rs rather than adding a dedicated git.rs wrapper function — this is the only call
    site that needs it, and git_at is already the crate's one sanctioned construction site."

requirements-completed: [CTX-06]

coverage:
  - id: D1
    description: "Four fact-based detectors — claimed files, staleness, criteria revision,
      decision read-back — each fires on a set/ref/id comparison alone, in a fixed order, and
      each has a test proving it fires and a test proving it stays quiet"
    requirement: CTX-06
    verification:
      - kind: unit
        ref: "tests/drift.rs (15 Task-1 tests: one fire + one non-fire case per detector, plus
          purity and fixed-order assertions)"
        status: pass
      - kind: other
        ref: "grep -v '^[[:space:]]*//' packages/core/src/drift.rs | grep -cE
          'Command::new|reqwest|ureq|rusqlite|Connection|Utc::now|SystemTime' == 0"
        status: pass
      - kind: other
        ref: "grep -v '^[[:space:]]*//' packages/core/src/drift.rs | grep -ciE
          'similarity|embedding|prompt|completion|llm|fuzzy' == 0"
        status: pass
    human_judgment: false
  - id: D2
    description: "The agent reads the board's observed contradictions before anything else in the
      briefing: a '## Warnings' section renders immediately after the task description and before
      the epic section, present only when drift is non-empty, with a preamble stating these are
      facts to reconcile — not a block"
    requirement: CTX-06
    verification:
      - kind: unit
        ref: "tests/drift.rs#two_warnings_render_both_sentences_before_the_epic_heading"
        status: pass
      - kind: unit
        ref: "tests/drift.rs#no_warnings_renders_no_warnings_heading_at_all"
        status: pass
      - kind: unit
        ref: "tests/drift.rs#two_renders_of_the_same_packet_are_byte_identical_with_warnings_present"
        status: pass
    human_judgment: false
  - id: D3
    description: "Every briefing computes its drift warnings from the current board and the
      current worktree, stores none of them anywhere, and a warning clears by itself the moment
      the underlying fact clears — no write to the summary row required"
    requirement: CTX-06
    verification:
      - kind: unit
        ref: "tests/drift.rs#a_claimed_path_the_real_diff_does_not_contain_produces_a_warning_in_the_assembled_packet"
        status: pass
      - kind: unit
        ref: "tests/drift.rs#the_same_claim_produces_no_warning_once_the_path_really_exists_in_the_diff"
        status: pass
      - kind: other
        ref: "grep -v '^[[:space:]]*//' packages/desktop/src-tauri/src/commands/agent_run.rs |
          grep -c 'detect_drift' == 1"
        status: pass
      - kind: other
        ref: "grep -rv '^[[:space:]]*--' packages/core/src/db/migrations | grep -ciE
          'drift_verdict|drift_status|drift_result' == 0"
        status: pass
    human_judgment: false

duration: 55min
completed: 2026-09-23
status: complete
---

# Phase 4 Plan 11: Drift Detection — Four Fact-Based Detectors, No Model Anywhere Summary

**Four pure detectors (claimed files, staleness, criteria revision, decision read-back) surface board/git contradictions as a `## Warnings` section at the top of every rendered briefing, recomputed from scratch on every assembly and stored nowhere — a legitimately renamed file never falsely fires because `diff_stat_and_names` now reads with `--no-renames`.**

## Performance

- **Duration:** 55 min
- **Started:** 2026-09-23T13:20:00Z (approx.)
- **Completed:** 2026-09-23T14:15:00Z
- **Tasks:** 3
- **Files modified:** 9 (2 created, 7 modified)

## Accomplishments

- `packages/core/src/drift.rs`: `DriftKind` (5 variants), `DriftWarning`, `DriftInputs` (borrowed
  slices only), and `detect_drift` — the four detectors run in a fixed order (claimed files,
  staleness, criteria revision, read-back), each pushing at most one warning per call. No database
  connection, no process spawn, no network call, no clock read, no keyword/model comparison
  anywhere — both grep gates pass.
- `packages/core/src/context_packet.rs`: `ContextPacket.drift: Vec<DriftWarning>` (always empty
  from `assemble_context_packet`, populated only by `assemble_context_packet_with_extras`);
  `PacketExtras.drift`; `render_prompt`'s new `## Warnings` section, placed immediately after the
  task description and before the epic section, with a preamble stating these are facts to
  reconcile rather than a block (D-46/D-74). `SummaryEntry` gained `acknowledged_decisions` and
  `diff_ref` so the detectors can read the latest summary's own values of both.
- `packages/desktop/src-tauri/src/commands/agent_run.rs`: `diff_extras_for` renamed to
  `packet_extras_for` and widened to compute drift from the same git reads already fetched for the
  diff section — the criteria-id set, the run's pin, the real changed-path list, `HEAD`, and
  working-tree dirtiness. Calls `detect_drift` exactly once; a missing worktree row, a vanished
  directory, or a git failure on any read still degrades to no diff section but still runs the two
  detectors that need no git facts (criteria revision, read-back).
- `packages/core/src/git.rs`: `diff_stat_and_names` now passes `--no-renames` on both its `git
  diff` calls — resolving 04-CONTEXT.md's open item on renamed files. A moved file now appears
  under both its old and new path in the real changed-path list, so an honest claim of either side
  matches and the claimed-files detector never cries wolf on a legitimate move.
- `packages/core/tests/drift.rs` (new, 20 tests) and `packages/core/tests/diff_so_far.rs` (+1
  test, +6 compile fixes): every behaviour named in the plan — one fire and one non-fire case per
  detector, purity, fixed ordering, both packet-rendering assertions, and the clears-without-a-
  write proof — plus the rename-detection-disabled proof at the git layer.

## Task Commits

Each task was committed atomically:

1. **Task 1: Four detectors, each firing on a fact it cannot be argued with** - `0d64a7f` (feat)
2. **Task 2: The warning reaches the agent, at the top of the briefing** - `bd5a4ac` (feat)
3. **Task 3: The command layer asks the question — every time, from scratch** - `e9192d1` (feat)

**Plan metadata:** commit follows this SUMMARY.

## Files Created/Modified

- `packages/core/src/drift.rs` - `DriftKind`, `DriftWarning`, `DriftInputs`, `detect_drift`
- `packages/core/tests/drift.rs` - 20 tests across all three tasks
- `packages/core/src/lib.rs` - `pub mod drift;`, alphabetically between `domain` and `git`
- `packages/core/src/context_packet.rs` - `ContextPacket.drift`, `PacketExtras.drift`,
  `render_prompt`'s Warnings section, `SummaryEntry.acknowledged_decisions`/`.diff_ref`
- `packages/core/src/compaction.rs`, `packages/core/tests/compaction.rs` - test-fixture
  `SummaryEntry` constructors updated for the two new fields
- `packages/core/src/git.rs` - `diff_stat_and_names` reads with `--no-renames`
- `packages/core/tests/diff_so_far.rs` - one rename-detection test, six `PacketExtras` literals
  updated for the `drift` field
- `packages/desktop/src-tauri/src/commands/agent_run.rs` - `packet_extras_for` (renamed/widened
  from `diff_extras_for`), `read_worktree_facts`

## Decisions Made

See `key-decisions` in the frontmatter above — summarised: (1) `SummaryEntry` extended with the
two fields the detectors need, since the packet's own read projection never carried them, (2) the
read-back detector checks unacknowledged ids before fabricated ones so it stays within "at most
one warning per detector," (3) set-difference outputs are sorted before rendering so the purity
test is reliably green rather than flaky under `HashSet`'s randomized iteration order, (4)
`--no-renames` on `diff_stat_and_names` resolves the plan's own open item on renamed files, (5)
`HEAD` is resolved via `git_at` directly rather than a new dedicated wrapper function.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 3 - Blocking] `SummaryEntry` lacked the two fields the detectors need**
- **Found during:** Task 1 (writing `drift.rs`'s staleness and read-back detectors against
  `DriftInputs.summaries: &[SummaryEntry]`)
- **Issue:** The plan's own behavior spec requires the staleness detector to read the latest
  summary's `diff_ref` and the read-back detector to read its `acknowledged_decisions` — both
  already exist on `session_summaries`/`SessionSummary`/`SummaryFields`, but `context_packet.rs`'s
  `SummaryEntry` projection never selected either column.
- **Fix:** Added `acknowledged_decisions: Vec<String>` and `diff_ref: Option<String>` to
  `SummaryEntry`, extended `SUMMARIES_SQL` and its row-mapping closure to select and deserialise
  both.
- **Files modified:** `packages/core/src/context_packet.rs`
- **Verification:** `cargo test -p core --test context_packet` (18/18), `cargo test -p core --test
  diff_so_far` (15/15) both stayed green; `cargo build --workspace` clean.
- **Committed in:** `0d64a7f` (Task 1 commit)

**2. [Rule 3 - Blocking] `compaction.rs`'s two `SummaryEntry` test-fixture constructors**
- **Found during:** Task 1 (immediately after fix 1, compiling)
- **Issue:** `packages/core/src/compaction.rs`'s own `#[cfg(test)]` helper and
  `packages/core/tests/compaction.rs`'s `entry()` helper both construct `SummaryEntry` by name —
  fix 1's new required fields broke both.
- **Fix:** Added `acknowledged_decisions: Vec::new()`, `diff_ref: None` to both helpers.
- **Files modified:** `packages/core/src/compaction.rs`, `packages/core/tests/compaction.rs`
- **Verification:** `cargo test -p core --test compaction` (12/12), `cargo test -p core --lib`
  (20/20).
- **Committed in:** `0d64a7f` (Task 1 commit)

**3. [Rule 3 - Blocking] `diff_extras_for`'s `PacketExtras` literal after adding the `drift` field**
- **Found during:** Task 2 (adding `PacketExtras.drift`, running `cargo build --workspace`)
- **Issue:** The one production `PacketExtras { diff: Some(...) }` literal in
  `commands/agent_run.rs` (plan 04-07's `diff_extras_for`) failed to compile once `drift` became a
  required field.
- **Fix:** Added `drift: Vec::new()` to that literal — a minimal, correct interim value, since
  Task 3 (this same plan) fully widens the function to compute real drift.
- **Files modified:** `packages/desktop/src-tauri/src/commands/agent_run.rs`
- **Verification:** `cargo build --workspace` clean.
- **Committed in:** `bd5a4ac` (Task 2 commit)

**4. [Rule 3 - Blocking, self-caught verification gap] `tests/diff_so_far.rs`'s six `PacketExtras` literals**
- **Found during:** Task 3 (running `cargo test -p core --test diff_so_far` before writing the
  rename test)
- **Issue:** Task 2's `PacketExtras.drift` addition also broke six pre-existing literals in
  `packages/core/tests/diff_so_far.rs` (plan 04-07's own diff test suite) — not caught before
  Task 2's commit landed because I re-ran only `cargo test -p core --test context_packet` after
  that change, not the full targeted suite sweep the process asks for. Recorded here rather than
  silently folded in, since it is a real gap in my own Task 2 verification pass, not a plan defect.
- **Fix:** Added `drift: Vec::new()` to all six literals.
- **Files modified:** `packages/core/tests/diff_so_far.rs`
- **Verification:** `cargo test -p core --test diff_so_far` (15/15, including the new rename
  test).
- **Committed in:** `e9192d1` (Task 3 commit)

---

**Total deviations:** 4 auto-fixed (all Rule 3 — blocking compile gaps between the plan's own
behavior spec and the pre-existing struct shapes it builds on; no scope creep, all fixes stay
inside files the plan's own frontmatter or explicit action text already names).
**Impact on plan:** None of the four changed the plan's intended behavior — each closes a gap
between what the plan's own detectors/tests require and what the pre-existing code already
carried.

## Issues Encountered

- **Pre-existing, unrelated test flakiness in `packages/core/tests/worktree_lifecycle.rs`.**
  `cargo test --workspace` (no filter) stopped at
  `a_worktree_survives_two_runs_with_an_epic ... FAILED` (`fatal: could not create leading
  directories of '.../.git': Invalid argument` — the same env-var race this phase's project notes
  already document). Confirmed out of scope: this plan touches no file under
  `domain::worktree`/`git.rs`'s worktree functions, and `cargo test -p core --test
  worktree_lifecycle` passes 2/2 in isolation. `cargo test --workspace --no-fail-fast -- --skip
  a_worktree_survives_two_runs_with_an_epic` then completed with 56 `test result: ok` blocks and
  zero other failures across every crate (core, desktop, shim, relay_client). Not auto-fixed
  (out of scope, per the deviation rules' scope boundary) — left as-is, matching this same phase's
  own prior precedent (04-10-SUMMARY.md).

## User Setup Required

None - no external service configuration required.

## Next Phase Readiness

- D-72/D-73/D-75/CTX-06 are structurally in place: four fact-based detectors exist, each proven to
  fire and to stay quiet; nothing is stored anywhere (a grep gate over the migrations directory
  asserts this); the agent reads the warnings before anything else in the briefing; a legitimately
  moved file never falsely fires; a run predating the criteria pin never fires the revision
  detector.
- CTX-06 is a shared requirement id, also declared by plans 04-10 and 04-12
  (`requirements.ready-ids` will hold it at "Gaps Found" until 04-12 finishes too, per 04-10's own
  Next Phase Readiness note).
- `drift::DriftWarning`/`DriftKind`/`detect_drift` and `PacketExtras.drift` are the exact seam plan
  04-12 needs for the board-visible signal, the activity-trail event and the project-rail count —
  no interface gap to close.
- No blockers for 04-12.

---
*Phase: 04-clear-is-free*
*Completed: 2026-09-23*

## Self-Check: PASSED

- FOUND: packages/core/src/drift.rs
- FOUND: packages/core/tests/drift.rs
- FOUND: packages/core/src/context_packet.rs
- FOUND: packages/core/src/git.rs
- FOUND: packages/desktop/src-tauri/src/commands/agent_run.rs
- FOUND commit 0d64a7f in git log
- FOUND commit bd5a4ac in git log
- FOUND commit e9192d1 in git log
- `cargo test -p core --test drift`: 20 passed, 0 failed
- `cargo test -p core --test diff_so_far`: 15 passed, 0 failed
- `cargo test -p core --test context_packet`: 18 passed, 0 failed
- `cargo test -p core --test compaction`: 12 passed, 0 failed
- `cargo build --workspace`: clean
- `cargo test --workspace --no-fail-fast -- --skip a_worktree_survives_two_runs_with_an_epic`:
  56 "test result: ok" blocks, 0 FAILED, exit code 0 (the one skipped test independently
  confirmed passing in isolation — see Issues Encountered)
