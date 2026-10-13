# Phase 5: Socratic Epic Authoring - Context

**Gathered:** 2026-09-23
**Status:** Ready for planning

<domain>
## Phase Boundary

Cyril opens a conversational session whose **output medium is the board**. Before anything is
planned, the agent challenges his framing rather than interviewing him — and it is structurally
unable to propose work until he says the challenge is done. The session then decomposes the shape
into tasks and drafts acceptance criteria for each, and every one of those proposals is accepted,
rejected or amended **individually**, down to the single criterion. Reopening the epic weeks later
resumes the same machine, with the agent challenging the change against the answered assumptions,
task roster, criteria and previously-rejected proposals the epic already carries.

Nothing an authoring session produces touches `epics`, `tasks` or `acceptance_criteria` until a
human accepts it. Proposals are durable board state, not session state — a session abandoned
halfway leaves real, visible, decidable work behind, because the session is disposable and the
board is not. This is ARCHITECTURE.md §6(a) implemented: the human is the write-gate for structure
created during authoring, mediated through the UI, and Anti-Pattern 2 (agents never write
`Task`/`Epic` directly) holds unchanged.

This phase also forces the first two seams Phase 4 deliberately left open: an agent read path over
the board, and the shape of the agent→board *structure* write surface that Phase 6 extends.

**Requirements:** SHAPE-01, SHAPE-02, SHAPE-03, SHAPE-04, SHAPE-05.

**Not this phase:** agent-proposed issues discovered during autonomous execution and the triage gate
over them (Phase 6 — it extends this phase's lane and write seam), git/forge truth on the board
(Phase 7), diff review against criteria (Phase 8), fan-out and declared file-sets (Phase 9), fleet
supervision (Phase 10).

</domain>

<decisions>
## Implementation Decisions

Decision numbering continues from Phase 4 (D-01–D-22 are Phase 1, D-23–D-40 are Phase 2,
D-41–D-63 are Phase 3, D-64–D-79 are Phase 4).

### Where proposals live before they are accepted

- **D-80:** **A session-scoped staging table holds every proposed epic, task and criterion; the
  canonical tables are untouched until acceptance — and staged rows outlive the session.** The
  board schema forced this: `0002_board_schema.sql:41` pins epics and tasks to one five-state CHECK
  with no `draft` and no reconfiguration path, so ARCHITECTURE.md §2's `Epic.status = draft` does
  not exist in the shipped product; every item burns a contiguous per-project key (D-10), so
  proposing into the canonical tables would burn keys on every rejection; and
  `acceptance_criteria.parent_type` accepts only `'task'` or `'epic'`, so a drafted criterion has
  nowhere to hang until its parent is real. Staging solves all three at once and keeps
  ARCHITECTURE.md Anti-Pattern 2 literally true rather than approximately true. Durability is not a
  convenience — if staged proposals died with the session, the session would be the store of record,
  which is precisely what the Core Value forbids.
  Rejected: creating real rows immediately in `backlog` and treating accept/amend/reject as ordinary
  board edits (zero new schema, and the board is the store of record from the first proposal — but
  the agent writes `epics`/`tasks` directly, rejections burn keys permanently, and the board fills
  with junk during the exact conversation where clarity matters) and using the `issues` lane as the
  staging area (reuses `IssuesLane.tsx` and is the channel Phase 6 needs anyway — but D-07 put
  criteria on tasks and epics only, so SHAPE-03's drafted criteria would have nowhere to live until
  after promotion, which is backwards from "editable before accepting").
  — **Reversibility:** one-way — a migration, and the shape every authoring write tool, the triage
  lane, the accept path and the reopening packet are all written against.

- **D-81:** **A proposal carries a uniform verb — `create`, `amend` or `delete` — plus an optional
  target id.** One staging shape and one accept path serve a fresh epic and a reopened one
  identically. An `amend` accepted against a criterion already locked by D-76 materialises as a
  D-77 revision row, never an `UPDATE` — the immutability Phase 4 shipped is not something this
  phase may route around. Safety comes from the human gate that defines this phase: no proposal is
  real until Cyril accepts it, so a `delete` verb is no more dangerous than a `create`.
  Rejected: create + amend with deletion reserved to humans (matches the rigidity instinct of D-23,
  D-24 and D-43, and keeps the one irreversible verb out of agent hands — but the reshaping
  conversation would then end in a manual step the agent could see was needed and not draft) and
  additive-only proposals (structurally incapable of touching criteria a run is pinned to via D-78,
  but SHAPE-05's "challenges the change against what the epic already contains" degrades to
  advice, which is most of the reason to reopen an epic at all).
  — **Reversibility:** one-way — the verb is part of the staging schema and of every write tool's
  argument contract.

- **D-82:** **Pending proposals surface as a board-level triage lane, alongside the existing
  workflow-less `IssuesLane`.** A wholly-staged new epic has no row to hang a detail-panel section
  on — the exact case SHAPE-01 is about — so a lane is the only home that serves both the fresh and
  the reopened path with one surface. A count on the epic row comes free from D-37's
  board-visible-state-plus-rail-count precedent. **This lane is what Phase 6's triage surface
  extends rather than reinvents**, which is why it is built here.
  Rejected: a `proposed` section inside `ItemDetailPanel.tsx` (strongest locality, but it cannot
  host a not-yet-existing epic, so it needs a second surface for the primary case) and keeping
  pending proposals visible only inside the authoring surface (cleanest board, zero new surface —
  but pending work becomes invisible state, the silent-degradation failure this project has
  designed against three times in D-16, D-45 and D-74).

- **D-83:** **A decided proposal row stays, marked terminal — `accepted` or `rejected` — and the
  rejected set is primed into every later session for this epic.** It is the single strongest guard
  against an agent re-proposing what Cyril already killed, available as one indexed read rather than
  an event replay, and it is exactly the ammunition SHAPE-05's challenge needs. **It must ship
  bounded** — STATE already carries the unbounded-read warning against `context_packet.rs`'s
  `SUMMARIES_SQL`, and this is the same failure with a different table.
  Rejected: consuming on accept and deleting on reject, with history left to the append-only event
  log (smallest mutable table, one source of history, and the event log is already human-renderable
  per D-19 — but "what did I already reject" becomes an event replay, making the re-proposal guard
  materially harder to build) and consuming accepted rows while keeping rejected ones (keeps the
  table small and preserves the only history that changes agent behaviour — but two lifecycles in
  one table, and the accept path has to branch on which).

### The authoring session itself

- **D-84:** **An epic-authoring session IS an `agent_run`. `agent_runs.task_id` becomes nullable, a
  nullable `epic_id` is added, and `triggers.target_task_id` is loosened the same way.** An
  authoring session is a real `claude` process: it can hang, block on a permission, burn money and
  be orphaned by a crash — and every piece of the apparatus Phase 3 built for exactly that (the
  watchdog, the heartbeat file, the kill record, the `abandoned` reconciler, the JSONL session log,
  cost tracking) hangs off `agent_runs`. `worktree_id` is already nullable, so a worktree-less run
  is representable today. The alternative is not "avoid a migration", it is "implement all of Phase
  3 twice".
  Rejected: a separate `authoring_sessions` table (leaves Phases 2–4's execution path untouched —
  but the watchdog, heartbeat, kill record, reconciliation, cost tracking and session log each need
  a second implementation or the same generalisation, paid twice and with two things to keep in
  sync) and anchoring the session to a synthetic placeholder task (no schema change at all today —
  but it puts rows on the board that are not work, and every board query, count, search and export
  must learn to hide them; that lie would leak into the one surface the Core Value says holds
  nothing but real work).
  — **Reversibility:** one-way — a CHECK-constrained table rebuild following
  `0006_recovery_statuses.sql`'s worked sequence, plus an audit of every query and call site that
  currently assumes `task_id` is present.

- **D-85:** **The conversation renders on `SessionSurface.tsx`, with a live proposal tray beside the
  feed.** Same route, same chrome: the structured feed with raw-stream-on-demand (D-32), the
  windowed scrollback read (D-33), the permission cards, the status strip, Stop and Discard all work
  unchanged, and the product keeps exactly one place where an agent session is rendered and one
  place where its blocked-state, cost and stop verbs are wired. The tray is the single new panel —
  staged proposals accumulating as the agent makes them.
  Rejected: a dedicated authoring surface with its own route and layout (FEATURES.md is blunt that
  this flow dies if it does not *feel* better than typing into a terminal, and that is partly a
  layout argument — but it means a second session-rendering surface and D-37's blocked state, cost
  display and Stop/Discard wired in two places) and a board-native flow with no transcript at all
  (the most literal reading of "board items, not a chat log" — but a Socratic exchange is
  conversational by nature, and turning every challenge into a card round-trip makes this the
  slowest way to shape an epic rather than the fastest).

- **D-86:** **The authoring agent runs read-only in the project's registered main checkout.** `cwd`
  is the repository root from `projects`; **D-36's accept-edits default explicitly does not apply**
  and the read-only posture is a thing the phase must prove, not assume. This is what makes its
  challenges specific — "you already have a module that does this" — rather than generic, which is
  the difference between a differentiator and a prompt. Phase 3's PATH shim and destructive gate
  still wrap the spawn, so nothing in the safety story regresses.
  Rejected: a dedicated read-only worktree off the trunk (structurally unable to reach the working
  tree, and it fits D-23's fixed root — but `worktrees.task_id` is NOT NULL UNIQUE, so it needs a
  second schema loosening on top of D-84 plus create/remove lifecycle for something that is not
  work, and a fresh trunk worktree does not reflect what Cyril is actually sitting on) and board-only
  access with no repo reads at all (zero filesystem surface, fully deterministic inputs — but every
  challenge it could make would be about coherence with the board, never about what already exists
  in the code).

- **D-87:** **Priming is an epic-scoped packet plus a small set of capped read tools.** A sibling of
  `assemble_context_packet` hands the session the epic, its task roster with criteria and statuses,
  prior authoring summaries and the D-83 rejected set; capped read tools (search, get_epic,
  list_tasks) then let it go looking for the duplicate or related epic a fixed packet could never
  anticipate. **This phase is the moment STATE warned about** — `epic_roster`'s deliberate exemption
  from `DEFAULT_LIMIT`/`MAX_LIMIT` (`01-SECURITY.md` AR-01-04) was safe only while one human created
  epics one at a time, and giving an agent a board read path is what makes it unbounded. Closing
  that cap is in scope here.
  Rejected: a packet with no read tools at all (extends D-28's and CTX-04's determinism contract
  cleanly to a second scope and lets `epic_roster`'s cap stay deferred — but the agent cannot check
  whether an epic for this already exists, so duplicate detection becomes entirely Cyril's job) and
  read tools with no packet (most flexible and the natural mirror of the write seam — but the
  session starts cold, spends its opening turns fetching what a packet hands it free, and its inputs
  stop being reproducible for no gain).

### What makes it Socratic rather than an interview

- **D-88:** **A three-stage machine — challenge → decompose → criteria — where the proposal tools do
  not exist in the tool set until the stage advances.** "Ask before you plan" is enforced by
  *absence*, not by instruction: during the challenge stage there is literally no tool the agent
  could call to write a proposal. This is GSD's own discuss/research/plan, which PROJECT.md names as
  the origin of the whole idea, and unlike a prompt it is testable — a plan can assert that no
  proposal row exists before the stage advanced.
  Rejected: a precondition inside the write tools that refuses until N challenges have been answered
  (cheaper, never blocks a loop-back, and it makes the write path the authority the way Phase 1 made
  the CHECK constraint the authority — but a counter is a crude proxy for a good challenge and a
  model satisfies it with cheap questions) and a system prompt alone (ships fastest and is exactly
  how every Socratic pattern surveyed in `FEATURES.md` works today — but nothing structural stops it
  degrading into an interview, there is no assertion to write about it, and the differentiator
  becomes a paragraph anyone copies in an afternoon).
  — **Reversibility:** costly — the stage is carried on the run, gates the tool set the adapter is
  spawned with, and is read by the tray, the feed and the advance affordance.

- **D-89:** **The challenge stage is free conversation; advancing distils it into staged assumption
  rows that go through the same accept/amend path as every other proposal.** Cyril talks normally —
  which is the thing that has to beat a terminal — and the act of advancing makes the agent write
  out the assumptions it challenged and the answers it got. Because those rows are amendable
  through the D-94 path, the model's reading of the conversation is *correctable rather than
  authoritative*, which is what makes a distilled record acceptable at all. The epic's reasoning
  ends up board-shaped and durable without anyone filling in a form.
  Rejected: structured challenges from the first turn, each one a row Cyril answers (most rigorous,
  fully auditable, and it gives a reopened session something exact to challenge against — but it
  turns the conversation into a form, which is the friction FEATURES.md names as what sends people
  back to the terminal) and prose only, with structure appearing at the proposal stage (simplest,
  nothing new to build — but the reasoning then lives only in a transcript, the chat blob the Core
  Value forbids as a store of record, so reopening means re-reading a log to learn why the epic is
  shaped this way).

- **D-90:** **Cyril holds the advance gate; the agent may recommend advancing but never advances
  itself. Going back is always allowed, and staged proposals survive the return.** An agent that
  decides when it has challenged enough is an agent that can end its own challenge stage on the
  first turn — the exact failure D-88 exists to prevent. Making the return free is what keeps
  D-88's rigidity from ever biting: there is no cost to reopening the framing.
  Rejected: recording each return as a numbered pass (genuinely useful signal months later, and more
  auditable — but passes are a second concept to model, render and reason about inside the distilled
  assumption set) and letting the agent advance on its own judgement with Cyril able to send it back
  (most fluid conversation, but it hands the agent the one gate the whole mechanism depends on).

- **D-91:** **SHAPE-05's reopening challenge is model judgement, grounded on a fact packet.** The
  reopened session is primed with the epic's answered assumptions (D-89), its task roster with
  criteria and statuses, and the rejected-proposal set (D-83); the challenge itself is the model
  reasoning over those facts. Phase 4's D-72/D-73 ban on model judgement **does not extend here**,
  and the distinction is principled rather than convenient: that ban protected an *unattended*
  continuity path where a wrong judgement is invisible and compounds. Here a human is sitting in the
  loop and every output is gated before it reaches the board, so the discipline that carries over is
  *what facts the judgement is grounded on* — not whether judgement is allowed.
  Rejected: adding mechanical conflict detection on top (a proposed criterion contradicting a locked
  one, a proposed task duplicating an existing one — strictly stronger when it fires, but
  near-duplicate detection is the problem ARCHITECTURE.md §6 already flags as hard, and a detector
  that cries wolf inside a conversation is worse than none) and mechanical detection only with no
  judgement (perfectly consistent with D-72 and trivially testable — but an epic can be internally
  consistent and still the wrong shape, and only judgement catches that).

### Deciding on proposals

- **D-92:** **Granularity is per-row, down to the individual criterion.** Forced by the requirements
  rather than chosen: SHAPE-04 says "any individual item… rather than accepting the set wholesale",
  SHAPE-03 says criteria are editable *before* accepting, and D-06 already gave every criterion its
  own table row and its own ULID. Recorded here so no downstream agent re-opens it.

- **D-93:** **Rejection is a turn in the conversation — the agent sees it, optionally with a reason,
  and may re-propose.** This is the difference between shaping something together and grading a
  worksheet, and it is the half of the loop that makes "Socratic" bidirectional rather than a label.
  The looping risk is already covered: D-83's persisted rejected set is primed into the session and
  is what the agent is told not to re-propose.
  Rejected: terminal and silent rejection (simplest, zero risk of the agent arguing — but Cyril ends
  up typing the objection into the conversation anyway to get a better proposal, so the silence buys
  nothing and costs a round trip) and a structural bar on re-proposing a rejected item, enforced in
  the tool handler (strongest protection against a model that keeps pushing — but "matching" a
  rejected proposal is the near-duplicate similarity problem again, and a false match silently
  swallows a genuinely better second attempt).

- **D-94:** **Amend means editing the staged row and accepting the version Cyril wrote — the board
  never receives a version he did not accept.** SHAPE-03's "which the user can edit before
  accepting" taken literally. Because an amendment is also a turn the agent sees (D-93's rule
  applied to the other verb), the next batch of drafts moves toward what he actually wants instead
  of repeating the same miss.
  Rejected: accept-then-edit using the `ItemDetailPanel` / `AcceptanceCriteriaList` editors that
  already exist (zero new editing UI and one place in the product where an item is edited — but the
  board holds a wrong statement in between, the agent learns nothing, and against an
  already-locked task the first edit becomes a D-77 revision of something that arrived wrong) and
  offering both paths (most forgiving, but two editing paths for the same text and the agent learns
  from only one, making the feedback loop intermittent in a way nobody can reason about later).

- **D-95:** **Bulk accept is subtree-scoped — a task together with its drafted criteria — and there
  is no tray-wide accept-all.** A five-task epic becomes six decisions instead of twenty-six while
  the unit being decided stays a coherent piece of work. SHAPE-04 forbids wholesale acceptance being
  the *only* option, not bulk acceptance existing; a subtree accept keeps Cyril deciding per task,
  which a tray-wide "yes" would quietly stop doing.
  Rejected: an accept-all-remaining single-letter action (fastest when he has read the tray and
  agrees — but it becomes the reflex, and once it is the reflex SHAPE-03's criterion-editing
  requirement is decorative: the phase would pass its tests while the behaviour it exists to create
  stops happening) and no bulk path at all (the strictest reading, and the only version that
  guarantees every criterion is read — but twenty-six keystrokes per epic is precisely the friction
  FEATURES.md names as what sends him back to a terminal prompt).

- **D-96:** **An accepted proposal materialises immediately as a real row in `backlog`; accepting a
  child implies accepting its parent.** The board fills as Cyril decides, so a session he is called
  away from still leaves real work behind rather than nothing — a half-shaped epic *is* an epic with
  fewer tasks, which is the truth rather than a compromise. The implied-parent rule is what
  guarantees the tree can never reference a row that does not exist. `backlog` is the only entry
  state the five-state CHECK offers.
  Rejected: materialising only on an explicit commit of the whole epic (atomic, the board never
  shows a half-built epic, and the per-project key sequence stays contiguous — but it puts a
  wholesale gate back on top of the per-item decisions SHAPE-04 asked for, and an interrupted
  session produces nothing, the exact failure durable staging was chosen to prevent) and
  materialising immediately but hiding the epic from the default board view until it is complete
  (keeps both properties — but a visibility rule is state every query must honour, and
  hidden-but-real rows are what surprise you six weeks later).

### Claude's Discretion

The following were **not** discussed. The researcher and planner should resolve them against the
decisions above and the canonical references — not re-ask the user.

- **The high-assumption spike, and its kill criterion.** ROADMAP.md's Phase 5 Notes and
  `research/SUMMARY.md` §"Risks" both carry an explicit flag: *spike the flow during planning to
  confirm epic authoring here really is faster and better than prompting in a terminal, before
  building the full surface.* STATE.md repeats it as an open concern. Open: what the spike measures
  (wall-clock to a shaped epic? quality of the resulting criteria? both?), what the comparison arm
  is, and what result would change the plan rather than merely be recorded. Decide this **before**
  the surface work is planned, not alongside it.
- **The Nimbalyst competitive re-scout.** STATE.md Blockers/Concerns holds a standing action to
  re-scout Nimbalyst *before* Phase 5 ships, to confirm the moat is still where
  `research/COMPETITION.md` said it was. It has not been done.
- **Where the authoring write and read tools live.** Phase 4's own Discretion list left this open
  and this phase forces it: a second tool set on the existing
  `packages/sidecar/src/mcp-permission-server.ts` process (the precedent D-64 set, and D-53 before
  it), a separate board MCP server, or a new op on the sidecar's stdio protocol. Resolve against
  `research/ARCHITECTURE.md` §6 and Anti-Pattern 2, and build it so **Phase 6 extends rather than
  replaces it** — Phase 6's `propose_issue` is the next tool through the same seam.
- **What a closing summary means for an authoring run.** D-64's `report_summary` and D-65's field set
  assume a task, a diff and a worktree; an authoring run has none of the three. Whether the closing
  summary is the same tool with nullable fields, a sibling tool, or nothing at all — and what
  D-66's bounded wait and the `auto_generated` fallback synthesizer do for a run with no diff to
  synthesize from — is open.
- **Whether `mark_abandoned` now has a second caller.** PROJECT.md and STATE.md both carry the open
  Phase 4 question of what `mark_abandoned` owes the board. D-84 gives it a second kind of run to
  reconcile. This does not have to be answered here, but the planner should not widen the gap
  silently.
- **How a session is started when no epic exists yet**, and whether D-27's launch sheet applies. The
  launch sheet is currently task-scoped and pre-filled from the task packet; an authoring session
  has a different packet (D-87) and possibly no subject at all.
- **Stop and Discard semantics for an authoring run.** D-35's interrupt-then-force and D-66's
  discard-asks-for-a-summary-first were both written for a run with a dirty worktree. Neither
  premise holds here.
- **What the criteria stage drafts.** D-05 made a criterion a checkable statement *plus* a
  verification hint; whether the agent drafts the hint too, and whether a criterion without one can
  be accepted, was not discussed.
- **The keyboard map.** Accept, reject, amend, bulk-accept-subtree and advance-stage all want
  single-letter actions under D-02, against `01-UI-SPEC.md`'s exhaustive Keyboard Map and
  `02-UI-SPEC.md`'s agent signal vocabulary. A stage indicator and a proposal-pending mark must join
  that vocabulary rather than invent a parallel one. **Caveat:** Phase 10.1 is scheduled to re-open
  sections `01-UI-SPEC.md` marks LOCKED — build against it as it stands, do not pre-empt 10.1.
- **How the tray renders while the feed streams**, given D-33's windowed read against the persisted
  log and `SessionSurface.tsx`'s `StatusStrip` constraint on new event shapes.
- **Cost attribution and the project-rail needs-you count for an authoring run** — D-37's count and
  D-46's only-money-burning-blocks rule both need a reading for a run that is a conversation.
- **What happens to a staged proposal whose target item is deleted underneath it** (D-81's `amend`
  and `delete` verbs both carry a target id; D-44 already governs task deletion).
- **Whether authoring runs count toward D-52's per-repository spawn stagger**, given D-86 puts them
  in the main checkout rather than a worktree.
- **Key allocation timing.** D-96 materialises on accept, so per-project keys (D-10) are allocated in
  acceptance order rather than proposal order. Confirm that is acceptable and that nothing renders a
  staged proposal as though it already had a key.

</decisions>

<canonical_refs>
## Canonical References

**Downstream agents MUST read these before planning or implementing.**

### Project intent, scope and requirements
- `.planning/PROJECT.md` — the Core Value and its corollary. The Active requirement *"Socratic epic
  authoring: the agent challenges the user while an epic is being shaped, in the manner of GSD's
  discuss/research/plan phases, and writes the resulting structure as board items"* is this phase's
  charter, and **"in the manner of GSD's discuss/research/plan"** is the direct source of D-88. Also
  load-bearing: the Active row *"Cap the epic roster before an agent can create epics"* (D-87's
  obligation) and the two open Phase 4 rows on packet bounding and `mark_abandoned`.
- `.planning/REQUIREMENTS.md` lines 93–97 — SHAPE-01 through SHAPE-05 verbatim. SHAPE-03's "which
  the user can edit **before** accepting" and SHAPE-04's "rather than accepting the set wholesale"
  are the exact wordings D-92, D-94 and D-95 are pinned to.
- `.planning/ROADMAP.md` §"Phase 5: Socratic Epic Authoring" — the four success criteria this phase
  is verified against, and the Notes: sequenced ahead of the commodity surfaces, **the first phase
  where an agent writes structured items to the board through a tool interface — the write path
  Phase 6 extends**, and the research flag to spike the flow during planning.
- `.planning/ROADMAP.md` §Overview — the "Sequencing rationale for the moat" paragraph explaining why
  this phase precedes Phases 7–8, and the competitive window it is racing.
- `.planning/STATE.md` §Blockers/Concerns — three rows bear directly on this phase: the **Nimbalyst
  re-scout before Phase 5**, **"Phase 5 rests on an unvalidated assumption"**, and **`epic_roster` is
  unbounded by design… the moment an agent gets that path**. Also the unbounded-`context_packet`
  row, which D-83 must not repeat.

### Architecture
- `.planning/research/ARCHITECTURE.md` §6 "Agent↔Board Write Path" — **§6(a) is this phase's
  specification**: the human is the write-gate for structure created during authoring, the agent
  proposes via a structured tool call, the UI renders an editable draft. §6(b) is Phase 6. The
  failure-modes table (spam rate-limiting, near-duplicate collapse, `task_id`-scoped authorization
  enforced server-side, schema validation before any write) applies to this phase's tools too.
- `.planning/research/ARCHITECTURE.md` §"Anti-Patterns to Avoid" — **Anti-Pattern 2**: agents never
  write `Task`/`Epic` directly. D-80 is what keeps this literally true. Anti-Pattern 3 (cwd as an
  implicit git argument) constrains D-86's main-checkout spawn.
- `.planning/research/ARCHITECTURE.md` §2 "Domain Schema" and §2.1 "CQRS-lite with an outbox" — one
  transaction writes the mutable row *and* appends to `events`; every staging mutation rides this.
  §2's `Epic.status = draft` **does not exist** in the shipped schema — D-80 records why.
  §3 "Context-Reconstitution Mechanism" is the contract D-87's epic-scoped packet parallels.
  §5 "Agent Adapter Interface" — D-88's stage-gated tool set must sit behind this seam without the
  supervisor branching on backend identity (AGNT-01).
- `.planning/research/ARCHITECTURE.md` §7 — the `Trigger` seam; D-84 loosens `triggers.target_task_id`,
  so read the row explaining why `trigger_id` exists on every run before changing it.

### Market and risk
- `.planning/research/FEATURES.md` — the table row rating Socratic epic authoring, and especially
  the note that *"the risk is not technical feasibility… but making the output land as clean,
  parseable board structure rather than another wall of text"*, plus item 5 in "What must be true":
  **shaping new work must feel better than typing a prompt into a terminal**. This is the sentence
  D-85, D-89 and D-95 were each argued against.
- `.planning/research/FEATURES.md` §"Everything in section 5 requires the board schema to exist and
  be stable first" — the sequencing dependency this phase finally cashes in.
- `.planning/research/COMPETITION.md` — the weeks-long window, the Nimbalyst assessment, and the
  observation that Socratic authoring is one of the two things a fast competitor cannot bolt on
  quickly.
- `.planning/research/SUMMARY.md` §"Risks" and §"Open Questions" — the Socratic-authoring UX
  validation assumption and the Nimbalyst checkpoint, both still open.
- `.planning/research/PITFALLS.md` — read for anything bearing on an agent write path and on
  criteria never drifting; pitfall 3's rule that **criteria are first-class and never folded into
  prose** constrains what the criteria stage may emit.

### Stack
- `.claude/CLAUDE.md` §"Technology Stack" — the locked stack. Load-bearing here: `rusqlite` in the
  Rust core owns the canonical database and therefore the staging table, the accept path and the
  epic-scoped packet; `rusqlite_migration` owns schema versioning; the sidecar drives the session
  and hosts the tool surface but never opens the database file itself.
- `.planning/research/STACK.md` — the full argument behind those choices.

### Prior phase decisions
- `.planning/phases/04-clear-is-free/04-CONTEXT.md` — **all of it.** Especially **D-64/D-65** (the
  `report_summary` tool and its field set — the first agent→board write seam and the precedent this
  phase's tools follow), **D-76/D-77/D-78/D-79** (the criteria lock, revision-on-edit,
  run-pinned revision sets, and superseded revisions being visible to Cyril and never to an agent —
  D-81's `amend` verb must materialise through exactly this machinery), **D-72/D-73/D-74** (the
  facts-not-judgement discipline D-91 deliberately departs from, and the reasoning for why that
  departure is principled), **D-68/D-69** (compaction and the fixed verbatim window — the precedent
  for bounding D-83), and its Claude's Discretion entry on where the `report_summary` tool should
  live, which this phase forces.
- `.planning/phases/03-nothing-lost-nothing-left-running/03-CONTEXT.md` — especially **D-46** (only
  money burning blocks), **D-51/D-52** (the PATH `git` shim and per-repository spawn stagger, both of
  which D-86's main-checkout spawn inherits), **D-53** (the precedent for adding a second message
  kind to an existing channel rather than opening a second one), **D-47/D-49** (the heartbeat,
  watchdog and `abandoned` status D-84 reuses), and **D-43** (rigidity is the feature).
- `.planning/phases/02-one-agent-one-worktree-watched-live/02-CONTEXT.md` — **D-27** (the launch
  sheet), **D-28** (`assemble_context_packet`'s determinism contract, which D-87 parallels),
  **D-29/D-30** (session start semantics), **D-31/D-32/D-33** (the session surface, the structured
  feed and the windowed scrollback read — D-85's reuse target), **D-34** (the session log path),
  **D-35** (Stop is interrupt-then-force), **D-36** (accept-edits, which D-86 explicitly overrides),
  **D-37** (board-visible blocked state plus project-rail count — D-82's count precedent), and
  **D-39/D-40**.
- `.planning/phases/01-the-board-is-the-store-of-record/01-CONTEXT.md` — **D-05** (a criterion is a
  checkable statement plus a verification hint), **D-06** (criteria are their own table with their
  own ULIDs — the reason D-92's granularity is free), **D-07** (criteria live on tasks and epics,
  never issues — the reason the issues-lane staging option was rejected), **D-09** (inline quick-add
  is the creation path — the interaction the tray should not contradict), **D-10** (per-project
  human-readable keys — D-96's allocation-order note), **D-13** (`task.epic_id` is nullable; no bare
  inner join to `epics`), **D-14**, **D-16** (surface a mismatch, never silently repair it),
  **D-17/D-19** (the event log's per-`(project_id, origin)` sequence and the human-renderable payload
  obligation every staging event inherits), **D-01/D-02/D-03** (the dense virtualized list, the
  single-letter keyboard model, indexed SQL queries).
- `.planning/phases/01-the-board-is-the-store-of-record/01-UI-SPEC.md` — the locked visual direction,
  Surface Inventory and exhaustive Keyboard Map the tray, the stage indicator and the triage lane
  must slot into. **Caveat:** Phase 10.1 is scheduled to re-open sections this document marks
  LOCKED — build against it as it stands, do not pre-empt 10.1.
- `.planning/phases/02-one-agent-one-worktree-watched-live/02-UI-SPEC.md` — the agent signal
  vocabulary (four contrast-proven colour roles, six legend marks, eight keyboard actions). A stage
  indicator and a proposal-pending mark must join this vocabulary rather than invent a parallel one.
- `.planning/phases/01-the-board-is-the-store-of-record/01-SECURITY.md` — **AR-01-04**, the
  `epic_roster` limit exemption D-87 must close.

### Code the phase extends
- `packages/core/src/db/migrations/0002_board_schema.sql` — the five-state CHECK at lines 41 and 67
  (**no `draft`, no reconfiguration path**, the comment block at lines 6–10 explains the re-homing
  of ARCHITECTURE's `integrating`/`archived`/`draft` states), the `issues` table and its
  no-status comment, `acceptance_criteria` at line 96, and the `events` table at line 114.
- `packages/core/src/db/migrations/0003_agent_runtime.sql` — `triggers` (line 31,
  `target_task_id NOT NULL`), `worktrees` (line 49, `task_id NOT NULL UNIQUE`) and `agent_runs`
  (line 65, `task_id NOT NULL`, `worktree_id` already nullable). These three lines are what D-84
  changes.
- `packages/core/src/db/migrations/0006_recovery_statuses.sql` — the CHECK-constrained table-rebuild
  sequence D-84 must copy, plus the reminder that `DROP TABLE` drops indexes and `RENAME TO` does not
  resurrect them. `0009_criteria_revisions.sql` is the most recent worked example and the shape
  D-81's `amend` writes into.
- `packages/core/src/context_packet.rs` (590 lines) — **read the whole file, header comment first.**
  Its no-model/no-network/no-write contract and its omit-the-heading-rather-than-emit-an-empty-section
  rule are what D-87's epic-scoped sibling should follow. `REPORT_SUMMARY_TOOL_NAME` is declared at
  line 34.
- `packages/core/src/domain/epic.rs`, `task.rs`, `acceptance_criterion.rs` (955 lines),
  `session_summary.rs` — the canonical write paths the accept step materialises through. `create_summary`
  in `session_summary.rs` (and its "every caller passes the same shape" comment at line 38) is the
  worked example of a scoped agent-originated write.
- `packages/core/src/domain/agent_run.rs` (1024 lines) — the run lifecycle D-84 widens, including
  `mark_abandoned` at lines 749–808.
- `packages/core/src/domain/trigger.rs`, `packages/core/src/domain/issue.rs` — the trigger the run
  hangs off, and the lane D-82's triage surface sits beside.
- `packages/core/src/query/` — `search.rs`, `filter.rs`, `events.rs`, `agent_runs.rs`. Every query is
  a compile-time literal `&str` with bound parameters and **zero string interpolation**; D-87's read
  tools and the triage-lane query must hold that line, and `DEFAULT_LIMIT`/`MAX_LIMIT` live here.
- `packages/sidecar/src/mcp-permission-server.ts` — read the module doc comment. Two roles in one
  file, the socket relay, the second-message-kind precedent (D-53), `REPORT_SUMMARY_TOOL_NAME` at
  line 66 and `SUMMARY_TOOL_NAME` at line 73. This is the shape the authoring tools are argued
  against.
- `packages/sidecar/src/claude-code-adapter.ts` and `adapter.ts` — `buildClaudeArgv`,
  `AdapterCapabilities`, `StartSessionOptions`, `AgentAdapter`, and the `--allowedTools`
  pre-approval path D-88's stage-gated tool set must drive.
- `packages/desktop/src/session/SessionSurface.tsx` (780 lines) — D-85's host surface; its
  `StatusStrip` scans top-level numeric fields on loaded log entries, a constraint any new event
  shape must respect. `FeedRow.tsx` and `PermissionRequestCard.tsx` are the primitives the tray sits
  beside.
- `packages/desktop/src/board/IssuesLane.tsx`, `BoardView.tsx`, `BoardRow.tsx`, `QuickAdd.tsx`,
  `CommandPalette.tsx` — the lane D-82 sits alongside, the virtualized list it must not slow down,
  and the creation and command surfaces the tray's verbs must be consistent with.
- `packages/desktop/src/item-detail/ItemDetailPanel.tsx`, `AcceptanceCriteriaList.tsx`,
  `ActivityTrail.tsx` — the editors D-94 deliberately does not route amendments through, and the
  revised-criterion marker D-79 shipped. **Note:** WINDOWS.md records an existing hex-literal styling
  violation in `ItemDetailPanel.tsx:219` — do not add more.
- `packages/desktop/src/launch-sheet/LaunchSheet.tsx` (361 lines) — task-scoped today; the
  Discretion item on starting an authoring session lands here.
- `packages/core/tests/` — `worktree_lifecycle.rs`, `stop_lifecycle.rs`, `discard_lifecycle.rs`,
  `summary_report_wire.rs`, `five_cycle_reconstitution.rs`, `termination_atomicity_call_site.rs`,
  `start_pin_ordering.rs`. The established pattern for proving multi-process guarantees with real
  spawned processes, and the structural-gate precedent for asserting that a future edit cannot
  reintroduce a bug. `packages/sidecar/test/fake-claude.mjs` is the cheap deterministic alternative.

</canonical_refs>

<code_context>
## Existing Code Insights

### Reusable Assets
- **`packages/sidecar/src/mcp-permission-server.ts`** — a working MCP tool server with a Unix-socket
  relay to the Rust core, already hosting two tools (`approve_action`, `report_summary`) and already
  carrying a second message kind on one socket (D-53). The authoring tool set is the third thing
  through this pattern, not the first.
- **`packages/core/src/context_packet.rs`** — a proven pure-query assembler with a `PartialEq`
  packet, stable headings and an omit-empty-sections rule. D-87's epic-scoped packet is a sibling,
  not a rewrite.
- **`packages/core/src/domain/session_summary.rs`** — the worked example of a narrowly-scoped
  agent-originated write whose identity is derived from the run, never accepted as a caller
  argument. Every authoring write tool should follow that rule exactly.
- **Phase 3's supervision apparatus** — watchdog, heartbeat, kill record, `abandoned` reconciliation,
  spawn stagger, PATH shim, destructive gate. D-84 exists so this phase inherits all of it rather
  than reimplementing it.
- **`IssuesLane.tsx`** — an existing workflow-less board lane; D-82's triage lane is its sibling.
- **`packages/desktop/src/session/`** — feed rows, permission cards, raw-log view and windowed
  scrollback, all reusable unchanged under D-85.
- **`0009_criteria_revisions.sql` + `AcceptanceCriteriaList.tsx`'s revised marker** — D-81's `amend`
  verb materialises straight into machinery that already exists and is already tested.

### Established Patterns
- **Schema is the authority, not app code** (Phase 1) — the five-state CHECK has no reconfiguration
  path, which is exactly why D-80 staged rather than adding a `draft` status.
- **Every query is a compile-time literal `&str` with bound parameters; zero `format!` SQL anywhere
  in core** — the read tools and the triage lane must not be the first exception.
- **Derive at read time, never store** (`query/events.rs`, D-16) — the staging row's terminal status
  is a fact and belongs in the row; any *verdict* computed about it does not.
- **Every mutation is actor-attributed and lands in `events` in the same transaction** (DATA-03,
  D-19, ARCHITECTURE §2.1) — a staged proposal written by the agent carries the agent as actor; the
  accept carries Cyril. That distinction is the audit trail SHAPE-04 implies.
- **Event payloads must be human-renderable** (D-19) — the activity trail gets proposal and decision
  history free if the payloads are written for it.
- **Capability-gated adapter methods throw `CapabilityUnsupportedError`** rather than failing
  silently — the pattern a backend lacking the authoring tool set would follow (AGNT-01).
- **Rigidity over configurability** — D-23, D-24, D-43, D-69. D-88's fixed three stages and D-95's
  refusal of a tray-wide accept-all both continue it.
- **No hex literals in desktop styling; tokens only.**

### Integration Points
- A new migration (`0010`) adding the staging table and loosening `agent_runs.task_id` /
  `triggers.target_task_id` — possibly two migrations, since the second is a CHECK-constrained
  rebuild.
- The Rust core gains: the staging domain module, the accept/reject/amend write paths that
  materialise into `epics`/`tasks`/`acceptance_criteria` (and into a D-77 revision for a locked
  criterion), the epic-scoped packet, the triage-lane query, and a cap on `epic_roster`.
- The sidecar gains the stage-gated authoring tool set and the stage transition it is driven by;
  `buildClaudeArgv`'s `--allowedTools` composition is where the gating becomes real.
- The desktop gains the proposal tray on `SessionSurface.tsx`, the triage lane on the board, a
  proposal count on the epic row, a stage indicator, and the accept/reject/amend/advance keyboard
  actions.
- Every existing call site that assumes `agent_runs.task_id` is present must be audited — this is
  the largest mechanical risk in the phase.

</code_context>

<specifics>
## Specific Ideas

- The test that proves D-88 is real: **assert that no proposal row exists before the stage
  advanced.** If the challenge stage can be skipped, the differentiator is a prompt.
- The sentence to hold D-89 against: the model's reading of the conversation must be **correctable
  rather than authoritative** — which is the only reason a distilled record is acceptable at all.
- D-91's principle, stated once: Phase 4 banned model judgement from an *unattended* path where a
  wrong judgement is invisible and compounds. Here a human sits in the loop and every output is
  gated, so what carries over is **what facts the judgement is grounded on**, not whether judgement
  is allowed.
- The reason there is no tray-wide accept-all (D-95): once it is the reflex, SHAPE-03's
  criterion-editing requirement is decorative — **the phase would pass its tests while the behaviour
  it exists to create stops happening.**
- A half-shaped epic is an epic with fewer tasks. That is the truth, not a degraded state — which is
  why D-96 materialises on accept rather than on a commit.
- The whole staging decision in one line: if staged proposals died with the session, **the session
  would be the store of record**, which is precisely what the Core Value forbids.

</specifics>

<deferred>
## Deferred Ideas

- **Mechanical conflict and near-duplicate detection** (D-91's rejected option) — a computed check
  that a proposed criterion contradicts a locked one, or that a proposed task duplicates an existing
  one. `ARCHITECTURE.md` §6 already names near-duplicate detection as a requirement for Phase 6's
  `propose_issue` spam control, so that is where it most naturally lands, with this phase as a
  second consumer once it exists.
- **A structural bar on re-proposing a rejected item** (D-93's rejected option) — enforced in the
  tool handler rather than advised through the primed rejected set. Revisit if a model demonstrably
  keeps pushing rejected proposals; needs the near-duplicate machinery above first.
- **A dedicated authoring surface** (D-85's rejected option) — its own route and a layout with the
  epic tree as the primary object. Revisit only with evidence that `SessionSurface` plus a tray
  measurably loses to a terminal, which is exactly what the spike should be able to tell us.
- **A tray-wide accept-all-remaining action** (D-95's rejected option). Purely additive later, and
  deliberately not shipped first so the per-subtree habit forms.
- **Recorded stage passes** (D-90's rejected option) — numbering each return to the challenge stage
  so the record shows the framing was reopened and why. Genuinely useful months later; not worth a
  second concept in v1.
- **A dedicated read-only worktree for authoring sessions** (D-86's rejected option). Becomes
  attractive if the read-only posture in the main checkout proves hard to guarantee, or if
  authoring sessions ever need to run unattended.
- **Structured challenges from the first turn** (D-89's rejected option) — every challenge a row
  Cyril answers rather than prose distilled on advance. Revisit only if distillation demonstrably
  loses something that mattered.

</deferred>

---

*Phase: 5-Socratic Epic Authoring*
*Context gathered: 2026-09-23*
