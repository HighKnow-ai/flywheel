# Phase 14: Cycles On Screen, State In Colour - Context

**Gathered:** 2026-10-15
**Status:** Ready for planning

<domain>
## Phase Boundary

Two things, on one surface, judged together:

1. **The Cycle record and its region.** A scope-boxed, undated grouping layer above `epics`. The
   current Cycle's goal, ordering and progress, plus the roadmap ahead of it, visible without
   navigating. Progress folded from the real task counts of every epic in the Cycle — never the
   200-row paged window, never a stored percentage. Closing a Cycle asks per unfinished epic. A
   Cycle whose scope changed after it started says so.
2. **The state-colour vocabulary.** One component that is the only consumer of the `--state-*`
   tokens, always carrying a glyph and a word or accessible name beside the colour; CVD-safe,
   per-mode contrast-checked against the shipped stylesheet bytes, forced-colors-safe. The
   decision that introduces saturated state colour supersedes D-11 by name, and the specification,
   the brand allowlist and the tests that enforce them are amended in the same change.

Plus two things that are **success criteria, not tasks**: a seeded demonstration board carrying
every state live at realistic density, and the owner's verdict on the BUILT application with a
screenshot. Adopting a comp cannot satisfy either, and neither may be deferred.

Requirements: RECD-08, RECD-09, RECD-10, VIS-01, VIS-02, VIS-03, VIS-04, VIS-06, VIS-07.

**Explicitly NOT this phase.** VIS-05 and VIS-08 are Phase 18: the values, the dark-first switch,
the signal budget and a final per-surface verdict once the IA exists (roadmap decision 3, the
W7a/W7b split). Phase 14 takes the vocabulary and the structure. The PRD, ADR, drafting and review
layers are phases 15–17 and must not leak in.

</domain>

<decisions>
## Implementation Decisions

### The Cycle region (RECD-09)

- **D-01:** The region is a **non-virtualized sticky region at the top of the board surface**,
  above the five status bands — not app chrome, not a new `UiSurface` member. It satisfies
  "without navigating" literally, leaves `BoardView`'s O(1) `ROW_HEIGHT_BY_KIND` `estimateSize`
  lookup untouched by staying outside the virtualizer, and it is the only placement where the
  Cycle, the epic roster and the tasks read as three levels of one visual hierarchy — which is
  what the hierarchy statement has to assert.
  — **Reversibility:** reversible — a region component and its mount point; nothing persists it.
  - *A full-pane `cycles` surface was rejected on criterion 1's own text: "routes to it" IS
    navigating. App chrome was rejected because the fleet surface is cross-project and the session
    surface is one task deep, so it would need per-surface suppression — a nested conditional
    outside the surface model FNC-06 just cleaned up.*
- **D-02:** The region shows the **current Cycle expanded** (goal, progress, counts) and **every
  later Cycle as a single line** (goal, epic count). Bounded by a ceiling far above any realistic
  roster plus a `truncated` fact the renderer MUST print — the exact `EPIC_ROSTER_CEILING` /
  `EpicRoster::truncated` shape (D-87), which exists because a silent cap reintroduced G-01-2.
  No second windowing rule is invented.
- **D-03:** **The epic roster keeps the hierarchy lead; the Cycle region orients.** The three
  levels of the written hierarchy statement are *internal to the region*: current Cycle goal and
  progress loud, later Cycles quiet, nothing else competing. The roster keeps the weight because
  that is where work is driven. *(This is the owner's recorded direction — "epic roster leads,
  progress + roadmap always visible" are two separate things. A region that leads the whole
  surface was considered and declined; so was making the progress figure the single focal element,
  because criterion 1 asks for the goal to be seen too.)*
- **D-04:** The hierarchy statement is **written before the visual work** and the built region is
  judged against it (criterion 5). It is a phase artifact, not a sentence in a plan.

### The Cycle schema and lifecycle (RECD-08, RECD-10, criteria 1 and 2)

- **D-05:** A Cycle carries a **`state` column: `planned` / `active` / `closed`**, with **at most
  one `active` per project** enforced by a partial unique index. One column does three jobs the
  phase needs: it names the current Cycle (the `active` one), it gives "after it started" a
  meaning without a date (the transition into `active`), and it gives the close something to
  transition to. Starting a Cycle is a **human-only FNC-03 authority act**.
  — **Reversibility:** one-way — it is a column on a table the same phase pins in `spine_pin.rs`;
  removing it is another rebuild.
  - *Deriving "current" from rank order was rejected because "after it started" then has no
    moment. A `projects.current_cycle_id` pointer was rejected outright: it adds a reference TO the
    cycle table, violating criterion 2's "no other table references it" and breaking the
    `spine_pin` assertion this phase exists to add.*
- **D-06:** **One `exit_criteria TEXT` column** satisfies RECD-08's exit criteria in v0.2.0.
  CONV-02 (exit criteria as checkable items) stays v0.2.x and later becomes a migration onto the
  existing `acceptance_criteria` mechanism rather than a new concept. Reusing
  `acceptance_criteria` now was rejected: it is deferred scope, it adds a reference to the cycle
  table, and it would pull RECD-04's anchor-survival question two phases early.
- **D-07:** **"Scope changed after it started" is derived from the event log** — an epic's cycle
  assignment/removal event timestamped after the Cycle's own transition-to-`active` event. No
  column, nothing to keep in sync, nothing added to the allowlist, and it uses the append-only
  `events` table that is already the store of record (DATA-01). It catches a **swap** (one epic
  out, one in) which a baseline count cannot, and the row can say the true sentence: *"2 epics
  added, 1 removed since this Cycle started."*
  - *A `baseline_epic_count` column and a `scope_changed` flag were both rejected: a stored number
    that can disagree with the board is the shape Phase 13 spent itself removing, and a flag can
    never say WHAT changed.*
- **D-08:** **Progress is folded, never stored.** The fold reads every task of every epic in the
  Cycle, in the `board_epic_progress` style — three grouped reads with no row window and no
  ordering — and must match a full count over a 900+ task board. There is no percentage column.
- **D-09 (criterion 2's owed assertion):** `epics.cycle_id` lands in this phase, which **fails
  `spine_pin.rs::the_parent_chain_above_epics_is_pinned` the moment it is added** — by design
  (Phase 13 wrote that test for exactly this). The two remaining halves are added beside it here:
  the cycle table has **no parent**, and **no other table references it**.
- **D-10:** An epic belongs to **at most one Cycle**; Cycles **never nest**; a Cycle holds epics
  scope-boxed and undated. No date, duration, capacity or velocity column exists anywhere in the
  schema or the UI.

### Closing a Cycle (RECD-10)

- **D-11:** The close asks **per unfinished epic**, offering **three dispositions**: move to a
  named later Cycle / return to no Cycle / leave it in this closed Cycle. There is **no
  "apply to all" control and no pre-selected default** — DRFT-07 makes the item the unit of
  acceptance for a structure and says no control anywhere accepts a set wholesale, enforced by a
  source test. A pre-selected default on every row is a bulk accept wearing per-item clothing.
- **D-12 (naming trap, act on this):** The code may **never** name this `rollover` — it is one of
  the ten words in `FORBIDDEN_PM_WORDS` (`pm_vocabulary_gate.rs:72`), and A-06 made the gate match
  a corpus word used as an identifier component, so `rolloverTarget` fails the build too.

### Epic status (folded todo, resolves_phase: 14)

- **D-13:** **Epic status is derived from its tasks**, extending D-08's one-writer stance one level
  up: `in_progress` if any task is, `in_review` when every task is in review or done, `done` when
  all are done, `todo`/`backlog` otherwise, under the **same forward-only floor** (A-03). This
  closes the gap plan 13-07 left when it deleted `StatusPicker.tsx` — epic status is currently
  *frozen*, with no writer in the renderer at all.
  — **Reversibility:** costly — reversing it means re-arguing D-08 and A-03 one level up, and
  re-introducing a human control the same change deletes.
- **D-14 (companion todo):** `epic_set_status` is **unregistered** from the `generate_handler!`
  roster, and `task_set_status` with it. The **13-04 handler-roster test is updated in the same
  diff** — it pins the command count exactly, in both directions. This closes criterion 3 of
  Phase 13 *in structure*, not only in practice.

### The state vocabulary (VIS-01, VIS-02, VIS-03, VIS-04)

- **D-15:** The **saturated classes are defined by meaning, then enumerated** — criterion 3's six
  are the floor, not the ceiling:
  - **needs-you** — blocked, awaiting review, abandoned, needs-decision, proposals pending
  - **running**
  - **failed** — failed, CI failed
  - **merged**
  - **quiet** — completed, interrupted (glyph + word + muted ink, no saturation)

  `abandoned` and `needs-decision` are saturated because `bandForState` already groups abandoned
  with blocked in the fleet's NEEDS YOU band; the band header and the colour would otherwise teach
  different things, and abandoned (a session that died unsupervised) is the case most likely to be
  missed. Reusing the `failed` role for `abandoned` was declined: an unsupervised session is not
  an error.
- **D-16:** **The five task workflow statuses keep no colour.** D-11's reasoning survives where it
  was right — a backlog row is not a signal — and is superseded only where it was wrong: a blocked
  agent is. This is the smallest token set and the cleanest gate, and it keeps the largest, loudest
  visual change (re-colouring every board row) out of a phase whose signal budget is Phase 18's job.
- **D-17:** **`RUN_STATUS_COLOR_ROLES` is deleted.** Every run state renders *through* the new
  component; the out-of-six states map to the single quiet class. One vocabulary, one consumer, no
  gate holes, and `legend/runStatus.ts`'s entry in the `brand-rule.test.ts` allowlist retires.
  — **Reversibility:** costly — the undo touches `RunsSection.tsx`, `FleetSurface.tsx`,
  `SessionSurface.tsx`, `OrphanRecoveryModal.tsx` and the brand allowlist together.
  - *Keeping it for the out-of-six states was rejected: `completed` in success green beside a new
    saturated `merged` token is the confusion the single-component rule exists to prevent.*
- **D-18:** **Four tokens per class: `text` · `wash` · `edge` · `mark`** — one per way the product
  actually draws. Mirrors the existing `accentTextRack` / `accentNontext` precedent, which exists
  because a destructive FILL fails AA (2.95:1 light, 2.86:1 dark) and so an action is DRAWN on a
  3:1 edge rather than filled. `mark` carries its own 3:1 non-text floor instead of borrowing the
  text role. `edge` is a full 1px boundary, **never** a 2px side stripe — the craft floor's
  side-border ban is asserted by `brand-rule.test.ts` and A-06 reserves the 2px side rule for
  selection.
- **D-19:** `merged` and `awaiting review` are **registered in `legend/marks.ts`** — no mark may
  exist that the legend does not define, and `Legend.tsx` renders exactly that array.
- **D-20:** The superseding decision **names D-11 in a SUPERSEDES table**, and the specification,
  the brand allowlist (`brand-rule.test.ts`'s `BRAND_USES` + the `USE` spec phrases) and the tests
  are amended **in the same change** (criterion 4, VIS-02). The allowlist test fails in both
  directions, so widening the code without widening the document is a failing test.

### The gates (criterion 1, criterion 3)

- **D-21:** The Cycle's exact column allowlist is enforced **two ways, both existing**: the
  `cycles` DDL joins `spine_pin.rs`'s pinned set, so **any** added column fails regardless of its
  name; **and** `"sql"` is added to `SCANNED_EXTENSIONS` in `pm_vocabulary_gate.rs`. Verified
  during this discussion: the ten-word corpus has **zero hits across every existing migration**,
  so this is the one-token edit `13-CONTEXT.md` said it would be. It closes the hole PROJECT.md
  **A-06** named by hand — *"a Phase 14 `cycles` table with a `sprint_length_days` column passes
  the spine pin, table classification and the PM gate today."*
- **D-22:** `cycles` is added to `TABLE_CLASSES` in `schema_classification.rs` as
  **`TableClass::Canonical`** with its reason — the closed-world test fails in both directions, so
  the table cannot reach the database unclassified.
- **D-23:** Every gate change here is **two-sided** (the Phase 12 key decision, carried by D-24 of
  Phase 13): a check that fails if the gate decides something it cannot justify, *and* a check
  that fails if a legitimate path becomes blocked.

### The demonstration board (VIS-06, criterion 5)

- **D-24:** **Seeded from Flywheel's own `.planning/`** — Cycles from the v0.2.0 milestone's
  phases, epics from the roadmap's phase entries, tasks from the `PLAN.md` files, issues from
  `.planning/todos/pending/`. Criterion 5's *"its lead row is real work, not a junk epic"* is then
  satisfied **by construction**, not by naming a fixture carefully. It is also self-demonstrating:
  the surface is judged against the work actually being done on it.
- **D-25:** The runtime states `.planning/` cannot provide are **synthesised on top**: `agent_runs`
  in running / blocked / failed / completed / abandoned, staged `authoring_proposals`, change flags
  and a merged branch, written directly over the real structure. Deterministic, free, re-runnable,
  and every state class is guaranteed present — which is what makes it a fair judging surface.
  - **Planning note:** a `running` row with **no live process** must not make the session surface
    try to attach to one. Name this as a task-level concern, not a discovered bug.
  - *Running real agents was declined: it spends credentials, failed and abandoned are hard to
    produce on demand, and the board would change under the owner while he judges a visual
    direction on it.*
- **D-26:** It loads as a **dev-only seeder binary writing a separate DB** at a known path, which
  the app opens through the existing DB-path mechanism. Nothing ships in the product, no new IPC
  command (the phase is *pruning* that roster, D-14), and it **cannot touch the real board**
  because it writes its own file. `perf_seed_1000.rs` is the precedent for seeding at volume.
  - *A dev-only Tauri command was rejected for adding to the roster this phase prunes and for
    writing to the real database. A checked-in `.sql` fixture was rejected because it duplicates
    the schema by hand and rots on the next migration — and `.sql` is about to be scanned (D-21).*

### The owner verdict (VIS-07, criterion 6)

- **D-27:** **Scripted capture, manual verdict, both committed.** A script launches the app on the
  demo DB and captures the region, so the only manual step is the owner's yes/no and his words —
  recorded in `14-OWNER-VERDICT.md` in the phase directory with the PNG committed beside it. This
  matches the owner's standing preference for automating verification down to the judgement itself.
- **D-28:** **A "no" loops back into this phase's tuning, never forward to Phase 18.** Criterion 6
  says it cannot be deferred to a later phase, and criterion 5 says adopting a comp or a direction
  document does not satisfy it.

### Claude's Discretion

- The **CVD simulation method and threshold** — which matrix (Brettel / Viénot / Machado), what
  distinguishability metric and floor. Nothing in the tree simulates CVD today and no dependency
  is installed for it; the matrices are small enough not to need one. The roadmap's research flag
  says the *values* are a design artifact of this phase, tuned on the demo board.
- Whether the state-token source gate **extends `brand-rule.test.ts`** or lands as a sibling test.
  The repo's precedent cuts both ways: `brand-rule.test.ts` already walks every production source
  through `import.meta.glob(..., '?raw')`, and the core's gates are deliberately self-contained
  per-file copies (D-23 of Phase 13).
- The **forced-colors fallback shape**. Nothing in the tree handles `forced-colors` today.
- Column names, the Cycle's ordering mechanism (`ranking.rs`'s fractional ranks are the obvious
  reuse — `rank_after` / `rank_before` / `rank_between`), event type names, and the internal naming
  of the state component and its token classes.
- How a Cycle is **created** (the milestone's scope rule has an opinion: no form a human fills that
  an agent could have drafted), and whether a closed Cycle can be **reopened**. Both left open.
- Plan decomposition and the sequencing of the schema work against the token work. Note the one
  hard ordering constraint: criterion 5's hierarchy statement and demo board must exist **before**
  the visual work, not after it.

### Folded Todos

Both carry `resolves_phase: 14` explicitly.

- **Epic status has no writer after StatusPicker deletion**
  (`.planning/todos/pending/2026-10-15-epic-status-has-no-writer-after-statuspicker-deletion.md`,
  area: desktop, severity: major). Plan 13-07 deleted `StatusPicker.tsx` to satisfy DRFT-04, but
  the picker moved **epics as well as tasks** and DRFT-04 is scoped to tasks. Nothing in the
  renderer can change an epic's status today. Filed rather than fixed because the aggregation rule
  was an unmade product decision and epics had no surface to judge it against — Phase 14 builds
  that surface. **Resolved by D-13.** Note it sits behind a requirement marked *complete*, so
  requirement traceability will not surface it; this todo and this context are the only record.
- **`task_set_status` and `epic_set_status` remain IPC-reachable with no caller**
  (`.planning/todos/pending/2026-10-15-task-and-epic-set-status-remain-ipc-reachable.md`,
  area: desktop, severity: minor). Still registered Tauri commands with no caller — the path is
  unused, not absent, so Phase 13 criterion 3 is satisfied in practice and not in structure.
  **Resolved by D-14**, which is why it was deferred here: the pair had to be decided together so
  the 13-04 roster gate is edited once.

</decisions>

<canonical_refs>
## Canonical References

**Downstream agents MUST read these before planning or implementing.**

### Phase scope and requirements
- `.planning/ROADMAP.md` §"Phase 14: Cycles On Screen, State In Colour" — the goal, six success
  criteria, the research flag (**No** for code paths), and the UI hint
- `.planning/ROADMAP.md` §"Decisions this roadmap makes" item 3 — the VIS 14/18 split (W7a/W7b):
  what Phase 14 takes and what Phase 18 takes. Also §"Pitfall placement" rows for pitfalls 3, 7
  and 9, and §"Why Phase 14 is written the way it is"
- `.planning/REQUIREMENTS.md` §"Records: PRD, ADR and Cycle" (RECD-08, 09, 10), §"Visual direction"
  (VIS-01…08), §"Scope rule", §"Out of Scope", §"Decisions taken at requirements time" (notably
  decisions 1, 2, 9 and 13), §"v0.2.x and later" (CONV-02, CONV-04, CONV-05)
- `.planning/PROJECT.md` §"Key Decisions" — **A-03** (the forward-only floor, which D-13 extends),
  **A-06** (the `.sql`-unscanned hole this phase closes, D-21), and the D-12 brand decision
- `.planning/phases/13-nothing-new-escapes-the-fence/13-CONTEXT.md` — D-08…D-13 (derived status,
  the floor, the one writer), D-19 (`StatusPicker` deleted, which is why the epic todo exists),
  D-20…D-24 (gate house style, two-sided acceptance), and its deferred note that *"a 'why is this
  status' explainer on the card is a Phase 14 surface question"*
- `.planning/research/v0.2.0/PITFALLS.md` — **pitfall 3** (the redesign still does not change the
  feeling), **pitfall 7** (the Cycle layer drags in the PM long tail), **pitfall 9** (dark-mode and
  colour-as-signal failures)
- `.planning/v0.1.0-MILESTONE-AUDIT.md` and the archived `08.1` phase — the diagnosis Phase 14 is
  written against: comps judged on FIXTURE rows with a lead epic named `test`, all-mechanical
  must-haves, and SC0 (the one perceptual criterion) deferred

### The visual specification and its gates
- `.planning/phases/08.1-visual-polish-brand-assets-and-confirmed-motion-inserted/08.1-UI-SPEC.md`
  §"The brand rule (D-12), and the rule it replaced" — **read as bytes by
  `brand-rule.test.ts`**; the allowlist test fails if the code widens without the document
- `packages/desktop/src/theme/__tests__/brand-rule.test.ts` — `BRAND_USES`, the `USE` spec-phrase
  map, the `import.meta.glob('?raw')` walk, and the no-coloured-side-border assertion
- `packages/desktop/src/theme/__tests__/contrast.test.ts` — `TEXT_ROLES` × `SURFACES` × `MODES`,
  parsed from the **shipped stylesheet bytes** block by block; the enumeration criterion 3 extends
  with every state wash
- `packages/desktop/src/theme/contrast.ts` — WCAG relative luminance and contrast ratio
- `packages/desktop/src/theme/tokens.ts` — the typed per-mode `Palette` mirror; a role declared in
  one mode and not the other does not typecheck
- `packages/desktop/src/styles/tokens.css` — the one source of colour; the dark block is found by
  `DARK_BLOCK_START` in the contrast test
- `packages/desktop/src/styles/states-and-confirms.css` — the existing `.state-*` CSS **class**
  namespace (a naming collision to avoid with the new `--state-*` **token** namespace)

### The state vocabulary's current home
- `packages/desktop/src/legend/marks.ts` — `MARKS`, `MARKS_BY_ID`, `STATUS_MARKS`,
  `statusMarkId` / `statusValueFromMarkId`, `actorTypeMarkId`. The single registry; `merged` and
  `awaiting review` are registered here (D-19)
- `packages/desktop/src/legend/runStatus.ts` — `RUN_STATUS_LABELS`, `RUN_STATUS_MARK_IDS`,
  **`RUN_STATUS_COLOR_ROLES` (deleted by D-17)**, `FleetState`, `FLEET_BANDS`, `bandForState`
  (which already groups `abandoned` with `blocked` — the reason for D-15)
- `packages/desktop/src/legend/Legend.tsx` — renders exactly `MARKS`, never a second list
- Current colour consumers to rewire: `packages/desktop/src/item-detail/RunsSection.tsx`,
  `packages/desktop/src/fleet/FleetSurface.tsx`,
  `packages/desktop/src/session/SessionSurface.tsx`,
  `packages/desktop/src/recovery/OrphanRecoveryModal.tsx`,
  `packages/desktop/src/board/BoardRow.tsx`

### The region's integration points
- `packages/desktop/src/board/BoardView.tsx` — the virtualized rack, `ROW_HEIGHT_BY_KIND`, the
  O(1) `estimateSize` lookup (08.1 amendment A-03, no `measureElement`), the keyboard/layer
  dispatch through `state/keyboard.ts`
- `packages/desktop/src/board/EpicHeaderRow.tsx` — the roster row the hierarchy statement is
  written against (D-03): progress bar, printed fraction, the `STRIP_ORDER` distribution strip, and
  D-06's honesty rule ("no criteria yet" rather than a percentage that lies)
- `packages/desktop/src/state/keyboard.ts` — the `UiSurface` union and `activeSurface` precedence
  resolver (FNC-06, plan 13-08). D-01 adds **no** member to this union
- `packages/desktop/src/state/uiStore.ts` — the Zustand layer stack; server/DB state stays in React
  Query only
- `packages/desktop/src/board/useBoardQuery.ts` and `useBoardChangedInvalidation.ts` — the reader
  side of FNC-07's targeted `board:changed` payload

### The data layer
- `packages/core/src/query/epic_progress.rs` — **`board_epic_progress`**: three grouped reads over
  every task in the project, folded in Rust, deliberately no row window and no ordering because the
  board's unscoped list is a 200-row page over 920 real rows (RESEARCH Correction 3). The exact
  pattern the Cycle fold copies (D-08)
- `packages/core/src/domain/epic.rs` — `EpicSummary`, `EpicRoster`, `list_epics`,
  **`EPIC_ROSTER_CEILING`** and the `truncated` contract (D-87/D-16) that D-02 reuses; also
  `create_epic_in_tx` and `set_epic_status`
- `packages/core/src/db/migrations/0002_board_schema.sql` — the spine the `cycles` migration sits
  above; `epics.cycle_id` lands here
- `packages/core/src/ranking.rs` — `rank_after` / `rank_before` / `rank_between`, the fractional
  rank the Cycle ordering reuses
- `packages/core/src/query/mod.rs` — `ORDER_BY`, `status_sort_key`, the `DEFAULT_LIMIT`/200-row
  window the Cycle fold must NOT read through
- `packages/core/src/status_derivation.rs` — the task deriver D-13 extends one level up
- `packages/core/src/schema_classification.rs` — `TABLE_CLASSES` and `TableClass`; `cycles` is
  added as `Canonical` (D-22). Note its comment on `epics`: *"the top of the spine"*
- `packages/core/src/domain/event.rs` — `append_event` / `next_sequence`, the append-only log D-07
  derives scope drift from

### The gates this phase edits
- `packages/core/tests/spine_pin.rs` — the pinned DDL consts and
  **`the_parent_chain_above_epics_is_pinned`**, written by Phase 13 to fail the moment
  `epics.cycle_id` is added. Its doc comment states exactly what D-09 owes
- `packages/core/tests/pm_vocabulary_gate.rs` — `FORBIDDEN_PM_WORDS` (:72, including **`rollover`**
  — see D-12), `IDIOM_EXCLUSIONS`, `SCANNED_EXTENSIONS` (:41, the one-token edit of D-21),
  `SCAN_ROOTS` (:149), `has_word_prefix_at_boundary` (A-06's identifier-component matching)
- `packages/core/tests/table_classification.rs` — the closed-world `sqlite_master` check,
  failing in both directions
- `packages/core/tests/no_agent_status_write.rs` — the source gate that asserts the absence of
  source-level status writes but does **not** close the IPC surface (the reason for D-14)
- `packages/desktop/src-tauri/src/main.rs` — the `generate_handler!` roster and the 13-04 test that
  pins its command count exactly, in both directions (D-14)
- `packages/core/tests/perf_seed_1000.rs` — the precedent for seeding at volume (D-26)
- `packages/core/tests/epic_progress.rs`, `epic_roster.rs`, `hierarchy_workflow.rs`,
  `status_derivation.rs` — the existing assertions the Cycle layer must not break

### Folded todos
- `.planning/todos/pending/2026-10-15-epic-status-has-no-writer-after-statuspicker-deletion.md`
- `.planning/todos/pending/2026-10-15-task-and-epic-set-status-remain-ipc-reachable.md`

</canonical_refs>

<code_context>
## Existing Code Insights

### Reusable Assets
- **`board_epic_progress`** (`query/epic_progress.rs`) — three grouped reads, no window, no
  ordering, folded in Rust, with a `bail!` that names truncation rather than returning a short
  list. The Cycle fold is the same shape one level up.
- **`EPIC_ROSTER_CEILING` + `EpicRoster::truncated`** — the bounded-read pattern with a fact the
  caller must render. D-02 copies it rather than inventing a second windowing rule.
- **`ranking.rs`** (`rank_after` / `rank_before` / `rank_between`) — the Cycle's ordering.
- **`legend/marks.ts` + `Legend.tsx`** — the published registry and its single renderer. New marks
  append here; nothing invents an undocumented glyph.
- **`theme/contrast.ts` + `contrast.test.ts`'s stylesheet-byte parser** (`declarations()`,
  `driftErrors()`, `DARK_BLOCK_START`) — already does per-mode parsing of the shipped CSS. The
  state washes extend `SURFACES`; nothing new is needed to read the bytes.
- **`brand-rule.test.ts`'s `import.meta.glob('?raw')` walk + `code()` comment stripper** — the
  working shape for a desktop-side source gate over every production file.
- **`status_derivation.rs`** and the forward-only floor — D-13 extends it to epics.
- **`sources_under()` / `is_whole_line_comment()` / `workspace_root()`** — the core-side source
  gate helper trio, copied per file by this repo's precedent.
- **`authoring_proposals` staging** — where the demo board's pending proposals come from (D-25).

### Established Patterns
- Fixed counts are declared **exactly once** and never parameterised, never config (D-69, and
  Phase 13's 5+20 summary window). Any ceiling this phase adds follows that.
- Source gates are integration tests with case-sensitive literal corpora, self-contained helpers
  copied rather than shared, and an explicit allowlist const where unavoidable. They are **two
  sided**: a false positive is as damaging as a false negative (Phase 12).
- Colour is a **data channel only** (D-11, `EpicHeaderRow.tsx`'s header comment) — which is
  precisely what D-20 supersedes, by name, with its SUPERSEDES table.
- No literal colour, scrim or shadow appears in any component or group stylesheet;
  `styles/tokens.css` is the one source.
- Actions are **drawn on a 3:1 control edge, never filled** — a destructive fill fails AA. This is
  why `mark` is its own token role (D-18).
- Server/DB state lives only in React Query; UI state only in Zustand. Never blurred.
- Group-scoped CSS lives beside its group (`review/review.css`, `session/session.css`,
  `styles/admin-surfaces.css`), never added to `App.css`.

### Integration Points
- The sticky region mounts in `BoardView.tsx` **outside** the virtualizer, the way `TriageLane` and
  `IssuesLane` sit relative to the bands.
- `state/keyboard.ts`'s `UiSurface` union gains **no** member (D-01); the region registers its own
  bindings via `useRegionBindings(...)` if it needs any.
- `epics.cycle_id` is the one FK added; `spine_pin.rs` fails until the pinned DDL is edited in the
  same diff.
- `schema_classification.rs::TABLE_CLASSES` and `table_classification.rs` both gain `cycles`.
- `main.rs`'s `generate_handler!` roster **shrinks** by two (D-14) and its count test moves with it.
- The new `--state-*` block in `styles/tokens.css` plus its typed mirror in `theme/tokens.ts`
  (a role declared in one mode and not the other does not typecheck).

### Known traps
- **`rollover` is a forbidden word.** The close disposition must never be named it, in any
  identifier, including compounds (A-06).
- **`.state-*` CSS classes already exist** in `states-and-confirms.css` for the empty/error
  surfaces. The new `--state-*` **tokens** are a different namespace; don't let a gate regex
  conflate them.
- A `running` `agent_runs` row on the demo board has **no live process** behind it (D-25).
- `brand-rule.test.ts` reads `08.1-UI-SPEC.md` **as bytes** from `.planning/`, with an archive
  fallback — a missing spec FAILS rather than skips. Amending the brand allowlist means amending
  that document's § "The brand rule" in the same diff.

</code_context>

<specifics>
## Specific Ideas

- **The demo board is Flywheel's own roadmap.** Not a plausible fixture — this milestone, these
  six phases, these epics, these pending todos as issues. The lead row is real work because it IS
  the work. It also means every future owner review of a new surface has a board worth looking at
  with zero setup, and that judging the surface and using the product are the same act.
- **The sentence the scope-drift row says must be a true sentence**, in the D-69 spirit:
  *"2 epics added, 1 removed since this Cycle started"* — arithmetic the owner can state out loud,
  never a badge he would have to reverse-engineer from behaviour.
- **Defining the saturated classes by meaning and then enumerating them** (D-15) is deliberate:
  the fleet's `bandForState` already encodes "what needs you", and a colour vocabulary derived from
  a different list than the band grouping is how the two drift apart.
- **The verdict is scripted up to the judgement.** The screenshot capture and the app launch are
  automated; the only human act is the yes/no and the words. That is the shape to reach for
  whenever a criterion needs a human.

</specifics>

<deferred>
## Deferred Ideas

- **VIS-05 and VIS-08** — the token *values*, the dark-first switch, the signal budget, and a final
  per-surface verdict. **Phase 18**, by roadmap decision 3. Phase 14 ships the vocabulary and the
  structure; tuning on the demo board produces the direction document's values as an artifact *of*
  this phase, but applying them across every surface is 18's job.
- **CONV-02: Cycle exit criteria as checkable items** — v0.2.x. D-06 ships one text slot now, and
  the later version is a migration onto `acceptance_criteria`, not a new concept.
- **CONV-05: an agent proposing which Cycle an epic belongs in** — deferred at requirements time.
  An optional hint on an epic proposal is the cheap later route.
- **CONV-06: the since-you-left digest and a single explained next action** — deferred with a
  **named trigger: Phase 17 closing**, when every input it would rank exists. RECD-09 (this phase)
  already delivers the half that is derivable today.
- **Agent-drafted Cycle creation** — the milestone's scope rule has an opinion ("no form a human
  fills that an agent could have drafted"), but drafting is Phase 15's engine. Left open here; a
  hand-authored Cycle is acceptable in 14.
- **Reopening a closed Cycle** — not decided. No criterion requires it.
- **A "why is this status" explainer on the card** (worktree present / request open / CI passed) —
  carried forward from `13-CONTEXT.md`, which called it "a Phase 14 surface question". Still a
  genuine idea, still not in any criterion, and the region this phase builds is already the answer
  to "where does the work stand". Left deferred.
- **Re-colouring the five task workflow statuses** — declined by D-16, not forgotten. If the board
  reads as too quiet once the state classes are tuned, it is a Phase 18 signal-budget decision with
  the vocabulary already in place.

### Reviewed Todos (not folded)

Nine keyword matches were reviewed and left in the backlog. None touches the Cycle layer, the state
vocabulary, the gates or the demo board, and the phase already carries two folded todos plus a
schema addition:

- Adapter drops assistant text when a stream line carries text and tool_use (general)
- G-05-8 AskUserQuestion invisible and board unwritable in live run (tooling)
- Socratic challenge should be structured like GSD's questioning, not one wall of questions
  (authoring) — belongs with Phase 15/16's authoring work
- Handoff sheet drops questions the agent asked (tooling)
- Forge resolution failures are not memoised, so they retry per worktree every tick (desktop)
- Forge-sourced URLs reach an anchor href without scheme validation (desktop)
- Live-chain tests inconsistently assert that the fake CLI was actually reached (core)
- Timeout-boundary race misreports a child that just finished as TimedOut (core)
- Subprocess timeout guard leaks reader threads under a sustained forge outage (core)

</deferred>

---

*Phase: 14-Cycles On Screen, State In Colour*
*Context gathered: 2026-10-15*
