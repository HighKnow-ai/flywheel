# Roadmap: Flywheel (by HighKnow)

**Current milestone: v0.2.0 — The Board Thinks With You** (phases 13-18)

v0.1.0 shipped as phases 1-12 and is complete. Their goals, success criteria and plan lists are
archived at `.planning/milestones/v0.1.0-phases/`, with the requirements at
`.planning/milestones/v0.1.0-REQUIREMENTS.md` and the v0.1.0 audit at
`.planning/v0.1.0-MILESTONE-AUDIT.md`. Nothing from them is restated here.

## Overview

v0.1.0 proved the loop: a board that is the store of record, agents working in durable worktrees,
context that reconstitutes from the board alone, Socratic epic authoring, an agent-authored backlog
behind a human triage gate, git truth, review and merge, fan-out, fleet supervision and a shipped
build. What it left behind is **encoding work**: forms Cyril fills that an agent could have drafted,
and a surface he does not especially want to return to.

v0.2.0 removes the encoding and gives the board a layer above epics to think in. The sequence is
forced by one correctness property and one owner decision:

- **The fence comes before the records.** Three new record types (PRD, ADR, Cycle) above a fixed
  three-level spine is exactly how rigidity erodes. The existing no-promotion gate names four
  tables by literal substring, so a `prds`, `adrs` or `cycles` table is invisible to it and the
  passing gate would say nothing about them. Making the gate closed-world, pinning the spine DDL and
  bounding the context packet are preconditions, not hygiene — which is why **Phase 13** exists and
  why it is mostly tests, gates and deletions.
- **Colour appears one phase later, not five.** The research's literal dependency order (fence,
  live proofs, records, drafts, review, visual) puts the first visibly different pixel after four
  invisible phases, and the owner's opening request was colour and life. The owner's ruling
  (REQUIREMENTS decision 13, 2026-10-14): **exactly one foundation phase before colour**. So the
  state-colour vocabulary is structure, not polish, and it ships in **Phase 14** with the first new
  surface — the Cycle and roadmap region, which has zero agent dependency and is the first consumer
  of state colour. Only *application and tuning* waits for the end (Phase 18).

**Structure:** vertical slices on a fenced foundation. Phase 13 is the one horizontal phase in the
milestone and it is deliberate; every phase after it delivers a surface Cyril can open, on a seeded
demonstration board carrying real state.

**Why Phase 14 is written the way it is.** Phase 8.1 spent 21 plans on visual polish and the owner
called the result lifeless. The diagnosis is on record: its comps were judged on FIXTURE rows with a
lead epic named `test`, its must-haves were all mechanical, and its one perceptual criterion (SC0)
was deferred. Phase 14 therefore carries three things as **success criteria, not tasks** — the
seeded demo board with every state live at realistic density, a written hierarchy statement, and an
owner verdict on the BUILT application with a screenshot, which adopting a comp cannot satisfy.

### Pitfall placement

The six critical pitfalls from `research/v0.2.0/PITFALLS.md` are addressed in the phase that first
makes them possible, and each prevention lands as a success criterion rather than a task:

| Pitfall | Phase | Prevention carried as a criterion |
|---------|-------|-----------------------------------|
| 4 The spine erodes because new records sit outside the fence | 13 (before any record table exists) | Closed-world table classification, spine DDL pin, extended no-promotion corpus, hierarchy depth test |
| 6 The context packet grows without bound (`/clear` stops being free) | 13 (before records wire into the packet) | Fixed counts, link-based inclusion, visible boundary sentence, scale test, `SUMMARIES_SQL` fixed not allowlisted |
| 7 The Cycle layer drags in the PM long tail | 13 (gates) + 14 (schema) | Forbidden-identifier gate, column allowlist, derived progress, no dates or capacity anywhere |
| 3 The redesign still does not change the feeling | 14 | Seeded demo board, hierarchy statement, owner verdict on the built surface with a screenshot |
| 1 Draft-and-accept becomes a review chore | 15 | Per-item acceptance, no bulk-accept identifier anywhere, open-drafts cap with back-pressure, post-accept revision rate measured from events |
| 5 The PRD becomes a wiki | 16 | Closed slots, derived coverage, bar items enter the packet, no human-writable freshness column |
| 2 The pre-review becomes a confidence machine | 17 | No-self-grading gate first, three-valued verdicts, no aggregate badge, planted-defect calibration shown where verdicts are read |
| 8 ADRs neglected or flooding | 16 | Two options minimum, per-run cap, FTS duplicate flag, one decision registry (CTX-06), superseded never enters the packet |
| 9 Dark-mode and colour-as-signal failures | 14 (vocabulary) + 18 (values) | CVD distinguishability test, per-mode contrast over every tint, ground lightness floor, single state component |
| 14 Closing on proxies and deferrals | every phase with a surface | One owner-verdict criterion per user-visible surface; a deferral may not satisfy it |

### Pre-existing defect placement

`research/v0.2.0/SUMMARY.md` names eleven defects no requirement covers. **F2** (the
`brand-rule.test.ts` planning-path reads) was repaired on 2026-10-14 (`ac8715e`) and needs no work.
The remaining **ten (F1, F3…F11)** are placed here; each is named in the phase that fixes it:

| Defect | Phase | What it is |
|--------|-------|------------|
| F1 | 13 | The 10-proposal cap hits authoring runs and its refusal names `report_summary`, a tool an authoring session does not have |
| F4 | 13 | `set_priority` / `set_estimate` have no `_in_tx` form (narrowed by decision 8 to whichever writer survives the field audit) |
| F5 | 13 | `start_agent_run` writes `tasks.status` directly, past the Phase 6 gate — must be refactored or allow-listed with a reason before the gate widens |
| F6 | 13 | Run kind is inferred from column shape in four places; `agent_runs.kind` replaces it |
| F7 | 13 | An older build cannot open a newer DB; "reversible" means backup-and-restore and no test covers `DatabaseTooFarAhead` |
| F8 | 13 | The `board:changed` payload is discarded, so every subscriber invalidates on every event (FNC-07) |
| F9 | 13 | Surfaces are chosen by a nested ternary outside the keyboard layer model (FNC-06) |
| F11 | 13 | The capabilities roster string and 148 `commands::` entries are hand-maintained; `generate_handler!` is the real enforcement point |
| F3 | 15 | Criteria cannot be drafted for an existing hand-made task — `materialise_proposal` requires a parent proposal (DRFT-10) |
| F10 | 15 | Draft file-sets are live and agent-attributed before approval; provenance must read "drafted by the planner" from the event actor |

Phase 13 also carries the **CLAUDE.md reconciliation**: four entries in the project's stack table
are not in the tree (`@monaco-editor/react`, `@xyflow/react`, `git2`, `@anthropic-ai/claude-agent-sdk`),
and CLAUDE.md is read as authoritative every session. The same plan corrects PROJECT.md's claim that
the Phase 6 gate scans `packages/desktop/src` (it scans `sidecar/src`) and audits the remaining
`*.browser.test.tsx` files that read `.planning/phases` paths.

### Decisions this roadmap makes

Four questions were left to roadmapping. Each is settled here, in the open:

1. **Agent review is its own phase (17), parallel-eligible with 16 — not a tail of the records
   phase.** It shares no file with PRD/ADR work (`review_findings`, `review.rs`, the criteria
   overlay and the fleet label, against `prd.rs`/`adr.rs` and their surfaces), and its risk is a
   different kind: Pitfall 2 is a human-factors failure whose prevention (the no-self-grading gate,
   the three-valued schema, the planted-defect harness) must be the phase's *first* plan. Scheduled
   as the tail of a records phase whose own research flag is about PRD prompt design, it would be
   planned last and gated weakest. It may execute beside 16; it must not be absorbed into it.
2. **The drafting work splits in two, not one phase.** DRFT-04/05/06 are deletions and derivations,
   not an engine: status becomes derived (which requires F5 fixed and the authority gate widened),
   `estimate` leaves every required flow, priority becomes an opt-in suggestion. They belong with
   the fence in Phase 13, where that gate and F4/F5 already live. DRFT-09 is the *per-run production*
   cap — run-kind policy that lands with `agent_runs.kind` and F1, also Phase 13. What remains in
   Phase 15 is the actual engine: drafts, per-item acceptance, the *per-project attention* cap
   (DRFT-08, a different quantity from DRFT-09), lint, staleness, instrumentation and the file-set
   editor.
3. **VIS splits across 14 and 18**, per the W7a/W7b distinction. Phase 14 takes the vocabulary and
   the structure — the single state component and its source gate, the four tokens per class, the
   CVD test, the per-mode contrast enumeration, forced-colors fallbacks, the decision superseding
   D-11, the demo board, the owner verdict. Phase 18 takes application and tuning — the values, the
   dark-first switch, the signal budget, and a final per-surface verdict once the IA exists.
4. **CONV-06 (the since-you-left digest and a single explained next action) stays deferred, with a
   named trigger.** The case for it is real: it is the most direct answer to "a surface he wants to
   return to", and the owner's standing preference is one concrete next action rather than a menu.
   The case against it wins on timing, not value. A digest is a *ranking over derived state*, and
   three of the four things it would rank — pending drafts (15), PRD/ADR drift and uncovered bar
   items (16), review verdicts awaiting adjudication (17) — do not exist until this milestone's last
   phase closes. Meanwhile **RECD-09 already delivers the half that is derivable today** (current
   Cycle progress and the roadmap ahead, on screen without navigating), and Phase 10's blocked queue
   already answers "what needs me?" across every project. Adding a 47th requirement to the final
   visual phase is precisely the pattern that produced 8.1. **Named trigger: Phase 17 closing.** At
   that point every input exists, the digest is a read and a sort, and it is a v0.2.x phase of its
   own rather than scope smuggled into a polish pass.

**DIST-01 is not scheduled here.** It is deferred out of the milestone with a named unblocking
trigger — an Apple Developer Program membership existing — recorded in
`.planning/REQUIREMENTS.md` ("DIST-01 — deferred, not dropped"). Plan `11-07` is written, has zero
tasks executed and runs unchanged once that account exists. It is deliberately **not** one of the 46
mapped requirements and deliberately **not** an orphan.

## Phases

**Phase Numbering:**

- Numbering continues from v0.1.0. The last v0.1.0 phase was 12; the first v0.2.0 phase is 13.
- Integer phases (13, 14, 15): planned milestone work
- Decimal phases (14.1, 14.2): urgent insertions (marked INSERTED), executing between their
  surrounding integers in numeric order

**Shipped (v0.1.0, phases 1-12):** complete; detail archived at `.planning/milestones/v0.1.0-phases/`.

- [ ] **Phase 13: Nothing New Escapes The Fence** - The spine, the gates and the packet are closed-world before a single new record type exists, the ten carried defects are paid, and the unread fields are gone
- [ ] **Phase 14: Cycles On Screen, State In Colour** - The current Cycle and the roadmap ahead are always visible, and every state carries saturated colour that is never the only channel
- [ ] **Phase 15: Nothing Typed That An Agent Could Draft** - File-sets, criteria and decomposition arrive drafted and are accepted one item at a time, proven against a live backend
- [ ] **Phase 16: The Problem And The Decision Are Board Records** - A PRD with closed slots and a signed bar, and ADRs an agent proposes at a real fork, both reaching the agent's context bounded and revision-pinned
- [ ] **Phase 17: Pre-Reviewed, Never Pre-Approved** - An agent with no memory of writing the code reports evidence per criterion, and only a human ever marks one satisfied
- [ ] **Phase 18: Dark By Design, Calm When Healthy** - The direction applied across every surface the milestone built, dark-first and budgeted so colour only shouts where something needs you

## Phase Details

### Phase 13: Nothing New Escapes The Fence

**Goal**: Every structural guarantee the milestone is about to lean on is closed-world and asserted
*before* the first new record type exists — the spine cannot erode, an unclassified table fails the
build, authority is reachable only from a human, the context packet is bounded, and the fields nobody
reads are gone rather than drafted.
**Mode:** mvp
**Depends on**: Phase 12 (last v0.1.0 phase)
**Requirements**: FNC-01, FNC-02, FNC-03, FNC-04, FNC-05, FNC-06, FNC-07, DRFT-04, DRFT-05, DRFT-06, DRFT-09
**Defects fixed here**: F1, F4, F5, F6, F7, F8, F9, F11
**Success Criteria** (what must be TRUE):

  1. A table added to the database with no entry in the classification list fails the build, and a change to the `epics`, `tasks` or `issues` `CREATE TABLE` text fails unless the pin is edited in the same diff; the adversarial no-promotion corpus runs with `prd`, `adr` and cycle-assignment as target types and passes every verb-by-target case; the foreign-key chain above `epics` ends at the cycle table, which has no parent, and no other table references it.
  2. Every authority transition — sign-off, acceptance, checking a criterion, accepting an ADR — refuses an agent actor at the database and is unreachable from agent-reachable code, proven two-sided: an agent attempting it is refused, and a human performing it is not blocked. The three sites that write past the current gate, including `start_agent_run` writing `tasks.status`, are each either refactored or allow-listed with the reason recorded in the same diff.
  3. A build containing `velocity`, `burndown`, `burnup`, `capacity`, `story_point`, `sprint`, `deadline`, `due_date`, `overdue` or `rollover` in core or desktop source fails; `estimate` appears in no required flow and is asked for nowhere; priority is reachable only as an explicit opt-in suggestion carrying its reasoning; and a task's status is derived from git and forge state, with the one non-derivable transition (backlog→todo) riding the acceptance of the task itself and no agent-writable path to any other status.
  4. Assembling the context packet for a fixture of 200 summaries, 40 ADRs and a 30 KB PRD stays at or below a fixed bound, states its own inclusion boundary in the prompt the user reads ("3 of 7 ADRs included: accepted, constrain this epic"), is strictly smaller for a small fixture, and is byte-identical when a superseded ADR is added. No unbounded read of summaries, decisions or records remains: `SUMMARIES_SQL` is fixed rather than allowlisted, and the unbounded-reads gate scans `context_packet.rs` and every new record query module.
  5. Which surface is showing is one modelled value inside the keyboard layer model rather than a nested conditional outside it, and a board change wakes only the readers it affects — observable as an event in one project no longer re-fetching an unrelated project's views.
  6. A run that hits its per-run proposal cap is refused with wording that fits the kind of session it is, a legitimate decomposition is not throttled by that cap, and the amendment to D-109 is recorded as an owner decision. A live, credential-spending planning run exists as a recorded artifact showing the planner naming real files from the repository *(this measurement starts on day one and runs in parallel; it serves DRFT-01, whose home is Phase 15 — the hand-typed path field is not retired until this artifact exists)*.

**Research flag**: **Yes, one policy decision only** — how decisions are folded in the bounded
packet. Bounding the existing terms conflicts with compaction's "lossless for decisions and file
paths", and D-69 explicitly rejected size ceilings because a ceiling moves the boundary for reasons
the developer cannot see. Any bound must use fixed counts, link-based inclusion and a visible
boundary sentence; "truncate at N tokens" is out. Whether acknowledged or superseded decisions drop
from the folded residue is a deliberate decision to take before planning, not during.
**Plans**: 6/11 plans executed, 6 waves

Plans:
**Wave 1**

- [x] 13-01-PLAN.md — tracer: the PM-vocabulary gate (FNC-04), two-sided, wired into `cargo test -p core`

**Wave 2** *(blocked on Wave 1 completion)*

- [x] 13-02-PLAN.md — bound the context packet at its input, with the drift detector in the same diff (FNC-05)
- [x] 13-03-PLAN.md — drop `estimate` from schema, domain, queries and UI; prove `criterion_anchors` survive the rebuild (DRFT-05, F4)

**Wave 3** *(blocked on Wave 2 completion)*

- [x] 13-04-PLAN.md — CLAUDE.md/PROJECT.md reconciliation, the too-far-ahead database test, the handler roster gate, A-01…A-04 (F7, F11)
- [x] 13-05-PLAN.md — spine DDL pin and table classification; the no-promotion gate covers tables by class (FNC-01, FNC-02)
- [x] 13-06-PLAN.md — hand-made tasks at `todo`; priority as an opt-in suggestion carrying its reasoning (DRFT-06)

**Wave 4** *(blocked on Wave 3 completion)*

- [ ] 13-07-PLAN.md — derived task status with an explicit floor; F5's raw write and `StatusPicker` deleted (DRFT-04, F5)

**Wave 5** *(blocked on Wave 4 completion)*

- [ ] 13-08-PLAN.md — one `UiSurface` union with one resolver inside the keyboard layer model (FNC-06, F9)
- [ ] 13-09-PLAN.md — authority transitions human-only, two-sided, with the three write-past-the-gate sites dispositioned (FNC-03)
- [ ] 13-10-PLAN.md — project-routed `board:changed` payload through one emit helper (FNC-07, F8)

**Wave 6** *(blocked on Wave 5 completion)*

- [ ] 13-11-PLAN.md — per-kind proposal cap and refusal; run kind gets one definition (DRFT-09, F1, F6)

### Phase 14: Cycles On Screen, State In Colour

**Goal**: Cyril sees where the work stands without going to look — the current Cycle's goal and
progress and the roadmap ahead of it, folded from real counts — and the board finally carries
saturated state colour on a surface worth looking at, with colour as the fastest channel and never
the only one.
**Mode:** mvp
**Depends on**: Phase 13
**Requirements**: RECD-08, RECD-09, RECD-10, VIS-01, VIS-02, VIS-03, VIS-04, VIS-06, VIS-07
**Success Criteria** (what must be TRUE):

  1. User sees the current Cycle's goal, its ordering and its progress, and the roadmap ahead of it, without navigating to them; the progress number is folded from the real task counts of every epic in the Cycle and matches a full count over a 900+ task board, not the 200-row paged window. No stored percentage exists, and the Cycle has no date, duration, capacity or velocity column anywhere in its schema or its UI — its column set is an exact allowlist a new column fails.
  2. User closes a Cycle and is asked what happens to each unfinished epic rather than having them silently moved, and a Cycle whose scope changed after it started says so on its own row. An epic belongs to at most one Cycle, Cycles never nest, and a Cycle holds epics scope-boxed and undated.
  3. Every state on screen — running, blocked, failed, awaiting review, merged, proposals pending — is rendered by the single component that is the only consumer of the state colour tokens, always carrying a glyph and a word or accessible name beside the colour; a component referencing a `--state-*` token directly fails the build; every pair of state colours stays distinguishable under simulated protanopia, deuteranopia and tritanopia; every text role is contrast-checked against every surface tint it can appear on in both modes against the shipped stylesheet bytes; and forced-colors mode keeps every state readable.
  4. The decision that introduces saturated state colour names D-11 in a SUPERSEDES table, and the specification, the brand allowlist and the tests that enforce them are amended in the same change — including the existing colour consumers (`RUN_STATUS_COLOR_ROLES`), with `merged` and `awaiting review` registered in the marks legend, which no mark may exist without.
  5. All of the above is built and judged on a **seeded demonstration board carrying every state live** — running, blocked, failed, awaiting review, proposals pending, an epic mid-flight, a realistic item count — and never on fixture rows; its lead row is real work, not a junk epic. A written **hierarchy statement** for the region ("this region is the focal point; these are the three levels") exists before the visual work and the built region realises it.
  6. The **owner signs off looking at the running application** on that board, with a screenshot recorded. Adopting a comp or a direction document does not satisfy this criterion, and it cannot be deferred to a later phase.

**Research flag**: **No** for the code paths — the Cycle schema, the progress fold, the region and
the token work are established patterns in this repository. The direction document's values (which
states get washes, the CVD thresholds, the ground lightness floor) are a design artifact *of* this
phase, tuned on the demo board, not a research round before it. OS-following and dark-first are
already settled (REQUIREMENTS decisions 1 and 13).
**Plans**: TBD
**UI hint**: yes

### Phase 15: Nothing Typed That An Agent Could Draft

**Goal**: The encoding work is gone. File-sets, acceptance criteria and decomposition arrive
drafted by an agent and are accepted one item at a time, the hand-typed path field survives only as
an escape hatch, and the product can tell reflex acceptance from good drafting rather than assuming.
**Mode:** mvp
**Depends on**: Phase 14 (new surfaces are born on state tokens) and Phase 13's live planning
artifact
**Requirements**: DRFT-01, DRFT-02, DRFT-03, DRFT-07, DRFT-08, DRFT-10, DRFT-11, DRFT-12
**Defects fixed here**: F3, F10
**Success Criteria** (what must be TRUE):

  1. User starts planning and the planner declares each task's expected file-set, observed working against a live backend and recorded as an artifact; the declared paths show as chips marked "drafted by the planner", derived from the event actor rather than stored; and the hand-typed path field is still there as the same form with no prefill — an escape hatch, not the path of record.
  2. A task created or started gets its acceptance criteria drafted by default, and a run on a task with no criteria routes through drafting first rather than proceeding without them; criteria can be drafted for a task that was created by hand long before the session, not only for one an agent proposed in the same run; a draft that fails the deterministic lint (compounds, vague verbs, no observable) never reaches the user, and a criterion with no verification hint is stored flagged judgement-only and counted as such.
  3. User decomposes an epic or task and accepts, rejects or amends each child individually: the unit of acceptance is the field for a scalar and the item for a structure, and **no bulk-accept control, label, handler or identifier exists anywhere in the product** — asserted by the source test extended to every new draft surface. Accepting a draft computed against a revision that has since moved is refused with a diff rather than applied.
  4. Open drafts are capped per project with visible back-pressure: at the cap the agent stops drafting and says so loudly, no drafting run can accumulate an unreviewable queue, and no path exists that sweeps the existing 900-task board into drafts. The cap is a constant asserted by test, not a setting.
  5. The product reports what fraction of accepted drafts were revised afterwards, derived from the event log, so reflex acceptance is distinguishable from good drafting by a number rather than by belief.
  6. A real backend rate or session limit is observed in a live run, backed off from, and surfaced in the run's own state rather than retried blindly — with the measurement recorded, since this gate has never been exercised against a real limit. The owner signs off on the built drafting surfaces on the demo board, with a screenshot.

**Research flag**: **Yes.** Live planner behaviour cannot be settled from a desk — the `--live`
measurement (planning prompt with a `git ls-files` listing, read tools allow-listed, `Bash`
unlisted) decides whether file-set declaration is real, and Claude Code's default-mode handling of
read tools versus `Bash` is unverified. Also needed before planning: the per-field tier decision
(provisional versus explicit) and the values for the open-drafts cap, since no measured acceptance
behaviour for this product exists yet — the only datum is 1 of 42 amended, which cannot distinguish
good drafting from reflex acceptance. Instrument first, tune after.
**Plans**: TBD
**UI hint**: yes

### Phase 16: The Problem And The Decision Are Board Records

**Goal**: Cyril states a problem, is challenged on it, and walks away with a PRD whose slots and
acceptance bar are structured board data he signs off on — and an agent that reaches a real fork
proposes the decision rather than choosing silently. Both reach the next agent's context bounded,
revision-pinned and never as instructions.
**Mode:** mvp
**Depends on**: Phase 15 (cap policy, per-item acceptance and link-on-accept) and Phase 14 (state
tokens)
**Requirements**: RECD-01, RECD-02, RECD-03, RECD-04, RECD-05, RECD-06, RECD-07, RECD-11, RECD-12, RECD-13
**Success Criteria** (what must be TRUE):

  1. A PRD exists as a board record with closed, named slots — problem, appetite, solution sketch, rabbit holes, no-gos — each independently revisioned and amendable, with no free-form body beyond the problem statement. It is signed off by one human act against one named immutable revision; editing after sign-off creates a new revision rather than overwriting and marks the linked epics "PRD moved" until a human acknowledges it. The Socratic shaping session's output is structured board data written through the staging path, never a transcript, and the owner's quality verdict on a live shaping run is recorded.
  2. Small work proceeds with no PRD and nothing in the product requires one to start: an epic without a signed-off PRD reads as a neutral, countable "unanchored" state rather than an error, and a 1:1 PRD-to-epic ratio is surfaced as a smell rather than as success.
  3. The PRD carries its acceptance bar as discrete checkable items on the existing `acceptance_criteria` mechanism — **conditional on the anchor-preservation test, which is the first plan of this phase**: if `criterion_anchors` rows do not survive the table rebuild, RECD-04 is amended in the open to the Markdown-checklist fallback rather than silently weakened. Either way coverage is derived — every bar item has a covering epic criterion or is explicitly deferred with a reason — and a PRD-parented criterion never appears in a task packet.
  4. An ADR exists with states proposed, accepted, rejected and superseded; the body of an accepted ADR is immutable; superseding is atomic, with no committed state in which both the superseded record and its successor are accepted; and a rejected ADR is retained as negative knowledge so the same decision is not re-proposed. An agent that reaches a genuine fork proposes an ADR naming at least two options with their trade-offs and a reversibility class — the writer refuses fewer — rate-limited per run below the generic cap, checked against existing ADRs for duplicates before the user sees it, and a reversible fork proceeds on a stated provisional default without blocking the run.
  5. Accepted ADRs that constrain an epic, and the PRD bar items for that epic, enter the agent's context packet bounded by fixed counts and link relevance, pinned to the revision that was read, with the inclusion boundary stated to the user in the CTX-05 style — as data in a labelled section, never merged into the instruction text. Superseded and draft records never enter, removing a linked bar item changes the assembled packet, and a record revised after a session read it is surfaced as a contradiction by the existing CTX-06 detector — one decision registry, not two.
  6. A Cycle holds epics from more than one PRD and a PRD spans more than one Cycle, with no state in which an epic belongs to two Cycles. The owner signs off on the built PRD and ADR surfaces on the demo board, with a screenshot.

**Research flag**: **Yes.** Needed before planning: the Socratic PRD session's prompt design and its
live acceptance harness with credential isolation (reuse SHAPE-01's, whose thirteen rounds are the
cost of skipping this); what the acceptance bar actually contains and how epics are proposed from a
PRD; the packet size budget for record sections; and confirmation in this phase's research of where
a *proposed* ADR lives (staging-only versus `adrs.status = 'proposed'` behind a human-only writer) —
the research's own ruling here is its least confident, and the PRD slot shape is a composition no
single source proposed.
**Plans**: TBD
**UI hint**: yes

### Phase 17: Pre-Reviewed, Never Pre-Approved

**Goal**: Cyril adjudicates evidence instead of reading a diff cold — an agent with no memory of
having written the code reports, per criterion, what it found and where — and nothing about that
report can mark a criterion satisfied or move code toward a merge.
**Mode:** mvp
**Depends on**: Phase 13 (run kinds, findings table, authority gate) and Phase 14 (state tokens).
**May execute in parallel with Phase 16** — it shares no file with the records work.
**Requirements**: ARVW-01, ARVW-02, ARVW-03, ARVW-04, ARVW-05, ARVW-06
**Success Criteria** (what must be TRUE):

  1. A task's diff is reviewed against that task's acceptance criteria in a session primed from the criteria and the diff only, carrying no memory of having written the code and no access to the authoring session's reasoning; it reads the diff through the same functions the review UI uses and is never given `Bash`; its subject is the review task, so a completed review leaves the execution task's assembled context packet byte-identical and does not displace the execution run in the fleet view.
  2. Each criterion carries one of three verdicts — met, not met, or cannot determine — with cannot-determine first-class and *required* where there is no verification hint and no external signal. No aggregate "all criteria met" element exists anywhere and no confidence score is shown; the header states counts by evidence type, rows sort weakest-evidence first, a claim with no evidence link renders as "no evidence" rather than "met", and the view states how many hunks support no criterion at all, with hunks outside the declared file-set shown as a distinct class.
  3. A verdict never writes a criterion's checked state and can never enable an automatic merge: a source gate fails if any agent-reachable module writes `acceptance_criteria.checked`, the writer refuses an agent actor for that column, and no path leads from a verdict to auto-merge. Only a human check marks a criterion satisfied — proven two-sided, with the human path not blocked.
  4. Every verdict is anchored to the lines it refers to and its freshness is derived from the existing anchor-staleness mechanism rather than stored; the review reads the criteria revision recorded at task start and flags any criterion revised after work began.
  5. Pre-review is off by default and happens only when explicitly invoked.
  6. A planted-defect harness runs the reviewer over diffs with known unmet criteria, and its measured false-"met" rate is visible in the place the verdicts are read — not in a document. The owner signs off on the built review surface on the demo board, with a screenshot.

**Research flag**: **Yes, including a live measurement.** What external evidence the reviewer can
actually obtain (test runs, type checks, captured command output) decides whether `met` can ever be
honest, and no study was found of a developer adjudicating an LLM's pre-review of its own diff.
Whether Claude shows self-preference judging its own code is unmeasured — the planted-defect harness
is how Flywheel measures it for itself. Needs a credential-spending run in the style of
`uat-10 --live`.
**Plans**: TBD
**UI hint**: yes

### Phase 18: Dark By Design, Calm When Healthy

**Goal**: The direction lands on the information architecture the milestone built — dark-first with
a light mode derived from it, and a surface that is quiet when the fleet is healthy and loud only
where something needs the human.
**Mode:** mvp
**Depends on**: Phase 16 and Phase 17 (every surface the direction applies to must exist)
**Requirements**: VIS-05, VIS-08
**Success Criteria** (what must be TRUE):

  1. The interface is designed dark-first and follows the operating system's setting, with the light mode derived from the dark design rather than the reverse; the ground stays above a pinned lightness floor and is not near-black, body text is not pure white, elevation is expressed by surface lightness steps, and the per-mode contrast assertion and the dark-drift parser change in the same diff as the switch.
  2. In a steady-state screenshot of the seeded demonstration board with a healthy fleet, the number of elements carrying saturated state chroma is at or below a fixed budget; in a bad-state board, the blocked and failed region has the greatest local contrast on the screen. This check is a cheap regression catch for always-loud, and it does not replace the owner's verdict.
  3. Every surface this milestone built is signed off by the owner looking at the running application on the demonstration board, with a screenshot recorded per surface, and the perceptual criteria carried in the `owner-question` register from Phase 8.1 — SC0 among them — are each either answered on the built product or closed with a recorded reason. No deferral satisfies any of these.

**Research flag**: **Yes, design only, no code research.** The tuned values — which states get
washes, chroma ceilings per mode, CVD thresholds, the signal budget number — are principles in the
research, not findings, and must be settled on the demo board at real density. The forced-dark
versus OS-follow question is already decided (OS-follow, dark-first: REQUIREMENTS decision 1).
**Plans**: TBD
**UI hint**: yes

## Requirement Coverage

**46 of 46 v0.2.0 requirements map to exactly one phase. No orphans, no duplicates.**
DIST-01 is not among the 46: it is deferred out of the milestone with a named unblocking trigger and
is deliberately unscheduled, so the milestone total stays 46 and the deferral is recorded rather
than counted.

| Phase | Requirements | Count |
|-------|--------------|-------|
| 13. Nothing New Escapes The Fence | FNC-01, FNC-02, FNC-03, FNC-04, FNC-05, FNC-06, FNC-07, DRFT-04, DRFT-05, DRFT-06, DRFT-09 | 11 |
| 14. Cycles On Screen, State In Colour | RECD-08, RECD-09, RECD-10, VIS-01, VIS-02, VIS-03, VIS-04, VIS-06, VIS-07 | 9 |
| 15. Nothing Typed That An Agent Could Draft | DRFT-01, DRFT-02, DRFT-03, DRFT-07, DRFT-08, DRFT-10, DRFT-11, DRFT-12 | 8 |
| 16. The Problem And The Decision Are Board Records | RECD-01, RECD-02, RECD-03, RECD-04, RECD-05, RECD-06, RECD-07, RECD-11, RECD-12, RECD-13 | 10 |
| 17. Pre-Reviewed, Never Pre-Approved | ARVW-01, ARVW-02, ARVW-03, ARVW-04, ARVW-05, ARVW-06 | 6 |
| 18. Dark By Design, Calm When Healthy | VIS-05, VIS-08 | 2 |
| **Total** | | **11 + 9 + 8 + 10 + 6 + 2 = 46** |

By category, as a cross-check against `REQUIREMENTS.md`:

| Category | Count | Phases |
|----------|-------|--------|
| RECD (Records: PRD, ADR, Cycle) | 13 | 14 (RECD-08, 09, 10), 16 (RECD-01, 02, 03, 04, 05, 06, 07, 11, 12, 13) |
| DRFT (Drafting) | 12 | 13 (DRFT-04, 05, 06, 09), 15 (DRFT-01, 02, 03, 07, 08, 10, 11, 12) |
| ARVW (Agent-assisted review) | 6 | 17 (all) |
| VIS (Visual direction) | 8 | 14 (VIS-01, 02, 03, 04, 06, 07), 18 (VIS-05, 08) |
| FNC (Integrity and fencing) | 7 | 13 (all) |
| **Total** | **13 + 12 + 6 + 8 + 7 = 46** | **6 phases** |

**Deliberate cross-category placements** (a requirement placed outside its category's home phase,
with the reason):

| Requirement | Phase | Why |
|-------------|-------|-----|
| DRFT-04 (status derived, never agent-written) | 13 | It is an authority property before it is a drafting one: it needs F5 (`start_agent_run` writing `tasks.status` past the gate) fixed and the FNC-03 human-only gate widened, both of which land here |
| DRFT-05 (`estimate` out of required flows) | 13 | A deletion, and the hook the PM long tail arrives through (`SUM(estimate)` per Cycle is velocity in one query) — it belongs with FNC-04's forbidden-identifier gate, before the Cycle layer exists |
| DRFT-06 (priority opt-in only) | 13 | Same deletion pass; what survives of it is the writer F4 adds, not an engine |
| DRFT-09 (per-run proposal cap) | 13 | It is run-kind policy: it lands with `agent_runs.kind` (F6) and the F1 repair. Distinct from DRFT-08, the per-project attention cap, which is a different quantity and stays in 15 |
| DRFT-01 (planner declares file-sets; closes PLAN-01) | 15 | Its live measurement starts on day one of Phase 13 and runs in parallel, because it has the longest feedback loop — but the requirement completes only when the file-set editor exists and the hand-typed field becomes an escape hatch, which cannot happen before the live artifact does. Mapped to 15 only; Phase 13 carries the measurement, not the requirement |
| RECD-08, 09, 10 (the Cycle layer) | 14 | The Cycle is the first visible surface and has zero agent dependency, so it is the first consumer of state colour; PRD and ADR need the cap policy and link-on-accept from 15 and cannot lead |
| RECD-13 (a Cycle may hold epics from several PRDs) | 16 | It is a statement about PRD↔epic linkage, which cannot be asserted until PRDs exist |
| VIS-01, 02, 03, 04, 06, 07 (vocabulary and structure) | 14 | W7a: surfaces must be *born* on state tokens, and this is where saturated colour first appears — the owner's sequencing decision puts it one phase after foundations, not five |
| VIS-07 (owner signs off on the built application) | 14 | Mapped once, in the phase that establishes the practice; every later phase with a surface re-asserts it as a success criterion of its own, which is the Pitfall 14 prevention |
| VIS-05, 08 (dark-first switch, signal budget) | 18 | W7b: application and tuning need every surface to exist. These are the only two requirements that genuinely cannot be judged earlier, which is why Phase 18 is deliberately the smallest phase in the milestone rather than a padded polish round |

**Not mapped, by decision:**

| Item | Status |
|------|--------|
| DIST-01 (signed, notarized macOS build) | Deferred out of v0.2.0 with a named trigger — an Apple Developer Program membership existing. Plan `11-07` is written, zero tasks executed, and runs unchanged once that account exists. Owner decision 2026-10-14, confirming D-REV-60 |
| CONV-06 (since-you-left digest, single explained next action) | Stays in v0.2.x, with a named trigger: Phase 17 closing. Three of the four inputs it would rank do not exist until then; RECD-09 and the Phase 10 blocked queue already deliver the derivable half. Argued in full under "Decisions this roadmap makes" |
| CONV-01, 02, 03, 04, 05 | Acknowledged in `REQUIREMENTS.md` as v0.2.x and later; not in this milestone's roadmap |

## Progress

**Execution Order:**
Phases execute in numeric order, with one parallel pair: 13 → 14 → 15 → (16 ∥ 17) → 18.
Phase 17 shares no file with Phase 16 and may run beside it; it may not be absorbed into it.

| Phase | Plans Complete | Status | Completed |
|-------|----------------|--------|-----------|
| 13. Nothing New Escapes The Fence | 6/11 | In Progress|  |
| 14. Cycles On Screen, State In Colour | 0/0 | Not started | - |
| 15. Nothing Typed That An Agent Could Draft | 0/0 | Not started | - |
| 16. The Problem And The Decision Are Board Records | 0/0 | Not started | - |
| 17. Pre-Reviewed, Never Pre-Approved | 0/0 | Not started | - |
| 18. Dark By Design, Calm When Healthy | 0/0 | Not started | - |

---
*Roadmap rewritten for v0.2.0: 2026-10-14 (v0.1.0's phases 1-12 complete; detail archived at `.planning/milestones/v0.1.0-phases/`)*
*Granularity: standard · Structure: vertical slices on a fenced foundation · 6 phases (13-18) · 46/46 v0.2.0 requirements mapped · DIST-01 deferred with a named trigger · CONV-06 deferred with a named trigger*
