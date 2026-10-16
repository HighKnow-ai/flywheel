---
phase: 15-nothing-typed-that-an-agent-could-draft
plan: 07
subsystem: authoring
tags: [rust, rusqlite, tauri, react, provisional-tier, ghost, start-work, tdd]

requires:
  - phase: 15-nothing-typed-that-an-agent-could-draft
    provides: "15-01: OPEN_DRAFTS_PER_PROJECT cap and criterion drafts; 15-06: criteria coverage gate on the launch sheet"
  - phase: 13-nothing-new-escapes-the-fence
    provides: "D-16/D-17 priority as an opt-in suggestion through staging, D-18 backlog means proposed-not-accepted"
provides:
  - "authoring_proposal::AcceptanceTier / acceptance_tier: the two tiers (explicit = criterion, provisional = everything else) declared once, read by the project cap"
  - "query::provisional_values::provisional_values_for: a derive-on-read, bounded, per-field read of pending provisional-tier amendments beside the canonical value"
  - "authoring_proposal::confirm_provisional_values_for_task: Start Work decides every pending provisional value on one task through accept_proposal_in_tx, called from start_agent_run in the run-insert transaction"
  - "item_provisional_values Tauri command, itemProvisionalValues adapter wrapper, and per-field ghosts inside ItemDetailPanel with reject reusing authoring_proposal_reject"
affects: [15-08, 15-09, 15-10, no-bulk-accept-gate, DRFT-07]

actuals:
  tokens: 28000
  tasks: 3
  commits: 6
plan_head_before: 0505c34ed7953d60af50716b1de9ed3e89c61ea6

tech-stack:
  added: []
  patterns:
    - "A tier declared by one exhaustive const match with no wildcard, plus an ALL array a test walks, so a new target type cannot compile or pass without a tier"
    - "The ghost walks the amendments in the same order confirm applies them, so what is shown is what Start Work leaves"
    - "A focus is not a decision: a ghost adopted into a field on focus is written only by an explicit Enter or an edit"

key-files:
  created:
    - packages/core/src/query/provisional_values.rs
    - packages/core/tests/provisional_tier.rs
    - packages/core/tests/provisional_start.rs
    - packages/desktop/src/item-detail/__tests__/provisional-ghost.test.tsx
  modified:
    - packages/core/src/domain/authoring_proposal.rs
    - packages/core/src/domain/agent_run.rs
    - packages/core/src/query/mod.rs
    - packages/core/tests/open_drafts_cap.rs
    - packages/desktop/src-tauri/src/commands/authoring.rs
    - packages/desktop/src-tauri/src/main.rs
    - packages/desktop/src-tauri/tests/handler_roster.rs
    - packages/desktop/src/adapters/tauri.ts
    - packages/desktop/src/authoring/useAuthoringQuery.ts
    - packages/desktop/src/item-detail/ItemDetailPanel.tsx
    - packages/desktop/src/item-detail/item-detail.css

key-decisions:
  - "The confirm lives inside start_agent_run's own transaction (human actor only), not in the desktop command: the run row insert is what freezes criteria (BOARD-03), so freeze and confirm are one site, and start_pin_ordering's pinned ordering in the desktop command is untouched"
  - "A system actor's automatic start confirms nothing: a dispatcher start is not a human decision, so the values stay pending for a human"
  - "The read reports a value only if it moves the field's EFFECTIVE value after earlier amendments, in the order confirm applies them; a later proposal that restates a stale title shows as its own ghost rather than reverting silently at Start Work"
  - "Ghosts are task-only: an epic has no Start Work, so an epic's provisional values would never confirm; the core read still supports an epic parent"
  - "The mixed-tier refusal in validate_payload has no shape to refuse today; it is encoded as the exhaustive acceptance_tier match plus a build-failing test, as the plan allowed"

patterns-established:
  - "Pending provisional amendments are one shared read (pending_provisional_amendments) used by both the ghost and the confirm, so the two cannot disagree about what is pending"

requirements-completed: [DRFT-03, DRFT-07]

coverage:
  - id: D1
    description: "The two acceptance tiers are declared once (criterion explicit, every other target type provisional) and the project cap reads that declaration, counting pending criteria and not pending task amends"
    requirement: DRFT-07
    verification:
      - kind: integration
        ref: "packages/core/tests/provisional_tier.rs#criterion_is_explicit_and_every_other_target_type_is_provisional"
        status: pass
      - kind: integration
        ref: "packages/core/tests/provisional_tier.rs#the_project_cap_counts_a_pending_criterion_and_not_a_pending_task_amend"
        status: pass
      - kind: integration
        ref: "packages/core/tests/open_drafts_cap.rs#the_cap_is_a_compile_time_30_declared_once_and_reads_the_tier_function"
        status: pass
    human_judgment: false
  - id: D2
    description: "An item's provisional values are a derived, bounded, per-field read of pending provisional-tier amendments beside the canonical value, in staging order, with no column added (migrations stay 24) and criteria never appearing"
    requirement: DRFT-03
    verification:
      - kind: integration
        ref: "packages/core/tests/provisional_tier.rs#a_pending_task_amend_reads_back_with_the_current_value_and_the_proposing_actor"
        status: pass
      - kind: integration
        ref: "packages/core/tests/provisional_tier.rs#the_read_is_bounded"
        status: pass
      - kind: integration
        ref: "packages/core/tests/provisional_tier.rs#no_provisional_column_reached_the_schema"
        status: pass
    human_judgment: false
  - id: D3
    description: "Start Work confirms every pending provisional value on that one task through the canonical writers, attributes the priority to the human, leaves a rejected value rejected, is a no-op when empty, never touches the explicit tier, and runs in the start_agent_run transaction for a human actor only"
    requirement: DRFT-03
    verification:
      - kind: integration
        ref: "packages/core/tests/provisional_tier.rs#confirming_lands_title_description_and_priority_through_the_canonical_writers"
        status: pass
      - kind: integration
        ref: "packages/core/tests/provisional_start.rs#start_work_confirms_the_pending_title"
        status: pass
      - kind: integration
        ref: "packages/core/tests/provisional_tier.rs#the_confirm_takes_one_task_id_and_issues_no_write_of_its_own"
        status: pass
    human_judgment: false
  - id: D4
    description: "Suggested title, body and priority ghost inside the item form's own fields, marked as suggestions with the proposing agent and the current value, adopted on focus, committed only by Enter or an edit, and rejectable one field at a time with a single call"
    requirement: DRFT-07
    verification:
      - kind: automated_ui
        ref: "packages/desktop/src/item-detail/__tests__/provisional-ghost.test.tsx"
        status: pass
    human_judgment: false
  - id: D5
    description: "Whether the ghost reads as a suggestion rather than committed state in the real panel (muted italic ink, dashed hairline, the word Suggested) and whether the description block, which has no field of its own in the panel, sits naturally"
    verification: []
    human_judgment: true
    rationale: "Visual treatment and placement are not asserted by any test; the colour gates only prove no literal colour was introduced."

duration: 72min
completed: 2026-10-16
status: complete
---

# Phase 15 Plan 07: The provisional tier, ghosted into the item form and confirmed at Start Work Summary

**An agent's suggested title, body and priority now ghost inside the one item form, rejectable per field, and starting work on the task confirms whatever is left through the same canonical writers a human accept uses; criteria stay explicit and the two tiers never meet.**

## Performance

- **Duration:** 72 min
- **Started:** 2026-10-16T10:06Z (approx.)
- **Completed:** 2026-10-16T11:20Z
- **Tasks:** 3 (all TDD)
- **Files modified:** 15 (4 created)

## Accomplishments

- `acceptance_tier` is one exhaustive `match`: `Criterion` explicit, everything else provisional. The project cap (`OPEN_DRAFTS_PER_PROJECT`) now counts pending rows grouped by `target_type` and keeps the explicit ones through that function, so D-14 has one definition. The reserved `file_set` string counts as explicit.
- `provisional_values_for` is a derive-on-read over `authoring_proposals` joined to the canonical row: per field (`title`, `description`, `priority`), proposed beside current, with the run id and the proposing actor's display name, in `position` order, bounded at 50. No column, no migration (count stays 24).
- `confirm_provisional_values_for_task(conn, actor_id, task_id)` takes one task id and decides each pending provisional amendment through `accept_proposal_in_tx` only. It is called from `start_agent_run` in the transaction that inserts the run row, for a human actor, so the confirm and BOARD-03's criteria freeze are one site.
- `ItemDetailPanel` ghosts a suggested title (in the title input, with the current title and agent named beneath), priority (beside the current mark, label from the published registry) and description (a block, see Deviations), each with its own `Reject suggested <field>` control reusing `authoring_proposal_reject`.

## Task Commits

1. **Task 1: tiers named once, provisional values readable** - `c3191a45` (test, RED: 5 of 10 failing on assertions) then `a0194447` (feat)
2. **Task 2: ghost in the item form** - `ac99716f` (test, RED: 9 of 11 failing) then `090117a8` (feat)
3. **Task 3: Start Work confirms** - `120db3ad` (test, RED: 8 of 21 plus the start test failing on assertions) then `138761da` (feat)

**Plan metadata:** committed with this SUMMARY (docs).

## TDD Gate Compliance

Every task has a `test(15-07)` commit before its `feat(15-07)` commit and each RED run failed on assertions, not compilation: Tasks 1 and 3 carry compile-only stubs in the RED commit (`provisional_values_for` returning empty, `confirm_provisional_values_for_task` returning `Ok(0)`), as 15-01 and 15-06 did. A few RED-time tests pass vacuously against the stubs (the no-op and no-ghost guards); they are guards, and their GREEN-time passes are not meaningful on their own. `gsd check tdd-red-evidence` was not run (the RED runs are not node TAP).

## Files Created/Modified

See `key-files`. Source gates run and green: `proposal_no_promotion`, `authority_human_only`, `authoring_acceptance`, `criteria_pin`, `start_pin_ordering`, `pm_vocabulary_gate`, `priority_is_opt_in`, `open_drafts_cap`, `proposal_limit`, `proposal_limit_per_kind`, `estimate_absent`, `spine_pin`, `migration_safety`, `table_classification`, `db_bootstrap`, `agent_tracer`, `authoring_lifecycle`, `criterion_coverage`, `core --lib`, plus desktop `handler_roster` and `board_changed_payload`, the whole desktop vitest suite (104 files, 1741 passed) and `tsc --noEmit`.

## Decisions Made

See `key-decisions`. The one to read twice: the ghost walks amendments in confirm order. An amend payload always restates a title, so a later proposal restating a stale title would revert an earlier suggestion at Start Work while the ghost still showed the earlier one. Walking the effective value through the sequence makes the ghost say what Start Work will actually leave.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 1 - Plan/UI mismatch] The item panel has no description field**
- **Found during:** Task 2
- **Issue:** The plan asks for a ghost "on the existing description affordance", but `ItemDetailPanel` renders only a title input; its header comment mentions a description that is not there, and `DetailItem` carries none.
- **Fix:** The description suggestion renders as a labelled block (`Suggested description by ...`) with the proposed text, the current text when there is one, and its own reject. It cannot be edited in place because no description field exists to adopt it into; editing the body is out of scope.
- **Files modified:** `ItemDetailPanel.tsx`, `item-detail.css`
- **Committed in:** `090117a8`

**2. [Rule 3 - Blocking] The 15-01 cap pin asserted the literal list the plan removes**
- **Found during:** Task 1
- **Issue:** `open_drafts_cap.rs#the_cap_is_a_compile_time_30_declared_once_and_read_from_one_list` required exactly one `IN ('criterion', 'file_set')` in `src/`, which is the duplicate definition this plan's acceptance criteria forbid.
- **Fix:** The pin now asserts zero such lists and was renamed `..._reads_the_tier_function`. The cap's behaviour assertions are unchanged and green.
- **Files modified:** `packages/core/tests/open_drafts_cap.rs`
- **Committed in:** `a0194447`

**3. [Rule 3 - Blocking] The handler roster pin**
- **Found during:** Task 2
- **Issue:** `handler_roster.rs` pins the command count; `item_provisional_values` makes it 151.
- **Fix:** Moved the pin from 150 to 151 in the same diff, as the file's comment requires.
- **Committed in:** `090117a8`

**4. [Rule 2 - Missing critical] The ghost could disagree with what Start Work leaves**
- **Found during:** Task 3 (designing the confirm tests)
- **Issue:** The first read compared each proposal to the canonical value, so two amendments (title B, then a description amend restating the old title A) showed a ghost of B while confirm would leave A.
- **Fix:** The read tracks the effective value through the sequence; the panel hides a field whose last suggestion equals the canonical value. Test: `a_later_amendment_restating_a_stale_title_is_shown_not_applied_silently`.
- **Files modified:** `provisional_values.rs`, `ItemDetailPanel.tsx`
- **Committed in:** `120db3ad` (read), `138761da`

**5. [Rule 2 - Missing critical] A focus must not write**
- **Found during:** Task 2
- **Issue:** Adopting the suggestion into `titleDraft` on focus meant the existing blur-commit would write it just for tabbing through the field, violating "nothing is written on focus".
- **Fix:** A ref marks a draft adopted-and-untouched; leaving the field then discards it, and Enter or an edit is the commit.
- **Committed in:** `090117a8`

**6. [Plan wave note] `wave: 4` in the plan frontmatter** — the plan index places this plan in wave 3 (it depends only on 15-06). Executed as wave 3; the frontmatter was not touched.

**7. Extra test target** — `packages/core/tests/provisional_start.rs` was added beside the plan's `provisional_tier.rs`, because the one behavioural test that drives `start_agent_run` sets the process-wide `FLYWHEEL_WORKTREE_ROOT` and must not race the other tests in `provisional_tier`.

---

**Total deviations:** 5 auto-fixed (2 plan/blocker mismatches, 1 blocker, 2 missing-critical) plus 2 notes
**Impact on plan:** No scope creep; the additions make the ghost honest and keep focus from writing.

## Issues Encountered

- A task proposal's payload always carries a title, so "one proposal per field" is not literally possible: one proposal can suggest several fields and its reject declines all of them. The per-field reject controls share that proposal id. Agents that stage one field per proposal (the plan's own test shape) get true per-field reject.
- Stale-title clobber, left as is: a human who renames a task after an agent staged a description-only amend sees the stale title as a ghost with a reject (the read shows it), but if they ignore it Start Work applies it. That is the same contract `accept_proposal` has today and the ghost now surfaces it.

## Known Stubs

None. No placeholder or hardcoded-empty value flows to the UI.

## Known Limitations

- Epics render no provisional ghosts: Start Work exists for tasks only, so an epic's pending amendments would never confirm. The core read accepts an epic parent for when that is decided.
- An automatic (system actor) start confirms nothing; its pending provisional values wait for a human.
- The ghost's visual treatment is untested by a human (D5 above).

## User Setup Required

None - no external service configuration required.

## Next Phase Readiness

15-08 can add the no-bulk-accept gate and delete `accept_subtree` knowing the confirm touches the provisional tier only and is one task id by signature, so the gate needs no exemption for Start Work. `AcceptanceTier` is the single definition the gate should reuse.

## Self-Check: PASSED

- Created files exist: `provisional_values.rs`, `provisional_tier.rs`, `provisional_start.rs`, `provisional-ghost.test.tsx` all FOUND.
- Commits FOUND: `c3191a45`, `a0194447`, `ac99716f`, `090117a8`, `120db3ad`, `138761da`; measured `git rev-list --count` from `plan_head_before` is 6.
- Acceptance criteria re-run: migrations count 24 and no `provisional` in migrations; no `IN ('criterion'` in `authoring_proposal.rs`; `item_provisional_values` in `main.rs`; `grep -rn confirm_provisional packages/desktop/src` empty; no timer/expiry strings in the changed files; no literal colour in the panel or its stylesheet.

---
*Phase: 15-nothing-typed-that-an-agent-could-draft*
*Completed: 2026-10-16*
