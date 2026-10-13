# Phase 10: Fleet Supervision Across Every Project - Discussion Log

> **Audit trail only.** Do not use as input to planning, research, or execution agents.
> Decisions are captured in CONTEXT.md — this log preserves the alternatives considered.

**Date:** 2026-10-12
**Phase:** 10-fleet-supervision-across-every-project
**Areas discussed:** Fleet surface shape & grouping, At-a-glance state vocabulary, Attention routing (queue + notifications), Worktree inventory / disk usage / reclaim

---

## Fleet surface shape & grouping

### Where the fleet view lives in the app shell

| Option | Description | Selected |
|--------|-------------|----------|
| New full surface, entered from the rail | Pushed into the shell and popped back out of, like Session/Triage/Review/Settings; the rail's inert Fleet and Review queue rows become its entry points | ✓ |
| "All projects" board mode | A pseudo-project entry widening every board query to all projects | |
| Persistent fleet strip above the board | Always-visible compact strip, board beneath | |

**User's choice:** New full surface, entered from the rail → **D-163**
**Notes:** 08.1 deliberately left the rail's Fleet/Review queue rows as read-only facts because their destinations did not exist. This phase is when they do.

### Ordering of fleet entries

| Option | Description | Selected |
|--------|-------------|----------|
| Urgency first, project as a column | Three bands — NEEDS YOU / RUNNING / DONE-FAILED — longest-waiting first within each | ✓ |
| Grouped by project | A section per registered project | |
| Flat, newest activity first | Feed ordering | |

**User's choice:** Urgency first, project as a column → **D-164**
**Notes:** Grouping by project puts a blocked agent in the fourth project below the fold, which the roadmap's own note calls the deciding failure mode.

### What stays on the surface, and for how long

| Option | Description | Selected |
|--------|-------------|----------|
| Until acknowledged, not on a timer | Reuses `agent_runs.acknowledged_at`; nothing disappears before it is seen | ✓ |
| Rolling window | Live runs plus anything ended in the last N hours | |
| Live runs only | Finished work lives on the board | |

**User's choice:** Until acknowledged → **D-165**
**Notes:** `agent_run_acknowledge`'s SQL is gated to `status = 'abandoned'` today; extending it is a one-clause change plus a capability-file description update.

### How one row offers both FLEET-03 destinations

| Option | Description | Selected |
|--------|-------------|----------|
| Row opens the session; a second target reaches the board | Enter → SessionSurface; the TASK-xx key → board item | ✓ |
| Row opens the board item; session is secondary | | |
| Row expands in place, both as explicit actions | | |

**User's choice:** Row opens the session → **D-166**

### What fills the "what it's doing" cell

| Option | Description | Selected |
|--------|-------------|----------|
| Latest feed row, truncated to one line | Reuses the session feed's existing normaliser and row kinds | ✓ |
| Task title, with the latest tool subordinate | | |
| Current tool name only | | |

**User's choice:** Latest normalised feed row → **D-167**
**Notes:** Asked as a fifth question in this area at the user's explicit choice, on the grounds that FLEET-01's literal wording ("what each is doing") makes the cell's content a requirement rather than decoration.

---

## At-a-glance state vocabulary

### How a row's state is computed

| Option | Description | Selected |
|--------|-------------|----------|
| Derived in one SQL read, nothing stored | Join `agent_runs` to its task; completed + task-not-Done reads awaiting review | ✓ |
| A new column on `agent_runs`, written at run end | | |
| Reuse the task status alone | | |

**User's choice:** Derived, nothing stored → **D-168**

### Where `interrupted` and `abandoned` land

| Option | Description | Selected |
|--------|-------------|----------|
| Keep their own marks — six states, not four | FLEET-04's four are a floor; interrupted muted, abandoned in NEEDS YOU | ✓ |
| Fold both into failed | | |
| Fold interrupted into done, abandoned into needs-you | | |

**User's choice:** Six states → **D-169**
**Notes:** 02-UI-SPEC explicitly states a user-initiated interrupt is a normal outcome, not an error; folding it into failed would contradict a locked decision.

### Where the awaiting-review glyph comes from

| Option | Description | Selected |
|--------|-------------|----------|
| Reuse the `status` channel's In Review mark | Circle-with-ellipsis, verbatim; legend gains no entry | ✓ |
| A new mark in the `agent` channel | | |

**User's choice:** Reuse the existing mark → **D-170**

### How the fleet stays live across every agent

| Option | Description | Selected |
|--------|-------------|----------|
| One query off `board:changed`; elapsed ticks locally | Rides the existing app-wide push; no IPC per second | ✓ |
| Subscribe to `agent:event` for every live run | | |
| Its own poll timer on the fleet surface | | |

**User's choice:** One query off `board:changed` → **D-171**
**Notes:** Confirmed during discussion that `board:changed` carries no project scope, so no new mechanism is needed.

---

## Attention routing: queue + notifications

### What is in FLEET-02's queue

| Option | Description | Selected |
|--------|-------------|----------|
| Live blocks only — a pending permission request | Preserves D-46's split between live spend and cold decisions | ✓ |
| Everything waiting on a human | Blocks + abandoned + awaiting-review in one queue | |
| Blocked plus abandoned; review stays separate | | |

**User's choice:** Live blocks only → **D-172**

### Whether a block can be answered from the queue

| Option | Description | Selected |
|--------|-------------|----------|
| Answer inline — a third mount of the same card | Same row, same three actions, same no-Escape rule | ✓ |
| Jump to the session to answer | | |
| Inline for routine, jump for destructive | | |

**User's choice:** Answer inline → **D-173**
**Notes:** 02-UI-SPEC Discretion #6 already specifies the card as one component with multiple mount points sharing one row, so this is the established pattern rather than a new one.

### Which transitions notify, and when it is suppressed

| Option | Description | Selected |
|--------|-------------|----------|
| Blocked, completed, failed — suppressed only when that session is on screen | | ✓ |
| Exactly blocked and completed, always fires | | |
| Blocked only | | |

**User's choice:** Blocked, completed, failed with focused-and-visible suppression → **D-174**

### Who emits, and batching

| Option | Description | Selected |
|--------|-------------|----------|
| Rust core emits; coalesce within a short window | Renderer gets no notification capability; waves collapse to one banner | ✓ |
| Rust core emits; one notification per transition | | |
| Renderer emits from the fleet query | | |

**User's choice:** Core emits, coalesced → **D-175**
**Notes:** Rated `costly` in CONTEXT.md — moving the emit to the renderer later would require granting the window a notification permission, reversing the documented default-deny boundary.

### Click-through and opt-out

| Option | Description | Selected |
|--------|-------------|----------|
| Single → that session; coalesced → the fleet. One global switch in Settings | | ✓ |
| Always opens the fleet; one global switch | | |
| Single → session, coalesced → fleet; per-project opt-out | | |

**User's choice:** Split click-through, one global switch → **D-176**

---

## Worktree inventory, disk usage & reclaim

### When disk size is measured

| Option | Description | Selected |
|--------|-------------|----------|
| On demand, cached with a measured-at stamp | Shown with its age; explicit re-measure | ✓ |
| A fifth scheduled tick, slowest tier | | |
| Measured fresh every time, no cache | | |

**User's choice:** On demand with a cached, aged figure → **D-177**
**Notes:** Follows D-116's precedent of labelling a figure with its age rather than pretending it is live. Rated `costly` — the cache needs a column or side table plus a migration.

### What makes a worktree reclaimable

| Option | Description | Selected |
|--------|-------------|----------|
| Derived from facts already recorded — don't write 'stale' | Task Done or branch merged, no live run, clean porcelain | ✓ |
| Populate the existing 'stale' status on the tick | | |
| Age and size heuristic | | |

**User's choice:** Derived → **D-178**
**Notes:** Surfaced during discussion that `worktrees.status`'s CHECK constraint permits `stale` and `merged` but nothing in the codebase ever writes either — only `active` and `missing`. WORK-07's "stale" had no populator.

### How reclaiming works at scale

| Option | Description | Selected |
|--------|-------------|----------|
| Multi-select, one confirmation, loops the existing verb per row | Each call keeps its own server-side porcelain re-read and refusal | ✓ |
| One at a time, through the existing dialog | | |
| One "reclaim everything reclaimable" action | | |

**User's choice:** Multi-select, looped verb → **D-179**

### Where cost and tokens surface at fleet scale

| Option | Description | Selected |
|--------|-------------|----------|
| A spend column on the fleet, blank while running, plus a fleet total | Needs no adapter change | ✓ |
| Make the adapter emit `cost_update` mid-run, then show it live | | |
| Leave cost where it already is; fleet shows no money | | |

**User's choice:** Spend column, blank while running → **D-180**
**Notes:** Surfaced during discussion that the Claude Code adapter reports `total_cost_usd` and usage only at the terminal `result` event, so a running run's `cost_usd` is NULL. Blank rather than `$0.00` was chosen as the honest rendering.

---

## Claude's Discretion

Deliberately left to the builder, within the authoritative UI contract: the specific glyphs, colour
tokens and band-header treatment; where the fleet's global binding slots into the Keyboard Map; the
coalescing window length; byte and age formatting; empty-state copy; whether D-177's cache is a new
column or a side table; and the truncation rule for the one-line activity cell.

## Folded Todos

Three pending todos were folded into scope because the fleet surface enlarges each one's blast
radius: the timeout-boundary terminal-status race, the adapter dropping assistant text when a stream
line carries both text and `tool_use`, and the unmemoised forge-resolution retry per worktree per
tick. Seven other keyword matches were reviewed and left out as out-of-domain.

## Deferred Ideas

Live mid-run cost streaming; per-project notification policy; an idle-output timeout for a blocked
session (carried forward from Phase 3, still declined now that D-174 wakes the user instead); an
age-and-size reclamation heuristic for worktrees the board has lost track of; fleet-wide spend over
time; scheduled automations.
