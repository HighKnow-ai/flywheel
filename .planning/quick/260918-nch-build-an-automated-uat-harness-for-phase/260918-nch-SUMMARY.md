---
status: complete
quick_id: 260918-nch
description: Automated UAT harness for phase 03's five deferred human-verification items
date: 2026-09-18
commits: 6
---

# Quick Task 260918-nch — Automated UAT harness for phase 03

## What was built

`scripts/uat/` — a re-runnable harness for the five items
`.planning/phases/03-nothing-lost-nothing-left-running/03-VERIFICATION.md` had deferred to a human.
Three of the five are now decided by a script; the two visual ones are reduced to "look at this
window", with the application stood up in exactly the right state.

```bash
bash scripts/uat/run-all.sh
```

| File | Role |
|---|---|
| `scripts/uat/lib/sidecar-harness.mjs` | Scratch repos, spawn-env resolution, client for the sidecar's stdio JSON protocol |
| `scripts/uat/lib/supervisor.mjs` | Stand-in supervisor for item 1 |
| `scripts/uat/lib/long-lived-backend.mjs` | Backend stub for item 1 only |
| `scripts/uat/uat-01-supervisor-kill.sh` | UAT item 1 |
| `scripts/uat/uat-03-destructive-gate.mjs` | UAT item 3 |
| `scripts/uat/uat-05-concurrent-commits.mjs` | UAT item 5 |
| `scripts/uat/uat-ui-setup.sh` | Preconditions for UAT items 2 and 4 |
| `scripts/uat/run-all.sh`, `scripts/uat/README.md` | Runner and documentation |
| `packages/core/tests/bin/uat_session_env.rs` | Spawn environment from the production functions; `--touch-heartbeat` |
| `packages/core/tests/bin/uat_seed_ui.rs` | Seeds the two visual preconditions through the real domain layer |
| `packages/core/src/db/mod.rs` | New `FLYWHEEL_APP_DATA_DIR` seam |

## Results

| Item | Result |
|---|---|
| 1 — Supervisor `kill -9` leaves no surviving agent process | **PASS** |
| 2 — Orphan recovery modal blocks the board | Manual (precondition scripted) |
| 3 — Destructive gate stops a live auto-accept session | **FAIL** — safety holds, the human-in-the-loop half does not |
| 4 — Destructive card renders correctly | Manual (precondition scripted) |
| 5 — Ten concurrent commits keep every commit | **PASS** |

## The finding — UAT item 3

The item bundles two claims. A live run against `claude` 2.1.267 shows only one holds.

**Property A — safety. HOLDS.** The remote branch is unchanged; the agent receives
`This would delete a branch.` rather than a bare non-zero exit.

**Property B — a human is asked. DOES NOT HOLD.** No `permission_request` is raised, and the session
never blocks. The tool result carries `non_execution_kind: "permission-rule"`.

The mechanism, confirmed in source: `claude-code-adapter.ts::writeHookSettings` wires the
`PreToolUse` hook with `matcher: "Bash"` — every Bash tool call — and `pretooluse-hook.ts` classifies
the command by shelling out to the shim's own `--classify-command` mode, returning
`permissionDecision: "deny"` for every non-`safe` verdict. The hook and the shim consult the **same**
classifier, so the hook refuses precisely the set the shim's socket would have asked a human about.
D-58's indefinite block — the only thing that raises a `permission_request` — is therefore
unreachable for anything the agent runs through its Bash tool.

`pretooluse-hook.ts`'s own doc comment anticipates a residual gap, but describes it as covering "the
narrow class of commands only it (not the shim) can see" — i.e. absolute-path invocations. The
measured scope is wider: the hook fires first for *every* Bash command, so it is the refusal layer in
all cases and the question layer never runs.

This is a product gap, not a harness defect, and it is not a safety gap. It should become a phase-03
UAT gap for diagnosis.

## Secondary observations

Both fail-closed (over-refusal, never under-refusal), so neither is a safety issue, but both would
make ordinary agent work painful:

- `git worktree add …` classifies as `uncategorized` → treated as destructive. An agent cannot create
  its own worktrees.
- `git -C <path> add <file>` also classifies as `uncategorized` — the global `-C` option is not
  understood, so ordinary safe commands are treated as destructive.

## Measurements that shaped item 1's script

Each of these changed the test, and each is recorded in the script so it is not rediscovered:

1. Killing the supervisor **and** the sidecar collapses the session through broken pipes (~1s), well
   before the 15s stale window. The group empties, but the watchdog never fires and no kill record is
   written.
2. Killing only the supervisor does the same if the sidecar's stdout is a pipe the supervisor owns.
   The supervisor therefore hands the sidecar a FIFO (`O_RDWR`) for stdin and files for
   stdout/stderr.
3. The real backend will not outlive the stale window on demand: `claude` 2.1.267 refuses
   `sleep 240` under its own tool policy, the turn ends at ~16s, and the watchdog exits alongside its
   finished child. Item 1's leaf process is therefore a stub; the real backend is exercised by items
   3 and 5.

## Design notes

- **No reimplementation.** The Rust harness binaries call `shim::shim_env_for_run`,
  `runtime_protocol::runtime_dir`, `runtime_protocol::touch_heartbeat` and the domain layer directly,
  so the harness cannot drift from what `sidecar.rs` assembles.
- **Isolation.** `core::db::app_data_dir()` gained a `FLYWHEEL_APP_DATA_DIR` override mirroring
  `runtime_protocol::runtime_dir`'s existing pattern. Overriding `HOME` would have isolated the
  database but also moved `~/.claude` out from under spawned sessions, breaking the credential
  resolution they depend on. `uat_seed_ui` refuses to run without the variable.
- **Falsifiability.** Item 1 asserts the process group is alive before the kill; item 5 proves shim
  resolution from the agent's own shell rather than the model's narration.

## Verification

- `cargo test -p core` — all suites pass (includes three new `db_bootstrap` tests for the seam).
- `npm --prefix packages/sidecar run test` — 55 pass, 0 fail.
- `npm --prefix packages/desktop test` — 440 pass across 32 files.
- No existing test was modified or weakened.

## Commits

| Commit | Scope |
|---|---|
| `d9037b8` | `FLYWHEEL_APP_DATA_DIR` override |
| `e3b23a2` | `uat_session_env` harness binary |
| `2b7640f` | Sidecar harness library + UAT item 3 |
| `01d5eb8` | UAT item 5 |
| `63218d3` | UAT item 1 |
| `251ebef` | UI precondition setup, runner, README |
