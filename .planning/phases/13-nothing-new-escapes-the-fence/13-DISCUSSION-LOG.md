# Phase 13: Nothing New Escapes The Fence - Discussion Log

> **Audit trail only.** Do not use as input to planning, research, or execution agents.
> Decisions are captured in CONTEXT.md — this log preserves the alternatives considered.

**Date:** 2026-10-14
**Phase:** 13-nothing-new-escapes-the-fence
**Areas discussed:** Decision residue in the packet, Derived status mapping, estimate/priority removal depth, Gate strictness and exceptions

---

## Pre-discussion: pending todos

| Option | Description | Selected |
|--------|-------------|----------|
| Just the `git_identity` SQL one | A SQL/table-name source-convention defect in core, adjacent to the table-classification and SQL gates this phase builds | ✓ |
| None — leave all ten in the backlog | Phase 13 already carries 11 requirements and 8 defects | |
| All six core/desktop defects | A defect-drain pass alongside F1–F11 | |

**User's choice:** Just the `git_identity` SQL one
**Notes:** Nine of ten keyword matches were noise — forge memoisation, URL scheme validation, timeout races, a thread leak, adapter text loss, AskUserQuestion visibility, Socratic structure and handoff-sheet gaps. Listed in CONTEXT.md's Reviewed Todos so later phases know they were considered.

---

## Decision residue in the packet

### Q1 — What bounds the folded decision residue?

| Option | Description | Selected |
|--------|-------------|----------|
| Bound the input, not the fold | `SUMMARIES_SQL` gets a fixed LIMIT; `compaction.rs` untouched and still lossless; no amendment to D-68/D-69 | ✓ |
| Bound the residue by a fixed decision count | Read every summary, fold, carry the most recent K decisions whole; every decision stays addressable — but the losslessness contract and both decisions need amending | |
| Keep lossless; bound only the new records | Accept residue growth with task age; fixed counts apply only to ADRs and the PRD bar | |

**User's choice:** Bound the input, not the fold
**Notes:** Framing correction made during discussion — the roadmap's research flag asked whether *acknowledged* decisions drop from the residue. Reading `drift.rs` showed `acknowledged_decisions` is D-73 drift machinery (proof an agent read a decision), not a settled-ness marker. Dropping on acknowledgment would lose a decision because an agent said it saw it, and would blind `drift.rs:207`. The live fork was therefore narrower than the roadmap's phrasing.

### Q2 — What does the visible boundary sentence say about what was left out?

| Option | Description | Selected |
|--------|-------------|----------|
| Count plus how to reach the rest | Names the arithmetic and one way to read the excluded sessions; adds no bytes per excluded item; stays byte-identical for a given board state | ✓ |
| Count only | Same shape as today's `boundary_sentence()`; makes no reachability claim | |
| Count plus the excluded decision ids | Keeps every decision addressable, but the id list grows with task age — reintroduces the unbounded term one level down | |

**User's choice:** Count plus how to reach the rest

### Q3 — How does drift detection stay sound once the summary list is bounded?

| Option | Description | Selected |
|--------|-------------|----------|
| Drift reads the bounded list, with an existence check | Contract becomes "over the summaries in scope"; fabrication half does a bounded point lookup per echoed id | ✓ |
| Drift gets its own id-only query | Both detectors stay exact, but it is an unbounded read of decisions needing an allowlist entry — in the phase closing that precedent | |
| Maintain a per-task decision id index | Exact and bounded, at the cost of new schema, a new write path and a migration | |

**User's choice:** Drift reads the bounded list, with an existence check
**Notes:** Surfaced during discussion, not named in the roadmap: `detect_decision_read_back` (`drift.rs:188`) builds its recorded-id set from `inputs.summaries` and its own comment relies on compaction being lossless for decisions. A LIMIT does not merely weaken `UnacknowledgedDecision` — an agent correctly echoing a decision from a dropped summary would fire a *false* `FabricatedDecisionEcho`. The detector must change in the same diff as the LIMIT.

### Q4 — What is the LIMIT value?

| Option | Description | Selected |
|--------|-------------|----------|
| 25 — 5 verbatim, 20 folded | Sibling const to `VERBATIM_WINDOW`; roughly a week of sessions; small fixture and large fixture visibly differ | ✓ |
| 50 — 5 verbatim, 45 folded | More history survives; ~45 summaries of file paths per packet and a narrower size gap | |
| Set it from the scale test | A number chosen to pass a test is ceiling-shaped reasoning, one level removed from what D-69 rejected | |

**User's choice:** 25 — 5 verbatim, 20 folded

---

## Derived status mapping

### Q1 — Does `tasks.status` stay a column?

| Option | Description | Selected |
|--------|-------------|----------|
| Column stays, exactly one writer | Materialised derivation, deriver as sole writer; keeps SQL predicates, rank index, `task.status_changed` events, compare-and-swap | ✓ |
| Drop the column; derive at read time | Impossible to drift, but the largest diff in the milestone's foundation phase | |
| Column stays, writers narrowed only | Status becomes "not agent-written" rather than "derived"; DRFT-04 would need amending | |

**User's choice:** Column stays, exactly one writer
**Notes:** Context established first: today status is a stored column the forge nudges edge-triggered, forward-only, and hands back (D-121/D-122), precisely so it can never overwrite a manual move. Deriving it is a different model, not a tightening of that one. `blocked` was confirmed to be `agent_runs.status`, not a task state — the five task statuses are `backlog, todo, in_progress, in_review, done`.

### Q2 — Which signal derives `in_progress`?

| Option | Description | Selected |
|--------|-------------|----------|
| A worktree exists for the task | The durable task-owned resource that outlives sessions; one existing read | ✓ |
| First commit on the branch (ahead > 0) | A task sits at todo through the first hour of real work | |
| An active agent run | Demotes to todo when a session ends — the model the board exists to replace | |

**User's choice:** A worktree exists for the task

### Q3 — Does the deriver go backward?

| Option | Description | Selected |
|--------|-------------|----------|
| Forward-only is kept as an explicit floor | `max(candidate, current)` over the band order; D-122 survives as one comparison | ✓ |
| Derivation is honest and may go backward | Reverses a Phase 7 decision taken on evidence; a flapping forge read moves the card both ways | |
| Forward-only, except `done` is terminal and closed reopens nothing | Superset of option 1 — but the floor already makes `done` terminal, so it was redundant | |

**User's choice:** Forward-only is kept as an explicit floor
**Notes:** `done` terminality follows from the floor rather than needing its own rule, which is why option 3 collapsed into option 1.

### Q4 — When does the deriver run?

| Option | Description | Selected |
|--------|-------------|----------|
| The existing scheduler tick, plus worktree lifecycle | D-113/D-114 tick already reads git facts and polls the forge; no new machinery; compare-and-swap carries over | ✓ |
| On every board read | Never stale, but a read path that writes in a WAL database several surfaces poll | |
| Tick, plus an explicit recompute command | A button whose existence admits the derivation can be wrong | |

**User's choice:** The existing scheduler tick, plus worktree lifecycle

---

## estimate / priority removal depth

### Q1 — How deep does estimate removal go?

| Option | Description | Selected |
|--------|-------------|----------|
| Drop the column via table rebuild | Removed from `tasks` and `epics`; picker and filter deleted; spine pinned post-drop; rebuild doubles as early RECD-04 proof | ✓ |
| Keep the column, remove every flow | Satisfies criterion 3 literally, but leaves an unread column inside a pinned spine | |
| Drop from tasks only, keep on epics | Two rules where one would do | |

**User's choice:** Drop the column via table rebuild
**Notes:** Two findings framed the question. `estimate`'s only reader is a filter dimension over a field nobody fills. And SQLite refuses `DROP COLUMN` on a column named in a `CHECK` — so removal forces a table rebuild, the exact operation RECD-04 (Phase 16) is explicitly conditional on surviving. Doing it here de-risks RECD-04 three phases early.

### Q2 — What changes for priority?

| Option | Description | Selected |
|--------|-------------|----------|
| Column stays; suggestions become a proposal | Agent proposes through `authoring_proposals` with reasoning; human accepts per-item; no schema change | ✓ |
| Column stays; add a reasoning column beside it | Durable visible reasoning, at the cost of a spine change in the phase that pins the spine | |
| Drop priority to opt-in storage entirely | `0`-sorts-last already gives that semantic | |

**User's choice:** Column stays; suggestions become a proposal

### Q3 — What moves a hand-made task from backlog to todo?

| Option | Description | Selected |
|--------|-------------|----------|
| Hand-made tasks are created at todo | Typing a task is the human act; `backlog` gets one meaning instead of two | ✓ |
| A human move stays available for backlog→todo only | A picker offering one move is a worse affordance than a button | |
| Accepting the task's drafted criteria moves it | Depends on DRFT-02/DRFT-10, both Phase 15 | |

**User's choice:** Hand-made tasks are created at todo
**Notes:** Hole surfaced during discussion: criterion 3 says backlog→todo rides "acceptance of the task itself", which has no meaning for a task typed by hand and never proposed — the same shape as the DRFT-10 gap flagged for criteria in Phase 15.

### Q4 — Does `StatusPicker.tsx` survive?

| Option | Description | Selected |
|--------|-------------|----------|
| Delete it; status becomes read-only on the card | The deletion is itself the proof no human-reachable status write exists outside the deriver | ✓ |
| Keep it, refusing every transition with a reason | UI whose only job is to say no | |
| Replace it with a "why is this here" explainer | A Phase 14 surface question | |

**User's choice:** Delete it; status becomes read-only on the card

### Not asked — derived consequence

`set_estimate` disappears with the column, so **F4 narrows to `set_priority_in_tx`**, and that form becomes *required* rather than optional, because accepting a priority suggestion happens inside the proposal-acceptance transaction. Recorded rather than put to the user.

---

## Gate strictness and exceptions

### Q1 — How is FNC-04's vocabulary list made workable?

| Option | Description | Selected |
|--------|-------------|----------|
| All ten words, whole-word match, two named idiom exclusions | `with_capacity` and `deadline`-in-`proc.rs`; list survives intact; exclusions are two auditable literals | ✓ |
| All ten words, committed baseline fixture | Strongest audit trail, but every future `Vec::with_capacity` fails the build until regenerated | |
| Amend the list to domain spellings | Zero false positives, but amends criterion 3 and lets a column still be named `capacity` | |

**User's choice:** All ten words, whole-word match, two named idiom exclusions
**Notes:** Blocking finding: criterion 3 taken literally fails the build today. `capacity` appears 15 times as `Vec::with_capacity`/`String::with_capacity` across `branch.rs`, `destructive.rs`, `forge/request_body.rs`, `epic_context_packet.rs`, `query/*` and `domain/dispatch_plan.rs`; `deadline` is a timeout `Instant` throughout `proc.rs`.

### Q2 — What is the scan's reach?

| Option | Description | Selected |
|--------|-------------|----------|
| `packages/core/src` and `packages/desktop/src`, plus tests | A fixture is the cheapest place to smuggle a field in; planning docs never scanned | ✓ |
| src trees only, tests excluded | Tests are source in this repo — the gates themselves are tests | |
| Source, tests, and migrations | The spine pin and table-classification test already cover schema change | |

**User's choice:** `packages/core/src` and `packages/desktop/src`, plus tests
**Notes:** `.planning/REQUIREMENTS.md` legitimately names `velocity` and `deadline` in its own out-of-scope table — the words must stay sayable in planning documents in order to be forbidden in code.

### Q3 — F5: refactor, delete, or allow-list?

| Option | Description | Selected |
|--------|-------------|----------|
| Delete it | The write is redundant under derived status; smaller diff than either alternative | ✓ |
| Refactor it through `set_task_status_in_tx` | Satisfies criterion 2 literally, but preserves a second status writer that writes a value the deriver already wrote | |
| Allow-list it with a recorded reason | The first allow-list entry would defend a write nothing needs | |

**User's choice:** Delete it
**Notes:** `agent_run.rs:233` is a raw `UPDATE tasks SET status = 'in_progress'`, directly violating the rule documented at `task.rs:443`. Criterion 2 offers only "refactored or allow-listed"; "deleted" is a third outcome and is recorded as amendment A-01.

### Q4 — How do the forward-only floor and `request_changes` coexist?

| Option | Description | Selected |
|--------|-------------|----------|
| The floor binds the deriver; a human authority act may lower it | `request_changes` stays a human-only FNC-03 transition that lowers the floor explicitly | ✓ |
| Keep the floor absolute; `request_changes` stops moving status | A declined task would look identical to one awaiting first review | |
| Treat a decline as derivable | `ForgeState::ChangesRequested` is GitHub-only by design; the rule would silently not work on GitLab | |

**User's choice:** The floor binds the deriver; a human authority act may lower it

### Q5 — Where does table classification live?

| Option | Description | Selected |
|--------|-------------|----------|
| A const list in core, checked against `sqlite_master` by a test | Catches a table added by migration, which a source scan cannot; two-sided (unnamed table and stale name both fail) | ✓ |
| A compile-time enum with an exhaustive match | Migrations are SQL text — a new table reaches the DB without the compiler seeing it | |
| Parse the migration files and classify from there | Tests the text rather than the schema — the open-world hole FNC-02 exists to close | |

**User's choice:** A const list in core, checked against `sqlite_master` by a test

---

## Claude's Discretion

- Exact wording of boundary and refusal sentences, within the stated shape
- Internal naming of the new window const, the deriver function and the classification enum
- Whether the classification test lives beside `proposal_no_promotion.rs` or in its own file
- Sequencing of the eight defects against the five gates, and plan decomposition generally

## Deferred Ideas

- A manual status override / recompute command — rejected with Q4 of status and Q4 of fields
- A "why is this status" explainer on the card — a Phase 14 surface question
- Scanning `.sql` migrations with the vocabulary gate — already covered by the spine pin and classification test
- A per-task decision id index table — new schema for a detector that needs none
- Gray areas identified but not discussed: per-run proposal cap values and refusal wording per run kind (DRFT-09/F1), F7's `DatabaseTooFarAhead` user-facing behaviour, F11's `generate_handler!` roster generation, and what counts as the recorded live-planning-run artifact in criterion 6
