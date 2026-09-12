# Phase 3: Nothing Lost, Nothing Left Running - Research

**Researched:** 2026-09-12
**Domain:** Process supervision (crash-safe process-tree teardown, launch-time reconciliation), git worktree lifecycle safety, git index-lock contention under concurrency, and defeating an auto-accept permission mode for a fixed list of destructive git operations.
**Confidence:** MEDIUM-HIGH — the git-worktree and git-lock claims are grounded in official git docs plus the primary-source GitHub issues named in ROADMAP.md; the Claude Code hook/permission-timeout claims are backed by **two real empirical spikes run in this session** against the installed `claude` 2.1.236 binary (see "Verified This Session" below), which is the strongest evidence tier available; the cross-platform process-supervision claims (Windows Job Objects, macOS kqueue) are WebSearch-sourced and un-executed, since this phase's v1 target is macOS only (`.claude/CLAUDE.md` Out of Scope: "Windows and Linux builds in v1").

<user_constraints>
## User Constraints (from CONTEXT.md)

### Locked Decisions

Decision numbering continues from Phase 2 (D-01–D-22 are Phase 1, D-23–D-40 are Phase 2). Copied verbatim from `03-CONTEXT.md`:

- **D-41:** The remove-worktree verb lives on the task, inside `WorktreeSummary`. Rejected: a project-scoped Worktrees list; building both.
- **D-42:** A refused removal renders the `git status --porcelain` output as rows — one per entry, with its status (modified / added / deleted / untracked) and its path — plus the count. Rejected: a count and one sentence; rendering the full diff inline.
- **D-43:** There is no escape hatch. A dirty worktree is simply not removable from inside Flywheel. Rejected: force-remove behind a typed task-key confirmation; offering safe outs (stash-then-remove or commit-then-remove). Reversibility: reversible.
- **D-44:** Deleting a task with agent-run history unblocks once its worktree is gone. Deletion stays blocked while a `worktrees` row exists for the task and succeeds once it does not. Rejected: keeping the block permanent; having delete offer to remove the worktree in the same confirmation. Reversibility: reversible.
- **D-45:** A worktree the database calls `active` that is not on disk is written to a new `missing` status — surfaced, never repaired. Rejected: reusing the existing unused `stale` value; computing disk presence at read time without writing anything. Reversibility: costly (CHECK-constraint rebuild).
- **D-46:** Recovery blocks only when money is burning. A live orphaned agent process found at launch puts a modal in front of the board. Everything else (a worktree that disagrees with the database, a run stuck at `running` with no process behind it) lands as a persistent "needs you" item that survives dismissal, reusing D-37's mechanism. Rejected: one blocking screen for every discrepancy; never blocking at all.
- **D-47:** A heartbeat file plus a per-session watchdog. The Rust core touches a heartbeat file on an interval; each session is spawned under a thin wrapper that polls that file and kills its own process group when the heartbeat goes stale. Rejected: reparent detection (`getppid() == 1`); dropping `detached: true`. Reversibility: costly.
- **D-48:** The watchdog goes straight to force — no grace window. Rejected: reusing D-35's interrupt-then-force.
- **D-49:** A run that was `running` when the app died lands in a new `abandoned` status, written by the launch reconciler and never by the dying process. Rejected: reusing `interrupted`; leaving the run at `running` until the user picks an outcome. Reversibility: costly.
- **D-50:** The watchdog leaves a kill record on disk (run id, pid, reason, timestamp) beside the heartbeat. The Rust core still owns every SQLite write. Rejected: treating absence as the signal.
- **D-51:** A `git` shim on the worktree's PATH. Each session is spawned with a Flywheel-owned directory prepended to `PATH` containing a `git` wrapper that forwards to the real binary and retries on `.git/index.lock` with backoff and jitter. Rejected: a shim that leases per-repository serialization from the supervisor; no shim at all. Reversibility: costly.
- **D-52:** Spawn stagger is a supervisor-enforced minimum interval per repository, not a random sleep. Rejected: random 100–500ms jitter per spawn (alone); doing both (the planner may add jitter on top of the floor if nearly free — the floor is required).
- **D-53:** Collisions are counted per run; only exhaustion is surfaced. Rejected: an event per collision; full silence with git's own error reaching the agent on exhaustion.
- **D-54:** One backoff policy, shared by `git_at` and the shim, living in a single module in `packages/core`. Rejected: two independent implementations.
- **D-55:** Both a PreToolUse hook and the shim — the hook as the semantic gate, the shim as the backstop. Rejected: the hook alone; the shim alone. Reversibility: costly.
- **D-56:** The destructive list is fixed and wider than AGNT-07's three: force-push, branch deletion, recursive delete, plus any push to the project's `default_branch`, `git reset --hard`, `git clean -fdx`, and history rewrite (`filter-branch`, or a rebase onto a published ref). Rejected: exactly the three the requirement names; a user-editable list.
- **D-57:** Allow-always can never cover a destructive action. The permission card for one offers allow-once and deny only. Rejected: a separately-flagged, possibly-expiring destructive grant; treating destructive actions like any other tool under D-38.
- **D-58:** An unanswered destructive request blocks indefinitely, exactly like any other permission request. Rejected: auto-deny after an idle window; denying immediately without asking.

### Claude's Discretion

Copied verbatim from `03-CONTEXT.md`:

- The shim's identity and build (one binary or several, Rust or a script, how it's built and placed on `PATH` per session, behavior when the real `git` cannot be resolved, whether it intercepts every git subcommand or only mutating ones).
- The on-disk runtime protocol (where the heartbeat/kill-record files live, the heartbeat interval, the staleness threshold, who cleans stale files up).
- The backoff curve and retry budget (PITFALLS suggests 200ms → 400ms → 800ms over 3–5 attempts as a starting point; D-52's minimum-interval floor value).
- Whether a live orphan found at launch can ever be adopted rather than only killed — default to kill-only unless research shows adoption is nearly free. **Resolved by `03-UI-SPEC.md`: kill-only, no Adopt action anywhere.**
- Whether the recovery modal's kill action is per-run or all-at-once. **Resolved by `03-UI-SPEC.md`: both.**
- Whether the stress run of criterion 4 is an automated CI test or a manual harness.
- Whether any of this phase's machinery behaves differently under `tauri dev` versus a packaged `.app`.
- What `delete_task` does with the `triggers`/`agent_runs`/`permission_requests` rows once D-44 lets the deletion through.
- Research flag carried from ROADMAP.md: expand the lock-contention evidence base and test against multiple git versions during planning.

### Deferred Ideas (OUT OF SCOPE)

Copied verbatim from `03-CONTEXT.md`:

- A project-scoped Worktrees list.
- Supervisor-level serialization of all git-mutating operations per repository.
- Tool-call-layer file-set enforcement (Phase 9, PLAN-04/PLAN-05).
- Adopting a live orphaned agent back into a relaunched Flywheel.
- An idle-output timeout for a blocked session.
- Worktree disk reclamation / a "these worktrees are old" sweep (WORK-07, Phase 10).
- Correcting `RLAY-01` in `REQUIREMENTS.md`.
- Closing broken-window #2 (the `FLYWHEEL_WORKTREE_ROOT` env-var race in `worktree_lifecycle.rs`).
</user_constraints>

<phase_requirements>
## Phase Requirements

| ID | Description | Research Support |
|----|-------------|------------------|
| WORK-03 | A worktree is never destroyed without first checking for uncommitted changes; if any exist, destruction is refused and surfaced to the user | "git worktree remove — exact refusal semantics" section; verified via official git docs and `git-worktree(1)` |
| WORK-04 | Concurrent git operations against the same repository retry with exponential backoff and jitter on index-lock contention rather than failing the task | ".git/index.lock contention" section — distinguishes worktree-add-time (`config.lock`) vs. commit-time (per-worktree index, shared refs/objects) contention, both primary-sourced from named GitHub issues |
| WORK-05 | Agent spawn timing is desynchronised so that parallel starts do not collide on the same repository index | Same section — confirms `git worktree add` contends on `.git/config.lock`, which D-52's per-repository spawn floor directly targets |
| WORK-06 | On launch, the application reconciles worktrees recorded in the database against those actually present on disk and surfaces any discrepancy | "Launch-time reconciliation" section, grounded directly in the existing `reconcile_projects` implementation this phase is instructed to copy |
| PROC-03 | Agent processes are managed as process groups so that termination reliably kills the whole tree, not just the parent | "Process-group kill semantics" section |
| PROC-04 | No agent process survives application quit; a worker self-terminates if its supervisor disappears | "Process-group kill semantics" + "The heartbeat/watchdog protocol" sections |
| PROC-05 | On launch, orphaned agent processes and in-flight runs from a previous session are detected and surfaced for a decision rather than silently resumed | "Crash-recovery reconciliation and PID-reuse safety" section |
| AGNT-07 | Destructive actions always require explicit confirmation, even in an auto-accept permission mode | "The destructive-action gate" section — includes two empirical spikes proving both the mechanism (works) and a real gap (hook timeout fallthrough) |
</phase_requirements>

## Summary

This phase has two genuinely separate technical problems wearing one phase name. The first — worktree removal, launch reconciliation, and process-tree teardown — extends patterns the codebase already has working examples of: `reconcile_projects` (D-16's "surface, never repair" contract) is the literal template for D-45's worktree reconciliation, and the sidecar's existing `shutdown_all_sessions`-then-`kill()` sequencing (CR-02) is the belt this phase adds suspenders to. The second — index-lock survival and the destructive-action gate — required going beyond the codebase to primary sources, because the two GitHub issues ROADMAP.md names describe two **different** lock files (`.git/config.lock` at `git worktree add` time, vs. a per-worktree `index.lock` plus shared-ref/object contention at `git commit` time), and because this session's own empirical testing against the installed `claude` CLI surfaced a load-bearing gap in the naive "PreToolUse hook blocks forever" design that `03-CONTEXT.md`'s D-55/D-58 narrative does not mention: **a PreToolUse hook that does not resolve within its configured timeout (default 600s) does not block the tool call — the call falls through to the normal permission flow, which in `bypassPermissions` mode means silent execution.** This was reproduced live in this session (a `git branch -D` survived a hook explicitly configured to deny it, because the hook's 1-second timeout expired before its 3-second sleep finished). This one finding changes the shape of D-55's design: the **shim, not the hook, must be the component capable of blocking indefinitely** for git-mediated destructive commands, because the shim is a plain OS process with no Claude-Code-imposed timeout; the hook's real job is narrower — fast, synchronous classification, plus covering the one category of destructive command the shim structurally cannot see: a bare `rm -rf` that never goes through `git` at all.

**Primary recommendation:** Build the shim as the authoritative, indefinitely-blocking enforcement point for every D-56 category that is a `git` invocation (it can poll a resolution file/socket for as long as needed, immune to the CLI's own hook-timeout semantics); keep the PreToolUse hook fast and synchronous (classify against D-56, deny immediately with a reason if no pre-existing approval exists, never hold the process open waiting on a human); and treat the hook's non-git coverage (`rm -rf`) as bounded by whatever timeout is configured, flagging that residual gap explicitly to the user rather than silently declaring "always" satisfied for it.

## Architectural Responsibility Map

| Capability | Primary Tier | Secondary Tier | Rationale |
|------------|-------------|----------------|-----------|
| Worktree removal + dirty-check | Supervisor (Rust core) | — | `git status --porcelain` and `git worktree remove` are git plumbing; only the Rust core shells out to git (PROC-02, `git.rs` is the one `Command::new("git")` site) |
| Launch-time worktree/run reconciliation | Supervisor (Rust core) | — | Runs in `main.rs`'s `setup()` before any window is shown, exactly where `reconcile_projects` already runs; must complete before the renderer can trust board state |
| Process-group kill on app exit | Supervisor (Rust core) + Worker (sidecar) | — | The Rust core owns `shutdown_all_sessions()`-then-`kill()` sequencing (CR-02); the sidecar's Node process is what actually holds each session's process-group handle and issues the OS-level kill |
| Watchdog self-termination on supervisor death | Worker (a thin wrapper around each spawned `claude` process) | — | Must survive a SIGKILL of the *entire* Rust-core-plus-sidecar tree at once — the only component that can do this is something running as its own independent process, not a thread inside the sidecar (which dies with it) |
| Orphan/in-flight-run detection at launch | Supervisor (Rust core) | — | Reads the heartbeat/kill-record files and cross-references `agent_runs` — pure Rust-core startup logic, no renderer or worker involvement |
| Index-lock retry for the agent's own commits | Worker-adjacent (the PATH shim, injected per-session) | Supervisor (`git_at` in `git.rs`, shared backoff module) | The agent's `git commit` calls happen inside the worker's own process tree in the worktree — only a PATH-level interception inside that worktree's environment can see them; the Rust core's own git calls (worktree-add, status checks) share the same backoff logic but are a structurally separate call site |
| Destructive-action gate (git-mediated) | Worker-adjacent (the PATH shim) | Supervisor (permission_requests / board) | The shim is the only component guaranteed to run for every git invocation regardless of Claude Code's own hook/permission machinery; it defers to the existing board-blocked mechanism to actually collect the human's decision |
| Destructive-action gate (non-git, e.g. `rm -rf`) | Worker (Claude Code's own PreToolUse hook) | — | No shim can intercept a command that never calls `git`; the hook is the only interception point available, with the documented timeout-fallthrough caveat |

## Standard Stack

### Core

| Library | Version | Purpose | Why Standard |
|---------|---------|---------|--------------|
| System `git` CLI (already the sole mechanism in `git.rs`) | 2.54.0 installed locally [VERIFIED: `git --version`, this session]; **document a tested minimum of 2.44** [ASSUMED — chosen because it is roughly two years old as of this research and predates the per-worktree-index and locking behavior this phase depends on; not independently version-bisected this session] | Worktree lifecycle (`add`/`remove`/`list`), status/dirty checks, and every commit the agent makes | Already the locked stack decision (`.claude/CLAUDE.md`: "worktree lifecycle operations shell out to the system git CLI, never git2-rs") |
| `sysinfo` (Rust crate) | `0.39.6` [ASSUMED — package name discovered via WebSearch/training knowledge, not from official docs or Context7; existence and health independently confirmed via `cargo search` and the package-legitimacy gate below, which is registry confirmation, not a substitute for an authoritative-source citation] | Cross-platform process liveness + start-time lookup for orphan detection (PID-reuse safety: pair PID with process start time, not PID alone) | Long-lived (published 2015), ~3.5M downloads/week, actively maintained (`GuillaumeGomez/sysinfo`) — see Package Legitimacy Audit |
| Claude Code CLI `--settings <file-or-json>` flag | Present on the installed 2.1.236 binary [VERIFIED: `claude --help`, this session] | Inject a PreToolUse hook into a spawned headless session without writing into the worktree's own `.claude/settings.json` | Highest-precedence settings source per official docs [CITED: code.claude.com/docs/en/hooks]; confirmed empirically in this session to actually take effect in a `-p --output-format stream-json` headless run under `bypassPermissions` |

### Supporting

| Library | Version | Purpose | When to Use |
|---------|---------|---------|-------------|
| `tokio::process::Command` (already a dependency) | workspace-pinned `tokio 1` with `process` feature [VERIFIED: `packages/desktop/src-tauri/Cargo.toml`, this session] | Spawning any new Rust-side helper process this phase needs (if the shim or watchdog ends up Rust-built) | Already used for the sidecar's own process supervision |
| Node `net` (Unix domain sockets) — already used by `mcp-permission-server.ts` | Node builtin, no new dependency | Template for how the shim or hook can relay a "needs human decision" event to the board through the sidecar without a new IPC channel | Reuse the existing pattern rather than inventing a second permission-relay mechanism |

### Alternatives Considered

| Instead of | Could Use | Tradeoff |
|------------|-----------|----------|
| `sysinfo` for PID-reuse-safe orphan detection | Hand-rolled `/proc/<pid>/stat` parsing (Linux) + `libc::kill(pid, 0)` (POSIX liveness only, no start-time) | `sysinfo` gives cross-platform start-time comparison for free; hand-rolling loses PID-reuse safety unless start-time is independently sourced per platform, which is exactly what a "don't hand-roll" case looks like |
| A heartbeat-file-based watchdog (D-47, already decided) | `PR_SET_PDEATHSIG` (Linux-only, and known-buggy with multi-threaded parents per the "Tokio + prctl" bug below) or kqueue `EVFILT_PROC`/`NOTE_EXIT` (macOS-only) | D-47 already rejected signal-based reparent detection in favor of the heartbeat file specifically because it needs no OS-specific signal plumbing and works identically on every platform — this research confirms that was the right call: macOS has no `PDEATHSIG` equivalent at all, and the closest analog (kqueue) requires the watchdog to register for the exact PID of a process it must independently verify hasn't already been reused |

**Installation:**
```toml
# packages/core/Cargo.toml, if the orphan-detection reconciler is built in Rust
sysinfo = "0.39"
```

**Version verification:** `cargo search sysinfo` [VERIFIED: this session] returned `sysinfo = "0.39.6"` as the current published version with an accurate one-line description ("Library to get system information such as processes, CPUs, disks, components and networks"), confirming both existence and that the name is not a stale/abandoned alias.

## Package Legitimacy Audit

| Package | Registry | Age | Downloads | Source Repo | Verdict | Disposition |
|---------|----------|-----|-----------|-------------|---------|-------------|
| `sysinfo` | crates.io | ~11 years (published 2015-07-25) | ~3.5M/week | `github.com/GuillaumeGomez/sysinfo` | [OK] | Approved — see caveat below |

**Packages removed due to [SLOP] verdict:** none.
**Packages flagged as suspicious [SUS]:** none.

*`sysinfo`'s package name was discovered via WebSearch/training knowledge, not an official-docs citation or Context7, so per the package-name provenance rule it is tagged `[ASSUMED]` above despite the clean `[OK]` legitimacy verdict — the OK verdict rules out slopsquatting, it does not promote the recommendation itself to `[VERIFIED]`. The planner should gate the `cargo add sysinfo` step behind a `checkpoint:human-verify` task.*

## Architecture Patterns

### System Architecture Diagram

```
LAUNCH (main.rs setup(), before any window is shown)
  │
  ├─► open_and_migrate()  [existing]
  ├─► reconcile_projects()  [existing — the D-16 template]
  ├─► NEW: reconcile_worktrees()
  │       for each `active` worktrees row:
  │         stat(row.path) missing? ──► UPDATE status='missing', append worktree.missing event
  │                                     (never delete row, never rewrite path — D-45)
  ├─► NEW: reconcile_agent_runs()
  │       for each `running`/`blocked` agent_runs row:
  │         read <heartbeat-dir>/<run_id>.kill  (D-50's kill record)?
  │           found            ──► UPDATE status='abandoned' (D-49), carry kill reason for UI
  │           not found, PID+start-time still alive (sysinfo) ──► LIVE ORPHAN
  │                                    → collected into a list, NOT written yet
  │           not found, PID dead/reused ──► UPDATE status='abandoned' (D-49), no kill record
  ├─► spawn_sidecar()  [existing]
  ├─► app.manage(AppState { ..., pending_orphans: <list from above> })
  └─► window paints
         │
         ▼
   IF pending_orphans non-empty → Orphan recovery modal renders immediately (blocking)
   IF any `missing` worktree / `abandoned` run unacknowledged → "Needs Decision" pill (non-blocking)

RUNTIME (one agent run in flight)
  Rust core                         Sidecar (Node)                    Worker (claude CLI + wrapper)
  │  touches heartbeat file    │                                  │
  │  every N seconds ─────────►│  (file lives in shared app-data) │
  │                             │  spawns: wrapper(claude, argv)  │
  │                             │     └─ wrapper is the process-  │
  │                             │        group leader (detached)  │
  │                             │        └─ spawns claude as child│
  │                             │     wrapper polls heartbeat file│
  │                             │     stale? → SIGTERM the whole  │
  │                             │        group, write kill record │
  │                             │                                  │
  │  worktree PATH ────────────────────────────────────────────►  git (real) via SHIM
  │                                                                  shim intercepts every
  │                                                                  git subcommand:
  │                                                                    - index.lock collision?
  │                                                                        → backoff+retry (D-51/54)
  │                                                                    - matches D-56 destructive list?
  │                                                                        → block, relay to permission
  │                                                                          channel, wait for board answer
  │                                                                          (no CLI-imposed timeout —
  │                                                                          this is a plain OS process)
  │                                                                        → on Allow, exec real git
  │                                                                        → on Deny, exit non-zero
  │
  │  claude's own PreToolUse hook (via --settings) ──────────────►  fires BEFORE the CLI's built-in
  │                                                                  bash-command classifier (verified
  │                                                                  this session) — fast synchronous
  │                                                                  check against D-56 categories for
  │                                                                  NON-git commands (rm -rf); denies
  │                                                                  immediately if unapproved, never
  │                                                                  holds the process open (its own
  │                                                                  timeout, default 600s, falls
  │                                                                  through to normal permission flow
  │                                                                  if exceeded — verified this session)

APP EXIT
  RunEvent::Exit → shutdown_all_sessions() [existing] → kill(sidecar) [existing]
  (the heartbeat simply stops being touched; every wrapper notices within its own poll interval
   and self-terminates — this is the ONLY path that survives a SIGKILL of the whole tree, since
   RunEvent::Exit never fires on a SIGKILL)
```

### Recommended Project Structure

No new top-level packages. New modules inside the existing four:

```
packages/core/src/
├── domain/
│   ├── worktree.rs          # + worktree_remove (D-41/42/43), + reconcile_worktrees (D-45)
│   └── agent_run.rs         # + mark_abandoned (D-49), reconciler reads (D-46's orphan classification)
├── git_retry.rs             # NEW — D-54's single shared backoff module (git_at AND the shim call into this)
└── runtime_protocol.rs      # NEW — D-47/D-50's heartbeat-file + kill-record read/write helpers,
                              #        used by both the Rust core (writer) and the watchdog (reader)

packages/desktop/src-tauri/src/
├── commands/agent_run.rs    # + worktree_remove_check / worktree_remove (D-41), + orphan_kill (D-46)
└── main.rs                  # setup() gains reconcile_worktrees()/reconcile_agent_runs() calls

packages/shim/                # NEW package (or a bin target inside packages/core) — see Claude's
│                              #   Discretion "shim identity" — the git-wrapper binary/script placed
│                              #   on PATH per spawned session
└── ...

packages/sidecar/src/
├── claude-code-adapter.ts   # spawn() now launches the watchdog wrapper, not `claude` directly;
│                              #   buildClaudeArgv gains --settings for the PreToolUse hook (D-55)
└── watchdog/                 # NEW — the thin per-session wrapper (D-47), or a small standalone
                               #   script if the planner chooses not to keep it in the sidecar's
                               #   own module graph (see Claude's Discretion)
```

### Pattern 1: Surface-never-repair reconciliation (the D-16 template)

**What:** A launch-time pass that compares the database's belief about the world against the actual filesystem/process state, writes a new status when they disagree, and never silently rewrites the record back into agreement.
**When to use:** D-45 (worktree vs. disk) and the non-orphan half of D-46/PROC-05 (agent_runs vs. process table).
**Example — the exact function this phase's worktree reconciler should mirror:**
```rust
// Source: packages/core/src/domain/project.rs:335-374 (read this session)
pub fn reconcile_projects(conn: &mut Connection, actor_id: &str) -> anyhow::Result<()> {
    let projects = list_projects(conn)?;
    let now = Utc::now().to_rfc3339();

    for project in projects {
        // Any read failure (a malformed marker, a permissions error, a genuinely missing
        // repository) reads as "not reachable" here — one bad project must never abort
        // reconciliation for every other registered project.
        let reachable =
            marker::verify_marker(Path::new(&project.repo_path), &project.id).unwrap_or(false);
        let new_status = if reachable { "active" } else { "unreachable" };
        if new_status == project.status {
            // No change: no row write, no event — this is what makes a second run over an
            // unchanged filesystem a true no-op.
            continue;
        }
        // ... one transaction: UPDATE status, append event. Never touches repo_path (D-16).
    }
}
```
The worktree reconciler is structurally identical: `list` worktrees, `stat` each `path`, write `missing` only on a state change, append an event, never touch `path`/`branch`.

### Pattern 2: The watchdog-per-child pattern (D-47)

**What:** Each spawned worker is wrapped in a thin process that (a) becomes the process-group leader itself, (b) spawns the real work as its own child inside that same group, (c) polls a shared heartbeat file, and (d) signals the whole group if the heartbeat goes stale.
**When to use:** The only mechanism named in PITFALLS.md pitfall 4 that survives a SIGKILL of the supervisor — "the child monitors parent, self-terminates if parent dies" pattern — applied here as "watches a file, not a live parent handle," because macOS has no `PDEATHSIG` to watch a live parent with.
**Why the wrapper must be the group leader, not `claude` itself:** the current code spawns `claude` directly with `detached: true` [VERIFIED: `packages/sidecar/src/claude-code-adapter.ts` — `const child = spawn(bin, argv, { cwd: options.worktreePath, env: { ...process.env, ...options.env }, detached: true });`, read this session], making `claude` the group leader; D-35's `interruptSession`/`killSession` already signal `-pid` (the negative of that PID) to reach the whole group. If a wrapper is inserted, it must become the new group leader and spawn `claude` inside its own group (not `detached` a second time, which would create a *second* group) so that D-35's existing `-pid` signaling continues to reach both the wrapper and `claude` with no change to `interruptSession`/`killSession`'s own code.

### Pattern 3: The PATH shim as an unconditional interception point

**What:** A directory prepended to the spawned session's `PATH` containing an executable named `git` that intercepts every invocation the agent's own tools make, regardless of what Claude Code's own permission/hook machinery decides.
**When to use:** D-51 (lock retry) and D-55/D-56 (destructive-command backstop) — anything that must hold even if Claude Code's hook layer is misconfigured, bypassed, or (per this session's own finding) times out.
**Example skeleton (illustrative — no verified source, since this is new code this phase writes):**
```bash
#!/bin/bash
# packages/shim/git — resolved via `PATH` ahead of the real git
REAL_GIT="$(command -v -a git | grep -v "$0" | head -1)"
if is_destructive "$@"; then
  # Block here — this process can poll/wait indefinitely; it is not subject to
  # Claude Code's own hook timeout (that constraint only applies to a `command`
  # hook entry the CLI itself spawns and watches).
  request_id=$(create_permission_request "$@")
  wait_for_decision "$request_id"   # blocks on a socket/file, no self-imposed timeout
  [ "$(read_decision "$request_id")" = "allow" ] || { echo "denied by user" >&2; exit 1; }
fi
if is_index_lock_error "$("$REAL_GIT" "$@" 2>&1)"; then
  backoff_and_retry "$REAL_GIT" "$@"
fi
```

### Anti-Patterns to Avoid

- **Relying on the PreToolUse hook to block indefinitely for a human decision.** Confirmed this session (see "Verified This Session" below): a hook that has not exited by its own `timeout` (default 600s) is canceled and the tool call proceeds through the normal permission flow — which, under `bypassPermissions`, means silent execution. Do not design D-58's "blocks indefinitely" contract around the hook alone for any command the shim can also see.
- **Treating `.git/index.lock` as the only lock name worth matching.** The two primary-source issues this phase's own ROADMAP.md cites report *different* lock files (`config.lock` at worktree-creation time, `index.lock`/ref-lock-shaped errors at commit time). A retry regex scoped only to the literal string `index.lock` will miss the worktree-add-time collision entirely.
- **Assuming per-worktree index files eliminate commit-time lock contention.** They eliminate collision on the *index* specifically, but git worktrees still share `refs/`, `objects/`, and repo-wide maintenance locks (`gc.auto`, background `git maintenance`) — the retry/backoff logic still earns its keep even though each worktree has its own index.

## Don't Hand-Roll

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| PID-reuse-safe liveness check | Manual `/proc/<pid>` parsing per platform, or bare `kill(pid, 0)` | `sysinfo` crate's `Process::start_time()` compared against a stored start time | A liveness check without start-time comparison is unsafe the moment the OS recycles a PID between a crash and the next launch — a real, not theoretical, risk on a long-uptime dev machine |
| Cross-platform "is my parent still alive" signal | Hand-rolled `PR_SET_PDEATHSIG` (Linux-only, and documented as unreliable with multi-threaded parents — see "Tokio + prctl = nasty bug" below) or kqueue `EVFILT_PROC` (macOS-only) | The heartbeat-file poll D-47 already committed to | One mechanism, one code path, works identically on every OS Tauri targets; D-47's own rejection of `getppid()==1` reparent detection already established this reasoning — this research adds the concrete platform evidence for *why* no signal-based alternative is actually simpler |
| Exponential backoff with jitter | A bespoke sleep loop per call site | D-54's single shared module, called by both `git_at` and the shim | Already decided (D-54) — named here only to reinforce it as the module every future git-mutating call site must route through, including any Phase 9 work that touches git |

**Key insight:** every "don't hand-roll" item in this phase resolves the same way — pick the one mechanism that is provably platform-uniform (a file on disk, a crate that already normalizes OS differences) over anything that requires OS-conditional code, because this phase's entire premise (nothing lost, nothing left running) is falsified by exactly one platform-specific edge case slipping through.

## Runtime State Inventory

> This phase is not a rename/refactor/migration phase — it adds new columns/statuses and new runtime files, but does not rename or move any existing entity. Included for completeness per the researcher's standing instructions; all categories below are genuinely "none found."

| Category | Items Found | Action Required |
|----------|-------------|------------------|
| Stored data | None — this phase adds new CHECK-constrained status values (`missing`, `abandoned`) to existing columns; no existing row's meaning changes. | None |
| Live service config | None — no external service (n8n, Datadog, etc.) is touched by this phase. | None |
| OS-registered state | None — no Task Scheduler/launchd/systemd registration exists yet in this codebase (Phase 10's scope, not this phase's). | None |
| Secrets/env vars | None new. `FLYWHEEL_WORKTREE_ROOT` (test-only, `packages/core/src/git.rs:worktree_root_from_env`) is read, not written, by this phase's work. | None |
| Build artifacts | None — no package rename or build-output relocation occurs in this phase. | None |

## Common Pitfalls

### Pitfall 1: PreToolUse hook timeout silently defeats "always" (verified this session — see below)

**What goes wrong:** A PreToolUse hook designed to hold its own process open while waiting for a human decision (mirroring the existing MCP permission-prompt-tool's no-timeout socket pattern) gets canceled by the Claude Code CLI once its configured `timeout` elapses (default 600 seconds), and the tool call it was supposed to block **proceeds anyway** under `bypassPermissions` mode.
**Why it happens:** Claude Code's hook timeout semantics are explicitly documented [CITED: code.claude.com/docs/en/hooks]: "Apart from a command hook you run with `async: true`, Claude Code cancels a `command`, `http`, or `mcp_tool` hook that reaches its `timeout`, discarding the hook's output" and, specifically for `PreToolUse`: "A timed-out `command`, `http`, or `mcp_tool` hook doesn't block the tool call. The call continues through the normal permission flow." This is not a hypothetical reading of the docs — it was reproduced live this session.
**How to avoid:** Do not architect the destructive-action gate's indefinite-blocking guarantee (D-58) around the PreToolUse hook alone. For every D-56 category that is a `git` invocation, make the **shim** (a plain OS process with no CLI-imposed timeout) the component that actually blocks; let the hook be a fast, synchronous classifier only. For the one category the shim cannot see (`rm -rf`, which never calls `git`), either configure the hook's `timeout` to a very large value (docs state no documented maximum, but this was not independently stress-tested this session — flag for a planning-time spike) or explicitly accept and surface the residual "bounded by timeout" risk rather than silently claiming full "always" coverage.
**Warning signs:** A destructive command executes despite an apparently-denying hook; `claude`'s own `permission_denials` array in its result event is empty for a command that should have been denied (this is exactly what the spike below observed).

### Pitfall 2: Conflating two different git lock files under one mental model

**What goes wrong:** Treating `anthropics/claude-code#55724` (parallel agents' *commits* losing to `.git/index.lock`) and `anthropics/claude-code#34645` (parallel agents' `git worktree add` losing to `.git/config.lock`) as the same failure with the same fix.
**Why it happens:** Both surface as "a lock file collision under parallel git operations," and both are cited together in this project's own PITFALLS.md pitfall 1 — but they occur at different times in the lifecycle (worktree creation vs. an established worktree's own commits) and are addressed by different decisions in this phase: D-52 (spawn stagger, for `worktree add`/`config.lock`) and D-51/D-54 (the shim's retry, for in-worktree `git commit`/`index.lock`-and-adjacent-lock collisions).
**How to avoid:** Design the stress test for success criterion 4 to specifically exercise *ten concurrent commits inside ten already-created worktrees* (per `03-CONTEXT.md`'s own reading: "criterion 4 is a statement about commits, and agents commit") — a test that only exercises ten simultaneous `worktree add` calls would validate D-52 but say nothing about D-51/D-54.
**Warning signs:** A stress-test harness that creates all ten worktrees as its setup step and only then times the commits is testing the right thing; one that creates worktrees and commits in the same tight parallel loop is conflating the two failure modes.

### Pitfall 3: Assuming per-worktree index files make the shim's retry logic unnecessary

**What goes wrong:** Reading "each worktree has its own index file" [CITED: git-scm.com/docs/git-worktree, this session — "In general, all pseudo refs are per-worktree... refs starting with refs/ are shared. Pseudo refs are ones like HEAD..."] and concluding that concurrent commits across worktrees therefore cannot collide on any lock at all.
**Why it happens:** The index genuinely is per-worktree — but `refs/`, `objects/`, and git's own background maintenance (`gc.auto`, `git maintenance`) are shared across every worktree in the repository, and the literal error text quoted in `#55724` ("Unable to create '.git/index.lock': File exists" [CITED: github.com/anthropics/claude-code/issues/55724, fetched this session]) shows real collisions still occurring in practice at 13-way parallelism.
**How to avoid:** Keep the shim's retry logic in place regardless of per-worktree index separation; broaden its match pattern beyond the literal substring `index.lock` to the general git lock-file failure shape (`Unable to create '<path>.lock': File exists`), since the actual contended file may be a ref lock, `config.lock`, or a gc-related lock rather than literally `index.lock`.
**Warning signs:** A shim that only greps for the string `index.lock` and passes every test in a two-worktree local repro, then fails to catch a real collision on the project's own larger integration branch under `gc.auto`-triggered background maintenance.

### Pitfall 4: Building the watchdog wrapper without re-deriving D-35's process-group contract

**What goes wrong:** Inserting a wrapper process between the sidecar and `claude` without checking that D-35's existing `interruptSession`/`killSession` — which signal `-pid` (negative of `claude`'s own PID) — still reach the right target once `claude` is no longer the direct child of the sidecar.
**Why it happens:** `claude-code-adapter.ts`'s `interruptSession` reads `session.child.pid` and signals `-pid` [VERIFIED: `packages/sidecar/src/claude-code-adapter.ts`, read this session — `process.kill(-pid, "SIGINT")` and the surrounding `LiveSession.child` field]. If the wrapper becomes the tracked `child` instead of `claude`, this still works *only if* the wrapper is the process-group leader and `claude` is spawned inside that same group — get the spawn order or the `detached` flag wrong and D-35's Stop button silently stops signaling the actual `claude` process.
**How to avoid:** Write (or extend) a test in the style of the existing `interruptSession`/D-35 tests that asserts the *entire* group (wrapper + `claude`) is asked to exit, not just the wrapper.
**Warning signs:** Stop appears to work (the wrapper exits) but the underlying `claude` process is now orphaned from the sidecar's own tracking — exactly the failure this phase exists to prevent, self-inflicted by the fix for a different failure.

## Code Examples

### The reconciliation pattern to copy verbatim in shape

```rust
// Source: packages/core/src/domain/project.rs:335-374 (read this session, quoted above in
// "Architecture Patterns" Pattern 1). Apply the identical shape to worktrees: list, stat,
// write-on-change-only, one event per change, never touch the row's path/branch fields.
```

### The existing PATH-injection precedent for a spawned session

```typescript
// Source: packages/sidecar/src/claude-code-adapter.ts (read this session) — the exact spawn
// call the shim's PATH entry and the watchdog wrapper must both slot into without breaking:
const child = spawn(bin, argv, {
  cwd: options.worktreePath,
  env: { ...process.env, ...options.env },
  // Own process group, so D-35's "force" step can signal the whole group, never just this
  // one PID (RESEARCH.md Pitfall 3).
  detached: true,
});
```
`options.env` is already the seam D-51's shim uses to prepend its own directory to `PATH`, and where D-55's `--settings` JSON (added to `buildClaudeArgv`'s returned argv, not `env`) would be threaded through.

### The hook mechanism verified working this session

```json
{
  "hooks": {
    "PreToolUse": [
      {
        "matcher": "Bash",
        "hooks": [
          { "type": "command", "command": "/absolute/path/to/hook-script.sh" }
        ]
      }
    ]
  }
}
```
Invoked as `claude -p "..." --permission-mode bypassPermissions --settings /path/to/above.json --output-format stream-json --verbose`. Verified this session: the hook script received `{"tool_input":{"command":"git push --force origin main", ...}, ...}` on stdin, printed `{"hookSpecificOutput":{"hookEventName":"PreToolUse","permissionDecision":"deny","permissionDecisionReason":"..."}}`, exited 2, and the resulting transcript's terminal `result` event carried `"permission_denials":[{"tool_name":"Bash","tool_use_id":"...","tool_input":{"command":"git push --force origin main",...}}]` with `"tool_result_meta":[{"non_execution_kind":"permission-rule"}]` — the push never reached git at all, **despite `permissionMode` reading `"bypassPermissions"` in the same session's own `init` event.**

## State of the Art

| Old Approach | Current Approach | When Changed | Impact |
|--------------|------------------|---------------|--------|
| `--permission-prompt-tool` as the sole gate on tool calls (Phase 2's AGNT-06 design) | `--permission-prompt-tool` + a `PreToolUse` hook injected via `--settings`, layered as defense-in-depth | This phase (Phase 3), forced by Phase 2's own 02-05 spike finding that the CLI's built-in bash-command classifier can approve a command without ever consulting `--permission-prompt-tool` | AGNT-07's "always" cannot be satisfied by the permission-prompt-tool mechanism alone; a second, earlier-firing interception point is required |
| Assuming a worktree's own index eliminates git lock contention | Recognizing two distinct contention windows (worktree-creation-time `config.lock`, commit-time index/ref/gc locks) requiring two distinct mitigations (D-52 stagger, D-51/D-54 retry) | This research session, cross-referencing `#55724` and `#34645` directly | Changes what the stress-test harness for criterion 4 must actually exercise |

**Deprecated/outdated:**
- The mental model "a PreToolUse hook can just hold the process open and wait for a human, like the MCP permission-prompt-tool does" — falsified this session; the hook is timeout-bounded, the MCP tool call (per `mcp-permission-server.ts`'s own doc comment, "no timer, no default, no local cache... the sidecar asks and waits") is not.

## Assumptions Log

| # | Claim | Section | Risk if Wrong |
|---|-------|---------|---------------|
| A1 | A tested-minimum git version of 2.44 is a reasonable floor to document | Standard Stack | If the actual minimum supported per-worktree-index/locking behavior this phase depends on requires a newer git, a developer on an older git could hit undocumented failure modes the plan never tested against. Recommend the planner pick a concrete CI-tested minimum rather than accepting this figure uncritically. |
| A2 | `sysinfo` is the right crate for PID-reuse-safe orphan detection | Standard Stack, Don't Hand-Roll | Package name came from WebSearch/training knowledge, not an authoritative source; while the legitimacy gate returned `[OK]`, a `checkpoint:human-verify` should confirm the crate's actual API shape (`start_time()` comparison) against the installed version before committing code to it. |
| A3 | A hook `timeout` field has no documented maximum and can be set arbitrarily high as a mitigation for Pitfall 1 | Common Pitfalls #1 | Not independently stress-tested this session (only a 1-second timeout was tested, to confirm the *fallthrough*, not the *ceiling*). If the CLI silently clamps large timeout values, the mitigation of "just set a huge timeout" does not actually restore indefinite-blocking behavior for the non-git (`rm -rf`) case, and the residual gap is larger than a config tweak can close. |
| A4 | Windows Job Objects and macOS kqueue `EVFILT_PROC` are the correct primitives for a future non-macOS port | Standard Stack / Don't Hand-Roll (background context only — D-47 already chose the heartbeat-file approach, which needs neither) | Low risk to this phase specifically, since v1 targets macOS only and D-47's design is platform-uniform; only matters if a future phase revisits the watchdog design for Windows/Linux parity. |

**If this table is empty:** N/A — see rows above.

## Open Questions

1. **Does the git-lock contention this phase must survive occur even with each worktree's own separate index file, or would ROADMAP.md's evidence base look different on a from-scratch repro against this project's own stack (git 2.54, macOS)?**
   - What we know: Two named GitHub issues report real collisions (`config.lock` at worktree-add time in `#34645`, `index.lock`-shaped errors at commit time in `#55724`), and official git docs confirm the index is per-worktree while refs/objects/maintenance locks are shared.
   - What's unclear: Neither issue was reproduced against this specific project's exact git version and worktree topology (`~/Flywheel/<PROJECT-KEY>/<TASK-KEY>/`, one branch per task) — ROADMAP.md's own research flag explicitly asked for this.
   - Recommendation: The planner should treat criterion 4's stress-test task as the actual reproduction, run once against 10 real worktrees under this project's own topology, before deciding the shim's retry parameters are sufficient — do not treat this research's secondary sources as a substitute for that direct test.

2. **What is the actual maximum (or unbounded-ness) of a Claude Code hook's `timeout` field?**
   - What we know: The default is 600s for a `command` hook on `PreToolUse`; a timed-out hook falls through to normal permission flow (verified this session).
   - What's unclear: Whether an arbitrarily large configured `timeout` (e.g., 86400) is honored without a hidden ceiling, and whether `async: true` (mentioned in the docs as exempt from the cancel-on-timeout behavior) is a viable alternative shape for a hook that needs to wait on a human without itself blocking the tool call's classification.
   - Recommendation: Spike this specifically during planning (mirroring Phase 2's 02-05 spike pattern) before deciding whether the hook can ever be relied on as more than a fast/best-effort layer for the non-git destructive-command case.

3. **What does `delete_task` do with `triggers`/`agent_runs`/`permission_requests` rows once D-44 unblocks deletion?**
   - What we know: `03-CONTEXT.md` explicitly reopens this question and defers it to planning.
   - What's unclear: Whether these rows are cascaded, orphaned-but-retained, or reassigned.
   - Recommendation: Out of this research's scope (a data-lifecycle decision, not a technical-domain question) — flag for the planner to resolve explicitly, since it is the one open item in `03-CONTEXT.md`'s discretion list with no UI-SPEC resolution and no clear precedent in Phase 1/2's decisions.

## Environment Availability

| Dependency | Required By | Available | Version | Fallback |
|------------|------------|-----------|---------|----------|
| System `git` | WORK-03..06, AGNT-07 shim | ✓ [VERIFIED: `git --version`, this session] | 2.54.0 (Apple Git-157) | — |
| `claude` CLI | AGNT-07 hook mechanism, all agent runs | ✓ [VERIFIED: `claude --version`, this session] | 2.1.236 | — |
| Node.js (sidecar runtime) | Watchdog wrapper, shim if Node-based | ✓ [VERIFIED: `node --version`, this session] | v22.22.3 | — |
| `sysinfo` crate | Orphan PID-reuse-safe detection | Not yet a dependency — needs `cargo add` | 0.39.6 available on crates.io [VERIFIED: `cargo search`, this session] | Hand-rolled per-platform PID+start-time reads (not recommended — see Don't Hand-Roll) |
| macOS (target platform for v1) | Everything in this phase | ✓ [VERIFIED: `uname -a`, this session — Darwin 25.6.0, arm64] | — | — |

**Missing dependencies with no fallback:** none.
**Missing dependencies with fallback:** `sysinfo` is not yet vendored; a hand-rolled fallback exists but is explicitly discouraged (see Don't Hand-Roll).

## Validation Architecture

### Test Framework

| Property | Value |
|----------|-------|
| Framework | `cargo test` (Rust core, existing `packages/core/tests/`), `vitest` 5.0.0 (desktop frontend) [VERIFIED: `packages/desktop/package.json`, this session], `node --test` (sidecar) [VERIFIED: `packages/sidecar/package.json`, this session] |
| Config file | none dedicated — `packages/desktop/package.json`'s `"test": "vitest run"` script; `packages/sidecar/package.json`'s `"test": "npm run build && node --test test/*.test.mjs"` |
| Quick run command | `cargo test -p core <test_name>` / `npx vitest run <file>` / `node --test test/<file>.test.mjs` |
| Full suite command | `cargo test --workspace` / `npm run test` (desktop) / `npm run test` (sidecar) |

### Phase Requirements → Test Map

| Req ID | Behavior | Test Type | Automated Command | File Exists? |
|--------|----------|-----------|-------------------|-------------|
| WORK-03 | Refused removal on a dirty worktree; succeeds on a clean one | integration (real repo, real git) | `cargo test -p core worktree_removal -- --nocapture` | ❌ Wave 0 — new test file alongside `worktree_lifecycle.rs` |
| WORK-04 | 10 concurrent commits into one repository, zero lost | integration, real spawned processes (the "reproduction," not a mock) | new binary in `packages/core/tests/bin/` mirroring `crash_harness.rs`'s pattern | ❌ Wave 0 |
| WORK-05 | No two spawns against the same repo within the configured floor | unit/integration on the supervisor's spawn-gating logic | `cargo test -p core spawn_stagger` | ❌ Wave 0 |
| WORK-06 | A worktree removed on disk (not through Flywheel) surfaces as `missing` at next launch | integration | `cargo test -p core reconcile_worktrees` | ❌ Wave 0 |
| PROC-03 | Interrupt/kill reaches the whole process group including the new watchdog wrapper | integration, real spawned process, real signal | extend `packages/core/tests/stop_lifecycle.rs`'s pattern | ❌ Wave 0 (extends existing file) |
| PROC-04 | `kill -9` on the supervisor leaves zero orphaned `claude` processes | integration, real `kill -9`, following `crash_harness.rs`'s established precedent for proving process-level guarantees with real spawned processes | new binary + test, mirroring `crash_harness.rs` | ❌ Wave 0 |
| PROC-05 | Launch after a simulated crash surfaces every orphan/in-flight-run/missing-worktree discrepancy | integration | `cargo test -p core launch_reconciliation` | ❌ Wave 0 |
| AGNT-07 | A destructive command is denied even under `bypassPermissions` | integration against the real `claude` binary (per this session's own spike pattern — not mockable, since the thing under test is the CLI's own hook/permission plumbing) | new test mirroring the empirical spike run in this research session | ❌ Wave 0 |

### Sampling Rate

- **Per task commit:** the relevant quick-run command for the file touched.
- **Per wave merge:** full suite for the touched package (`cargo test --workspace` at minimum, since process-group/reconciliation changes in `packages/core` are exactly the kind of change with cross-module blast radius this codebase's own `supervisor_cwd.rs` gate exists to catch).
- **Phase gate:** Full suite green before `/gsd-verify-work`, plus a manual or scripted run of the criterion-4 stress test (10 concurrent commits) and the criterion-2 force-quit test (`kill -9` on the supervisor process, not just the Quit menu item — this codebase's own `crash_harness.rs` precedent already tests exactly this shape for the database; this phase needs the equivalent for the process tree).

### Wave 0 Gaps

- [ ] `packages/core/tests/worktree_removal.rs` — covers WORK-03
- [ ] `packages/core/tests/bin/commit_stress_harness.rs` + `packages/core/tests/lock_contention.rs` — covers WORK-04, mirroring `crash_harness.rs`'s "separate binary, real spawned processes" pattern
- [ ] `packages/core/tests/spawn_stagger.rs` — covers WORK-05
- [ ] `packages/core/tests/reconcile_worktrees.rs` — covers WORK-06
- [ ] Extension to `packages/core/tests/stop_lifecycle.rs` — covers PROC-03's group-inclusive-of-wrapper assertion
- [ ] `packages/core/tests/bin/watchdog_harness.rs` (a `kill -9`-able binary, mirroring `crash_harness.rs`) + `packages/core/tests/watchdog_survival.rs` — covers PROC-04
- [ ] `packages/core/tests/launch_reconciliation.rs` — covers PROC-05
- [ ] A real-`claude`-binary integration test for the destructive-gate mechanism, following this session's own spike shape — covers AGNT-07

## Security Domain

### Applicable ASVS Categories

| ASVS Category | Applies | Standard Control |
|---------------|---------|-----------------|
| V2 Authentication | no | This phase touches no auth surface |
| V3 Session Management | no | — |
| V4 Access Control | yes | The destructive-action gate (D-55/56/57/58) is an access-control mechanism gating specific git operations; the shim must validate it is intercepting the REAL git binary, not a second shim, to avoid a bypass-by-substitution |
| V5 Input Validation | yes | The shim parses its own argv to classify D-56 categories; the hook parses `tool_input.command` from an untrusted JSON payload the CLI provides — both must fail closed (treat unparseable input as destructive, per D-56's own "uncategorized destructive commands fail closed" UI rule) rather than fail open |
| V6 Cryptography | no | Not applicable to this phase's scope |

### Known Threat Patterns for this stack

| Pattern | STRIDE | Standard Mitigation |
|---------|--------|---------------------|
| A malicious or buggy agent script prepends its own directory to `PATH` ahead of Flywheel's shim entry, or resolves `git` via an absolute path that bypasses the shim entirely | Tampering / Elevation of Privilege | The spawned session's environment must place the shim's directory unambiguously first in `PATH`; the shim itself should be the ONLY thing on that `PATH` prefix, and its own resolution of "the real git" must not simply call `command -v git` again (which could re-resolve to itself in a misconfigured environment) — resolve the real binary once, by absolute path, at shim-install time, not per-invocation |
| A hook script or shim binary that fails open on a parse error (e.g., cannot parse `tool_input.command` as expected) | Repudiation / Tampering | Both interception points must fail CLOSED (treat as destructive/deny) on any input they cannot confidently classify — this is already the UI-SPEC's own decided behavior for the hook (D-56's "uncategorized destructive commands fail closed into this variant") and should be mirrored in the shim |
| PID-reuse causing the launch reconciler to misidentify a brand-new, unrelated process as "the same orphaned agent" and either kill an innocent process or fail to kill the actual orphan | Denial of Service (against the wrong target) / financial harm (against the real target, if missed) | PID + process start-time pairing (the `sysinfo`-based approach above), never bare PID comparison |

## Sources

### Primary (HIGH confidence — empirical, this session)

- Two empirical spikes run against the installed `claude` 2.1.236 binary in this session: (1) a `--settings`-injected `PreToolUse` hook denying `git push --force origin main` under `--permission-mode bypassPermissions`, confirmed blocked via the transcript's `permission_denials`/`tool_result_meta.non_execution_kind: "permission-rule"`; (2) the same mechanism with a 1-second hook `timeout` against a 3-second-sleeping hook script, confirmed the destructive command (`git branch -D victim-branch`) executed anyway once the hook was canceled.
- `claude --help` output, installed 2.1.236 binary — confirms `--settings <file-or-json>`, `--permission-mode` accepted values, `--bare` skips hooks.
- `git --version` (2.54.0, Apple Git-157), `node --version` (v22.22.3), `uname -a` (Darwin 25.6.0 arm64) — this machine's actual environment.
- `packages/core/src/git.rs`, `packages/core/src/domain/{worktree,project,agent_run}.rs`, `packages/core/src/db/{mod.rs,migrations/0003_agent_runtime.sql,migrations/0004_permission_gate.sql}`, `packages/core/src/session_log.rs`, `packages/desktop/src-tauri/src/{main.rs,sidecar.rs}`, `packages/sidecar/src/{claude-code-adapter.ts,mcp-permission-server.ts}` — all read directly this session.

### Secondary (MEDIUM confidence — official docs / primary-source issues, WebSearch-verified)

- [Git - git-worktree Documentation](https://git-scm.com/docs/git-worktree) — per-worktree vs. shared files, `remove --force`/`--force --force` semantics.
- [Agent isolation: worktree — parallel agents lose work due to git lock contention + auto-cleanup, anthropics/claude-code#55724](https://github.com/anthropics/claude-code/issues/55724) — the exact error text and 8/13 failure rate, fetched directly this session.
- [Parallel subagents with worktree isolation fail due to git config lock contention, anthropics/claude-code#34645](https://github.com/anthropics/claude-code/issues/34645) — the distinct `config.lock`/`worktree add` failure mode, fetched directly this session.
- [Hooks reference — Claude Code Docs](https://code.claude.com/docs/en/hooks) — PreToolUse schema, exit-code/timeout semantics, settings precedence, `--settings` flag, hooks-under-`bypassPermissions` behavior — fetched directly this session.
- [PR_SET_PDEATHSIG manpage](https://manpages.ubuntu.com/manpages/stonking/man2/PR_SET_PDEATHSIG.2const.html), [Tokio + prctl = nasty bug](https://kobzol.github.io/rust/2025/02/23/tokio-plus-prctl-equals-nasty-bug.html) — Linux-only, multi-threaded-parent caveat.
- [Waiting for process groups, macOS edition (jmmv.dev)](https://jmmv.dev/2019/11/wait-for-process-group-darwin.html) — kqueue `EVFILT_PROC`/`NOTE_EXIT` as the macOS analog, confirming no `PDEATHSIG` equivalent exists.
- [Windows Job Objects for process-tree management (Nikhil's blog)](https://nikhilism.com/post/2017/windows-job-objects-process-tree-management/), [Kill process on exit, tauri-apps/tauri#3273](https://github.com/orgs/tauri-apps/discussions/3273) — Windows-specific background context (out of scope for v1's macOS target, retained for the "don't foreclose Windows/Linux" architecture constraint).
- `sysinfo` crate — `docs.rs/sysinfo`, `github.com/GuillaumeGomez/sysinfo`, `cargo search` output (this session) confirming `0.39.6`.

### Tertiary (LOW confidence — WebSearch only, illustrative)

- Various practitioner blogs on `.git/index.lock` recovery and retry parameters (200ms→400ms→800ms, 3–5 attempts) — consistent with this project's own PITFALLS.md, treated as a starting point, not a verified benchmark.

## Metadata

**Confidence breakdown:**
- Standard stack: MEDIUM — `sysinfo` is a training/WebSearch-sourced name (tagged ASSUMED per provenance rules) though registry-verified as legitimate; the git/claude-CLI version findings are locally VERIFIED.
- Architecture: HIGH — the reconciliation, process-group, and PATH-injection patterns are all grounded in code read directly this session, not inferred.
- Pitfalls: HIGH for the hook-timeout finding (directly reproduced, twice, this session, with pasted failing output) and the two-distinct-lock-files finding (both primary sources fetched and quoted directly); MEDIUM for the general index-lock backoff guidance (WebSearch-corroborated, matches the project's own existing PITFALLS.md).

**Research date:** 2026-09-12
**Valid until:** 30 days for the git/architecture findings (stable); 7 days for the Claude Code CLI hook-timeout finding specifically, since this is exactly the kind of fast-moving CLI behavior that changed at least once already in this project's own history (Phase 2's 02-05 spike found different classifier behavior than training-data expectations) — re-verify against whatever `claude` version is installed at planning time if more than a week has passed.
