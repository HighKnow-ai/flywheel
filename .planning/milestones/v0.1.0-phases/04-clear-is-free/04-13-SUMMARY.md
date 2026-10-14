---
phase: 04-clear-is-free
plan: 13
subsystem: context-reconstitution
tags: [rust, react, tauri, session-lifecycle, discard, launch-sheet, ctx-08]

requires:
  - phase: 04-clear-is-free
    provides: "04-12's shipped DriftWarningDto/launch-sheet packet surfaces, and every prior
      plan's session-summary/context-packet machinery this plan's launch-sheet hand-off lands
      the developer on"
provides:
  - "commands::agent_run::agent_run_discard — a bounded wait for the agent's own closing
    summary, then the exact interrupt-then-force path agent_run_stop already walks
    (stop_agent_run_recording_first), never a second termination implementation"
  - "stop_agent_run_recording_first now guarantees a fallback summary exists for any run it
    terminates that had none — closes a latent gap in the pre-existing Stop path, not only in
    Discard's own"
  - "adapters/tauri.ts's discardSession and SessionSurface.tsx's Discard control — the phase's
    flagship one-action verb, landing the developer on the launch sheet for the same task"
affects: []

actuals:
  tokens: 14212
  tasks: 3
  commits: 3
  plan_head_before: ce67b3ba516874464ae8b027c4cc5a913c078675

tech-stack:
  added: []
  patterns:
    - "A bounded wait polls the shared DB lock ONCE PER ITERATION, never held across the whole
      window — agent_run_stop's own CR-01 comment states the reason (holding the app's one
      Mutex<Connection> across a multi-second wait freezes every other board read); this plan's
      discard_poll_snapshot follows the identical discipline with more force, since its window
      is longer (8s vs the sidecar's own 5s STOP_GRACE_MS)."
    - "A shared termination tail gains a new invariant once, in the ONE function two entry
      points call, rather than being duplicated per caller: stop_agent_run_recording_first's new
      fallback-summary presence check applies to Stop and Discard alike, because both walk the
      exact same function body."
    - "A component prop the surface has no other source for is threaded through the specific
      call sites that already hold it, rather than added as a new backend read — uiStore's
      setActiveAgentRunId gained a second, optional parameter, following the same 'N related
      fields, one writer' shape openQuickAdd already established."

key-files:
  created:
    - packages/core/tests/discard_lifecycle.rs
  modified:
    - packages/desktop/src-tauri/src/commands/agent_run.rs
    - packages/desktop/src-tauri/src/main.rs
    - packages/desktop/src/adapters/tauri.ts
    - packages/desktop/src/session/SessionSurface.tsx
    - packages/desktop/src/session/__tests__/session-surface.test.tsx
    - packages/desktop/src/state/uiStore.ts
    - packages/desktop/src/App.tsx
    - packages/desktop/src/board/BoardView.tsx
    - packages/desktop/src/board/useBoardQuery.ts

key-decisions:
  - "DISCARD_SUMMARY_WAIT_MS is 8_000ms, declared beside agent_run_discard with the plan's own
    arithmetic recorded in its doc comment — longer than the sidecar's 5_000ms STOP_GRACE_MS
    (waiting for a model to finish a tool call, not for a process to notice a signal), shorter
    than twice it (discard must keep feeling like one action); the two windows are sequential,
    so the worst case before the force step is 13 seconds."
  - "stop_agent_run_recording_first (not agent_run_discard alone) gained the fallback-summary
    presence check, so Stop ALSO now guarantees a summary exists for any run it terminates with
    none — apply_session_closed's own fallback hook (plan 04-02) only fires the FIRST time a run
    becomes terminal, and a run stopped/discarded through the interrupt-then-force path is
    already terminal by the time any later session_closed event for it arrives there, so that
    hook's own presence check was structurally unreachable for this path before this change."
  - "SessionSurface has no other source for its own task id (the header literally hardcodes
    'Session', never a task title), so uiStore's setActiveAgentRunId gained an optional
    taskId parameter, set together with activeAgentRunId at its three call sites (App.tsx's
    LaunchSheet onStarted, BoardView.tsx's onOpenRun, useBoardQuery.ts's
    openLiveSessionForTask) — each of which already held the task id in scope — rather than
    adding a new backend read."
  - "The Discard control is styled with --accent-nontext (the same filled-primary treatment
    LaunchSheet.tsx's own Start Work button uses), visually distinguishing it as the flagship
    verb rather than a second outline button beside Stop; no colour hex literal was introduced."
  - "01-UI-SPEC.md reserves no keyboard shortcut for a discard-shaped verb, so the control ships
    without one, per the plan's own instruction not to pre-empt Phase 10.1's keyboard-map work."

patterns-established:
  - "A prop threaded through 3 already-informed call sites, never a new query, when a component
    needs data every one of its callers already has — the template for the next surface that
    needs its own task id without adding a fourth Tauri command."

requirements-completed: [CTX-08]

coverage:
  - id: D1
    description: "agent_run_discard polls for the agent's own closing summary at a bounded
      interval, taking and releasing the DB lock per poll, for up to DISCARD_SUMMARY_WAIT_MS,
      then falls through to the exact stop_agent_run_recording_first path agent_run_stop already
      walks; a discard with no agent summary leaves exactly one auto_generated fallback row, a
      discard with one present leaves it untouched, and an already-terminal run is a safe no-op"
    requirement: CTX-08
    verification:
      - kind: integration
        ref: "tests/discard_lifecycle.rs#discarding_a_run_with_an_agent_recorded_summary_leaves_it_present_and_the_run_interrupted"
        status: pass
      - kind: integration
        ref: "tests/discard_lifecycle.rs#discarding_a_run_with_no_agent_summary_synthesizes_exactly_one_auto_generated_fallback"
        status: pass
      - kind: integration
        ref: "tests/discard_lifecycle.rs#discarding_an_already_terminal_run_writes_no_second_terminal_event"
        status: pass
      - kind: integration
        ref: "tests/discard_lifecycle.rs#the_fallback_never_overwrites_an_agent_authored_summary_recorded_moments_before_the_interrupt"
        status: pass
      - kind: integration
        ref: "tests/discard_lifecycle.rs#discarding_twice_appends_no_second_summary_and_no_second_interrupted_event"
        status: pass
      - kind: other
        ref: "cargo test -p core --test discard_lifecycle (10/10 passed)"
        status: pass
      - kind: other
        ref: "cargo test -p core --test stop_lifecycle (2/2 passed, unregressed)"
        status: pass
      - kind: other
        ref: "cargo test -p core --test agent_run_stop_ordering (2/2 passed, unregressed)"
        status: pass
    human_judgment: false
  - id: D2
    description: "The task's worktree row count and directory, and every prior session's
      summary row, are unchanged by a discard — expressed as explicit before-and-after counts
      over worktrees, session_summaries, agent_runs and acceptance_criteria"
    requirement: CTX-08
    verification:
      - kind: integration
        ref: "tests/discard_lifecycle.rs#the_tasks_worktree_row_count_and_directory_are_unchanged_by_a_discard"
        status: pass
      - kind: integration
        ref: "tests/discard_lifecycle.rs#no_prior_session_summary_row_is_removed_by_a_discard"
        status: pass
      - kind: integration
        ref: "tests/discard_lifecycle.rs#board_counts_are_unchanged_across_a_discard_when_the_agent_already_recorded_its_own_summary"
        status: pass
      - kind: integration
        ref: "tests/discard_lifecycle.rs#board_counts_gain_exactly_one_session_summary_when_no_agent_summary_was_recorded"
        status: pass
    human_judgment: false
  - id: D3
    description: "A Discard control renders beside Stop under the live-session condition, one
      activation calls discardSession exactly once with no confirmation dialog in between, the
      in-flight state disables both controls and reads Discarding…, and resolution lands the
      developer on the launch sheet pre-filled for the same task"
    requirement: CTX-08
    verification:
      - kind: unit
        ref: "src/session/__tests__/session-surface.test.tsx#clicking Discard twice in one synchronous tick sends exactly one agent_run_discard command, with no confirmation dialog appearing in between"
        status: pass
      - kind: unit
        ref: "src/session/__tests__/session-surface.test.tsx#reads Discarding… and disables both Discard and Stop immediately after activation"
        status: pass
      - kind: unit
        ref: "src/session/__tests__/session-surface.test.tsx#opens the launch sheet for this run's own task once the discard resolves"
        status: pass
      - kind: unit
        ref: "src/session/__tests__/session-surface.test.tsx#renders the muted warning notice and never opens the launch sheet when the discard call is rejected"
        status: pass
      - kind: unit
        ref: "src/session/__tests__/session-surface.test.tsx#renders neither Stop nor Discard for a terminal run"
        status: pass
      - kind: other
        ref: "grep -cE '#[0-9a-fA-F]{3,8}\\b' packages/desktop/src/session/SessionSurface.tsx == 0"
        status: pass
    human_judgment: false
  - id: D4
    description: "The full Rust workspace and desktop test suites, plus the TypeScript build,
      stay green after these changes"
    verification:
      - kind: other
        ref: "cargo test --workspace (exit 0, no FAILED lines anywhere, including the two
          previously-flaky worktree_lifecycle tests both passing this run)"
        status: pass
      - kind: other
        ref: "npm --prefix packages/desktop run test (463 passed, 32 test files)"
        status: pass
      - kind: other
        ref: "npm --prefix packages/desktop run build (clean)"
        status: pass
    human_judgment: false
  - id: D5
    description: "A human sees the real one-action path once: start a real session, let it make
      an edit, press Discard, and confirm the wait indicator, the launch-sheet auto-open, and the
      prior-session summary's presence all happen exactly as the automated suites above assert"
    requirement: CTX-08
    verification: []
    human_judgment: true
    rationale: "Task 3's own <human-check> — this is the phase's flagship path and the one place
      a human should look at it once; every property it depends on is asserted by the automated
      suites above, but the end-to-end feel of a real live session (the bounded wait actually
      elapsing, a real agent's report_summary call landing or not, the launch sheet opening
      itself) needs a live claude session this executor did not spawn."

duration: 14min
completed: 2026-09-23
status: complete
---

# Phase 4 Plan 13: Discard — One Activation Ends The Session And Opens The Launch Sheet For The Same Task Summary

**`agent_run_discard` gives the agent's own closing summary an 8-second bounded window, then falls through to the exact `stop_agent_run_recording_first` path Stop already walks (which now guarantees a fallback summary exists for any run it terminates); the Discard control lands the developer on the launch sheet, pre-filled for the same task, with no intermediate step — CTX-08's `/clear` is free, made real.**

## Performance

- **Duration:** 14 min
- **Started:** 2026-09-23T05:59:02Z
- **Completed:** 2026-09-23T06:12:53Z
- **Tasks:** 3
- **Files modified:** 9 (1 created)

## Accomplishments

- `packages/desktop/src-tauri/src/commands/agent_run.rs`: `agent_run_discard` polls
  `latest_summary_for_run` (and the run's own terminal status) at 200ms intervals, taking and
  releasing the shared DB lock per poll, for up to `DISCARD_SUMMARY_WAIT_MS` (8_000ms, declared
  with the plan's own worst-case arithmetic recorded in its doc comment), then falls through to
  `stop_agent_run_recording_first` — the exact same shared tail `agent_run_stop` calls. Registered
  in `main.rs`'s `invoke_handler`.
- `stop_agent_run_recording_first` itself gained the fallback-summary presence check: after
  `interrupt_agent_run` resolves the run's terminal status, if no summary exists yet, one
  `synthesize_fallback_summary` call runs inside its own transaction. This closes a latent gap
  that predates this plan — `apply_session_closed`'s own fallback hook (plan 04-02) only fires the
  FIRST time a run becomes terminal, and a run reaching terminal through the interrupt-then-force
  path (Stop, and now Discard) was already terminal by the time any later `session_closed` event
  for it arrived at `apply_session_closed`, so that hook's presence check was structurally
  unreachable for this path. The fix benefits Stop too, not only Discard.
- `packages/core/tests/discard_lifecycle.rs` (new, 10 tests): simulates the exact database
  sequence `stop_agent_run_recording_first` performs (core cannot import the Tauri command
  directly) and asserts the summary-present/summary-absent outcomes, the already-terminal no-op,
  and explicit before-and-after row counts across `worktrees`/`session_summaries`/`agent_runs`/
  `acceptance_criteria` — the counts are unchanged except `session_summaries`, which gains exactly
  one only when no agent summary landed.
- `discardSession` (`adapters/tauri.ts`) mirrors `stopAgentRun`'s wrapper shape exactly. The
  Discard control in `SessionSurface.tsx` renders beside Stop (never folded into it), copies
  `handleStop`'s ref-based double-activation guard line for line, shows `Discarding…` while both
  controls are disabled, and — on resolution — calls `setLaunchSheetTaskId(taskId)` so the
  developer lands on the pre-filled launch sheet for the same task. A rejected call reuses the
  existing muted `StopWarningNotice` treatment; no second notice component was introduced.
- Deviation (Rule 3 - blocking): `SessionSurface` had no source for its own task id anywhere in
  props or state (the header literally hardcodes "Session" — no task title is rendered anywhere in
  this file). `uiStore.ts`'s `setActiveAgentRunId` gained an optional `taskId` parameter, set
  together with `activeAgentRunId` at its three call sites (`App.tsx`'s `LaunchSheet.onStarted`,
  `BoardView.tsx`'s `onOpenRun`, `useBoardQuery.ts`'s `openLiveSessionForTask`) — each of which
  already held the task id in scope — rather than adding a new backend read.
- `packages/desktop/src/session/__tests__/session-surface.test.tsx` gained a new describe block
  (6 tests): double-synchronous-activation sends exactly one `agent_run_discard` call with no
  dialog role present in between, the in-flight state disables both controls, resolution sets
  `useUiStore.getState().launchSheetTaskId` to the run's own task id, rejection renders the muted
  notice and never opens the launch sheet, and a terminal run renders neither Stop nor Discard.

## Task Commits

Each task was committed atomically:

1. **Task 1: agent_run_discard — a bounded wait, then the path Stop already walks** - `773e511` (feat)
2. **Task 2: The Discard verb, and the hand-off to the launch sheet** - `ac0dde7` (feat)
3. **Task 3: Prove it is one action, and that nothing was lost** - `6f6f055` (test)

**Plan metadata:** commit follows this SUMMARY.

## Files Created/Modified

- `packages/desktop/src-tauri/src/commands/agent_run.rs` - `agent_run_discard`,
  `DISCARD_SUMMARY_WAIT_MS`, `DISCARD_POLL_INTERVAL_MS`, `discard_poll_snapshot`;
  `stop_agent_run_recording_first`'s new fallback-summary presence check
- `packages/desktop/src-tauri/src/main.rs` - registered `agent_run_discard`
- `packages/core/tests/discard_lifecycle.rs` - 10 new tests (created)
- `packages/desktop/src/adapters/tauri.ts` - `discardSession`
- `packages/desktop/src/session/SessionSurface.tsx` - `taskId` prop, `handleDiscard`, the
  Discard control
- `packages/desktop/src/session/__tests__/session-surface.test.tsx` - the Discard describe block,
  a top-level `afterEach(resetUiState)`
- `packages/desktop/src/state/uiStore.ts` - `activeAgentRunTaskId`, `setActiveAgentRunId`'s new
  optional `taskId` parameter
- `packages/desktop/src/App.tsx` - threads `activeAgentRunTaskId` into `SessionSurface`, passes
  `launchSheetTaskId` through `setActiveAgentRunId` on `onStarted`
- `packages/desktop/src/board/BoardView.tsx` - `onOpenRun` now passes `selectedItem.id`
- `packages/desktop/src/board/useBoardQuery.ts` - `openLiveSessionForTask` now passes `taskId`

## Decisions Made

See `key-decisions` in the frontmatter above — summarised: (1) `DISCARD_SUMMARY_WAIT_MS` is
8_000ms with the worst-case arithmetic recorded beside it, (2) the fallback-summary guarantee was
added to the SHARED `stop_agent_run_recording_first`, not duplicated into `agent_run_discard`
alone, so Stop gets the same correctness fix, (3) the task-id plumbing threads through 3
already-informed call sites rather than adding a new backend query, (4) the Discard control reuses
the launch sheet's own filled-accent primary-button styling, (5) no keyboard shortcut ships for
this verb since 01-UI-SPEC.md reserves none.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 2 - Missing Critical] `stop_agent_run_recording_first` now guarantees a fallback summary exists**
- **Found during:** Task 1 (implementing `agent_run_discard`)
- **Issue:** The plan's own must-have truth requires "the run is interrupted, and the fallback
  synthesizer leaves exactly one auto_generated summary" when the wait elapses with no agent
  summary. Reading `apply_session_closed` closely (as the plan's own `<read_first>` directed)
  showed its fallback hook only fires the FIRST time a run becomes terminal — a run already
  terminal via `interrupt_agent_run` (Stop or Discard's own shared path) reaches
  `apply_session_closed`'s "already terminal" branch when the later `session_closed` event
  arrives, which never checks for a missing summary at all. Without a fix, a discarded run with
  no agent summary would end up with ZERO summary rows, violating the plan's own must-have.
- **Fix:** Added a summary-presence check to `stop_agent_run_recording_first` itself (the one
  function both `agent_run_stop` and `agent_run_discard` call), mirroring
  `apply_session_closed`'s own "check existing state; write only the missing piece" shape.
- **Files modified:** `packages/desktop/src-tauri/src/commands/agent_run.rs`
- **Verification:** `cargo test -p core --test discard_lifecycle` (10/10), the two pre-existing
  `stop_agent_run_recording_first` unit tests in `commands/agent_run.rs`'s own test module stay
  green (they assert no summary-related behavior, so unaffected by this addition).
- **Committed in:** `773e511` (Task 1 commit)

**2. [Rule 3 - Blocking] Threaded `taskId` through 3 call sites beyond Task 2's own `<files>`**
- **Found during:** Task 2 (wiring the Discard verb's hand-off to the launch sheet)
- **Issue:** Task 2's own `<files>` names only `tauri.ts` and `SessionSurface.tsx`, but
  `SessionSurface` had no source for its own task id anywhere in props or state — the surface's
  header renders the literal string "Session", never a task title, and no query hook it already
  calls (`useSessionFeed`, `usePendingPermissionRequests`) returns one either. Without this id,
  `handleDiscard`'s `setLaunchSheetTaskId(taskId)` call — D-67's whole point — had nothing to
  call with.
- **Fix:** Added `taskId` to `SessionSurfaceProps`, and `activeAgentRunTaskId` to `uiStore.ts`,
  set together with `activeAgentRunId` via `setActiveAgentRunId`'s new optional second parameter
  at its three call sites — each of which already held the task id in its own scope (`App.tsx`'s
  `launchSheetTaskId` closure variable, `BoardView.tsx`'s `selectedItem.id`,
  `useBoardQuery.ts`'s own `taskId` function parameter). No new Tauri command was added, per the
  plan's own instruction.
- **Files modified:** `packages/desktop/src/state/uiStore.ts`, `packages/desktop/src/App.tsx`,
  `packages/desktop/src/board/BoardView.tsx`, `packages/desktop/src/board/useBoardQuery.ts`
- **Verification:** `npm --prefix packages/desktop run build` (clean), full desktop test suite
  (457/457 before Task 3's own additions, then 463/463 after).
- **Committed in:** `ac0dde7` (Task 2 commit)

---

**Total deviations:** 2 auto-fixed (1 missing critical, 1 blocking).
**Impact on plan:** Both fixes are necessary for the plan's own must-have truths to hold — a
discard with no agent summary must leave one auto_generated row, and the launch-sheet hand-off
must have a task id to open. No scope creep beyond what those two properties require.

## Issues Encountered

- A test-authoring bug (not a product bug): the first draft of the Discard describe block's
  `renderDiscard` helper called `mockWindowReads` unconditionally, which silently overwrote a
  caller's own `invokeCommandMock.mockImplementation` when that call happened BEFORE
  `renderDiscard()` in the test body — two tests (`reads Discarding…`, the rejection test) passed
  the wrong mock outcome as a result, both coincidentally not failing loudly at first because the
  "wrong" outcome happened to overlap with the expected one in two of the four affected tests.
  Root-caused by adding a debug reproduction outside the shared mock scaffolding, then fixed by
  giving `renderDiscard` an explicit optional `impl` parameter installed INSTEAD OF (never before)
  the plain default — resolved before committing Task 3.

## User Setup Required

None - no external service configuration required.

## Next Phase Readiness

- CTX-08 is closed: one activation ends a live session and lands the developer on the launch
  sheet for the same task, with the agent's own closing summary given a bounded window to land
  first and the fallback synthesizer covering the case where it does not — the phase's flagship
  path, and the user-visible half of everything the previous twelve plans in this phase built.
- `stop_agent_run_recording_first`'s new fallback-summary guarantee closes a pre-existing gap in
  the Stop path too (not scoped to this plan's own requirement, but a correctness fix CTX-01
  already implied and this plan's own read-first pass surfaced).
- The `<human-check>` in Task 3 — starting a real session, discarding it, and watching the launch
  sheet open itself with the just-discarded session's summary already in its Prior Sessions list —
  is the one place this plan asks a human to look once; every property it depends on is asserted
  by the automated suites above.
- This is the last plan in Phase 4 (`/clear` Is Free); phase-level verification is the next step.

---
*Phase: 04-clear-is-free*
*Completed: 2026-09-23*

## Self-Check: PASSED

- FOUND: packages/desktop/src-tauri/src/commands/agent_run.rs
- FOUND: packages/desktop/src-tauri/src/main.rs
- FOUND: packages/core/tests/discard_lifecycle.rs
- FOUND: packages/desktop/src/adapters/tauri.ts
- FOUND: packages/desktop/src/session/SessionSurface.tsx
- FOUND: packages/desktop/src/session/__tests__/session-surface.test.tsx
- FOUND: packages/desktop/src/state/uiStore.ts
- FOUND: packages/desktop/src/App.tsx
- FOUND: packages/desktop/src/board/BoardView.tsx
- FOUND: packages/desktop/src/board/useBoardQuery.ts
- FOUND commit 773e511 in git log
- FOUND commit ac0dde7 in git log
- FOUND commit 6f6f055 in git log
- `cargo test -p core --test discard_lifecycle`: 10 passed, 0 failed
- `cargo test -p core --test stop_lifecycle`: 2 passed, 0 failed
- `cargo test -p core --test agent_run_stop_ordering`: 2 passed, 0 failed
- `npm --prefix packages/desktop run test -- src/session/__tests__/session-surface.test.tsx`: 42 passed, 0 failed
- `npm --prefix packages/desktop run test`: 463 passed, 0 failed (32 test files)
- `npm --prefix packages/desktop run build`: clean
- `cargo build --workspace`: clean
- `cargo test --workspace`: exit code 0, no FAILED lines anywhere (including the two
  previously-flaky worktree_lifecycle tests, both passing this run)
