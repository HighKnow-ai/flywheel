---
phase: 02-one-agent-one-worktree-watched-live
plan: 06
subsystem: ui
tags: [react, rust, rusqlite, tauri, typescript, vitest, tanstack-query, lucide-react]

# Dependency graph
requires:
  - phase: 02-one-agent-one-worktree-watched-live
    provides: "Plan 02-03's agent signal vocabulary (theme/tokens.ts AGENT group, legend/marks.ts
      run-blocked/blocked-indicator marks, state/keyboard.ts's permission-card region/ActionIds and
      its deliberate Escape-ladder exclusion). Plan 02-05's permission gate (permission_requests/
      permission_rules tables, domain::permission_request, agent_run_answer_permission, and
      query::permissions's blocked_task_ids_for_project/blocked_count_for_project) — this plan
      renders and answers what that produced. Plan 02-04's ItemDetailPanel/onStartWork wiring,
      unmodified by this plan beyond the new card mount point."
provides:
  - "packages/desktop/src/session/PermissionRequestCard.tsx — one component, two mount points
    (feed/compact variants), three unequal actions, structurally non-dismissible"
  - "state/keyboard.ts's useRegionBindings — the first region-scoped (non-global) keyboard hook in
    this codebase, the seam any future region-owned surface reaches for instead of a local handler"
  - "query::permissions::{pending_requests_for_run, latest_run_id_for_task} and the
    agent_run_pending_permissions/task_latest_agent_run/board_blocked_summary Tauri commands —
    every remaining read the permission gate's UI needed and didn't have yet"
  - "board/useBoardQuery.ts's usePendingPermissionRequests/useLatestAgentRunId/useBlockedSummary —
    the one shared query both mount points and the board row/rail read"
  - "The board-visible blocked signal end to end: BoardRow.tsx's blocked pill and
    ProjectRail.tsx's per-project count badge, both reading one shared summary"
affects: [02-07, 02-08, 02-10, "10 (FLEET-02/FLEET-04 generalise this plan's per-project mechanism)"]

# Actuals (#2632)
actuals:
  tokens: 22977
  tasks: 3
  commits: 3
  plan_head_before: 41604eefa99d67dd0ae15fcba5c2a69cfed4f568

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "Region-scoped keyboard hook (useRegionBindings) as the sibling of the existing global-only
      useGlobalBindings — the window-level listener lives in state/keyboard.ts, never inside the
      region-owning component, which is what let PermissionRequestCard.tsx ship with zero local key
      or dismissal handlers (T-02-16's own verify gate)."
    - "One shared TanStack Query key (usePendingPermissionRequests(agentRunId)) consumed by two
      independent mount points (SessionSurface's feed variant, ItemDetailPanel's compact variant)
      so answering at either one invalidates both — proved by rendering both against one shared
      QueryClient in the same test, not by inspecting each component in isolation."
    - "A board-visible signal (blocked pill) made structurally exempt from a progressive-disclosure
      truncation ladder by NOT carrying a field-* class — the exact mechanism 01-UI-SPEC.md's
      criteria-count badge already established, reused rather than re-derived."

key-files:
  created:
    - packages/desktop/src/session/PermissionRequestCard.tsx
    - packages/desktop/src/session/__tests__/permission-card.test.tsx
    - packages/desktop/src/board/__tests__/blocked-indicator.test.tsx
  modified:
    - packages/core/src/query/permissions.rs
    - packages/core/tests/permission_gate.rs
    - packages/desktop/src-tauri/capabilities/default.json
    - packages/desktop/src-tauri/src/commands/agent_run.rs
    - packages/desktop/src-tauri/src/main.rs
    - packages/desktop/src/adapters/tauri.ts
    - packages/desktop/src/board/BoardRow.tsx
    - packages/desktop/src/board/BoardView.tsx
    - packages/desktop/src/board/__tests__/epic-roster.test.tsx
    - packages/desktop/src/board/__tests__/filter.test.tsx
    - packages/desktop/src/board/__tests__/workflow.test.tsx
    - packages/desktop/src/board/useBoardQuery.ts
    - packages/desktop/src/item-detail/ItemDetailPanel.tsx
    - packages/desktop/src/projects/ProjectRail.tsx
    - packages/desktop/src/session/SessionSurface.tsx
    - packages/desktop/src/session/__tests__/session-surface.test.tsx
    - packages/desktop/src/state/keyboard.ts

key-decisions:
  - "pending_requests_for_run reads ALL pending permission_requests rows for a run, not the LIMIT-1
    domain::permission_request::pending_for_run already had — two concurrent MCP tool calls (D4 in
    02-05-SUMMARY) can each raise their own pending row for the same run, and the UI must stack
    every one of them (E3 zero-one-many), not silently surface only the latest."
  - "ItemDetailPanel resolves its own agentRunId self-contained (useLatestAgentRunId(item.id)),
    exactly the way ActivityTrail/AcceptanceCriteriaList already resolve their own embedded-section
    queries off item.id — preserves this component's existing 'no store import' convention rather
    than threading a new prop down from BoardView."
  - "With more than one pending request rendered at once, only the OLDEST one's row responds to the
    a/d/Shift+A keyboard shortcuts; every row is independently answerable by click regardless. A
    deliberate, documented simplification (multiple concurrent requests are rare in practice) rather
    than building keyboard-focus tracking across an array the plan itself didn't specify."
  - "Activating the board row's blocked pill reuses the SAME onOpenDetail destination a
    double-click already uses (open the item detail panel), rather than adding a new 'scroll and
    focus the card' mechanism — the panel already renders the compact card at a fixed position near
    the top the moment it mounts, satisfying the plan's own 'fastest path to answering it' intent
    without new machinery ItemDetailPanel.tsx wasn't declared to need in this plan's own file list."

requirements-completed: [AGNT-06, DATA-06]

coverage:
  - id: D1
    description: "The permission-request card renders nothing with no pending request, and a
      pending request renders the ShieldAlert glyph, tool name, read-only Mono payload, and the
      three actions at their exact copy and unequal visual weights"
    requirement: AGNT-06
    verification:
      - kind: unit
        ref: "packages/desktop/src/session/__tests__/permission-card.test.tsx (PermissionRequestCard (standalone) describe block)"
        status: pass
    human_judgment: false
  - id: D2
    description: "Escape never resolves the card (T-02-16); the card has no onKeyDown prop, no
      addEventListener call and no dismissable-layer wrapper anywhere in its own source"
    requirement: AGNT-06
    verification:
      - kind: unit
        ref: "packages/desktop/src/session/__tests__/permission-card.test.tsx#Escape never resolves the card — the answer spy sees zero calls and the card stays mounted"
        status: pass
      - kind: other
        ref: "grep -vE '^[[:space:]]*(//|/*|*)' PermissionRequestCard.tsx | grep -cE 'onKeyDown|addEventListener|DismissableLayer' == 0"
        status: pass
    human_judgment: false
  - id: D3
    description: "A double-activation of Allow calls the answer function exactly once (T-02-29);
      a rejected answer keeps the card mounted, re-enables its actions and renders an inline error
      rather than vanishing"
    requirement: AGNT-06
    verification:
      - kind: unit
        ref: "packages/desktop/src/session/__tests__/permission-card.test.tsx (activating Allow twice / a rejected answer describe cases)"
        status: pass
    human_judgment: false
  - id: D4
    description: "Two pending requests on one run render as two independently answerable cards,
      stacked in creation order, and the Rust query surfaces both rows (not just the latest)"
    requirement: AGNT-06
    verification:
      - kind: unit
        ref: "packages/desktop/src/session/__tests__/permission-card.test.tsx#renders two pending requests as two independently answerable cards"
        status: pass
      - kind: integration
        ref: "packages/core/tests/permission_gate.rs#pending_requests_for_run_returns_every_pending_row_in_creation_order"
        status: pass
    human_judgment: false
  - id: D5
    description: "Both mount points (session feed, item detail compact) read the same shared
      query for one agentRunId, and answering at either one clears the other within one delta
      cycle with no stale duplicate left in the document"
    requirement: AGNT-06
    verification:
      - kind: integration
        ref: "packages/desktop/src/session/__tests__/permission-card.test.tsx (Two mount points, one request describe block, all 6 cases)"
        status: pass
    human_judgment: false
  - id: D6
    description: "The session feed suppresses its follow-the-tail scroll while any request is
      pending, and resumes it in the same cycle the request is answered"
    requirement: AGNT-06
    verification:
      - kind: unit
        ref: "packages/desktop/src/session/__tests__/permission-card.test.tsx#the feed does not scroll to its tail while a pending card is mounted, and resumes after it is answered"
        status: pass
    human_judgment: false
  - id: D7
    description: "A task with no blocked run renders no pill and no rail badge; a blocked task
      renders the pill immediately after the (unchanged) status glyph, layered on top rather than
      replacing it, and it is structurally exempt from the row's truncation ladder"
    requirement: DATA-06
    verification:
      - kind: unit
        ref: "packages/desktop/src/board/__tests__/blocked-indicator.test.tsx (BoardRow blocked indicator describe block, all 6 cases)"
        status: pass
    human_judgment: false
  - id: D8
    description: "The project-rail badge renders no element at zero blocked tasks, a numeral above
      zero, and the exact singular/plural tooltip copy"
    requirement: DATA-06
    verification:
      - kind: unit
        ref: "packages/desktop/src/board/__tests__/blocked-indicator.test.tsx (ProjectRail blocked count badge describe block, all 4 cases)"
        status: pass
    human_judgment: false
  - id: D9
    description: "Pressing Start Work in the real packaged app, hitting a genuinely gated tool
      call, watching the task row flip to a blocked pill, and answering from the item detail panel
      resumes the agent rather than restarting it — ROADMAP success criterion 3 end to end"
    verification: []
    human_judgment: true
    rationale: "This plan builds and unit-tests every piece of the mechanism (the card, the
      cross-mount clearing, the board indicator, the rail count), but the full stack — a real
      packaged app, a real claude session, a human watching a row flip blocked and answering it —
      has not been observed yet. 02-05-SUMMARY's own D9 deferred this exact end-to-end claim to
      02-06 shipping the surfaces; it now defers to end-of-phase UAT per
      workflow.human_verify_mode=end-of-phase, the same pattern every prior Phase 2 plan used."

duration: 50min
completed: 2026-09-11
status: complete
---

# Phase 2 Plan 6: The Board Says What Needs You — Permission Card, Blocked Pill, Rail Count Summary

**One `PermissionRequestCard` component (feed/compact variants, structurally non-dismissible, deliberately unequal Allow/Deny/Allow-always actions) mounted at both the session feed and the item detail panel off one shared `usePendingPermissionRequests(agentRunId)` query, plus a board-row blocked pill and project-rail count reading `query::permissions`'s existing blocked-task summary — closing ROADMAP success criterion 3's "the user answers it from the board."**

## Performance

- **Duration:** ~50 min (continuation session)
- **Started:** 2026-09-11
- **Completed:** 2026-09-11
- **Tasks:** 3/3 completed
- **Files modified:** 20 (3 created, 17 modified)

## Accomplishments

- **`PermissionRequestCard.tsx`** (new): one component, a `feed`/`compact` variant prop, reused
  across both mount points per Discretion #6/`ParentPicker`'s established precedent. Renders the
  `ShieldAlert` glyph (resolved from the published `blocked-indicator` mark), the tool name in
  Heading weight, the raw input payload read-only in Mono, and three deliberately unequal actions.
  Owns no local key handler, no `onKeyDown` prop and no dismissable-layer wrapper anywhere in its
  own source — its three keyboard shortcuts resolve through `state/keyboard.ts`'s new
  `useRegionBindings` hook instead, which owns the window-level listener so the card's structural
  key/dismissal surface stays at zero (T-02-16).
- **`query::permissions::pending_requests_for_run`/`latest_run_id_for_task`** (new): the Rust reads
  the UI needed and didn't have — the former returns EVERY pending row for a run (not just the
  latest, since two concurrent MCP calls can each raise one), the latter resolves a task's most
  recent run id so `ItemDetailPanel` can join the same shared query the session feed uses.
  `agent_run_pending_permissions`/`task_latest_agent_run`/`board_blocked_summary` Tauri commands
  expose them, all read-only.
- **`usePendingPermissionRequests(agentRunId)`** (new, `useBoardQuery.ts`): the ONE query both
  mount points read, invalidated on both `subscribeBoardChanged` and `subscribeAgentEvent`, never
  polled — proved by rendering both mount points against one shared `QueryClient` and asserting
  answering either clears both. `useLatestAgentRunId`/`useBlockedSummary` follow the same
  subscription discipline.
- **`SessionSurface.tsx`**: mounts the `feed` card at the tail of the transcript; gained a minimal
  follow-the-tail scroll (a tail sentinel + `scrollIntoView`) that this plan suppresses for as long
  as a request is pending and resumes the instant none is.
- **`ItemDetailPanel.tsx`**: mounts the `compact` card above the Activity Trail whenever the task's
  most recent run has a pending request, resolving its own `agentRunId` self-contained (matching
  `ActivityTrail`/`AcceptanceCriteriaList`'s existing embedded-section convention — no store import).
- **`BoardRow.tsx`**: a blocked pill inserted immediately after the (unchanged) status glyph,
  carrying no `field-*` class — the exact mechanism that already exempts the criteria-count badge
  from `App.css`'s truncation ladder, reused rather than re-derived. Activating it opens the item
  detail panel (the same destination a double-click already uses).
- **`ProjectRail.tsx`**: the current project's entry gains a numeral count badge, absent entirely
  at zero, with the exact singular/plural tooltip copy the plan specifies.

## Task Commits

Each task was committed atomically:

1. **Task 1: The permission-request card — one component, three unequal actions, no way out but answering** — `66a810d` (feat)
2. **Task 2: Two mount points, one request — answering in either place clears both** — `183bff1` (feat)
3. **Task 3: The board says what needs you — a blocked pill on the row and a count on the rail** — `5a8916d` (feat)

**Plan metadata:** (this commit)

_No REFACTOR commits — Tasks 1 and 3 carried `tdd="true"` in the plan frontmatter, but each was
implemented and its full behavior-covering test suite written together per this plan's own task
shape (test-file authoring is part of the same `<action>` block, not a separate RED-fails-first
task), the same convention 02-01-SUMMARY.md and 02-05-SUMMARY.md both recorded for their own
`tdd="true"` tasks in this phase._

## Files Created/Modified

See `key-files` in frontmatter for the full list.

## Decisions Made

See `key-decisions` in frontmatter. The most consequential: `pending_requests_for_run` reads every
pending row for a run rather than reusing the existing `LIMIT 1` lookup, because two concurrent
held MCP calls (a real, measured case per 02-05-SUMMARY's own D4) can each raise their own pending
row for the same run, and the card's own zero-one-many resolution promises to stack all of them.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 3 - Blocking] No Rust read existed for a run's pending-request CONTENT, or for a task's
most recent run id**
- **Found during:** Task 2, writing `usePendingPermissionRequests`/`ItemDetailPanel`'s own resolution
  of "this task's active run"
- **Issue:** Plan 02-05 built `create_pending_request`/`answer_request` and the boolean
  `blocked_task_ids_for_project`/`blocked_count_for_project` reads, but nothing exposed a pending
  request's tool name/payload to a caller, and nothing resolved a task id to its latest run id —
  both are required for the card to render anything at all, and Task 2's own declared file list
  (`SessionSurface.tsx`, `ItemDetailPanel.tsx`, `useBoardQuery.ts`) named no Rust file.
- **Fix:** Added `query::permissions::pending_requests_for_run`/`latest_run_id_for_task` and the
  `agent_run_pending_permissions`/`task_latest_agent_run` Tauri commands (Task 2's own scope,
  committed with it), then `board_blocked_summary` for Task 3's own equivalent gap.
- **Files modified:** `packages/core/src/query/permissions.rs`, `packages/core/tests/permission_gate.rs`,
  `packages/desktop/src-tauri/src/commands/agent_run.rs`, `packages/desktop/src-tauri/src/main.rs`,
  `packages/desktop/src-tauri/capabilities/default.json`
- **Verification:** `cargo test -p core --test permission_gate` (11/11), `cargo test -p desktop`
  (14/14), `cargo build --workspace` clean
- **Committed in:** `183bff1` (Task 2), `5a8916d` (Task 3)

**2. [Rule 1 - Bug] `BoardView.tsx` gaining its own `subscribeBoardChanged` subscriber
(`useBlockedSummary`) surfaced a genuine unhandled promise rejection in two pre-existing board test
files that rendered `BoardView` with no `adapters/tauri` mock at all**
- **Found during:** Task 3, running the full `npm --prefix packages/desktop run test` suite after
  wiring `useBlockedSummary` into `BoardView`
- **Issue:** `workflow.test.tsx` and `filter.test.tsx` never mocked `adapters/tauri` — harmless
  before this plan because `BoardView` never called `subscribeBoardChanged` directly (only
  `App.tsx` did, via `useBoardChangedSubscription`). This plan's `useBlockedSummary` is the first
  hook `BoardView` itself calls that does, and the real (unmocked) `listen()` call rejects
  synchronously outside a Tauri context with nothing attached to catch it.
- **Fix:** Added the same minimal `vi.mock("../../adapters/tauri", ...)` every sibling board test
  file already uses.
- **Files modified:** `packages/desktop/src/board/__tests__/workflow.test.tsx`,
  `packages/desktop/src/board/__tests__/filter.test.tsx`
- **Verification:** `npm --prefix packages/desktop run test` — 229/229 pass, zero unhandled-rejection
  errors (down from 4)
- **Committed in:** `5a8916d` (Task 3)

**3. [Rule 1 - Bug] `epic-roster.test.tsx`'s single-slot captured-handler mock let `BoardView`'s new
`subscribeBoardChanged` subscriber silently clobber the real one under test**
- **Found during:** Task 3, running the full test suite — `epic-roster.test.tsx`'s three
  `board:changed` liveness tests failed once `BoardView` gained a second, independent
  `subscribeBoardChanged` subscriber (`useBlockedSummary`) alongside the test's own mounted
  `<Subscriber>` (`useBoardChangedSubscription`)
- **Issue:** The mock's `capturedBoardChangedHandler` was a single overwritable variable, correct
  when exactly one subscriber existed but silently wrong the moment a second, equally real one was
  added — whichever mounted last won the slot, and the test's simulated push drove only that one.
- **Fix:** Widened the mock to `capturedBoardChangedHandlers: Array<() => void>`, and
  `triggerBoardChanged()` now invokes every registered handler — matching real Tauri `listen()`,
  which supports any number of independent listeners for one event.
- **Files modified:** `packages/desktop/src/board/__tests__/epic-roster.test.tsx`
- **Verification:** `npm --prefix packages/desktop run test -- epic-roster` — 21/21 pass
- **Committed in:** `5a8916d` (Task 3)

---

**Total deviations:** 3 auto-fixed (1 Rule 3 blocking-functionality addition, 2 Rule 1 bug fixes).
**Impact on plan:** Deviation #1 is the most consequential — without it, neither mount point could
render any actual pending-request content, and `ItemDetailPanel` had no way to resolve its own
task's run id at all; the card's own behavior would be untestable end to end. Deviations #2 and #3
were necessary for the existing suite to keep passing once this plan's own `BoardRow`/`ProjectRail`
wiring gave `BoardView` a second `board:changed` subscriber it never had before. No scope creep
beyond what each task's own action/behavior/acceptance criteria already required.

## Known Stubs

None that block this plan's own goal. With more than one pending request rendered at once, only
the oldest one's row responds to the `a`/`d`/Shift+A keyboard shortcuts — every row remains
independently answerable by click regardless, and this is documented as a deliberate simplification
(see `key-decisions`) rather than a gap, since concurrent requests on one run are the rare case
(02-05-SUMMARY's own D4) and the plan does not specify per-row keyboard targeting.

## Issues Encountered

`cargo test --workspace` occasionally shows `worktree_lifecycle.rs`'s
`a_worktree_survives_two_runs_with_an_epic` as flaky under cross-binary parallelism (reproduced
once, then passed consistently on 3 subsequent isolated and workspace-wide runs). This test's own
file is outside this plan's scope, unrelated to any change this plan makes (no `FLYWHEEL_WORKTREE_ROOT`/
worktree-lifecycle code was touched), and matches the exact class of env-var race 02-04-SUMMARY's
own deviation #2 already documented for a sibling test file — not fixed here, out of scope.

## User Setup Required

None — no external service configuration required.

## Next Phase Readiness

- Plans 02-07 (session surface expansion) and 02-08 (Runs section) can build directly on
  `PermissionRequestCard.tsx`, `useRegionBindings`, and `usePendingPermissionRequests` — none of
  them needs to invent a parallel mechanism for a pending request or a region-scoped keybinding.
- Phase 10's FLEET-02 (cross-project blocked visibility) and FLEET-04 (OS notifications) can
  generalise `board_blocked_summary`/`useBlockedSummary`'s per-project mechanism directly — this
  plan built the real thing, not a placeholder, per its own Boundary note.
- **Requirements AGNT-06/DATA-06** were shared with plan 02-05 (both plans declared them); this
  plan is the second and last plan declaring either, so both become eligible to mark complete now
  that both plans have SUMMARYs.
- **Not yet human-observed:** the full end-to-end claim (real packaged app, real gated tool call, a
  human watching a row flip blocked and answering it) — deferred to end-of-phase UAT per
  `workflow.human_verify_mode: end-of-phase`, the same pattern every prior Phase 2 plan's SUMMARY
  used.
- Every checkpoint this plan's own `<tasks>` block declared has been resolved — the plan is fully
  closed out with no open decisions.

---
*Phase: 02-one-agent-one-worktree-watched-live*
*Completed: 2026-09-11*

## Self-Check: PASSED

All 3 files listed under `key-files.created` verified present on disk with `[ -f ]`. All 3 task
commits (`66a810d`, `183bff1`, `5a8916d`) verified present in `git log --oneline --all`. Every
`<acceptance_criteria>` item across Tasks 1-3 re-run and passing: `npm --prefix packages/desktop run
test -- permission-card` (17/17), `npm --prefix packages/desktop run test -- blocked-indicator`
(10/10), full suite `npm --prefix packages/desktop run test` (229/229, zero unhandled-rejection
errors), `npm --prefix packages/desktop run build` (clean, no `error TS`), `cargo build --workspace`
(clean), `cargo test -p core --test permission_gate` (11/11), `cargo test -p desktop` (14/14), the
structural no-`onKeyDown`/`addEventListener`/`DismissableLayer` grep gate on
`PermissionRequestCard.tsx`, the no-hex-literal grep gate across `packages/desktop/src`, the
single-registration grep gate for `board_blocked_summary` in `main.rs`, and the
no-notification-API grep gate across `BoardRow.tsx`/`ProjectRail.tsx` — all PASS. The plan-level
`<verification>` block's one manual item (a real packaged-app session hitting a genuinely gated
tool call, watched and answered from the board) is not re-run here — it requires a human at a
GUI — see "Next Phase Readiness."
