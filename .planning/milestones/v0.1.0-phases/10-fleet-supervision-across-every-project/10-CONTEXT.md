# Phase 10: Fleet Supervision Across Every Project - Context

**Gathered:** 2026-10-12
**Status:** Ready for planning

<domain>
## Phase Boundary

This phase delivers **one cross-project supervision surface and an OS-level attention channel**.

Concretely: a Fleet surface listing every agent across every registered project with its state and
what it is doing; a dedicated blocked queue answerable in place; OS notifications when a run blocks,
finishes or fails; and a worktree inventory across all projects showing disk usage with a reclaim
path. Per-session token and cost figures, already persisted since Phase 2, surface at fleet scale.

It generalises mechanisms that already exist as their per-project half. It is **not** new agent
capability, new board semantics, new dispatch behaviour, or any part of the relay/team layer.

**Out of scope, named explicitly so planning does not drift into it:** the relay, mobile or web
surfaces (RLAY-\*); scheduled automations (the `tokio-cron-scheduler` trigger type stays stubbed);
a second agent backend; any change to the destructive-gate trust boundary (Phase 12, complete);
per-project notification policy; mid-run cost streaming (see D-180); and shipping/distribution,
which is Phase 11.

</domain>

<decisions>
## Implementation Decisions

Decision ids continue the project-wide sequence; Phase 9 ended at D-162.

### The fleet surface

- **D-163:** **The fleet is a new full surface, pushed into the shell and popped back out of** —
  the same shape `SessionSurface`, `TriageSurface`, `ReviewSurface` and `SettingsSurface` already
  use, triggered through `useUiStore` from `App.tsx`. The project rail's **existing `Fleet` and
  `Review queue` sections stop being inert read-only facts and become its entry points**, which is
  exactly what 08.1 held them back for ("a row that looks like a button and does nothing is worse
  than a plain number"). A global keyboard binding opens it too.
  Rejected: an "All projects" pseudo-project board mode (every board query, search, filter and
  quick-add is `projectId`-scoped today and would each need an all-projects branch); and a
  persistent always-on fleet strip above the board (a third layout axis, which D-31 already
  rejected a dockable pane for).

- **D-164:** **One flat list ordered by urgency, with the project as a column, never a grouping.**
  Three bands: `NEEDS YOU` (blocked, then awaiting-review, then abandoned), `RUNNING`, then
  `DONE / FAILED`. Longest-waiting first within each band.
  Rejected: grouping by project (a blocked agent in the fourth project falls below the fold, which
  is the exact failure this phase exists to kill — the roadmap's own note says criterion 2 decides
  whether this beats tab-cycling); and flat newest-activity-first (a long-blocked agent sinks as
  chattier agents push it down).

- **D-165:** **A finished run stays on the fleet until acknowledged, not on a timer.** Live runs
  always appear; a `completed`, `failed` or `abandoned` run appears while `acknowledged_at IS NULL`
  and leaves once acted on. This reuses the **existing `agent_runs.acknowledged_at` column** rather
  than introducing a retention clock. **Executor note:** `agent_run_acknowledge`'s SQL is today
  gated by `AND status = 'abandoned'` (`commands/agent_run.rs:1956`); extending it to `completed`
  and `failed` is a one-clause change, and the capability file's own description of that command
  must be updated with it.
  Rejected: a rolling N-hour window (a failure that happened overnight drops off exactly when the
  user sits down, and the window length becomes a setting nobody tunes); and live-runs-only (it
  contradicts FLEET-04, which names four states the fleet itself must distinguish).

- **D-166:** **The row opens the session; a second target on the row reaches the board item.**
  Enter or click on a fleet row opens that run's `SessionSurface` — the thing the user came to see.
  The `TASK-xx` key rendered on the row is a distinct secondary target for the board item, with its
  own keyboard binding. Both FLEET-03 destinations are reachable without a menu.
  Rejected: board-item-first (consistent with the board being the store of record, but it costs an
  extra hop for the thing the fleet was opened to watch); and expand-in-place with both as explicit
  actions (adds a disclosure state and a second feed renderer, and D-32 already settled where the
  feed lives).

- **D-167:** **The "what it's doing" cell is the latest normalised feed row, truncated to one
  line.** It reuses the session feed's existing normaliser and its existing row kinds
  (`assistant_text`, `tool_call`, `system_notice`, `scope_denied`, `git_retry`, `raw`) — so a tool
  call reads `Edit packages/core/src/git.rs` and narration reads its first clause. **The fleet never
  defines a second vocabulary for agent activity.**
  Rejected: leading with the task title (two agents on one task read identically and the row stops
  being a liveness signal); and the bare tool name (`Bash` does not tell you whether the agent is
  on track, which is the actual question).

### The at-a-glance state vocabulary

- **D-168:** **A row's `fleet_state` is derived in one SQL read and stored nowhere.** The
  cross-project query joins `agent_runs` to its task and returns the state per row: a `completed`
  run whose task is not yet Done reads **awaiting review**; every other case maps straight from the
  run status. There is no new column and therefore **no second write path that can disagree with
  the run** — the truth stays where it already lives, in `agent_runs.status` and `tasks.status`.
  Rejected: a `fleet_state` column written at run end (one cheap read with no join, and inspectable
  in the DB — but it duplicates truth held in two tables, and a task reviewed later leaves the
  column stale unless something rewrites it); and showing the task status alone (a failed run over
  an In Progress task would be indistinguishable from a healthy one, which FLEET-04 forbids).

- **D-169:** **Six states on the fleet row, not four — FLEET-04's four are a floor, not a cap.**
  The fleet renders every status the legend already defines. `interrupted` stays **muted**, because
  02-UI-SPEC § Run Status states that a user-initiated interrupt is a normal outcome and not an
  error. `abandoned` keeps the distinct "needs decision" urgency D-46 gave it and sits in the
  `NEEDS YOU` band. No existing vocabulary is flattened.
  Rejected: folding both into `failed` (literally satisfies FLEET-04's four and keeps the row
  scannable — but it calls a deliberate user-initiated stop a failure, which 02-UI-SPEC explicitly
  rejected); and folding `interrupted` into done with `abandoned` into needs-you (a clean
  completion and a half-finished interrupt then look identical).

- **D-170:** **"Awaiting review" reuses the `status` channel's existing In Review mark** (the
  circle-with-ellipsis) verbatim, rather than adding a seventh mark to the `agent` channel. The
  `agent` channel keeps meaning "what the process did"; the review signal stays a board concept,
  and the legend gains no new entry to explain.
  Rejected: a new agent-channel mark (internally tidier — one channel, one colour role per fleet
  state — but it creates a second glyph meaning "awaiting review" and the legend then has to
  explain the difference from the board's).

- **D-171:** **One cross-project query, re-run on `board:changed`; elapsed times tick locally.**
  `board:changed` is **already an app-wide invalidation signal, not project-scoped** (`sidecar.rs`,
  `scheduler.rs`), so the fleet rides the existing D-04 push with no new mechanism. Elapsed times
  are computed in the UI from `started_at` on a plain interval — no IPC per second. One read path to
  bound in the Performance Contract.
  Rejected: an `agent:event` subscription per live run (freshest possible activity line, but it is
  N subscriptions churning as runs start and end, and it duplicates the normaliser outside the
  session surface); and a fleet-local poll timer (adds a second freshness mechanism alongside
  D-04's push, which is the divergence the existing decisions were written to avoid).

### Attention routing — the queue and the notification

- **D-172:** **FLEET-02's queue holds live blocks only** — the runs sitting at a `pending`
  `permission_requests` row, routine or destructive, across every project. Abandoned runs and
  awaiting-review work stay on the fleet surface and in their own rail rows. This preserves
  **D-46's refusal to merge a live agent burning time with a cold decision**, and it is honest to
  FLEET-02's own wording ("currently blocked").
  Rejected: one queue for everything waiting on a human (completely answers "what needs me?" — but
  it merges three urgencies D-46 split on purpose, and a long review backlog then buries a live
  agent that is spending money right now); and blocked-plus-abandoned (two urgencies instead of
  three, but it still merges the live-spend case with the cold one).

- **D-173:** **A blocked agent is answered inline from the queue — a third mount of
  `PermissionRequestCard`.** 02-UI-SPEC Discretion #6 already specifies "one component, mounted in
  two places … both instances read/write the same row — answering in either place resolves both";
  the queue is the third such mount, with the same three unequal-weight actions and the same
  **no-Escape-to-dismiss rule**. Draining four blocked agents across three projects costs four
  keystrokes instead of four round trips, which is the queue's entire purpose, and it needs **no new
  verb** — `agent_run_answer_permission` is unchanged.
  Rejected: jump-to-session-to-answer (safer for a destructive request you should not approve blind
  — but it makes the queue a directory rather than a tool); and inline-for-routine /
  jump-for-destructive (two interaction models in one list, when the card's own design already
  renders the input payload wherever it mounts).

- **D-174:** **`blocked`, `completed` and `failed` fire an OS notification; `interrupted` and
  `abandoned` do not** (one is user-initiated, the other is an app-restart artefact). It is
  **suppressed only when the window is focused AND that run's session surface is the visible
  surface** — the one case where the user is already looking at it. It still fires while the fleet
  surface is open, because eight projects produce one visible row. `failed` is included because a
  crashed agent needs the user exactly as much as a blocked one.
  Rejected: exactly blocked-and-completed with no suppression (trivially testable and never
  silently withholds — but a banner for the session you are watching is the fastest way to train
  yourself to ignore notifications); and blocked-only (highest signal per notification, but it
  fails FLEET-05 as written, which names completion explicitly).

- **D-175:** **The Rust core emits the notification, at the same site it writes the status
  transition, and coalesces transitions inside a short window.** The renderer is never granted a
  notification capability, so `capabilities/default.json` **keeps its default-deny posture for the
  window**. A lone transition reads normally ("api · TASK-02 is blocked"); several inside the window
  collapse into one summary banner ("3 agents finished — web, api") rather than stacking. Phase 9's
  fan-out with a cap of up to 8 makes a simultaneous wave the normal case, not an edge case.
  This adds `tauri-plugin-notification` as a dependency.
  Rejected: one notification per transition from the core (simplest to build and verify, and each
  banner can click through to its own run — but a fan-out wave then stacks eight banners); and
  emitting from the renderer by diffing successive fleet reads (batching is free since it already
  has the list — but it needs a notification grant in the capability file, only works while the
  window exists, and makes the notification a second derivation of state rather than a fact the
  core asserts).
  — **Reversibility:** costly — moving the emit to the renderer later means re-deriving every
  transition from successive query results and granting the window a notification permission,
  reversing the default-deny boundary `capabilities/default.json` documents as an explicit threat
  control.

- **D-176:** **A single-transition banner opens that run's session surface; a coalesced banner opens
  the fleet surface. One global on/off switch lives in the existing Settings surface.** The single
  banner lands where the request can be answered; the coalesced banner lands on the only view that
  shows all of them. No per-project matrix — the same "one global number" instinct D-159 applied to
  the parallel cap.
  Rejected: always opening the fleet (one destination, nothing to branch on — but a single blocked
  agent then costs an extra hop to the thing the notification was about); and a per-project opt-out
  (useful if one repo runs noisy experimental agents — but it costs a settings row and a management
  surface for a need that has not appeared yet).

### The worktree inventory

- **D-177:** **Disk size is measured on demand and cached with a `measured_at` stamp, displayed with
  its age** ("1.4 GB · 4m ago"), with an explicit re-measure action. A recursive walk over a repo
  carrying `node_modules` and `target/` costs seconds, not milliseconds, so it never walks a
  filesystem nobody is looking at. Showing the figure **with its age** is the same honesty grammar
  **D-116** already established for ahead/behind counts labelled with their fetch age.
  Rejected: a fifth scheduled tick on the slowest tier walking a bounded round-robin set (sizes
  always warm when the view opens, reusing D-114's budget shape — but it spends disk I/O
  continuously for a view opened occasionally); and measuring fresh on every open with no cache
  (nothing stale to explain and no column to migrate — but twelve worktrees across four large repos
  means the view takes seconds to paint, and reopening pays again).
  — **Reversibility:** costly — the cache needs a new column or side table on `worktrees` plus a
  migration, so dropping it later is a second migration. The on-demand trigger itself is local.

- **D-178:** **Reclaimability is derived from facts already recorded; nothing ever writes
  `worktrees.status = 'stale'`.** A row is reclaimable when its task is Done or its branch is merged
  into the epic integration branch, **and** no run is live against it, **and** the worktree is clean
  by the porcelain read `worktree_remove` already demands. **Finding the planner must know:**
  `worktrees.status`'s CHECK constraint allows `stale` and `merged`, but **no code in the repository
  ever writes either** — only `active` and `missing`, both from `reconcile_worktrees`. WORK-07's
  "stale" therefore has no existing populator, and this decision declines to invent one.
  Rejected: finally giving the unused `stale` value a writer on the reconcile pass (the status
  column becomes the single queryable answer — but it is a stored judgement that can go wrong, and
  a reopened task leaves it wrong until something rewrites it); and an age-and-size heuristic
  independent of board state (catches worktrees the board has lost track of, which is the real disk
  problem — but it will propose reclaiming a long-running task the user is actively working on).

- **D-179:** **Reclaim is multi-select with one confirmation, looping the existing `worktree_remove`
  verb once per row.** The confirmation names the total bytes. Each per-row call keeps its **own
  server-side porcelain re-read and its own unconditional refusal on any uncommitted change** —
  the capability file's standing rule that "no parameter on this surface, at any layer, can skip
  that guard" is not weakened, because no new bypassing path is created. Results are reported per
  row, so one refusal does not fail the batch.
  Rejected: one-at-a-time through the existing per-task dialog (zero new removal code and the
  strongest guard story — but reclaiming six means six dialogs, and WORK-07's value is reclaiming
  the accumulation); and a single "reclaim everything reclaimable" action (fastest disk recovery —
  but there is no way to keep one of them, and a bulk delete with no selection step is the kind of
  action you only regret once).

- **D-180:** **A spend column on the fleet row, blank while running, plus a fleet total.** The
  session's cost and token figures appear once known and read **blank, never `$0.00`**, while the run
  is live — an honest absence rather than a wrong number. A footer totals what the visible fleet has
  spent. **This needs no adapter change:** the Claude Code adapter reports `total_cost_usd` and the
  usage block only at the terminal `result` event, which is also the moment the row enters
  `DONE / FAILED`, so the figure arrives exactly when the row can carry it.
  Rejected: wiring the `cost_update` event the adapter interface already declares so spend climbs
  live (watching money burn is the real supervision signal — but it needs a mid-stream usage source
  Claude Code does not expose today); and leaving cost only where it already is (AGNT-08 as written
  is satisfied by the existing session surface and Runs section — but roadmap criterion 5 names cost
  visibility as something the user must see).

- **D-181:** **Stay on the pinned `tauri = "=2.11.5"`; take `tauri-plugin-notification` 2.4.0, not
  2.6.0.** FLEET-05 and roadmap criterion 4 require only that the OS notification *fire* when an
  agent becomes blocked or completes; neither names click-through. 2.4.0 delivers that on the pinned
  Tauri. Owner decision, 2026-10-12, answering research Open Question 0.
  Rejected: bumping to Tauri 2.12.x for plugin 2.6.0's Rust-side `on_action` click handler — it is
  the only way to make a banner click jump to the agent's live output, and research dry-ran the bump
  clean (compiles, 103 desktop tests pass), but it buys an affordance no requirement asks for at the
  cost of re-exposing every Tauri surface to a minor-version change. **Click-to-jump from a
  notification is deferred to a board issue, not planned in this phase.** Any `on_action` /
  notification-click wiring in a plan for this phase is out of scope.

### Claude's Discretion

The following were deliberately not decided and are the builder's to choose, within the authoritative
UI contract:

- The **specific glyphs, colour tokens and band-header treatment** for the fleet's three bands, and
  where the fleet's global keyboard binding slots into 01-UI-SPEC's Keyboard Map. Must extend the
  existing map and the `agent`/`status` legend channels rather than fork them.
- The **coalescing window length** in D-175 (a few seconds; pick a value and pin it in a test).
- **Byte formatting** (GB vs GiB, precision) and the age-string format for D-177's `measured_at`.
- The fleet surface's and queue's **empty-state copy**, following the Copywriting Contract.
- Whether D-177's cache lives in a new `worktrees` column or a side table — either satisfies the
  decision; the migration cost is the same order.
- The **truncation width and tail-vs-head ellipsis** for D-167's one-line activity cell.

### Folded Todos

All three are folded into this phase's scope because the fleet surface makes each one's blast radius
larger than it was when filed. Each must appear in a plan with its own verification.

- **Timeout-boundary race misreports a child that just finished as `TimedOut`**
  (`.planning/todos/pending/2026-10-05-timeout-boundary-race-misreports-a-child-that-just-finished.md`,
  core, major). A run that has just finished can be recorded with the wrong terminal status. D-168
  derives every fleet row's state from `agent_runs.status`, so a wrong terminal status is now wrong
  on the new surface, in the `DONE / FAILED` band, and in a D-174 notification that tells the user a
  healthy run failed.

- **Adapter drops assistant text when a stream line carries text and `tool_use`**
  (`.planning/todos/pending/2026-09-24-adapter-drops-assistant-text-when-a-stream-line-carries-text.md`,
  general, major). `normaliseStreamLine` returns from the `tool_use` branch before the text branch
  is reached, silently discarding narration. D-167 makes the latest normalised feed row the fleet's
  activity cell, so this bug now degrades FLEET-01's "what each is doing" as well as the session
  feed it was filed against.

- **Forge resolution failures are not memoised, so they retry per worktree every tick**
  (`.planning/todos/pending/2026-10-05-forge-resolution-failures-are-not-cached-so-they-retry-per-worktree.md`,
  desktop, major). `forge_tick_targets` inserts into its `resolved` map only on success, so a
  project with a failing `forge_and_repo_path` re-attempts a bounded `git remote get-url origin`
  spawn per tracked worktree per tick, **while the DB lock is held**. Folded because this phase adds
  cross-project sweeps over the same worktree set and a worktree inventory that enumerates all of
  them; the existing per-tick cost is the floor every new sweep sits on top of.

</decisions>

<canonical_refs>
## Canonical References

**Downstream agents MUST read these before planning or implementing.**

### The authoritative UI contract

- `.planning/phases/08.1-visual-polish-brand-assets-and-confirmed-motion-inserted/08.1-UI-SPEC.md` —
  **read first; its `## SUPERSEDES` and `## AUTHORITATIVE` sections say which parts of the earlier
  UI-SPECs still bind.** Carries the "Mission Control" selected direction, the colour and token
  roles as shipped with measured contrast ratios, the control-boundary role, the brand rule (D-12:
  the brand carries progress, never current position), the selection 2px rule, the Overlay Rule, the
  Radius Language, Motion durations and the "never a fade" settlement, Row Anatomy Additions, and
  `## What this phase deliberately did not decide`.
- `.planning/phases/01-the-board-is-the-store-of-record/01-UI-SPEC.md` — the Surface Inventory a
  Fleet surface and a worktree inventory must join, the **exhaustive Keyboard Map** (including
  `## Global`) that new bindings must slot into, the State Inventory, the Performance Contract, the
  Spacing Scale and Accessibility rules (never colour alone).
- `.planning/phases/02-one-agent-one-worktree-watched-live/02-UI-SPEC.md` — `### Run Status` (the
  glyph + word + colour-role pairing per run status, under the `agent` legend channel);
  `### Permission-request card` including **Discretion #6's one-component-two-mount-points rule**,
  the three unequal-weight actions and the no-Escape rule D-173 inherits; `## Keyboard Map
  Additions`; `## Color Additions`; `## Copywriting Contract Additions`.
- `.planning/phases/03-nothing-lost-nothing-left-running/03-UI-SPEC.md` — how the `missing` worktree
  state and the `abandoned` run state joined that vocabulary rather than inventing a parallel one;
  the recovery-modal actions.

### Decisions this phase builds on and must not re-open

- `.planning/phases/01-the-board-is-the-store-of-record/01-CONTEXT.md` — **D-14** (one fleet-wide
  SQLite database in app-data holds every project, which is why cross-project reads are plain SQL
  and not an N-database fan-out — rated one-way); **D-04** (the Rust core pushes event-log deltas
  and the UI invalidates affected queries); **D-15** (the per-repo identity marker holds only id and
  key, never board content).
- `.planning/phases/02-one-agent-one-worktree-watched-live/02-CONTEXT.md` — **D-31**
  (`SessionSurface` was built as the real surface FLEET-03 jumps into, not a placeholder); **D-32**
  (structured feed, raw stream on demand); **D-37** (the per-project half of "what needs me?": a
  distinct blocked state on the task row plus a rail count — and the explicit statement that OS
  notifications were held back for this phase); **D-38** (allow-always is scoped per project, per
  tool).
- `.planning/phases/03-nothing-lost-nothing-left-running/03-CONTEXT.md` — **D-41** (the worktree
  removal verb D-179 loops, and its unconditional dirty-tree refusal); **D-46** (a "needs decision"
  count is never summed with the blocked count, because the two carry different urgency — the rule
  D-172 preserves); **D-45** (the missing-worktree recovery decisions).
- `.planning/phases/07-the-board-tells-the-git-truth/07-CONTEXT.md` — **D-113** (one periodic tick in
  the Rust core is the single mechanism, emitting into the same invalidation path); **D-114** (the
  tick is tiered, hot worktrees fast and cold slow, with a fixed per-tick budget); **D-116** (a
  figure is shown labelled with its age rather than pretended live — the precedent D-177 follows).
- `.planning/phases/09-planned-fan-out-that-does-not-collide/09-CONTEXT.md` — **D-159** (the parallel
  cap is one global number: concurrent agent sessions across every project — the precedent D-176
  follows for a fleet-wide control); **D-153** (a scope event appears in the live feed and on the
  board); **D-155** (waves auto-advance with a user-controlled pause).

### Scope, requirements and known defects

- `.planning/ROADMAP.md` § `### Phase 10` — the goal, the five success criteria, and the note that
  criterion 2 is what decides whether fleet supervision beats tab-cycling.
- `.planning/REQUIREMENTS.md` — FLEET-01 … FLEET-05, WORK-07, AGNT-08 verbatim.
- `.planning/WINDOWS.md` — read before touching `BoardView.tsx`; it records an open
  window-scoped-parent-picker defect.
- `packages/desktop/src-tauri/capabilities/default.json` — the default-deny boundary and the
  per-command audit roster. **D-175 keeps the window free of a notification grant, and D-165's
  change to `agent_run_acknowledge` must be reflected in that command's description here.**

</canonical_refs>

<code_context>
## Existing Code Insights

### Reusable Assets

- `packages/desktop/src/session/SessionSurface.tsx` — D-166's primary jump target; already renders
  the structured feed, the blocked state, cost and the stop verb. Already displays `tokensIn` via
  `latestNumericField`.
- `packages/desktop/src/session/PermissionRequestCard.tsx` — D-173 mounts this verbatim as its third
  instance. Designed to be mounted anywhere; both existing instances read/write the same row.
- `packages/desktop/src/session/FeedRow.tsx` — owns the normalised row kinds D-167's activity cell
  reuses (`assistant_text`, `tool_call`, `system_notice`, `scope_denied`, `git_retry`, `raw`).
- `packages/desktop/src/projects/ProjectRail.tsx` — holds the `rail-fleet` and `rail-review-queue`
  sections D-163 turns into entry points, plus the two deliberately-unmerged count badges (blocked,
  needs-decision) and the "only the current project carries it" scope a fleet view generalises.
- `packages/desktop/src/legend/marks.ts` + `Legend.tsx` — the `agent` and `status` channels D-169
  and D-170 draw from; `marks.ts` is where a fleet state's glyph/label/meaning belongs.
- `packages/core/src/query/permissions.rs` — `blocked_task_ids_for_project` /
  `blocked_count_for_project` are the per-project shape D-172's cross-project queue generalises.
- `packages/core/src/query/recovery.rs` — the existing `acknowledged_at IS NULL` idiom D-165 adopts.
- `packages/core/src/query/agent_runs.rs` — `cost_usd` / `tokens_in` / `tokens_out` already
  projected for the Runs section; the read D-180's spend column extends across projects.
- `packages/core/src/domain/worktree.rs` — `remove_worktree_for_task` (D-179's looped verb),
  `porcelain_entries` (D-178's clean check), `reconcile_worktrees`, `worktree_root`.
- `packages/desktop/src-tauri/src/scheduler.rs` — four existing ticks (`HOT_TICK_SECS`,
  `COLD_TICK_SECS`, `FETCH_INTERVAL_SECS`, `FORGE_POLL_SECS`, plus `DISPATCH_TICK_SECS`) and the
  single `emit_board_changed` site; also the home of the folded forge-memoisation defect.

### Established Patterns

- **Surfaces are pushed into and popped out of `App.tsx`**, triggered by a field on `useUiStore`;
  none is routed. D-163 follows this exactly.
- **`board:changed` is app-wide, not project-scoped** (`subscribeBoardChanged` in
  `adapters/tauri.ts` takes no project argument). This is what makes D-171 cheap.
- **Every Tauri command is read-only unless it must not be, resolves the actor server-side, and
  caps its window server-side**; the renderer never passes a path, ref, sha or actor. New
  cross-project reads must follow this, and the capability file's roster is updated with each.
- **Derive rather than store**, where the inputs already exist in the schema — the shape D-168 and
  D-178 both take, and the reason neither needs a migration.
- **Never colour alone**: every state is a glyph + word pairing registered in `marks.ts`.
- Tauri plugin surface is deliberately tiny (`shell` scoped to one named sidecar, `dialog:allow-open`
  only). D-175's `tauri-plugin-notification` is the third plugin and the first added since Phase 2 —
  it must be granted to the core, not the window.

### Integration Points

- `App.tsx` — mount the Fleet surface and the worktree inventory in the existing surface stack;
  `useUiStore` gains their trigger fields.
- `ProjectRail.tsx` — the `rail-fleet` and `rail-review-queue` rows become interactive.
- `state/keyboard.ts` + `menu.rs` — the fleet's global binding registers as an action id, reachable
  identically from keystroke, palette and native menu (never a broader capability per T-01-02).
- `packages/core/src/query/` — a new module for the cross-project fleet read, the blocked queue read
  and the worktree inventory read.
- `commands/` + `main.rs`'s `generate_handler!` list + `capabilities/default.json` — where the new
  read commands and the extended `agent_run_acknowledge` are exposed and documented.
- The run-status write sites in `packages/core/src/domain/agent_run.rs` — D-175's notification emit
  hangs off the same transition the status write performs.
- `settings_get` / a new settings setter — D-176's single notification toggle, alongside the existing
  `settings_set_dispatch_max_parallel` shape.

</code_context>

<specifics>
## Specific Ideas

Each decision above was chosen against a rendered layout sketch. The owner picked these shapes
specifically; treat them as the intended information architecture, not as illustrations.

- **Fleet row anatomy and banding** (D-164, D-167, D-169, D-180):

  ```
  FLEET                                   8 agents · 3 need you

  NEEDS YOU
    §  api  TASK-02  blocked          Bash: cargo test -p core      12m      —
    ⋯  cli  TASK-77  awaiting review  —                              —   $1.32
    ◌  web  TASK-31  abandoned        needs decision                 —      —
  RUNNING
    ●  web  TASK-14  running          Edit packages/core/git.rs       2m      —
    ●  api  TASK-08  running          Reading the migration to …     18m      —
  DONE / FAILED
    ✕  web  TASK-19  failed           —                              —   $0.84
    ⊘  api  TASK-05  interrupted      —                              —   $2.10
                                                                      ───────
                                                                      $4.26 this fleet
  ```

  Project is a column. Spend is blank while running, never `$0.00`. Band order is fixed.

- **The blocked queue answers in place** (D-172, D-173):

  ```
  BLOCKED QUEUE                                                              3

  ┃ §  api  TASK-02   Bash                                                 12m
  ┃    rm -rf target/
  ┃    destructive · filesystem
  ┃    [ Allow ]  [ Deny ]
  ┃    Allow this tool for this project from now on

  ┃ §  web  TASK-41   Write                                                 4m
  ┃    .env.local
  ┃    [ Allow ]  [ Deny ]
  ```

  The 4px left stripe is the existing "needs your attention" grammar. Answering here resolves the
  session's instance of the same row.

- **Worktree inventory with ages and a reclaim batch** (D-177, D-178, D-179):

  ```
  WORKTREES                                                                 12

   [✓] web  TASK-19   1.2 GB   4m ago   reclaimable · merged
   [✓] api  TASK-05   340 MB   4m ago   reclaimable · task done
   [✓] cli  TASK-77   890 MB   4m ago   reclaimable · merged
   [ ] web  TASK-14   1.4 GB   4m ago   in use · agent running
   [ ] api  TASK-02   340 MB   4m ago   in use · blocked
   [ ] cli  TASK-88   890 MB   4m ago   keep · uncommitted changes

    Reclaim 3 worktrees · 2.4 GB            [ Reclaim ]      [ Re-measure ]

  result
    ✓ web TASK-19  removed
    ✓ api TASK-05  removed
    ✕ cli TASK-77  refused — uncommitted change     (batch continues)
  ```

- **Notification copy and coalescing** (D-174, D-175, D-176):

  ```
  one transition                     several inside the window
  ┌─ Flywheel ───────────────┐      ┌─ Flywheel ───────────────┐
  │ api · TASK-02 is blocked │      │ 3 agents finished        │
  │ Bash: rm -rf target/     │      │ web · api · cli          │
  └──────────────────────────┘      └──────────────────────────┘
   click → that run's session         click → the fleet surface
  ```

- **Settings carries one switch, not a matrix** (D-176):

  ```
  Notifications
    [✓] Notify when an agent blocks, finishes or fails
  ```

</specifics>

<deferred>
## Deferred Ideas

- **Live mid-run cost streaming** — wire the `cost_update` event `packages/sidecar/src/adapter.ts`
  already declares so a running agent's spend climbs on the fleet. Declined in D-180 only because
  Claude Code reports totals at the terminal `result` event today; revisit when a mid-stream usage
  source exists, or when a second adapter provides one. The interface field is already there.
- **Per-project notification policy** — silencing one noisy repo. Declined in D-176 for want of a
  real need; it would be a settings row plus a management surface.
- **An idle-output timeout for a blocked session** — carried forward from Phase 3's deferred list,
  which noted it "pairs naturally with Phase 10's OS notifications … the right fix for 'the user is
  asleep' is probably to wake them, not to answer for them." D-174 now wakes them, so the timeout
  stays declined rather than becoming more attractive.
- **Age-and-size disk reclamation independent of board state** — the heuristic rejected in D-178.
  It is the right tool for worktrees the board has lost track of entirely, which D-178's derivation
  cannot see; revisit if orphaned directories turn out to be the real disk problem in practice.
- **Fleet-wide spend over time** — a cost history or budget view across projects and days. Beyond
  AGNT-08 and criterion 5, which ask only for per-session figures. Its own phase if wanted.
- **Scheduled automations** — still out of scope; `tokio-cron-scheduler` stays vendored with the
  cron-tick trigger type stubbed, per the standing architecture constraint.

### Reviewed Todos (not folded)

Seven of the ten keyword matches were reviewed and left out — each matched on generic keywords
("phase", "agent", "one", "live"), not on domain:

- **Socratic challenge should be structured like GSD's questioning** (authoring) — Phase 5 domain.
- **Handoff sheet drops questions the agent asked** (tooling) — GSD tooling, not product code.
- **Forge-sourced URLs reach an anchor href without scheme validation** (desktop) — a real security
  defect, but on the forge link path, untouched by this phase.
- **Live-chain tests inconsistently assert the fake CLI was actually reached** (core) — test
  hygiene.
- **Subprocess timeout guard leaks reader threads under a sustained forge outage** (core) — adjacent
  to the folded forge defect but a distinct fix; left for a forge-focused pass.
- **G-05-8 AskUserQuestion invisible and board unwritable in live run** (tooling) — authoring-run
  defect.
- **`git_identity` builds a table name into SQL with `format!`** (core) — crate convention, no fleet
  surface.

</deferred>

---

*Phase: 10-fleet-supervision-across-every-project*
*Context gathered: 2026-10-12*
