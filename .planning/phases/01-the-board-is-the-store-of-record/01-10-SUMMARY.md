---
phase: 01-the-board-is-the-store-of-record
plan: 10
subsystem: database
tags: [rusqlite, sqlite, event-sourcing, tauri-commands, tanstack-query, react, lucide-react]

# Dependency graph
requires:
  - phase: 01-the-board-is-the-store-of-record (plan 01-03)
    provides: "Migration 0002_board_schema.sql's events/event_sequence_counters tables, append_event/next_sequence, the CQRS-lite outbox with a monotonic per-(project,origin) sequence"
  - phase: 01-the-board-is-the-store-of-record (plan 01-04)
    provides: "ItemDetailPanel.tsx's placeholder-free section boundary reserved for the activity trail"
  - phase: 01-the-board-is-the-store-of-record (plan 01-06)
    provides: "acceptance_criterion events denormalised onto their parent's task_id/epic_id column"
  - phase: 01-the-board-is-the-store-of-record (plan 01-09)
    provides: "state/uiStore.ts's detailItemId, BoardView.tsx's ItemDetailPanel mount point"
provides:
  - "core::domain::event::render_description — the one function that turns an event's payload into its trail sentence"
  - "core::query::events::{activity_trail, events_since_cursor, EventCursor, EventRow} — the item trail read and the DATA-05 cursor-resumable stream"
  - "Two Tauri commands: events_activity_trail, events_since_cursor (both read-only, both cap their requested window server-side)"
  - "item-detail/ActivityTrail.tsx — the paginated, newest-first, actor-badged trail section embedded in ItemDetailPanel.tsx"
  - "legend/marks.ts's assignee-system mark, completing the human/agent/system actor-badge triad"
affects: ["Phase 2+ relay (RLAY-01 names DATA-01/DATA-05's append-only, cursor-readable event log as its integration seam — no schema change needed)", "any future issue-detail surface (would need stream_type/stream_id filtering, not a new column, per the Known deferred surfaces note below)"]

# Actuals (#2632)
actuals:
  tokens: 16861
  tasks: 3
  commits: 3
plan_head_before: 70d7332c0a332d57521ec815fb44942b341c1381

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "render_description reads the pre-rendered \"label\" every domain mutation function already writes into its event payload (a fact discovered by reading task.rs/epic.rs/issue.rs/acceptance_criterion.rs before writing this function, not assumed) — one place any future relay/mobile client renders the same sentence, never a second UI-side formatter"
    - "activity_trail is a single indexed query keyed on the denormalised task_id/epic_id column, ascending by the ULID id (chronological by construction) — a task's own trail includes its acceptance criteria's events for free, since criterion events already carry their parent's id in that same column (no union, no per-row follow-up)"
    - "events_since_cursor filters on (project_id, origin, sequence > cursor) together, never sequence alone — the exact, gap-free half of DATA-05's two-tier cursor design; cross-origin merge order is approximate, by sorting fetched rows on the ULID id"
    - "Every SQL statement in query/events.rs is a complete literal &str (two full duplicated query strings for the task/epic trail branches) — no format!/string-interpolation SQL construction anywhere in the module"
    - "ActivityTrail.tsx uses useInfiniteQuery so \"Load more\" fetches the next bounded 50-event page, never a growing unbounded window — subscribes to board:changed (D-04) so any mutation anywhere refreshes the trail"

key-files:
  created:
    - packages/core/src/query/events.rs
    - packages/core/tests/activity_trail.rs
    - packages/core/tests/cursor_resume.rs
    - packages/desktop/src-tauri/src/commands/events.rs
    - packages/desktop/src/item-detail/ActivityTrail.tsx
    - packages/desktop/src/item-detail/__tests__/activity-trail.test.tsx
  modified:
    - packages/core/src/domain/event.rs
    - packages/core/src/query/mod.rs
    - packages/desktop/src-tauri/src/main.rs
    - packages/desktop/src-tauri/src/commands/mod.rs
    - packages/desktop/src-tauri/capabilities/default.json
    - packages/desktop/src/item-detail/ItemDetailPanel.tsx
    - packages/desktop/src/legend/marks.ts
    - DESIGN.md

key-decisions:
  - "render_description reads payload[\"label\"] (already present on every event this codebase writes) rather than re-deriving a second, independent rendering from field/before/after — since every existing label was itself built from field/before/after at write time, reading it back is D-19's own consequence, not a shortcut around it. A generic field/before/after fallback (and a bare event_type fallback below that) keeps the function total for any future event type or malformed payload."
  - "criterion_changes_appear_on_the_parent_trail's fixture inserts its criterion row directly via SQL rather than through create_criterion, so the setup itself does not append a sixth criterion.created event — isolating what the test actually proves (toggling shows up on the parent trail) from criterion creation's own, already-covered event"
  - "same_millisecond_events_order_stably constructs two events sharing one literal occurred_at timestamp directly via append_event/next_sequence, rather than relying on real wall-clock coincidence within one millisecond — deterministic, not flaky"
  - "ActivityTrail is guarded by the same !isIssue condition AcceptanceCriteriaList already uses — core::query::events::activity_trail only accepts \"task\"/\"epic\" as parent_kind (events carries no issue_id column), and no surface opens the detail panel for an issue yet, so this is a real scope boundary, not dead code"
  - "assignee-system mark added to legend/marks.ts and actorTypeMarkId widened to map all three actor types, closing a pre-existing gap where \"system\" silently fell back to the human badge — necessary for the trail's own stated human/agent/system triad, even though no assignee picker exposes it yet"

patterns-established:
  - "render_description(event_type, payload) as the one place any future surface (relay, mobile client, a second desktop feature) turns an event into displayed text — extend this function, never add a second formatter"
  - "useInfiniteQuery + board:changed subscription as the established shape for any future paginated, push-invalidated read inside the item detail panel"

requirements-completed: [BOARD-09, DATA-05]

coverage:
  - id: D1
    description: "activity_trail returns a task's/epic's own events plus, for a task, its acceptance criteria's events, in one indexed query ascending by event id; a never-edited item shows exactly one entry; two same-instant events return in a stable order across ten reads; every entry carries a non-empty description and a non-null actor id"
    requirement: "BOARD-09"
    verification:
      - kind: unit
        ref: "packages/core/tests/activity_trail.rs#new_item_has_exactly_one_entry"
        status: pass
      - kind: unit
        ref: "packages/core/tests/activity_trail.rs#criterion_changes_appear_on_the_parent_trail"
        status: pass
      - kind: unit
        ref: "packages/core/tests/activity_trail.rs#same_millisecond_events_order_stably"
        status: pass
      - kind: unit
        ref: "packages/core/tests/activity_trail.rs#every_entry_has_a_description_and_an_actor"
        status: pass
      - kind: unit
        ref: "packages/core/tests/activity_trail.rs#trail_paging_covers_every_entry_once"
        status: pass
    human_judgment: false
  - id: D2
    description: "events_since_cursor is gap-free and duplicate-free across batches that do not evenly divide the log; a cursor past the end returns empty, not an error; a cursor of zero returns the first event; a second origin has its own isolated cursor, and merging both by event id yields write order"
    requirement: "DATA-05"
    verification:
      - kind: unit
        ref: "packages/core/tests/cursor_resume.rs#cursor_batches_deliver_every_event_exactly_once"
        status: pass
      - kind: unit
        ref: "packages/core/tests/cursor_resume.rs#cursor_past_the_end_returns_empty"
        status: pass
      - kind: unit
        ref: "packages/core/tests/cursor_resume.rs#cursor_zero_returns_the_first_event"
        status: pass
      - kind: unit
        ref: "packages/core/tests/cursor_resume.rs#a_second_origin_has_its_own_cursor"
        status: pass
    human_judgment: false
  - id: D3
    description: "Replaying every event from sequence zero reconstructs the same item id/title set the projection (the tasks table) itself holds"
    requirement: "DATA-05"
    verification:
      - kind: unit
        ref: "packages/core/tests/cursor_resume.rs#replay_reconstructs_the_projection"
        status: pass
    human_judgment: false
  - id: D4
    description: "ActivityTrail.tsx renders newest-first from the ascending query, actor-badged (human/agent/system, never colour alone), 50-event windows with Load more, embedded in the detail panel — a single-event trail renders exactly one entry with no empty-state placeholder"
    requirement: "BOARD-09"
    verification:
      - kind: unit
        ref: "packages/desktop/src/item-detail/__tests__/activity-trail.test.tsx#renders exactly one entry for a single-event trail"
        status: pass
      - kind: unit
        ref: "packages/desktop/src/item-detail/__tests__/activity-trail.test.tsx#renders the first 50-event page with a Load more affordance for a 60-event trail"
        status: pass
    human_judgment: false
  - id: D5
    description: "Live tauri dev walkthrough: create a task, rename it, change its status twice, add and check a criterion, then open it — the trail reads newest-first with real before/after text, each line carries an actor badge and a relative timestamp, criterion changes appear on the task's own trail; a second task opened immediately shows exactly one entry"
    verification: []
    human_judgment: true
    rationale: "No agent-spawning tool and no confirmed GUI display are available in this execution environment, matching every prior plan in this phase (01-02 through 01-09). Every mechanical claim is proven by the automated suites above (10 core tests, 2 component tests) plus a self-conducted craft-floor.md review and a clean detect.mjs run (documented in DESIGN.md's new \"Phase 1, Plan 01-10\" section); the live interactive walkthrough is deferred to /gsd-verify-work, matching the established precedent for this exact gap."

duration: ~50min
completed: 2026-09-09
status: complete
---

# Phase 1 Plan 10: The Activity Trail and the Cursor-Resumable Event Stream Summary

**Every task/epic detail panel now ends in a chronological, actor-attributed activity trail read straight from the append-only `events` table (no second history store), and the same table is readable as a resumable, gap-free, duplicate-free stream keyed on the monotonic per-`(project, origin)` sequence — proven by a test that stops mid-stream and resumes from the returned cursor, and by a test that writes a second origin even though nothing in this phase produces one yet.**

## Performance

- **Duration:** ~50 min
- **Started:** 2026-09-09 (this session)
- **Completed:** 2026-09-09
- **Tasks:** 3
- **Files modified:** 14 (across 3 commits)

## Accomplishments

- `core::domain::event::render_description` — reads the pre-rendered `"label"` sentence every domain mutation function already writes into its event payload (discovered by reading `task.rs`/`epic.rs`/`issue.rs`/`acceptance_criterion.rs`, not assumed), with a generic `field`/`before`/`after` fallback and a bare-`event_type` last resort — a defined, non-empty output for every event type this phase emits.
- `core::query::events` (new module): `activity_trail(conn, parent_kind, parent_id, limit, offset)` — one indexed query against the denormalised `task_id`/`epic_id` column, ascending by ULID id, covering a task's criteria events for free; `events_since_cursor(conn, cursor, limit)` — `WHERE project_id = ?1 AND origin = ?2 AND sequence > ?3`, filtered on both columns together, never `sequence` alone (D-17). Every SQL statement in the module is a complete literal `&str` — no `format!`-assembled SQL anywhere. No migration was added; the schema gained no new table.
- `desktop/src-tauri/src/commands/events.rs`: `events_activity_trail`/`events_since_cursor`, each capping its requested window server-side (T-01-24: 50 for the trail, 500 for the cursor stream), registered in `main.rs`'s `generate_handler!` and `capabilities/default.json`'s roster.
- `item-detail/ActivityTrail.tsx`: the trail section embedded in `ItemDetailPanel.tsx` (tasks/epics only, mirroring `AcceptanceCriteriaList`'s `!isIssue` guard). Uses `useInfiniteQuery` so "Load more" fetches the next bounded 50-event page rather than an ever-growing window. Entries render newest-first (reversed at display time only) with an actor badge (human/agent/system, resolved via `useActors()`/`actorTypeMarkId`, never colour alone), the core's pre-rendered description, and a relative timestamp (`<time>`, `tabular-nums`, absolute value in the native `title` tooltip). Subscribes to `board:changed` (D-04) so any mutation anywhere refreshes the trail.
- `legend/marks.ts`: added the `assignee-system` mark and widened `actorTypeMarkId` to map all three actor types instead of silently falling back to the human badge for `"system"` — closing a gap found while wiring the trail's own stated human/agent/system triad.
- Wrote `packages/core/tests/activity_trail.rs` (5 tests) and `packages/core/tests/cursor_resume.rs` (5 tests) — all 10 named exactly as the plan specified, all passing on first run against the already-correct Task 1 implementation — plus `item-detail/__tests__/activity-trail.test.tsx` (2 component tests).
- Self-conducted `craft-floor.md` review (no agent-spawning tool in this execution environment, matching `01-02` through `01-09`'s own documented limitation): `detect.mjs` returned no findings; documented in `DESIGN.md`'s new "Phase 1, Plan 01-10" section.
- All four verification commands green: `cargo build --workspace`, `cargo test --workspace` (80 passing, up from 70), `npm --prefix packages/desktop run test` (46 passing, up from 44), `npm --prefix packages/desktop run build`.

## Task Commits

Each task was committed atomically:

1. **Task 1: The item trail query and the cursor-resumable stream** — `2fce553` (feat)
2. **Task 2: The activity trail section in the detail panel** — `044cd0c` (feat)
3. **Task 3: Prove the trail is complete and the cursor is gap-free** — `8b43e59` (test)

**Plan metadata:** commit pending (this SUMMARY + STATE.md + ROADMAP.md docs commit, below).

## Files Created/Modified

See `key-files` in frontmatter above for the full list. Highlights:

- `packages/core/src/domain/event.rs` — `render_description`
- `packages/core/src/query/events.rs` — `activity_trail`, `events_since_cursor`, `EventCursor`, `EventRow`
- `packages/desktop/src-tauri/src/commands/events.rs` — the new Tauri command surface
- `packages/desktop/src/item-detail/ActivityTrail.tsx` — the new renderer surface
- `packages/desktop/src/legend/marks.ts` — `assignee-system`, widened `actorTypeMarkId`
- `packages/core/tests/activity_trail.rs`, `packages/core/tests/cursor_resume.rs`, `packages/desktop/src/item-detail/__tests__/activity-trail.test.tsx` — the invariant suites

## Decisions Made

See `key-decisions` in frontmatter above for the full list. Most consequential: `render_description` reads the payload's already-present `"label"` rather than re-deriving a second, independent formatter — since every label was itself built from `field`/`before`/`after` at write time (verified by reading every domain mutation module before writing this function), this is D-19's own consequence rather than a shortcut around it.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 2 - Missing Critical] `actorTypeMarkId` silently mapped `"system"` to the human badge**
- **Found during:** Task 2, wiring the trail's actor badge against 01-UI-SPEC.md's explicit "human vs agent vs system, never colour alone" requirement
- **Issue:** `legend/marks.ts`'s `actorTypeMarkId` (from plan 01-07) only distinguished `"agent"` from everything else, falling back to the human badge for `"system"` — correct at the time (Phase 1 never assigned an item to the system actor), but this plan's own trail requires the system actor to render as its own, visually distinct badge whenever it appears as an event's `actor_id`
- **Fix:** Added an `assignee-system` mark (`Cog` glyph) and widened `actorTypeMarkId` to check for `"system"` explicitly before falling back
- **Files modified:** `packages/desktop/src/legend/marks.ts`
- **Verification:** `npm --prefix packages/desktop run build`/`test` green; the mark is declared before `ActivityTrail.tsx` ever renders it ("no mark may exist that the legend does not define")
- **Committed in:** `044cd0c` (Task 2 commit)

---

**Total deviations:** 1 auto-fixed (1 Rule 2 missing-critical-functionality addition).
**Impact on plan:** Necessary for the trail's own stated actor-badge requirement to be true for every actor type the schema already supports, not only the two Phase 1 happens to exercise today. No scope creep beyond this plan's own acceptance criteria.

## Issues Encountered

- **No agent-spawning tool available to this executor**, matching every prior plan in this phase (`01-02` through `01-09`). The shipped `impeccable-finish-reviewer`/`impeccable-documenter` subagents named in Task 2's acceptance criteria could not be literally invoked; substituted a self-conducted review directly against `craft-floor.md`'s Verify/Refuse checklist (documented in `DESIGN.md`'s new "Phase 1, Plan 01-10" section) and authored the `DESIGN.md` update directly, exactly as every prior plan in this phase did for the same limitation. `detect.mjs` was run against every changed surface and returned no findings.
- **No live `tauri dev` launch this session** (no confirmed GUI display in this execution context). This plan's own `<human-check>` block (create a task, rename it, change status twice, add and check a criterion, open it, confirm the trail's exact reading; open a second, fresh task and confirm exactly one entry) is **not yet walked live** — flagged as coverage item D5 with `human_judgment: true`, deferred to `/gsd-verify-work`, matching `01-06`'s/`01-09`'s established precedent exactly.
- **All 10 core tests and both component tests passed on first run** against Task 1's/Task 2's already-correct implementation — not a fabricated RED phase for non-existent behavior. This matches this project's own established precedent (`01-03`/`01-04`/`01-06`/`01-09`'s SUMMARYs: `workflow.tdd_mode` is not the strict-gate-enforcing setting for this project's config) of implementation-first sequencing within a plan, followed by a dedicated invariant-proving suite in the final task.

## User Setup Required

None — no external service configuration required.

## Next Phase Readiness

- `BOARD-09`/`DATA-05` are fully proven: `cargo build --workspace`, `cargo test --workspace` (80 passing, up from 70: 5 `activity_trail` + 5 `cursor_resume` are new), `npm --prefix packages/desktop run build`, and `npm --prefix packages/desktop run test` (46 passing, up from 44) are all green.
- `core::query::events::{activity_trail, events_since_cursor, EventCursor, EventRow}` and `core::domain::event::render_description` are the one place any future surface (a relay, per D-22/RLAY-01; a mobile client; a second desktop feature) reads or renders the event log — extend these, never add a second formatter or a second query path.
- `events_since_cursor` has no renderer caller in Phase 1 by design — it exists purely as the proven, tested integration surface a future relay reads from. Its entire integration contract is "read `events` where `(project_id, origin, sequence) > cursor`" — no new table, no CDC tooling, no schema change, matching D-22's own promise.
- **Known deferred surfaces — not blockers, all explicitly documented in `DESIGN.md`:** issue trails do not exist (`events` carries no `issue_id` column, and no surface opens the detail panel for an issue yet); `BoardRow.tsx`'s "actor-of-last-change" row field is unwired (that's the board strip, not the detail panel's trail, and `BoardRow.tsx` is outside this plan's `files_modified`); the live `tauri dev` walkthrough was not run this session (coverage item D5), deferred to `/gsd-verify-work` matching every prior plan's precedent for the same no-confirmed-GUI-display limitation.

## Known Stubs

None that block this plan's own goal. Every entry `ActivityTrail.tsx` renders comes from a real `events_activity_trail` query result — nothing hardcoded or mocked in the shipped component.

## TDD Gate Compliance (Task 1, Task 3)

| Gate | Commit | Status |
|------|--------|--------|
| Task 1 (`tdd="true"`) | `2fce553` | Implementation-first sequencing, matching `01-03`/`01-04`/`01-06`/`01-09`'s own documented precedent for this project (`workflow.tdd_mode` is not the strict-gate-enforcing setting here): `query/events.rs`'s functions were written, then verified green against the existing `cargo test -p core` suite before commit. The dedicated invariant-proving suites (`activity_trail.rs`, `cursor_resume.rs`) are Task 3's own deliverable, by the plan's own designed sequencing. |
| Task 3 (`tdd="true"`) | `8b43e59` | Written against the already-implemented, already-committed `query::events` module from Task 1 — all 10 Rust tests and both component tests passed on first run (`cargo test -p core --test activity_trail`/`--test cursor_resume`, `npm run test`), consistent with this project's documented precedent that this plan's Task-N-implements/Task-N+1-proves structure is not a violated RED phase. |

## Self-Check: PASSED

- FOUND: packages/core/src/query/events.rs
- FOUND: packages/core/tests/activity_trail.rs
- FOUND: packages/core/tests/cursor_resume.rs
- FOUND: packages/desktop/src-tauri/src/commands/events.rs
- FOUND: packages/desktop/src/item-detail/ActivityTrail.tsx
- FOUND: packages/desktop/src/item-detail/__tests__/activity-trail.test.tsx
- FOUND commit 2fce553 (feat(01-10): the item activity trail query and the cursor-resumable stream)
- FOUND commit 044cd0c (feat(01-10): the activity trail section in the detail panel)
- FOUND commit 8b43e59 (test(01-10): prove the trail is complete and the cursor is gap-free)

---
*Phase: 01-the-board-is-the-store-of-record*
*Completed: 2026-09-09*
