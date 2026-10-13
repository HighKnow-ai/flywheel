# Phase 4: `/clear` Is Free - Context

**Gathered:** 2026-09-22
**Status:** Ready for planning

<domain>
## Phase Boundary

Every agent session ends by **appending** a structured summary to the board — what changed, what
remains, what the next session must know, and the decisions it made — and no existing summary is
ever rewritten in place. Cyril discards a live context in one action and lands on a fresh session
against the same worktree, primed entirely from the board: the task, its epic, its immutable
acceptance criteria, prior session summaries (recent ones verbatim, older ones mechanically
compacted with the boundary visible), and the diff so far. No chat transcript is involved anywhere,
and the same board state always produces the same packet. When facts on the board contradict what a
session claims or was told, Cyril is told rather than discovering it in the diff. Acceptance criteria
freeze the moment work starts; editing one afterwards appends a revision instead of overwriting the
original.

This phase is the falsification test for the entire product thesis and it completes the thinnest
vertical slice — one task, two sequential sessions on one worktree, the second reconstituted from
the board alone. Context assembly is a deterministic query and never a model call (CTX-04); the diff
is ground truth because prose degrades and a diff cannot.

**Requirements:** CTX-01, CTX-02, CTX-03, CTX-04, CTX-05, CTX-06, CTX-07, CTX-08, BOARD-03.

**Not this phase:** the agent→board *write* path for proposals (Phase 6), diff review against
criteria (Phase 8), Socratic epic authoring (Phase 5), fan-out (Phase 9). The `report_summary` board
tool D-64 introduces is a deliberately narrow write surface for one scoped row type — it is not
Phase 6's proposal channel, and ARCHITECTURE's Anti-Pattern 2 (agents never write to `tasks`/`epics`)
holds unchanged.

</domain>

<decisions>
## Implementation Decisions

Decision numbering continues from Phase 3 (D-01–D-22 are Phase 1, D-23–D-40 are Phase 2,
D-41–D-63 are Phase 3).

### Summary authorship and the killed-session gap

- **D-64:** **The agent authors the summary through a `report_summary` board tool; the Rust core
  synthesizes and flags a fallback when a run closes without one.** The tool is a second scoped
  write surface alongside the existing permission-only MCP server
  (`packages/sidecar/src/mcp-permission-server.ts`), called by the agent as its closing turn. When a
  run reaches a terminal state with no summary row — and `SessionClosedEvent.reason`
  (`interrupted` | `completed` | `failed`) already tells the core exactly that, exactly once — the
  core writes a best-effort summary from the diff and the event log, flagged `auto_generated`, so
  reconstitution never has a hard gap. This is ARCHITECTURE.md §3 "Who assembles it, and where
  summaries are produced" implemented verbatim, and it is what makes criterion 1's word *every*
  literally true under D-35's force-kill.
  Rejected: the core always synthesizing with no model anywhere (never missing and trivially
  testable, but the one thing only the agent knows — what it would tell the next session, the
  approach it rejected, the half-finished idea — is unrecoverable from a diff) and parsing a
  structured block out of the terminal `result` stream-json line (no new write seam, but a
  force-killed or crashed run leaves no summary at all, so criterion 1 is false for exactly the
  sessions where continuity matters most).
  — **Reversibility:** costly — the tool's name and argument shape become part of what every session
  is prompted to call, and the `auto_generated` flag is read by the packet, the drift detectors
  (D-72) and CTX-07's five-cycle assertions.

- **D-65:** **A summary row carries four fields, two of them machine-checkable:** `changed` as a
  list of file paths *plus* prose, `remains`, `next_session_must_know`, and `decisions` as a list of
  discrete entries rather than one prose blob. The file list is what lets the core compare
  claimed-touched against real `git diff --name-only` (ARCHITECTURE.md §3.2's integrity check, and
  D-72's first detector); `decisions` as a list is what mechanical compaction preserves when
  narrative is dropped (D-68) and what a new session reads back against (D-73). Structure here is
  load-bearing for three later decisions, not schema decoration.
  Rejected: the three prose fields criterion 1 literally names (simplest, least for the agent to get
  wrong, but nothing is machine-checkable so CTX-06 has only prose to work with and compaction has no
  structured field to keep) and four fields all as free prose (richer than the minimum, still one
  TEXT column each, but with no file list the drift detector ARCHITECTURE names cannot be built).
  — **Reversibility:** one-way — the field set is a migration, and it is the shape the
  `report_summary` tool contract, the compaction fold, the integrity check and the five-cycle test
  suite are all written against.

### Discarding a live context

- **D-66:** **Discard asks for the summary first, then falls through to D-35.** One final turn —
  *call `report_summary` now* — a bounded wait, then interrupt-then-force exactly as Stop already
  does. The agent-authored summary lands in the common case and `auto_generated` stays the exception
  rather than the norm, which matters because discard-mid-task is the flagship action of the whole
  phase: taking the weakest summary on the path the thesis is being falsified against would be
  measuring the wrong thing.
  Rejected: making discard byte-identical to Stop (one code path, instant, nothing new to test — but
  the single action the thesis rests on would routinely produce the weakest kind of summary) and
  blocking when a session will not produce one, surfacing it as a D-37 needs-you state instead of
  synthesizing (strongest guarantee criterion 1 is literally true, but it puts a hung agent between
  Cyril and his fresh session — the friction D-46 deliberately reserved for money burning).

- **D-67:** **Discard lands on D-27's launch sheet, pre-filled with the freshly assembled packet.**
  One action from the session surface takes Cyril to `packages/desktop/src/launch-sheet/LaunchSheet.tsx`
  already primed — summaries, compaction boundary, diff-so-far, any drift warnings — and Enter starts
  it. This keeps D-27's "briefing visible and correctable before tokens are spent" on the most
  frequently taken path in the product, and it gives CTX-05's visible compaction boundary a surface
  that already exists rather than requiring a new one. D-30 already made every start a fresh session,
  so this decision is about the seam, not about whether the context is discarded.
  Rejected: spawning immediately with no sheet (the truest reading of "single action", but Cyril never
  sees what the new session was told, and CTX-05's boundary would need its own new surface) and
  growing the affordance onto Stop as a modifier (fewest new surfaces, but the phase's flagship
  capability would be buried inside a destructive-sounding verb, and the board would have nowhere that
  says `/clear` is free).

### What the fresh session receives

- **D-68:** **Compaction is a pure Rust fold with no model anywhere.** Past the verbatim window,
  `changed` prose and `remains` are dropped; every `decisions` entry and every file path is kept.
  `PITFALLS.md` pitfall 3 is explicit — "resist the temptation to save tokens by summarizing
  summaries" — and this is the reading that obeys it: the details research says collapse first
  (rejected alternatives, specific names) are the ones structurally preserved, and CTX-04's
  determinism holds at *write* time as well as at assembly time because no LLM ever touches the
  continuity path. Compaction is lossless for decisions and total for narrative.
  Rejected: a model-written epoch summary produced once at write time (richer prose, and assembly
  stays a pure query — but it is a summary of summaries, the exact failure physics PITFALLS names,
  with a model call inside the continuity path) and no compaction at all, treating an over-long
  history as a signal the task should have been decomposed (PITFALLS' own alternative reading, zero
  drift by construction — but CTX-05 explicitly requires a visible compaction boundary, so this
  builds less than the requirement asks for).

- **D-69:** **The verbatim window is a fixed count of 5, not configurable.** ARCHITECTURE.md §3 says
  "last 3–5"; fixing it is the same instinct as D-23's fixed worktree root and D-24's fixed branch
  names — rigidity is the feature. The boundary becomes arithmetic Cyril can state out loud
  ("summaries 1–4 are folded, 5–9 are verbatim"), and CTX-07's five-cycle test has one assertion to
  make rather than a budget to reverse-engineer.
  Rejected: a token/character budget filled until full (never wastes the window and adapts to short
  summaries, but the boundary moves for reasons Cyril cannot see and one verbose summary silently
  pushes three good ones over the fold) and a fixed default exposed in the Settings surface D-39
  introduced (a knob is a second behaviour to test across five cycles, and every prior phase chose
  fixed over configurable on exactly this question).

- **D-70:** **The diff-so-far covers committed *and* uncommitted work, as two labelled sections.**
  The committed range `base...HEAD`, then the working-tree state as its own section. ARCHITECTURE.md
  §3 specifies only the committed range, and that is insufficient here: D-35 guarantees a dirty,
  uncommitted tree after every interrupt, and D-66/D-67 make discard-mid-edit the flagship path — so
  a committed-only packet hands the new session a tree full of changes it cannot see and will
  rediscover or clobber. D-42 already renders `git status --porcelain` rows for the removal refusal,
  so the untracked-file shape exists to reuse.
  Rejected: the committed range only, exactly as ARCHITECTURE.md §3 specifies (simplest, and the
  agent can always run `git status` itself — but the packet's claim to be ground truth would be false
  for precisely the state D-35 guarantees exists) and additionally enumerating every untracked file
  path-by-path per D-42's argument (most complete, but a worktree with build output that escaped
  `.gitignore` floods the packet).

- **D-71:** **The packet always carries `--stat` and the changed-path list, never hunk bodies**, plus
  one line telling the agent to read what it needs. The agent is sitting in the worktree, so nothing
  is lost by not embedding hunks — and the packet's size then depends only on how many files changed:
  bounded, deterministic, and diffable across five cycles. The file list is also exactly what D-72's
  integrity check compares against, so one representation serves both jobs.
  Rejected: ARCHITECTURE.md §3's literal "full diff when small, stat when large" (maximum grounding
  with zero tool calls in the common case, but a threshold is a second behaviour to test and the
  packet's size — hence the five-cycle assertions — swings on a byte count) and always the full diff
  (one code path, no threshold to argue about, but a long-running task's packet grows without bound,
  which is the exact context-window pressure this phase exists to relieve).

### Surfacing contradiction (CTX-06)

- **D-72:** **Three fact-based detectors, no model judgement anywhere.** (1) The summary's claimed
  `changed` file list against the real `git diff --name-only` for its range. (2) Commits or
  working-tree changes that landed since the last summary was written, compared against its stored
  `diff_ref`. (3) Acceptance-criteria text drift against the revision the run was pinned to (D-78).
  ARCHITECTURE.md §3.2 names exactly these as its integrity check and staleness detection. Each fires
  on a fact, so it cannot cry wolf and cannot be argued with — which is what a detector guarding the
  product's central claim has to be.
  Rejected: adding a semantic layer on top that flags a `decisions` entry "restated inversely"
  (catches the case criterion 4 literally describes, but needs either brittle keyword matching or a
  model call, which every other decision in this phase has refused) and a single LLM call comparing
  the new session's opening statement against accumulated decisions (the only reading of criterion 4
  at full strength, but non-deterministic, unverifiable across five cycles, and it puts a model
  between Cyril and the truth about his own board).

- **D-73:** **The `decisions` read-back closes criterion 4's stated-understanding gap without a
  model.** Criterion 4's wording is about a session *stating an understanding* that contradicts a
  recorded decision, and a file-list mismatch is not that. So the packet renders accumulated
  `decisions` entries with stable ids, and the session's opening `report_summary`-family board-tool
  call must echo back the ids it is working under. An entry it never echoes, or an echo whose
  `changed` list contradicts the entry it claimed, fires the same surfaced warning as any other
  detector. This stays pure mechanism — id matching, never semantics — while giving criterion 4 an
  actual stated understanding to check against.
  Rejected: shipping the three detectors and recording criterion 4 as a deliberately narrowed
  "contradiction is detected from facts, not prose" reading (honest and cheap, and nothing gets built
  that a later phase tears out — but the verifier may reasonably call criterion 4 unmet, and this is
  the one phase not allowed to look solved while being hollow) and deferring the
  stated-understanding half to Phase 6's real write path (pitfall 3's whole warning is that this
  degrades invisibly, so deferring the detector past the phase that creates the risk is the named
  failure).

- **D-74:** **A fired detector writes a warning line into the packet itself and raises D-37's
  board-visible state — and blocks nothing.** The warning goes in the packet so the *agent* reads it
  too (ARCHITECTURE.md §3.2: "flag mismatches in the packet as a warning line"), and simultaneously
  raises the needs-you signal Phase 2 already built: a distinct state on the task row plus a count in
  the project rail. D-46 already settled the blocking question for this whole product — only money
  burning blocks — and drift is not money burning.
  Rejected: a blocking banner on the session surface requiring acknowledgement (strongest guarantee
  he is actually told, but it puts a modal in the path of every start where a human edited the
  worktree by hand — friction D-46 reserved for live orphans, spent on a routine condition) and the
  packet warning line alone with no board signal (cheapest, one string, and the agent is arguably who
  most needs it — but an unattended run would drift with nothing on the board ever saying so, which
  is the "silently degrades" failure pitfall 3 rates as the thesis-killer).

- **D-75:** **A fired detector is an `events` row; the packet's warning line is re-derived on every
  assembly, never stored.** The event payload is human-renderable per D-19, so the activity trail
  carries drift history for free and CTX-07's five-cycle test asserts on emitted events. Re-deriving
  keeps CTX-04's byte-identical property intact — the warning is a pure function of board state — and
  leaves no derived value to go stale, which is D-16's rule and `packages/core/src/query/events.rs`'s
  own "derive at read time, never store" discipline.
  Rejected: a verdict column on the `session_summaries` row it was checked against (directly
  queryable per summary and cheap to render in `RunsSection.tsx`, but it is stored derived state and
  goes stale the moment the range it was computed against changes) and a first-class drift-findings
  table with its own acknowledge/dismiss lifecycle (most complete and the most natural fit for D-37's
  count, but a new table and migration for what is three computed booleans, in a phase already adding
  summaries and criteria revisions).

### Criteria lock and revisions (BOARD-03)

- **D-76:** **The lock engages on the first `agent_runs` row for the task, ever.** That row's
  existence *is* the lock — a fact already in the schema, needing no new flag, and the honest reading
  of "once a task starts work": work started when an agent was actually spawned against those
  criteria. D-29 already makes Start Work move the task to In Progress, so the two fire together
  without the lock depending on a status value a human can hand-edit.
  Rejected: keying off `tasks.status` entering In Progress (the board's own vocabulary and what Cyril
  sees, but D-29 notes a human can set that status by hand, which would make the lock something a
  status change toggles rather than something an agent run establishes) and the first `worktrees` row
  (durable and task-owned, matching the product's thesis — but the worktree survives a refused D-41
  removal and a D-45 `missing` marking, so the lock's lifetime would start tracking a disk artifact
  rather than the work).

- **D-77:** **Editing a locked criterion appends a new revision row and marks the old one
  superseded; the original `statement` is never UPDATEd.** A `revision` column plus a
  supersedes/revision-of link — migration `0002_board_schema.sql` already annotates the
  `acceptance_criteria` table with "Phase 4's revisioning is an additive column", so this is the shape
  the schema was written expecting. Immutability is enforced by the write path, the same way Phase 1
  made the CHECK constraint the authority rather than app code. Cyril types an edit and gets an edit —
  no refusal, no modal — while history stays intact.
  Rejected: making the field read-only once locked with a separate explicit "revise" action (rigidity
  is the feature, D-43's exact argument — but D-43's rigidity was protecting uncommitted work, not
  prose, and this would make the legitimate act of sharpening a criterion mid-task feel like fighting
  the tool) and a confirmation dialog naming the criterion and the session working under it, per
  D-42's show-what-is-at-stake instinct (friction spent on an additive, non-destructive operation
  where nothing can be lost).
  — **Reversibility:** one-way — a schema change to a table Phase 1 shipped, whose CHECK-constrained
  rebuild rides on D-18's backup-first migration safety.

- **D-78:** **A run pins the revision set it was assembled with; the next session picks up the new
  one.** The `agent_runs` row records which criterion revisions its packet carried, so what the agent
  was actually told is never retroactively rewritten — the same non-repudiation property D-40
  protected agent-run history for. A revision bump between sessions is itself surfaced by D-72's third
  detector, so the next session is told the criteria moved rather than silently receiving different
  ones. CTX-07 can then prove "acceptance criteria verifiably unchanged" against a pinned set rather
  than a moving target.
  Rejected: everyone always reading the latest, on the grounds that the board is the truth (one rule,
  no pinning — but an agent gets marked as having missed a criterion it was never given, and a
  completed run's packet can no longer be reproduced, which makes CTX-04's determinism a property of
  *now* rather than of a run) and refusing revision outright while a run is live (zero ambiguity, but
  an unattended overnight run would make the board read-only for hours, and noticing a badly worded
  criterion mid-run is exactly when Cyril most wants to fix it).

- **D-79:** **Superseded revisions are visible to Cyril on demand and never to an agent.**
  `packages/desktop/src/item-detail/AcceptanceCriteriaList.tsx` shows current revisions with a quiet
  "revised" marker that expands to the prior text, and the change lands in the activity trail as an
  event (D-19). The packet carries current revisions only: pitfall 3's rule is that criteria are the
  one thing that must never drift, so putting superseded wording in front of a model hands it the
  drift directly.
  Rejected: carrying the revision trail in the packet too (the agent would see what Cyril cared
  enough to sharpen, which is genuine signal — but the whole point of criteria being structured and
  immutable is that no session ever reads a version that is no longer true) and storing revisions
  without surfacing them anywhere in v1 (cheapest, and Phase 8's diff review could use them later —
  but criterion 5 wants "creates a new revision instead of overwriting" demonstrable, and this would
  make it a claim only a test can see).

### Claude's Discretion

The following were **not** discussed. The researcher and planner should resolve them against the
decisions above and the canonical references — not re-ask the user.

- **The multi-cycle test harness and what "context-quality metrics" means.** ROADMAP.md's Phase 4
  Notes carry an explicit research flag: *build the synthetic multi-cycle test suite and the
  context-quality metrics before shipping this phase — do not ship without evidence the thesis
  holds.* CTX-07 demands at least five cycles. Open: whether cycles are driven by the existing
  `packages/sidecar/test/fake-claude.mjs` fixture or by real `claude` sessions. Weigh WINDOWS.md rows
  **11 and 12** — two consecutive end-of-phase `scripts/uat/run-all.sh` runs failed 4/6 on
  live-`claude`-session scripts, judged pre-existing flakiness — against Phase 3's own precedent of
  proving process-level guarantees with real spawned processes (`packages/core/tests/`). The
  determinism half of CTX-04 is provable with no agent at all: `ContextPacket` already derives
  `PartialEq`.
- **How much of the `report_summary` tool is the start of Phase 5/6's write path.** D-64 introduces
  the first agent→board *write* seam. Whether it is a second tool on the existing
  `mcp-permission-server.ts` process, a separate board MCP server, or a new op on the sidecar's stdio
  protocol, is open — resolve against `.planning/research/ARCHITECTURE.md` §6 and Anti-Pattern 2, and
  build it so Phase 6 extends rather than replaces it.
- **The bounded wait in D-66** — how long discard gives the agent to produce its closing summary
  before the interrupt lands. Too short and the flagship path always synthesizes; too long and
  discard stops feeling like one action. Phase 3's D-47/D-50 timing work is the nearest precedent.
- **Whether ARCHITECTURE.md §3 items 5–7 join the packet in this phase** — unresolved
  `permission_requests` and human triage notes since the last session (item 5), open agent-proposed
  issues (item 6, and Phase 6 is what creates them), and project conventions / CLAUDE.md-equivalent
  (item 7). No Phase 4 success criterion names any of them; item 7 is nearly free and item 6 has no
  producer yet.
- **Where summaries render on a task, and what the panel looks like after ten runs.**
  `RunsSection.tsx` already lists runs; whether summaries nest inside it, get their own section, or
  surface on `SessionSurface.tsx` was not discussed. The board-side rendering of the compaction
  boundary (D-69) lives with this question.
- **What the `auto_generated` fallback is allowed to claim.** It has the diff and the event log but no
  agent voice; whether it populates `next_session_must_know` at all, and how D-73's read-back behaves
  against a summary that has no `decisions` entries, are open.
- **How the integrity check treats a legitimately renamed or moved file**, where `git diff
  --name-only` and an agent's claimed path list honestly disagree.
- **Whether a fired detector is acknowledgeable.** D-75 stores it as an event and re-derives the
  warning, so it clears when the underlying fact clears; whether that is enough for D-37's rail count
  not to become permanently non-zero needs a call.
- **Whether any of this behaves differently under `tauri dev` versus a packaged `.app`** — carried
  forward from Phase 3's discretion list and WINDOWS.md row 3.

</decisions>

<canonical_refs>
## Canonical References

**Downstream agents MUST read these before planning or implementing.**

### Project intent, scope and requirements
- `.planning/PROJECT.md` — the Core Value statement and its corollary: *the board is the
  context-reconstitution mechanism that makes `/clear` free.* The Key Decisions table row "Board is
  the context-reconstitution mechanism" is marked **Pending** and this phase is what resolves it, as
  is "Worktrees are durable; agent sessions are ephemeral".
- `.planning/REQUIREMENTS.md` — the 9 requirement definitions this phase implements (CTX-01 through
  CTX-08 at lines 82–89, BOARD-03 at line 25), verbatim.
- `.planning/ROADMAP.md` §"Phase 4: `/clear` Is Free" — the five success criteria this phase is
  verified against, and the Notes naming the deterministic-query constraint, the diff-as-ground-truth
  rule, and the research flag to build the multi-cycle suite and context-quality metrics *before*
  shipping.
- `.planning/ROADMAP.md` §Overview — "Reachability of the thinnest slice" (this phase completes it)
  and the "Project-killer placement" table row assigning *context reconstitution degrading silently*
  to Phase 4 via CTX-02, CTX-06, CTX-07.
- `.planning/STATE.md` — §Accumulated Context and §Blockers/Concerns; Phase 2/3 entries that bind
  inputs to this phase.
- `.planning/WINDOWS.md` — **rows 11 and 12** are the live-`claude`-session flakiness evidence that
  bears directly on how CTX-07's five-cycle test should be driven. Row 3 records that Phase 2 UAT ran
  under `tauri dev`, not a packaged `.app`. Rows 1, 2, 4, 5 are open and untouched by this phase.

### Risk — the project-killer this phase owns
- `.planning/research/PITFALLS.md` **pitfall 3** — "Reconstituted context degrades silently instead
  of failing loudly (context rot reborn inside the fix for context rot)." **This is CTX-02/05/06/07's
  specification.** Load-bearing lines: never overwrite prior summaries in place; keep criteria
  first-class and never folded into prose; store the diff as ground truth and treat the summary as an
  index into it, not a replacement; *resist the temptation to save tokens by summarizing summaries*
  (D-68's direct source); and the explicit test mandate — run a task through 5+ synthetic cycles and
  diff reconstituted criteria against the originals programmatically.
- `.planning/research/PITFALLS.md` §"Decisions That Would Be Wrong" — the row rating *store only the
  latest session summary per task* as **Never**.
- `.planning/research/PITFALLS.md` §"Looks Done But Isn't" — the checklist row warning that context
  reconstitution is often "tested" only on session 1→2.
- `.planning/research/PITFALLS.md` §"Recovery Strategies" — the row on reconstituting from an
  *earlier, less-degraded* stored summary, which only works because D-64/CTX-02 never overwrite.

### Architecture
- `.planning/research/ARCHITECTURE.md` §3 "Context-Reconstitution Mechanism" — the seven-item packet
  contents in order, who assembles it and when (Supervisor, at `AgentRun` creation, before spawn),
  where summaries are produced, and the `auto_generated` fallback. **This is CTX-03/04's
  specification and D-64's source.**
- `.planning/research/ARCHITECTURE.md` §3.2 "Preventing silent degradation across many sessions" —
  verbatim cap plus compaction, diff-as-ground-truth, criteria immutability, staleness detection via
  `diff_ref`, and the integrity check comparing claimed touched-files against `git diff --name-only`.
  **This is D-68, D-70, D-72's specification.**
- `.planning/research/ARCHITECTURE.md` §2 "Domain Schema" — the `SessionSummary` field sketch
  (`id, agent_run_id, worktree_id, task_id, content, diff_ref, created_at`) and `AgentRun.exit_summary_id`;
  the starting point for D-65's and D-78's schema work.
- `.planning/research/ARCHITECTURE.md` §2.1 "CQRS-lite with an outbox" — one transaction writes the
  mutable row *and* appends to `events`; D-75's detector events ride this.
- `.planning/research/ARCHITECTURE.md` §2.2 — why `SessionSummary` must be a top-level table
  independently queryable and orderable across many runs per worktree, not JSON on a task row.
- `.planning/research/ARCHITECTURE.md` §6 "Agent↔Board Write Path" — the seam D-64's `report_summary`
  tool is the first instance of, and its named failure modes.
- `.planning/research/ARCHITECTURE.md` §"Anti-Patterns to Avoid" — **Anti-Pattern 1** (session summary
  as the only source of continuity; always pair with the live diff and immutable criteria) and
  **Anti-Pattern 2** (agents never write directly to Task/Epic; a scoped `SessionSummary` row is the
  sanctioned target). Anti-Pattern 3 (cwd as an implicit git argument) constrains how the packet's git
  calls are invoked.
- `.planning/research/ARCHITECTURE.md` §5 "Agent Adapter Interface" — the capability table; a summary
  tool is backend-specific and must sit behind this seam without the supervisor branching on backend
  identity (AGNT-01).

### Stack
- `.claude/CLAUDE.md` §"Technology Stack" — the locked stack. Load-bearing here: `rusqlite` in the
  Rust core owns the canonical database and the packet is assembled there, not in the sidecar;
  worktree/git reads for the diff-so-far follow the established split (`git2` for hot-path reads, the
  system `git` CLI for worktree lifecycle); `rusqlite_migration` owns schema versioning.
- `.planning/research/STACK.md` — the full argument behind those choices.

### Market and feature framing
- `.planning/research/FEATURES.md` — the competitive framing for why context reconstitution is
  sequenced ahead of the commodity diff/forge surfaces.
- `.planning/research/COMPETITION.md` — the weeks-long window research assigns to this differentiator.

### Prior phase decisions
- `.planning/phases/02-one-agent-one-worktree-watched-live/02-CONTEXT.md` — **all of it.** Especially
  **D-28** (`assemble_context_packet` / `render_prompt` were built in Phase 2 as a genuine stub of
  this phase's ContextAssembler, with the same signature and the same determinism contract — Phase 4
  *adds inputs*, it does not replace them; and its Reversibility note already says this phase's
  multi-cycle tests are written against that function's contract), **D-30** (every Start Work is a
  fresh session on the reused worktree; `resumeSession` stays capability-gated and unimplemented —
  the reason CTX-08 is nearly satisfied before this phase begins), **D-27** (the launch sheet is the
  surface the packet slots into — D-67's target), **D-35** (Stop is interrupt-then-force, the
  worktree is left dirty and uncommitted, nothing is committed on the user's behalf — the reason
  D-64's fallback and D-70's second diff section exist), **D-34** (`<app-data>/sessions/<run-id>.jsonl`
  and the pointer-not-blob rule), **D-37** (board-visible state plus project-rail count, reused by
  D-74), **D-29** (starting a session moves the task to In Progress and nothing moves it out —
  D-76's context), and **D-40** (the non-repudiable agent-run record D-78 extends).
- `.planning/phases/03-nothing-lost-nothing-left-running/03-CONTEXT.md` — especially **D-46** (only
  money burning blocks; everything else is a persistent needs-you item — the rule D-74 applies),
  **D-45** (surface a mismatch, never silently repair it), **D-42** (render `git status --porcelain`
  as rows so "exactly what would be lost" is literally true — the shape D-70 reuses), **D-43**
  (rigidity is the feature, and why D-77 declined to apply it to prose), and its Claude's Discretion
  list, several entries of which carry forward.
- `.planning/phases/01-the-board-is-the-store-of-record/01-CONTEXT.md` — **D-16** (the mismatch is
  surfaced, never silently repaired), **D-05** (criteria carry verification hints, already rendered by
  `render_prompt`), **D-06** (criteria have their own table and their own ULIDs — the row D-77
  revisions), **D-18** (backup-first migration safety, which D-77's CHECK-constrained rebuild rides
  on), **D-19** (event payloads must be human-renderable — D-75's obligation), **D-14** (one
  fleet-wide database in app-data; agent-written state never inside the repo).
- `.planning/phases/01-the-board-is-the-store-of-record/01-UI-SPEC.md` — the locked visual direction,
  Surface Inventory and exhaustive Keyboard Map that a discard verb and a compaction-boundary marker
  must slot into. **Caveat:** Phase 10.1 is scheduled to re-open sections this document marks LOCKED —
  build against it as it stands, do not pre-empt 10.1.
- `.planning/phases/02-one-agent-one-worktree-watched-live/02-UI-SPEC.md` — the agent signal
  vocabulary (four contrast-proven colour roles, six legend marks, eight keyboard actions). A drift
  warning state and a "revised" criterion marker must join this vocabulary rather than inventing a
  parallel one.

### Code the phase extends
- `packages/core/src/context_packet.rs` — **read the whole file, header comment first.** The 241-line
  Phase 2 implementation of D-28: `ContextPacket`, `CriterionEntry`, `EpicSection`, `WorktreeFacts`,
  `assemble_context_packet`, `render_prompt`, `predict_base_ref`. Its header records two contracts
  this phase must not break — every SQL statement is a literal `&str` bound through `params![]`, and
  the function makes no model call, no network call, **no git call and no write of any kind**. D-70's
  diff section is the first thing that pressures the "no git call" clause; resolve that deliberately
  rather than by accident.
- `packages/core/src/db/migrations/0002_board_schema.sql` — the `acceptance_criteria` table (line 96)
  and its comment *"Phase 4's revisioning is an additive column"*; the `events` table (line 114) and
  its per-`(project_id, origin)` sequence.
- `packages/core/src/db/migrations/0006_recovery_statuses.sql` — the CHECK-constraint table-rebuild
  sequence to copy if D-77 or D-78 needs one, plus the reminder that `DROP TABLE` drops indexes and
  `RENAME TO` does not resurrect them.
- `packages/sidecar/src/adapter.ts` — `SessionClosedEvent` (line 101, `reason` and optional `result`),
  `ResultEvent` (line 75), `AdapterCapabilities` (line 183), `StartSessionOptions` (line 212),
  `AgentAdapter` (line 229). D-64's terminal-state signal is `SessionClosedEvent.reason`.
- `packages/sidecar/src/mcp-permission-server.ts` — read the module doc comment: the two-role
  split (sidecar-side socket relay plus a standalone MCP server process the backend spawns), and the
  precedent for adding a second message kind to an existing channel rather than inventing a second
  answering surface. This is the shape D-64's board tool should be argued against.
- `packages/core/src/query/events.rs` — the "derive at read time, never store" discipline D-75 follows,
  and the SQL-as-literal-`&str` pattern.
- `packages/desktop/src/launch-sheet/LaunchSheet.tsx` (361 lines) — D-67's landing surface and where
  CTX-05's boundary becomes visible.
- `packages/desktop/src/session/SessionSurface.tsx` (780 lines) — where the discard verb lives; its
  `StatusStrip` scans top-level numeric fields on loaded log entries, a constraint any new event shape
  must respect.
- `packages/desktop/src/item-detail/AcceptanceCriteriaList.tsx` — D-77 and D-79's surface.
- `packages/desktop/src/item-detail/RunsSection.tsx` — where summaries most plausibly render.
- `packages/core/src/session_log.rs` (215 lines) — the persisted-JSONL read path the fallback
  synthesizer would draw on.

</canonical_refs>

<code_context>
## Existing Code Insights

### Reusable Assets
- **`packages/core/src/context_packet.rs`** — this phase's central artifact already exists and works.
  `assemble_context_packet(conn, task_id) -> ContextPacket` returns task key/title/description, an
  optional `EpicSection`, `Vec<CriterionEntry>` in rank order with verification hints, and
  `WorktreeFacts`. `ContextPacket` derives `PartialEq` and `Serialize`, so CTX-04's "two calls against
  an unchanged database return byte-identical packets" is already assertable with no agent involved.
  `render_prompt(packet, instruction)` is the only place prose is produced, with stable headings and
  an omit-the-heading-rather-than-emit-an-empty-section rule — new sections (summaries, compaction
  boundary, diff-so-far, drift warnings) extend that same discipline.
- **`SessionClosedEvent`** — already the exactly-once terminal event for every session regardless of
  how it ended, carrying `reason: "interrupted" | "completed" | "failed"`. D-64's fallback trigger
  needs no new signal.
- **`mcp-permission-server.ts`** — a working MCP tool-server pattern with the socket relay to the Rust
  core already built, plus the Phase 3 precedent (D-53) of adding a second message kind to that same
  socket rather than opening a second channel.
- **`git status --porcelain` rendering** — Phase 3's `WorktreeRemovalDialog.tsx` / D-42 already parse
  and present porcelain rows with per-entry status and path; D-70's uncommitted section reuses the
  parse, not just the idea.
- **`worktree_lifecycle.rs`, `cursor_resume.rs`, `stop_lifecycle.rs`, the crash harness** in
  `packages/core/tests/` — the established pattern for proving multi-process guarantees with real
  spawned processes; `packages/sidecar/test/fake-claude.mjs` is the cheap deterministic alternative
  for cycle-driving.

### Established Patterns
- **Schema is the authority, not app code** (Phase 1) — a five-state CHECK constraint with no
  reconfiguration path. D-77's immutability and D-76's lock should be enforced at the write path /
  constraint level, not by a UI guard.
- **Derive at read time, never store** (`query/events.rs`, D-16) — D-75 follows this directly; it is
  also why a `diff_ref` on a summary row is acceptable (it records *what was true when written*) while
  a cached integrity verdict is not.
- **CHECK-constrained columns need a full table rebuild** — `0006_recovery_statuses.sql` is the
  worked example, and D-18's backup-first safety wraps it.
- **Every mutation is actor-attributed and lands in `events` in the same transaction** (DATA-03, D-19,
  ARCHITECTURE §2.1) — a summary written by an agent carries the agent as actor.
- **Rigidity over configurability** — D-23, D-24, D-43 all chose fixed; D-69 continues it.
- **Capability-gated adapter methods throw `CapabilityUnsupportedError`** rather than failing
  silently — the pattern a backend without a summary tool would follow.
- **No hex literals in desktop styling; tokens only** — WINDOWS.md row 4 records an existing violation
  in `ItemDetailPanel.tsx:219`; do not add more.

### Integration Points
- `assemble_context_packet` gains inputs (summaries, compaction boundary, diff-so-far, drift warnings)
  and `render_prompt` gains sections — its "no git call, no write of any kind" header contract is the
  seam D-70 pressures and the planner must resolve explicitly.
- A new `session_summaries` table plus a migration (`0008`), and a criterion-revision migration —
  possibly the same one.
- The sidecar gains a summary-reporting tool surface; the Rust core gains the handler that writes the
  row and the fallback synthesizer that fires off `SessionClosedEvent`.
- `LaunchSheet.tsx` renders the enlarged packet; `SessionSurface.tsx` grows the discard verb;
  `AcceptanceCriteriaList.tsx` grows the revised marker; `RunsSection.tsx` is the likely summary
  surface; the project rail's needs-you count grows a drift contributor.
- `agent_runs` gains the pinned revision set (D-78) and the summary link
  (ARCHITECTURE's `exit_summary_id`).

</code_context>

<specifics>
## Specific Ideas

- The compaction boundary should be statable as arithmetic, not as a heuristic: *"summaries 1–4 are
  folded, 5–9 are verbatim."* That sentence is the acceptance test for whether CTX-05 is met.
- The phrase to hold onto for D-68: compaction is **lossless for decisions and total for narrative**.
- D-73's read-back exists because criterion 4 says a session *states an understanding*. The mechanism
  is id matching, never semantics — if a proposed implementation needs a model to decide whether two
  sentences disagree, it has left this decision.
- CTX-04's determinism is provable today with zero agent involvement, because `ContextPacket` already
  derives `PartialEq`. That test should exist before any of the harder cycle machinery.
- The packet tells the agent the diff exists and how to read it rather than embedding it. The agent is
  standing in the worktree; handing it a file list and a `git diff` invitation is strictly more
  information per token than handing it hunks.

</specifics>

<deferred>
## Deferred Ideas

- **A semantic contradiction check** — a model comparing a session's stated understanding against
  accumulated decisions. Explicitly rejected in D-72/D-73 for this phase (non-deterministic,
  unverifiable across five cycles). If the mechanical read-back proves insufficient in practice, this
  is the shape to revisit, and Phase 6's agent→board write path is where it would most naturally live.
- **A model-written epoch summary** for compaction (D-68's rejected option). Revisit only with
  evidence that mechanical folding lost something that mattered.
- **A first-class drift-findings table** with acknowledge/dismiss lifecycle (D-75's rejected option).
  Becomes attractive once the project-rail needs-you count has several contributors — plausibly
  Phase 10's fleet view.
- **A configurable verbatim window** in Settings (D-69's rejected option). Purely additive later.
- **Reconstituting from an earlier, less-degraded summary** rather than the latest —
  `PITFALLS.md` §"Recovery Strategies" names this as the mitigation that only exists because
  summaries are append-only. The append-only store ships here; the recovery *affordance* does not.
- **Full diff embedding with a size threshold** (D-71's rejected option) — revisit only if agents
  demonstrably fail to read the diff they were pointed at.
- **Human annotation of a summary.** CTX-02 makes summaries append-only, so a human note would have to
  be its own row type. Not scoped here.

</deferred>

---

*Phase: 4-`/clear` Is Free*
*Context gathered: 2026-09-22*
