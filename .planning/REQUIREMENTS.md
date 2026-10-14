# Requirements: Flywheel (by HighKnow)

**Defined:** 2026-10-14
**Milestone:** v0.2.0 — The Board Thinks With You
**Core Value:** Every unit of agent work is anchored to a structured board item with real acceptance criteria — never a chat blob.

v0.1.0's 93 requirements are archived verbatim at `.planning/milestones/v0.1.0-REQUIREMENTS.md`
and remain the authority for everything that shipped. Three of them were unmet and are carried
here; the rest are not restated.

**The bar for this milestone:** Cyril shapes a piece of work end to end — states the problem,
is challenged on it, records the decisions it forces, watches it decompose into cycles, epics and
tasks, and reviews what comes back — **without typing anything an agent could have drafted**, on a
surface he wants to return to.

## Scope rule

Two rules govern every requirement below. They are the milestone, compressed:

1. **No form a human fills that an agent could have drafted.** A field that an agent cannot draft
   and a human must type is either derived from something already known, or it should not exist.
2. **No draft that creates more work than it removes.** Every drafted field must name the thing
   downstream that reads it. Acceptance is per field for scalars and per item for structures;
   there is no bulk-accept control anywhere in the product.

## v0.2.0 Requirements

### Records: PRD, ADR and Cycle

The grouping layer above epics is called a **Cycle**, not a phase — "phase" collides with GSD's
own phases, which are read daily in this repository (owner decision, 2026-10-14).

- [ ] **RECD-01**: A PRD is a first-class board record with closed, named slots — problem, appetite, solution sketch, rabbit holes, no-gos — not a free-form document; each slot is independently revisioned and independently amendable
- [ ] **RECD-02**: A PRD is signed off by a human act against one named, immutable revision; after sign-off an edit creates a new revision rather than overwriting, as BOARD-03 already does for acceptance criteria
- [ ] **RECD-03**: A PRD is optional per epic — small work proceeds without one, and nothing in the product requires authoring a PRD to start
- [ ] **RECD-04**: A PRD carries a structured acceptance bar as discrete checkable items, reusing the existing `acceptance_criteria` mechanism — conditional on a test proving `criterion_anchors` rows survive the table rebuild; if that test fails, the bar falls back to a Markdown checklist section and this requirement is amended rather than silently weakened
- [ ] **RECD-05**: An ADR is a first-class board record with states proposed, accepted, rejected and superseded; the body of an accepted ADR is immutable, and `rejected` is retained as negative knowledge so the same decision is not re-proposed
- [ ] **RECD-06**: Superseding an ADR is atomic — the superseded record and its successor change state in one transaction, and no state exists in which both are accepted
- [ ] **RECD-07**: An agent that reaches a genuine decision fork proposes an ADR naming at least two options with their trade-offs, rate-limited per run, checked against existing ADRs for duplicates before surfacing; a provisional choice may proceed without blocking the run
- [ ] **RECD-08**: A Cycle groups epics and is scope-boxed and undated — it has a goal, an ordering and exit criteria, and it has no dates, no capacity and no velocity
- [ ] **RECD-09**: The current Cycle's progress and the roadmap ahead of it are visible without navigating to them, folded from the real task counts of every epic rather than from a paged window
- [ ] **RECD-10**: Closing a Cycle prompts for the disposition of unfinished epics rather than silently moving them, and a Cycle whose scope changed after it started says so
- [ ] **RECD-11**: Accepted ADRs that constrain an epic, and the PRD bar items for that epic, enter the agent's context packet — bounded by fixed counts and link relevance, pinned to the revision that was read, with the inclusion boundary stated to the user in the CTX-05 style
- [ ] **RECD-12**: A PRD or ADR revision that changed after an agent read it is surfaced as a contradiction in the next session's prompt, extending CTX-06 rather than duplicating it
- [ ] **RECD-13**: A Cycle may hold epics from more than one PRD, and a PRD may span more than one Cycle

### Drafting: the end of encoding work

- [ ] **DRFT-01**: The planner declares each task's expected file-set, observed working against a live backend, and the hand-typed path field becomes an escape hatch rather than the path of record *(closes the carried PLAN-01)*
- [ ] **DRFT-02**: Acceptance criteria are drafted by default when a task is created or started; a run on a task with no criteria routes through drafting first rather than proceeding without them
- [ ] **DRFT-03**: An epic or task can be decomposed by an agent into child items with titles and bodies drafted, which the user accepts, rejects or amends individually
- [ ] **DRFT-04**: A task's status is derived from git and forge state and is never drafted or written by an agent; the one non-derivable transition (backlog to todo) rides the acceptance of the task itself
- [ ] **DRFT-05**: `estimate` is removed from every required flow unless a consumer that reads it is named; an unread field is not drafted, shown as required, or asked for
- [ ] **DRFT-06**: Priority is offered only as an explicit, opt-in suggestion carrying its reasoning, never applied automatically and never required to start work
- [ ] **DRFT-07**: The unit of acceptance is the field for a scalar and the item for a structure; no control anywhere accepts a set wholesale, and the absence of a bulk-accept path is enforced by a source test
- [ ] **DRFT-08**: Open drafts are capped per project with visible back-pressure, so a drafting run cannot accumulate an unreviewable queue
- [ ] **DRFT-09**: The per-run proposal cap does not throttle a legitimate decomposition, and a run that hits its cap is refused with wording that fits the kind of session it is *(the current cap of 10 applies to authoring runs by accident, and its refusal text names a tool an authoring session does not have)*
- [ ] **DRFT-10**: Acceptance criteria can be drafted for a task that already exists and was created by hand, not only for a task an agent proposed in the same session
- [ ] **DRFT-11**: The product measures what fraction of drafted items are revised after acceptance, derived from the event log, so reflex acceptance is distinguishable from good drafting rather than assumed
- [ ] **DRFT-12**: Rate and session limits from the backend are detected, backed off from, and surfaced rather than retried blindly, observed against a real limit *(the carried AGNT-05)*

### Agent-assisted review

- [ ] **ARVW-01**: An agent reviews a task's diff against that task's acceptance criteria in a context that carries no memory of having written the code
- [ ] **ARVW-02**: Each criterion gets one of three verdicts — met, not met, or cannot determine — with cannot-determine first-class; no aggregate "all criteria met" badge exists, and no confidence score is shown
- [ ] **ARVW-03**: A verdict never sets a criterion's checked state and never enables an automatic merge; only a human check marks a criterion satisfied
- [ ] **ARVW-04**: Every verdict is anchored to the lines it refers to, and its freshness is derived from the existing anchor-staleness mechanism rather than stored
- [ ] **ARVW-05**: Pre-review is off by default and is invoked explicitly
- [ ] **ARVW-06**: A harness measures the reviewer against planted defects, and the measured miss rate is visible where the verdicts are read

### Visual direction

- [ ] **VIS-01**: State is carried by a single component that is the only consumer of the state colour tokens, rendering a glyph and a name alongside the colour, so that colour is the fastest channel and never the only one — enforced by a source gate, not by convention
- [ ] **VIS-02**: The direction that introduces saturated state colour supersedes D-11 by name, in a recorded decision with a SUPERSEDES table; the specification, the brand allowlist and the tests that enforce them are amended in the same change
- [ ] **VIS-03**: Every pair of state colours remains distinguishable under simulated protanopia, deuteranopia and tritanopia, asserted by test
- [ ] **VIS-04**: Every text role is contrast-checked against every surface tint it can appear on, in both modes, asserted by test against the shipped stylesheet bytes
- [ ] **VIS-05**: The interface is designed dark-first and follows the operating system's setting; the light mode is derived from the dark design rather than the reverse
- [ ] **VIS-06**: A seeded demonstration board exists carrying every state live — running, blocked, failed, awaiting review, proposals pending, an epic mid-flight, and a realistic item count — and design work is judged on it, never on fixture rows
- [ ] **VIS-07**: Each new surface is signed off by the owner looking at the built application, with a screenshot recorded; adopting a comp does not satisfy this
- [ ] **VIS-08**: The interface is calm when nothing needs the user and loud only where something does; the proportion of the surface carrying saturated colour is budgeted and checked

### Integrity and fencing

- [x] **FNC-01**: The epic, task and issue tables are pinned by a test that fails if their schema changes, so the fixed spine cannot erode while records are added above it
- [x] **FNC-02**: The no-promotion source gate classifies every table in the database rather than naming four, so a new table is covered by default and an unclassified table fails the build
- [ ] **FNC-03**: Every authority transition — sign-off, acceptance, checking a criterion, accepting an ADR — is reachable only from a human-initiated command, enforced at the database and in a source gate
- [x] **FNC-04**: A source gate fails the build on the vocabulary of the PM long tail — velocity, burndown, capacity, sprint, deadline, overdue, rollover — so the Cycle layer cannot drift into Jira by accretion
- [x] **FNC-05**: The context packet is bounded by fixed counts and link relevance with the boundary visible to the user; no unbounded read of summaries, decisions or records remains, and the bound is asserted by a scale test
- [ ] **FNC-06**: Which surface is showing is one modelled value inside the keyboard layer model, not a nested conditional outside it
- [ ] **FNC-07**: A board change notifies only the readers it affects, rather than invalidating every subscriber on every event

## Carried from v0.1.0

| Requirement | v0.1.0 state | Home in v0.2.0 |
|---|---|---|
| **PLAN-01** | Unmet. Code path proven against a fake backend; never run live (D-REV-35) | **DRFT-01.** It is the dependency that lets the hand-typed path field be retired, so it is scheduled first and in parallel |
| **AGNT-05** | Unmet. Gate implemented and unit-tested; no real hard limit ever observed (D-REV-32) | **DRFT-12.** Needs a credential-spending run, not code |
| **DIST-01** | Unmet and mapped to no phase in any roadmap | **Deferred with a named trigger** (below). It is no longer an orphan |

### DIST-01 — deferred, not dropped

**DIST-01**: The application installs and runs on macOS from a signed, notarized build.

**Status: UNMET and deliberately deferred out of v0.2.0.** Owner decision 2026-10-14, confirming
the 2026-10-13 decision (D-REV-60) to decline the Apple Developer Program purchase.

**Named unblocking trigger:** an Apple Developer Program membership existing. Plan `11-07`
(archived at `.planning/milestones/v0.1.0-phases/11-ship-it/`) is written, has zero tasks executed,
and runs unchanged once that account exists. Nothing else blocks it.

Until then the shipped build is ad-hoc signed, macOS reports a quarantined copy as damaged, and
the `xattr -cr` workaround is documented in the README and the release notes. This paragraph exists
so the requirement has a recorded home: it was lost once by having none.

## v0.2.x and later

Acknowledged, not in this milestone's roadmap.

- **CONV-01**: Quick capture that produces a proposed draft from one line of text
- **CONV-02**: Cycle exit criteria as checkable items
- **CONV-03**: ADR scoping by path glob, so an ADR constrains the files it governs
- **CONV-04**: Time-boxed cycles with dates — deliberately deferred; continuous backlog-draining has no sprint to plan against
- **CONV-05**: An agent proposing which Cycle an epic belongs in (an optional hint on an epic proposal is the cheap later route)
- **CONV-06**: A since-you-left digest and a single explained next action on re-entry — valuable, unassigned, to be placed or deferred during roadmapping

## Out of Scope

Carried forward from v0.1.0 and extended for this milestone's specific temptations.

| Feature | Reason |
|---------|--------|
| Velocity, burndown, capacity planning, forecasting | The Cycle layer describes where work is; it never predicts or accounts for effort. This is the exact boundary at which a focused tool becomes Jira, and FNC-04 enforces it mechanically |
| Dates, deadlines, overdue states, auto-created cycles | Scope-boxed and undated by decision. A date creates an obligation the loop-engineering model does not have |
| Portfolio and health roll-ups, manual weekly status updates | General-purpose PM long tail; already out of scope in v0.1.0 and restated because a Cycle layer invites them |
| Time tracking | Unchanged from v0.1.0 |
| Confidence scores on agent verdicts | Self-reported model confidence was found near-uninformative; a number invites deference without adding signal |
| An aggregate "all criteria met" badge | It is the single most effective way to manufacture false confidence in a self-review |
| Bulk-accept of drafted items | It converts the drafting feature into a rubber stamp, which is the failure mode the milestone exists to avoid |
| Gamification — streaks, scores, celebration of volume | "Want to come back" must come from legible state and real momentum, not from extrinsic reward |
| Multi-approver PRD sign-off | Single-developer product; a team approval chain belongs with the collaboration layer |
| A free-form document body on a PRD beyond its named slots | This is how a PRD becomes a wiki nobody reads, and how custom fields arrive through the back door |
| A general-purpose chat interface to the agent | Unchanged from v0.1.0: the board is the interface |

## Decisions taken at requirements time

Recorded here because each was an open question the research surfaced, and each is cheaper to
settle now than mid-phase.

| # | Decision | Ruling | Who |
|---|---|---|---|
| 1 | Force dark, or follow the OS? | Follow the OS, designed dark-first. Keeps the existing single-scheme test shape | Default |
| 2 | Cycle time-boxed or scope-boxed? | Scope-boxed and undated. All four research dimensions agreed | Default |
| 3 | Does a `rejected` ADR status exist? | Yes. Negative knowledge prevents re-proposal | Default |
| 4 | Proposal caps | Two distinct caps: a per-run production cap that does not throttle decomposition, and a per-project open-drafts cap. Values set in-phase; raising the per-run cap amends D-109 | Default |
| 5 | Auto pre-review on by default? | Off | Default |
| 6 | PRD bar: real criteria or a checklist? | Real criteria, conditional on the anchor-preservation test (RECD-04) | Default |
| 7 | May an agent verdict block a merge? | Advisory only, and it can never enable an automatic merge. Tightening later is possible; loosening is not | Default |
| 8 | Status / priority / estimate drafting | Derive status, drop estimate unless a consumer is named, priority opt-in only — against the owner's initial selection, on the evidence | **Owner, 2026-10-14** |
| 9 | User-facing name for the grouping layer | **Cycle** | **Owner, 2026-10-14** |
| 10 | Citable keys for PRD and ADR | Derived ordinal over archive-only rows | Default |
| 11 | May an agent propose Cycle placement? | Deferred (CONV-05) | Default |
| 12 | DIST-01's home | Explicit deferral with a named trigger | **Owner, 2026-10-14** |
| 13 | When does colour first appear? | After one foundation phase, with the first new surface | **Owner, 2026-10-14** |

## Traceability

Populated by the roadmapper on 2026-10-14. Phase detail lives in `.planning/ROADMAP.md`.

| Requirement | Phase | Status |
|-------------|-------|--------|
| RECD-01 | Phase 16 | Pending |
| RECD-02 | Phase 16 | Pending |
| RECD-03 | Phase 16 | Pending |
| RECD-04 | Phase 16 | Pending |
| RECD-05 | Phase 16 | Pending |
| RECD-06 | Phase 16 | Pending |
| RECD-07 | Phase 16 | Pending |
| RECD-08 | Phase 14 | Pending |
| RECD-09 | Phase 14 | Pending |
| RECD-10 | Phase 14 | Pending |
| RECD-11 | Phase 16 | Pending |
| RECD-12 | Phase 16 | Pending |
| RECD-13 | Phase 16 | Pending |
| DRFT-01 | Phase 15 | Pending |
| DRFT-02 | Phase 15 | Pending |
| DRFT-03 | Phase 15 | Pending |
| DRFT-04 | Phase 13 | Pending |
| DRFT-05 | Phase 13 | Pending |
| DRFT-06 | Phase 13 | Pending |
| DRFT-07 | Phase 15 | Pending |
| DRFT-08 | Phase 15 | Pending |
| DRFT-09 | Phase 13 | Pending |
| DRFT-10 | Phase 15 | Pending |
| DRFT-11 | Phase 15 | Pending |
| DRFT-12 | Phase 15 | Pending |
| ARVW-01 | Phase 17 | Pending |
| ARVW-02 | Phase 17 | Pending |
| ARVW-03 | Phase 17 | Pending |
| ARVW-04 | Phase 17 | Pending |
| ARVW-05 | Phase 17 | Pending |
| ARVW-06 | Phase 17 | Pending |
| VIS-01 | Phase 14 | Pending |
| VIS-02 | Phase 14 | Pending |
| VIS-03 | Phase 14 | Pending |
| VIS-04 | Phase 14 | Pending |
| VIS-05 | Phase 18 | Pending |
| VIS-06 | Phase 14 | Pending |
| VIS-07 | Phase 14 | Pending |
| VIS-08 | Phase 18 | Pending |
| FNC-01 | Phase 13 | Complete |
| FNC-02 | Phase 13 | Complete |
| FNC-03 | Phase 13 | Pending |
| FNC-04 | Phase 13 | Complete |
| FNC-05 | Phase 13 | Complete |
| FNC-06 | Phase 13 | Pending |
| FNC-07 | Phase 13 | Pending |

**Placement notes:**

- **DRFT-01** — Phase 13 carries its live measurement in parallel from day one; the requirement completes in 15
- **DRFT-04** — Needs F5 fixed and the FNC-03 human-only gate widened
- **DRFT-09** — Per-run production cap; lands with `agent_runs.kind` and the F1 repair
- **DRFT-12** — Carries AGNT-05; needs a credential-spending run
- **RECD-04** — Conditional on the anchor-preservation test, the phase's first plan
- **VIS-07** — Mapped once; re-asserted as a success criterion in phases 15, 16, 17 and 18

**Coverage:**

- v0.2.0 requirements: 46 total (13 RECD, 12 DRFT, 6 ARVW, 8 VIS, 7 FNC — of which DRFT-01 and DRFT-12 carry PLAN-01 and AGNT-05)
- Mapped to phases: 46 — Phase 13: 11, Phase 14: 9, Phase 15: 8, Phase 16: 10, Phase 17: 6, Phase 18: 2 (11 + 9 + 8 + 10 + 6 + 2 = 46)
- Unmapped: 0 — no orphans, no duplicates
- Deferred with a named trigger, outside the 46: DIST-01 (Apple Developer Program membership) and CONV-06 (Phase 17 closing)

---
*Requirements defined: 2026-10-14 for milestone v0.2.0*
*v0.1.0's requirements archived at `.planning/milestones/v0.1.0-REQUIREMENTS.md`*
