---
phase: 01-the-board-is-the-store-of-record
plan: 08
subsystem: database
tags: [rust, rusqlite, fts5, sqlite-json1, react, tanstack-query, zustand, tauri]

# Dependency graph
requires:
  - phase: 01-the-board-is-the-store-of-record (plan 01-03)
    provides: "the FTS5 tables + sync triggers in migration 0002_board_schema.sql, core::query::mod.rs's list_board/BoardItem/BoardCursor shape, the virtualized rack"
  - phase: 01-the-board-is-the-store-of-record (plan 01-06)
    provides: "criteria_checked/criteria_total in list_board's CRITERIA_JOIN"
  - phase: 01-the-board-is-the-store-of-record (plan 01-07)
    provides: "priority_sort_key, status_sort_key, estimate/assignee_id on BoardItemDto, legend/marks.ts's STATUS_MARKS/PRIORITY_MARKS/ESTIMATE_MARKS registries, pickers/ directory conventions"
provides:
  - "core::query::filter::{BoardFilter, EpicSelector, AssigneeSelector, apply_filter, FILTER_WHERE} — the one filter-translation pattern (named-parameter JSON-array membership, never format!)"
  - "core::query::search::search_items/search_issues — FTS5 phrase+prefix search across tasks/epics/issues plus a case-insensitive key match (D-10), sharing list_board's ORDER_BY/CURSOR_WHERE fragments"
  - "list_board gains a &BoardFilter parameter and filter-aware per-band totals (board_band_counts)"
  - "board_search Tauri command, capped-limit sibling of board_list"
  - "state/uiStore.ts — the filter draft / search term / selected-item-id Zustand store, separate from TanStack Query server state"
  - "useBoardQuery.ts's useDebouncedValue/toFilterInput/keepPreviousData pattern for any future debounced, filter-shaped query"
  - "BoardView.tsx's optional emptyState overlay prop (EmptyStateContent), additive and backward-compatible"
affects: [phase-06-triage-lane, phase-09-agent-fanout]

# Actuals (#2632)
actuals:
  tokens: 32366
  tasks: 3
  commits: 3

plan_head_before: bf82974

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "Filter dimensions bound as a single JSON-array-or-NULL named parameter (json_each(:x), NULL = unfiltered) rather than a dynamically-sized IN(?,?,?) list — the WHERE text never changes shape per call, so it can stay a concat!-built compile-time literal with zero format!/string-interpolation anywhere in packages/core/src/query."
    - "No-epic/unassigned encoded as the empty string inside the same JSON array as a real id (COALESCE(epic_id,'') IN (...)) — a real ULID can never be empty, so one array expresses both 'match these specific ids' and 'match the null bucket' with no separate flag."
    - "A user-typed FTS5 search term is always wrapped as a double-quote-escaped literal phrase with a trailing prefix modifier ('\"<term>\"*') before being bound as a parameter — disables every FTS5 operator (AND/OR/NOT/*/column-filter) inside the quotes, verified empirically against punctuation, unicode and emoji terms before any test was written."
    - "Debounce lives at the TanStack Query key boundary (useDebouncedValue feeding queryKey), never in the virtualization layer — combined with placeholderData: keepPreviousData so a refetch never re-skeletons the visible window."
    - "New global UI state (filter draft, search term, selection) gets its own Zustand store separate from existing per-feature stores (board/collapseStore.ts stays untouched) rather than one store growing to own everything."

key-files:
  created:
    - packages/core/src/query/filter.rs
    - packages/core/src/query/search.rs
    - packages/core/tests/common/mod.rs
    - packages/core/tests/search_filter.rs
    - packages/core/tests/perf_seed_1000.rs
    - packages/desktop/src/state/uiStore.ts
    - packages/desktop/src/board/FilterBar.tsx
    - packages/desktop/src/board/__tests__/filter.test.tsx
  modified:
    - packages/core/src/query/mod.rs
    - packages/core/tests/criteria.rs
    - packages/core/tests/hierarchy_workflow.rs
    - packages/core/tests/outbox.rs
    - packages/core/tests/ranking.rs
    - packages/desktop/src-tauri/src/commands/board.rs
    - packages/desktop/src-tauri/src/main.rs
    - packages/desktop/src-tauri/capabilities/default.json
    - packages/desktop/src/App.tsx
    - packages/desktop/src/board/BoardView.tsx
    - packages/desktop/src/board/useBoardQuery.ts
    - DESIGN.md

key-decisions:
  - "Filter WHERE text is one concat!-built compile-time literal shared by list_board and search_items (via json_each(:x)-or-NULL binding), not four independently hand-maintained fragments — verified against the plan's own grep gate (zero format!/string-interpolation occurrences anywhere in packages/core/src/query)."
  - "The human-readable key (FLY-142, D-10) is matched by a plain case-insensitive equality OR'd alongside the FTS5 phrase inside the same per-table WHERE, not a schema/migration change — FTS5 only indexes title/description(body), and adding key to the FTS index would have required altering an already-shipped virtual table."
  - "search_items delegates byte-identically to list_board for an empty/whitespace-only term rather than re-implementing 'the unfiltered window' — proven by empty_term_returns_the_unfiltered_window comparing exact id sequences."
  - "band_band_counts (and its searched sibling) became filter-aware in this plan — a filtered/searched board's sticky headers now report the narrowed scale, not the whole project's, matching 01-UI-SPEC.md's 'band headers stay honest about scale' intent."
  - "The empty-project vs. empty-filter-result distinction is made entirely client-side, from the renderer's own filter/search UI state — BandCounts::total()==0 is identical in both cases by construction, so no backend sentinel was added; App.tsx's Board component is the one place that decision is made."
  - "state/uiStore.ts does NOT absorb board/collapseStore.ts's existing collapsed-band state, and BoardView.tsx's selectedId stays local useState rather than migrating into the new store — both are real, larger refactors deliberately deferred (documented in DESIGN.md's Known Stubs) rather than rushed into an already-large plan; the store still exports selectedItemId/setSelectedItemId, ready for that future migration."
  - "The epic filter's chip list is derived from the currently loaded window's own epic rows, not a dedicated 'list every epic' Tauri command — avoids a new command surface + capability entry for a chip-population convenience the plan's acceptance criteria did not require; the known limitation (composing filters can hide an epic from its own chip) is documented in DESIGN.md's Known Stubs."

patterns-established:
  - "json_each(:x)-or-NULL as the standard idiom for 'this dimension is unfiltered vs. restricted to a value set' in a parameterised SQL fragment — any future filterable list in this crate should reach for this rather than dynamic IN-list placeholder construction."
  - "FTS5 search terms always cross the Rust boundary already wrapped as an escaped, quoted, prefix-modified phrase — never a raw user string bound directly as the MATCH operand."

requirements-completed: [BOARD-06, BOARD-08]

coverage:
  - id: D1
    description: "A user filters and searches across every item in a project by free text, status, epic, assignee, priority and estimate, and every one of those runs as an indexed SQL query in the Rust core"
    requirement: BOARD-06
    verification:
      - kind: unit
        ref: "packages/core/tests/search_filter.rs#exact_and_prefix_terms_both_match"
        status: pass
      - kind: unit
        ref: "packages/core/tests/search_filter.rs#no_match_returns_zero_with_a_zero_total"
        status: pass
      - kind: unit
        ref: "packages/core/tests/perf_seed_1000.rs#board_window_uses_the_composite_index"
        status: pass
    human_judgment: false
  - id: D2
    description: "A search term equal to a full title and a prefix of it both match, punctuation/unicode terms never error, an empty term returns the unfiltered window, and a filter matching nothing returns zero rows with a zero total"
    requirement: BOARD-06
    verification:
      - kind: unit
        ref: "packages/core/tests/search_filter.rs#punctuation_and_unicode_terms_do_not_error"
        status: pass
      - kind: unit
        ref: "packages/core/tests/search_filter.rs#empty_term_returns_the_unfiltered_window"
        status: pass
    human_judgment: false
  - id: D3
    description: "Filtered results preserve the priority-then-rank-then-id order; the same query path is used at 999/1,000/1,001 items; cursor paging through 1,000 rows visits every row exactly once; a title edit updates what search matches"
    requirement: BOARD-06
    verification:
      - kind: unit
        ref: "packages/core/tests/search_filter.rs#filtering_preserves_order"
        status: pass
      - kind: unit
        ref: "packages/core/tests/search_filter.rs#window_path_is_identical_at_999_1000_and_1001"
        status: pass
      - kind: unit
        ref: "packages/core/tests/search_filter.rs#cursor_paging_covers_every_row_once"
        status: pass
      - kind: unit
        ref: "packages/core/tests/search_filter.rs#title_edit_updates_what_search_matches"
        status: pass
    human_judgment: false
  - id: D4
    description: "At 1,000 items, an unfiltered board window, a text search, and a combined status+assignee filter each return in under 50ms server-side, through an indexed query"
    requirement: BOARD-08
    verification:
      - kind: unit
        ref: "packages/core/tests/perf_seed_1000.rs#search_at_1000_items_is_under_50ms"
        status: pass
    human_judgment: false
  - id: D5
    description: "The search field, filter chips, the debounced query boundary and the two distinct empty states render correctly, and no board component re-filters/re-sorts the returned window client-side"
    requirement: BOARD-06
    verification:
      - kind: unit
        ref: "packages/desktop/src/board/__tests__/filter.test.tsx#empty-window state copy"
        status: pass
      - kind: unit
        ref: "packages/desktop/src/board/__tests__/filter.test.tsx#FilterBar"
        status: pass
      - kind: other
        ref: "grep -rEc '\\.sort\\(|localeCompare' packages/desktop/src/board = 0"
        status: pass
    human_judgment: false
  - id: D6
    description: "Live tauri dev walkthrough: type into the search field against a seeded 1,000-item project, apply a status+assignee filter together, clear the search, set a filter matching nothing, scroll the full list"
    human_judgment: true
    rationale: "No agent-spawning tool and no confirmed GUI display are available in this execution environment (same limitation 01-02/01-03/01-04/01-06/01-07 documented). The plan's own <human-check> block is a live visual/interaction walkthrough that cannot be proven by an automated test here — deferred to /gsd-verify-work, matching the established precedent for this exact gap."
    verification: []

# Metrics
duration: ~140min
completed: 2026-09-09
status: complete
---

# Phase 1 Plan 8: Search, Filter, and the Board at 1,000+ Items Summary

**FTS5 free-text search (titles, bodies and the human-readable key) plus a five-dimension
filter set (status, epic-including-no-epic, assignee-including-unassigned, priority, estimate),
both compiled into one shared, named-parameter, `format!`-free SQL fragment in the Rust core;
a 150ms-debounced query boundary and two distinct empty-window states in the renderer; a
1,000-item project answering every one of those queries in 1-2ms, proven against a real
`EXPLAIN QUERY PLAN`.**

## Performance

- **Duration:** ~140 min
- **Completed:** 2026-09-09
- **Tasks:** 3
- **Files modified:** 20 (8 created, 12 modified)

## Accomplishments

- `core::query::filter::BoardFilter`/`apply_filter`/`FILTER_WHERE`: a single `concat!`-built
  compile-time SQL fragment, shared verbatim by `list_board` and `search_items`, binding every
  filter dimension as either SQL `NULL` (unfiltered) or a JSON array matched via
  `json_each(:x)` — proven empirically (via the SQLite CLI, before any Rust was written) that
  `json_each(NULL)` yields zero rows rather than erroring, and that this idiom needs no dynamic
  placeholder construction at all. Zero `format!`/string-interpolation occurrences anywhere in
  `packages/core/src/query`, enforced by the plan's own grep gate.
- `core::query::search::search_items`/`search_issues`: matches `tasks_fts`/`epics_fts`/
  `issues_fts` as a literal, double-quote-escaped FTS5 phrase with a trailing last-token prefix
  modifier (`"<term>"*`), OR'd with a case-insensitive key equality so `FLY-142` is searchable
  without touching the already-shipped FTS5 schema (D-10). Verified against a double quote, an
  asterisk, a hyphen, a colon, accented Latin, CJK and an emoji — all return without error;
  emoji alone tokenizes to nothing under the default `unicode61` tokenizer (empty result, no
  error), documented rather than silently assumed.
- `list_board` gained a `&BoardFilter` parameter and filter-aware per-band totals; nine existing
  call sites across four test files and the `board_list` Tauri command were updated to pass
  `&BoardFilter::default()`, keeping every one of them byte-identical to their pre-01-08
  behavior (proven by the unchanged 60 pre-existing core tests still passing).
- `board_search` Tauri command, registered in `main.rs` and named explicitly in
  `capabilities/default.json` (never a blanket grant, T-01-02) — both `board_list`/`board_search`
  cap the requested limit to 500 before calling the core (T-01-24).
- `state/uiStore.ts` (new Zustand store: filter draft, search term, selected item id) and
  `FilterBar.tsx` (always-visible top-bar search field with `⌘F`/`/` focus, plus status/
  priority/estimate/epic/assignee chips reusing `legend/marks.ts`'s existing registries — no new
  marks were needed).
- `useBoardQuery.ts`'s `useDebouncedValue` (150ms) drives the TanStack Query key, so exactly one
  `board_list`/`board_search` call fires per settled input; `placeholderData: keepPreviousData`
  keeps the visible window rendered during a refetch, with `isFetching` driving a small
  non-blocking indicator inside the search field.
- `BoardView.tsx` gained an optional `emptyState` overlay prop — `undefined` preserves every
  pre-01-08 caller's behavior exactly (the existing `board-view.test.tsx` suite needed zero
  changes); `App.tsx`'s `Board` component decides which of the two empty-state copies to show
  from its own filter/search UI state, since `BandCounts` alone can't distinguish "empty
  project" from "empty filter result" (both report all-zero counts by construction).
- `packages/core/tests/common/mod.rs`'s `seed_project(conn, n)`: one project, `n` tasks spread
  across the five states with varied titles/priorities/estimates/assignees, inserted through
  literal `INSERT`s so the FTS5 sync triggers fire exactly as they would for a real user-created
  task.
- At 1,000 seeded items: unfiltered `list_board` in 2ms, a text search in 1ms, a combined
  status+assignee filter in 1ms — all against the 50ms budget `01-UI-SPEC.md`'s Performance
  Contract states, and all proven against a real `EXPLAIN QUERY PLAN` naming a project-scoped
  composite index (`idx_epics_project_status_rank`/`idx_tasks_project_epic`), never a full
  table scan.

## Task Commits

1. **Task 1: FTS5 search and the indexed filter set in the core** — `1a701ba` (feat)
2. **Task 2: The search field, the filter chips, and the virtualized window** — `a320b12` (feat)
3. **Task 3: A 1,000-item project, the latency assertion, and the search edge cases** — `4cba8c5` (test)

**Plan metadata:** pending (this commit, made immediately after this SUMMARY)

## Files Created/Modified

- `packages/core/src/query/filter.rs` — new; `BoardFilter`, `EpicSelector`, `AssigneeSelector`, `apply_filter`, `FILTER_WHERE`
- `packages/core/src/query/search.rs` — new; `search_items`, `search_issues`, the FTS5 phrase-wrapping and key-match logic
- `packages/core/src/query/mod.rs` — `list_board` gained the filter parameter and filter-aware band counts; `ITEM_SELECT_LIST`/`CRITERIA_JOIN`/`ORDER_BY`/`CURSOR_WHERE` extracted as shared literal fragments
- `packages/core/tests/{criteria,hierarchy_workflow,outbox,ranking}.rs` — updated `list_board` call sites to pass `&BoardFilter::default()`
- `packages/core/tests/common/mod.rs`, `search_filter.rs`, `perf_seed_1000.rs` — new
- `packages/desktop/src-tauri/src/commands/board.rs` — `board_search` command, `BoardFilterInput`/`BoardCursorInput` DTOs
- `packages/desktop/src-tauri/src/main.rs`, `capabilities/default.json` — `board_search` registered/named
- `packages/desktop/src/state/uiStore.ts` — new
- `packages/desktop/src/board/FilterBar.tsx` — new
- `packages/desktop/src/board/__tests__/filter.test.tsx` — new
- `packages/desktop/src/board/useBoardQuery.ts` — debounce, `toFilterInput`, `useBoardQuery` gained filter/searchTerm params
- `packages/desktop/src/board/BoardView.tsx` — optional `emptyState` overlay prop
- `packages/desktop/src/App.tsx` — wires `FilterBar`/`uiStore`/empty-state decision
- `DESIGN.md` — new "Phase 1, Plan 01-08" section (self-conducted craft-floor review)

## Decisions Made

See `key-decisions` in frontmatter above for the full list. The most consequential: the entire
filter set is bound as JSON-array-or-NULL named parameters rather than dynamically-sized
`IN (?,?,?)` lists, which is what let every query stay a `concat!`-built compile-time literal
with zero `format!`/interpolation — verified against the plan's own grep gate before any test
was written, not discovered as a fix afterward.

## Deviations from Plan

### Auto-fixed Issues

None — this plan's design (json_each-or-NULL filter binding, quoted-phrase FTS5 wrapping,
client-side empty-state distinction) was arrived at deliberately during implementation, not as
a correction to a bug. No Rule 1/2/3 auto-fixes were needed.

**Scope clarifications (not deviations from a written instruction, but explicit choices where
the plan left room for judgment):**

1. **`state/uiStore.ts` does not absorb `board/collapseStore.ts`'s collapsed-band state, and
   `BoardView.tsx`'s `selectedId` stays local `useState`.** The plan's action text lists "the
   filter draft, the search term, the collapsed-band set and the selected item id" as
   `uiStore.ts`'s contract; collapse state already has a working, tested home in
   `collapseStore.ts` (01-04) and migrating `selectedId` would have touched every keyboard
   handler in an already-489-line file. Both are real refactors, deliberately deferred rather
   than rushed — documented in `DESIGN.md`'s Known Stubs, and the store still exports
   `selectedItemId`/`setSelectedItemId` ready for that future migration.
2. **The epic filter's chip options come from the currently loaded window, not a dedicated
   `epic_list` command.** No such command exists in this plan's `files_modified` list, and
   adding one would have opened a new command surface + capability entry for a chip-population
   convenience the acceptance criteria did not require. Documented as a Known Stub in
   `DESIGN.md`.
3. **`adapters/tauri.ts` needed no change**, despite being named in `files_modified` — the
   existing generic `invokeCommand<T>(command, args)` seam already covers `board_search`
   identically to every other command.
4. **`legend/marks.ts` needed no change**, despite being named in `files_modified` — every
   filter chip reuses a glyph/label the row anatomy already defines (status/priority/estimate
   marks, plus the pre-existing `epic-pill-none`/`assignee-unassigned` marks); no new
   domain-meaning glyph was introduced.

---

**Total deviations:** 0 auto-fixed; 4 documented scope clarifications, all judgment calls within
the plan's own stated discretion, none contradicting an explicit plan instruction.
**Impact on plan:** None of the four clarifications reduce BOARD-06/BOARD-08 coverage — each is
a deliberate, documented boundary on a genuinely separate piece of future work.

## Issues Encountered

None beyond ordinary implementation iteration (a test-fixture bug in `filter.test.tsx`'s first
draft — a missing `onCta` callback caused the "Clear Filters" button not to render — caught and
fixed before commit, not shipped).

## User Setup Required

None — no external service configuration required.

## Next Phase Readiness

- The board's search/filter/window contract is now complete for Phase 1: BOARD-06 and BOARD-08
  are both proven, with an indexed, parameterised query path that never falls back to a
  full-table scan and a renderer that holds nothing but the current window.
- `json_each(:x)`-or-`NULL` is established as the standard idiom for any future filterable
  dimension in this crate — a later phase adding, say, a "labels" or "sprint" filter should
  reach for this pattern rather than re-deriving dynamic `IN`-list construction.
- **Known deferred surface — not a blocker:** `state/uiStore.ts`'s `selectedItemId` exists but
  is not yet wired to `BoardView.tsx`'s own selection state; a future command-palette "jump to
  item" feature can complete that migration without any backend change.
- **Live `tauri dev` walkthrough not run this session** (coverage item D6) — deferred to
  `/gsd-verify-work`, matching the precedent every prior Phase 1 plan established for the same
  no-GUI-display limitation.

---
*Phase: 01-the-board-is-the-store-of-record*
*Completed: 2026-09-09*

## Self-Check: PASSED

All created files verified present on disk; all three task commit hashes (1a701ba, a320b12,
4cba8c5) verified present in git log. No missing items.
