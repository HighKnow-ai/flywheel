---
phase: 13-nothing-new-escapes-the-fence
plan: 09
subsystem: authority
tags: [rust, sqlite, rusqlite, source-gate, fnc-03, two-sided-gate]

requires:
  - phase: 13-07
    provides: single-writer tasks.status and the no_agent_status_write gate
  - phase: 13-05
    provides: spine pin, table classification, the no-promotion corpus and gate
  - phase: 13-06
    provides: todo floor, acceptance transaction, priority allowlist
provides:
  - actor::assert_human_actor_in_tx / assert_human_actor, the database-level refusal of a non-human actor
  - authority_human_only.rs, a two-sided behaviour and source gate over every authority writer
  - a canonical-write gate widened to UPDATE tasks/epics SET with an exact-match allow-list
  - 13-AUTHORITY-ALLOWLIST.md, the committed disposition of the three write-past-the-gate sites
affects: [phase-14, phase-16-adr-acceptance]

plan_head_before: 2fd45397f5a741975a4989a6a3eb68d248ee8f8d
actuals:
  tokens: 21000
  tasks: 3
  commits: 4

tech-stack:
  added: []
  patterns:
    - "Authority precondition: read actors.type in the write transaction as the first statement, exact match on 'human'"
    - "Macro-declared case table that generates a refusal/not-blocked test pair per writer and asserts the table equals a declared writer list"

key-files:
  created:
    - packages/core/tests/authority_human_only.rs
    - .planning/phases/13-nothing-new-escapes-the-fence/13-AUTHORITY-ALLOWLIST.md
  modified:
    - packages/core/src/domain/actor.rs
    - packages/core/src/domain/acceptance_criterion.rs
    - packages/core/src/domain/task.rs
    - packages/core/src/domain/authoring_proposal.rs
    - packages/core/tests/proposal_no_promotion.rs

key-decisions:
  - "The refusal reads actors.type inside the write transaction; 'human' is the only accepting value, so system is refused as surely as an agent, and an unknown or empty id is refused as not found rather than defaulted to the local human."
  - "Bulk and subtree verbs check the actor up front as well as in the per-row writer, so an agent is refused even when there is nothing left to decide."
  - "Parent-touch statements in acceptance_criterion.rs are allow-listed (not refactored) and the file-level skip for that module no longer covers UPDATE tasks/epics SET, so the allow-list is load-bearing."
  - "amend_proposal is not gated: it decides nothing and promotes nothing, and the plan did not list it."

patterns-established:
  - "Two-sided gate files: refusal and not-blocked are generated together by one macro so neither direction can be dropped"

requirements-completed: [FNC-03]

coverage:
  - id: D1
    description: "Every authority writer refuses an agent actor at the database and leaves the board byte-for-byte unchanged"
    requirement: FNC-03
    verification:
      - kind: unit
        ref: "packages/core/tests/authority_human_only.rs#<writer>::an_agent_is_refused_and_nothing_is_written (x10)"
        status: pass
    human_judgment: false
  - id: D2
    description: "A human performing each authority transition is not blocked and the full effect lands"
    requirement: FNC-03
    verification:
      - kind: unit
        ref: "packages/core/tests/authority_human_only.rs#<writer>::a_human_is_not_blocked_and_the_full_effect_lands (x10)"
        status: pass
    human_judgment: false
  - id: D3
    description: "The system actor, an unknown id and an empty id are refused with distinguishable reasons"
    requirement: FNC-03
    verification:
      - kind: unit
        ref: "packages/core/tests/authority_human_only.rs#the_system_actor_is_refused_not_treated_as_human, an_unknown_actor_id_is_refused_as_not_found, an_empty_actor_id_is_refused_as_not_found_never_defaulted_to_the_local_human"
        status: pass
    human_judgment: false
  - id: D4
    description: "No agent-reachable module (core, Tauri, sidecar) calls an authority writer; the gate fires on a planted call"
    requirement: FNC-03
    verification:
      - kind: unit
        ref: "packages/core/tests/authority_human_only.rs#no_agent_reachable_module_calls_an_authority_writer, the_authority_gate_fires_on_a_planted_call, the_sidecar_tree_is_scanned_and_nothing_in_it_is_allow_listed"
        status: pass
    human_judgment: false
  - id: D5
    description: "The three write-past-the-gate sites each have a recorded disposition, and the gate now catches their class"
    requirement: FNC-03
    verification:
      - kind: unit
        ref: "packages/core/tests/proposal_no_promotion.rs#no_agent_reachable_module_writes_a_canonical_table, the_canonical_update_gate_fires_on_a_planted_parent_touch, every_allowlisted_update_site_still_exists"
        status: pass
    human_judgment: false
  - id: D6
    description: "Concurrent human and agent attempts each get their own verdict"
    requirement: FNC-03
    verification: []
    human_judgment: true
    rationale: "Backstop by design (must_haves verification: backstop). The check is a per-call in-transaction read of the named actor's type; a real two-connection interleaving test is deferred to lock_contention.rs if the owner wants it measured."

duration: ~55min
completed: 2026-10-15
status: complete
---

# Phase 13 Plan 09: Authority reachable only from a human Summary

**Every authority writer now reads `actors.type` inside its own write transaction and refuses anything but `'human'`, proven in both directions by a macro-generated 28-test file, with the canonical-write gate widened to the `UPDATE tasks/epics SET` class and its two allow-listed exceptions recorded.**

## Performance

- **Duration:** ~55 min (wall clock dominated by Gatekeeper scans and one 6 min workspace check)
- **Completed:** 2026-10-15
- **Tasks:** 3 (executed RED/GREEN per task, so 4 commits)
- **Files modified:** 7

## Accomplishments

- `actor::assert_human_actor_in_tx` (and a connection form) is the one precondition. Called first by `write_checked` (covers `toggle_criterion` and `check_criterion_with_anchor`), `request_changes`, and the four proposal decision writers (`accept_proposal_in_tx`, `merge_proposal_in_tx`, `defer_proposal_in_tx`, `reject_proposal_in_tx`), plus up-front in `accept_subtree` and both bulk verbs. Not called from reads, from `create_proposal` / `apply_proposal_created`, or from the deriver.
- `authority_human_only.rs`: 28 tests. Ten writers, each with an agent-refused test (board byte-for-byte unchanged) and a human-not-blocked test (hard assert that the effect landed), the system / unknown / empty edges run across all ten writers, a helper unit test, and the source half.
- The source half scans core, the Tauri tree and the sidecar tree. The only allowed callers are the declaring domain modules and the human-facing Tauri command modules. `commands/agent_run.rs` is allowed for a `#[cfg(test)]` fixture only, enforced by line position. Nothing under `packages/sidecar/src` can be allow-listed.
- The canonical-write gate now matches `UPDATE tasks SET` / `UPDATE epics SET`. `task.rs` and `epic.rs` own them; the module-wide skip for `acceptance_criterion.rs` no longer covers them, so its two `updated_at` touches are held by an exact (file, pattern) allow-list entry each. A stale entry fails the build.
- `13-AUTHORITY-ALLOWLIST.md` records all three sites: the status write deleted by 13-07 (A-01), and the two parent touches allow-listed with reasons and revisit conditions.

## Task Commits

1. **Task 2 RED: authority transitions refuse an agent and do not block a human** - `ac5eee4` (test) - 13 refusal tests failed on assertions, 15 passed
2. **Task 1 GREEN: every authority writer refuses a non-human actor at the database** - `0387b86` (feat) - 28/28
3. **Task 3 RED: widen the canonical-write gate to UPDATE tasks/epics SET** - `31b0d0f` (test) - the widened gate failed on exactly `acceptance_criterion.rs:779` and `:783`
4. **Task 3 GREEN: allow-list the two parent touches and record all three sites** - `9e0569a` (feat)

**Plan metadata:** the `docs(13-09)` commit following this file.

## Files Created/Modified

- `packages/core/src/domain/actor.rs` - the helper, its two refusal messages, the Phase 16 ADR note
- `packages/core/src/domain/acceptance_criterion.rs` - precondition in `write_checked`; pointer comment at the parent touch
- `packages/core/src/domain/task.rs` - precondition in `request_changes`
- `packages/core/src/domain/authoring_proposal.rs` - preconditions in the four decision writers, `accept_subtree` and both bulk verbs
- `packages/core/tests/authority_human_only.rs` - both-direction behaviour tests and the source gate
- `packages/core/tests/proposal_no_promotion.rs` - widened gate, `ALLOWED_CANONICAL_UPDATE_SITES`, planted and stale-entry tests
- `.planning/phases/13-nothing-new-escapes-the-fence/13-AUTHORITY-ALLOWLIST.md` - the committed dispositions

## TDD notes

- Task 2's tests were written and committed first (RED) against the existing public writers, so they compiled and failed on assertions. That commit precedes the implementation commit for Task 1, so the plan's Task 1 / Task 2 order was swapped to get a real RED.
- Compile-order exception: the direct tests of `assert_human_actor_in_tx` / `assert_human_actor` cannot compile before the helper exists. They were added in the GREEN commit. The same refusal behaviour had already been proven RED through the public writers, including the system / unknown / empty edges.
- Task 3's RED is genuine: the gate was widened with an empty `ALLOWED_CANONICAL_UPDATE_SITES` (the const itself is the other compile-order exception) and failed on the two real sites.

## Decisions Made

- `'human'` is the only accepting `actors.type`. Two distinguishable messages: `actor "<id>" not found` (covers the empty string) and `actor "<id>" is a "<type>" actor, and only a human may do this`.
- Gated `accept_subtree` and the bulk verbs up front. Without it, an agent calling them on an already-decided set got `Ok` with nothing written; harmless, but inconsistent with "refuses an agent".
- `amend_proposal` left ungated. It is a human act but decides nothing and promotes nothing; the plan did not list it. Flagged for the owner in case sign-off should cover it.
- Added `UPDATE tasks SET`/`epics SET` ownership as a separate list (`task.rs`, `epic.rs`) rather than reusing the four-module skip, because reusing it would have exempted `acceptance_criterion.rs` and made the allow-list decorative.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 2 - Missing critical] Gate the subtree and bulk verbs up front**
- **Found during:** Task 1
- **Issue:** `accept_subtree`, `reject_proposals_bulk` and `defer_proposals_bulk` only reach the per-row precondition when a pending row exists. An agent calling them with an empty slice or a fully decided subtree got `Ok`.
- **Fix:** added `assert_human_actor` / `assert_human_actor_in_tx` at the top of each.
- **Files modified:** `packages/core/src/domain/authoring_proposal.rs`
- **Verification:** `accept_subtree`, `reject_proposals_bulk`, `defer_proposals_bulk` refusal and not-blocked tests pass.
- **Committed in:** `0387b86`

### Plan-vs-reality notes (not rule deviations)

- **Call-site count.** The plan's acceptance criterion expected at least 7 `assert_human_actor_in_tx(` call sites on the assumption that `toggle_criterion` and `check_criterion_with_anchor` call it separately. Both route through the single `write_checked`, so one call covers both; the count is 7 anyway because of the extra subtree and bulk calls.
- **Allowed-caller list.** The plan allowed "the declaring domain module and the Tauri command module". The real list is wider: three declaring modules, three human-facing command modules (`criterion.rs`, `review.rs`, `authoring.rs`), and `commands/agent_run.rs` for a `#[cfg(test)]` fixture only.
- **Task order.** Task 2's tests were committed before Task 1's implementation (see TDD notes).

**Total deviations:** 1 auto-fixed (Rule 2). **Impact:** closes a hole in the same property the plan targets; no scope creep.

## Issues Encountered

- A background `cargo test` wrapper reported "completed" immediately because the run was in a detached subshell; the real result was read from its log. No effect on results.
- Test counts are non-zero throughout: `authority_human_only` 28, `proposal_no_promotion` 12 (was 10), with the 25-binary regression sweep below all passing.

## Verification

- `cargo test -p core --test authority_human_only`: 28 passed.
- Regression sweep of every binary that calls an authority writer, run with `RUST_TEST_THREADS=1`: `activity_trail` 5, `authoring_acceptance` 16, `authoring_criterion_reachability` 3, `authoring_lifecycle` 12, `authoring_measurement` 12, `authoring_proposal` 42, `authoring_tracer` 6, `context_packet` 30, `criteria` 22, `criterion_anchors` 26, `epic_request_draft` 22, `forge_request_body` 11, `no_agent_status_write` 8, `pm_vocabulary_gate` 4, `priority_is_opt_in` 4, `proposal_channel` 6, `proposal_duplicates` 16, `proposal_limit` 12, `proposal_no_promotion` 10 (12 after Task 3), `proposal_triage_verbs` 18, `review_changes_request` 12, `spine_pin` 4, `status_derivation` 19, `task_created_at_todo` 5. All passed, none failed.
- `cargo test -p core --lib`: 20 passed.
- `cargo check --workspace --tests`: clean (pre-existing unused-import warnings only).
- `cargo test --workspace` and bare `cargo test -p core` were deliberately not run (hours on this machine, per the environment note). The Tauri crate's own unit tests were not run; its one test-only caller passes the seeded human actor, and the workspace compiles.

## Known Stubs

None.

## Threat Flags

None. The change adds a read of `actors` inside existing transactions and no new endpoint, file access or schema.

## Next Phase Readiness

- Phase 16's ADR acceptance has its obligation recorded on `assert_human_actor_in_tx`: call it first. No stub exists.
- Not touched, per the plan's boundaries: the two Phase 14 gaps filed by 13-07 (epic status has no UI writer; `task_set_status` / `epic_set_status` remain registered with no caller).

## Self-Check: PASSED

- Created files exist: `authority_human_only.rs`, `13-AUTHORITY-ALLOWLIST.md`.
- Commits `ac5eee4`, `0387b86`, `31b0d0f`, `9e0569a` exist; `git rev-list --count 2fd4539..HEAD` = 4.
- All Task 1 and Task 3 acceptance greps return the required values; no fourth raw `UPDATE tasks/epics SET` site exists.
