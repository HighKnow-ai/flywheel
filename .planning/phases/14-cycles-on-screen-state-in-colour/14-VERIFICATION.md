---
phase: 14-cycles-on-screen-state-in-colour
verified: 2026-10-16T12:00:00Z
status: human_needed
score: 11/12 must-haves verified
covered_files:
  - ".planning/REQUIREMENTS.md"
  - "packages/core/src/db/migrations/0024_cycles.sql"
  - "packages/core/src/domain/cycle.rs"
  - "packages/core/src/query/cycle_progress.rs"
  - "packages/core/tests/spine_pin.rs"
  - "packages/desktop/src/board/CycleCloseDialog.tsx"
  - "packages/desktop/src/board/CycleRegion.tsx"
  - "packages/desktop/src/legend/StateBadge.tsx"
  - "packages/desktop/src/theme/__tests__/contrast.test.ts"
  - "packages/desktop/src/theme/__tests__/cvd.test.ts"
  - "packages/desktop/src/theme/__tests__/state-token-gate.test.ts"
covered_digest: "v1:sha256:f3409a6acff610aaed45a5b66bd2f630f85c6dd6355c85b6d4c0807a49a6434f"
behavior_unverified: 0
overrides_applied: 1
overrides:
  - must_have: "A written hierarchy statement for the region exists before the visual work and the built region realises it (ordering clause)"
    reason: "14-HIERARCHY.md (f853e244, 18:45) is NOT a git ancestor of CycleRegion.tsx's first commit (a5c6f7d7, 18:20, plan 14-01 tracer slice); the plan's own verify one-liner exits 1. It DOES predate every commit that shaped the three levels (8db0e8d8 onward). No history was rewritten. The git fact stands; only the acceptance is recorded here."
    accepted_by: "Cyril Marechal (owner), as recorded in 14-OWNER-VERDICT.md section 'Criterion 5: the ordering ruling'"
    accepted_at: "2026-10-16"
gaps: []
human_verification:
  - test: "Decide whether `merged` satisfies criterion 3's 'every state on screen ... merged ... is rendered by the single component'."
    expected: "Either (a) accept that `merged` is defined, tokenised, CVD/contrast/forced-colours tested but drawn on no surface (vacuously satisfied: no merged state is on screen through the component), or (b) require a surface to draw it through StateBadge (plan a follow-up). Today the merge outcome (review/MergeConfirmSheet.tsx), the integrated-branch line (review/ReviewSurface.tsx:383) and the worktree reclaim reason (fleet/WorktreeInventory.tsx:68, 'merged into its epic') all show the word 'merged' as plain text, outside StateBadge."
    why_human: "The criterion's wording ('every state on screen') and its intent (saturated state colour for the states the developer cares about) point in different directions; this is a reading of the contract, not something a test can settle."
  - test: "Decide whether legacy state-coloured consumers outside StateBadge are acceptable under criterion 3."
    expected: "The source gate guards only the `--state-*` namespace. `projects/ProjectRail.tsx:363` (Blocked count, `--blocked-text-rack`), `fleet/BlockedQueue.tsx:86` (the word 'Blocked'), `session/PermissionRequestCard.tsx:286` (`--blocked-text-rack` / `--destructive-text-rack`) and the rail's 'Needs decision' count still colour a state through the older roles, with no glyph beside the numeral/word. Accept as a data channel and Phase 18 per-surface work, or fold them through StateBadge."
    why_human: "Only the rail's 'Needs decision' red/amber mismatch is in the filed todos; the other three bypasses are new to this report. Whether they count as 'a state rendered outside the single component' is a judgement."
  - test: "Look at the board's first screen (not the fleet) and confirm it carries saturated state colour 'on a surface worth looking at'."
    expected: "In the owner-judged screenshots the only state colour visible on the board surface is the two rail numerals (Blocked amber, Needs decision red, neither through StateBadge). Epic rows draw no state at all, and task-row chips (Blocked on FLY-1020, Needs Decision on FLY-1031) appear only inside expanded epics. 14-DIRECTION.md measures 2 saturated rows of 1038 (0.19%). The fleet surface (6 of 6 rows saturated) is where the colour actually lives."
    why_human: "The goal says 'the board finally carries saturated state colour'. The owner saw this and answered 'all good to me', but this report cannot tell whether he meant the fleet or the board. Known todos 4 and 6 cover the epic rows and the dark wash; this item is the goal-level reading of them."
---

# Phase 14: Cycles On Screen, State In Colour Verification Report

**Phase Goal:** Cyril sees where the work stands without going to look (the current Cycle's goal and progress and the roadmap ahead of it, folded from real counts) and the board finally carries saturated state colour on a surface worth looking at, with colour as the fastest channel and never the only one.
**Verified:** 2026-10-16
**Status:** human_needed
**Re-verification:** No, initial verification

## Verdict in one paragraph

Every roadmap criterion is backed by code and tests that exist and are wired, and the two criteria the owner had to judge (5 and 6) have their artefacts on disk and consistent with their claims. No truth FAILED outright. One clause (criterion 5, ordering) is false as a git fact and carried by an owner-recorded override; I have not marked it satisfied. One clause of criterion 3 (merged on screen) is UNCERTAIN and routes to the owner. Status is therefore `human_needed`, not `passed`. The phase goal as worded ("the board finally carries saturated state colour on a surface worth looking at") is the weakest-evidenced part of the phase, see human item 3.

## Goal Achievement

### Observable Truths

| # | Truth (roadmap criterion) | Status | Evidence |
|---|---|---|---|
| 1 | C1: current Cycle's goal, ordering, progress and the roadmap ahead are on the board without navigating; progress folded from every epic's real task counts, equals a full count over 900+ tasks; no stored percentage; no date/duration/capacity/velocity column in schema or UI; column set an exact allowlist | VERIFIED | `CycleRegion.tsx` mounted at `BoardView.tsx:1156`, reads `cycle_region` IPC (`adapters/tauri.ts:1631`, registered `main.rs:169`). `query/cycle_progress.rs` uses grouped `COUNT(*)` joins with no LIMIT/ORDER; `tests/cycle_progress.rs::the_fold_equals_an_independent_full_count_over_more_than_900_tasks` and `the_fold_total_is_strictly_greater_than_the_board_page`. Region prints the integer pair (`"412/940 tasks done"`), test asserts no `%` in the region text; no `%`, `Math.round`, `toFixed`, `Date` in `CycleRegion.tsx` / `CycleCloseDialog.tsx`. Schema: `0024_cycles.sql` has 10 columns, no stored progress. `spine_pin.rs` pins `cycles` DDL byte-for-byte (`CYCLES_DDL_PIN`) and `the_spine_pin_fires_on_a_planted_ddl_change` proves an added column on `cycles` fails. `pm_vocabulary_gate.rs` scans `.sql`, `core/src`, `desktop/src` for the ten PM words and checks calendar-point / work-span column fragments on `cycles`. Note: `created_at`/`updated_at` exist; the gate exempts them as audit pair "owner confirmed 2026-10-15". Minor: "its ordering" is expressed by rank order of later lines; no ordinal is printed for the current Cycle (it is first by position). |
| 2 | C2: closing a Cycle asks per unfinished epic; scope drift stated on the Cycle's own row; an epic in at most one Cycle; Cycles never nest; FK chain above `epics` ends at the cycle table | VERIFIED (with a reading, below) | `domain/cycle.rs::close_cycle` refuses a close with any unfinished epic lacking a disposition (bails naming the epic), refuses duplicates, closed/self targets; one transaction with one event per disposition. `tests/cycle_close.rs` covers each (15 tests incl. agent/system actor refused, DTO has no apply-to-all shape). `CycleCloseDialog.tsx`: both state maps start empty, three radio choices, confirm disabled until every row decided, no header/bulk control. Scope drift derived from event log (`query/cycle_scope.rs`, `tests/cycle_scope_drift.rs`), rendered on the active Cycle's facts row (`data-cycle-scope-drift`, and visible in the screenshots: "10 epics added since this Cycle started"). "At most one Cycle": single nullable `epics.cycle_id`. "Never nest": `cycles` has no self-reference, pinned by DDL pin. `spine_pin.rs::no_table_other_than_epics_references_the_cycle_table` asserts `referencing == ["epics"]`. |
| 3a | C3: every state rendered by one component that is the only consumer of `--state-*` tokens, always glyph + word/accessible name; a direct reference fails the build | VERIFIED | `legend/StateBadge.tsx`: no prop removes the glyph; `hideLabel` substitutes `role="img"` + `aria-label` with the word. `grep -e "--state-"` over `src` outside `__tests__` returns only `StateBadge.tsx`, `styles/tokens.css`, `theme/tokens.ts` (definitions). `theme/__tests__/state-token-gate.test.ts` fails on any other production file naming the prefix, two-sided (planted fixtures fire / stay silent, `.state-*` class namespace not conflated, case and look-alike code points). `RUN_STATUS_COLOR_ROLES` no longer exists anywhere in `packages/`. Callers: BoardRow, FleetSurface, SessionSurface, RunsSection, OrphanRecoveryModal. Gate is a vitest test (the repo's house pattern, as `brand-rule.test.ts`), so "fails the build" means "fails the test suite"; there is no separate bundler-level check. |
| 3b | C3: every pair of state colours distinguishable under protanopia, deuteranopia, tritanopia | VERIFIED | `theme/cvd.ts` (in-repo, no dependency) and `cvd.test.ts`: all 10 unordered class pairs x text and wash x 2 modes x 3 deficiencies, asserted with a pair-count guard, plus primitive tests (symmetry, floor edge both sides). Scope note: `edge` and `mark` roles are not paired directly; they sit in the same hue family as their class `text`, so coverage is transitive but not asserted. |
| 3c | C3: every text role contrast-checked against every surface tint it can appear on, both modes, against the shipped stylesheet bytes | VERIFIED | `contrast.test.ts`: `TEXT_ROLES` (incl. all 5 state inks) x `SURFACES` (incl. the four state washes) per mode, and a separate "every state wash keeps every text role at 4.5:1". The numbers come from the typed `PALETTES`; "shipped bytes" is carried by `driftErrors(mode, tokensCssSource)` (raw `tokens.css`), per-role block-aware corruption tests for all 20 state roles in both blocks, and a lowercase-hex byte-encoding check. Transitive, not a direct parse of the number from the CSS, but the drift tests are adversarially built. |
| 3d | C3: forced-colors mode keeps every state readable | VERIFIED | `board/__tests__/browser/forced-colors.browser.test.tsx` runs in real Chromium with forced colours (config `vitest.browser.forced-colors.config.ts`) plus an ordinary-colour arm; asserts the substitution actually happened, 1px solid boundary on all four sides, wash discarded, and every pair of the five classes told apart by glyph and word. Orchestrator ran it: 22 passed. |
| 3e | C3: "every state on screen, running, blocked, failed, awaiting review, **merged**, proposals pending, is rendered by the single component" | UNCERTAIN (WARNING, human decision requested) | `merged` is in `STATE_VOCABULARY`, has tokens, a mark (`run-merged`), and is in the CVD / contrast / forced-colours matrices, but no surface calls `<StateBadge state="merged">` (call sites: `BoardRow` blocked / needs_decision / ci_failed / proposals_pending; the rest pass run/fleet status, which has no merged). `14-DIRECTION.md` says as much: "merged (no surface draws it)". The word "merged" appears as plain text in `MergeConfirmSheet`, `ReviewSurface:383`, `WorktreeInventory:68`. Also: `ProposalRow.tsx:299` and `ChallengeRow.tsx:49` draw the proposal mark directly in muted ink rather than through StateBadge (they draw the proposal itself, not a state flag, so I treat this as not a gap). See human items 1 and 2. |
| 4 | C4: decision naming D-11 in a SUPERSEDES table; spec, brand allowlist and tests amended in the same change incl. `RUN_STATUS_COLOR_ROLES`; `merged` and `awaiting review` registered in the marks legend | VERIFIED | `14-DIRECTION.md` section "SUPERSEDES" has a row for `08.1-CONTEXT.md` D-11 (what stands / what is void) and two spec rows. `08.1-UI-SPEC.md` (now under `.planning/milestones/v0.1.0-phases/...`) strikes item 6 (D-199) and the pending-proposal bullet; `brand-rule.test.ts` asserts the voided uses stay struck and out of the allowlist. Commit `c0df838a` moves code, allowlist and spec together; the decision doc is `bfbdd76a`, five minutes earlier, same plan. `legend/marks.ts:515,522` define `run-awaiting-review` and `run-merged`. Note: nothing enforces that the SUPERSEDES table names D-11 as a test; I verified it by reading the document. |
| 5a | C5: built and judged on a seeded demonstration board carrying every state live, realistic count, lead row real work | VERIFIED | `scripts/demo-board.sh` + `core/tests/bin/demo_board.rs`; the DB on disk (read-only query): 5 cycles (FLY-1 active), 278 epics, 760 tasks, 9 issues (1,038 items), agent_runs running 2 / blocked 1 / failed 1 / completed 1 / abandoned 1, 3 pending proposals. Lead epic FLY-1015 "14-03: the demonstration board, seeded from Flywheel's own .planning/..." is real work, in_progress. The criterion's own state list (VIS-06) does not include `merged` or `ci_failed`, so their absence from the board is not a criterion-5 gap (it is a criterion-3 matter, item 3e). |
| 5b | C5: a hierarchy statement exists **before** the visual work | PASSED (override), AT RISK | See "Criterion 5 ordering" below. The git fact is that the statement is not an ancestor of the component's first commit. |
| 5c | C5: the built region realises the hierarchy statement | VERIFIED | `14-HIERARCHY.md` names focal point (roster leads, region orients) and three levels. `CycleRegion.tsx` realises them: Level 1 heading-step goal clamped to two lines plus facts row, Level 2 one-line later Cycles in rank order, Level 3 container + one divider, no colour declared in the region. `14-DIRECTION.md` records the statement's own five-step procedure run on the demo board: the pre-shaping region FAILED steps 1 and 2, was reshaped (3593dfa1, f14813ac), and passed after. Two honest caveats recorded there: Level 2 is in primary ink not muted, and step 5 (absences) was not exercised in the running app (held by unit tests: "No cycle is active.", "No tasks in this cycle yet", "no epics yet"). The "Close this cycle" bordered button sits in Level 1 although the statement lists "any control" under what must not compete there; it is a visible control, the owner saw it. |
| 6 | C6: owner signs off looking at the running application on that board, screenshot recorded | VERIFIED (a human act, see caveats) | `14-OWNER-VERDICT.md`: "yes", verbatim "all good to me", 2026-10-16. `screenshots/cycle-region-dark.png` and `cycle-region-light.png` exist, are 2400x1600 PNGs, and their sha256 equal those in the verdict and in `capture-manifest.json`. Both images, viewed by me, show the real Flywheel window on the demo board (FLY project, Cycle FLY-1 region, 4 later cycles, FLY-1015 lead roster row). All four committed together in `54ebb22f`. The manifest names `target/debug/desktop` (profile debug, `builtThisRun: true`, `honoursAppDataSeam: true`), the demo DB, source commit `75d986ee` with empty `dirtyFiles`, and lists the stale `target/release/desktop` under `notUsed`. Caveats stated plainly: the verdict records he viewed the running app in **Dark**, and it is **not known** whether he switched to Light live; Light was seen as a captured image. The judged binary is the one he launched himself; the manifest's is the capture run's. Both screenshots include the "Flywheel 0.1.1 is available" update popover covering the lower roster rows. |

**Score:** 11/12 truths verified (including 1 PASSED by override); 1 UNCERTAIN; 0 present-but-behavior-unverified.

### Criterion 5 ordering: judged explicitly

The clause "A written hierarchy statement ... exists before the visual work" is **not satisfied as written**.

- `f853e244` (14-HIERARCHY.md) is 2026-10-15 18:45. `a5c6f7d7` (CycleRegion.tsx created, plan 14-01 tracer) is 18:20. I re-ran `git merge-base --is-ancestor f853e244 a5c6f7d7`: exit 1. The plan's own verify command fails.
- What the earlier file contained: a 55-line component (goal at the heading step, a muted fraction, a divider) and its test. That is a minimal visual slice, not nothing.
- What does hold: the statement predates `8db0e8d8` (19:11) and every later commit that shaped the levels (`e57f81ec`, `3aca15ec`, `3593dfa1`, `f14813ac`). It is also true that the statement then changed the built region (14-09 reshaped it after failing the statement's steps 1 and 2), so it governed in practice.
- No history was rewritten. The owner was shown the fact and accepted it; `14-OWNER-VERDICT.md` records that. The acceptance does not make the git fact untrue, and I carry it as an override (`overrides_applied: 1`), not as a pass.
- Structural cause, for future phases: tracer-first plan ordering (14-01 builds the end-to-end slice including the component) and a statement-first criterion (14-02 writes the statement) were in tension and the phase plan did not reconcile them. A future phase with a "statement before visual work" criterion should either put the statement in the first wave ahead of the tracer, or state that the tracer is exempt.
- One minor overclaim: the header comment in `CycleRegion.tsx` says the hierarchy was "written before this shape". True of the shaped version, not of the original 55 lines.

### Criterion 2 foreign-key clause: assessment

The clause reads "the cycle table has no parent, and no other table references it." Implemented: `cycles.project_id REFERENCES projects(id)` and `cycles.created_by REFERENCES actors(id)`; `spine_pin.rs` asserts the parent set is exactly `{projects, actors}`, both classified Infrastructure, and that only `epics` references `cycles`.

Assessment: **satisfied in intent, not in literal wording.** The literal "no parent" would be a zero-row `pragma_foreign_key_list('cycles')`; that is false. What the clause protects (Phase 13 criterion 1: nothing in the board spine sits above a Cycle, so the chain above `epics` cannot grow a layer) is asserted and fails closed: a new parent, a new referrer, or a new column on `cycles` fails a test. `epics` already hangs from `projects` and `actors` the same way, so reading the chain as "within the board spine" is consistent with how the spine pin already treated `epics`. The owner chose option B knowingly (2026-10-15). "No other table references it" is read as "no table other than `epics`", the only possible reading because `epics.cycle_id` is the membership. One naming nit: the test `the_chain_above_epics_terminates_at_the_cycle_table` asserts a nonzero parent set; its doc comment explains this, the name does not. I would accept this, and if the owner wants the criterion's text to stay honest, amend the ROADMAP wording to "no parent in the board spine" rather than leave it as written.

### Known-open item 5 (not exercised: `ci_failed`, `merged`, task-row proposal mark)

Judged against the criteria:

- **Criterion 5: not a gap.** Its enumerated list (and VIS-06) is running, blocked, failed, awaiting review, proposals pending, an epic mid-flight, a realistic count. `ci_failed` and `merged` are not in it. The proposal mark on a task row is covered at the epic level (3 pending proposals seeded).
- **Criterion 3: a partial gap in intent.** `ci_failed` is drawn by a wired call site (`BoardRow.tsx:379`), merely not seeded, so it is a demo-coverage shortfall. `merged` is different: no surface draws it through StateBadge at all, so criterion 3's sentence lists a state that, for the user, is not coloured anywhere. Component, tokens, CVD, contrast and forced-colours coverage exist; the user-visible rendering does not. It is not a blocker (the sentence says "on screen"), but it is the sharpest edge of criterion 3 and is human item 1.

### Required Artifacts

| Artifact | Expected | Status | Details |
|---|---|---|---|
| `packages/core/src/db/migrations/0024_cycles.sql` | cycles table, partial unique active index, `epics.cycle_id` | VERIFIED | 10 columns, state CHECK, one-active-per-project partial index |
| `packages/core/src/query/cycle_progress.rs` | folded progress | VERIFIED | grouped counts, no window |
| `packages/core/src/domain/cycle.rs` | create/start/assign/reorder/close | VERIFIED | one transaction + one event per writer; close refuses undecided epics |
| `packages/desktop/src/board/CycleRegion.tsx` | region above the roster | VERIFIED | wired in `BoardView.tsx:1156`, data flows from `cycle_region` |
| `packages/desktop/src/board/CycleCloseDialog.tsx` | per-epic close | VERIFIED | wired from the region, calls `cycle_close` |
| `packages/desktop/src/legend/StateBadge.tsx` | single consumer | VERIFIED | 5 call-site files |
| `theme/cvd.ts`, `theme/__tests__/{cvd,contrast,state-token-gate}.test.ts` | enforcement | VERIFIED | see 3a to 3c |
| `14-HIERARCHY.md`, `14-DIRECTION.md`, `14-OWNER-VERDICT.md`, `screenshots/*` | records | VERIFIED | hashes match; see criterion 6 |

### Key Link Verification

| From | To | Via | Status |
|---|---|---|---|
| `BoardView.tsx` | `CycleRegion` | `<CycleRegion projectId>` line 1156 | WIRED |
| `useCycleRegionQuery` | `cycle_region` command | `adapters/tauri.ts:1631`, `main.rs:169` | WIRED |
| `CycleCloseDialog` | `cycle_close` command | `adapters/tauri.ts:1644`, `main.rs:170` | WIRED |
| run/fleet/session/runs/recovery surfaces | `StateBadge` | `<StateBadge state=...>` | WIRED |
| `StateBadge` | `--state-*` tokens | `var(--state-${cls}-${role})` | WIRED |
| marks legend | `StateBadge` | `MARKS_BY_ID[...]` | WIRED |
| `epics.cycle_id` writes | `epic.rs` | routed in `acca627d` after the plans completed | WIRED (post-plan fix) |

### Data-Flow Trace (Level 4)

| Artifact | Variable | Source | Real data | Status |
|---|---|---|---|---|
| `CycleRegion` | `cycle.progress.tasksDone/Total` | `cycle_progress` grouped SQL over `tasks` joined to `epics` | Yes | FLOWING (screenshots show `7/27 tasks done` and 10 epics, matching the demo DB: 10 epics in the active cycle, 3+3+3+3+2+... tasks) |
| `CycleRegion` | `later[]` | `cycle_roster` | Yes | FLOWING (4 later lines on screen) |
| `StateBadge` | state value | callers pass run/fleet status and booleans from real reads | Yes | FLOWING |

### Behavioral Spot-Checks

I did not re-run suites the orchestrator already established (cargo check, tsc, desktop suite, theme envelope, browser arms, scoped core targets). Spot checks I ran myself: read-only SQLite queries on the demo DB (counts above), `shasum -a 256` on both screenshots (match), `git merge-base --is-ancestor` (exit 1, as reported), `grep -e "--state-"` over source (only the three allowed files), `grep RUN_STATUS_COLOR_ROLES` over `packages/` (no matches).

### Probe Execution

Step 7c: SKIPPED. No `probe-*.sh` is declared by the phase plans and none exists under `scripts/*/tests/` for this phase.

### Requirements Coverage

| Requirement | Source plan(s) | Description | Status | Evidence |
|---|---|---|---|---|
| RECD-08 | 14-01, 14-05 | Cycle scope-boxed and undated | SATISFIED | migration, `pm_vocabulary_gate`, `spine_pin` column pin; epic status derived (14-05) |
| RECD-09 | 14-01, 14-02 | progress and roadmap visible, folded | SATISFIED | region, `cycle_progress` 900+ full-count test |
| RECD-10 | 14-06 | close prompts per epic; drift stated | SATISFIED | `close_cycle`, dialog, `cycle_scope_drift` |
| VIS-01 | 14-04, 14-07 | single component, source gate | SATISFIED, see 3e for coverage of `merged` | `StateBadge`, gate |
| VIS-02 | 14-07 | D-11 superseded by name | SATISFIED | SUPERSEDES table, spec strike-through, brand-rule test |
| VIS-03 | 14-08 | CVD pairs | SATISFIED | `cvd.test.ts` (text and wash; marks and edges transitive) |
| VIS-04 | 14-08, 14-09 | contrast vs shipped bytes | SATISFIED | `contrast.test.ts` plus drift tests |
| VIS-06 | 14-03, 14-09 | seeded demo board | SATISFIED | demo DB and seeder |
| VIS-07 | 14-10 | owner sign-off, screenshot | SATISFIED | `14-OWNER-VERDICT.md`, `screenshots/` |

All nine IDs appear in at least one PLAN's frontmatter and in `REQUIREMENTS.md` (traceability rows all "Complete"). No orphaned IDs: `REQUIREMENTS.md` maps exactly these nine to Phase 14. VIS-05 is mapped to Phase 18 and is correctly not claimed here.

### Anti-Patterns Found

| File | Pattern | Severity | Impact |
|---|---|---|---|
| Phase-modified source (cycle/state/theme files scanned) | `TBD` / `FIXME` / `XXX` | None found | no debt-marker blockers |
| `projects/ProjectRail.tsx:363`, `fleet/BlockedQueue.tsx:86`, `session/PermissionRequestCard.tsx:286` | state colour via `--blocked-text-rack` / `--destructive-text-rack`, outside StateBadge, no glyph next to the numeral | Warning | human item 2 |
| `14-REVIEW.md` WR-03 | planned Cycle ranked before the active one is not shown and cannot be a close target | Warning (latent) | reachable only from core code, there is no IPC to start a Cycle |
| `14-REVIEW.md` WR-01/02/04/05, IN-01..08 | dev-script and latent issues | Info/Warning | already recorded by the advisory review; none blocks a criterion |

Observation not in the todos: in the shipped application a Cycle can only be created, started and given epics through the seeder or core code; there is no IPC to create, start or assign. No Phase 14 criterion requires one (RECD-08 to 10 are about the record, the display and the close), so it is not a gap here, but a user cannot yet reach the region with their own data.

### Human Verification Required

#### 1. Is `merged` allowed to be defined but drawn nowhere?

**Test:** Read criterion 3's sentence ("every state on screen, running, blocked, failed, awaiting review, merged, proposals pending, is rendered by the single component") against the fact that no surface renders `merged` through StateBadge.
**Expected:** Owner chooses: accept (vacuous on-screen reading) or plan a surface.
**Why human:** a reading of the contract.

#### 2. Are the legacy blocked/destructive colour consumers acceptable?

**Test:** Rail Blocked count, BlockedQueue "Blocked" label, PermissionRequestCard, rail "Needs decision" count colour a state outside StateBadge with no glyph beside the figure.
**Expected:** Accept as data channel or schedule folding them through StateBadge. The source gate cannot see this class because it only matches `--state-*`.
**Why human:** only one of the four is in the filed todos.

#### 3. Where does the state colour live, and was that what he approved?

**Test:** Compare the goal's "the board finally carries saturated state colour" to the owner-judged screenshots and to 14-DIRECTION.md's measured 2-of-1038 board rows and 6-of-6 fleet rows.
**Expected:** Owner confirms the verdict covered the fleet as the colour surface, or opens a follow-up (known todos 4 and 6 are the mechanisms).
**Why human:** his three-word verdict does not say which surface he meant.

### Gaps Summary

No gaps. Nothing in the six criteria is missing, stubbed or unwired. The residue is: a criterion-5 ordering clause that is false as git history and carried by an owner-recorded acceptance; a criterion-3 clause (`merged` on screen) that holds only vacuously; legacy state-colour consumers the source gate cannot see; and a goal-level question about where the saturated colour actually appears. The known filed items (1 to 4, 6 to 8) were not re-reported. The two post-plan cross-phase regressions (`465464f3`, `acca627d`) are recorded by the orchestrator as fixed and I confirmed the only non-test `UPDATE epics SET cycle_id` is in `domain/epic.rs:672`.

---

_Verified: 2026-10-16_
_Verifier: Claude (gsd-verifier)_
