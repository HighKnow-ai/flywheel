---
phase: 03-nothing-lost-nothing-left-running
plan: 10
subsystem: process-supervision
tags: [react, tauri, radix, recovery-ui, run-status]

# Dependency graph
requires:
  - phase: 03-06
    provides: "reconcile_agent_runs's launch-time orphan classification, kill_orphan/OrphanKillOutcome, AppState.pending_orphans, and the agent_runs_pending_orphans/orphan_kill Tauri commands plus adapters/tauri.ts wrappers this plan's modal drives directly"
  - phase: 03-09
    provides: "the recovery-surface pattern (early-return ladder replacing a normal line, `{ acting, error }` + useRef double-click guard, one Tauri command per decision) this plan's Acknowledge button and orphan-kill rows both copy"
provides:
  - "OrphanRecoveryModal — the blocking launch-time overlay: no Escape/click-outside/close-button dismissal, per-row Kill, Kill All, permanent per-row failure copy naming the pid"
  - "RunsSection's abandoned-run badge, watchdog/fallback explanation, and single Acknowledge action"
  - "agent_run_acknowledge Tauri command — writes acknowledged_at, guarded to status = 'abandoned', no domain function"
  - "RunSummaryDto.acknowledgedAt/abandonedReason on the wire end to end"
  - "run-abandoned legend mark (Unplug, agent channel)"
affects: [phase-3-verification]

# Actuals (#2632)
actuals:
  tokens: 20118
  tasks: 3
  commits: 3
plan_head_before: d3d58da2d64d5e8c95f2c2bc5b0e0e23e46b3a1c

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "A blocking overlay guarantees undismissability by never composing the dismissable-layer primitive at all (not by mounting it with no-op handlers) — a source-scanning grep gate over non-comment lines proves the absence structurally, following session/PermissionRequestCard.tsx's precedent for the exact same reason"
    - "A row whose async action can fail permanently (a kill the OS itself could not honor) carries a { acting, failed } state where failed is terminal and renders no retry-looking control — the one deliberate divergence from PermissionRequestCard.tsx's RowState, where a failed answer clears back to answerable"
    - "A synchronous-double-click guard needs a useRef checked before any await, not React state alone — recurred verbatim from 03-09's MissingWorktreeBanner fix, now established as the pattern for any row-local async action in this codebase"

key-files:
  created:
    - packages/desktop/src/recovery/OrphanRecoveryModal.tsx
    - packages/desktop/src/recovery/__tests__/orphan-recovery.test.tsx
  modified:
    - packages/desktop/src/App.tsx
    - packages/desktop/src/legend/marks.ts
    - packages/desktop/src/legend/__tests__/legend.test.tsx
    - packages/desktop/src/item-detail/RunsSection.tsx
    - packages/desktop/src/item-detail/__tests__/runs-section.test.tsx
    - packages/desktop/src/adapters/tauri.ts
    - packages/desktop/src/board/useBoardQuery.ts
    - packages/desktop/src-tauri/src/commands/agent_run.rs
    - packages/desktop/src-tauri/src/main.rs
    - packages/desktop/src-tauri/capabilities/default.json
    - packages/core/src/query/agent_runs.rs
    - DESIGN.md

key-decisions:
  - "packages/desktop/src/recovery/ instead of 03-PATTERNS.md's suggested components/ — no components/ directory exists anywhere in this codebase; every surface lives in a domain-named folder (board/, item-detail/, session/, settings/, projects/, launch-sheet/). Documented in the plan's own <ui_build_process> as an expected deviation, and recorded in DESIGN.md."
  - "abandonedReason carries the kill record's raw killed_at ISO timestamp, not a pre-rendered sentence — the renderer interpolates it into the fixed watchdog sentence via toLocaleString(), keeping status-word/duration/relative-time derivation at read time in the renderer, matching this DTO's own established convention."
  - "agent_run_acknowledge has no backing domain function, per the plan's own explicit instruction — the UPDATE statement is a compile-time literal inline in the command handler, guarded to status = 'abandoned' in its own WHERE clause, so acknowledging a non-abandoned run is a no-op (zero rows affected) rather than a second guard layered on top of a first."

requirements-completed: [PROC-04]

coverage:
  - id: D1
    description: "A launch that found at least one live orphaned agent process puts a blocking overlay in front of the board with no Escape, click-outside or close-button dismissal, and it closes itself only when its own row list becomes empty"
    requirement: "PROC-04"
    verification:
      - kind: unit
        ref: "packages/desktop/src/recovery/__tests__/orphan-recovery.test.tsx#OrphanRecoveryModal — undismissable (T-03-10-01, D-46)"
        status: pass
      - kind: unit
        ref: "packages/desktop/src/recovery/__tests__/orphan-recovery.test.tsx#OrphanRecoveryModal — empty list"
        status: pass
      - kind: other
        ref: "grep -v '^[[:space:]]*//' OrphanRecoveryModal.tsx | grep -c DismissableLayer == 0"
        status: pass
    human_judgment: false
  - id: D2
    description: "Every row carries its own Kill action and Kill All resolves all of them in one press; a kill that fails leaves the row mounted permanently, naming its pid, and the modal cannot be dismissed while any row is unresolved"
    requirement: "PROC-04"
    verification:
      - kind: unit
        ref: "packages/desktop/src/recovery/__tests__/orphan-recovery.test.tsx#OrphanRecoveryModal — kill in flight and outcomes"
        status: pass
      - kind: unit
        ref: "packages/desktop/src/recovery/__tests__/orphan-recovery.test.tsx#OrphanRecoveryModal — criterion 2 honesty (03-10 Task 3)"
        status: pass
    human_judgment: false
  - id: D3
    description: "Neither surface renders a cost figure, a token count, or a route into a live session"
    requirement: "PROC-04"
    verification:
      - kind: other
        ref: "grep -v '^[[:space:]]*//' OrphanRecoveryModal.tsx | grep -ciE 'costUsd|tokensIn|tokensOut|SessionSurface' == 0"
        status: pass
      - kind: unit
        ref: "packages/desktop/src/recovery/__tests__/orphan-recovery.test.tsx#OrphanRecoveryModal — populated#renders no cost figure, token count, or route into the live session surface"
        status: pass
    human_judgment: false
  - id: D4
    description: "An abandoned run renders its own distinct badge, an honest explanation sourced from the kill record or a weaker fallback when none exists or it is malformed, and a single Acknowledge action that clears once pressed"
    requirement: "PROC-05"
    verification:
      - kind: unit
        ref: "packages/desktop/src/item-detail/__tests__/runs-section.test.tsx#RunsSection — abandoned run (plan 03-10 Task 2, D-49/D-50)"
        status: pass
      - kind: unit
        ref: "packages/desktop/src/legend/__tests__/legend.test.tsx#agent channel"
        status: pass
    human_judgment: false
  - id: D5
    description: "The full chain — a real force-quit, relaunch, live orphan resolution, and an abandoned run's Acknowledge round trip — observed in the running application"
    verification: []
    human_judgment: true
    rationale: "No live Tauri shell or headless-Chromium screenshot pass was run this session (no GUI display available to this executor, matching every prior Phase 3 plan's own precedent). Every behavioural/copy assertion is covered by an automated test and the Impeccable detector found zero findings for both surfaces, but the plan's own human-check verification step names this exact end-to-end scenario as something no jsdom test can stand up — deferred to /gsd-verify-work per workflow.human_verify_mode: end-of-phase."

# Metrics
duration: 22min
completed: 2026-09-15
status: complete
---

# Phase 3 Plan 10: The Orphan Recovery Modal and the Abandoned-Run Acknowledgment Summary

**A blocking launch-time modal that structurally cannot be dismissed while a previous session's process is still alive, plus an abandoned-run badge/explanation/Acknowledge action that changes nothing about the record it describes.**

## Performance

- **Duration:** 22 min
- **Started:** 2026-09-15T16:12:50+08:00
- **Completed:** 2026-09-15T16:34:03+08:00
- **Tasks:** 3
- **Files modified:** 14 (2 created, 12 modified)

## Accomplishments

- `OrphanRecoveryModal` (new, `packages/desktop/src/recovery/`) reuses `DeleteConfirm.tsx`'s exact
  overlay shape at 560px, but never composes the dismissable-layer primitive at all — a source gate
  proves the absence structurally. Rows carry `{ killing, failed }` state where `failed` is
  PERMANENT (no retry-looking button survives a failed kill); Kill All fires every unresolved row
  concurrently. Mounted unconditionally in `App.tsx`, self-conditioned on a non-empty orphan list.
- `agent_run_acknowledge` (new Tauri command) writes `agent_runs.acknowledged_at` through a
  compile-time-literal `UPDATE` guarded to `status = 'abandoned'` — no domain function backs it, per
  the plan's own explicit instruction, so acknowledging a non-abandoned run is a no-op.
- `RunsSection.tsx`'s `abandoned` variant renders the new `run-abandoned` mark (`Unplug`, distinct
  from `run-interrupted`'s `CircleSlash`), the watchdog explanation (kill record's timestamp
  interpolated) or the honest fallback sentence, and a single Acknowledge button guarded against
  synchronous double-clicks by the same `useRef` fix plan 03-09's `MissingWorktreeBanner` needed for
  the identical bug.
- `RunSummaryDto.acknowledgedAt`/`abandonedReason` now travel the wire end to end (Rust
  `commands/agent_run.rs` → `adapters/tauri.ts`); `abandonedReason` is resolved per-row from the
  on-disk kill record (`runtime_protocol::read_kill_record`), never from SQL — absent and malformed
  records both fold to the same `None`, never inventing a reason the data does not support.
- A criterion-2 honesty test (Task 3) drives a Kill All where every kill fails and asserts all three
  rows remain, each naming its own distinct pid, the heading intact, and no close/dismiss/continue
  button anywhere — the application must never reach the board implying a clean launch it did not
  achieve.

## Task Commits

Each task was committed atomically:

1. **Task 1: The blocking orphan recovery modal** - `2e5814e` (feat)
2. **Task 2: The abandoned run explains itself, and Acknowledge is the only thing it asks for** - `88d9442` (feat)
3. **Task 3: Prove the modal cannot lie about a clean launch, and record both surfaces in DESIGN.md** - `5ca0950` (docs)

**Plan metadata:** committed alongside this SUMMARY.

## Files Created/Modified

- `packages/desktop/src/recovery/OrphanRecoveryModal.tsx` - the blocking overlay, per-row Kill,
  Kill All, permanent failure copy
- `packages/desktop/src/recovery/__tests__/orphan-recovery.test.tsx` - 18 tests covering every
  `<behavior>` bullet plus the criterion-2 honesty test
- `packages/desktop/src/App.tsx` - mounts `OrphanRecoveryModal` unconditionally in every app-shell
  branch
- `packages/desktop/src/legend/marks.ts` - `run-abandoned` mark
- `packages/desktop/src/legend/__tests__/legend.test.tsx` - agent-channel count (7 → 8), the new
  glyph's own assertion
- `packages/desktop/src/item-detail/RunsSection.tsx` - `abandoned` status/mark/colour/terminal-set
  entries, the explanation line, the Acknowledge button
- `packages/desktop/src/item-detail/__tests__/runs-section.test.tsx` - 10 new tests in an
  `abandoned` describe block
- `packages/desktop/src/adapters/tauri.ts` - `RunSummaryDto.acknowledgedAt`/`abandonedReason`,
  `acknowledgeAgentRun`
- `packages/desktop/src/board/useBoardQuery.ts` - doc comment on `useAgentRuns` naming the shared
  invalidation
- `packages/desktop/src-tauri/src/commands/agent_run.rs` - `RunSummaryDto` widened, `agent_run_acknowledge`
- `packages/desktop/src-tauri/src/main.rs` - registers `agent_run_acknowledge`
- `packages/desktop/src-tauri/capabilities/default.json` - roster comment updated
- `packages/core/src/query/agent_runs.rs` - `RunRow.acknowledged_at`, widened `SELECT`
- `DESIGN.md` - new Phase 3 Plan 03-10 entry

## Decisions Made

See `key-decisions` in frontmatter above. The load-bearing one: `packages/desktop/src/recovery/`
instead of `03-PATTERNS.md`'s suggested `components/` path — no `components/` directory exists
anywhere in this codebase, and the plan's own `<ui_build_process>` names this exact deviation as
expected.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 1 - Bug] Acknowledge's double-click guard needed a `useRef`, not `state.acting` alone**
- **Found during:** Task 2, first run of "pressing Acknowledge while the call is in flight does not
  issue a second call"
- **Issue:** Three synchronous `.click()` calls in the same tick all observed the same stale
  `ackState.acting === false`, because React had not yet flushed the `setState({ acting: true })`
  update (and the resulting `disabled` attribute) to the DOM before the second and third clicks
  fired — `acknowledgeAgentRunMock` was called 3 times, not 1.
- **Fix:** Added `ackActingRef` (`useRef<boolean>`), checked and set synchronously before any
  `await`, mirroring `item-detail/WorktreeSummary.tsx`'s own `actingRef` fix from plan 03-09 for the
  identical bug — `ackState.acting` remains the source of truth for what renders.
- **Files modified:** `packages/desktop/src/item-detail/RunsSection.tsx`
- **Verification:** "pressing Acknowledge while the call is in flight does not issue a second call"
  now asserts exactly 1 call
- **Committed in:** `88d9442` (Task 2 commit)

**2. [Rule 3 - Blocking] `DismissableLayer` mentioned in doc-comment prose broke the plan's own
verify gate**
- **Found during:** Task 1, first run of the `<verify>` grep gate asserting zero occurrences of
  `DismissableLayer` in `OrphanRecoveryModal.tsx`
- **Issue:** The plan's own gate strips only `//`-prefixed line comments (`grep -v '^[[:space:]]*//'`),
  not `/** */` block comments or `{/* */}` JSX comments — the file's own top-of-file doc comment and
  an inline JSX comment explaining WHY the dismissable-layer primitive is absent both named it
  literally, tripping the gate the documentation was trying to justify.
- **Fix:** Reworded both comments to say "the dismissable-layer primitive" (no CamelCase identifier)
  instead of the literal import name — same meaning, passes the literal-string gate.
- **Files modified:** `packages/desktop/src/recovery/OrphanRecoveryModal.tsx`
- **Verification:** `grep -v '^[[:space:]]*//' OrphanRecoveryModal.tsx | grep -c DismissableLayer`
  returns `0`
- **Committed in:** `2e5814e` (Task 1 commit)

---

**Total deviations:** 2 auto-fixed (1 bug, 1 blocking). **Impact:** Both were necessary — the first
for the Acknowledge button to actually guard against a real double-click, the second for the file to
satisfy its own plan-authored verification gate without losing the explanatory documentation. Neither
expands scope beyond what Tasks 1/2 already required.

## Issues Encountered

None beyond the two deviations documented above.

## User Setup Required

None - no external service configuration required.

## Next Phase Readiness

- `OrphanRecoveryModal.tsx`'s "compose the overlay shape, omit the dismissable-layer primitive
  entirely" pattern is the reference shape for any future surface that must structurally guarantee
  it cannot be dismissed while an unresolved state remains.
- `RunSummaryDto.acknowledgedAt`/`abandonedReason` are on the wire end to end — any future surface
  reading a task's runs can branch on either without a second call.
- **PROC-05 stays open in REQUIREMENTS.md** — it is shared with a sibling plan in this phase that has
  not yet produced its own SUMMARY.md (`requirements.ready-ids` reported it `blocked`); it will mark
  complete automatically once that plan finishes, per the phase's shared-ID gate.
- **Outstanding for the phase's consolidated end-of-phase UAT** (per
  `workflow.human_verify_mode: end-of-phase`): a live force-quit/relaunch showing the modal, a real
  kill resolving a row, and an abandoned run's Acknowledge round trip — not run this session (no GUI
  display available to this executor).
- No blockers. `cargo build --workspace`/`cargo test --workspace` and `npm --prefix packages/desktop
  run build`/`run test` (370/370) all green after this plan's additions.

---
*Phase: 03-nothing-lost-nothing-left-running*
*Completed: 2026-09-15*

## Self-Check: PASSED

All key files verified present on disk (`[ -f ]`). All three task commits (`2e5814e`, `88d9442`,
`5ca0950`) verified present in `git log`. `cargo build --workspace`, `cargo test --workspace` (all
suites green, 0 failed), `npm --prefix packages/desktop run build`, and `npm --prefix packages/desktop
run test` (370/370 pass) all re-confirmed before this SUMMARY was written. `grep -c 'run-abandoned'
packages/desktop/src/legend/marks.ts` and `grep -c 'agent_run_acknowledge'
packages/desktop/src-tauri/src/main.rs` both return `1`. `grep -ciE 'orphan recovery|run-abandoned|
Abandoned' DESIGN.md` returns `10` (≥ 1 required).
