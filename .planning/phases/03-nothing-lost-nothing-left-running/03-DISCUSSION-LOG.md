# Phase 3: Nothing Lost, Nothing Left Running - Discussion Log

> **Audit trail only.** Do not use as input to planning, research, or execution agents.
> Decisions are captured in CONTEXT.md — this log preserves the alternatives considered.

**Date:** 2026-09-12
**Phase:** 3-nothing-lost-nothing-left-running
**Areas discussed:** Worktree safety & recovery surface, Orphaned agents & the dying supervisor, Whose git survives index-lock, The destructive-action gate

---

## Worktree safety & recovery surface

### Where does the "remove this worktree" verb live?

| Option | Description | Selected |
|--------|-------------|----------|
| On the task, in `WorktreeSummary` | The component already renders path, branch and base; removal is an action on a record already on screen. It is also the block broken-window #6 says must learn to say "missing from disk". Cost: no way to see every worktree at once. | ✓ |
| A project-scoped Worktrees list | A new surface listing every worktree with status, removal per row; could double as the recovery screen's mount point. Cost: a whole new surface; `worktrees.status` has four accepted values but only `active` is ever written. | |
| Both — task action, list for the sweep | Per-task action for the common case plus the list for bulk reclamation. Most complete, most work. | |

**User's choice:** On the task, in `WorktreeSummary`
**Notes:** → D-41. The project-scoped list was captured as a deferred idea for Phase 9/10.

### When removal is refused, what does Flywheel show as "exactly what would have been lost"?

| Option | Description | Selected |
|--------|-------------|----------|
| The porcelain list — paths + status | Parse `git status --porcelain` and render one row per entry (modified / added / deleted / untracked) plus the count. Makes criterion 1 literally true; does not pre-empt Phase 8. | ✓ |
| A count and one sentence | "3 uncommitted changes — this worktree was not removed", with the path shown. Smallest surface. Cost: the user must leave Flywheel to find out what the changes are. | |
| The full diff, inline | Render the actual `git diff`. Most information. Cost: Phase 8's job five phases early, with its own virtualization problem. | |

**User's choice:** The porcelain list — paths + status
**Notes:** → D-42.

### Is there any way past the refusal?

| Option | Description | Selected |
|--------|-------------|----------|
| No escape hatch in v1 | The refusal is terminal; the user cleans the tree in a terminal and removal then succeeds. Rigidity is the feature. | ✓ |
| Force-remove behind a typed confirmation | Type the task key, then `git worktree remove --force`. Cost: the one code path capable of destroying uncommitted work — exactly what turned `#55724` from a lock collision into data loss. | |
| Offer safe outs — stash, then remove | Stash or commit, then remove; nothing is destroyed. Cost: writes git the user did not author, which D-35 refused to do on Stop. | |

**User's choice:** No escape hatch in v1
**Notes:** → D-43, rated reversible (adding an override later is purely additive).

### On relaunch after a crash, how hard does the recovery surface insist on a decision?

| Option | Description | Selected |
|--------|-------------|----------|
| Blocking only when money is burning | A live orphaned process blocks; a mismatched worktree or a stuck `running` row becomes a persistent needs-you item. Splits along the phase's own name. | ✓ |
| One blocking screen for everything | Criterion 3's "decides what happens to each" becomes structurally guaranteed. Cost: one stale row stands between the user and their board every launch. | |
| Never blocking — a persistent needs-you item | Reuses D-37's board state plus project-rail count exactly. Cost: an orphan keeps spending while the count sits unread. | |

**User's choice:** Blocking only when money is burning
**Notes:** → D-46. The user chose to continue with more questions in this area rather than move on.

### D-40 blocks deleting a task with agent-run history. Now that a worktree-removal path exists, what happens?

| Option | Description | Selected |
|--------|-------------|----------|
| Unblocks once the worktree is gone | The refusal becomes the actionable sentence D-40 intended. Deletion stays blocked while a `worktrees` row exists. One guard, one order of operations. | ✓ |
| Stays blocked — history is the point | D-40's rejected Option B rejected permanently. Cost: a task started by mistake is permanently undeletable. | |
| Delete offers to remove the worktree too | Fewest steps. Cost: chains two destructive operations behind one confirmation. | |

**User's choice:** Unblocks once the worktree is gone
**Notes:** → D-44. What deletion does to the `triggers`/`agent_runs`/`permission_requests` rows was left to planning.

### What does a worktree the database calls `active` but the disk does not have become?

| Option | Description | Selected |
|--------|-------------|----------|
| A new `missing` status, surfaced not repaired | Migration adds `missing` to the CHECK; the row is never deleted and the path never rewritten. D-16's `reconcile_projects` contract applied to worktrees; closes broken-window #6. | ✓ |
| Reuse `stale` — no schema change | `stale` exists and is unused. Cost: overloading it now means a later phase cannot distinguish *gone* from *old*. | |
| Leave the status, carry it as a derived signal | Compute disk presence at read time. Cost: every reader stats the filesystem, and "the user decided" has nowhere to live. | |

**User's choice:** A new `missing` status, surfaced not repaired
**Notes:** → D-45, rated costly (CHECK-constraint change means a SQLite table rebuild).

---

## Orphaned agents & the dying supervisor

**Framing presented before the questions:** the sidecar's stdin-EOF net already covers a SIGKILL'd Tauri process. What nothing covers is the sidecar itself dying — every `claude` is spawned `detached: true` as its own process-group leader, so it is in no group the sidecar's death would reach, and macOS has no `PDEATHSIG`.

### What mechanism makes "no agent survives, even when the supervisor is killed rather than closed cleanly" true?

| Option | Description | Selected |
|--------|-------------|----------|
| Heartbeat file + per-session watchdog | Core touches a heartbeat; a thin wrapper per session polls it and kills its own process group when stale. PITFALLS pitfall 4's named pattern; the only one surviving a SIGKILL of the whole tree. The files double as PROC-05's orphan record. | ✓ |
| Reparent detection (`getppid() == 1`) | Same wrapper, no file, no staleness threshold. Cost: blind to a wedged-but-alive supervisor; leaves no breadcrumb. | |
| Drop `detached` — one group for everything | Smallest change. Cost: breaks D-35's Stop, and macOS does not cascade a SIGKILL to a group anyway. | |

**User's choice:** Heartbeat file + per-session watchdog
**Notes:** → D-47, rated costly (a real on-disk protocol plus one extra process per session).

### Does the watchdog give the agent the same grace D-35 gives a user-initiated Stop?

| Option | Description | Selected |
|--------|-------------|----------|
| Straight to force — no grace | Nobody is watching; there is nothing to receive a clean exit and every second of grace is metered spend. The worktree is left dirty either way. | ✓ |
| Reuse D-35's interrupt-then-force | One termination path in the product. Cost: a few more seconds of unattended spend per session. | |

**User's choice:** Straight to force — no grace
**Notes:** → D-48. Knowingly diverges from D-35; the divergence is recorded in CONTEXT.md.

### What does the board finally say about a run that was `running` when the app died?

| Option | Description | Selected |
|--------|-------------|----------|
| A new `abandoned` status | Written by the launch reconciler; lets the trail distinguish a deliberate Stop from a crash. | ✓ |
| Reuse `interrupted` | No migration. Cost: "why did this run end?" becomes unanswerable from the row. | |
| Stay `running` until the user decides | Maximally "nothing is silently repaired". Cost: the board knowingly lies about a process that does not exist. | |

**User's choice:** A new `abandoned` status
**Notes:** → D-49, rated costly (same CHECK-constraint rebuild as D-45).

### The watchdog cannot write to SQLite — does it leave anything behind?

| Option | Description | Selected |
|--------|-------------|----------|
| Yes — a per-session kill record on disk | Run id, pid, reason, timestamp, written beside the heartbeat before killing. The Rust core stays the only SQLite writer. | ✓ |
| No — absence is the signal | Nothing extra to write or keep consistent. Cost: "killed cleanly" and "vanished unknown" become indistinguishable. | |

**User's choice:** Yes — a per-session kill record on disk
**Notes:** → D-50. The user chose "Next area" at the continuation check; heartbeat interval, staleness threshold, adoption-vs-kill and per-run-vs-all-at-once kill were left to Claude's discretion.

---

## Whose git survives index-lock

**Framing presented before the questions:** criterion 4 says a stress run driving ten concurrent *commits* must keep every commit. Agents run their own `git commit`; `packages/core/src/git.rs` never sees those calls.

### Whose git operations does the protection actually cover?

| Option | Description | Selected |
|--------|-------------|----------|
| A git shim on the worktree's PATH | A Flywheel-owned `git` wrapper prepended to the session's PATH, forwarding to the real binary with backoff and jitter. The only design protecting the agent's own commits; also the seam AGNT-07 and Phase 9's file-set enforcement want. Cost: a real architectural commitment; a broken shim breaks every agent. | ✓ |
| Shim that leases from the supervisor | PITFALLS pitfall 1's own suggestion — serialized, deterministic, observable. Cost: needs IPC reachable from inside a worktree, and a wedged supervisor blocks git entirely. | |
| No shim — protect only Flywheel's own calls | Retry inside `git_at`; nothing injected into the agent's environment. Cost: criterion 4 cannot be met as written. | |

**User's choice:** A git shim on the worktree's PATH
**Notes:** → D-51, rated costly.

### How is spawn timing desynchronised (WORK-05)?

| Option | Description | Selected |
|--------|-------------|----------|
| Supervisor-enforced minimum interval | A hard floor between two spawns against the same repository. A real, testable guarantee, living where every pending start is visible. | ✓ |
| Random jitter per spawn | PITFALLS' literal 100–500ms suggestion. Cost: probability reduction, not a guarantee; nothing to assert in a test. | |
| Both — floor plus jitter on top | Most robust; slightly more machinery. | |

**User's choice:** Supervisor-enforced minimum interval
**Notes:** → D-52. The planner may add jitter on top if it is nearly free; the floor is the required part.

### How visible are lock collisions and retries?

| Option | Description | Selected |
|--------|-------------|----------|
| Count them on the run; surface exhaustion | Per-run collision counter, quiet while retries succeed; exhaustion raises a board event naming repository, command and attempts. Gives PITFALLS' "failures correlated with wave width" a number to look at. | ✓ |
| Every collision is an event in the log | Complete auditability. Cost: many rows for something resolved in 200ms; noise in the activity trail. | |
| Silent — git's own error on exhaustion | Nothing to build. Cost: the failure mode this phase exists to kill becomes an ordinary agent error. | |

**User's choice:** Count them on the run; surface exhaustion
**Notes:** → D-53.

### `git_at` and the shim both need backoff. One policy or two?

| Option | Description | Selected |
|--------|-------------|----------|
| One policy, shared by both | A single module in `packages/core`; the shim is a thin binary calling the same code. Matches how `git.rs` is already treated as the ONE `Command::new("git")` site. | ✓ |
| Two — shim owns its own | The shim stays trivially auditable and immune to core changes. Cost: two policies that will drift. | |

**User's choice:** One policy, shared by both
**Notes:** → D-54. The user chose "Next area"; backoff curve, retry budget, the floor's actual value, shim build/placement, and whether the stress run is CI or manual were left to Claude's discretion.

---

## The destructive-action gate

**Framing presented before the questions:** Phase 2's 02-05 spike found the installed `claude` CLI applies its own bash-safety classification before consulting a configured `--permission-prompt-tool`, recorded verbatim as a Phase 3 input. The MCP gate built in Phase 2 therefore cannot on its own satisfy a requirement whose word is *always*.

### How is AGNT-07 actually enforced?

| Option | Description | Selected |
|--------|-------------|----------|
| Both — PreToolUse hook, shim as backstop | The hook fires before the CLI's classification, can block, and can return a reason the agent understands; the shim is the line that cannot be reasoned around. Defense in depth on the one requirement that says "always". | ✓ |
| PreToolUse hook only | Clean and semantic. Cost: Claude-Code-specific, so "always" depends on a config file the environment could in principle not honour. | |
| PATH shim only | Backend-independent. Cost: only catches what goes through those binaries; a script calling `os.rmdir` walks past it. | |

**User's choice:** Both — PreToolUse hook, shim as backstop
**Notes:** → D-55, rated costly. The hook must sit behind AGNT-01's adapter seam without the supervisor branching on backend identity.

### What is on the destructive list?

| Option | Description | Selected |
|--------|-------------|----------|
| A wider fixed list | AGNT-07's three plus push to `default_branch`, `git reset --hard`, `git clean -fdx`, and history rewrite. A list stopping at three has a hole shaped like `reset --hard`. | ✓ |
| Exactly the three named | Literally compliant and auditable at a glance. Cost: the user finds the gaps by losing work. | |
| A user-editable list | Adapts per repository. Cost: a safety list that can be edited will be edited down. | |

**User's choice:** A wider fixed list
**Notes:** → D-56.

### Can a D-38 allow-always rule ever cover a destructive action?

| Option | Description | Selected |
|--------|-------------|----------|
| Never — no allow-always, ever | The choice is structurally absent from the card, not merely discouraged. Keeps the Settings rules table free of standing force-push licences. | ✓ |
| Yes, but as its own revocable grant | Avoids prompting a repository that force-pushes constantly. Cost: contradicts the requirement's wording; failure is silent and unbounded. | |
| Yes — same as any other tool | One permission model, no special cases. Cost: AGNT-07 becomes a default rather than a requirement. | |

**User's choice:** Never — no allow-always, ever
**Notes:** → D-57.

### A destructive action is blocked while the user is asleep. What happens to the agent?

| Option | Description | Selected |
|--------|-------------|----------|
| Blocks indefinitely, like any permission request | Run sits at `blocked`, task carries D-37's state, rail counts it. One permission model; the session spends nothing while waiting. | ✓ |
| Auto-deny after a timeout, agent continues | Answers PITFALLS pitfall 11 directly. Cost: an agent routing around a denied force-push may do something stranger, unwatched. | |
| Deny immediately and record it | Zero unattended risk. Cost: never asking is not confirming. | |

**User's choice:** Blocks indefinitely, like any permission request
**Notes:** → D-58. At the final gate the user selected "I'm ready for context" over exploring three further gray areas that were offered (shim identity, the on-disk runtime protocol's location and ownership, and `tauri dev` versus packaged `.app` behaviour) — all three are recorded in CONTEXT.md under Claude's Discretion.

---

## Claude's Discretion

Recorded in full in `03-CONTEXT.md` §Claude's Discretion. Summary:

- The shim's identity and build — one binary or several, Rust or script, placement on `PATH`, behaviour when the real `git` is unresolvable, and whether it intercepts every git subcommand or only mutating ones.
- The on-disk runtime protocol — where the heartbeat, per-session and kill-record files live, the heartbeat interval, the staleness threshold, and who cleans them up.
- The backoff curve, the retry budget, and D-52's minimum-interval value.
- Whether a live orphan can ever be adopted rather than killed (default: kill-only).
- Whether the recovery modal's kill action is per-run or all-at-once, and the surface's layout.
- Whether criterion 4's stress run is an automated CI test or a manual harness.
- Whether any of this phase's machinery behaves differently under `tauri dev` versus a packaged `.app`.
- What `delete_task` does with the agent-runtime rows once D-44 lets the deletion through.
- ROADMAP research flag: expand the lock-contention evidence base and test against multiple git versions during planning.

## Deferred Ideas

Recorded in full in `03-CONTEXT.md` §Deferred Ideas. Summary: a project-scoped Worktrees list (Phase 9/10); supervisor-level serialization of git-mutating operations (Phase 9); tool-call-layer file-set enforcement (Phase 9, PLAN-04/05); adopting a live orphan instead of killing it; an idle-output timeout for a blocked session (pairs with FLEET-04 in Phase 10); worktree disk reclamation (WORK-07, Phase 10); correcting `RLAY-01` (milestone boundary, carried from Phase 1 D-21); closing broken-window #2 in `packages/core/tests/worktree_lifecycle.rs`.
