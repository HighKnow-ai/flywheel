---
phase: 01-the-board-is-the-store-of-record
plan: 07
subsystem: database
tags: [rust, rusqlite, fractional-index, react, tanstack-query, radix-ui, lucide-react, tauri]

# Dependency graph
requires:
  - phase: 01-the-board-is-the-store-of-record (plan 01-03)
    provides: "core::ranking (rank_after/rank_between), core::query::priority_sort_key, the schema's priority/estimate/assignee_id columns, StatusPicker.tsx's Radix picker shape"
  - phase: 01-the-board-is-the-store-of-record (plan 01-04)
    provides: "the pickers/ directory, StatusBand.tsx, IssuesLane.tsx, collapseStore.ts"
  - phase: 01-the-board-is-the-store-of-record (plan 01-06)
    provides: "criteria_checked/criteria_total in list_board, the acceptance_criterion.rs reorder-function precedent this plan's reorder_task/reorder_epic/reorder_issue mirror"
provides:
  - "ranking::ReorderDirection::parse and rank_before (fractional-index groundwork completing 01-03's rank_after/rank_between)"
  - "reorder_task/reorder_epic/reorder_issue: one indexed neighbour query, one UPDATE, one event per move"
  - "set_priority/set_estimate/set_assignee on task.rs and epic.rs, no-op-on-redundant-value discipline"
  - "domain::actor::list_actors + actor_list Tauri command (the assignee roster)"
  - "PriorityPicker.tsx/EstimatePicker.tsx/AssigneePicker.tsx following StatusPicker's Radix shape"
  - "BoardRow.tsx's estimate badge and assignee avatar, plus the container-query progressive-disclosure ladder"
  - "packages/core/tests/ranking.rs — 8 named tests proving the order is total and a move costs one row"
affects: [phase-09-agent-fanout, phase-06-triage-lane]

# Actuals (#2632)
actuals:
  tokens: 32567
  tasks: 3
  commits: 3

plan_head_before: ff62d20

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "Reorder domain functions (reorder_task/reorder_epic/reorder_issue) compute both neighbours in one indexed query (ORDER BY rank DESC/ASC, id DESC/ASC LIMIT 2 against a row-value (rank, id) comparison), then call rank_before/rank_between/rank_after — never a renumbering pass, never a second round trip to find the second neighbour"
    - "BoardView.tsx's consolidated activePicker: { kind; id } | null + pickerAnchor state pair, replacing one useState triple per picker — the reference shape for any future Nth row-level picker"
    - "legend/marks.ts's channel + id + value<->mark-id-helper-function triad (PRIORITY_MARKS/priorityValueFromMarkId, ESTIMATE_MARKS/estimateMarkId/estimateLetter, actorTypeMarkId) as the established shape for adding a new mark-backed field"
    - "CSS container queries (container-type: inline-size on .board-row) for the progressive-disclosure ladder, responding to the row's own available width rather than the document viewport — the first use of this technique in the codebase"

key-files:
  created:
    - packages/desktop/src/board/pickers/PriorityPicker.tsx
    - packages/desktop/src/board/pickers/EstimatePicker.tsx
    - packages/desktop/src/board/pickers/AssigneePicker.tsx
    - packages/desktop/src-tauri/src/commands/actor.rs
    - packages/core/tests/ranking.rs
    - packages/desktop/src/board/__tests__/reorder.test.tsx
  modified:
    - packages/core/src/ranking.rs
    - packages/core/src/domain/task.rs
    - packages/core/src/domain/epic.rs
    - packages/core/src/domain/issue.rs
    - packages/core/src/domain/actor.rs
    - packages/core/src/query/mod.rs
    - packages/desktop/src-tauri/src/main.rs
    - packages/desktop/src-tauri/src/commands/mod.rs
    - packages/desktop/src-tauri/src/commands/task.rs
    - packages/desktop/src-tauri/src/commands/epic.rs
    - packages/desktop/src-tauri/src/commands/issue.rs
    - packages/desktop/src-tauri/src/commands/board.rs
    - packages/desktop/src-tauri/capabilities/default.json
    - packages/desktop/src/board/BoardRow.tsx
    - packages/desktop/src/board/BoardView.tsx
    - packages/desktop/src/board/useBoardQuery.ts
    - packages/desktop/src/legend/marks.ts
    - packages/desktop/src/legend/Legend.tsx
    - packages/desktop/src/App.css
    - DESIGN.md

key-decisions:
  - "Reorder neighbour lookups for tasks/epics are filtered by priority as well as (project_id, status) — the composite index only covers (project_id, status, rank), but computing a new rank against the true global rank-neighbour (ignoring priority) could compute a rank that does not reflect the item's visual position within its priority band, since rank values are not partitioned per priority. Filtering by priority in the WHERE clause, even though it costs an extra residual filter over the index range, is what keeps a keyboard reorder from silently displacing the wrong neighbour."
  - "Priority change does not rewrite rank. Setting priority alone leaves the item's existing rank untouched — its new visual position within the new priority band falls wherever that rank naturally compares against other same-priority items. No plan behavior bullet required forcing rank to the top of the new band, and doing so would have added an undocumented, untested side effect."
  - "estimate is rendered as a letter (S/M/L) directly from a lookup table (estimateLetter), never derived from the stored 1-3 integer via arithmetic display formatting — reinforces D-12's 'never the numeric reading' intent at the rendering layer, not only the query layer."
  - "AssigneePicker has no fixed-digit keyboard shortcut (unlike Priority's 0-4 and Estimate's 0-3) because the actor roster is not a fixed-size, design-time-known set — relies on FocusScope's trapped Tab order and native button Enter/Space activation instead."
  - "Task 1's inherited rank_before/rank_between groundwork (written by the halted session) was reviewed against the plan and kept as-is — it matched D-11's contract exactly and needed no correction, only the ReorderDirection::parse companion and the domain-layer callers this plan adds."

patterns-established:
  - "One indexed neighbour-lookup query per reorder direction (LIMIT 2 against a row-value (rank, id) comparison) rather than two separate single-row queries — the pattern any future reorderable list should follow."
  - "Consolidated multi-picker overlay state (activePicker/pickerAnchor) instead of one useState triple per picker kind."

requirements-completed: [BOARD-05]

coverage:
  - id: D1
    description: "Reordering an item up/down rewrites exactly one row and appends one attributed event; a group of zero or one item is a no-op"
    requirement: BOARD-05
    verification:
      - kind: unit
        ref: "packages/core/tests/ranking.rs#a_move_rewrites_exactly_one_row"
        status: pass
      - kind: unit
        ref: "packages/core/tests/ranking.rs#reorder_in_a_tiny_group_is_a_no_op"
        status: pass
    human_judgment: false
  - id: D2
    description: "200 random moves over 50 items in one group leave every rank distinct and the read order matches the move history"
    requirement: BOARD-05
    verification:
      - kind: unit
        ref: "packages/core/tests/ranking.rs#many_moves_keep_ranks_distinct"
        status: pass
    human_judgment: false
  - id: D3
    description: "Priority sorts first and manual rank orders within a priority band; the board's order is total and reproducible across repeated reads"
    requirement: BOARD-05
    verification:
      - kind: unit
        ref: "packages/core/tests/ranking.rs#priority_sorts_before_rank"
        status: pass
      - kind: unit
        ref: "packages/core/tests/ranking.rs#board_order_is_reproducible"
        status: pass
    human_judgment: false
  - id: D4
    description: "Priority, estimate and assignee are set from the keyboard (p/e/a), each a no-op on a redundant value, and assignee rejects an id naming no real actor"
    requirement: BOARD-05
    verification:
      - kind: unit
        ref: "packages/core/tests/ranking.rs#redundant_priority_change_is_a_no_op"
        status: pass
      - kind: unit
        ref: "packages/core/tests/ranking.rs#assignee_must_reference_a_real_actor"
        status: pass
    human_judgment: false
  - id: D5
    description: "⌘↓ on the selected row issues exactly one reorder command and the selection stays on the same item id across the move"
    requirement: BOARD-05
    verification:
      - kind: unit
        ref: "packages/desktop/src/board/__tests__/reorder.test.tsx#⌘↓ issues exactly one reorder call and keeps the selection on the same item id"
        status: pass
    human_judgment: false
  - id: D6
    description: "Live tauri dev walkthrough of the pickers, ⌘↑/⌘↓ displacement, and the 900px progressive-disclosure ladder"
    human_judgment: true
    rationale: "No agent-spawning tool and no confirmed GUI display are available in this execution environment (same limitation 01-02/01-03/01-04/01-06 documented). The plan's own <human-check> block is a live visual/interaction walkthrough that cannot be proven by an automated test in this environment — deferred to /gsd-verify-work, matching the established precedent for this exact gap."
    verification: []

# Metrics
duration: ~65min
completed: 2026-09-09
status: complete
---

# Phase 1 Plan 7: Fractional Ranking, the Priority Tie-Break, and Size/Assignee Summary

**Fractional-index manual rank (rank_before/rank_between/rank_after) with a priority-filtered
neighbour lookup so `⌘↑`/`⌘↓` costs exactly one row; S/M/L estimate and human/agent-badged
assignee added end-to-end from schema through three new Radix pickers, with a CSS
container-query progressive-disclosure ladder on the strip.**

## Performance

- **Duration:** ~65 min (this resumption dispatch, executing after Task 1's groundwork
  — `rank_before`, an unused import — was inherited already-green from a prior session
  terminated mid-flight by an API quota limit; that earlier session's own duration is not
  included here)
- **Completed:** 2026-09-09
- **Tasks:** 3
- **Files modified:** 26 (6 created, 20 modified)

## Accomplishments

- `reorder_task`/`reorder_epic`/`reorder_issue`: one indexed neighbour-lookup query per move
  direction, one `UPDATE`, one attributed event — proven by `a_move_rewrites_exactly_one_row`
  (before/after snapshot compared field-by-field for every row in the group) and
  `many_moves_keep_ranks_distinct` (200 random moves over 50 items, every rank still distinct,
  read order matches the move history exactly).
- `set_priority`/`set_estimate`/`set_assignee` on tasks and epics: no-op on a redundant value
  (no event appended), `set_assignee` rejects an id naming no real actor via the pre-existing
  `assignee_id` foreign key rather than an application-layer check.
- Three new pickers (`PriorityPicker`, `EstimatePicker`, `AssigneePicker`) following
  `StatusPicker`'s exact Radix wiring, wired to `p`/`e`/`a` and `⌘↑`/`⌘↓` in `BoardView.tsx`.
- `BoardRow.tsx` gained the estimate badge (renders the S/M/L letter, never the numeric
  ordinal) and the assignee avatar in Row Anatomy's fixed order, plus a CSS
  container-query-driven progressive-disclosure ladder (epic pill first, then assignee avatar,
  then estimate badge last) that responds to the row's own available width.
- `packages/core/tests/ranking.rs` — 8 named tests, all passing on first run, proving the
  board's order is total and reproducible and that a reorder costs exactly one row.

## Task Commits

1. **Task 1: Fractional ranking, the priority tie-break, and the size and assignee fields** —
   `935d39a` (feat)
2. **Task 2: The pickers, the reorder keystrokes, and the strip's remaining annotation fields** —
   `09ee41c` (feat)
3. **Task 3: Prove the order is total and a move costs one row** — `1291269` (test)

_Note: Task 1 and Task 3 carried `tdd="true"`. This project's own established precedent
(recorded in `01-03`/`01-04`/`01-06`'s SUMMARYs — "`workflow.tdd_mode` is not the
strict-gate-enforcing setting here") is implementation-first sequencing: Task 1 implements and
verifies green against the existing suite, and the next `tdd="true"` task (Task 3) writes the
dedicated invariant-proving test suite against the already-implemented code, all tests passing
on first run. That is exactly what happened here — no RED-phase Rust compile-error workaround
was needed, and no TDD discipline was violated relative to this project's own precedent._

**Plan metadata:** pending (this commit, made immediately after this SUMMARY)

## Files Created/Modified

- `packages/core/src/ranking.rs` — `ReorderDirection::parse`; `rank_before` inherited already-green from the halted session
- `packages/core/src/domain/task.rs` — `reorder_task`, `set_priority`, `set_estimate`, `set_assignee`
- `packages/core/src/domain/epic.rs` — `reorder_epic`, `set_priority`, `set_estimate`, `set_assignee`
- `packages/core/src/domain/issue.rs` — `reorder_issue` only (D-07: no priority/estimate/assignee)
- `packages/core/src/domain/actor.rs` — `list_actors` (new, Rule 2 — required by the assignee picker)
- `packages/core/src/query/mod.rs` — `BoardItem` gained `estimate`/`assignee_id`
- `packages/desktop/src-tauri/src/commands/{task,epic,issue}.rs` — 9 new Tauri commands
- `packages/desktop/src-tauri/src/commands/actor.rs` — new, `actor_list` command
- `packages/desktop/src-tauri/src/commands/board.rs` — `BoardItemDto` gained `estimate`/`assignee_id` (Rule 2)
- `packages/desktop/src-tauri/src/main.rs`, `capabilities/default.json` — 10 new commands registered/mirrored
- `packages/desktop/src/board/pickers/{PriorityPicker,EstimatePicker,AssigneePicker}.tsx` — new
- `packages/desktop/src/board/BoardRow.tsx`, `BoardView.tsx`, `useBoardQuery.ts` — the strip's new fields, the four-picker overlay dispatcher, the reorder/setter mutation hooks
- `packages/desktop/src/legend/marks.ts`, `Legend.tsx` — `estimate`/`assignee` channels
- `packages/desktop/src/App.css` — the progressive-disclosure container queries
- `DESIGN.md` — new "Phase 1, Plan 01-07" section (self-conducted craft-floor review)
- `packages/core/tests/ranking.rs`, `packages/desktop/src/board/__tests__/reorder.test.tsx` — new

## Decisions Made

See `key-decisions` in frontmatter above for the full list; the most consequential is filtering
the reorder neighbour lookup by `priority` in addition to `(project_id, status)` — a deviation
from the plan action text's literal "(project_id, status, rank)" phrasing, made to keep a
keyboard reorder from computing a rank against a neighbour in a different priority band (see
Deviations below).

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 1 - Bug] Filtered the reorder neighbour lookup by priority, not just (project_id, status)**
- **Found during:** Task 1 (implementing `reorder_task`)
- **Issue:** The plan's action text names the composite index `(project_id, status, rank)` for
  the neighbour lookup, without mentioning priority. Since `create_task`/`create_epic` append new
  items to the *whole status band's* tail rank (ignoring priority), rank values from different
  priority levels interleave in one shared numeric space. A neighbour lookup that ignores
  priority could compute a new rank against an item in a completely different priority band —
  the mutation would still be internally consistent (no duplicate ranks, no corruption), but the
  displaced neighbour would not match what the user visually sees as "the item above/below" in
  `list_board`'s `priority ASC, rank ASC, id ASC` grouped view. UI-SPEC's own keyboard map entry
  ("Reorder the selected item up/down *within its priority band*") confirms priority-scoped
  movement is the intended behavior.
- **Fix:** Added `AND priority = ?3` to the neighbour-lookup `WHERE` clause in
  `reorder_task`/`reorder_epic` (issues have no priority column, so `reorder_issue` is
  unaffected). The composite index `(project_id, status, rank)` is still used for its
  `(project_id, status)` prefix; `priority` is a residual filter over that range.
- **Files modified:** `packages/core/src/domain/task.rs`, `packages/core/src/domain/epic.rs`
- **Verification:** `priority_sorts_before_rank` and `many_moves_keep_ranks_distinct` in
  `packages/core/tests/ranking.rs` both pass; the latter's 50-item group is entirely
  single-priority by construction, so it does not by itself prove the priority filter, but the
  filter's absence would produce no observable failure in either existing test — it is a
  correctness property proven by code reading and the UI-SPEC citation above, not by a
  dedicated failing-without-the-fix test. Flagged here rather than silently claimed.
- **Committed in:** `935d39a` (Task 1 commit)

**2. [Rule 2 - Missing Critical] Added `domain::actor::list_actors` + a new `actor_list` Tauri command**
- **Found during:** Task 1 (laying groundwork for Task 2's `AssigneePicker`)
- **Issue:** The plan's `files_modified` list names `pickers/AssigneePicker.tsx` and says it
  "lists the actors in the database with an explicit Unassigned entry," but no command existed
  to fetch the actor roster from the renderer — `domain::actor` only had single-actor resolvers
  (`local_human_actor_id`, `local_human_actor`, `system_actor`), none of which return a list.
  Without this, `AssigneePicker` would have had no data to render at all.
  `commands/board.rs`'s `BoardItemDto` similarly needed `estimate`/`assignee_id` fields added —
  without them, the fields existed in the database and the core's `BoardItem` struct but never
  reached the renderer.
- **Fix:** Added `list_actors` to `domain/actor.rs` and a new `commands/actor.rs` module
  exposing it as `actor_list`; added `estimate`/`assignee_id` to `BoardItemDto` and its `From`
  impl.
- **Files modified:** `packages/core/src/domain/actor.rs`,
  `packages/desktop/src-tauri/src/commands/actor.rs` (new),
  `packages/desktop/src-tauri/src/commands/board.rs`,
  `packages/desktop/src-tauri/src/commands/mod.rs`, `main.rs`, `capabilities/default.json`
- **Verification:** `cargo build --workspace` and `cargo test -p core` both green; `useActors()`
  in `useBoardQuery.ts` consumes `actor_list` and `AssigneePicker` renders its result in
  `BoardView.tsx`'s picker dispatcher.
- **Committed in:** `935d39a` (Task 1 commit)

---

**Total deviations:** 2 auto-fixed (1 bug prevention, 1 missing critical functionality)
**Impact on plan:** Both were necessary for correctness (deviation 1) and for the plan's own
stated Task 2 deliverable to have any data to render at all (deviation 2). No scope creep beyond
what D-11/BOARD-05 and Task 2's own action text already required.

## Issues Encountered

None beyond the deviations above. Task 1's inherited `rank_before`/unused-import groundwork from
the halted session compiled and tested green on first inspection and needed no correction — it
matched D-11's contract exactly.

## User Setup Required

None — no external service configuration required.

## Next Phase Readiness

- The board now answers "what is next" identically on every read: priority sorts first, manual
  rank orders within a band, the ULID id is the final tiebreaker. This is the deterministic
  ordering contract Phase 9's agent-fanout planner will read from.
- `reorder_task`/`reorder_epic`/`reorder_issue`'s one-indexed-query-per-direction pattern is
  ready for Phase 6's triage lane to reuse if issues ever gain their own reorderable UI.
- **Known deferred surface — not a blocker:** issue reordering has a working core function and
  Tauri command (`reorder_issue`, proven in `ranking.rs`), but `IssuesLane.tsx` was not touched
  by this plan and has no keyboard selection model to attach `⌘↑`/`⌘↓` to yet. A later plan can
  wire it without any core or Tauri change.
- **Live `tauri dev` walkthrough not run this session** (coverage item D6) — deferred to
  `/gsd-verify-work`, matching the precedent `01-04`/`01-06` established for the same
  no-GUI-display limitation.

---
*Phase: 01-the-board-is-the-store-of-record*
*Completed: 2026-09-09*

## Self-Check: PASSED

All created files verified present on disk; all three task commit hashes (935d39a, 09ee41c,
1291269) verified present in git log. No missing items.
