# Pitfalls Research: v0.2.0 "The Board Thinks With You"

**Domain:** Adding a board-native authoring layer (PRD, ADR, phase) and an agent-drafts/human-accepts model to a shipped agentic development environment, then redesigning its visual direction
**Researched:** 2026-10-14
**Confidence:** MEDIUM overall. The codebase evidence is HIGH (read directly). The human-factors effects are HIGH as effects but MEDIUM in transfer: no study found measures developers adjudicating an LLM's pre-review of its own diff, so the transfer from clinical decision support, recruiting and generic AI-assisted decisions is inference and is labelled as such.

This file extends `.planning/research/PITFALLS.md` (v0.1.0). It does not repeat it. v0.1.0 pitfall 6 (agent backlog spam) is the direct ancestor of Pitfall 1 here; its answer (a staged "proposed" state, a rate limit, no bulk accept) is reused below, not re-derived.

## How to read this file

Each pitfall gives: what goes wrong, why, an observable warning sign, a prevention stated as something a requirement or acceptance criterion could assert, and an owning phase. Phase names are suggestions for the roadmapper, defined once in "Suggested phase vocabulary" at the end.

The pitfalls are ordered by how likely they are to sink the milestone, not by the question numbering. The question number is given in each heading.

**Severity ranking for this milestone**

| # | Pitfall | Why it ranks here |
|---|---------|-------------------|
| 1 | Draft-and-accept becomes a bigger chore than authoring (Q4) | The developer's explicit goal is LESS boring work. A bad implementation delivers more. |
| 2 | Agent pre-review becomes a confidence machine (Q5) | It silently degrades the Core Value ("real acceptance criteria") while looking like progress. |
| 3 | The redesign does not change the feeling (Q8, Q7) | It already happened once, at 21 plans of cost. |
| 4 | The spine erodes because new records sit outside the fence (Q6) | The rigid hierarchy is a stated differentiator, and the structural gates cover only four named tables. |
| 5 | Documents become a wiki decoupled from execution (Q1) | The existing evidence (15 criteria across 907 tasks) says optional authoring paths go unused. |
| 6 | The context packet grows without bound (Q9) | It is already unbounded and PRD/ADR text will want in. It threatens the product thesis. |
| 7 | The phase layer drags in the PM long tail (Q3) | Slow and easy to miss; one schema column away. |
| 8 | ADRs are written once, never consulted, or flood in (Q2) | Documented failure of every ADR practice, with a new agent-volume variant. |

---

## Critical Pitfalls

### Pitfall 1: Draft-and-accept becomes a review chore (Q4)

**What goes wrong:**
The milestone rule is "no form a human fills that an agent could have drafted." Implemented naively, a human who used to write 6 task titles now adjudicates roughly 40 machine-authored items: 6 tasks multiplied by title, body, 5 criteria, file-set, priority and estimate. The work moved, it did not shrink, and the new work is worse in kind: it is verification of text that is plausible by construction, which is the hardest thing for a tired person to do well. The failure has two exits and both are bad. Either the developer stops using the feature (the same fate as the manual criteria composer: Phase 8's audit found every task with a worktree carries ZERO criteria, and 15 criteria exist across 907 tasks), or the developer accepts everything reflexively, which silently turns the board's "real acceptance criteria" into agent output nobody read.

**Why it happens:**
Three mechanisms, all with named evidence.
- Approval volume trains reflex acceptance. Anthropic reports that Claude Code users approve 93% of permission prompts and calls the result approval fatigue: people stop paying attention to what they approve. Its answer was not to ask better; it was to stop asking for the safe majority and interrupt only on risk (auto mode). The analogue is direct: do not prompt for the safe majority of drafts.
- Acceptance probability decays within an encounter. In a clinical decision-support study of 112 clinicians, the odds a reminder was accepted fell about 30% for each additional reminder in the same encounter, and fell with repetition and work complexity but not with raw amount of work (Ancker et al. 2017). Forty items in one sitting is the shape that study found worst.
- Verification only beats relying when it is cheaper than the task. Vasconcelos et al. (CSCW 2023, five studies, N=731) formalise reliance as a cost-benefit choice: people over-rely when checking the AI costs about as much as doing the task. A draft that is as expensive to validate as to write will be waved through.

There is one local datum that cuts both ways and must not be misread. The SHAPE-03 live run drafted 42 criteria and one was amended. That is either excellent drafting or a reflex-accept signature, and the acceptance rate alone cannot distinguish them. Plan the instrumentation to tell them apart (below).

**What determines which side of the line a design lands on:**

| Variable | Chore side | Assist side |
|----------|-----------|-------------|
| Unit of acceptance | Per leaf field (about 36 decisions for a 6-task epic) | Per task, one decision, fields editable in place (6 decisions), or per decomposition shape (1 decision, then 6) |
| Default when ignored | Unaccepted draft blocks work (a gate) | Draft is applied as visibly provisional and the human's natural next action confirms it (Start Work is already the freeze point for criteria under BOARD-03) |
| Where it lands | A separate inbox or queue the human must visit | Inline, prefilling the same form the human was about to fill; reject is one key |
| Volume control | Bounded by what the agent produces | Bounded by a human-attention budget: when open drafts reach N, the agent stops drafting (back-pressure), and the gauge is visible |
| Pre-filtering | Human sees raw model output | Deterministic lint runs first (criterion lacks a verification hint, is a compound, duplicates a sibling, names no observable); failing drafts never reach the human |
| Field selection | Every field gets a draft | Only fields with downstream consumers and a ground truth are drafted |
| Confidence | Agent drafts a guess to fill the form | Agent asks a question or declares "unknown" instead of inventing (a file-set it cannot determine is "undeclared", not invented) |
| Feedback | Reject discards | Reject is kept and fed to the next draft (the epic packet already carries `REJECTED_VERBATIM_WINDOW`) |

The last-but-one row deserves its own warning. Several fields in the milestone's draft list should be deleted from the flow rather than automated:
- **Status** is already driven by git and forge state (LINK-07). An agent-drafted status is a second writer on a derived value.
- **Estimate** is `1|2|3` and **priority** is `0..4`. An agent has no business context to set priority, and a 3-valued estimate is noise. Drafting them is fabricated precision that costs a decision each. Ask of every field: does a consumer read it (dispatch ordering, packet, review)? If not, remove it from required flows (ponytail ladder rung 1: does it need to exist?).

**Warning signs (observable):**
- Open draft count per project rises faster than it is drained (the v0.1.0 Pitfall 6 signal, now for drafts).
- Median time-to-accept of a draft batch under about 2 seconds per item, or accept-without-expanding rate above about 90%.
- Edit rate near zero AND post-accept correction rate near zero is fine; edit rate near zero AND high post-accept correction (criteria revised after work started, items overridden at review) means reflex acceptance. The second number is the one that matters.
- The developer starts routing around the draft path (hand-editing, or leaving drafts unresolved).
- A "backfill" proposal appears: "draft criteria for the existing 907 tasks." That is the 40-versus-6 problem at 900x.

**Prevention (assertable):**
1. Acceptance granularity: acceptance is per task, never per field; assert there is no UI control or handler that accepts a set of drafts across tasks. Mirror the existing precedent: `TriageSurface.tsx` (D-104) has exactly two bulk controls (reject, defer) and a source test that no bulk-accept control, label, handler or identifier exists. Extend that exact test to every new draft surface.
2. Attention budget: a fixed cap on open agent drafts awaiting a human per project (precedent: PROP-05's fixed 10 per run). At the cap the agent stops drafting and says so loudly. Assert the cap by test, not config.
3. Deterministic pre-filter: drafted criteria are linted in code before display. Assert a draft that fails lint is never persisted as visible.
4. Field audit as a requirement: each drafted field names its downstream reader in the requirement text. A field with no reader is removed from required flows, not automated.
5. Provisional-with-undo for low-stakes fields; explicit accept only for criteria, file-sets, PRD sign-off and ADR acceptance. Assert acceptance events are actor-attributed (human) for the explicit tier.
6. Provenance survives acceptance: drafted_by (agent actor), accepted_by (human actor), edited flag, retained on the record (actors and the event log already exist: DATA-01, DATA-03). Assert an accepted agent draft is still distinguishable from human-authored text.
7. Instrumentation from the event log, not new telemetry: accept-without-expand rate, time-to-accept, edit rate per field, post-accept revision rate. The post-accept revision rate (criteria revised after the task started, BOARD-03 revisions) is the outcome metric; success is defined on it, not on "criteria count."
8. No backfill: drafting is triggered for the epic being shaped or the item the human opens, never as a sweep of the existing board. Assert no code path enumerates all tasks to draft.
9. One component, two sources: the agent path prefills the same form the manual path uses. Do not build a parallel "agent UI" and a "manual UI." This also removes the dead-fallback problem in Pitfall 10.

**Phase to address:** "Draft engine." The field audit and the cap must be in the phase's requirements before any drafting UI is built.

---

### Pitfall 2: The agent pre-review becomes a confidence machine (Q5)

**What goes wrong:**
The agent checks its own diff against the task's acceptance criteria and reports "all met." The reviewer, who is also supervising a fleet, defers. Three failure modes compound:
- **Automation bias and complacency.** Parasuraman and Manzey's integrative review (Human Factors 2010) finds automation bias (omission and commission errors when aids are imperfect) occurs in naive and expert participants, "cannot be prevented by training or instructions," and that complacency grows under multiple-task load. Supervising many agents is multiple-task load by definition.
- **Better pre-review means less human effort.** Dell'Acqua's field experiment with 181 recruiters reviewing nearly 8,000 résumés found that those with higher-quality AI exerted less effort and performed worse than those with lower-quality AI. The more accurate the pre-review becomes, the less the human checks, so improving it is itself a hazard.
- **The explanation makes it worse, not better.** Bansal et al. (CHI 2021): explanations increased the chance humans accepted the AI's recommendation regardless of its correctness. A fluent paragraph justifying "criterion 3 met" is exactly such an explanation.

Two further problems are specific to this design:
- **Self-grading.** Under this milestone the agent drafts the criteria, executes against them, and pre-reviews the result. The human is one click at the start and one at the end. That is a closed loop with a thin human membrane. Panickssery et al. (NeurIPS 2024) show LLM evaluators score their own generations higher than humans rate them equal, with self-preference correlating with self-recognition. That was measured on summarisation with GPT-4 and Llama 2, so transfer to Claude judging its own code diff is inferred (MEDIUM), but it is the configuration the finding warns about. Huang et al. (ICLR 2024) show that without external feedback LLMs fail to self-correct reasoning and sometimes get worse, so a self-review with no external signal (tests, type checker, command output) carries little information.
- **Scope blindness.** A criteria check can only say whether the asked-for thing is present. It cannot see the unrelated change in the diff. Cold review catches that; criteria-anchored review does not.

**Why it happens:**
People cannot calibrate trust in an algorithm from its outputs. Green and Chen (CSCW 2019) found participants could not effectively evaluate the accuracy of the risk assessment or their own predictions, and did not adjust reliance to the model's real performance. Bainbridge's "Ironies of Automation" (1983): monitoring a mostly-correct system is a task people do badly, and the skills needed to take over decay. The more reliable the pre-review, the worse the human gets at overriding it.

**Presentation patterns that preserve scrutiny (and are assertable):**

| Pattern | Rationale | Assertion |
|---------|-----------|-----------|
| The agent never sets `checked` | The existing no-promotion guarantee is structural; make no-self-grading structural too. REVW-03 already makes the human check criteria against the diff. | A source gate fails if any agent-reachable module writes `acceptance_criteria.checked = 1`; the writer rejects `actor.type = 'agent'` for that column |
| Evidence, not verdict | Vasconcelos: verification works when evidence is cheaper than the task | Each criterion row shows the agent's claim plus deep links to the exact hunks, test names with results, and command output. A claim with zero evidence links renders as "no evidence", never "met" |
| Three-valued, with "cannot determine" first-class | A forced binary invites a confident guess | The pre-review schema allows `met`, `not_met`, `cannot_determine`. A criterion with no verification hint and no external signal MUST be `cannot_determine`; test it |
| No aggregate "all met" badge | The aggregate is the confidence machine's headline | No green all-clear element exists. The header states counts by evidence type: "4 mechanically evidenced, 1 judgement only, 1 no evidence" |
| Disagreements and gaps first | Attention is spent where the claim is weakest | Rows sort by evidence strength ascending. Test the sort |
| Show the unexplained diff | Inverts the scope blindness. Value of cold review is in what no criterion covers | The review view states "N hunks support no criterion" and lists them; hunks outside the declared file-set (PLAN-05 scope events) are shown as a distinct class |
| Independent reviewer context | Self-preference and anchoring on its own reasoning | The pre-review runs in a fresh session primed from criteria and diff only, not the authoring session's summary or reasoning. This is Flywheel's own mechanism (ephemeral context reconstitution); use it on purpose. Prompt framing: "find evidence each criterion is NOT met" |
| Frozen rubric | The agent must not soften the bar to pass | The pre-review reads the criteria revision recorded at task start (BOARD-03) and flags any criterion revised after start |
| Calibration shown, not assumed | Green and Chen: people cannot calibrate alone | An offline harness runs the pre-reviewer over diffs with planted unmet criteria and the measured false-"met" rate is displayed in the review UI. Fully automated, which matches the developer's preference for automated verification |
| Effort monitoring | Dell'Acqua: effort falls as accuracy rises | Log evidence-expand rate and time-on-review per merge. Alert (in the dev log) when pre-review accuracy rises while expand rate on low-evidence items falls |

Cognitive forcing (making the human decide before seeing the AI answer) reduces over-reliance most strongly (Buçinca et al., CSCW 2021) but people rated those designs lowest and it helped high Need-for-Cognition users more. For a developer who wants less boring work, use it narrowly: only for criteria rated `cannot_determine` or `not_met`, and for the planted-defect calibration, not as a blanket interaction.

An honest note on the other side: the pre-review genuinely lowers verification cost when its evidence is simpler than re-deriving the answer, and that is the milestone's real benefit. The risk is the verdict, not the evidence.

**Warning signs (observable):**
- Merge without opening any evidence link, trending up.
- Pre-review false-"met" rate (from the planted-defect harness) is non-trivial and the UI does not show it.
- A criterion is revised after task start with the pre-review then reporting it met.
- The pre-review summary prose is longer than the evidence it cites.

**Phase to address:** "Agent-assisted review." The no-self-grading gate and the three-valued schema belong in the first plan of that phase, before any UI.

---

### Pitfall 3: The redesign does not change the feeling (Q8, with Q7)

**What goes wrong:**
Phase 8.1 ran 21 plans, closed 8 of 12 must-haves with 2 owner overrides, and the developer's verdict is "lifeless, no contrast, boring." Doing 21 more plans of the same kind will produce the same verdict. The diagnosis below is from the artifacts, not from taste.

**Diagnosis (what the artifacts say):**

1. **The brief was the cause; the plans were faithful.** `08.1-DIRECTION.md` adopted "near-neutral ground, one surface family, one-pixel hairline rules, no fills, type and spacing carry all hierarchy." Its own table lists the dark rule colour at 1.20:1 against the ground, "decorative hairline only." Colour appears "only as a data channel" from an exhaustive list of five, with "no tinted rows, no status fills, no pills with backgrounds." The brand colour appears only as a progress fill. The v0.2.0 brief asks for the opposite on every one of those axes (dark-first, high contrast, saturated accents, colour carrying state). Executing a restraint brief well produces a restrained UI. Polishing components cannot add a point of view the brief withheld.
2. **The proof was verifiable proxies, not the feeling.** The criteria that closed were token names unchanged, contrast ratios asserted per mode, icons registered in a legend, motion durations confirmed. All mechanical, all true. The only perceptual criterion, SC0 ("the owner looks at the BUILT board with real data and judges it bold and modern"), was DEFERRED: "closed by the owner adopting six code-rendered comps... No record shows him viewing the BUILT board. The app shell has never been visually reviewed." What gets verified gets built. The feeling was never a requirement anyone could fail.
3. **The comps were designed on a board with no state.** The Direction doc says all five worktrees are zero commits ahead, one is dirty, no agent is running, no proposal is pending, and the change cue "is nearly invisible on real data," so three labelled FIXTURE rows were added so the owner could see it. A supervision UI whose signals are absent in the data cannot look alive; it can only look tidy. The roster's lead row was a junk epic named `test` (0 of 1) and a no-epic bucket held 181 in-review tasks (D-REV-25). The focal point of the screen was junk.
4. **No focal point, uniform weight.** The row ladder is four fixed heights (64/48/32/28px) with the hierarchy carried by type and spacing in a near-monochrome system. Nothing says "look here first." Linear's own refresh states the opposing principle: "Don't compete for attention you haven't earned," and dims the sidebar so the work area is the focal point. The 8.1 system had no earned-attention mechanism, so everything was equally quiet.
5. **Decision by artefact, not by use.** Adoption was wholesale (D-03) after viewing static comps; the 21 plans then executed it. There was no cheap loop where the owner saw a built surface with live state, said "lifeless," and the direction changed before 20 plans were spent.

The class of mistake: **specifying a style instead of a hierarchy, verifying tokens instead of perception, and judging on a design artefact instead of the built thing with real data.**

**The over-correction trap:**
The new brief says saturated accents and colour carrying state. The opposite failure is a screen where everything is coloured. ISA-101 "high performance HMI" practice states why: in traditional HMIs "constantly filled with red and green, a critical high-pressure red alarm no longer stands out"; the discipline is a grey baseline with saturated colour, motion and blinking reserved for abnormal conditions, where a grey screen signifies a healthy process. Healey and Enns' preattentive-vision work explains the mechanism: a single colour outlier is detected in a glance regardless of the number of items, but only when it is an outlier. A fleet of 12 running agents all painted green is 12 non-outliers.

The reconciliation, which is the opinionated recommendation here: **restraint was not the mistake; absent signal carriers were.** 8.1 used the restraint discipline but put the colour on a count and a 4px strip, so no abnormal state could be loud. The fix is a signal budget with large carriers:
- Colour intensity inversely proportional to state frequency and to need for action. `blocked` and `failed` (the human is needed) get high chroma and a large carrier (row tint at low alpha plus a saturated edge and glyph). `running` and `merged` are the expected, ignorable states: low chroma, with liveness carried by motion on change, not by paint.
- "Alive" comes from change and recency, not decoration: a state change animates once and settles, running shows a subtle pulse, recency is encoded, counters tick. Motion stays in CSS so the existing reduced-motion blanket rule still catches it (8.1 motion contract), and must not break the O(1) `estimateSize` row virtualisation (BOARD-08; 8.1 already rejected a height animation for this reason).
- One focal region by construction: the "needs you" surface (blocked queue, failed, awaiting-review) is the highest-contrast element on the screen when non-empty, and the screen is visibly calm when empty. A dashboard that is calm when healthy and loud when not is the target; a dashboard that is always moderately loud is the failure.

**Warning signs (observable):**
- A design review where the owner cannot answer "what should I look at first?" for a screenshot taken with the board in its worst state.
- The comp or the plan relies on FIXTURE rows to show the signal.
- Plans are scoped per component ("restyle row," "restyle chip") rather than per surface hierarchy.
- All must-haves are mechanical; none can fail on perception.
- More than a small, fixed number of elements carry accent chroma in a steady-state screenshot of a healthy fleet.

**Prevention (assertable):**
1. A seeded **demo board** with every state live: running, blocked, failed, awaiting review, proposals pending, an epic mid-flight, 900+ items. Not labelled fixture rows. All design review, screenshots and browser tests use it. This replaces "comps from a board with nothing happening."
2. Owner review of the BUILT surface on that board, per surface, early in the phase (after the first surface, not at phase end). SC0-style criteria are recorded as owner verdicts with a screenshot attached; they cannot be deferred by adopting an artefact. The phase does not close on token tests alone.
3. A **signal budget** test: in a healthy-fleet screenshot of the demo board, the count of elements carrying saturated state chroma is at or below a fixed number; in a bad-state board, the blocked/failed region has the highest local contrast. Implement as DOM class counts plus a coarse image check (downsample the screenshot and assert the needs-you region has the greatest luminance variance). This is a heuristic proxy and must not replace the owner's verdict; its job is to catch the always-loud regression cheaply.
4. Plans are organised by surface hierarchy (what is first, second, third on this screen), not by component.
5. IA decisions precede visual ones (the milestone already says so) but the hierarchy statement ("this region is the focal point; these are the three levels") is an acceptance criterion of the IA phase, so visual work has something to realise.
6. Reuse the existing proxy tests but extend them to the new tokens: the per-mode contrast assertion in `theme/__tests__/contrast.test.ts` must cover every new accent and every chroma tint, because tinted rows change the background text sits on.

**Phase to address:** "IA and visual." The demo board and the first owner review of a built surface are its first plan, not its last.

---

### Pitfall 4: The spine erodes because new records sit outside the fence (Q6)

**What goes wrong:**
Three new record types above a fixed hierarchy is exactly how rigidity erodes, and the existing structural gates do not cover them. `proposal_no_promotion.rs` guards by literal substring: five patterns (an INSERT into each of `epics`/`tasks`/`issues`/`acceptance_criteria`, plus an UPDATE of `acceptance_criteria`) and four allow-listed writer modules. A new `prds`, `adrs`, `phases` or link table is invisible to it. An agent-reachable module can write PRDs and ADRs directly, and the passing gate says nothing about them. The no-promotion guarantee holds for four tables and is silent about everything added after.

**Signs of erosion:**
- A generic `records` or `documents` table with a `kind` text column ("everything is a doc"). This is the path to custom issue types by another name.
- `parent_type` CHECKs widened. `acceptance_criteria.parent_type IN ('task','epic')` already exists. Adding `'prd'` to reuse the criteria table for the PRD acceptance bar is the tempting move: it saves a table and quietly makes criteria polymorphic, puts PRD writes inside the gated tables, and breaks `CRITERIA_SQL`'s `parent_type = 'task'` assumption in agent-facing reads.
- A link table with a free-text relation (`rel TEXT`) that grows new values per feature.
- A `phases` row with a parent, or an epic that can belong to two phases. That is a fourth level or a graph, not a grouping.
- Any statuses, types or priorities that become configurable. The Out of Scope row is explicit: configurable workflows, custom fields and custom issue types are excluded because the primary consumer is an agent parsing a predictable schema.
- "Proposed" as a status on the ADR table that an agent can insert directly, bypassing staging.

**Prevention (assertable), in the repo's own style of structural tests:**
1. **Closed-world table classification.** A test enumerates `sqlite_master` and requires every table to appear in a classification list (spine, staging, derived, record, infrastructure). An unclassified table fails the build. This inverts the gate from deny-listed to deny-by-default, so the next table cannot slip in. Precedent: the `unbounded_reads` gate, whose own review finding (WR-02) was "silently outside the scanner's directory scope."
2. **Spine DDL pin.** Hash the `CREATE TABLE` text of the spine tables (epics, tasks, issues, acceptance_criteria) and pin it; a change requires editing the pin in the same diff. This is the baseline-pin pattern Phase 12 used to fence the shim classifier. The spine status vocabulary (`backlog..done`) and `kind IN ('bug','idea','question','risk')` are inside this.
3. **Dedicated tables with their own CHECKs** for PRD, ADR and phase: no shared `kind`. Statuses are CHECKed closed sets. The link table has CHECK on the allowed (from_type, rel, to_type) triples, a closed vocabulary. Assert no `rel` or `kind` column is unconstrained TEXT.
4. **Hierarchy depth test.** From `sqlite_master` foreign keys: the FK chain above `epics` ends at `phases`; `phases` has no parent FK; `epics.phase_id` is a single nullable FK; no table other than `epics` references `phases`. Assert it.
5. **Extend the no-promotion corpus.** The 17-case adversarial corpus covers every verb by target type. Add `prd`, `adr` and phase-assignment as target types and rerun the full matrix. Agent-proposed ADRs and PRDs are staged rows materialised only by human action, exactly like epics. Decide explicitly where `proposed` lives: recommended is staging for agent proposals, with the `adrs` table holding only human-materialised states, enforced by the writer and the source gate. If a human-authored draft state is wanted in `adrs`, restrict it to human actors.
6. **Every mutation appends an event with an actor** in the same transaction (DATA-01, DATA-03). The new writers inherit this; add them to the event-coverage test so a new table without events fails (v0.1.0 Pitfall 7).
7. **Typed `_in_tx` writers per record**, with the gate's `CANONICAL_WRITER_SUFFIXES` extended deliberately, in the same diff as the table, with the reason recorded. Widening the allowlist silently is the erosion; widening it with a pinned reason is the control.

**Warning signs (observable):** a migration adds a nullable "type" or "kind" column to a new table; a PR extends `CANONICAL_WRITER_SUFFIXES` or a CHECK without touching a pin file; someone asks "can a PRD contain tasks?" or "can an ADR have child ADRs?"

**Phase to address:** "Fence and bound," before any record-type table exists. The classification gate and the DDL pin must land first so the record phase builds inside them.

---

### Pitfall 5: The document layer becomes a wiki decoupled from execution (Q1)

**What goes wrong:**
A PRD record is added, nobody links it, agents never see it, it drifts from what was built, and it joins the graveyard of Confluence-shaped pages. The local evidence says the risk is real and specific: the optional authoring path for acceptance criteria was simply not used (15 criteria across 907 tasks, none on the five tasks with worktrees). An optional authoring step with no forcing function and no consumer is not used. A PRD gets the same treatment unless something downstream needs it.

**Failure signatures (observable):**

| Signature | How to observe it |
|-----------|-------------------|
| Orphan PRD | A signed-off PRD with no epic link |
| 1:1 stub | Every PRD links exactly one epic; the PRD adds nothing the epic description lacked |
| Frozen-but-wrong | PRD `signed_off`, all linked epics `done`, bar items with no covering criterion |
| Edit without consequence | PRD revised after sign-off and no downstream record notices |
| Never read | Zero read or open events on a signed-off PRD in 30 days of linked-epic activity |
| Not load-bearing | Deleting the PRD would not change any assembled context packet |
| Bypass | Epics created and run with no PRD, and nobody objects |
| Prose swells, bar does not | PRD word count grows while the count of structured bar items stays flat |

**Prevention (assertable):**
1. **The PRD's load-bearing part is structured, not prose.** The acceptance bar is a list of discrete items (the BOARD-02 shape), and epics link to the bar items they realise. Coverage is derived: each bar item has at least one covering epic criterion or is explicitly `deferred` with a reason. A PRD with an uncovered, non-deferred bar item is shown as such.
2. **States with teeth.** `draft` then `signed_off` then (`realised`, `superseded`, `withdrawn`). Sign-off freezes the bar as a revision (the BOARD-03 mechanism applied one level up). Editing after sign-off creates a new revision and marks linked epics "PRD moved" until a human acknowledges it, mirroring CTX-06's contradiction surfacing.
3. **Derived staleness, never asked.** Dormant is computed from the event log (signed off, linked epics idle). "Realised" is computed from coverage. Nobody maintains a staleness field. Assert there is no human-writable freshness column.
4. **Consulted by machine.** The signed-off bar items for the task's epic enter the context packet (bounded, see Pitfall 6). Assert: removing a linked bar item changes the assembled packet.
5. **Unanchored is a visible state, not a forbidden one.** Requiring a PRD for every epic creates a form to fill (contradicting the milestone rule) and breeds stub PRDs. Instead an epic without a signed-off PRD shows as "unanchored" and the roadmap view counts them. A 1:1 PRD-to-epic ratio is flagged as a smell.
6. **Sign-off is one human clicking, not a workflow.** No approvers, reviewers, RACI or comment threads. Those are the TEAM-xx paid layer and the road to a wiki.

**Phase to address:** "Records." Coverage derivation and the packet entry are part of the first PRD plan, not follow-ups.

---

### Pitfall 6: The context packet grows without bound (Q9)

**What goes wrong:**
`context_packet.rs:219` `SUMMARIES_SQL` reads every summary for a task (`ORDER BY created_at ASC`, no LIMIT). Compaction (`compaction.rs`) folds narrative past a fixed `VERBATIM_WINDOW = 5` but is "lossless for decisions and for file paths," so folded entries still carry every decision and path forever. The packet therefore has two unbounded terms today: the read, and the lossless decision/path residue. PRDs and ADRs add a third and fourth. This is the scale ceiling that makes `/clear` stop being free, the product thesis.

The evidence that this is more than tidiness:
- Anthropic's context-engineering guidance treats context as a finite resource with diminishing marginal returns; as tokens grow, recall of that context falls ("context rot"), and the goal is the smallest set of high-signal tokens.
- Liu et al. (TACL 2024): performance is highest when the relevant item is at the start or end of the context and degrades in the middle and with length.
- Gloaguen et al. (2026): repository context files written by an LLM reduced task success about 3% and raised cost over 20%; even developer-written ones raised token use for a small lift (about 4%). Unnecessary requirements make tasks harder. A PRD pasted whole is the same kind of extra context.

Two Flywheel-specific hazards:
- **Determinism cuts both ways.** CTX-04 makes the packet a deterministic query. Adding PRD/ADR content means an edit to a PRD changes the packet of every in-flight task. Without revision pinning, a session's context shifts under it.
- **The D-69 constraint.** Compaction deliberately has "no character count, no token count and no size ceiling anywhere," because a size ceiling would move the boundary for reasons a developer cannot see. A fix for the unbounded read must respect that reasoning (fixed counts, visible boundary), which means the obvious "truncate at N tokens" fix is out.

**Bounding strategy (opinionated):**
- **Include by link, status and scope, never by recency.** An ADR enters iff `accepted`, not `superseded`, and either linked to the task's epic or its scope paths intersect the task's declared file-set. This is the same load-bearing filter idiom as `CRITERIA_SQL`'s `superseded_at IS NULL` ("every agent-facing read must see current wording only").
- **Fixed counts with a visible boundary.** For example, N ADRs verbatim, the rest as one-line id and title index lines, and the packet states "3 of 7 ADRs included: accepted, constrain this epic." Same shape as the CTX-05 boundary sentence.
- **PRD enters as problem statement plus only the bar items linked to this epic.** The rest is pull-on-demand through a read-only board tool during the session (just-in-time retrieval). The packet stays deterministic; the agent's mid-session reads are not part of it.
- **Revision-pin what enters.** The packet records the PRD/ADR revision ids it used, so a later edit is a surfaced contradiction (CTX-06 style), not a silent change.
- **Bound the existing terms first.** Cap the summaries read and define a fold policy for decisions (for example `acknowledged_decisions` and superseded ones drop from the folded residue). This conflicts with "lossless for decisions" and needs a deliberate decision, flagged for phase research.

**Warning signs:** packet byte size grows with task age; a long-lived task's start-up cost climbs; the epic packet's `PRIOR_AUTHORING_RUNS_SQL` (already named as a tracked unbounded read) is joined by a new one.

**Prevention (assertable):**
1. A scale test (`context_packet_scale`-style): assemble the packet for a fixture with 200 summaries, 40 ADRs and a 30KB PRD, and assert size at or below a fixed bound B, and that a small fixture is strictly smaller. Monotone: adding a superseded ADR never increases the packet.
2. Extend the `unbounded_reads` source gate to scan `context_packet.rs` and every new PRD/ADR query module from day one. Do not allowlist-away `SUMMARIES_SQL`; fix it.
3. The packet records PRD/ADR revision ids; assert an edit after packet assembly is reported as drift.
4. A removal test: deleting a superseded ADR leaves the packet byte-identical (superseded never enters).

**Phase to address:** "Fence and bound," before the record phase wires PRD/ADR into the packet. This is a precondition, not a polish item.

---

### Pitfall 7: The phase layer drags in the PM long tail (Q3)

**What goes wrong:**
Adding a grouping above epics is how a focused tool becomes Jira. The milestone text says "phase (cycle)," which hides a decision: a time-boxed cycle and a scope-boxed phase have different long tails. A time-box brings dates, rollover, capacity and velocity. Linear itself shows the slope: its cycles are fixed periods with automatic rollover of unfinished issues and a capacity estimate based on velocity over the last three completed cycles. Even the "light" tool arrived there.

**Recommendation:** a phase is an ordered, goal-bearing, scope-boxed grouping with success criteria, no dates, no capacity, no velocity. The product-level argument: the thesis is loop engineering, continuously draining a backlog with agents. Agent throughput is not time-boxed and sprint planning rituals have no referent. `CONV-04` ("Cycles or other time-boxed planning constructs") sits in Deferred Conveniences; record that this milestone ships the scope-boxed variant and keeps the time-boxed one deferred.

**Features that arrive next, in the order they usually arrive, all to be refused:**
1. start and end dates, then an "overdue" state
2. carry-over or rollover of unfinished epics
3. capacity and velocity, then a forecast ("will we make it?"). Note the hook already in the schema: `estimate IN (1,2,3)`. Summing estimates per phase is velocity in one query.
4. burndown or burnup charts, then phase reports
5. retrospectives, phase goals as OKRs
6. nested phases, initiatives, dependency lines, Gantt
7. per-actor capacity and assignment (resource planning)
8. auto-create-next-phase templates, which is the deferred scheduled automation arriving through the back door
9. cross-project (portfolio) roadmaps. The fleet view spans projects, which makes this the most tempting here, and portfolio reporting is explicitly Out of Scope.
10. approvals and sign-off workflows on phases

**Warning signs (observable):** a `phases` column named or typed like a date, duration, capacity or points; any `SUM(estimate)` grouped by phase; a chart in the phase view; words like sprint, velocity, burndown, capacity, deadline, due, overdue in code or UI strings; a user story that begins "as a manager."

**Prevention (assertable):**
1. A schema allowlist test: `phases` columns equal an exact set (id, project, ordinal, title, goal, status, timestamps). A new column fails the test.
2. A forbidden-identifier source gate in the repo's existing style: no `velocity`, `burndown`, `burnup`, `capacity`, `story_point`, `sprint`, `deadline`, `due_date`, `overdue`, `rollover` in `packages/core/src` or `packages/desktop/src`. Cheap, and it makes the refusal structural rather than a promise.
3. Phase progress is derived from child epic states and the phase's own success criteria, never a stored percentage; a phase closes on its criteria, not on zero findings.
4. Epics belong to at most one phase and phases never nest (see Pitfall 4's depth test).
5. Record a decision entry: "scope-boxed, undated; time-boxed deferred (CONV-04)."

**Phase to address:** "Records" (schema) with the gates installed in "Fence and bound."

---

### Pitfall 8: ADRs written once and never consulted, or flooding in (Q2)

**What goes wrong:**
The documented failure of every ADR practice: praised universally and practised sporadically. Mining studies back it. An MSR study of GitHub (Buchgeher et al.) found about 50% of repositories with ADRs hold only one to five, "tried but not definitively adopted." A recent ICSA 2026 study of 921 repositories found about 63% of 5,800 ADRs were opened directly with status "accepted" or equivalent, bypassing the deliberation the format exists to capture. Practitioner critiques say the same from the other side: static documents pretending to be living artefacts, diverging silently until someone acts on an outdated one.

An agent adds new variants:
- **Volume.** An LLM narrating its own reasoning will find "decisions" constantly. v0.1.0 already had to cap proposals at a fixed 10 per run for this reason.
- **Low-stakes recorded as load-bearing.** Every library pick becomes an ADR; the real ones drown.
- **Block-or-flag.** An agent that blocks on every fork turns the blocked queue into the review chore (Pitfall 1). One that picks silently is what the milestone wants to stop.
- **Decision split-brain.** Session summaries already carry a `decisions` array, and CTX-06 detects contradictions against it. A separate ADR store creates two decision registries that drift. Reuse, do not duplicate.

**What makes the difference between consulted and ignored:**
Consulted ADRs are consulted by machine at the point of decision, not read from a list. Flywheel has the pieces: CTX-06 contradiction detection, per-task declared file-sets, and the context packet.

**Prevention (assertable):**
1. **Scope-bound ADRs.** An ADR carries scope (linked epics and path globs). When a task's declared file-set intersects an accepted ADR's scope paths, the ADR is surfaced in the packet and in the start-work view. Assert it with a fixture.
2. **Wire into the existing detector.** An accepted ADR is a recorded decision for CTX-06's purposes: a session proposing the opposite is flagged. Assert one detector, not two.
3. **Proposal needs a real fork.** The staged ADR proposal requires at least 2 alternatives, a stated consequence, a reversibility class and the task it affects; the writer rejects fewer. Assert rejection at the schema or writer level.
4. **Fixed per-run cap**, lower than the generic proposal cap (suggest 1 or 2 per run), and duplicate detection against existing ADRs using the FTS5 mechanism already built for proposals.
5. **Reversibility decides block versus flag.** Reversible forks: the agent proceeds on a stated default and files the proposal; the choice is visible in review. Irreversible ones (public API, schema, dependency, data format): block. Classification is a required field of the proposal. Flagged MEDIUM: this is design reasoning, not a measured result.
6. **Promotion, not duplication.** A session `decision` can be promoted to an ADR proposal by an explicit human action, which is a natural significance filter and keeps one registry.
7. **Superseded never enters context** (Pitfall 6 prevention 4), and acceptance of an ADR that supersedes another shows the superseded one in the same view.

**Warning signs:** ADR count per epic growing faster than epic count; ADRs with fewer than 2 alternatives; accepted ADRs never surfaced in any packet; an ADR whose scope paths no task has ever intersected.

**Phase to address:** "Records," after the packet bound lands.

---

### Pitfall 9: Dark-mode and colour-as-signal failures (Q7)

**What goes wrong:**
A dark-first direction with saturated accents invites the standard failures, and this codebase has an additional rule that raises the stakes: "meaning never rests on colour" (`EpicHeaderRow.tsx:15`, `BoardRow.tsx:443`).

| Failure | Evidence and local risk | Prevention (assertable) |
|---------|------------------------|-------------------------|
| Pure black ground | Material's dark-theme guidance recommends dark grey, not black, and lets lighter surfaces express elevation. 8.1's dark ground was `#0a0a0a`, near black, with text `#ededed` at 16.9:1 | Ground is not at or below a fixed lightness floor; elevation is by surface lightness steps. Pin in the token test |
| Over-saturated accents on dark | Material: saturated colours on dark surfaces fail 4.5:1 for text and produce optical vibration; desaturate. 8.1's brand `#3c64dd` was 3.83:1 on the dark ground and needed a lift to `#5175e1` | Saturated hue is carried by fills, edges and glyphs; text uses the lifted tone. Contrast test covers every accent as text and as non-text (3:1) per mode |
| Too-high contrast and halation | Light text on a dark ground is less legible than dark on light for acuity (Piepenbrock et al.), and the glow effect is reported for astigmatic readers (practitioner sources only, LOW) | Body text not pure white; keep a maintained light theme; follow system preference. Dark-first, not dark-only. The existing single token set for both modes supports this; the contrast test must run on both |
| Colour as sole carrier | WCAG 1.4.1: colour must not be the only means of conveying information. Red-green deficiency affects up to about 8% of men (NEI). The 8.1 palette pairs `#3fb950` done with `#f85149` failed, the classic confusable pair | Every state has a unique glyph and a printed word, registered in `legend/marks.ts` (a mark the legend does not define may not exist). Test: states are pairwise distinguishable with all colour stripped; each state has non-empty glyph and label. Add the new states (`merged`, `awaiting review`) to the registry |
| Dense rows all competing | Healey and Enns: pop-out works for outliers only. 907 tasks with glyph, key, title, count and annotations at near-uniform weight | Default rows quiet; chroma only on exceptions; healthy epics collapse. See Pitfall 3's signal budget |
| Tints change the background under text | Row tints alter the contrast pair for every text colour on them | Contrast test enumerates text roles against each tint, per mode |

Confidence: Material guidance is first-party (HIGH for the rules it states). The astigmatism halation prevalence figures seen were from non-peer-reviewed sources (LOW), so treat halation as a reason to keep light mode and soften text white, not as a quantified claim.

**Phase to address:** "IA and visual."

---

## Moderate Pitfalls

### Pitfall 10: Deleting the fallback before the agent path is proven, and the board becomes unusable when the agent is not
**What goes wrong:** The hand-typed file paths at `WavePlanSheet.tsx:201` exist because PLAN-01 was never run against a real planning run, and AGNT-05 (live rate-limit observation) is also unmet: a hard limit has never been seen from the real backend. A milestone that deletes the manual path and drafts everywhere has two exposures. If the agent path has a defect found only live, the board cannot be authored. If drafting is eager, every item costs a model call against the subscription limit and the limit behaviour is unproven.
**Prevention:** (a) The manual path is the same form with no prefill; do not delete a form, delete its separate fallback code, and only after a live-run evidence artifact exists (a credential-spending run, as `scripts/uat/uat-10-agent-backlog.mjs --live` did for Phase 6). Assert the hand-typed path is not removed in the phase that introduces the agent path without that artifact. (b) Draft on demand, never sweep. (c) Treat AGNT-05 as a prerequisite or an explicit risk-accepted item, because drafting multiplies model calls.
**Phase:** "Carried live proofs," ahead of "Draft engine."

### Pitfall 11: The Socratic PRD session becomes the chat blob the product bans
**What goes wrong:** "Drafted in a session where the agent challenges the user" can yield a long markdown PRD plus a transcript, which is the general-purpose chat interface the Out of Scope table excludes. SHAPE-01's history is a warning on cost: the live dialogue-quality judgement stayed UNJUDGED through round 11 and closed in round 13, after a dozen narrowing rounds.
**Prevention:** the session's output is structured (problem statement, bar items, constraints, assumptions) written through the staging path, never a transcript; the PRD record has no free "body" blob beyond the problem statement. Budget a live acceptance harness for PRD shaping from the start (reuse the SHAPE-01 harness and its credential isolation), and plan for the owner's quality verdict as an explicit gate, as SHAPE-01 had.
**Phase:** "Records."

### Pitfall 12: Drafts go stale under concurrent edits
**What goes wrong:** A draft computed against a task is shown after the task (or the epic's criteria, or the file-set) changed. The human accepts a draft for a state that no longer exists. Related: provisional values applied on drafts that a later human edit silently overwrites.
**Prevention:** each draft records the revision it was computed against; accepting a draft against a moved revision is refused with a diff (the same stance as BOARD-03's revision model and the drift surfacing in CTX-06). Assert the stale-accept is refused.
**Phase:** "Draft engine."

### Pitfall 13: A drafted criterion is only as real as its verification hint
**What goes wrong:** The Core Value is "real acceptance criteria." Agent-drafted criteria tend to be unfalsifiable ("works correctly," "is well structured"), pass lint-free, and then give the pre-review (Pitfall 2) nothing mechanical to check.
**Prevention:** a criterion requires a verification hint or is stored flagged `judgement-only` and counted in the review header. Lint for compounds, vague verbs and absent observables, in code.
**Phase:** "Draft engine."

### Pitfall 14: Closing a UX milestone on proxies and deferrals
**What goes wrong:** 8.1 closed with deferrals standing in for judgement, and v0.1.0 ended with 22 unanswered owner-questions, the largest block of undischarged review debt. Another milestone of deferrals compounds it.
**Prevention:** each user-visible surface has one criterion that is an owner verdict on the built thing, and a deferral may not satisfy it. State this in the roadmap's success criteria. Consistent with the standing preference to close a phase on roadmap criteria and drain defects through the board, but with the perceptual criterion made one of the roadmap criteria.
**Phase:** every phase; owned by "IA and visual" and "Agent-assisted review."

### Pitfall 15: Name collision between "phase" in the product and "phase" in GSD
**What goes wrong:** The product exists to replace `.planning/` phases; its own record type called "phase" confuses users, agents reading both, and the planning tooling used to build the product.
**Prevention:** decide the user-facing noun deliberately and record it (candidates: phase, track, stage). Linear's method advice applies: do not invent terms that mean different things in different places. Put the decision in the requirements.
**Phase:** "Records."

---

## Minor Pitfalls

### Pitfall 16: Open-core drift through sign-off semantics
**What goes wrong:** "Signed off" implies a signer and, quickly, roles and approvals, which is the paid team layer (TEAM-03).
**Prevention:** sign-off is a single-actor state transition recorded in the event log; no role model in the schema. Run the open/paid boundary test from v0.1.0 Pitfall 8 on every new record.

### Pitfall 17: Provenance blur after acceptance
**What goes wrong:** Once accepted, an agent draft reads as human text, and later review cannot weigh it appropriately.
**Prevention:** see Pitfall 1 prevention 6; render provenance as a small, persistent marker.

### Pitfall 18: Motion that breaks the performance contract
**What goes wrong:** "Alive" gets implemented as layout-affecting animation on 900+ rows.
**Prevention:** motion stays in CSS using transform and opacity; the O(1) `estimateSize` lookup by row kind is untouched; the existing browser tests that run in three engine arms are extended to the new motion.

---

## Technical Debt Patterns

| Shortcut | Immediate Benefit | Long-term Cost | When Acceptable |
|----------|-------------------|----------------|-----------------|
| Reuse `acceptance_criteria` for the PRD bar via a new `parent_type` | One less table | Polymorphic spine, PRD writes inside the gated tables, breaks agent-facing `CRITERIA_SQL` assumptions | Never |
| One generic `records` table with `kind` | One migration, one writer | Custom issue types by another name | Never |
| Per-field accept UI | Simplest data model | The 40-versus-6 chore (Pitfall 1) | Never |
| Eager draft of the existing board | Fills the criteria gap fast | About 900 unreviewed criteria and subscription burn | Never |
| Truncate the packet at N tokens | Fast bound | Boundary moves for invisible reasons (D-69 rejected this) | Never; use fixed counts with a visible boundary |
| Allowlist `SUMMARIES_SQL` in the unbounded-reads gate | Gate goes green | Debt hidden by the gate meant to expose it | Never |
| Show a single "all criteria met" indicator | Looks clean | The confidence machine | Never |
| Ship visual work against FIXTURE rows | Demonstrable now | Another lifeless build | Only for a throwaway spike, never for a phase gate |
| Skip live acceptance for PRD shaping | Saves a credential-spending run | SHAPE-01's thirteen rounds repeated | Never for the quality verdict |

## Integration Gotchas

| Integration | Common Mistake | Correct Approach |
|-------------|----------------|------------------|
| Staging (`authoring_proposals`) | New target types added to the table but not to the no-promotion corpus | Rerun the full verb by target matrix with `prd`, `adr`, phase-assignment |
| Event log | New record tables written without an event | Event-coverage test over all record tables |
| CTX-06 drift detection | ADRs stored as a separate decision registry | One registry; accepted ADR counts as a recorded decision |
| File-sets (PLAN-01) | ADR scoping built on file-sets that are still hand-typed | Land the live PLAN-01 proof first; scope-by-path depends on it |
| Context packet | PRD/ADR text added into the same string with no boundary | Fixed counts, revision-pinned, visible boundary sentence |
| Fleet view | Phase view reaching across projects | Phases are per-project; cross-project roadmap is refused (Out of Scope) |
| Rate limits | Draft calls added with AGNT-05 unproven | Draft on demand; treat AGNT-05 as a prerequisite or accepted risk |

## Performance Traps

| Trap | Symptoms | Prevention | When It Breaks |
|------|----------|------------|----------------|
| Packet growth (Pitfall 6) | Slow session start, worse agent adherence | Fixed counts, link-based inclusion, scale test | Long-lived tasks, around tens of summaries and a few dozen ADRs |
| Eager drafting | Rate-limit friction, token cost | Draft on demand | Immediately on a 900-item board |
| Animated layout on large lists | Jank at 900+ rows | Transform/opacity only; O(1) size lookup | The seeded demo board |
| Coverage derivation recomputed on read | Slow roadmap view | Derive at write time inside the staging or writer transaction (the duplicate-flag precedent: computed in the INSERT, never recomputed on read) | PRDs with many bar items across many epics |

## Security Mistakes

| Mistake | Risk | Prevention |
|---------|------|------------|
| Agent-writable PRD/ADR outside staging | Agents author the governing documents unreviewed, and the packet then feeds them back as authority | Staging only; extend the gate (Pitfall 4) |
| PRD/ADR text injected into the packet as trusted instructions | A poisoned document steers every future session | Packet content from records is data in a labelled section, with provenance; never merged into the system instruction |
| Agent revising a criterion to make the pre-review pass | Self-grading by softening the rubric | Frozen revision; flag post-start revisions (Pitfall 2) |

## UX Pitfalls

| Pitfall | User Impact | Better Approach |
|---------|-------------|-----------------|
| Drafts shown in a separate inbox | Another queue to drain | Inline in the form being edited |
| Green all-clear on pre-review | Reflex merge | Counts by evidence type; gaps first |
| Everything coloured | Nothing stands out | Signal budget; calm when healthy |
| "Unanchored" shown as an error | Pressure to create stub PRDs | Neutral, countable state |
| Blocking on every ADR fork | Blocked queue becomes the chore | Reversibility decides block versus flag |

## "Looks Done But Isn't" Checklist

- [ ] **Draft acceptance:** often per field, verify it is per task and no bulk-accept identifier exists anywhere in the new surfaces
- [ ] **Draft quality:** often unlinted, verify lint-failing drafts never reach a human
- [ ] **Pre-review:** often shows a verdict, verify `checked` can only be set by a human actor, a gate fails on an agent write, and no aggregate all-clear element exists
- [ ] **Pre-review evidence:** often prose, verify every "met" has at least one hunk, test or command-output link
- [ ] **Calibration:** often assumed, verify the planted-defect harness exists and its number is displayed
- [ ] **PRD linkage:** often optional and unused, verify coverage is derived and the bar enters the packet
- [ ] **ADR consultation:** often a list nobody opens, verify a file-set intersection test surfaces it and the CTX-06 detector reads it
- [ ] **Closed-world schema:** often only the four old tables are gated, verify an unclassified table fails the build
- [ ] **Spine pin:** verify a DDL change to the spine tables fails without a pin edit
- [ ] **Phase layer:** verify the column allowlist and the forbidden-identifier gate exist
- [ ] **Packet bound:** verify the scale test, and that `SUMMARIES_SQL` is not allowlisted
- [ ] **Visual direction:** verify the owner reviewed the BUILT surface on the seeded demo board, with a screenshot, before the phase closed
- [ ] **Colour:** verify state distinguishability with colour stripped, and contrast for every tint and accent in both modes
- [ ] **Fallback:** verify the manual path is the same form, and no live-proof-less deletion happened

## Recovery Strategies

| Pitfall | Recovery Cost | Recovery Steps |
|---------|---------------|----------------|
| Draft chore discovered after launch | MEDIUM | Raise granularity to per task, add the attention cap, drop low-value fields; the event log already holds the accept and correction history to justify which |
| Reflex acceptance discovered | MEDIUM | Compute post-accept revision rate from events; add the planted-defect harness; quarantine criteria with `judgement-only` |
| Pre-review overtrust | LOW to MEDIUM | Remove aggregate indicator, add counts-by-evidence, show calibration; no data migration |
| Spine eroded | HIGH | Migration to split a polymorphic table; the pins and the closed-world gate exist so this should never be exercised |
| Packet bloat | MEDIUM | Replace recency inclusion with link-based inclusion; revision-pin; the scale test locates the offender |
| Phase long tail | MEDIUM | Drop columns and views; the forbidden-identifier gate localises them |
| Lifeless redesign again | HIGH | Stop at the first built surface, change the brief, not the components; the seeded demo board makes the second attempt cheap |

## Pitfall-to-Phase Mapping

| Pitfall | Prevention Phase | Verification |
|---------|------------------|--------------|
| 1 Draft chore | Draft engine | Per-task granularity test; attention cap test; no-bulk-accept source test; field audit in requirements; post-accept revision rate computed from events |
| 2 Confidence machine | Agent-assisted review | No-self-grading gate; three-valued schema test; no aggregate badge; evidence-link test; planted-defect harness; fresh-context reviewer |
| 3 Lifeless redesign | IA and visual | Seeded demo board; owner verdict on a built surface with screenshot; signal budget test; surface-hierarchy statement as a criterion |
| 4 Spine erosion | Fence and bound | Closed-world table classification; spine DDL pin; depth test; extended no-promotion corpus; event coverage |
| 5 Wiki | Records | Derived coverage; packet entry removal test; no human-writable freshness column |
| 6 Packet growth | Fence and bound | Scale test; unbounded-reads gate extended; revision pinning; superseded-never-enters test |
| 7 PM long tail | Fence and bound (gates), Records (schema) | Column allowlist; forbidden-identifier gate; depth test |
| 8 ADR neglect and flood | Records | Scope-by-file-set test; single decision registry; alternatives-required writer test; per-run cap |
| 9 Dark and colour | IA and visual | Per-mode contrast test across all tints; colour-stripped distinguishability test; ground lightness floor |
| 10 Fallback and rate limit | Carried live proofs, then Draft engine | Live-run evidence artifact before deletion; no sweep path; AGNT-05 status stated |
| 11 Chat blob | Records | Structured-output-only test; live harness for PRD shaping |
| 12 Stale drafts | Draft engine | Stale-revision accept refused |
| 13 Unfalsifiable criteria | Draft engine | Verification hint or `judgement-only` flag test |
| 14 Proxy closure | Every phase | One owner-verdict criterion per user-visible surface |
| 15 Naming | Records | Recorded decision on the noun |
| 16 to 18 | Records, Draft engine, IA and visual | See each entry |

## Suggested phase vocabulary and ordering

The roadmapper owns the final names. These are the work packages the pitfalls reference.

1. **Fence and bound** (precondition for everything): closed-world table classification, spine DDL pin, forbidden-identifier gate, extended no-promotion matrix, packet bound plus scale test. Cheap, mostly tests, and it makes every later phase safer.
2. **Carried live proofs**: PLAN-01 and AGNT-05 each need a credential-spending run, not code. Do them before the draft engine because drafting depends on file-set drafting working live and multiplies model calls. DIST-01 is a budget decision (the owner declined the purchase on 2026-10-13); give it a named home or an explicit deferral, do not let it stay orphaned.
3. **Records** (PRD, ADR, phase): dedicated tables, linkage, derived coverage and staleness, packet entry, Socratic PRD session.
4. **Draft engine**: field audit, per-task drafts, lint, attention cap, provisional tier, instrumentation.
5. **Agent-assisted review**: no-self-grading gate, evidence-first view, calibration harness.
6. **IA and visual**: IA first, then the seeded demo board and a built-surface owner review before the rest of the visual work.

## Research flags for phases

- **Agent-assisted review:** needs deeper research. What external evidence the pre-reviewer can obtain (test runs, type checks, command capture) determines whether `met` can ever be honest. No direct study of developers adjudicating an LLM's pre-review of its own diff was found.
- **Draft engine:** needs a per-field tier decision (provisional versus explicit) and a decision on which fields are deleted.
- **Fence and bound:** needs a policy decision on folding decisions in the packet, which conflicts with "lossless for decisions" and with D-69's refusal of size ceilings.
- **IA and visual:** needs rendering experiments on the demo board; the colour and signal-budget numbers here are principles, not tuned values.
- **Records:** standard patterns apart from the Socratic PRD session, which needs the live-harness budget.

## Gaps to address

- No measured acceptance behaviour exists for this product yet. The 1-of-42 amended datum is the only local signal. Instrument first, then tune the attention cap and thresholds named above (the numbers given, such as 2 seconds, 90% and the ADR cap, are starting points, not findings).
- Panickssery's self-preference result is from other models and summarisation; the transfer to Claude judging code is unmeasured. The planted-defect harness is how Flywheel measures it for itself.
- The ICSA 2026 ADR figure (63% opened as accepted) was read from the conference listing snippet; confirm against the paper before quoting it in user-facing material.
- The Dell'Acqua study was read through a secondary summary page; the effect is widely cited but confirm figures against the working paper before quoting.
- The 13.6% human catch rate of disguised dangerous commands, attributed to Anthropic's auto-mode material in secondary coverage, was NOT found on the primary page and is not used here. Only the 93% approval figure is used, which the primary page states.
- Linear's cycle capacity and velocity behaviour was read from search summaries of its documentation (MEDIUM-LOW); confirm on `linear.app/docs` before citing.

## Sources

Local evidence (HIGH, read directly)
- `.planning/PROJECT.md`, `.planning/REQUIREMENTS.md`, `.planning/v0.1.0-MILESTONE-AUDIT.md`, `.planning/research/PITFALLS.md`
- `packages/core/src/context_packet.rs:219` (`SUMMARIES_SQL`), `packages/core/src/compaction.rs` (`VERBATIM_WINDOW`, D-68/D-69), `packages/core/tests/epic_context_packet.rs` (`ALLOWED_UNBOUNDED_SELECTS`, WR-02)
- `packages/core/tests/proposal_no_promotion.rs` (canonical write patterns and writer suffixes), `packages/core/src/db/migrations/0002_board_schema.sql` (CHECK constraints)
- `packages/desktop/src/triage/TriageSurface.tsx:21-23` (no bulk accept, D-104), `packages/desktop/src/dispatch/WavePlanSheet.tsx:201`
- `.planning/milestones/v0.1.0-phases/08.1-visual-polish-brand-assets-and-confirmed-motion-inserted/08.1-DIRECTION.md` and `08.1-VERIFICATION.md` (SC0, D-REV-24, D-REV-25, overrides)

Human factors (effects HIGH, transfer MEDIUM)
- Parasuraman and Manzey, "Complacency and Bias in Human Use of Automation: An Attentional Integration," Human Factors 52(3), 2010: https://depositonce.tu-berlin.de/handle/11303/8923
- Goddard, Roudsari and Wyatt, "Automation bias: a systematic review of frequency, effect mediators, and mitigators," JAMIA 2012: https://pmc.ncbi.nlm.nih.gov/articles/PMC3240751
- Bansal et al., "Does the Whole Exceed its Parts? The Effect of AI Explanations on Complementary Team Performance," CHI 2021: https://arxiv.org/abs/2006.14779
- Buçinca, Malaya and Gajos, "To Trust or to Think: Cognitive Forcing Functions Can Reduce Overreliance on AI," CSCW 2021: https://arxiv.org/abs/2102.09692
- Vasconcelos et al., "Explanations Can Reduce Overreliance on AI Systems During Decision-Making," CSCW 2023: https://arxiv.org/abs/2212.06823
- Green and Chen, "The Principles and Limits of Algorithm-in-the-Loop Decision Making," CSCW 2019: https://econcs.seas.harvard.edu/resource/greenacm19pdf
- Dell'Acqua, "Falling Asleep at the Wheel: Human/AI Collaboration in a Field Experiment on HR Recruiters" (summary page): https://innovationgrowthlab.org/node/1447
- Bainbridge, "Ironies of Automation," Automatica 1983: https://gwern.net/doc/sociology/technology/1983-bainbridge.pdf
- Ancker et al., "Effects of workload, work complexity, and repeated alerts on alert fatigue in a clinical decision support system," BMC MIDM 2017: https://pmc.ncbi.nlm.nih.gov/articles/PMC5387195/
- Anthropic Engineering, "Claude Code auto mode" (93% approval figure): https://www.anthropic.com/engineering/claude-code-auto-mode
- Panickssery, Bowman and Feng, "LLM Evaluators Recognize and Favor Their Own Generations," NeurIPS 2024: https://arxiv.org/abs/2404.13076
- Huang et al., "Large Language Models Cannot Self-Correct Reasoning Yet," ICLR 2024: https://arxiv.org/abs/2310.01798
- Cohen/SmartBear code review study (Cisco, 2,500 reviews): https://smartbear.com/learn/code-review/best-practices-for-peer-code-review/ (MEDIUM; vendor study)
- Threat image projection in screening (vigilance decrement, seeded targets): https://irf.fhnw.ch/entities/publication/9c6fb0b5-3dec-4730-babf-992ce82916c9/full?back=true (MEDIUM)
- METR, early-2025 RCT on experienced open-source developers (developers 19% slower while believing 20% faster), via https://simonwillison.net/2025/Jul/12/ai-open-source-productivity/ (MEDIUM; 16 developers; informs the perception gap, not used for a numeric claim)

Context and agents
- Anthropic Engineering, "Effective context engineering for AI agents": https://www.anthropic.com/engineering/effective-context-engineering-for-ai-agents
- Liu et al., "Lost in the Middle," TACL 2024: https://aclanthology.org/2024.tacl-1.9/
- Gloaguen et al., "Evaluating AGENTS.md: Are Repository-Level Context Files Helpful for Coding Agents?" 2026: https://arxiv.org/abs/2602.11988

ADRs, documents, cycles
- Buchgeher et al., "Using Architecture Decision Records in Open Source Projects: An MSR Study on GitHub": https://research.jku.at/en/publications/using-architecture-decision-records-in-open-source-projects-an-ms/ (MEDIUM)
- ICSA 2026, "Architecture Decision Records Adoption Impact and Developer Engagement in Open Source": https://conf.researchr.org/details/icsa-2026/icsa-2026-papers/34/Architecture-Decision-Records-Adoption-Impact-and-Developer-Engagement-in-Open-Sou (MEDIUM, snippet-derived)
- ADR anti-patterns, practitioner: https://jopr.org/blog/detail/10-adr-antipatterns (LOW)
- Linear Method: https://linear.app/method/introduction ; Linear cycles guide: https://linear.app/enablement/guide/cycles-guide (MEDIUM-LOW)

Visual, colour, accessibility
- Material Design, dark theme: https://m2.material.io/design/color/dark-theme (first-party)
- Linear, "Behind the latest design refresh": https://linear.app/now/behind-the-latest-design-refresh (first-party)
- ISA, "The High Performance HMI": https://blog.isa.org/the-high-performance-hmi (MEDIUM)
- Healey and Enns, "Attention and Visual Memory in Visualization and Computer Graphics": https://www.csc2.ncsu.edu/faculty/healey/download/tvcg.11.pdf
- WCAG 2.2, Understanding SC 1.4.1 Use of Color: https://www.w3.org/WAI/WCAG22/Understanding/use-of-color.html
- NIH/NEI on colour vision deficiency prevalence: https://newsinhealth.nih.gov/2010/02/cant-see-certain-colors
- Piepenbrock et al., "Positive display polarity is advantageous for both younger and older adults," Ergonomics (reached via search snippet; MEDIUM)

---
*Pitfalls research for: Flywheel v0.2.0 "The Board Thinks With You"*
*Researched: 2026-10-14*
