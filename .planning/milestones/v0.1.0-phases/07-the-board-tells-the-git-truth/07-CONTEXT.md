# Phase 7: The Board Tells The Git Truth - Context

**Gathered:** 2026-10-02
**Status:** Ready for planning

<domain>
## Phase Boundary

This phase makes the board a trustworthy mirror of git and forge state for every task, so the
question "where does this actually stand?" is answerable from the board without opening a
terminal. It delivers five things and nothing else:

1. **Git facts on the item** — branch, commits, ahead/behind against the integration target, and
   uncommitted changes sitting in the worktree (LINK-02, LINK-09).
2. **A round trip between a git identifier and a board item** — a commit-message trailer that makes
   `git log` alone reveal the originating task, and navigation from a pasted hash or branch name
   back to that item (LINK-03, LINK-04).
3. **Forge state on the item, driving two status transitions** — pull/merge request state and CI
   result visible on the task; a request opening moves it to In Review and merging moves it to Done
   (LINK-05, LINK-06, LINK-07).
4. **GitHub and GitLab, degrading cleanly to local-only git** (LINK-08).
5. **Detection of work done outside Flywheel** — a commit made by hand from the user's own terminal
   is noticed and reflected, never silently overwritten (LINK-10) — and one-action access to a
   task's worktree in the user's own editor or terminal (LINK-11).

**Not in this phase:** reviewing or merging a diff inside Flywheel (Phase 8), fan-out across many
tasks (Phase 9), webhook-driven forge updates (CONV-06, explicitly deferred — v1 polls), board-card
visual density and placement (`/gsd-ui-phase 7` owns that contract).

</domain>

<decisions>
## Implementation Decisions

Decision numbering continues from Phase 6 (D-01–D-22 are Phase 1, D-23–D-40 are Phase 2,
D-41–D-63 are Phase 3, D-64–D-79 are Phase 4, D-80–D-96 are Phase 5, D-97–D-112 are Phase 6).

### How git state stays fresh

- **D-113:** **One periodic tick in the Rust core is the single mechanism that notices a git
  change.** It re-reads the tracked worktrees on a schedule and emits one event the frontend
  invalidates off — reusing the `app.emit(…)` → `useBoardQuery.ts` invalidation path that every
  existing live update in this product already travels, and `tokio-cron-scheduler` 0.15, which is
  already a dependency of `packages/core` and currently drives nothing user-facing.
  There is no filesystem watcher: `notify` is not a dependency of this workspace, one watcher per
  worktree scales with the fleet, and macOS FSEvents noise from build artifacts would need
  filtering before it told the truth about anything. Nor is refresh on-demand-only (on focus or on
  opening a task), because a board that is visibly stale while the user looks at it is precisely
  the LINK-10 failure this phase exists to remove.
  The worst case is bounded and explainable: the board is at most one interval behind git.

- **D-114:** **The tick is tiered — hot worktrees fast, cold worktrees slow.** A worktree with a
  live agent session or an open detail panel refreshes on a short interval; every other tracked
  worktree refreshes on a long one. Cost tracks the work the user is actually watching, and a cold
  task is permitted to be up to a minute stale.
  Rejected: one interval for everything (one number to reason about, no tiering logic — but total
  git subprocess cost then grows linearly with the fleet, which is the dimension this product is
  built to grow); and a fixed per-tick budget refreshing the N stalest worktrees round-robin
  (constant load regardless of fleet size — but the staleness of any given card becomes a function
  of fleet size, which the user cannot reason about at a glance).
  Two intervals, one mechanism. Not two mechanisms.

- **D-115:** **A commit on a task's branch that no agent run produced is marked in the commit list
  and written to the activity trail.** It renders with a visible "made outside Flywheel" marker,
  and the detection writes one `events` row so the trail carries it with a timestamp — reusing the
  existing `events` table and `ActivityTrail.tsx`, adding no new status and interrupting nothing.
  Rejected: rendering it unmarked (least code, and "never silently overwritten" is satisfied
  anyway since Flywheel never rewrites git — but the user then cannot tell at a glance which
  commits came from an agent and which from their own hands); and escalating to a persistent
  board-card indicator requiring acknowledgement, the treatment a blocked agent gets under D-37
  (strongest signal — but a dismissal chore for something that is usually entirely routine).
  Note that `drift.rs`'s existing `StaleSinceLastSummary` detector already fires on "work has
  landed — a moved head ref, uncommitted changes, or both — since the latest summary", so an
  outside commit already reaches the next agent's context packet for free. D-115 is about what the
  *user* sees, not about what the next agent is told.

- **D-116:** **Ahead/behind compares against `origin/<target>`, with `git fetch` on its own slower
  cadence and the figure labelled with its fetch age.** The target itself is already derivable —
  the epic integration branch for a task under an epic (D-25), the trunk for an epic-less task
  (D-26). Network cost is decoupled from the tick rate, the figure stays readable offline (just
  visibly aged), and the label is what keeps it honest.
  Rejected: comparing against the local target ref and never fetching (zero network, works on a
  plane, no fetch policy to design — but "behind: 0" becomes a lie the moment the local trunk is
  stale, with nothing to distinguish the two cases); and fetching every tick (always current,
  nothing to explain — but a network round trip per repository per tick turns the freshness
  mechanism into a liability on a metered or absent connection).
  — **Reversibility:** reversible — the comparison ref is one argument to a `rev-list --count`
  call; the fetch schedule is a second entry in the same scheduler D-113 already stands up.

### How Flywheel talks to the forge

- **D-117:** **A thin adapter shelling out to the user's installed `gh` and `glab` CLIs.** It
  inherits the login the user already has, so there is no token for Flywheel to mint, store,
  rotate or leak; both tools emit structured JSON (`gh pr view --json`, `glab mr view -F json`);
  and the Rust core continues to make zero network calls of its own — there is no HTTP client
  anywhere in this workspace today, no `reqwest`, no `ureq`, nothing.
  This also follows the project's standing credential posture, which `credentials.rs` already
  enforces for agent credentials: use what the developer is already authenticated with rather than
  asking them to hand Flywheel a secret.
  Rejected: REST with a personal access token in the Keychain via the existing `credentials.rs`
  boundary (one uniform transport, no external binary dependency — but a PAT becomes the user's to
  mint and Flywheel's to guard, and it puts the first network dependency into the core); and
  CLI-first-with-REST-fallback (works on every machine — but it is two complete implementations of
  one forge contract to build, test and keep in agreement, for one developer on one machine in v1).
  — **Reversibility:** costly — the adapter seam itself is the cheap part, but swapping transport
  means re-deriving every forge field (request state, CI conclusion, review state) from a
  different response shape; the seam is what keeps this costly rather than one-way, and it is the
  same seam CONV-06 names for the future webhook path.

- **D-118:** **Flywheel opens the pull request itself, from an action on the item, pre-filled from
  the board item.** Title from the task, body from its acceptance criteria and session summaries,
  target derived from the epic integration branch or the trunk. This is the product thesis applied
  literally: the board item becomes the pull request description, rather than the user
  re-describing in the forge what the board already holds.
  Externally-opened requests are still detected regardless — LINK-05 requires the request's state
  to be reflected whoever opened it, and LINK-10's spirit forbids a request opened outside
  Flywheel from being invisible.
  Rejected: observe-only (no create path, no body template, no risk of opening something unwanted
  — but the one action that advances a task to In Review would be the one action the user leaves
  the app to perform); and having the agent open it as its last act via a board tool, a natural
  sibling of Phase 6's `propose_item` (fully closes the loop unattended — but an agent that
  misjudges "done" then pushes a branch and opens a request on a real forge).

- **D-119:** **The forge is auto-detected from the origin remote's host at project registration and
  stored as a per-project setting the user can override.** `github.com` → `gh`, `gitlab.com` →
  `glab`, no remote → local-only. Right by default, and the override is what rescues a self-hosted
  GitLab or GitHub Enterprise behind a company domain.
  Rejected: pure derivation with nothing stored (zero configuration surface, nothing to desync —
  but a self-hosted instance silently degrades to local-only with no way to correct it); and
  asking the CLIs who claims the repo via `gh repo view` / `glab repo view` (the CLIs resolve their
  own hosts config, so self-hosted works with no detection logic — but it spends two subprocess
  spawns per project answering a question the remote URL usually answers for free).

- **D-120:** **With no forge configured, the forge section of the item panel is absent entirely.**
  Branch, commits, ahead/behind and uncommitted changes render in full as always; nothing renders
  where request state and CI would go. This is `WorktreeSummary.tsx`'s own established discipline,
  stated in its header comment — absence is the design, not an empty labelled header.
  Rejected: a labelled empty state naming the missing capability and routing to the setting
  (discoverable — but permanent furniture on every item of a project that may never have a forge,
  in a panel already carrying criteria, worktree, summaries and activity); and a single
  project-level notice instead (discoverability without per-item cost — but a third place to look
  for the state of a project, after the board and the settings pane).

### Who owns the status column

- **D-121:** **Status transitions are edge-triggered and then hand the column back.** The core
  writes a transition only when it observes forge state *change* — once when the request opens,
  once when it merges — and never re-asserts it on a later tick. A manual move the user makes
  afterwards therefore stands until the request genuinely changes state again.
  This is what reconciles LINK-07 with D-29 ("starting a session moves the task to In Progress;
  nothing ever moves it out"): the column does gain automatic outward moves, but the mechanism is
  structurally incapable of overwriting the user in a loop, which is the property D-29 was
  protecting.
  Rejected: level-triggered reconciliation on every tick (the board can never disagree with the
  forge — but dragging a card anywhere else is futile, it snaps back within one interval, and
  "never silently overwritten" becomes false in the most visible place in the product); and
  proposing the transition as a one-click suggestion that waits for the user (the user always owns
  the column — but the board then asks rather than tells, and a backlog drained by agents
  accumulates unanswered prompts).
  — **Reversibility:** costly — changing to level-triggered later is a small code change, but
  every status row written under edge semantics would then be re-asserted against live forge
  state, silently moving historical tasks; the `events` trail, which stamps the system actor on
  automatic transitions, is the only record distinguishing them.

- **D-122:** **Only the two transitions LINK-07 names, and only forward.** Request opened →
  `in_review`, merged → `done`. Changes requested, closed-without-merging and CI failure all
  render on the item and move nothing.
  Rejected: adding the two backward moves, changes-requested → `in_progress` and closed-unmerged →
  `in_progress` (the column would track reality more tightly and a stalled task would stop looking
  reviewed — but backward moves are exactly the ones that read as the board second-guessing the
  user, and "changes requested" often means a one-line fix already underway); and a full mapping
  making the column a projection of the forge (maximally honest, nothing to remember — but the
  columns stop being the user's at all, and local-only projects would then behave by completely
  different rules from forge-backed ones).

- **D-123:** **A merge carries a task to Done even with unchecked acceptance criteria, and raises a
  visible unresolved marker plus an `events` row.** Git stays the truth — that is the phase title —
  while the criteria gap becomes impossible to miss, which is what the project's core value is for.
  Rejected: moving it and letting the criteria simply stay visibly unchecked in the existing
  criteria list (no new mechanism at all — but "Done with unmet criteria" becomes a state the user
  can scroll past, in the one product whose whole premise is that criteria are real); and refusing
  the move, stopping at In Review with a blocking note (criteria would genuinely gate completion —
  but the board would then openly contradict git, the exact failure this phase exists to eliminate).

- **D-124:** **CI result is visible on the item with a link out to the run, and a failure also
  raises a board-visible flag — the D-37 blocked-agent treatment — but never changes status.** A
  red build on a backlog being drained by agents is something the user should spot without opening
  anything, and the flag is how; the status column stays under D-122's forward-only rule.
  Rejected: display-only with no board propagation (least machinery, CI noise never nags — but a
  red build is only discoverable by opening the task); and flagging plus returning the task to
  `in_progress` (closes the loop automatically — but a flaky test then reshuffles the board, and it
  directly contradicts D-122).

### The git-identifier round trip

- **D-125:** **Two trailers: `Flywheel-Task: <key>` and `Flywheel-Run: <run-id>`.** The task key is
  already the right value and not a choice — D-10 enforces a project's key prefix as immutable once
  its first item key is allocated, and `project.rs`'s own stated reason is "once branches and
  commit trailers in real git history carry a key, the identifier scheme cannot change
  retroactively". The run id is the second line because what the user usually wants from a
  surprising commit is the session that produced it — its transcript, its summary, its permission
  decisions — not merely which task it belonged to.
  Rejected: the task key alone (exactly what LINK-03/LINK-04 ask for, smallest footprint in other
  people's `git log` — but a hash then tells you the task and leaves you matching run history by
  timestamp); and adding `Flywheel-Epic:` as a third line (the whole hierarchy would read out of
  `git log` with no database at all — but the epic is already one hop from the task, so it buys a
  lookup that already exists).
  — **Reversibility:** one-way — this is D-10's own argument inherited. The moment commits carrying
  these trailers exist in real history, the trailer keys and their value format cannot be changed
  without stranding every commit already stamped; any later reader would have to understand both
  shapes forever.

- **D-126:** **A `commit-msg` hook does the stamping, installed into the same per-project
  `core.hooksPath` directory `git_hooks.rs` already owns for the Phase 12 pre-push hook.** It
  derives the task from the current branch name — `branch.rs`'s derivation is one-way by design but
  the branch is a lookup key — and appends the trailers when absent, guarded to fire only on
  `flywheel/`-namespaced branches so commits in the main checkout are untouched.
  This catches every commit, including the user's own hand-typed ones, with no model compliance
  anywhere in the path.
  Rejected: instructing the agent to write the trailers itself (zero machinery, no hook to install,
  guard or uninstall — but it depends on a model remembering a formatting rule on every commit, and
  the user's own commits would never carry a trailer at all); and per-worktree `commit.template` /
  `trailer.*` git config (declarative, no script — but a template only pre-fills an interactive
  editor, and agents commit with `-m`, which skips it entirely, so it would not fire for the main
  case).
  **HARD CONSTRAINT:** like `git_hooks.rs`, any git invocation this work adds goes through
  `crate::git::git_at`. `packages/core/tests/supervisor_cwd.rs` asserts `Command::new("git")`
  appears exactly once in this workspace, inside `packages/core/src/git.rs` — a second construction
  site fails that test immediately.

- **D-127:** **The existing command palette resolves git identifiers.** `CommandPalette.tsx` learns
  to recognise a hex string or a `flywheel/…` branch name as a git identifier and resolve it to its
  item alongside its normal results — one entry point for "find anything", no new surface, and the
  muscle memory already exists.
  Rejected: folding it into `FilterBar.tsx`'s FTS text search (also no new surface — but the filter
  bar narrows a visible list, so resolving to one specific off-screen item is the wrong gesture for
  that control); and a dedicated go-to-commit surface (purpose-built, unconfusable with text search
  — but a third way to find things in an app that already has two).

- **D-128:** **Resolution reads git and stores nothing.** A pasted hash is answered by asking git
  for the commit's trailers across the registered repositories until one resolves — a couple of
  cheap `git cat-file` / `git show -s` calls. This is `drift.rs`'s own D-75 discipline applied:
  derive at read time, never cache a verdict. Git history is the one source that cannot go stale
  against itself.
  Rejected: a sha→task index populated by the tick as it reads commit lists, with a git read as
  fallback (instant, and it answers even after a worktree is gone — but it is a second source of
  truth about git that can disagree with git, the exact bug class this phase exists to kill); and
  an index with no fallback (simplest query, no repo-guessing loop — but a hash from a branch not
  ticked recently, or from a rebase, fails to resolve with git sitting right there holding the
  answer).

- **D-129:** **Derived constraint, forced by D-126 — "made outside Flywheel" is decided by agent-run
  coverage, not by trailer presence.** Because the `commit-msg` hook stamps *every* commit on a
  `flywheel/` branch, a hand-typed commit carries the same trailers as an agent's. D-115's marker
  must therefore be computed from whether a recorded `agent_runs` range covers the commit (or from
  committer identity), never from the absence of a trailer. The planner should not rediscover this.

### Opening the worktree

- **D-130:** **Two actions on the item, each running a configurable command template with the
  worktree path substituted** — "Open in editor" defaulting to `code <path>`, and "Open in
  terminal" defaulting to the system terminal. Covers both halves of LINK-11 literally and survives
  the user changing editors. `WorktreeSummary.tsx`'s header comment already reserves this slot and
  its own structural gate greps for its absence today, so that gate is what this decision retires.
  Rejected: editor-only (half the surface, and a terminal is reachable from inside most editors —
  but LINK-11 names "editor or terminal", so a verifier reading the requirement literally finds one
  missing); and revealing the folder in Finder (zero configuration, never wrong, works before the
  user has configured anything — but two more clicks than the one action the requirement asks for).

### Claude's Discretion

- The exact interval values for D-114's hot and cold tiers, and for D-116's fetch cadence — pick
  defaults that are explainable, and make them constants in one place rather than settings.
- Whether the two tiers and the fetch live as one scheduler job with internal partitioning or as
  separate jobs — a structure question, not a behaviour question.
- The commit-list window on the item (how many commits render before "show more"), and the shape of
  the uncommitted-changes view, which should follow D-42's already-shipped
  `git status --porcelain`-as-rows rendering rather than inventing a second presentation.
- The precise trailer-block ordering and whether the hook writes them via `git interpret-trailers`
  or by direct append.
- How the forge adapter normalises GitHub's and GitLab's differing request-state and CI-conclusion
  vocabularies into one internal model — but the model itself is the CONV-06 seam and should be
  named explicitly, not left implicit in the adapter.
- Error presentation when `gh`/`glab` is installed but not authenticated, versus not installed at
  all — these are different user situations and should read differently, but the wording is
  discretion.

</decisions>

<canonical_refs>
## Canonical References

**Downstream agents MUST read these before planning or implementing.**

### Phase scope and requirements
- `.planning/ROADMAP.md` § "Phase 7: The Board Tells The Git Truth" — the goal, the five success
  criteria, the Phase 4 dependency, and the note on why LINK-10 matters more than it looks.
- `.planning/REQUIREMENTS.md` lines 48–57 — LINK-02 through LINK-11, the ten requirements this
  phase closes, and line 180's CONV-06 ("real-time forge updates via webhooks rather than polling
  — *seam: `LINK-05`/`LINK-06` forge state model*"), which is the deferred successor this phase
  must leave room for.
- `.planning/PROJECT.md` — the architecture constraint that no v1 decision may foreclose scheduled
  automations, team collaboration, the mobile/web relay, or additional agent backends; and the
  local-first execution model behind D-117.

### Prior-phase decisions this phase builds on
- `.planning/phases/02-one-agent-one-worktree-watched-live/02-CONTEXT.md` — D-24 (task branch name
  `flywheel/<task-key-lowercased>-<title-slug>`), D-25 (epic integration branch), D-26 (epic-less
  task branches off and targets the trunk) — together these make D-116's comparison target
  derivable; D-29 (status moves in, never out) — the decision D-121 reconciles; D-37 (a blocked
  agent is visible on the board, not only the session surface) — the treatment D-124 reuses.
- `.planning/phases/03-nothing-lost-nothing-left-running/03-CONTEXT.md` — D-42 (`git status
  --porcelain` rendered as rows, already shipped), D-51 (the `git` shim on the worktree PATH),
  D-54 (one shared backoff policy for `git_at` and the shim).
- `.planning/phases/04-clear-is-free/04-CONTEXT.md` — D-70/D-71 (the diff-so-far covers committed
  and uncommitted work as two labelled sections, always `--stat` and changed paths, never hunk
  bodies), D-75 (derive at read time, never store a verdict) — the precedent D-128 follows.
- `.planning/phases/01-the-board-is-the-store-of-record/01-CONTEXT.md` — D-10 (project key prefix
  immutable once the first item key is allocated), the argument D-125 inherits.

### Trust boundary and git invariants
- `docs/destructive-gate-trust-boundary.md` § "Layer 3 — git's own pre-push hook" — the spec
  `git_hooks.rs` implements, and the reason `core.hooksPath` is per-repository and shared by every
  linked worktree (this codebase does not enable `extensions.worktreeConfig`). D-126 installs into
  that same directory and must not disturb Layer 3.
- `packages/core/src/git.rs` header comment — PROC-02: the one and only `Command::new("git")` site
  in the workspace, with `-C <repo_path>` always the first two arguments. Structurally asserted by
  `packages/core/tests/supervisor_cwd.rs`.
- `packages/core/src/credentials.rs` header comment — the credential boundary, and the standing
  rule against passing secrets as command arguments where a process listing would disclose them.
  Relevant to D-117: shelling out to `gh`/`glab` is safe precisely because no secret crosses argv.

</canonical_refs>

<code_context>
## Existing Code Insights

### Reusable Assets
- `packages/core/src/git.rs` — `git_at` (the single git entry point), `git_status_porcelain`,
  `diff_stat_and_names` (already returns a `DiffStat` with changed paths), `rev_parse_verify`,
  `worktree_list`, `git_version`. Every new git read in this phase goes through `git_at`.
- `packages/core/src/branch.rs` — `task_branch_name`, `epic_integration_branch_name`, `slugify`.
  The `flywheel/` namespace is explicitly flagged in its header as load-bearing for "Phase 7's
  LINK-10 detection"; D-126's hook guard keys off exactly that namespace.
- `packages/core/src/git_hooks.rs` — `hooks_dir_for_repo`, `install_pre_push_hook`,
  `uninstall_pre_push_hook`, `PrePushInstall`. The per-project `core.hooksPath` machinery D-126
  extends with a second hook.
- `packages/core/src/drift.rs` — `detect_drift`, `DriftInputs`, and the `StaleSinceLastSummary`
  variant which already fires on a moved head ref or uncommitted changes since the latest summary.
- `packages/core/src/domain/actor.rs` — `system_actor()`, documented as "for any mutation performed
  by Flywheel itself rather than a human at the keyboard", with the seeded "Flywheel" system actor
  in `0001_actors.sql`. This phase is its first real consumer: D-121's automatic transitions stamp
  it, which is what makes the activity trail read truthfully.
- `packages/core/src/query/events.rs` + `packages/desktop/src/item-detail/ActivityTrail.tsx` — the
  append-only events trail D-115, D-123 and D-124 write into.
- `packages/desktop/src/item-detail/WorktreeSummary.tsx` — already renders the branch and path row,
  already handles the missing-worktree case, and its header comment explicitly reserves LINK-11
  ("No 'open in editor/terminal' affordance is rendered — that is LINK-11, Phase 7, out of scope
  here (this file's own structural `<verify>` gate greps for it)"). D-130 retires that gate.
- `packages/desktop/src/item-detail/WorktreeRemovalDialog.tsx` — D-42's porcelain-as-rows rendering,
  the presentation LINK-09's uncommitted-changes view should follow rather than reinvent.
- `packages/desktop/src/board/CommandPalette.tsx` — the surface D-127 extends.
- `tokio-cron-scheduler` 0.15, already in `packages/core/Cargo.toml`, vendored for the trigger
  abstraction and currently driving nothing user-facing — D-113's scheduler.

### Established Patterns
- **One git construction site.** `Command::new("git")` appears exactly once in the workspace and a
  test asserts it. Every git call in this phase routes through `git::git_at`.
- **Derive at read time, cache nothing** (D-75, enforced by `drift.rs` and `query/events.rs`). This
  is why D-128 reads git rather than maintaining a sha index.
- **Absence is the design.** `WorktreeSummary.tsx` renders nothing at all until a worktree exists,
  rather than an empty labelled header. D-120 applies the same rule to the forge section.
- **Push, then invalidate.** Rust emits a Tauri event (`app.emit("agent:event", …)`);
  `packages/desktop/src/board/useBoardQuery.ts` invalidates the affected TanStack Query keys. There
  is no polling and no `refetchInterval` anywhere in the frontend today — D-113's tick emits into
  this existing path rather than adding a second one.
- **Actor stamped in Rust, never claimed by the renderer** (T-01-04). `events.actor_id` is resolved
  inside `packages/core` by `actor.rs`.
- **Schema-enforced status vocabulary.** `0002_board_schema.sql` constrains epics and tasks to one
  five-state CHECK (`backlog`, `todo`, `in_progress`, `in_review`, `done`); `set_task_status` in
  `domain/task.rs` defers validation to that constraint and writes an `events` row with a
  before/after payload and a human-readable label. D-121's transitions go through that function —
  not around it.

### Integration Points
- **New:** a forge adapter module in `packages/core` wrapping `gh`/`glab`, with the normalised
  request-state / CI-result model named explicitly as the CONV-06 seam.
- **New:** a git-facts read path (branch, commits, ahead/behind, porcelain) exposed as a Tauri
  command and consumed through `useBoardQuery.ts`, alongside the existing worktree summary.
- **New:** a scheduler job in the Rust core (D-113/D-114) plus the slower fetch job (D-116).
- **New:** a `commit-msg` hook written into `hooks_dir_for_repo`'s directory, alongside the
  existing `pre-push` hook — the two must coexist without either disturbing the other.
- **New:** a per-project forge setting (D-119) in the `settings` surface.
- **Extended:** `CommandPalette.tsx` (D-127), `WorktreeSummary.tsx` or a sibling section for the
  git facts and the D-130 actions, `ActivityTrail.tsx` for the new event kinds.
- **A migration** is needed for the per-project forge setting and for whatever the forge state model
  persists; it follows `0016` and uses `rusqlite_migration` as every prior migration does.

</code_context>

<specifics>
## Specific Ideas

- The pull request body is the board item. D-118's pre-fill is not a convenience feature — "the
  board item becomes the PR description" is the product thesis applied to the forge, and the
  pre-fill should read as a real description a reviewer would want, assembled from the task title,
  its acceptance criteria and its session summaries.
- "Never silently overwritten" (LINK-10) was interpreted structurally rather than as a warning
  dialog: D-121's edge-triggered mechanism is *incapable* of overwriting a manual move in a loop,
  which is a stronger guarantee than a confirmation prompt.
- The staleness label on ahead/behind (D-116) is deliberate honesty furniture — the figure is
  allowed to be old, but it is never allowed to look current when it is not.

</specifics>

<deferred>
## Deferred Ideas

- **Backward status transitions** — changes-requested or closed-unmerged returning a task to
  In Progress. Rejected in D-122 for this phase; revisit only if forward-only proves to leave
  stalled tasks looking reviewed in practice.
- **Webhook-driven forge updates** — already a named future convenience (CONV-06). D-117's adapter
  and its normalised state model are the seam; nothing in this phase may assume polling is the
  only possible source.
- **A sha→task index** — rejected in D-128 as a second source of truth. If hash resolution for
  commits on removed worktrees ever becomes a real need, this is the shape it would take.
- **Epic-level rollup of git state** — how an epic summarises its tasks' branches and ahead/behind.
  Not raised, not scoped; a natural Phase 9 (fan-out) concern.
- **A `flywheel` CLI verb** (`flywheel open <sha>`) — the terminal-side half of D-127's round trip.
  No CLI surface exists in v1.

### Reviewed Todos (not folded)
Four pending todos matched phase 7 on keyword noise only (`one`, `phase`, `requirements`, `board`,
`agent`, `its`); none touches git, branches or the forge. All remain in the backlog:
- `2026-09-26-socratic-challenge-should-be-structured-like-gsd.md` (score 0.6) — Socratic challenge
  structure. Belongs to the Phase 5 authoring surface, not here.
- `2026-09-24-adapter-drops-assistant-text-when-a-stream-line-carries-text.md` (0.2) — a sidecar
  stream-parsing defect; Phase 2 territory.
- `2026-09-26-g-05-8-askuserquestion-invisible-and-board-unwritable-in-liv.md` (0.2) — authoring
  run tooling defect; Phase 5 territory.
- `2026-09-30-handoff-sheet-drops-questions-the-agent-asked.md` (0.2) — handoff sheet content;
  Phase 4 territory.

</deferred>

---

*Phase: 7-the-board-tells-the-git-truth*
*Context gathered: 2026-10-02*
