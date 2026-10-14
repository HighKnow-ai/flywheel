# Phase 4: `/clear` Is Free - Discussion Log

> **Audit trail only.** Do not use as input to planning, research, or execution agents.
> Decisions are captured in CONTEXT.md — this log preserves the alternatives considered.

**Date:** 2026-09-22
**Phase:** 4-`/clear` Is Free
**Areas discussed:** Discard verb and the summary it leaves, What the fresh session receives, Contradiction surfacing, Criteria lock and revisions

---

## Gray area selection

| Option | Description | Selected |
|--------|-------------|----------|
| Discard verb + the summary it leaves | CTX-01/02/08 — what the single discard action is, and who authors the summary when D-35's force-kill means many sessions die before writing one | ✓ |
| What the fresh session receives | CTX-03/05 — verbatim count, what compaction does, where the boundary shows, whether the diff includes uncommitted work | ✓ |
| Contradiction surfacing | CTX-06 — what counts as contradicting a board decision, and where the user is told | ✓ |
| Criteria lock and revisions | BOARD-03 — when criteria freeze, what editing does, which revision a running session sees | ✓ |

**User's choice:** all four.

---

## Discard verb and the summary it leaves

### Q1 — Who authors a session summary?

| Option | Description | Selected |
|--------|-------------|----------|
| Agent writes it, supervisor fills the gap | A `report_summary` MCP board tool called as the closing turn; the Rust core synthesizes from diff + event log and flags `auto_generated` when a run closes without one (`SessionClosedEvent.reason` is the signal). Matches ARCHITECTURE §3 verbatim | ✓ |
| Supervisor always synthesizes, no model ever | Deterministic Rust fold over `git diff`, the JSONL and the event log. Never missing. Cost: what only the agent knows is unrecoverable from a diff | |
| Agent only, from the terminal result text | Parse a structured block out of the final `result` line. No new seam. Cost: a force-killed run leaves no summary, so criterion 1 is false where continuity matters most | |

**User's choice:** Agent writes it, supervisor fills the gap.
**Notes:** becomes D-64.

### Q2 — What structure does the summary row carry?

| Option | Description | Selected |
|--------|-------------|----------|
| Four fields, two machine-checkable | `changed` as file paths + prose, `remains`, `next_session_must_know`, `decisions` as discrete entries. Enables ARCHITECTURE §3.2's integrity check and gives compaction something structured to keep | ✓ |
| Three prose fields, exactly what criterion 1 names | Simplest, least for the agent to get wrong. Cost: nothing machine-checkable | |
| Four fields, all free prose | Adds `decisions`/`open_questions` as prose. Cost: no file list, so the drift detector cannot be built | |

**User's choice:** Four fields, two machine-checkable.
**Notes:** becomes D-65; rated one-way (migration + four dependent contracts).

### Q3 — Does discard spend a closing turn, or take the fallback?

| Option | Description | Selected |
|--------|-------------|----------|
| Ask for the summary, then stop | One final "call `report_summary` now" turn, bounded wait, then D-35's interrupt-then-force. `auto_generated` stays the exception | ✓ |
| Interrupt immediately, take the fallback | Byte-identical to Stop. Cost: the flagship action routinely produces the weakest summary | |
| Ask, and if it refuses, block rather than fall through | Strongest guarantee criterion 1 is literally true. Cost: spends the friction D-46 reserved for money burning | |

**User's choice:** Ask for the summary, then stop.
**Notes:** becomes D-66. The bounded-wait duration was left to the planner.

### Q4 — Launch sheet or immediate spawn?

| Option | Description | Selected |
|--------|-------------|----------|
| Lands on the launch sheet, pre-filled | One action to `LaunchSheet.tsx` primed with the fresh packet; Enter starts it. Keeps D-27's correctable briefing and gives CTX-05's boundary an existing surface | ✓ |
| Spawns immediately, no sheet | Truest single action. Cost: the briefing is never seen and CTX-05 needs a new surface | |
| A modifier on Stop, not its own verb | Fewest new surfaces. Cost: the flagship capability buried inside a destructive verb | |

**User's choice:** Lands on the launch sheet, pre-filled.
**Notes:** becomes D-67.

---

## What the fresh session receives

### Q1 — What does compaction do?

| Option | Description | Selected |
|--------|-------------|----------|
| Mechanical field-keeping, no model at all | Drop `changed` prose and `remains`, keep every `decisions` entry and file path. A pure Rust fold, so CTX-04 determinism holds at write time too | ✓ |
| A model-written epoch summary, produced once at write time | Richer prose, assembly stays pure. Cost: it is a summary of summaries — PITFALLS' named failure physics | |
| No compaction — carry everything | PITFALLS' own alternative reading. Cost: CTX-05 explicitly requires a visible boundary | |

**User's choice:** Mechanical field-keeping, no model at all.
**Notes:** becomes D-68. Framed during discussion as "lossless for decisions and total for narrative".

### Q2 — Where does the verbatim window end?

| Option | Description | Selected |
|--------|-------------|----------|
| A fixed count, not configurable | Last 5 verbatim. Same instinct as D-23/D-24 — rigidity is the feature; the boundary is statable arithmetic | ✓ |
| A token budget — fill until full, then fold | Adapts, never wastes the window. Cost: the boundary moves invisibly; one verbose summary evicts three good ones | |
| Fixed count, but exposed in Settings | Tunable per project. Cost: a second behaviour to test across five cycles | |

**User's choice:** A fixed count, not configurable.
**Notes:** becomes D-69.

### Q3 — Does the diff cover uncommitted work?

| Option | Description | Selected |
|--------|-------------|----------|
| Both, as two labelled sections | Committed `base...HEAD` plus working-tree state. Without the second, discard-mid-edit hands the next session changes it cannot see | ✓ |
| Committed range only, exactly as ARCHITECTURE §3 specifies | Simplest, matches the research literally. Cost: false for precisely the state D-35 guarantees | |
| Both, plus untracked files named path-by-path | D-42's argument, most complete. Cost: escaped build output floods the packet | |

**User's choice:** Both, as two labelled sections.
**Notes:** becomes D-70. Noted that this pressures `context_packet.rs`'s own "no git call" header contract.

### Q4 — How much of the diff goes in?

| Option | Description | Selected |
|--------|-------------|----------|
| Always stat + file list; the agent reads the diff itself | Packet size depends only on file count — bounded, deterministic, diffable across five cycles; the file list doubles as the integrity-check input | ✓ |
| Full diff when small, stat when large | ARCHITECTURE §3's literal recommendation. Cost: a threshold is a second behaviour and packet size swings on a byte count | |
| Always the full diff | Maximum grounding. Cost: unbounded growth — the pressure this phase exists to relieve | |

**User's choice:** Always stat + file list.
**Notes:** becomes D-71.

---

## Contradiction surfacing

### Q1 — What is compared against what?

| Option | Description | Selected |
|--------|-------------|----------|
| Mechanical checks only — three detectors | Claimed `changed` vs `git diff --name-only`; changes since the last summary's `diff_ref`; criteria drift against the pinned revision. ARCHITECTURE §3.2 names exactly these | ✓ |
| Mechanical checks plus a declared-intent comparison | Catches the semantic case. Cost: needs brittle keyword matching or a model call | |
| A model-judged contradiction check at session start | Reads criterion 4 at full strength. Cost: non-deterministic, unverifiable across five cycles, a model between the user and his own board | |

**User's choice:** Mechanical checks only.
**Notes:** becomes D-72.

### Q2 — Closing criterion 4's stated-understanding gap

Raised by Claude: the three detectors fire on facts, but criterion 4's wording is about a session *stating an understanding*. A file-list mismatch is not that.

| Option | Description | Selected |
|--------|-------------|----------|
| Close it without a model: decisions read-back | The packet renders `decisions` entries with ids; the session's opening tool call must echo back the ids it works under. An unechoed entry, or an echo whose `changed` list contradicts it, fires the same warning. Pure id matching | ✓ |
| Record it as a narrowed reading and let the verifier judge | Honest and cheap. Cost: the verifier may call criterion 4 unmet, in the one phase not allowed to look solved while hollow | |
| Defer the stated-understanding half to Phase 6 | Phase 6 builds the real write path. Cost: deferring the detector past the phase that creates the risk is pitfall 3's named failure | |

**User's choice:** Close it without a model.
**Notes:** becomes D-73.

### Q3 — Where is the user told, and does it block?

| Option | Description | Selected |
|--------|-------------|----------|
| A warning line in the packet, plus D-37's board-visible state | The agent reads it too (ARCHITECTURE §3.2); the board raises the needs-you signal. Nothing blocks — D-46 already ruled only money burning blocks | ✓ |
| A blocking banner requiring acknowledgement | Strongest guarantee. Cost: a modal on a routine condition | |
| Packet warning line only, no board signal | Cheapest. Cost: an unattended run drifts with nothing on the board saying so — pitfall 3's thesis-killer | |

**User's choice:** Packet warning line plus board-visible state, non-blocking.
**Notes:** becomes D-74.

### Q4 — Where does a fired detector live?

| Option | Description | Selected |
|--------|-------------|----------|
| An event row, and the packet re-derives the warning every time | D-19 human-renderable payload; activity trail carries drift history free; CTX-04 preserved because the warning is a pure function of board state | ✓ |
| A column on the summary row it was checked against | Queryable per summary. Cost: stored derived state that goes stale | |
| Its own drift-findings table | Most complete, best fit for the rail count. Cost: a table and migration for three computed booleans | |

**User's choice:** An event row, with the warning re-derived.
**Notes:** becomes D-75.

---

## Criteria lock and revisions

### Q1 — What engages the lock?

| Option | Description | Selected |
|--------|-------------|----------|
| The first agent run on the task, ever | An `agent_runs` row is the lock — a fact already in the schema, no new flag, not toggleable by a hand-edited status | ✓ |
| The task entering In Progress | The board's own vocabulary. Cost: a human can set that status by hand | |
| The first worktree created for the task | Durable and task-owned. Cost: survives a refused D-41 removal and a D-45 `missing` marking | |

**User's choice:** The first agent run on the task, ever.
**Notes:** becomes D-76.

### Q2 — What happens when a locked criterion is edited?

| Option | Description | Selected |
|--------|-------------|----------|
| The edit writes a new revision; the original row is never touched | A `revision` column plus a supersedes link — the additive column migration `0002` already anticipated. Enforced at the write path, like Phase 1's CHECK constraints | ✓ |
| Refuse the edit and require an explicit revise action | D-43's rigidity argument. Cost: D-43 was protecting uncommitted work, not prose | |
| Show what will happen, then confirm | D-42's show-the-stakes instinct. Cost: friction on a non-destructive operation | |

**User's choice:** The edit writes a new revision.
**Notes:** becomes D-77; rated one-way (schema change to a Phase 1 table, CHECK rebuild on D-18's backup-first path).

### Q3 — Which revision does a live run see vs the next session?

| Option | Description | Selected |
|--------|-------------|----------|
| The live run keeps rev 1; the next session gets rev 2 | `agent_runs` pins the revision set it was assembled with — D-40's non-repudiation property. The bump is surfaced by D-72's third detector. CTX-07 asserts against a pinned set | ✓ |
| Both get the latest — the board is always the truth | One rule, no pinning. Cost: an agent is judged on a criterion it was never given, and a completed run's packet cannot be reproduced | |
| Revising while a run is live is refused outright | Zero ambiguity. Cost: an overnight run makes the board read-only for hours | |

**User's choice:** The live run keeps its pinned revision.
**Notes:** becomes D-78.

### Q4 — Are superseded revisions visible, and to whom?

| Option | Description | Selected |
|--------|-------------|----------|
| Visible to Cyril on demand, never in the packet | A quiet "revised" marker expanding to prior text, plus an event in the activity trail. The packet carries current revisions only — criteria are the one thing that must never drift | ✓ |
| Visible to both — the packet carries the revision trail | The agent sees what the user sharpened. Cost: puts superseded wording in front of the model | |
| Stored but not surfaced anywhere in v1 | Cheapest. Cost: criterion 5 wants revisioning demonstrable, not test-only | |

**User's choice:** Visible to Cyril on demand, never in the packet.
**Notes:** becomes D-79.

---

## Claude's Discretion

Recorded in full in `04-CONTEXT.md` §"Claude's Discretion". Summary:

- The multi-cycle test harness and what "context-quality metrics" means (ROADMAP research flag; weigh WINDOWS rows 11/12's live-session flakiness against Phase 3's real-process precedent).
- How much of the `report_summary` tool is the start of Phase 5/6's write path, and where it physically lives.
- The bounded wait in D-66.
- Whether ARCHITECTURE §3 items 5–7 (unresolved permission requests, open issues, project conventions) join the packet in this phase.
- Where summaries render on a task, and the panel after ten runs.
- What the `auto_generated` fallback may claim, and how D-73's read-back behaves against a summary with no `decisions` entries.
- How the integrity check treats a legitimately renamed file.
- Whether a fired detector is acknowledgeable.
- Whether behaviour differs under `tauri dev` versus a packaged `.app`.

## Deferred Ideas

- A semantic contradiction check (a model comparing stated understanding against decisions) — rejected here, plausibly Phase 6.
- A model-written epoch summary for compaction.
- A first-class drift-findings table with acknowledge/dismiss lifecycle — plausibly Phase 10.
- A configurable verbatim window in Settings.
- Reconstituting from an earlier, less-degraded summary (PITFALLS "Recovery Strategies") — the append-only store ships here, the affordance does not.
- Full diff embedding with a size threshold.
- Human annotation of a summary (would need its own row type, since CTX-02 makes summaries append-only).

*No scope creep occurred — all four areas stayed inside the phase boundary.*
