---
phase: 01-the-board-is-the-store-of-record
verified: 2026-09-10T08:31:47Z
status: passed
score: 22/22 must-haves verified
covered_files:
  - ".planning/REQUIREMENTS.md"
  - ".planning/phases/01-the-board-is-the-store-of-record/01-01-PLAN.md"
  - ".planning/phases/01-the-board-is-the-store-of-record/01-01-SUMMARY.md"
  - ".planning/phases/01-the-board-is-the-store-of-record/01-02-PLAN.md"
  - ".planning/phases/01-the-board-is-the-store-of-record/01-02-SUMMARY.md"
  - ".planning/phases/01-the-board-is-the-store-of-record/01-03-PLAN.md"
  - ".planning/phases/01-the-board-is-the-store-of-record/01-03-SUMMARY.md"
  - ".planning/phases/01-the-board-is-the-store-of-record/01-04-PLAN.md"
  - ".planning/phases/01-the-board-is-the-store-of-record/01-04-SUMMARY.md"
  - ".planning/phases/01-the-board-is-the-store-of-record/01-05-PLAN.md"
  - ".planning/phases/01-the-board-is-the-store-of-record/01-05-SUMMARY.md"
  - ".planning/phases/01-the-board-is-the-store-of-record/01-06-PLAN.md"
  - ".planning/phases/01-the-board-is-the-store-of-record/01-06-SUMMARY.md"
  - ".planning/phases/01-the-board-is-the-store-of-record/01-07-PLAN.md"
  - ".planning/phases/01-the-board-is-the-store-of-record/01-07-SUMMARY.md"
  - ".planning/phases/01-the-board-is-the-store-of-record/01-08-PLAN.md"
  - ".planning/phases/01-the-board-is-the-store-of-record/01-08-SUMMARY.md"
  - ".planning/phases/01-the-board-is-the-store-of-record/01-09-PLAN.md"
  - ".planning/phases/01-the-board-is-the-store-of-record/01-09-SUMMARY.md"
  - ".planning/phases/01-the-board-is-the-store-of-record/01-10-PLAN.md"
  - ".planning/phases/01-the-board-is-the-store-of-record/01-10-SUMMARY.md"
  - ".planning/phases/01-the-board-is-the-store-of-record/01-11-PLAN.md"
  - ".planning/phases/01-the-board-is-the-store-of-record/01-11-SUMMARY.md"
  - ".planning/phases/01-the-board-is-the-store-of-record/01-12-PLAN.md"
  - ".planning/phases/01-the-board-is-the-store-of-record/01-12-SUMMARY.md"
  - ".planning/phases/01-the-board-is-the-store-of-record/01-13-PLAN.md"
  - ".planning/phases/01-the-board-is-the-store-of-record/01-13-SUMMARY.md"
  - ".planning/phases/01-the-board-is-the-store-of-record/01-14-PLAN.md"
  - ".planning/phases/01-the-board-is-the-store-of-record/01-14-SUMMARY.md"
  - ".planning/phases/01-the-board-is-the-store-of-record/01-15-PLAN.md"
  - ".planning/phases/01-the-board-is-the-store-of-record/01-15-SUMMARY.md"
  - ".planning/phases/01-the-board-is-the-store-of-record/01-16-PLAN.md"
  - ".planning/phases/01-the-board-is-the-store-of-record/01-16-SUMMARY.md"
  - ".planning/phases/01-the-board-is-the-store-of-record/01-17-PLAN.md"
  - ".planning/phases/01-the-board-is-the-store-of-record/01-17-SUMMARY.md"
  - ".planning/phases/01-the-board-is-the-store-of-record/01-18-PLAN.md"
  - ".planning/phases/01-the-board-is-the-store-of-record/01-18-SUMMARY.md"
  - ".planning/phases/01-the-board-is-the-store-of-record/01-19-PLAN.md"
  - ".planning/phases/01-the-board-is-the-store-of-record/01-19-SUMMARY.md"
  - ".planning/phases/01-the-board-is-the-store-of-record/01-20-PLAN.md"
  - ".planning/phases/01-the-board-is-the-store-of-record/01-20-SUMMARY.md"
  - ".planning/phases/01-the-board-is-the-store-of-record/01-21-PLAN.md"
  - ".planning/phases/01-the-board-is-the-store-of-record/01-21-SUMMARY.md"
  - ".planning/phases/01-the-board-is-the-store-of-record/01-CONTEXT.md"
  - ".planning/phases/01-the-board-is-the-store-of-record/01-DISCUSSION-LOG.md"
  - ".planning/phases/01-the-board-is-the-store-of-record/01-PATTERNS.md"
  - ".planning/phases/01-the-board-is-the-store-of-record/01-RESEARCH.md"
  - ".planning/phases/01-the-board-is-the-store-of-record/01-REVIEW-FIX.md"
  - ".planning/phases/01-the-board-is-the-store-of-record/01-REVIEW.md"
  - ".planning/phases/01-the-board-is-the-store-of-record/01-UAT.md"
  - ".planning/phases/01-the-board-is-the-store-of-record/01-UI-SPEC.md"
  - ".planning/phases/01-the-board-is-the-store-of-record/01-VALIDATION.md"
  - "DESIGN.md"
  - "packages/desktop/src/board/BoardView.tsx"
  - "packages/desktop/src/board/__tests__/quick-add-focus.test.tsx"
  - "packages/desktop/src/test/setup.ts"
covered_digest: "v1:sha256:ba629ca1644012767ac0485878e54aa59321ba3755acf78655b46b692205157c"
behavior_unverified: 0
overrides_applied: 0
re_verification:
  previous_status: human_needed
  previous_score: 22/22
  round: "human-verification discharge (no code change)"
  why: "Both human_verification items were run by the owner and passed (01-UAT.md, status: complete, 2/2, commit 143e7ec). No source file changed this round — git diff --name-only c00075a..HEAD outside .planning/ is empty — so every automated truth below stands on its prior evidence plus a fresh full-suite run (122 Rust + 155 Vitest, 0 failures; frontend build and tsc --noEmit clean). The covered_digest was recomputed over the current covered_files because 01-UAT.md and 01-VALIDATION.md are declared inputs and both were rewritten by the verify/validate steps, which is what made the prior report read stale."
  prior_round_previous_status: gaps_found
  prior_round_previous_score: 21/22
  gaps_closed:
    - "CR-01 — Observable Truth #22: with quick-add reachable, clicking the Backlog band header to collapse it was silently reverted on the very next render (permanently inert on any zero-item project). Plan 01-21 replaced the continuously-reasserting expand-Backlog effect with a rising-edge guard, and a follow-up incremental code review (01-REVIEW.md, this session) found that guard's first shipped form (a scalar `useRef<string | null>`) still failed an A -> B -> A project round trip because `App.tsx:212` renders `<Board projectId>` with no React key (BoardView is never remounted on a project switch). That residual was fixed in commit `7d382ec` by replacing the scalar with a per-project `useRef<Set<string>>`. Both the original property and the round-trip residual are independently re-verified in this report by direct code read and fresh test execution (24/24 quick-add-focus.test.tsx, including the new `returning_to_a_project_after_a_deliberate_collapse_does_not_re_expand_it` case)."
  gaps_remaining: []
  regressions: []
gaps: []
human_verification:
  - test: "01-20-PLAN.md Task 3's live `tauri dev` walkthrough of the G-01-4 fix on the real seeded 1,067-item / 13-epic THRE board: scroll deep, ⌘N lands the cursor with no click/Tab, ⌘⇧N does the same for an epic, a re-press returns focus after a click elsewhere, a collapsed Backlog band expands and focuses, the detail panel refuses all three bindings without scrolling, and no visual jank during any of the above. This run additionally asked the owner to confirm the Backlog header still collapses and stays collapsed while quick-add is open, live in the running app (the CR-01 property this round closed under jsdom)."
    expected: "Every step completes exactly as the automated suite proves it does under jsdom — no perceptible lag, no visual jank, cursor lands in the input without an extra click or Tab, and a manual Backlog collapse click sticks."
    why_human: "Native macOS Tauri GUI interaction and visual judgment are outside what an automated executor or verifier can perform."
    resolution: "DISCHARGED 2026-09-10 — run by the owner against a real build and recorded as `01-UAT.md` test 1, `result: pass` (file `status: complete`, commit 143e7ec). This was the walkthrough every prior session still owed; it is no longer outstanding. The CR-01 collapse property was exercised live, including across a project round-trip, which is the half that had only ever been proven under jsdom."
  - test: "01-UAT.md test 2 (perceived responsiveness at 1,000+ items) — reorder, filter, search, and switch projects with the mouse untouched, on the real seeded board, including with quick-add open, after plans 01-19/01-20/01-21's changes to BoardView.tsx's render-path effects."
    expected: "No perceptible lag or visual jank at volume, including while quick-add is open. Expected direction is strictly better than the pre-01-21 code, since CR-01's fix removes a self-sustaining render-path write rather than merely retiming it."
    why_human: "The prior round refused to propagate a possibly-stale pass over twice-changed render-path code; a fresh owner confirmation was required."
    resolution: "DISCHARGED 2026-09-10 — re-confirmed by the owner on the real seeded board after the CR-01 fix and recorded as `01-UAT.md` test 2, `result: pass` (commit 143e7ec). The internal inconsistency the prior report flagged in the old UAT file (a `pass` entry whose own `note:` said the check stayed pending) is resolved: this is a fresh, unambiguous pass over the current code."
---

# Phase 1: The Board Is The Store Of Record Verification Report

**Phase Goal:** Cyril runs his real project structure on Flywheel's board — epics, tasks with
individually checkable acceptance criteria, and a workflow he cannot bend — and it is still
exactly there after a crash.

**Verified:** 2026-09-10T16:10:00Z
**Status:** human_needed
**Re-verification:** Yes — this run independently verifies plan 01-21 (gap closure for CR-01,
`01-VERIFICATION.md` Observable Truth #22), executed after the prior verification
(2026-09-10T15:20:00Z, status `gaps_found`, 21/22 must-haves).

## Goal Achievement

**CR-01 is confirmed closed, independently, by direct code read and fresh test execution — not
accepted from either SUMMARY's narration.** This session also independently confirmed that an
incremental code review found the first shipped fix (`fb961dc`) only partially closed CR-01 — it
passed a one-way project switch but silently re-expanded a deliberately-collapsed Backlog band on
an A -> B -> A round trip, because `App.tsx:212` renders `<Board projectId={project.id}>` with no
React `key`, so `BoardView` survives a project switch and a scalar "already handled" ref forgets
project A the moment project B is recorded. The residual was fixed in commit `7d382ec` by
replacing the scalar `useRef<string | null>` with a per-project `useRef<Set<string>>`
(`backlogAutoExpandedRef`).

**Both the original property and the residual fix were independently re-verified this session,
not accepted from any SUMMARY or review document:**

- **Direct read of `packages/desktop/src/board/BoardView.tsx`** confirms the guard is exactly
  `const backlogAutoExpandedRef = useRef<Set<string>>(new Set());` (line 166), with the effect
  (lines 414-425) keying on `projectId ?? ""`, checking `backlogAutoExpandedRef.current.has(key)`
  before adding to the set, and clearing the *entire* set only when `effectiveQuickAddOpen`
  becomes false — not a scalar, not reset on every project switch. This matches the SUMMARY's
  claimed diff exactly.
- **`npm --prefix packages/desktop run test -- --run src/board/__tests__/quick-add-focus.test.tsx`**
  — fresh run, this session — 24/24 passing, including
  `returning_to_a_project_after_a_deliberate_collapse_does_not_re_expand_it`, which exercises the
  full A -> B -> A cycle without unmounting `BoardView` (via `rerender`, matching `App.tsx:212`'s
  un-keyed render) and asserts `collapsedByProject['proj-a'].backlog` is still `true` after the
  round trip. Read in full: the test genuinely drives the click, the two `rerender` calls with new
  `projectId` props on the same tree, and the final assertion — it is not a shape that could pass
  vacuously.
- **`collapsing_backlog_while_quick_add_is_open_sticks`** and
  **`the_backlog_collapse_toggle_is_operable_on_an_empty_project`** (both re-run fresh this
  session) directly re-prove the original CR-01 property this report's predecessor found failing:
  clicking the Backlog header while quick-add is reachable now sticks, on both a populated project
  and the permanently-inert-by-`effectiveQuickAddOpen` zero-item case, and survives further
  unrelated re-renders and a scroll.
- **`npm --prefix packages/desktop run test -- --run`** (full desktop suite) — fresh run, this
  session — 20 files / 155 tests passing (floor at the prior verification was 147; this round adds
  8 new named cases across the original fix and the residual fix).
- **`npm --prefix packages/desktop run build`** (`tsc && vite build`) — fresh run, clean, no
  `error TS`, no new warnings beyond the pre-existing chunk-size notice.
- **`cargo test --workspace`** — fresh run, this session — every `test result:` line reads `ok`,
  0 `FAILED` occurrences (unaffected by this round's frontend-only change, re-confirmed as a
  regression check).
- **Scope discipline confirmed by direct `git show --stat` on all 8 commits of this round**
  (`06909f3`, `fb961dc`, `6f56eea`, `1573cbd`, `71ca01d`, `c7d5ed3`, `2dca0f3`, `7d382ec`): the
  only non-planning-doc files touched are the 3 named in `files_modified`
  (`BoardView.tsx`, `quick-add-focus.test.tsx`, `setup.ts`) plus `01-UI-SPEC.md`. No file
  named in the plan's "MUST NOT widen the diff" prohibition (`collapseStore.ts`, `uiStore.ts`,
  `QuickAdd.tsx`, `IssuesLane.tsx`, `StatusBand.tsx`) was touched — confirmed by their absence
  from every commit's diffstat and by direct read of `StatusBand.tsx`'s `onClick={onToggleCollapsed}`
  (line 26), which remains unguarded exactly as the prohibition requires.
- **No debt markers** (`TBD`/`FIXME`/`XXX`/`TODO`/`HACK`/`PLACEHOLDER`) in any of the 4 files this
  round touched, confirmed by direct grep.

### Observable Truths

| # | Truth | Status | Evidence |
|---|-------|--------|----------|
| 1 | DATA-01 — every mutation writes projection + event in one transaction | ✓ VERIFIED | Unchanged; not touched by 01-21 |
| 2 | DATA-02 — every entity id is a client-generated ULID, never an auto-increment int | ✓ VERIFIED | Unchanged; not touched by 01-21 |
| 3 | DATA-03 — humans and agents are distinct actors of one model, every mutation actor-attributed | ✓ VERIFIED | Unchanged; not touched by 01-21 |
| 4 | DATA-05 — the event log is a gap-free, no-duplicate, resumable stream from a cursor | ✓ VERIFIED | Unchanged; not touched by 01-21 |
| 5 | DATA-07 — the database survives an unclean termination with no loss/corruption of committed work | ✓ VERIFIED | Unchanged; `crash_safety.rs` re-run fresh this session (part of `cargo test --workspace`), passes |
| 6 | DATA-08 — migrations run automatically on launch and are reversible within one version | ✓ VERIFIED | Unchanged; `migration_safety.rs` re-run fresh this session, passes |
| 7 | BOARD-01a — user creates/edits epics, tasks, issues in a fixed, non-reconfigurable 3-level hierarchy | ✓ VERIFIED | Unchanged mechanism |
| 8 | BOARD-01b — a task can be placed under an epic, and an issue under an epic or task, from the running UI | ✓ VERIFIED | `epic-assign.test.tsx`/`issue-parent.test.tsx` re-run fresh this session (part of the 155-test full run) — pass |
| 9 | BOARD-01c — an issue can never hold both an epic and a task parent at once | ✓ VERIFIED | Unchanged; not touched by 01-21 |
| 10 | BOARD-02 — discrete, individually checkable acceptance criteria | ✓ VERIFIED | Unchanged |
| 11 | BOARD-04 — fixed Backlog→Todo→In Progress→In Review→Done workflow, no reconfiguration path | ✓ VERIFIED | The five bands remain fixed, ordered (`BAND_ORDER`, confirmed unchanged by direct read) and non-reorderable |
| 12 | BOARD-05 — reorder/reprioritize within an epic and within the backlog | ✓ VERIFIED | Unchanged; not touched by 01-21 |
| 13 | BOARD-06 — filter/search by text, status, epic, assignee, indexed SQL, correct at project volume named in SC #3 | ✓ VERIFIED | Unchanged since prior round's closure; `filter.test.tsx`/`epic-roster.test.tsx` re-run fresh this session, pass |
| 14 | BOARD-07a — every navigational and mutating action reachable entirely from the keyboard | ✓ VERIFIED | Unchanged. The Backlog band's *collapse* toggle remains mouse-only by design (`StatusBand.tsx`'s `tabIndex={-1}`, confirmed unchanged) — a pre-existing design choice, not a regression |
| 15 | BOARD-07b — global shortcuts are inert while the item detail panel or a row-level picker holds a trapped focus scope, including click-opened pickers | ✓ VERIFIED | `layer-guard.test.tsx` re-run fresh this session — pass |
| 16 | BOARD-07c — a native macOS menu accelerator can never bypass the layer guard a real keystroke would obey | ✓ VERIFIED | `menu-bridge.test.tsx` re-run fresh this session — pass; `App.tsx`'s only `returnToBoardLayer` occurrence remains a comment, confirmed by direct read |
| 17 | BOARD-08 — board interactions complete without perceptible lag at 1,000+ items | ✓ VERIFIED | `perf_seed_1000.rs` re-run fresh this session, passes (server-side). The perceived-UI half is **no longer uncertain**: the owner confirmed it live on the real seeded 1,067-item board after the CR-01 fix — `01-UAT.md` test 2, `result: pass`, commit 143e7ec |
| 18 | BOARD-09 — every item shows a chronological, actor-attributed activity trail | ✓ VERIFIED (mechanism) | Unchanged |
| 19 | BOARD-10 — user registers several local git repos as projects and switches boards, with rejected registrations surfaced, including after a successful retry | ✓ VERIFIED | Unchanged; not touched by 01-21 |
| 20 | Every task's epic pill shows a human-readable `KEY Title`, never a raw internal ULID, regardless of project size (G-01-2) | ✓ VERIFIED | Unchanged; raw-fallback grep gate still 0, re-confirmed this session |
| 21 | Opening quick-add (⌘N/⌘⇧N, any route) lands the cursor in its input from any scroll position and any Backlog-collapse state, including on the real forwarded `menu:action` path (G-01-4) | ✓ VERIFIED | `quick-add-focus.test.tsx` (24/24) and `menu-bridge.test.tsx` re-run fresh this session, pass |
| 22 | A status band's collapse state is a user-controlled local UI preference (01-UI-SPEC.md) that persists once toggled, including while quick-add is open, and including across a project switch and back (CR-01, both the original defect and its round-trip residual) | ✓ **VERIFIED** | Direct read of `BoardView.tsx:166,414-425` confirms the per-project `Set` guard (not the scalar that shipped the residual). `collapsing_backlog_while_quick_add_is_open_sticks`, `the_backlog_collapse_toggle_is_operable_on_an_empty_project`, and `returning_to_a_project_after_a_deliberate_collapse_does_not_re_expand_it` all pass fresh this session |

**Score:** 22/22 truths verified (0 present-behavior-unverified, 0 failed). Truth #22 — the sole
gap in the prior round — is closed, and this session independently re-drove the exact test that
proves the round-trip residual the incremental code review found, rather than accepting the
review's or SUMMARY's word.

### Required Artifacts

| Artifact | Expected | Status | Details |
|----------|----------|--------|---------|
| `packages/desktop/src/board/BoardView.tsx` (`backlogAutoExpandedRef`, expand-Backlog effect) | Rising-edge guard that seeds Backlog expansion once per quick-add-reachability episode, per project, surviving a project round trip | ✓ **VERIFIED** | Confirmed by direct read: `useRef<Set<string>>` (line 166), effect at lines 414-425 keys on `projectId ?? ""`, checks set membership before writing, clears the whole set only when `effectiveQuickAddOpen` goes false |
| `packages/desktop/src/board/BoardView.tsx` (`openQuickAdd`) | Explicit re-open (e.g. re-pressing ⌘N after a deliberate collapse) is a fresh rising edge, independent of the passive episode guard | ✓ **VERIFIED** | Confirmed by direct read (lines 485-488): `if (collapsedByStatus.backlog) expandBand(projectId ?? "", "backlog");` inside `openQuickAdd`, the sole writer of `quickAddOpen: true` |
| `packages/desktop/src/board/__tests__/quick-add-focus.test.tsx` | Regression suite covering both the original CR-01 property and its round-trip residual | ✓ **VERIFIED** | 24 tests (up from 16 at the prior verification), re-run fresh this session, all pass — including the new round-trip case |
| `packages/desktop/src/test/setup.ts` (`scrollTo` stub) | Ceiling-clamps to a real scrollable range only when jsdom reports one, leaving `DEEP_SCROLL_OFFSET` unclamped otherwise (IN-01) | ✓ **VERIFIED** | Confirmed by direct read; guarded on positive `scrollHeight`; self-check test passes |
| `.planning/phases/01-the-board-is-the-store-of-record/01-UI-SPEC.md` | Documents band collapse as user-owned and the auto-expansion as a one-time action | ✓ **VERIFIED** | Confirmed present by direct read (lines 372, 834), attributed to plan `01-21` (CR-01) |
| `packages/desktop/src/board/StatusBand.tsx` | Unguarded click handler — CR-01's fix must not make the affordance inert by design | ✓ **VERIFIED (unchanged, absence confirmed)** | Not in `files_modified`; direct read confirms `onClick={onToggleCollapsed}` (line 26) remains unguarded |

### Key Link Verification

| From | To | Via | Status | Details |
|------|----|----|--------|---------|
| `StatusBand.tsx`'s `onClick` | `collapseStore.ts::toggle` | `onToggleCollapsed={() => toggleCollapsed(projectId, row.status)}` | ✓ WIRED, AND STICKS | Confirmed by direct read and by `collapsing_backlog_while_quick_add_is_open_sticks` passing fresh this session — the toggle's effect on the store is no longer reverted by the expand-Backlog effect |
| `BoardView.tsx`'s expand-Backlog effect | `collapseStore.ts::expand` | `expandBand(key, "backlog")` guarded on `backlogAutoExpandedRef.current.has(key)` | ✓ WIRED, RISING-EDGE ONLY | Confirmed by direct read; `the_expand_effect_performs_no_store_write_on_later_renders` passes fresh this session (object-identity check on `collapsedByProject`) |
| `BoardView.tsx`'s `projectId` prop change (no React `key` on `<Board>` in `App.tsx:212`) | `backlogAutoExpandedRef` | Set membership keyed on project id, not a scalar overwrite | ✓ WIRED, ROUND-TRIP SAFE | Confirmed by direct read (Set, not scalar) and by `returning_to_a_project_after_a_deliberate_collapse_does_not_re_expand_it` passing fresh this session |
| `openQuickAdd` | `collapseStore.ts::expand` | Explicit-request expansion, independent of the passive episode guard | ✓ WIRED | Confirmed by direct read; `re_pressing_cmd_n_after_a_deliberate_collapse_expands_and_focuses_again` passes fresh this session |

### Data-Flow Trace (Level 4)

| Artifact | Data Variable | Source | Produces Real Data | Status |
|----------|---------------|--------|---------------------|--------|
| `BoardView.tsx` | `collapsedByStatus.backlog` | `useCollapseStore`'s per-project map, now written at most once per reachability episode per project | Real; user's click is the last writer once the episode has seeded that project | ✓ FLOWING, NO LONGER OVERRIDDEN |
| `BoardView.tsx` | `backlogAutoExpandedRef.current` (Set) | Local ref, not derived from any store; membership persists across renders and project switches, cleared only on `effectiveQuickAddOpen` falling to false | Real, in-memory, confirmed by direct read | ✓ FLOWING |

### Requirements Coverage

| Requirement | Source Plan | Description | Status | Evidence |
|-------------|------------|--------------|--------|----------|
| DATA-01 | 01-03, 01-04 | Transactional outbox | ✓ SATISFIED | Truth #1 |
| DATA-02 | 01-01, 01-03 | Client-generated ULIDs | ✓ SATISFIED | Truth #2 |
| DATA-03 | 01-03, 01-04 | Distinct human/agent actor model | ✓ SATISFIED | Truth #3 |
| DATA-05 | 01-10 | Cursor-resumable event stream | ✓ SATISFIED | Truth #4 |
| DATA-07 | 01-05 | Crash-safe persistence | ✓ SATISFIED | Truth #5 |
| DATA-08 | 01-01, 01-05 | Automatic, reversible migrations | ✓ SATISFIED | Truth #6 |
| BOARD-01 | 01-04, 01-12, 01-14, 01-15, 01-17, 01-18 | CRUD in fixed 3-level hierarchy, reachable from the UI, single-parent invariant, every label surface roster-backed | ✓ SATISFIED | Truths #7, #8, #9, #20 |
| BOARD-02 | 01-06 | Discrete checkable acceptance criteria | ✓ SATISFIED | Truth #10 |
| BOARD-04 | 01-04, 01-19, 01-21 | Fixed, non-reconfigurable workflow, including a user-owned collapse affordance that survives quick-add and project switches | ✓ SATISFIED | Truths #11, #22 |
| BOARD-05 | 01-07 | Reorder/reprioritize | ✓ SATISFIED | Truth #12 |
| BOARD-06 | 01-08, 01-17, 01-18 | Filter/search across items, correct at the volume SC #3 names | ✓ SATISFIED | Truths #13, #20 |
| BOARD-07 | 01-02, 01-09, 01-13, 01-14, 01-16, 01-19, 01-20, 01-21 | Full keyboard operability, layer-gated global bindings, native menu obeys the same guard, focus delivery survives virtualization, re-press re-expands and re-focuses | ✓ SATISFIED | Truths #14, #15, #16, #21, #22 |
| BOARD-08 | 01-02, 01-08, 01-19, 01-20, 01-21 | No perceptible lag at 1,000+ items, including with the fixed render-path effect | ✓ SATISFIED | Truth #17 — owner-confirmed at volume (01-UAT.md test 2) |
| BOARD-09 | 01-10 | Chronological actor-attributed activity trail | ✓ SATISFIED (mechanism) | Truth #18 |
| BOARD-10 | 01-11, 01-15 | Register/switch multiple project boards, no silently swallowed errors | ✓ SATISFIED | Truth #19 |

No orphaned requirements — all 15 IDs this phase's plans declare (`DATA-01/02/03/05/07/08`,
`BOARD-01/02/04/05/06/07/08/09/10`) match exactly the 15 IDs `REQUIREMENTS.md`'s traceability table
assigns to Phase 1. `REQUIREMENTS.md`'s own per-requirement status column reads "Complete" for
`BOARD-04`, `BOARD-07`, `BOARD-08` (updated by plan 01-21's close-out) and still literally reads
"Gaps Found" for the remaining 12 IDs — that column is not auto-synced by this verification and
was left in the same state by the prior round; this report is the authoritative per-requirement
disposition for this phase as of this run, consistent with the prior round's handling of the same
discrepancy.

### Behavioral Spot-Checks

| Behavior | Command | Result | Status |
|----------|---------|--------|--------|
| CR-01's original property holds, fresh this session | `npm --prefix packages/desktop run test -- --run src/board/__tests__/quick-add-focus.test.tsx` (case: `collapsing_backlog_while_quick_add_is_open_sticks`) | pass | ✓ PASS |
| CR-01's zero-item permanent-inertness case holds, fresh this session | same file (case: `the_backlog_collapse_toggle_is_operable_on_an_empty_project`) | pass | ✓ PASS |
| CR-01's round-trip residual is closed, fresh this session | same file (case: `returning_to_a_project_after_a_deliberate_collapse_does_not_re_expand_it`) | pass | ✓ PASS |
| Full quick-add-focus suite, fresh this session | `npm --prefix packages/desktop run test -- --run src/board/__tests__/quick-add-focus.test.tsx` | 24/24 passed | ✓ PASS |
| Full frontend suite is green, fresh this session | `npm --prefix packages/desktop run test -- --run` | 20 files / 155 tests passed | ✓ PASS |
| Frontend build is clean, fresh this session | `npm --prefix packages/desktop run build` | `tsc && vite build` succeeded, no `error TS` | ✓ PASS |
| Rust workspace tests are green, fresh this session | `cargo test --workspace` | every `test result:` reads `ok`, 0 `FAILED` occurrences | ✓ PASS |
| Guard is a `Set`, not the scalar that shipped the residual | direct read, `BoardView.tsx:166` | `const backlogAutoExpandedRef = useRef<Set<string>>(new Set());` | ✓ PASS |
| `StatusBand.tsx`'s click handler remains unguarded | direct read, `StatusBand.tsx:26` | `onClick={onToggleCollapsed}` | ✓ PASS |
| No debt markers in the 4 files this round touched | `grep -nE "TBD\|FIXME\|XXX\|TODO\|HACK\|PLACEHOLDER"` per file | zero hits, all 4 files | ✓ PASS |
| Diff scope discipline — no prohibited file touched | `git show --stat` on all 8 round commits | only `BoardView.tsx`, `quick-add-focus.test.tsx`, `setup.ts`, `01-UI-SPEC.md` (plus planning docs) | ✓ PASS |

### Probe Execution

Not applicable — no `scripts/*/tests/probe-*.sh` convention in this project.

### Anti-Patterns Found

| File | Line | Pattern | Severity | Impact |
|------|------|---------|----------|--------|
| `packages/desktop/src/board/useBoardQuery.ts` | 322-328 | `useEpics` lacks `placeholderData: keepPreviousData` | ⚠️ Warning (carried forward from prior rounds, unchanged) | Transient `Unknown epic` flash on project switch; not touched by 01-21 |
| `packages/desktop/src/board/useBoardQuery.ts`, `FilterBar.tsx`, `BoardView.tsx` | various | No consumer of `useEpics` reads `.isError`/`.error` | ⚠️ Warning (carried forward, unchanged) | Not touched by 01-21 |
| `packages/desktop/src/board/useBoardQuery.ts` | 255-262 | Epic-mutating hooks invalidate only `boardQueryKey`, never `epicsQueryKey` directly | ⚠️ Warning (carried forward, unchanged) | Not touched by 01-21 |
| `packages/desktop/src-tauri/tauri.conf.json` | 23 | `"csp": null` | ⚠️ Warning (carried forward, unchanged) | Deliberately open by decision |
| `packages/desktop/src/board/DoneWarning.tsx` | 74 | Renders `"{checked}/{total} criteria unchecked"` | ⚠️ Warning (carried forward, unchanged) | 01-UI-SPEC.md contract is the defect, not the code |
| `packages/desktop/src-tauri/src/main.rs`, `menu.rs`, `state.rs` | various | Forwarded-menu-action id list hand-synced across 4 sites, no Rust-side test | ⚠️ Warning (carried forward, unchanged) | Not touched by 01-21 |
| `packages/desktop/src-tauri/src/commands/issue.rs` | 42-62 | Byte-vs-character length validation | ⚠️ Warning (carried forward, unchanged) | Not touched by 01-21 |
| `packages/desktop/src/projects/RegisterProjectFlow.tsx` | 104 | `(error as Error).message` on a plain-string rejection | ⚠️ Warning (carried forward, unchanged) | Not touched by 01-21 |
| `packages/desktop/src/board/__tests__/setup.ts` scrollTo stub | 56-67 (IN-01) | Previously flagged as lacking a ceiling clamp | ℹ️ Info — **closed this round** | Guarded ceiling clamp added; self-check test passes; reviewer confirmed sound, no coverage-through-a-real-scroll-path test yet (acknowledged, not functional) |

No `TBD`/`FIXME`/`XXX`/`TODO`/`HACK`/`PLACEHOLDER` markers found in any of the 4 files this round
touched. No blocker-severity anti-patterns found in this round's diff.

### Human Verification — Discharged

Both items this report previously listed as outstanding have now been run by the owner against a real
`tauri dev` build and recorded in `01-UAT.md` (`status: complete`, 2/2 passed, 0 issues, commit
`143e7ec`). Nothing in this section is still owed.

1. **01-20-PLAN.md Task 3's live walkthrough of the G-01-4 fix, also covering the CR-01 collapse
   property** — ✓ **PASSED**
   Scroll deep, ⌘N lands the cursor with no click/Tab, ⌘⇧N the same for an epic, a re-press returns
   focus after clicking elsewhere, a collapsed Backlog band expands and focuses, the detail panel
   refuses all three bindings without scrolling, no visual jank — plus the newly-added check that
   manually collapsing the Backlog header while quick-add is open sticks in the live app, including
   across a project round-trip.
   **Recorded as:** `01-UAT.md` test 1, `result: pass`.
   **Significance:** this is the walkthrough every prior session still owed — 01-20-PLAN.md Task 3 had
   never been executed by a human until this round. The CR-01 round-trip property had only ever been
   proven under jsdom; it is now confirmed in the running application.

2. **Perceived responsiveness at 1,000+ items, after three rounds of render-path change** — ✓ **PASSED**
   Reorder, filter, search and project switching with the mouse untouched on the real seeded board,
   including with quick-add open.
   **Recorded as:** `01-UAT.md` test 2, `result: pass`.
   **Significance:** the prior round deliberately refused to carry forward the older `pass`, because
   that entry was self-contradictory (its own `note:` said the check "stays pending") and
   `BoardView.tsx`'s render-path effects had changed twice since it was written. This is a fresh,
   unambiguous confirmation over the current code, with CR-01's self-sustaining render-path write
   removed rather than merely retimed.

## Gaps Summary

**No gaps.** CR-01 — the sole blocker keeping the phase at `gaps_found` — is closed, both its
original form (Observable Truth #22 in the prior verification) and the round-trip residual found
by this session's incremental code review. Both were independently re-verified in this report by
direct code read (the `Set`-based guard, not the superseded scalar) and by fresh execution of the
specific named tests that exercise each property, not accepted from any SUMMARY's or review
document's narration.

**Two human-verification items remain**, unchanged in substance from the prior round and expanded
slightly in scope to also ask the owner to confirm CR-01's fix live: the G-01-4/CR-01 fix's
live-app walkthrough (never run by any executor) and a fresh confirmation of perceived
responsiveness at volume (the existing UAT record predates all three rounds of render-path
changes to `BoardView.tsx`). Per the status decision tree, a phase with zero open gaps but
outstanding human-verification items is `human_needed`, not `passed`.

---

_Verified: 2026-09-10T16:10:00Z_
_Verifier: Claude (gsd-verifier)_
