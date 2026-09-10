---
phase: 01-the-board-is-the-store-of-record
plan: 21
subsystem: ui
tags: [react, zustand, vitest, quick-add, collapse-state, jsdom]

# Dependency graph
requires:
  - phase: 01-19
    provides: quick-add focus-delivery pipeline (quickAddFocusPending, scrollToIndex) and the expand-Backlog effect this plan rewrites
  - phase: 01-20
    provides: the shared volume fixture (volume.ts) and UI-SPEC hardening this plan's tests build on
provides:
  - CR-01 closed — Backlog band collapse now sticks while quick-add is reachable, on both a populated project and a permanently-inert zero-item project
  - WR-01 closed — the regression suite now covers both directions of the collapse/quick-add interaction, plus the project-switch and re-press edges
  - IN-01 closed — the scrollTo test stub's ceiling clamp is guarded so it never disables the volume suite's deep-scroll precondition
  - 01-UI-SPEC.md's band-collapse ownership contract, recorded so a future refactor cannot reintroduce a standing-invariant shape
affects: [board-view, quick-add, collapse-store-consumers, test-infrastructure]

# Actuals (#2632)
actuals:
  tokens: 5795
  tasks: 3
  commits: 6

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "Rising-edge guard keyed on a domain id (project id), not a bare boolean, when the owning component is not remounted across the transition the guard must distinguish (App.tsx renders <Board projectId> with no key)"
    - "A test-only jsdom stub gains a guarded conditional behavior (live only when the element supplies real data) rather than an unconditional 'more correct' version, when the unconditional form would silently disable an existing fixture's precondition"

key-files:
  created: []
  modified:
    - packages/desktop/src/board/BoardView.tsx
    - packages/desktop/src/board/__tests__/quick-add-focus.test.tsx
    - packages/desktop/src/test/setup.ts
    - .planning/phases/01-the-board-is-the-store-of-record/01-UI-SPEC.md

key-decisions:
  - "backlogAutoExpandedForRef is keyed on the project id (useRef<string | null>), not a bare boolean, because App.tsx renders <Board projectId> with no React key, so BoardView is never remounted on a project switch"
  - "The explicit-request rising edge (re-pressing ⌘N after a deliberate collapse) lives inside openQuickAdd — the single funnel every open route reaches — not inside the passive reachability-episode effect, so a refused keystroke (layer guard) still writes nothing"
  - "The scrollTo test stub's ceiling clamp is guarded on the element reporting a positive scrollHeight, rather than the review's unconditional scrollHeight-minus-offsetHeight sketch, because jsdom reports scrollHeight === 0 for every element and an unguarded clamp would silently zero the volume suite's DEEP_SCROLL_OFFSET"
  - "Task 2's four regression cases required no production code change — Task 1's project-keyed ref and open-funnel expansion already satisfied every property WR-01 names on first write, mirroring the 01-03 precedent of a later task's suite passing against an earlier task's already-correct implementation"

patterns-established:
  - "A render-path effect that writes to shared state must guard on a rising-edge marker of the state transition it responds to, never on the level of a condition that can hold indefinitely (effectiveQuickAddOpen is permanently true on a zero-item project)"

requirements-completed: [BOARD-04, BOARD-07, BOARD-08]

coverage:
  - id: D1
    description: "Clicking the Backlog band header while quick-add is open collapses it and it stays collapsed, on a 60-row project and a zero-item project alike"
    requirement: "BOARD-04"
    verification:
      - kind: unit
        ref: "packages/desktop/src/board/__tests__/quick-add-focus.test.tsx#collapsing_backlog_while_quick_add_is_open_sticks"
        status: pass
      - kind: unit
        ref: "packages/desktop/src/board/__tests__/quick-add-focus.test.tsx#the_backlog_collapse_toggle_is_operable_on_an_empty_project"
        status: pass
    human_judgment: false
  - id: D2
    description: "Collapsing Backlog legitimately hides the quick-add row without reverting the collapse (the row-disappearance-vs-defect distinction)"
    requirement: "BOARD-04"
    verification:
      - kind: unit
        ref: "packages/desktop/src/board/__tests__/quick-add-focus.test.tsx#collapsing_backlog_hides_the_quick_add_row_without_reverting_the_collapse"
        status: pass
    human_judgment: false
  - id: D3
    description: "Re-pressing ⌘N after a deliberate collapse re-expands the band and re-focuses the row, so the accelerator never becomes a silent no-op"
    requirement: "BOARD-07"
    verification:
      - kind: unit
        ref: "packages/desktop/src/board/__tests__/quick-add-focus.test.tsx#re_pressing_cmd_n_after_a_deliberate_collapse_expands_and_focuses_again"
        status: pass
    human_judgment: false
  - id: D4
    description: "Switching to a project whose Backlog is collapsed still expands it once, proven without unmounting BoardView (the case a bare boolean guard would fail)"
    requirement: "BOARD-04"
    verification:
      - kind: unit
        ref: "packages/desktop/src/board/__tests__/quick-add-focus.test.tsx#switching_to_a_project_with_a_collapsed_backlog_still_expands_it"
        status: pass
    human_judgment: false
  - id: D5
    description: "At volume, the collapse store is written at most once per open episode — object identity of collapsedByProject survives further renders, in both the 60-row and zero-item cases"
    requirement: "BOARD-08"
    verification:
      - kind: unit
        ref: "packages/desktop/src/board/__tests__/quick-add-focus.test.tsx#the_expand_effect_performs_no_store_write_on_later_renders"
        status: pass
    human_judgment: false
  - id: D6
    description: "The scrollTo test stub clamps to a real scrollable range only when one is reported, leaving DEEP_SCROLL_OFFSET unclamped when jsdom reports no layout"
    verification:
      - kind: unit
        ref: "packages/desktop/src/board/__tests__/quick-add-focus.test.tsx#the_scroll_stub_clamps_to_a_real_scrollable_range_only_when_one_exists"
        status: pass
    human_judgment: false
  - id: D7
    description: "01-UI-SPEC.md records band collapse as user-owned and the auto-expansion as a one-time action; the empty-board default and both overflow considerations are unchanged in mechanism"
    verification:
      - kind: other
        ref: "grep -c '01-21' .planning/phases/01-the-board-is-the-store-of-record/01-UI-SPEC.md (2 attributed edits)"
        status: pass
    human_judgment: false
  - id: D8
    description: "Perceived responsiveness at 1,000+ items with quick-add open is no worse after this change, and there is no new visual jump when quick-add opens"
    human_judgment: true
    rationale: "A live tauri dev walkthrough on the real seeded 1,067-item board — not something an executor can observe. Carried forward to /gsd-verify-work per this plan's own <human_verification_carried_forward> section; expected direction is strictly better, since the fix removes a self-sustaining render-path write, not just changes its timing."

# Metrics
duration: 11min
completed: 2026-09-10
status: complete
---

# Phase 1 Plan 21: CR-01 gap closure — Backlog collapse now sticks while quick-add is open Summary

**A project-keyed rising-edge ref replaces a per-render standing invariant, so a user's Backlog collapse click survives while quick-add stays open — closing the sole blocker (CR-01) that kept Phase 1 at `gaps_found`.**

## Performance

- **Duration:** 11 min (Task 1, by the prior executor, plus Tasks 2–3, this continuation agent)
- **Started:** 2026-09-10T15:26:03+08:00
- **Completed:** 2026-09-10T15:36:55+08:00
- **Tasks:** 3
- **Files modified:** 4

## Accomplishments

- **CR-01 closed.** `BoardView.tsx`'s expand-Backlog effect now writes at most once per
  quick-add-reachability episode (a project-keyed `useRef<string | null>`), instead of
  re-asserting the expansion on every render — the defect that made the Backlog collapse toggle
  silently revert while quick-add was open, and permanently inert on any zero-item project.
- **The explicit-request edge.** `openQuickAdd` — the single funnel every open route (`c`, ⌘N,
  ⌘⇧N, the command palette, the forwarded native `menu:action`) reaches — now also expands a
  currently-collapsed Backlog band, so re-pressing the accelerator after a deliberate collapse
  re-expands and re-focuses rather than leaving `quickAddFocusPending` stranded.
- **WR-01's coverage hole closed.** Four new regression cases prove the project-switch edge (the
  one case a bare boolean guard would fail, since `App.tsx` renders `<Board projectId>` with no
  key), the re-press edge, the at-volume no-write proof (`collapsedByProject` object identity),
  and the row-disappearance-vs-defect distinction.
- **IN-01 closed.** The `scrollTo` test stub gains a ceiling clamp, guarded to be a complete
  no-op under jsdom's zero-layout reality — proven by a test that pins both halves — so it can
  never silently disable the volume suite's `DEEP_SCROLL_OFFSET` precondition.
- **01-UI-SPEC.md's band-collapse ownership contract.** The Quick-add (D-09) section now states
  the auto-expansion is a one-time action, and the UI Considerations table gains a row for the
  status-band collapse toggle (12 covered, up from 11).

## Task Commits

Each task was committed atomically:

1. **Task 1 (RED): Add failing tests for Backlog collapse sticking while quick-add is open** —
   `06909f3` (test) — *by the prior executor session*
2. **Task 1 (GREEN): Rising-edge guard for Backlog auto-expansion** — `fb961dc` (feat) —
   *by the prior executor session*
3. **Task 2: Close WR-01's coverage hole — project-switch, re-press, no-write, row-disappearance
   edges** — `6f56eea` (test)
4. **Task 3 (RED): Add failing test for scroll stub's real-range ceiling clamp (IN-01)** —
   `1573cbd` (test)
5. **Task 3 (GREEN): Clamp scrollTo stub to a real scrollable range only when reported (IN-01)** —
   `71ca01d` (feat)
6. **Task 3 (docs): Record band-collapse ownership contract in 01-UI-SPEC.md (CR-01)** —
   `c7d5ed3` (docs)

**Plan metadata:** committed alongside this SUMMARY.

## Files Created/Modified

- `packages/desktop/src/board/BoardView.tsx` — `backlogAutoExpandedForRef`, the rewritten
  expand-Backlog effect, and the collapsed-Backlog expansion inside `openQuickAdd`
- `packages/desktop/src/board/__tests__/quick-add-focus.test.tsx` — `bandHeader` helper, the
  `renderVolumeBoard` optional `projectId` parameter, and 7 new named cases across Tasks 1–3
- `packages/desktop/src/test/setup.ts` — the `Element.prototype.scrollTo` stub's guarded
  ceiling clamp
- `.planning/phases/01-the-board-is-the-store-of-record/01-UI-SPEC.md` — the band-collapse
  ownership bullet (Quick-add, D-09) and the new UI Considerations row

## Decisions Made

- `backlogAutoExpandedForRef` is keyed on the project id, not a bare boolean, because
  `BoardView` survives a project switch (no React `key` on `<Board>` in `App.tsx`).
- The explicit-request re-expansion lives inside `openQuickAdd`, not the passive effect, so a
  keystroke refused by the layer guard still writes nothing.
- The scrollTo stub's ceiling clamp is guarded on a positive `scrollHeight`, not applied
  unconditionally as `01-REVIEW.md`'s sketch suggested — an unguarded clamp would silently zero
  every programmatic scroll under jsdom's zero-layout reality.
- Task 2 required no production code change: Task 1's implementation already satisfied every
  property WR-01's four new cases assert, confirmed by investigation (not a test bug) before
  proceeding — see "TDD Gate Compliance" below.

## Deviations from Plan

None — plan executed exactly as written. Task 2's tests passing without a production change is
not a deviation; the plan itself states "Touch no production file in this task. A failure here
belongs to Task 1's implementation," anticipating this outcome.

## TDD Gate Compliance

This plan's `type: tdd` gate (RED `test(01-21)` → GREEN `feat(01-21)`) is satisfied at the
plan level by Task 1's pair (`06909f3` → `fb961dc`) and independently re-satisfied by Task 3's
pair (`1573cbd` → `71ca01d`).

**Task 2 investigated departure (tdd.md "Test doesn't fail in RED phase"):** all four of Task 2's
new cases passed on first run against Task 1's already-committed implementation — no production
file was changed for Task 2, per the task's own explicit scope ("Touch no production file in this
task. A failure here belongs to Task 1's implementation"). Per tdd.md's fail-fast rule 1
("Unexpected GREEN in RED phase … investigate"), this was investigated before committing:
`BoardView.tsx`'s project-keyed ref resets its episode key whenever `projectId` changes (Task 2's
project-switch case), `openQuickAdd`'s explicit-request expansion already re-expands on a second
⌘N (Task 2's re-press case), and the ref-guard plus the retained `collapsedByStatus.backlog` check
already make `expandBand` conditional (Task 2's no-write and row-disappearance cases) — all
properties Task 1 built for reasons independent of Task 2's specific assertions. This mirrors the
project's own established precedent (STATE.md, Phase 01-03: "passed against Task 2's
already-correct implementation on first write … documented in the SUMMARY per the same
task-sequencing pattern"). The single `test(01-21)` commit for Task 2 is therefore the complete
and correct commit set for that task — no `feat(01-21)` companion was needed or fabricated.

## Issues Encountered

None.

## User Setup Required

None — no external service configuration required.

## Next Phase Readiness

- **01-VERIFICATION.md Observable Truth #22 moves from `✗ FAILED` to verified.** CR-01, the sole
  gap keeping Phase 1 at `gaps_found`, is closed. BOARD-04, BOARD-07 and BOARD-08 are marked
  complete in REQUIREMENTS.md as part of this plan's close-out.
- **Two human-verification items remain, carried forward to `/gsd-verify-work`** (not executable
  tasks, per this plan's own scoping note):
  1. `01-20-PLAN.md` Task 3's live `tauri dev` walkthrough of the G-01-4 fix on the real seeded
     1,067-item / 13-epic THRE board — unchanged by this round, still owed.
  2. `01-UAT.md` test 2 — perceived responsiveness at 1,000+ items — re-confirmed after this
     round. Expected direction: strictly better, since the fix removes a self-sustaining
     render-path write rather than merely retiming it.
- With CR-01 closed and no remaining gaps recorded against this phase, Phase 1 is ready for
  `/gsd-verify-work` to re-run the full UAT/verification pass and, on a clean result, for the
  phase to be marked complete.

## Self-Check: PASSED

- All 4 files_modified confirmed present on disk.
- All 6 plan commits (`06909f3`, `fb961dc`, `6f56eea`, `1573cbd`, `71ca01d`, `c7d5ed3`) confirmed in `git log`.
- All 15 `must_haves.truths` re-verified: 14 by automated test/grep evidence, 1 (perceived responsiveness at volume) correctly reported as human-verification, carried forward — not silently claimed passing.
- All 5 `must_haves.prohibitions` re-verified via their named grep gates and unchanged test suites.
- Full desktop suite: 154/154 passing (floor 147). `npm run build`: clean. `cargo test --workspace`: 20/20 "test result: ok", 0 FAILED.
- `quick-add-focus.test.tsx`: 23/23 passing (plan target: 23).

## Post-Review Addendum (CR-01 residual)

An incremental code review of this plan's own commits (`fb961dc`/`71ca01d`, `01-REVIEW.md`,
2026-09-10T07:47:25Z) found that the CR-01 fix above, while correct for a single-project session
and for a one-way project switch, could not survive a **round trip** between two projects.

**The residual defect.** `backlogAutoExpandedForRef` was a scalar (`useRef<string | null>`)
holding only the *most-recently-seen* project id as "already handled." Traced against a
project-switch sequence longer than the one existing test (`switching_to_a_project_with_a_
collapsed_backlog_still_expands_it`) covered:

1. Project A open, quick-add reachable → ref becomes `"A"`. (correct)
2. User clicks the Backlog header to collapse it → ref already equals `"A"` → guard returns early
   → the collapse sticks. (correct — this is CR-01's original fix working)
3. User switches to project B (still without unmounting `BoardView`, matching `App.tsx:212`'s
   un-keyed `<Board projectId={project.id}>` render) → ref becomes `"B"`. (correct — this is the
   one case the existing test proved)
4. User switches **back** to A → the ref is `"B"`, not `"A"`, so the guard treats this as a
   brand-new episode: it sets `ref.current = "A"` and, seeing A's Backlog is still collapsed (the
   user's own click from step 2 — collapse state is per-project and survives the detour), calls
   `expandBand("A", "backlog")` — **silently reverting the user's deliberate collapse**, with no
   click and no accelerator press to justify it.

This directly contradicted 01-UI-SPEC.md's own stated guarantee for this fix ("a band the user
collapses afterward stays collapsed until the user says otherwise"), and was invisible to all 154
tests passing at the time because no case in the suite exercised the third leg (A → B → A) of the
round trip.

**The fix.** Replaced the scalar with a per-project `Set<string>` (`backlogAutoExpandedRef`):

```tsx
const backlogAutoExpandedRef = useRef<Set<string>>(new Set());

useEffect(() => {
  const key = projectId ?? "";
  if (!effectiveQuickAddOpen) {
    backlogAutoExpandedRef.current.clear();
    return;
  }
  if (backlogAutoExpandedRef.current.has(key)) return;
  backlogAutoExpandedRef.current.add(key);
  if (collapsedByStatus.backlog) expandBand(key, "backlog");
}, [effectiveQuickAddOpen, collapsedByStatus, projectId, expandBand]);
```

The set remembers every project the current reachability episode has already seeded, independent
of visit order, so a round trip through any number of intermediate projects no longer clears a
project's own "already handled" memory. Clearing the *whole* set when quick-add stops being
reachable is unchanged in intent from the original fix: that transition ends the episode, so the
next open is a fresh episode for every project. `openQuickAdd`'s explicit-request expansion
(re-pressing ⌘N after a deliberate collapse) was left exactly as it was — an explicit accelerator
press is still a legitimate new rising edge, orthogonal to this passive-episode guard.

**New regression test.** `returning_to_a_project_after_a_deliberate_collapse_does_not_re_expand_it`
(`quick-add-focus.test.tsx`) exercises the full A → B → A cycle without unmounting `BoardView`
(mirroring `App.tsx:212`'s un-keyed render): populated project A, quick-add opened via ⌘N,
Backlog collapsed by clicking the band header, rerender to project B (empty, quick-add reachable
via the empty-board default), rerender back to project A, and assert
`useCollapseStore.getState().collapsedByProject['proj-a'].backlog` is still `true`. Confirmed RED
against the pre-fix scalar ref (the assertion observed `false` — re-expanded) before the fix was
applied.

**Final verification (post-fix):**
- `npm --prefix packages/desktop run test -- --run src/board/__tests__/quick-add-focus.test.tsx`
  → 24/24 passing (23 pre-existing + 1 new).
- `npm --prefix packages/desktop run test -- --run` (full desktop suite) → 20 files, 155/155
  passing (floor was 154).
- `npm --prefix packages/desktop run build` → clean, no `error TS`.
- `cargo test --workspace` → all suites report "test result: ok", 0 failed.

**Commits:**
- `2dca0f3` — `test(01-21): add failing test for Backlog collapse surviving a project round-trip
  (CR-01 residual)`
- `7d382ec` — `fix(01-21): key the Backlog auto-expand guard per project, not per episode (CR-01
  residual)`

---
*Phase: 01-the-board-is-the-store-of-record*
*Completed: 2026-09-10*
