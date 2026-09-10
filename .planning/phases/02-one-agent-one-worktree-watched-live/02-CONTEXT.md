# Phase 2: One Agent, One Worktree, Watched Live - Context

**Gathered:** 2026-09-10
**Status:** Ready for planning

<domain>
## Phase Boundary

Pressing Start Work on a board task creates a git worktree that the **task** owns rather than the
session, on a branch derived from the task's key and chained to its epic's integration branch;
spawns exactly one Claude Code session as a separate operating-system process inside that worktree,
through a single adapter interface that no supervisor code branches around; streams that session's
normalised events to the user live without the application's memory growing with the transcript;
blocks the agent on permission requests until the user answers them from the board; and records the
worktree, the agent run, the session and the trigger that started it as distinct, linked, first-class
rows on the task. Sessions run either on the developer's existing local Claude Code credentials or on
an explicit API key, with nothing else in the product behaving differently.

Two structural seams land here and are the reason several of the decisions below are shaped the way
they are: the generic trigger record with `user_action` implemented and `schedule`/`webhook`
accepted-but-unimplemented (DATA-04 — flagged in `STATE.md` as the one extension-ready foundation
Phase 1 did **not** build), and the single agent adapter interface (AGNT-01). PROC-02 is
architectural rather than a check: the supervisor's own working directory is set once at launch and
never read, and every filesystem and git call takes an explicit absolute path.

**Requirements:** DATA-04, DATA-06, WORK-01, WORK-02, WORK-08, LINK-01, PROC-01, PROC-02, PROC-06,
PROC-07, AGNT-01, AGNT-02, AGNT-03, AGNT-04, AGNT-06.

**Explicitly NOT in this phase:** crash recovery, orphaned-process reaping, index-lock backoff,
staggered spawn timing, the refuse-to-destroy-a-dirty-worktree guard and destructive-action
confirmation (all Phase 3 — WORK-03 through WORK-06, PROC-03 through PROC-05, AGNT-07); structured
session summaries and context reconstitution (Phase 4 — CTX-\*, BOARD-03); Socratic authoring
(Phase 5); the agent→board write path and proposal triage (Phase 6); branch/commit/PR status on the
board (Phase 7 — LINK-02 through LINK-11); diff review and merge (Phase 8); planner fan-out and
file-set enforcement (Phase 9); the cross-project fleet view, OS notifications, worktree disk
reclamation and per-session cost display (Phase 10 — FLEET-\*, WORK-07, AGNT-08).

</domain>

<decisions>
## Implementation Decisions

### Worktree and branch layout

- **D-23:** **Worktrees live in one visible, Flywheel-owned root outside every repository:**
  `~/Flywheel/<PROJECT-KEY>/<TASK-KEY>/`. One predictable place for every project's trees, trivially
  `cd`-able from a bare terminal (success criterion 1 requires the result to be recognisable without
  Flywheel), and never nested inside a working tree — which keeps agent-written directories out of
  the tree agents are editing and stops the main checkout's ripgrep, watchers, test runners and
  builds from traversing every agent's worktree. This is the same instinct as D-14 placing the
  database in app-data, applied to a directory the user actually navigates to by hand.
  Rejected: a sibling-of-the-repo layout (scatters Flywheel-owned directories across wherever the
  user's repositories happen to live, and writes into a parent directory Flywheel does not own) and
  an in-repo `.flywheel/worktrees/` layout (nests a working tree inside a working tree).
  — **Reversibility:** costly — existing worktrees would have to be removed through
  `git worktree remove` and recreated at the new root, and every stored `worktrees.path` rewritten;
  any uncommitted agent work in flight at the time is at risk.

- **D-24:** **A task branch is `flywheel/<task-key-lowercased>-<title-slug>`** — e.g.
  `flywheel/thre-142-fts5-search-and-filters`. The `flywheel/` namespace makes every agent-created
  branch instantly distinguishable from a branch the user cut by hand, which is load-bearing from
  Phase 7 on (LINK-10 detects the user's own manual commits on a task's branch) and again at fan-out.
  The slug makes `git branch` readable without opening the board. The slug is fixed at branch
  creation and is **not** rewritten when the task's title later changes.
  Rejected: a bare `thre-142` (a wall of opaque keys in `git branch`) and an unnamespaced
  `thre-142-<slug>` (nothing on the name says Flywheel produced it).
  — **Reversibility:** one-way — this has the same shape as D-10: once real git history and (from
  Phase 7) commit trailers carry these names, published refs cannot be retroactively renamed.

- **D-25:** **The epic integration branch is `flywheel/epic/<epic-key-lowercased>-<title-slug>`, cut
  lazily from the trunk tip at the first Start Work under that epic**, and its name is written to the
  `epics.integration_branch` column that migration `0002_board_schema.sql` already added for exactly
  this purpose. An epic that never runs an agent never leaves a branch behind, and the base is as
  fresh as it can be at the moment work actually begins.
  Rejected: cutting eagerly at epic creation (branches accumulate for every epic that is shaped and
  never worked, from a stale base) and an explicit user-run "set up integration branch" action (one
  more thing to forget before the first task can run).

- **D-26:** **A task with no epic branches straight off the trunk and targets it directly** —
  `flywheel/thre-142-<slug>` → the project's `default_branch`, with no integration branch in between.
  This closes the hole D-13 explicitly handed to this phase. WORK-02's fixed topology becomes **two
  fixed shapes, not one shape with an improvised exception**: neither shape is ever chosen by a
  planner or an agent, and which one applies is a pure function of whether `task.epic_id` is null.
  Rejected: requiring an epic before Start Work (a hard block on the quick-fix task D-13 exists to
  permit) and auto-filing orphans into a catch-all epic (an epic the user never authored appears on
  the board and accumulates unrelated work).

### Start Work

- **D-27:** **Start Work opens a launch sheet before spawning anything.** The sheet is pre-filled
  with exactly what the agent will be told, plus an optional free-text instruction and the permission
  mode for this run; Enter starts it. The briefing is visible and correctable before tokens are
  spent, and the sheet is the surface Phase 4's context packet slots straight into rather than
  needing a new one.
  Rejected: a single keypress with no sheet (no place for the one sentence of steering the user
  usually has, and nothing shows what the agent was actually told until the transcript is read) and
  spawning an idle session the user types into (which makes the board optional — the exact thing this
  product exists to prevent).

- **D-28:** **Build `assembleContextPacket(taskId)` now, as a pure deterministic query** — epic title
  and description, task title and description, every acceptance criterion with its verification hint
  (D-05), and the branch/worktree facts — and render it into the initial prompt. It is a genuine
  stub of Phase 4's ContextAssembler with the same signature and the same "same board state always
  produces the same packet" contract, so Phase 4 adds inputs (prior summaries, diff-so-far) rather
  than replacing a throwaway. Never an LLM call (ARCHITECTURE.md §3).
  Rejected: a prose markdown brief (Phase 4 would replace it wholesale, and the reproducibility
  property Phase 4's multi-cycle test suite depends on would have to be built from scratch there) and
  a pointer-plus-board-tool approach (the agent↔board tool channel is Phase 5/6; bringing a whole
  write-path seam forward to serve a read is not this phase's job).
  — **Reversibility:** costly — Phase 4's CTX-04 determinism requirement and its multi-cycle drift
  tests are written against this function's contract; changing its shape later means rewriting that
  test suite and every call site.

- **D-29:** **Starting a session moves the task to In Progress; nothing ever moves it out.** The
  status change is a normal actor-attributed mutation, so it lands in the event log and the activity
  trail like any other (DATA-03, D-19) — with the agent as the actor. Moving to In Review is a human
  judgement, and Phase 8 is where criteria get checked against a diff. The board tells the truth about
  what is running without an agent ever promoting its own work.
  Rejected: moving to In Review on a clean exit (a session that finishes successfully having achieved
  nothing still parks the task in the review lane) and never moving status at all (the user would
  hand-move every task to In Progress immediately after pressing the button that started work on it).

- **D-30:** **Every Start Work produces a fresh session on the reused worktree.** The existing
  worktree is reused exactly as the last session left it — dirty tree and all — and a brand-new
  session starts against a freshly assembled packet. Claude Code's native `--resume` is deliberately
  **not** used in v1: `resumeSession` stays in the adapter interface (ARCHITECTURE.md §5) as a
  capability-gated, unimplemented method. This rehearses the product thesis early — worktree durable,
  context disposable — so that Phase 4's falsification test exercises a path Phase 2 already made the
  only path.
  Rejected: prompting resume-or-fresh on each start (two code paths from day one, a decision every
  time, and a resume path quietly competing with the mechanism the product is betting on) and
  resuming whenever possible (contexts accumulate and rot exactly as they do in chat-native tools,
  and the board never gets exercised as the thing that carries state).

### Watching a session

- **D-31:** **The live session gets its own full surface**, pushed into from a task and popped back
  out of; the board stays the board. The existing 480px item-detail side panel is already carrying
  title, status, acceptance criteria and the activity trail, and a multi-hour transcript does not fit
  beside them. This is also the surface Phase 10's fleet view jumps into from any project
  (FLEET-03), so building it here is building the real thing rather than a placeholder.
  Rejected: a Session tab inside the 480px panel (too narrow for tool output, and it competes with
  the panel's existing job) and a dockable bottom pane (a third layout axis on top of the panel's
  existing below-1100px overlay rule).

- **D-32:** **The feed is structured, with the raw stream available on demand.** Each normalised
  `AgentEvent` renders as its own row: assistant text as prose, a tool call collapsed to one line
  (name + target) that expands, a permission request as an inline card that visibly blocks, cost and
  token counts in a status strip. A "view raw" affordance opens the persisted JSONL. This is what
  AGNT-02's normalisation is *for*, it is the only way to skim a long run, and the raw log has to
  exist regardless — so the escape hatch is nearly free, and it is what lets the user check the
  feed's ground truth from inside the app when a row renders wrong.
  Rejected: a structured feed with no raw escape hatch, and a verbatim terminal-style stream (nothing
  skimmable, a blocking permission request is just more text scrolling past, and the adapter's common
  event type would end up normalising for nobody).

- **D-33:** **Full scrollback, delivered by a windowed read against the persisted log.** The UI holds
  a bounded window of events and scrolling up pages older ones back from disk — the same shape as the
  board's virtualized windowed queries, a pattern this codebase already proved at 1,000+ items
  (D-03, BOARD-08). PROC-07's flat-memory requirement is then satisfied **by construction rather than
  by ceiling**, and nothing an agent did is ever out of reach without leaving Flywheel.
  Rejected: a live-tail ring buffer with the rest only openable outside the app (reviewing what an
  agent did an hour ago would mean leaving Flywheel — the specific move this product exists to stop)
  and keeping everything in memory up to a hard cap with a truncation marker (a long unattended run
  is exactly what finds the ceiling).

- **D-34:** **The persisted session log lives beside the database, not in it and not in the
  worktree:** `<app-data>/sessions/<agent-run-id>.jsonl`, with the session/run row holding a path
  reference. This follows D-14's rule — agent-written state never lands inside the tree agents are
  editing — and matches DATA-06/ARCHITECTURE.md §2's `Artifact.storage_ref` shape, which is specified
  as a pointer rather than a blob. A log written this way also outlives the worktree it came from.
  It is written durably and independently of what the UI renders, so UI backpressure can never cause
  silent output loss (PITFALLS.md pitfall 10).
  Rejected: writing into the worktree (inside the tree the agent is editing, could be committed, and
  dies with the worktree) and storing transcripts in SQLite (hundreds of megabytes a day in the same
  file that holds the board, carried by every migration).

- **D-35:** **Stop means interrupt, then force.** Send an interrupt, let the agent finish its current
  tool call and shut down cleanly, and kill the process group if it has not exited within a short
  window. The worktree is left exactly as the agent left it — dirty, uncommitted, inspectable
  (PROC-06) — and the run record closes as `interrupted`. Nothing is committed on the user's behalf.
  The next session, always fresh per D-30, simply picks the tree up as-is.
  Rejected: committing a work-in-progress commit on stop (it writes git history the user did not
  author, and Phase 3's whole premise is *refusing* to touch a tree with uncommitted changes rather
  than resolving it for them) and a separate Pause verb (a suspended agent still holds a session and
  a slot, and "reattachable" is the resume path D-30 already declined to build).

### Permission gate and credentials

- **D-36:** **Sessions default to accept-edits: the agent writes freely inside its own worktree and
  stops for everything else** — shell commands, network access, anything outside the tree. File edits
  on a throwaway branch inside an isolated worktree are the one class of action the topology already
  makes safe to undo, and gating them would make the user the bottleneck on every write. The launch
  sheet (D-27) overrides the mode per run.
  Rejected: ask-every-time as the default (unusable unattended — it would be changed on day one and
  never changed back) and plan-first as the default (two round trips for every task, including the
  ones where the plan was never in doubt).

- **D-37:** **A blocked agent is visible on the board, not only on the session surface.** The task's
  row carries a distinct blocked state — not merely "in progress" — and the project rail carries a
  count of everything waiting on the user. This makes the board itself the answer to "what needs me?",
  which is precisely the signal FLEET-02 generalises across projects in Phase 10, so this phase builds
  the per-project half of the real mechanism rather than a throwaway. **OS notifications are
  deliberately not built here** — FLEET-04 owns them in Phase 10.
  Rejected: surfacing the request only in the session feed (an agent can sit blocked and silent for
  an hour, which is the failure mode that sends people back to cycling terminal tabs).

- **D-38:** **Allow-always is scoped per project, per tool.** Answering a request offers allow once /
  deny / allow this tool for this project from now on, stored as a project-scoped rule that can be
  inspected and revoked. Prompt fatigue is what kills unattended running, and the project is the
  honest blast radius — its trunk, its worktrees, its dependencies. A rule earned on one repository
  must not silently apply to another.
  Rejected: session-scoped allow-always (since every start is a fresh session per D-30, the same
  prompt would be re-answered on every run of every task) and a global per-tool allowlist (a rule
  granted on a scratch repository would be live on a production one, long after the user has
  forgotten granting it).

- **D-39:** **The credential path is a global default with a per-project override, and this phase
  introduces the application's first Settings surface** (Phase 1 deliberately shipped none). The
  choice is between the developer's existing local Claude Code login and an explicit API key; **the
  API key is held in the macOS Keychain, never in the SQLite database and never in a config file.**
  A per-project override lets a client repository bill to an API key while personal repositories ride
  the subscription, and it keeps the credential boundary — which `PITFALLS.md` pitfall 5 rates as an
  existential dependency outside Flywheel's control — in exactly one explicit, auditable place.
  Nothing else in the product behaves differently between the two paths (success criterion 5).
  Rejected: a global-only choice (no way to separate billing or risk between repositories without
  flipping a global switch) and choosing per run on the launch sheet (one more decision on a path
  taken dozens of times a day, and no stable answer to "what is this project running on?").
  — **Reversibility:** costly — moving a stored secret between backing stores later means a
  migration the user must be walked through, and the boundary is the thing this project has committed
  to keeping auditable.

### Claude's Discretion

The following were **not** discussed. The researcher and planner should resolve them against the
decisions above and the canonical references — not re-ask the user.

- **The Node sidecar's shape.** `packages/` today contains only `core`, `desktop` and
  `relay-client` — **there is no sidecar**, so this phase creates it. Open: whether it is one
  long-lived process hosting all sessions or one process per session; and whether it drives
  `@anthropic-ai/claude-agent-sdk` or shells out to the user's own already-authenticated `claude`
  CLI in headless `-p --output-format stream-json` mode. Note this is **not purely an implementation
  detail**: `PITFALLS.md` pitfall 5 explicitly recommends "literally shelling out to the user's own
  already-authenticated `claude` CLI, not intercepting or replaying OAuth tokens itself" and keeping
  that boundary architecturally explicit and auditable — which bears directly on D-39 and on AGNT-03.
  Resolve against `.claude/CLAUDE.md` §"The Two Load-Bearing Decisions" #1, `PITFALLS.md` pitfall 5,
  and `ARCHITECTURE.md` §1.
- **How the worktree, agent-run and session records render on a task** (success criterion 5 requires
  them to be visible as distinct linked records). Where they appear in the item-detail panel, and what
  the list looks like after ten runs, were not discussed.
- **Whether the DATA-04 trigger record surfaces in the UI at all in v1**, or exists purely as a schema
  row and an event. The requirement only demands the record and the accepted-but-unimplemented
  `schedule`/`webhook` sources.
- **Whether the user can type into a running session to steer it mid-task.** `FEATURES.md` §3 rates
  interrupt/redirect as table stakes, but no Phase 2 success criterion names it — treat as a scope
  judgement for the planner, defaulting to out unless it is nearly free.
- **What a failed or errored run looks like** on the board and on the session surface.
- **Slug drift and collisions** — what happens to the directory and branch name when a task is renamed
  after work started (D-24 fixes the slug at creation), and how a duplicate directory name is handled.
- **Whether the `flywheel/` branch namespace and the `~/Flywheel/` worktree root are configurable**,
  or fixed like everything else in this product. Default to fixed; rigidity is the feature.
- **The exact shape of the trigger→run→session record split** (ARCHITECTURE.md §2 sketches
  `Trigger`, `AgentRun`, `SessionSummary`, `Artifact`, `PermissionRequest`; DATA-06 requires them as
  first-class rows). Field lists and which of them Phase 2 actually needs are a planning concern.

</decisions>

<canonical_refs>
## Canonical References

**Downstream agents MUST read these before planning or implementing.**

### Project intent, scope and requirements
- `.planning/PROJECT.md` — the core value, the seven hard constraints (especially "no v1 decision may
  foreclose scheduled automations, team collaboration, the mobile/web relay, or additional agent
  backends"), and the Key Decisions table. Note that "Worktrees are durable; agent sessions are
  ephemeral" and "Claude Code only in v1, behind an adapter seam" are both still marked *Pending* —
  this is the phase that makes them true.
- `.planning/REQUIREMENTS.md` — the 15 requirement definitions this phase implements, plus the v2
  seams it must not foreclose: **`AUTO-01`** (scheduled runs, seam = `DATA-04`) and **`BKND-01`**
  (a Codex CLI adapter, seam = `AGNT-01`). Both are named in the file as riding on seams that land
  in this phase.
- `.planning/ROADMAP.md` §"Phase 2: One Agent, One Worktree, Watched Live" — the five success
  criteria this phase is verified against, and the Notes explaining why DATA-04 and AGNT-01 land here.
- `.planning/STATE.md` §Blockers/Concerns — two entries bind this phase directly: **the Anthropic
  credential-policy dependency** (AGNT-04 is the named hedge) and **"the generic trigger abstraction
  was never built"**, which is DATA-04's debt coming due here.

### Architecture
- `.planning/research/ARCHITECTURE.md` §1 "Process Topology" — the renderer/supervisor/worker
  three-tier diagram, the component responsibility table, and the argument for why cwd-drift is
  structurally impossible rather than merely guarded. **This is the direct source for PROC-01 and
  PROC-02.**
- `.planning/research/ARCHITECTURE.md` §2 "Domain Schema" — the concrete field lists for `Worktree`,
  `AgentRun`, `SessionSummary`, `Artifact`, `PermissionRequest` and `Trigger`. The authoritative
  starting point for this phase's migration (DATA-06).
- `.planning/research/ARCHITECTURE.md` §2.2 "Agent runs, worktrees, branches, diffs, summaries are
  first-class" — why these are top-level tables and not JSON on a task; names the three things that
  would otherwise be impossible.
- `.planning/research/ARCHITECTURE.md` §2.3 "Generic trigger abstraction" — `Trigger.source`, the
  single `startAgentRun(taskId, triggerId)` command handler, and the rule that future schedule and
  webhook sources are new *producers* only. **This is DATA-04's specification.**
- `.planning/research/ARCHITECTURE.md` §3 "Context-Reconstitution Mechanism" — read for the
  `assembleContextPacket` contract D-28 stubs (a pure query, never an LLM call), even though the full
  mechanism is Phase 4.
- `.planning/research/ARCHITECTURE.md` §5 "Agent Adapter Interface" — the `AgentAdapter` contract,
  the `AgentEvent` union D-32's feed renders, the per-backend capability table, and the
  `supportsResume` capability flag D-30 relies on. **This is AGNT-01 and AGNT-02's specification.**
- `.planning/research/ARCHITECTURE.md` §7 "Extension Seams for the Deferred Four" and §8 "Open-Core
  Module Boundary" — where the sidecar and adapter code must sit so the OSS packages still build with
  the commercial packages stripped.
- `.planning/research/ARCHITECTURE.md` §"Anti-Patterns to Avoid" — anti-pattern 3 (cwd as an implicit
  git/fs argument) is PROC-02 stated as a rule; anti-pattern 2 (letting agents write directly to
  Task/Epic) constrains D-29's status write.

### Stack
- `.claude/CLAUDE.md` §"Technology Stack" — the locked stack. Load-bearing for this phase: the Tauri
  Rust core + **bundled Node sidecar** decision and its rationale, `node-pty` vs headless stdio,
  `tokio-cron-scheduler` ("the crate should be vendored and the cron-tick trigger type stubbed now"),
  the rule that worktree lifecycle operations shell out to the **system `git` CLI** rather than
  `git2-rs`, and `@anthropic-ai/claude-agent-sdk` pinning.
- `.planning/research/STACK.md` — the full argument behind those choices.

### Risk
- `.planning/research/PITFALLS.md` **pitfall 5** — "Local credential reuse is a compliance dependency
  Flywheel doesn't control." Rated existential. Directly shapes D-39 and the sidecar-shape question
  left to Claude's discretion.
- `.planning/research/PITFALLS.md` **pitfall 10** — streaming backpressure across concurrent sessions;
  persist raw output durably and independently of what the UI renders. This is D-34's justification.
- `.planning/research/PITFALLS.md` **pitfall 11** — agents hanging on unattended interactive prompts;
  argues for a per-session idle-output timeout surfaced as a board-visible "needs human input" state,
  which pairs with D-37.
- `.planning/research/PITFALLS.md` **pitfalls 1 and 4** — worktree lock contention and zombie
  processes. **Phase 3 owns the fixes**, but read them here so this phase does not build something
  Phase 3 has to tear out.

### Market and feature framing
- `.planning/research/FEATURES.md` §2 "Worktree & Branch Management" — the fixed-topology
  differentiator and the unanimous community rule that worktrees must be removed through
  `git worktree remove`/`prune`, never `rm -rf`.
- `.planning/research/FEATURES.md` §3 "Agent Session Lifecycle" and §7 "Human-in-the-Loop Gating" —
  the tiered permission model D-36 inherits, and the per-project permission profile D-38 implements.

### Prior phase decisions and UI contract
- `.planning/phases/01-the-board-is-the-store-of-record/01-CONTEXT.md` — **all of it.** D-10 (item
  keys, one-way once git history carries them), D-13 (nullable `epic_id`, whose consequence D-26
  closes), D-14 (one fleet-wide database, agent state never inside the repo), D-04 (core pushes
  deltas, UI invalidates), D-19 (event payloads must be human-renderable).
- `.planning/phases/01-the-board-is-the-store-of-record/01-UI-SPEC.md` — the locked visual direction
  ("Flight Progress Strips"), the Surface Inventory this phase extends, the exhaustive Keyboard Map
  new actions must slot into, the Radius Language and measured palette, and §"Open Decisions the
  Builder Must Not Invent". **Caveat:** Phase 10.1 is scheduled to re-open and amend sections this
  document marks LOCKED. Build against it as it stands; do not pre-empt 10.1.
- `.planning/WINDOWS.md` — one open defect (window-scoped parent pickers on `BoardView.tsx`); read
  before touching that file.

</canonical_refs>

<code_context>
## Existing Code Insights

Phase 1 shipped 21 plans and 277 green tests. The repository is a three-package monorepo:
`packages/core` (Rust), `packages/desktop` (Tauri v2 + React), `packages/relay-client` (inert seam).

### Reusable Assets

- **`packages/core/src/db/`** — `rusqlite` with WAL, `rusqlite_migration`, and backup-first migration
  safety (`backup.rs`, D-18). This phase's new tables (`worktrees`, `agent_runs`, `sessions`,
  `triggers`, `permission_requests`) are migration `0003`.
- **`packages/core/src/db/migrations/0002_board_schema.sql`** — already contains
  `epics.integration_branch TEXT`, added in Phase 1 specifically so Phase 8 would need no schema
  change. **D-25 is its first writer.** Also the model to follow for how this project documents an
  owner decision inline in a migration.
- **`packages/core/src/domain/`** — one module per entity, each writing its mutable row and appending
  to `events` in the same transaction (DATA-01, the transactional outbox). New agent entities follow
  this exact shape. `actor_id` is resolved server-side in every handler and never accepted from the
  renderer — the rule that makes D-29's agent-attributed status change non-repudiable.
- **`packages/core/src/query/`** — every query is a compile-time literal with bound named parameters;
  zero `format!`/string-interpolated SQL. `query/events.rs` (activity trail, cursor-resumable stream)
  is the closest analog for D-33's windowed log reads.
- **`packages/core/src/ids.rs`, `ranking.rs`, `marker.rs`** — ULID allocation, fractional indexing,
  and the committed project-identity marker (D-15/D-16). `projects.repo_path` plus the marker is how
  a worktree root resolves to an absolute repository path.
- **`packages/desktop/src/adapters/tauri.ts`** — the single invoke/listen seam, the **only** module
  permitted to import `@tauri-apps/api`. Every new agent command and every live-event subscription
  goes through it. `subscribeBoardChanged` is the existing push channel (D-04).
- **`packages/desktop/src/state/keyboard.ts`** — the single key→action map; `dispatchAction(id)`
  synthesizes a real `KeyboardEvent` so the command palette and native menu re-enter one pipeline.
  New actions (start work, open session, stop session, answer permission) register here, not as
  competing per-component handlers.
- **`packages/desktop/src/item-detail/ItemDetailPanel.tsx`** and **`ActivityTrail.tsx`** — the 480px
  peer surface with its Radix `FocusScope`/`DismissableLayer` pattern and the Escape ladder. D-31
  puts the session on its own surface instead, but the focus/dismiss pattern is the one to copy.
- **`packages/desktop/src/legend/marks.ts`** and **`theme/contrast.ts`** — the marks vocabulary and
  the asserted contrast checks a new "blocked" state (D-37) must join.
- **`packages/core/tests/`** — a crash harness binary and cursor-resume tests. The precedent for
  proving process-level guarantees with a real spawned process rather than a mock.

### Established Patterns

- **The schema is the authority, not app code** — CHECK constraints reject invalid states so no
  app-layer guard can be bypassed. `triggers.source` and run/session status columns should be CHECK
  constrained the same way, with `schedule`/`webhook` accepted-but-unimplemented per DATA-04.
- **One transaction writes the mutable row and appends to `events`** — no exceptions, and payloads
  are shaped for human rendering (D-19), because the activity trail reads straight from the log.
- **No `cwd` as an implicit argument** — already how `packages/core` is written; this phase is where
  it starts mattering, via an explicit `git -C <abs-path>` wrapper.
- **Default-deny IPC** — `capabilities/default.json` grants only `core:default` and
  `dialog:allow-open`; app commands are exposed solely through `generate_handler!` in `main.rs`, and
  the capability file documents the full roster for auditability. New agent commands must be added to
  both and the roster comment kept accurate.
- **Self-hosted Archivo, hand-rolled unstyled Radix primitives, Lucide icons; no shadcn.**

### Integration Points

- **`packages/desktop/src-tauri/src/commands/`** — one module per entity; agent commands (start work,
  stop session, answer permission, read session log) land as new modules registered in `mod.rs` and
  `main.rs`'s `generate_handler!`.
- **`packages/desktop/src-tauri/src/main.rs` / `state.rs`** — where the supervisor's long-lived state
  lives. The sidecar's lifecycle (spawn, health-check, restart, kill-on-exit) is owned here, and this
  is where the "cwd is pinned at launch and never read" invariant is enforced.
- **A new `packages/` member for the Node sidecar** — it does not exist yet. Its placement must respect
  `ARCHITECTURE.md` §8's open-core boundary (the OSS packages must still build with the commercial
  packages stripped).
- **`packages/desktop/src/App.tsx`** — owns the board/detail layout decision and the below-1100px
  overlay rule; the new session surface (D-31) is routed from here.
- **`tokio-cron-scheduler`** is not yet vendored. `.claude/CLAUDE.md` asks for the crate vendored and
  the cron-tick trigger type stubbed in this phase's timeframe so schedule-as-trigger-source is a
  drop-in later — this is the concrete discharge of the `STATE.md` blocker.

</code_context>

<specifics>
## Specific Ideas

- **"Recognisable from a bare terminal without Flywheel" is the test the layout decisions were made
  against.** It is why the worktree root is a visible `~/Flywheel/` rather than app-data (where the
  database correctly lives), why branches carry a readable title slug rather than a bare key, and why
  the `flywheel/` namespace exists at all — so that `git branch` in any repository immediately
  separates what an agent made from what the user made by hand.
- **The launch sheet is a deliberate "show me the briefing before you spend money" gate**, and it was
  chosen partly because it is the surface Phase 4's context packet slots into unchanged. It is not a
  confirmation dialog.
- **"Always a fresh session" was chosen over native resume specifically to rehearse the product
  thesis early.** The reasoning was explicit: making it the *only* path in Phase 2 means Phase 4's
  falsification test is exercising a path the product already depends on, rather than a second-class
  branch competing with a resume mechanism.
- **"Two fixed shapes, not one shape with an exception"** is the framing that resolved D-13's orphan-
  task hole. WORK-02's rigidity is preserved because neither shape is ever chosen by a planner or an
  agent — which shape applies is a pure function of `task.epic_id`.
- **PROC-07 is satisfied by construction, not by ceiling.** The windowed-read-against-the-log design
  was chosen over a generous in-memory cap for exactly this reason.
- **Nothing is ever committed on the user's behalf.** Stop leaves the tree dirty and inspectable;
  this is consistent with Phase 3's premise of refusing to touch a dirty worktree rather than
  resolving it.

</specifics>

<deferred>
## Deferred Ideas

- **OS notifications when an agent blocks or completes** — real value, but `FLEET-04` owns it in
  Phase 10. D-37 deliberately stops at board-visible state plus a project-rail count.
- **Cross-project "needs you" queue** — `FLEET-02`, Phase 10. D-37 builds the per-project half of the
  same signal, so the generalisation is additive.
- **Per-session cost and token display beyond a live status strip** — `AGNT-08` is Phase 10. The
  adapter's `cost_update` event exists from this phase, so the data is available early.
- **Native session resume (`--resume`)** — the adapter interface keeps `resumeSession` and the
  `supportsResume` capability flag, unimplemented. Revisit only if the board-reconstitution path
  proves insufficient in Phase 4, which would itself be a finding about the thesis.
- **Typing into a running session to steer it mid-task** — `FEATURES.md` §3 rates interrupt/redirect
  as table stakes, but no Phase 2 success criterion names it. Left as a scope judgement, defaulting to
  out.
- **A per-task or per-epic default permission profile** — `FEATURES.md` §7 flags it as a
  differentiator that reduces prompt fatigue at fleet scale. D-38's per-project rules are the v1
  answer; per-epic profiles belong with fan-out in Phase 9.
- **Correcting `RLAY-01` in `REQUIREMENTS.md`** — carried forward unresolved from Phase 1 (D-21).
  Still a requirements-pass action for a milestone boundary, recorded in `STATE.md` § Deferred Items.

</deferred>

---

*Phase: 2-One Agent, One Worktree, Watched Live*
*Context gathered: 2026-09-10*
