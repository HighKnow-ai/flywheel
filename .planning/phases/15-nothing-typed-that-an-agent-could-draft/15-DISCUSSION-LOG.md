# Phase 15: Nothing Typed That An Agent Could Draft - Discussion Log

> **Audit trail only.** Do not use as input to planning, research, or execution agents.
> Decisions are captured in CONTEXT.md — this log preserves the alternatives considered.

**Date:** 2026-10-16
**Phase:** 15-nothing-typed-that-an-agent-could-draft
**Areas discussed:** Provisional vs explicit accept, accept_subtree's fate, The no-criteria run
gate, Cap value and what it counts, Live file-set scope (F10), Lint failure disposition, Where the
revision rate shows, Observing a real limit, Stale drafts, No backfill

All eight offered gray areas were selected, plus two follow-ups on criterion 3 and criterion 4 that
none of the eight covered. All four candidate todos were folded.

---

## Provisional vs explicit accept

| Option | Description | Selected |
|--------|-------------|----------|
| Criteria + file-sets explicit, rest provisional | PITFALLS #5's recommendation; titles, bodies, priority land provisional | ✓ |
| Everything explicit | Simplest gate; the ~36-decisions-per-epic chore shape | |
| Everything provisional, Start Work freezes | Fewest interruptions; criterion 3 left with nothing to act on | |

| Option | Description | Selected |
|--------|-------------|----------|
| Stays in authoring_proposals, ghosted into the real form | No canonical row until confirmed; PITFALLS #9 one-component-two-sources | ✓ |
| Canonical row written, provisional derived from the event actor | Row is real immediately; unconfirmed draft is live board state | |
| New provisional column | Cheapest query; a tasks/epics rebuild on the pinned spine | |

| Option | Description | Selected |
|--------|-------------|----------|
| Start Work on the task | Same site as BOARD-03's criteria freeze | ✓ |
| Any human edit to the item | Touching a title silently accepts a drafted file-set | |
| Nothing — provisional values expire | Neglect is never silent acceptance; costs the agent's work | |

| Option | Description | Selected |
|--------|-------------|----------|
| Reject is the undo | One mechanism, no window to expire | ✓ |
| Timed undo after confirmation | Catches reflex accept; adds a timer and a race | |

**User's choice:** explicit tier for criteria and file-sets; provisional values stay staged and
ghosted into the manual form; Start Work confirms; reject is the undo.
**Notes:** Claude flagged a tension this created — criteria explicit plus `accept_subtree` deleted
would mean ~30 explicit accepts for a 6-task decomposition, the Ancker-worst shape. Resolved in the
next area by firing criteria drafting per task rather than inside the decomposition run (D-05, D-10).

---

## accept_subtree's fate

| Option | Description | Selected |
|--------|-------------|----------|
| Delete it | Per-item only; handler, outcome struct, tests and the index rationale all go | ✓ |
| Keep it as the structural unit, named in the gate with its reason | A task plus its own criteria IS one item under DRFT-07 | |
| Rename to the unit-of-acceptance vocabulary | Satisfies the "no identifier" clause on its text; weakest gate | |

| Option | Description | Selected |
|--------|-------------|----------|
| No — confirming provisionals is not accepting drafts | Explicit tier untouched by Start Work | ✓ |
| Yes — name it with its reason, two-sided | Gate names the confirm path explicitly | |

| Option | Description | Selected |
|--------|-------------|----------|
| Both sides — desktop walk plus a core-side gate | Criterion 3 says "anywhere"; a desktop test cannot see accept_subtree | ✓ |
| Extend the existing desktop test only | One test; blind to the Rust handler | |
| One core-side gate scanning both trees | D-21's sources_under() precedent; diverges from desktop house style | |

| Option | Description | Selected |
|--------|-------------|----------|
| Both bulk reject/defer stay unchanged | They mint nothing, which is why D-104 allowed them | ✓ |
| Both stay, and the gate asserts they mint nothing | Adds the second side explicitly | |

**User's choice:** delete `accept_subtree`; no exemption for Start Work; gate on both sides; bulk
reject and defer unchanged.
**Notes:** Supersedes Phase 5's D-95 by name. The `idx_authoring_proposals_parent` index survives
for the implied-parent walk; only its bulk-accept rationale is rewritten.

---

## The no-criteria run gate

| Option | Description | Selected |
|--------|-------------|----------|
| Per task, on open or Start Work | ~5 decisions per encounter; same path as DRFT-10's hand-made task | ✓ |
| At task creation, decomposition children included | Fully shaped epic; the 30-in-one-sitting shape | |
| Both, deduplicated | Most coverage; two trigger sites, cap spent fastest | |

| Option | Description | Selected |
|--------|-------------|----------|
| Route through drafting in the launch sheet, no dispatch until decided | Criterion 2's wording directly | ✓ |
| Refuse the run with a reason | Cleanest gate; the "draft blocks work" chore-side row | |
| Draft and dispatch together | No interruption; breaks BOARD-03's freeze-at-start | |

| Option | Description | Selected |
|--------|-------------|----------|
| Zero current criteria and zero pending drafts | Pending drafts count as coverage; cap not spent twice | ✓ |
| Zero current criteria only | Literal; re-drafts over waiting drafts | |
| Epic-level anchored criterion counts as coverage | Widest; most likely to start with nothing specific | |

| Option | Description | Selected |
|--------|-------------|----------|
| Yes, recorded as an event | Escape hatch is measurable, sits beside the DRFT-11 numbers | ✓ |
| No — never dispatch without criteria | Strongest reading of the Core Value; a refusing lint bricks the task | |

**User's choice:** per-task drafting on open/Start Work; launch sheet routes before dispatch;
pending drafts count as coverage; deliberate no-criteria start allowed and recorded.
**Notes:** Context given during the question — Phase 8's audit found zero criteria on every task
with a worktree, and 15 criteria across 907 tasks, so the gate meets an almost entirely
criteria-free board.

---

## Cap value and what it counts

| Option | Description | Selected |
|--------|-------------|----------|
| Pending explicit-tier drafts per project | Only what needs a decision | ✓ |
| Every pending draft row per project | One COUNT(*); throttles on drafts not waiting on you | |
| Items with pending drafts per project | Closest to "things waiting for me"; one item hides 10 decisions | |

| Option | Description | Selected |
|--------|-------------|----------|
| 30 | ~a 6-task epic; above the 1-of-42 batch, below the 40-in-a-sitting shape | ✓ |
| 15 | Back-pressure felt early; may stop mid-decomposition | |
| 60 | Matches the authoring per-run cap; permits the queue A-05 rejected 100 for | |

| Option | Description | Selected |
|--------|-------------|----------|
| Tool refuses with a named refusal and one event, run continues | ProposalOutcome::LimitExhausted reused | ✓ |
| Pause the run until drained | Loudest; contradicts limit_gate.rs's own rule | |

| Option | Description | Selected |
|--------|-------------|----------|
| Project gauge plus the refusal in the run's own state | The leading indicator PITFALLS names first | ✓ |
| Only in the run's own state | Smallest surface; no leading indicator | |
| Gauge, run state, and the fleet rail | Most visible; rail count semantics just flagged in a todo | |

**User's choice:** pending explicit-tier drafts per project, cap 30, refusal + event with the run
continuing, gauge on the project plus run state.
**Notes:** Recorded as a first setting to instrument against, not a tuned one.

---

## Live file-set scope (F10)

| Option | Description | Selected |
|--------|-------------|----------|
| Live, and plan approval is the accept | approve_plan already exists and already gates dispatch | ✓ |
| Stage in authoring_proposals until accepted | Literally consistent with the explicit tier; second staging path | |
| Keep it live, fix provenance only | F10's named fix; "accepted" then means nothing for file-sets | |

| Option | Description | Selected |
|--------|-------------|----------|
| The task.file_set_declared event's actor | Criterion 1's wording; A-07's no-column precedent | ✓ |
| A stored drafted_by column | Cheapest read; stored copy of a logged fact | |

| Option | Description | Selected |
|--------|-------------|----------|
| Chip editor for the drafted set, raw textarea retained unprefilled | Criterion 1's "still there as the same form with no prefill" | ✓ |
| Chip editor with git ls-files autocomplete, textarea removed | Best editing; contradicts criterion 1's "still there" | |
| Keep the textarea alone, add chips above it | Smallest change; leaves "the file-set editor" unbuilt | |

| Option | Description | Selected |
|--------|-------------|----------|
| Declare it undeclared explicitly | PITFALLS: undeclared, not invented | ✓ |
| Leave the task out of the plan with a reason | Reuses the skipped-task path; unscoped task drops out | |
| An empty set means undeclared | No new vocabulary; conflates "nothing to touch" with "cannot tell" | |

**User's choice:** live with plan approval as the accept; provenance from the event actor; chip
editor plus unprefilled textarea; undecidable sets declared undeclared.
**Notes:** CLAUDE.md's rule was surfaced in the options — any path autocomplete uses `git ls-files`,
not a libgit2 walk, because `git2` is not a dependency.

---

## Lint failure disposition

| Option | Description | Selected |
|--------|-------------|----------|
| Refused with the named reason, agent redrafts in-run | EntryRefusal's reject-never-repair discipline | ✓ |
| Persisted pending-but-hidden with its lint reason | Nothing lost; criterion 2 asserted on the UI instead of the write path | |
| Dropped, with one event | Cheapest; wastes the agent's next attempt | |

| Option | Description | Selected |
|--------|-------------|----------|
| Core, inside create_proposal_in_tx before the INSERT | No bypass; a database-level fact a test can assert | ✓ |
| At the MCP tool boundary in the sidecar | Fastest feedback; leaves the core open-world | |

| Option | Description | Selected |
|--------|-------------|----------|
| Derived — a NULL verification_hint IS the flag | No spine change; one query | ✓ |
| A stored judgement_only column | Literal "stored flagged"; a rebuild and a second truth | |

| Option | Description | Selected |
|--------|-------------|----------|
| Yes, as a non-blocking warning | One component two sources; never overrules you | ✓ |
| Agent drafts only | Simplest scope; the form behaves differently per author | |
| Yes, blocking for both | Strongest floor; how a gate gets disabled | |

**User's choice:** refuse in core with a named reason; judgement-only derived from a NULL hint; the
same lint warns non-blockingly on human-typed criteria.
**Notes:** Consequence recorded in CONTEXT.md — a refused draft consumes neither the project cap
(pending rows) nor the per-run cap (inserted rows), and that must be asserted.

---

## Where the revision rate shows

| Option | Description | Selected |
|--------|-------------|----------|
| On the project, beside the open-drafts gauge | Both numbers are drafting health, read in one glance | ✓ |
| A dev-only report, like the demo seeder | Nothing ships; only seen when you go looking | |
| Item detail, per criterion | Local and concrete; never adds up to the fraction asked for | |

| Option | Description | Selected |
|--------|-------------|----------|
| Post-accept revision rate alone | PITFALLS names it the outcome metric | ✓ |
| Revision rate plus draft drain rate | Adds the leading indicator; two derivations | |
| All four from PITFALLS #7 | Most diagnostic; needs UI telemetry that does not exist | |

| Option | Description | Selected |
|--------|-------------|----------|
| A revision or in-place edit after that item's accept event | Both are the same signal; both already in the log | ✓ |
| Locked revisions only | Unambiguous; misses corrections made before the first run | |
| Any edit to any drafted field | Widest; counts ordinary shaping as failure | |

| Option | Description | Selected |
|--------|-------------|----------|
| Windowed to the last N accepted drafts, N a const | The house style for every count in this codebase | ✓ |
| All-time over the project's event stream | Honest denominator; the unbounded shape Phase 13 closed | |

**User's choice:** project surface beside the gauge; that one number; revisions and in-place edits
after the accept event; windowed const.

---

## Observing a real limit

| Option | Description | Selected |
|--------|-------------|----------|
| Deliberately drive a session into the subscription window limit | The only way to see Rejected on purpose; costs a window | ✓ |
| Ship the recorder, catch one opportunistically | Costs nothing; a deferral satisfying an owner-verdict criterion (Pitfall 14) | |
| Accept a warning-tier observation | Free; Warning is not the unexercised tier | |

| Option | Description | Selected |
|--------|-------------|----------|
| A committed artifact plus a fixture derived from it | Observation permanent, test stops being constructed | ✓ |
| The committed artifact alone | Evidence only; fixtures stay hand-built from the docs | |

| Option | Description | Selected |
|--------|-------------|----------|
| Rejected — the unexercised tier | The tier that pauses dispatch and the one flagged unobserved | ✓ |
| Warning, if the same wire confirms Rejected's shape | Cheaper; leaves the pausing transition unexercised live | |

| Option | Description | Selected |
|--------|-------------|----------|
| Reuse blocked plus the existing DispatchGateLine | No seventh state class; nothing for Phase 18 to re-budget | ✓ |
| A distinct limited state carrying the reset instant | Says exactly what happened; a seventh class in a six-class vocabulary | |

**User's choice:** deliberate burn; artifact plus derived fixture; `Rejected` must be seen; surfaced
through `blocked` and the existing gate line.
**Notes:** No API-key path was offered — agents authenticate with the developer's own Claude Code
credentials, which is a standing project constraint.

---

## Stale drafts (criterion 3's last sentence)

| Option | Description | Selected |
|--------|-------------|----------|
| Pin the parent's revision; diff shows what changed under the draft | Reuses D-77's revision counter | ✓ |
| Pin a content hash of everything the draft read | Strictly stronger; new machinery | |
| Pin the event sequence number | One integer; refuses on any board change, so the refusal gets ignored | |

**User's choice:** pin the parent's revision, refuse with a diff of what moved.

---

## No backfill (criterion 4)

| Option | Description | Selected |
|--------|-------------|----------|
| A source gate: no drafting call site enumerates tasks | PITFALLS #8 as a test rather than a convention | ✓ |
| The cap of 30 is the whole answer | Throttles a sweep; criterion 4 says no path exists | |
| Types alone — drafting takes one item id | Cheapest and strong; a future caller writes the loop one level up | |

**User's choice:** a source gate over drafting call sites, two-sided.

---

## Claude's Discretion

- The lint's rule set and wording (vague verbs, compound detection, "names no observable"); the
  three named classes are the floor.
- How `undeclared` is represented — constraint: not a new column on a spine-pinned table.
- The value of `N` in the revision-rate window; internal naming of the cap const, the lint module,
  the gauge component and the provenance chip.
- Whether the core-side DRFT-07 gate sits beside `proposal_no_promotion.rs` or in its own file.
- The diff presentation for a stale draft.
- Plan decomposition and sequencing, with one hard constraint: the live planner measurement and the
  deliberate limit burn are scheduled early and in parallel, not as a tail.

## Deferred Ideas

- Timed undo after confirmation — revisit only if the revision rate says reflex acceptance is real.
- Accept-without-expand rate and time-to-accept — next two if the revision rate proves ambiguous;
  both need UI telemetry that does not exist.
- Drafting the Cycle itself — carried forward unresolved from 14-CONTEXT.md; in no criterion here.
- An agent proposing which Cycle an epic belongs in (CONV-05).
- The since-you-left digest (CONV-06) — named trigger: Phase 17 closing.
- A seventh "limited" state class — a Phase 18 signal-budget decision if the gate line reads quiet.
- Stored `drafted_by` and `judgement_only` columns — each a spine rebuild if a future query needs
  to filter without the derivation.
