# Feature Research: v0.2.0 "The Board Thinks With You"

**Domain:** Agent-native product shaping (PRD / ADR / phase records), agent-drafts/human-accepts authoring, agent-assisted review, and loop-engineering supervision UX — layered onto a shipped board-native ADE
**Researched:** 2026-10-14
**Confidence:** MEDIUM overall. HIGH on Linear cycles, Shape Up pitch anatomy, Nygard/MADR formats, Linear Triage Intelligence, Devin Review severity tiers, Kiro/Spec Kit phase structure (each fetched from the product's own docs or confirmed in 2+ sources this session). MEDIUM on ADR-adoption folklore (practitioner blogs, consistent but not measured), on Notion/Height (not re-fetched; from prior knowledge), and on Linear's default project-status names (docs page said statuses are customisable but did not list defaults). LOW-MEDIUM on section 6 (loop-supervision UX): the sources are practitioner blogs and vendor pages, there is no empirical study of what makes a supervision dashboard feel alive, so that section is synthesis and is labelled as such.

**Scope note.** v0.1.0's `.planning/research/FEATURES.md` and `COMPETITION.md` are not repeated. This file covers only the six questions the v0.2.0 requirements need. Where a v0.2.0 capability generalises something already shipped, the shipped requirement ID is named so the roadmap can see the reuse.

---

## Executive Findings (read this first)

1. **A PRD is a record with a lifecycle and an enforced link downward, not a document.** Linear models it as a Project (lead, status, milestones, documents under "Resources", health updates) that issues belong to; Shape Up models it as a pitch with five fixed slots (problem, appetite, solution, rabbit holes, no-gos) that a betting table accepts or does not; Kiro and Spec Kit model it as an approval-gated artifact whose children (design, tasks) are derived. The wiki-page failure is consistent: the page has no state, no owner of sign-off, and no machine-checkable link to the work, so it drifts and nobody can tell which version the work was built against. Flywheel already owns the hard parts (structured criteria, immutability-after-start, proposal staging); the PRD should reuse them rather than introduce a document editor.
2. **ADRs fail on consumption, not on writing.** The recurring cause of abandonment is that nothing in the normal workflow forces a reader to meet the ADR. Flywheel has a mechanism no chat tool has: the context packet (CTX-03/CTX-04) and contradiction detection (CTX-06). An accepted ADR that is injected into every session whose task it constrains, and flagged when a session's understanding contradicts it, is *used by construction*. That is the whole case for building ADRs as records rather than markdown files.
3. **The phase layer must stay a scope container, not a time-box.** Linear cycles and Jira sprints bundle a useful core (ordered container, carryover, visible scope change, a goal) with a long tail (velocity, capacity dials, burndown, cooldowns, auto-scheduled future cycles). The long tail is exactly what PROJECT.md's Out of Scope list excludes. Section 3 draws the line item by item. Estimates already exist on the schema (`estimate IN (1,2,3)`, `priority 0..4`) so the only decision is what *consumes* them.
4. **Agent-drafts/human-accepts saves work when the draft is the default value of the field the human would have typed, and creates a chore when it arrives as a separate inbox.** Linear's Triage Intelligence (per-property suggestion, hover for reasoning, accept/decline individually, per-property auto-apply policy) is the best-documented example; Google Docs suggesting mode and Claude Code plan mode are the other poles. Kiro-style whole-document gates are the failure case: one Spec Kit run for a trivial change produced 8 files and 1,300 lines, which no human reads. Granularity rule: the unit is *what the human would have typed* — a field for scalars, an item for structures, a batch only as an explicit second step after the human has seen the items.
5. **Honest review signal is a claim with evidence, owned by a different actor than the human check.** Flywheel's `criterion_anchors` (migration 0018: path, side, line range, sha; staleness derived from git, never stored) already gives the evidence primitive. The agent's pre-review should write a *verdict row with anchors* (met / not met / could not determine), never set `checked`. Self-reported agent confidence is close to uninformative in the literature found; do not display a score.
6. **"Come back to it" is five concrete things:** an instant since-you-left digest, one explained next action, state legible without opening anything, visible forward motion (things landing), and calm — motion only on real events. Gamification (streaks, confetti, points) is the wrong lever and is listed as an anti-feature.

---

## 1. PRD / Spec / Brief as a Record

### How real products model it

| Product | The object | States / lifecycle | Who signs off | Relation to execution | Source / confidence |
|---|---|---|---|---|---|
| **Linear Projects** | A Project: description, a single `lead` field ("to keep ownership of the project clear"), target date, milestones (ordered, each with a description), and a **Resources** section where you "create a document" (same Markdown as issues, issue linking and tagging) or add links. | Project status is a workspace-customisable set ("names, descriptions, and colors"), grouped by category. Default names not confirmed this session (commonly Backlog / Planned / In Progress / Completed / Canceled). Separate from status: weekly **project updates** carrying health `On Track` / `At Risk` / `Off Track`. | No sign-off gate. The lead owns it. Linear deliberately avoids an approval step. | An issue belongs to **at most one project** ("sub-issues offer a workaround for multi-project association"). A progress graph rolls up from issues. | linear.app/docs/projects, /docs/project-status (HIGH for structure; MEDIUM for default status names) |
| **Shape Up pitch** | A pitch with five fixed ingredients: **problem**, **appetite** ("how much time we want to spend and how that constrains the solution"), **solution**, **rabbit holes**, **no-gos** ("functionality or use cases we intentionally aren't covering"). | Shaped → pitched → bet on (or not) → in cycle → shipped or cancelled. **Circuit breaker:** "Cancel projects that don't ship in one cycle by default instead of extending them by default." | A **betting table** decides, during cool-down, after stakeholders read the write-up asynchronously. The book does not name one person; it is a small collective decision. | The pitch becomes a project the team then breaks into *scopes* during the work ("scope mapping is done continuously… you cannot know the interdependencies in advance"). Hill charts show scopes uphill (figuring out) or downhill (executing). | basecamp.com/shapeup ch. 6; hill-chart summaries (HIGH) |
| **Kiro (AWS)** | A *spec* = `requirements.md` (EARS notation: "WHEN [condition] THE SYSTEM SHALL [behavior]"), `design.md`, `tasks.md`. | Requirements → Design → Tasks → Execution, with **approval gates between phases**. Requirements-first or design-first entry. | The developer approves each phase document before the next is generated. | Tasks execute one at a time against the approved spec. | Kiro coverage across 3+ independent sources (MEDIUM-HIGH) |
| **GitHub Spec Kit** | `.specify/` folder; slash commands `/speckit.constitution`, `.specify`, `.clarify`, `.plan`, `.tasks`, `.analyze`, `.implement`. The **constitution** is a set of non-negotiable project rules; changing it triggers a Sync Impact Report across templates. | Phase-by-phase, file-based. `clarify` and `analyze` are explicit challenge/consistency steps. | The developer, implicitly, by running the next command. | Files in the repo; no persistent board. | Spec Kit guides (MEDIUM-HIGH) |
| **Jira Rovo** | Generates "PRDs → epics → issues". PRD lives in Confluence. | Confluence page states are informal. | n/a | Link between page and epic is a URL, not a model relation. | COMPETITION.md (v0.1.0), MEDIUM |
| **Notion** | A page inside a Projects database with properties (status, owner, relation to a Tasks database). | Whatever the team configures. | Convention only. | Relation property + rollup if the team builds it. | Prior knowledge, not re-fetched this session (MEDIUM-LOW) |
| **Height** | Tasks with embedded docs; "autonomous project collaboration" ambitions. | n/a | n/a | Product shut down (offline Sep 2025, per v0.1.0 research). Useful only as a cautionary tale about shipping the vision before the base. | COMPETITION.md (MEDIUM) |

### What goes wrong when the PRD is a wiki page

All of these are mechanically observable, not opinion:

- **No state.** A page cannot be "signed off" in a way the system can see, so nothing can refuse to start work against an unsigned brief. (Linear sidesteps this by not gating; Kiro and Shape Up gate in a file/meeting, not in the work system.)
- **No version binding.** Work cannot say "built against revision 3". Flywheel already solved this once for criteria: BOARD-03 makes criteria immutable once work starts and records revisions. A PRD wiki page edited after sign-off silently changes the target.
- **No machine-checkable link down.** The page links to epics by hand-pasted URL; the epics do not link back; progress is a human-maintained status paragraph. (Linear's Resources documents are the wiki-page-in-a-project compromise: the doc is free text, only the issue relation is structural.)
- **Spec bloat.** Spec-driven tooling's strongest critique: "8 files and 1,300 lines of text" for a trivial change; spec creation consuming about a third of tokens in several frameworks; benefit concentrated on tickets touching three or more files, little advantage on one- or two-file tickets, and a "spec longer than the change" being a bad trade. Implication: **a PRD must be optional per epic.**
- **The challenge step is missing.** Kiro and Spec Kit have approval gates, but the agent's job is generation, not adversarial questioning. Spec Kit's `/clarify` is the nearest analogue. Flywheel's Socratic arm (SHAPE-01, live-validated with a PASS verdict on challenge quality) is a real differentiator when moved up to product level.

### Recommended PRD record (for requirements)

Fields mirror the Shape Up slots because they are the only ones in this survey that are both small and each independently useful to an agent: **problem**, **appetite** (coarse, see anti-features), **solution sketch**, **rabbit holes**, **no-gos**, **acceptance bar** (structured, individually checkable items, same model as BOARD-02), **open challenges** (unresolved agent questions; see below).

States: `draft → signed_off → superseded | withdrawn`. "Shipped/delivered" is **derived** from child epics (epic_progress query exists), never stored — consistent with how Phase 10 derived reclaim eligibility instead of writing a status that can drift.

Sign-off: the single human (v1 is solo; multi-actor identity DATA-03 already makes the field correct for teams later). Sign-off is **a recorded event with an actor**, and it locks the body: edits create a new revision (BOARD-03's rule, generalised), and downstream epics record which revision they were shaped against. Sign-off with unresolved agent challenges should **warn, not block** (human sovereignty; blocking invites a "dismiss all" reflex that destroys the signal).

| Feature | Class | Complexity | Depends on (shipped) | Notes |
|---|---|---|---|---|
| PRD as a board record with fixed slots, lifecycle, actor-attributed sign-off event | **Table stakes** (for this milestone's stated goal) | Medium | DATA-01/03 (event + actor), BOARD-01 (spine untouched) | Nullable `prd_id` FK on epics; epic with no PRD stays legal. |
| Epic belongs to at most one PRD; PRD progress derived from epics | **Table stakes** | Low | `query/epic_progress.rs` | Matches Linear's one-project-per-issue rule; avoids many-to-many UI. |
| PRD acceptance bar as structured criteria with revisions, locked at sign-off | **Table stakes** | Medium | BOARD-02, BOARD-03, migration 0009 | **Schema trap:** `acceptance_criteria.parent_type` is `CHECK IN ('task','epic')` (migration 0002). SQLite cannot alter a CHECK in place; adding `prd` (and `phase`) needs a table rebuild migration. Plan for it. |
| Socratic PRD drafting: agent challenges, asks, and writes slots as staged proposals; per-slot accept/reject/amend | **Differentiator** | Medium | SHAPE-01…04, authoring staging (migration 0011) | Staging `target_type` is `CHECK IN ('epic','task','criterion','assumption')`; needs `prd` and sibling kinds. `assumption` already exists and maps directly to rabbit holes and no-gos. |
| Open challenges recorded on the PRD (question, agent's reasoning, resolved/waived) | **Differentiator** | Low-Medium | SHAPE-01, `change_flags` query | Makes the "challenge" auditable and gives sign-off something concrete to warn about. |
| Downward draft: agent proposes epics (and their criteria) from a signed PRD into the staging queue | **Differentiator** | Medium | SHAPE-02/03, PROP-01…07 | Same accept/reject/amend path; epics land in `proposed`, never active (PROP-03 invariant must be re-asserted for the new kinds). |
| Context packet includes the signed PRD slots (problem, no-gos, bar) for every epic under it | **Differentiator** | Low-Medium | CTX-03/04, `epic_context_packet.rs` | Keeps CTX-04 determinism: same board state, same packet. Adds to the packet-size concern already open in PROJECT.md (unbounded SUMMARIES_SQL) — cap PRD contribution. |
| Contradiction flag: a session's stated understanding vs. a PRD no-go | **Differentiator** | Medium | CTX-06 | Extension of an existing mechanism, not a new one. |
| Free-form rich-text/markdown document editor for the PRD body | **Anti-feature** | High | | Reintroduces the wiki page. Slots are the model. Offer a read-only rendered view and an export. |
| Mandatory PRD for every epic | **Anti-feature** | | | Spec-overhead evidence above. Small fixes and issues must never need one. |
| Approval workflow with multiple reviewers / required-approver rules | **Anti-feature** (v0.2.0) | | | Team feature; belongs to the paid-cloud milestone. The sign-off *event* is enough. |
| PRD templates library / custom sections | **Anti-feature** | | | Violates "no custom fields". Fixed slots only. |
| Export signed PRD as markdown (one-way projection) | **Differentiator, defer-able** | Low | | Portability and OSS ethos; strictly one-way, never read back. |

---

## 2. ADRs as Records

### How teams actually run them

- **Nygard's original format (2011):** five parts — Title (short noun phrase, `ADR N: …`), Context ("forces at play, including technological, political, social, and project local"), Decision (full sentences, active voice, "We will …"), Status, Consequences ("the resulting context, after applying the decision"). Statuses: **proposed** (stakeholders have not agreed), **accepted**, **deprecated**, **superseded** (with a reference to the replacement). Files sit at `doc/arch/adr-NNN.md`, numbering monotonic, "Numbers will not be reused." A reversed decision stays: "It's still relevant to know that it *was* the decision, but is *no longer* the decision." (cognitect.com, HIGH)
- **MADR 4.0.0 (2024-09-17):** adds optional **Decision Drivers**, **Considered Options**, **Confirmation** (how compliance will be validated), **Pros and Cons of the Options**, **More Information**; status in YAML front matter: `proposed | rejected | accepted | deprecated | … | superseded by ADR-0123`; ships Bare, Minimal and Full variants. (adr.github.io/madr, HIGH). "Confirmation" is the one MADR addition that matters for Flywheel: it is already a verification hint on a criterion.
- **adr-tools (Nygard-compatible CLI):** `adr new`, `adr new -s <n>` to supersede, `adr link` — i.e. the toolchain's contribution is *making supersession a one-liner*. (prior knowledge; MEDIUM)

### Why they are written once and abandoned (consistent across sources found)

1. **Writer pays, imagined future reader never arrives.** The cost-benefit breaks at the writer. Nothing routes the ADR to the person about to violate it.
2. **Staleness without a signal.** "An ADR written in 2021… is actively misleading" in 2025 because the code diverged and no one updated the status. Superseding is a manual act performed in a different place than the change that made it obsolete.
3. **Over-engineered templates.** "Templates with 12 sections discourage writing"; engineers fall back to PR comments.
4. **No review checkpoint.** Written, merged, forgotten.
5. **Wrong home.** Practitioner guidance is unanimous: in the repo, in PRs, "Not Confluence. Not Notion. Not a wiki." Target "10 to 30 minutes to write and 5 minutes to read"; write it *before or during* the decision; update the old ADR's status "in the same PR. One line change." (jonoherrington.com, MEDIUM — practitioner source, but it agrees with the others.)

### What this implies for Flywheel

Flywheel can fix causes 1, 2 and 4 structurally, which no file-based ADR practice can:

- **Cause 1 (nobody reads it):** inject accepted ADRs into the context packet of every task whose epic they constrain (CTX-03) — they are *read by every session by construction*. Extend contradiction detection (CTX-06) so a session whose understanding contradicts an accepted ADR is told in its own prompt, the way criteria revisions already are.
- **Cause 2 (stale):** supersession is a first-class edge. Creating ADR-12 "supersedes ADR-7" flips ADR-7 in the same transaction (DATA-01) and the context packet stops injecting it. Derived "possibly stale" signal: an accepted ADR whose constrained file paths changed substantially since acceptance (derive from git, store nothing — the D-141 idiom).
- **Cause 4 (no review):** `proposed` is a triage state with a human gate — the exact PROP-02/03 invariant.

### The agent-proposes-an-ADR-at-a-fork case

Implications, as design requirements rather than facts (this is synthesis; no shipped product does it, so confidence is MEDIUM-LOW):

- **States:** `proposed → accepted | rejected → (accepted) superseded`. Keep `rejected` (MADR has it; a rejected proposal is valuable negative knowledge — "we considered X and no"). `deprecated` (no replacement) is a fifth state of marginal value; recommend omitting it and expressing retirement as `superseded` by nothing explicit, or deciding at requirements time. Body of an accepted ADR is immutable; only status and supersession link change (Nygard).
- **A real fork has ≥2 viable options with different consequences.** The agent's `propose_decision` tool should require: the question, ≥2 options with consequences, the option it recommends and why, and what it *provisionally did* meanwhile. Agent taste/style choices must be rejected at the tool boundary (reuse the proposal rate limit, PROP-05, so a chatty agent cannot flood the queue with "ADR: use camelCase").
- **Blocking vs. non-blocking.** A fork the agent cannot proceed past is a *blocked-on-human* state (surfaces in the existing FLEET-02 queue). A fork it can proceed past on a reversible default is a non-blocking `proposed` ADR with the task carrying a "built on unaccepted decision X" flag. If the human rejects, the task is flagged for rework rather than silently kept. Do not make this a modal interruption; the queue exists.
- **Linkage:** ADR → originating PRD (optional), ADR → constrained epics (many), ADR → originating run/turn (PROP-07 precedent: "which agent run produced it and what prompted it"), optional path globs it governs (the join that lets the context packet include it for tasks whose declared file-set intersects, tying into PLAN-01's file-sets).

| Feature | Class | Complexity | Depends on (shipped) | Notes |
|---|---|---|---|---|
| ADR as a record: title, context, options, decision, consequences, status, number | **Table stakes** | Medium | DATA-01/02/03 | Use Nygard's five parts + MADR's *Considered Options* and *Confirmation*. Nothing more; fixed fields. |
| Status lifecycle proposed / accepted / rejected / superseded; accepted body immutable; actor-attributed transitions | **Table stakes** | Low-Medium | BOARD-03 pattern, events | Sequential numbers never reused (Nygard). |
| Supersession as an atomic edge that retires the old ADR in the same transaction | **Table stakes** | Low | DATA-01 | The one-line-change practice made impossible to forget. |
| ADR ↔ epic "constrains" link (many) and ADR ↔ PRD link | **Table stakes** | Low-Medium | BOARD-01 spine | Join table; epics with no ADR remain legal. |
| Accepted ADRs injected into the context packet of constrained tasks | **Differentiator (core of this section)** | Medium | CTX-03/04, `epic_context_packet.rs` | Deterministic. Cap contribution (open PROJECT.md item on unbounded packet). |
| Contradiction flag against accepted ADRs | **Differentiator** | Medium | CTX-06 | Extension. |
| `propose_decision` agent tool landing in `proposed` with provisional-choice and rate limit | **Differentiator** | Medium | PROP-01…07, `propose_item` | Add target kinds to staging CHECK. Re-prove PROP-03 across the new kinds (the 17-case adversarial corpus is the model). |
| Socratic ADR drafting: human can open a decision and have the agent enumerate options and challenge the choice | **Differentiator** | Medium | SHAPE-01 | Same session machinery as PRD. |
| Path-glob scoping so an ADR attaches to tasks by file-set intersection | **Differentiator** | Medium | PLAN-01 (unmet!), `file_set.rs` | Depends on PLAN-01 being proven live; fall back to epic-level link only until then. |
| Derived "possibly stale" indicator from git churn on governed paths | **Differentiator** | Medium | `git2` hot-path reads, D-141 idiom | Optional; ship the supersession edge first. |
| One-way export to `docs/adr/NNNN-title.md` on accept | **Differentiator, defer-able** | Low-Medium | worktree/git plumbing | Honours "in the repo" practice. **Never** read the file back (two sources of truth is the failure mode). |
| ADR for every agent choice / auto-accepted ADRs | **Anti-feature** | | | Volume and rubber-stamping; contradicts PROP-02/03. |
| Free-form ADR editor, template picker, custom fields | **Anti-feature** | | | Same reasoning as PRD; "12-section templates discourage writing". |
| Bidirectional sync with an ADR folder / adr-tools compatibility layer | **Anti-feature** | High | | Dual source of truth. |
| ADR review workflow with required approvers | **Anti-feature** (v0.2.0) | | | Team feature. |

---

## 3. The Cycle / Sprint Layer (the sharp boundary)

### What the products actually do (verified)

**Linear cycles** (linear.app/docs/use-cycles, HIGH):
- Open issues **roll over automatically**; issues "moved to backlog, triage, canceled, or completed during cooldown are not carried".
- Optional **cooldown** between cycles; "Issues cannot be assigned to a cooldown."
- A cycle graph shows "effort and scope over time"; **completed cycle graphs are preserved as historical snapshots**.
- **Auto-create** upcoming cycles on a repeating schedule, up to 15 ahead.
- **Capacity** "is calculated from the velocity of the previous three completed cycles", shown as a dial predicting completion likelihood.
- Cycle end displays completion percentage, total effort, days elapsed.

**Jira sprints** (Atlassian docs and community, MEDIUM-HIGH): sprint report lists completed, incomplete (often carried over), **issues added after start, issues removed**; on close you choose per incomplete issue "next sprint" or "backlog"; Velocity Chart ("amount of value delivered in each sprint… predict… future sprints"); Burndown ideal-vs-actual line that "highlights scope changes"; Epic Report.

**Shape Up cycles** (HIGH): six weeks fixed, a cool-down, **no backlog and no roadmap by design**, circuit breaker (cancel rather than extend), hill charts for progress, scope mapping done as the work reveals it. Notable: Shape Up *rejects* carryover (nothing extends) and rejects velocity, the opposite of Jira.

### Table stakes vs. long tail, line by line

| Behaviour | Seen in | Verdict for Flywheel phases | Why / mechanism |
|---|---|---|---|
| Ordered container of epics with a name and a one-sentence **goal** | Scrum sprint goal, GSD phase goal | **Table stakes** | Without a goal it is a bucket, not a phase. |
| Phase **exit criteria** as structured checkable items | GSD roadmap success criteria; Flywheel BOARD-02 | **Differentiator** | Makes "phase done" verifiable by an agent against the board instead of a date passing. Reuses criteria model (needs `parent_type` rebuild). |
| States `planned → active → done` (and `cancelled`?) | all | **Table stakes** | Exactly one active phase per project is a sane default; do not model parallel phases. |
| **Roadmap always visible**: ordered list of phases, each with a segmented progress rollup | Linear roadmap/initiatives; Shape Up has none | **Table stakes for this milestone** (explicitly requested) | Derive from epics → tasks; no hand-updated status. |
| **Carryover** at phase close: unfinished epics prompted "next phase / back to backlog" | Linear auto; Jira prompts | **Table stakes**, Low | Prompt with a sensible default (move to next planned phase); record as events. Do *not* auto-carry silently (Shape Up's critique: silent carry hides slippage). |
| **Scope-change visibility**: epics added/removed after the phase became active | Jira sprint report; Linear scope line | **Table stakes**, Low | The append-only event log (DATA-01/05) makes it derivable; show as a count chip ("+2 / −1 since start"), not a chart. |
| Phase membership drafted by the agent (suggest which epics belong in a phase) | none directly; Linear Triage Intelligence suggests projects/teams | **Differentiator**, Medium | Same accept/decline suggestion pattern. |
| Phase-close **summary drafted from merged work** | none directly | **Differentiator**, Low-Medium | One narrative per phase from merged items. It is per-phase retrospective prose, not reporting. |
| **Velocity** (completed-per-cycle history) and **capacity dial** | Linear capacity (last 3 cycles), Jira velocity chart | **Anti-feature** | Predictive planning from throughput is *resource planning* — on the Out of Scope list. It is also meaningless when concurrency is set by file-set disjointness (PLAN-06 width) and rate limits (AGNT-05), not people-hours. |
| **Burndown / burnup, ideal line** | Jira, Linear graph | **Anti-feature** | Explicitly Out of Scope ("sprint burndown"). |
| Time-boxing: required start/end dates, cooldowns, auto-created future cycles, recurring cadence | Linear (up to 15 ahead), Shape Up six weeks | **Anti-feature** | Phases close when exit criteria are met, not when a clock expires. Dates may exist as optional free labels at most. Cadence automation also collides with the deferred scheduled-automations milestone. |
| Story points / hour estimates feeding capacity | Jira | **Anti-feature** | `estimate IN (1,2,3)` already exists; keep as a coarse size consumed by the planner / phase sizing, never summed into a forecast. |
| Time tracking, worklogs | Jira | **Anti-feature** | Out of Scope. |
| Portfolio view across projects with status/health roll-ups | Linear Initiatives, Jira Plans | **Anti-feature** | Out of Scope ("portfolio reporting"). The existing cross-project *fleet* view (FLEET-01) is operational, not reporting; do not extend it into planning. |
| Per-phase team assignment / capacity per person | Jira, Linear | **Anti-feature** | Resource planning; solo user. |
| Health status (`On Track` / `At Risk` / `Off Track`) with weekly written updates | Linear project updates | **Anti-feature as a manual field**; the *derived* equivalent is fine | Weekly hand-written updates are encoding work. A derived indicator (e.g. blocked epics, scope breach holds) is just state colour on the rollup. |
| Shape Up circuit breaker (cancel what overruns) | Shape Up | **Defer** | Needs a time/budget notion; CONV-02 (per-epic budgets with hard stops) is already deferred. Appetite stays a coarse label. |
| Hill chart per epic | Shape Up | **Differentiator, speculative** | Basecamp's is hand-dragged (encoding work). A *derived* position — shaping/decomposition = uphill, executing/reviewing = downhill — would be free, but it is untested. MEDIUM-LOW. See section 6. |

**The boundary in one sentence:** keep everything that *describes where work is* (membership, goal, exit criteria, carryover, scope change, roll-up); refuse everything that *predicts or accounts for effort* (velocity, capacity, burndown, time, points, assignees-by-capacity, cross-project portfolios).

**Structural note.** Linear's own mapping is the right mental model: *Project* ≈ PRD and *Cycle* ≈ phase are two orthogonal axes an issue sits on (intent vs. time). In Flywheel the unit placed on both axes is the **epic**, via two nullable FKs on `epics` (`prd_id`, `phase_id`). BOARD-01's three-level spine is not touched; both axes sit *above* it.

| Feature | Class | Complexity | Depends on |
|---|---|---|---|
| Phase record (name, goal, state, order), nullable `phase_id` on epics | Table stakes | Low-Medium | BOARD-01, DATA-01 |
| Persistent roadmap strip with derived segmented progress | Table stakes | Medium | `epic_progress`, BOARD-08 (1,000+ items perf) |
| Carryover prompt at close + scope-change chip | Table stakes | Low | Event log |
| Exit criteria on phases | Differentiator | Medium | BOARD-02/03, criteria CHECK rebuild |
| Agent-suggested phase membership | Differentiator | Medium | Staging, triage pattern |
| Agent-drafted phase-close summary | Differentiator | Low-Medium | Session summaries (CTX-01) |

---

## 4. Agent-Drafts / Human-Accepts as an Interaction Pattern

### Survey

| Pattern | Where | Granularity | Verified behaviour | Verdict |
|---|---|---|---|---|
| **Suggestion on the property itself** | Linear Triage Intelligence | Per property (team, project, assignee, label, duplicates) | Suggestions appear alongside the issue in Triage; "hover over the suggestion to see why it's appearing"; **accept or decline individually**; per-property-type policy: shown, hidden or **auto-applied**; 1-4 minutes to generate; rules can be scoped to specific values. | **The gold standard for scalar fields.** Reasoning is on demand; the draft sits where the human would have typed. |
| **Suggesting mode** | Google Docs | Per edit, with thread | Each change is an attributed tracked suggestion; accept/reject individually or all. | Right model for *prose revisions* of a record the human already authored; heavy for fresh drafts. (prior knowledge, MEDIUM) |
| **Inline diff keep/undo** | Cursor, Copilot-style editors | Per hunk, per file, all | Agent edits land in the buffer; human keeps or undoes. | Works because the artifact (code) is already diff-shaped and the human is in it. (prior knowledge, MEDIUM) |
| **Plan approval gate** | Claude Code plan mode | Whole plan | Read-only exploration, a proposed plan, then: approve and auto-run / approve and accept edits / approve and review each edit / keep planning with feedback. | Good for a *single-thread* plan; coarse when the plan has independent parts. The "keep planning with feedback" exit matters: rejection is a conversation, not a delete. (verified via search) |
| **Phase document gates** | Kiro | Whole document per phase | Approve requirements → design → tasks in sequence. | Safe in principle, but the unit of review is a multi-page document, which invites skimming. Combined with Spec Kit's 8-files/1,300-lines anecdote this is the cautionary example. |
| **Staged changeset with per-item verbs** | Flywheel itself (SHAPE-04, PROP-06) | Per item; four verbs; two bulk paths | Staging table; nothing canonical until a human action; duplicate annotation link-only. | **Already the best-evidenced pattern in this codebase.** v0.2.0 generalises it; it does not need inventing. |
| **Review queue as a separate surface** | Linear Triage inbox, Flywheel `TriageSurface` | Per item | Suggestions wait in a queue to be processed. | Right for *work the human did not initiate* (agent-found backlog). Wrong for work the human *is in the middle of* typing. |

### What separates "saves work" from "new review chore"

Synthesised from the above; each point is checkable against a product listed:

1. **The draft is the default value, not a notification.** Pre-fill the file-set list / criteria list / priority where the human would have entered it, marked with provenance ("drafted by agent, run X"), accept with one key. A separate "suggestions" inbox for something the human is staring at doubles the work. Use the queue only for items the human did not initiate.
2. **Review cost must be proportional to stakes.** Linear's per-property policy (display / auto-apply / hide) encodes this. Low-stakes reversible fields (labels, estimate) are candidates for auto-apply *after the user opts in*; commitments (acceptance criteria, file-set, PRD slots, ADR decision) never auto-apply. Default: nothing auto-applies; Flywheel's PROP-03 stays absolute for *board items*, and any auto-apply policy for *field values* must be an explicit per-field setting, off by default.
3. **Reasoning on demand, evidence on the item.** Hover/expand for "why" (Linear), never a paragraph beside every suggestion.
4. **Drafts must be cheap to reject and cheap to amend.** Amend-in-place (SHAPE-04's amend verb) beats reject-and-retype. Rejection with free-text feedback should re-prompt (Claude Code's "keep planning with feedback"), not just delete.
5. **Re-drafting must not re-ask.** If the agent regenerates, previously accepted or amended items are frozen and only the unresolved remainder is redrafted, and the human sees a diff of what changed since the last draft. Otherwise every iteration is a fresh chore.
6. **Drafts go stale and say so.** A file-set drafted against commit A is suspect at commit B. Derive staleness from git (the D-141 idiom) instead of storing a flag.
7. **Volume caps.** PROP-05's 10-per-run refusal with a loud notice is the right precedent. Apply per draft surface.
8. **Batch accept exists but is a second step.** "Accept remaining unedited" after the human has seen the list is fine; "Accept all" as the primary button on first view produces rubber-stamping (automation bias, section 5). SHAPE-04 already states the principle ("rather than accepting the set wholesale").

### Granularity decision

| Data shape | Unit of accept/reject | Example |
|---|---|---|
| Scalar field | The field | priority, estimate, a task title |
| Ordered list the human would type | The list as one chip-set, with per-chip remove/add | a task's file-set |
| Structured items | The item | one acceptance criterion, one task, one proposed epic |
| Tree (decomposition) | Per node, with subtree accept as a convenience | SHAPE-04 + D-96 cascade |
| Prose record (PRD slot, ADR consequences) | The slot | PRD "no-gos" |
| Whole session output | Never the unit; only a closing "accept remaining" | |

### The four encoding paths, specifically

| Path | Today | Agent-drafts path | Notes / dependencies |
|---|---|---|---|
| **File-set declaration** | `WavePlanSheet.tsx` renders a `<textarea>` ("Files for {taskKey}") of hand-typed lines, with "No files declared, so this task runs alone." as the only fallback. The developer's complaint is exactly this. | Planner drafts file-set (PLAN-01) as **resolved chips** (each path validated against the repo tree; globs show match counts; unresolved flagged). Manual override is a **fuzzy file picker** over the worktree tree (Cmd-P style), never a free text path. After a run, **declared vs. actual files** (scope events, PLAN-05) offer "amend file-set to match" for sibling tasks. | **PLAN-01 is unmet** (code path in place, never observed against a live planning run). Deleting the textarea is only safe once PLAN-01 is proven live; sequence: prove PLAN-01 live → ship chips + picker → delete textarea. Keep PLAN-02/03 overlap logic untouched. |
| **Acceptance criteria** | SHAPE-03 drafts criteria during epic authoring only. Phase 8's audit found every task with a worktree carried **zero** criteria; a blank composer is work nobody does. | "Draft criteria" is the **default entry** for any task with none, including manually created ones and accepted proposals: the criteria editor opens pre-filled. Starting a run on a criteria-less task routes through draft-and-accept first. | Must land **before** work starts because BOARD-03 locks criteria at start. A "no criteria" run should be refused with a one-key route into drafting, not silently allowed. |
| **Titles / bodies / decomposition** | Manual composer; SHAPE-02 decomposes epics inside an authoring session. | (a) **Quick capture:** paste or type one rough sentence; agent returns a structured `proposed` draft (title, body, criteria, size); (b) "Decompose" on any epic/task, landing in the same staging queue; (c) title-from-body. | Reuses PROP staging and `TriageSurface`. No new queue. The Phase 8 finding says the composer is the dead surface; quick capture replaces it as the primary path, composer stays as an escape hatch. |
| **Status / priority / estimates** | Status is largely git-derived (LINK-07); priority 0..4 and estimate 1..3 are hand-set. | Status: **derive, don't draft** — most transitions already follow git/forge state. Draft only the non-derivable ones (Backlog → Todo promotion, "ready"). Priority and estimate: **suggestion with hover reasoning** (Linear pattern) on items entering triage or on an explicit "Prioritise this epic" action. Auto-apply off by default. | The v0.1.0 anti-feature stands: the agent never unprompted re-ranks the *existing* backlog. Estimates must have a consumer (planner width, phase sizing) or they are a form field nobody needs; confirm in requirements what consumes `estimate`. |

| Feature | Class | Complexity | Depends on |
|---|---|---|---|
| Staging queue extended to PRD / ADR / phase / file-set / field-suggestion kinds, with per-item accept/reject/amend | **Table stakes** (for the milestone's design rule) | Medium | Migration 0011 CHECK rebuilds; PROP-03 structural gate (source walker must learn the new canonical-writer modules) |
| Pre-filled draft as field default with provenance mark and one-key accept | **Table stakes** | Medium | UI; staging |
| Reasoning-on-hover and "keep refining with feedback" instead of delete | **Table stakes** | Low-Medium | Authoring session machinery |
| File-set chips with repo-validated paths + fuzzy picker; textarea removed | **Table stakes** (the stated complaint) | Medium | PLAN-01 live proof first; git tree read (`git2`) |
| Re-draft freezes accepted items and shows diff vs. previous draft | **Differentiator** | Medium | Staging revision model |
| Draft staleness derived from git | **Differentiator** | Low-Medium | D-141 idiom |
| Quick capture (one sentence → structured proposed draft) | **Differentiator** | Medium | PROP-01, SHAPE-03 |
| Declared-vs-actual file-set reconciliation offered as next-task amendment | **Differentiator** | Medium | PLAN-05 scope events |
| Per-field opt-in auto-apply policy (labels/estimate only) | **Differentiator, defer** | Low | Settings; keep off by default and absent for commitments |
| "Accept all" as the primary action | **Anti-feature** | | Rubber-stamping; keep as explicit second step |
| Agent silently edits fields on items already in progress | **Anti-feature** | | Breaks BOARD-03 spirit |
| Learning-from-rejections / preference model | **Anti-feature** (v0.2.0) | | Scope creep; log rejections as events so it stays possible |

---

## 5. Agent-Assisted Review Against Acceptance Criteria

### What the evidence says

- **Self-evaluation is biased and its confidence is nearly uninformative.** Search results this session: models acting as judges rate their own work more leniently; one study of long-running agent loops found self-reported confidence "nearly uninformative" and, where an agent claimed improvement in all 54 cycles, external measurement showed 56 percent had zero or negative delta. Another notes that self-refinement helps code generation but has "limited effectiveness for final review stages". These are arXiv/blog sources, so treat magnitudes as directional (MEDIUM-LOW), but the direction is consistent with the v0.1.0 finding that an agent's "tests pass" must not be the only gate (Codacy et al.).
- **Automation bias is the operative risk.** "Read the diff, not the description" — AI-authored PR descriptions and polished summaries invite rubber-stamping. Mitigations named: independent test verification, confidence claims treated as hypotheses, scrutiny scaled with risk. (addyosmani.com, MEDIUM)
- **Best practice cited for agent review:** a *blind* reviewer in a clean context, ideally from a different model family. Flywheel can honour the first half for free; the second is impossible while Claude Code is the sole backend (BKND-* are v2).
- **Devin Review** is the most concrete shipped example (docs.devin.ai): bugs in two tiers (red = high-confidence needing immediate attention; orange = lower severity), security findings with CWE classes, **flags** (orange = warrants investigation, gray = informational), diffs reordered *thematically* with moved code shown cleanly, findings **dismissable as resolved** (dimmed, sorted to the bottom), and an explicit Auto-Fix that "requires user review and approval". Note the honest tiering of uncertainty (flags exist because the tool admits it cannot always tell).

### Honest-signal patterns (design requirements)

1. **Verdict is a separate record from the human's check.** `acceptance_criteria.checked` is the human's. The agent writes a *verdict* (`met` / `not_met` / `could_not_determine`) with a short statement and **anchors** (path, side, line range, sha) using the criterion_anchors shape (migration 0018). The review UI shows "agent says" and "you say" as distinct columns, actor-attributed (DATA-03). The agent can never check a box.
2. **Three-valued, with "could not determine" as a first-class, loudly-sorted-first outcome.** An agent forced to choose met/not-met will fabricate; Devin's gray/orange flags exist for the same reason.
3. **Evidence or it did not happen.** A `met` verdict with no anchor renders as *unverified claim* (the existing D-140 "no-evidence state"), not as a pass. Staleness is derived from git on every read (D-141): if the anchored lines moved, the verdict shows as stale automatically.
4. **Ground in external truth, side by side.** CI status (LINK-06) and any test command output appear next to the agent's verdicts, so "tests pass" is a fact from the runner, never the agent's sentence.
5. **Fresh-context reviewer.** Run the pre-review as a *new* session reconstituted from the board (criteria + diff) — not the author's context. This is the Flywheel thesis applied: discarding context is free, so use it to get a reviewer that does not share the author's blind spots.
6. **Show coverage and gaps.** List files in the diff no criterion anchors to, and criteria with no evidence, as first-class rows. This is what a bare "looks good" hides.
7. **Review organised around criteria.** The diff view jumps by criterion anchor (REVW-01/03). The agent's thematic grouping of the diff (Devin) is a draft ordering only.
8. **Asymmetric authority.** An agent verdict may *hold* a merge (not_met, could_not_determine on a required criterion) but may never *release* one. This matters concretely: a dispatch auto-merge path exists (`dispatch_auto_merge.rs`, PLAN-04 narrowing); the agent pre-review must not become an input that *enables* automatic merge.
9. **Calibration visible to the user.** Keep a simple per-project count of agent verdicts the human overturned (e.g. "overturned 3 of 40 'met' verdicts"). Both sides are recorded, so it costs a query; it is the one honest answer to "should I trust this" and replaces a confidence score. Optional.

| Feature | Class | Complexity | Depends on |
|---|---|---|---|
| Per-criterion agent verdict (met / not met / could not determine) with anchors, distinct from human check | **Table stakes** (for "agent pre-reviews its diff") | Medium | REVW-03, `criterion_anchors`, `review.rs`, DATA-03 |
| "Unverified claim" rendering for anchorless verdicts; derived staleness | **Table stakes** | Low | D-140/D-141 (shipped) |
| CI/test result shown next to verdicts | **Table stakes** | Low | LINK-06 |
| Fresh-context reviewer session reconstituted from criteria + diff | **Differentiator** | Medium | CTX-03/08, REVW-01 |
| Coverage rows: unanchored files, evidence-less criteria | **Differentiator** | Low-Medium | `review.rs` |
| Criterion-ordered diff navigation | **Differentiator** | Medium | REVW-01/03 |
| Asymmetric authority: verdicts can hold a merge, never release one | **Differentiator (safety invariant)** | Low | `dispatch_auto_merge` path; add a source-gate test in the PROP-03 style |
| Overturn-rate counter | **Differentiator, optional** | Low | Events |
| Numeric confidence score / "AI approved" badge / green check from the agent | **Anti-feature** | | Self-confidence nearly uninformative; badge induces automation bias |
| Prose summary of the diff as the review | **Anti-feature** | | "Read the diff, not the description" |
| Agent auto-checks criteria | **Anti-feature** | | Violates Core Value's honesty |
| Generic AI review-bot style nit comments with severity spam | **Anti-feature** | | Creates the review chore the milestone is meant to remove; keep to criteria-relevant findings plus a short, tiered "other concerns" list |
| Auto-fix without a human accepting the fix | **Anti-feature** | | Devin itself requires approval |
| Second-model-family review | **Defer** | High | BKND-* (v2) |

---

## 6. Loop-Engineering UX: The "Come Back To It" Quality

**Confidence caveat:** this section is mostly synthesis. Sources: practitioner write-ups on agent dashboards ("a queue of active, blocked, and completed tasks competing for human attention"; sessions grouped by state with name, branch, permission mode, current activity, time since last update; the actions monitor / reply / dispatch), the Cursor Agents Window (single sidebar of all local and cloud agents with status; simpler diffs view; stage/commit/PR in-window), Shape Up hill charts, and the v0.1.0 fleet research. No empirical study of "feels alive" was found. The v0.1.0 fleet surfaces (FLEET-01…05) are the base; this section is about what the *home screen* does with them.

### What the quality actually consists of

| Ingredient | What it means concretely | Shipped base | Class | Complexity |
|---|---|---|---|---|
| **Instant re-entry digest ("since you left")** | One strip answering: N landed (merged), N need you, N failed, N proposed, N running. Computed from the event log from the user's last-seen cursor. | DATA-05 resumable cursor, FLEET-02/04, PROP triage count | **Differentiator** (no Family A tool reconstitutes the user the way Flywheel reconstitutes the agent) | Low-Medium |
| **One explained next action** | A single primary affordance ranked: blocked-on-you agent > review-ready task > untriaged proposals > ready-to-dispatch task > a shaping session to continue. Each states *why it is first* in one phrase. Fits the user's stated preference for one concrete next action over a menu. | FLEET-02 queue, REVW, PROP-06 | **Differentiator** | Medium |
| **State legible without opening anything** | Colour (plus shape/icon, not colour alone) for a small closed vocabulary — running, blocked, failed, in-review, merged, proposed — the same colour in fleet row, board card, roadmap rollup and notification. A segmented progress bar on epic and phase (done / in review / running / blocked / todo) beats a percentage. | FLEET-04, LINK-07, `epic_progress` | **Table stakes** for this milestone (the visual direction), Medium | Medium |
| **Visible forward motion** | Things *land*: an item moving from running → review-ready → merged is a visible, attributable transition (a "Landed" list for the active phase, items animating between states). Momentum is *descriptive* (what merged), never *predictive* (velocity). | Event log, LINK-07 | **Differentiator** | Medium |
| **Calm, honest liveness** | Present-tense plain-language status per running agent derived from the latest tool event ("Writing tests for X") rather than a log tail; motion/pulse *only* on a real state change; `prefers-reduced-motion` respected; notifications coalesced (already 3s). | PROC-07 stream, FLEET-05 | **Table stakes**, Low-Medium | Low-Medium |
| **A place to be proud of finished work** | Phase close shows what shipped (agent-drafted summary from merged items, section 3). | CTX-01 summaries | **Differentiator**, Low-Medium | Low-Medium |
| **Derived hill position per epic** | Shaping/decomposing = uphill, executing/reviewing = downhill, derived from state not hand-dragged. | SHAPE, dispatch state | **Differentiator, speculative** (MEDIUM-LOW; try only on the roadmap strip, drop if it adds noise) | Medium |

### Alive vs. monitoring console

A console is rows plus timestamps plus a log you must read to learn anything, and it is organised by *agent*. A product feels alive when it is organised by *work* (the roadmap and the next action), when state changes are visible as transitions with spatial continuity, and when text is written in sentences. The Cursor Agents Window is organised by agent in a sidebar and is therefore, structurally, a console with good diffs; Flywheel's advantage is that the board gives a work-centred home. Keep the agent-centred fleet view as a drill-down, not the landing page.

Dark-first and high-contrast constraints that follow from "colour carries state" (design guidance, standard WCAG numbers, HIGH): body text at least 4.5:1 and UI component boundaries at least 3:1 against the dark surface; saturated accents reserved for state so that decoration never competes with signal; every state also has an icon or label so colour-blind users lose nothing. Per the project's rule that IA leads and the visual round follows, apply this to the new IA surfaces (roadmap strip, PRD/ADR views, review) rather than re-skinning the shipped ones first.

### Anti-features for this section

| Anti-feature | Why requested | Why problematic | Alternative |
|---|---|---|---|
| Streaks, points, confetti, leaderboards | "Give people the will to continue" | Manipulative, trivial to game, irrelevant to a solo developer whose motivation is *real* progress | Real progress made visible: landings, phase-close summary |
| Throughput / velocity trend charts as the home screen | Looks like momentum | It is velocity/portfolio reporting, on the Out of Scope list; also not predictive in this domain | Counts of what landed since last visit |
| Activity-feed firehose | "Alive" | Console again; hides the one thing that needs you | Digest + ranked next action |
| Notification for every event | Awareness | Fatigue; already coalesced in FLEET-05 | Keep the existing coalescing; only blocked/finished/failed |
| Per-agent log wall as the landing view | Transparency | Requires reading to learn state | Drill-down only |
| AI-generated motivational copy | Warmth | Noise and tone risk | Plain, specific status sentences |
| Custom themes / user-configurable palettes | Preference | A configurable palette breaks "colour = state" consistency | One dark-first theme, state colours fixed |

---

## Consolidated Feature Landscape

### Table Stakes (this milestone is incomplete without these)

| Feature | Why Expected | Complexity | Notes |
|---|---|---|---|
| PRD record with slots, lifecycle, sign-off event, revisions, derived progress | The stated goal; wiki pages fail | Medium | Optional per epic |
| ADR record with proposed/accepted/rejected/superseded, immutable body, atomic supersession | Nygard/MADR baseline | Medium | |
| Epic ↔ PRD and epic ↔ phase as nullable FKs; ADR ↔ epic join | Spine untouched (BOARD-01) | Low-Medium | |
| Phase record with goal, state, order, carryover prompt, scope-change chip | Cycle table stakes | Low-Medium | No dates required |
| Roadmap strip always visible with derived segmented rollup | Explicitly requested | Medium | BOARD-08 perf |
| Staging extended to new kinds with per-item accept/reject/amend | Design rule: no form an agent could draft | Medium | Re-prove PROP-03 |
| Draft-as-default-value with provenance, reasoning on demand, refine-with-feedback | Separates saved work from review chore | Medium | |
| File-set chips + fuzzy picker replacing hand-typed paths | The developer's explicit complaint | Medium | After PLAN-01 live proof |
| Criteria drafted by default for any criteria-less task; run refused without them | Phase 8 audit finding | Medium | Before BOARD-03 lock |
| Agent verdict per criterion with anchors, distinct from human check, unverified rendering | Honest review | Medium | |
| State colour vocabulary applied consistently on new IA | Visual direction | Medium | |
| PLAN-01 live-proven; AGNT-05 live-observed | Carried unmet from v0.1.0 | Medium | Not a new feature; a proof debt |

### Differentiators (where Flywheel competes)

| Feature | Value Proposition | Complexity | Notes |
|---|---|---|---|
| Socratic PRD and ADR drafting with recorded open challenges | Nobody pairs adversarial questioning with a persistent board | Medium | Raises SHAPE-01 |
| ADRs and PRD slots injected into the context packet; contradiction flag | ADRs are *read by construction* | Medium | CTX-03/04/06 |
| `propose_decision` at real forks, non-blocking with provisional choice | Agent surfaces decisions instead of silently choosing | Medium | Rate-limited, PROP-05 |
| Fresh-context reviewer session | Blind reviewer for free via cheap context | Medium | |
| Asymmetric review authority (hold, never release) | Prevents automation-bias failure at the merge | Low | |
| Re-entry digest + one explained next action | "Come back" quality | Low-Medium / Medium | |
| Declared-vs-actual file-set reconciliation | Planning accuracy improves from real runs | Medium | PLAN-05 |
| Phase exit criteria; agent-drafted phase-close summary | GSD-like phase gating on the board | Medium | |
| Quick capture to structured draft | Kills encoding work at the moment it occurs | Medium | |
| Derived hill position (speculative) | Free Shape Up-style insight | Medium | Trial only |

### Anti-Features (violate Out of Scope or the product thesis)

| Feature | Why Requested | Why Problematic | Alternative |
|---|---|---|---|
| Velocity chart, capacity dial, burndown/burnup | Standard in Linear/Jira | Out of Scope: burndown, resource planning | Descriptive counts of what landed |
| Required dates, cooldowns, auto-created recurring phases | Cycle parity | Time-boxing; collides with deferred automations | Phase closes on exit criteria |
| Story points / hours feeding forecasts; time tracking | Estimation culture | Out of Scope: time tracking, resource planning | Keep coarse `estimate` 1..3 for sizing only |
| Portfolio / initiative roll-ups across projects with health | Executive visibility | Out of Scope: portfolio reporting | FLEET view stays operational |
| Manual weekly project updates with On Track / At Risk | Linear parity | Hand-written encoding work | Derived state colour |
| Custom fields, custom statuses, PRD/ADR templates, custom workflows | "Flexibility" | Out of Scope: configurable workflows; agents need a fixed schema | Fixed slots |
| Free-form PRD/ADR document editor | Familiarity | Recreates the wiki page | Slots + read-only render + export |
| Mandatory PRD/ADR per epic | Process rigor | Spec overhead; small fixes suffer | Optional |
| Multi-approver sign-off, roles | Governance | Team/cloud milestone | Single sign-off event with actor |
| Bidirectional ADR/markdown sync | Repo purity | Two sources of truth | One-way export |
| Auto-accept of PRDs/ADRs/criteria; "Accept all" as primary | Speed | Rubber-stamping; contradicts PROP-02/03 | Per-item, then "accept remaining" |
| Agent confidence score, "AI approved" badge, agent checking boxes | Reassurance | Self-confidence uninformative; automation bias | Evidence-anchored verdicts |
| Gamification (streaks, points, confetti) | "Will to continue" | Manipulative; irrelevant | Visible landings |
| Merge queue, multi-model review race | Throughput | Already excluded v0.1.0 / v2 | |
| Agent re-prioritising existing backlog unprompted | Autonomy | v0.1.0 anti-feature stands | Suggestions on triage entry / explicit ask |

---

## Feature Dependencies

```
PLAN-01 live proof (unmet in v0.1.0)
    └──requires──> a real planning run observed against a live account
    └──gates──> File-set chips + picker, and deletion of WavePlanSheet textarea
                    └──gates──> ADR path-glob scoping (falls back to epic-level link until then)

Staging extension (new target kinds: prd, adr, phase, file_set, field suggestion)
    └──requires──> table-rebuild migration for CHECK on staging target_type (0011)
    └──requires──> PROP-03 source-gate learns new canonical-writer modules
    └──enables──> PRD drafting, ADR proposing, phase membership suggestions, quick capture

Criteria on PRD / phase (exit criteria, acceptance bar)
    └──requires──> table-rebuild migration for acceptance_criteria.parent_type CHECK (0002)
    └──requires──> BOARD-03 revision/lock semantics generalised

PRD record ──requires──> Staging extension (for Socratic drafting)
    └──enables──> Epic proposals from a signed PRD
    └──enhances──> Context packet (CTX-03/04)

ADR record ──requires──> Staging extension, propose_decision tool
    └──enhances──> Context packet + CTX-06 contradiction detection
    └──enhances──> Phase-agnostic: independent of the phase layer

Phase layer ──requires──> phase_id on epics, event log (scope-change), epic_progress
    └──enhances──> Roadmap strip, re-entry digest, phase-close summary

Agent pre-review verdicts ──requires──> criterion_anchors (0018), review.rs, REVW-03
    └──requires──> fresh-context session reconstitution (CTX-03/08)
    └──must not feed──> dispatch auto-merge as a release signal

Re-entry digest ──requires──> event log cursor (DATA-05) + per-user last-seen marker
Next-action ranking ──requires──> FLEET-02 queue, PROP triage count, review-ready state
Colour-as-state ──requires──> a single closed state vocabulary shared by fleet, board, roadmap, notifications

Wiki-style PRD editor ──conflicts──> structured slots, BOARD-03 lock
Velocity/capacity ──conflicts──> PROJECT.md Out of Scope
```

### Dependency Notes

- **Two CHECK-constraint rebuilds are the hidden cost of this milestone.** `acceptance_criteria.parent_type` (migration 0002) and the authoring staging `target_type` (migration 0011) both enumerate allowed values at the schema level, which the project deliberately treats as the authority (the CHECK, not app code). Extending either needs a table-copy migration on SQLite. This is the correct tradeoff for integrity but should be a named plan, with the reversibility requirement DATA-08.
- **PLAN-01 is on the critical path of the user's headline complaint.** The hand-typed file paths remain until PLAN-01 is observed live. Do not plan the chip UI before the live run; v0.1.0 shows what happens when a fallback form ships ahead of an unproven agentic path.
- **The PROP-03 structural gate is the model, and a liability.** The source-walker test restricts direct writes to canonical tables to four domain modules. New record types (`prds`, `adrs`, `phases`) need to be added deliberately, or the gate will (correctly) fail. Treat that failure as the check working.
- **Context packet growth is an existing open item.** Adding PRD slots and ADRs to the packet before the unbounded-summaries cap lands worsens the issue named in PROJECT.md. Cap new contributions and, ideally, schedule the packet bound in the same milestone.
- **`estimate` has no consumer today** (it is a 1..3 column). Decide what reads it before building drafting UI for it.

---

## MVP Definition (for v0.2.0 requirements)

### Launch With (v0.2.0)

- [ ] Staging queue generalised to the new kinds, with provenance-marked pre-filled drafts — everything else rides on it
- [ ] PLAN-01 observed live; file-set chips + picker; hand-typed textarea removed
- [ ] Criteria drafted by default; run on a criteria-less task routes through drafting
- [ ] PRD record (slots, lifecycle, sign-off event, revisions) with Socratic drafting and per-slot adjudication; optional per epic
- [ ] ADR record (4 states, immutable body, atomic supersession) with `propose_decision` and context-packet injection
- [ ] Phase record with goal, carryover prompt, scope-change chip, and a persistent derived roadmap strip
- [ ] Agent pre-review verdicts with anchors, human check separate, hold-never-release invariant
- [ ] Re-entry digest and a single explained next action
- [ ] State-colour vocabulary on the new surfaces
- [ ] AGNT-05 live observation; DIST-01 given a home (carried debts)

### Add After Validation (v0.2.x)

- [ ] Fresh-context reviewer session — once single-session pre-review shows value
- [ ] Declared-vs-actual file-set reconciliation — once PLAN-01 has real run history
- [ ] Phase exit criteria and phase-close summary
- [ ] ADR path-glob scoping and derived staleness
- [ ] Quick capture
- [ ] Overturn-rate counter

### Future Consideration

- [ ] One-way ADR/PRD markdown export
- [ ] Per-field opt-in auto-apply
- [ ] Derived hill position (trial)
- [ ] Second-model-family review (BKND-*)

## Feature Prioritization Matrix

| Feature | User Value | Implementation Cost | Priority |
|---|---|---|---|
| Staging generalised + draft-as-default | HIGH | MEDIUM | P1 |
| File-set chips/picker (after PLAN-01) | HIGH | MEDIUM | P1 |
| Default criteria drafting + refuse criteria-less runs | HIGH | MEDIUM | P1 |
| PRD record + Socratic drafting | HIGH | MEDIUM | P1 |
| ADR record + propose_decision + packet injection | HIGH | MEDIUM | P1 |
| Phase record + roadmap strip + carryover | HIGH | MEDIUM | P1 |
| Pre-review verdicts with anchors | HIGH | MEDIUM | P1 |
| Re-entry digest + next action | HIGH | LOW-MEDIUM | P1 |
| State-colour vocabulary on new IA | HIGH | MEDIUM | P1 |
| Fresh-context reviewer | MEDIUM-HIGH | MEDIUM | P2 |
| Declared-vs-actual reconciliation | MEDIUM | MEDIUM | P2 |
| Phase exit criteria / close summary | MEDIUM | MEDIUM | P2 |
| Quick capture | MEDIUM-HIGH | MEDIUM | P2 |
| ADR path-glob scoping | MEDIUM | MEDIUM | P2 |
| Markdown exports | LOW-MEDIUM | LOW | P3 |
| Derived hill chart | LOW-MEDIUM (speculative) | MEDIUM | P3 |
| Velocity / burndown / portfolio / time | NEGATIVE | — | Do not build |

## Competitor / Reference Feature Analysis

| Feature | Linear | Shape Up / Basecamp | Kiro / Spec Kit | Devin | Flywheel's approach |
|---|---|---|---|---|---|
| "Why/what" record | Project + Resources docs, lead, milestones; no gate | Pitch with 5 slots, betting table | requirements.md (EARS), constitution | n/a | Fixed slots, sign-off event, revisions, optional |
| Challenge before commit | None | Shaping is human work | `clarify`/`analyze` commands | Clarifying questions when confidence low | Socratic agent, recorded open challenges |
| Decision records | none native | none | design.md | n/a | ADR record, injected into context, contradiction-flagged |
| Time layer | Cycles with rollover, capacity, graphs | 6-week cycle, no backlog, circuit breaker | n/a | n/a | Phase = scope container with goal, carryover, scope-change chip; no velocity |
| Draft acceptance | Per-property suggestion, hover reasoning, auto-apply policy | n/a | Whole-document gate | Auto-Fix needs approval | Per-item staged adjudication; draft as default value |
| Review honesty | n/a | n/a | n/a | Severity tiers, flags for uncertainty | Anchored verdicts, separate from human check, hold-never-release |
| Progress | Project graph | Hill chart (hand-dragged) | Task list | n/a | Derived segmented rollup; derived hill trial |

## Sources

Fetched or confirmed in 2+ sources this session:
- Linear Cycles: https://linear.app/docs/use-cycles (HIGH)
- Linear Projects (resources, lead, milestones, one project per issue): https://linear.app/docs/projects (HIGH); Project status customisation: https://linear.app/docs/project-status (HIGH for "customisable", defaults not stated)
- Linear Triage Intelligence: https://linear.app/docs/triage-intelligence (HIGH)
- Linear project update health values: guideflow tutorial and Sentry/Linear agent-skill listing via search (MEDIUM)
- Shape Up ch. 6 (pitch, betting table, circuit breaker): https://basecamp.com/shapeup/1.5-chapter-06 (HIGH); hill charts and scope mapping: curiouslab.io, reflectoring.io, sachinrekhi.com summaries (MEDIUM)
- Nygard ADRs: https://www.cognitect.com/blog/2011/11/15/documenting-architecture-decisions (HIGH)
- MADR 4.0.0: https://adr.github.io/madr/ (HIGH)
- ADR adoption and abandonment: https://www.jonoherrington.com/blog/how-to-write-adrs-that-actually-get-used (MEDIUM); also search results from contributing.bitwarden.com, docs.cloudposse.com, pdpspectra.com, research.chalmers.se (MEDIUM)
- Kiro specs: horadecodar.com.br, codemyspec.com (Kiro Specs Explained), verdent.ai, smithery.ai (MEDIUM-HIGH)
- GitHub Spec Kit: augmentcode.com, xebia.com, context7.com/github/spec-kit (MEDIUM-HIGH)
- Spec-driven criticism and benchmarks: marmelab.com ("Waterfall Strikes Back"), codemyspec.com, uvik.net benchmark, hackernoon first impressions (MEDIUM)
- Jira sprint report, velocity, burndown: atlassian.com burndown tutorial, released.so, jira.atlassian.com JSWSERVER-13810, ones.com (MEDIUM-HIGH)
- Devin Review: https://docs.devin.ai/work-with-devin/devin-review (HIGH)
- Automation bias in AI review: https://addyosmani.com/agentic-engineering/automation-bias/ (MEDIUM)
- Self-evaluation bias in agent loops: arXiv 2607.25152, arXiv 2605.17548, web-developpeur.com "No Agent Grades Its Own Homework" (MEDIUM-LOW; abstracts only)
- Claude Code plan mode: fast.io, openreplay, agentpatterns.ai guides (MEDIUM)
- Cursor Agents Window: forum.cursor.com/t/cursor-3-agents-window/156509, cursor.com/help/ai-features/multi-agent, agentpatterns.ai (MEDIUM)
- Agent supervision surfaces: blakecrosley.com/blog/agents-need-supervision-surfaces, junctionpanel.dev, blog.marcnuri.com (MEDIUM-LOW)

Repository evidence (read this session):
- `.planning/PROJECT.md`, `.planning/REQUIREMENTS.md`, `.planning/research/FEATURES.md`, `.planning/research/COMPETITION.md`
- `packages/desktop/src/dispatch/WavePlanSheet.tsx` (hand-typed files textarea, "No files declared, so this task runs alone.")
- `packages/core/src/db/migrations/0002_board_schema.sql` (`priority 0..4`, `estimate IN (1,2,3)`, `acceptance_criteria.parent_type IN ('task','epic')`), `0011_authoring_staging.sql` (`target_type IN ('epic','task','criterion','assumption')`, `verb IN ('create','amend','delete')`), `0018_criterion_anchors.sql` and `domain/acceptance_criterion.rs` (anchors, D-139/140/141)

## Gaps to Address

- Linear's default project status names were not confirmed (docs said customisable; defaults not listed). Immaterial to the recommendation.
- Notion and Height PRD modelling are from prior knowledge, not re-fetched.
- Google Docs suggesting mode and Cursor/Copilot inline keep/undo are described from prior knowledge, not re-verified this session.
- No empirical source on what makes a supervision dashboard feel alive; section 6 is synthesis. Plan a cheap in-product validation (the developer's own week of use is the success metric) rather than more desk research.
- What consumes `estimate` (1..3) is undecided and should be settled in requirements before drafting UI is built for it.
- Whether the agent pre-review should run inside the author session or a fresh one is a design decision with a cost tradeoff (tokens per review); recommended fresh, but unmeasured.
- Whether a phase may contain epics from only one PRD (cleaner) or many (realistic) is a modelling question for requirements; recommend many.

---
*Feature research for: Flywheel v0.2.0 "The Board Thinks With You"*
*Researched: 2026-10-14*
