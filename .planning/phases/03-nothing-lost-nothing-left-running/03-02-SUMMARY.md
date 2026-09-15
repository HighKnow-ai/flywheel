---
phase: 03-nothing-lost-nothing-left-running
plan: 02
subsystem: process-supervision
tags: [rust, typescript, node, process-groups, heartbeat, watchdog, tauri-sidecar]

requires:
  - phase: 02-supervised-agents-that-answer-for-themselves
    provides: "claude-code-adapter.ts's single spawn(bin, argv, {detached:true}) call site,
      LiveSession, interruptSession/killSession's negative-pid group signalling, sidecar.rs's
      spawn_sidecar/SidecarHandle/PersistOutcome returned-enum idiom"
provides:
  - "packages/core/src/runtime_protocol.rs — the on-disk runtime protocol: runtime_dir,
    touch_heartbeat/read_heartbeat_age, write_kill_record/read_kill_record,
    write_run_descriptor/list_run_descriptors, RuntimeIo/KillRecordRead, KillRecord/RunDescriptor,
    HEARTBEAT_INTERVAL_MS/HEARTBEAT_POLL_MS/HEARTBEAT_STALE_MS — every failure mode returned,
    never a panic, and no rusqlite/Connection reference anywhere in the module"
  - "packages/sidecar/src/watchdog.ts — the per-session wrapper: leads the process group,
    spawns the backend as its own child inside it, fails closed without FLYWHEEL_RUNTIME_DIR,
    force-kills the whole group with no grace window on heartbeat staleness, writes the kill
    record before signalling"
  - "The promoted PROC-03 noun: the session's process group, led by its watchdog — the referent
    every future D-47/D-48-adjacent plan (03-06's launch reconciler, 03-10's recovery copy)
    should read/write against"
affects: [03-06, 03-10]

actuals:
  tokens: 15505
  tasks: 3
  commits: 3
plan_head_before: 9f65ec3

tech-stack:
  added: []
  patterns:
    - "Cross-language on-disk protocol by convention, not shared serializer: Rust's
      runtime_protocol.rs and TypeScript's watchdog.ts/claude-code-adapter.ts each independently
      write/read the identical snake_case JSON shape (run_id/pid/start_time/reason/killed_at),
      asserted by both files' own doc comments rather than a generated schema"
    - "Fail-closed configuration gate: a wrapper process that finds its own required environment
      variable missing exits non-zero BEFORE spawning the thing it would otherwise supervise,
      rather than silently degrading to an unsupervised passthrough (T-03-02-02)"
    - "Sentinel stdout line across a process boundary a promise-based caller can't otherwise
      observe: watchdog.ts reports its own child's spawn failure as one JSON line on its own
      stdout (ahead of any real stream-json), which claude-code-adapter.ts checks for before
      treating a line as backend output — lets a wrapper-mediated spawn failure still reject the
      caller's promise exactly as a direct spawn failure always did"

key-files:
  created:
    - packages/core/src/runtime_protocol.rs
    - packages/core/tests/runtime_protocol.rs
    - packages/sidecar/src/watchdog.ts
    - packages/sidecar/test/watchdog.test.mjs
  modified:
    - packages/core/src/lib.rs
    - packages/desktop/src-tauri/src/sidecar.rs
    - packages/sidecar/src/claude-code-adapter.ts
    - packages/sidecar/package.json
    - packages/sidecar/test/stop.test.mjs

key-decisions:
  - "The run descriptor (<runtime>/runs/<runId>.json) is written by claude-code-adapter.ts, not
    watchdog.ts — the adapter is the one process that knows the WRAPPER's pid (its own spawn's
    return value) and can read its OS start time; watchdog.ts recomputes its own pid/start-time
    directly when writing a kill record, rather than reading that file back, so a kill record
    never depends on a write that may not have landed yet"
  - "The kill record's pid field names the WATCHDOG's own pid (the process-group leader,
    PROC-03's promoted noun) — the same pid interruptSession/killSession already signal via
    -child.pid — never the backend's own inner pid, keeping one consistent referent for 'the
    process this protocol tracks' end to end"
  - "A backend spawn failure inside the watchdog (e.g. FLYWHEEL_CLAUDE_BIN pointing nowhere) is
    reported via one sentinel-shaped JSON line on the watchdog's own stdout, checked by the
    adapter before generic stream-json parsing — preserves credentials.test.mjs's pre-existing
    'startSession rejects naming the missing binary' contract, which a silent close-based
    resolution would have broken"
  - "stop.test.mjs's own defensive cleanup net was converted from a broad `pkill -f
    <fake-claude path>` to signalling by process group scoped to pids the file itself observed
    — the broad match could (and, observed directly this session, did) tear down a sibling test
    file's still-legitimately-running session, a collision this plan's extra per-session process
    made materially more likely to land mid-suite"

patterns-established:
  - "HEARTBEAT_STALE_MS/HEARTBEAT_POLL_MS/HEARTBEAT_INTERVAL_MS are one set of named Rust
    constants with doc-comment-stated tradeoffs, stringified into env vars
    (FLYWHEEL_HEARTBEAT_STALE_MS/FLYWHEEL_HEARTBEAT_POLL_MS) rather than duplicated as literals
    on both sides of the language boundary; watchdog.ts falls back to matching literal defaults
    only when a caller invokes it directly without going through resolved_env_for_run"

requirements-completed: [PROC-03, PROC-04]

coverage:
  - id: D1
    description: "While Flywheel is alive, a heartbeat file under the app-data runtime directory
      is touched on a fixed interval by the Rust core"
    requirement: "PROC-03"
    verification:
      - kind: unit
        ref: "packages/core/tests/runtime_protocol.rs#touch_heartbeat_writes_a_parseable_rfc3339_timestamp"
        status: pass
      - kind: integration
        ref: "packages/sidecar/test/watchdog.test.mjs#a fresh heartbeat leaves both the watchdog and its backend alive across at least three poll intervals"
        status: pass
    human_judgment: false
  - id: D2
    description: "When the heartbeat stops being touched, the watchdog notices within its poll
      interval and force-kills its own process group with no grace window — no interrupt-then-
      force sequence, straight to force"
    requirement: "PROC-04"
    verification:
      - kind: integration
        ref: "packages/sidecar/test/watchdog.test.mjs#ceasing to touch the heartbeat kills both the watchdog and the backend within one stale window plus one poll interval"
        status: pass
      - kind: unit
        ref: "packages/sidecar/src/watchdog.ts (grep -cE 'SIGINT|SIGTERM' <= 1 non-comment line — no interrupt-then-force sequence exists)"
        status: pass
    human_judgment: false
  - id: D3
    description: "Before terminating, the watchdog writes a kill record naming the run id, the
      pid it killed, the reason and the timestamp, beside the heartbeat file"
    requirement: "PROC-04"
    verification:
      - kind: integration
        ref: "packages/sidecar/test/watchdog.test.mjs#a kill record for the run exists on disk, parses as JSON, and names the reason, pid and a timestamp"
        status: pass
      - kind: unit
        ref: "packages/core/tests/runtime_protocol.rs#kill_record_round_trips_with_the_fields_a_watchdog_writes"
        status: pass
    human_judgment: false
  - id: D4
    description: "The watchdog never opens, reads or writes the SQLite database — it drops files
      for the Rust core to read and nothing else"
    verification:
      - kind: other
        ref: "grep -v '^\\s*//' packages/core/src/runtime_protocol.rs | grep -cE 'rusqlite|Connection' == 0; packages/sidecar/src/watchdog.ts imports only node:child_process/node:fs/node:path"
        status: pass
    human_judgment: false
  - id: D5
    description: "The watchdog wrapper is the session's process-group leader and spawns the
      backend as its own child inside that same group, so interruptSession/killSession's
      existing negative-pid signalling reaches both with no change to their own code"
    requirement: "PROC-03"
    verification:
      - kind: integration
        ref: "packages/sidecar/test/stop.test.mjs, packages/sidecar/test/shutdown.test.mjs (full suite, unmodified assertions, still green post-wrapper)"
        status: pass
      - kind: integration
        ref: "packages/sidecar/test/watchdog.test.mjs#sending the force signal to the negation of the watchdog's pid kills both the watchdog and the backend"
        status: pass
    human_judgment: false
  - id: D6
    description: "A heartbeat or kill-record I/O failure is a returned enum value, never a
      panic"
    verification:
      - kind: unit
        ref: "packages/core/tests/runtime_protocol.rs#no_panicking_calls_survive_in_the_runtime_protocol_module"
        status: pass
      - kind: unit
        ref: "packages/core/tests/runtime_protocol.rs#touch_heartbeat_returns_write_failed_never_panics_when_the_directory_is_blocked"
        status: pass
    human_judgment: false
  - id: D7
    description: "Whole-application proof: kill -9 on the running Flywheel process leaves no
      claude process behind and writes a kill record — success criterion 2's 'including when the
      supervisor is killed rather than closed cleanly' clause"
    verification: []
    human_judgment: true
    rationale: "No packaged/running Tauri application was available to this executor session —
      this needs the real supervisor+sidecar+session process tree, which Task 3's own
      <human-check> block names explicitly as untestable by any harness in this repository.
      Deferred to /gsd-verify-work per workflow.human_verify_mode: end-of-phase."

duration: 46min
completed: 2026-09-15
status: complete
---

# Phase 3 Plan 2: Heartbeat and Watchdog Close the Sidecar-Death Gap Summary

**A 2-second heartbeat file touched by the Rust core while Flywheel is alive, and a per-session Node watchdog wrapper — now the true process-group leader — that force-kills its own group with no grace window and writes a kill record the instant that heartbeat goes stale for 15 seconds, closing the one gap `RunEvent::Exit`'s existing shutdown sequence never covered: a SIGKILL of the supervisor itself.**

## Performance

- **Duration:** 46 min
- **Started:** 2026-09-15T01:03:00Z
- **Completed:** 2026-09-15T01:49:09Z
- **Tasks:** 3
- **Files modified:** 9

## Accomplishments

- `packages/core/src/runtime_protocol.rs` — the on-disk runtime protocol shared by convention
  with the Node sidecar: heartbeat touch/read, kill-record write/read (three-way
  Found/Absent/Malformed outcome), run-descriptor write/list, all failure modes returned as
  `RuntimeIo`/`KillRecordRead` values, zero `unwrap()`/`expect(`/`panic!`, zero
  `rusqlite`/`Connection` reference — proved by 12 tests including two source-scanning gates
- `packages/desktop/src-tauri/src/sidecar.rs` — a detached heartbeat-writer thread started after
  `spawn_sidecar`'s own readiness handshake succeeds, stopped from `SidecarHandle::kill`;
  `resolved_env_for_run` now carries `FLYWHEEL_RUNTIME_DIR`/`FLYWHEEL_HEARTBEAT_STALE_MS`/
  `FLYWHEEL_HEARTBEAT_POLL_MS` into every spawned session's environment
- `packages/sidecar/src/watchdog.ts` — every session now runs under this wrapper instead of the
  backend directly: it becomes the process-group leader (via its own parent's `detached: true`),
  spawns the backend as a plain child inside that group, fails closed if
  `FLYWHEEL_RUNTIME_DIR` is missing, and force-kills the whole group with a straight-to-SIGKILL
  no-grace step the instant the heartbeat file reads stale
- `claude-code-adapter.ts`'s one `spawn(bin, argv, {...})` call site now spawns the watchdog
  wrapper instead — `interruptSession`/`killSession`, `STOP_GRACE_MS` and `LiveSession` are
  **byte-unchanged**, because they already signalled `-child.pid`, and that pid is now the
  wrapper's own, whose group contains the backend too
- `packages/sidecar/test/watchdog.test.mjs` — PROC-04 proved against real spawned processes: a
  fresh heartbeat keeps both watchdog and backend alive across three poll intervals; ceasing to
  touch it kills both within one stale window plus one poll interval; the resulting kill record
  parses as JSON naming run/pid/reason/timestamp; a direct group SIGKILL kills both; and no
  heartbeat file at all leaves the backend alive at half the stale window (the launch-race grace
  period) — every assertion probes a pid directly, never inferred from an exit event

## Task Commits

Each task was committed atomically:

1. **Task 1: The on-disk runtime protocol — heartbeat, per-run descriptor, kill record** - `070358e` (feat)
2. **Task 2: The watchdog wrapper becomes the group leader, and the backend becomes its child** - `78a304d` (feat)
3. **Task 3: PROC-04 proved with real processes — kill the supervisor, watch the group die** - `9bc1403` (test)

**Plan metadata:** committed alongside this SUMMARY (see final commit).

_Note: All three tasks carry `tdd="true"`, but this project's `workflow.tdd_mode` is not enabled
(absent from `.planning/config.json`), so gate enforcement (RED-evidence checks,
`test(...)`-then-`feat(...)` commit splitting) was not mandatory. Each task's tests and
implementation were authored together and verified green before a single commit per task — the
same "TDD-flavored, not strict TDD-gated" pattern plan 03-01's own SUMMARY recorded for this
phase._

## Files Created/Modified

- `packages/core/src/runtime_protocol.rs` - the on-disk runtime protocol (heartbeat/kill-record/run-descriptor)
- `packages/core/src/lib.rs` - declares the new module
- `packages/core/tests/runtime_protocol.rs` - 12 round-trip and gate tests
- `packages/desktop/src-tauri/src/sidecar.rs` - heartbeat-writer thread, env additions for spawned sessions
- `packages/sidecar/src/watchdog.ts` - the per-session watchdog wrapper (new module)
- `packages/sidecar/src/claude-code-adapter.ts` - spawns the wrapper instead of the backend; writes the run descriptor; detects a wrapper-reported spawn failure
- `packages/sidecar/test/watchdog.test.mjs` - 5 real-process PROC-04 tests
- `packages/sidecar/test/stop.test.mjs` - defensive cleanup net converted to scoped pid-group signalling
- `packages/sidecar/package.json` - test script exports a scratch `FLYWHEEL_RUNTIME_DIR` and a generous `FLYWHEEL_HEARTBEAT_STALE_MS` for the existing (heartbeat-less) test suites

## Decisions Made

See `key-decisions` in frontmatter above.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 3 - Blocking] Existing sidecar test suites needed `FLYWHEEL_RUNTIME_DIR`/a generous stale window to keep passing**
- **Found during:** Task 2, running the full pre-existing sidecar suite after wiring the watchdog into `claude-code-adapter.ts`
- **Issue:** Every pre-existing sidecar test (`adapter`, `stop`, `shutdown`, `permission`, `credentials`) calls `adapter.startSession(...)` directly with no `FLYWHEEL_RUNTIME_DIR` set, and none of them run a real heartbeat writer. The watchdog's fail-closed check (T-03-02-02) correctly refused to spawn any backend at all under that missing env var, and even once that was fixed, the default 15s stale threshold killed at least one intentionally long-held test session (see deviation 3) before its own 25-second assertion window completed.
- **Fix:** `packages/sidecar/package.json`'s `test` script now exports a fresh `FLYWHEEL_RUNTIME_DIR` (via `mktemp -d`) and `FLYWHEEL_HEARTBEAT_STALE_MS=120000` for the whole `npm test` invocation, respecting either var if a caller already set one.
- **Files modified:** packages/sidecar/package.json
- **Verification:** `npm --prefix packages/sidecar test` — 44/44 passing, run 3× consecutively with no flake
- **Committed in:** `78a304d`

**2. [Rule 1 - Bug] `credentials.test.mjs`'s "missing binary" test broke because the adapter's own child is now the wrapper**
- **Found during:** Task 2, first full-suite run after the spawn-call-site change
- **Issue:** `adapter.startSession` used to reject when the CHILD process itself failed to spawn (a direct `spawn(bin,...)` ENOENT). After wiring the watchdog, `child` is the wrapper (which spawns fine, since `process.execPath`+`watchdog.js` always exist); a backend-level ENOENT now happens INSIDE the watchdog process, invisible to the adapter's own `child.on("error")` handler — `startSession` would have silently resolved instead of rejecting, breaking `credentials.test.mjs`'s pre-existing "rejects naming the missing binary" assertion.
- **Fix:** `watchdog.ts` reports its own child's spawn error as one sentinel-shaped JSON line on its own stdout before exiting; `claude-code-adapter.ts`'s `rl.on("line", ...)` handler checks for that shape before generic stream-json parsing and, on a match, rejects `startSession` exactly as the old direct-spawn-error path did.
- **Files modified:** packages/sidecar/src/watchdog.ts, packages/sidecar/src/claude-code-adapter.ts
- **Verification:** `credentials.test.mjs`'s "starting a run under the local mode with the binary absent..." test passes
- **Committed in:** `78a304d`

**3. [Rule 1 - Bug] `stop.test.mjs`'s broad `pkill -f <fake-claude path>` cross-file collision became load-bearing**
- **Found during:** Task 2, intermittent full-suite failures of `permission.test.mjs`'s 25-second held-open-session test
- **Issue:** `stop.test.mjs`'s own defensive `after()` cleanup ran `pkill -f <fake-claude.mjs path>` — a pattern every sidecar test file's spawned processes match, since they all point `FLYWHEEL_CLAUDE_BIN` at the same fixture. `shutdown.test.mjs`'s own doc comment already flagged this as a known, accepted collision risk in this file's precedent. Adding a second process per session (the watchdog) shifted this file's own timing enough, relative to its siblings, that the collision reproducibly fired mid-suite this session — confirmed directly by reverting to the pre-plan baseline and observing 39/39 pass, then re-applying the change and observing the exact same permission test die with `session_closed: failed` at the SIGTERM this pkill sent.
- **Fix:** `stop.test.mjs` now tracks the one grandchild pid its own "stubborn" test observes and, in `after()`, resolves that pid's process-group id and signals only that group — never a broad name-based match, mirroring `shutdown.test.mjs`'s own already-safer `processGroupIdOf` idiom.
- **Files modified:** packages/sidecar/test/stop.test.mjs
- **Verification:** `npm --prefix packages/sidecar test` run 5× total across this session (2 before the fix reproduced the flake, 3 after did not)
- **Committed in:** `78a304d`

---

**Total deviations:** 3 auto-fixed (1 blocking/missing-env-var, 2 bugs directly caused by this plan's own spawn-call-site change)
**Impact on plan:** All three were necessary to keep the pre-existing test suite green while wiring the watchdog in, exactly as Task 2's own acceptance criteria required. No scope creep — every fix lives in a file the plan already touches or a sibling test file whose own collision risk this plan's change exposed.

## Issues Encountered

Debugging the intermittent `permission.test.mjs` failure (deviation 3) required isolating the
full test suite against a temporarily-reverted baseline to prove the flake was newly-introduced
rather than pre-existing — confirmed via three separate full-suite runs on each side. Root cause
(the broad `pkill -f` cross-file collision) was found by adding temporary debug instrumentation
to `watchdog.ts`'s `child.on("exit")` handler, which is not present in the final diff.

## User Setup Required

None - no external service configuration required.

## Next Phase Readiness

- `runtime_protocol.rs`'s `list_run_descriptors`/`read_kill_record` are ready for plan 03-06's
  launch reconciler to read directly.
- The promoted PROC-03 noun (the process group, led by its watchdog) is now the referent every
  later plan touching session liveness should read/write against — plan 03-06 in particular,
  which is what actually consumes `RunDescriptor.start_time` for a pid-reuse-safe liveness check
  (this plan only writes it; nothing in this plan's own scope reads it back for that purpose yet).
- D7 (the whole-application `kill -9` proof) is the one deliverable this plan could not verify
  directly — carried forward to `/gsd-verify-work`'s end-of-phase UAT batch per
  `workflow.human_verify_mode: end-of-phase`.
- No blockers for the next plan in this phase.

---
*Phase: 03-nothing-lost-nothing-left-running*
*Completed: 2026-09-15*
