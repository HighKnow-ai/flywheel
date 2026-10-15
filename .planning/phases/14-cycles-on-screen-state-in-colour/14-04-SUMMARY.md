---
phase: 14-cycles-on-screen-state-in-colour
plan: 04
subsystem: state-vocabulary
tags: [tokens, colour, state, legend, source-gate, vis-01]
requires: ["14-01"]
provides:
  - "twenty --state-* custom properties (needs-you, running, failed, merged, quiet times text, wash, edge, mark) in both mode blocks of styles/tokens.css"
  - "the typed per-mode mirror of them in theme/tokens.ts"
  - "legend/StateBadge.tsx: the only consumer of the state tokens, STATE_VOCABULARY and stateClassOf"
  - "marks run-awaiting-review and run-merged in the legend registry"
  - "theme/__tests__/state-token-gate.test.ts: a two-sided source gate over every production file"
affects: [14-07, 14-08, 14-09]
tech-stack:
  added: []
  patterns: ["values derived by search with the ratio recorded beside each", "a sibling two-sided source gate over import.meta.glob ?raw", "one component as the sole consumer of a token namespace"]
key-files:
  created:
    - packages/desktop/src/legend/StateBadge.tsx
    - packages/desktop/src/legend/__tests__/state-badge.test.tsx
    - packages/desktop/src/theme/__tests__/state-token-gate.test.ts
  modified:
    - packages/desktop/src/styles/tokens.css
    - packages/desktop/src/theme/tokens.ts
    - packages/desktop/src/theme/__tests__/contrast.test.ts
    - packages/desktop/src/legend/marks.ts
    - packages/desktop/src/legend/runStatus.ts
    - packages/desktop/src/legend/__tests__/legend.test.tsx
    - packages/desktop/src/fleet/__tests__/fleet-surface.test.tsx
decisions:
  - "Token spelling is --state-<class>-<role>, classes needs-you, running, failed, merged, quiet; roles text, wash, edge, mark. The component is StateBadge in legend/, props state, variant (text, wash, edge, mark) and hideLabel."
  - "awaiting review REPLACES the old reuse of the In Review mark: RUN_STATUS_MARK_IDS.awaiting_review is now run-awaiting-review (Eye). The status channel keeps In Review for task status."
  - "merged takes the GitMerge glyph, shared on purpose with the criteria channel's Integrated: one fact, one glyph."
  - "An unknown state renders quiet, prints its raw value, and wears the Backlog mark's dashed circle (the registry's one glyph that claims nothing about a state)."
  - "The dark washes are a faint tint (1.02 to 1.04 on the ground) because the weakest existing text role, the dark brand text lift, leaves almost no luminance budget. Raising that lift is the precondition for a stronger dark wash."
requirements-completed: [VIS-01]
metrics:
  duration: "about 40 minutes"
  completed: 2026-10-15
status: complete
actuals:
  tokens: 60000
  tasks: 3
  commits: 4
commits: 4
plan_head_before: fbf27b48b8f5fb0beebeb2528ae4fde6a6393be1
---

# Phase 14 Plan 04: The state vocabulary Summary

Five state classes defined by meaning, four token roles each (twenty `--state-*` properties in both mode blocks, mirrored in the typed palette), values derived by search against the 4.5 and 3:1 floors, one component (`StateBadge`) that is their only consumer and always draws a glyph plus a word or accessible name, and a two-sided source gate that fails the build when any other production file names a `--state-*` token.

## What was built

- **Task 1** (`c362858a`): the `--state-*` block in the root and the dark block of `styles/tokens.css`, the matching 20 keys on `Palette`, `LIGHT` and `DARK`, and in `contrast.test.ts` the state inks added to `TEXT_ROLES`, the marks and edges to `NON_TEXT_ROLES`, a wash test (every text role keeps 4.5:1 on every state wash, five inks and five washes pairwise distinct), a quiet-class test, and `stateQuietWash` added to `SAME_BY_DESIGN` (the transparent rest value, as `rowSurface`). Nothing was removed or re-valued, no task workflow status got a token, and the brand-hex line count in the stylesheet is 9 before and after.
- **Task 2** (`b748bb08` RED, `5cf6f228` GREEN): `legend/StateBadge.tsx`, two marks in the `agent` channel (`run-awaiting-review` Eye, `run-merged` GitMerge), `RUN_STATUS_MARK_IDS` made to agree, and the registry tests (agent channel 20 to 22, total 54 to 56) plus a new describe covering the two marks through the legend. `Legend.tsx` was not edited (0 diff lines).
- **Task 3** (`514038ea`): `theme/__tests__/state-token-gate.test.ts`, a sibling of `brand-rule.test.ts` (reason in its header), 10 tests.

## The derivation (values by search, not by eye)

Per class a hue and a saturation held across modes, lightness stepped 1% at a time, run with the WCAG maths of `theme/contrast.ts`. Hue and saturation: needs-you 40/90, running 190/80, failed 355/75, merged 270/60.

1. WASH first: from the ground toward the ink until the weakest existing text role on it was about to drop under 4.5, keeping 0.02 clear.
2. TEXT: first step clearing 4.5 on the worst of the five surfaces AND the four washes.
3. MARK: first step clearing 3:1 on the worst surface (its own floor).
4. EDGE: as mark with saturation 20 points lower, so a 1px outline around text is calmer than the glyph beside it.

| mode | class | text | mark | edge | wash | weakest existing text on wash |
|---|---|---|---|---|---|---|
| light | needs-you | #966708 4.61 | #bd810a 3.10 | #b68420 3.10 | #fef6e7 | #9a6700 4.53 |
| light | running | #10798e 4.71 | #149cb8 3.02 | #2c9aaf 3.08 | #edfafd | #9a6700 4.56 |
| light | failed | #db1f2f 4.60 | #e9636e 3.02 | #d67179 3.01 | #fef6f7 | #9a6700 4.58 |
| light | merged | #9150d3 4.56 | #ab78dd 3.03 | #a37ec8 3.07 | #faf7fd | #9a6700 4.59 |
| dark | needs-you | #aa7409 4.72 | #835a07 3.11 | #7e5b16 3.08 | #130d01 | brand lift 4.59 |
| dark | running | #1289a1 4.64 | #0e6a7c 3.05 | #1f6b7a 3.12 | #021012 | brand lift 4.59 |
| dark | failed | #e33b49 4.52 | #c01b29 3.11 | #ae323d 3.01 | #240508 | brand lift 4.53 |
| dark | merged | #9c60d7 4.59 | #8237cd 3.06 | #7a49ab 3.05 | #140821 | brand lift 4.59 |

Light text is measured on its worst ground, the needs-you wash; mark and edge on the selected row surface `#f5f7f9`. In dark, text, mark and edge are all measured on `#101010`, the selected row surface. The same table sits in the comments of both mode blocks. Quiet takes the existing muted ink for text and mark, the control boundary for edge, and the transparent rest value for wash. The same ratios are held by tests in `contrast.test.ts`.

## Verification

- `npx vitest run` over the whole desktop suite: 95 files, 1591 passed (2 expected fail), including the new gate over the real tree.
- `npx vitest run src/theme/__tests__/`: 172 passed. `npx vitest run src/legend src/fleet`: 171 passed.
- `npx tsc --noEmit`: only the two known `brand-rule.test.ts` `node:fs` errors, which plan 14-07 owns. The new gate imports nothing from `node:fs`.
- Acceptance greps: 20 and 20 state declarations with equal name sets (node one-liner exit 0); `state[A-Z]` in tokens.ts 60; task-status tokens 0; brand hex line count 9 before and after; StateBadge literal colours 0, `MARKS_BY_ID` 3, `role=`/`aria-label` 2; `merged` 4 and `awaiting` 5 in marks.ts; `Legend.tsx` diff 0 lines; gate: `import.meta.glob` 1, `toBeGreaterThan` 1, `states-and-confirms` 6.
- Failure message, captured by appending `const planted = "var(--state-failed-text)";` to `legend/Legend.tsx` and reverting it with `git checkout -- <that file>`: `Render the state through the one component, legend/StateBadge.tsx (<StateBadge state="..." />), which always draws a glyph and a word beside the colour. If a second consumer is genuinely needed, widen CONSUMER or DEFINITIONS in theme/__tests__/state-token-gate.test.ts and say why in 14-HIERARCHY.md or the phase direction document.: expected [ 'legend/Legend.tsx' ] to deeply equal []`.

## Deviations from Plan

**1. [Rule 3 - Blocking] `contrast.test.ts` edited, though the plan does not list it.**
- **Found during:** Task 1. The new `stateQuietWash` is the same transparent value in both modes, so the existing "no token is declared identically in both modes" test would fail without a `SAME_BY_DESIGN` entry. The plan's behaviours (floors, wash AA, distinct inks) also need a test to hold them, and 14-08 extends a matrix that did not yet contain the state roles.
- **Fix:** the entry, the roles in the two role lists, and two small tests. Plan 14-08 still owns the CVD, per-mode and forced-colors proofs.
- **Commit:** `c362858a`.

**2. [Rule 3 - Blocking] `fleet-surface.test.tsx` edited, though the plan does not list it.** It pinned `RUN_STATUS_MARK_IDS.awaiting_review` to `status-in-review`, which D-19 replaces. One assertion and its title changed. **Commit:** `5cf6f228`.

**3. [Weak RED, disclosed] The RED run failed on an unresolved import** (`../StateBadge` did not exist), not on an assertion. It is a real failure for the right file but not the intentional assertion failure `tdd.md` describes. The tests then went green without being edited for behaviour; one assertion was corrected (see 4).

**4. [Rule 1 - Bug in my own test] The edge test asserted `borderLeftWidth` was empty.** jsdom expands the `borderWidth` shorthand to all four sides, so the test now asserts all four sides are `1px`, which is the stronger statement of "no side stripe".

**Total deviations:** 2 blocking-rule additions, 1 disclosed weak RED, 1 self-corrected test. **Impact:** none on scope; every acceptance criterion holds.

## Hand-offs

- **14-07** (delete the old consumers): `RUN_STATUS_COLOR_ROLES` in `legend/runStatus.ts` still exists and still spends the brand and the data channels. Route the five consumers (fleet row, runs section, session badge, blocked chip, pending-proposal chip) through `<StateBadge>`. The gate is already live, so any of them that names a `--state-*` token directly fails the build.
- **14-08** (CVD, per-mode, forced colours): needs-you (amber), running (teal), failed (red) and merged (violet) are spread by hue only, with the glyph and the word as the redundant channels. Quiet text equals muted ink by design, so it is distinguished only by saturation.
- **14-09** (tuning): the dark washes are 1.02 to 1.04 against the ground and may not read at all. The cause is the dark brand text lift (4.55 on `#0f0f0f`) which caps the wash luminance; raise the lift first or accept that dark carries state in text, edge and mark and not in wash. The prohibition (the board must not read as permanent alarm) is the figure to count there: simultaneously saturated rows on the demonstration board, where `needs-you` covers blocked, awaiting review and abandoned (3 of the 11 live runs) plus pending proposals.
- `awaiting_review` and `needs-you`: in the fleet the state now has the Eye glyph, not the In Review circle.

## Known Stubs

None. `StateBadge` has no consumer yet by design (14-07 wires them); the gate is the only thing that references it.

## Threat Flags

None. No network, auth, file-access or schema surface was added.

## Self-Check: PASSED

`StateBadge.tsx`, `state-badge.test.tsx` and `state-token-gate.test.ts` exist; commits `c362858a`, `b748bb08`, `5cf6f228` and `514038ea` are in `git log`; `git rev-list --count fbf27b48..HEAD` was 4.
