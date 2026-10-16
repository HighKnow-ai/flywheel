---
phase: 14-cycles-on-screen-state-in-colour
verified: 2026-10-16T00:34:37Z
status: passed
score: 12/12 must-haves verified
covered_files:
  - ".planning/REQUIREMENTS.md"
  - ".planning/phases/14-cycles-on-screen-state-in-colour/14-01-PLAN.md"
  - ".planning/phases/14-cycles-on-screen-state-in-colour/14-01-SUMMARY.md"
  - ".planning/phases/14-cycles-on-screen-state-in-colour/14-02-PLAN.md"
  - ".planning/phases/14-cycles-on-screen-state-in-colour/14-02-SUMMARY.md"
  - ".planning/phases/14-cycles-on-screen-state-in-colour/14-03-PLAN.md"
  - ".planning/phases/14-cycles-on-screen-state-in-colour/14-03-SUMMARY.md"
  - ".planning/phases/14-cycles-on-screen-state-in-colour/14-04-PLAN.md"
  - ".planning/phases/14-cycles-on-screen-state-in-colour/14-04-SUMMARY.md"
  - ".planning/phases/14-cycles-on-screen-state-in-colour/14-05-PLAN.md"
  - ".planning/phases/14-cycles-on-screen-state-in-colour/14-05-SUMMARY.md"
  - ".planning/phases/14-cycles-on-screen-state-in-colour/14-06-PLAN.md"
  - ".planning/phases/14-cycles-on-screen-state-in-colour/14-06-SUMMARY.md"
  - ".planning/phases/14-cycles-on-screen-state-in-colour/14-07-PLAN.md"
  - ".planning/phases/14-cycles-on-screen-state-in-colour/14-07-SUMMARY.md"
  - ".planning/phases/14-cycles-on-screen-state-in-colour/14-08-PLAN.md"
  - ".planning/phases/14-cycles-on-screen-state-in-colour/14-08-SUMMARY.md"
  - ".planning/phases/14-cycles-on-screen-state-in-colour/14-09-PLAN.md"
  - ".planning/phases/14-cycles-on-screen-state-in-colour/14-09-SUMMARY.md"
  - ".planning/phases/14-cycles-on-screen-state-in-colour/14-10-PLAN.md"
  - ".planning/phases/14-cycles-on-screen-state-in-colour/14-10-SUMMARY.md"
  - ".planning/phases/14-cycles-on-screen-state-in-colour/14-DIRECTION.md"
  - ".planning/phases/14-cycles-on-screen-state-in-colour/14-HIERARCHY.md"
  - ".planning/phases/14-cycles-on-screen-state-in-colour/14-OWNER-VERDICT.md"
  - ".planning/phases/14-cycles-on-screen-state-in-colour/14-UAT.md"
  - "packages/core/src/db/migrations/0024_cycles.sql"
  - "packages/core/src/domain/cycle.rs"
  - "packages/core/src/domain/epic.rs"
  - "packages/core/src/query/cycle_progress.rs"
  - "packages/core/tests/epic_context_packet.rs"
  - "packages/core/tests/proposal_no_promotion.rs"
  - "packages/core/tests/spine_pin.rs"
  - "packages/desktop/src/board/CycleCloseDialog.tsx"
  - "packages/desktop/src/board/CycleRegion.tsx"
  - "packages/desktop/src/legend/StateBadge.tsx"
  - "packages/desktop/src/theme/__tests__/contrast.test.ts"
  - "packages/desktop/src/theme/__tests__/cvd.test.ts"
  - "packages/desktop/src/theme/__tests__/state-token-gate.test.ts"
  - "packages/desktop/src/theme/cvd.ts"
covered_digest: "v1:sha256:91bc670179ae772021fd6964d80fc8a4d7bab58797b2873cc3f167a93c309937"
behavior_unverified: 0
overrides_applied: 2
overrides:
  - must_have: "A written hierarchy statement for the region exists before the visual work and the built region realises it (ordering clause)"
    reason: "14-HIERARCHY.md (f853e244, 18:45) is NOT a git ancestor of CycleRegion.tsx's first commit (a5c6f7d7, 18:20, plan 14-01 tracer slice); the plan's own verify one-liner exits 1. It DOES predate every commit that shaped the three levels (8db0e8d8 onward). No history was rewritten. The git fact stands; only the acceptance is recorded here."
    accepted_by: "Cyril Marechal (owner), as recorded in 14-OWNER-VERDICT.md section 'Criterion 5: the ordering ruling'"
    accepted_at: "2026-10-16"
  - must_have: "Criterion 3: every state on screen — including `merged` — is rendered by the single component"
    reason: "Owner accepted reading (a): `merged` is defined in STATE_VOCABULARY, tokenised, CVD-proven, contrast-checked, forced-colours-tested and unit-tested through StateBadge, but no surface draws it; the criterion is therefore vacuously satisfied because no `merged` state is on screen outside the component. The word appears as plain text only (MergeConfirmSheet, ReviewSurface:383, WorktreeInventory:68). No follow-up owed. This was the one UNCERTAIN truth of the 2026-10-16T12:00:00Z report."
    accepted_by: "Cyril Marechal (owner) — UAT test 1, result pass"
    accepted_at: "2026-10-16"
  - must_have: "Criterion 3: no state colour is drawn outside the single component (legacy --blocked-text-rack / --destructive-text-rack consumers)"
    reason: "Owner accepted the three legacy sites as-is for now — ProjectRail.tsx:363 (rail Blocked count), BlockedQueue.tsx:86 (the word 'Blocked'), PermissionRequestCard.tsx:286 — as a data channel plus later per-surface work. No rewire owed in Phase 14. The source gate guards only the `--state-*` namespace and cannot see these roles."
    accepted_by: "Cyril Marechal (owner) — UAT test 2, result pass"
    accepted_at: "2026-10-16"
  - must_have: "Phase goal: the board finally carries saturated state colour on a surface worth looking at"
    reason: "Owner confirmed his 'all good to me' verdict covered the reading in which the colour lives on the fleet surface (6 of 6 rows saturated) while the board shows 2 saturated rows of 1038 (0.19%) — a deliberate design outcome after 14-09 found washing all five classes produced 'a pastel plate'. Nothing further owed."
    accepted_by: "Cyril Marechal (owner) — UAT test 3, result pass"
    accepted_at: "2026-10-16"
re_verification:
  previous_status: human_needed
  previous_score: 11/12
  previous_verified: 2026-10-16T12:00:00Z
  reason: "covered_digest stale — acca627d edited packages/core/src/domain/cycle.rs (a covered file) plus domain/epic.rs and tests/proposal_no_promotion.rs; 465464f3 edited tests/epic_context_packet.rs. All three human_verification items answered pass in 14-UAT.md (status complete, 3/3, 0 issues, 0 pending)."
  gaps_closed: []
  human_items_resolved:
    - "merged defined but drawn nowhere — accepted, reading (a) (UAT test 1)"
    - "legacy blocked/destructive colour consumers — accepted as-is (UAT test 2)"
    - "board vs fleet as the saturated-colour surface — verdict confirmed to cover it (UAT test 3)"
  gaps_remaining: []
  regressions: []
gaps: []
deferred: []
prohibitions:
  - statement: "The folded progress figure must not become a number the developer is nudged to manage: no trend arrow, no comparison against a previous Cycle, no target, no congratulation or reproach in the copy."
    source: 14-02-PLAN.md
    status: verified
    verification: judgment
    evidence: "Deterministic: grep over CycleRegion.tsx for trend / target / congratulat / previous / last cycle / arrow glyphs / `%` returns only the header comment stating the rule and `targets={data.later}` (the close dialog's move-target list, not a goal target). No `Math.round`, `toFixed` or `Date`. The region prints the integer pair (`\"412/940 tasks done\"`); `cycle-region.test.tsx` asserts no `%` in the region text. Judge verdict is mine and NON-AUTHORITATIVE on the copy question; it was never put to the owner in writing. Not raised as a human-verification item because the prohibition's observable half is fully covered by the greps above."
  - statement: "The state vocabulary must not turn the board into an incident dashboard; the count of simultaneously saturated rows on the demonstration board is the figure that decides whether this held."
    source: 14-04-PLAN.md
    status: verified
    verification: judgment
    evidence: "The prohibition names its own decider and the figure was measured: 2 saturated rows of 1038 on the board (0.19%) and 6 of 6 on the fleet (14-09-SUMMARY, 14-DIRECTION.md). The quiet class exists and the five task workflow statuses gained no colour. HUMAN-RULED, not judge-ruled: this exact measurement was put to the owner as UAT test 3 and answered pass."
  - statement: "A threshold must never be moved to make a test pass; a floor changes only with a recorded reason naming the evidence, in the direction document, and never inside the same edit that made a failing test green."
    source: 14-08-PLAN.md
    status: verified
    verification: judgment
    evidence: "Deterministic: `git log -p` over theme/cvd.ts and theme/__tests__/contrast.test.ts shows TEXT_FLOOR=10, WASH_FLOOR=2.3, AA_TEXT=4.5 and SELECTED_BAND_FLOOR each introduced on exactly one `+` line and never edited since — no floor constant has a second revision in the phase's range. 14-DIRECTION.md states it independently (\"The floors were fixed before the numbers were seen, and no floor moved. The values moved\"; \"no floor constant moved (asserted over the plan's commit range)\") and the dark needs-you wash was left recorded as unreachable at 4.79 against 4.43 shipped rather than shipped by lowering the envelope — the prohibition's hardest case, resolved the way it demands. Judge verdict is mine and NON-AUTHORITATIVE, but the git evidence is deterministic."
coincidental_reliance_items:
  - truth: "Criterion 2: a Cycle whose scope changed after it started says so on its own row (scope drift derived from the event log)"
    reason: undeclared-precondition
    harden: "`epic::set_epic_cycle_in_tx` (new in acca627d) is `pub` and writes `epics.cycle_id` while deliberately appending no event; the drift derivation holds only because its two callers (cycle.rs:227, cycle.rs:256) happen to be the sole call sites and each appends `cycle.epic_assigned` / `cycle.epic_removed` in the same transaction. Nothing enforces that a third caller would. Before the fix the write was private to cycle.rs, so the pairing was structural. Consider either a gate test asserting cycle.rs is the only caller of set_epic_cycle_in_tx, or taking the event name as a required argument. Advisory only — no score or status effect."
---

# Phase 14: Cycles On Screen, State In Colour Verification Report

**Phase Goal:** Cyril sees where the work stands without going to look (the current Cycle's goal and progress and the roadmap ahead of it, folded from real counts) and the board finally carries saturated state colour on a surface worth looking at, with colour as the fastest channel and never the only one.
**Verified:** 2026-10-16T00:34:37Z
**Status:** passed
**Re-verification:** Yes — digest stale after two post-verification fix commits, and all three human-verification items answered by the owner.

> Coverage note: `covered_files` lists every current PLAN and SUMMARY in the phase directory alongside the code and record files. That is the staleness contract (#4155 — a report whose phase gains or changes an artifact must re-stale), not a claim that I re-read 400 KB of plan prose this round: for the plans I read the frontmatter `requirements`, `must_haves` and `prohibitions` blocks and judged them against the code, and the four Rust/TSX files the two fix commits touched I read in full.
>
> Timestamp note: this report carries the real system/UTC clock (00:34Z), which correctly post-dates every commit it judges (`acca627d` is 00:04:56Z). `14-UAT.md`'s recorded times (12:30Z–13:15Z) and the previous report's `12:00:00Z` came from the session's narrative clock, so they read as numerically later despite being earlier in sequence. Sequence, not arithmetic, is the thing: UAT → this report.

## Verdict in one paragraph

Re-measured against the six ROADMAP criteria as the code stands at `cf9ddb4a`. The two post-verification fix commits are both real fixes and neither regressed anything: `acca627d` moves the `epics.cycle_id` write into `epics`' owning module with the parameter binding and behaviour preserved, and `465464f3` names `cycle_progress` in the unbounded-reads allowlist without widening the fence. I re-ran all seven cycle/gate Rust targets and the nine desktop test files that carry criteria 1–3 — 85 Rust tests and 342 desktop tests, all green, run per-target (never a bare `cargo test`). The one UNCERTAIN truth of the previous report (criterion 3's `merged` clause) is resolved by owner acceptance in `14-UAT.md`, as are the two residual readings. Score is 12/12 with two overrides inside the score; no gaps. The three judgment-tier prohibitions the plans declare (and the previous report never assessed) are each checked as negatives below and each held, one of them by the owner's own UAT ruling. Status: **passed**. One advisory (not a gap, not a human item): the new `pub` helper's silent-write contract is now carried by its two callers rather than by structure.

## What changed since the previous report, and what I re-checked against it

| Commit | Files | What it does | Re-check | Result |
|---|---|---|---|---|
| `acca627d` | `domain/cycle.rs`, `domain/epic.rs`, `tests/proposal_no_promotion.rs` | Registers `cycles` → `src/domain/cycle.rs` in `CANONICAL_TABLE_OWNERS` (5→6 entries); replaces the two raw `UPDATE epics SET cycle_id` statements in `assign_epic_in_tx` / `remove_epic_in_tx` with a new `epic::set_epic_cycle_in_tx` | Read both diffs line by line; traced every `UPDATE epics` in the tree; re-ran `proposal_no_promotion` (15), `cycle_close` (15), `cycle_scope_drift` (12), `no_agent_status_write` (10), `spine_pin` (6) | No behaviour change. Parameter binding is correctly re-ordered (`?1`=cycle_id, `?2`=now, `?3`=epic_id vs the old `?2/?3/?1`). `grep "UPDATE epics"` over `packages/core/src` + `packages/desktop/src-tauri/src`: `epic.rs:672` is the only `cycle_id` write; `acceptance_criterion.rs:784` is an allowlisted timestamp touch. `close_cycle`'s `MoveTo` / `BackToBacklog` dispositions route through the same two `*_in_tx` helpers (cycle.rs:468, 472), so all three membership paths are covered by the one fix. `every_canonical_table_has_exactly_one_owner`, `the_derived_write_patterns_cover_every_canonical_table` and `no_agent_reachable_module_writes_a_canonical_table` all pass with the new row. |
| `465464f3` | `tests/epic_context_packet.rs` | Adds `"cycle_progress"` to `ALLOWED_UNBOUNDED_SELECTS` with a 9-line justification | Read the scanner: `scan_source_for_unbounded_selects` keys on `chunk_identifier`, an exact string match against the allowlist. All three SELECTs in `query/cycle_progress.rs` (lines 46, 51, 69) are inline in `pub fn cycle_progress`, so the one entry covers exactly that function. Re-ran `epic_context_packet` (18), including the two-sided `the_unbounded_reads_gate_fires_on_a_planted_violation` | The fence still bites: the planted unbounded SELECT is still exactly one offender. The entry is name-scoped, not a wildcard. Granularity note below. |

The criterion-1 fold itself is unaffected: `cycle_progress` must stay unbounded (RECD-09 requires a full count), and `cycle_progress.rs` was not edited — only its allowlist entry was added.

**No desktop source changed since the previous report.** `git diff --stat c73e438b..HEAD` touches only the two Rust fixes and the two planning documents, so criteria 3a–3d, 5 and 6 rest on identical bytes; I re-ran their tests anyway rather than carry the claim.

## Goal Achievement

### Observable Truths

| # | Truth (roadmap criterion) | Status | Evidence |
|---|---|---|---|
| 1 | C1: current Cycle's goal, ordering, progress and the roadmap ahead on the board without navigating; progress folded from every epic's real task counts, equal to a full count over 900+ tasks; no stored percentage; no date/duration/capacity/velocity column in schema or UI; column set an exact allowlist | ✓ VERIFIED | `CycleRegion` imported at `BoardView.tsx:40` and mounted at `BoardView.tsx:1156`, reads the `cycle_region` IPC (`adapters/tauri.ts:1631`, registered `main.rs:169`). `query/cycle_progress.rs` uses one `COUNT(*)` plus two GROUP BY aggregates, no LIMIT, no window. Behavioural: `cycle_progress` (8 tests incl. `the_fold_equals_an_independent_full_count_over_more_than_900_tasks`, `the_fold_total_is_strictly_greater_than_the_board_page`) and `cycle_region` (11) pass. `0024_cycles.sql` has 10 columns and no stored progress; `spine_pin::the_spine_ddl_is_pinned` + `the_spine_pin_fires_on_a_planted_ddl_change` pass (6/6); `pm_vocabulary_gate` 8/8. Desktop: `cycle-region.test.tsx` asserts no `%` in the region text. Minor, unchanged: "its ordering" is carried by rank position, no ordinal printed for the current Cycle. |
| 2 | C2: closing a Cycle asks per unfinished epic; scope drift stated on the Cycle's own row; an epic in at most one Cycle; Cycles never nest; FK chain above `epics` ends at the cycle table | ✓ VERIFIED (coincidental-reliance) | `cycle_close` 15/15 — close refuses any unfinished epic without a disposition (bails naming it), refuses duplicate dispositions, closed/self targets, agent/system actors; one transaction, one event per disposition; the DTO has no apply-to-all shape. `cycle_scope_drift` 12/12 (drift derived from the event log, `query/cycle_scope.rs`). Desktop `cycle-close.test.tsx` passes: both state maps start empty, confirm disabled until every row is decided, no bulk control. One nullable `epics.cycle_id` gives "at most one Cycle"; `cycles` has no self-reference (DDL pinned); `spine_pin::no_table_other_than_epics_references_the_cycle_table` and `the_chain_above_epics_terminates_at_the_cycle_table` pass. **Re-checked post-`acca627d`:** all three membership write paths now route through `epic::set_epic_cycle_in_tx` and still append their cycle event in the same transaction — proven behaviourally by `cycle_scope_drift` (which derives drift from those very events) staying green. The reliance flag is advisory, see `coincidental_reliance_items`. The literal "no parent" wording is read as "no parent in the board spine" (owner ruling 2026-10-15); assessment unchanged and restated below. |
| 3a | C3: every state rendered by one component that is the only consumer of `--state-*`, always glyph + word/accessible name; a direct reference fails the build | ✓ VERIFIED | `grep -rln -- "--state-" packages/desktop/src` outside `__tests__` returns exactly `legend/StateBadge.tsx`, `styles/tokens.css`, `theme/tokens.ts` (the two definitions). `state-token-gate.test.ts` passes two-sided (planted fixtures fire, `.state-*` class namespace not conflated, case and look-alike code points). `RUN_STATUS_COLOR_ROLES`: no match anywhere in `packages/`. `state-badge.test.tsx` + `legend.test.tsx` pass: no prop removes the glyph; `hideLabel` substitutes `role="img"` + `aria-label`. "Fails the build" means "fails the test suite" (the repo's house pattern, as `brand-rule.test.ts`); there is no bundler-level check. |
| 3b | C3: every pair of state colours distinguishable under protanopia, deuteranopia, tritanopia | ✓ VERIFIED | `cvd.test.ts` passes: all 10 unordered class pairs × text and wash × 2 modes × 3 deficiencies, with a pair-count guard, plus primitive symmetry/floor tests. `theme/cvd.ts` is in-repo, no dependency. Scope note unchanged: `edge` and `mark` are not paired directly — same hue family as their class `text`, so coverage is transitive, not asserted. |
| 3c | C3: every text role contrast-checked against every surface tint it can appear on, both modes, against the shipped stylesheet bytes | ✓ VERIFIED | `contrast.test.ts` passes: `TEXT_ROLES` (all 5 state inks) × `SURFACES` (the four state washes) per mode, plus "every state wash keeps every text role at 4.5:1". The shipped-bytes clause is carried by `driftErrors(mode, tokensCssSource)` over raw `tokens.css`, per-role block-aware corruption tests for all 20 state roles in both blocks, and a lowercase-hex encoding check — transitive rather than a direct parse, as before. |
| 3d | C3: forced-colors mode keeps every state readable | ✓ VERIFIED | `board/__tests__/browser/forced-colors.browser.test.tsx` in real Chromium (`vitest.browser.forced-colors.config.ts`) with an ordinary-colour arm: substitution happened, 1px solid boundary all four sides, wash discarded, every pair of the five classes told apart by glyph and word. Not re-run this round (browser arm, unchanged bytes, 22 passed on the executing round). |
| 3e | C3: `merged` is among the states rendered by the single component | PASSED (override) | No surface calls `<StateBadge state="merged">`; `merged` is in `STATE_VOCABULARY`, has tokens, a mark (`run-merged`), and sits in the CVD / contrast / forced-colours matrices. The owner accepted reading (a) — vacuously satisfied, no `merged` state is on screen outside the component — **UAT test 1, result pass**. No follow-up owed. Previously the single UNCERTAIN truth. |
| 4 | C4: the decision names D-11 in a SUPERSEDES table; spec, brand allowlist and tests amended in the same change incl. `RUN_STATUS_COLOR_ROLES`; `merged` and `awaiting review` registered in the marks legend | ✓ VERIFIED | `14-DIRECTION.md` SUPERSEDES table has the `08.1-CONTEXT.md` D-11 row (what stands / what is void) plus two spec rows. `08.1-UI-SPEC.md` strikes item 6 (D-199) and the pending-proposal bullet; `brand-rule.test.ts` keeps the voided uses struck and out of the allowlist. `c0df838a` moves code, allowlist and spec together. `legend/marks.ts:515,522` define `run-awaiting-review` and `run-merged`. Note unchanged: nothing enforces that the SUPERSEDES table names D-11; I verified it by reading. |
| 5a | C5: built and judged on a seeded demonstration board carrying every state live, realistic count, lead row real work | ✓ VERIFIED | `scripts/demo-board.sh` + `core/tests/bin/demo_board.rs`; the owner's own re-seed report in `14-OWNER-VERDICT.md`: `cycles=5 epics=278 tasks=760 issues=9 running=2 blocked=1 failed=1 completed=1 abandoned=1 awaiting_review=1 proposals_pending=3 merged=1 active_cycle=FLY-1 lead_epic=FLY-1015` — 1,038 items, lead epic FLY-1015 is real Phase-14 work, in_progress. The criterion's own list (VIS-06) excludes `ci_failed`, so its absence is a criterion-3 matter, not a criterion-5 gap. |
| 5b | C5: a hierarchy statement exists **before** the visual work | PASSED (override) | The git fact is unchanged and still false as written: `f853e244` (18:45) is not an ancestor of `a5c6f7d7` (18:20). Carried by the owner's recorded ruling, not marked satisfied. See "Criterion 5 ordering" below. |
| 5c | C5: the built region realises the hierarchy statement | ✓ VERIFIED | `14-HIERARCHY.md` names the focal point and three levels; `CycleRegion.tsx` realises them (Level 1 heading-step goal clamped to two lines + facts row, Level 2 one-line later Cycles in rank order, Level 3 container + one divider, no colour declared in the region). `14-DIRECTION.md` records the statement's five-step procedure run on the demo board: the pre-shaping region FAILED steps 1–2, was reshaped (`3593dfa1`, `f14813ac`), then passed. Two honest caveats stand there (Level 2 in primary not muted ink; step 5 held by unit tests, not exercised in the running app), plus the "Close this cycle" button sitting in Level 1. |
| 6 | C6: the owner signs off looking at the running application on that board, with a screenshot recorded | ✓ VERIFIED | `14-OWNER-VERDICT.md`: "yes", verbatim "all good to me", 2026-10-16, judged on `target/debug/desktop` launched by him. `screenshots/cycle-region-{dark,light}.png` exist as 2400×1600 PNGs with sha256 matching the verdict and `capture-manifest.json` (re-checked by `shasum` on the executing round; bytes unchanged since). Caveats stand: he viewed the running app in **Dark** and it is not known whether he switched to Light live; both screenshots carry the "Flywheel 0.1.1 is available" popover over the lower roster rows. The verdict also records that the known-open items, the 0.19% figure and the criterion-5 ordering question were put to him in writing before he answered. |

**Score:** 12/12 truths verified — 10 verified outright, 2 PASSED by owner-recorded override (3e, 5b). 0 present-but-behaviour-unverified. 0 UNCERTAIN.

### Owner acceptances carried forward (not re-litigated)

| UAT test | Question | Owner result | Where it lands here |
|---|---|---|---|
| 1 | Does `merged` count as satisfied while drawn nowhere? | pass — reading (a), vacuously satisfied | Truth 3e → PASSED (override), in score |
| 2 | Are the legacy `--blocked-text-rack` / `--destructive-text-rack` consumers acceptable? | pass — accepted as-is, data channel plus later per-surface work | Override 3; the three sites stay listed as ℹ️ Info below, not as warnings owing a rewire |
| 3 | Did "all good to me" cover the fleet as the colour surface? | pass — confirmed | Override 4; the goal statement is satisfied on the accepted reading |

Acceptance record: `.planning/phases/14-cycles-on-screen-state-in-colour/14-UAT.md` (`status: complete`, total 3 / passed 3 / issues 0 / pending 0, empty `## Gaps`). None of the three reappears as a human-verification item or a gap, by owner decision.

### Criterion 5 ordering: unchanged, carried by override

- `f853e244` (14-HIERARCHY.md, 2026-10-15 18:45) is **not** a git ancestor of `a5c6f7d7` (CycleRegion.tsx created, 18:20, plan 14-01 tracer). The plan's own verify one-liner exits 1. I did not re-run it; nothing in `acca627d`/`465464f3` touches git history before them, and no history was rewritten.
- The earlier file was a 55-line component plus its test — a minimal visual slice, not nothing.
- The statement does predate `8db0e8d8` (19:11) and every later commit that shaped the levels, and it demonstrably governed: 14-09 reshaped the region after it failed the statement's own steps 1–2.
- Structural cause for future phases: tracer-first plan ordering (14-01 builds the component) and a statement-first criterion (14-02 writes the statement) were in tension and the phase plan did not reconcile them. A future phase with this criterion should put the statement in the first wave ahead of the tracer, or exempt the tracer explicitly.
- One minor overclaim stands: `CycleRegion.tsx`'s header comment says the hierarchy was "written before this shape" — true of the shaped version, not the original 55 lines.

### Criterion 2 foreign-key clause: assessment unchanged

Implemented: `cycles.project_id REFERENCES projects(id)` and `cycles.created_by REFERENCES actors(id)`; `spine_pin.rs` asserts the parent set is exactly `{projects, actors}` (both Infrastructure) and that only `epics` references `cycles`. **Satisfied in intent, not in literal wording** — the literal "no parent" would be a zero-row `pragma_foreign_key_list('cycles')`, which is false. What the clause protects (nothing in the board spine sits above a Cycle) is asserted and fails closed: a new parent, a new referrer or a new column on `cycles` fails a test. `epics` hangs from `projects`/`actors` the same way, so reading the chain as "within the board spine" is consistent with how the spine pin already treats `epics`. Owner chose option B knowingly (2026-10-15). Naming nit unchanged: `the_chain_above_epics_terminates_at_the_cycle_table` asserts a nonzero parent set; its doc comment explains this, its name does not. If the owner wants the criterion text to stay literally honest, amend ROADMAP wording to "no parent in the board spine".

### Prohibitions (must-NOT checks)

Three plans declare a prohibition. All three are judgment-tier (bare statements, no `verification` field), and none had been assessed by the previous report. Each is checked here as a negative: a verified prohibition means the must-NOT did **not** happen.

| # | Prohibition (source) | Status | Evidence |
|---|---|---|---|
| P1 | The folded progress figure must not become a number to manage — no trend arrow, no comparison with a previous Cycle, no target, no congratulation or reproach (14-02) | ✓ HELD | Grep over `CycleRegion.tsx` for trend / target / congratulat / previous / last-cycle / arrow glyphs / `%`: only the header comment restating the rule, plus `targets={data.later}` (the close dialog's move-target list, not a goal target). No `Math.round`, `toFixed` or `Date`. The region prints the integer pair; `cycle-region.test.tsx` asserts no `%`. **Judge verdict mine, non-authoritative** on the tone half; the observable half is fully covered by the greps. Never put to the owner in writing. |
| P2 | The state vocabulary must not turn the board into an incident dashboard — the simultaneously-saturated row count on the demonstration board decides it (14-04) | ✓ HELD | The prohibition names its own decider and the figure was measured: **2 of 1038 board rows (0.19%)**, 6 of 6 fleet rows (14-09-SUMMARY, 14-DIRECTION.md). The quiet class exists; the five task workflow statuses gained no colour. **Human-ruled, not judge-ruled** — this exact measurement was UAT test 3 and the owner answered pass. |
| P3 | A threshold must never be moved to make a test pass (14-08) | ✓ HELD | `git log -p` over `theme/cvd.ts` and `theme/__tests__/contrast.test.ts`: `TEXT_FLOOR = 10`, `WASH_FLOOR = 2.3`, `AA_TEXT = 4.5` and `SELECTED_BAND_FLOOR` each appear on exactly one `+` line and have no second revision in the phase's range. 14-DIRECTION.md says it independently ("The floors were fixed before the numbers were seen, and no floor moved. The values moved"; "no floor constant moved (asserted over the plan's commit range)"), and the prohibition's hardest case went the way it demands: the dark needs-you wash was **left recorded as unreachable** (best 4.79 against 4.43 shipped, bounded by the dark brand text lift) instead of being shipped by lowering the envelope. **Judge verdict mine, non-authoritative** — but the git evidence is deterministic. |

Not raised as human-verification items: each has deterministic evidence named above, and P2 was explicitly human-ruled. P1 and P3 were never put to the owner in writing, so if he wants belt-and-braces he may spot-confirm the copy of the facts row (P1) — advisory, not blocking.

### Required Artifacts

| Artifact | Expected | Status | Details |
|---|---|---|---|
| `packages/core/src/db/migrations/0024_cycles.sql` | cycles table, partial unique active index, `epics.cycle_id` | ✓ VERIFIED | 10 columns, state CHECK, one-active-per-project partial index; DDL byte-pinned |
| `packages/core/src/query/cycle_progress.rs` | folded progress | ✓ VERIFIED | one `COUNT(*)` + two GROUP BY aggregates, no LIMIT, no window; now allowlisted by name |
| `packages/core/src/domain/cycle.rs` | create/start/assign/reorder/close | ✓ VERIFIED | one transaction + one event per writer; close refuses undecided epics; membership write delegated post-`acca627d` |
| `packages/core/src/domain/epic.rs` | `set_epic_cycle_in_tx` (new) | ✓ VERIFIED | `epic.rs:672`, the single `cycle_id` write in the tree; two callers, both in cycle.rs; `status` untouched |
| `packages/desktop/src/board/CycleRegion.tsx` | region above the roster | ✓ VERIFIED | imported line 40, mounted `BoardView.tsx:1156`, data from `cycle_region` |
| `packages/desktop/src/board/CycleCloseDialog.tsx` | per-epic close | ✓ VERIFIED | wired from the region, calls `cycle_close` |
| `packages/desktop/src/legend/StateBadge.tsx` | single `--state-*` consumer | ✓ VERIFIED | 5 call-site files; gate green |
| `theme/cvd.ts`, `theme/__tests__/{cvd,contrast,state-token-gate}.test.ts` | enforcement | ✓ VERIFIED | 230 tests green this round |
| `tests/proposal_no_promotion.rs`, `tests/epic_context_packet.rs` | the two cross-phase gates the fixes answer | ✓ VERIFIED | 15 + 18 green, both two-sided |
| `14-HIERARCHY.md`, `14-DIRECTION.md`, `14-OWNER-VERDICT.md`, `14-UAT.md`, `screenshots/*` | records | ✓ VERIFIED | hashes match; UAT complete |

### Key Link Verification

| From | To | Via | Status |
|---|---|---|---|
| `BoardView.tsx` | `CycleRegion` | import line 40, `<CycleRegion projectId>` line 1156 | WIRED |
| `useCycleRegionQuery` | `cycle_region` command | `adapters/tauri.ts:1631`, `main.rs:169` | WIRED |
| `CycleCloseDialog` | `cycle_close` command | `adapters/tauri.ts:1644`, `main.rs:170` | WIRED |
| run/fleet/session/runs/recovery surfaces | `StateBadge` | `<StateBadge state=...>` | WIRED |
| `StateBadge` | `--state-*` tokens | `var(--state-${cls}-${role})` | WIRED |
| marks legend | `StateBadge` | `MARKS_BY_ID[...]` | WIRED |
| `cycle.rs::assign_epic_in_tx` / `remove_epic_in_tx` / `close_cycle` dispositions | `epic::set_epic_cycle_in_tx` | `use crate::domain::epic::set_epic_cycle_in_tx` (cycle.rs:27), called at 227 and 256; close routes via 468/472 | WIRED (re-checked after `acca627d`) |
| `cycles` (Canonical) | `src/domain/cycle.rs` | `CANONICAL_TABLE_OWNERS` row 6 | WIRED |
| `query/cycle_progress.rs` | unbounded-reads fence | `ALLOWED_UNBOUNDED_SELECTS["cycle_progress"]`, exact identifier match | WIRED |

### Data-Flow Trace (Level 4)

| Artifact | Variable | Source | Real data | Status |
|---|---|---|---|---|
| `CycleRegion` | `cycle.progress.tasksDone/Total` | `cycle_progress` grouped SQL over `tasks` joined to `epics` | Yes | FLOWING (screenshots show `7/27 tasks done` and 10 epics, matching the demo DB) |
| `CycleRegion` | `later[]` | `cycle_roster` (`cycle_roster` target 10/10) | Yes | FLOWING (4 later lines on screen) |
| `CycleRegion` | scope drift line | `query/cycle_scope.rs` over the event log | Yes | FLOWING (`data-cycle-scope-drift`, "10 epics added since this Cycle started" visible in the screenshots) |
| `StateBadge` | state value | callers pass run/fleet status and booleans from real reads | Yes | FLOWING |

### Behavioral Spot-Checks

Every Rust run was scoped per-target (never a bare `cargo test` — Gatekeeper serially scans ~125 relinked binaries).

| Behavior | Command | Result | Status |
|---|---|---|---|
| Canonical-owner gate accepts the new `cycles` row and still bites | `cargo test -p core --test proposal_no_promotion` | 15 passed | ✓ PASS |
| Unbounded-reads fence accepts `cycle_progress` and still fires on a plant | `cargo test -p core --test epic_context_packet` | 18 passed | ✓ PASS |
| Spine pin: cycles DDL, parent set, single referrer, planted-change detection | `cargo test -p core --test spine_pin` | 6 passed | ✓ PASS |
| Close asks per unfinished epic; refuses undecided/duplicate/agent-actor | `cargo test -p core --test cycle_close` | 15 passed | ✓ PASS |
| Fold equals a full count over 900+ tasks, exceeds the 200-row page | `cargo test -p core --test cycle_progress` | 8 passed | ✓ PASS |
| Region and roster assembly | `cargo test -p core --test cycle_region --test cycle_roster` | 11 + 10 passed | ✓ PASS |
| Scope drift still derived from the events the fixed write path must still append | `cargo test -p core --test cycle_scope_drift` | 12 passed | ✓ PASS |
| No agent-reachable status write survived the epic.rs edit | `cargo test -p core --test no_agent_status_write` | 10 passed | ✓ PASS |
| No PM vocabulary / date column on `cycles` | `cargo test -p core --test pm_vocabulary_gate` | 8 passed | ✓ PASS |
| CVD pairs, contrast envelope, `--state-*` source gate | `npx vitest run src/theme/__tests__/{cvd,contrast,state-token-gate}.test.ts` | 3 files, 230 passed | ✓ PASS |
| Region, close dialog, state pills, badge, legend | `npx vitest run src/board/__tests__/{cycle-close,cycle-region,state-pills,states-finish}.test.tsx src/legend/__tests__/{state-badge,legend}.test.tsx` | 6 files, 112 passed | ✓ PASS |
| Only one `cycle_id` write exists | `grep -rn "UPDATE epics" packages/core/src packages/desktop/src-tauri/src` | `epic.rs:672` only (plus allowlisted timestamp touch) | ✓ PASS |
| `--state-*` consumers outside tests | `grep -rln -- "--state-" packages/desktop/src` | StateBadge.tsx, tokens.css, tokens.ts | ✓ PASS |
| `RUN_STATUS_COLOR_ROLES` gone | `grep -rn RUN_STATUS_COLOR_ROLES packages/` | no matches | ✓ PASS |
| Forced-colors in real Chromium | browser arm, not re-run (unchanged bytes) | 22 passed on the executing round | ? SKIP (carried) |

### Probe Execution

Step 7c: SKIPPED. No `probe-*.sh` is declared by any Phase 14 plan and none exists under `scripts/*/tests/` for this phase.

### Requirements Coverage

| Requirement | Source plan(s) | Description | Status | Evidence |
|---|---|---|---|---|
| RECD-08 | 14-01, 14-05 | Cycle scope-boxed and undated | ✓ SATISFIED | migration, `pm_vocabulary_gate`, spine column pin; epic status derived (14-05) |
| RECD-09 | 14-01, 14-02 | progress and roadmap visible, folded | ✓ SATISFIED | region, `cycle_progress` 900+ full-count test; allowlist entry preserves the unbounded read the requirement demands |
| RECD-10 | 14-06 | close prompts per epic; drift stated | ✓ SATISFIED | `close_cycle`, dialog, `cycle_scope_drift` |
| VIS-01 | 14-04, 14-07 | single component, source gate | ✓ SATISFIED | `StateBadge`, gate; `merged` coverage accepted per UAT test 1 |
| VIS-02 | 14-07 | D-11 superseded by name | ✓ SATISFIED | SUPERSEDES table, spec strike-through, brand-rule test |
| VIS-03 | 14-08 | CVD pairs | ✓ SATISFIED | `cvd.test.ts` (text and wash; marks/edges transitive) |
| VIS-04 | 14-08, 14-09 | contrast vs shipped bytes | ✓ SATISFIED | `contrast.test.ts` plus drift tests |
| VIS-06 | 14-03, 14-09 | seeded demo board | ✓ SATISFIED | demo DB and seeder; owner's seed report |
| VIS-07 | 14-10 | owner sign-off, screenshot | ✓ SATISFIED | `14-OWNER-VERDICT.md`, `screenshots/` |

All nine IDs appear in at least one PLAN's frontmatter and in `REQUIREMENTS.md`. No orphaned IDs: `REQUIREMENTS.md` maps exactly these nine to Phase 14. VIS-05 is mapped to Phase 18 and correctly not claimed here.

### Anti-Patterns Found

| File | Pattern | Severity | Impact |
|---|---|---|---|
| Phase-modified source (cycle/epic/theme/state files) | `TBD` / `FIXME` / `XXX` | None found | no debt-marker blockers |
| `packages/core/src/domain/epic.rs:653-676` | `pub` helper that deliberately writes a canonical column and appends no event; its event pairing lives in the caller | ℹ️ Info (advisory) | see `coincidental_reliance_items` — the drift truth is correct today because cycle.rs is the only caller, not because anything enforces it |
| `packages/core/tests/epic_context_packet.rs` allowlist | entries are function-granular (`chunk_identifier` matches the enclosing `fn`/`const` name), so a future unbounded SELECT added inside `cycle_progress` is silently allowed | ℹ️ Info | pre-existing gate design, not introduced by Phase 14; the fix used the mechanism as built |
| `projects/ProjectRail.tsx:363`, `fleet/BlockedQueue.tsx:86`, `session/PermissionRequestCard.tsx:286` | state colour via `--blocked-text-rack` / `--destructive-text-rack`, outside StateBadge, no glyph beside the numeral/word | ℹ️ Info (accepted) | owner accepted as-is, UAT test 2; no rewire owed in Phase 14 |
| `14-REVIEW.md` WR-03 | a planned Cycle ranked before the active one is not shown and cannot be a close target | ⚠️ Warning (latent) | reachable only from core code; there is no IPC to start a Cycle |
| `14-REVIEW.md` WR-01/02/04/05, IN-01..08 | dev-script and latent issues | Info/Warning | recorded by the advisory review; none blocks a criterion |

Observation retained from the previous report: in the shipped application a Cycle can only be created, started and given epics through the seeder or core code — there is no IPC to create, start or assign. No Phase 14 criterion requires one (RECD-08/09/10 are about the record, the display and the close), so it is not a gap, but a user cannot yet reach the region with their own data. Worth a board issue for the next milestone.

### Human Verification Required

None. The previous report's three items were answered by the owner (`14-UAT.md`, status complete, 3 passed / 0 issues / 0 pending) and are carried here as overrides; re-verification produced no new item. Criterion 6 is itself a human act, already discharged in `14-OWNER-VERDICT.md`.

### Gaps Summary

No gaps, and no regression from either post-verification fix commit. Both fixes were re-read line by line and re-proven by their own gate targets plus every cycle target that depends on their behaviour: `acca627d` preserves the parameter binding and the same-transaction event append (the scope-drift derivation, which reads those events, is still green), and `465464f3` names one function in a name-keyed allowlist whose planted-violation half still fires. The residue is unchanged and all of it is now decided rather than open: criterion 5's ordering clause is false as git history and carried by the owner's recorded ruling; criterion 3's `merged` clause holds on the owner's accepted vacuous reading; the three legacy state-colour consumers are accepted as a data channel; and the goal's "the board carries saturated state colour" is accepted on the fleet-surface reading. One new advisory, not a gap: `epic::set_epic_cycle_in_tx` is `pub` and silent, so the invariant "every Cycle membership change leaves an event" is now enforced by its two callers rather than by structure — one gate test asserting cycle.rs is its only caller would restore it. The known filed todos (1–7 in the verdict, plus the post-verdict `agent_run.abandoned` event finding) were not re-reported here.

---

_Verified: 2026-10-16T00:34:37Z_
_Verifier: Claude (gsd-verifier)_
