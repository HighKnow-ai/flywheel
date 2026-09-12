# Phase 3: Nothing Lost, Nothing Left Running - Context

**Gathered:** 2026-09-12
**Status:** Ready for planning

<domain>
## Phase Boundary

Quitting, crashing or interrupting Flywheel at any moment destroys no uncommitted work and leaves no
agent process spending the user's money. Concretely, this phase builds: the product's **first
worktree-removal verb** and the refusal that guards it (a worktree holding uncommitted changes is
never destroyed, and the user is shown exactly what would have been lost); **launch-time
reconciliation** of the worktrees the database records against the worktrees that are actually on
disk, surfaced rather than silently repaired; **orphan detection and recovery** for agent processes
and in-flight runs that outlived a previous session, with the user deciding the fate of each;
**index-lock contention survival** for concurrent git operations, including the agents' own commits,
plus desynchronised spawn timing so parallel starts do not collide in the first place; and a
**destructive-action gate** that an auto-accept permission mode cannot bypass.

Two of the four ranked project-killers from `.planning/research/PITFALLS.md` live here — worktree
lock contention destroying agent work (pitfall 1) and zombie agent processes surviving app quit
(pitfall 4) — and this phase exists as its own vertical slice precisely so each gets a dedicated plan
with its own tests rather than being buried inside Phase 2. The lock-contention work lands **six
phases before real fan-out arrives** (Phase 9), deliberately, rather than being bolted on after the
first data loss.

**Requirements:** WORK-03, WORK-04, WORK-05, WORK-06, PROC-03, PROC-04, PROC-05, AGNT-07.

**Explicitly NOT in this phase:** structured session summaries, context reconstitution and criteria
revisions (Phase 4 — CTX-\*, BOARD-03); Socratic epic authoring (Phase 5); the agent→board write path
and proposal triage (Phase 6); branch, commit and PR status on the board (Phase 7 — LINK-02 through
LINK-11); diff review and merge in-app (Phase 8 — and note that D-42 deliberately stops short of
rendering a diff for this reason); planner fan-out, declared file-sets and the wave overlap guard
(Phase 9 — PLAN-04, PLAN-05, and PITFALLS pitfall 2's tool-call-layer file-set enforcement, even
though D-51's shim is the seam it will use); the cross-project fleet view, OS notifications, worktree
disk reclamation and per-session cost display (Phase 10 — FLEET-\*, WORK-07, AGNT-08).

</domain>

<decisions>
## Implementation Decisions

Decision numbering continues from Phase 2 (D-01–D-22 are Phase 1, D-23–D-40 are Phase 2).

### Worktree removal and its refusal

- **D-41:** **The remove-worktree verb lives on the task, inside `WorktreeSummary`.** The worktree's
  path, branch and base are already rendered there; removal is an action on a record that is already
  on screen, so this phase invents no new surface for it. This is also the component broken-window
  **#6** is waiting on — its "missing from disk" clause was explicitly deferred to Phase 3 WORK-06,
  and D-46 is what finally gives it a backend signal to render.
  Rejected: a project-scoped Worktrees list (a whole new surface in a phase whose UI work is
  otherwise refusals and recovery; `worktrees.status` has accepted `active`/`stale`/`merged`/
  `abandoned` since migration `0003` but nothing has ever written anything but `active`) and building
  both (most complete, most work, and the sweep case is not yet real with one agent at a time).

- **D-42:** **A refused removal renders the `git status --porcelain` output as rows — one per entry,
  with its status (modified / added / deleted / untracked) and its path — plus the count.** This is
  what makes "shows exactly what would have been lost" (success criterion 1) literally true rather
  than a figure of speech, and untracked files are the whole risk, so naming them by path is the
  answer. It is cheap to produce and it deliberately does **not** pre-empt Phase 8's diff review.
  Rejected: a count and one sentence (the user has to leave Flywheel to find out what the changes
  are — the exact move this product exists to stop) and rendering the full diff inline (Phase 8's job
  arriving five phases early, with its own virtualization problem, inside a phase about refusing to
  act).

- **D-43:** **There is no escape hatch. A dirty worktree is simply not removable from inside
  Flywheel.** The refusal is terminal: the user commits, stashes or discards the changes in a
  terminal, and removal then succeeds because the tree is clean. Rigidity is the feature, exactly as
  it is for D-23's fixed worktree root and D-24's fixed branch naming. The phase's own promise is
  "Flywheel refuses and leaves the worktree alone" — an override is the thing that turns that promise
  back into a warning, and `anthropics/claude-code#55724`'s whole lesson is that a force-remove path
  is what converted a lock collision into permanent data loss.
  Rejected: force-remove behind a typed task-key confirmation (it would be the one code path in the
  product capable of destroying uncommitted work) and offering safe outs — stash-then-remove or
  commit-then-remove (it writes git history the user did not author, which is precisely what D-35
  refused to do on Stop).
  — **Reversibility:** reversible — adding an override later is purely additive; nothing depends on
  its absence except the promise itself.

- **D-44:** **Deleting a task with agent-run history unblocks once its worktree is gone.** D-40
  currently blocks the deletion outright and recorded that block as "cheap to revisit once Phase 3
  adds a worktree-removal path"; that path now exists, so the refusal becomes the actionable sentence
  D-40 intended — *remove this task's worktree first, then delete*. Deletion stays blocked while a
  `worktrees` row exists for the task and succeeds once it does not. One guard, one order of
  operations, and no new destructive combination: because D-43 forbids removing a dirty tree, a task
  can never be deleted out from under uncommitted work.
  Rejected: keeping the block permanent (a task started by mistake becomes permanently undeletable
  and the roster only grows) and having delete offer to remove the worktree in the same confirmation
  (it chains two destructive operations behind one click, in the phase whose entire premise is that
  destructive operations are refused rather than streamlined).
  — **Reversibility:** reversible — a guard condition in `delete_task`, no schema change, revisit any
  time. What the deletion does to the `triggers`/`agent_runs`/`permission_requests` rows themselves is
  a separate call left to planning.

### Launch-time reconciliation

- **D-45:** **A worktree the database calls `active` that is not on disk is written to a new
  `missing` status — surfaced, never repaired.** The row is never deleted and the path is never
  rewritten; the user decides whether to recreate the worktree or drop the record. This is D-16's
  `reconcile_projects` contract (detect the mismatch, surface it, never silently rewrite the cached
  value) applied to worktrees, and `reconcile_projects` — which already runs in `main.rs`'s `setup()`
  before any window is shown — is the direct model to copy.
  Rejected: reusing the existing unused `stale` value (no migration, but `stale` will eventually mean
  "the branch is behind" or "nothing has run here in weeks", and overloading it now means a later
  phase cannot distinguish *gone* from *old*) and computing disk presence at read time without
  writing anything (every reader must stat the filesystem, and there is nowhere for "the user decided
  what happens to this" to live).
  — **Reversibility:** costly — `worktrees.status` is CHECK-constrained, so adding a value is a
  migration and SQLite requires a table rebuild to change a CHECK. The schema is the authority here,
  per the Phase 1 rule, so this is not a value app code may simply start writing.

- **D-46:** **Recovery blocks only when money is burning.** A **live orphaned agent process** found at
  launch puts a modal in front of the board — it is spending tokens right now and every second of
  deferral is real money. Everything else — a worktree that disagrees with the database, a run stuck
  at `running` with no process behind it — does **not** block: it lands as a persistent "needs you"
  item that survives dismissal, reusing D-37's board-visible-state-plus-project-rail-count mechanism
  rather than inventing a second one. The split follows the phase's own name: *Nothing Lost* can wait,
  *Nothing Left Running* cannot.
  Rejected: one blocking screen for every discrepancy (a single stale worktree row would stand
  between the user and their board on every launch) and never blocking at all (an orphan can keep
  spending while an unread count sits in the rail — the exact financial harm PITFALLS pitfall 4 rates
  as the trust-killer).

### The dying supervisor

The gap this closes, stated precisely: the sidecar's stdin-EOF fallback net already covers a
SIGKILL'd **Tauri** process, because the sidecar is its child and notices the pipe close. What nothing
covers today is the **sidecar itself** dying — every `claude` session is spawned `detached: true` as
its own process-group leader (deliberately, so `killSession` can signal exactly one session's
subtree), which also means it is in no group the sidecar's death would reach. macOS has no
`PDEATHSIG`, so a poll of some kind is unavoidable.

- **D-47:** **A heartbeat file plus a per-session watchdog.** The Rust core touches a heartbeat file
  on an interval; each session is spawned under a thin wrapper that polls that file and kills its own
  process group when the heartbeat goes stale. This is PITFALLS pitfall 4's named "child monitors
  parent, self-terminates if parent dies" pattern, and it is the only design that survives a SIGKILL
  of the whole app tree at once — which is exactly what success criterion 2's "including when the
  supervisor is killed rather than closed cleanly" demands. The heartbeat and per-session files are
  also the on-disk record PROC-05 needs at next launch, since `agent_runs` stores no pid or pgid
  today and nothing currently identifies an orphan at all.
  Rejected: reparent detection (`getppid() == 1` inside the same wrapper — no file and no staleness
  threshold to tune, but blind to a wedged-but-alive supervisor and it leaves no breadcrumb) and
  dropping `detached: true` so every session joins the sidecar's group (it breaks D-35's Stop, which
  relies on `process.kill(-pid)` reaching one session's subtree, and macOS does not cascade a SIGKILL
  to a group anyway, so it does not even satisfy criterion 2).
  — **Reversibility:** costly — this introduces a real on-disk protocol beside the database and one
  extra process per session; the watchdog becomes load-bearing for criterion 2, and replacing it later
  means changing how every session is spawned.

- **D-48:** **The watchdog goes straight to force — no grace window.** D-35's interrupt-then-force
  exists so an agent can finish its current tool call and shut down cleanly *for a user who is
  watching*. Nobody is watching here: the supervisor is dead, there is nothing to receive a clean
  exit, and every second of grace is metered spend with no observer. The worktree is left dirty and
  inspectable either way, which is already the contract.
  Rejected: reusing D-35's interrupt-then-force for consistency (one termination path is genuinely
  cheaper, but the cost is unattended spend multiplied by however many sessions were running when the
  app died).

- **D-49:** **A run that was `running` when the app died lands in a new `abandoned` status**, written
  by the launch reconciler and never by the dying process. `agent_runs.status` is CHECK-constrained to
  `running`/`blocked`/`completed`/`failed`/`interrupted`; `abandoned` joins it so the activity trail
  can distinguish *the user stopped this* from *the app died under this* — genuinely different facts
  about the same task, in a product whose core value is that the board is the non-repudiable record.
  Rejected: reusing `interrupted` (no migration, but "why did this run end?" becomes unanswerable from
  the row) and leaving the run at `running` until the user picks an outcome (the board knowingly lies
  about a process that does not exist, and a user who never opens the recovery surface has a
  permanently wrong board).
  — **Reversibility:** costly — same CHECK-constraint rebuild as D-45, and once runs carry the value
  the activity trail and any later fleet view read it.

- **D-50:** **The watchdog leaves a kill record on disk.** Before killing, it writes a small file —
  run id, pid, reason, timestamp — beside the heartbeat, so next launch's recovery surface can say
  *"this agent was killed by its watchdog at 14:03 because Flywheel died"* rather than *"this run
  never finished"*. The Rust core still owns every SQLite write; the watchdog only drops a fact for it
  to read and never touches the database, which keeps `better-sqlite3`-in-a-Node-process off the table
  exactly as `.claude/CLAUDE.md` requires.
  Rejected: treating absence as the signal (nothing extra to write or keep consistent, but "killed
  cleanly by its watchdog" and "vanished for reasons unknown" become indistinguishable, so the
  recovery screen could only ever offer a guess).

### Index-lock survival

The honest framing that drove these decisions: success criterion 4 says *"a stress run driving ten
concurrent commits into one repository keeps every commit."* Agents run their own `git commit` inside
their own sessions — `packages/core/src/git.rs` never sees those calls. A retry policy written only in
`git_at` protects worktree-add, branch-cutting and status checks, and protects **none** of the commits
criterion 4 is actually about.

- **D-51:** **A `git` shim on the worktree's PATH.** Each session is spawned with a Flywheel-owned
  directory prepended to `PATH` containing a `git` wrapper that forwards to the real binary and
  retries on `.git/index.lock` with backoff and jitter. It is the only design under which the agent's
  own commits are protected, and criterion 4 is a statement about commits. It is also the seam that
  D-54's destructive-action backstop uses now and that Phase 9's tool-call-layer file-set enforcement
  (PITFALLS pitfall 2) will want later.
  Rejected: a shim that leases per-repository serialization from the supervisor (PITFALLS pitfall 1's
  own suggestion — "retries are deterministic and observable rather than opaque CLI failures" — but it
  needs an IPC channel reachable from inside a worktree, and a wedged supervisor would then block git
  entirely rather than merely failing to retry) and no shim at all (criterion 4 could not be met as
  written; the stress run would have to drive Flywheel's own operations, leaving the agent commits
  issue #55724 is actually about unprotected).
  — **Reversibility:** costly — it changes what `which git` resolves to inside every worktree, it
  becomes load-bearing for three separate jobs, and a broken shim breaks every agent at once. Treat
  its failure modes as first-class, not as an implementation detail.

- **D-52:** **Spawn stagger is a supervisor-enforced minimum interval per repository**, not a random
  sleep. The Rust core will not begin two spawns against the same repository closer together than a
  fixed floor. It is a real guarantee rather than a probability reduction, it is testable ("no two
  spawns against repo X within N ms"), and it lives in the one place that can see every pending start
  across the fleet — which is what Phase 9's fan-out will need regardless.
  Rejected: random 100–500ms jitter per spawn (PITFALLS pitfall 1's literal suggestion, trivial to
  implement and needing no shared state, but ten simultaneous starts can still land inside the same
  window and there is nothing to assert in a test beyond "it usually works") and doing both
  (defensible, and the planner may add jitter on top of the floor if it is nearly free — the floor is
  the part that is required).

- **D-53:** **Collisions are counted per run; only exhaustion is surfaced.** The shim increments a
  per-run collision counter and stays quiet while retries are succeeding; exhausting the retry budget
  raises a real board-visible event naming the repository, the command and the attempt count.
  PITFALLS' warning sign is "failures correlated with wave width, not task content" — that needs a
  number you can look at, and the counter is precisely the signal Phase 9 will want when fan-out width
  becomes tunable.
  Rejected: an event per collision (complete auditability, but it writes many rows for something that
  resolved itself in 200ms and puts noise in the activity trail the user reads to understand the task)
  and full silence with git's own error reaching the agent on exhaustion (the failure mode this phase
  exists to kill becomes indistinguishable from an ordinary agent error, with no data at all showing
  contention rising).

- **D-54:** **One backoff policy, shared by `git_at` and the shim.** The backoff, jitter and budget
  logic is a single module in `packages/core`; `git_at` calls it directly and the shim is a thin
  binary calling the same code. One place to tune, one place to test, and the stress run exercises the
  same implementation both paths use — matching how this codebase already treats `git.rs` as the ONE
  `Command::new("git")` site, asserted structurally by `packages/core/tests/supervisor_cwd.rs` rather
  than by convention.
  Rejected: two independent implementations (the shim stays trivially auditable and immune to a core
  change, which matters for something injected into every agent's PATH — but two backoff policies will
  drift and a bug fixed in one stays live in the other).

### The destructive-action gate

Phase 2's 02-05 empirical spike found that the installed `claude` CLI applies **its own** built-in
bash-command safety classification before ever consulting a configured `--permission-prompt-tool`,
for at least read-only/safe-looking commands, even in `--permission-mode default`. It was recorded
verbatim as "a Phase 3 input, not resolved this plan." The consequence is that the MCP permission gate
built in Phase 2 **cannot on its own** satisfy a requirement whose word is *always*.

- **D-55:** **Both a PreToolUse hook and the shim — the hook as the semantic gate, the shim as the
  backstop.** A `PreToolUse` hook injected into the spawned session's settings fires before the CLI's
  own classification, can block, and can return a reason the agent understands, so the agent is told
  *ask the human* rather than simply failing. The shim (D-51) is the line that cannot be reasoned
  around: even if the hook is missing, misconfigured or bypassed, `git push --force` still stops.
  Defense in depth on the one requirement that says "always".
  Rejected: the hook alone (clean and semantic, and the agent gets a real explanation — but it is a
  Claude-Code-specific capability living behind AGNT-01's adapter seam, so "always" would depend on a
  config file the agent's environment could in principle not honour) and the shim alone (backend-
  independent, which is genuinely valuable when AGNT-01's seam is used for real — but it only catches
  what goes through those binaries, so a script calling `os.rmdir` walks straight past it and the
  agent gets a bare non-zero exit rather than an explanation).
  — **Reversibility:** costly — the hook is per-backend and must sit behind the adapter seam without
  the supervisor branching on backend identity (AGNT-01), and the shim is already load-bearing for
  D-51.

- **D-56:** **The destructive list is fixed and wider than AGNT-07's three.** It covers force-push,
  branch deletion and recursive delete — plus the near neighbours that cause identical harm: any push
  to the project's `default_branch`, `git reset --hard`, `git clean -fdx`, and history rewrite
  (`filter-branch`, or a rebase onto a published ref). A list that stops at exactly three has a hole
  shaped like `git reset --hard`, which destroys precisely the uncommitted work success criterion 1
  refuses to destroy.
  Rejected: exactly the three the requirement names (literally compliant, auditable at a glance, but
  the user finds the gaps by losing work) and a user-editable list (adapts to repositories with their
  own dangerous commands, but rigidity is this product's stated feature and a safety list that can be
  edited is one that will be edited down the first time it is inconvenient).

- **D-57:** **Allow-always can never cover a destructive action.** The permission card for one offers
  allow-once and deny only; D-38's "allow this tool for this project from now on" choice is
  structurally **absent**, not merely discouraged. AGNT-07's word is "always require explicit
  confirmation", and a persistable grant is exactly what turns *always* into *once*. It also keeps the
  Settings permission-rules table honest: nothing in it can ever be a standing force-push licence
  granted at 2am and forgotten.
  Rejected: a separately-flagged, possibly-expiring destructive grant (it contradicts the
  requirement's wording and its failure mode is silent and unbounded) and treating destructive actions
  like any other tool under D-38 (one permission model with no special cases — but AGNT-07 stops being
  a requirement and becomes a default).

- **D-58:** **An unanswered destructive request blocks indefinitely, exactly like any other permission
  request.** The run sits at `blocked`, the task carries D-37's blocked state, the project rail counts
  it, and it waits. One permission model, no second timeout mechanism, and the session spends nothing
  while it waits — the user comes back to a question, not to a consequence.
  Rejected: auto-deny after an idle window so the agent can keep working overnight (PITFALLS pitfall
  11's concern answered directly, but an agent that routes around a denied force-push may do something
  stranger, unwatched, and the user never sees the question asked on their behalf) and denying
  immediately without asking (zero unattended risk, but "require explicit confirmation" is not
  satisfied by never asking — it makes the action impossible rather than gated).

### Claude's Discretion

The following were **not** discussed. The researcher and planner should resolve them against the
decisions above and the canonical references — not re-ask the user.

- **The shim's identity and build.** D-51's PATH shim is now load-bearing for three separate jobs —
  index-lock retry (D-51), the AGNT-07 backstop (D-55), and Phase 9's future file-set enforcement.
  Whether that is one binary or several, whether it is Rust or a script, how it is built and placed on
  `PATH` per session, and what it does when the real `git` cannot be resolved, are all open. Also
  open: whether it intercepts every git subcommand or only mutating ones.
- **The on-disk runtime protocol.** D-47's heartbeat file, its per-session sibling files and D-50's
  kill records now form a real protocol beside the database. Where it lives (app-data, alongside
  `<app-data>/sessions/` per D-34, is the obvious candidate), the heartbeat interval, the staleness
  threshold, and who cleans stale files up were not decided. A short threshold kills a merely-slow
  supervisor; a long one is unattended spend.
- **The backoff curve and retry budget.** PITFALLS suggests 200ms → 400ms → 800ms over 3–5 attempts as
  a starting point; the actual values, and D-52's minimum-interval floor, are a planning concern.
- **Whether a live orphan found at launch can ever be adopted** rather than only killed. D-30's
  "always a fresh session" and D-47's watchdog both point at *killed*, and nothing in this phase's
  criteria asks for adoption — default to kill-only unless research shows adoption is nearly free.
- **Whether the recovery modal's kill action is per-run or all-at-once**, and the recovery surface's
  actual layout.
- **Whether the stress run of criterion 4 is an automated CI test or a manual harness.** The criterion
  says "a stress run driving ten concurrent commits" and names no driver. `packages/core/tests/`
  already holds a crash-harness binary and cursor-resume tests — the precedent for proving
  process-level guarantees with real spawned processes rather than mocks.
- **Whether any of this phase's machinery behaves differently under `tauri dev` versus a packaged
  `.app`.** Phase 2's UAT ran entirely under `tauri dev` (broken-window #3 notes this explicitly), and
  process-group, PATH and app-data semantics are exactly the things that can differ.
- **What `delete_task` does with the `triggers`/`agent_runs`/`permission_requests` rows** once D-44
  lets the deletion through. D-40 rejected cascading them; that rejection was about deleting a task
  *with a live worktree*, and the question is genuinely reopened now.
- **Research flag carried from ROADMAP.md:** expand the lock-contention evidence base and test against
  multiple git versions during planning.

</decisions>

<canonical_refs>
## Canonical References

**Downstream agents MUST read these before planning or implementing.**

### Project intent, scope and requirements
- `.planning/PROJECT.md` — the core value, the seven hard constraints, and the Key Decisions table.
  "Worktrees are durable; agent sessions are ephemeral" is still marked *Pending*; this phase is what
  makes the durability half true under crash conditions.
- `.planning/REQUIREMENTS.md` — the 8 requirement definitions this phase implements (WORK-03 through
  WORK-06, PROC-03 through PROC-05, AGNT-07), verbatim.
- `.planning/ROADMAP.md` §"Phase 3: Nothing Lost, Nothing Left Running" — the five success criteria
  this phase is verified against, and the Notes naming `anthropics/claude-code#55724` and the
  multiple-git-versions research flag.
- `.planning/ROADMAP.md` §Overview "Project-killer placement" table — why WORK-03..06 and PROC-03..05
  are scheduled here and not in Phase 9.
- `.planning/STATE.md` §Blockers/Concerns and §Accumulated Context — two Phase 2 entries bind this
  phase directly: the 02-05 spike finding that the `claude` CLI pre-classifies bash commands before
  consulting a `--permission-prompt-tool` (**the direct cause of D-55**), and Assumption A1
  (`ANTHROPIC_API_KEY` override behaviour) recorded as an unresolved Phase 3 input.
- `.planning/WINDOWS.md` — **row 6 is this phase's work**: `WorktreeSummary.tsx`'s "missing from disk"
  clause was deferred to Phase 3 WORK-06 and is closed by D-45. Row 2 (an unsynchronised
  `FLYWHEEL_WORKTREE_ROOT` env-var race in `packages/core/tests/worktree_lifecycle.rs`) is in a test
  file this phase will touch. Row 3 records that Phase 2's UAT ran under `tauri dev`, not a packaged
  `.app`.

### Risk — the two project-killers this phase owns
- `.planning/research/PITFALLS.md` **pitfall 1** — "Worktree lock contention silently destroys agent
  work at fan-out." The `#55724` postmortem, the 200ms→400ms→800ms backoff suggestion, the
  never-destroy-a-worktree-without-checking-`git status --porcelain` rule, spawn jitter, and the
  supervisor-serialization idea D-51 declined. **This is WORK-03/04/05's specification.**
- `.planning/research/PITFALLS.md` **pitfall 4** — "Zombie agent processes and orphaned worktrees
  survive app quit." Process groups over bare pids, the child-monitors-parent self-termination pattern
  (**D-47's source**), startup reconciliation, and the "last known good heartbeat" idea. **This is
  PROC-03/04/05's specification.**
- `.planning/research/PITFALLS.md` **pitfall 11** — agents hanging on unattended interactive prompts.
  D-58 knowingly accepts the hang; read the pitfall before proposing a timeout.
- `.planning/research/PITFALLS.md` **pitfall 2** — agents writing outside declared file-sets. Phase 9
  owns it, but it names the tool-call-layer enforcement seam that D-51's shim will become; read it so
  this phase does not build something Phase 9 has to tear out.
- `.planning/research/PITFALLS.md` §"Recovery Strategies" and §"Looks Done But Isn't" — both speak
  directly to criteria 2 and 3.

### Architecture
- `.planning/research/ARCHITECTURE.md` §1 "Process Topology" — the renderer/supervisor/worker
  three-tier model and the cwd-drift argument. The source for PROC-01/PROC-02, which D-47's watchdog
  must not violate.
- `.planning/research/ARCHITECTURE.md` §2 "Domain Schema" — the field lists for `Worktree` and
  `AgentRun`, the starting point for D-45's and D-49's status additions.
- `.planning/research/ARCHITECTURE.md` §5 "Agent Adapter Interface" — the `AgentAdapter` contract and
  the per-backend capability table. **D-55's PreToolUse hook is backend-specific and must sit behind
  this seam without the supervisor branching on backend identity (AGNT-01).**
- `.planning/research/ARCHITECTURE.md` §"Anti-Patterns to Avoid" — anti-pattern 3 (cwd as an implicit
  git/fs argument) constrains how the shim and the watchdog are invoked.

### Stack
- `.claude/CLAUDE.md` §"Technology Stack" — the locked stack. Load-bearing here: **worktree lifecycle
  operations shell out to the system `git` CLI, never `git2-rs`** (which lags on worktree edge cases);
  `rusqlite` in the Rust core owns the canonical database and **`better-sqlite3` must not become a
  second writer** (D-50 is shaped by this); `tokio::process` plus platform process-group APIs are the
  named mechanism for kill-on-app-exit.
- `.planning/research/STACK.md` — the full argument behind those choices.

### Market and feature framing
- `.planning/research/FEATURES.md` §2 "Worktree & Branch Management" — the unanimous community rule
  that worktrees are removed through `git worktree remove`/`prune`, **never `rm -rf`**. Not a decision
  this phase may revisit.
- `.planning/research/FEATURES.md` §7 "Human-in-the-Loop Gating" — the tiered permission model D-36
  inherited and D-57 now carves an exception out of.

### Prior phase decisions and UI contract
- `.planning/phases/02-one-agent-one-worktree-watched-live/02-CONTEXT.md` — **all of it.** Especially
  **D-35** (Stop is interrupt-then-force; nothing is ever committed on the user's behalf; the worktree
  is left dirty and inspectable — the contract D-48 diverges from and must justify), **D-40** (the
  task-delete block D-44 reopens), **D-38** (per-project per-tool allow-always, which D-57 carves an
  exception out of), **D-34** (`<app-data>/sessions/<agent-run-id>.jsonl` — the precedent for where
  D-47's runtime files should live), **D-37** (board-visible blocked state plus project-rail count,
  reused by D-46 and D-58), and **D-23/D-24/D-25/D-26** (the fixed worktree root and branch topology
  D-41 and D-45 operate on).
- `.planning/phases/01-the-board-is-the-store-of-record/01-CONTEXT.md` — **D-16** (the marker is the
  binding; a mismatch is surfaced, never silently repaired — **D-45's direct model**), **D-14** (one
  fleet-wide database in app-data; agent-written state never inside the repo), **D-18** (backup-first
  migration safety, which D-45's and D-49's CHECK-constraint rebuilds ride on), **D-19** (event
  payloads must be human-renderable, which D-53's exhaustion event must satisfy).
- `.planning/phases/01-the-board-is-the-store-of-record/01-UI-SPEC.md` — the locked visual direction
  ("Flight Progress Strips"), the Surface Inventory, the exhaustive Keyboard Map that a remove-worktree
  action and a recovery-modal action must slot into, and the measured palette. **Caveat:** Phase 10.1
  is scheduled to re-open sections this document marks LOCKED — build against it as it stands, do not
  pre-empt 10.1.
- `.planning/phases/02-one-agent-one-worktree-watched-live/02-UI-SPEC.md` — the agent signal
  vocabulary (four contrast-proven colour roles, six legend marks, eight keyboard actions). A
  `missing` worktree state and an `abandoned` run state must join this vocabulary rather than inventing
  a parallel one.

</canonical_refs>

<code_context>
## Existing Code Insights

Phase 2 shipped 18 plans across a four-package monorepo: `packages/core` (Rust), `packages/desktop`
(Tauri v2 + React), `packages/sidecar` (Node, created in Phase 2), `packages/relay-client` (inert
seam).

### Reusable Assets

- **`packages/core/src/git.rs`** — the ONE `Command::new("git")` site in the workspace, asserted
  structurally by `packages/core/tests/supervisor_cwd.rs`. It has `git_at`, `rev_parse_verify`,
  `worktree_add`, `worktree_list` and `worktree_root_from_env` — and **no `worktree_remove`**. D-41's
  removal verb and D-42's porcelain read are new functions here; D-54's shared backoff wraps `git_at`.
- **`packages/core/src/domain/project.rs::reconcile_projects`** — runs in `main.rs`'s `setup()` before
  any window is shown, verifies each project's committed marker against its cached `repo_path`, and
  surfaces a mismatch without ever rewriting the path (D-16). **This is the exact shape WORK-06 should
  copy**, including the `project.reconciled` event it appends.
- **`packages/core/src/domain/worktree.rs`** — `worktree_for_task`, `worktree_root`,
  `base_ref_for_task`, `ensure_worktree`. `worktrees.task_id` is UNIQUE, so one worktree per task is a
  schema invariant, not a convention.
- **`packages/core/src/domain/agent_run.rs`** — `start_agent_run`, `close_agent_run`,
  `apply_session_closed`, `interrupt_agent_run`, `set_run_blocked`/`clear_run_blocked`. D-49's
  `abandoned` transition belongs alongside `close_agent_run`, and `apply_session_closed`'s
  already-terminal backfill behaviour is the precedent for a reconciler that must not overwrite a run
  that did reach a real end.
- **`packages/core/src/db/`** — `rusqlite` with WAL, `rusqlite_migration`, and backup-before-migrate
  (`backup.rs`, D-18). D-45 and D-49 are migration `0006`; both change a CHECK constraint, which in
  SQLite means a table rebuild.
- **`packages/desktop/src-tauri/src/sidecar.rs`** — `SidecarHandle` with `send_request`,
  `interrupt_run`, `shutdown_all_sessions`, `kill`, and the non-panicking `persist_event_line`
  (`PersistOutcome`) seam. `spawn_sidecar` already performs a bounded ping readiness handshake before
  returning. This is where D-47's heartbeat writer and the per-session watchdog spawn belong.
- **`packages/sidecar/src/claude-code-adapter.ts`** — `spawn(bin, argv, { detached: true, ... })`,
  `interruptSession` (negative-pid SIGINT then SIGTERM), `killSession` (negative-pid SIGTERM, no
  grace), a live session registry with a `closedEventEmitted` flag, and `buildClaudeArgv` as a pure
  argv builder with a real-binary test (`test/real-claude-argv.test.mjs`). D-47's wrapper wraps this
  spawn; D-55's hook is an argv/settings change here; D-51's shim is an env change here.
- **`packages/sidecar/src/mcp-permission-server.ts`** — the Unix-domain-socket permission channel
  opened *before* the backend is spawned. D-55's hook must route to the same permission card rather
  than inventing a second answering surface.
- **`packages/desktop/src/item-detail/WorktreeSummary.tsx`** — D-41's home, and broken-window #6's
  open defect.
- **`packages/desktop/src/state/keyboard.ts`** — the single key→action map, with `useGlobalBindings`
  and `useRegionBindings` (added in Phase 2 for the permission card). A remove-worktree action and any
  recovery-modal binding register here, never as a competing per-component handler.
- **`packages/desktop/src/legend/marks.ts`** and **`theme/contrast.ts`** — the marks vocabulary and
  asserted contrast checks that `missing` and `abandoned` states must join.
- **`packages/core/tests/`** — a crash-harness binary, `cursor_resume.rs`, `worktree_lifecycle.rs`,
  `stop_lifecycle.rs`, `supervisor_cwd.rs`. The established precedent for proving process-level
  guarantees with real spawned processes rather than mocks — which criteria 2 and 4 both require.

### Established Patterns

- **The schema is the authority, not app code** — CHECK constraints reject invalid states so no
  app-layer guard can be bypassed. D-45's `missing` and D-49's `abandoned` must land in the CHECK, not
  in a Rust enum alone.
- **One transaction writes the mutable row and appends to `events`** — no exceptions, and payloads are
  shaped for human rendering (D-19). D-53's exhaustion event and the reconciler's writes follow this.
- **`actor_id` is resolved server-side in every command handler**, never accepted from the renderer.
  The reconciler's writes need an actor — `local_human_actor_id` and the seeded Claude Code agent
  actor (`01M21VR17D2SKYJMVH3P3DFJBW`) both already exist.
- **No `cwd` as an implicit argument** — every filesystem and git call takes an explicit absolute path
  (PROC-02). The watchdog and the shim must not become the exception that reintroduces it.
- **Default-deny IPC** — `capabilities/default.json` grants only `core:default` and
  `dialog:allow-open`; commands are exposed solely through `generate_handler!` in `main.rs`, with the
  capability file documenting the full roster. New commands (remove worktree, resolve orphan,
  reconcile) must be added to both and the roster comment kept accurate.
- **Failure modes are returned values, not panics** — `persist_event_line`'s `PersistOutcome` replaced
  a panicking open after one run's log failure took down the shared reader for every run (CR-03). The
  reconciler and the watchdog integration must follow the same rule.

### Integration Points

- **`packages/desktop/src-tauri/src/main.rs` `setup()`** — already runs `open_and_migrate` then
  `reconcile_projects` then `spawn_sidecar`, in that order, before any window is shown. Worktree
  reconciliation (D-45) and orphan detection (D-46) slot into this sequence; a blocking modal implies
  the window *is* shown with the recovery state already resolved by the core.
- **`packages/desktop/src-tauri/src/main.rs` `RunEvent::Exit`** — the existing
  `shutdown_all_sessions()`-then-`kill()` ordering (CR-02), with a source-order gate test. D-47 is the
  belt-and-braces net *behind* this path, not a replacement for it.
- **`packages/desktop/src-tauri/src/commands/agent_run.rs`** — where `agent_run_stop`,
  `agent_run_answer_permission` and `worktree_summary` live. The removal, reconcile and orphan-resolve
  commands land here or in a sibling module, registered in `mod.rs` and `generate_handler!`.
- **`packages/sidecar/src/index.ts`** — the `shutdown` op plus two fallback nets (SIGTERM, stdin EOF),
  both of which call `shutdownAllSessions()`. D-47 adds the third net, the only one that survives a
  SIGKILL of the sidecar itself.
- **`packages/desktop/src/session/`** and **`packages/desktop/src/item-detail/`** — the surfaces that
  render run status; both need the `abandoned` state, and `WorktreeSummary` needs `missing`.

</code_context>

<specifics>
## Specific Ideas

- **"Blocking only when money is burning" is the framing that resolved the recovery-surface question**,
  and it comes straight from the phase's own title. *Nothing Lost* is a state that can wait for the
  user; *Nothing Left Running* is a meter turning. Only the second earns a modal. This is the sentence
  to design the recovery surface against.
- **Criterion 4 is a statement about commits, and agents commit.** The decision to put a shim on the
  agent's `PATH` was made by reading the criterion literally and noticing that a retry policy confined
  to `git.rs` would satisfy a stress test Flywheel wrote for itself while leaving the failure in
  `#55724` completely untouched. Any plan that tests criterion 4 by driving Flywheel's own git calls
  is testing the wrong thing.
- **"Always" is the word that forced defense in depth.** AGNT-07 says destructive actions *always*
  require confirmation. Phase 2 proved the MCP gate is not always consulted. A single mechanism whose
  failure mode is silent cannot implement "always", which is why both the hook and the shim ship.
- **A safety list that can be edited is a list that will be edited down.** D-56's fixed-but-wider list
  was chosen over configurability on exactly this reasoning, consistent with D-23/D-24's "rigidity is
  the feature".
- **`git reset --hard` is the hole in the literal requirement.** AGNT-07 names three commands;
  `reset --hard` is not one of them, and it destroys precisely the uncommitted work criterion 1 exists
  to protect. The wider list is not gold-plating — it closes a contradiction between two of this
  phase's own requirements.
- **The watchdog may never touch SQLite.** D-50's file-drop design exists specifically so the Rust core
  remains the only writer of the canonical database, per the stack rule that forbids a second
  SQLite writer in a Node process.
- **Nothing is silently repaired, and nothing is silently resumed** — the phrase is from success
  criterion 3 and it is the same instinct as D-16's `reconcile_projects`. Every decision in this phase
  that *could* have auto-fixed something chose to surface it instead.

</specifics>

<deferred>
## Deferred Ideas

- **A project-scoped Worktrees list** — a surface showing every worktree a project owns, with status
  and bulk removal. Rejected for this phase (D-41) because the single-task case is the only real one
  while one agent runs at a time. It becomes genuinely valuable at Phase 9's fan-out and again at
  Phase 10's fleet view, and `worktrees.status` already has the vocabulary to populate it.
- **Supervisor-level serialization of all git-mutating operations per repository** — PITFALLS pitfall
  1's own suggestion, declined in D-51 in favour of local retry inside the shim. Revisit at Phase 9
  when fan-out width makes contention deterministic rather than incidental; the shim is already the
  place it would be added.
- **Tool-call-layer file-set enforcement** — PITFALLS pitfall 2, Phase 9 (PLAN-04/PLAN-05). D-51's
  shim and D-55's PreToolUse hook are both seams it will use; do not build any part of it here.
- **Adopting a live orphaned agent back into a relaunched Flywheel** rather than killing it. Points
  against it: D-30's "always a fresh session" and D-47's watchdog, which is designed to have already
  killed it. Revisit only if research shows the watchdog cannot be made reliable.
- **An idle-output timeout for a blocked session** — PITFALLS pitfall 11 argues for one, and D-58
  knowingly declines it. Pairs naturally with Phase 10's OS notifications (FLEET-04), which change the
  calculus: the right fix for "the user is asleep" is probably to wake them, not to answer for them.
- **Worktree disk reclamation / a "these worktrees are old" sweep** — `WORK-07`, Phase 10. D-41 builds
  the removal verb it will call.
- **Correcting `RLAY-01` in `REQUIREMENTS.md`** — carried forward unresolved from Phase 1 (D-21) and
  Phase 2. Still a requirements-pass action for a milestone boundary, recorded in `STATE.md`
  §Deferred Items.
- **Closing broken-window #2** — the unsynchronised `FLYWHEEL_WORKTREE_ROOT` env-var race in
  `packages/core/tests/worktree_lifecycle.rs`, which can leak a directory into the developer's real
  `~/Flywheel`. This phase touches that file; fixing it is in scope for whichever plan does, but it is
  not a phase requirement.

</deferred>

---

*Phase: 3-Nothing Lost, Nothing Left Running*
*Context gathered: 2026-09-12*
