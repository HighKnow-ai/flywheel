---
phase: 06-agents-file-their-own-backlog
plan: 02
subsystem: testing
tags: [rust, sqlite, source-gate, adversarial-corpus, authoring-proposal]

# Dependency graph
requires:
  - phase: 06-agents-file-their-own-backlog (plan 06-01)
    provides: "migration 0015's widened target_type/status vocabularies, ProposalPayload::Issue, ProposalProvenance, the propose_item MCP channel this plan's corpus drives through"
provides:
  - "no_agent_reachable_module_writes_a_canonical_table: a source gate proving no code outside the four canonical-writer domain modules issues a direct INSERT/UPDATE against epics/tasks/issues/acceptance_criteria"
  - "only_three_call_sites_reach_a_canonical_writer_from_the_staging_module: bounds authoring_proposal.rs's own canonical-writer calls to materialise_proposal/accept_proposal_in_tx/merge_proposal_in_tx"
  - "the_no_promotion_gate_actually_reaches_the_frontend_tree: gate-on-the-gate proving the walker collects .ts/.tsx under packages/desktop/src"
  - "domain_issue_contains_no_status_identifier_at_source_level: the source-level proof issue.rs's own header comment already claimed"
  - "a 17-case adversarial CORPUS table (packages/core/tests/proposal_no_promotion.rs) proving zero canonical rows exist before an explicit human triage action, across every verb x target-type combination, both entry routes, three ordering edge cases, and the abandoned-run discretion item"
affects: [06-03, 06-09]

actuals:
  tokens: 13981
  tasks: 2
  commits: 2

tech-stack:
  added: []
  patterns:
    - "Table-driven adversarial corpus: a const CORPUS: &[CorpusCase] of {label, run: fn()} entries, executed via std::panic::catch_unwind so one failing case doesn't hide failures in the rest, with the case label folded into the panic message for loud, unambiguous failure attribution"
    - "Source-gate containment check via a linear 'most recent top-level fn' scan (top_level_fn_name matching column-0 fn/pub fn/pub(crate) fn declarations) rather than a full parser — sufficient to bound which functions may call a named set of writer functions"

key-files:
  created:
    - packages/core/tests/proposal_no_promotion.rs
  modified: []

key-decisions:
  - "Followed 06-02-PLAN.md's literal enumeration for both gates rather than extending it: Gate 1's five forbidden patterns cover INSERT into the four canonical tables plus one UPDATE of acceptance_criteria (no DELETE FROM coverage); Gate 2's nine canonical-writer-call names omit delete_criterion_in_tx. Both omissions are deliberate, not oversights — this pair of gates bounds PROMOTION (turning a proposal into new/changed board substance), not deletion, which each canonical table's own domain module already exclusively owns and which a separate concern (worktree-guard tests, hierarchy_workflow.rs) already covers."
  - "The create/issue corpus case surfaces, rather than works around, a real gap found while writing it: accept_proposal's materialise_proposal match has no arm for (\"create\", ProposalPayload::Issue) — issue proposals materialise via a merge verb plan 06-03 hasn't built yet (per 06-01-SUMMARY.md's own D-101 note). The case asserts accept fails closed (returns Err, proposal stays pending, all four canonical counts untouched) rather than skipping the case or forcing an accept that doesn't yet exist. This is intentional half-finished capability, not a bug — flagged here so 06-03 knows exactly which corpus case starts asserting a successful materialisation once merge_proposal lands."
  - "Reused proposal_channel.rs's seeded_execution_run fixture shape (rather than importing it) to keep this file self-contained per the plan's own explicit instruction and this repo's established source-gate-file precedent (app_exit_ordering.rs/session_closed_call_site.rs each carry their own copy of shared helpers rather than a shared module)."

patterns-established: []

requirements-completed: [PROP-02, PROP-03]

coverage:
  - id: D1
    description: "A source gate proves no agent-reachable module outside the four canonical-writer domain modules writes epics/tasks/issues/acceptance_criteria directly"
    requirement: PROP-03
    verification:
      - kind: unit
        ref: "packages/core/tests/proposal_no_promotion.rs#no_agent_reachable_module_writes_a_canonical_table"
        status: pass
    human_judgment: false
  - id: D2
    description: "Authoring_proposal.rs's own canonical-writer calls are bounded to exactly materialise_proposal/accept_proposal_in_tx/merge_proposal_in_tx (the last vacuously true until plan 06-03)"
    requirement: PROP-03
    verification:
      - kind: unit
        ref: "packages/core/tests/proposal_no_promotion.rs#only_three_call_sites_reach_a_canonical_writer_from_the_staging_module"
        status: pass
    human_judgment: false
  - id: D3
    description: "The gate-on-the-gate: the shared sources_under walker provably collects .ts and .tsx sources under packages/desktop/src, closing the empty-scan coverage hole Phase 5 verification found once already"
    verification:
      - kind: unit
        ref: "packages/core/tests/proposal_no_promotion.rs#the_no_promotion_gate_actually_reaches_the_frontend_tree"
        status: pass
    human_judgment: false
  - id: D4
    description: "domain::issue carries no status identifier and no WORKFLOW_STATES reference at the source level, not only against a live database row"
    verification:
      - kind: unit
        ref: "packages/core/tests/proposal_no_promotion.rs#domain_issue_contains_no_status_identifier_at_source_level"
        status: pass
    human_judgment: false
  - id: D5
    description: "The Phase-5 accept-all gate (authoring_proposal.rs) was neither deleted nor weakened by this plan"
    verification:
      - kind: unit
        ref: "packages/core/tests/proposal_no_promotion.rs#the_accept_all_gate_still_passes_unmodified"
        status: pass
      - kind: integration
        ref: "cargo test -p core --test authoring_proposal (42 tests)"
        status: pass
    human_judgment: false
  - id: D6
    description: "A 17-case adversarial corpus proves zero canonical rows exist before triage across create x{task,epic,issue,criterion,assumption}, amend x{task,epic,criterion}, delete x{task,epic,criterion}, a still-pending parent, a target deleted underneath its proposal, three ordering edge cases, and the abandoned-run survival case"
    requirement: PROP-02
    verification:
      - kind: unit
        ref: "packages/core/tests/proposal_no_promotion.rs#every_corpus_case_proves_zero_canonical_rows_before_triage"
        status: pass
      - kind: unit
        ref: "packages/core/tests/proposal_no_promotion.rs#corpus_declares_at_least_14_labelled_adversarial_cases"
        status: pass
    human_judgment: false

duration: 62min
completed: 2026-09-30
status: complete
---

# Phase 6 Plan 2: No Promotion Without Triage Summary

**A source gate plus a 17-case adversarial corpus prove, structurally and empirically, that no agent-reachable code path can turn a staged proposal into a canonical board row without an explicit human accept/accept_subtree — the corpus catching, as a real finding, that accept has no materialisation arm for Issue proposals yet.**

## Performance

- **Duration:** 62 min
- **Started:** 2026-09-30T04:43:00Z (approx.)
- **Completed:** 2026-09-30T05:45:00Z
- **Tasks:** 2
- **Files modified:** 1 (new)

## Accomplishments
- Four source-level gates plus a tripwire, all in one new self-contained test file: no agent-reachable module writes a canonical table directly; only three functions in `authoring_proposal.rs` may reach a canonical writer; the shared walker provably reaches `.tsx`/`.ts` under the frontend tree; `domain::issue` carries no `status` identifier at the source level; the Phase-5 accept-all gate is untouched
- A 17-case table-driven adversarial corpus exercising both entry routes (`create_proposal`, `apply_proposal_created`) across every verb/target-type combination, proving all four canonical-table counts are unchanged before triage and change only as the named triage command promises after
- Three ordering edge cases the plain per-case loop can't express: implied-parent accept (a child criterion accepted before its still-pending parent task materialises the parent exactly once, leaving a third sibling untouched), two siblings forced to share an identical `created_at`, and reject-then-accept refusing the second call
- The abandoned-run discretion item (D-80) is now a test, not an assumption: a pending proposal survives `mark_abandoned` byte-identical, and a new `proposal_created` event against the same run returns `TerminalRun` and stages nothing
- Found (not fixed, per the plan's own instruction) that `accept_proposal` has no materialisation arm for `create`/`Issue` proposals yet — the corpus's issue case asserts the accept attempt fails closed rather than silently promoting or skipping the scenario

## Task Commits

Each task was committed atomically:

1. **Task 1: The source gate, its gate-on-the-gate, and the issues-no-status gate** - `c677a26` (test)
2. **Task 2: The adversarial corpus — every proposal path, zero canonical rows until triage** - `fd25409` (test)

**Plan metadata:** commit follows this SUMMARY

_Note: TDD is not applicable to this plan._

## Files Created/Modified
- `packages/core/tests/proposal_no_promotion.rs` - the four Task-1 source gates, the accept-all tripwire, and the Task-2 17-case adversarial corpus table, all self-contained (own copies of `workspace_root`/`is_whole_line_comment`/`sources_under`, `ready_run`, `seeded_execution_run`)

## Decisions Made

**1. Followed the plan's literal gate scope, not an extended one.** Gate 1's five forbidden patterns (INSERT into each of the four canonical tables, plus one UPDATE of `acceptance_criteria`) carry no `DELETE FROM` coverage; Gate 2's nine canonical-writer-call names omit `delete_criterion_in_tx`. Both are deliberate: these two gates bound *promotion* (a proposal becoming new/changed board substance), not deletion, which is a materially different property already owned by each canonical table's own domain module and exercised elsewhere (`hierarchy_workflow.rs`, the worktree-guard tests). Verified this reading is coherent with the plan's own wording before implementing rather than second-guessing it as an oversight.

**2. The create/issue corpus case surfaces a real gap rather than working around it.** While writing the corpus, `materialise_proposal`'s match arms proved to have no `("create", ProposalPayload::Issue { .. })` case — accepting a staged issue proposal today returns an error naming the unsupported combination. This is intentional half-finished capability (06-01-SUMMARY.md's own Decision 3/D-101 note: issue materialisation lands via a `merge` verb in plan 06-03, not `accept`), not a bug to fix in this plan. The corpus case (`case_create_issue_via_execution_run_task_scoped_null_epic`) asserts the refusal is total — the accept call returns `Err`, the proposal remains `pending`, and every canonical count stays untouched — which is arguably a stronger proof of D-100 than a forced-success path would have been. Flagged here so plan 06-03 knows precisely which corpus case will need extending to assert a successful materialisation once `merge_proposal` exists.

**3. Reused, rather than imported, `proposal_channel.rs`'s execution-run fixture shape.** `seeded_execution_run` (raw-SQL `agent_runs`/`triggers` inserts, no worktree/git dependency) is copied into this file rather than shared, matching both the plan's own explicit self-containment instruction and this repo's established source-gate-file precedent (`app_exit_ordering.rs`/`session_closed_call_site.rs`).

## Deviations from Plan

None - plan executed exactly as written. The create/issue accept-refusal behavior documented in Decision 2 above is a genuine pre-existing gap the corpus was designed to surface, not something this plan introduced or needed to fix — the plan's own `<output>` instruction says exactly this: "If the issues-no-status source gate or the three-call-site gate fails at HEAD, record the finding verbatim rather than weakening the gate." The analogous corpus finding (accept refuses a create/issue proposal) is recorded the same way: as a passing assertion of the refusal, not a masked failure.

## Issues Encountered
None beyond the documented finding above.

## Authentication Gates
None.

## User Setup Required
None - no external service configuration required.

## Next Phase Readiness
- PROP-03 (no promotion without triage) now has machine-checked, structural evidence a verifier can point at, closing the gap `06-01-PLAN.md`'s own frontmatter flagged as "authored descriptor-less, flagged-unverified at the phase level."
- **Shared-ID note:** PROP-02 and PROP-03 are also declared by sibling plans still in flight (06-03, 06-09) — the shared-ID gate (#2388) holds both open in `REQUIREMENTS.md` until every declaring plan finishes, even though this plan's own coverage above is complete.
- **Handoff to plan 06-03:** when `merge_proposal_in_tx` is added, (a) `only_three_call_sites_reach_a_canonical_writer_from_the_staging_module`'s allow-list already names it, no gate change needed; (b) the corpus's `case_create_issue_via_execution_run_task_scoped_null_epic` case will need a sibling case (or an update) asserting a successful merge-driven materialisation, since accept will presumably remain refused for issues while merge becomes the real promotion path.

---
*Phase: 06-agents-file-their-own-backlog*
*Completed: 2026-09-30*

## Self-Check: PASSED

- FOUND: packages/core/tests/proposal_no_promotion.rs
- FOUND: c677a26 (Task 1 commit)
- FOUND: fd25409 (Task 2 commit)
