---
phase: 13-nothing-new-escapes-the-fence
plan: 08
subsystem: ui
tags: [react, typescript, keyboard-layers, exhaustive-switch, vitest]

requires:
  - phase: 13-nothing-new-escapes-the-fence
    provides: "13-07 deleted StatusPicker/DoneWarning, so the surface chain in App.tsx was already free of status surfaces"
provides:
  - "keyboard::UiSurface union, SurfaceState, activeSurface resolver and SURFACE_LAYERS registry beside topLayer"
  - "App.tsx content area rendered from one exhaustive switch over activeSurface"
  - "A pinned precedence order (13 resolver cases + 3 App-level cases) that Phase 14-18 surfaces (Cycle, PRD, ADR) must register into"
affects: [phase-14, phase-16, phase-17, phase-18]

actuals:
  tokens: 11000
  tasks: 2
  commits: 4  # MEASURED rev-list b1b2aff..HEAD; 3 are this plan's, 1 (db2ae9b, docs(13)) is a foreign commit that landed mid-run

tech-stack:
  added: []
  patterns:
    - "Which surface is showing is one flat union resolved by precedence inside the keyboard layer model; a surface outside the model is a TypeScript error (Record<UiSurface, ...> + never-typed default)"

key-files:
  created:
    - packages/desktop/src/state/__tests__/surface-union.test.ts
  modified:
    - packages/desktop/src/state/keyboard.ts
    - packages/desktop/src/App.tsx
    - packages/desktop/src/board/__tests__/layer-guard.test.tsx
    - packages/desktop/src/fleet/__tests__/fleet-surface.test.tsx
    - packages/desktop/src/fleet/__tests__/jump.test.tsx

key-decisions:
  - "Flat union resolved by precedence, not a surface stack with history (the flagged FNC-06 assumption) - closing a surface returns to whatever the remaining state resolves to, exactly as the ternary did"
  - "String store ids (triage project id, session run id) map to booleans by truthiness, not !== null, so an empty-string id behaves exactly as the old ternary did"
  - "No surfaceStateFromStore helper added to uiStore.ts - App.tsx is the only caller, so the mapping stays inline (plan's stated preference)"

patterns-established:
  - "Precedence comments live on the activeSurface arm they explain; App.tsx arms carry only the render"

requirements-completed: [FNC-06]

coverage:
  - id: D1
    description: "UiSurface union + pure activeSurface resolver + SURFACE_LAYERS registry inside the keyboard layer model, precedence pinned by named cases"
    requirement: FNC-06
    verification:
      - kind: unit
        ref: "packages/desktop/src/state/__tests__/surface-union.test.ts (13 tests)"
        status: pass
    human_judgment: false
  - id: D2
    description: "App.tsx renders the content area from one exhaustive switch; no ternary chain; a new UiSurface variant without an arm fails the build"
    requirement: FNC-06
    verification:
      - kind: integration
        ref: "packages/desktop/src/board/__tests__/layer-guard.test.tsx#the surface decision comes from activeSurface (3 App-render cases)"
        status: pass
      - kind: other
        ref: "cd packages/desktop && npx tsc --noEmit (only the 2 pre-existing brand-rule.test.ts errors)"
        status: pass
    human_judgment: false
  - id: D3
    description: "Existing guard behaviour unchanged: all pre-existing layer-guard cases and the full desktop suite still pass"
    verification:
      - kind: unit
        ref: "cd packages/desktop && npx vitest run -> 90 files passed, 1482 tests passed"
        status: pass
    human_judgment: false

duration: 6min
completed: 2026-10-15
status: complete
---

# Phase 13 Plan 08: One modelled surface value Summary

**`UiSurface` union with a pure `activeSurface` resolver and `SURFACE_LAYERS` registry beside `topLayer`, and `App.tsx` rendering its content area from one exhaustive `switch` instead of an eight-deep nested ternary**

## Performance

- **Duration:** ~6 min
- **Completed:** 2026-10-15T00:49Z
- **Tasks:** 2
- **Files modified:** 6 (1 created, 5 modified)

## Accomplishments

- `state/keyboard.ts` now owns "which surface is showing": `UiSurface` (8 variants), `SurfaceState` (7 booleans), `activeSurface` (flat early-return chain, zero `?` operators), and `SURFACE_LAYERS: Record<UiSurface, UiLayer | null>`. Every plan-reference comment (D-39, D-103, Phase 8, D-31, D-163, 10-08/WORK-07, D-16) moved onto the arm it explains, including the two deliberate orderings (fleet and worktree inventory below the session).
- `App.tsx` computes `activeSurface(...)` once and renders via a `switch` with a `never`-typed `default`. Precedence is unchanged: settings, triage, review, session, fleet, worktree inventory, project-unreachable, board.
- Adding a surface now fails the build twice over: no `SURFACE_LAYERS` entry (Record), no `switch` arm (`never`).

## Task Commits

1. **Task 1 RED: pin the precedence order** - `04139e3` (test)
2. **Task 1 GREEN: UiSurface, activeSurface, SURFACE_LAYERS** - `abf8f4a` (feat)
3. **Task 2: App.tsx exhaustive switch + guard cases + two fleet tests repointed** - `a0de3dd` (feat)

**Plan metadata:** committed separately (docs: complete plan).

## TDD Gate Compliance

- **Task 1:** RED committed first (`04139e3`): 13 of 13 failed at runtime with `TypeError: Cannot read properties of undefined` because `activeSurface`/`SURFACE_LAYERS` did not exist. This is the compile-order case - the failure is "export missing", not a failed assertion about behaviour - so it is a legitimate RED exception under the plan's rule, not a behavioural RED. GREEN `abf8f4a`: 13 of 13 pass.
- **Task 2 (not `tdd="true"`):** the three new App-render cases in `layer-guard.test.tsx` are characterization tests of behaviour the refactor must preserve; they pass both before and after, by design. There is no RED for a behaviour-preserving refactor. Their value is as a tripwire: if the switch reorders arms, they fail.

## Files Created/Modified

- `packages/desktop/src/state/keyboard.ts` - `UiSurface`, `SurfaceState`, `activeSurface`, `SURFACE_LAYERS`
- `packages/desktop/src/state/__tests__/surface-union.test.ts` - 11 precedence cases + 2 registry cases
- `packages/desktop/src/App.tsx` - ternary chain replaced by `renderSurface()` over `activeSurface`, exhaustive `never` default
- `packages/desktop/src/board/__tests__/layer-guard.test.tsx` - additions only (see below)
- `packages/desktop/src/fleet/__tests__/fleet-surface.test.tsx`, `jump.test.tsx` - source-grep precedence assertions repointed at the resolver

## Decisions Made

See frontmatter `key-decisions`. No uiStore.ts change was needed (no helper, no field change), so it is not in the modified list despite being in the plan's `files_modified`.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 3 - Blocking] Two existing tests pinned surface order by grepping `App.tsx` source**
- **Found during:** Task 2 (full `vitest run`)
- **Issue:** `fleet-surface.test.tsx` ("checks the session branch before the fleet branch...") and `jump.test.tsx` ("opening a session leaves the fleet open...") used `appSource.indexOf(") : activeAgentRunId ? (")`-style searches. The ternary they searched for no longer exists, so both returned `-1` and failed.
- **Fix:** Repointed both at the real source of truth, `activeSurface(...)`, asserting the same two orderings (session over fleet; fleet over unreachable project) behaviourally rather than by text position. Removed the now-unused `?raw` import in `fleet-surface.test.tsx`; `jump.test.tsx` still uses `appSource` for an unrelated check and keeps it.
- **Files modified:** `fleet-surface.test.tsx`, `jump.test.tsx`
- **Verification:** full suite 90/90 files, 1482 tests passing.
- **Committed in:** `a0de3dd`

**2. [Rule 3 - Blocking] `layer-guard.test.tsx` tauri mock lacked two exports `App` needs**
- **Found during:** Task 2 (new App-render cases)
- **Issue:** Rendering `App` mounts the fleet watcher, which calls `subscribeAgentEvent` and `fleetWatchRun`; the file's full-replacement `adapters/tauri` mock did not define them.
- **Fix:** Added both as no-op stubs to the existing mock, plus `vi.mock` stubs for `SettingsSurface`, `SessionSurface`, `FleetSurface`, `WorktreeInventory`. No pre-existing harness case renders `App`, so none is affected.
- **Committed in:** `a0de3dd`

---

**Total deviations:** 2 auto-fixed (both Rule 3)
**Impact on plan:** Both were mechanical consequences of moving the decision out of `App.tsx` source text. No behaviour change.

### Plan-criterion note: `grep -c "!" App.tsx`

The acceptance criterion says the `!` line count must not rise above the pre-change count (2). It rose to 7. The criterion's stated intent is "no non-null assertions were added"; the new `!` characters are `if (!reviewSurface) return null;`-style narrowing guards and `!== null` comparisons, which the plan itself prescribes ("narrow with a local guard rather than a non-null assertion"). Checked with `grep -nE '[A-Za-z)\]]!(\.|;|,|\)|\[)' App.tsx`: zero postfix non-null assertions. The literal count criterion is therefore unmet by its letter and met by its intent.

### `layer-guard.test.tsx` diff

`git diff HEAD` shows 0 removed lines: additions only (an `App` import, four `vi.mock` stubs, two mock exports, one new `describe` with three cases). No pre-existing case was edited.

## Issues Encountered

- `git rev-parse --git-dir` is `.git` as a *file* here (linked worktree layout), so a hard-coded `.git/gsd-plan-head-before-*` path fails; the ledger was read via `$(git rev-parse --git-dir)/...`.
- A foreign commit, `db2ae9b docs(13): file two status-ownership gaps left by 13-07 for Phase 14`, landed on the branch between my Task 1 and Task 2 commits. Not mine; it is why the measured `commits:` is 4 while this plan authored 3.
- `npx tsc --noEmit`: only the 2 known pre-existing `brand-rule.test.ts` errors. No Rust tests were run - this plan touches only `packages/desktop`.

## Known Stubs

None. (The `vi.mock` surface stubs live only inside the test file.)

## Next Phase Readiness

Phases 14-18 add a surface by (1) adding a `UiSurface` variant, (2) its `SurfaceState` boolean and `activeSurface` arm at the right precedence, (3) its `SURFACE_LAYERS` entry, (4) its `switch` arm in `App.tsx`. Steps 3 and 4 are compile errors if skipped; step 2's precedence is guarded only by adding a resolver case to `surface-union.test.ts`.

## Self-Check: PASSED

- `packages/desktop/src/state/__tests__/surface-union.test.ts` exists; `04139e3`, `abf8f4a`, `a0de3dd` exist in `git log`.
- Acceptance: `export type UiSurface` x1, `export function activeSurface` x1, `SURFACE_LAYERS` present, resolver `?` count 0, `) : ` in App content area 0, `activeSurface` x3 / `switch (` x1 / `never` x5 in App.tsx; `tsc` clean except 2 pre-existing; full vitest 90/90 files passing.

---
*Phase: 13-nothing-new-escapes-the-fence*
*Completed: 2026-10-15*
