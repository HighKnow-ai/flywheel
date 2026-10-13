---
phase: 03-nothing-lost-nothing-left-running
plan: 11
subsystem: board-recovery-signal
tags: [rust, tauri, react, tanstack-query, lucide-react]

requires:
  - phase: 03-nothing-lost-nothing-left-running
    provides: "03-03's worktrees.status='missing' schema value and reconcile_worktrees; 03-09's
      worktree_recreate/worktree_forget_record and MissingWorktreeBanner; 03-10's
      agent_run_acknowledge, OrphanRecoveryModal and RunsSection's abandoned badge — this plan
      rolls all of it up into one board-visible signal, reusing D-37's blocked-pill-plus-rail-count
      mechanism rather than inventing a second one"
provides:
  - "recovery_task_ids_for_project / recovery_count_for_project (packages/core/src/query/recovery.rs)
    — the UNION rollup over worktrees.status='missing' and unacknowledged abandoned agent_runs,
    de-duplicating a task carrying both conditions to exactly one row"
  - "board_recovery_summary Tauri command + RecoverySummaryDto, boardRecoverySummary adapter
    wrapper, useRecoverySummary TanStack Query hook (invalidated on subscribeBoardChanged, no
    polling)"
  - "recovery-needed legend mark (TriangleAlert, agent channel) — deliberately shares
    worktree-missing's glyph"
  - "BoardRow.tsx's Needs Decision pill — trails the Blocked pill, same truncation-ladder
    exemption, distinguishable by glyph/word/colour family"
  - "ProjectRail.tsx's second, visually distinct count badge — never summed with the Blocked count"
affects: [phase-3-verification]

actuals:
  tokens: 17585
  tasks: 3
  commits: 3
plan_head_before: 9eef61c0f3293ce7673638d903867e88e7db08e6

tech-stack:
  added: []
  patterns:
    - "A two-condition rollup that must never double-count a task tripping both conditions uses
      SQL UNION (not UNION ALL) over the two contributing SELECTs, with a source-scanning grep
      gate proving UNION ALL's absence — the same discipline the crate already applies to
      format!'s absence"
    - "A second board-visible signal sharing an existing mechanism (row pill + rail badge) is built
      as a literal parallel structure to the first — same prop shape, same hook shape, same DTO
      shape, same query-invalidation path — rather than generalizing the mechanism into a
      multi-signal abstraction prematurely"

key-files:
  created:
    - packages/core/src/query/recovery.rs
    - packages/core/tests/recovery_summary.rs
    - packages/desktop/src/board/__tests__/needs-decision.test.tsx
  modified:
    - packages/core/src/query/mod.rs
    - packages/desktop/src-tauri/src/commands/agent_run.rs
    - packages/desktop/src-tauri/src/main.rs
    - packages/desktop/src-tauri/capabilities/default.json
    - packages/desktop/src/adapters/tauri.ts
    - packages/desktop/src/board/useBoardQuery.ts
    - packages/desktop/src/board/BoardRow.tsx
    - packages/desktop/src/board/BoardView.tsx
    - packages/desktop/src/legend/marks.ts
    - packages/desktop/src/legend/__tests__/legend.test.tsx
    - packages/desktop/src/projects/ProjectRail.tsx
    - DESIGN.md

key-decisions:
  - "The rollup deliberately does NOT require the abandoned run to be the task's most recent run —
    a task whose latest run completed cleanly but whose earlier run was abandoned and never
    acknowledged still has something the user has not seen. Stated in a code comment in
    recovery.rs and here, per the plan's own flagged-assumption instruction."
  - "The Needs Decision pill's activation opens the item detail panel plainly rather than scrolled
    to a specific section — no target-section mechanism exists on the panel yet (uiStore.ts carries
    no scroll-target field). Named as a gap per the plan's own instruction, not silently treated as
    covered."
  - "The rail's second badge is positioned at the opposite corner (bottom-right) from the existing
    Blocked badge/Unreachable glyph (both top-right) — a placement decision not specified in
    03-UI-SPEC.md, needed so the two badges never visually overlap on the same project entry."
  - "needs-decision.test.tsx carries both the BoardRow pill tests (Task 2) and the ProjectRail
    badge tests (Task 3) in one file, per the plan's own explicit permission to do either — split
    into two commits by temporarily omitting the rail describe block from Task 2's commit and
    appending it in Task 3's, keeping each commit's test content aligned with what that commit's
    production code implements."

requirements-completed: [WORK-06, PROC-05]

coverage:
  - id: D1
    description: "One query answers 'which tasks in this project are waiting on a decision, and
      how many' and cannot double-count a task that is waiting twice"
    requirement: "WORK-06"
    verification:
      - kind: integration
        ref: "cargo test -p core --test recovery_summary (7/7 pass)"
        status: pass
      - kind: other
        ref: "grep -c 'format!' packages/core/src/query/recovery.rs == 0"
        status: pass
      - kind: other
        ref: "grep -c 'UNION ALL' packages/core/src/query/recovery.rs == 0"
        status: pass
      - kind: other
        ref: "grep -c 'board_recovery_summary' packages/desktop/src-tauri/src/main.rs == 1"
        status: pass
      - kind: other
        ref: "npm --prefix packages/desktop run build"
        status: pass
    human_judgment: false
  - id: D2
    description: "A task waiting on a recovery decision says so on the board, in a way nobody will
      confuse with a blocked agent, and no window width can hide it"
    requirement: "WORK-06"
    verification:
      - kind: unit
        ref: "packages/desktop/src/board/__tests__/needs-decision.test.tsx#BoardRow Needs Decision pill (D-46) (9 tests)"
        status: pass
      - kind: unit
        ref: "packages/desktop/src/board/__tests__/blocked-indicator.test.tsx (10/10, no regression)"
        status: pass
      - kind: other
        ref: "grep -c 'recovery-needed' packages/desktop/src/legend/marks.ts == 1"
        status: pass
      - kind: other
        ref: "grep -cE '#[0-9a-fA-F]{6}' packages/desktop/src/board/BoardRow.tsx == 0"
        status: pass
    human_judgment: false
  - id: D3
    description: "The rail shows two separate counts, and zero renders no badge; the rollup counts
      a task carrying both conditions exactly once"
    requirement: "PROC-05"
    verification:
      - kind: unit
        ref: "packages/desktop/src/board/__tests__/needs-decision.test.tsx#ProjectRail second count badge (D-46) (6 tests)"
        status: pass
      - kind: unit
        ref: "packages/desktop/src/projects/__tests__/project-rail.test.tsx (5/5, no regression)"
        status: pass
      - kind: other
        ref: "grep -c 'blockedCount + ' packages/desktop/src/projects/ProjectRail.tsx == 0"
        status: pass
      - kind: other
        ref: "grep -ciE 'needs decision|recovery-needed' DESIGN.md >= 1"
        status: pass
    human_judgment: false
  - id: D4
    description: "Full suite regression-free: 386/386 desktop tests, all cargo workspace suites
      green, both builds clean"
    verification:
      - kind: other
        ref: "npm --prefix packages/desktop run test (386/386 pass)"
        status: pass
      - kind: other
        ref: "cargo test --workspace (0 failed across every suite)"
        status: pass
      - kind: other
        ref: "cargo build --workspace"
        status: pass
    human_judgment: true
    rationale: "No live Tauri shell or headless-Chromium screenshot pass was run this session (no
      GUI display available to this executor, matching every prior Phase 3 plan's own precedent).
      The Impeccable detector (detect.mjs --json) was run directly against BoardRow.tsx,
      ProjectRail.tsx and legend/marks.ts and reported zero findings for all three, and every
      behavioural/copy assertion is covered by an automated test, but final visual confirmation of
      the pill and the two-badge rail in the running app is deferred to /gsd-verify-work per
      workflow.human_verify_mode: end-of-phase."

duration: 25min
completed: 2026-09-15
status: complete
---

# Phase 3 Plan 11: The Needs Decision Pill and the Rail's Second Badge Summary

**A `UNION`-based rollup over missing worktrees and unacknowledged abandoned runs feeds a board-row "Needs Decision" pill and a second, visually distinct project-rail badge — reusing D-37's blocked-pill-plus-rail-count mechanism rather than inventing a second one, and never merging the two counts.**

## Performance

- **Duration:** 25 min
- **Started:** 2026-09-15T08:33:00Z
- **Completed:** 2026-09-15T08:54:00Z
- **Tasks:** 3
- **Files modified:** 15 (3 created, 12 modified)

## Accomplishments

- `recovery_task_ids_for_project`/`recovery_count_for_project` (`packages/core/src/query/recovery.rs`)
  — a single `UNION` over `worktrees.status = 'missing'` and `agent_runs.status = 'abandoned' AND
  acknowledged_at IS NULL`, structurally mirroring `query::permissions`'s own blocked-signal pair.
  `UNION`, not `UNION ALL`, de-duplicates a task carrying both conditions to exactly one row —
  proven by a source gate and a dedicated fixture test.
- `board_recovery_summary` (Tauri command) + `RecoverySummaryDto`/`boardRecoverySummary`
  (adapter)/`useRecoverySummary` (hook) — the same three-layer shape as `board_blocked_summary`,
  invalidated on `subscribeBoardChanged` with no polling.
- `recovery-needed` mark (`TriangleAlert`, agent channel — the ninth agent-channel entry) —
  deliberately shares `worktree-missing`'s glyph, since the row pill is a rollup of the same
  underlying fact, mirroring `run-blocked`/`blocked-indicator`'s own shared-glyph precedent.
- `BoardRow.tsx`'s Needs Decision pill — trails the Blocked pill (or the status glyph alone),
  carries the identical no-`field-*`-class truncation exemption, distinguished along three
  independent axes (glyph, word, colour family), opens the item detail panel on activation.
- `ProjectRail.tsx`'s second count badge — `--destructive-text-rack` background, positioned at the
  opposite corner from the existing Blocked badge so the two never collide, gated on
  `isCurrent && recoveryCount > 0`, never summed with `blockedCount`.
- `DESIGN.md` gained a Phase 3 Plan 03-11 entry recording the pill, the badge, the new mark, the
  reused tokens, the three distinguishing axes, and the named scroll-to-section gap.

## Task Commits

Each task was committed atomically:

1. **Task 1: The rollup read — which tasks have an outstanding recovery item, and how many** - `0a6add0` (feat)
2. **Task 2: The row pill — distinguishable from Blocked, and never truncated away** - `c281f27` (feat)
3. **Task 3: The rail's second badge — a different number, never merged with the first** - `55c055f` (feat)

**Plan metadata:** committed alongside this SUMMARY.

## Files Created/Modified

- `packages/core/src/query/recovery.rs` - `recovery_task_ids_for_project`/`recovery_count_for_project`
- `packages/core/src/query/mod.rs` - declares `pub mod recovery;`
- `packages/core/tests/recovery_summary.rs` - 7 tests covering every `<behavior>` bullet
- `packages/desktop/src-tauri/src/commands/agent_run.rs` - `RecoverySummaryDto`, `board_recovery_summary`
- `packages/desktop/src-tauri/src/main.rs` - registers `board_recovery_summary`
- `packages/desktop/src-tauri/capabilities/default.json` - roster comment updated
- `packages/desktop/src/adapters/tauri.ts` - `RecoverySummaryDto`, `boardRecoverySummary`
- `packages/desktop/src/board/useBoardQuery.ts` - `useRecoverySummary`, `recoverySummaryQueryKey`
- `packages/desktop/src/board/BoardRow.tsx` - `needsDecision` prop, the pill, `onOpenRecovery`
- `packages/desktop/src/board/BoardView.tsx` - wires `useRecoverySummary`, passes `needsDecision`/`onOpenRecovery`
- `packages/desktop/src/board/__tests__/needs-decision.test.tsx` - 15 tests (9 row-pill + 6 rail-badge)
- `packages/desktop/src/legend/marks.ts` - `recovery-needed` mark
- `packages/desktop/src/legend/__tests__/legend.test.tsx` - agent-channel count (8 → 9), new legend-row assertion
- `packages/desktop/src/projects/ProjectRail.tsx` - `useRecoverySummary`, the second badge
- `DESIGN.md` - new Phase 3 Plan 03-11 entry

## Decisions Made

See `key-decisions` in frontmatter above.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 3 - Blocking] Adding a ninth agent-channel mark broke the existing legend suite's fixed count**
- **Found during:** Task 2, first run of the full desktop test suite after appending `recovery-needed`
- **Issue:** `legend/__tests__/legend.test.tsx` asserted exactly eight agent-channel marks by name;
  adding a ninth mark made that assertion fail.
- **Fix:** Updated the assertion to nine entries, added `recovery-needed` to the expected list, and
  added a legend-row rendering test mirroring the existing `worktree-missing` one.
- **Files modified:** `packages/desktop/src/legend/__tests__/legend.test.tsx`
- **Verification:** `npm --prefix packages/desktop run test` — 386/386 pass
- **Committed in:** `c281f27` (Task 2 commit)

---

**Total deviations:** 1 auto-fixed (1 blocking). **Impact:** Necessary for the build/test suite to
stay green; no scope creep — the fix only updates an existing assertion's fixed count to match the
mark registry's new size.

## Issues Encountered

None beyond the deviation documented above.

## User Setup Required

None - no external service configuration required.

## Next Phase Readiness

- `query::recovery`'s `UNION`-over-two-tables shape is the reference pattern for any future rollup
  that must merge two independent "needs attention" signals into one de-duplicated set.
- `RecoverySummaryDto`/`useRecoverySummary` are on the wire end to end — any future surface needing
  "does this task have something the user hasn't seen" can read the same summary without a second
  query.
- The item detail panel still has no target-section mechanism — flagged in `03-CONTEXT.md`'s own
  discretion items and confirmed absent this session; the next surface needing to open the panel
  scrolled to a specific section will need to add that mechanism once.
- **Outstanding for the phase's consolidated end-of-phase UAT** (per
  `workflow.human_verify_mode: end-of-phase`): visual confirmation of the pill's placement/colours
  against the running app and the rail's two-badge layout at both corners — not run this session (no
  GUI display available to this executor).
- No blockers. `cargo build --workspace`/`cargo test --workspace` (all suites green, 0 failed) and
  `npm --prefix packages/desktop run build`/`run test` (386/386 pass) all green after this plan's
  additions.

---
*Phase: 03-nothing-lost-nothing-left-running*
*Completed: 2026-09-15*

## Self-Check: PASSED

All key files verified present on disk. All three task commits (`0a6add0`, `c281f27`, `55c055f`)
verified present in `git log`. `cargo build --workspace`, `cargo test -p core --test
recovery_summary` (7/7), `cargo test --workspace` (0 failed across every suite), `npm --prefix
packages/desktop run build`, and `npm --prefix packages/desktop run test` (386/386 pass) all
re-confirmed before this SUMMARY was written. `grep -c 'recovery-needed'
packages/desktop/src/legend/marks.ts` returns `1`. `grep -ciE 'needs decision|recovery-needed'
DESIGN.md` returns ≥ 1.
