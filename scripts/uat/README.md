# Phase 03 UAT harness

`.planning/phases/03-nothing-lost-nothing-left-running/03-VERIFICATION.md` deferred five items to a
human, each justified by some variant of *"no harness in this repository stands that up."* That is a
statement about missing tooling, not about the guarantees. This directory is the tooling.

Run everything scriptable:

```bash
bash scripts/uat/run-all.sh          # add --no-build to skip the prerequisite build
```

## What each script proves

| UAT item | Script | Verdict |
|---|---|---|
| 1 — Supervisor `kill -9` leaves no surviving agent process (SC2, PROC-03/04) | `uat-01-supervisor-kill.sh` | **PASS** |
| 2 — Orphan recovery modal blocks the board (SC3, PROC-05, WORK-06) | `uat-ui-setup.sh orphan` | **Manual** — needs a rendered window |
| 3 — Destructive gate stops a live auto-accept session (SC5, AGNT-07) | `uat-03-destructive-gate.mjs` | **Partial** — safety holds, the human-in-the-loop half does not |
| 4 — Destructive card renders correctly (SC5, AGNT-07) | `uat-ui-setup.sh destructive` | **Manual** — needs a rendered window |
| 5 — Ten concurrent commits keep every commit (SC4, WORK-04/05) | `uat-05-concurrent-commits.mjs` | **PASS** |

### Item 1 — supervisor kill

Stands up a stand-in supervisor (`lib/supervisor.mjs`) that does the only two things a watchdog can
observe about a supervisor: it owns the sidecar, and it touches the heartbeat file through the
**production** writer. Everything downstream is real — real sidecar, real adapter, real watchdog
wrapper, real process group, real runtime protocol on disk.

Asserts that within one stale window the session's whole process group is gone from the OS process
table, and that a kill record under `<runtime>/kills/<runId>.json` names the run id, pid, start
time, `reason: heartbeat-stale` and a timestamp. Includes a falsifiability check: the group must be
demonstrably alive before the kill.

Three measurements shaped this script, and each is worth knowing before changing it:

- Killing the supervisor **and** the sidecar collapses the session through broken pipes within about
  a second. The group empties, but the watchdog never fires and **no kill record is written**.
- Killing only the supervisor does the same thing if the sidecar's stdout is a pipe the supervisor
  owns. Hence the FIFO stdin (`O_RDWR`, so stdin never reaches EOF) and file-backed stdout/stderr.
- The real backend will not outlive the 15s stale window on demand. `claude` 2.1.267 refuses
  `sleep 240` under its own tool policy, the turn ends at ~16s, and the watchdog exits alongside its
  finished child. The leaf of the tree is therefore `lib/long-lived-backend.mjs`. The real backend is
  exercised by items 3 and 5, which need a real model and get one.

### Item 3 — destructive gate

Drives a real `claude` session in `bypassPermissions` mode against a scratch repository with a local
bare remote, and asks the agent to delete a remote branch. It scores the item's **two** claims
separately, because a live run shows they do not both hold:

- **Property A — safety. HOLDS.** The remote branch is unchanged, and the agent receives
  `This would delete a branch.` rather than a bare non-zero exit.
- **Property B — a human is asked. DOES NOT HOLD.** No `permission_request` is ever raised and the
  session never blocks. The tool result names `non_execution_kind: "permission-rule"`.

The mechanism: `claude-code-adapter.ts::writeHookSettings` wires the `PreToolUse` hook with
`matcher: "Bash"` — every Bash tool call — and `pretooluse-hook.ts` classifies the command by
shelling out to the shim's own `--classify-command` mode, returning `permissionDecision: "deny"` for
every non-`safe` verdict. The hook and the shim consult the **same** classifier, so the hook refuses
precisely the set the shim's socket would have asked a human about. D-58's indefinite block — the
thing that actually raises a `permission_request` — is unreachable for anything the agent runs
through Bash.

This script therefore **fails on Property B by design**. That is the finding, not a defect in the
harness.

### Item 5 — concurrent commits

Ten concurrent committers, run from a process tree rooted in a real `claude` session so they inherit
the session's real spawn environment. Asserts every commit is reachable *and carries its payload*,
that the fan-out reported no internal failures, and that the shim reported no retry-budget
exhaustion.

Shim resolution is proven by the agent's **own shell** writing `command -v git` to a file the harness
reads back — a model claiming it used the shim would not count.

Two classifier observations surfaced here, both fail-closed rather than unsafe:

- `git worktree add …` classifies as `uncategorized`, so an agent cannot create its own worktrees.
- `git -C <path> add <file>` also classifies as `uncategorized` — the global `-C` option is not
  understood, so ordinary safe commands are treated as destructive.

The fan-out therefore `cd`s rather than using `-C`, and the worktrees are pre-created by the harness:
this item is about commits surviving contention, which is item 3's subject, not the gate.

### Items 2 and 4 — the visual ones

```bash
bash scripts/uat/uat-ui-setup.sh orphan       # item 2
bash scripts/uat/uat-ui-setup.sh destructive  # item 4
```

Each builds what is missing, creates a scratch repository, seeds a scratch database into the exact
state that forces the thing under inspection onto the screen, launches the real application against
it, and prints the checklist to confirm. The seeding goes through the real domain functions
(`register_project`, `create_task`, `start_agent_run`, `create_pending_request`), never hand-rolled
SQL, so a seeded row is indistinguishable from one the application produced.

Four things this script must keep doing, each of which cost a debugging round when it did not:

- **Build the desktop binary, not merely check it exists.** A binary predating the
  `FLYWHEEL_APP_DATA_DIR` seam ignores it and quietly opens the developer's **real** fleet database —
  indistinguishable from working until you notice real projects in the rail. There is now also an
  explicit guard that refuses to launch a binary without that symbol.
- **Start the Vite dev server for a debug build.** A Tauri debug build loads its frontend from
  `devUrl` (`http://localhost:1420`), not from the bundled `dist`, so launching one with nothing on
  that port gives a blank white window. Release builds embed the frontend and skip this.
  The detection uses `grep -c`, not `grep -q`: under `set -o pipefail` a matching `grep -q` kills
  `strings` with SIGPIPE and the pipeline reports 141, so a match reads as a miss.
- **Use `register_project`, not `create_project`.** The latter is the marker-free tracer-era fixture;
  without a project marker, launch reconciliation flags the project `unreachable` and the board shows
  "Can't find this project" instead of the thing you came to look at.
- **Seed a genuinely LIVE orphan process.** `reconcile_agent_runs` only reports a live orphan when a
  run descriptor's pid *and* start time still name a running process. A row that merely says
  "running" is classified as abandoned and the board stays reachable. The seeder therefore spawns a
  detached `sleep` and records it exactly as the adapter would — with its stdio detached, or the
  calling script's command substitution blocks forever waiting for the inherited pipe to close.

**Observed so far for item 2** (captured via screenshot, since the modal is portalled and does not
appear in the accessibility tree): the modal appears naming exactly the live orphan, offers per-row
**Kill** and **Kill All** with no resume/adopt affordance, carries the "every process above is
spending tokens right now" copy, and **Escape does nothing**. Click-outside, board-unreachability,
and the Abandoned/Acknowledge flow still need a human at the window.

## Safety and cost

- **Nothing touches your real data.** Every script points `FLYWHEEL_APP_DATA_DIR` at a scratch
  directory. That seam exists for this — see `core::db::app_data_dir`. `uat_seed_ui` *refuses to run*
  if the variable is unset, rather than defaulting to the real fleet database.
- **Items 3 and 5 cost real tokens.** They drive real model turns.
- Scripts clean up their scratch directories, worktrees and child processes on every exit path. The
  exception is `uat-ui-setup.sh`, which deliberately leaves its directory in place because the app is
  still running in it; it prints the path to remove.

## Pieces

| File | Role |
|---|---|
| `lib/sidecar-harness.mjs` | Scratch repos, spawn-environment resolution, and a client for the sidecar's stdio JSON protocol |
| `lib/supervisor.mjs` | Stand-in supervisor for item 1: owns the sidecar, touches the heartbeat |
| `lib/long-lived-backend.mjs` | Backend stub for item 1 only, so the leaf outlives the stale window |
| `packages/core/tests/bin/uat_session_env.rs` | Builds the spawn environment from the **production** functions; also `--touch-heartbeat` |
| `packages/core/tests/bin/uat_seed_ui.rs` | Seeds the two visual preconditions through the real domain functions |

The Rust binaries exist so the harness cannot drift: they call `shim::shim_env_for_run`,
`runtime_protocol::runtime_dir`, `runtime_protocol::touch_heartbeat` and the domain layer directly,
rather than reimplementing what `sidecar.rs` assembles.
