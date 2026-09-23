# Phase 5: Socratic Epic Authoring - Discussion Log

> **Audit trail only.** Do not use as input to planning, research, or execution agents.
> Decisions are captured in CONTEXT.md — this log preserves the alternatives considered.

**Date:** 2026-09-23
**Phase:** 5-Socratic Epic Authoring
**Areas discussed:** Proposal staging, Session shape & scope, The challenge mechanism, Accept / reject / amend

---

## Proposal staging

### Where do proposed epics/tasks/criteria live before acceptance?

| Option | Description | Selected |
|--------|-------------|----------|
| Session-scoped staging table | A new table holds proposed rows keyed to the session; canonical tables untouched until commit. Keeps Anti-Pattern 2 literally true, burns no keys, board stays clean. Costs a migration plus a materialise-on-accept path. | ✓ |
| Real rows immediately, in `backlog` | The proposal *is* the row. Zero new schema. But the agent writes `epics`/`tasks` directly, rejects burn keys, board fills with junk mid-conversation. | |
| Issues lane as the staging area | Proposals land as `issues` (kind='idea'), promoted on accept. Reuses IssuesLane. But `issues` has no criteria (D-07), so SHAPE-03's drafted criteria have nowhere to live. | |

**Notes:** The board schema forced this — no `draft` status exists, the five-state CHECK has no
reconfiguration path, and `acceptance_criteria.parent_type` accepts only `'task'`/`'epic'`.

### What may a proposal address when reopening a live epic (SHAPE-05)?

| Option | Description | Selected |
|--------|-------------|----------|
| Create, amend or delete — uniform verb | One staging shape, one accept path, fresh and reopened epics identical. Amend against a locked criterion becomes a D-77 revision. Safety comes from the human gate. | ✓ |
| Create + amend, no delete | Keeps the one irreversible verb out of agent hands. But the agent can argue a task should go and cannot draft it. | |
| Additive only | Structurally cannot touch criteria a run is pinned to. But SHAPE-05's challenge degrades to advice. | |

### Where do pending proposals show up on the board?

| Option | Description | Selected |
|--------|-------------|----------|
| A triage lane on the board | Handles a wholly-staged epic with no row yet, and is the surface Phase 6 extends. Count on the epic row comes free via D-37. | ✓ |
| A section inside the epic's detail panel | Strongest locality, but cannot host a brand-new staged epic — two surfaces for one concept. | |
| Only inside the authoring surface | Cleanest board, but pending work becomes invisible state (the D-16/D-45/D-74 failure). | |

### Does a decided proposal row stay?

| Option | Description | Selected |
|--------|-------------|----------|
| Stays, marked terminal (accepted/rejected) | The rejected set becomes the do-not-re-propose corpus, readable as one indexed query. Must ship bounded. | ✓ |
| Consumed on accept, deleted on reject | Smallest mutable table; history via the event log. But the re-proposal guard becomes an event replay. | |
| Accepted consumed, rejected kept | Small table plus the useful half of history. But two lifecycles in one table. | |

---

## Session shape & scope

### Is an authoring session an `agent_run`?

| Option | Description | Selected |
|--------|-------------|----------|
| Yes — make `task_id` nullable, add `epic_id` | One supervision apparatus; Phase 3's watchdog/heartbeat/kill record/reconciler keep working. `worktree_id` already nullable. Costs a CHECK-constrained rebuild per 0006. | ✓ |
| A separate `authoring_sessions` table | Leaves `agent_runs` untouched. But watchdog, heartbeat, kill record, reconciliation, cost tracking and session log each need a second implementation. | |
| Anchor it to a synthetic placeholder task | No schema change today. But it puts non-work rows on the board that every query must learn to hide. | |

### Where does the shaping conversation happen?

| Option | Description | Selected |
|--------|-------------|----------|
| `SessionSurface.tsx` plus a live proposal tray | Same route, same chrome; feed, permission cards, status strip, Stop and Discard all work unchanged. The tray is the one new panel. | ✓ |
| A dedicated authoring surface | Laid out for shaping, which FEATURES.md implies matters. But a second session-rendering surface and duplicate wiring for blocked state, cost, Stop/Discard. | |
| Board-native, no transcript | Most literal reading of "not a chat log". But a card round-trip per challenge makes this the slowest way to shape an epic. | |

### Can the agent read the code, and from where?

| Option | Description | Selected |
|--------|-------------|----------|
| Read-only in the project's main checkout | Makes challenges specific rather than generic. D-36's accept-edits default explicitly does not apply; the Phase 3 shim and destructive gate still wrap the spawn. | ✓ |
| A dedicated read-only worktree | Structurally isolated. But `worktrees.task_id` is NOT NULL UNIQUE — a second schema loosening — and a trunk worktree does not reflect the real working state. | |
| Board only — no repo access | Zero filesystem surface. But it can never say "this already exists", the most valuable challenge available. | |

### What board context does the session get?

| Option | Description | Selected |
|--------|-------------|----------|
| Epic-scoped packet + bounded read tools | Deterministic priming plus the ability to go looking for duplicates. Forces `epic_roster`'s limit exemption closed, which STATE has been waiting for. | ✓ |
| Epic-scoped packet only | Cleanly extends D-28/CTX-04's contract and defers the `epic_roster` cap. But duplicate detection becomes the user's job. | |
| Read tools only, no packet | Most flexible. But the session starts cold and its inputs stop being reproducible, for no gain. | |

---

## The challenge mechanism

### What stops the session drifting into an interview?

| Option | Description | Selected |
|--------|-------------|----------|
| A staged machine: challenge → decompose → criteria | Each stage exposes a different tool set; proposal tools do not exist during the challenge stage. GSD's own discuss/research/plan, and testable. | ✓ |
| A precondition on the write tools | Refuses until N challenges are answered. Cheaper, never blocks a loop-back. But a counter is a crude proxy. | |
| System prompt only | Ships fastest; how every surveyed Socratic pattern works. But nothing structural, nothing assertable, trivially copied. | |

### Is a challenge structured or conversation?

| Option | Description | Selected |
|--------|-------------|----------|
| Talk freely, distil to amendable rows on advance | Fast and natural; advancing writes the challenged assumptions and answers as staged rows, correctable through the same accept/amend path. | ✓ |
| Structured from the start | Most rigorous and fully auditable. But it turns the conversation into a form. | |
| Prose only | Simplest. But the reasoning lives only in a transcript — the chat blob the Core Value forbids. | |

### Who moves between stages, and can it go back?

| Option | Description | Selected |
|--------|-------------|----------|
| You advance; you can always go back | The agent may recommend but never advances, so it cannot end its own challenge stage. Staged proposals survive a return. | ✓ |
| You advance; going back opens a recorded pass | More auditable. But passes are a second concept to model and render. | |
| The agent advances on its own judgement | Most fluid. But it hands the agent the one gate the mechanism depends on. | |

### What does SHAPE-05's reopening challenge mean mechanically?

| Option | Description | Selected |
|--------|-------------|----------|
| Model judgement, grounded on a fact packet | Phase 4's ban protected an unattended path; here a human is present and every output is gated, so the discipline is what facts ground the judgement, not whether it is allowed. | ✓ |
| Fact packet plus mechanical conflict detection | Stronger when it fires. But near-duplicate detection is hard, and a detector that cries wolf mid-conversation is worse than none. | |
| Mechanical only | Consistent with D-72 and trivially testable. But an epic can be consistent and still the wrong shape. | |

---

## Accept / reject / amend

**Not asked — forced by the requirements:** per-row granularity down to the individual criterion.
SHAPE-04 says "any individual item… rather than accepting the set wholesale", SHAPE-03 says criteria
are editable *before* accepting, and D-06 already gave every criterion its own row and ULID.

### What does rejecting tell the agent?

| Option | Description | Selected |
|--------|-------------|----------|
| A turn in the conversation — it may re-propose | Makes the loop collaborative rather than a grading exercise. The persisted rejected set is the guard against looping. | ✓ |
| Terminal and silent | Simplest. But the objection gets typed into the conversation anyway, so the silence buys nothing. | |
| Visible, structurally barred from re-proposing | Strongest protection. But "matching" a rejected proposal is the near-duplicate problem, and a false match swallows a better second attempt. | |

### What does amend mean?

| Option | Description | Selected |
|--------|-------------|----------|
| Edit the staged row, then accept | SHAPE-03 taken literally; the board never holds a version the user disagreed with, and the agent sees the edit. | ✓ |
| Accept, then edit on the board | Zero new editing UI. But the board holds a wrong statement in between, the agent learns nothing, and against a locked task the first edit is a D-77 revision of something that arrived wrong. | |
| Both | Most forgiving. But two editing paths and an intermittent feedback loop. | |

### Is there a bulk path for 26 rows?

| Option | Description | Selected |
|--------|-------------|----------|
| Bulk-accept a subtree (task + its criteria) | Six decisions instead of twenty-six, with the unit staying a coherent piece of work. SHAPE-04 forbids wholesale being the only option, not bulk existing. | ✓ |
| Accept-all-remaining for the whole tray | Fastest. But it becomes the reflex, and then SHAPE-03's criterion-editing requirement is decorative. | |
| No bulk path | Guarantees every criterion is read. But twenty-six keystrokes is the friction that sends you back to a terminal. | |

### When does an accepted proposal become a real row?

| Option | Description | Selected |
|--------|-------------|----------|
| Immediately, on accept, into `backlog` | An interrupted session still leaves real work behind. Accepting a child implies its parent. `backlog` is the only entry state the CHECK offers. | ✓ |
| Only on an explicit commit of the whole epic | Atomic and contiguous keys. But it puts a wholesale gate back over per-item decisions, and an interrupted session produces nothing. | |
| Real immediately but hidden until complete | Keeps both properties. But a visibility rule every query must honour, and hidden-but-real rows surprise you later. | |

---

## Claude's Discretion

Nothing was answered with "you decide". The Claude's Discretion section in CONTEXT.md lists the
areas that were **not discussed at all** and are left to the researcher and planner — most notably
the high-assumption spike and its kill criterion, the Nimbalyst re-scout STATE flags as due before
this phase, where the authoring tool set lives relative to `mcp-permission-server.ts`, what a
closing summary means for a run with no task or diff, Stop/Discard semantics for an authoring run,
and the keyboard map.

## Deferred Ideas

No scope creep arose during the discussion. The deferred list in CONTEXT.md is composed entirely of
rejected options worth revisiting later: mechanical near-duplicate/conflict detection (most
naturally Phase 6), a structural bar on re-proposing a rejected item, a dedicated authoring surface,
a tray-wide accept-all, recorded stage passes, a read-only worktree for authoring sessions, and
structured-from-the-start challenges.
