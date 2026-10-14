---
phase: 02-one-agent-one-worktree-watched-live
plan: 02
subsystem: agent-runtime
tags: [typescript, node-child-process, process-groups, rust, rusqlite, tauri, react, tanstack-query, tdd]

# Dependency graph
requires:
  - phase: 02-one-agent-one-worktree-watched-live
    provides: "Plan 02-01's tracer — the sidecar AgentAdapter interface (interruptSession/killSession signatures), the sidecar stdio request loop, SidecarHandle, the agent_run_start command, and SessionSurface.tsx's minimal read path"
provides:
  - "ClaudeCodeAdapter.interruptSession/killSession — real interrupt-then-force with negative-pid process-group signalling and a single exported STOP_GRACE_MS constant"
  - "The session_closed terminal AgentEvent (reason: interrupted | completed | failed) every session now ends with exactly once"
  - "domain::agent_run::interrupt_agent_run — the database/worktree half of D-35, idempotent, never touches git or tasks.status"
  - "SidecarHandle::interrupt_run — the ack-awaiting request/response half of the Rust<->sidecar stdio protocol (the reader loop now actually consumes Ack lines)"
  - "The agent_run_stop Tauri command and its stopAgentRun frontend wrapper"
  - "A Stop affordance and run-status word on SessionSurface.tsx"
affects: [02-03, 02-04, 02-05, 02-06, 02-07, 02-08, 02-09, 02-10]

# Actuals (#2632)
actuals:
  tokens: 19071
  tasks: 3
  commits: 5
  plan_head_before: 086e1585bd647bf861336cb5f8e5a19dac08542f

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "Interrupt-then-force via process-group signalling: SIGINT to -pid, wait STOP_GRACE_MS, escalate to SIGTERM to -pid — never a bare positive-pid signal (RESEARCH.md Pitfall 3)"
    - "Sidecar request/ack correlation: the Rust core's pending_acks map + std::sync::mpsc, keyed by request id, lets a synchronous Tauri command block on an async sidecar round-trip without pulling in tokio::sync"
    - "Idempotent terminal-event emission: a closedEventEmitted/interruptionRequested pair on the sidecar's LiveSession record, and a terminal-status check before interrupt_agent_run's write, both guarantee at most one terminal event/row per run"

key-files:
  created:
    - packages/sidecar/test/stop.test.mjs
    - packages/core/tests/stop_lifecycle.rs
    - .planning/phases/02-one-agent-one-worktree-watched-live/tdd-evidence/02-02-task1-red.json
    - .planning/phases/02-one-agent-one-worktree-watched-live/tdd-evidence/02-02-task2-red.txt
  modified:
    - packages/sidecar/src/adapter.ts
    - packages/sidecar/src/claude-code-adapter.ts
    - packages/sidecar/src/index.ts
    - packages/sidecar/test/fake-claude.mjs
    - packages/sidecar/test/adapter.test.mjs
    - packages/core/src/domain/agent_run.rs
    - packages/desktop/src-tauri/src/sidecar.rs
    - packages/desktop/src-tauri/src/commands/agent_run.rs
    - packages/desktop/src-tauri/src/main.rs
    - packages/desktop/src-tauri/capabilities/default.json
    - packages/desktop/src/adapters/tauri.ts
    - packages/desktop/src/session/SessionSurface.tsx
    - packages/desktop/src/session/__tests__/session-surface.test.tsx

key-decisions:
  - "session_closed carries a synthesized non-empty raw field (`session_closed: <reason>`) rather than an empty string, preserving AgentEventBase's own 'raw is never empty' class invariant for every event type, not just parsed ones"
  - "SidecarHandle::interrupt_run uses std::sync::mpsc (not tokio::sync::oneshot) to keep agent_run_stop a plain synchronous #[tauri::command], matching every other command handler in this codebase rather than introducing the first async one"
  - "SessionSurface takes an optional initialStatus prop (default 'running') rather than a new query — this phase only ever pushes into the surface right after Start Work; a later plan's 'View' affordance for an already-terminal run should pass the real status instead of relying on the default"

patterns-established:
  - "Fixture readiness handshake over an assumption of synchronous-enough timing: a test double that spawns its own grandchild process must have that grandchild signal its own readiness (not just its own existence) before the parent reports it upstream — a separate OS process's own startup is never free"
  - "Test env-var mutation across cargo's concurrently-run #[test] fns must be serialized by a file-local mutex, not merely asserted safe by a comment — verified the hard way, see Deviations"

requirements-completed: [PROC-06, DATA-06, AGNT-01]

coverage:
  - id: D1
    description: "PROC-06's sidecar half: interrupt-then-force reaches the whole process group (negative pid), proven against a real process that ignores SIGINT and has a grandchild only a group signal can reach"
    requirement: PROC-06
    verification:
      - kind: integration
        ref: "packages/sidecar/test/stop.test.mjs (all 5 cases: cooperative interrupt, already-exited no-op, stubborn+grandchild teardown, unknown runId rejection, concurrent-session isolation)"
        status: pass
    human_judgment: false
  - id: D2
    description: "PROC-06's database/worktree half: a stopped run closes interrupted with ended_at set, the task's workflow status is untouched, and the worktree (plus its uncommitted file) survives byte-identical with an unchanged commit count"
    requirement: PROC-06
    verification:
      - kind: integration
        ref: "packages/core/tests/stop_lifecycle.rs (both tests)"
        status: pass
    human_judgment: false
  - id: D3
    description: "A Stop control on the session surface that tells the truth about the in-flight interrupt (Stop -> Stopping… (disabled) -> removed on terminal status), plus a plain-word run-status header"
    requirement: AGNT-01
    verification:
      - kind: unit
        ref: "packages/desktop/src/session/__tests__/session-surface.test.tsx (Stop control describe block, all 4 cases)"
        status: pass
    human_judgment: false
  - id: D4
    description: "End-to-end, in the real packaged app: pressing Stop on a genuinely running session leaves the worktree intact and inspectable from a bare terminal, with no surviving process under it"
    verification: []
    human_judgment: true
    rationale: "This is the plan's own <verification> block's explicit manual step. Every automated layer (D1-D3) is proven against a real spawned process or a real SQLite/git fixture individually, but the full stack — packaged app, real claude session, a human pressing the actual button — has not been observed. Deferred to end-of-phase UAT per workflow.human_verify_mode=end-of-phase, same pattern 02-01-SUMMARY.md used for its own Start Work path."

duration: 55min
completed: 2026-09-10
status: complete
---

# Phase 2 Plan 2: Interrupt-Then-Force Stop, Proven Against a Real Stubborn Process Group Summary

**D-35's stop path shipped end to end — `interruptSession`/`killSession` signal the session's process group (never a bare pid), `interrupt_agent_run` closes the run without ever touching git or the task's status, and a Stop control on the session surface tells the truth about the in-flight interrupt — with the process-group teardown proven against a real spawned process that ignores SIGINT and has a grandchild only a group signal can reach.**

## Performance

- **Duration:** 55 min
- **Started:** 2026-09-10T13:00:27Z (approx.)
- **Completed:** 2026-09-10T13:21:57Z
- **Tasks:** 3/3 completed
- **Files modified:** 17 (13 modified, 4 created)

## Accomplishments

- **`ClaudeCodeAdapter.interruptSession`/`killSession` rewritten for real interrupt-then-force**: SIGINT to the session's process group (`process.kill(-pid, ...)`, never a bare positive pid), a single exported `STOP_GRACE_MS` constant, escalation to a group SIGTERM only after the grace window, idempotent on an already-closed session, and a typed `UnknownRunError` rejected *before* any signal is sent for a `runId` this sidecar never spawned (T-02-11).
- **The `session_closed` terminal `AgentEvent`**: every session now ends with exactly one of these (`reason: interrupted | completed | failed`, carrying the last `result` payload when one arrived) — emitted from exactly one place (`emitSessionClosed`), guarded against a second emission by a `closedEventEmitted` flag on the session record.
- **A real stubborn-process proof, not a mock**: `packages/sidecar/test/fake-claude.mjs`'s new stubborn mode ignores SIGINT and forks a grandchild that only a process-GROUP signal can reach; `stop.test.mjs`'s group-teardown case reads the grandchild's real pid and asserts `process.kill(pid, 0)` throws `ESRCH` after the force step.
- **`domain::agent_run::interrupt_agent_run`**: the database/worktree half — moves a run to `interrupted`, sets `ended_at`, appends a human-renderable `agent_run.interrupted` event, and structurally cannot touch `crate::git` (grep-gated) or `tasks.status` (never a task moves out of In Progress in this phase, D-29).
- **`SidecarHandle::interrupt_run`**: the Rust core now actually consumes the sidecar's `Ack` lines (previously parsed and discarded) via a `pending_acks` map, letting the synchronous `agent_run_stop` command block on the sidecar's real interrupt-then-force round trip before writing the run's terminal status.
- **A Stop control on `SessionSurface.tsx`**: `Stop` → `Stopping…` (disabled) → removed once a `session_closed` push arrives — the terminal status is read from the pushed delta, never assumed from the mutation's own resolved promise. The run status also renders as one of five plain words in the header, deliberately with no glyph or new colour token this plan (02-03/02-07 own those).

## Task Commits

Each task was committed atomically (Tasks 1 and 2 carried `tdd="true"` — full RED→GREEN cycles):

1. **Task 1 RED: failing stop-path tests** — `0f5d47a` (test)
2. **Task 1 GREEN: interrupt-then-force implementation** — `7bd4d5a` (feat)
3. **Task 2 RED: failing stop_lifecycle test** — `10e652a` (test)
4. **Task 2 GREEN: interrupt_agent_run + agent_run_stop wiring** — `c6dd3d7` (feat)
5. **Task 3: Stop affordance on the session surface** — `2a58d5d` (feat)

**Plan metadata:** (this commit)

_No REFACTOR commits — neither TDD cycle needed a separate cleanup pass beyond what GREEN already produced cleanly._

## Files Created/Modified

See `key-files` in frontmatter. Highlights:
- `packages/sidecar/src/claude-code-adapter.ts` — the interrupt-then-force rewrite
- `packages/sidecar/test/fake-claude.mjs` — stubborn mode + grandchild readiness handshake
- `packages/core/src/domain/agent_run.rs` — `interrupt_agent_run`
- `packages/desktop/src-tauri/src/sidecar.rs` — ack-awaiting `interrupt_run`
- `packages/desktop/src/session/SessionSurface.tsx` — Stop control + status word

## Decisions Made

- `session_closed` carries a synthesized non-empty `raw` (`session_closed: <reason>`), not an empty string — keeps "every event has a non-empty raw field" a real invariant instead of an exception for one event type.
- `SidecarHandle::interrupt_run` uses `std::sync::mpsc`, not `tokio::sync::oneshot` — keeps `agent_run_stop` a plain synchronous `#[tauri::command]`, matching every other handler in this codebase, at the cost of a 30s hard ceiling on the ack wait (generous over the sidecar's own 5s `STOP_GRACE_MS`).
- `SessionSurface` takes an optional `initialStatus` prop (default `"running"`) instead of a new status-read command — this phase never opens the surface except right after Start Work; a future "View" affordance for an already-finished run is the natural place to thread a real starting status through.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 1 - Bug] `adapter.test.mjs`'s pre-existing "last event is `result`" assertion broke under this task's own new terminal event**
- **Found during:** Task 1 GREEN, first full `npm --prefix packages/sidecar test` run after implementing `session_closed`
- **Issue:** The pre-existing normalised-stream test asserted `events[events.length - 1].type === "result"` and that every event's `raw` field is non-empty. Since every session now correctly ends with a `session_closed` event (this task's own intended behavior), the last event became `session_closed` (whose `raw` was then empty), breaking both assertions.
- **Fix:** Gave `session_closed` a synthesized non-empty `raw`; updated the test to assert `result` is second-to-last and `session_closed` (`reason: "completed"`) is last.
- **Files modified:** `packages/sidecar/src/claude-code-adapter.ts`, `packages/sidecar/test/adapter.test.mjs`
- **Verification:** `npm --prefix packages/sidecar test` — 8/8 pass
- **Committed in:** `7bd4d5a`

**2. [Rule 1 - Bug] The stubborn fixture's grandchild died from the interrupt step alone, collapsing the interrupt-vs-force distinction under test**
- **Found during:** Task 1 GREEN, debugging why the stubborn/grandchild-teardown test resolved in ~4ms instead of the expected ~5s grace window (only reproduced when the test used a fast polling wait before signalling, not a flat delay — traced to a genuine race, not a flaky timing artifact)
- **Issue:** The grandchild (`node -e "setInterval(...)"`) had no SIGINT handler of its own. A group SIGINT (the *interrupt* step) reaches every process in the group, including the grandchild — its default disposition (terminate) killed it on the interrupt step alone. Losing the grandchild starved the parent fake-claude process's only remaining event-loop reference (a plain script with just signal handlers registered has nothing else keeping it alive), so the *parent* then exited too, even though its own SIGINT handler was a no-op. The test's own timing observed this as a false-fast "successful" interrupt when in fact the force step was never actually reached or proven.
- **Fix:** The grandchild's own `-e` script now also ignores SIGINT (it has no SIGTERM handler, so the force step's default disposition still ends it), and — since spawning a second OS process is not free — it signals its own readiness (`console.log('ready')` after registering the handler) over a piped stdout that `fake-claude.mjs` waits on before ever reporting the grandchild's pid upstream. Without this handshake, a test built to send the interrupt "as soon as the pid is known" could still race the grandchild's own Node.js startup.
- **Files modified:** `packages/sidecar/test/fake-claude.mjs`
- **Verification:** `stop.test.mjs`'s stubborn case now stable at ~5080ms across repeated runs (was ~4ms); the group-teardown assertion (`process.kill(grandchildPid, 0)` throws `ESRCH`) now genuinely follows a real force step.
- **Committed in:** `7bd4d5a`

**3. [Rule 1 - Bug] `stop_lifecycle.rs`'s test helper raced on a process-global env var and leaked a real directory into the developer's home folder**
- **Found during:** Task 2 GREEN, first `cargo test -p core --test stop_lifecycle` run with both tests present
- **Issue:** `with_scratch_worktree_root` mutates the process-global `FLYWHEEL_WORKTREE_ROOT` env var with a comment claiming "tests in this crate run single-threaded per binary" — untrue by default (`cargo test` runs a binary's `#[test]` fns concurrently on a thread pool). The two tests in this file raced, and one fell through to the real default (`~/Flywheel/...`) mid-test, creating an actual `~/Flywheel/FLY/FLY-1` directory on the machine running the test — cleaned up as part of this fix.
- **Fix:** Added a file-local `static Mutex<()>` serializing every call to `with_scratch_worktree_root` in this binary.
- **Files modified:** `packages/core/tests/stop_lifecycle.rs`
- **Verification:** `cargo test -p core --test stop_lifecycle` stable across 3 repeated runs; `~/Flywheel` confirmed absent afterward.
- **Committed in:** `c6dd3d7`
- **Note:** The identical unguarded pattern exists in `packages/core/tests/worktree_lifecycle.rs` (plan 02-01) — out of this plan's file scope, logged to `.planning/WINDOWS.md` rather than fixed here.

---

**Total deviations:** 3 auto-fixed (all Rule 1 — bugs this task's own changes exposed or introduced, fixed and verified before proceeding).
**Impact on plan:** All three were necessary for the plan's own verify commands to pass and for the stubborn-process proof (PROC-06's central falsifiability requirement) to actually prove what it claims. No scope creep beyond what each task's own `<action>`/`<behavior>`/`<acceptance_criteria>` already specified.

## Issues Encountered

None beyond the deviations documented above. The stubborn-fixture race (Deviation 2) took the bulk of this plan's debugging time — a textbook case of a test that "passes" (fast, green) while silently not exercising the behavior it claims to prove; caught only because the timing looked suspiciously fast rather than because any assertion failed.

## User Setup Required

None — no external service configuration required.

## Next Phase Readiness

- Plans 02-03 through 02-10 can build on `interruptSession`/`killSession`'s real (not tracer-stub) behavior, `session_closed`, and `interrupt_agent_run` without re-deriving any of this.
- **Not yet human-observed:** the plan's own manual verification step — starting a real session, pressing Stop in the packaged app, and confirming from a bare terminal that the worktree is intact and no process survives under it. Deferred to end-of-phase UAT per `workflow.human_verify_mode: end-of-phase`, same pattern 02-01-SUMMARY.md used. Logged to `.planning/WINDOWS.md`.
- **Carried forward, not introduced here:** `worktree_lifecycle.rs`'s own unguarded env-var race (see Deviation 3's note) — logged to `.planning/WINDOWS.md`, not fixed (out of this plan's file scope).
- Boundary held: this plan built no crash recovery, no orphan reaping at launch, and no refuse-to-destroy-a-dirty-worktree guard — those remain Phase 3's (WORK-03, PROC-04, PROC-05), exactly as scoped.

---
*Phase: 02-one-agent-one-worktree-watched-live*
*Completed: 2026-09-10*

## Self-Check: PASSED

All 4 files listed under `key-files.created` verified present on disk with `[ -f ]`. All 5 task
commits (`0f5d47a`, `7bd4d5a`, `10e652a`, `c6dd3d7`, `2a58d5d`) verified present in
`git log --oneline --all`. Every `<acceptance_criteria>` item across Tasks 1-3 re-run and passing:
`npm --prefix packages/sidecar test` (8/8), `cargo test -p core --test stop_lifecycle` (2/2),
`cargo test -p core` (all green), `cargo test --workspace` (all green), `cargo build --workspace`
(clean), `npm --prefix packages/desktop run test` (161/161), `npm --prefix packages/desktop run
build` (no TypeScript errors), plus every grep-based structural gate (`process.kill(-` count,
`STOP_GRACE_MS =` single-declaration, no bare-pid `child.kill(`, zero `SIGKILL` in
`packages/sidecar/src`, zero `git_at(`/`crate::git` in `agent_run.rs`, single-Tauri-seam, no
`legend/marks` import, no keydown listener). The plan-level `<verification>` block's one manual
item (real packaged-app GUI check) is not re-run here — it requires a human at a GUI — see "Next
Phase Readiness".
