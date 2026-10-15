# Phase 14: Cycles On Screen, State In Colour - Discussion Log

> **Audit trail only.** Do not use as input to planning, research, or execution agents.
> Decisions are captured in CONTEXT.md — this log preserves the alternatives considered.

**Date:** 2026-10-15
**Phase:** 14-Cycles On Screen, State In Colour
**Areas discussed:** Where the Cycle region lives, What counts as a "state", Cycle schema &
lifecycle, The demo board

---

## Where the Cycle region lives

### Q1 — Where does the Cycle + roadmap region live?

| Option | Description | Selected |
|--------|-------------|----------|
| Sticky region atop the board | Non-virtualized, above the five status bands, inside the board surface. Keeps `BoardView`'s O(1) `estimateSize` lookup untouched; the only placement where Cycle / roster / tasks read as three levels of one hierarchy | ✓ |
| Persistent strip in the app chrome | Visible on every surface. Strongest "always visible", but the fleet surface is cross-project and the session surface is one task deep, so it needs per-surface suppression — a nested conditional outside the FNC-06 surface model | |
| Its own full-pane surface | A new `cycles` member in the `UiSurface` union. Most room, but "routes to it" IS navigating — fails criterion 1 on its own text | |

**User's choice:** Sticky region atop the board (recommended)

### Q2 — How much of "the roadmap ahead" does the region show?

| Option | Description | Selected |
|--------|-------------|----------|
| Every later Cycle, one line each | Current expanded; every later Cycle one line. Bounded by a ceiling plus a `truncated` fact the renderer must print — the `EPIC_ROSTER_CEILING` / `EpicRoster::truncated` shape (D-87) | ✓ |
| A fixed count ahead | Current plus the next N, declared once as a const in the D-69 house style. Predictable height, but "the roadmap ahead" stops short of the roadmap | |
| Current and next only | Tightest region, strongest focus. Answers "what's next" rather than RECD-09's "the roadmap ahead of it" | |

**User's choice:** Every later Cycle, one line each (recommended)

### Q3 — What makes a Cycle "the current one"?

| Option | Description | Selected |
|--------|-------------|----------|
| A `state` column: planned/active/closed | One column names the current Cycle, gives "after it started" a meaning without a date, and gives the close a target. At most one `active` per project; starting it is a human FNC-03 act | ✓ |
| Derived from ordering | First non-closed Cycle in rank order; stored nowhere. But "after it started" then has no moment | |
| A pointer on `projects` | `projects.current_cycle_id`. Decouples current from ordering, but adds a reference TO the cycle table — violates criterion 2 and breaks the `spine_pin` assertion | |

**User's choice:** A `state` column: planned/active/closed (recommended)

### Q4 — What leads the hierarchy once the Cycle region is there?

| Option | Description | Selected |
|--------|-------------|----------|
| Epic roster still leads; Cycle orients | The three levels of the hierarchy statement are internal to the region: current Cycle goal + progress loud, later Cycles quiet. The roster keeps the weight because that is where work is driven | ✓ |
| The Cycle region leads | Region becomes the focal point of the whole surface. Straightest reading of the roadmap's "this region is the focal point", but demotes the roster 8.1 built around | |
| Progress alone is the focal element | One element leads: the folded progress figure. Calmest, pre-pays VIS-08, but "where the work stands" becomes a number without its sentence | |

**User's choice:** Epic roster still leads; Cycle orients (recommended)
**Notes:** Reflects the owner's recorded direction — "epic roster leads, progress + roadmap always
visible" are two separate things.

---

## What counts as a "state"

### Q1 — Which states does the single state component render?

| Option | Description | Selected |
|--------|-------------|----------|
| Criterion 3's six, as one closed vocabulary | running, blocked, failed, awaiting review, merged, proposals pending. Task statuses stay glyph + word with no colour — D-11 survives where it was right | ✓ |
| Every agent/run state plus the six | Also completed, interrupted, abandoned, CI failed, needs-decision, worktree states, scope refusals. Needed for "only consumer" to be literally true, otherwise the gate has holes to allowlist | |
| All of the above plus the five task statuses | Most literal reading of "every state on screen". Also the largest visual change and the one most likely to make the board loud | |

**User's choice:** Criterion 3's six, as one closed vocabulary (recommended)

### Q2 — What happens to the run states outside the six?

| Option | Description | Selected |
|--------|-------------|----------|
| Delete `RUN_STATUS_COLOR_ROLES`; one component, one quiet class | Every run state renders through the component; out-of-six map to one quiet class. One vocabulary, no gate holes, the brand-allowlist entry retires | ✓ |
| Keep it for the out-of-six states | Purely additive; smallest diff, nothing regresses. But two colour vocabularies coexist and `completed` green beside saturated `merged` is the confusion the rule prevents | |
| They lose colour, in place | Drop to glyph + word at existing render sites. Hardest deletion, but "rendered by the single component" then covers only six of the states on screen | |

**User's choice:** Delete `RUN_STATUS_COLOR_ROLES` (recommended)

### Q3 — `abandoned` and `needs-decision`: saturated or quiet?

| Option | Description | Selected |
|--------|-------------|----------|
| Saturated — the class is "needs you", not a literal list | Define classes by meaning, then enumerate. Criterion 3's six become the floor. `bandForState` already groups abandoned with blocked, so band and colour now agree | ✓ |
| Quiet — the six exactly, no more | Smallest colour budget. But a NEEDS YOU row with no colour beside a blocked row with colour teaches that band and colour mean different things | |
| Saturated, but as the failed class | `abandoned` already shares `--destructive-text-rack` with `failed`; zero new classes. But it colours a non-failure as a failure | |

**User's choice:** Saturated — the class is "needs you" (recommended)

### Q4 — What are the four tokens per state class?

| Option | Description | Selected |
|--------|-------------|----------|
| text · wash · edge · mark | One per way the product draws. Mirrors `accentTextRack`/`accentNontext`; `mark` carries its own 3:1 floor; `edge` is a full 1px boundary, never a 2px stripe | ✓ |
| text · wash · edge · on-wash text | The ink for a word on its own class's wash — where dark mode breaks. But non-text marks then borrow the text role | |
| text · wash-subtle · wash-strong · edge | Two tint levels for graded density. Doubles the surface tints the contrast enumeration covers and the CVD pair matrix | |

**User's choice:** text · wash · edge · mark (recommended)

---

## Cycle schema & lifecycle

### Q1 — What does the exit criteria slot look like in v0.2.0?

| Option | Description | Selected |
|--------|-------------|----------|
| One text slot now; checkable items in v0.2.x | One `exit_criteria TEXT` column — one allowlist entry, no new table, no `criterion_anchors` coupling. CONV-02 later becomes a migration, not a new concept | ✓ |
| Reuse `acceptance_criteria` now | Delivers CONV-02 early for little code. But it is deferred scope, adds a reference TO the cycle table, and pulls RECD-04's anchor question early | |
| No exit criteria column at all | Smallest schema; the goal IS the exit criterion. But RECD-08 names exit criteria, so it needs a recorded amendment, not silence | |

**User's choice:** One text slot now; checkable items in v0.2.x (recommended)

### Q2 — How is "scope changed after it started" detected?

| Option | Description | Selected |
|--------|-------------|----------|
| Derived from the event log | Assignment/removal events timestamped after the transition to `active`. No column, catches a swap, and the row can say the true sentence | ✓ |
| A stored baseline count | One column, one comparison, cheapest read. But blind to a swap, and a stored number that can disagree with the board | |
| A flag the assignment writer sets | Trivial to read. But a materialised fact with a writer, and once flipped it can never say WHAT changed | |

**User's choice:** Derived from the event log (recommended)

### Q3 — How is the exact column allowlist enforced?

| Option | Description | Selected |
|--------|-------------|----------|
| Pin the DDL and turn on `.sql` scanning | The `cycles` DDL joins `spine_pin.rs`; any added column fails regardless of name. Plus `"sql"` in `SCANNED_EXTENSIONS` — verified clean across every existing migration, closing A-06's named hole | ✓ |
| Pin the DDL only | Already strictly stronger than a word gate for this table. Leaves A-06 standing for future migrations as a named residual | |
| Pin the DDL and pin the column list separately | Two assertions, more explicit about intent. But two tests over one fact, and the DDL pin fails first | |

**User's choice:** Pin the DDL and turn on `.sql` scanning (recommended)
**Notes:** Verified in-discussion that the ten-word corpus has zero hits across every existing
migration, so this really is the one-token edit `13-CONTEXT.md` predicted. Also surfaced: `rollover`
is in the corpus, so the close disposition must never be named that.

### Q4 — Closing a Cycle: what disposition per unfinished epic?

| Option | Description | Selected |
|--------|-------------|----------|
| Three choices, asked per epic, no "apply to all" | move to a named later Cycle / return to no Cycle / leave it in this closed Cycle. DRFT-07 forbids any control that accepts a set wholesale | ✓ |
| Two choices — move to next, or leave it | Fewer decisions at close time. But hides the disposition that means "this was a mistake, unfile it" | |
| Per-epic, with a default pre-selected | Fastest close. But a default on every row is a bulk accept wearing per-item clothing — the reflex acceptance DRFT-11 measures | |

**User's choice:** Three choices, asked per epic, no "apply to all" (recommended)

### Q5 — Epic status: derive it, or keep a human control?

| Option | Description | Selected |
|--------|-------------|----------|
| Derive it from its tasks | Extends D-08's one-writer stance one level up, under the same forward-only floor. `epic_set_status` is unregistered, closing the companion todo cleanly | ✓ |
| Keep a human control on the Cycle region | An epic is a unit of intent; "done even though two tasks aren't" is a judgement a rule can't make | |
| Derive it, with a human floor-lowering act | Most faithful to the `request_changes` precedent (D-11). Also the most machinery for a level with no surface today | |

**User's choice:** Derive it from its tasks (recommended)
**Notes:** Resolves the folded todo `2026-10-15-epic-status-has-no-writer-after-statuspicker-deletion`.

---

## The demo board

### Q1 — What is the demonstration board seeded from?

| Option | Description | Selected |
|--------|-------------|----------|
| Flywheel's own `.planning/` | Cycles from the milestone's phases, epics from roadmap entries, tasks from PLAN.md files, issues from pending todos. "Lead row is real work" satisfied by construction; self-demonstrating | ✓ |
| A hand-authored realistic fixture | Full control over the state distribution, which criterion 5 demands. But it is still a fixture | |
| Real structure, synthesised runtime state | Real titles and density plus full control of runtime rows. Two mechanisms instead of one | |

**User's choice:** Flywheel's own `.planning/` (recommended)

### Q2 — How do the runtime states get onto the demo board?

| Option | Description | Selected |
|--------|-------------|----------|
| Synthesised rows on top of the real structure | `agent_runs` in every status, staged proposals, change flags, a merged branch written directly. Deterministic, free, re-runnable, every class guaranteed present | ✓ |
| Run real agents against it | Most honest reading of "live", doubles as an E2E exercise. But spends credentials, nondeterministic, and the board changes while you judge it | |
| Synthesised, plus one real run | Proves the synthesised rows aren't lying about shape. But re-seeding before a review is no longer one deterministic command | |

**User's choice:** Synthesised rows on top of the real structure (recommended)
**Notes:** Carried into CONTEXT.md as a planning concern — a `running` row with no live process must
not make the session surface try to attach to one.

### Q3 — How does the demo board get loaded into the running app?

| Option | Description | Selected |
|--------|-------------|----------|
| A dev-only binary writing a separate DB | Seeder under `packages/core/src/bin/`, opened via the existing DB-path mechanism. Nothing ships, no new IPC command, cannot touch the real board. `perf_seed_1000.rs` is the precedent | ✓ |
| A dev-only Tauri command | Most convenient to reach. But adds to the `generate_handler!` roster this phase is pruning, and writes to the real database | |
| A checked-in SQL fixture | No Rust, diffable, inspectable. But duplicates the schema by hand and rots on the next migration — and `.sql` is about to be scanned | |

**User's choice:** A dev-only binary writing a separate DB (recommended)

### Q4 — What form does the owner verdict take?

| Option | Description | Selected |
|--------|-------------|----------|
| Scripted capture, manual verdict, both committed | A script launches the app on the demo DB and captures the region; `14-OWNER-VERDICT.md` plus the committed PNG. Only the judgement is manual | ✓ |
| Inside the phase's UAT, no extra artifact | Stays inside the machinery that refreshes the verification fingerprint. But buried in a transcript rather than citable by phases 15–18 | |
| A standing verdict artifact VIS-07 appends to | One home for the four more entries VIS-07 has coming. But a cross-phase artifact invented in a busy phase | |

**User's choice:** Scripted capture, manual verdict, both committed (recommended)

---

## Claude's Discretion

- The CVD simulation method and distinguishability threshold (nothing in the tree simulates CVD
  today; no dependency installed; the roadmap says the values are a design artifact of this phase).
- Whether the state-token source gate extends `brand-rule.test.ts` or lands as a sibling test.
- The forced-colors fallback shape (nothing handles `forced-colors` today).
- Column names, the Cycle's ordering mechanism (`ranking.rs` is the obvious reuse), event type
  names, and the internal naming of the state component and its token classes.
- How a Cycle is created (hand-typed vs. agent-drafted) and whether a closed Cycle can be reopened.
- Plan decomposition, subject to one hard ordering constraint: the hierarchy statement and the demo
  board must exist **before** the visual work.

## Deferred Ideas

- VIS-05 / VIS-08 — values, dark-first switch, signal budget, final per-surface verdict → Phase 18.
- CONV-02 (exit criteria as checkable items), CONV-05 (agent-proposed Cycle placement), CONV-06
  (since-you-left digest, named trigger: Phase 17 closing) → v0.2.x.
- Agent-drafted Cycle creation → Phase 15's drafting engine.
- Reopening a closed Cycle — not decided, no criterion requires it.
- A "why is this status" explainer on the card — carried from `13-CONTEXT.md`, still in no criterion.
- Re-colouring the five task workflow statuses — declined by D-16, revisitable as a Phase 18
  signal-budget decision with the vocabulary already in place.
