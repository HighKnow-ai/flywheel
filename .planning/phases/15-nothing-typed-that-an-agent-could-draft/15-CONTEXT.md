# Phase 15: Nothing Typed That An Agent Could Draft - Context

**Gathered:** 2026-10-16
**Status:** Ready for planning

<domain>
## Phase Boundary

The encoding work goes away. This phase delivers the **drafting engine**: file-sets declared by a
planner proven against a live backend, acceptance criteria drafted and linted before a human ever
sees them, epics and tasks decomposed into children accepted one item at a time, a per-project cap
on how much drafted work may await a human, a number that distinguishes reflex acceptance from
good drafting, and a real backend limit observed, backed off from and surfaced.

**Requirements:** DRFT-01, DRFT-02, DRFT-03, DRFT-07, DRFT-08, DRFT-10, DRFT-11, DRFT-12
**Defects fixed here:** F3 (criteria cannot be drafted for an existing hand-made task),
F10 (draft file-sets are live and agent-attributed before approval)

**Not in this phase:** the PRD and ADR record types (16), agent pre-review (17), token values and
the signal budget (18), the since-you-left digest (deferred, trigger = Phase 17 closing).
DRFT-04/05/06/09 are already complete in Phase 13 and are not re-opened here.

</domain>

<decisions>
## Implementation Decisions

### The acceptance tier — provisional versus explicit (DRFT-07, PITFALLS prevention 5)

- **D-01:** **Explicit accept is for criteria and file-sets only.** Titles, bodies and priority
  suggestions land **provisional**. This is PITFALLS prevention 5 taken as written: the two things
  an agent *executes against* stay under human authority; the rest does not cost a decision each.
  A field with no downstream reader is not drafted at all — Phase 13 already deleted `estimate`
  (D-14) and made priority an opt-in suggestion (D-16).
- **D-02:** **A provisional value never mints a canonical row.** It stays in `authoring_proposals`
  and is *ghosted into the same form the manual path uses* — PITFALLS prevention 9's "one
  component, two sources". No `provisional` column, no second writer on `tasks`/`epics`, no
  parallel "agent UI". The spine Phase 13 pinned is untouched by this phase's tier work.
  — **Reversibility:** reversible — a render state and a read, nothing persisted that would need
  a migration to remove.
- **D-03:** **Start Work confirms every provisional value on that task.** BOARD-03 already freezes
  criteria at that moment, so the freeze point and the confirm point are the same site: one act,
  one place to teach, nothing new to discover. Confirmation materialises through the canonical
  `*_in_tx` writers those tables already own, exactly as `accept_proposal` does today.
- **D-04:** **Reject is the undo.** A provisional value is rejectable until confirmed; afterwards it
  is ordinary board state, edited the ordinary way. No timed undo, no expiry window, no timer
  racing the agent that just started.
- **D-05 (consequence, name it in planning):** because criteria are explicit-tier and the subtree
  path is deleted (D-06), a decomposition that also drafted criteria would be ~30 explicit accepts
  in one sitting — the shape Ancker et al. found worst. **That is why D-09 fires criteria drafting
  per task rather than inside the decomposition run.** The two decisions are load-bearing together;
  changing one without the other recreates the chore.

### No bulk accept anywhere (DRFT-07, criterion 3)

- **D-06:** **`accept_subtree` is deleted** — the handler, `AcceptSubtreeOutcome`, its tests, and
  the bulk-accept rationale in `idx_authoring_proposals_parent`'s comment (the index itself stays:
  `accept_proposal_in_tx`'s implied-parent walk still needs it). `subtree` joins the forbidden
  corpus. This **supersedes D-95** of Phase 5, which introduced it as "the ONE bulk path this
  module offers".
  — **Reversibility:** costly — restoring it means re-arguing criterion 3 and re-adding an
  identifier the new gate now fails the build on.
- **D-07:** **Start Work's confirm needs no named exemption.** It touches the provisional tier only;
  the explicit tier (criteria, file-sets) is never confirmed by it, so there are no accepts to
  batch. The gate's subject matter stays narrow — and the planner must keep the two tiers from
  blurring, since that separation is what makes this true.
- **D-08:** **The DRFT-07 source test lands on both sides.** Criterion 3 says *anywhere in the
  product*, and a desktop-side test cannot see `accept_subtree`. So: extend `TriageSurface`'s
  existing desktop test (D-104's precedent, the `import.meta.glob(..., '?raw')` + `code()` shape
  from `brand-rule.test.ts`) to every new draft surface, **and** a core-side gate over Rust
  handler names using the `sources_under()` / `is_whole_line_comment()` / `workspace_root()` trio.
  Two-sided per D-24 (13) and D-23 (14): each also fails if a legitimate per-item path becomes
  unreachable.
- **D-09:** `reject_proposals_bulk` and `defer_proposals_bulk` **stay unchanged** (D-104). They mint
  nothing, which is precisely why they were allowed; the gate is about accept alone.

### Criteria drafting and the no-criteria run gate (DRFT-02, DRFT-10, F3)

- **D-10:** **Criteria are drafted per task, on open or Start Work — never inside the decomposition
  run.** A decomposition drafts task items only. This keeps per-encounter volume at roughly five
  decisions (the Ancker finding), spends the cap only on work actually being started, and makes
  DRFT-10/F3's hand-made-task path *the same code path* as the fresh one rather than a second
  entry point. `materialise_proposal`'s parent-proposal requirement must stop being a precondition
  for criterion drafting — that is F3.
- **D-11:** **A run on a task with no criteria routes through drafting in the launch sheet, and does
  not dispatch until each drafted criterion is decided.** The launch sheet already exists and
  already renders the packet; drafting prefills the same criteria form the manual path uses. Start
  Work is what is blocked, not the task.
- **D-12:** **"No criteria" means zero current criteria *and* zero pending criterion drafts.** A
  pending draft counts as coverage, so reopening the launch sheet does not re-draft what is already
  waiting and the cap is not spent twice on one task. `list_current_criteria` plus a pending count,
  both existing reads.
- **D-13:** **A deliberate no-criteria start is allowed and recorded as an event.** An explicit
  "proceed without criteria" appends an event, so the escape hatch is *measurable* and sits beside
  the DRFT-11 number rather than hiding. Same philosophy as the hand-typed path field surviving as
  an escape hatch (D-19). Without it, a lint that refuses every draft would leave a task
  permanently unstartable.

### The open-drafts cap (DRFT-08, criterion 4)

- **D-14:** **The cap counts pending explicit-tier drafts per project** — criteria and file-sets.
  Provisional drafts confirm themselves at Start Work and cost no attention, so counting them would
  throttle drafting for work that was never queued on a human.
- **D-15:** **The cap is 30**, declared exactly once as a compile-time const and asserted by test,
  never a setting, never a `projects` column, never an env override (the D-69 house style, and
  A-05's own form). Roughly a six-task epic fully drafted; above the 1-of-42 datum's batch size and
  below the forty-in-one-sitting shape PITFALLS calls worst. **It is a first setting to instrument
  against, not a tuned one** — D-20's number is what argues for changing it.
  — **Reversibility:** reversible — one const and its test.
- **D-16:** **At the cap the drafting tool refuses with a named refusal and one event; the run
  continues.** This is `ProposalOutcome::LimitExhausted` and `proposal.limit_exhausted` reused for
  the project cap: the refusal **commits** (T-06-22 — a refusal is never a silent rollback) and the
  human-facing notice derives from the event on read, never a second stored copy. The run is not
  paused: `limit_gate.rs`'s own rule is that stopping in-flight work is not what a limit asks for.
- **D-17:** **Back-pressure is visible as a count-against-cap gauge on the project, plus the refusal
  in the run's own state.** The gauge is the leading indicator PITFALLS names first — open drafts
  rising faster than they are drained. Not added to the fleet rail (a pending todo has just flagged
  that rail's count semantics).

### File-sets: live scope and provenance (DRFT-01, F10, criterion 1)

- **D-18:** **The planner-declared file-set stays live at draft time, and plan approval is its
  explicit accept.** `approve_plan` already exists, already freezes `colliding_paths` and already
  gates dispatch — the file-set's accept is an act already being performed. Nothing is staged
  twice, and the draft period remains restrictive-only, which is what makes it safe. F10's "live
  before approval" concern is answered by naming the approval as the accept and fixing provenance,
  not by adding a staged twin that `declare_refusal`'s live-run guard would also have to grow.
- **D-19:** **Provenance is derived from the `task.file_set_declared` event's actor**, never stored
  — criterion 1's own wording, and A-07's precedent (one definition in code rather than a column
  for a derivable value). The event already carries `{field, before, after, label}` per change, so
  the chip and the history read from one source.
- **D-20:** **A chip editor for the drafted set, with the raw textarea retained and never
  prefilled.** Criterion 1 requires the hand-typed field to be "still there as the same form with
  no prefill — an escape hatch, not the path of record", and roadmap decision 2 puts "the file-set
  editor" in this phase. Both live in `WavePlanSheet.tsx` today. Per CLAUDE.md, any path
  autocomplete uses `git ls-files`, **not** a libgit2 blob walk (`git2` is not a dependency).
- **D-21:** **A file-set the planner cannot determine is declared `undeclared`, explicitly.**
  PITFALLS' confidence row: an undecidable set is "undeclared", not invented. An empty set and an
  undecidable one stop being the same thing, and the escape-hatch textarea is exactly where the
  human answers it. The task stays in the wave plan rather than dropping out through the
  skipped-task path.

### The lint (DRFT-02, criterion 2)

- **D-22:** **A draft that fails lint is refused with its named reason, so the agent can redraft in
  the same run.** Nothing persists. This is `file_set.rs`'s `EntryRefusal` discipline applied to
  text: it REJECTS, never repairs, because a repaired draft is a criterion nobody wrote. A refused
  draft therefore consumes neither the project cap (D-14 counts pending rows) nor the per-run cap
  (which counts inserted rows).
- **D-23:** **The lint runs in the core, inside `create_proposal_in_tx`, before the INSERT.** Every
  caller — authoring run, execution run, launch sheet — reaches that one statement site, so "a
  failing draft is never persisted" is a database-level fact a test can assert rather than a render
  condition. The refusal still travels back to the tool. A sidecar-boundary lint was rejected for
  leaving the core open-world, the exact hole Phase 13 spent itself closing.
  — **Reversibility:** costly — moving it later means re-proving the no-bypass property across
  every caller.
- **D-24:** **Judgement-only is derived: a NULL `verification_hint` IS the flag.** No schema change
  on the pinned spine, and the count is one query. Criterion 2's "stored flagged" is satisfied by
  the hint column itself being the storage (see A-08).
- **D-25:** **The same lint runs on human-typed criteria as a non-blocking warning.** One component,
  two sources — the same form, the same rules, but a human's text is never refused. The product
  tells you a criterion names no observable without overruling you; a blocking rule on your own
  input is how a gate gets disabled (D-20 of Phase 13's lesson).

### Stale drafts (criterion 3, last sentence)

- **D-26:** **A draft pins its parent's revision; accepting against a moved revision is refused with
  a diff of what changed underneath.** Reuses D-77's existing `revision` / `revision_of` /
  `superseded_at` counter rather than inventing a version token. The human then redrafts, or
  accepts the new state deliberately. A content hash of the draft's whole read-set was rejected as
  new machinery this phase does not need; the event sequence number was rejected because refusing
  on any board change at all makes the refusal routine, and a routine refusal is an ignored one.

### Instrumentation (DRFT-11, criterion 5)

- **D-27:** **The post-accept revision rate, and only that number, on the project beside the
  open-drafts gauge.** PITFALLS prevention 7 names it the outcome metric and says success is
  defined on it, not on criteria count. Accept-without-expand and time-to-accept were declined:
  both need UI interaction events that do not exist, which is the new telemetry the research argued
  against.
- **D-28:** **"Revised after acceptance" = a criterion revision or an in-place edit occurring after
  that item's accept event.** Both are the same signal from the owner's side, and both already
  exist in the log. Locked-revisions-only was rejected for missing every correction made before the
  first run, which is most of them; any-edit-to-any-field was rejected for counting ordinary
  shaping as a drafting failure.
- **D-29:** **The derivation is windowed to the last N accepted drafts, N declared once as a
  const** — the house style for every count in this codebase (D-69, Phase 13's 5+20 summary window,
  `EPIC_ROSTER_CEILING`). An all-time rate is both the unbounded-read shape Phase 13 closed and a
  number that stops moving once the denominator is large.

### No backfill (criterion 4)

- **D-30:** **A source gate asserts no drafting call site enumerates tasks.** PITFALLS prevention 8
  as a test rather than a convention: drafting entry points take one item id, and the gate fails if
  a drafting path ever reaches a list query. Two-sided — it also fails if the single-item path
  becomes unreachable. Types alone were judged necessary but not sufficient: nothing stops a future
  caller writing the loop one level up, which is where sweeps actually get added.

### The live proofs (DRFT-01, DRFT-12, criterion 6)

- **D-31:** **A session is deliberately driven into the subscription window limit**, on the demo
  board, to observe a real backend rejection. `limit_gate.rs`'s own header records that no hard
  limit has ever been observed and that `Rejected` is built from the documented shape against
  constructed fixtures. Catching one opportunistically was rejected: it would let a deferral satisfy
  an owner-verdict criterion, which is Pitfall 14 exactly. Cost: one window of subscription
  capacity. No API-key path is available or wanted — agents run on the developer's own Claude Code
  credentials.
  — **Reversibility:** one-way in the sense that it spends real capacity; the artifact it produces
  is permanent.
- **D-32:** **`Rejected` is the tier that must be seen.** It is the unexercised one and the one that
  pauses new dispatch. A `warning` observation does not close criterion 6.
- **D-33:** **A committed artifact plus a fixture derived from it.** The raw wire lines, the
  normalised tier, the run's state transition and the timestamps are committed in the phase
  directory (the credential-path artifact precedent), and the replay fixture is generated from the
  real bytes rather than from the documentation. The observation becomes permanent and the test
  stops being constructed.
- **D-34:** **The limit surfaces through `blocked` plus the existing `DispatchGateLine`.**
  `DispatchGateLine.tsx` and the `dispatch_gate` setting already exist, and `blocked` already sits
  in Phase 14's `needs-you` class. **No seventh state class** — Phase 14 capped the vocabulary at
  six deliberately (D-15/D-16 of 14) and Phase 18 owns the signal budget.

### Criterion amendments this discussion implies

Record these as owner decisions; each is a wording reading the discussion forced, not a scope
change:

- **A-08 (criterion 2):** "stored flagged judgement-only" is satisfied by **deriving** the flag from
  a NULL `verification_hint`. No new column on the pinned spine (D-24, and A-07's precedent).
- **A-09 (criterion 1):** the hand-typed path field is retained **alongside** a new chip editor —
  "the same form with no prefill" is read as *retained and unprefilled*, not as *the only editor*
  (D-20).
- **A-10 (D-95 superseded):** Phase 5's `accept_subtree` is **deleted**, not exempted. D-95's own
  reasoning (a root above the task level is a tray-wide accept-all wearing a different name)
  survives; criterion 3 extends it one level further down (D-06).
- **A-11 (criterion 4):** "no path exists that sweeps the board into drafts" is asserted by a source
  gate over drafting call sites, not by the cap alone (D-30).

### Claude's Discretion

- The lint's rule set and its wording: which verbs count as vague, how a compound is detected, what
  "names no observable" means operationally. The three named classes (compounds, vague verbs, no
  observable) are the floor.
- How `undeclared` is represented (D-21). Constraint: not a new column on a spine-pinned table —
  derive it, or carry it as an event and a submission field.
- The value of `N` in D-29's window, and the internal naming of the cap const, the lint module, the
  gauge component and the provenance chip.
- Whether the core-side DRFT-07 gate lives beside `proposal_no_promotion.rs` or in its own file
  (the repo's precedent cuts both ways — see 14-CONTEXT.md's own note).
- The diff presentation for a stale draft (D-26).
- Plan decomposition and sequencing. One hard ordering constraint: **the live planner measurement
  (DRFT-01) and the deliberate limit burn (D-31) are the two items that cannot be desk-settled, so
  they are scheduled early and in parallel, not as a tail.**

### Folded Todos

All four were reviewed and folded; each is load-bearing for a criterion this phase must prove live.

- **G-05-8: AskUserQuestion invisible and board unwritable in live run**
  (`.planning/todos/pending/2026-09-26-g-05-8-askuserquestion-invisible-and-board-unwritable-in-liv.md`,
  area: tooling, severity: **blocker**). The harness captures only `assistant_text`, so
  `AskUserQuestion` blocks never reach the evidence sheet and the driver answers them with "the user
  did not answer". Phase 15's drafting runs are live runs that ask questions — PITFALLS' confidence
  row ("the agent asks a question or declares unknown instead of inventing") is unjudgeable while
  this holds.
- **Adapter drops assistant text when a stream line carries text and tool_use**
  (`.planning/todos/pending/2026-09-24-adapter-drops-assistant-text-when-a-stream-line-carries-text.md`,
  area: general, severity: major). `claude-code-adapter.ts:589-612` returns from the `tool_use`
  branch before the text branch. Latent against the current binary's emission shape, and one
  upstream change away from the drafting feed showing tool calls with no narration.
- **Socratic challenge should be structured like GSD's questioning, not one wall of questions**
  (`.planning/todos/pending/2026-09-26-socratic-challenge-should-be-structured-like-gsd.md`,
  area: authoring, severity: major, `resolves_phase: 5.1`). `14-CONTEXT.md` already routed this
  here: "belongs with Phase 15/16's authoring work". Staged adaptive rounds, one focused question
  at a time, accumulating into a recorded artifact — the same shape D-11's launch-sheet drafting
  routing wants.
- **Live-chain tests inconsistently assert that the fake CLI was actually reached**
  (`.planning/todos/pending/2026-10-05-live-chain-tests-inconsistently-assert-the-fake-was-reached.md`,
  area: core). The instrument for DRFT-01's and DRFT-12's live proofs: a test that passes without
  reaching the CLI cannot prove a live measurement happened, and D-33's derived fixture depends on
  the chain being genuinely exercised.

</decisions>

<canonical_refs>
## Canonical References

**Downstream agents MUST read these before planning or implementing.**

### Phase scope and requirements
- `.planning/ROADMAP.md` § "Phase 15: Nothing Typed That An Agent Could Draft" — the goal, the six
  success criteria, the research flag, and roadmap decision 2 (why the drafting work split across
  13 and 15, and that "the file-set editor" is in this phase).
- `.planning/REQUIREMENTS.md` — DRFT-01/02/03/07/08/10/11/12 verbatim, plus the PLAN-01 and AGNT-05
  carry-forward rows and the "Deferred, not dropped" entries.
- `.planning/PROJECT.md` § "Key Decisions" — A-05 (per-run-kind proposal caps: execution 10,
  planning 30, authoring 60) and A-07 (no `agent_runs.kind` column; one definition in code) are the
  two rows this phase's caps and derivations build on.
- `CLAUDE.md` § "Technology Stack" — `git2`, `@monaco-editor/react` and `@xyflow/react` are **not**
  installed; path autocomplete must use `git ls-files`. The Agent SDK is not a dependency.

### Why this phase is shaped the way it is
- `.planning/research/v0.2.0/PITFALLS.md` § "Pitfall 1: Draft-and-accept becomes a review chore" —
  the nine assertable preventions this phase's decisions implement, the chore-side/assist-side
  table, and the named human-factors evidence (Ancker 2017, Vasconcelos CSCW 2023, the 93%
  permission-approval figure).
- `.planning/research/v0.2.0/PITFALLS.md` § 355 — the stale-draft failure D-26 answers.
- `.planning/research/v0.2.0/SUMMARY.md` § "Pre-existing defects no requirement covers" — F3 and
  F10 with their file references (`dispatch_plan.rs:1131`, `sidecar.rs:984-1001`).
- `.planning/research/v0.2.0/SUMMARY.md` § "Confidence and gaps" — the live-behaviour gaps this
  phase closes: the `--live` planner measurement, AGNT-05 never observed against a real limit, and
  "no measured acceptance behaviour exists; instrument first".

### Prior phase decisions this phase inherits
- `.planning/phases/13-nothing-new-escapes-the-fence/13-CONTEXT.md` § `<decisions>` — D-08/D-13
  (one status writer), D-14/D-16/D-17 (estimate dropped, priority opt-in through staging),
  D-18 (hand-made tasks created at `todo`; `backlog` means "proposed by an agent, not yet
  accepted"), D-19 (`StatusPicker` deleted), D-20..D-24 (the gate house style, two-sidedness).
- `.planning/phases/14-cycles-on-screen-state-in-colour/14-CONTEXT.md` § `<decisions>` — D-15/D-16
  (the six state classes and why task workflow statuses carry no colour), D-18 (four tokens per
  class), D-24/D-25/D-26 (the demo board seeded from Flywheel's own `.planning/`, a dev-only seeder
  writing its own DB), D-27/D-28 (scripted capture, manual verdict, a "no" loops back into the
  phase).
- `.planning/phases/14-cycles-on-screen-state-in-colour/14-CONTEXT.md` § "Known traps" — the
  `running`-row-with-no-live-process trap and the `brand-rule.test.ts` byte-read of
  `08.1-UI-SPEC.md`, both still live for any surface this phase adds.

### The drafting machinery as it exists
- `packages/core/src/domain/authoring_proposal.rs` — read the module header first: the staging
  contract, the five-value `status` vocabulary, `ProposalProvenance`, `proposal_limit` /
  `RunKind`, `ProposalOutcome::LimitExhausted`, and `accept_subtree` (deleted by D-06).
- `packages/core/src/domain/acceptance_criterion.rs` — `create_criterion_in_tx`,
  `revise_criterion`, `criteria_locked_for_task`, and D-77's `revision` / `revision_of` /
  `superseded_at` trio that D-26 and D-28 both read.
- `packages/core/src/domain/file_set.rs` and `packages/core/src/file_set.rs` —
  `declare_file_set_in_tx`, `declare_refusal`'s live-run guard, `EVENT_FILE_SET_DECLARED`, and
  `EntryRefusal`'s reject-never-repair discipline that D-22 copies.
- `packages/core/src/domain/dispatch_plan.rs` — `submit_plan`, `SubmittedTask`,
  `MAX_SUBMITTED_*` bounds, `edit_draft_plan`, `approve_plan` (D-18's accept) and
  `resolve_planning_run`.
- `packages/core/src/limit_gate.rs` — read the header: the gate never probes, writes no run status,
  and records that **no hard limit has ever been observed**. `LimitTier`, `LimitSignal`,
  `SETTING_DISPATCH_GATE`, `DISPATCH_REJECT_FLOOR_SECS`, `EVENT_DISPATCH_GATE_CHANGED`.
- `packages/core/src/db/migrations/0011_authoring_staging.sql` and
  `0015_proposal_triage_extension.sql` — the staging table's shape and the documented rebuild
  sequence, including `idx_authoring_proposals_parent`'s bulk-accept comment that D-06 rewrites.
- `packages/core/src/query/authoring.rs` — `proposal_limit_notices` and the derive-on-read pattern
  D-16 extends to the project cap.

### Surfaces touched
- `packages/desktop/src/dispatch/WavePlanSheet.tsx` — today's newline textarea; becomes D-20's chip
  editor plus retained escape hatch, with D-19's provenance chips.
- `packages/desktop/src/launch-sheet/LaunchSheet.tsx` — where D-11 routes criteria drafting.
- `packages/desktop/src/item-detail/AcceptanceCriteriaList.tsx` — the manual criteria form the
  drafted path must prefill rather than duplicate (D-02, D-25).
- `packages/desktop/src/authoring/ProposalTray.tsx`, `ProposalRow.tsx`, `ProposalAmendEditor.tsx` —
  the per-item accept/reject/amend surface the new draft kinds join.
- `packages/desktop/src/triage/TriageSurface.tsx` and its `__tests__` — D-104's two bulk controls
  and the source test D-08 extends.
- `packages/desktop/src/dispatch/DispatchGateLine.tsx` — D-34's limit surface.

### The gates
- `packages/core/tests/proposal_no_promotion.rs` — the closed-world no-promotion gate; the house
  style D-08's core-side test follows.
- `packages/core/tests/authoring_acceptance.rs`, `authoring_proposal.rs`,
  `proposal_triage_verbs.rs`, `authority_human_only.rs` — the existing acceptance-path corpus
  D-06's deletion and D-08's gate must both keep green.
- `packages/desktop/src/test` and `brand-rule.test.ts` — the `import.meta.glob('?raw')` + `code()`
  walk D-08's desktop side reuses.

</canonical_refs>

<code_context>
## Existing Code Insights

### Reusable Assets
- **`authoring_proposals` + `create_proposal_in_tx`** — the one staging write path, with identity
  resolved from the `agent_runs` row inside the transaction so a caller cannot attribute a proposal
  to a run it does not drive. D-23's lint hangs here; D-02's provisional tier lives here.
- **`ProposalOutcome::LimitExhausted` + `proposal.limit_exhausted` + `proposal_limit_notices`** —
  a refusal that commits, with its notice derived on read. D-16 reuses the whole shape for the
  project cap.
- **`EntryRefusal` (`file_set.rs`)** — a named-cause refusal rendered verbatim through `Display`,
  rejecting rather than repairing. The model for D-22's lint refusals.
- **D-77's revision trio** (`revision`, `revision_of`, `superseded_at`) — already in
  `acceptance_criteria`; D-26's pin and D-28's measurement both read it, no new column.
- **`approve_plan`** — freezes `colliding_paths` as stored JSON and appends one event per edge.
  D-18 names it the file-set's accept.
- **`task.file_set_declared`'s `{field, before, after, label}` payload** — the version history
  D-19's provenance chip derives from.
- **`sources_under()` / `is_whole_line_comment()` / `workspace_root()`** — the core-side source-gate
  trio, copied per file by this repo's precedent.
- **The demo seeder and `demo-board.sh`** (Phase 14, D-24/D-26) — the judging surface for criterion
  6's owner verdict, already seeded from Flywheel's own `.planning/`.
- **`status_derivation.rs`** — the one `tasks.status` writer. Nothing in this phase may add a
  second; D-13's "proceed without criteria" is an event, not a status.

### Established Patterns
- Fixed counts are declared **exactly once**, never parameterised, never config (D-69; Phase 13's
  5+20 window; A-05's `const fn`). D-15's cap and D-29's window both follow.
- Agents never write canonical rows; everything materialises through the canonical `*_in_tx`
  writers those tables own. D-03's confirm obeys this too.
- Source gates are integration tests with case-sensitive literal corpora, self-contained helpers
  copied rather than shared, and are **two-sided** — a false positive is as damaging as a false
  negative (Phase 12's key decision).
- A refusal always commits its event; a refusal is never a silent rollback (T-06-22).
- Derive rather than store when the log already holds the fact (A-07). D-19, D-24, D-27, D-28.
- Server/DB state lives only in React Query; UI state only in Zustand. Never blurred.
- Group-scoped CSS lives beside its group, never in `App.css`; no literal colour outside
  `styles/tokens.css`.

### Integration Points
- `create_proposal_in_tx` gains the lint (D-23) and the project-cap count (D-16) in the same
  transaction as its INSERT.
- The launch sheet gains the drafting route and the dispatch block (D-11, D-12, D-13).
- `WavePlanSheet.tsx` gains the chip editor and the provenance chips, keeps the textarea (D-20).
- The project surface gains the cap gauge and the revision-rate number, side by side (D-17, D-27).
- `materialise_proposal` loses its parent-proposal precondition for criteria (F3, D-10).
- `accept_subtree` and its tests are removed; `idx_authoring_proposals_parent` survives with a
  rewritten comment (D-06).
- Two new source gates join the corpus, one per side (D-08), plus the no-enumeration gate (D-30).

### Known traps
- **`subtree` becomes a forbidden word.** Nothing may name the concept in any identifier after D-06
  — including in the index comment that currently justifies it.
- **The provisional tier must never touch an explicit-tier field**, or D-07's "no exemption needed"
  stops being true and the gate has to grow one.
- **A refused draft must not consume either cap** — the project cap counts pending rows, the per-run
  cap counts inserted rows, and a lint refusal inserts nothing. Assert it.
- **A `running` `agent_runs` row on the demo board has no live process behind it** (14's D-25). The
  deliberate limit burn (D-31) runs against the real backend, not the demo rows.
- **The 900-task board is the backfill hazard.** Every drafting entry point takes one item id
  (D-30), and the existing board is proof of what a sweep would cost: zero criteria on every task
  with a worktree, 15 criteria across 907 tasks.

</code_context>

<specifics>
## Specific Ideas

- **The two tiers are the whole design.** "No form a human fills that an agent could have drafted"
  does not mean "every field becomes an approval". The things an agent *executes against* —
  criteria and file-sets — are explicit; everything else lands and confirms itself when you start
  the work. The chore/assist line in PITFALLS is drawn exactly there.
- **Criteria arrive when you reach the task, not when the epic is decomposed.** Five decisions at
  the moment you were already opening the task, rather than thirty at the moment you were admiring
  a decomposition. This is the single decision that keeps the engine off the chore side.
- **Plan approval was already the accept.** The file-set did not need a second staging lifecycle; it
  needed its existing one named out loud and its provenance derived from the actor who declared it.
- **The escape hatch stays, unprefilled.** The hand-typed path field and the "proceed without
  criteria" act are both deliberate escape hatches that *record themselves* — measurable rather
  than hidden, which is the same instinct as deriving the revision rate from the log.
- **Instrument first, tune after.** 30 and N are first settings with tests on them, not tuned
  values. The only product datum that exists is 1-of-42-amended, and it cannot tell good drafting
  from reflex acceptance — which is exactly why D-27 ships before any tuning argument.
- **The limit burn is a cost accepted on purpose.** `limit_gate.rs` has said "unobserved" in its own
  header since Phase 9. Spending one subscription window to delete that sentence is cheaper than
  carrying it into another milestone.

</specifics>

<deferred>
## Deferred Ideas

- **Timed undo after confirmation** — declined by D-04. A short window to take back a Start Work
  confirmation would catch the reflex accept directly; it adds a timer, a surface and a race with
  the agent that just started. Revisit only if D-27's number says reflex acceptance is real.
- **Accept-without-expand rate and time-to-accept** — declined by D-27. Both are named in PITFALLS
  prevention 7 and both need UI interaction events that do not exist. If the revision rate alone
  proves ambiguous, these are the next two, and they are new telemetry with a real cost.
- **Drafting the Cycle itself** — carried forward unresolved from `14-CONTEXT.md` ("the milestone's
  scope rule has an opinion, but drafting is Phase 15's engine"). This phase builds the engine for
  tasks, criteria and file-sets; pointing it at Cycle creation is a later, cheap follow-on and is
  in no criterion here.
- **An agent proposing which Cycle an epic belongs in (CONV-05)** — deferred at requirements time;
  an optional hint on an epic proposal remains the cheap route.
- **The since-you-left digest (CONV-06)** — deferred with a named trigger: **Phase 17 closing.**
  Pending drafts become one of its four inputs when this phase ships, but two more do not exist
  until 16 and 17 close.
- **A seventh state class for "limited"** — declined by D-34. Phase 14 capped the vocabulary at six
  deliberately; if the dispatch gate reads as too quiet on the demo board, it is a Phase 18
  signal-budget decision with the vocabulary already in place.
- **A stored `drafted_by` column and a stored `judgement_only` column** — both declined (D-19,
  D-24) in favour of derivation. Named here because each would be a spine rebuild if a future query
  genuinely needs to filter on them without the derivation, which is A-07's own accepted cost.

### Reviewed Todos (not folded)

Thirteen keyword matches were reviewed and left in the backlog. The five filed on 2026-10-16 are
Phase 14 follow-ups on the demo board and the state tokens; they bear on criterion 6's judging
surface and should be drained before the owner verdict, but they are Phase 14/18 work and folding
them here would import a visual-tuning tail into a drafting phase:

- App launch writes false `agent_run.abandoned` events into seeded runs (core)
- Demo board does not exercise `ci_failed`, `merged`, or the task-row proposal mark (core)
- `demo-board.sh` prefers a stale release binary over the current debug build (tooling)
- Demo seeder Cycle goals include the rest of the roadmap line (core)
- Epic rows draw no state, even an epic with a running agent (desktop)
- Rail "Needs decision" count is red beside the amber "Blocked" count (desktop)
- Dark `needs-you` wash is not visible inside the current contrast envelope (desktop)
- App shell content child has no `min-width: 0` (desktop)

And five that touch neither the drafting engine nor its live proofs:

- Handoff sheet drops questions the agent asked (tooling)
- Forge resolution failures are not memoised, so they retry per worktree every tick (desktop)
- Forge-sourced URLs reach an anchor href without scheme validation (desktop)
- Timeout-boundary race misreports a child that just finished as `TimedOut` (core)
- Subprocess timeout guard leaks reader threads under a sustained forge outage (core)

</deferred>

---

*Phase: 15-Nothing Typed That An Agent Could Draft*
*Context gathered: 2026-10-16*
