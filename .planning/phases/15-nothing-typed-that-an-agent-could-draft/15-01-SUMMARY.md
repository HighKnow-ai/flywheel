---
phase: 15-nothing-typed-that-an-agent-could-draft
plan: 01
subsystem: authoring
tags: [rust, rusqlite, sqlite, authoring-proposals, lint, acceptance-criteria, tdd]

requires:
  - phase: 13-nothing-new-escapes-the-fence
    provides: "create_proposal_in_tx as the one staging write path, the per-run proposal cap and its committed refusal event (T-06-22)"
  - phase: 05-socratic-epic-authoring
    provides: "authoring_proposals staging table, accept_proposal, D-77 revision chain on acceptance_criteria"
provides:
  - "criterion_lint::lint_statement / CriterionRefusal (Compound, VagueVerb, NoObservable) and three rule-corpus consts"
  - "ProposalOutcome::LintRefused: a lint-failing criterion draft leaves no authoring_proposals row and no event, for every caller"
  - "F3 closed at the domain layer: a criterion draft whose target_id names an existing task or epic accepts with no parent proposal"
  - "OPEN_DRAFTS_PER_PROJECT = 30: pending explicit-tier cap counted in the INSERT's transaction, refusal reuses proposal.limit_exhausted"
  - "limit_refusal_text: one sentence builder that tells the project cap from the per-run cap for both relay doors"
  - "ProposalPayload::Criterion.pinned_revision and StaleDraftRefusal: an amend draft pins its target's revision and is refused on accept when it moved"
affects: [15-02, 15-03, 15-04, 15-05, 15-06, drafting-engine, launch-sheet, project-gauge]

actuals:
  tokens: 21800
  tasks: 3
  commits: 5

tech-stack:
  added: []
  patterns:
    - "Lint and cap both hang at create_proposal_in_tx before the INSERT, so no-bypass is a database fact across callers"
    - "Server-side pin: the caller's pinned_revision is overwritten inside the transaction, like origin_log_offset"
    - "serde(default) + skip_serializing_if on a payload field: no migration, wire shape unchanged while absent"

key-files:
  created:
    - packages/core/src/criterion_lint.rs
    - packages/core/tests/criterion_draft_tracer.rs
    - packages/core/tests/open_drafts_cap.rs
    - packages/core/tests/draft_revision_pin.rs
  modified:
    - packages/core/src/domain/authoring_proposal.rs
    - packages/core/src/lib.rs
    - packages/desktop/src-tauri/src/commands/authoring.rs
    - packages/core/tests/bin/uat_authoring_ops.rs

key-decisions:
  - "Lint refusal appends no event (unlike the cap refusal): nothing was turned away for a budget reason, the draft never happened"
  - "The project cap is checked after the per-run cap and before validation and lint, so a draft at the cap gets LimitExhausted rather than LintRefused"
  - "The pin is the target row's own revision at draft time; the accept check compares it with the head of the revision chain (COALESCE(revision_of, id) root, superseded_at IS NULL)"
  - "An in-place edit of an unlocked criterion does not bump revision, so it does not trip the pin; D-26 names revision as the only signal"
  - "A human amend of a pending draft carries the existing pin over, since the editor never sends one"

patterns-established:
  - "Refusal text lives in one core helper (limit_refusal_text) shared by create_proposal and the desktop inbound handler"
  - "RED evidence for cargo tests is checked by transcribing the real cargo output into the TAP shape check tdd-red-evidence reads"

requirements-completed: [DRFT-02, DRFT-08, DRFT-10]

coverage:
  - id: D1
    description: "A criterion can be drafted for a hand-made task and accepts onto it with no parent proposal (F3 / DRFT-10, domain layer)"
    requirement: DRFT-10
    verification:
      - kind: integration
        ref: "packages/core/tests/criterion_draft_tracer.rs#a_clean_draft_for_a_hand_made_task_accepts_onto_it_with_no_parent_proposal"
        status: pass
      - kind: integration
        ref: "packages/core/tests/criterion_draft_tracer.rs#a_criterion_with_neither_a_parent_proposal_nor_a_resolvable_target_still_errors_at_accept"
        status: pass
    human_judgment: false
  - id: D2
    description: "A lint-failing criterion draft is refused verbatim inside create_proposal_in_tx with no row and no event, through both the direct and the inbound-event door"
    requirement: DRFT-02
    verification:
      - kind: integration
        ref: "packages/core/tests/criterion_draft_tracer.rs#a_lint_failing_draft_for_a_hand_made_task_leaves_no_row_and_no_event"
        status: pass
      - kind: integration
        ref: "packages/core/tests/criterion_draft_tracer.rs#the_inbound_event_door_refuses_the_same_draft_through_the_same_statement_site"
        status: pass
      - kind: unit
        ref: "packages/core/src/criterion_lint.rs#tests"
        status: pass
    human_judgment: false
  - id: D3
    description: "Pending explicit-tier drafts are capped at 30 per project; the refusal commits one event, pauses nothing, and no refusal consumes a slot"
    requirement: DRFT-08
    verification:
      - kind: integration
        ref: "packages/core/tests/open_drafts_cap.rs"
        status: pass
    human_judgment: false
  - id: D4
    description: "An amend draft accepted against a moved parent revision is refused with the pinned and current revisions and statements; an unrelated board change never refuses"
    requirement: DRFT-02
    verification:
      - kind: integration
        ref: "packages/core/tests/draft_revision_pin.rs"
        status: pass
    human_judgment: false
  - id: D5
    description: "The lint rule corpora are a usable floor: they reject the slop an agent drafts without rejecting the criteria worth keeping"
    verification: []
    human_judgment: true
    rationale: "The corpora are keyword floors (D-22 leaves wording to discretion). Whether they refuse too much or too little against real planner output is only visible against live drafts, which D-27's revision rate measures later."

duration: 112min
completed: 2026-10-16
status: complete
plan_head_before: aed5a095eb950d6d07f5ab2af5447f1407632817
---

# Phase 15 Plan 01: Criterion drafting tracer, lint, project cap and revision pin Summary

**A deterministic criterion lint and a 30-draft project cap both enforced inside `create_proposal_in_tx` before the INSERT, hand-made-task criterion drafting without a parent proposal, and a server-side revision pin that refuses stale amend drafts with a four-fact diff.**

## Performance

- **Duration:** 112 min (most of it cold and incremental Rust builds)
- **Started:** 2026-10-16T02:15:55Z
- **Completed:** 2026-10-16T04:08:31Z
- **Tasks:** 3 (1 tracer, 2 TDD)
- **Files modified:** 16 (4 created)

## Accomplishments

- **Tracer proven first.** `create_proposal` for a criterion whose `target_id` is a `create_task` task, `parent_proposal_id = None`: a compound statement is refused with the statement verbatim and `authoring_proposals` / `proposal.created` stay at zero; a clean one stages and `accept_proposal` writes `acceptance_criteria` with `('task', <that task>)`. The inbound `proposal_created` door hits the same refusal.
- **`criterion_lint`** (pure, no I/O): `Compound`, `VagueVerb`, `NoObservable` over three module-level corpora. It returns the refusal, never a corrected string.
- **F3 closed.** `materialise_proposal`'s `("create", Criterion)` arm resolves the parent from the proposal's own `target_id` (task, then epic, via `target_row_exists`) when no parent proposal exists. The parent-proposal branch and the `task|epic` guard are intact and `create_criterion_in_tx` is still the only writer.
- **Project cap.** `OPEN_DRAFTS_PER_PROJECT = 30`, declared once. 30th pending criterion draft stages, 31st returns `LimitExhausted { limit: 30, count: 30 }` with one committed `proposal.limit_exhausted` event and no run-status write. A rejected row frees exactly one slot; a lint refusal and a provisional `Task` draft consume nothing.
- **Revision pin.** `ProposalPayload::Criterion.pinned_revision` is set inside the transaction for `amend` drafts and checked before materialise. `StaleDraftRefusal` carries pinned revision, current revision, pinned statement and current statement. No migration (still 24).

## Task Commits

1. **Task 1: tracer, lint and F3** - `0f18747f` (feat)
2. **Task 2: open-drafts cap** - `5a9e0d04` (test, RED) then `07cbf860` (feat, GREEN)
3. **Task 3: revision pin** - `4a5a14f7` (test, RED) then `dc056bfe` (feat, GREEN)

**Plan metadata:** committed with this SUMMARY (docs).

## TDD Gate Compliance

Both TDD tasks have a `test(15-01)` commit before the `feat(15-01)` commit. RED was verified with `gsd check tdd-red-evidence`, returning `RED_EVIDENCE_OK / target_test_failed` for `the_thirtieth_pending_draft_stages_and_the_thirty_first_is_refused` (5 of 7 tests failed on assertions) and `accepting_against_a_moved_revision_is_refused_with_the_four_facts` (5 of 8 failed). The checker reads node TAP, so the real cargo output was transcribed into the `ok N - name` / `# fail N` shape first. Each RED commit also carries the minimum to compile (the `OPEN_DRAFTS_PER_PROJECT` declaration; the `pinned_revision` field and `pinned_revision: None` on existing literals) with no enforcement. No REFACTOR commit was needed.

## Files Created/Modified

- `packages/core/src/criterion_lint.rs` - the lint, refusal enum with `Display`, three corpora, unit tests
- `packages/core/src/domain/authoring_proposal.rs` - `LintRefused`, lint call, F3 arm, project cap, `limit_refusal_text`, `pinned_revision`, `StaleDraftRefusal`, `check_pinned_revision`, pin carry-over in `amend_proposal`
- `packages/core/src/lib.rs` - declares `criterion_lint`
- `packages/desktop/src-tauri/src/commands/authoring.rs` - relays `LintRefused`; uses `limit_refusal_text`
- `packages/core/tests/bin/uat_authoring_ops.rs` - handles `LintRefused` in both outcome matches
- `packages/core/tests/{criterion_draft_tracer,open_drafts_cap,draft_revision_pin}.rs` - the three database-reading test targets

## Decisions Made

See `key-decisions` above. The one worth restating: a draft that arrives at the cap with a failing statement gets `LimitExhausted`, not `LintRefused`, because the plan places the cap before validation. Both leave no row.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 3 - Blocking] Existing fixtures staged criteria the new lint refuses**
- **Found during:** Task 1
- **Issue:** The acceptance corpus drafted statements like "Must work", "Child", "First", "Retry budget is configurable". The plan requires that corpus to stay green and the lint to run in `create_proposal_in_tx` for every caller, so the two could not both hold.
- **Fix:** Reworded those statements to lint-clean criteria by exact-literal replacement per file (both construction and assertion sides moved together). No assertion logic changed. Contractions (`'`) were removed from the lint's "quoted literal" set so "developer's" no longer counts as an observable.
- **Files modified:** `authoring_acceptance.rs`, `authoring_proposal.rs`, `authoring_measurement.rs`, `authoring_lifecycle.rs`, `authoring_tracer.rs`, `proposal_no_promotion.rs`, `authoring_criterion_reachability.rs`
- **Verification:** all 18 existing authoring/proposal test targets green
- **Committed in:** `0f18747f`

**2. [Rule 3 - Blocking] A third exhaustive `ProposalOutcome` match**
- **Found during:** Task 1
- **Issue:** The plan says the enum is matched in two relay sites. `packages/core/tests/bin/uat_authoring_ops.rs` (a `[[bin]]` target) matches it exhaustively in two places and would fail `cargo check --workspace`.
- **Fix:** Added a `LintRefused` arm to both, printing `"outcome": "lint_refused"`.
- **Committed in:** `0f18747f`

**3. [Rule 3 - Blocking] 41 struct-literal and pattern sites for the new payload field**
- **Found during:** Task 3
- **Issue:** Adding `pinned_revision` to `ProposalPayload::Criterion` breaks every literal and every destructuring pattern.
- **Fix:** Mechanical `pinned_revision: None` / `..` across 9 test files and 4 sites in `authoring_proposal.rs`.
- **Committed in:** `4a5a14f7`, `dc056bfe`

**4. [Rule 1 - Bug] The project-cap refusal would have been relayed as a per-run refusal**
- **Found during:** Task 2
- **Issue:** `create_proposal` and the desktop handler both formatted `LimitExhausted` as "run X has already staged N of LIMIT" with a run-kind clause. For the project cap that sentence names the wrong cap and the wrong count.
- **Fix:** Added `limit_refusal_text` in core and used it in both doors. The per-run wording is unchanged for the run cap (the desktop sentence now reads `run "<id>" has already staged ...` rather than `this run has already staged ...`).
- **Committed in:** `07cbf860`

**5. [Rule 2 - Missing critical] Human amend would have erased the pin**
- **Found during:** Task 3
- **Issue:** `amend_proposal` replaces the payload wholesale and the editor never sends `pinned_revision`, so one human edit would silently turn a pinned draft into an unpinned one.
- **Fix:** `amend_proposal` carries the existing pin over; covered by a test.
- **Committed in:** `dc056bfe`

---

**Total deviations:** 5 auto-fixed (1 bug, 1 missing critical, 3 blocking)
**Impact on plan:** All necessary for the stated acceptance criteria. No scope creep beyond the files above.

## Issues Encountered

- Cold `cargo check --workspace` builds took 8 to 30 minutes each; test runs were scoped per target as instructed.
- The branch is not `agent-*` named and `.git` is a file, so the worktree allow-list assertion in the commit protocol would trip. I followed the orchestrator's explicit instruction to commit sequentially on this branch (`ISOLATION=none`); the default-branch check (`git.base-branch --is-protected`) returned `false`.

## Known Limitations

- The lint corpora are keyword floors; calibration against real planner output is open (see coverage D5).
- The pin does not detect an in-place edit of an unlocked criterion, because that does not bump `revision` (D-26 names revision only). D-28's post-accept revision rate is the instrument that would show it matters.
- `file_set` is in the cap's `IN (...)` list but is not yet a `ProposalTargetType`; plan 15-05 joins it.
- Nothing outside the domain layer was done: no launch-sheet routing, no gauge, no UI. Requirements DRFT-02, DRFT-08 and DRFT-10 are marked complete for this plan's share only; their surface work belongs to later plans.

## User Setup Required

None - no external service configuration required.

## Next Phase Readiness

- 15-02 and 15-03 are independent (disjoint files). Anything that drafts a criterion should go through `create_proposal` or `apply_proposal_created` and will inherit the lint and the cap.
- A planner surfaces `LintRefused.reason` to the agent; the UI gauge for D-17 can read pending explicit-tier rows with the same predicate used here.

## Self-Check: PASSED

All four created files exist on disk and all five commits (`0f18747f`, `5a9e0d04`, `07cbf860`, `4a5a14f7`, `dc056bfe`) exist. Plan-level verification: `cargo check --workspace --all-targets` clean; the three new targets and the 18-target existing corpus (including `spine_pin`, `migration_safety`, `criteria`, `criteria_pin`, `criterion_anchors`) pass; migration count is 24. No stubs found in files touched.

---
*Phase: 15-nothing-typed-that-an-agent-could-draft*
*Completed: 2026-10-16*
