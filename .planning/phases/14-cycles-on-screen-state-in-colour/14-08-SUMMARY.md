---
phase: 14-cycles-on-screen-state-in-colour
plan: 08
subsystem: state-vocabulary
tags: [colour, cvd, contrast, forced-colors, accessibility, vis-03, vis-04]
requires: ["14-04", "14-07"]
provides:
  - "theme/cvd.ts: three colour-vision simulations (Machado 2009, severity 1.0, linear sRGB), CIE76 separation on the simulated pair, one rounding rule, TEXT_FLOOR 10 and WASH_FLOOR 2.3"
  - "theme/__tests__/cvd.test.ts: every unordered pair of the five classes, text and wash, both modes, three deficiencies (120 checks, pair count pinned)"
  - "contrast.test.ts: the four tinted state washes are surfaces, so all 12 text roles and 16 non-text roles are measured on them; both directions of block drift, encoding and floor-edge assertions"
  - "vitest.browser.forced-colors.config.ts and the test:browser:forced-colors script: a fourth browser arm, in Chromium"
  - "14-DIRECTION.md: the CVD method, metric and floors with reasons and rejected alternatives; the measured weakest pairs; the forced-colors findings"
affects: [14-09]
tech-stack:
  added: []
  patterns: ["a CVD simulation and a separation metric implemented in-repo beside contrast.ts", "a browser arm whose self-check asserts the substitution happened, not only the media query", "values move, floors do not: floors fixed before the numbers were seen"]
key-files:
  created:
    - packages/desktop/src/theme/cvd.ts
    - packages/desktop/src/theme/__tests__/cvd.test.ts
    - packages/desktop/vitest.browser.forced-colors.config.ts
    - packages/desktop/src/board/__tests__/browser/forced-colors.browser.test.tsx
  modified:
    - packages/desktop/src/theme/contrast.ts
    - packages/desktop/src/theme/__tests__/contrast.test.ts
    - packages/desktop/src/styles/tokens.css
    - packages/desktop/src/theme/tokens.ts
    - packages/desktop/package.json
    - .planning/phases/14-cycles-on-screen-state-in-colour/14-DIRECTION.md
decisions:
  - "CVD method: Machado, Oliveira and Fernandes 2009 at severity 1.0 in linear sRGB; metric CIE76 on the simulated pair; rounding to the nearest 8-bit channel, then to two decimals, pass on >=. Reasons and rejected alternatives are in 14-DIRECTION.md."
  - "Two floors, fixed before any pair was measured: ink pairs 10, wash pairs 2.3 (the just-noticeable difference). A wash is a reinforcing channel held to the text-contrast budget, so it is held to the lower floor; no floor moved afterwards."
  - "Nine values moved, none of the floors: light failed text #db1f2f to #bb1b28 (5.7 to 11.2 from needs-you under deuteranopia), and the eight washes by 0.5 to 3 CIE76 units inside the 4.5:1 and 3:1 budget."
  - "The forced-colors arm runs in Chromium, not WebKit: forced colors is a Windows mechanism (WebView2 is Chromium), and WebKit reports the media query but substitutes nothing."
  - "The forced-colors fallback is a measured no-op: nothing was added to styles/tokens.css. The wash is the one channel the system discards."
requirements-completed: [VIS-03, VIS-04]
metrics:
  duration: "about 35 minutes"
  completed: 2026-10-15
status: complete
actuals:
  tokens: 11000
  tasks: 3
  commits: 4
commits: 4
plan_head_before: e6d41506abbad2a7a03e72879985e1fbbae89121
---

# Phase 14 Plan 08: Colour-vision, contrast and forced-colors proofs Summary

Every pair of state colours is now asserted distinguishable under protanopia, deuteranopia and tritanopia (120 checks, pair count pinned at ten), every text and non-text role is measured on every state wash in both modes against the shipped stylesheet bytes, and a fourth browser arm in Chromium proves each state keeps its glyph, its word and its boundary when the system replaces the colours. The proofs found seven real failures; nine values moved and no floor did.

## What was built

- **Task 1** (`8b64ace7` RED, `fa9cb80a` GREEN). `theme/cvd.ts`: Machado 2009 severity-1.0 matrices applied in linear sRGB, CIE76 difference on the simulated pair, one rounding rule stated in the header and applied identically in the test. `cvd.test.ts` opens with the primitives (a grey is unchanged under all three, the three transforms differ on a known red, deterministic and lowercase-hex output, the metric is 0 for equal and 100 for black on white), then asserts symmetry, both floors as edges (a grey constructed at the floor passes and the next 8-bit step fails), and the every-pair loop. `contrast.ts` now exports `hexToRgb` and `linearize` so the new module reuses them. 14-DIRECTION.md's CVD section holds the choices, reasons, rejected alternatives and measured pairs.
- **Task 2** (`b25fc899`). The four tinted state washes join `SURFACES`, so the loops already in the file measure all 12 text roles and 16 non-text roles on them. Added: a state role missing from or wrong in the ROOT block is rejected (the dark direction already was), uppercase, three-digit, `rgb()` and `hsl()` spellings of a state colour are drift errors (byte equality on the shipped text), and both contrast floors are asserted on both sides with the file's `bandAtGap`. Every pre-existing assertion is untouched (the diff removes no line from the test). The 14-DIRECTION.md ground-lightness section gained a "Measured by plan 14-08" subsection.
- **Task 3** (`dc434f1c`). `vitest.browser.forced-colors.config.ts`, the `test:browser:forced-colors` script, and `forced-colors.browser.test.tsx` (22 tests per arm). It opens with the engine self-check, then asserts the substitution itself (ink equals `CanvasText` and is not the class token), glyph present and sized in every variant, word and accessible name, a 1px solid edge on all four sides, ten pairs told apart by glyph and word, and that the wash is discarded. The same file runs in the ordinary, dark and motion arms and asserts the opposite there.

## Findings, measured

**Seven pair checks failed before any value moved** (of 120): light text needs-you `#966708` against failed `#db1f2f` under deuteranopia at 5.68 (floor 10), and six wash checks between 0.60 and 2.24 (light running/merged under protanopia and deuteranopia, light needs-you/failed under tritanopia, light running/failed under protanopia, dark failed/quiet under protanopia 1.28, dark needs-you/failed under deuteranopia 1.49). This is the hue-only separation 14-04 warned about. Dark text passed everywhere.

**What moved.** Light failed text to `#bb1b28` (same hue and saturation, darker; 11.2 from needs-you, 5.93:1 on the worst ground; the lighter direction is not available, `#e12d3c` is 4.21:1). Eight washes by a bounded search within 15 degrees of hue (25 in dark), subject to every text role at 4.5:1 and every non-text role at 3:1 on the candidate, then minimum movement. Shipped nearest pairs: light text 10.9 (running/quiet) and 11.2, dark text 19.3, light wash 2.6, dark wash 2.6.

**The light text pairs sit within one unit of the floor on two pairs.** That is where the next hue shift in 14-09 can break the proof.

**Contrast, now over the washes.** Weakest text pair: light `blockedTextRack` on the selected row surface 4.53 (4.55 on the running and merged washes), dark brand text lift 4.51 on the selected row surface and the running wash. Weakest non-text: `stateFailedEdge` 3.01 in both modes. Nothing in the existing matrix failed when the washes were added.

**Light washes cannot get much stronger.** With each wash within 15 degrees of its hue, the best arrangement the search found keeps every pair 2.5 or more apart (shipped 2.6, floor 2.3). Freeing the hue reaches more, but only by turning the failed wash orange and the merged wash blue. 14-09 must re-run `cvd.test.ts` after any wash it moves.

**Forced colors.** WebKit with `forcedColors: "active"` reports the media query true and substitutes nothing (the computed `color` stayed `rgb(150, 103, 8)`), so the arm is Chromium, the WebView2 engine. Under the substitution all five inks, glyphs and edge borders become `CanvasText`; the wash background becomes `Canvas`; the edge variant keeps its 1px border. The five states are told apart by glyph and word alone, asserted for all ten pairs. No stylesheet block was needed.

**For 14-09 (not done here, per the hand-off).** The needs-decision and CI-failed chips in `BoardRow.tsx` still spend `--destructive-strip`. Measured in the forced arm: each keeps its glyph, its word and a 1px solid border forced to `CanvasText`, same as the edge variant, so the rewire needs no forced-colors fix. In ordinary light they ink `rgb(207, 34, 46)`. Asserted in the same file.

## Verification

- `npx vitest run src/theme/__tests__/cvd.test.ts`: 27 passed. `contrast.test.ts`: 193 passed (142 before). `src/theme`: 261.
- `npx vitest run` (whole desktop suite): 97 files, 1684 passed, 2 expected fail (baseline was 1606 across 96 files).
- `npx tsc --noEmit` and `npx tsc -p tsconfig.browser-tests.json --noEmit`: both clean. Clean before, clean after.
- Browser arms: default, dark and motion each 17 files, 147 passed, 1 expected fail, 1 skipped; forced-colors 1 file, 22 passed.
- No dependency added: 12 dependencies and 13 devDependencies before and after. `cvd.ts` imports nothing outside the repository.
- Mutations: planting a wash that dulls the muted ink fails `contrast.test.ts` naming the mode, role and surface; setting the edge border to 0px fails the forced-colors arm; running the forced test under WebKit with the claim set fails the engine and substitution self-checks.

## TDD Gate Compliance

Task 1 has a RED commit (`8b64ace7`, 17 tests failing on assertions against an identity stub, not on an unresolved import) and a GREEN commit (`fa9cb80a`). Tasks 2 and 3 extend measurements over values that already satisfied them, so they have no red phase: each is a test-only commit, and the mutations above are the proof that they bite. That is disclosed here rather than presented as a RED.

## Deviations from Plan

**1. [Rule 3 - Blocking] The forced-colors arm is Chromium and does not use `mergeConfig`.**
- **Found during:** Task 3. WebKit reports the media query and substitutes nothing, so an arm in the plan's "dark and motion pattern" would pass while measuring the ordinary world. `mergeConfig` concatenates arrays, which would have run WebKit as well.
- **Fix:** spread the base config, one Chromium instance, `include` narrowed to the forced-colors test (every other browser test measures painted colour, which forced colors removes by definition).
- **Files modified:** `vitest.browser.forced-colors.config.ts`. **Commit:** `dc434f1c`.

**2. [Rule 3 - Blocking] `contrast.ts` edited, though the plan does not list it.** `hexToRgb` and `linearize` gained `export` so `cvd.ts` reuses them rather than copying. **Commit:** `fa9cb80a`.

**3. [Rule 1 - Plan text] Two acceptance checks could not be satisfied as written.** The `TEXT_ROLES`/`NON_TEXT_ROLES`/`SURFACES` literal-count one-liner counts quoted strings, but 14-04 built those lists with spreads, so it cannot see the state roles; the semantic counts are 12 text roles, 16 non-text roles and 9 surfaces. The `SURFACES` target of 10 assumed the quiet wash is a surface; it is the transparent rest value and equals the ground, as `rowSurface` does, so the count is 9. The one-liner also carried the stray `\&\&` from XML escaping.

**4. [Scope] The pairwise-distinctness assertions the plan asks for already existed.** 14-04's wash test asserts the five inks and five washes pairwise distinct; they were not duplicated.

**5. [Scope] The ground-lightness section.** The direction document says 14-09 fills it; the plan says this plan writes what it measured. A "Measured by plan 14-08" subsection was added and 14-09's paragraph was left in place.

**Total deviations:** 1 engine/config change, 1 unlisted export, 2 plan-text mismatches, 1 section split. **Impact:** none on the requirements. No floor moved and no dependency was added.

## Known Stubs

None.

## Threat Flags

None. A test configuration, a pure module and token values only; no network, auth or file-access surface.

## Self-Check: PASSED

`cvd.ts`, `cvd.test.ts`, `vitest.browser.forced-colors.config.ts` and `forced-colors.browser.test.tsx` exist. Commits `8b64ace7`, `fa9cb80a`, `b25fc899` and `dc434f1c` are in `git log`. `git rev-list --count e6d41506..HEAD` was 4 at write time.
