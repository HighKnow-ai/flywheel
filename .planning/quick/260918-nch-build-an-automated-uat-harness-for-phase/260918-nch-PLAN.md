---
quick_id: 260918-nch
description: Automated UAT harness for phase 03's five deferred human-verification items
date: 2026-09-18
mode: quick
---

# Quick Task 260918-nch — Automated UAT harness for phase 03

## Why

`.planning/phases/03-nothing-lost-nothing-left-running/03-VERIFICATION.md` carries five
`human_verification` items, each justified by some variant of *"no harness in this repository
stands that up."* That is a statement about missing tooling, not a property of the guarantees
themselves. Four of the five are reachable by a script; the two visual ones still need a rendered
window, but a script can stand the application up in exactly the state that needs photographing.

This task builds that tooling under `scripts/uat/` so the five items become **re-runnable** rather
than a one-off manual walkthrough.

## Design

The harness drives the *real* production code paths, never a reimplementation:

- The **sidecar** (`packages/sidecar/dist/index.js`) is driven over its own newline-delimited JSON
  stdio protocol (`packages/sidecar/src/index.ts`) — the identical channel
  `packages/desktop/src-tauri/src/sidecar.rs` uses. A `spawn` request with a real `worktreePath`,
  `prompt`, `permissionMode` and `env` produces a real `claude` session behind the real watchdog
  wrapper.
- The **spawn environment** is produced by a new Rust harness binary that calls the production
  functions `flywheel_core::shim::shim_env_for_run`,
  `flywheel_core::runtime_protocol::runtime_dir` and the `HEARTBEAT_*` constants directly, so the
  harness can never drift from `resolved_env_for_run`'s own shape. Credentials are deliberately
  omitted: with no `ANTHROPIC_API_KEY` in the environment the Agent SDK prefers the developer's
  local Claude Code credentials, which is exactly what the UAT items describe.
- `permission_request` events carry `destructiveCategory` when they originate from the PATH shim
  (`packages/sidecar/src/adapter.ts`), which is the signal the destructive-gate assertions key on.

### Isolation

`core::db::app_data_dir()` currently has no override, so anything driving the real app would open
the developer's own `~/Library/Application Support/Flywheel/flywheel.db`. Task 1 adds a
`FLYWHEEL_APP_DATA_DIR` seam mirroring `runtime_protocol::runtime_dir`'s existing
"test-only override that is also the production seam" pattern.

## Tasks

### Task 1 — `FLYWHEEL_APP_DATA_DIR` override

**files:** `packages/core/src/db/mod.rs`, `packages/core/tests/db_bootstrap.rs`

**action:** Add the env override to `app_data_dir()`, documented in the same voice as
`runtime_protocol::runtime_dir`'s own override comment. Add a test asserting the override is
honoured and that the default path is unchanged when it is absent.

**verify:** `cargo test -p core db_bootstrap`

**done:** A harness can point the whole application at a scratch app-data directory without
touching the developer's real database.

### Task 2 — Session-environment harness binary

**files:** `packages/core/Cargo.toml`, `packages/core/tests/bin/uat_session_env.rs`

**action:** New `[[bin]] uat_session_env` following the existing `crash_harness` /
`commit_stress_harness` conventions. Usage: `uat_session_env <run_id> [default_branch]`. Prints a
JSON object of the spawn environment built from the production functions named above.

**verify:** `cargo run -p core --bin uat_session_env -- <ulid> main` emits JSON whose `PATH` is
prefixed with the per-run shim directory and which carries `FLYWHEEL_REAL_GIT`,
`FLYWHEEL_REAL_RM`, `FLYWHEEL_DEFAULT_BRANCH`, `FLYWHEEL_RUNTIME_DIR` and both `HEARTBEAT_*` keys.

**done:** Every UAT script obtains its spawn environment from production code, not a copy.

### Task 3 — Shared harness library + destructive-gate script (UAT item 3)

**files:** `scripts/uat/lib/sidecar-harness.mjs`, `scripts/uat/uat-03-destructive-gate.mjs`

**action:** The library owns sidecar spawn/handshake/request/event plumbing and scratch-repo
construction (a work repo plus a local bare remote). The script starts a real `claude` session in
an auto-accept permission mode and instructs the agent to delete a remote branch via
`git push --delete`, then asserts:
1. a `permission_request` event arrives carrying a `destructiveCategory`;
2. the session stays blocked — no `session_closed` and no further tool progress — while the
   request is unanswered;
3. the bare remote's ref is byte-identical before and after;
4. answering `deny` surfaces an explanatory refusal to the agent rather than a bare non-zero exit.

**verify:** `node scripts/uat/uat-03-destructive-gate.mjs`

**done:** UAT item 3 is decided by a script.

### Task 4 — Concurrent-commit script (UAT item 5)

**files:** `scripts/uat/uat-05-concurrent-commits.mjs`

**action:** Drive a live session that produces ten concurrent commits into worktrees of one
repository. Assert all ten commits are reachable, and that the agent's own `git` resolved through
the installed PATH shim (evidenced by the shim's per-run directory leading `PATH` and by shim
activity for the run) rather than a bare system `git`.

**verify:** `node scripts/uat/uat-05-concurrent-commits.mjs`

**done:** UAT item 5 is decided by a script.

### Task 5 — Supervisor kill script (UAT item 1)

**files:** `scripts/uat/uat-01-supervisor-kill.sh`

**action:** Stand up a supervised session against a scratch app-data + runtime dir, write the
heartbeat the way the production supervisor does, `kill -9` the supervising process, then poll for
up to 20s asserting (a) no process from that run's process group survives in `ps -ax`, and (b) a
kill record under `$FLYWHEEL_RUNTIME_DIR/kills/<run>.json` names the run id, pid, reason and
timestamp.

**verify:** `bash scripts/uat/uat-01-supervisor-kill.sh`

**done:** UAT item 1 is decided by a script.

### Task 6 — UI precondition script + runner + README

**files:** `scripts/uat/uat-ui-setup.sh`, `scripts/uat/run-all.sh`, `scripts/uat/README.md`

**action:** `uat-ui-setup.sh` seeds a scratch app-data database into the exact precondition state
each visual item needs (`orphan` mode: a live orphaned run so the recovery modal must appear;
`destructive` mode: a pending destructive permission request so the card must render) and launches
the real application against it. `run-all.sh` runs the scriptable items and prints a pass/fail
table. `README.md` states what each script proves and which UAT item it closes, and is explicit
that items 2 and 4 remain screenshot-adjudicated.

**verify:** `bash scripts/uat/run-all.sh`

**done:** The two visual items reduce to "look at this window", and the rest run from one command.

## Constraints

- No existing test may be weakened.
- Scripts must clean up their scratch directories, worktrees and child processes on every exit
  path, and must never touch `~/Library/Application Support/Flywheel`.
- Live-session scripts consume real tokens; the README must say so.
