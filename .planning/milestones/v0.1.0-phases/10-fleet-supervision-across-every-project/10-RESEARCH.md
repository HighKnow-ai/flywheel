# Phase 10: Fleet Supervision Across Every Project - Research

**Researched:** 2026-10-12
**Domain:** Cross-project read aggregation (SQLite), OS notifications from a Tauri v2 Rust core, a shell surface stack in React, worktree disk accounting and batch reclaim
**Confidence:** HIGH on codebase facts (every load-bearing claim below was read in source this session); MEDIUM on the macOS notification click path (library source read, runtime behaviour not exercised)

<user_constraints>
## User Constraints (from CONTEXT.md)

### Locked Decisions

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

### Folded Todos (in scope, each needs its own plan task and verification)

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

### Deferred Ideas (OUT OF SCOPE)

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
</user_constraints>

<phase_requirements>
## Phase Requirements

| ID | Description | Research Support |
|----|-------------|------------------|
| FLEET-01 | User can see, in one view, every agent running across every registered project and what each is doing | One cross-project read (`query::fleet`), `fleet_state` derived in SQL (D-168); activity cell from a bounded log tail plus the already-exported `buildFeedRows` (Findings 2, 10; Pattern 1) |
| FLEET-02 | A dedicated queue shows every agent currently blocked and waiting on a human, across all projects | Cross-project pending-request read; per-run mount of the existing `PermissionRequestCard`; keyboard-ownership hazard in Finding 3 |
| FLEET-03 | User can jump from any fleet entry directly to that agent's live output and its board item | `setActiveAgentRunId(runId, taskId, authoringStage, epicId)` for the session; a pending-focus handoff for the board item because `BoardView` clears detail state on project change (Finding 9) |
| FLEET-04 | The fleet view distinguishes running, blocked, finished-awaiting-review, and failed states at a glance | Six states from existing `agent`-channel marks plus the `status`-channel In Review mark (D-169, D-170); no new run-status vocabulary (Finding 14) |
| FLEET-05 | The user receives an operating-system notification when an agent becomes blocked or completes | `tauri-plugin-notification` 2.6.0 called from the Rust core at the two existing transition handlers; window capability untouched (Finding 4, 5, 6) |
| WORK-07 | User can see all worktrees across all projects, their disk usage, and reclaim stale ones | Two-phase inventory read (board half under lock, git and disk half without), cached size columns in migration 0020, batch reclaim with server-side eligibility (Finding 7, 8) |
| AGNT-08 | The adapter reports token usage and cost per session | Already persisted since Phase 2 (G-02-4); this phase only surfaces it. `total_cost_usd` is an estimate, so label it (Finding 11) |
</phase_requirements>

## Summary

Phase 10 is a generalisation phase: almost every capability already exists in its per-project form (`blocked_count_for_project`, `recovery.rs`'s `acknowledged_at IS NULL` idiom, `PermissionRequestCard`, `SessionSurface`, `remove_worktree_for_task`, `merge::is_integrated`, the `{inputs, finish}` two-phase git read in `query::change_flags`). The work is a new `query/fleet.rs` read module, one migration, a notification emitter in the desktop crate, and three UI views mounted in the existing `App.tsx` surface stack. No new agent capability, no adapter change for cost.

The CONTEXT decisions are sound but contain **eleven gaps that will bite the executor** if the planner does not close them (next section). The three most expensive: (1) D-165's `acknowledged_at IS NULL` rule would put *every historical completed and failed run* on the fleet at first launch, because the column has been NULL for all of them since migration 0006; (2) the queue mounts N copies of a card whose `a`/`d` shortcuts are window-level listeners, so one keystroke would answer every blocked agent at once; (3) D-171's "re-run on `board:changed`" leaves the activity cell stale, since `board:changed` is not emitted per agent event.

The notification plan (D-175/D-176) is feasible but only on `tauri-plugin-notification` **2.6.0, published 2026-10-10**: earlier releases document the Actions API as mobile-only. 2.6.0 adds a Rust-side `Notification::on_action` that fires on a desktop click and carries our own `extra` payload back, so the window never needs a notification grant.

One decision needs the owner before the notification plan can start: plugin 2.6.0 requires Tauri 2.12 (the project pins 2.11.5). The bump was dry-run compiled and tested in a scratch copy and is clean; a fallback to plugin 2.4.0 keeps notifications and loses only the click-through (Open Question 0).

**Primary recommendation:** Build `query/fleet.rs` (fleet rows, blocked queue, worktree inventory inputs) as literal-SQL reads over existing tables; add migration `0020_fleet.sql` (backfill acknowledgement of historic terminal runs, two size-cache columns, one partial index); emit notifications from `handle_inbound_permission_request` and `handle_inbound_session_closed` through a pure, unit-testable coalescer; mount one `FleetSurface` (views: fleet, queue) plus a worktree inventory in `App.tsx` beneath the session surface in precedence.

## Findings That Change The Plan

Each is a fact about the current code that CONTEXT.md does not state, or states differently. Numbered so plans can cite them.

**Finding 1 — D-165 floods the fleet on first launch, and omits `interrupted`.**
`agent_runs.acknowledged_at` was added by migration 0006 as nullable with no default and has been written only by `agent_run_acknowledge`, which is gated to abandoned runs `[VERIFIED: packages/desktop/src-tauri/src/commands/agent_run.rs:1956 — "UPDATE agent_runs SET acknowledged_at = ?1 WHERE id = ?2 AND status = 'abandoned'"]`. Every completed, failed and interrupted run ever recorded therefore has `acknowledged_at IS NULL`. Applying D-165 literally lists all of them. Required: migration 0020 backfills `acknowledged_at = COALESCE(ended_at, started_at)` for `status IN ('completed','failed','interrupted')` rows that are NULL. Do **not** backfill `abandoned` (those still feed the rail's "Needs decision" count, `recovery.rs` arm 2). Also: D-165 names `completed`, `failed`, `abandoned` but the D-169 sketch shows an `interrupted` row in `DONE / FAILED`; extend the acknowledge clause and the fleet filter to `interrupted` too, or that row can never leave.

**Finding 1b — one task can own several unacknowledged terminal runs.** CTX-08 Discard and every `/clear` cycle ends a run and starts another on the same task. Without a rule, an old `completed` run keeps reading "awaiting review" beside the task's newer live run. Recommended rule: a terminal run appears on the fleet only if it is the task's most recent run (`ORDER BY started_at DESC, id DESC LIMIT 1`, the ordering `recovery.rs` already uses), except `abandoned`, which keeps `recovery.rs`'s any-unacknowledged rule so the rail count and the band agree. The rail's "Needs decision" count additionally includes missing worktrees and drift (arms 1 and 3 of `RECOVERY_TASK_IDS_SQL`), so it will not equal the NEEDS YOU band's abandoned rows; tests must not assert equality.

**Finding 2 — the activity cell is stale under D-171 as written.** `board:changed` is emitted on state transitions and git-digest changes, never per agent event; live output travels on the separate `agent:event` channel `[VERIFIED: packages/desktop/src-tauri/src/sidecar.rs:1842 — "let _ = app_for_reader.emit(\"agent:event\", &event);"]`. A running agent's latest tool call would not move on the fleet until something unrelated fires `board:changed`. Also, "latest normalised feed row" cannot come from SQL: the log is a JSONL file, and `session_log::read_window` calls `count_lines` first, which scans the whole file `[VERIFIED: packages/core/src/session_log.rs:185-190]`. Required: a new `session_log::read_tail(run_id, max_bytes, max_lines)` that seeks from EOF (live runs only), and a freshness mechanism. Least-deviating option that honours D-171's intent: keep the one fleet query keyed on `board:changed`, and add **one** app-level `agent:event` listener (not one per run) that trailing-edge-throttles an invalidation of that same key to about once per second. This is a tension with D-171's rejected "subscription per live run"; it is one listener doing invalidation only, no normaliser duplication. Surface this to the owner as a one-line confirmation, do not decide it silently (Open Question 1).

**Finding 3 — the queue as specified is a one-keystroke mass-approve.** `PermissionRequestCard` gates keyboard on `keyboardEnabled={index === 0}` *within the array a single card instance receives* `[VERIFIED: packages/desktop/src/session/PermissionRequestCard.tsx — "keyboardEnabled={index === 0}"]`, and each enabled row registers its own `window` keydown listener through `useRegionBindings("permission-card", "permission-card", {...})` with no deduplication `[VERIFIED: packages/desktop/src/state/keyboard.ts:783-803]`. Mounting one card per blocked run (the natural reading of D-173) makes N rows enabled; one `a` press calls `answer("allow")` on all N, across projects, including destructive requests. Required: add an optional `keyboardEnabled` prop to the card (default true, so the two existing mounts are unchanged) and have the queue pass `true` to exactly one request at a time (the first in queue order), plus a visible "current" mark. Pin with a test that one `a` keypress over three queued cards issues exactly one `agent_run_answer_permission` call. Note `AGNT-07`'s measured reality: a destructive Bash command is refused by the PreToolUse hook and does not raise a request at all `[CITED: .planning/DEFERRED-REVIEW.md D-REV-01]`, so the queue will mostly show routine requests; the destructive path stays defended anyway.

**Finding 4 — notification clicks work only on plugin >= 2.6.0.** The official docs page still says "The Actions API is only available on mobile platforms" `[CITED: https://v2.tauri.app/plugin/notification/]`. The 2.6.0 changelog (2026-10-10) adds "Report actions on desktop: a click on a notification (`tap`) or on one of the actions of its action type reaches `onAction`" `[CITED: https://raw.githubusercontent.com/tauri-apps/plugins-workspace/v2/plugins/notification/CHANGELOG.md]`. In the 2.6.0 crate source: `Notification::on_action<F: Fn(&ActionPerformed) + Send + Sync + 'static>(&self, handler: F) -> crate::Result<()>` pushes a Rust handler `[VERIFIED: ~/.cargo/registry/src/*/tauri-plugin-notification-2.6.0/src/desktop.rs:240-246]`; on macOS the click arrives as action id `"tap"` via `notify-rust`'s `wait_for_response`, and the dispatched payload is the whole serialized `NotificationData` (it includes `id` and the `extra` map `[VERIFIED: models.rs:219-239]`), readable as `performed.notification().extra()` `[VERIFIED: models.rs:384-386]`. So a click can carry `{ "runId": ..., "target": "run" | "fleet" }` back into Rust with no id bookkeeping. The handler must be registered **before** the first `show()`: "Notifications shown before the first handler or listener existed report nothing" `[VERIFIED: desktop.rs doc comment]`. Whether macOS 26 actually delivers the click is runtime behaviour this session could not exercise `[ASSUMED]`; see the deferred-register entry in Open Questions.

**Finding 4b — plugin 2.6.0 forces a Tauri minor bump (2.11.5 to 2.12.x).** crates.io lists 2.6.0's requirements as `tauri ^2.12` and `tauri-plugin ^2.7.1` `[VERIFIED: crates.io API /crates/tauri-plugin-notification/2.6.0/dependencies]`, while the project pins `tauri = "=2.11.5"` and `tauri-build = "=2.6.3"` `[VERIFIED: packages/desktop/src-tauri/Cargo.toml]` (Cargo.lock resolves `tauri-plugin` 2.6.3). Every release that carries the desktop click path (2.5.0, 2.5.1, 2.6.0) requires `tauri ^2.12`; 2.4.0 needs only `^2.10` but has no desktop click. Latest available: `tauri` 2.12.3 and `tauri-build` 2.7.2 (both 2026-10-10), `@tauri-apps/cli` 2.12.2, `@tauri-apps/api` 2.12.3 `[VERIFIED: crates.io API; npm view]`. **Dry run done this session** in a scratch copy of the workspace (no repo file was changed): with `tauri =2.12.3`, `tauri-build =2.7.2`, `tauri-plugin-notification =2.6.0` added under `[dependencies]`, `.plugin(tauri_plugin_notification::init())`, `app.notification().on_action(|performed| ...)` reading `performed.notification().and_then(|n| n.extra().get("target"))`, and a builder chain with two `.extra(..)` calls all compile with `cargo check -p desktop` (55 s cold, clean), and `cargo test -p desktop` ran 103 passed; the 2 failures were both the "run `npm --prefix packages/sidecar run build` first" guard, an artifact of the scratch copy omitting `packages/sidecar/dist`, not of the bump `[VERIFIED: cargo output this session]`. The JS side (`@tauri-apps/cli`, `@tauri-apps/api`) was not exercised; `.claude/CLAUDE.md` says to pin the Rust core and the CLI together. This is a stack change the owner should confirm (Open Question 0) because Phase 11 (signing, notarization, updater) builds on whatever Tauri line this lands on.

**Finding 5 — "the same site as the status write" is two desktop-crate functions, not the core domain.** `packages/core` has no `AppHandle`. The only production writers of the two notifiable transitions are `commands::agent_run::handle_inbound_permission_request` (outcome `PermissionRequestOutcome::Pending`, sets `blocked`) and `commands::agent_run::handle_inbound_session_closed` (outcome `SessionClosedOutcome::Closed(status)` carries `Completed`/`Failed`/`Interrupted`) `[VERIFIED: commands/agent_run.rs:1308-1366 and 1378-1402]`. `interrupt` (Stop) writes `interrupted` first, so the later `session_closed` returns `AlreadyTerminal` and never notifies; `mark_abandoned` runs at launch before any window exists. Both D-174 exclusions therefore fall out for free. Two traps: a run that is already `blocked` and receives a second concurrent pending request must **not** re-notify (read the run's status before processing, notify on the `running -> blocked` edge only); and a `Pending` outcome with no tool target must still produce a readable banner.

**Finding 6 — D-174's suppression needs a renderer-to-core report.** The core cannot know which surface is visible. Use the pattern `git_truth_focus_task` already established (one in-memory `AppState` field, no database, no filesystem) `[VERIFIED: packages/desktop/src-tauri/src/state.rs — "focused_task: Mutex<Option<String>>"]`: add `watched_run: Mutex<Option<String>>` and a tiny command the renderer calls whenever the *visible* session run changes. "Visible" is `activeAgentRunId` only when no higher-precedence surface (settings, triage, review) is on top. Window focus comes from `app.get_webview_window("main")` `[VERIFIED: capabilities/default.json — "windows": ["main"]]`.

**Finding 7 — D-179's "loop the existing verb" is unsafe as stated.** `worktree_remove` is a synchronous `#[tauri::command]` (main-thread) that takes the database mutex and runs `git status --porcelain` plus `git worktree remove` inside `remove_worktree_for_task` `[VERIFIED: commands/agent_run.rs:2073-2093; domain/worktree.rs:240-330]`; deleting a worktree holding `node_modules` and `target/` takes seconds. Eight in a row on the main thread with the lock held freezes the window and every other command. It also **does not check that no run is live** and does not check task state; the dirty-tree refusal is its only guard. A bulk UI with a stale selection could therefore remove a worktree an agent just started in. Required: one new `worktree_reclaim(task_ids)` command, `#[tauri::command(async)]` with `spawn_blocking`, that per row (a) re-derives eligibility server-side with the **same function the inventory read uses** (single definition, no live run is the non-negotiable clause), then (b) calls `remove_worktree_for_task` unchanged so its own porcelain re-read stays the final guard. Prefer splitting lock phases like `board_change_flags` does (read under lock, git without, re-lock to delete the row and append the event). A per-row refusal returns in the result list; it never aborts the batch. Also note `GIT_TIMEOUT_SECS = 120`: a removal killed at the ceiling leaves a half-deleted directory with a live row, which reads as dirty on the next attempt `[VERIFIED: packages/core/src/proc.rs:20]`.

**Finding 8 — the inventory covers task worktrees only.** `worktrees.task_id` is `UNIQUE NOT NULL` `[VERIFIED: 0003_agent_runtime.sql:49-58]`. Epic integration worktrees (`merge::epic_worktree_path`, used by merges and planning runs) are real directories under the same root but have no row, so a `worktrees`-derived inventory cannot list or size them. State this limit in the plan and the empty-state copy; it is the same blind spot D-178's rejected "age-and-size heuristic" would address, already in Deferred Ideas. Confirmed independently: nothing writes `worktrees.status = 'stale'` or `'merged'`; the only writers are `reconcile_worktrees` (`active`/`missing`, domain/worktree.rs:365) and `recreate_worktree_for_task` (`active`, :468) `[VERIFIED: grep over packages/core/src and packages/desktop/src-tauri/src]`. D-178's derivation reuses `merge::is_integrated(conn, repo_path, task_id, integration_branch)` (recorded event plus a live `merge-base --is-ancestor` check, and `false` when the commit no longer resolves) `[VERIFIED: packages/core/src/merge.rs:442-454]`. For a task with no epic there is no integration branch, so "task is Done" is the only clause.

**Finding 9 — the board-item jump is not just `setDetailItemId`.** `BoardView` runs an effect keyed on `[projectId]` that clears `selectedId`, `detailItemId` and `deleteTarget` `[VERIFIED: packages/desktop/src/board/BoardView.tsx:384-390]`, and `selectedItem` resolves only from `selectableItems`, i.e. the loaded window (default limit 200). The palette's git-identifier jump sets `setCurrentProjectId`, `setSelectedItemId`, `setDetailItemId` in one handler `[VERIFIED: board/CommandPalette.tsx:324-326]`, which the `[projectId]` effect immediately undoes whenever the target project differs from the current one. Required: a one-shot `pendingFocusItemId` in `useUiStore` that `BoardView` consumes once the item exists in its loaded rows (or, simpler, route the secondary target to the existing review/detail path that takes an id and label without the window, as the palette's second entry does with `setReviewSurface`). Whichever is chosen, the plan needs a tracer test that jumps from the fleet to a task in a *different* project and asserts the detail panel shows it. Epic-subject and fresh-epic authoring runs have no task: the secondary target is the epic detail or absent respectively.

**Finding 10 — runs without a task are first-class fleet rows.** `agent_runs.task_id` and `epic_id` are both nullable with `CHECK (NOT (task_id IS NOT NULL AND epic_id IS NOT NULL))` `[VERIFIED: 0010_authoring_runs.sql:62-81]`; authoring runs and planning runs carry an epic or nothing. `dispatch::occupied_slots` counts them as live (`status IN ('running', 'blocked')`, across every project) `[VERIFIED: packages/core/src/dispatch.rs:249-256]`, so the fleet must too or "8 agents" disagrees with Settings' "N of M slots in use". The fleet query must `LEFT JOIN tasks` and `LEFT JOIN epics`, return `subject_kind` (task, epic, authoring), `subject_key`, `authoring_stage`, `epic_id`, `task_id`, and the renderer passes all of them to `setActiveAgentRunId(agentRunId, taskId, authoringStage, epicId)` or `SessionSurface` will not mount the proposal tray.

**Finding 11 — AGNT-08 is already implemented; do not touch the adapter for cost.** The Claude Code adapter emits `totalCostUsd`, summed `inputTokens` and `outputTokens` on the terminal result, `apply_session_closed` persists them, and a figure that is absent stays NULL (never zero) `[VERIFIED: packages/core/src/domain/agent_run.rs:566-640; packages/sidecar/src/claude-code-adapter.ts:1062-1070]`. Two honesty points for the UI: `total_cost_usd` is a client-side estimate computed from a bundled price table, not billing data `[CITED: https://code.claude.com/docs/en/agent-sdk/cost-tracking]`, so label the fleet total as an estimate; and `tokens_in` is a **sum including cache reads** (G-02-4's measured decision), so a "tokens in" column will read very large against the plain input figure. Cost is present on error results too, so a failed run shows what it spent.

**Finding 12 — two of the three folded todos are narrower than CONTEXT describes.**
- *Timeout race*: the defect is in `proc::output_with_timeout` (`packages/core/src/proc.rs`), which wraps **git and forge subprocesses**, not agent-run terminal status. It does not make a healthy run read `failed`. Its real blast radius in this phase is the porcelain read and `git worktree remove` inside reclaim and the inventory, where a spurious `TimedOut` would refuse a reclaim or mislabel a row. Fix is one extra `try_wait()` before `kill()`; test with a child that exits at the deadline.
- *Adapter text-plus-tool_use*: `normaliseStreamEvent` returns exactly one `AgentEvent` per stream line and its `tool_use` branch returns before the text branch `[VERIFIED: claude-code-adapter.ts:961-1021]`. The todo's cited line range (589-612) is stale; the code is at roughly 955-1021. It is exported and unit-tested for the one-event contract (`test/adapter.test.mjs`), and has two call sites that each allocate `session.nextSeq++` per line (~1540, ~1557, ~1586). Fix by adding a sibling that returns an ordered list (narration before tool call, matching block order) and having both call sites allocate a `seq` per element, leaving `normaliseStreamEvent`'s single-event contract intact for existing tests. The spike recorded that the live binary splits blocks across lines, so this is latent, not active.
- *Forge memoisation*: `forge_tick_targets` inserts into `resolved` only in the `Ok` arm `[VERIFIED: scheduler.rs:338-372]`; change the map to hold the `Result` (or an `Option`) so a failing project is attempted once per tick. Log once per project per tick.

**Finding 13 — existing tests and registries that this phase will break unless updated.**
- `project-rail.test.tsx` source-scans `ProjectRail.tsx` and fails if the lowercase word "proposal" appears anywhere in it `[VERIFIED: projects/__tests__/project-rail.test.tsx:104-106]`. Keep that word out of every comment you add there.
- Tests `vi.mock("../../adapters/tauri", ...)` with a fixed export list; any new adapter function a rendered component imports must be added to those mocks or the import resolves to `undefined`.
- `core/tests/recovery_summary.rs` mirrors the acknowledge SQL literally in a fixture helper (`AND status = 'abandoned'`) `[VERIFIED: tests/recovery_summary.rs:35-37]`. Move the statement into one core function (`domain::agent_run::acknowledge_run`) used by the command and by tests so the two cannot drift.
- Any new CSS file with a `?raw` assertion must be added to `vitest.config.ts`'s `css.include`.
- `capabilities/default.json`'s `description` contains the per-command roster as prose and `generate_handler!` in `main.rs` is the real boundary; both need each new command, and `agent_run_acknowledge`'s sentence ("guarded to the abandoned status") must change. `gen/` is untracked, so no generated-schema diff is committed.
- Marks: "no mark may exist that the legend does not define". Worktree inventory chips (reclaimable, in use, keep) are new marks needed in `legend/marks.ts`; the `MarkChannel` union is closed, so reuse the `agent` channel (precedent: `worktree-missing`) unless the plan also edits `Legend.tsx`.

**Finding 14 — the run-status vocabulary is already copied twice.** `RunsSection.tsx` and `SessionSurface.tsx` each define their own `RunStatus`, label map, mark-id map and colour map; the second one lacks `abandoned` `[VERIFIED: item-detail/RunsSection.tsx:49-91; session/SessionSurface.tsx:59-92]`. D-167 says the fleet must not define a second vocabulary. Extract one module (e.g. `legend/runStatus.ts`) exporting the six-state type, labels, mark ids, colour roles, `formatElapsed` and `formatCostUsd`, import it from all three, and add the fleet's In Review mapping there. Without this the fleet is a third copy.

## Architectural Responsibility Map

| Capability | Primary Tier | Secondary Tier | Rationale |
|------------|-------------|----------------|-----------|
| Cross-project fleet rows, blocked queue, `fleet_state` derivation | Database / Storage (`packages/core/src/query/fleet.rs`) | API / Backend (Tauri command, DTO) | D-14 put every project in one SQLite file; D-168 forbids a stored state column; D-03's "the renderer never re-implements filter/sort" |
| Activity line per live run | API / Backend (`session_log::read_tail`) | Browser / Client (`buildFeedRows` normalises) | The log file is Rust-owned (D-34); the normaliser already lives in the renderer and must not be duplicated (D-167) |
| Elapsed times | Browser / Client | — | D-171: local interval, no IPC per second |
| Blocked queue answers | Browser / Client (existing card) | API / Backend (`agent_run_answer_permission`, unchanged) | D-173: no new verb |
| OS notification, coalescing, suppression decision | API / Backend (desktop crate Rust) | Browser / Client (reports visible run) | D-175: the renderer is never granted a notification capability |
| Notification click navigation | API / Backend (`on_action` handler, window focus) | Browser / Client (event listener, surface switch) | Handler runs in Rust; renderer only receives an app event |
| Worktree size measurement | API / Backend (blocking walk, off the lock) | Database (cache columns) | D-177; a recursive walk is seconds, never on the IPC thread or under the mutex |
| Reclaim eligibility and removal | API / Backend (core function) | Browser / Client (selection, confirmation) | Eligibility must be server-derived; the renderer's selection is advisory only |
| Notifications on/off switch | Database (`settings` row) | Browser / Client (Settings control) | D-176; read by the Rust emitter at fire time |
| Surface routing and keyboard | Browser / Client (`uiStore`, `keyboard.ts`) | Native menu (`menu.rs`) | Established pattern; menu forwards the same action id |

## Standard Stack

### Core

| Library | Version | Purpose | Why Standard |
|---------|---------|---------|--------------|
| `tauri-plugin-notification` (crate) | `=2.6.0` (published 2026-10-10; Rust MSRV 1.90) | OS notifications from the Rust core, with desktop click callback | The official Tauri v2 plugin; **2.6.0 is the first release whose changelog lists desktop click handling**. It requires `tauri ^2.12`, so the project's `=2.11.5` pin must move (Finding 4b) `[VERIFIED: crates.io API dependencies listing; cargo info tauri-plugin-notification@2.6.0]` |
| `tauri` / `tauri-build` (crates) | `=2.12.3` / `=2.7.2` | Required by the plugin; dry-run compiled and 103 desktop tests passed | Same exact-pin convention as today `[VERIFIED: scratch-copy cargo check/test this session]` |
| `@tauri-apps/cli` / `@tauri-apps/api` (npm, existing) | bump with the crates: `2.12.2` / `2.12.3` | Keep CLI and core on one minor line | `.claude/CLAUDE.md` Version Compatibility row; JS side not exercised this session `[ASSUMED]` |
| `rusqlite` | 0.40 (already in both crates) | Literal-SQL fleet, queue and inventory reads | Existing store of record; no new dependency |
| `@tanstack/react-query` | 5.102.8 (already installed) | Fleet, queue and inventory query cache | Existing pattern: invalidate on `subscribeBoardChanged` |
| `zustand` | 5.0.15 (already installed) | `useUiStore` trigger fields | Existing pattern |

### Supporting

| Library | Version | Purpose | When to Use |
|---------|---------|---------|-------------|
| `lucide-react` | 1.43.0 (already installed) | Glyphs, resolved by name from `marks.ts` | Any new mark |
| `std::fs` + `std::os::unix::fs::MetadataExt` | stdlib | Recursive allocated-size walk (`blocks() * 512`), `symlink_metadata`, no symlink following | Worktree size measurement. No new crate; about 20 lines. Ceiling: hard-linked trees (pnpm stores) double count. |

### Alternatives Considered

| Instead of | Could Use | Tradeoff |
|------------|-----------|----------|
| `tauri-plugin-notification` 2.6.0 | `tauri-plugin-notifications` (different crate, `0.5.0-rc.14`) or `user-notify` | Both are third-party; the official plugin now covers the need. Do not substitute. |
| `walkdir` / `fs_extra` for sizes | stdlib walk | A dependency for 20 lines; skip. |
| `du -sk` subprocess | stdlib walk | Spawns a process per worktree and parses text; the walk is simpler to bound and test. |

**Installation:**
```bash
# packages/desktop/src-tauri/Cargo.toml — put it under [dependencies], NOT at the end of the file
# (the file ends with [dev-dependencies]; a plain append lands there and the crate is then unresolved —
#  this exact mistake was made and caught in the dry run).
tauri       = { version = "=2.12.3", features = [] }      # was =2.11.5
tauri-build = { version = "=2.7.2",  features = [] }      # was =2.6.3  ([build-dependencies])
tauri-plugin-notification = "=2.6.0"                      # new
# packages/desktop: bump @tauri-apps/cli and @tauri-apps/api to the 2.12 line (no JS notification package)
```
No JavaScript notification package is needed or wanted: installing `@tauri-apps/plugin-notification` invites a renderer-side grant, which D-175 forbids. Register the plugin with `.plugin(tauri_plugin_notification::init())` in `main.rs` next to the dialog and shell plugins, and **do not** add any `notification:*` entry to `capabilities/default.json`.

**Version verification:** `cargo info tauri-plugin-notification@2.6.0` reports rust-version 1.90, license Apache-2.0 OR MIT; `rustc 1.98.1` is installed. crates.io lists versions 2.6.0 (2026-10-10), 2.5.1 (2026-10-01), 2.5.0 (2026-09-26), 2.4.0 (2026-08-31), 2.3.3 (2025-10-27) and `3.0.0-alpha.*`; do not use an alpha. Pin exactly, as the project already does for `tauri` and `tauri-build`, because this is a two-day-old release.

**Fallback if the owner declines the Tauri bump** (Open Question 0): stay on `tauri =2.11.5` and use `tauri-plugin-notification =2.4.0` (needs only `tauri ^2.10`, `tauri-plugin ^2.5`). Banners still fire from the Rust core and the window still has no grant; only the click-through of D-176 is lost (a click merely activates the app), because 2.4.0 has no desktop `on_action`. FLEET-05 and success criterion 4 do not depend on the click. A third option, calling `notify-rust` directly, re-implements the plugin and its macOS app-identity handling; it is the last resort, not a recommendation.

## Package Legitimacy Audit

| Package | Registry | Age | Downloads | Source Repo | Verdict | Disposition |
|---------|----------|-----|-----------|-------------|---------|-------------|
| `tauri-plugin-notification` | crates.io | created 2023-05-24 (3+ yrs); version 2.6.0 is 2 days old | 252,224/wk | github.com/tauri-apps/plugins-workspace | OK | Approved, pin `=2.6.0` (needs the Tauri 2.12 bump, Finding 4b) |
| `@tauri-apps/plugin-notification` | npm | 2.6.0 published 2026-10-10 | 697,838/wk | github.com/tauri-apps/plugins-workspace | SUS (`too-new`) | **Not installed.** Not needed; see Installation |

`gsd-tools query package-legitimacy check` was run for both `[VERIFIED: gsd-tools output this session]`. **Packages removed due to [SLOP] verdict:** none. **Packages flagged as suspicious [SUS]:** `@tauri-apps/plugin-notification`, and the recommendation is to not install it at all, so no `checkpoint:human-verify` is needed. The crate's own newest version being 2 days old is the reason for the exact pin; it comes from the official `tauri-apps` repository, and the package name was discovered in the official plugin docs, not via search results. The version-specific behaviour (desktop click) was verified by reading the downloaded 2.6.0 source, not just the changelog.

## Architecture Patterns

### System Architecture Diagram

```
 agent session (claude, sidecar) ──stdout JSONL──► sidecar.rs reader loop
        │                                              │
        │                       ┌──────────────────────┼───────────────────────────┐
        │                       ▼                      ▼                           ▼
        │              agent:event (app-wide)   permission_request         session_closed
        │                       │                      │                           │
        │                       │      handle_inbound_permission_request   handle_inbound_session_closed
        │                       │            (Pending, run was 'running')   (Closed(Completed|Failed))
        │                       │                      │                           │
        │                       │                      └──────────┬────────────────┘
        │                       │                                 ▼
        │                       │                    notify::Coalescer.push(transition)   ◄── settings: notifications_enabled
        │                       │                                 │ window elapsed                ◄── AppState.watched_run + window focus
        │                       │                                 ▼
        │                       │              suppress? ── yes ─► drop
        │                       │                                 │ no
        │                       │                                 ▼
        │                       │      app.notification().builder().extra(target).show()   (tauri-plugin-notification 2.6.0)
        │                       │                                 │ user clicks banner
        │                       │                                 ▼
        │                       │      on_action("tap") ─► show/focus "main" window ─► emit "fleet:navigate" {run | fleet}
        │                       │                                                                │
        ▼                       ▼                                                                ▼
   SQLite (one file, D-14) ◄── board:changed (state transitions, git digest) ──► React: useFleet() invalidates
        ▲                       │ (throttled ~1s, one listener)                                   │
        │                       └─────────────────────────────────────────────────────────────────┤
        │                                                                                         ▼
        │    query::fleet::fleet_rows ─► (lock released) ─► session_log::read_tail (live runs) ─► FleetDto
        │    query::fleet::blocked_queue                                                         │
        │    query::fleet::worktree_inventory_inputs ─► (lock released) ─► finish: is_integrated + porcelain + cached size
        │                                                                                         ▼
        └── worktree_reclaim(task_ids) ─► per row: re-derive eligibility ─► remove_worktree_for_task ─► board:changed
                                                                                    FleetSurface (fleet | queue) / WorktreeInventory
                                                                                    mounted in App.tsx beneath SessionSurface
```

### Recommended Project Structure

```
packages/core/src/
├── query/fleet.rs                 # fleet_rows, blocked_queue, worktree_inventory_inputs (+ finish_*) — literal SQL only
├── session_log.rs                 # + read_tail(run_id, max_bytes, max_lines)
├── domain/agent_run.rs            # + acknowledge_run (single statement, shared with tests)
├── domain/worktree.rs             # + reclaim_eligibility (the one definition) and reclaim_worktrees
├── domain/settings.rs             # + notifications_enabled / set_notifications_enabled
├── db/migrations/0020_fleet.sql   # backfill + size cache columns + partial index
└── proc.rs                        # try_wait before kill (folded todo)
packages/desktop/src-tauri/src/
├── notify.rs                      # pure Coalescer + target/summary builders; thin Tauri shell
├── commands/fleet.rs              # fleet_list, fleet_blocked_queue, fleet_watch_run, worktree_inventory,
│                                  #   worktree_measure, worktree_reclaim, settings_set_notifications_enabled
├── commands/agent_run.rs          # acknowledge widened; notify hooks in the two inbound handlers
└── scheduler.rs                   # forge memoisation (folded todo)
packages/desktop/src/
├── fleet/FleetSurface.tsx         # views: fleet | queue
├── fleet/BlockedQueue.tsx
├── fleet/WorktreeInventory.tsx
├── fleet/useFleet.ts              # query hooks, throttled agent:event invalidation
├── legend/runStatus.ts            # extracted six-state vocabulary (Finding 14)
└── state/uiStore.ts, keyboard.ts, App.tsx, projects/ProjectRail.tsx   # wiring
packages/sidecar/src/claude-code-adapter.ts   # text-plus-tool_use fix (folded todo)
```

### Pattern 1: Derive, do not store — the fleet read

**What:** One literal-SQL statement, no `format!`, `LEFT JOIN` for runs without a task, state computed by `CASE`, ordering by band then waiting time, capped server-side. Mirrors `query::permissions` and `query::recovery`.
**When to use:** `fleet_rows`, `blocked_queue`, `worktree_inventory_inputs`.
**Example (shape, not final SQL):**
```rust
// Source: pattern from packages/core/src/query/recovery.rs and permissions.rs (read this session).
const FLEET_SQL: &str = "SELECT ar.id, ar.project_id, p.name, p.key_prefix, \
    ar.task_id, t.key, t.title, t.status, ar.epic_id, e.key, ar.authoring_stage, \
    ar.status, ar.started_at, ar.ended_at, ar.cost_usd, ar.tokens_in, ar.tokens_out, \
    CASE \
      WHEN ar.status = 'completed' AND t.id IS NOT NULL AND t.status <> 'done' THEN 'awaiting_review' \
      ELSE ar.status END AS fleet_state, \
    (SELECT MIN(pr.created_at) FROM permission_requests pr \
       WHERE pr.agent_run_id = ar.id AND pr.status = 'pending') AS blocked_since \
  FROM agent_runs ar \
  JOIN projects p ON p.id = ar.project_id \
  LEFT JOIN tasks t ON t.id = ar.task_id \
  LEFT JOIN epics e ON e.id = ar.epic_id \
  WHERE ar.status IN ('running','blocked') \
     OR (ar.status IN ('completed','failed','interrupted','abandoned') AND ar.acknowledged_at IS NULL \
         AND (ar.status = 'abandoned' OR ar.task_id IS NULL OR ar.id = ( \
              SELECT ar2.id FROM agent_runs ar2 WHERE ar2.task_id = ar.task_id \
              ORDER BY ar2.started_at DESC, ar2.id DESC LIMIT 1))) \
  ORDER BY ... LIMIT ?1";
```
Band order (`NEEDS YOU` blocked, awaiting_review, abandoned; `RUNNING`; `DONE / FAILED`) and "longest waiting first" (ascending `blocked_since` / `ended_at` / `started_at`) belong in an `ORDER BY CASE`, so the renderer only groups. Return a `total_cost_usd` over the returned rows rather than summing in the renderer.

### Pattern 2: Two-phase git reads (board half under lock, git half without)

**What:** `query::change_flags::{change_flag_inputs, finish_change_flags}` is the template: the first takes `&Connection` and spawns nothing; the second takes no connection. Use it for the inventory (`worktree_inventory_inputs` then `finish_worktree_inventory`: `merge::is_integrated` and `porcelain_entries` only for rows that pass the board-state test and have no live run, so a dozen worktrees do not cost a dozen git spawns). Expose through `#[tauri::command(async)]` + `spawn_blocking` as `board_change_flags` does `[VERIFIED: commands/change_flags.rs:1-67]`.
**Size cache:** `ALTER TABLE worktrees ADD COLUMN size_bytes INTEGER` and `size_measured_at TEXT`, a plain `ADD COLUMN` like migration 0007, not a rebuild (a rebuild of `worktrees` forces the foreign-key dance 0006 documents). `worktree_measure(task_ids?)` walks off-lock then re-locks briefly to store. The renderer renders `"1.4 GB · 4m ago"` from `size_bytes` and `size_measured_at`; a NULL size renders blank, never `0 B`.

### Pattern 3: A pure coalescer with a thin async shell

**What:** `notify::Coalescer { window: Duration, pending: Vec<Transition> }` with `push(t, now: Instant)` and `take_due(now) -> Option<Banner>` where `Banner` is `Single { run_id, title, body }` or `Summary { count, projects, kind }`. The Tauri shell owns one `tokio` task that sleeps until the window closes and calls `take_due`. Unit tests drive `now` explicitly, so no `start_paused` runtime and no `tokio` `test-util` feature is needed (the desktop crate enables only `process, signal, rt-multi-thread, macros, time` `[VERIFIED: src-tauri/Cargo.toml]`). The suppression decision is a second pure function `should_suppress(transition, window_focused, watched_run)`. Window length is Claude's discretion (2 to 3 seconds); pin it as a named constant in a test. Trailing-edge means a lone blocked banner is delayed by one window; accept it.
Click routing: register `app.notification().on_action(...)` once in `.setup()` before any `show()`; the handler reads `performed.notification().map(|n| n.extra())` for `target`/`runId`, shows and focuses the `main` window, then `app.emit("fleet:navigate", ...)`. A missing or unreadable `extra` degrades to opening the fleet.

### Pattern 4: Surfaces are pushed into `App.tsx` by a `useUiStore` field

**What:** Add `fleetSurface: null | { view: "fleet" | "queue" }` and `worktreeInventoryOpen: boolean`. In the `App.tsx` precedence chain place the fleet **below** `activeAgentRunId`: settings, triage, review, session, **fleet / inventory**, unreachable, board. Then opening a run from the fleet only sets `activeAgentRunId`, and the session's existing "← Board" (`setActiveAgentRunId(null)`) lands back on the fleet, which is what queue-draining needs. The triage surface instead clears itself before opening a session `[VERIFIED: App.tsx:296-300]`; do not copy that here. One consequence to handle: any other code that calls `setActiveAgentRunId(null)` while the fleet is open will reveal the fleet; that is intended.
Keyboard: add `open-fleet` to `ActionId`, a `global` binding in `BINDINGS`, `MENU_ACTION_IDS` in `keyboard.ts`, `FORWARDED_MENU_ACTIONS` in `main.rs`, `MenuHandles` in `state.rs`, and an item in `menu.rs` (the four-file mirror). Add region `fleet-surface` and layer `fleet-surface` with their allow-lists the way `triage-surface` and `review-surface` were added. A `⌘⇧F` accelerator is unused today `[ASSUMED]` (checked against the `BINDINGS` table and `menu.rs` by reading; a uniqueness test in `keyboard` tests should assert it). Avoid `a`, `d`, `Shift+A` inside the fleet region (the card owns them).

### Anti-Patterns to Avoid

- **Mounting one card per blocked run with defaults** — mass-approve (Finding 3).
- **Summing or filtering the fleet in the renderer** — D-03; compute the band, order and total in SQL.
- **Walking the filesystem inside a Tauri sync command or under `state.db`** — the scheduler comment block documents the single-mutex hazard `[VERIFIED: scheduler.rs header lines 19-27]`.
- **A `fleet_state` column or a writer for `worktrees.status = 'stale'`** — D-168 and D-178 decline both.
- **A second `RunStatus` vocabulary** — Finding 14.
- **Granting the window `notification:default`** — it lists `allow-notify`, `allow-register-listener`, and others, i.e. everything D-175 forbids `[CITED: https://v2.tauri.app/plugin/notification/]`.
- **Using `format!` for SQL in `query/`** — the crate's tests grep-gate for it `[VERIFIED: query/mod.rs header]`; literal strings or the module's `format_sql(&[..])` concatenation of literals only.

## Don't Hand-Roll

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| "Awaiting review" glyph, label, colour | A seventh `agent` mark | `status-in-review` (`CircleEllipsis`) as D-170 says | The legend gains no entry to explain |
| Run status label/mark/colour maps | A third copy | One extracted `legend/runStatus.ts` | Finding 14 |
| "What the agent is doing" | A fleet-specific activity vocabulary | `buildFeedRows` (already exported from `SessionSurface.tsx`) over the tail entries, then `toolCallTarget` from `FeedRow.tsx` | D-167 |
| Elapsed and cost formatting | New formatters | Move `formatElapsed`, `formatCostUsd`, `formatCount` out of `SessionSurface.tsx` | They are file-local today |
| Merged-into-integration test | `git branch --merged` parsing | `merge::is_integrated` | Handles the zero-commit-branch trap and rewritten history |
| Dirty-tree check | A new `git status` call | `domain::worktree::porcelain_entries` | WORK-03's one-porcelain-read-site contract |
| Worktree removal | Direct `git worktree remove` | `remove_worktree_for_task` | Row deletion, `agent_runs.worktree_id` decoupling and the event are inside it |
| Cross-project permission answer | A new answer verb | `agent_run_answer_permission` | D-173 |
| Settings storage | A new table | `settings` key/value via `upsert_setting`/`read_setting` | Precedent: `dispatch_max_parallel` |
| Window-focus tracking | A renderer focus listener reporting up | `WebviewWindow::is_focused()` in Rust at fire time | One source of truth, no race with the report |
| Notification batching | Per-transition `show()` with a debounce in JS | The pure `Coalescer` above | Phase 9 fans out to 8; also bounds the macOS thread-per-notification cost |

**Key insight:** every hard part of this phase already exists in its single-project form and carries a documented invariant (lock discipline, one porcelain site, one removal verb, one card, one normaliser). The failures to avoid are all "generalised it by copying" failures; each Finding above is one place where copying breaks an invariant.

## Runtime State Inventory

Not a rename or migration phase. One data migration is included (Finding 1), so the five categories are answered for completeness:

| Category | Items Found | Action Required |
|----------|-------------|------------------|
| Stored data | `agent_runs.acknowledged_at` is NULL for every historic terminal run; `worktrees` has no size columns | Migration 0020: backfill (data migration) and `ADD COLUMN` x2 (schema) |
| Live service config | None — no external service holds a name this phase changes | None — verified by reading the phase scope |
| OS-registered state | macOS Notification Center will register the app on the first banner; in `tauri dev` the banner is attributed to Terminal (`com.apple.Terminal`) `[CITED: plugin desktop.rs excerpt via WebFetch]` | None in code; note for verification |
| Secrets/env vars | None | None |
| Build artifacts | The sidecar is bundled as `binaries/flywheel-sidecar`; the adapter fix (folded todo) requires rebuilding it for the packaged app | Rebuild sidecar when the adapter changes |

## Common Pitfalls

### Pitfall 1: The first-launch flood
**What goes wrong:** Fleet opens with hundreds of "awaiting review" rows. **Why:** Finding 1. **Avoid:** migration backfill plus the latest-run-per-task rule; seed a fixture with 500 historic terminal runs and assert the fleet returns only the live and the genuinely unacknowledged. **Warning sign:** the fleet's count differs from the number of running agents on a fresh install.

### Pitfall 2: A stale selection removes a live worktree
**What goes wrong:** User selects three "reclaimable" rows, an agent starts on one, reclaim deletes its directory. **Avoid:** Finding 7's server-side re-derivation; test with a run inserted between read and reclaim.

### Pitfall 3: Notification storm from re-blocking
**What goes wrong:** An agent that asks for permission eleven times in a session fires eleven banners; a run already `blocked` fires again for a second concurrent request. **Avoid:** notify on the status edge, coalesce, and keep the per-run key in the coalescer so identical `(run, kind)` inside the window collapse.

### Pitfall 4: Secrets in banners
**What goes wrong:** The banner body mirrors the tool input (`Bash: curl -H "Authorization: ..."`); Notification Center persists it and shows it on a locked or shared screen. **Avoid:** body is tool name plus a length-capped target, never the full payload; the Settings switch is the user's control. The D-176 sketch shows `rm -rf target/`; keep to that scale. `[ASSUMED: macOS Notification Center retention and lock-screen display behaviour]`

### Pitfall 5: macOS thread-per-notification
**What goes wrong:** With a click handler registered, each macOS banner parks a thread in `wait_for_response` until the user acts on it or it goes away `[VERIFIED: desktop.rs wait()]`. A never-clicked banner may hold its thread indefinitely `[ASSUMED]`. **Avoid:** coalescing keeps the count low; add a counter in the shell and log if it grows past a small bound.

### Pitfall 6: Dev-mode notifications look wrong
**What goes wrong:** Under `tauri dev` the banner is attributed to Terminal and may need Terminal's notification permission. **Avoid:** do not treat a dev-mode miss as a defect; the click-through check belongs against an installed build (Phase 11) and goes in the deferred register.

### Pitfall 7: Opening a terminal run's session shows "Running"
**What goes wrong:** `SessionSurface` defaults `initialStatus = "running"`, and its local `RunStatus` has no `abandoned`. **Avoid:** pass the mapped status for terminal rows, and widen the type via the extracted module (Finding 14); for an abandoned run the session surface needs an explicit mapping decision.

### Pitfall 8: A walk that follows symlinks or hard links
**What goes wrong:** A `node_modules/.bin` symlink loop or a pnpm store inflates or hangs the measurement. **Avoid:** `symlink_metadata`, never follow links, count `blocks() * 512`, bound depth and entries, and document the hard-link double count as the known ceiling.

### Pitfall 9: Unreachable project in the inventory
**What goes wrong:** `projects.status = 'unreachable'` makes every git call for its worktrees fail. **Avoid:** label such rows "keep · project unreachable" and never offer them for reclaim.

## Code Examples

### Reading a notification click back into Rust
```rust
// Source: tauri-plugin-notification 2.6.0 src/desktop.rs:240-246 and src/models.rs:339-386 (read this session)
use tauri_plugin_notification::NotificationExt;

app.notification().on_action(move |performed| {
    // action_id() == "tap" for a banner click
    let target = performed
        .notification()
        .and_then(|n| n.extra().get("target").and_then(|v| v.as_str()).map(str::to_owned));
    let run_id = performed
        .notification()
        .and_then(|n| n.extra().get("runId").and_then(|v| v.as_str()).map(str::to_owned));
    // show + focus the "main" window, then emit "fleet:navigate" { target, runId }
})?;

app.notification()
    .builder()
    .title("api · TASK-02 is blocked")
    .body("Bash: cargo test -p core")
    .extra("target", "run")
    .extra("runId", run_id)
    .show()?;
```

### Server-side reclaim loop shape
```rust
// Source: shape of commands/change_flags.rs (lock-safe split) + domain/worktree.rs::remove_worktree_for_task
#[tauri::command(async)]
pub async fn worktree_reclaim(state: State<'_, AppState>, app: AppHandle, task_ids: Vec<String>)
    -> Result<Vec<ReclaimResultDto>, String> {
    // cap task_ids (e.g. 50) server-side; resolve the actor server-side; per id:
    //   1. reclaim_eligibility(&conn, id)  -> Err(reason) is returned per row, batch continues
    //   2. remove_worktree_for_task(&mut conn, id, &actor)  (its own porcelain re-read is the final guard)
    // run the loop on spawn_blocking; emit board:changed once at the end
}
```

### Pinning one keystroke to one answer
```tsx
// Source: PermissionRequestCard.tsx keyboardEnabled={index === 0}; the queue passes its own flag.
<PermissionRequestCard variant="feed" requests={pending} onAnswer={onAnswer}
  keyboardEnabled={queueIndex === 0} />   // new optional prop, default true keeps the two existing mounts unchanged
```

## State of the Art

| Old Approach | Current Approach | When Changed | Impact |
|--------------|------------------|--------------|--------|
| `tauri-plugin-notification` desktop = fire-and-forget; Actions mobile-only | `Notification::on_action` fires on desktop (`tap`) | 2.6.0, 2026-10-10 | D-176's click-through is implementable in Rust; official docs page lags |
| Worktree `status` column as stale marker | Derived reclaimability | D-178 | No writer to build |

**Deprecated/outdated:** the docs-page statement "Actions API is only available on mobile platforms" is now out of date for the *Rust* desktop path in 2.6.0; the JS `onAction` path on desktop is not used here.

## Assumptions Log

| # | Claim | Section | Risk if Wrong |
|---|-------|---------|---------------|
| A1 | macOS 26 delivers the banner click to `notify-rust`'s `wait_for_response` so `on_action` fires | Finding 4 | Click-through silently does nothing. Criterion 4 (receive a notification) still holds; D-176's routing degrades to "open the app" |
| A2 | A never-clicked macOS banner holds its `wait` thread for a long time | Pitfall 5 | Thread count grows; mitigated by coalescing and a logged counter |
| A3 | Notification Center retains and displays banner text on lock screens | Pitfall 4 | Over-cautious truncation; low |
| A4 | `⌘⇧F` is unused by the BINDINGS table, `menu.rs` and WKWebView | Pattern 4 | Rebind; a uniqueness test catches it |
| A5 | A log line larger than the tail window (a huge `tool_result`) makes the activity cell blank | Finding 2 | Cell shows `—` for that run until a smaller line lands; widen the window to about 256 KiB if seen |
| A6 | The first banner on a bundled app may need the user to allow notifications in System Settings; the plugin reports `Granted` without asking on desktop `[CITED: docs.rs Notification::permission_state]` | Environment | Banners never appear; no in-app signal exists |
| A7 | Reclaim timing for a large `node_modules` worktree stays under the 120 s git ceiling | Finding 7 | A killed removal leaves a half-deleted tree; report as refused with the reason |

## Open Questions

0. **Does the owner accept bumping Tauri from 2.11.5 to 2.12.x so notification clicks work? (`checkpoint:decision`, gates the plan that adds the plugin.)**
   - Known: plugin 2.6.0 (the only line with desktop click handling) requires `tauri ^2.12` (Finding 4b); the bump compiled and 103 desktop tests passed in a scratch dry run; the CLI/API npm packages were not exercised.
   - Unclear: appetite for a Tauri minor bump immediately before Phase 11's signing, notarization and updater work.
   - Recommendation: take the bump, as the first plan of the phase and gated by the existing suites (`cargo test -p core`, `cargo test -p desktop`, `cd packages/desktop && npm test`, `npm run build`). If any gate is red and not trivially fixable, fall back to plugin 2.4.0 on 2.11.5 and drop only the click-through (see the fallback paragraph in Standard Stack). Either way D-175's emitter, coalescing and default-deny window are unchanged.

1. **Does the owner accept one throttled `agent:event` listener beside D-171's `board:changed` re-run?**
   - Known: without it the activity cell is stale (Finding 2); D-171 rejected per-run subscriptions, not a single invalidating listener.
   - Unclear: whether "one read path" was meant to also mean "one trigger".
   - Recommendation: build it as described and record it as a one-line deviation in the plan. If refused, the activity cell becomes "as of the last state change" and must show its age, following D-116's grammar.

2. **What does "acted on" mean for D-165's acknowledgement?**
   - Known: the column and one-clause SQL change are specified; no UI trigger is.
   - Recommendation: an explicit per-row "Dismiss" (Enter on the row opens; a distinct key dismisses), plus one "Dismiss finished" action on the `DONE / FAILED` band header. Do not auto-acknowledge on opening the session. Also decide if moving the task to Done should clear an awaiting-review row (recommended: no; the row simply re-reads as plain completed).

3. **Structure of the three views.** Recommendation: one `FleetSurface` with a `view` discriminator (fleet, queue) and the worktree inventory as its own field, rather than three top-level surfaces. Rail rows: Fleet opens `fleet`, Blocked opens `queue`, Worktrees opens the inventory, "Needs decision" opens `fleet` (its NEEDS YOU band). The rail's Fleet counts should become fleet-wide from the same cached query (the rail's doc comment says current-project-only today and must be updated).

4. **Deferred-register items (physical reasons only).** Banner click-through on an installed build; first-run macOS notification permission. Everything else here is automatable: the coalescer, suppression, routing function, SQL, reclaim, keyboard and rendering are unit, integration and WebKit browser tests. Per the project rule, register these two in `.planning/DEFERRED-REVIEW.md` with `automatable: NO` and a physical reason, and emit no `checkpoint:human-verify`.

5. **Epic integration worktrees** are invisible to the inventory (Finding 8). Confirm the v1 inventory is task worktrees only.

## Environment Availability

| Dependency | Required By | Available | Version | Fallback |
|------------|------------|-----------|---------|----------|
| Rust toolchain | core and desktop crates | ✓ | rustc 1.98.1, cargo 1.98.1 (plugin MSRV 1.90) | — |
| Node.js / npm | desktop tests, sidecar | ✓ | v24.21.0 / 11.19.0 | — |
| git | worktree and merge reads | ✓ | 2.54.0 | — |
| macOS | notification banners, WebKit | ✓ | 26.6.2 | — |
| Playwright WebKit | `test:browser` arms | ✓ | `webkit-2359` in `~/Library/Caches/ms-playwright` | jsdom arm only for non-layout checks |
| crates.io access | add the plugin | ✓ | index reachable this session | — |
| Installed (bundled) build | banner click-through | ✗ | — | Deferred register (Open Question 4) |

**Missing dependencies with no fallback:** none for planning or execution.
**Missing dependencies with fallback:** an installed build is a Phase 11 artifact; click-through is registered, not blocked.

## Validation Architecture

### Test Framework

| Property | Value |
|----------|-------|
| Framework | `cargo test` (core integration tests in `packages/core/tests`, in-file unit tests in `packages/desktop/src-tauri`); `vitest` 5.0.0 + jsdom + Testing Library for the renderer; `vitest` browser arm (Playwright WebKit) for layout and contrast; `node --test` for the sidecar |
| Config file | `packages/desktop/vitest.config.ts` (`css.include` list), `vitest.browser*.config.ts`, `packages/sidecar/package.json` |
| Quick run command | `cargo test -p core --test fleet_query` · `cd packages/desktop && npx vitest run src/fleet` |
| Full suite command | `cargo test -p core && cargo test -p desktop` · `cd packages/desktop && npm test` · `cd packages/sidecar && npm run build && node --test test/adapter.test.mjs` (the full sidecar suite drives the real `claude` binary and spends API budget, so run it targeted) |

`cargo test -p core --test recovery_summary` was run this session: 7 passed, about 16 s including build. `npx vitest run src/projects` ran: 11 passed in 1.5 s.

### Phase Requirements → Test Map

| Req ID | Behavior | Test Type | Automated Command | File Exists? |
|--------|----------|-----------|-------------------|-------------|
| FLEET-01 | Fleet lists live runs of every project incl. authoring/planning (no task), ordered by band | integration | `cargo test -p core --test fleet_query` | ❌ Wave 0 |
| FLEET-01 | Historic terminal runs do not appear after migration 0020; only latest run per task | integration | `cargo test -p core --test fleet_query -- backfill` | ❌ Wave 0 |
| FLEET-01 | Read stays under 50 ms at 5,000 runs and uses the partial index | integration | `cargo test -p core --test fleet_perf -- --nocapture` | ❌ Wave 0 |
| FLEET-01 | `read_tail` returns the last complete lines, ignores a partial final line, missing file, oversize line | unit | `cargo test -p core session_log` | ❌ Wave 0 |
| FLEET-02 | Queue lists runs with a pending request across projects; second pending on one run is one entry | integration | `cargo test -p core --test fleet_query -- queue` | ❌ Wave 0 |
| FLEET-02 | One `a` keypress over N queued cards answers exactly one request | component | `npx vitest run src/fleet/__tests__/blocked-queue.test.tsx` | ❌ Wave 0 |
| FLEET-03 | Row Enter opens that run's session with taskId/stage/epicId; secondary key opens the board item in another project | component | `npx vitest run src/fleet/__tests__/jump.test.tsx` | ❌ Wave 0 |
| FLEET-04 | Six states render glyph + word; awaiting review uses the In Review mark; interrupted muted | component | `npx vitest run src/fleet/__tests__/states.test.tsx` and `src/legend` | ❌ Wave 0 |
| FLEET-05 | Coalescer: one transition -> single banner; N in window -> one summary; window pinned | unit | `cargo test -p desktop notify::` | ❌ Wave 0 |
| FLEET-05 | Suppress only when focused and that run visible; interrupted/abandoned never notify; already-blocked run does not re-notify | unit | `cargo test -p desktop notify::` | ❌ Wave 0 |
| FLEET-05 | Capability file has no `notification:` grant; plugin registered | unit | `cargo test -p desktop capabilities` (read the JSON, assert absence) | ❌ Wave 0 |
| FLEET-05 | Click routing: `extra` -> run or fleet target; missing `extra` -> fleet | unit | `cargo test -p desktop notify::route` | ❌ Wave 0 |
| WORK-07 | Reclaimability derivation: done, integrated, no live run, clean; live run and dirty refused | integration | `cargo test -p core --test worktree_inventory` | ❌ Wave 0 |
| WORK-07 | Batch reclaim re-derives per row, continues after a refusal, reports per row | integration | `cargo test -p core --test worktree_reclaim` | ❌ Wave 0 |
| WORK-07 | Size walk: sums allocated bytes, ignores symlinks, NULL until measured | unit | `cargo test -p core worktree_size` | ❌ Wave 0 |
| AGNT-08 | Fleet row carries cost/tokens from the terminal result; blank (null) while running; failed run keeps its spend | integration | `cargo test -p core --test fleet_query -- spend` | ❌ Wave 0 |
| Folded | `output_with_timeout` returns the real status for a child exiting at the deadline | unit | `cargo test -p core proc::` | ❌ Wave 0 |
| Folded | Text + tool_use on one stream line yields both events in order | sidecar | `cd packages/sidecar && npm run build && node --test test/adapter.test.mjs` | ✅ extend |
| Folded | A failing forge resolution is attempted once per tick | unit | `cargo test -p desktop scheduler::` | ✅ extend |
| Cross-cut | Migration 0020 applies on the N-1 fixture and keeps integrity | integration | `cargo test -p core --test migration_safety` | ✅ auto-covers |
| Cross-cut | Tauri 2.12 bump leaves existing suites green and the app builds | build + unit | `cargo test -p desktop` · `cd packages/desktop && npm test && npm run build` | ✅ existing |
| Cross-cut | Rail rows are buttons; the "proposal" source scan still passes | component | `npx vitest run src/projects` | ✅ update |

### Sampling Rate
- **Per task commit:** the relevant quick command above.
- **Per wave merge:** `cargo test -p core`, `cargo test -p desktop`, `cd packages/desktop && npm test`.
- **Phase gate:** full suite green, plus `npm run test:browser` for the fleet legibility file, before the phase closes on its ROADMAP criteria (per `.claude/CLAUDE.md`, no `verify-work` round).

### Wave 0 Gaps
- [ ] `packages/core/tests/fleet_query.rs`, `fleet_perf.rs`, `worktree_inventory.rs`, `worktree_reclaim.rs` — reuse `common::seeded_git_project` and the `with_scratch_worktree_root` env-lock pattern from `recovery_summary.rs`
- [ ] `packages/desktop/src-tauri/src/notify.rs` unit module and a capability-file assertion test
- [ ] `packages/desktop/src/fleet/__tests__/*.test.tsx`; add every new adapter export to each test's `vi.mock("../../adapters/tauri")` factory
- [ ] `vitest.config.ts` `css.include` entry for any new stylesheet with a `?raw` assertion
- [ ] No new framework install is needed

## Security Domain

`security_enforcement` is enabled (ASVS level 1).

### Applicable ASVS Categories

| ASVS Category | Applies | Standard Control |
|---------------|---------|-----------------|
| V2 Authentication | no | Local desktop; credentials unchanged |
| V3 Session Management | no | — |
| V4 Access Control | yes | Tauri default-deny: no `notification:` grant in `capabilities/default.json`; every new command is listed in `generate_handler!` and the roster; actor resolved server-side, never passed by the renderer |
| V5 Input Validation | yes | New commands accept ids only (no path, ref, sha, actor); `task_ids` capped server-side; unknown ids refused per row; literal SQL via `params![]` |
| V6 Cryptography | no | — |
| V8 Data Protection | yes | Banner text length-capped and limited to tool name plus target; Settings switch |
| V12 Files | yes | Size walk uses `symlink_metadata`, never follows links, reads only paths from `worktrees.path` under the worktree root; removal keeps the adjacency refusals in `git::worktree_remove` |

### Known Threat Patterns for this stack

| Pattern | STRIDE | Standard Mitigation |
|---------|--------|---------------------|
| One keystroke approves every queued request | Elevation of privilege | Single keyboard-owning card (Finding 3) and a one-call-per-keypress test |
| Stale selection deletes a live worktree | Tampering | Server-side per-row eligibility including "no live run" (Finding 7) |
| Renderer supplies a path/sha to a reclaim or measure command | Tampering | Ids only; all paths derived from `worktrees` rows in the core |
| Notification grant given to the webview | Elevation of privilege | Keep `capabilities/default.json` free of `notification:*`; assert it in a test |
| Secrets echoed into banners | Information disclosure | Cap and limit banner content |
| Symlink in a worktree makes the size walk escape the tree | Information disclosure / DoS | `symlink_metadata`, no follow, entry and depth bound |
| Destructive command answered blind | Elevation of privilege | Existing destructive variant keeps Deny as the lead action; Phase 12 gate untouched |

## Project Constraints (from CLAUDE.md)

Source: `.claude/CLAUDE.md` (read this session).
- Desktop shell is Tauri v2 with a Rust core; SQLite via `rusqlite` is the store of record; the Node sidecar is not allowed to open the database. All new reads and writes live in the Rust core.
- Isolate every Tauri-specific call behind `adapters/tauri.ts`; keep UI state (`zustand`) separate from server state (`@tanstack/react-query`). New hooks follow that split.
- Architecture must not foreclose scheduled automations, the relay, or additional backends: no Claude-specific type leaks into the fleet read; keep `tokio-cron-scheduler` stubbed.
- Local-first, credentials never leave the machine. Nothing here adds a network path.
- **Human verification is deferred until MVP.** Do not run `/gsd-verify-work`, do not emit `checkpoint:human-verify`, write the cheap automated test instead of deferring, and put any genuinely physical item in `.planning/DEFERRED-REVIEW.md` with `truth`, `why_deferred`, `risk_if_wrong` and an honest `automatable`. `checkpoint:decision` and `checkpoint:human-action` still apply.
- Honest reporting: a deferred item is never described as verified.
- Work enters through a GSD command; no direct repo edits outside a GSD workflow.
- Memory directives respected here: Flywheel must not depend on an Anthropic API key (no change), and Cyril wants one concrete next action rather than a menu (see the final return).

## Sources

### Primary (HIGH confidence)
- Repository files read this session: `10-CONTEXT.md`, `REQUIREMENTS.md`, `STATE.md` (first 275 lines plus targeted greps), `ROADMAP.md` Phase 10, `.claude/CLAUDE.md`, `.planning/DEFERRED-REVIEW.md`, `.planning/WINDOWS.md`, `08.1-UI-SPEC.md` (SUPERSEDES, AUTHORITATIVE, Row Anatomy, deliberately-not-decided), `01-UI-SPEC.md` (Surface Inventory, Keyboard Map Global, Performance Contract, Copywriting), the three folded todos.
- Core: `query/{mod,agent_runs,permissions,recovery,change_flags}.rs`, `domain/{agent_run,worktree,settings}.rs`, `session_log.rs`, `merge.rs` (is_integrated), `git.rs`, `proc.rs`, `dispatch.rs` (occupied_slots), migrations 0002, 0003, 0004, 0005, 0006, 0010, 0013, 0014, 0017, 0019, `db/mod.rs`.
- Desktop crate: `main.rs`, `state.rs`, `menu.rs`, `scheduler.rs`, `sidecar.rs` (emit sites), `commands/{agent_run,change_flags,settings,menu}.rs`, `Cargo.toml`, `capabilities/default.json`, `tauri.conf.json`.
- Renderer: `App.tsx`, `state/uiStore.ts`, `state/keyboard.ts`, `projects/ProjectRail.tsx`, `session/{SessionSurface,PermissionRequestCard,FeedRow}.tsx`, `item-detail/RunsSection.tsx`, `legend/marks.ts`, `board/{useBoardQuery.ts,BoardView.tsx,CommandPalette.tsx}`, `adapters/tauri.ts` export list, `settings/SettingsSurface.tsx` (cap control), test setup.
- Sidecar: `claude-code-adapter.ts` (normaliser, close reason), `adapter.ts` event types.
- `tauri-plugin-notification` 2.6.0 crate source (`~/.cargo/registry/src/*/tauri-plugin-notification-2.6.0/src/{desktop,models,lib}.rs`), downloaded via `cargo info`.
- crates.io API (versions, dependencies); `gsd-tools query package-legitimacy check`.

### Secondary (MEDIUM confidence)
- https://v2.tauri.app/plugin/notification/ — Actions API mobile-only statement, default permission list, `cargo add` command
- https://raw.githubusercontent.com/tauri-apps/plugins-workspace/v2/plugins/notification/CHANGELOG.md — 2.6.0 desktop click entry
- https://docs.rs/tauri-plugin-notification/2.6.0/tauri_plugin_notification/struct.Notification.html — `on_action`, desktop permission always Granted
- https://code.claude.com/docs/en/agent-sdk/cost-tracking — `total_cost_usd` is a client-side estimate, present on error results

### Tertiary (LOW confidence)
- Behaviour of macOS Notification Center, banner retention, `wait_for_response` lifetime: not exercised; see A1, A2, A3, A6.

## Metadata

**Confidence breakdown:**
- Standard stack: HIGH — one new dependency, version-specific behaviour confirmed in downloaded source.
- Architecture: HIGH — every pattern is a generalisation of code read this session.
- Pitfalls: HIGH for the code-level findings (1 to 3, 5 to 14); MEDIUM for notification runtime behaviour (4).

**Research date:** 2026-10-12
**Valid until:** 2026-10-26 for the plugin version facts (a 2-day-old release in a fast-moving line); 2026-11-12 for the codebase findings, or until Phases 11 or any plan touching `App.tsx`, `keyboard.ts` or `agent_run.rs` lands.
