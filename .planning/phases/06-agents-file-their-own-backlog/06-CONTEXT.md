# Phase 6: Agents File Their Own Backlog - Context

**Gathered:** 2026-09-30
**Status:** Ready for planning

<domain>
## Phase Boundary

An agent in an ordinary execution run can put a **proposal** on the board mid-session — a
proposed task, issue or epic — and nothing it proposes becomes real work without Cyril's
explicit triage. The phase delivers: the agent-facing proposal tool, the proposed state and
its structural no-promotion guarantee, duplicate flagging before a human sees the proposal, a
per-run volume limit that is surfaced rather than silent, provenance back to the run and the
turn that produced it, and a dedicated triage view carrying accept / reject / merge / defer.

Out of scope: cross-project proposal queues and OS notifications (FLEET-01/02/05, Fleet
Supervision), the planner's own decomposition of an accepted epic (PLAN-01..07), and any
change to how epic-authoring sessions propose (Phase 5, shipped).

Most of this phase's substrate already exists. Phase 5 shipped the staging table
(`authoring_proposals`), the proposal row and tray components, a board-level triage lane, and
the accept-materialises-through-canonical-writers discipline. Phase 6's work is to open that
channel to execution runs and to add the four things it does not yet have: an `issue` target
type, merge and defer, duplicate flagging, and a volume limit.

</domain>

<decisions>
## Implementation Decisions

Decision numbering continues from Phase 5 (D-01–D-22 are Phase 1, D-23–D-40 are Phase 2,
D-41–D-63 are Phase 3, D-64–D-79 are Phase 4, D-80–D-96 are Phase 5).

### Where an execution run's proposal lives

- **D-97:** **`authoring_proposals` is the single proposal channel for both run kinds.** Add
  `issue` to the table's `target_type` CHECK and allow a proposal to originate from a
  task-scoped run (`epic_id` is already nullable). The `issues` table keeps **zero** status
  columns, exactly as D-07 requires and as `hierarchy_workflow.rs`'s grep gate asserts; the
  triage lifecycle lives on `authoring_proposals.status`, and `merged_into_task` — the state
  `issue.rs:5` reserved for this phase — becomes a **triage outcome on the proposal row**, not
  an issue state. This reading reconciles Phase 1's reservation with Phase 5's shipped table
  rather than choosing between them.
  The decisive reason is PROP-03: `authoring_proposals` is the only place where "no code path
  promotes this" is already structurally true — `domain::authoring_proposal` never issues
  `INSERT INTO tasks`/`epics`/`acceptance_criteria` and materialises exclusively through those
  tables' own canonical writers (D-96). Building a second proposed-state elsewhere would mean
  proving that property twice.
  Rejected: giving `issues` the `proposed/triaged/accepted/rejected/merged_into_task` lifecycle
  literally (honours `issue.rs:5` as written and issues are already "proposals and notes, not
  units of work" — but a proposed *task* or *epic* has no home in that table, so PROP-01 would
  need a second channel anyway, and the no-promotion proof would have to be built fresh); and
  splitting by target type, tasks/epics to `authoring_proposals` and issues to `issues` (each
  lands where it structurally belongs — but that is two proposed-states to prove PROP-03
  against and two triage surfaces, where PROP-06 asks for one dedicated view).
  — **Reversibility:** one-way — SQLite cannot alter a CHECK constraint, so `target_type` and
  `status` changes are a table rebuild against a table that by then holds decided rows kept
  forever by D-83; the choice also fixes the shape published to `query::authoring`'s read
  surface and to the `propose_item` tool contract.

- **D-98:** **One new MCP tool, `propose_item`, taking `target_type` ∈ {`task`, `issue`,
  `epic`} plus its payload.** Pre-approved by one new entry in `buildClaudeArgv`'s
  `--allowedTools` branch, mirroring exactly how `report_summary` was added for execution runs
  in Phase 4 (D-64), and for the same D-46 reason: staging a proposal burns no money and blocks
  nothing, so it must never wait on a human permission answer. Authoring's six-tool
  `propose_`/`amend_`/`delete_` family is left untouched.
  An executing agent proposing has one job; three separate tools triples the input-schema
  surface and the prompt budget for no gain, and the `criterion`/`assumption` target types make
  no sense outside an authoring session.
  Rejected: reusing `propose_task`/`propose_epic` and adding `propose_issue` (one vocabulary
  across both run kinds — but those handlers resolve identity from an epic-scoped authoring
  socket and would have to branch on run kind, and the stage-gate hook's
  `propose_|amend_|delete_` name-prefix regex would then span two run kinds with different
  gating rules); and three new execution-scoped tool names (no branching in authoring's
  handlers — but nine proposal tools against one staging table).
  — **Reversibility:** costly — the tool name is published to the model in its allowlist and
  system prompt; renaming later touches the MCP registration, `buildClaudeArgv`, the
  stage-gate prefix reasoning, and every fixture that names it.

- **D-99:** **Provenance is both a stated rationale and a pointer into the transcript.** A
  required named `rationale` field in the proposal payload (the agent's own account of why it
  is proposing), plus the run's session sequence number at the moment of the call so a triage
  row can jump into the session feed at the turn that produced it. PROP-07's "what prompted
  it" is two different questions — what the agent says its reason was, and what was actually
  happening — and a triage decision needs both: a rationale alone is unfalsifiable, a turn
  pointer alone makes you read a transcript to decide one row. The executing task comes free
  via `agent_run_id` → `agent_runs.task_id`.
  The rationale field is a **discrete named field**, never folded into another row's prose —
  the same structural prohibition `ProposalPayload` already enforces on itself.
  Known hazard for the turn pointer: the open todo at `claude-code-adapter.ts:589-612` drops
  assistant narration when one stream line carries both a text and a `tool_use` block, so a
  jump target can land on a bare tool call with no narration around it. This is why the
  rationale field is required rather than derived from the turn.
  — **Reversibility:** one-way — adds a payload field and a turn-pointer column; rows staged
  before the change carry neither and there is no source to backfill them from.

- **D-100:** **Criterion 1 closes on a source gate plus an adversarial corpus, not on a happy
  path.** The source gate is a Rust test asserting that no agent-reachable module — the MCP
  tool handlers, `sidecar.rs`'s inbound applier, `domain::authoring_proposal` — contains an
  `INSERT`/`UPDATE` against `epics`, `tasks`, `issues` or `acceptance_criteria`, and that
  accept / merge / defer are the only callers of those tables' canonical writers. The
  adversarial corpus drives every `propose` / `amend` / `delete` path and asserts zero
  canonical rows appear until a triage command runs. Mirrors D-62 exactly: AGNT-07 closed on
  an end-to-end adversarial corpus plus a recorded trust boundary.
  Neither half suffices alone. A source gate proves the code contains no such statement, not
  that no composition of existing calls reaches the same effect; a corpus covers only the paths
  someone thought to try, which is the exact gap the ROADMAP note names.

### Triage: what the four verbs do

- **D-101:** **Merge attaches a child issue; it never rewrites the target.** Merging creates a
  real `issues` row parented to the target task or epic via `IssueParent`, carrying the
  proposal's title, body and rationale, through `domain::issue::create_issue` — a canonical
  writer, so D-96's materialisation discipline holds. The proposal closes as `merged` with
  `materialised_id` set to the new issue, which is where `issue.rs:5`'s `merged_into_task` is
  actually recorded. No triage action mutates an item that was already accepted.
  Rejected: appending the proposal's text to the target's description (fewest new rows, and the
  context lands where an agent reconstituting from the board will read it — but a triage action
  then mutates an accepted item, possibly one with a criteria set locked by D-76/D-77, and the
  proposal's text is no longer separable afterwards); and adding it as an acceptance criterion
  (fits when the finding really is a missing condition of done — but D-76 locks a task's
  criteria on its first agent run, so merging into a running task lands on the D-77/D-78
  revision path, and most execution-run findings are not criteria).
  — **Reversibility:** costly — already-merged proposals point at `issues` rows that different
  merge semantics would not have created, so changing this later leaves a mixed population.

- **D-102:** **Defer is a recallable status that mints nothing.** A fourth value alongside
  `accepted`/`rejected`/`merged`: the row leaves the pending queue, stays forever per D-83, and
  is recallable from a deferred filter in the triage view. It also joins the primed
  already-decided set, so a later run is told not to re-propose it. Needs no scheduler —
  `tokio-cron-scheduler` is vendored but deliberately unwired in v1.
  The load-bearing reason is PROP-05's chatty-agent case: a defer pile where each defer minted
  a board row would be precisely the backlog spam the ROADMAP note says collapses trust in an
  agent-authored backlog.
  Rejected: a `deferred_until` snooze that returns the proposal to pending (a real "remind me
  later" rather than a place things go to die — but it needs the unwired scheduler, and a
  proposal that silently reappears weeks later is a new surprise surface); and defer
  materialising an unparented `issues` row of kind `idea` and closing the proposal (the thought
  becomes durable and visible without becoming work, which is what D-07 made issues for — but
  every defer then grows the issues lane).
  — **Reversibility:** one-way — a fourth value in the `status` CHECK is a table rebuild, and
  deferred rows exist from the first use onward.

- **D-103:** **A dedicated project-scoped triage surface, with `TriageLane` as its board entry
  point.** A real triage pane, sibling to `SessionSurface.tsx`, listing this project's pending
  proposals with keyboard-driven accept / reject / merge / defer, the stated rationale, and the
  jump-back-to-turn link from D-99. `TriageLane.tsx` stays on the board carrying the count and
  routing into the surface. PROP-06 asks for a dedicated view, and the four verbs do not fit a
  board-lane row — merge needs a target picker and defer needs a recall filter.
  Deliberately **project-scoped**: a cross-project queue is Fleet Supervision's job
  (FLEET-01/02), and building it here pulls that phase's work forward.
  Rejected: extending `ProposalRow.tsx` in place and shipping no new surface (cheapest by far —
  the lane, the grouping, the collapse state and the row component all already ship — but
  "dedicated view" becomes a lane among lanes and merge's target picker has to live inside a
  32px board row); and a modal overlay from the lane header (no new route — but a modal is a
  poor home for a queue worked one row at a time and cannot be deep-linked).
  — **Reversibility:** costly — undoing it means deleting a view and re-homing four verbs back
  into a board row.

- **D-104:** **Bulk reject and bulk defer; never bulk accept.** Accept stays per-row or
  per-subtree (D-95), because accepting is what mints canonical rows and burns a contiguous
  per-project key (D-10) — it must stay deliberate. Reject and defer mint nothing, so a
  multi-row sweep is safe, and it is what PROP-05's chatty-agent case actually needs. Plan
  05-06's accept-all source gate, which scans all of `packages/desktop/src`, stays **green and
  unchanged** — it forbids an accept-all control and this phase adds none.
  Rejected: no bulk anything (SHAPE-04's prohibition as literally written, zero new risk — but
  a run that proposes fifteen near-identical follow-ups costs fifteen individual clicks to
  clear); and bulk everything via multi-select (fastest queue-draining — but it puts an
  accept-all control into `packages/desktop/src`, which fails the existing source gate, and
  that gate would have to be deleted rather than narrowed).

### Duplicate flagging

- **D-105:** **FTS5 `bm25` over the already-shipped indexes, against one fixed threshold.**
  Score the proposal's title and body against `tasks_fts` / `epics_fts` / `issues_fts` and flag
  the best hit above the threshold. No new index, no new dependency, no network: the tables and
  their sync triggers ship in `0002_board_schema.sql`, and `query::search::search_items`
  already carries the quoted-phrase escaping that stops a model-authored title being read as
  FTS5 query syntax. Deterministic, so a UAT can assert it.
  An embedding-based detector was not considered viable: Flywheel authenticates only through
  the developer's existing local Claude credentials and never an API key, and the execution
  model is local-first — a hosted-model dedup pass breaks both constraints.
  Rejected: normalised-title near-match with a trigram overlap score (the most predictable and
  the easiest to explain in the UI — but it misses the common agent case, the same finding
  described in different words); and a two-stage bm25-recall-then-title-rank pass (best
  precision, both halves local — but two tunable thresholds instead of one, and more to explain
  when a flag looks wrong).

- **D-106:** **The corpus is canonical items plus pending proposals plus the already-decided
  set.** Open tasks, epics and issues in the project; this project's still-pending proposals;
  and the accepted/rejected/merged/deferred rows D-83 keeps forever. Re-proposing something
  already rejected is the most irritating duplicate there is, and D-83 built the bounded
  indexed read (`idx_authoring_proposals_epic_status`) for exactly this priming purpose.
  **Open implementation choice (Claude's discretion, see below):** the decided set has no FTS
  index today, so covering it means either a new FTS5 table over `authoring_proposals` or
  title-matching that half.
  Rejected: canonical items plus pending only (covers the two sets you actually look at and
  both already have an indexed read — but an agent can re-propose a rejected idea on every run
  unflagged, which is the D-83 priming problem relocated); and canonical items only (smallest
  and fastest, entirely on shipped indexes — but two agents in the same wave proposing the same
  follow-up both come through unflagged, since neither is on the board yet).

- **D-107:** **The flag is written at staging time, not computed on read.** New `duplicate_of`
  and `duplicate_score` columns on `authoring_proposals`, written inside the same transaction
  that stages the proposal. PROP-04 says flagged *before being surfaced*, and a stored flag is
  the only version a test can assert deterministically. It is also bounded — no `bm25` sweep
  per render over a queue of unknown length. **The row always still appears**, annotated with a
  link to its candidate; nothing is ever auto-dropped or auto-merged.
  Rejected: computing the flag inside the triage read (always current as the board changes
  underneath the queue, no migration — but an unbounded read shape on every render, the exact
  pattern `epic_context_packet.rs`'s `unbounded_reads` test exists to refuse, and "before the
  user sees it" degrades to "as the user sees it"); and storing then refreshing on read (most
  accurate — but two code paths for one number, and a stored and displayed value that can
  disagree).
  — **Reversibility:** one-way — two new columns; removing them needs a migration.

- **D-108:** **`propose_item` returns the flagged candidate to the agent.** The call resolves
  with `staged` plus the candidate's key and title, so the agent can see it and stop rather
  than filing three rewordings of one finding. This is D-93's shape reused: a decision about a
  proposal is a turn in the agent's conversation, not a silent server-side fact. It also takes
  pressure off D-109's limit, since near-duplicates are the commonest way to burn it.
  Note this diverges deliberately from the authoring path, where `stageAuthoringProposal`
  resolves every `propose_*` call with the literal `{"staged": true}`.
  Rejected: staying silent and returning the same opaque receipt (uniform tool-result shape
  across both run kinds — but the agent has no way to notice it is repeating itself, so the
  queue fills with variants rejected one at a time); and refusing to stage a duplicate at all
  (the queue never carries duplicates — but that is auto-dropping, which PROP-04 does not ask
  for, and a false positive would silently destroy a real finding with no record that anything
  was proposed).
  — **Reversibility:** costly — the resolved result shape is described to the model in its
  prompt, and the divergence from authoring's `{"staged": true}` contract has to be kept
  deliberate rather than accidental.

### The per-run volume limit

- **D-109:** **One fixed constant, around 10 proposals per run, not configurable.** Follows
  D-69 exactly — the verbatim window was deliberately fixed at 5 rather than exposed as a
  setting, because a knob nobody tunes still has to be tested at every value. A v1 with no
  setting is also one fewer thing to migrate when the real number turns out to be different.
  Rejected: a global setting with a default (raise it when a genuinely productive run keeps
  hitting the cap — but a new settings surface and a value the tests stop being able to
  assume); and a per-project setting (a noisy legacy repo and a greenfield one want different
  numbers — but a `projects` column, a settings UI, and a per-project value in every fixture).

- **D-110:** **Enforced in the Rust core, inside the staging write transaction.** Count the
  run's existing rows and refuse the N+1th in the same transaction that would have written it —
  a `COUNT(*)` on `idx_authoring_proposals_run_status`, which already indexes exactly
  `(agent_run_id, status)`. The core owns the store of record, the check cannot be raced, and
  it survives a sidecar restart. Anything enforced outside the write is advisory by
  construction.
  Rejected: counting per run in the sidecar process (no DB round trip, refusal reaches the
  agent fastest — but the counter is in memory, so `watchdog.ts` restarting the sidecar resets
  it and any other writer bypasses it); and both layers (defence in depth, the same shape as
  D-55's hook-plus-shim pairing — but two counters that can disagree and a second home for the
  constant).
  — **Reversibility:** costly — the atomicity guarantee is what makes the limit a limit;
  relocating it later weakens it and changes every test that asserts it.

- **D-111:** **The tripping call is refused loudly, and points the agent at its summary.** A
  tool error naming the limit and stating the proposal was not staged — so the agent can put
  whatever else it found into `report_summary`'s existing `remains` field (D-65) instead of
  losing it. D-93's shape again. The board stays clean and nothing the agent knew is actually
  lost.
  Rejected: staging the row and marking it over-limit (nothing is discarded and the overflow is
  visible behind a filter — but the limit then limits nothing; the spam lands in the queue with
  a label on it, which is the outcome the ROADMAP note says kills trust); and refusing silently
  (smallest change to the tool contract — but PROP-05 explicitly asks for the opposite).

- **D-112:** **Cyril is told through an append-only `events` row, with the display re-derived
  on read.** The triage surface and the run's own entry derive their notice from the event
  every time rather than storing a second copy. This is D-74/D-75 applied verbatim — a fired
  detector is an `events` row and the warning line is never stored twice. It follows D-53 too:
  count every refusal per run, surface only the exhaustion.
  Rejected: an OS notification the moment a run is throttled (lets you intervene while it is
  still running — but OS notifications are FLEET-05's requirement in Fleet Supervision, and
  building that channel here pulls the phase forward); and showing it only in the run's own
  session feed (zero new plumbing — but you see it only if you were watching that run, which
  for a background fleet is most of the time not).

### Claude's Discretion

Cyril explicitly delegated these; decide them during research and planning and record the
choice.

- Whether `authoring_proposals` is renamed now that it serves both authoring and execution
  runs, or kept under its Phase 5 name with a corrected module comment.
- Whether an executing agent's session surface gains a live proposal tray beside its output,
  the way `SessionSurface.tsx` does for authoring, or whether the board lane's count is the
  only in-flight signal.
- The keyboard bindings for accept / reject / merge / defer on the new triage surface
  (`packages/desktop/src/state/keyboard.ts` already owns the board's map).
- Whether `amend` (D-94), built in Phase 5 for drafted criteria, is offered on an
  execution-run proposal at all.
- The actual `bm25` threshold value for D-105 — this wants measurement against seeded data,
  not a number guessed in a planning document.
- Whether the D-106 decided-set half gets its own FTS5 table over `authoring_proposals` or is
  matched by title only.
- The `issues` payload shape for an `issue`-target proposal, given `kind` must be one of
  `bug` / `idea` / `question` / `risk` per the schema CHECK.
- What happens to a pending proposal when its run is abandoned (D-49's `abandoned` status) —
  the proposal outliving its session is D-80's whole point, so the expected answer is "nothing",
  but it needs an explicit test rather than an assumption.

</decisions>

<canonical_refs>
## Canonical References

**Downstream agents MUST read these before planning or implementing.**

### The proposal staging table and its lifecycle
- `packages/core/src/db/migrations/0011_authoring_staging.sql` — the `authoring_proposals`
  table D-97 extends: verb/target_type/status CHECK constraints, the three indexes, and the
  header comment stating why decided rows are never deleted (D-83).
- `packages/core/src/db/migrations/0012_authoring_proposals_project_status_index.sql` — the
  `(project_id, status, created_at DESC)` index the project-scoped triage read uses.
- `packages/core/src/domain/authoring_proposal.rs` — `create_proposal` / `accept_proposal` /
  `reject_proposal` / `amend_proposal` / `accept_subtree`, and the module header stating the
  no-canonical-write discipline D-100's source gate must assert.
- `packages/core/src/query/authoring.rs` — `list_pending_proposals`,
  `list_rejected_for_epic`, `resolve_board_read`, and the `DEFAULT_LIMIT`/`MAX_LIMIT` clamp
  every read here is bounded by.

### The board schema and why issues carry no status
- `packages/core/src/db/migrations/0002_board_schema.sql` — the `issues` table, the
  `tasks_fts`/`epics_fts`/`issues_fts` external-content FTS5 tables and their sync triggers
  (D-105 depends on both), and the header note at line 7 reserving the triage lifecycle for
  this phase.
- `packages/core/src/domain/issue.rs` — `create_issue`, `IssueParent`, and the module header
  at line 5 naming `proposed/triaged/accepted/rejected/merged_into_task`. D-97 resolves that
  note; D-101 uses `create_issue` as the merge materialiser.
- `packages/core/src/query/search.rs` — `search_items`, `to_fts5_prefix_phrase`, and the
  header's warning that external-content FTS5 tables drift silently if a write bypasses the
  triggers. D-105 builds on this module.

### The agent-facing tool surface
- `packages/sidecar/src/mcp-permission-server.ts` — the tool-name declarations, the
  `AUTHORING_WRITE_TOOL_NAMES` / `AUTHORING_READ_TOOL_NAMES` lists, `MAX_READ_LIMIT`, and the
  `AuthoringProposalPayload` wire shape D-99 adds a field to. Note the header rule that a read
  tool must stay outside the `propose_`/`amend_`/`delete_` prefix.
- `packages/sidecar/src/claude-code-adapter.ts` — `buildClaudeArgv` (execution runs; D-98's
  new `--allowedTools` entry goes in the same branch that already pre-approves
  `SUMMARY_TOOL_NAME`) and `buildAuthoringClaudeArgv` / `startAuthoringSession` (the authoring
  path, untouched by this phase). Also `normalizeProposalNotice` and the known narration-drop
  hazard at lines 589-612 that D-99 works around.
- `packages/sidecar/src/stage-gate-hook.ts` — the name-prefix matcher, wired only on authoring
  sessions. D-98 avoids extending its reach.

### The triage UI
- `packages/desktop/src/board/TriageLane.tsx` — the shipped board-level lane; D-103 keeps it
  as the entry point. Its header comment records SHAPE-04's no-lane-wide-decision rule that
  D-104 narrows.
- `packages/desktop/src/authoring/ProposalRow.tsx` — the accept / reject / amend /
  accept-subtree row D-103's surface reuses and D-101/D-102 extend.
- `packages/desktop/src/authoring/ProposalAmendEditor.tsx`,
  `packages/desktop/src/authoring/useAuthoringQuery.ts` — the amend editor and the query hooks
  (`useAcceptProposal`, `useRejectProposal`, `useProjectProposals`) the new surface builds on.
- `packages/desktop/src/session/SessionSurface.tsx` — the sibling surface D-103's triage pane
  is modelled on.
- `packages/desktop/src/state/keyboard.ts` — the board's existing keyboard map, which the new
  surface's bindings must not collide with.

### Prior-phase decisions this phase inherits
- `.planning/phases/05-socratic-epic-authoring/05-CONTEXT.md` — D-80 to D-96. Read D-80/D-81
  (staging and the verb vocabulary), D-83 (decided rows kept forever), D-92 to D-96
  (per-row granularity, rejection as a conversational turn, amend, subtree accept,
  materialisation).
- `.planning/phases/04-clear-is-free/04-CONTEXT.md` — D-64/D-65 (`report_summary` and its
  `remains` field, which D-111 points the agent at), D-69 (fixed-not-configurable precedent for
  D-109), D-74/D-75 (the events-row-plus-re-derived-display pattern D-112 copies), D-76 to
  D-79 (criteria locking, which D-101 deliberately avoids touching).
- `.planning/phases/03-nothing-lost-nothing-left-running/03-CONTEXT.md` — D-46 (permission
  friction reserved for money-burning actions, why D-98's tool is pre-approved), D-49
  (`abandoned` runs), D-53 (count per run, surface only exhaustion), D-55 (hook-plus-shim
  defence in depth, the shape D-110 declined), D-62 (adversarial corpus plus recorded trust
  boundary, the shape D-100 copies).
- `.planning/REQUIREMENTS.md` — PROP-01 to PROP-07 at lines 101-107.
- `.planning/ROADMAP.md` — Phase 6's five success criteria and the note that criterion 1 must
  be verified by proving no promotion path exists.

</canonical_refs>

<code_context>
## Existing Code Insights

### Reusable Assets
- `authoring_proposals` table plus its four indexes — the whole staging substrate, needing only
  an `issue` target type, a `merged`/`deferred` status, and D-99/D-107's new columns.
- `domain::authoring_proposal`'s write path — identity is resolved from the `agent_runs` row
  *inside* the write transaction and never accepted as a caller argument (T-05-02-01). D-110's
  count belongs in that same transaction.
- `domain::issue::create_issue` with `IssueParent` — D-101's merge materialiser, already a
  canonical writer with the both-parents-at-once case unrepresentable.
- `query::search::search_items` and the three `*_fts` tables — D-105's detector, escaping
  included.
- `TriageLane.tsx`, `ProposalRow.tsx`, `ProposalAmendEditor.tsx`, `useAuthoringQuery.ts` — the
  triage UI, project-scoped and run-agnostic already.
- `report_summary`'s `remains` field — where D-111 sends what did not fit under the limit.

### Established Patterns
- Every agent-reachable write resolves its identity server-side from the socket the call arrived
  on; no payload carries a `runId`, `projectId` or `epicId`. D-98's tool must follow this.
- Every read is bounded and indexed from the first migration, and there is a test
  (`epic_context_packet.rs`'s `unbounded_reads`) that refuses an unbounded read shape. D-107
  chose stored-at-staging partly for this reason.
- Prohibitions are enforced by grep gates over source, not by convention —
  `hierarchy_workflow.rs`'s no-status gate on issues, plan 05-06's accept-all scan over
  `packages/desktop/src`. D-100 and D-104 both live inside this pattern.
- A decision about a proposal is a turn in the agent's conversation (D-93). D-108 and D-111
  both extend that.
- Migrations are additive and numbered; a new CHECK value means a table rebuild, which is why
  D-97, D-102 and D-107 are rated one-way.

### Integration Points
- `buildClaudeArgv`'s `--allowedTools` branch in `claude-code-adapter.ts` — the one line that
  gives an execution run a new pre-approved tool.
- `mcp-permission-server.ts`'s tool registration and its per-run socket protocol — where
  `propose_item` is declared and where its payload arrives.
- `sidecar.rs`'s inbound applier (the `"proposal_created"` branch) — where a staged proposal
  crosses from the sidecar into the Rust core.
- `BoardView.tsx` — where `TriageLane` mounts and where D-103's route into the triage surface
  hangs.

</code_context>

<specifics>
## Specific Ideas

- The reconciliation in D-97 is the specific thing to get right: `issue.rs:5` and
  `0002_board_schema.sql:7` both promise Phase 6 gives issues a triage lifecycle, and Phase 5
  then shipped `authoring_proposals` doing nearly the same job. The resolution is that the
  lifecycle lives on the proposal row and `issues` keeps zero status columns — so
  `hierarchy_workflow.rs`'s grep gate stays green and `merged_into_task` is a proposal outcome.
  A planner reading only `issue.rs` will reach the opposite conclusion; it must read D-97.
- Plan 05-06's accept-all source gate scans all of `packages/desktop/src`. D-104 adds bulk
  reject and bulk defer controls to that tree. The gate must stay green — it forbids
  accept-all specifically, not bulk actions generally, and that distinction needs to survive
  into the new surface's implementation.

</specifics>

<deferred>
## Deferred Ideas

- A cross-project proposal queue — belongs with Fleet Supervision (FLEET-01/02). D-103 keeps
  the triage surface project-scoped for exactly this reason.
- An OS notification when a run is throttled or a proposal lands — FLEET-05.
- A `deferred_until` snooze that returns a proposal to the queue on a date — needs the
  `tokio-cron-scheduler` trigger machinery that v1 deliberately leaves stubbed. Revisit when
  scheduled automations land.
- Defer-as-idea-issue (D-102's third option) — a reasonable later refinement if the deferred
  pile turns out to be where good ideas go to die.

### Reviewed Todos (not folded)
All four todos that matched this phase were reviewed and deliberately left out of scope; they
are Phase 5 authoring/harness defects, not proposal-channel work.

- `2026-09-26-g-05-8-askuserquestion-invisible-and-board-unwritable-in-liv.md` —
  `AskUserQuestion` uncaptured and unanswered in a live authoring run. Severity blocker, but
  scoped to the Phase 5 UAT harness and the authoring conversation path.
- `2026-09-24-adapter-drops-assistant-text-when-a-stream-line-carries-text.md` — narration
  dropped when one stream line carries both text and `tool_use`
  (`claude-code-adapter.ts:589-612`). **Noted as a live constraint on D-99**: it is why the
  rationale field is required rather than derived from the turn the pointer lands on. Fixing it
  is still Phase 5's follow-up.
- `2026-09-26-socratic-challenge-should-be-structured-like-gsd.md` — authoring conversation
  shape, Phase 5.
- `2026-09-30-handoff-sheet-drops-questions-the-agent-asked.md` — authoring handoff sheet,
  Phase 5.

</deferred>

---

*Phase: 6-agents-file-their-own-backlog*
*Context gathered: 2026-09-30*
