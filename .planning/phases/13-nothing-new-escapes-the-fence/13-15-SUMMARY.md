---
phase: 13-nothing-new-escapes-the-fence
plan: 15
subsystem: desktop-renderer
tags: [react-query, board-changed, fnc-07, gap-closure, routing, source-gate]

requires:
  - phase: 13-10
    provides: the typed board:changed payload {projectId, entity, id} and the central routed subscription
provides:
  - useBoardChangedInvalidation / BoardChangedScope - the one routing decision for board:changed (project | viewed | account)
  - every keyed reader (28 sites) routed on payload.projectId instead of refetching on every event
  - board-changed-adoption gate - exactly three production files may call subscribeBoardChanged
  - useDispatchCap account-wide subscription (the 13-10 regression closed)
  - board_entity_for - the accept event carries the materialised entity, not a hard-coded "task"
affects: [phase-13-verification, relay-milestone]

status: complete
plan_head_before: d5a606552e26882eacaa6084f8a25d4d41956c68
actuals:
  tokens: 14300
  tasks: 3
  commits: 3

tech-stack:
  added: []
  patterns:
    - "One hook owns subscribe + cancelled/unlisten bookkeeping + the routing decision; call sites name their scope"
    - "Fail open on an unroutable event: a stale board is worse than an over-broad refresh"
    - "Adoption gate with a planted-violation half, reading the tree through import.meta.glob (no node typings)"

key-files:
  created:
    - packages/desktop/src/board/useBoardChangedInvalidation.ts
    - packages/desktop/src/board/__tests__/board-changed-adoption.test.tsx
  modified:
    - packages/desktop/src/board/useBoardQuery.ts
    - packages/desktop/src/review/useReviewQuery.ts
    - packages/desktop/src/authoring/useAuthoringQuery.ts
    - packages/desktop/src/item-detail/ActivityTrail.tsx
    - packages/desktop/src/settings/PermissionRulesTable.tsx
    - packages/desktop/src/dispatch/queries.ts
    - packages/desktop/src/fleet/useFleet.ts
    - packages/desktop/src/board/__tests__/board-changed-routing.test.tsx
    - packages/desktop/src/board/__tests__/epic-roster.test.tsx
    - packages/desktop/src/dispatch/__tests__/ (five files)
    - packages/desktop/src-tauri/src/commands/authoring.rs

key-decisions:
  - "Three scope kinds (project / viewed / account) so every call site names its routing decision"
  - "useFleet keeps the one raw subscribeBoardChanged outside the hook: module-level reference-counted, account-wide keys"
  - "GATE_KEY left alone: it already has its own dispatch:gate_changed event; only CAP_KEY gained a subscription"

requirements-completed: [FNC-07]

duration: 8 min
completed: 2026-10-15
---

# Phase 13 Plan 15: Route board:changed at every keyed reader Summary

**One shared `useBoardChangedInvalidation` hook now owns the board:changed routing decision for all 28 keyed readers, a gate keeps it at three callers, the dispatch cap refreshes again, and the accept event names the entity it materialised.**

## Accomplishments

- `useBoardChangedInvalidation(scope, keys, {debounceMs, unroutableKeys})` owns the effect, the `cancelled`/`unlisten` race guard and the routing. An event for a foreign project invalidates nothing; `projectId: null`, missing or malformed payloads fail open; empty `keys` or an `undefined` project id register no listener; a `viewed` scope with no project selected fails open; no coalescing unless `debounceMs` is set.
- `useChangeFlags` (the git-spawning reader) keeps its 1000 ms one-per-window coalescing, and a foreign-project event now causes zero invalidations and zero `boardChangeFlags` calls (asserted on the adapter mock).
- 28 subscribers adopt it. The `subscribeBoardChanged(` call now lives in exactly `adapters/tauri.ts`, `board/useBoardChangedInvalidation.ts`, `fleet/useFleet.ts`.
- `board-changed-adoption.test.tsx` fails the build on a fourth caller (planted both directions in one test).
- `useDispatchCap` subscribes with `{kind: "account"}` over `CAP_KEY`.
- `authoring_proposal_accept` and `authoring_subtree_accept` derive the event entity via `board_entity_for(target_type)`.

## Per-site scope decisions applied

| Scope | Sites |
|---|---|
| central (project, with `unroutableKeys` = bare `["board"]`/`["epics"]`) | `useBoardChangedSubscription` |
| `project` | `useForgeFlags`, `useChangeFlags` (debounced), `useBlockedSummary`, `useRecoverySummary`, `useScopeFlags`, `useEpicProgress`, `useProjectProposals`, `useDeferredProposals`, `useProposalLimitNotices` |
| `viewed` | `usePendingPermissionRequests`, `useLatestAgentRunId`, `useAgentRuns`, `useTaskSessionSummaries`, `useWorktreeSummary`, `useGitFacts`, `useForgeRequest`, `useRunProposals`, the eight review hooks (`useReviewFiles`, `useReviewPatch`, `useReviewCriteriaState`, `useMergePrecheck`, `useChangesRequest`, `useEpicRequestDraft`, `useEpicTaskRollup`, `useEpicRequest`), `ActivityTrail` |
| `account` | `PermissionRulesTable`, `useDispatchCap` |
| raw (allow-listed) | `fleet/useFleet.ts` `startInvalidation` (reference-counted, three account-wide keys) |

## Planted-direction confirmations

- Hook mismatch branch changed from `return` to an unconditional invalidate: 5 tests failed, e.g. `an event for a different project invalidates nothing at all` -> `expected "invalidateQueries" to be called +0 times, but got 3 times`, and the foreign-project and strict-prefix `useChangeFlags` cases -> `... +0 times, but got 1 times`. Restored; 19/19 pass.
- `subscribeBoardChanged(() => {});` appended to `board/BoardView.tsx`: `only the three allow-listed files call it` failed with `+   "board/BoardView.tsx"` as the offender. Removed; 5/5 pass.
- The fallback arm comment in `board_entity_for`: "The historical default, NOT a correct answer: a target type added after this match was written lands here and is labelled "task" until it gets its own arm above."

## Verification

- `board-changed-routing`: 19 tests (8 original untouched, 11 new); diff is insertions only.
- Full renderer suite: 92 files / 1506 passed, 2 expected fail, exit 0. The 13-10 baseline recorded no failing files; none failing now.
- `tsc --noEmit`: only the two pre-existing `TS2305` errors in `brand-rule.test.ts`. `tsc -p tsconfig.browser-tests.json` clean.
- `cargo test -p desktop --test board_changed_payload`: 3 passed. `cargo test -p desktop --bin desktop board_entity`: 2 passed. `cargo check -p desktop`: clean (one pre-existing dead-field warning in `agent_run.rs`).
- `cargo test -p core --test pm_vocabulary_gate`: 5 passed.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 3 - Blocking] epic-roster test mounted the central hook with no project id**
- **Found during:** Task 2 (full-suite run)
- **Issue:** `epic-roster.test.tsx`'s `Subscriber` called `useBoardChangedSubscription()` with `undefined`; the plan's "undefined project registers no listener" rule makes that a no-op, so three liveness tests lost their push. Production (`App.tsx`) always passes a string.
- **Fix:** the test now passes `"proj-1"`. The file is outside the plan's `files_modified`.
- **Files modified:** `packages/desktop/src/board/__tests__/epic-roster.test.tsx`
- **Commit:** b324b78

**2. [Rule 3 - Blocking] adoption gate could not use node imports**
- **Found during:** Task 2 (tsc)
- **Issue:** the project has no `@types/node`, so `node:fs`/`__dirname` in the gate added tsc errors beyond the two pre-existing ones.
- **Fix:** the gate reads the tree through `import.meta.glob` (`?raw`, eager, negative pattern for tests), as `brand-rule.test.ts` already does. The call is spelled `"subscribeBoardChanged" + "("` so the test file is not itself a caller.
- **Commit:** b324b78

**3. [Rule 3 - Blocking] subtree accept had no root target_type on its outcome**
- **Found during:** Task 3
- **Issue:** `AcceptSubtreeOutcome` carries only `root_materialised_id`.
- **Fix:** the command's existing `SELECT agent_run_id` now also selects `target_type` (same row, same query).
- **Commit:** 95e01d3

**Plan-grep note:** acceptance check `grep -A4 'emit_board_changed(&app, project_id.as_deref()' | grep -c board_entity_for` expects a single-line call; the calls are multi-line (rustfmt style), so that literal grep matches nothing. Both accept paths call `board_entity_for` and `grep ... | grep -c '"task"'` prints 0.

**Total deviations:** 3 auto-fixed (3 Rule 3). **Impact:** none on behaviour or scope.

## Known Stubs

None.

## Threat Flags

None. The change narrows which readers wake; it adds no endpoint, auth path or schema.

## Issues Encountered

None. `deferred-items.md` updated: both 13-07 bullets (per-hook subscribers, dispatch cap) marked resolved.

## Self-Check: PASSED

