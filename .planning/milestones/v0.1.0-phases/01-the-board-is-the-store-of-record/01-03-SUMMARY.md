---
phase: 01-the-board-is-the-store-of-record
plan: 03
subsystem: database
tags: [rusqlite, sqlite, fts5, transactional-outbox, tauri-commands, tanstack-query, tanstack-virtual, tauri-plugin-dialog, react, fractional-index]

# Dependency graph
requires:
  - phase: 01-the-board-is-the-store-of-record (plan 01-01)
    provides: "Cargo workspace, Tauri v2 shell, core::db::open_and_migrate, core::ids::new_id, actors table, adapters/tauri.ts seam"
  - phase: 01-the-board-is-the-store-of-record (plan 01-02)
    provides: "styles/tokens.css + theme/tokens.ts, styles/type.css, styles/motion.css, legend/marks.ts + Legend.tsx, the four locked visual-world decisions"
provides:
  - "Migration 0002_board_schema.sql — projects/epics/tasks/issues/acceptance_criteria/events/event_sequence_counters, FTS5 + sync triggers"
  - "packages/core::ranking — FractionalIndex wrapper (rank_after/rank_between)"
  - "packages/core::domain::{actor, event, project, task} — create_project, create_task (one-transaction outbox), append_event, next_sequence, update_key_prefix"
  - "packages/core::query::list_board — bounded, indexed board window with the No-priority-sorts-last rule"
  - "Tauri commands project_register/project_list/task_create/board_list, wired end to end with board:changed push-invalidate"
  - "packages/desktop/src/board — FirstRun, BoardView, BoardRow, QuickAdd, useBoardQuery"
  - "The five owner decisions closing the schema shape, recorded in 01-UI-SPEC.md Open Decisions #4/#5/#6/#7/#11"
affects: ["01-04 (command palette, wires the Legend in)", "01-09 (pickers hand-wired against Radix)", "phase 4 (criteria revisioning)", "phase 6 (issue triage lifecycle)", "phase 8 (epic integration_branch / archived_at columns already present)"]

# Actuals (#2632)
actuals:
  tokens: 32000
  tasks: 3
  commits: 5
plan_head_before: 2394369343e42e0cc92725d617d23f0f71f33465

# Tech tracking
tech-stack:
  added: ["tauri-plugin-dialog@2.7.3", "@tauri-apps/plugin-dialog@2.7.3", "chrono@0.4 (clock feature, packages/core)"]
  patterns:
    - "Transactional outbox: every domain mutation function opens exactly one conn.transaction(), writes the projection row(s) and appends an events row inside it, commits once (DATA-01)"
    - "next_sequence/append_event take &Transaction, never &Connection — nesting conn.transaction() inside another transaction's scope is structurally unrepresentable"
    - "Two literal SQL query strings (with/without cursor) instead of format!-assembled SQL — every statement in packages/core is a literal bound through params![]"
    - "Sort-key expressions (status_sort_key, priority_sort_key) computed in SQL CASE expressions, never relying on the raw stored/keymap value's natural ordering"
    - "actor_id always resolved server-side (domain::actor::local_human_actor_id) inside the Tauri command handler, never accepted as a renderer argument"
    - "Single constant estimateSize for @tanstack/react-virtual, band headers sharing the same fixed row height as item rows — no measureElement, no per-row-type height branching"
    - "jsdom test fixture: HTMLElement.prototype.offsetWidth/offsetHeight stubbed + ResizeObserver stubbed in test/setup.ts, since jsdom has no layout engine and @tanstack/react-virtual measures via offsetWidth/offsetHeight"

key-files:
  created:
    - packages/core/src/db/migrations/0002_board_schema.sql
    - packages/core/src/ranking.rs
    - packages/core/src/domain/mod.rs
    - packages/core/src/domain/actor.rs
    - packages/core/src/domain/event.rs
    - packages/core/src/domain/project.rs
    - packages/core/src/domain/task.rs
    - packages/core/src/query/mod.rs
    - packages/core/tests/outbox.rs
    - packages/desktop/src-tauri/src/commands/mod.rs
    - packages/desktop/src-tauri/src/commands/project.rs
    - packages/desktop/src-tauri/src/commands/task.rs
    - packages/desktop/src-tauri/src/commands/board.rs
    - packages/desktop/src/board/BoardView.tsx
    - packages/desktop/src/board/BoardRow.tsx
    - packages/desktop/src/board/QuickAdd.tsx
    - packages/desktop/src/board/FirstRun.tsx
    - packages/desktop/src/board/useBoardQuery.ts
    - packages/desktop/src/board/__tests__/board-view.test.tsx
  modified:
    - packages/core/src/lib.rs
    - packages/core/src/db/mod.rs
    - packages/core/Cargo.toml
    - packages/core/tests/db_bootstrap.rs
    - packages/desktop/src-tauri/src/main.rs
    - packages/desktop/src-tauri/src/state.rs
    - packages/desktop/src-tauri/Cargo.toml
    - packages/desktop/src-tauri/capabilities/default.json
    - packages/desktop/src/App.tsx
    - packages/desktop/src/App.css
    - packages/desktop/src/adapters/tauri.ts
    - packages/desktop/src/legend/marks.ts
    - packages/desktop/src/legend/Legend.tsx
    - packages/desktop/src/test/setup.ts
    - DESIGN.md
    - .planning/phases/01-the-board-is-the-store-of-record/01-UI-SPEC.md

key-decisions:
  - "Owner closed the schema-shape checkpoint (2026-09-09): epics/tasks share one five-state status CHECK, issues stay workflow-less (uispec-reading); nullable assignee_id accepted; priority is 5-level Linear (0-4) with No priority sorting LAST; estimate is S/M/L as nullable ordinal INTEGER 1-3, never aggregated; project key prefix is user-typed with a directory-derived default, immutable once the first item exists"
  - "ARCHITECTURE.md section 2's epic lifecycle enum (draft/active/integrating/done/archived) is re-homed onto the five-state status plus two orthogonal columns (epics.integration_branch, epics.archived_at) added now so Phase 8 needs no schema change, rather than discarded"
  - "No-priority-sorts-last is enforced entirely in query::list_board's SQL sort-key expression (CASE WHEN priority = 0 THEN 5 ELSE priority END), never by relying on the raw stored/keymap value's natural ordering — proven by an explicit test"
  - "Project key-prefix immutability is enforced in code (domain::project::update_key_prefix rejects any change once key_counter > 0), not merely documented, even though no rename UI ships in Phase 1"
  - "list_board's cursor is expressed as pre-computed integer sort keys (status_sort_key, priority_sort_key), not the raw status string, so SQLite's row-value tuple comparison stays type-consistent"
  - "tauri-plugin-dialog's native folder picker is granted only the narrow dialog:allow-open permission (T-01-02), not the blanket dialog:default"
  - "Registered repository paths are canonicalized server-side before storage (T-01-13) — closing a gap between the plan's threat register and the first implementation commit, fixed in a follow-up commit within this same plan"

patterns-established:
  - "Task-level TDD on an already-implemented tracer: Task 2 (type=tracer) implements the feature; Task 3 (tdd=true) writes the invariant-proving regression suite. Where Task 2's implementation was already correct, tests pass immediately (documented, not a violation); where a genuine gap existed (jsdom lacks layout, breaking @tanstack/react-virtual), the RED->GREEN cycle is real and separately committed"
  - "MARKS_BY_ID / statusMarkId / priorityMarkId in legend/marks.ts — the one lookup BoardRow.tsx uses to resolve a status/priority value to its glyph, so no board surface hand-maintains a second glyph mapping"

requirements-completed: [DATA-01, DATA-02, DATA-03]

coverage:
  - id: D1
    description: "Migration 0002_board_schema.sql: projects/epics/tasks/issues/acceptance_criteria/events/event_sequence_counters, composite indexes, FTS5 virtual tables + sync triggers, applying all five owner decisions"
    requirement: "DATA-01"
    verification:
      - kind: unit
        ref: "cargo test -p core --test db_bootstrap (7 tests, migration applies and is idempotent)"
        status: pass
      - kind: other
        ref: "grep -c 'UNIQUE (project_id, origin, sequence)' packages/core/src/db/migrations/0002_board_schema.sql == 1"
        status: pass
    human_judgment: false
  - id: D2
    description: "create_task opens exactly one transaction writing the tasks row, the human key, the event sequence and the events row together; rollback leaves neither"
    requirement: "DATA-01"
    verification:
      - kind: unit
        ref: "packages/core/tests/outbox.rs#outbox_writes_projection_and_event_together, #outbox_rollback_writes_neither"
        status: pass
      - kind: other
        ref: "grep -v '^\\s*//' packages/core/src/domain/task.rs | grep -c 'conn.transaction()' == 1"
        status: pass
    human_judgment: false
  - id: D3
    description: "actor_id is resolved server-side and is NOT NULL with a foreign key to actors(id); a NULL or orphaned actor_id is rejected"
    requirement: "DATA-03"
    verification:
      - kind: unit
        ref: "packages/core/tests/outbox.rs#actor_attribution_is_not_nullable, #three_mutations_by_one_actor_in_one_transaction_share_actor_id_and_write_order"
        status: pass
    human_judgment: false
  - id: D4
    description: "\"No priority\" (priority 0) sorts LAST within its status band despite being keyed 0, per Open Decisions #6"
    verification:
      - kind: unit
        ref: "packages/core/tests/outbox.rs#priority_zero_no_priority_sorts_last_within_its_band"
        status: pass
    human_judgment: false
  - id: D5
    description: "A project's key prefix is immutable once the project has allocated its first item key, per Open Decisions #11"
    verification:
      - kind: unit
        ref: "packages/core/tests/outbox.rs#project_key_prefix_is_immutable_once_an_item_exists"
        status: pass
    human_judgment: false
  - id: D6
    description: "A task with epic_id = NULL is returned by list_board rather than dropped (D-13, no bare inner join to epics)"
    verification:
      - kind: unit
        ref: "packages/core/tests/outbox.rs#orphan_task_survives_board_query"
        status: pass
    human_judgment: false
  - id: D7
    description: "BoardView renders the five band headers in fixed order (even empty) and one strip per supplied item, including the No epic pill for an orphan task"
    verification:
      - kind: unit
        ref: "packages/desktop/src/board/__tests__/board-view.test.tsx (3 tests)"
        status: pass
    human_judgment: false
  - id: D8
    description: "End-to-end: register a repository via the native folder picker, quick-add a task, see it appear via the pushed board:changed delta, survive a full process relaunch, in the same order with the same keys"
    verification:
      - kind: manual_procedural
        ref: ".impeccable/review/01-03-first-run.png, .impeccable/review/01-03-populated-rack.png — captured via orca computer get-app-state against a real tauri dev launch, plus a kill-and-relaunch of the compiled binary proving persistence"
        status: pass
    human_judgment: true
    rationale: "A real native folder-picker interaction, a live push-invalidate refresh, and a genuine process-kill-and-relaunch persistence check are outside what an automated test asserts in this environment; verified manually this session end to end and documented with before/after screenshots and a database inspection, but a fresh human glance is the cheapest final check for this GUI flow."

duration: ~34min
completed: 2026-09-09
status: complete
---

# Phase 1 Plan 3: The Tracer — Register, Create, Persist Summary

**End-to-end vertical slice: migration `0002_board_schema.sql` (projects/epics/tasks/issues/acceptance_criteria/events, FTS5), a transactional-outbox `create_task`/`create_project` in `packages/core`, four Tauri commands with server-resolved actor attribution and `board:changed` push-invalidate, and a virtualized React rack (`FirstRun`/`BoardView`/`BoardRow`/`QuickAdd`) — proven live via a real `tauri dev` launch, a kill-and-relaunch, and a 13-test Rust invariant suite.**

## Performance

- **Duration:** ~34 min (this continuation dispatch, resuming after Task 1's decision checkpoint was already answered by the owner in a prior session — that earlier session's own duration is not included here)
- **Started:** 2026-09-09T02:14:30Z
- **Completed:** 2026-09-09T02:48:33Z (implementation) + a short follow-up fix pass
- **Tasks:** 3
- **Files modified:** 38 (across 5 commits)

## Accomplishments

- Recorded the owner's five schema-shape decisions into `01-UI-SPEC.md`'s Open Decisions #4/#5/#6/#7, and added a new #11 for the project key-prefix decision, with the `ARCHITECTURE.md` epic-lifecycle re-homing explained inline.
- Authored migration `0002_board_schema.sql`: `projects`, `epics`, `tasks`, `issues`, `acceptance_criteria`, `events`, `event_sequence_counters`, their composite indexes, and three FTS5 virtual tables with their sync triggers — applying every owner decision directly in the DDL comments and column shapes.
- Implemented the transactional-outbox pattern in `packages/core::domain`: `create_project` (with `key_prefix` validation and `update_key_prefix`'s immutability guard), `create_task` (one transaction: tail-rank lookup, key allocation, insert, sequence allocation, event append, single commit), `append_event`/`next_sequence` (both take `&Transaction`, never `&Connection`).
- Implemented `query::list_board`: a bounded, cursor-capable window ordered by status band, then priority (with "No priority" mapped to sort last, not first), then rank, then id — two literal SQL strings (with/without cursor), no `format!`-assembled SQL anywhere in the crate.
- Wired four Tauri commands (`project_register`, `project_list`, `task_create`, `board_list`) that resolve `actor_id` server-side, validate every input, and emit `board:changed` after a successful mutation.
- Built the renderer: `FirstRun` (two-step registration — native folder picker via `tauri-plugin-dialog`, then a key-prefix confirmation step pre-filled from the directory name), `BoardView` (virtualized rack, single constant `estimateSize`, five fixed bands), `BoardRow` (status/priority glyphs resolved from the `legend/marks.ts` registry, the "No epic" pill for orphans), `QuickAdd` (D-09), and `useBoardQuery` (TanStack Query hooks, one `board:changed` subscription).
- Verified the entire path live: launched a real `tauri dev` build, registered "threadfin" (derived prefix `THRE`), created three tasks (`THRE-1/2/3`), killed the running process and relaunched it from the compiled binary directly — all three tasks were still present, in the same order, with the same keys.
- Wrote `packages/core/tests/outbox.rs` (13 tests) proving every Task-3 invariant, including the two owner-decision-driven tests this dispatch specifically required: "No priority" sorting last, and project key-prefix immutability.
- Found and fixed a genuine test-infrastructure gap: jsdom has no layout engine, so `@tanstack/react-virtual`'s container measurement always read 0 and every virtualized list rendered zero rows in tests. Fixed via a `ResizeObserver` stub and fixed `offsetWidth`/`offsetHeight` values in `test/setup.ts`, plus a missing global `afterEach(cleanup)` registration.
- Found and fixed a gap between the plan's own threat register and the first implementation commit: `T-01-13` commits to canonicalizing the folder-picker's path before storage; the initial commit only trimmed it. Fixed in a dedicated follow-up commit.

## Task Commits

Each task was committed atomically:

1. **Task 1: Close the schema shape before the board tables are committed** — `af844b2` (docs) — decision checkpoint answered by the owner in the dispatching session; this executor recorded it into `01-UI-SPEC.md`.
2. **Task 2: End-to-end "create a task and see it on the rack"** — `acccd2d` (feat)
3. **Task 3: Prove the outbox, ULID and actor-attribution invariants** — `3a366a0` (test) + `bb7486b` (fix — genuine RED->GREEN for the jsdom virtualization gap) + `543df6b` (fix — T-01-13 canonicalization gap found during the plan's own threat-surface review)

**Plan metadata:** commit pending (this SUMMARY + STATE.md + ROADMAP.md docs commit, below).

## Files Created/Modified

See `key-files` in frontmatter above for the full list. Highlights:

- `packages/core/src/db/migrations/0002_board_schema.sql` — the board schema
- `packages/core/src/domain/{actor,event,project,task}.rs` — the mutation functions
- `packages/core/src/query/mod.rs` — `list_board`
- `packages/core/src/ranking.rs` — the `FractionalIndex` wrapper
- `packages/desktop/src-tauri/src/commands/{project,task,board}.rs` — the Tauri command surface
- `packages/desktop/src/board/{FirstRun,BoardView,BoardRow,QuickAdd,useBoardQuery}` — the renderer
- `packages/core/tests/outbox.rs`, `packages/desktop/src/board/__tests__/board-view.test.tsx` — the invariant suites

## Decisions Made

See `key-decisions` in frontmatter above for the full list; the most consequential is the owner's schema-shape checkpoint resolution (recorded in `01-UI-SPEC.md` and above), which every plan from `01-04` onward now treats as binding.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 1 - Bug] `db_bootstrap.rs`'s two `user_version` assertions hardcoded a single-migration assumption**
- **Found during:** Task 2 (adding migration `0002_board_schema.sql`)
- **Issue:** Two tests from plan `01-01` asserted `user_version == 1`; migration `0002` legitimately advances it to `2`
- **Fix:** Updated both assertions to `2` and renamed one test from `..._advances_user_version_to_1` to `..._advances_user_version_to_latest`, with a comment explaining the count is schema-version-count, not a literal every-migration-must-edit-this constant
- **Files modified:** `packages/core/tests/db_bootstrap.rs`
- **Verification:** `cargo test -p core --test db_bootstrap` — all 7 pass
- **Committed in:** `acccd2d` (Task 2 commit)

**2. [Rule 3 - Blocking] jsdom has no layout engine; `@tanstack/react-virtual` measures via `offsetWidth`/`offsetHeight`, which read 0**
- **Found during:** Task 3 (writing `board-view.test.tsx`) — a genuine RED: all three component tests failed, rendering zero rows regardless of supplied item count
- **Issue:** `@tanstack/virtual-core`'s `getRect()` reads `element.offsetWidth`/`offsetHeight` to size its viewport; jsdom defaults both to `0` for every element, and jsdom has no `ResizeObserver` at all
- **Fix:** Stubbed `ResizeObserver` and fixed `offsetWidth`/`offsetHeight` to viewport-sized values on `HTMLElement.prototype` in `test/setup.ts`. Also discovered and fixed a related gap: `vitest.config.ts`'s `globals: false` meant Testing Library's automatic `afterEach(cleanup)` registration never fired, so a later test's `getByText("No epic")` matched a leftover node from an earlier render in the same file — fixed by registering `afterEach(cleanup)` explicitly.
- **Files modified:** `packages/desktop/src/test/setup.ts`
- **Verification:** `npm --prefix packages/desktop run test` — 18/18 pass (up from 15)
- **Committed in:** `bb7486b` (separate fix commit, per genuine TDD RED->GREEN discipline)

**3. [Rule 2 - Missing Critical] Registered repository paths were not canonicalized, contradicting the plan's own threat register**
- **Found during:** a threat-surface review pass after Task 2's commit, before writing this SUMMARY
- **Issue:** `01-03-PLAN.md`'s threat register (`T-01-13`) explicitly commits to "the handler canonicalizes and stores it," but the first `project_register` implementation only trimmed the path
- **Fix:** Added `Path::canonicalize()` in `project_register`, resolving symlinks and `.`/`..` segments before the path ever reaches `create_project`
- **Files modified:** `packages/desktop/src-tauri/src/commands/project.rs`
- **Verification:** `cargo build --workspace` succeeds; re-ran the full registration flow live via `tauri dev` — `sqlite3` inspection confirms the stored `repo_path` is the canonicalized absolute path
- **Committed in:** `543df6b`

---

**Total deviations:** 3 auto-fixed (1 Rule 1 bug, 1 Rule 3 blocking test-infra gap, 1 Rule 2 missing-critical security control)
**Impact on plan:** All three were necessary for correctness (migration count), for Task 3's own acceptance criteria to be verifiable at all (jsdom virtualization), and for the shipped code to match the plan's own committed threat mitigation. No scope creep beyond what Task 2/3 and the plan's threat register already specified.

## Issues Encountered

- **No agent-spawning tool available to this executor**, matching plan `01-02`'s documented limitation. The shipped `impeccable-finish-reviewer` and `impeccable-documenter` subagents named in Task 2's acceptance criteria could not be literally invoked. Substituted a self-conducted review directly against `craft-floor.md`'s Verify/Refuse checklist (documented in `DESIGN.md`'s new "Phase 1, Plan 01-03" section) and authored the `DESIGN.md` update directly. `detect.mjs` was run against every changed surface (`packages/desktop/src/board`, `packages/desktop/src/legend`, `App.tsx`, `App.css`) and returned no findings.
- **Task 3's tests passed immediately against Task 2's implementation** rather than failing first — this plan's own structure sequences the tracer's real implementation in Task 2 (`type="tracer"`) before the invariant-proving suite in Task 3 (`tdd="true"`), so this is a regression suite over already-correct code, not a violated RED phase. The one place a genuine RED did occur (jsdom's virtualization gap) is documented above with its own fix commit. See "TDD Gate Compliance" below.
- **The app-data database used for live verification was reset twice** (`rm -rf "$HOME/Library/Application Support/Flywheel"`) after each verification pass, so the human running `01-03-PLAN.md`'s own `<human-check>` walkthrough starts from a genuinely fresh first-run state, not one already carrying the `threadfin`/`THRE-1..3` verification data.

## User Setup Required

None — no external service configuration required.

## Next Phase Readiness

- `cargo build --workspace`, `cargo test --workspace` (24 passing: 3 ranking + 7 db_bootstrap + 4 ids + 13 outbox... note `cargo test -p core` reports these across separate binaries — see verification commands below), and `npm --prefix packages/desktop run test` (18 passing, up from 15) are all green. `npm --prefix packages/desktop run build` succeeds.
- `packages/core::domain::{project,task,event}` and `query::list_board` are real, tested, and ready for `01-04`'s command palette and any later plan's additional mutations (e.g. `set_status`, `set_priority`) to follow the exact same one-transaction outbox shape.
- `legend/marks.ts`'s new status and priority marks are ready for the item detail panel's pickers (`01-04`/`01-09`) to reuse rather than re-declare.
- `deriveKeyPrefix` (`board/FirstRun.tsx`) is the one place a key-prefix default is computed — any future "edit project" surface should reuse it before hitting `update_key_prefix`'s immutability guard.
- No blockers. One scope note carried forward: the project rail (multi-project switching), row selection, the command palette, the item detail panel, acceptance-criteria authoring, and the activity trail are all explicitly out of this plan's file list and land in `01-04`/`01-09` per `01-UI-SPEC.md` — see `DESIGN.md`'s "Known deferred surfaces" section.

## Known Stubs

None that block this plan's own goal (the tracer's one path is fully working, tested, and persists across a relaunch). The following Row Anatomy fields are simply **not yet rendered** at all (not rendered as an empty/placeholder value) because their underlying features do not exist yet in any plan: assignee avatar (no assignee picker ships until a later plan), acceptance-criteria checked/total badge (no criteria-authoring surface exists yet), and actor-of-last-change (no activity trail exists yet). These are documented as explicit scope boundaries in `DESIGN.md`'s "Known deferred surfaces" section, assigned to named future plans (`01-04`/`01-09`), not open defects — not added to `.planning/WINDOWS.md`.

## TDD Gate Compliance (Task 3)

| Gate | Commit | Status |
|------|--------|--------|
| RED (outbox.rs) | — | Not present as a failing state — all 13 tests passed immediately against Task 2's already-correct implementation. This is the plan's own designed sequencing (tracer implemented in Task 2, invariants proven in Task 3), documented under "Issues Encountered" rather than treated as a violation. `workflow.tdd_mode` is `false` in this project's config, so the strict RED-evidence gate is not enforced for this plan. |
| RED (board-view.test.tsx) | `3a366a0` | Present and genuine — all 3 component tests failed for the right reason (jsdom's virtualization gap rendered zero rows) |
| GREEN | `bb7486b` | Present — all 18 frontend tests pass |
| REFACTOR | — | Not needed; the fix (`test/setup.ts`) was already minimal |

## Self-Check: PASSED

- FOUND: packages/core/src/db/migrations/0002_board_schema.sql
- FOUND: packages/core/src/ranking.rs
- FOUND: packages/core/src/domain/actor.rs
- FOUND: packages/core/src/domain/event.rs
- FOUND: packages/core/src/domain/project.rs
- FOUND: packages/core/src/domain/task.rs
- FOUND: packages/core/src/query/mod.rs
- FOUND: packages/core/tests/outbox.rs
- FOUND: packages/desktop/src-tauri/src/commands/project.rs
- FOUND: packages/desktop/src-tauri/src/commands/task.rs
- FOUND: packages/desktop/src-tauri/src/commands/board.rs
- FOUND: packages/desktop/src/board/BoardView.tsx
- FOUND: packages/desktop/src/board/BoardRow.tsx
- FOUND: packages/desktop/src/board/QuickAdd.tsx
- FOUND: packages/desktop/src/board/FirstRun.tsx
- FOUND: packages/desktop/src/board/useBoardQuery.ts
- FOUND: packages/desktop/src/board/__tests__/board-view.test.tsx
- FOUND commit af844b2 (docs(01-03): record owner decision closing the schema-shape checkpoint)
- FOUND commit acccd2d (feat(01-03): end-to-end tracer — register a project, create a task, see it on the rack)
- FOUND commit 3a366a0 (test(01-03): add outbox/ULID/actor-attribution invariants and BoardView render test)
- FOUND commit bb7486b (fix(01-03): size the jsdom viewport for @tanstack/react-virtual in tests)
- FOUND commit 543df6b (fix(01-03): canonicalize the registered repository path (T-01-13))

---
*Phase: 01-the-board-is-the-store-of-record*
*Completed: 2026-09-09*
