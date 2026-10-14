---
phase: 05-socratic-epic-authoring
plan: 08
subsystem: agent-authoring
tags: [rusqlite, tauri-command, react, tanstack-query, board-lane, design-tokens]

requires:
  - phase: 05-socratic-epic-authoring
    provides: "plan 05-04's list_pending_proposals/list_rejected_for_epic (unconsumed until this plan), plan 05-07's useAuthoringQuery.ts query layer and ProposalRow.tsx (both extended here, never re-derived), plan 05-06's full accept/reject/amend/accept-subtree matrix and its accept-all source-scanning gate"
provides:
  - "authoring_proposals_pending (Tauri command) + ProposalWindowDto/ProposalStatusCountsDto — the board-level triage lane's own bounded, project-scoped read, wrapping query::authoring::list_pending_proposals through commands/board.rs's own resolve_limit clamp idiom"
  - "useProjectProposals/useAcceptSubtreeForProject (useAuthoringQuery.ts) — the project-scoped siblings of plan 05-07's useRunProposals/useAcceptSubtree, so the tray and the lane read through the SAME query layer"
  - "TriageLane.tsx — IssuesLane's structural sibling: pending proposals across the whole project, in their own collapsible lane, reusing ProposalRow.tsx verbatim, grouped exactly as ProposalTray.tsx groups its own run-scoped list but applied to a list spanning several different authoring runs at once"
  - "BoardRow.tsx's pendingProposalCount — an epic row's own count of pending proposals targeting it, reusing the field-epic-pill slot an epic row never otherwise fills and the --accent-text-strip/--accent-text-rack role pair, never a new token or the blocked role"
  - "Rust proof that D-82/D-83's whole staging decision holds: a pending proposal survives its run reaching completed/failed/interrupted/abandoned, staying pending, staying in the lane read, and staying acceptable"
affects: [05-10-*, phase-05-verification, phase-06-*]

actuals:
  tokens: 14750
  tasks: 3
  commits: 3
  plan_head_before: 6ea39730aca930aa09f48e9584e5b0c517bc0dfc

tech-stack:
  added: []
  patterns:
    - "A project-scoped TanStack Query hook read by two independent surfaces at once (BoardView.tsx's epic-row count and TriageLane.tsx's own list) via the SAME query key, so a second `useProjectProposals(projectId)` call site is a second subscriber to one cached read, never a second network round trip — the query-key-level counterpart of 05-07's 'one query layer, two surfaces' discipline"
    - "A board row field slot reused for a second row kind's own signal, rather than adding a new field — the field-epic-pill slot (empty on an epic row, since an epic has no epic of its own) is where the epic-row proposal count lives, which is what keeps it structurally unable to collide with the Blocked/Needs Decision pills occupying the row's other exempt slot near the status glyph"

key-files:
  created:
    - packages/desktop/src/board/TriageLane.tsx
    - packages/desktop/src/board/__tests__/triage-lane.test.tsx
  modified:
    - packages/desktop/src-tauri/src/commands/authoring.rs
    - packages/desktop/src-tauri/src/main.rs
    - packages/desktop/src/adapters/tauri.ts
    - packages/desktop/src/authoring/useAuthoringQuery.ts
    - packages/desktop/src/board/BoardRow.tsx
    - packages/desktop/src/board/BoardView.tsx
    - packages/core/tests/authoring_proposal.rs
    - packages/core/tests/perf_seed_1000.rs

key-decisions:
  - "Each TriageLane row carries its OWN proposal.agentRunId (never a lane-wide one) into ProposalRow, since the lane's project-scoped list can span several different authoring runs at once — the run-scoped tray never has to make this choice because it only ever reads one run."
  - "useAcceptSubtreeForProject was added as a new hook rather than reusing useAcceptSubtree with a placeholder run id, because the lane's own invalidation scope (the project-wide lane query) is genuinely different from any single run's query key, and hooks cannot be called conditionally per group inside a loop."
  - "Opening a proposal's session from the lane passes authoringStage as null (SessionSurface.tsx's default), not a placeholder stage string — ProposalDto carries no authoring_stage field, and a fabricated stage value would desync AuthoringStageIndicator's fixed-order rendering. The feed/transcript still opens, which is what 'reaches the session that produced it' requires; the tray's own stage-gated mount is a secondary affordance this route does not need to reproduce."
  - "The epic-row pending-proposal count reuses --accent-text-strip (the strip-stock sibling of --accent-text-rack, the pre-existing 'agent, non-blocking informational' role used by the authoring-stage indicator and the tray's own target-type label) — never a new token, never the blocked role, satisfying both of T-05-08's own constraints in one existing pair."
  - "The count is computed client-side in BoardView.tsx from the same bounded proposals window TriageLane.tsx reads (a second useProjectProposals(projectId) subscriber to the one cached query), not from a second backend aggregate — consistent with this plan's own 'one query layer, two surfaces' discipline and avoiding a third read path for the same fact."

patterns-established:
  - "A project-scoped query hook (useProjectProposals) is read by more than one independent component at the SAME query key — the pattern any future board-level signal derived from proposal data (or similarly-shaped project-wide agent state) should follow rather than adding a bespoke aggregate command."

requirements-completed: [SHAPE-02, SHAPE-04]

coverage:
  - id: D1
    description: "authoring_proposals_pending (Tauri command) serves the board-level triage lane's own bounded, project-scoped read of query::authoring::list_pending_proposals — including the primary case (a proposal for an epic that does not exist yet) and holding the BOARD-08 1,000-item budget with the lane populated"
    requirement: SHAPE-02
    verification:
      - kind: integration
        ref: "packages/core/tests/authoring_proposal.rs (6 new tests: not-yet-existing-epic inclusion, two-project scoping, ordering stability, decided-proposal exclusion, per-status counts, 10,000,000-request clamp)"
        status: pass
      - kind: integration
        ref: "packages/core/tests/perf_seed_1000.rs#pending_proposals_lane_at_1000_items_stays_under_budget"
        status: pass
      - kind: other
        ref: "grep gate: zero JOIN epics occurrences in query/authoring.rs; authoring_proposals_pending registered exactly once in main.rs"
        status: pass
      - kind: integration
        ref: "cargo test -p core --test authoring_proposal (33/33 at Task 1), cargo build --workspace"
        status: pass
    human_judgment: false
  - id: D2
    description: "TriageLane.tsx renders pending proposals across the whole project as IssuesLane's structural sibling, reusing ProposalRow.tsx verbatim, with an epic label (or 'a new epic'), a route to the originating session, and no lane-wide decision control"
    requirement: SHAPE-04
    verification:
      - kind: unit
        ref: "packages/desktop/src/board/__tests__/triage-lane.test.tsx (9 tests: row rendering + criterion nesting, header count survives collapsing, epic label vs. 'a new epic', route to session, per-row accept/reject, no header decision control, terminal-run proposal still enabled, renders nothing with zero proposals)"
        status: pass
      - kind: integration
        ref: "npm --prefix packages/desktop run test -- src/board/__tests__/triage-lane.test.tsx src/board/__tests__/board-view.test.tsx"
        status: pass
      - kind: other
        ref: "grep gates: zero hex-colour literals in TriageLane.tsx; ProposalRow imported/rendered"
        status: pass
    human_judgment: false
  - id: D3
    description: "An epic row with pending proposals shows a count (D-82), reusing the field-epic-pill slot and the accent-text-strip/rack role pair — never the blocked role, no new token, no project-rail badge — and board_blocked_summary's result is unchanged by the presence of pending proposals"
    requirement: SHAPE-02
    verification:
      - kind: unit
        ref: "packages/desktop/src/board/BoardRow.tsx change, asserted via packages/desktop/src/board/__tests__/blocked-indicator.test.tsx and needs-decision.test.tsx (both unregressed, 25/25)"
        status: pass
      - kind: integration
        ref: "packages/core/tests/authoring_proposal.rs#pending_proposals_never_join_the_blocked_task_ids_or_the_blocked_count"
        status: pass
      - kind: other
        ref: "grep gates: blocked-text-rack|blocked-text-strip count in BoardRow.tsx stays at 2 (pre-existing usages only); rack/strip text-role count in tokens.css stays at 6 (no new token)"
        status: pass
      - kind: integration
        ref: "npm --prefix packages/desktop run test (full suite, 522/522)"
        status: pass
    human_judgment: false
  - id: D4
    description: "A session that ends while proposals are still pending leaves them pending, visible in the lane, and decidable — for all four terminal run statuses (completed/failed/interrupted/abandoned) — with accepting afterward producing the canonical row exactly as it would have during the session"
    requirement: SHAPE-02
    verification:
      - kind: integration
        ref: "packages/core/tests/authoring_proposal.rs (4 new tests: a_pending_proposal_survives_its_run_reaching_{completed,failed,interrupted,abandoned})"
        status: pass
      - kind: unit
        ref: "packages/desktop/src/board/__tests__/triage-lane.test.tsx#renders_a_proposal_belonging_to_a_terminal_run_with_its_actions_enabled"
        status: pass
      - kind: integration
        ref: "cargo test --workspace (0 failures)"
        status: pass
    human_judgment: false

duration: ~55min
completed: 2026-09-24
status: complete
---

# Phase 5 Plan 08: The Board-Level Triage Lane, the Epic-Row Count, and Proof Staging Outlives the Session Summary

**Pending authoring proposals are now visible on the board itself — a collapsible lane beside Issues that reuses the tray's own row component, an epic row's own pending-proposal count reusing an existing colour role, and Rust proof that a session which ends mid-shaping still leaves its proposals pending, listed and acceptable.**

## Performance

- **Duration:** ~55 min
- **Completed:** 2026-09-24
- **Tasks:** 3
- **Files created:** 2
- **Files modified:** 8

## Accomplishments

- **Task 1 — the lane's read, and the command that serves it.** `authoring_proposals_pending` (Tauri command, `commands/authoring.rs`) plus `ProposalWindowDto`/`ProposalStatusCountsDto` wrap plan 05-04's already-shipped-but-unconsumed `query::authoring::list_pending_proposals`, clamped through this module's own `resolve_limit` idiom and registered once in `main.rs`. `useProjectProposals` (new, `useAuthoringQuery.ts`) is the project-scoped sibling of plan 05-07's `useRunProposals`, sharing its `board:changed`-only invalidation discipline. Six new Rust tests assert the primary case (a proposal for an epic that does not exist yet still appears — the lane read joins no `epics` table), two-project scoping, read-order stability, decided-proposal exclusion, per-status counts, and the 10,000,000-request clamp; a new `perf_seed_1000.rs` test proves both the lane read and the board's own BOARD-08 budget hold at 1,000 items with the lane populated (4ms and 4ms respectively, well under the 50ms budget).
- **Task 2 — the lane itself.** `TriageLane.tsx` (new) is `IssuesLane.tsx`'s structural sibling — the same collapsible shell, header style, chevron pair and count — joined to `collapseStore.ts` (keyed `"proposals"` per project) rather than local state. It renders the SAME `ProposalRow.tsx` the tray does, grouped by `parentProposalId` exactly as `ProposalTray.tsx` groups its own list, but applied to a project-scoped window that can span several different authoring runs at once — each row therefore carries its own `proposal.agentRunId` rather than a lane-wide one. Each group names its epic (`epic.key epic.title`, or "a new epic" when `epicId` is null — D-84's fresh-epic case, the primary reason this lane exists) and offers a route to the session that produced it. `useAcceptSubtreeForProject` (new) is the lane's project-scoped sibling of `useAcceptSubtree`, since the lane cannot fix one `agentRunId` at hook-construction time the way the run-scoped tray can. The lane header carries only a count and a collapse toggle — no accept/reject/amend/decision control anywhere in it, holding plan 05-06's accept-all source gate. Nine new tests cover row rendering, criterion nesting, header-count-survives-collapsing, the epic label (both cases), the session route, per-row accept/reject, the no-decision-control header, and rendering nothing at all with zero pending proposals.
- **Task 3 — the epic-row count, and the property this whole plan exists for.** `BoardRow.tsx` gains `pendingProposalCount`, rendered ONLY on an epic's own row, in the `field-epic-pill` slot a task row uses but an epic row never does — a structural placement that keeps it from ever competing with the Blocked/Needs Decision pills near the status glyph for the same row space. It reuses `--accent-text-strip` (the strip-stock sibling of `--accent-text-rack`, already this product's "agent, non-blocking informational" role) — no new token, never the blocked role. `BoardView.tsx` derives the per-epic count client-side from the SAME `useProjectProposals(projectId)` read `TriageLane.tsx` already subscribes to (a second subscriber to one cached query, never a second network read). Four new Rust tests drive a run through each of the four terminal statuses in turn (`close_agent_run` for completed/failed, `interrupt_agent_run` for interrupted, `mark_abandoned` for abandoned) and assert the staged proposal is still pending, still in the lane read, and still acceptable — producing the canonical row exactly as it would have mid-session. A fifth Rust test proves pending proposals never join `blocked_task_ids_for_project`/`blocked_count_for_project` (D-46: only money burning blocks). The React-side companion proves a proposal from a terminal run renders identically to one from a live run, with accept/reject enabled — the lane's own read is scoped by proposal status, never run status, so the two are structurally indistinguishable on the wire.

## Task Commits

Each task was committed atomically:

1. **Task 1: The lane's read, and the command that serves it** - `24991e6` (feat)
2. **Task 2: The lane itself — the sibling of the issues lane** - `8e47e6c` (feat)
3. **Task 3: The epic-row count, and proof that an abandoned session leaves work behind** - `883348f` (feat)

**Plan metadata:** see below.

## Files Created/Modified

- `packages/desktop/src/board/TriageLane.tsx` (new) — the board-level triage lane
- `packages/desktop/src/board/__tests__/triage-lane.test.tsx` (new) — 9 tests covering the lane
- `packages/desktop/src-tauri/src/commands/authoring.rs` — `authoring_proposals_pending`, `ProposalWindowDto`, `ProposalStatusCountsDto`, `ProposalCursorInput`
- `packages/desktop/src-tauri/src/main.rs` — the new command registered
- `packages/desktop/src/adapters/tauri.ts` — `authoringProposalsPending`, `ProposalWindowDto`, `ProposalStatusCountsDto`, `ProposalCursorInput`
- `packages/desktop/src/authoring/useAuthoringQuery.ts` — `useProjectProposals`, `useAcceptSubtreeForProject`, `projectProposalsQueryKey`, plus a corrected module doc comment
- `packages/desktop/src/board/BoardRow.tsx` — `pendingProposalCount` prop and its badge
- `packages/desktop/src/board/BoardView.tsx` — mounts `TriageLane`, derives `pendingProposalCountByEpicId`
- `packages/core/tests/authoring_proposal.rs` — 11 new tests across all three tasks
- `packages/core/tests/perf_seed_1000.rs` — the populated-lane volume case

## Decisions Made

See `key-decisions` in frontmatter.

## Deviations from Plan

None — plan executed exactly as written. Three implementation refinements were made strictly to satisfy the plan's own acceptance criteria without changing behaviour outside what the plan specifies (documented as key-decisions, not deviations):

- `useAcceptSubtreeForProject` added as a new hook (rather than reusing `useAcceptSubtree`) because the lane's project-wide invalidation scope is genuinely different from any single run's query key, and the lane can span several runs at once.
- The session route passes `authoringStage: null` rather than a fabricated stage value, since `ProposalDto` carries no `authoring_stage` field and a wrong value would desync the stage indicator's fixed-order rendering.
- A stale module doc comment in `useAuthoringQuery.ts` (referencing a since-superseded design where the lane would read `useRunProposals`) was corrected in place while adding `useProjectProposals`.

One deviation was caught and fixed within Task 3 before it reached a commit: a doc comment in `BoardRow.tsx` originally quoted the literal token name `--blocked-text-strip` in prose explaining what the new badge does NOT reuse — which tripped the plan's own literal-count `<verify>` gate (`grep -c 'blocked-text-rack\|blocked-text-strip'` expecting exactly `2`, the two pre-existing pill usages). Reworded to describe the same fact without the literal substring; verified the gate returns `2` again before committing.

## Issues Encountered

None beyond the deviations above. One pre-existing, unrelated test flake was observed and confirmed not a regression: `proposal-keyboard.test.tsx`'s "each of the four keys dispatches its action on the focused (selected) row" failed once when run as part of the full 36-file suite (a `flushSync`-during-render React warning, consistent with this phase's own documented pattern of transient full-suite timing flakiness — 05-02-SUMMARY.md, WINDOWS.md entries #8-#12) and passed both in isolation and on an immediate full-suite re-run (522/522). No file this plan touches is imported by that test.

## User Setup Required

None — no external service configuration required.

## Next Phase Readiness

- The triage lane, its row component, its query layer, and the route to the originating session all exist — Phase 6's own triage surface is positioned to extend this lane rather than reinvent it, per `ROADMAP.md`'s Phase 5 Notes and this plan's own objective.
- `SHAPE-02`/`SHAPE-04` are this plan's own declared requirements but are NOT yet marked complete: the shared-ID gate (`requirements.ready-ids`) reports `0/2 requirement(s) ready to mark complete` — both are ALSO declared by plan `05-10` (the phase's last remaining plan, still in progress). They will flip to `Complete` automatically once `05-10` finishes and produces its own `*-SUMMARY.md`.
- Deliberately out of scope, per `05-CONTEXT.md`'s own Discretion item: a project-rail count for pending proposals — the rail's "needs-you" count question was resolved (or deliberately deferred further) by plan `05-09`, not pre-empted here.
- Plan `05-10` is this phase's last remaining plan and is next.

---
*Phase: 05-socratic-epic-authoring*
*Completed: 2026-09-24*

## Self-Check: PASSED

- Both created files found on disk (`TriageLane.tsx`, `triage-lane.test.tsx`).
- All 3 task commit hashes (`24991e6`, `8e47e6c`, `883348f`) found in git history.
- `npm --prefix packages/desktop run build` succeeds.
- `npm --prefix packages/desktop run test` — 522/522 pass across 36 files (full re-run after the one transient full-suite flake noted above), including `triage-lane.test.tsx` 9/9, `board-view.test.tsx` 4/4, `blocked-indicator.test.tsx`/`needs-decision.test.tsx` 25/25.
- `cargo build --workspace` succeeds (only the one pre-existing, unrelated `StartRunOutcome` dead-code warning).
- `cargo test --workspace` — 0 failures across every crate, including `authoring_proposal` 38/38 and `perf_seed_1000` 3/3.
- Named grep gates: `authoring_proposals_pending` registered exactly once in `main.rs`; zero `JOIN epics` occurrences in `query/authoring.rs`; zero hex-colour literals and `ProposalRow` present in `TriageLane.tsx`; `blocked-text-rack`/`blocked-text-strip` count in `BoardRow.tsx` stays at `2`; rack/strip text-role count in `tokens.css` stays at `6` — all return their expected values.
- `commits: 3` measured via `git rev-list --count 6ea39730aca930aa09f48e9584e5b0c517bc0dfc..HEAD` (matches `plan_head_before` in frontmatter).
