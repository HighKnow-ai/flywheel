---
phase: 06-agents-file-their-own-backlog
plan: 08
subsystem: authoring
tags: [react, zustand, tanstack-query, triage, session-surface]

# Dependency graph
requires:
  - phase: 06-agents-file-their-own-backlog (plan 06-07)
    provides: "TriageSurface.tsx (the dedicated project-scoped triage view), the triage-surface keyboard region, and the WINDOWS.md unrun-verify entry (#20) recording that it was not yet reachable from a running app"
  - phase: 06-agents-file-their-own-backlog (plan 06-06)
    provides: "The six triage hooks and the widened AuthoringProposalDto (rationale/originLogOffset) this plan's turn-pointer jump reads"
provides:
  - "state/uiStore.ts: triageSurfaceProjectId/setTriageSurfaceProjectId (the App-level mount trigger for TriageSurface) and activeAgentRunInitialLogOffset (carried alongside setActiveAgentRunId's existing fields)"
  - "App.tsx: TriageSurface mounted once, gated on the store field, wired to the board's epic roster and to the same setActiveAgentRunId path the launch sheet already uses"
  - "board/TriageLane.tsx: one route control in the header ('Open the dedicated triage view'), no lane-wide decision added"
  - "session/SessionSurface.tsx: an optional initialFeedOffset prop, threaded into useSessionFeed's initial page and suppressing follow-the-tail for that surface's lifetime; ProposalTray's mount condition broadened to any run (authoring or execution) with at least one staged proposal"
  - "board/useBoardQuery.ts: useSessionFeed accepts an optional initialOffset, resolving its first page there instead of the tail when supplied"
  - "packages/desktop/src/triage/__tests__/triage-routing.test.tsx: 7 component tests"
affects: [06-09]

actuals:
  tokens: 8962
  tasks: 3
  commits: 3

plan_head_before: abf4147a182a7dc183244429f85c6565c82168a3

tech-stack:
  added: []
  patterns:
    - "A cross-tree App-level surface trigger is a single uiStore field plus its setter (triageSurfaceProjectId/setTriageSurfaceProjectId), matching the exact shape activeAgentRunId/launchSheetTaskId/settingsOpen already use — no new context, no prop-drilled callback through BoardView's tree."
    - "A board-tree control that writes an App-level store field directly calls useUiStore.getState().setXxx(...) inside its onClick rather than subscribing via the useUiStore(selector) hook, when the component itself never needs to READ that field — avoids a needless re-render subscription for a write-only control (board/TriageLane.tsx's route button)."
    - "A live proposal-tray mount condition is broadened by deriving the new clause from the SAME run-scoped query the mounted child already reads through (useRunProposals), never a second fetch shape or a run-kind flag — and that second query subscription is explicitly disabled (passed null) whenever the OR's other clause already guarantees the mount, so no redundant concurrent subscriber to the same query key is created where the child component will open its own anyway."

key-files:
  created:
    - packages/desktop/src/triage/__tests__/triage-routing.test.tsx
  modified:
    - packages/desktop/src/state/uiStore.ts
    - packages/desktop/src/App.tsx
    - packages/desktop/src/board/TriageLane.tsx
    - packages/desktop/src/session/SessionSurface.tsx
    - packages/desktop/src/board/useBoardQuery.ts

key-decisions:
  - "Answered 06-CONTEXT.md's last open discretion item: an executing agent's session surface DOES gain a live proposal tray, not just the board lane's count. Confirmed 06-07's own recorded rationale — ProposalTray already queries by agentRunId alone with no run-kind dependency, so this is a mount-condition change, never a new component."
  - "TriageLane's route control calls useUiStore.getState().setTriageSurfaceProjectId(...) directly rather than through a subscribed selector + local const, matching Task 1's own literal <verify> gate (grep -c 'setTriageSurfaceProjectId' TriageLane.tsx == 1) and avoiding a read-subscription the component has no other use for."
  - "[Rule 1 - Bug] The second useRunProposals(agentRunId) subscriber this task's own instruction called for (\"derived from the tray's own data source\") reproducibly disrupted authoring/__tests__/proposal-keyboard.test.tsx's per-row keyboard dispatch when left unconditional for every run — an extra render cycle raced useRegionBindings' per-render effect cleanup/re-add churn. Fixed by disabling that query (passing null) whenever authoringStage is already set, since the OR's first clause covers that case and the tray's own identical subscription is the only reader needed there. Confirmed the flake is otherwise absent (unconditional query removed) and confirmed a DIFFERENT, PRE-EXISTING flake in the same test file exists on the unmodified baseline too (see Deviations)."
  - "useSessionFeed gained a second parameter (initialOffset) not listed in this plan's own files_modified — required so 'the feed opens positioned at the recorded log offset' (a must_haves truth) is a real behaviour, not merely an accepted-and-dropped prop. See Deviations."

patterns-established: []

requirements-completed: [PROP-06, PROP-07]  # Both also declared by sibling plan 06-09, still in flight (no *-SUMMARY.md yet) — the shared-ID gate (#2388) holds them open in REQUIREMENTS.md until 06-09 finishes, even though this plan's own coverage below is complete.

coverage:
  - id: D1
    description: "The board's triage lane header gained one route control into the dedicated triage surface; activating it sets the store's triage project id and no lane-wide decision was added"
    requirement: PROP-06
    verification:
      - kind: unit
        ref: "packages/desktop/src/triage/__tests__/triage-routing.test.tsx#activating the lane's route control sets the store's triage project id"
        status: pass
      - kind: integration
        ref: "cargo test -p core --test authoring_proposal (42/42, the Phase-5 accept-all source gate re-run against the lane change)"
        status: pass
    human_judgment: false
  - id: D2
    description: "The triage surface is mounted once at the App level, rendering only while the store's triage project id is set, and closing it clears the field and restores the board"
    requirement: PROP-06
    verification:
      - kind: unit
        ref: "packages/desktop/src/triage/__tests__/triage-routing.test.tsx#the triage surface renders only while the store's triage project id is set, #closing the surface clears the store field and the board is interactive again"
        status: pass
    human_judgment: false
  - id: D3
    description: "A row's turn-pointer jump opens the run's session through the real App-level onOpenSession wiring, at the recorded log offset, including offset zero"
    requirement: PROP-07
    verification:
      - kind: unit
        ref: "packages/desktop/src/triage/__tests__/triage-routing.test.tsx#activating a row's turn-pointer control opens the run's session at the recorded offset, including zero"
        status: pass
    human_judgment: true
    rationale: "The store-state assertions prove the wiring (agentRunId/epicId/offset all land correctly, and offset 0 is not coerced to 'no offset'). Whether the session feed's own INITIAL SCROLL POSITION visibly lands the developer at that turn in a real running app is a rendering/visual outcome no automated test in this plan asserts — SessionSurface.tsx suppresses follow-the-tail when initialFeedOffset is set, but no test renders enough of the feed to see where it visually lands. A human or 06-09's UAT harness should confirm this visually."
  - id: D4
    description: "An ordinary task-execution run's session surface shows its own live proposal tray as soon as it has staged a proposal, and an authoring run renders exactly as before"
    requirement: PROP-07
    verification:
      - kind: unit
        ref: "packages/desktop/src/triage/__tests__/triage-routing.test.tsx#renders when the run has no authoring stage but has staged a proposal, #does not render when the run has no authoring stage and no staged proposals, #an authoring run renders the tray exactly as it did before this plan"
        status: pass
      - kind: integration
        ref: "npm --prefix packages/desktop test (570/570, including authoring/__tests__/proposal-tray.test.tsx and proposal-keyboard.test.tsx unchanged)"
        status: pass
    human_judgment: false

duration: 38min
completed: 2026-09-30
status: complete
---

# Phase 6 Plan 8: Route Into the Triage Surface Summary

**Wires `TriageSurface` into the running app through a single `uiStore` trigger, adds a turn-pointer log offset that threads into `useSessionFeed`, and broadens `ProposalTray`'s mount condition so an execution run shows its own live tray.**

## Performance

- **Duration:** ~38 min
- **Started:** 2026-09-30T09:14:00Z (approx., following 06-07's completion)
- **Completed:** 2026-09-30T09:52:00Z (approx.)
- **Tasks:** 3
- **Files modified:** 6 (1 created, 5 modified)

## Accomplishments
- `state/uiStore.ts` gained `triageSurfaceProjectId`/`setTriageSurfaceProjectId` (the App-level mount trigger) and `activeAgentRunInitialLogOffset` (a 5th, optional parameter on `setActiveAgentRunId`, defaulting to `null` for every pre-existing call site).
- `App.tsx` mounts `TriageSurface` exactly once, ahead of the session surface in the render priority, reading the project's epic roster the same way `BoardView.tsx` does (`useEpics`) since `AppShell` had no other source for it.
- `board/TriageLane.tsx`'s header gained one route control ("Open the dedicated triage view") beside the existing count and collapse control — no lane-wide decision, no accept-all identifier, header comment extended to record D-103's reasoning.
- `session/SessionSurface.tsx` accepts an optional `initialFeedOffset`, threaded into `useSessionFeed`'s initial page (`board/useBoardQuery.ts` gained a matching optional parameter) and suppressing the follow-the-tail scroll for the surface's whole lifetime when set — every pre-existing caller passes none, so behaviour there is unchanged.
- `session/SessionSurface.tsx`'s `ProposalTray` mount condition is broadened from "authoring stage present" to "authoring stage present OR this run has staged at least one proposal" — derived from `useRunProposals`, the same query `ProposalTray.tsx` itself reads through; `ProposalTray.tsx` is untouched.
- 7 new component tests in `triage/__tests__/triage-routing.test.tsx`; all 4 plan-level `<verification>` commands re-run and green: `npm --prefix packages/desktop test -- triage-routing` (7/7), full `npm test` (570/570 across 40 files), `npm run build` (clean), `cargo test -p core --test authoring_proposal` (42/42). Also re-ran `cargo test --workspace` (all green) and `npm --prefix packages/sidecar test` (215/215) per this plan's own stated baselines.

## Task Commits

Each task was committed atomically:

1. **Task 1: The store trigger, the App-level mount, and the lane's route in** — `1df3d5a` (feat)
2. **Task 2: An execution run's own live proposal tray** — `bd82542` (feat)
3. **Task 3: Routing and tray-condition tests** — `61f8c04` (test)

**Plan metadata:** commit follows this SUMMARY

_TDD note: Task 3 carries `tdd="true"`, but Tasks 1-2 (both `type="auto"`) in this same plan already shipped the complete implementation before this test file existed — mirrors 06-07's own documented precedent exactly (implementation task then test task, by this plan's own structure). All 7 tests passed on their first run (no RED). See "TDD Gate Compliance" below._

## Files Created/Modified
- `packages/desktop/src/state/uiStore.ts` — `triageSurfaceProjectId`/`setTriageSurfaceProjectId`, `activeAgentRunInitialLogOffset` threaded through `setActiveAgentRunId`, both added to `resetUiState`
- `packages/desktop/src/App.tsx` — `TriageSurface` mount (gated on the store field, ahead of the session surface), the epic roster read it needs, `initialFeedOffset` threaded to `SessionSurface`
- `packages/desktop/src/board/TriageLane.tsx` — header restructured into a toggle zone + one sibling route button, header comment extended
- `packages/desktop/src/session/SessionSurface.tsx` — `initialFeedOffset` prop, `useSessionFeed` call updated, follow-the-tail effect gated, `ProposalTray` mount condition broadened, `useRunProposals` import
- `packages/desktop/src/board/useBoardQuery.ts` — `useSessionFeed`'s new optional `initialOffset` parameter, threaded into `initialPageParam`
- `packages/desktop/src/triage/__tests__/triage-routing.test.tsx` — new: 7 component tests

## Decisions Made

See `key-decisions` in the frontmatter for full rationale. Summary:

1. **The execution-run live tray discretion item is answered yes** (already recorded by 06-07; this plan implements it).
2. **`TriageLane`'s route control writes the store directly via `useUiStore.getState()`**, not a subscribed selector, matching the plan's own literal single-occurrence `<verify>` gate and avoiding an unneeded read-subscription.
3. **The second `useRunProposals` subscriber is disabled for authoring runs** (Rule 1 fix; see Deviations) — needed only for the one case it decides anything for.
4. **`useSessionFeed` gained a second parameter** (Rule 1 fix; see Deviations) — otherwise "positioned at the recorded offset" would be an accepted-and-dropped prop, not real behaviour.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 1 - Bug] A second, unconditional `useRunProposals` subscriber disrupted an existing keyboard test**
- **Found during:** Task 2, running the full desktop suite after adding `useRunProposals(agentRunId)` unconditionally in `SessionSurface.tsx` to derive the tray's execution-run mount clause
- **Issue:** With a second live subscriber to the exact same query key `ProposalTray.tsx` itself already opens (for an authoring run), an extra render cycle intermittently raced `useRegionBindings`' per-render effect cleanup/re-add churn (`state/keyboard.ts`), dropping the very first `e`/`d` keydown in `authoring/__tests__/proposal-keyboard.test.tsx`'s "j moves the tray's selection" test. Reproduced reliably (5/5 runs failed with the query enabled unconditionally; 5/5 passed with it removed).
- **Fix:** `useRunProposals(authoringStage ? null : agentRunId)` — disabled whenever `authoringStage` is set, since the OR's first clause (`authoringStage || hasStagedProposals`) already guarantees the mount in that case and the tray's own subscription is the only reader that case needs. The second subscriber now exists ONLY for the one case it actually decides anything for (an execution run).
- **Files modified:** `packages/desktop/src/session/SessionSurface.tsx`
- **Verification:** `npm --prefix packages/desktop test -- proposal-keyboard proposal-tray` (25/25) and the full suite (570/570), each re-run 2x with no failures after the fix. Also confirmed, on the UNMODIFIED baseline (this plan's changes fully reverted via `git checkout --`), that a DIFFERENT, unrelated test in the same file ("each of the four keys dispatches its action on the focused (selected) row") is intermittently flaky (2/4 baseline runs failed) — a PRE-EXISTING flake, out of this plan's scope, not chased or fixed here.
- **Committed in:** `bd82542` (Task 2's own commit)

**2. [Rule 1 - Bug] `useSessionFeed` needed a second parameter for the offset to be real, not just accepted**
- **Found during:** Task 1, implementing `SessionSurface.tsx`'s `initialFeedOffset` prop per this plan's own instruction ("If the session surface has no parameter for an initial feed offset, add one... and thread it from this call")
- **Issue:** `useSessionFeed(agentRunId)` always resolved its first page at `"tail"`; threading `initialFeedOffset` only as far as a prop with nowhere real to land would satisfy the letter of the instruction while leaving the plan's own `must_haves` truth ("the feed opens positioned at the recorded log offset") false.
- **Fix:** `useSessionFeed(agentRunId, initialOffset?: number | null)` resolves its first page at `initialOffset ?? "tail"` — the exact same `fetchSessionFeedPage` codepath every older page already uses, never a second fetch shape. The follow-the-tail effect is additionally suppressed for the surface's whole lifetime when `initialFeedOffset` is set (a developer who just jumped to a turn should not be snapped back to the tail the instant the page loads).
- **Files modified:** `packages/desktop/src/board/useBoardQuery.ts`, `packages/desktop/src/session/SessionSurface.tsx`
- **Verification:** `npm run build` clean; full desktop suite green (570/570); `packages/desktop/src/board/useBoardQuery.ts` not in this plan's own `files_modified` list — documented here as required, not silently expanded scope (Rule 1: the change is narrowly the offset-resolution codepath, no other behaviour of `useSessionFeed` touched).
- **Committed in:** `1df3d5a` (Task 1's own commit)

---

**Total deviations:** 2 auto-fixed (both Rule 1 — bugs found and fixed during implementation, neither a scope expansion beyond making this plan's own stated truths real). **Impact:** Both necessary for correctness; no scope creep beyond the two touched codepaths.

## Issues Encountered
- A pre-existing, order/timing-sensitive flake in `authoring/__tests__/proposal-keyboard.test.tsx` ("each of the four keys dispatches its action on the focused (selected) row") reproduces intermittently on the unmodified baseline (before any of this plan's changes) when the full desktop suite runs — confirmed via `git checkout --` to HEAD and 4 repeated full-suite runs (2/4 failed). Out of this plan's scope (not touched by this plan's diff); not fixed here. Flagged for a future plan or a dedicated flake-hunting pass.

## TDD Gate Compliance

Task 3 carries `tdd="true"`. The canonical RED-then-GREEN commit sequence did not occur, because Tasks 1-2 (both prior, non-TDD `type="auto"` tasks within this same plan) had already shipped the complete implementation before this test file was written — mirrors 06-07's own documented precedent for the identical task-split shape (implementation tasks first, tests last). Running the freshly-written 7-test suite against that already-correct implementation produced 7/7 passing on the FIRST run — a genuine, unforced GREEN, not a contrived or skipped RED. `gsd_run check tdd-red-evidence` was not invoked, since there was no RED run to evidence.

**Commit sequence:** `feat(06-08)` (Task 1) → `feat(06-08)` (Task 2) → `test(06-08)` (Task 3) — test follows both feat commits rather than preceding one, the same honestly-recorded ordering 06-07-SUMMARY.md documents.

## Authentication Gates
None.

## User Setup Required
None - no external service configuration required.

## Known Stubs

None.

## Broken Windows Ledger

- **Entry #20 (06-07's own `unrun-verify`, "TriageSurface not yet mounted from any route/entry point") is now CLOSED (`gsd_run windows fixed 20`).** The specific blocker it named — no mount point existed — is resolved: `TriageSurface` is reachable from the board's triage lane, mounted once at the App level, and the whole routing path is proven at the component level (`triage-routing.test.tsx`, 7/7).
- **A new entry (#21, `unrun-verify`) was appended, not silently dropped:** the underlying live-app visual check from 06-07 Task 3's own `<human-check>` (launch the packaged app, open the surface, confirm the four verbs are reachable/legible) still has not been run against a real running app in this session — it now has a real route to exercise, and is deferred to plan 06-09's scripted UAT harness (`scripts/uat/uat-10-agent-backlog.mjs`), consistent with entry #19's own precedent for this phase.

## Next Phase Readiness
- The board's route into `TriageSurface`, the App-level mount, the turn-pointer jump (including offset zero), and the execution-run tray are all implemented, tested at the component level, and wired into real store state — ready for 06-09's own scripted UAT harness to exercise end-to-end against a running app.
- **Shared-ID note:** PROP-06/PROP-07 are also declared by sibling plan 06-09, still in flight (no `*-SUMMARY.md` yet) — the shared-ID gate (#2388) holds them open in `REQUIREMENTS.md` until 06-09 finishes, even though this plan's own coverage above is complete.
- **One human-judgment item genuinely open:** D3's rationale above — the session feed's own visual scroll position when opened via the turn-pointer jump is implemented (follow-the-tail suppressed, first page resolved at the given offset) but not visually confirmed by any automated test in this plan; a good candidate for 06-09's UAT harness or a direct manual check.

---
*Phase: 06-agents-file-their-own-backlog*
*Completed: 2026-09-30*

## Self-Check: PASSED

- FOUND: packages/desktop/src/state/uiStore.ts (triageSurfaceProjectId/setTriageSurfaceProjectId/activeAgentRunInitialLogOffset)
- FOUND: packages/desktop/src/App.tsx (TriageSurface mount)
- FOUND: packages/desktop/src/board/TriageLane.tsx (route control)
- FOUND: packages/desktop/src/session/SessionSurface.tsx (initialFeedOffset, broadened tray condition)
- FOUND: packages/desktop/src/board/useBoardQuery.ts (useSessionFeed initialOffset)
- FOUND: packages/desktop/src/triage/__tests__/triage-routing.test.tsx
- FOUND: 1df3d5a (Task 1 commit)
- FOUND: bd82542 (Task 2 commit)
- FOUND: 61f8c04 (Task 3 commit)
- npm --prefix packages/desktop test -- triage-routing: 7/7 pass
- npm --prefix packages/desktop test -- proposal-keyboard proposal-tray triage-lane board-view: 38/38 pass
- npm --prefix packages/desktop test: 570/570 pass across 40 files
- npm --prefix packages/desktop run build: clean, tsc typechecks
- cargo test -p core --test authoring_proposal: 42/42 pass
- cargo test --workspace: all green
- npm --prefix packages/sidecar test: 215/215 pass
- All plan-level `<verification>` commands re-run and confirmed passing
