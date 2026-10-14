---
phase: 02-one-agent-one-worktree-watched-live
plan: 15
subsystem: infra
tags: [tauri, tauri-plugin-shell, sidecar, tokio, bash, node, gap-closure]

requires:
  - phase: 02-one-agent-one-worktree-watched-live
    provides: the dev-time sidecar stub bridging tauri-plugin-shell's externalBin requirement to packages/sidecar/dist/index.js (plan 02-01), and the sidecar reader loop CR-03 hardened against per-run I/O faults (plan 02-12)
provides:
  - a dev sidecar stub whose entrypoint resolution holds from both its checked-in location and the location Tauri actually runs it from
  - a bounded startup readiness handshake (`ping` op + `spawn_sidecar`) that proves the sidecar is alive and speaking its own protocol before application startup is allowed to proceed
  - reader-loop observation of sidecar stderr and process lifecycle (Terminated/Error), not only stdout
  - test coverage of the Tauri-copied invocation path, with a falsifiable negative case
affects: [02-16, 02-17, 02-18]

actuals:
  tokens: 12106
  tasks: 3
  commits: 4

tech-stack:
  added: []
  patterns:
    - "Startup readiness handshake: write a fixed-id request to a freshly-spawned child's stdin and drive a bounded wait over the raw spawn receiver BEFORE constructing the long-lived handle or moving the receiver into the reader task — used here because main.rs's .setup() closure runs before AppState (and its pending_acks mechanism) is managed."
    - "Dev-stub entrypoint resolution walks up from the script's own physical (symlink-resolved) directory for a fixed marker path, never a fixed parent-hop count, because the file runs from two different depths."

key-files:
  created:
    - packages/sidecar/test/stub-invocation.test.mjs
  modified:
    - packages/desktop/src-tauri/binaries/flywheel-sidecar-aarch64-apple-darwin
    - packages/desktop/src-tauri/src/sidecar.rs
    - packages/desktop/src-tauri/Cargo.toml
    - packages/sidecar/src/index.ts

key-decisions:
  - "Committed the pre-existing, UAT-verified interim patch to the stub as its own commit before hardening it further, so the already-proven fix and the plan's additional hardening are separately reviewable and separately revertable."
  - "The readiness handshake reads the sidecar's spawn receiver directly rather than routing through the existing pending_acks/AppState mechanism, because spawn_sidecar runs before app.manage(AppState) in main.rs's setup closure."
  - "ping is a distinct op from capability_probe: ping asks only whether this process is alive and speaking its own protocol (no side effect, no backend dependency), while capability_probe spawns the user's claude binary — conflating the two would gate application startup on a question about the user's environment rather than the sidecar's own health."

requirements-completed: [PROC-01, PROC-02, AGNT-01]

coverage:
  - id: D1
    description: "The dev sidecar stub resolves its Node entrypoint correctly from both its checked-in location and the Tauri-copied location, and the fix is committed"
    requirement: "PROC-01"
    verification:
      - kind: other
        ref: "manual: ./packages/desktop/src-tauri/binaries/flywheel-sidecar-aarch64-apple-darwin </dev/null exits 0 from checked-in location, from a scratch dir at the same depth as target/debug/, and exits 127 with an actionable message from outside the repository"
        status: pass
      - kind: integration
        ref: "test/stub-invocation.test.mjs#the stub boots the sidecar from the location tauri copies it to"
        status: pass
      - kind: integration
        ref: "test/stub-invocation.test.mjs#the stub run from outside the repository fails with an actionable message"
        status: pass
    human_judgment: false
  - id: D2
    description: "A sidecar that exits immediately after spawn aborts application startup naming its own cause, instead of surfacing later as a stdin write failure"
    requirement: "PROC-01"
    verification:
      - kind: unit
        ref: "cargo test --workspace (sidecar::persist_tests, commands::agent_run::tests) — 0 failures; spawn_sidecar's handshake logic is exercised indirectly by the workspace build and the real-process ping round-trip below, since it requires a real Tauri AppHandle to invoke directly"
        status: pass
      - kind: other
        ref: "manual: node packages/sidecar/dist/index.js given a ping request over stdin replies {\"kind\":\"ack\",\"id\":\"startup-readiness-check\",\"ok\":true} on stdout — the exact ack shape spawn_sidecar's handshake waits for"
        status: pass
    human_judgment: true
    rationale: "The handshake's failure branches (Terminated/Error/timeout aborting real Tauri app startup) require a running Tauri app to observe end-to-end; this plan proves the protocol and the code path compiles and the ack round-trips, but a human running the packaged app against a genuinely broken sidecar is the strongest confirmation."
  - id: D3
    description: "The reader loop observes sidecar stderr and process termination/error, not only stdout, so a mid-session sidecar death is a developer breadcrumb instead of silent"
    requirement: "PROC-02"
    verification:
      - kind: unit
        ref: "cargo build --workspace — compiles the CommandEvent::Stderr/Terminated/Error arms plus a non_exhaustive catch-all"
        status: pass
    human_judgment: false
  - id: D4
    description: "The Tauri-copied invocation path is covered by a test that runs the stub the way the application runs it, including a falsifiable negative case"
    requirement: "AGNT-01"
    verification:
      - kind: unit
        ref: "test/stub-invocation.test.mjs (3 tests, all pass); npm --prefix packages/sidecar test reports 32/32 (was 29 before this plan)"
        status: pass
    human_judgment: false

duration: 45min
completed: 2026-09-11
status: complete
---

# Phase 2 Plan 15: Sidecar Startup Readiness Handshake and Stub Hardening (G-02-1) Summary

**Closed gap G-02-1: the dev sidecar stub now resolves its entrypoint correctly from every location it runs from, `spawn_sidecar` proves the sidecar is alive and speaking its own protocol via a bounded `ping` handshake before startup proceeds, and the Tauri-copied invocation path is now covered by tests with a falsifiable negative case.**

## Performance

- **Duration:** 45 min
- **Started:** 2026-09-11T08:13:00Z (approx.)
- **Completed:** 2026-09-11T08:58:03Z
- **Tasks:** 3
- **Files modified:** 4 (1 created, 4 modified — `stub-invocation.test.mjs` new; stub, `sidecar.rs`, `Cargo.toml`, `index.ts` modified)

## Accomplishments

- Committed the already-verified interim patch to `packages/desktop/src-tauri/binaries/flywheel-sidecar-aarch64-apple-darwin` (walk-up marker resolution replacing the fixed `../../../` hop), then hardened it further: symlink-resolved physical directory before the walk, an explicit regular-readable-file assertion right before `exec`, preserved `0755` mode, and a rewritten leading comment block stating the resolution rule in the imperative and citing G-02-1.
- Gave the sidecar a `ping` op — ack-only, no adapter call, no session lookup, no backend-binary probe — and rewrote `spawn_sidecar` to write a fixed-id readiness request to the freshly-spawned child's stdin and block on a bounded (`STARTUP_READINESS_TIMEOUT`, 5s) wait over the raw spawn receiver, reading it directly since `main.rs`'s `.setup()` closure runs before `AppState`'s `pending_acks` mechanism exists. Any matching ack succeeds; process termination, a process error, the event stream closing, or the timeout elapsing all return `Err` naming the cause with a capped (4 KiB) stderr tail.
- Extended the reader loop with `CommandEvent::Stderr`/`Terminated`/`Error` arms (plus a `#[non_exhaustive]` catch-all) so a mid-session sidecar death is now a developer breadcrumb that ends the loop, instead of silently unobserved — the pre-existing `Stdout` arm's persist-then-emit ordering and its ack/malformed sub-arms are byte-for-byte unchanged.
- Wrote `packages/sidecar/test/stub-invocation.test.mjs` — the first test in this repository that copies the tracked stub into a fresh directory and spawns that copy, rather than running `dist/index.js` directly. Three cases: boots and exits 0 from a scratch dir at the same ancestor depth as the real Tauri-copied binary; answers the `ping` handshake on its own protocol; and exits non-zero with an actionable stderr message when run from outside the repository entirely (the falsifiability case). Manually confirmed the negative case actually catches the original bug by temporarily reintroducing the fixed `../../../` hop and observing test 1 fail as expected, then restoring the committed stub.

## Task Commits

Each task was committed atomically (Task 1 split into two commits per the plan's explicit "commit as-is, then harden" discipline):

1. **Task 1a: Commit the pre-existing interim entrypoint patch as-is** - `d548591` (fix)
2. **Task 1b: Harden the stub's entrypoint resolution** - `4c63c09` (fix)
3. **Task 2: Bound spawn_sidecar on a readiness handshake** - `5ca04a0` (feat)
4. **Task 3: Cover the Tauri-copied invocation path with tests** - `efd500f` (test)

_This plan's Task 2 and Task 3 carried `tdd="true"` in the plan frontmatter, but `workflow.tdd_mode` is not enabled in `.planning/config.json` for this project, so the strict RED/GREEN/REFACTOR gate sequence was not enforced; each task is a single commit following this repository's standard one-commit-per-task convention instead._

## Files Created/Modified

- `packages/desktop/src-tauri/binaries/flywheel-sidecar-aarch64-apple-darwin` - dev-time sidecar stub; walk-up marker resolution from its own symlink-resolved physical directory, asserts a regular readable entrypoint before exec, preserves 0755
- `packages/desktop/src-tauri/src/sidecar.rs` - `spawn_sidecar` now performs a bounded readiness handshake before returning `Ok`; reader loop observes stderr/termination/error
- `packages/desktop/src-tauri/Cargo.toml` - `tokio`'s feature list gains `time`
- `packages/sidecar/src/index.ts` - new `ping` op, ack-only
- `packages/sidecar/test/stub-invocation.test.mjs` - new; runs the tracked stub the way the app runs it, 3 tests

## Decisions Made

- Split Task 1 into two commits (commit the pre-existing patch as-is, then harden it) per the plan's explicit instruction and the execution prompt's `<uncommitted_patch_notice>` — this keeps the already-UAT-verified fix and this plan's additional hardening separately reviewable.
- The readiness handshake reads the spawn receiver directly rather than reusing `pending_acks`, because `spawn_sidecar` runs before `AppState` is managed in `main.rs`'s `.setup()` closure — `pending_acks` is only reachable through `AppState`.
- `ping` is deliberately not `capability_probe`: the former asks only about this process's own liveness (no side effect, no backend dependency); the latter spawns the user's `claude` binary and must never gate application startup.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 1 - Bug] `cargo fmt` reformatted files outside this plan's declared scope**
- **Found during:** Task 2, after running `cargo fmt --package desktop` to clean up manual indentation in the edited `spawn_sidecar` function
- **Issue:** `cargo fmt --package desktop` reformatted every source file in the `desktop` crate (`main.rs`, all of `commands/*.rs`, `menu.rs`), not just `sidecar.rs`, staging unrelated whitespace-only changes to files this plan does not own and did not declare in `files_modified`
- **Fix:** Reverted every incidentally-reformatted file with `git checkout --` except `sidecar.rs` (which this plan already touches and declares), leaving `sidecar.rs`'s own rustfmt-cleaned formatting in place
- **Files modified:** none beyond the plan's own declared set (reverted: `main.rs`, `commands/agent_run.rs`, `commands/criterion.rs`, `commands/epic.rs`, `commands/events.rs`, `commands/issue.rs`, `commands/project.rs`, `commands/settings.rs`, `commands/task.rs`, `menu.rs`)
- **Verification:** `git status --short` after the revert shows only the plan's own declared files modified; `cargo build --workspace` still exits 0
- **Committed in:** not separately committed — caught and reverted before any commit; the surviving `sidecar.rs` formatting is folded into `5ca04a0`

**2. [Rule 3 - Blocking] `CommandEvent` is `#[non_exhaustive]`; the reader-loop `match` needed a catch-all arm**
- **Found during:** Task 2, first `cargo build --workspace` after converting the reader loop's `if let CommandEvent::Stdout(..) = event` to a full `match event { .. }`
- **Issue:** `error[E0004]: non-exhaustive patterns: _ not covered` — the plan's own action text anticipated this ("Include a catch-all arm so a future `CommandEvent` variant cannot break the build") but the first draft omitted it in the handshake's inner loop and it was needed again in the reader task's outer match
- **Fix:** Added a `_ => {}` catch-all arm to both the handshake's inner `match rx.recv().await` and the reader task's outer `match event`
- **Files modified:** `packages/desktop/src-tauri/src/sidecar.rs`
- **Verification:** `cargo build --workspace` exits 0 with zero warnings
- **Committed in:** `5ca04a0` (part of Task 2's commit)

---

**Total deviations:** 2 auto-fixed (1 bug/scope-leak from a tool run, 1 blocking compile error). **Impact on plan:** Neither changed the plan's intended behavior; the first was caught before any commit and left zero trace, the second was already anticipated in the plan's own action text and closes exactly the gap that text named.

## Issues Encountered

- One pre-existing test in `packages/sidecar/test/stop.test.mjs` ("interrupting a stubborn session escalates to a group SIGTERM and tears down its grandchild") flaked once during a full-suite run under parallel CPU load (a timing-sensitive real-process test unrelated to any file this plan touches). Reproduced as a pass both in isolation and on a clean full-suite rerun immediately after; not investigated further as out of this plan's scope (pre-existing, not caused by this plan's changes).

## User Setup Required

None - no external service configuration required.

## Next Phase Readiness

- G-02-1 is closed: all three of its `missing:` items exist — the entrypoint resolves correctly from both locations and the fix is committed, a sidecar that exits immediately aborts startup at its cause, and the Tauri-copied invocation path is covered by a test with a falsifiable negative case.
- `packages/sidecar/src/claude-code-adapter.ts` and `packages/sidecar/test/adapter.test.mjs` remain modified-but-uncommitted in the working tree, as required — those commits belong to plan 02-17's ledger.
- Ready for `/gsd-verify-work 2` to resume UAT testing from test 1, and for the remaining open gaps (G-02-2 stderr capture/real-binary test, G-02-3 feed row overflow, G-02-4 terminal-status write path) to be closed by their respective gap-closure plans.

---
*Phase: 02-one-agent-one-worktree-watched-live*
*Completed: 2026-09-11*

## Self-Check: PASSED

All key files confirmed present on disk (`stub-invocation.test.mjs`, the stub, `sidecar.rs`, `Cargo.toml`, `index.ts`, this SUMMARY). All four task commits (`d548591`, `4c63c09`, `5ca04a0`, `efd500f`) confirmed present in `git log`. All acceptance criteria and the plan-level `<verification>` block re-run and passing: `cargo build --workspace` exits 0; `npm --prefix packages/sidecar test` reports 32/32 passing (was 29); `node --test packages/sidecar/test/stub-invocation.test.mjs` reports 3/3 passing; `bash -n` on the stub exits 0; `git ls-files -s` records mode `100755`; `git status --porcelain` for the stub is empty; no non-comment line of the stub performs a fixed multi-level parent hop; `STARTUP_READINESS_TIMEOUT`, `READINESS_REQUEST_ID` and `CommandEvent::Terminated` each appear on non-comment lines of `sidecar.rs`; `"ping"` appears on two non-comment lines of `index.ts`.
