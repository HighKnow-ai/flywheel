---
phase: 13-nothing-new-escapes-the-fence
plan: 11
subsystem: domain
tags: [rust, rusqlite, proposal-cap, run-kind, f1, f6, drft-09, tdd]

requires:
  - phase: 13-06
    provides: the proposal payload and the priority opt-in this cap counts
  - phase: 13-09
    provides: the human-actor gate and its allow-list (create_proposal, amend_proposal, apply_proposal_created deliberately stay ungated)
  - phase: 13-05
    provides: the spine pin and the table-name interpolation gate the shared predicates had to stay clear of
provides:
  - RunKind::classify and run_kind_for, the one Rust definition of run kind
  - RUN_KIND_PLANNING_PREDICATE and RUN_KIND_AUTHORING_PREDICATE, its SQL mirror, spliced by every former inference site
  - proposal_limit(kind), a const fn, execution 10 / planning 30 / authoring 60
  - proposal_limit_refusal(kind), the one source of the refusal's closing clause
  - the D-109 amendment on record as A-05 in PROJECT.md
affects: [phase-14, phase-15, phase-16, planning-runs-that-gain-propose_item]

plan_head_before: b9f3643fa826725b7cf2566f3ffaba68de5c39c7
actuals:
  tokens: 13234
  tasks: 4
  commits: 6

tech-stack:
  added: []
  patterns:
    - "one classifier for a column-shape-derived kind, with SQL predicate consts as its mirror (change together)"
    - "caps as compile-time constants selected by a const fn, never settings (D-69's precedent)"
    - "a refusal's action clause has one const fn source, composed by each door around its own prefix"

key-files:
  created:
    - packages/core/tests/run_kind.rs
    - packages/core/tests/proposal_limit_per_kind.rs
  modified:
    - packages/core/src/domain/agent_run.rs
    - packages/core/src/domain/authoring_proposal.rs
    - packages/core/src/domain/dispatch_plan.rs
    - packages/core/src/query/authoring.rs
    - packages/core/src/query/fleet.rs
    - packages/desktop/src-tauri/src/commands/authoring.rs
    - packages/desktop/src-tauri/src/commands/dispatch.rs
    - packages/core/tests/proposal_limit.rs
    - packages/core/tests/proposal_duplicates.rs
    - .planning/PROJECT.md

key-decisions:
  - "Cap values are execution 10 (D-109, unchanged), planning 30, authoring 60: compile-time constants selected by a const fn, never settings (owner, 2026-10-15)"
  - "Authoring 60 clears the observed 42-draft decomposition with headroom; 100 was rejected because 100 pending items in one run is the unreviewable queue the research round's pitfall 1 warns against"
  - "Planning gets its cap value but no bespoke refusal sentence; it refuses generically (owner, 2026-10-15)"
  - "D-109 amended in PROJECT.md Key Decisions as A-05: the cap is per run kind, execution value unchanged at 10"
  - "No agent_runs.kind column: the defect F6 names is the duplication, which one classifier removes"

patterns-established:
  - "An unscoped agent run is an error to surface, never a run to default a cap onto"
  - "The kind of a run is read from the row already in scope inside the transaction, not by a second query"

requirements-completed: [DRFT-09]

coverage:
  - id: D1
    description: "Run kind has exactly one Rust definition and one SQL mirror; the seven former inference sites use them; no migration"
    requirement: DRFT-09
    verification:
      - kind: integration
        ref: "packages/core/tests/run_kind.rs (17 tests)"
        status: pass
    human_judgment: false
  - id: D2
    description: "F1 reproduced by execution on an 11-proposal authoring fixture before the fix, then inverted"
    requirement: DRFT-09
    verification:
      - kind: integration
        ref: "packages/core/tests/proposal_limit_per_kind.rs#f1_an_authoring_run_is_not_throttled_at_ten_proposals"
        status: pass
    human_judgment: false
  - id: D3
    description: "The cap is per kind (10 / 30 / 60), exercised one below, at and one past the cap for each kind, with a row count that never exceeds the cap"
    requirement: DRFT-09
    verification:
      - kind: integration
        ref: "packages/core/tests/proposal_limit_per_kind.rs#an_execution_run_is_capped_at_ten, a_planning_run_is_capped_at_thirty, an_authoring_run_is_capped_at_sixty"
        status: pass
    human_judgment: false
  - id: D4
    description: "The refusal's wording fits the session: execution keeps report_summary, authoring never names it, planning is generic; one event per refusal carrying the kind's limit"
    requirement: DRFT-09
    verification:
      - kind: integration
        ref: "packages/core/tests/proposal_limit_per_kind.rs (refusal-text, event and notice tests)"
        status: pass
    human_judgment: false
  - id: D5
    description: "The refusal reads sensibly to a real authoring agent in a live session"
    requirement: DRFT-09
    verification: []
    human_judgment: true
    rationale: "The authoring clause points the model at its reply to the developer; whether a live model acts on it as intended is observable only in a real authoring session, not in a unit test"

duration: ~65min across two executors
completed: 2026-10-15
status: complete
---

# Phase 13 Plan 11: Per-kind proposal cap and the one run-kind definition Summary

**The proposal cap is a `const fn` of run kind (execution 10, planning 30, authoring 60), an authoring run is no longer throttled mid-decomposition or told to call a tool it lacks, and run kind has one Rust classifier with a SQL mirror in place of seven independent inferences.**

## Performance

- **Duration:** ~65 min across two executors (the first halted at the Task 3 decision checkpoint)
- **Started:** 2026-10-15T10:00+08:00 (first RED commit)
- **Completed:** 2026-10-15
- **Tasks:** 4
- **Files modified:** 12 (two created)

## Accomplishments

- F6: `RunKind::classify` (plus `run_kind_for`) in `agent_run.rs` is the single definition; `RUN_KIND_PLANNING_PREDICATE` and `RUN_KIND_AUTHORING_PREDICATE` mirror it for SQL. All seven inference sites moved onto them. No migration, no `kind` column.
- F1: confirmed by execution first (Task 2), then fixed. A 42-draft authoring decomposition now stages in full, and the 61st authoring proposal is the first refused.
- DRFT-09: `proposal_limit(kind)` is `const`-asserted to 10 / 30 / 60 in the test file itself, so the "compile-time constant, never a setting" claim is proved by the compiler.
- The refusal clause has one source, `proposal_limit_refusal(kind)`, used by `create_proposal`, the event `label` and the desktop's inbound handler. Execution text is byte-identical to before; authoring never names `report_summary`.
- The D-109 amendment is on record as A-05 in `.planning/PROJECT.md`.

## Task Commits

1. **Task 1: Run kind gets one definition (F6)** (TDD)
   - RED `71f6eae` (test) - compile-order exception, see Deviations
   - GREEN `2fad2bb` (feat)
2. **Task 2: Reproduce F1 by execution** - `333f586` (test)
3. **Task 3: Cap values and the D-109 amendment** - `7ffcfc7` (docs)
4. **Task 4: The per-kind cap and refusal (DRFT-09, F1)** (TDD)
   - RED `e87c702` (test) - compile-order exception, see Deviations
   - GREEN `193463e` (feat)

**Plan metadata:** the SUMMARY commit that carries this file (docs: complete plan).

## Task 2 evidence: F1 reproduced by execution, verbatim

Run against the UNFIXED code (`333f586`), the 11-proposal authoring fixture printed:

```
OBSERVED create_proposal refusal text: run "01M4YNF198G45YD284GD0XNAJT" has already staged 10 of 10 allowed proposals — this one was NOT staged; call report_summary and put it in the remains field instead
OBSERVED apply_proposal_created outcome: LimitExhausted { limit: 10, count: 10 }
OBSERVED refusal event payloads: [... "label": "Refused a new task proposal — this run already holds 10 staged proposals (limit 10)", "limit": 10, "targetType": "task", "title": "Task 10" ..., "title": "Task 11 via the door" ...]
OBSERVED execution refusal text: run "01M4YNF17YGCKFXXVZBKWE5NSF" has already staged 10 of 10 allowed proposals — this one was NOT staged; call report_summary and put it in the remains field instead
```

The defect, stated precisely: an authoring run was refused at 10 (the execution value, D-109), and the refusal text on the `Err` path told it to call `report_summary`, a tool an authoring session does not have. The same `report_summary` instruction is also in the IPC-side `format!` in `commands/authoring.rs`, which is the text the model actually receives.

After the fix (`193463e`), the same fixture stages 11, 12 and a full 42, refuses the 61st with `LimitExhausted { limit: 60, count: 60 }`, and the authoring refusal text ends "...this one was NOT staged; stop staging and list the items you could not stage in your reply to the developer, so they can be taken up in a new session".

## Task 3: owner decision, recorded verbatim (2026-10-15)

- **Cap values (option A):** execution **10** (D-109's value, deliberately unchanged), planning **30** (nominal; planning runs cannot stage proposals today), authoring **60** (clears the one observed datum, a 42-draft authoring session, with headroom).
- **Rationale:** 60 clears the observed 42-draft decomposition; 100 was rejected because 100 pending items in one run is the unreviewable queue the research round's pitfall 1 warns against.
- **The values are compile-time constants selected by a `const fn`, never settings.** No settings key, no `projects` column, no environment override.
- **Planning refusal wording: OMITTED.** Planning has its cap value for the `match` arm but no bespoke refusal sentence, and refuses generically. The reason given: a planning-specific sentence is unreachable through any shipped tool today (the sidecar pre-approves only `submit_plan` for planning runs), so it would be untestable end to end and would rot. Write it later, against a real flow, if planning runs ever gain `propose_item`.
- **D-109 amendment confirmed**, appended to `.planning/PROJECT.md` Key Decisions as **A-05**, dated 2026-10-15, Outcome "Recorded (Phase 13)".

## Files Created/Modified

- `packages/core/src/domain/agent_run.rs` - `RunKind`, `classify`, `as_str`, `run_kind_for`, the two SQL predicate consts
- `packages/core/src/domain/authoring_proposal.rs` - `proposal_limit`, `proposal_limit_refusal`, `PROPOSAL_LIMIT_PER_EXECUTION_RUN`, `PROPOSAL_LIMIT_REFUSAL_GENERIC`; `create_proposal_in_tx` classifies from the row in scope; the module header describes the per-kind cap
- `packages/core/src/domain/dispatch_plan.rs`, `query/authoring.rs`, `query/fleet.rs`, `packages/desktop/src-tauri/src/commands/dispatch.rs` - former inference sites moved onto the classifier and predicates
- `packages/desktop/src-tauri/src/commands/authoring.rs` - the authoring-turn guard moved onto the classifier; the inbound refusal reads the core's per-kind clause
- `packages/core/tests/run_kind.rs` (new, 17 tests), `packages/core/tests/proposal_limit_per_kind.rs` (new, 15 tests)
- `packages/core/tests/proposal_limit.rs`, `packages/core/tests/proposal_duplicates.rs` - fixture follow-ups, see Deviations
- `.planning/PROJECT.md` - the A-05 row

## Decisions Made

- Execution 10 / planning 30 / authoring 60 as `const fn` constants (owner decision, above).
- No `agent_runs.kind` column. `REQUIREMENTS.md` (and 13-CONTEXT) say DRFT-09 "lands with `agent_runs.kind`"; the plan deliberately delivers the same guarantee without a column, because the defect is the duplication and a queryable column would need a table rebuild (five tables reference `agent_runs`). Revisit if a requirement needs to `GROUP BY` run kind in SQL.
- `PROPOSAL_LIMIT_REFUSAL_GENERIC` carries no tool name and no capability claim, and doubles as the desktop handler's floor if a run cannot be classified (not a reachable branch: such a run errors before it can be refused).

## Deviations from Plan

### Carried from the first executor (Tasks 1 and 2)

**1. [Compile-order exception] Task 1's RED failed to compile rather than on an assertion**
- `RunKind`, `run_kind_for` and the two predicate consts did not exist, so `71f6eae` failed with E0432 unresolved imports. No behavioural RED was possible before the type existed. Stated, not faked.

**2. [Scope] Seven inference sites, not the plan's four**
- The plan named four SQL sites. Three more were Rust-side: `resolve_planning_run` (`dispatch_plan.rs`), `fleet.rs::subject_kind`, and the authoring-turn guard in `commands/authoring.rs` (~line 1239). All seven moved onto `RunKind::classify` because the criterion is "one definition". `fleet` still draws an unscoped run as `Authoring`, as before.

**3. [Rule 3 - Blocking] `concat!` cannot take a `const`**
- The predicates are spliced with `format!`. The 13-05 table-name gate only fires on `FROM|INTO|UPDATE|JOIN {`, so it stays silent. Every `LIMIT` is preserved.

**4. [Acceptance count] The `authoring_stage IS NULL` grep reports 1, not 0**
- The hit is the immutable `CHECK` in `0010_authoring_runs.sql`, reached because the grep scans `packages/core/src` including `.sql` migrations. The Rust non-comment count is 0 for both predicate texts. The predicate-const count in `agent_run.rs` is 4.

**5. [Acceptance count] `run_kind.rs` has 17 tests, not the 9 minimum**
- The two desktop-crate sites (`planning_run_for_epic`, `find_running_authoring_run`) are `pub(crate)` and unreachable from a core integration test. They are covered through the shared predicates' semantic tests plus `cargo check --workspace`.

**6. [Rule 1 - Bug in the plan] Task 2's label/tool-name assertion was wrong**
- Task 2 asserted the refusal event's `label` contains the tool name. It does not: the label carries no tool name. `report_summary` is in `create_proposal`'s `Err` text and in the IPC-side `format!` in `commands/authoring.rs` (~line 1375). The first executor pinned the defect on the `Err` text instead, and that stays.

### This executor (Tasks 3 and 4)

**7. [Rule 3 - Blocking] `proposal_limit.rs` const rename**
- **Found during:** Task 4. **Issue:** that file imports `PROPOSAL_LIMIT_PER_RUN` and asserts it equals 10; the constant is removed by the plan, so it would not compile. **Fix:** renamed to `PROPOSAL_LIMIT_PER_EXECUTION_RUN` throughout. The file uses only execution runs, so its behaviour is unchanged (12 tests pass). **Committed in:** `193463e`.

**8. [Rule 3 - Blocking] `proposal_duplicates.rs` throwaway run was unscoped**
- **Found during:** Task 4 verification (9 of 16 tests failed: "agent run is unscoped"). **Issue:** `seed_throwaway_run` writes an `agent_runs` row with no task, epic or stage; the classifier, by the plan's own `<behavior>` ("an error ... rather than defaulting"), now refuses to put a cap on it. **Fix:** the fixture row carries `authoring_stage = 'decompose'`, the cheapest scope needing no task or epic row (adding either would perturb the bm25 statistics that file was measured against). No production code path creates an unscoped run. **Committed in:** `193463e`.

**9. [Compile-order exception] Task 4's RED failed to compile**
- `e87c702` failed with E0425/E0432: `proposal_limit`, `proposal_limit_refusal` and `PROPOSAL_LIMIT_PER_EXECUTION_RUN` did not exist. Same reason as deviation 1. Because Task 2's defect assertions are inverted in place in the same commit, there is no earlier behavioural RED beyond Task 2's own pre-fix run.

**10. [Owner decision overriding Task 4's wording] Planning refusal is generic**
- Task 4 said a planning run's refusal "names what a planning session can actually do". The owner decided at the Task 3 checkpoint to omit planning-specific copy. `RunKind::Planning` maps to `PROPOSAL_LIMIT_REFUSAL_GENERIC` ("stop proposing; this run can stage no more"), asserted to name no tool.

**11. [Plan file not changed] `query/authoring.rs` needed no edit in Task 4**
- The plan expected `proposal_limit_notices` to take a kind-specific limit. It already reads each run's limit off its own `proposal.limit_exhausted` event payload (`MAX(json_extract(payload,'$.limit'))`), and that payload now carries the kind's limit. Its `limit` parameter is the row clamp, not the cap. The behaviour is asserted by `the_notice_reports_the_runs_own_kind_specific_limit` (10 for execution, 60 for authoring). The file was edited in Task 1 only.

**12. [Wording] The desktop's inbound refusal text changed punctuation**
- Before: "...this one was NOT staged. Call report_summary and put it in the remains field instead." After: "...this one was NOT staged; {clause}", so that core and IPC compose around the same clause. For an execution run the words are identical, with a semicolon and a lowercase "call". The core's `create_proposal` `Err` is byte-identical to before (asserted).

**13. [Rename] The inverted F1 test is `f1_an_authoring_run_is_not_throttled_at_ten_proposals`**
- The plan named it `..._is_throttled_at_ten_proposals (inverted in Task 4)`. Keeping the name on an inverted assertion would mislead, so it is renamed in place, not deleted.

**14. [Plan scope] The event `label` now ends with the per-kind clause**
- As Task 4 specifies. This changes the human-facing label for execution runs too (it now ends "; call report_summary and put it in the remains field instead"). No existing test pinned the old label text.

**15. [Verification scope] `cargo test -p core` was not run in full**
- It relinks ~125 binaries on a Gatekeeper-enabled machine and is unusable here. In its place: 33 binaries run with `--no-fail-fast`, all green with non-zero counts: `authoring_acceptance`, `authoring_board_read`, `authoring_criterion_reachability`, `authoring_distillation`, `authoring_lifecycle`, `authoring_measurement`, `authoring_proposal` (42), `authoring_stage`, `authoring_stage_marker_contract`, `authoring_tracer`, `authority_human_only` (28), `criteria`, `db_bootstrap`, `discard_lifecycle`, `epic_context_packet`, `estimate_absent`, `migration_safety`, `no_agent_status_write` (8), `pm_vocabulary_gate` (4), `priority_is_opt_in` (4), `proposal_channel`, `proposal_duplicates` (16), `proposal_limit` (12), `proposal_limit_per_kind` (15), `proposal_no_promotion` (12), `proposal_triage_verbs` (18), `run_kind` (17), `runtime_context_call_sites`, `scope_widen` (28), `spine_pin` (4), `summary_report_wire`, `table_classification`. `cargo check --workspace` passes; its one warning (`StartRunOutcome` unread fields) is pre-existing and unrelated.

---

**Total deviations:** 15 (3 Rule 3 blocking, 1 Rule 1 plan bug, 2 compile-order REDs, 1 owner-decision override, the rest scope, count and wording notes)
**Impact on plan:** None changes what the plan set out to achieve. The two substantive consequences are the seven-site scope (more thorough than asked) and the unscoped-run strictness, which surfaced one fixture that had been relying on a run belonging to nothing.

## Issues Encountered

None beyond the deviations. Task 4's first verification run exposed deviation 8 across nine `proposal_duplicates` tests; a second run with `--no-fail-fast` confirmed no other binary relied on an unscoped run.

## Authentication Gates

None.

## Known Stubs

None.

## Threat Flags

None. No new endpoint, auth path or schema change. The plan's register is mitigated: T-13-53 (authoring 60 > 42), T-13-54 (fixed constants, row count asserted never above the cap), T-13-55 (one clause source, authoring omits the execution-only tool, asserted), T-13-56 (`COUNT(*)` and `>=` untouched inside the INSERT's transaction), T-13-57 (one event per refusal, asserted with the kind's limit).

## User Setup Required

None - no external service configuration required.

## Next Phase Readiness

This is the last plan of Phase 13. The phase is ready for verification. Two owner-deferred Phase 14 gaps were deliberately not touched: epic status has no UI writer, and `task_set_status`/`epic_set_status` are registered with no caller. If planning runs ever gain `propose_item`, write a planning-specific refusal clause against that real flow and replace `PROPOSAL_LIMIT_REFUSAL_GENERIC` in the `Planning` arm.

---
*Phase: 13-nothing-new-escapes-the-fence*
*Completed: 2026-10-15*
