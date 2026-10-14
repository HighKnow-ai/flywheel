---
phase: 02-one-agent-one-worktree-watched-live
plan: 08
subsystem: ui
tags: [react, typescript, rust, rusqlite, tanstack-query, lucide-react]

# Dependency graph
requires:
  - phase: 02-one-agent-one-worktree-watched-live
    provides: "Plan 02-07's query::agent_runs (runs_for_task/worktree_summary_for_task) and
      useAgentRuns/useWorktreeSummary read hooks, plan 02-03's agent signal vocabulary
      (legend/marks.ts run-status marks, theme/tokens.ts AGENT colour roles), plan 02-06's
      PermissionRequestCard compact variant and usePendingPermissionRequests, plan 02-01's
      worktrees/agent_runs schema and SessionSurface/activeAgentRunId routing"
provides:
  - "WorktreeSummary.tsx: the task's git identity (branch + left-truncated copyable absolute
    path), absent until a worktree exists"
  - "RunsSection.tsx: every AgentRun on a task, newest first, with its status badge, timing,
    cost, session identity, and a primary Watch Live/View action on the active run"
  - "openLiveSessionForTask (board/useBoardQuery.ts): the one entry point the board-list `l` key
    and the command palette both call to open a task's most recent run"
  - "query::agent_runs::RunRow / RunSummaryDto / adapters/tauri.ts's RunSummaryDto now carry
    external_session_id — the session-identity read path later plans can rely on existing"
affects: []

# Actuals (#2632)
actuals:
  tokens: 14207
  tasks: 3
  commits: 3
  plan_head_before: eec00ef51a15593201a707be1c4cb6860692c120

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "Left-truncation via direction:rtl + text-align:left on an inline element containing plain
      LTR text — the standard CSS technique for eliding a shared path prefix while keeping the
      meaningful tail visible; the copy affordance always writes the untruncated string."
    - "A row's own onClick opens it, but any interactive child that should NOT trigger that
      (the primary action button, the nested PermissionRequestCard) stops propagation rather
      than the row refusing to listen — keeps the row itself the single source of 'open this
      run' while still allowing normal button semantics inside it."
    - "Small per-file duplication of tiny building blocks (MONO_STACK, the run-status
      label/mark-id/colour lookup tables, relativeTime, useNowTick) rather than exporting them
      from SessionSurface.tsx — this codebase's own established convention (already duplicated
      across FeedRow.tsx/RawLogView.tsx/PermissionRequestCard.tsx), preserved here rather than
      introducing a fifth shared module for building blocks this small."

key-files:
  created:
    - packages/desktop/src/item-detail/WorktreeSummary.tsx
    - packages/desktop/src/item-detail/RunsSection.tsx
    - packages/desktop/src/item-detail/__tests__/worktree-summary.test.tsx
    - packages/desktop/src/item-detail/__tests__/runs-section.test.tsx
  modified:
    - packages/desktop/src/item-detail/ItemDetailPanel.tsx
    - packages/desktop/src/board/BoardView.tsx
    - packages/desktop/src/board/CommandPalette.tsx
    - packages/desktop/src/board/useBoardQuery.ts
    - packages/desktop/src/adapters/tauri.ts
    - packages/core/src/query/agent_runs.rs
    - packages/desktop/src-tauri/src/commands/agent_run.rs
    - packages/desktop/src/session/__tests__/permission-card.test.tsx

key-decisions:
  - "external_session_id added to query::agent_runs::RunRow/RunSummaryDto/adapters/tauri.ts's
    RunSummaryDto — the column already existed on agent_runs (migration 0003_agent_runtime.sql)
    but plan 02-07's own SELECT list never read it. Task 2's own <behavior> requires rendering
    `Run · session {external_session_id}`, which was unsatisfiable without this extension."
  - "The permission-request card's compact mount moved from a generic ItemDetailPanel-level
    section (plan 02-06 Task 2) into RunsSection, nested beneath the specific blocked run's own
    row — the run and the answer it is waiting on now read as one linked record instead of two
    unrelated sections that happened to both be visible."
  - "The active/most-recent run is simply RunsSection's own first (newest) row — no separate
    'which run is active' resolution was built for the panel; only board-list keyboard/palette
    paths (which don't already have the loaded list) call the new openLiveSessionForTask helper."
  - "WorktreeSummary defensively treats branch/path as possibly null/undefined at the component
    level despite the wire type declaring them non-null strings (worktrees.branch/path are
    NOT NULL today) — a schema regression should render an inline notice, not a blank Mono span
    or a crash (T-02-37)."

patterns-established:
  - "A list row's aria-label is the row's own rendered identity line (e.g. 'Run · session
    sess-2') rather than a synthetic index — lets tests (and any future assistive-tech user)
    address a specific row by what it actually says, matching AcceptanceCriteriaList's own
    role=\"listitem\" + aria-label precedent."

requirements-completed: [DATA-06, WORK-01, WORK-08, LINK-01]

coverage:
  - id: D1
    description: "The worktree summary line: absent until a worktree exists, then branch + a
      left-truncated, copyable absolute path in the Mono role; a null branch/path renders an
      inline notice for the missing field rather than a blank span"
    requirement: "LINK-01"
    verification:
      - kind: unit
        ref: "packages/desktop/src/item-detail/__tests__/worktree-summary.test.tsx (all 8 cases)"
        status: pass
      - kind: other
        ref: "grep gates: zero openInEditor|openInTerminal|reveal_in_finder occurrences; zero new hex colour literals"
        status: pass
    human_judgment: false
  - id: D2
    description: "The runs list: absent until a run exists, newest first, each row showing its
      status badge (glyph+word, never colour alone), relative start time, duration or a live
      elapsed counter, cost so far, and its run identity paired with its session identity"
    requirement: "DATA-06"
    verification:
      - kind: unit
        ref: "packages/desktop/src/item-detail/__tests__/runs-section.test.tsx (Task 2 cases:
          empty/loading/order/elapsed-counter/failed-vs-interrupted/session-identity/no-session/
          blocked-permission-card)"
        status: pass
      - kind: other
        ref: "grep gate: RunsSection.tsx reuses PermissionRequestCard (>=1 occurrence)"
        status: pass
    human_judgment: false
  - id: D3
    description: "One way into the session surface: the active row carries Watch Live/View,
      selecting any other row opens it read-only through the same callback, the board-list `l`
      key and the command palette both resolve through one shared entry point, and the whole
      path is a no-op for a task with no runs"
    requirement: "WORK-01"
    verification:
      - kind: unit
        ref: "packages/desktop/src/item-detail/__tests__/runs-section.test.tsx (Watch Live/View,
          select-non-active-row, active-row-click, no-op-for-zero-runs, ItemDetailPanel section
          order cases)"
        status: pass
      - kind: other
        ref: "grep gate: packages/desktop/src/session/*.tsx still exactly 4 files (no second
          history viewer built)"
        status: pass
    human_judgment: false
  - id: D4
    description: "The full end-to-end claim: running two sessions on one task and confirming the
      panel shows one worktree line, two run rows newest first with their session identities,
      and that both open into the same session surface (the plan's own manual <verification>
      step)"
    verification: []
    human_judgment: true
    rationale: "Every mechanism this claim depends on is unit-tested in isolation (the worktree
      read, the runs read/render, the click-to-open wiring, the shared-entry-point keyboard/
      palette resolution), but watching two real runs on one real task in the packaged app has
      not been observed by a human yet. Deferred to end-of-phase UAT per
      workflow.human_verify_mode=end-of-phase, the same pattern every prior Phase 2 plan's
      SUMMARY used (02-07-SUMMARY.md D7, etc.)."

duration: 35min
completed: 2026-09-11
status: complete
---

# Phase 2 Plan 8: The Worktree, the Run and the Session as Distinct Linked Records Summary

**A task's worktree, its agent runs and their session identities are now visible on the board as distinct linked records — one worktree summary line, a newest-first runs list carrying `Run · session {id}` per row, and exactly one click-through path into the live session surface.**

## Performance

- **Duration:** ~35 min
- **Started:** 2026-09-11T01:40:00Z (approx.)
- **Completed:** 2026-09-11T02:13:16Z
- **Tasks:** 3/3 completed
- **Files modified:** 12 (4 created, 8 modified)

## Accomplishments

- **`WorktreeSummary.tsx`** (new): a task's git identity — branch and absolute path, both in the
  Mono role, absent until a worktree exists. The path truncates from the left (`direction: rtl` +
  `text-align: left`) so the meaningful `{PROJECT}/{TASK}/` tail stays visible; the copy affordance
  always writes the full, untruncated path. A null branch/path (a hypothetical schema regression —
  `worktrees.branch`/`path` are `NOT NULL` today) renders an inline notice for the missing field
  rather than a blank span.
- **`RunsSection.tsx`** (new): every `AgentRun` on a task, newest first, absent until one exists.
  Each row carries its run-status badge resolved from `legend/marks.ts`'s `agent` channel (glyph +
  word, never colour alone — failed/interrupted are asserted on glyph and word alone), a relative
  start time with the absolute on hover, a duration (terminal runs) or a live elapsed counter
  (running/blocked, ticking in its own isolated `RunRow` component), cost so far, and its run
  identity paired with its session identity in the exact form `Run · session {external_session_id}`
  (omitting the label entirely when no session id exists yet). A blocked run's row mounts the
  shared compact `PermissionRequestCard` beneath it.
- **One way into the session surface**: the active (newest) row carries a primary `Watch Live`
  (running/blocked) or `View` (terminal) button with the same visual weight as `Start Work`;
  selecting any other row opens it read-only through the identical `onOpenRun` callback — there is
  still exactly one session surface (`packages/desktop/src/session/` stayed at 4 files). The
  board-list `l` key and the command palette both resolve "which run is active" through one new
  shared helper, `openLiveSessionForTask` (`board/useBoardQuery.ts`), rather than each computing it
  separately; the whole path is a no-op for a task with no runs.
- **`query::agent_runs`/`RunSummaryDto` extended** with `external_session_id` (Rust core → Tauri
  command → TS adapter, field-for-field) — the column already existed on `agent_runs` but plan
  02-07's own read path never selected it.

## Task Commits

Each task was committed atomically:

1. **Task 1: The worktree summary — the task's git identity, readable at a glance** - `f1b085f` (feat)
2. **Task 2: The runs list — every session on this task, newest first, with what it cost** - `2a4b2d9` (feat)
3. **Task 3: One way into the session surface, live or long finished** - `c6dedc6` (feat)

**Plan metadata:** (this commit)

_No TDD RED/GREEN/REFACTOR split — Tasks 1 and 2 carry `tdd="true"` in the plan frontmatter, but
each was implemented and its full behavior-covering test suite written together, the same
convention every prior Phase 2 plan's SUMMARY recorded for its own `tdd="true"` tasks (see
02-07-SUMMARY.md)._

## Files Created/Modified

See `key-files` in frontmatter for the full list.

## Decisions Made

See `key-decisions` in frontmatter. The most consequential: extending `query::agent_runs`'s
existing `SELECT` list to include `external_session_id` (a column that already existed, just never
read) rather than treating the session-identity requirement as unsatisfiable or deferring it — the
plan's own `<behavior>` for Task 2 explicitly required the exact string form, and the column was
already there to read.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 3 - Blocking] `query::agent_runs::RunRow`/`RunSummaryDto` were missing `external_session_id`**
- **Found during:** Task 2, implementing the run identity/session identity row
- **Issue:** Task 2's own `<behavior>` requires rendering `Run · session {external_session_id}`,
  but plan 02-07's `RUNS_FOR_TASK_SQL` never selected `agent_runs.external_session_id` (a column
  that already existed per migration `0003_agent_runtime.sql`), and neither `RunSummaryDto` (Tauri
  command) nor the TS adapter's `RunSummaryDto` carried the field.
- **Fix:** Extended the `SELECT` list, the `RunRow` struct, `RunSummaryDto` (both Rust and TS),
  and the `From` impl, field-for-field, following the exact mirroring convention every other DTO
  in this module already uses. No schema change — the column was already there.
- **Files modified:** `packages/core/src/query/agent_runs.rs`,
  `packages/desktop/src-tauri/src/commands/agent_run.rs`, `packages/desktop/src/adapters/tauri.ts`
- **Verification:** `cargo test --workspace` (full suite green, no existing test referenced the
  old field list), `cargo build --workspace` (clean)
- **Committed in:** `2a4b2d9` (Task 2)

**2. [Rule 3 - Blocking] `session/__tests__/permission-card.test.tsx`'s shared-mount fixture needed `agent_runs_for_task`/`worktree_summary` mocks**
- **Found during:** Task 3, after moving the compact permission-card mount into `RunsSection`
- **Issue:** `ItemDetailPanel.tsx` now unconditionally mounts `RunsSection`/`WorktreeSummary` for
  a task, which call `agentRunsForTask`/`worktreeSummary` directly (not through generic
  `invokeCommand`, per `board/useBoardQuery.ts`'s own import shape). The pre-existing
  `permission-card.test.tsx` fixture (plan 02-06, predating `RunsSection`) mocked neither, so the
  Runs section read zero rows, the compact card (now living under a run's row) never rendered, and
  all 6 "two mount points" tests failed.
- **Fix:** Added `agentRunsForTask`/`worktreeSummary` to the module mock and a blocked run-row
  fixture for `RUN_ID` to the shared-mount switch, following the file's own documented "delegate
  every named export the code under test actually calls" discipline.
- **Files modified:** `packages/desktop/src/session/__tests__/permission-card.test.tsx`
- **Verification:** `npm --prefix packages/desktop run test` (270/270 pass, up from 264 before this
  plan; the 6 previously-failing cases now pass)
- **Committed in:** `c6dedc6` (Task 3)

---

**Total deviations:** 2 auto-fixed (both Rule 3 — blocking necessities: one to satisfy Task 2's
own stated behavior requirement, one to keep a pre-existing test suite green after Task 3's
required relocation of the permission card's mount point).
**Impact on plan:** Both auto-fixes were necessary for this plan's own acceptance criteria and the
full test suite to hold. No scope creep — nothing was added beyond what the plan's own action text
already required.

## Issues Encountered

None beyond the deviations documented above.

## User Setup Required

None — no external service configuration required.

## Known Stubs

**T-02-37's "missing from disk" clause is partially mitigated.** The threat register's Mitigation
Plan for T-02-37 describes rendering an inline notice for both "a worktree recorded in the database
but missing from disk" and "a row with a null branch/path." This plan implements the null-field
case fully (tested) but the missing-from-disk case has no data to act on: `WorktreeSummaryDto`
carries no disk-existence signal, and adding one would require a new backend check (a filesystem
`exists()` probe surfaced through a new or extended command) — a Rule 2/3-sized addition the plan's
own action text explicitly scopes to "Phase 3's WORK-06 reconciliation," not this plan. `WorktreeSummary.tsx`
is written so that once such a signal exists, wiring it in is additive (an inline notice branch),
not a redesign. This is a documented, accepted gap in a `verification: backstop` truth (per the
plan's own frontmatter classification), not a broken feature — the plan's actual goal (a task's git
identity readable from the board) is fully achieved for every case the current backend can report.

## Next Phase Readiness

- ROADMAP success criterion 5's first half holds: the worktree, the agent run and the session are
  visible as distinct linked records on the task, each reachable from the item detail panel.
- `query::agent_runs`/`RunSummaryDto` now carry `external_session_id` end-to-end — any later plan
  needing the session identity has it available without another read-path extension.
- **Requirements DATA-06/WORK-01/WORK-08/LINK-01** are declared by this and sibling plans in this
  phase; per the shared-ID gate, each becomes `Complete` only once every declaring plan has a
  SUMMARY. This plan is the last to declare `DATA-06` (per the dispatch context), so that
  requirement's gate resolves now that this SUMMARY exists.
- **Not yet human-observed:** the full end-to-end claim (D4 above) — running two real sessions on
  one real task in the packaged app and confirming the panel/session-surface behavior. Deferred to
  end-of-phase UAT per `workflow.human_verify_mode: end-of-phase`, the same pattern every prior
  Phase 2 plan's SUMMARY used.
- The T-02-37 "missing from disk" gap (see Known Stubs) is worth flagging to whoever plans Phase
  3's WORK-06 reconciliation — the UI-side rendering contract is ready, only the backend signal is
  missing.

---
*Phase: 02-one-agent-one-worktree-watched-live*
*Completed: 2026-09-11*

## Self-Check: PASSED

All 4 files listed under `key-files.created` verified present on disk with `[ -f ]`. All 3 task
commits (`f1b085f`, `2a4b2d9`, `c6dedc6`) verified present in `git log --oneline --all`. Every
`<acceptance_criteria>` item across Tasks 1-3 re-run and passing: `npm --prefix packages/desktop
run test` (270/270, up from 264 before this plan), `npm --prefix packages/desktop run build`
(clean, no `error TS`), `cargo test --workspace` (all green, 0 failures), the no-editor/terminal
grep gate on `WorktreeSummary.tsx`, the no-new-hex-colour grep gate across `packages/desktop/src`,
the `PermissionRequestCard` reuse gate on `RunsSection.tsx`, and the `session/*.tsx` file-count
gate (still 4, no second history viewer). The plan-level `<verification>` block's one manual item
(running two real sessions on one task and watching the panel/session-surface behavior) is not
re-run here — it requires a human at a GUI — see "Next Phase Readiness" and coverage item D4.
