# Phase 13: Nothing New Escapes The Fence - Context

**Gathered:** 2026-10-14
**Status:** Ready for planning

<domain>
## Phase Boundary

Close the world before v0.2.0's three new record types (PRD, ADR, Cycle) exist. Five structural
guarantees become closed-world and asserted: the spine cannot erode, an unclassified table fails
the build, authority is reachable only from a human, the context packet is bounded, and the fields
nobody reads are gone rather than drafted. Eight carried defects (F1, F4, F5, F6, F7, F8, F9, F11)
are paid here, plus the CLAUDE.md/PROJECT.md reconciliation.

This is the milestone's one horizontal phase. It delivers no new surface. New capabilities —
record tables, Cycle UI, drafting engine, review — belong to phases 14–18 and must not leak in.

Requirements: FNC-01, FNC-02, FNC-03, FNC-04, FNC-05, FNC-06, FNC-07, DRFT-04, DRFT-05, DRFT-06,
DRFT-09.

</domain>

<decisions>
## Implementation Decisions

### Bounding the context packet (FNC-05)

- **D-01:** Bound the *input*, not the fold. `SUMMARIES_SQL` (`context_packet.rs:219`) gets a fixed
  `LIMIT`; `compaction.rs` is not touched and stays lossless for decisions and file paths over
  whatever list it is given. No amendment to D-68 or D-69, and the "lossless for decisions" contract
  in the module header remains literally true. The residue is bounded because the list is.
  — **Reversibility:** reversible — one const and one SQL string; nothing persists the choice.
- **D-02:** The window is **25 — 5 verbatim plus 20 folded**. Declared exactly once as a sibling
  const to `compaction::VERBATIM_WINDOW`, in the same D-69 house style (a fixed count, never a
  parameter, never config). The boundary reads as one sentence: the last 5 whole, 20 more folded,
  the rest on the board.
- **D-03:** The CTX-05 boundary sentence states the count **and one named way to reach what was left
  out** ("Summaries 46–245 of 245 read; 45 earlier sessions are on the task", plus how to read them).
  It does not enumerate excluded decision ids — that list grows with task age and would reintroduce
  the unbounded term one level down.
- **D-04:** Determinism is preserved: the sentence is a function of board state only, so criterion 4's
  byte-identical assertion (adding a superseded ADR changes nothing) still holds.
- **D-05:** `drift.rs`'s `detect_decision_read_back` reads the **same bounded list**. Its contract
  becomes explicitly "over the summaries in scope", replacing the current comment at `drift.rs:188`
  that relies on compaction's losslessness for completeness. The `FabricatedDecisionEcho` half gains
  a **bounded point-lookup existence check** per echoed id before calling it fabricated — echoed ids
  come from one summary row's JSON, so that read is bounded by one row, not by task age.
  — **Reversibility:** costly — without it the LIMIT introduces a *false* `FabricatedDecisionEcho`
  whenever an agent correctly echoes a decision from a dropped summary; the detector must change in
  the same diff as the LIMIT, not after.
- **D-06:** Named consequence to write into the module doc: a decision older than the window can go
  unacknowledged without firing `UnacknowledgedDecision`. Accepted, and stated out loud rather than
  discovered later. The durable home for old decisions is the board, and CTX-06's registry (Phase 16).
- **D-07:** `acknowledged_decisions` **never** affects packet inclusion. It is D-73 drift machinery —
  proof an agent *read* a decision, not that the decision is settled. The roadmap's research flag
  asked whether acknowledged decisions drop from the residue; the answer is no, and the reason is
  that dropping on acknowledgment would both lose a decision because an agent said it saw it and
  blind `drift.rs:207`.

### Derived task status (DRFT-04, F5)

- **D-08:** `tasks.status` **stays a column**, materialised, with **exactly one writer** — the
  deriver. Every other path (agent, command, picker) is refused at the database and by a source
  gate. This keeps the twelve `'backlog'` SQL predicates, the rank index, the `task.status_changed`
  events the activity trail and drift read, and `forge/transitions.rs`'s compare-and-swap
  precondition. "Derived" here means "kept in sync by one deriver", not "computed per read".
  — **Reversibility:** costly — the alternative (dropping the column) would touch every status
  predicate, the backlog rank query, the status index and the whole edge-detector baseline.
- **D-09:** `in_progress` derives from **a worktree existing for the task**
  (`git_facts_for_task` returning `Some`). Not first commit, not an active agent run — the worktree
  is the durable task-owned resource that outlives sessions, so a card does not flip back to todo
  when an agent context is discarded.
- **D-10:** Forward-only is kept as an **explicit band floor**: the deriver computes a candidate and
  takes `max(candidate, current)` over the band order. D-122's reasoning survives the model change
  as one comparison rather than an absent branch. `done` is terminal as a consequence of the floor,
  not as a separate rule. A closed-unmerged request therefore leaves a card `in_review` until
  something moves it forward.
  — **Reversibility:** one-way in practice — reversing it means re-arguing D-121/D-122, which were
  taken on evidence in Phase 7.
- **D-11:** **The floor binds the deriver, not the board.** A human authority act may lower it:
  `request_changes` (`task.rs:652`, `in_review → in_progress`) stays a human-only FNC-03 transition
  that explicitly lowers the floor, and the deriver then respects the new value. Without this, a
  declined task would be indistinguishable from one awaiting first review.
- **D-12:** The deriver runs on **the existing D-113/D-114 scheduler tick**, replacing the edge
  detector's write at that point, **plus worktree create and remove** as the `todo → in_progress`
  edge. No new scheduler. The `expected_status` compare-and-swap precondition carries over unchanged.
- **D-13 (F5):** `agent_run.rs:233`'s raw `UPDATE tasks SET status = 'in_progress'` is **deleted**,
  not refactored and not allow-listed. A run only starts once a worktree exists, so the deriver has
  already set `in_progress` and the write is dead. It also violates the rule documented at
  `task.rs:443` ("No caller anywhere may issue a raw `UPDATE tasks SET status`").

### Unread fields (DRFT-05, DRFT-06, F4)

- **D-14:** `estimate` is **dropped from the schema** — both `tasks` and `epics`
  (`0002_board_schema.sql:44`, `:70`) — via a table rebuild, since SQLite refuses `DROP COLUMN` on a
  column named in a `CHECK`. `EstimatePicker.tsx` and the estimate filter dimension
  (`query/filter.rs`) are deleted with it. The spine DDL pin (FNC-01) is written against the
  post-drop schema.
  — **Reversibility:** one-way — a migration with FK care across `tasks`, `epics` and
  `criterion_anchors`; restoring the field means another rebuild.
- **D-15:** The rebuild is **deliberately reused as early proof that `criterion_anchors` rows survive
  a `tasks` table rebuild** — the exact test RECD-04 (Phase 16) is conditional on, moved three phases
  earlier where it is cheap. Plan this as a named assertion, not a side effect.
- **D-16:** `priority` keeps its column and its `CHECK (0..4)` unchanged — `0` already means "no
  priority" and already sorts last, so the opt-in semantic exists today. What changes: **an agent
  never writes priority.** It proposes one through the existing `authoring_proposals` staging path
  carrying its reasoning, and a human accepts it per-item under the DRFT-07 unit-of-acceptance rule.
  `PriorityPicker.tsx` stays as the human's own control. The no-promotion gate already covers the
  staging path.
- **D-17 (F4):** `set_estimate` disappears with the column. F4 narrows to **`set_priority_in_tx`**,
  and that form is now *required* rather than optional, because accepting a priority suggestion
  happens inside the proposal-acceptance transaction.
- **D-18:** **Hand-made tasks are created at `todo`.** Typing a task is the human act; there is no
  second acceptance to wait for. `backlog` comes to mean exactly "proposed by an agent, not yet
  accepted", giving the band one meaning instead of two. `create_task`'s three hardcoded `'backlog'`
  sites (`task.rs:76`, `:100`, `:134`) and the backlog-tail rank query change together.
- **D-19:** `StatusPicker.tsx` is **deleted**; status is read-only on the card. The deletion is
  itself the proof that no human-reachable status write exists outside the deriver and the one
  `request_changes` authority act — a deletion a source gate can assert, rather than a refusal it
  has to interrogate.

### Gates (FNC-01, FNC-02, FNC-03, FNC-04)

- **D-20 (FNC-04):** The forbidden-vocabulary gate keeps **all ten words** and matches on **word
  boundaries**, with exactly **two named idiom exclusions**: `with_capacity` /
  `String::with_capacity`, and `deadline` scoped to `proc.rs` where it is an `Instant`. Each
  exclusion carries its reason in the test. Any new PM-shaped use of either word still fails.
  *Finding this phase must act on:* criterion 3 taken literally fails the build today — `capacity`
  appears 15 times as `Vec::with_capacity`/`String::with_capacity` and `deadline` is a timeout
  `Instant` in `proc.rs`. A committed baseline fixture was rejected because every future
  `Vec::with_capacity` would fail the build until regenerated — a permanent tax on idiomatic Rust,
  which is how a gate gets disabled.
- **D-21:** The gate scans **`packages/core/src` and `packages/desktop/src`, plus their test trees**.
  Tests are source in this repo (the gates themselves are tests) and a fixture is the cheapest place
  to smuggle a field in. **Planning documents are never scanned** — `.planning/REQUIREMENTS.md`
  names `velocity` and `deadline` in its own out-of-scope table, and the words must stay sayable
  there in order to be forbidden in code. Reuse the existing `sources_under()` `.rs`/`.ts`/`.tsx`
  walk and the `is_whole_line_comment` exemption.
- **D-22 (FNC-02):** Table classification lives in **a const list in core, checked against
  `sqlite_master` by a test**: the test opens a migrated DB, reads `sqlite_master`, and fails both on
  a table the list does not name and on a name the list has that the DB does not. A compile-time
  enum was rejected because migrations are SQL text — a new table reaches the database without the
  compiler ever seeing it. Parsing the migration tree was rejected because it tests the text rather
  than the schema, which is the open-world hole FNC-02 exists to close.
- **D-23:** Gate tests follow the house style already in `proposal_no_promotion.rs` and
  `destructive_gate_no_new_launcher_tokens.rs`: self-contained helpers copied rather than shared,
  case-sensitive literal corpora, whole-line-comment exemption.
- **D-24:** Every gate change is **two-sided** (Phase 12 key decision): a check that fails if the
  gate decides something it cannot justify, *and* a check that fails if a legitimate path becomes
  blocked. An agent attempting an authority transition is refused; a human performing it is not.

### Criterion amendments this discussion implies

Record these as owner decisions in the phase; each is a wording change the discussion forced, not a
scope change:

- **A-01 (criterion 2):** "refactored or allow-listed" becomes **"refactored, deleted, or
  allow-listed"** — the `start_agent_run` write is redundant under derived status (D-13).
- **A-02 (criterion 3):** the forbidden-word gate is a **whole-word** scan with two named idiom
  exclusions; the literal reading fails the build on idiomatic Rust (D-20).
- **A-03 (D-122):** forward-only is re-expressed as a **floor on the deriver**, and the floor does
  not bind human authority acts (D-10, D-11).
- **A-04 (the research flag):** answered. Acknowledged decisions never drop; the bound is on the
  input, not the residue (D-01, D-07).

### Claude's Discretion

- Exact wording of boundary and refusal sentences, subject to the stated shape.
- Internal naming of the new const, the deriver function and the classification enum.
- Whether the classification test lives beside `proposal_no_promotion.rs` or in its own file.
- Sequencing of the eight defects against the five gates, and plan decomposition generally.

### Folded Todos

- **`git_identity` builds a table name into SQL with `format!`, against the crate convention**
  (`.planning/todos/2026-10-05-git-identity-builds-a-table-name-into-sql-with-format.md`, area: core).
  Folded because Phase 13 is already building the table-classification and SQL source gates — a
  table name interpolated into SQL is exactly what the closed-world classification work is reading
  for, and fixing it inside that pass is cheaper than a separate visit.

</decisions>

<canonical_refs>
## Canonical References

**Downstream agents MUST read these before planning or implementing.**

### Phase scope and requirements
- `.planning/ROADMAP.md` §"Phase 13: Nothing New Escapes The Fence" — goal, six success criteria,
  the research flag, defect placement table and pitfall placement table
- `.planning/REQUIREMENTS.md` §"Integrity and fencing" (FNC-01…07), §"Drafting" (DRFT-04, 05, 06, 09),
  §"Out of Scope", §"Decisions taken at requirements time" (notably decisions 4 and 8)
- `.planning/PROJECT.md` §"Key Decisions", §"Constraints"
- `.planning/research/v0.2.0/PITFALLS.md` — pitfalls 4, 6 and 7 are the ones this phase prevents
- `.planning/research/v0.2.0/SUMMARY.md` — the eleven pre-existing defects, of which eight land here

### Context packet and compaction
- `packages/core/src/context_packet.rs` — `SUMMARIES_SQL` at :219, the unbounded read this phase fixes
- `packages/core/src/compaction.rs` — `VERBATIM_WINDOW`, the lossless-for-decisions contract, `boundary_sentence()`
- `packages/core/src/drift.rs` — `detect_decision_read_back` at :188; its completeness comment depends on compaction's losslessness
- `packages/core/src/epic_context_packet.rs` — the unbounded-reads gate's current allowlist shape
- `packages/core/tests/epic_context_packet.rs` :728–745 — why `SUMMARIES_SQL` was deliberately left out of the allowlist

### Status derivation
- `packages/core/src/forge/transitions.rs` — D-121/D-122/D-123/D-124, the edge detector, `expected_status` compare-and-swap
- `packages/core/src/forge/mod.rs` — `ForgeState`, `CiResult`, `ForgeRequest`
- `packages/core/src/git_facts.rs` — `git_facts_for_task`, `TrackedWorktree`, the D-113/D-114 tick inputs
- `packages/core/src/domain/task.rs` — `set_task_status` / `set_task_status_in_tx` (:415–467), the raw-UPDATE prohibition at :443, `request_changes` at :652, `create_task`'s `'backlog'` sites at :76/:100/:134
- `packages/core/src/domain/agent_run.rs` :233 — F5, the raw status write to delete

### Gates and schema
- `packages/core/tests/proposal_no_promotion.rs` — the no-promotion corpus to extend to `prd`, `adr`, cycle-assignment; the house style for a self-contained source gate
- `packages/core/tests/destructive_gate_no_new_launcher_tokens.rs` — the committed-baseline precedent, considered and rejected for FNC-04
- `packages/core/src/db/migrations/0002_board_schema.sql` — the spine DDL to pin; `priority` :43/:69, `estimate` :44/:70, the `tasks.status` CHECK at :67
- `packages/core/src/db/migrations/` — the full migration set the table-classification test runs against

### Desktop surfaces touched
- `packages/desktop/src/board/pickers/EstimatePicker.tsx`, `StatusPicker.tsx` — both deleted
- `packages/desktop/src/board/pickers/PriorityPicker.tsx` — retained as the human control
- `packages/desktop/src/board/__tests__/layer-guard.test.tsx` — the existing keyboard layer model pin (FNC-06)
- `packages/core/src/query/filter.rs` — the estimate filter dimension to remove

### Reconciliation work carried by this phase
- `CLAUDE.md` — four stack-table entries not in the tree (`@monaco-editor/react`, `@xyflow/react`, `git2`, `@anthropic-ai/claude-agent-sdk`)
- `.planning/PROJECT.md` — the claim that the Phase 6 gate scans `packages/desktop/src` (it scans `sidecar/src`)

</canonical_refs>

<code_context>
## Existing Code Insights

### Reusable Assets
- `sources_under()` / `is_whole_line_comment()` / `workspace_root()` — the source-gate helper trio,
  copied per-file by this repo's own precedent. FNC-02 and FNC-04 both get their own copies.
- `compaction::compact_summaries` — a pure fold needing no change under D-01; only its input shrinks.
- `authoring_proposals` staging plus `accept_proposal` / `materialise_proposal` — the per-item
  acceptance path priority suggestions route through (D-16), already covered by the no-promotion gate.
- `forge::transitions::apply_forge_observation`'s `expected_status` compare-and-swap — carries
  straight over to the deriver (D-12).
- `CompactionBoundary::boundary_sentence()` — the CTX-05 sentence shape D-03 extends.

### Established Patterns
- Source gates are integration tests under `packages/core/tests/`, self-contained, with
  case-sensitive literal corpora and an explicit allowlist const where unavoidable
  (`ALLOWED_CANONICAL_WRITER_CONTAINERS`, `proposal_no_promotion.rs:166`).
- Fixed counts are declared exactly once and never parameterised (D-69, D-23, D-24 precedent).
  The new summary window follows this.
- `_in_tx` suffixed writers exist so a caller already holding a transaction never opens a second —
  the convention F4 is about restoring for `set_priority`.
- Status is currently nudged, not owned: the forge writes forward-only on an edge and hands the
  column back. The deriver replaces that write; it does not sit beside it.

### Integration Points
- The D-113/D-114 scheduler tick is where the deriver attaches (D-12).
- Worktree create/remove in `domain/worktree.rs` is the second derivation trigger.
- `query/filter.rs` and `BoardView`/`FilterBar`/`BoardRow` are where the estimate dimension unwinds.
- `board:changed` emitters live across `src-tauri/src/commands/*.rs` — FNC-07's payload work touches
  every one of them, plus `useBoardQuery.ts` on the reader side.

</code_context>

<specifics>
## Specific Ideas

- The boundary sentence must stay sayable out loud, in the D-69 spirit: "the last 5 whole, 20 more
  folded, the rest on the board" — arithmetic a developer can state, never a ceiling they would have
  to reverse-engineer from behaviour.
- Deleting a control is preferred over a control that refuses: `StatusPicker` goes rather than
  staying to explain itself (D-19), because a deletion is something a source gate can assert.
- The estimate rebuild should be planned as a *named proof* for RECD-04, so Phase 16 can cite it
  rather than repeat it.

</specifics>

<deferred>
## Deferred Ideas

- **A manual status override / recompute command** — rejected with D-12 and D-19. A button whose
  existence admits the derivation can be wrong invites using it instead of fixing the trigger. If
  derivation proves visibly wrong in practice, revisit as a bug, not a feature.
- **A "why is this status" explainer on the card** (showing worktree present / request open / CI
  passed) — a genuine idea, but it is a Phase 14 surface question, not a Phase 13 deletion.
- **Scanning `.sql` migrations with the vocabulary gate** — the spine pin and the table-classification
  test already cover schema change; a third gate on the same diff was not worth it.
- **A per-task decision id index table** — rejected for D-05; new schema and a new write path for a
  detector that needs neither.
- Gray areas identified but not discussed, available to the researcher and planner as open scope:
  the per-run proposal cap *values* and refusal wording per run kind (DRFT-09 / F1), F7's
  `DatabaseTooFarAhead` user-facing behaviour, F11's `generate_handler!` roster generation, and what
  counts as the recorded live-planning-run artifact in criterion 6.

### Reviewed Todos (not folded)

Nine of the ten keyword matches were reviewed and left in the backlog — none touches the fence, the
packet, status derivation or the gates, and Phase 13 is already eight defects wide:

- Forge resolution failures are not memoised, so they retry per worktree every tick (desktop)
- Forge-sourced URLs reach an anchor href without scheme validation (desktop)
- Live-chain tests inconsistently assert that the fake CLI was actually reached (core)
- Timeout-boundary race misreports a child that just finished as TimedOut (core)
- Subprocess timeout guard leaks reader threads under a sustained forge outage (core)
- Adapter drops assistant text when a stream line carries text and tool_use (general)
- G-05-8 AskUserQuestion invisible and board unwritable in live run (tooling)
- Socratic challenge should be structured like GSD's questioning, not one wall of questions (authoring)
- Handoff sheet drops questions the agent asked (tooling)

</deferred>

---

*Phase: 13-Nothing New Escapes The Fence*
*Context gathered: 2026-10-14*
