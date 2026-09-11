---
phase: 02-one-agent-one-worktree-watched-live
plan: 11
subsystem: agents
tags: [rust, tauri, typescript, react, sqlite, vitest]

# Dependency graph
requires:
  - phase: 02-one-agent-one-worktree-watched-live
    provides: "Plan 02-02's agent_run_stop command and SidecarHandle::interrupt_run (D-35);
      plan 02-07's SessionSurface.tsx structured feed, TerminalRow and findTerminalInfo."
provides:
  - "agent_run_stop's terminal write is unconditional: a crashed, wedged or non-acknowledging
    sidecar can only widen a returned sidecar_warning, never starve the interrupt_agent_run
    domain write (CR-04 fix)."
  - "AgentRunStopDto / AgentRunStopResult: the Rust command and its TS wrapper both now report
    the status actually recorded plus an optional non-blocking sidecar warning."
  - "SessionSurface.tsx leaves its stopping state from the command's own result even when no
    session_closed push ever arrives, and renders the sidecar-could-not-confirm notice at the
    interrupted (muted) weight, never the failed treatment."
  - "Two new Rust tests proving the fix under a dead-sidecar closure, plus three new
    session-surface.test.tsx cases covering the warning-shown, warning-absent and
    push-still-wins paths."
affects: [02-12, 02-14]

# Actuals (#2632)
actuals:
  tokens: 6737
  tasks: 3
  commits: 3
  plan_head_before: b1d4cd65f76ae81b05c665dd45af7b85c49c8423

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "A DB-write seam (stop_agent_run_recording_first) takes the risky side-effecting call as
      an injected closure whose Result is captured in a local rather than propagated with `?` —
      the same 'record first, degrade the ack to a warning' shape any future force-path command
      facing an unreliable external process should reuse, not just this one stop path."
    - "A command's return DTO reports what the database ACTUALLY holds (a SELECT read-back)
      rather than an assumed literal, so a caller can never be told a status the write didn't
      really produce."

key-files:
  created: []
  modified:
    - packages/desktop/src-tauri/src/commands/agent_run.rs
    - packages/desktop/src/adapters/tauri.ts
    - packages/desktop/src/session/SessionSurface.tsx
    - packages/desktop/src/session/__tests__/session-surface.test.tsx
    - .planning/phases/02-one-agent-one-worktree-watched-live/deferred-items.md

key-decisions:
  - "agent_run_stop's fix is a decouple-then-report shape, not the review's raw
    format!(\"...\")-wrapped Err suggestion (02-REVIEW.md's own sketch): an Err from a decoupled
    command still lands in SessionSurface.tsx's .catch(() => setStopping(false)), and the
    surface only ever sets a terminal status from a pushed session_closed event a dead sidecar
    never sends — so the review's own fix would have left the UI stuck one layer up. The
    AgentRunStopDto { status, sidecarWarning } return shape is what actually closes the loop:
    Ok(dto) always carries a terminal status, and the warning is additive, never blocking."
  - "The interrupt closure's Result is captured in a local and read only after the domain write
    completes — not applied with ? and not matched with an early return — so 'is the domain
    write reachable when the sidecar failed' is a structural, greppable property (Task 1's own
    verify asserts the old early-return form is absent), not a comment promising discipline."
  - "seeded_conn_with_running_run() inserts a real (placeholder-path) worktrees row, unlike the
    file's pre-existing seeded_conn_with_running_agent_run() helper which leaves worktree_id
    NULL — kept as a second helper rather than widening the existing one, since the existing
    helper's callers (the permission-request tests) have no reason to carry a worktree row and
    widening it would change fixtures those tests don't need touched."
  - "The UI-SPEC specifies no presentation for a successful-but-unconfirmed stop (flagged in the
    plan itself); resolved by reusing E2's terminal-row pattern — one-line human gloss above the
    machine-detail line in the Mono role — at the interrupted/muted weight (--text-muted-rack,
    CircleSlash), never the failed run's --destructive-text-rack stripe or CircleX, since the
    run genuinely did reach interrupted."

patterns-established:
  - "Record-first-report-second: a command that must survive an unreliable downstream process
    performs its own durable write unconditionally, then reports the downstream call's own
    outcome as a secondary, non-blocking field on the same response — rather than gating the
    write behind the downstream call's success."

requirements-completed: [PROC-06]

coverage:
  - id: D1
    description: "A stop against a run whose sidecar never acknowledges the interrupt still
      reaches a terminal (interrupted) status, and the command reports what it actually
      recorded plus a warning naming what could not be confirmed."
    requirement: "PROC-06"
    verification:
      - kind: unit
        ref: "packages/desktop/src-tauri/src/commands/agent_run.rs#stop_records_interrupted_even_when_the_sidecar_never_acks"
        status: pass
      - kind: unit
        ref: "packages/desktop/src-tauri/src/commands/agent_run.rs#stop_twice_with_a_dead_sidecar_appends_exactly_one_interrupted_event"
        status: pass
    human_judgment: false
  - id: D2
    description: "The session surface leaves its stopping state from the stop command's own
      result — with no session_closed push ever arriving — and shows the sidecar-warning notice
      at the interrupted (muted) weight, never the failed treatment; a real session_closed push
      still wins when it does arrive."
    requirement: "PROC-06"
    verification:
      - kind: unit
        ref: "packages/desktop/src/session/__tests__/session-surface.test.tsx#leaves the stopping state from the command result when no session_closed push arrives"
        status: pass
      - kind: unit
        ref: "packages/desktop/src/session/__tests__/session-surface.test.tsx#renders no warning notice when the sidecar confirms the interrupt"
        status: pass
      - kind: unit
        ref: "packages/desktop/src/session/__tests__/session-surface.test.tsx#still applies a real session_closed push, as an additional source alongside the stop result"
        status: pass
    human_judgment: false
  - id: D3
    description: "Visual review that the interrupted/warning notice actually reads as muted
      (not destructive) in the running app, matching E5's intent — the automated tokens/marks
      assertions prove no destructive class or glyph is used, but 'does it look right' is a
      judgment call no test performs."
    verification: []
    human_judgment: true
    rationale: "The gate suite (build, hex-literal scan, full vitest run) proves the notice
      uses no --destructive-text-rack value and no CircleX mark, but whether the muted
      treatment reads correctly at a glance in the live UI is a visual judgment, consolidated
      into end-of-phase UAT per workflow.human_verify_mode=end-of-phase rather than a mid-flight
      checkpoint."

# Metrics
duration: 9min
completed: 2026-09-11
status: complete
---

# Phase 02 Plan 11: Decouple agent_run_stop's terminal write from the sidecar ack Summary

**`agent_run_stop` now records a run as `interrupted` unconditionally — a crashed, wedged, or
never-acknowledging sidecar can only add a `sidecarWarning` to the response, never block the
domain write — and the session surface reads that returned status directly, so Stop always
resolves even with no `session_closed` push.**

## Performance

- **Duration:** 9 min
- **Started:** 2026-09-11T04:08:57Z
- **Completed:** 2026-09-11T04:18:13Z
- **Tasks:** 3
- **Files modified:** 5

## Accomplishments

- Restructured `agent_run_stop` (`commands/agent_run.rs`) around a new testable seam,
  `stop_agent_run_recording_first`: the sidecar's `interrupt` closure is invoked and its
  `Result` captured in a local — never applied with `?` — so `interrupt_agent_run` always runs
  next regardless of what the sidecar side did. Added `AgentRunStopDto { agent_run_id, status,
  sidecar_warning }`, with `status` read back from `agent_runs` rather than a hard-coded
  literal, so the caller is told exactly what the database holds.
- Proved the fix with two new Rust tests: a `running` run stopped via a failing interrupt
  closure still reaches `interrupted` with `ended_at` set and a warning naming what could not be
  confirmed; calling the seam twice with a dead sidecar appends exactly one
  `agent_run.interrupted` event and never overwrites the recorded status.
- Widened `stopAgentRun` (`adapters/tauri.ts`) to resolve `AgentRunStopResult { status,
  sidecarWarning }`, and wired `SessionSurface.tsx`'s `handleStop` to apply that status directly
  (guarded by the existing `isRunStatus` check) — the surface now leaves its stopping state even
  when the sidecar never sends a `session_closed` push. A live push remains an additional,
  still-authoritative source and is otherwise untouched.
- Added `StopWarningNotice`, rendering the sidecar-could-not-confirm case at the interrupted
  (muted) weight — the CircleSlash mark and `--text-muted-rack`, never the failed run's
  `--destructive-text-rack` stripe or CircleX glyph (E5/E2 lift from `02-UI-SPEC.md`).
- Corrected the stale `deferred-items.md` record: the `ItemDetailPanel.tsx:219` hex-literal item
  no longer reflects reality at HEAD (already fixed by an earlier plan) and the raw-hex gate
  returns `0`; flipped its `status` to `resolved` with the gate result as evidence.

## Task Commits

Each task was committed atomically:

1. **Task 1: Record the stop first, tell the sidecar second — one path, end to end** -
   `a4f806a` (fix)
2. **Task 2: Prove it — a stop with a dead sidecar still reaches a terminal status** -
   `7d2ea04` (test)
3. **Task 3: The user sees it — the surface leaves its stopping state and names what went
   unconfirmed** - `bca0fcb` (fix)

_Note: this plan's `test(...)` commit (Task 2) follows its `fix(...)` commit (Task 1) rather
than preceding it — see "TDD Gate Compliance" below._

## Files Created/Modified

- `packages/desktop/src-tauri/src/commands/agent_run.rs` — `AgentRunStopDto`,
  `stop_agent_run_recording_first`, the rewritten `agent_run_stop`, and the two new
  `stop_*` tests plus their `seeded_conn_with_running_run()` fixture helper.
- `packages/desktop/src/adapters/tauri.ts` — `AgentRunStopResult` type; `stopAgentRun` now
  resolves it instead of `void`.
- `packages/desktop/src/session/SessionSurface.tsx` — `stopWarning` state, `handleStop` applying
  the returned status, and the new `StopWarningNotice` component.
- `packages/desktop/src/session/__tests__/session-surface.test.tsx` — module mock's
  `stopAgentRun`/`subscribeAgentEvent` stubs widened to support the new assertions; three new
  test cases.
- `.planning/phases/02-one-agent-one-worktree-watched-live/deferred-items.md` — first item's
  `status` corrected from `open` to `resolved`.

## Decisions Made

See `key-decisions` in the frontmatter above (the decouple-then-report shape vs. the review's own
suggested fix, the closure-capture-not-`?` structural property, the second seeded-connection
helper, and the UI-SPEC gap resolution for the unconfirmed-stop notice).

## Deviations from Plan

None — plan executed exactly as written. The `AgentRunStopDto`/`AgentRunStopResult` shapes,
`stop_agent_run_recording_first` seam, test names, and UI treatment all match the plan's
`<action>` blocks; no Rule 1-4 auto-fixes were needed beyond what the plan itself specified
(`worktrees.created_by`/`created_at`, both schema-required `NOT NULL` columns the plan's own
prose summary of the insert omitted but its own `<read_first>` pointer to the migration file
made unambiguous — not a deviation from intent, just filling in a column list against the
schema the plan told this executor to read).

## TDD Gate Compliance

This plan's own task sequencing puts the production-code commit (`fix(02-11)`, Task 1) before
the test-only commit (`test(02-11)`, Task 2) — the reverse of the canonical RED-before-GREEN
commit order `tdd.md` names. This is the plan's explicit design, not an executor deviation: the
plan frontmatter names Task 1 a `type="tracer"` step whose own objective states it "wires one
path end to end … with a real runnable verify, and Tasks 2-3 expand out from that proven slice."
Task 1's `<verify>` block is exclusively `cargo build --workspace` plus two structural `grep`
assertions — no test run — and Task 2's job is explicitly to add the regression tests proving
the already-built seam, not to author a failing test first. Both new tests therefore passed on
first run (verified above under "Full workspace verification"); this is expected and correct
given the plan's tracer-first sequencing, not a masked regression. `gsd_run check
tdd-red-evidence` was not invoked for this plan for the same reason: no task's `<action>`
describes writing a test before its corresponding implementation exists.

## Issues Encountered

None.

## User Setup Required

None - no external service configuration required.

## Full Workspace Verification

- `cargo build --workspace`: exits 0.
- `cargo test -p desktop stop_`: 2 passed, 0 failed.
- `cargo test --workspace`: 0 failed across all 29 test binaries.
- `npm --prefix packages/desktop run test -- session-surface`: 27 passed (3 new).
- `npm --prefix packages/desktop run test`: 295 passed, 0 failed, across all 28 files.
- `npm --prefix packages/desktop run build`: exits 0, no `error TS`.
- Raw-hex gate (`grep -rlE '#[0-9a-fA-F]{6}' packages/desktop/src | grep -vcE '...'`): `0`.
- Source assertion (no early-return interrupt form in `commands/agent_run.rs`): `0` occurrences.

## Next Phase Readiness

Gap 1 of 4 (`02-VERIFICATION.md`, PROC-06/CR-04) is closed: the terminal write can no longer be
starved by a dead sidecar, and the renderer no longer strands the user in an unresolvable
stopping state. Two adjacent items are explicitly handed off, not closed here:

- `SidecarHandle::interrupt_run`'s doc comment in `sidecar.rs` still asserts the old ordering
  ("the process has already ... finished shutting down before the domain write lands") — owned
  by plan `02-12` Task 1, which touches that file next wave. Not edited here per this plan's own
  `files_modified` scope.
- WR-01 (`interruptSession`'s unguarded initial SIGINT in `claude-code-adapter.ts`) remains
  deferred to plan `02-14`, which already modifies that file for CR-02.

No blockers for the remaining gap-closure plans in this round.

---
*Phase: 02-one-agent-one-worktree-watched-live*
*Completed: 2026-09-11*
