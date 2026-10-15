---
phase: 14-cycles-on-screen-state-in-colour
plan: 09
subsystem: state-vocabulary
tags: [colour, tuning, hierarchy, demonstration-board, roster, vis-06, vis-03, vis-04]
requires: ["14-02", "14-03", "14-06", "14-08"]
provides:
  - "The Cycle region bounded to what the eye can use (loud goal two lines, each later Cycle one line, width its container's) so the epic roster keeps the lead"
  - "cycle-region.browser.test.tsx: 18 tests per appearance holding the structure of 14-HIERARCHY.md in an engine, plus the shell-widening and roster-ladder regressions the live app exposed"
  - "BoardRow needs-decision and CI-failed pills drawn through StateBadge (needs-you and failed), no longer red"
  - "StateBadge.rowVariant: needs-you and failed are drawn on a wash in list rows, the rest in ink; the fleet uses it"
  - "Light needs-you wash #fefcec -> #fffad3 (8.3 to 20.0 CIE76 from the ground), with theme/__tests__/wash-visibility.test.ts measuring that a wash can be seen"
  - "14-DIRECTION.md: per-class wash decisions with the rejected alternative as seen, the saturated-row count, the ground-lightness floor confirmed with the board as evidence, the region judgement"
affects: [14-10]
tech-stack:
  added: []
  patterns: ["tuning judged in the running application against the seeded board, in both appearances", "a bounded search for what a wash could be inside every gate, instead of asking whether the ratio passes", "layout defects found live are pinned by a browser test that reproduces them before the fix"]
key-files:
  created:
    - packages/desktop/src/board/__tests__/browser/cycle-region.browser.test.tsx
    - packages/desktop/src/board/__tests__/state-pills.test.tsx
    - packages/desktop/src/theme/__tests__/wash-visibility.test.ts
  modified:
    - packages/desktop/src/board/CycleRegion.tsx
    - packages/desktop/src/board/BoardRow.tsx
    - packages/desktop/src/App.css
    - packages/desktop/src/legend/StateBadge.tsx
    - packages/desktop/src/fleet/FleetSurface.tsx
    - packages/desktop/src/styles/tokens.css
    - packages/desktop/src/theme/tokens.ts
    - packages/desktop/src/board/__tests__/needs-decision.test.tsx
    - packages/desktop/src/board/__tests__/ci-flag.test.tsx
    - packages/desktop/src/fleet/__tests__/fleet-surface.test.tsx
    - packages/desktop/src/legend/__tests__/state-badge.test.tsx
    - .planning/phases/14-cycles-on-screen-state-in-colour/14-DIRECTION.md
decisions:
  - "Needs-you and failed carry a wash in list rows; running, merged and quiet are ink, glyph and word. Decided on the real fleet against a wash behind all five, which made five of six rows a pastel plate."
  - "One token value moved: light needs-you wash #fefcec to #fffad3, in the stylesheet and the typed mirror in one commit. No floor constant moved."
  - "Dark needs-you wash cannot be made visible inside the envelope (best 4.79 against 4.43 shipped); stated plainly in 14-DIRECTION.md, left unmoved, handed to Phase 18's dark-first work."
  - "Ground lightness floor confirmed, not revised; the board is the new evidence. The WCAG ratio is the wrong unit for visibility, so a CIE76 distance from the ground is now asserted too."
  - "The epic roster's container ladder was wrong at the default window and is repaired from the template's own arithmetic (rungs 1160 and 940, were 900 and 640); a region judgement against a roster that reads `1...` would have been meaningless."
requirements-completed: [VIS-06, VIS-03, VIS-04]
metrics:
  duration: "about 25 minutes"
  completed: 2026-10-15
status: complete
actuals:
  tokens: 11965
  tasks: 2
  commits: 14
commits: 14
plan_head_before: 71accecbb850815342948a056051805a00353b3a
---

# Phase 14 Plan 09: Tuned on the demonstration board Summary

The state values and the Cycle region were judged on the seeded demonstration board in the real application, in both appearances. What the board showed wrong was mostly structure: a long goal filled the window and left one roster row, the roster's titles read `1...`, and needs-decision drew red beside the amber Blocked chip. All three are fixed; one token value moved (the light needs-you wash, 8.3 to 20.0 from the ground), no floor moved, and every gate in the envelope is green.

## Where it was tuned

Database `target/demo-board/appdata/flywheel.db`, re-seeded by `scripts/demo-board.sh` at the start (the precondition: banner printed, `cycles=5 epics=278 tasks=760`). Lead epic `FLY-1015` (14-03), active Cycle `FLY-1`, on screen in every capture. The debug build of the application was launched against it with its frontend from the dev server (the release binary on disk is from 12 October and predates the phase). Dark is the machine's appearance. Light was reached by switching the system appearance for the captures; it was switched back each time and is dark now.

## What was built

- **Pills (`3fcaea7c` RED, `33ee8b83`).** The needs-decision and CI-failed pills in `BoardRow.tsx` are drawn by `StateBadge` in the `edge` variant, as Blocked is. Needs Decision is now amber beside Blocked in both appearances in the running app. Two source-reading tests that pinned the old registry reads follow 14-07's blocked analog, and the "two pills differ in colour" test, whose premise D-15 voids, now asserts both are needs-you and are told apart by glyph and word.
- **The region (`4bc65c61` RED, `3593dfa1`, `1bacabfc` RED, `f14813ac`).** The loud goal is clamped to two lines beside the close control with the facts on their own row, each later Cycle is one line with an ellipsis, and the region carries `contain: inline-size`. The full goal text stays in the document and in `title`.
- **The roster ladder (`6560b73a` RED, `73685ed2`, `f3dc35ad` RED, `4bb12a56`).** `App.css`: rungs from 900 and 640 to 1160 and 940, set from the template's own arithmetic (comment in the file), and the shed strip is `display: none !important` because its inline `display: flex` beat the class rule.
- **Washes (`e85a70bc` RED, `01ab17ff` RED, `dd5cb015`).** `theme/__tests__/wash-visibility.test.ts` measures how far each wash sits from the ground in CIE76. `StateBadge.rowVariant` returns `wash` for needs-you and failed and `text` for the rest, and `FleetSurface` draws through it. The light needs-you wash moved in `styles/tokens.css` and `theme/tokens.ts` together.
- **Record (`ad4ddb64`).** `14-DIRECTION.md` gained the settled-values section, the confirmed ground floor, the saturated-row count and the hierarchy judgement.

## Findings, measured on the running application

**The three structural defects** (each reproduced by a failing browser test before the fix):
1. A 10-line goal and four 4-line later Cycles left one roster row on screen. The seeded goals are whole roadmap paragraphs; a real goal has no length limit either.
2. The application shell is a flex row whose content child has no `min-width: 0`, so the first clamped goal widened the whole board past the window (shell scrolled 1886 over 1200). Fixed inside the region; the shell is still the root cause.
3. At the default 1016px pane every roster title was `1...` (22px). Pre-existing since 08.1; two defects in the ladder, described above.

**Wash visibility, CIE76 from the ground** (new, pinned by `wash-visibility.test.ts`):

| | needs-you | running | failed | merged |
|---|---|---|---|---|
| light, before / shipped | 8.25 / **20.0** | 4.15 | 3.76 | 5.40 |
| dark | 4.43 | 4.14 | 16.93 | 15.31 |

A bounded search (every 8-bit colour within 15 degrees of the hue that clears every text and non-text floor and keeps every wash pair 2.5 or more apart) found the light needs-you wash could reach 25.5 and shipped 20.0. **Dark needs-you cannot be fixed inside the envelope:** best 4.79 against 4.43 shipped. It is bounded by the dark brand text lift (4.51 on the running wash, floor 4.5), amber needs both red and green, and a move from hard to see to slightly less hard is not a tuning. It is left unmoved and said so in `14-DIRECTION.md`; a dark needs-you state is carried by ink, glyph and word.

**Saturated rows, counted in the application** (identical in both appearances; what differs is how much is seen): fleet 6 of 6 (needs-you 3, running 2, failed 1; 4 on a wash); board 0 of 278 epic rows and 2 of 760 task rows (Blocked on FLY-1020, Needs Decision on FLY-1031), 2 of 1038 or 0.19 percent. The board does not read as an incident dashboard. The fleet is a list of states by construction and the shape is half needs-you, calm running ink, one red. Not exercised: `ci_failed` (not seeded), `merged` (no surface draws it), a proposal mark on a task row.

**14-03's question, answered: yes, the app shows running and blocked on first launch.** After launch `agent_runs` held running 2, blocked 1, abandoned 1, completed 1, failed 1; the fleet listed Blocked, Awaiting review, Abandoned, Running x2 and Failed; the board showed the Blocked chip. The predicted residue is real: each launch writes three false `agent_run.abandoned` events (7 in the database after two launches: 1 seeded, 6 false).

**Hierarchy judgement** (full account in `14-DIRECTION.md`). Before: step 1 and step 2 failed. After, both appearances: all five steps pass except step 5, which was not forced in the app (it is held by 14-01 and 14-02's tests in words). The region realises the statement's structure. Named for 14-10: the perceptual half is the owner's (`verification: backstop`); the four later Cycles are in primary ink and may be the busiest part of the region, which is a statement amendment if his squint lands on them; and the ordering constraint below.

## Verification

- `npx vitest run src/theme`: 7 files, 265 passed (cvd, contrast, state-token gate, brand, motion, icons, wash-visibility).
- `npx vitest run` (whole desktop suite): 1694 passed, 2 expected fail (baseline 1684 plus the 10 added here).
- Browser arms: default, dark and motion each 18 files, 165 passed, 1 expected fail, 1 skipped (was 147; the region file is 18 tests per appearance); forced-colors 22 passed.
- `npx tsc --noEmit` and `npx tsc -p tsconfig.browser-tests.json --noEmit`: both clean.
- No Rust touched; `cargo check` not run.
- `cycle-region.browser.test.tsx` under the light and dark configs: 18 passed each (plan floor: 7). `getComputedStyle` 18 uses, `board-view` 3.
- Stylesheet and mirror moved together: over `71accecb..HEAD`, `styles/tokens.css` and `theme/tokens.ts` each changed in the same commit (`dd5cb015`). The plan's one-liner checks only `HEAD`, which is a docs commit by the time anyone runs it, so it was applied to the whole range instead.
- No floor constant changed: 0 lines matching the plan's four patterns in `contrast.test.ts` and `cvd.test.ts` over the range.
- Mutation reasoning: each new browser test failed before its fix (a 7-line loud goal, two-line later Cycles and a region taller than its pane; shell scroll 1886 over 1200; roster title 22px, then four of seven widths and the strip not hidden; light needs-you 8.25 under 15).

## TDD Gate Compliance

Task 2 and the three layout defects each have a RED commit that failed on a real assertion and a GREEN commit after it (see the commit list). The pills, the wash visibility test and the fleet rule are the same shape. `rowVariant`'s unit tests were written alongside the implementation in the GREEN commit, after the fleet RED had failed on an assertion; that is disclosed here rather than presented as a separate RED.

## Deviations from Plan

**1. [Rule 1 - Bug] The needs-decision and CI-failed pills.** The hand-off from 14-07 and 14-08, within scope, fixed (`33ee8b83`). Three existing tests changed with it, as above.

**2. [Rule 1 - Bug] The shell widened by a long goal, the roster title `1...`, and the ladder's shed that never happened.** Found only because the region was opened in the running application; none is in the plan's file list. Fixed with RED tests first. `App.css` is outside `files_modified`; it is the roster the hierarchy statement says leads, and the region judgement could not be made against a roster that read `1...`.

**3. [Rule 2 - Scope] `StateBadge.rowVariant` and a `FleetSurface` change.** The plan asks which states get washes; with no consumer drawing one the decision would have been prose. Neither file is in `files_modified`. Small, tested, and the decision is now enforced rather than advised.

**4. [Plan text] The ordering constraint cannot be met as written, and the plan's own verify command exits 1.** `14-HIERARCHY.md`'s first commit (`f853e244`, 18:45) is not an ancestor of `CycleRegion.tsx`'s first commit (`a5c6f7d7`, plan 14-01, 18:20): 14-01 created the file as a minimal slice (goal at the heading step, a muted fraction, a divider) twenty-five minutes before the statement was written. The statement predates every commit that shaped the three levels (`8db0e8d8` onward, this plan's included). History was not rewritten. **This is a finding for 14-10's verdict, not a pass.** The plan's precondition, "predates every commit touching `CycleRegion.tsx` in this plan", does hold.

**5. [Plan text] Stray escapes and a HEAD-only check, as predicted.** The two `git diff` one-liners compare `HEAD^..HEAD`; run over the plan's range instead. No assertion was weakened.

**6. [Environment] The system appearance was switched twice for light captures and restored each time.** Not asked for; the plan requires both appearances and the application follows the system's. Dark is the current state.

**Total deviations:** 2 bug fixes beyond the plan's files, 1 scope addition, 1 unmet plan check (reported), 2 plan-text and environment notes. **Impact:** all gates green, no floor lowered, no dependency added.

## Items to file, not done here

- **Review-queue rail "Needs decision" count is red beside the amber "Blocked" count** (`ProjectRail`, a figure not a pill): the same fact in a different class beside its own pill. Not named by this plan.
- **The application shell's content child has no `min-width: 0`** (`App.tsx` line 395 and 101): any future wide intrinsic content widens the whole board.
- **The seeder's Cycle goals include the rest of the roadmap line** (`Mode: mvp Depends on: ... Success Criteria (what must be TRUE):`). The clamp makes it harmless to the region; it still makes the demonstration board's goals unrealistic.
- **`scripts/demo-board.sh` prefers a stale release binary** over a current debug one; the release binary on disk predates Phase 14 and would show an old frontend.
- **The board's epic rows draw no state at all**, including FLY-1015 with a running agent. Whether they should is Phase 18's per-surface budget, not this phase's.

## Known Stubs

None.

## Threat Flags

None. No new network endpoint, auth path or schema change; CSS, a pure function and tests.

## Self-Check: PASSED

`cycle-region.browser.test.tsx`, `state-pills.test.tsx`, `wash-visibility.test.ts` and this file exist; the 14 task commits (`3fcaea7c` to `ad4ddb64`) are in `git log`; `git rev-list --count 71accecb..HEAD` was 14 at write time.
