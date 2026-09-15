---
phase: 03-nothing-lost-nothing-left-running
plan: 09
subsystem: worktree-lifecycle
tags: [rust, tauri, react, tanstack-query, lucide-react]

requires:
  - phase: 03-nothing-lost-nothing-left-running
    provides: "03-03's worktrees.status='missing' schema value, reconcile_worktrees, and the
      recreate_worktree_for_task/forget_worktree_record domain verbs this plan puts a command and
      UI surface on top of; 03-01's WorktreeSummary.tsx early-return ladder and Remove Worktree
      action, which the missing-worktree banner structurally supersedes while a row is missing"
provides:
  - "worktree_recreate / worktree_forget_record Tauri commands (packages/desktop/src-tauri/src/commands/agent_run.rs)
    — D-45's two recovery decisions, each a thin delegate to plan 03-03's domain verbs with no
    force/override parameter of any kind"
  - "WorktreeSummaryDto.status on both sides of the IPC seam (Rust + adapters/tauri.ts) — any
    future surface reading a task's worktree summary can branch on it without a second call"
  - "MissingWorktreeBanner (item-detail/WorktreeSummary.tsx) — the D-45 decision banner that
    replaces the branch/path line entirely while a worktree is missing from disk"
  - "worktree-missing legend mark (TriangleAlert, agent channel)"
  - "Broken window #6 closed — T-02-37's 'missing from disk' clause, deferred from Phase 2 to
    WORK-06, now has a named test and a backend signal to render from"
affects: [03-10, 03-11, phase-3-verification]

actuals:
  tokens: 8278
  tasks: 3
  commits: 3
plan_head_before: b52ee15e8eeea747de34f31e598bcf174807dd18

tech-stack:
  added: []
  patterns:
    - "A ref (not React state alone) guards a component's own async action against two clicks
      arriving in the same synchronous tick — state.acting is not read/written synchronously
      enough to prevent a second click that fires before React flushes the disabled attribute to
      the DOM; MissingWorktreeBanner's actingRef is the actual guard, with state remaining the
      source of truth for what renders"
    - "A missing-from-disk resource's recovery banner resolves through the SAME query
      invalidation its own read path already uses (board:changed -> useWorktreeSummary), never a
      local optimistic flag — the banner disappears because the data changed, not because the
      component believes it succeeded"

key-files:
  created: []
  modified:
    - packages/desktop/src-tauri/src/commands/agent_run.rs
    - packages/desktop/src-tauri/src/main.rs
    - packages/desktop/src-tauri/capabilities/default.json
    - packages/desktop/src/adapters/tauri.ts
    - packages/desktop/src/board/useBoardQuery.ts
    - packages/desktop/src/item-detail/WorktreeSummary.tsx
    - packages/desktop/src/item-detail/__tests__/worktree-summary.test.tsx
    - packages/desktop/src/legend/marks.ts
    - packages/desktop/src/legend/__tests__/legend.test.tsx
    - .planning/WINDOWS.md
    - DESIGN.md

key-decisions:
  - "worktree_recreate/worktree_forget_record carry no boolean/option/flag parameter beyond
    task_id — the refusal on a non-missing row lives entirely in plan 03-03's domain verbs, so the
    command layer adds no second guard and no way around the first"
  - "MissingWorktreeBanner's concurrency guard uses a useRef checked/set synchronously before any
    await, not state.acting alone — found necessary by a real failing test (three synchronous
    clicks in one tick all read the same stale state.acting=false before React's first re-render)"
  - "Remove Worktree's absence while a worktree is missing is proven by a test, not a second guard
    in the code — the early return that renders MissingWorktreeBanner instead of the normal row is
    what makes it structurally unreachable"
  - "Remove Record does not reuse WorktreeRemovalDialog.tsx's destructive-fill button style —
    nothing is destroyed on disk by it, and both actions carry identical visual weight because
    03-UI-SPEC.md treats this as a genuine either/or, not a safe-default/destructive pair"

requirements-completed: [WORK-06]

coverage:
  - id: D1
    description: "The two decisions D-45 offers (Recreate Worktree, Remove Record) are reachable
      from the renderer via worktree_recreate/worktree_forget_record, each delegating to plan
      03-03's domain verbs with no bypass parameter, and WorktreeSummaryDto carries status on both
      sides of the IPC seam"
    requirement: "WORK-06"
    verification:
      - kind: other
        ref: "cargo build --workspace"
        status: pass
      - kind: other
        ref: "grep -c 'worktree_recreate|worktree_forget_record' packages/desktop/src-tauri/src/main.rs == 2"
        status: pass
      - kind: other
        ref: "grep -c 'worktree_forget_record' packages/desktop/src-tauri/capabilities/default.json >= 1"
        status: pass
      - kind: other
        ref: "npm --prefix packages/desktop run build"
        status: pass
      - kind: integration
        ref: "cargo test -p core --test reconcile_worktrees (16/16 pass)"
        status: pass
    human_judgment: false
  - id: D2
    description: "A missing worktree shows the banner in place of its line — never alongside it —
      with the glyph, heading, body naming the path, and exactly two equally-weighted actions and
      no third way out; the Remove Worktree action from plan 03-01 is unreachable while missing"
    requirement: "WORK-06"
    verification:
      - kind: unit
        ref: "packages/desktop/src/item-detail/__tests__/worktree-summary.test.tsx#replaces the branch/path line entirely — no branch span, no copyable path button, no Remove Worktree action"
        status: pass
      - kind: unit
        ref: "packages/desktop/src/item-detail/__tests__/worktree-summary.test.tsx#renders the glyph, heading, body naming the path, and exactly two equally-weighted actions"
        status: pass
      - kind: unit
        ref: "packages/desktop/src/item-detail/__tests__/worktree-summary.test.tsx#gives both actions identical visual weight — same background and border colour"
        status: pass
      - kind: unit
        ref: "packages/desktop/src/item-detail/__tests__/worktree-summary.test.tsx#is absent by construction when the worktree row is not missing — the ordinary branch/path line renders instead"
        status: pass
    human_judgment: false
  - id: D3
    description: "Pressing either action calls the correct command with the task id, a second
      click while in flight issues no second call, and a rejected call leaves the banner mounted
      with an inline error rather than unmounting or clearing"
    requirement: "WORK-06"
    verification:
      - kind: unit
        ref: "packages/desktop/src/item-detail/__tests__/worktree-summary.test.tsx#Recreate Worktree calls worktreeRecreate with the task id"
        status: pass
      - kind: unit
        ref: "packages/desktop/src/item-detail/__tests__/worktree-summary.test.tsx#Remove Record calls worktreeForgetRecord with the task id"
        status: pass
      - kind: unit
        ref: "packages/desktop/src/item-detail/__tests__/worktree-summary.test.tsx#pressing a button while its action is in flight does not issue a second call"
        status: pass
      - kind: unit
        ref: "packages/desktop/src/item-detail/__tests__/worktree-summary.test.tsx#a rejected recreate leaves the banner mounted and renders an inline error, never unmounting or clearing"
        status: pass
      - kind: unit
        ref: "packages/desktop/src/item-detail/__tests__/worktree-summary.test.tsx#a rejected forget-record leaves the banner mounted and renders an inline error"
        status: pass
    human_judgment: false
  - id: D4
    description: "Broken window #6 is closed by a named test and marked fixed in the ledger; the
      new mark is published in the legend before any surface renders it a second way; zero new
      colour tokens/hex literals are introduced"
    requirement: "WORK-06"
    verification:
      - kind: unit
        ref: "packages/desktop/src/item-detail/__tests__/worktree-summary.test.tsx#closes broken window #6: tells the user the worktree is not on disk"
        status: pass
      - kind: other
        ref: ".planning/WINDOWS.md row 6 status=fixed, resolved_at set via gsd-tools windows fixed 6"
        status: pass
      - kind: unit
        ref: "packages/desktop/src/legend/__tests__/legend.test.tsx#renders the worktree-missing mark with its printed word"
        status: pass
      - kind: other
        ref: "grep -v '^\\s*//' WorktreeSummary.tsx | grep -cE '#[0-9a-fA-F]{6}' == 0"
        status: pass
      - kind: other
        ref: "impeccable detect --json (WorktreeSummary.tsx, legend/marks.ts) == []"
        status: pass
    human_judgment: true
    rationale: "No live Tauri shell or headless-Chromium screenshot pass was run this session (no
      GUI display available to this executor, matching plan 03-01's own precedent). The
      Impeccable detector found zero findings and every behavioural/copy assertion is covered by
      an automated test, but final visual confirmation of the banner in the running app is
      deferred to /gsd-verify-work per workflow.human_verify_mode: end-of-phase."

duration: 42min
completed: 2026-09-15
status: complete
---

# Phase 3 Plan 9: The Missing-Worktree Decision Banner Summary

**`worktree_recreate`/`worktree_forget_record` Tauri commands plus a `MissingWorktreeBanner` that replaces `WorktreeSummary`'s branch/path line entirely when a worktree's status reads `missing`, offering two identically-weighted actions guarded against double-clicks by a `useRef` (state alone flushes too slowly for two synchronous clicks) — closing broken window #6 along the way.**

## Performance

- **Duration:** 42 min
- **Started:** 2026-09-15T07:07:00Z
- **Completed:** 2026-09-15T07:49:00Z
- **Tasks:** 3
- **Files modified:** 11 (10 packages files + .planning/WINDOWS.md + DESIGN.md)

## Accomplishments

- `WorktreeSummaryDto` widened with `status` on both sides of the IPC seam (Rust `commands/agent_run.rs`
  and `adapters/tauri.ts`), so the renderer branches on `"missing"` without a second call
- `worktree_recreate`/`worktree_forget_record` Tauri commands, registered in `generate_handler!`
  and the capability roster comment, each a thin delegate to plan 03-03's domain verbs with no
  force/override parameter anywhere in the call chain
- `MissingWorktreeBanner` — a new early return in `WorktreeSummary.tsx`'s existing ladder, between
  the singleton-violation guard and the normal render, replacing the branch/path line and plan
  03-01's Remove Worktree action entirely while a worktree is `missing`
- One new legend mark: `worktree-missing` (`TriangleAlert`, agent channel), published in
  `legend/marks.ts` before the banner that renders it
- Broken window #6 closed: a named test proves the missing-from-disk clause deferred from Phase 2
  is now mitigated; `.planning/WINDOWS.md` row 6 marked `fixed` via `gsd-tools windows fixed 6`
- `DESIGN.md` gained a Phase 3 Plan 03-09 entry recording the banner, its mark, its reused tokens,
  and the equal-visual-weight decision

## Task Commits

Each task was committed atomically:

1. **Task 1: The two decisions as commands — recreate, or forget the record** - `c9e9241` (feat)
2. **Task 2: The banner replaces the line, and the removal action disappears while it does** - `d42ed51` (feat)
3. **Task 3: Close broken window #6 and record the surface in DESIGN.md** - `809fdee` (docs)

**Plan metadata:** committed alongside this SUMMARY.

_Note: All three tasks carry `tdd="true"`, but `workflow.tdd_mode` is not enabled for this
project, so strict RED/GREEN/REFACTOR gate enforcement was not mandatory — tests and
implementation were authored together and verified green before each task's single commit,
matching the pattern established by 03-01/03-02/03-03._

## Files Created/Modified

- `packages/desktop/src-tauri/src/commands/agent_run.rs` - `WorktreeSummaryDto.status`, `worktree_recreate`, `worktree_forget_record`
- `packages/desktop/src-tauri/src/main.rs` - registers both new commands
- `packages/desktop/src-tauri/capabilities/default.json` - roster comment updated
- `packages/desktop/src/adapters/tauri.ts` - `WorktreeSummaryDto.status`, `worktreeRecreate`, `worktreeForgetRecord`
- `packages/desktop/src/board/useBoardQuery.ts` - one-line comment on `useWorktreeSummary` documenting the banner's own invalidation path
- `packages/desktop/src/item-detail/WorktreeSummary.tsx` - `MissingWorktreeBanner`, the missing-status early return
- `packages/desktop/src/item-detail/__tests__/worktree-summary.test.tsx` - 10 new tests (missing describe block) + status field fix on 4 pre-existing fixtures
- `packages/desktop/src/legend/marks.ts` - `worktree-missing` mark
- `packages/desktop/src/legend/__tests__/legend.test.tsx` - updated agent-channel count (6 -> 7), new legend-rendering assertion
- `.planning/WINDOWS.md` - row 6 marked `fixed`
- `DESIGN.md` - new Phase 3 Plan 03-09 entry

## Decisions Made

See `key-decisions` in frontmatter above.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 1 - Bug] `state.acting` alone did not guard against two synchronous clicks in the same tick**
- **Found during:** Task 2, first run of "pressing a button while its action is in flight does not issue a second call"
- **Issue:** Three synchronous `.click()` calls on the same button in one test tick all observed the same stale `state.acting === false`, because React had not yet flushed the `setState({ acting: true })` update (and the resulting `disabled` attribute) to the DOM before the second and third clicks fired — `worktreeRecreateMock` was called 3 times, not 1.
- **Fix:** Added a `useRef<boolean>` (`actingRef`) checked and set synchronously before any `await`, alongside `state.acting` (which remains the source of truth for the rendered `disabled`/opacity). The ref has no such flush-timing window.
- **Files modified:** `packages/desktop/src/item-detail/WorktreeSummary.tsx`
- **Verification:** "pressing a button while its action is in flight does not issue a second call" now asserts exactly 1 call
- **Committed in:** `d42ed51` (Task 2 commit)

**2. [Rule 3 - Blocking] Widening `WorktreeSummaryDto` broke 4 pre-existing test fixtures**
- **Found during:** Task 1, first `npm run build` after adding the required `status` field
- **Issue:** `worktree-summary.test.tsx`'s pre-existing fixtures (typed as `WorktreeSummaryDto`) omitted the newly-required `status` field, failing `tsc` with `TS2741`.
- **Fix:** Added `status: "active"` to the four affected fixtures.
- **Files modified:** `packages/desktop/src/item-detail/__tests__/worktree-summary.test.tsx`
- **Verification:** `npm --prefix packages/desktop run build` passes
- **Committed in:** `c9e9241` (Task 1 commit)

---

**Total deviations:** 2 auto-fixed (1 bug, 1 blocking). **Impact:** Both were necessary for correctness (the concurrency guard) and for the build to pass at all (the widened DTO); neither expands scope beyond what Task 1/2 already required.

## Issues Encountered

None beyond the two deviations documented above. The "found multiple elements" text-matcher issue
in one new test (an ambiguous `findByText` predicate matching both the `<p>` and an ancestor) was
a test-authoring mistake, not a product bug — resolved in the same session by scoping the query
with `{ selector: "p" }` before any commit was made, so it never appears as a deviation.

## User Setup Required

None - no external service configuration required.

## Next Phase Readiness

- `worktree_recreate`/`worktree_forget_record`/`WorktreeSummaryDto.status` are ready for any future
  surface that needs to read or act on a worktree's recovery state.
- `MissingWorktreeBanner`'s `{ acting, error }` + `useRef` guard shape is the reference pattern for
  any future surface needing to guard two async actions sharing one row against synchronous
  double-clicks.
- No blockers. `cargo test --workspace` (all suites) and `npm --prefix packages/desktop run test`
  (334/334) both fully green after this plan's additions.

---
*Phase: 03-nothing-lost-nothing-left-running*
*Completed: 2026-09-15*

## Self-Check: PASSED

All key files verified present on disk. All three task commits (`c9e9241`, `d42ed51`, `809fdee`)
verified present in `git log`. `cargo build --workspace`, `cargo test -p core --test
reconcile_worktrees` (16/16), `npm --prefix packages/desktop run build`, and `npm --prefix
packages/desktop run test` (full suite, 334/334) all re-confirmed before this SUMMARY was written.
`.planning/WINDOWS.md` row 6 confirmed `fixed` with a `resolved_at` timestamp.
