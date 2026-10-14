---
phase: 01-the-board-is-the-store-of-record
plan: 02
subsystem: ui
tags: [design-tokens, css-custom-properties, archivo, variable-font, lucide-react, tdd, vitest, wcag-contrast]

# Dependency graph
requires:
  - phase: 01-the-board-is-the-store-of-record (plan 01-01)
    provides: "Tauri v2/React shell, packages/desktop/src/App.tsx boot mount, Vitest harness"
provides:
  - "The direction contract (THESIS/OWN-WORLD/STORY/FIRST VIEWPORT/FORM, seed 59b0beb9) authored in packages/desktop/index.html"
  - "styles/tokens.css + theme/tokens.ts — the one token source (rack/strip/ink roles, radius, spacing) every later board surface consumes"
  - "styles/type.css + public/fonts/ — self-hosted Archivo variable font with verified tabular figures"
  - "styles/motion.css — the single --ease curve and prefers-reduced-motion handling"
  - "legend/marks.ts (MARKS registry) + legend/Legend.tsx — the always-reachable legend surface"
  - "theme/contrast.ts — WCAG relativeLuminance/contrastRatio, proved by a runnable test suite"
  - "The four owner decisions (component strategy, typeface, icon library, radius language) locked into 01-UI-SPEC.md, binding for plans 01-03 through 01-11"
affects: ["01-03 (board list, quick-add, detail panel)", "01-04 (command palette wires in the Legend)", "01-09 (pickers hand-wired against Radix primitives)"]

# Actuals (#2632)
actuals:
  tokens: 15900
  tasks: 3
  commits: 5
plan_head_before: bebde96de21224de10a4e1f045c0b2c9128a2d25

# Tech tracking
tech-stack:
  added: ["lucide-react@1.43.0"]
  patterns:
    - "One theme source: CSS custom properties in styles/tokens.css, mirrored as typed constants in theme/tokens.ts so tests assert against shipped values, not copied literals"
    - "Row-state marks are lucide-react icon names (strings), not unicode/emoji stand-ins — resolved to real components in Legend.tsx"
    - "Row-state CSS tokens are overlays (rgba, including a fully-transparent rest state) layered on top of a row's own strip-tint background, not replacement colours"
    - "Condensed type cut produced from the same variable font file via font-stretch, not a second font file"

key-files:
  created:
    - packages/desktop/index.html (direction contract, modified not created)
    - packages/desktop/src/styles/tokens.css
    - packages/desktop/src/styles/type.css
    - packages/desktop/src/styles/motion.css
    - packages/desktop/src/theme/tokens.ts
    - packages/desktop/src/theme/contrast.ts
    - packages/desktop/src/theme/__tests__/contrast.test.ts
    - packages/desktop/src/legend/marks.ts
    - packages/desktop/src/legend/Legend.tsx
    - packages/desktop/src/legend/__tests__/legend.test.tsx
    - packages/desktop/public/fonts/Archivo-Variable.ttf
    - packages/desktop/public/fonts/OFL.txt
    - packages/desktop/public/fonts/README.md
  modified:
    - packages/desktop/index.html
    - packages/desktop/src/App.tsx
    - packages/desktop/src/App.css
    - packages/desktop/package.json
    - .planning/phases/01-the-board-is-the-store-of-record/01-UI-SPEC.md
    - DESIGN.md

key-decisions:
  - "Owner locked all four open visual-world items at once (2026-09-09): component strategy a-selfhost-radix (no shadcn), typeface Archivo, icon library Lucide, radius 2px/6px — recorded in 01-UI-SPEC.md as binding for plans 01-03 through 01-11"
  - "Archivo's condensed companion cut is produced from the SAME variable font file's wdth axis (font-stretch: 75%), not a second static file — Google Fonts merged Archivo Condensed into Archivo's wdth axis after the typeface constraint was written; verified against the upstream google/fonts repo before locking the decision"
  - "Tabular figures (tnum/lnum GSUB features) verified present in the shipped font file via direct fontTools inspection before locking the typeface decision, per the plan's explicit 'verify before locking' instruction"
  - "Row-state overlay values (row-surface/-hover/-selected/-selected-unfocused) are implementer-chosen rgba overlays layered on a row's strip tint, since 01-UI-SPEC.md states only the distinctness obligation, not exact values"
  - "MARKS registry glyphs are lucide-react icon names, not unicode glyphs — corrected during the plan's own craft-floor review after the first implementation used unicode box-drawing characters, which the review caught as a ban on icon-system stand-ins"

patterns-established:
  - "TDD task discipline for Task 3: test(01-02) RED commit (8 of 9 target assertions genuinely failing against a deliberately wrong contrast.ts stub, verified via gsd_run check tdd-red-evidence -> RED_EVIDENCE_OK) followed by feat(01-02) GREEN commit (all 15 tests passing)"
  - "No component outside styles/tokens.css and theme/tokens.ts may declare a literal hex colour — enforced by a grep gate in every subsequent plan's <verify> block"

requirements-completed: [BOARD-07, BOARD-08]

coverage:
  - id: D1
    description: "Direction contract (THESIS/OWN-WORLD/STORY/FIRST VIEWPORT/FORM, seed 59b0beb9) authored as the first child of <body> in index.html"
    requirement: ""
    verification:
      - kind: other
        ref: "grep -c '59b0beb9' packages/desktop/index.html == 1"
        status: pass
    human_judgment: false
  - id: D2
    description: "Token roles (rack/strip/ink/radius/spacing) declared once in styles/tokens.css and mirrored in theme/tokens.ts; no component elsewhere declares a literal hex colour"
    requirement: ""
    verification:
      - kind: other
        ref: "grep -rlE '#[0-9a-fA-F]{6}' packages/desktop/src | grep -vcE 'styles/tokens\\.css|theme/tokens\\.ts' == 0"
        status: pass
    human_judgment: false
  - id: D3
    description: "Every contrast ratio 01-UI-SPEC.md records is proved by a runnable test importing the shipped token values"
    requirement: ""
    verification:
      - kind: unit
        ref: "packages/desktop/src/theme/__tests__/contrast.test.ts (9 tests)"
        status: pass
    human_judgment: false
  - id: D4
    description: "The four row-state surfaces are pairwise distinct and every MARKS entry carries a non-empty glyph and label"
    requirement: ""
    verification:
      - kind: unit
        ref: "packages/desktop/src/legend/__tests__/legend.test.tsx (4 tests)"
        status: pass
    human_judgment: false
  - id: D5
    description: "Archivo is self-hosted (no font CDN reference) with verified tabular figures, and the type scale/motion contract match 01-UI-SPEC.md exactly"
    requirement: ""
    verification:
      - kind: other
        ref: "grep -rEq 'fonts\\.googleapis\\.com|fonts\\.gstatic\\.com|use\\.typekit' packages/desktop/src packages/desktop/index.html — no match; fontTools GSUB inspection recorded in public/fonts/README.md"
        status: pass
    human_judgment: false
  - id: D6
    description: "The Legend surface renders real lucide-react icons (not unicode stand-ins) and the rack ground / Legend render correctly in a real tauri dev launch"
    requirement: ""
    verification:
      - kind: manual_procedural
        ref: ".impeccable/review/01-02-rack-ground.png, .impeccable/review/01-02-legend.png — captured via orca computer get-app-state against a live tauri dev launch"
        status: pass
    human_judgment: true
    rationale: "Visual rendering of a real native window (icon shapes, colour swatches actually painting as intended) is outside what an automated test asserts in this environment; verified manually this session via live screenshots and documented, but a fresh human glance is the cheapest final check for a GUI surface."

duration: ~25min
completed: 2026-09-09
status: complete
---

# Phase 1 Plan 2: Flight Progress Strips Theme Foundation Summary

**Self-hosted Archivo variable-font theme system (tokens.css/tokens.ts, type scale, one easing curve, MARKS/Legend registry) proved by a 15-test WCAG contrast suite, built on the owner's newly-locked component/typeface/icon/radius decisions.**

## Performance

- **Duration:** ~25 min
- **Started:** 2026-09-09T09:38:00+08:00 (approx.)
- **Completed:** 2026-09-09T09:58:00+08:00
- **Tasks:** 3
- **Files modified:** 20 (across 5 commits)

## Accomplishments

- Recorded the owner's decision closing all four open visual-world items at once (component
  strategy, typeface, icon library, radius language) into `01-UI-SPEC.md` as binding for the
  remaining nine plans in this phase.
- Authored the five-block direction contract (`THESIS`/`OWN-WORLD`/`STORY`/`FIRST VIEWPORT`/`FORM`,
  seed `59b0beb9`) as the first child of `<body>` in `index.html`.
- Built the one token source: `styles/tokens.css` (CSS custom properties) mirrored by
  `theme/tokens.ts` (typed constants), covering the rack/strip/ink roles, the four row-state
  overlays, `--radius-strip`/`--radius-chrome`, and the spacing scale.
- Self-hosted Archivo as a single variable font (`wght` 100–900, `wdth` 62–125) — verified its
  `GSUB` feature list contains real tabular figures (`tnum`/`lnum`) via `fontTools` **before**
  locking the typeface decision, per the plan's explicit "verify before locking" instruction.
  Discovered and documented that Google Fonts merged the separate "Archivo Condensed" family into
  this variable font's `wdth` axis, so the condensed companion cut ships from the same file via
  `font-stretch` rather than a second font.
- Authored the single motion contract (`--ease`, two durations, `prefers-reduced-motion` collapsing
  both to `0s`) and the `MARKS` registry + `Legend.tsx` surface, rendering real `lucide-react` icons.
- Implemented `relativeLuminance`/`contrastRatio` (WCAG 2.x) via genuine TDD: a `test(01-02)` RED
  commit against a deliberately wrong stub (8 of 9 target assertions failing for the right reason,
  verified via `gsd_run check tdd-red-evidence` → `RED_EVIDENCE_OK`), then a `feat(01-02)` GREEN
  commit making all 15 tests pass.
- Verified the rack ground and the Legend surface visually via a real `tauri dev` launch
  (screenshots + live accessibility tree, captured with `orca computer get-app-state`).

## Task Commits

Each task was committed atomically:

1. **Task 1: Close the four open decisions inside the chosen visual world** - `56b96b0` (docs) —
   decision checkpoint cleared by the human; recorded into `01-UI-SPEC.md`.
2. **Task 2: Author the direction contract, the token roles, the type scale and the marks
   registry** - `357af3c` (feat)
3. **Task 3: Prove the contrast ratios with a runnable assertion** - `b8cdff0` (test, RED) +
   `8fe9651` (feat, GREEN)

**Plan metadata:** commit pending (this SUMMARY + STATE.md + ROADMAP.md docs commit, below).

## Files Created/Modified

- `packages/desktop/index.html` — the direction contract comment (seed `59b0beb9`)
- `packages/desktop/src/styles/tokens.css` — the one CSS custom-property token source
- `packages/desktop/src/styles/type.css` — locked type scale + self-hosted `@font-face` + tabular figures
- `packages/desktop/src/styles/motion.css` — `--ease`, durations, `prefers-reduced-motion`
- `packages/desktop/src/theme/tokens.ts` — `RACK`/`STRIP`/`INK`/`MOTION` typed constants
- `packages/desktop/src/theme/contrast.ts` — `relativeLuminance`/`contrastRatio`
- `packages/desktop/src/theme/__tests__/contrast.test.ts` — 9 tests
- `packages/desktop/src/legend/marks.ts` — the `MARKS` registry
- `packages/desktop/src/legend/Legend.tsx` — the Legend surface (lucide-react icons)
- `packages/desktop/src/legend/__tests__/legend.test.tsx` — 4 tests
- `packages/desktop/public/fonts/` — `Archivo-Variable.ttf`, `OFL.txt`, `README.md`
- `packages/desktop/src/App.tsx` / `App.css` — imports the theme once, renders the rack ground
- `.planning/phases/01-the-board-is-the-store-of-record/01-UI-SPEC.md` — the four locked decisions
- `DESIGN.md` — the built-world record and craft-floor review

## Decisions Made

- See `key-decisions` in frontmatter above. The most consequential: Archivo's condensed cut ships
  from the same variable file via `font-stretch` rather than a second font, because Google Fonts
  retired the standalone "Archivo Condensed" package after `01-UI-SPEC.md`'s typeface constraint
  was written — confirmed against the upstream `google/fonts` repository before locking the
  decision, and documented in `public/fonts/README.md` and `01-UI-SPEC.md` § Type.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 2 - Missing Critical] Legend used unicode glyphs instead of the locked icon library**
- **Found during:** Task 2's own craft-floor review (Impeccable step 3)
- **Issue:** The first `Legend.tsx`/`marks.ts` implementation used unicode box-drawing characters
  (`□`, `◫`, `▣`, `▢`, `◎`) as mark glyphs. `craft-floor.md`'s Refuse list explicitly bans "unicode
  glyphs or emoji standing in for an icon system," and the owner's own Task 1 decision locked
  Lucide as the icon library — shipping unicode stand-ins would have both violated craft-floor and
  silently ignored a decision made minutes earlier in the same plan.
- **Fix:** Installed `lucide-react@1.43.0` (verified as the genuine, official package via `npm
  view` before installing) and changed `MARKS[].glyph` to name a `lucide-react` export
  (`Square`/`SquareDashed`/`SquareDot`/`SquareMinus`/`Focus`); `Legend.tsx` resolves the name to
  the real icon component.
- **Files modified:** `packages/desktop/src/legend/marks.ts`, `packages/desktop/src/legend/Legend.tsx`, `packages/desktop/package.json`, `packages/desktop/package-lock.json`
- **Verification:** Re-ran the detector (`detect.mjs`) — no findings; re-captured the Legend
  screenshot via a real `tauri dev` launch, confirming real icon glyphs render correctly
  (`.impeccable/review/01-02-legend.png`); `theme/__tests__/legend.test.tsx`'s
  non-empty-glyph/label assertion still passes against the new string values.
- **Committed in:** `357af3c` (Task 2 commit — fixed before commit, not as a separate follow-up)

**2. [Rule 2 - Missing Critical] Added `STRIP.referenceStock` to theme/tokens.ts**
- **Found during:** Task 3 (writing the contrast test)
- **Issue:** Two of the plan's required assertions (`#2d4fb8`/`#9c351c` on strip `#ddd6c6`) test
  against a "reference stock" swatch from `01-UI-SPEC.md`'s "Pinned brand" table that does not
  exactly match any of the five per-status strip tints already in `STRIP`. The acceptance criteria
  require the test to import every value from `../tokens` with no hex literals of its own, so this
  value needed a home in `tokens.ts`.
- **Fix:** Added `STRIP.referenceStock = "#ddd6c6"` with a comment explaining it is a
  measurement-only reference distinct from the five status tints, with no corresponding CSS custom
  property since nothing in the product renders it directly.
- **Files modified:** `packages/desktop/src/theme/tokens.ts`
- **Verification:** `contrast.test.ts` imports and asserts against it; `grep -c 'from "../tokens"'` == 1
- **Committed in:** `b8cdff0` (Task 3 RED commit)

---

**Total deviations:** 2 auto-fixed (both Rule 2 — missing critical functionality/data needed to
honor an already-locked decision or an already-specified test obligation)
**Impact on plan:** Both fixes were necessary to satisfy decisions and acceptance criteria already
locked in this same plan. No scope creep — no feature was added beyond what Task 1/Task 3 already
specified.

## Issues Encountered

- **No agent-spawning tool available to this executor.** The plan's acceptance criteria call for
  spawning the shipped `impeccable-finish-reviewer` and `impeccable-documenter` subagents by name.
  This execution environment exposes only direct tool calls (Bash, Read, Write, Edit, Skill) — no
  Task-style subagent dispatch. Substituted a self-conducted review directly against
  `craft-floor.md`'s Verify/Refuse checklist (which caught the unicode-glyph issue above) and
  authored `DESIGN.md` directly rather than via the documenter subagent. Documented explicitly in
  `DESIGN.md`'s "Review against the direction contract" section rather than silently claiming the
  named subagents ran.
- **Transient screenshot rendering artifact.** One intermediate screenshot (captured immediately
  after an HMR reload, mid font-swap repaint) showed the leftmost characters of the first heading
  and first list item as clipped. A second capture moments later, and the live accessibility tree
  in both captures, confirmed the underlying DOM/CSS was always correct — this was a capture-timing
  artifact, not a code defect. Documented in `DESIGN.md` for the record.

## User Setup Required

None — no external service configuration required.

## Next Phase Readiness

- `cargo build --workspace`, `cargo test --workspace` (11 passing), and
  `npm --prefix packages/desktop run test` (15 passing, up from 3) all green.
- `01-03`'s board list, quick-add and detail panel can consume `styles/tokens.css`/`type.css`/
  `motion.css` directly — no board surface declares its own colour, radius or easing value.
- `01-04`'s command palette has a real `Legend` component and `MARKS` registry ready to wire in as
  an always-reachable surface.
- `01-09`'s pickers are scoped against Radix primitives per the locked `a-selfhost-radix` decision
  — no shadcn dependency to remove or work around.
- No blockers.

## Known Stubs

None — this plan's own acceptance criteria ("no board surface until 01-03") are honored explicitly:
the rack ground is the only rendered surface, and it is documented as intentional in `DESIGN.md`,
not a stub.

## Self-Check: PASSED

- FOUND: packages/desktop/src/styles/tokens.css
- FOUND: packages/desktop/src/styles/type.css
- FOUND: packages/desktop/src/styles/motion.css
- FOUND: packages/desktop/src/theme/tokens.ts
- FOUND: packages/desktop/src/theme/contrast.ts
- FOUND: packages/desktop/src/theme/__tests__/contrast.test.ts
- FOUND: packages/desktop/src/legend/marks.ts
- FOUND: packages/desktop/src/legend/Legend.tsx
- FOUND: packages/desktop/src/legend/__tests__/legend.test.tsx
- FOUND: packages/desktop/public/fonts/Archivo-Variable.ttf
- FOUND: packages/desktop/public/fonts/README.md
- FOUND commit 56b96b0 (docs(01-02): record owner decisions closing the four open visual-world items)
- FOUND commit 357af3c (feat(01-02): author the Flight Progress Strips theme foundation)
- FOUND commit b8cdff0 (test(01-02): add failing tests for the contrast and legend assertions)
- FOUND commit 8fe9651 (feat(01-02): implement WCAG relative luminance and contrast ratio)

## TDD Gate Compliance (Task 3)

| Gate | Commit | Status |
|------|--------|--------|
| RED | `b8cdff0` | Present — `RED_EVIDENCE_OK` (target test `is 1 for white` failed for the right reason; see `.planning/phases/01-the-board-is-the-store-of-record/tdd-evidence/01-02-task3-red.json`) |
| GREEN | `8fe9651` | Present — all 15 tests pass |
| REFACTOR | — | Not needed; implementation was already minimal |

---
*Phase: 01-the-board-is-the-store-of-record*
*Completed: 2026-09-09*
