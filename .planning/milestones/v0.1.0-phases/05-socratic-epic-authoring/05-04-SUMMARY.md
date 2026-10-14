---
phase: 05-socratic-epic-authoring
plan: 04
subsystem: agent-authoring
tags: [rusqlite, sqlite-migration, board-read-tools, rate-limiting, indexed-query, react, tanstack-query]

requires:
  - phase: 05-socratic-epic-authoring
    provides: "plan 05-02's authoring_proposals staging table (D-80/D-81/D-83) and domain::authoring_proposal::{Proposal, ProposalPayload}, plan 05-03's agent_runs.authoring_stage / domain::authoring_session — both built on without re-deriving"
provides:
  - "epic_context_packet.rs: assemble_epic_context_packet/render_epic_prompt, the epic-scoped sibling of context_packet.rs — a pure-query packet holding an epic's own facts, its task roster with current-revision criteria, accepted assumptions, prior authoring runs and D-83's rejected-proposal set folded by position past REJECTED_VERBATIM_WINDOW"
  - "domain::epic::EPIC_ROSTER_CEILING/EpicRoster: closes 01-SECURITY.md AR-01-04 — list_epics now returns {epics, total, truncated} bounded at 5000 rows, with truncation surfaced rather than silently dropped (D-16)"
  - "query::authoring.rs: the agent's own DEFAULT_LIMIT/MAX_LIMIT-clamped board reads (list_epics_page, list_tasks_for_epic, search_board_for_agent, list_pending_proposals, list_rejected_for_epic) plan 05-06's agent tools will call"
  - "migration 0012_authoring_proposals_project_status_index.sql: idx_authoring_proposals_project_status, closing the one unindexed board-level read this plan's own reads would otherwise have introduced"
  - "commands::epic::EpicRosterDto and useBoardQuery.ts's EpicRoster/epicRosterTruncationNotice: the roster's truncation, when it occurs, reaches the board as a plain notice naming the ceiling and the true total"
affects: [05-05-*, 05-06-*, phase-05-verification]

actuals:
  tokens: 26100
  tasks: 3
  commits: 3
  plan_head_before: 32e76b7ba7a10c1ef99c07dc31c6e765cdf2fee

tech-stack:
  added: []
  patterns:
    - "A crate-wide source-scanning gate (packages/core/tests/epic_context_packet.rs::unbounded_reads_in_query_module_are_all_named_in_the_allowlist) that parses out string-literal contents per top-level const/fn chunk and asserts every SELECT carries a LIMIT unless named in an allowlist with a written reason — the same 'source property, not a comment' discipline authoring_stage.rs's own source-scanning gate established in plan 05-03, applied here to SQL boundedness instead of caller reachability"
    - "Two reads, two ceilings, one reason each: domain::epic::list_epics (the renderer's roster, a high ceiling plus a surfaced truncation flag) and query::authoring::list_epics_page (the agent's own DEFAULT_LIMIT/MAX_LIMIT-clamped page) are deliberately two functions, never one serving both callers with a compromise ceiling"
    - "RejectedSet folds by POSITION only, in the newest-first order the epic_status index already returns — the split point is total.min(REJECTED_VERBATIM_WINDOW), never a size/character/token count, mirroring compaction.rs's own VERBATIM_WINDOW contract exactly"

key-files:
  created:
    - packages/core/src/epic_context_packet.rs
    - packages/core/src/query/authoring.rs
    - packages/core/src/db/migrations/0012_authoring_proposals_project_status_index.sql
    - packages/core/tests/epic_context_packet.rs
  modified:
    - packages/core/src/lib.rs
    - packages/core/src/domain/epic.rs
    - packages/core/src/domain/authoring_proposal.rs
    - packages/core/src/query/mod.rs
    - packages/core/src/db/mod.rs
    - packages/core/tests/epic_roster.rs
    - packages/desktop/src-tauri/src/commands/epic.rs
    - packages/desktop/src/board/useBoardQuery.ts
    - packages/desktop/src/board/BoardView.tsx
    - packages/desktop/src/board/FilterBar.tsx
    - packages/desktop/src/board/__tests__/epic-roster.test.tsx
    - packages/desktop/src/board/__tests__/board-view.test.tsx
    - packages/desktop/src/board/__tests__/epic-assign.test.tsx
    - packages/desktop/src/board/__tests__/issue-parent.test.tsx
    - packages/desktop/src/board/__tests__/quick-add-focus.test.tsx

key-decisions:
  - "EPIC_ROSTER_CEILING (5000) replaces list_epics's unbounded read, returning EpicRoster {epics, total, truncated} — closes 01-SECURITY.md AR-01-04's re-rate trigger with a surfaced truncation flag (D-16), never a silent DEFAULT_LIMIT-sized cap, which AR-01-04's own text named as the wrong closure (it would reopen G-01-2's raw-ULID regression)"
  - "query::authoring.rs holds every agent-reachable board read as a distinct module from domain::epic::list_epics — two reads, two ceilings, one reason each"
  - "Migration 0012 adds idx_authoring_proposals_project_status (deviation, Rule 2 — missing index on a frequently-queried column pair) since D-82's board-level triage-lane query has no existing index over (project_id, status)"
  - "RejectedSet folds D-83's rejected-proposal history by position past REJECTED_VERBATIM_WINDOW (5), copying compaction.rs's own contract exactly"

patterns-established:
  - "A source-scanning boundedness gate over an entire directory (packages/core/src/query), not just one file — extends plan 05-03's per-file source-scanning-gate precedent to a directory-wide sweep with a named allowlist, the shape a future 'nothing in this crate is unbounded' assertion would extend"

requirements-completed: []

coverage:
  - id: D1
    description: "assemble_epic_context_packet/render_epic_prompt: a deterministic, pure-query epic-scoped packet (epic facts, task roster with current-revision criteria, accepted assumptions, prior authoring runs, D-83's bounded rejected set) with no model/network/git call and no mutation of any kind"
    requirement: SHAPE-05
    verification:
      - kind: unit
        ref: "packages/core/tests/epic_context_packet.rs (10 tests: absent-epic, real-epic-with-roster, superseded-criterion-absent, rejected-fold-at-window, rejected-fold-past-window, two-assemblies-equal, cross-project-isolation, five-assemblies-determinism-and-write-freedom, unbounded-reads-gate, epic-status-index-columns)"
        status: pass
      - kind: integration
        ref: "cargo test --workspace"
        status: pass
    human_judgment: false
  - id: D2
    description: "01-SECURITY.md AR-01-04 closed: domain::epic::list_epics is bounded at EPIC_ROSTER_CEILING with a surfaced truncated flag, G-01-2's raw-ULID regression guard still passes unweakened, and the agent's own reads (query::authoring) are separately bounded by DEFAULT_LIMIT/MAX_LIMIT with no i64::MAX/unbounded path"
    requirement: SHAPE-01
    verification:
      - kind: unit
        ref: "packages/core/tests/epic_roster.rs (14 tests: the 8 pre-existing ordering/tie-break/idempotency/empty/non-ASCII/volume cases unweakened, plus roster_at_exactly_the_ceiling_reports_untruncated, roster_one_past_the_ceiling_reports_truncated_with_the_real_total, agent_epic_page_clamps_a_huge_limit_request_to_max_limit)"
        status: pass
      - kind: other
        ref: "grep gates: zero format! in query/authoring.rs, zero i64::MAX/LIMIT -1/Option<i64> limit params, EPIC_ROSTER_CEILING declared and applied (>=2 occurrences), epic_context_packet.rs carries no Command::new/reqwest/format!/INSERT/UPDATE/DELETE and >=1 superseded_at IS NULL filter"
        status: pass
      - kind: unit
        ref: "packages/desktop/src/board/__tests__/epic-roster.test.tsx (26 tests, including the 5 new truncation-notice cases)"
        status: pass
      - kind: integration
        ref: "cargo build --workspace; npm --prefix packages/desktop run build; npm --prefix packages/desktop run test (490/490)"
        status: pass
    human_judgment: false

duration: ~110min
completed: 2026-09-23
status: complete
---

# Phase 5 Plan 04: Two Ceilings and a Fact Packet Summary

**The epic-scoped context packet SHAPE-05's challenge stands on (facts, current-revision criteria, accepted assumptions, D-83's position-bounded rejected set) and the closure of 01-SECURITY.md's sharpest recorded latent DoS surface — the epic roster is no longer unwindowed by design, and the agent's own board reads are bounded from the first line.**

## Performance

- **Duration:** ~110 min
- **Completed:** 2026-09-23
- **Tasks:** 3
- **Files created:** 4
- **Files modified:** 15

## Accomplishments

- **Task 1 — the epic-scoped packet.** `epic_context_packet.rs` (new) restates `context_packet.rs`'s purity contract verbatim — a pure query, no model/network/git call, no mutation of any kind — and adds `assemble_epic_context_packet(conn, project_id, epic_id: Option<&str>)`. `epic_id = None` returns a packet with every section absent (SHAPE-01's fresh-epic case), never an error. A real epic yields its own facts, its task roster filtered to current-revision criteria only (`superseded_at IS NULL`, holding D-79's line that a superseded statement never reaches an agent), the accepted `assumption` proposals from prior sessions, every prior authoring run with the stage it reached, and D-83's `RejectedSet` — the most recent `REJECTED_VERBATIM_WINDOW` (5) rejected proposals carried whole, older ones folded to their `target_type` and payload label alone, copying `compaction.rs`'s own position-only fold contract exactly (no character/token/size ceiling anywhere in the module). `render_epic_prompt` mirrors the omit-the-heading-rather-than-emit-an-empty-section rule, states the rejected set is developer-rejected and not to be re-proposed, and always closes with a fixed "Your Task" section naming the challenge stage's job — the one section with no omit case, since a fresh-epic session still needs to be told what to do.
- **Task 2 — two epic reads, two ceilings.** `domain::epic::list_epics` now returns `EpicRoster { epics, total, truncated }`, bounded at the new `EPIC_ROSTER_CEILING` (5000) — closing `01-SECURITY.md` AR-01-04's re-rate trigger ("Phase 2+ gives an agent an epic-creation path"; Phase 5 gives one a board *read* path, the trigger arriving from the other side) with a surfaced truncation flag rather than a silently-dropped tail, which is what keeps `no_row_renders_a_raw_internal_identifier_at_volume` (G-01-2's own regression guard) green. `query::authoring.rs` (new) holds the agent's own separately-bounded reads — `list_epics_page`, `list_tasks_for_epic`, `search_board_for_agent` (reusing `query::search`'s existing FTS path, not a second implementation), `list_pending_proposals` (D-82's board-level triage lane, reading through a new index — see Deviations), and `list_rejected_for_epic` (through `idx_authoring_proposals_epic_status`) — every function takes a non-optional `limit`, clamped via the `DEFAULT_LIMIT`/`MAX_LIMIT` idiom `commands/board.rs` established; none can be asked for `i64::MAX` and comply. `commands::epic::epic_list_all` and `useBoardQuery.ts`'s `useEpics` carry the roster shape end to end; `BoardView.tsx` renders a plain notice naming the ceiling and the true total whenever `truncated` is set.
- **Task 3 — proving determinism and boundedness structurally.** Extended `epic_context_packet.rs`'s own test file with five consecutive assemblies (an epic carrying tasks, criteria, accepted assumptions and a rejected-proposal history past the verbatim window) asserted `PartialEq`-equal and byte-identical when rendered, plus a before/after row-count snapshot across all six touched tables (`epics`, `tasks`, `acceptance_criteria`, `authoring_proposals`, `events`, `agent_runs`) proving the five assemblies plus interleaved reads wrote nothing. A crate-wide `unbounded_reads` gate parses `packages/core/src/query`'s own source (string-literal contents only, so a Rust identifier that happens to contain the substring `SELECT` can never produce a false positive) and asserts every `SELECT` carries a `LIMIT` in the same statement unless named in an allowlist with a written reason — ten pre-existing deliberate exceptions (aggregate `COUNT`s, small-fixed-domain `GROUP BY`s, correlated subqueries spliced into an already-bounded outer query, a `UNIQUE`-scoped lookup, `PENDING_REQUESTS_FOR_RUN_SQL`'s own documented "do not reintroduce a LIMIT here") plus this plan's own two new ones (`AGENT_TASK_CRITERIA_SQL`, `proposal_status_counts`). The allowlist's doc comment names `context_packet.rs`'s own unfixed `SUMMARIES_SQL` debt so the gate stays honest about what it tolerates without folding that Phase-4-owned debt into this plan's closure — the gate's own scope is `packages/core/src/query` only, and `SUMMARIES_SQL` lives outside it.

## Task Commits

Each task was committed atomically:

1. **Task 1: The epic-scoped packet — the facts SHAPE-05's challenge stands on** — `2198dcf` (feat)
2. **Task 2: Two epic reads, two ceilings — closing AR-01-04 without reopening G-01-2** — `a609f5d` (feat)
3. **Task 3: Prove the two properties that decay silently — determinism, and boundedness** — `7709651` (test)

## Files Created/Modified

- `packages/core/src/epic_context_packet.rs` — `assemble_epic_context_packet`, `render_epic_prompt`, `EpicContextPacket`, `RejectedSet`, `RejectionBoundary`, `REJECTED_VERBATIM_WINDOW`
- `packages/core/src/query/authoring.rs` — the agent's own bounded reads: `list_epics_page`, `list_tasks_for_epic`, `search_board_for_agent`, `list_pending_proposals`, `list_rejected_for_epic`
- `packages/core/src/db/migrations/0012_authoring_proposals_project_status_index.sql` — `idx_authoring_proposals_project_status` (deviation)
- `packages/core/tests/epic_context_packet.rs` — the packet's own proof, plus the crate-wide `unbounded_reads` gate
- `packages/core/src/lib.rs` — `pub mod epic_context_packet;`
- `packages/core/src/domain/epic.rs` — `EPIC_ROSTER_CEILING`, `EpicRoster`, `list_epics`'s new return shape
- `packages/core/src/domain/authoring_proposal.rs` — `PROPOSAL_COLUMNS`/`row_to_proposal` widened to `pub(crate)` (deviation)
- `packages/core/src/query/mod.rs` — `pub mod authoring;`
- `packages/core/src/db/mod.rs` — migration 0012 registered
- `packages/core/tests/epic_roster.rs` — updated for the new `EpicRoster` return type, plus three new ceiling/clamp tests
- `packages/desktop/src-tauri/src/commands/epic.rs` — `EpicRosterDto`, `epic_list_all`'s new return shape
- `packages/desktop/src/board/useBoardQuery.ts` — `EpicRoster`, `EPIC_ROSTER_CEILING`, `epicRosterTruncationNotice`
- `packages/desktop/src/board/BoardView.tsx` — consumes `.epics`, renders the truncation notice
- `packages/desktop/src/board/FilterBar.tsx` — consumes `.epics`
- `packages/desktop/src/board/__tests__/epic-roster.test.tsx` — updated mocks plus 5 new truncation-notice tests
- `packages/desktop/src/board/__tests__/{board-view,epic-assign,issue-parent,quick-add-focus}.test.tsx` — mock shape updated (deviation)

## Decisions Made

See `key-decisions` in frontmatter — all four are load-bearing choices made while implementing the plan's own action items.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 2 - Missing Critical] Added `idx_authoring_proposals_project_status`, a migration not in the plan's own `files_modified` list**
- **Found during:** Task 2, implementing `list_pending_proposals`
- **Issue:** The plan's own action text names `idx_authoring_proposals_project_status` as the index `list_pending_proposals` reads through, but migration `0011_authoring_staging.sql` (plan 05-02) never created it — only `idx_authoring_proposals_run_status` (leading `agent_run_id`) and `idx_authoring_proposals_epic_status` (leading `epic_id`) exist, neither of which serves a project-wide `(project_id, status)` scan. Without it, the board-level triage lane's own read would be a full table scan — exactly the class of defect this plan's own purpose is closing.
- **Fix:** Added migration `0012_authoring_proposals_project_status_index.sql` (`CREATE INDEX idx_authoring_proposals_project_status ON authoring_proposals (project_id, status, created_at DESC)`), registered in `db/mod.rs`'s migration list.
- **Files modified:** `packages/core/src/db/migrations/0012_authoring_proposals_project_status_index.sql`, `packages/core/src/db/mod.rs`
- **Verification:** `cargo test --workspace` (all migration-safety and authoring-proposal tests green)
- **Committed in:** `a609f5d` (Task 2's own commit)

**2. [Rule 1 - Bug] Widened `PROPOSAL_COLUMNS`/`row_to_proposal` to `pub(crate)` so `query::authoring` could reuse them**
- **Found during:** Task 2, implementing `list_pending_proposals`/`list_rejected_for_epic`
- **Issue:** `domain::authoring_proposal.rs`'s own column list and row mapper were private, and `query::authoring` (a sibling module tree) could not reach them — the only alternatives were duplicating the 17-column mapping a second time or widening visibility.
- **Fix:** Marked both `pub(crate)`, mirroring `query::ORDER_BY`'s own documented precedent for the identical situation ("Widening the visibility is the alternative to restating the [shape] in a second module").
- **Files modified:** `packages/core/src/domain/authoring_proposal.rs`
- **Verification:** `cargo build --workspace`; `cargo test --workspace`
- **Committed in:** `a609f5d` (Task 2's own commit)

**3. [Rule 1 - Bug] Updated four pre-existing desktop test files whose `epic_list_all` mocks assumed the old bare-array wire shape**
- **Found during:** Task 2, after changing `useEpics`'s return shape from `EpicSummary[]` to `EpicRoster`
- **Issue:** `board-view.test.tsx`, `epic-assign.test.tsx`, `issue-parent.test.tsx` and `quick-add-focus.test.tsx` (none in the plan's own `files_modified` list) all mock `invokeCommand("epic_list_all", ...)` to resolve a bare array — after `BoardView.tsx`/`FilterBar.tsx` were updated to read `.data?.epics`, these mocks' `.epics` access silently returned `undefined ?? []`, degrading every affected test to "the roster is empty" without failing (`npm run test` reported 7 real failures on the actually-assertive tests; the others degraded silently).
- **Fix:** Wrapped each mock's resolved array in `{ epics: [...], total: N, truncated: false }`, matching `epic_list_all`'s real wire shape.
- **Files modified:** `packages/desktop/src/board/__tests__/{board-view,epic-assign,issue-parent,quick-add-focus}.test.tsx`
- **Verification:** `npm --prefix packages/desktop run test` (490/490 pass, up from 483/490 before the fix)
- **Committed in:** `a609f5d` (Task 2's own commit)

---

**Total deviations:** 3 auto-fixed (1 Rule 2 — missing index, 2 Rule 1 — bugs directly caused by this plan's own type/shape changes). **Impact:** All three are necessary consequences of the plan's own changes, not scope creep — none touch product behaviour beyond what the plan specifies.

## Issues Encountered

None.

## User Setup Required

None — no external service configuration required.

## Next Phase Readiness

- `01-SECURITY.md` AR-01-04 is closed with an honest reason (a five-hundred-times-larger ceiling with a surfaced truncation flag, not an enforced silence), and `no_row_renders_a_raw_internal_identifier_at_volume` (G-01-2's own regression guard) still passes unweakened.
- Plan 05-06 (the agent's read/write tool surface) can call `query::authoring`'s five bounded functions directly — every one already clamps its own limit, so no additional bounding work is needed at the tool-handler layer.
- Plan 05-05 (amend/delete and the remaining proposal verbs) can prime a reopened session's SHAPE-05 challenge from `assemble_epic_context_packet`/`render_epic_prompt` as built here — no further packet work is implied.
- `SHAPE-01` and `SHAPE-05` are this plan's own declared requirements but are NOT yet marked complete: the shared-ID gate (`requirements.ready-ids`) reports `0/2 requirement(s) ready to mark complete` — both IDs are also declared by later sibling plans in this phase (05-05/05-06) still in progress. They will flip to `Complete` automatically the next time any plan in this phase finishes its own `update_requirements` step, once every declaring plan has a `*-SUMMARY.md`.

---
*Phase: 05-socratic-epic-authoring*
*Completed: 2026-09-23*

## Self-Check: PASSED

- All 4 created files found on disk.
- All 3 task commit hashes (`2198dcf`, `a609f5d`, `7709651`) found in git history.
- `cargo test -p core --test epic_context_packet` (10/10), `--test epic_roster` (14/14), `--test search_filter` (8/8) and `cargo test --workspace` (0 failures across every crate) all pass.
- `cargo build --workspace` succeeds with only the one pre-existing, unrelated `StartRunOutcome` dead-code warning.
- `npm --prefix packages/desktop run build` succeeds; `npm --prefix packages/desktop run test` (490/490, including `epic-roster.test.tsx` 26/26) passes.
- All five named source gates return their expected values: zero `format!` in `query/authoring.rs`, zero `i64::MAX`/`LIMIT -1`/optional-limit parameters, `EPIC_ROSTER_CEILING` declared and applied (2 occurrences), `epic_context_packet.rs` carries no `Command::new`/`reqwest`/`format!`/`INSERT`/`UPDATE`/`DELETE` and at least one `superseded_at IS NULL` filter.
