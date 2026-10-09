# Phase 9: Planned Fan-Out That Does Not Collide - Discussion Log

> **Audit trail only.** Do not use as input to planning, research, or execution agents.
> Decisions are captured in CONTEXT.md — this log preserves the alternatives considered.

**Date:** 2026-10-09
**Phase:** 9-Planned Fan-Out That Does Not Collide
**Areas discussed:** File-set declaration, Out-of-scope write, Wave dispatch, Cap & limit backoff

All four offered gray areas were selected. Sixteen questions, sixteen concrete choices, no
delegation to Claude's discretion.

---

## File-set declaration

### Q1 — Where does a task's declared file-set come from?

| Option | Description | Selected |
|--------|-------------|----------|
| Pre-dispatch planning pass | A short agent run on the epic just before fan-out that reads the repo as it is now and attaches a file-set to each existing task. Freshest forecast; cost is a new run kind and surface. | ✓ |
| Extend the decompose stage | The authoring agent proposes each task with its file-set during the existing `decompose` stage. Reuses all of Phase 5/6; cost is stale forecasts at dispatch time. | |
| Both, pre-dispatch wins | `decompose` proposes a first guess, the pre-dispatch pass overwrites it, dispatch trusts only the latter. Two code paths. | |

**User's choice:** Pre-dispatch planning pass
**Notes:** The overlap check is only as good as the freshness of what it compares. `ProposalPayload::Task` stays `{ title, description }`.

### Q2 — What shape is a declared file-set?

| Option | Description | Selected |
|--------|-------------|----------|
| Paths + dir prefixes | Exact repo-relative path or directory prefix. Overlap = set intersection plus prefix containment: decidable, cheap, no false "maybe". | ✓ |
| Exact paths only | Every file named individually. Simplest to verify; cost is hand-listing 20 paths for a cross-cutting task. | |
| Full globs | Arbitrary patterns. Expressive; cost is undecidable glob-vs-glob overlap and a broad glob making scope meaningless. | |

**User's choice:** Paths + dir prefixes
**Notes:** Rejecting general globs is what keeps the overlap verdict binary instead of over-approximating.

### Q3 — Is there a human gate before any agent spawns?

| Option | Description | Selected |
|--------|-------------|----------|
| Review + edit, then dispatch | The wave plan is editable — fix a path, move a task between waves — then you dispatch. | ✓ |
| Approve as-is or re-run | Accept whole or send the pass back. Cheaper; a single wrong path means re-running an agent. | |
| No gate | Dispatch follows the pass immediately; the scope hook is the only net. | |

**User's choice:** Review + edit, then dispatch
**Notes:** A wrong file-set is the one error that silently voids the parallelism guarantee. Consistent with Phase 6's triage gate.

### Q4 — What happens to a task with no declared file-set?

| Option | Description | Selected |
|--------|-------------|----------|
| Runs alone, hook off | No declaration means no disjointness claim, so it never shares a wave, and the hook is not armed. Keeps today's single-task launch working. | ✓ |
| Runs alone, hook fails closed | Armed with an empty set, so every write is refused. Consistent with the other hooks; breaks the one-task launch flow. | |
| Refuse to dispatch | Blocked until a file-set exists. Strongest guarantee; a real regression against Phase 2. | |

**User's choice:** Runs alone, hook off
**Notes:** Enforcement exists exactly where a declaration exists.

---

## Out-of-scope write

### Q1 — What does the hook do on a write outside the declared set?

| Option | Description | Selected |
|--------|-------------|----------|
| Deny, agent carries on | Deny with a reason, record a scope event, agent adapts. Mirrors `stage-gate-hook.ts`: synchronous, socket-free, never waits. | ✓ |
| Ask you to widen | Raise a permission request through the D-58 socket and block. Flexible; the hook now waits, and approving mid-wave can collide with a sibling. | |
| Allow, flag loudly | Write goes through, recorded as a scope event. Nothing lost; this is the ~35% baseline the hook exists to cut. | |

**User's choice:** Deny, agent carries on
**Notes:** Keeps disjointness a fact — a declared set can never widen underneath a sibling agent already running against it.

### Q2 — Can a file-set be widened after dispatch, and when does it take effect?

| Option | Description | Selected |
|--------|-------------|----------|
| Live, if overlap re-checks | Widen from the scope event; refused if it collides with any in-flight set. The hook reads its marker fresh per call, so it lands on the next tool call — no restart. | ✓ |
| Between sessions only | Applies to the next session on the worktree. Leans on the ephemeral-session thesis; costs a stop/restart cycle. | |
| No widening in v1 | Re-run the pre-dispatch pass. One code path; re-plans the whole fan-out for one path. | |

**User's choice:** Live, if overlap re-checks
**Notes:** The in-flight re-check is the load-bearing half — without it, live widening reopens the hole Q1 closed.

### Q3 — Where does a scope event appear?

| Option | Description | Selected |
|--------|-------------|----------|
| Feed + task row count | A feed row with the refused path and a Widen action, plus a count badge on the task row. Both surfaces already exist. | ✓ |
| Session feed only | A feed row like any other event; board stays clean. Under fan-out you are not watching any one session. | |
| Feed + board + review | Also a scope summary on the Phase 8 review surface. Most complete; touches the largest surface in the app. | |

**User's choice:** Feed + task row count
**Notes:** A task that hit the hook twenty times must not look identical on the board to one that never did.

### Q4 — Does repeated refusal escalate?

| Option | Description | Selected |
|--------|-------------|----------|
| No escalation, count it | Every refusal denied, counted, surfaced; the run is never stopped on your behalf. | ✓ |
| Block the run after N | Run goes `blocked` past a threshold. Stops wasted sessions; N has no principled value. | |
| Stop the run after N | Close the run and re-plan. Strongest token protection; discards real in-lane work. | |

**User's choice:** No escalation, count it
**Notes:** An agent repeatedly asking is information, not a malfunction.

---

## Wave dispatch

### Q1 — Who drives the waves?

| Option | Description | Selected |
|--------|-------------|----------|
| Auto-advance, you can pause | Dispatch once; waves advance on their own, pausable at any point. `scheduler.rs`/`trigger.rs` already provide the tick. | ✓ |
| You step each wave | Every spawn is a human act. Strongest supervision story; you become the clock. | |
| Auto-advance, no pause | Simplest state machine; no handle to grab when a plan turns out wrong. | |

**User's choice:** Auto-advance, you can pause
**Notes:** Loop engineering does not work if the developer is the clock.

### Q2 — What must be true before the next wave dispatches?

| Option | Description | Selected |
|--------|-------------|----------|
| Auto-merge clean, hold conflict | A finished run's branch merges into the integration branch when the dry run is clean; a conflict stops that task and asks. Wave 2 branches off a base containing wave 1. | ✓ |
| Wave boundary is a review gate | Each merge stays the human act Phase 8 built. Nothing unreviewed becomes a base; every wave boundary is your attention. | |
| Run closed is enough | Nothing merged between waves. Never waits; a dependent wave-2 task works against code that isn't there. | |

**User's choice:** Auto-merge clean, hold conflict
**Notes:** Raised explicitly before the choice: this re-interprets Phase 8 success criterion 3 — per-task review stops being a gate during fan-out, and the review of record moves to the epic integration diff before the PR. Recorded in CONTEXT.md as the phase's one **one-way** decision.

### Q3 — Where does the "why were these two sequenced?" answer live?

| Option | Description | Selected |
|--------|-------------|----------|
| Inline + recorded as event | Colliding paths named on the wave plan at approval time, and the same reason written as an event so it is answerable later. | ✓ |
| Inline on the wave plan only | Cheapest, shown where the decision is made; no answer after dispatch. | |
| On-demand recompute | A "why?" action recomputes. Always current; answers about now, not about what was decided. | |

**User's choice:** Inline + recorded as event
**Notes:** PLAN-07 says the user can *ask*, which means after the fact — and after a live widen, a recomputed answer and the acted-on answer differ.

### Q4 — How does "that pair drops to sequential" actually run?

| Option | Description | Selected |
|--------|-------------|----------|
| Second waits inside the wave | Both stay in the wave; the second does not spawn until the first finishes, everything else runs in parallel throughout. | ✓ |
| Pushed to the next wave | A wave is a mutually disjoint set. Dead simple dispatch; inflates wave count and over-delays the task. | |
| Merge the pair into a sub-chain | A chain occupies one dispatcher slot. Handles long collisions; one long chain idles capacity. | |

**User's choice:** Second waits inside the wave
**Notes:** Literally what ROADMAP success criterion 2 asks for — only that pair degrades.

---

## Cap & limit backoff

### Q1 — What does the parallel cap count?

| Option | Description | Selected |
|--------|-------------|----------|
| Global agent sessions | One number across every project — the only cap that bounds one account's limits and one machine. Follows the `global_credential_mode` precedent. | ✓ |
| Global + per-project ceiling | Protects against one noisy project; two interacting numbers and an unclear reason a task is waiting. | |
| Per repository | Targets `.git/index.lock` directly; `SpawnFloor` already owns that risk, and account limits stay uncapped. | |

**User's choice:** Global agent sessions
**Notes:** Five projects at three each is fifteen sessions on one account. A per-project ceiling stays additive for Phase 10.

### Q2 — What pauses on a rate or session limit?

| Option | Description | Selected |
|--------|-------------|----------|
| New dispatch only | Stop spawning; running sessions continue. A mid-task session holds uncommitted work and spent tokens. | ✓ |
| Dispatch and running sessions | Hold everything. Strongest compliance posture; interrupting is safe but never cheap, and you resume into a reconstitution. | |
| Surface only | Tell you, change nothing. Fails the criterion. | |

**User's choice:** New dispatch only

### Q3 — Does the `allowed_warning` tier already change dispatch?

| Option | Description | Selected |
|--------|-------------|----------|
| Stop auto-advancing waves | Finish the running wave, do not auto-advance, say why. Soft landing; uses `utilization`/`rateLimitType` the adapter already parses. | ✓ |
| Surface the warning only | Show the number and trust you to read it. | |
| Taper the width | Narrow fan-out as utilization climbs. An invented mapping, and a cap that silently disagrees with the one you set. | |

**User's choice:** Stop auto-advancing waves
**Notes:** You never get cut off mid-wave with half an epic merged; manual dispatch stays available.

### Q4 — Who restarts dispatch once `resetsAt` has passed?

| Option | Description | Selected |
|--------|-------------|----------|
| Auto-resume at resetsAt | Visible wait with a resume-now action; resumes on its own. `resetsAt` is a real wire timestamp; `scheduler.rs` owns the tick. | ✓ |
| You resume | Every post-limit spawn is a deliberate act; a limit hit overnight is still waiting in the morning. | |
| Auto-resume with a probe | Retry on a backoff curve. Robust if `resetsAt` is missing; a probe is a retry against a limit. | |

**User's choice:** Auto-resume at resetsAt

---

## Claude's Discretion

Nothing was delegated — the user chose a concrete option on all sixteen questions. Six items were
surfaced during the discussion and left for the planner/researcher to decide and record rather
than re-ask: the cap's default value, whether authoring runs count against the cap, the fallback
when `resetsAt` is absent, whether reads are scoped as well as writes, whether a denial discloses
the whole declared set, and where/how the file-set is stored and versioned. See CONTEXT.md
§ Claude's Discretion.

## Deferred Ideas

- Per-project parallel ceiling on top of the global cap — Phase 10, additive.
- Scope summary on the Phase 8 review surface — considered for the scope-event surfacing question
  and set aside; post-MVP polish.
- Blocking or stopping a run that repeatedly fights its file-set — rejected for want of a
  principled threshold; revisit with measured fan-out data.
- Board-item ownership/lock checks (`PITFALLS.md` Pitfall 6) — the same discipline applied to
  board data instead of source files. Out of scope.
- Reviewed, not folded: *Forge resolution failures are not memoised, so they retry per worktree
  every tick* — a Phase 7 defect that fan-out multiplies by wave width. Flagged for the planner.
