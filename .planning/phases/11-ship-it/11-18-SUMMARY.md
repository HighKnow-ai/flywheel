---
phase: 11-ship-it
plan: 18
subsystem: contracts-and-brand-rule
tags: [d-197, d-198, d-199, requirements, ui-spec, brand-rule, type-scale, deferred-review]
requires: ["11-13", "11-14"]
provides:
  - AGNT-07 narrowed to the shipped refusal, with a dated note citing D-197 and the harness that measured it
  - 01-UI-SPEC.md amended four ways (D-198.1 to .4); the task row tail prints a value or nothing; the 10px type role deleted
  - 08.1-UI-SPEC.md brand rule widened to seven permitted uses (D-199) and enforced by brand-rule.test.ts from the shipped bytes
  - .review-anchor-widget on the neutral control edge instead of a 2px side stripe
  - D-REV-01, 13, 28 and 30 closed in the register; eight 11-17 rows outside D-197/198/199 handed to D-196 filing
affects: [11-21 (D-196 board filing: eight rows plus one owner decision), the owner (the developer's turn colour)]
actuals:
  tokens: 26000
  tasks: 3
  commits: 5
tech-stack:
  added: []
  patterns:
    - "an enforcement test that reads production source through an eager `import.meta.glob(..., { query: '?raw' })`, with one allowlist keyed by file and a count, so a new use in an already-listed file also fails"
    - "a spec-phrase check: the allowlist's `spec` phrases must appear in the spec section it mirrors, so the code and the document can only move together"
key-files:
  created:
    - packages/desktop/src/theme/__tests__/brand-rule.test.ts
  modified:
    - .planning/REQUIREMENTS.md
    - docs/destructive-gate-trust-boundary.md
    - .planning/phases/01-the-board-is-the-store-of-record/01-UI-SPEC.md
    - .planning/phases/08.1-visual-polish-brand-assets-and-confirmed-motion-inserted/08.1-UI-SPEC.md
    - packages/desktop/src/board/BoardRow.tsx
    - packages/desktop/src/session/FeedRow.tsx
    - packages/desktop/src/board/pickers/AssigneePicker.tsx
    - packages/desktop/src/styles/type.css
    - packages/desktop/src/review/review.css
    - packages/desktop/src/review/FileDiff.tsx
    - packages/desktop/vitest.config.ts
    - .planning/DEFERRED-REVIEW.md
    - .planning/phases/11-ship-it/11-FINISH-REVIEW.md
key-decisions:
  - "The developer's turn stays in the brand (FeedRow.tsx:458 is NOT changed). D-199 did not cover it and the owner left it open; moving it to ink with nothing in its place would leave the feed with no channel telling the two speakers apart. The spec records it as an existing use plan 11-18 did not decide, the test allowlists it by name, and it goes to 11-21 as an owner decision."
  - "The test found two more existing brand uses nobody had listed, the pending-proposal count on an epic row (D-82) and ::selection. Both are recorded the same way, as existing and undecided, rather than removed or hidden."
  - "AGNT-07's narrowing is a note beneath the requirement, not a silent reword, so the disagreement and its resolution stay auditable (T-11-49)."
requirements-completed: [DIST-04]
coverage:
  - id: D1
    description: "AGNT-07 reads 'refused before it reaches the remote, and the user is told' with a dated D-197 note naming uat-03-destructive-gate.mjs; no ask-and-block wording survives (D-REV-01)."
    requirement: "DIST-04"
    verification:
      - kind: other
        ref: "grep gates on .planning/REQUIREMENTS.md: 'require explicit confirmation' 0, 'refused before it reaches the remote' 1, 'D-197' 1"
        status: pass
    human_judgment: false
  - id: D2
    description: "A task row prints no criteria count at 0/0 and no priority glyph at No priority; a real count and priority still print (D-198.1, D-REV-13)."
    requirement: "DIST-04"
    verification:
      - kind: unit
        ref: "packages/desktop/src/board/__tests__/row-tail.test.tsx#prints no criteria count at 0/0 and no priority glyph at no priority (D-198.1)"
        status: pass
      - kind: unit
        ref: "packages/desktop/src/board/__tests__/row-tail.test.tsx#still prints a real criteria count and a real priority glyph"
        status: pass
    human_judgment: false
  - id: D3
    description: "Nothing renders below 11px: three FeedRow sites and the assignee picker moved to type-label, .type-micro deleted, zero references remain (D-198.3, D-REV-30)."
    requirement: "DIST-04"
    verification:
      - kind: other
        ref: "grep -rn type-micro packages/desktop/src returns 0 lines"
        status: pass
      - kind: automated_ui
        ref: "npm --prefix packages/desktop run test:browser -- src/board src/session (6 files, 35 passed), including the scope-denied row-height test at 11px"
        status: pass
    human_judgment: false
  - id: D4
    description: "01-UI-SPEC carries the four D-198 amendments, the Done-warning string transcribed from DoneWarning.tsx, and the key-alignment leave-as-is record."
    requirement: "DIST-04"
    verification:
      - kind: other
        ref: "grep gates on 01-UI-SPEC.md: 'criteria unchecked' 2, 'D-198' 6"
        status: pass
    human_judgment: false
  - id: D5
    description: "The brand rule lists seven uses plus three recorded existing uses, and a test over the shipped source fails on any brand-token use outside the allowlist, on an allowlist use the spec does not name, and on a coloured 2px side border outside the selection rule (D-199, D-REV-28)."
    requirement: "DIST-04"
    verification:
      - kind: unit
        ref: "packages/desktop/src/theme/__tests__/brand-rule.test.ts (4 tests); the side-border assertion was shown red by temporarily restoring the old 2px ink border on .review-anchor-widget"
        status: pass
    human_judgment: false
  - id: D6
    description: ".review-anchor-widget carries the neutral control edge, not a 2px side stripe."
    requirement: "DIST-04"
    verification:
      - kind: unit
        ref: "packages/desktop/src/review/__tests__/finish.test.tsx#draws the anchor badge with the neutral control edge; criteria-rail.test.tsx asserts the control-edge class on the rendered badge"
        status: pass
      - kind: automated_ui
        ref: "npm --prefix packages/desktop run test:browser -- src/review (4 files, 32 passed)"
        status: pass
    human_judgment: false
  - id: D7
    description: "Whether the developer's own turn should keep the brand colour, or move to ink with a different speaker channel."
    verification: []
    human_judgment: true
    rationale: "A design-direction call the owner left open in D-REV-28 and D-199. It is a decision, not a verification step, so it is not deferred under the human-verification rule; it is filed as an owner decision at 11-21."
duration: ~25 min
completed: 2026-10-13
status: complete
commits: 5
plan_head_before: 50b6019c18a6d0eb18d35f6297453480f930417c
---

# Phase 11 Plan 18: Contracts that match the product, and a brand rule that is tested Summary

**D-197, D-198 and D-199 implemented: AGNT-07 narrowed to the shipped refusal, the Phase 1 UI contract amended to the product (empty tail, shipped Done string, 11px floor), and the brand rule widened to seven uses with a test that reads the shipped source and fails when code and spec drift apart.**

## Performance

- **Duration:** ~25 min
- **Tasks:** 3 of 3
- **Commits:** 5 task and register commits, measured from the persisted ledger (`plan_head_before` above); this summary and the state update follow
- **Files:** 20 changed in the five commits, +265 / -70 lines

## What was done

1. **Task 1, AGNT-07 (D-197), commit edcbc09.** The requirement now reads "A destructive action ... is refused before it reaches the remote, and the user is told, even when the session is running in an auto-accept permission mode". It keeps its id, its `[x]` and its Phase 3 placement. A sub-line records the narrowing: date, D-197, the old claim of an ask-and-block, the `PreToolUse` and `pre-push` refusal, and `scripts/uat/uat-03-destructive-gate.mjs` as the harness that measured it twice. `docs/destructive-gate-trust-boundary.md` had one sentence (line 695) that still said the agent "stops and asks"; it is reworded. No code changed. The rest of that document already says the hook "never waits, so it can never be the layer that asks a human", which agrees.
2. **Task 2, the Phase 1 contract (D-198), commit 8698b12.**
   - **D-198.1:** `BoardRow.tsx` renders no criteria count when the total is 0 and no priority glyph when the priority maps to the no-priority mark. `row-tail.test.tsx` pins both the empty and the non-empty case (the old test asserting `0/0` was inverted). Row Anatomy's "never dropped" list is amended and says why.
   - **D-198.2:** the Copywriting Contract and the State Inventory row carry `{key} · {unchecked} of {total} criteria unchecked. Mark Done anyway?`, transcribed from `DoneWarning.tsx`, not from CONTEXT.md.
   - **D-198.3:** three `FeedRow.tsx` sites (the system notice, the scope-denied path and its widen button) and the `AssigneePicker.tsx` badge moved to `type-label`; the two tests and the board-group fixture that named the class moved with them; `.type-micro` is deleted from `type.css`; the Typography table's Micro row is struck through with the citation.
   - **D-198.4:** key alignment on pill-bearing rows is recorded in Row Anatomy as deliberate and left as it is, with D-198's reason.
3. **Task 3, the brand rule (D-199), commit 5dbf6ef, fix ffe1b60.** `08.1-UI-SPEC.md` lists seven permitted uses and the rejected alternative. `.review-anchor-widget` loses its 2px side stripe for the `control-edge` class (added in `FileDiff.tsx`). `brand-rule.test.ts` is the enforcement (below).
4. **Register, commit 34f51f2.** D-REV-01, 13, 28 and 30 closed with an `update_11-18` line each; `11-FINISH-REVIEW.md` gains a "Plan 11-18 outcome" section.

## The two decisions the plan asked for

**The developer's turn (`FeedRow.tsx:458`): widened, not changed.** The plan said to decide deliberately. D-199 did not include the developer's turn and the owner left it open, so there were two defensible moves: change the colour, or record it. The colour is the feed's only channel separating the developer's words from the agent's (`assistant_text` is ink, there is no speaker label), so moving it to ink with no replacement would remove information from the Socratic authoring surface, a change the owner has not asked for. Inventing a replacement channel (a label, a typographic change) is a design call that is also not mine. So the line is unchanged, `08.1-UI-SPEC.md` names it under "Three further existing uses, recorded by plan 11-18 and NOT decided by D-199", and the test allowlists it by name with the spec phrase. The test is not loosened: it still fails on any brand use that is not listed, and the list is in the spec. It is filed at 11-21 as an owner decision.

**The register was partly stale on `.review-anchor-widget` (correction one).** D-REV-28 said the widget "draws a 2px BRAND left border". It did not: A-08/D-12 had already made the border `var(--text-primary-rack)`, ink, and a comment in `review.css` says so. What remained was the SHAPE, a 2px side stripe, which is the weight A-06 reserves for the selection rule and the pattern the craft floor's side-border ban names. That is what was fixed. The `update_11-18` line on D-REV-28 says so.

## The enforcement test

`packages/desktop/src/theme/__tests__/brand-rule.test.ts` reads every production `.ts`, `.tsx` and `.css` file through an eager `import.meta.glob` with `?raw` (tests excluded, token definitions excluded), strips comments, and asserts:

1. it really read the source (more than 50 files, `App.css` contains `::selection`), so a stubbed `?raw` cannot pass vacuously;
2. the brand-token occurrences per file equal the allowlist exactly (12 files, 17 occurrences), so a new use anywhere, or a second use in a listed file, fails;
3. every use the allowlist names has its phrase in `08.1-UI-SPEC.md` § The brand rule, so widening the code without the document fails;
4. no line declaring a left or right border has a coloured 2px-or-wider stroke other than `--selection-rule`, `${selectionRule}` or `transparent`. Shown red by restoring the old ink stripe temporarily.

## Deviations from Plan

**1. [Rule 3 - Blocking] `vitest.config.ts` changed (not in the plan's file list).** Vitest stubs `.css` to empty unless listed in `css.include`. The test needs every stylesheet's real text for the side-border scan, so a catch-all `/src\/.*\.css$/` was appended, with a comment. Commit 5dbf6ef.

**2. [Rule 3 - Blocking] The spec is read with `node:fs`, not `?raw`.** Vite refuses `?raw` for a path outside the package root ("Denied ID"). The source scan still uses `?raw` (the plan's grep gate for it passes). The spec read follows the workspace's `icons.test.ts` pattern and the typed `node-shims.d.ts`, because the workspace carries no `@types/node`; the first version failed `tsc` and was fixed in ffe1b60.

**3. [Documented gate defect] The plan's `border-left: 2px` grep gate cannot read 0.** `review.css:133` has `border-left: 2px solid transparent`, the unselected half of the selection rule (A-06), which is legitimate. The gate counts it. The meaningful version of the gate is the side-border assertion in `brand-rule.test.ts`, which allows exactly the selection rule and nothing else; it passes.

**4. [Rule 2 - Missing critical] Three existing brand uses recorded, not planned for.** The test's first run listed `::selection`, the pending-proposal count and the developer's turn as uses outside D-199's list. They are recorded in the spec as existing and undecided (above) rather than removed or silently allowed.

**5. [Rule 1 - Bug, found while editing] Two tests moved with the code.** `finish.test.tsx` asserted the old ink side stripe and now asserts its absence; `criteria-rail.test.tsx` gained a `control-edge` assertion on the rendered badge.

**Total deviations:** 5 (2 blocking, 1 gate defect, 1 missing-coverage, 1 test follow-through). **Impact:** none on the decisions; the plan's files plus `vitest.config.ts`.

## Register corrections found while doing it

1. **D-REV-28** said the anchor widget drew a BRAND left border; it was already ink. The shape was the defect.
2. **D-REV-28** listed three brand uses outside the rule (run status, authoring stage, developer's turn) plus links and actions; the test found two more unlisted ones, the pending-proposal count and `::selection`.

## Plan 11-17 rows addressed to this plan (15)

- **Closed here (7):** one-8, five-8, app-shell-6 (D-198.1); four-8 (D-198.3); two-8, six-5 (D-199 permits the run status); and the D-REV-30 type-micro half. four-2 is recorded, not closed (above).
- **Outside D-197/198/199, handed to 11-21 for D-196 filing (8):** one-2, one-3, one-4, three-3, three-4, three-5, four-4, review-foot-2. Of these, three-4 and review-foot-2 were NOT on 11-17's list for 11-21 and must be added. four-2 goes to 11-21 as an owner decision. All of this is in `11-FINISH-REVIEW.md` § "Plan 11-18 outcome".

## Known Stubs

None.

## Threat Flags

None. T-11-49 (silent requirement reword) is met: the narrowing carries its date, decision id and measuring harness, and the grep gates require them. T-11-50 (brand rule widened in code only) is met by the single allowlist with the spec-phrase check. T-11-51 (sub-floor text) is met: zero `type-micro` references remain.

## Verification run

- `npm --prefix packages/desktop test`: 88 files, 1459 passed, 2 expected fail (1454 before this plan).
- `npm --prefix packages/desktop run test:browser -- src/board src/session`: 6 files, 35 passed. `-- src/review`: 4 files, 32 passed. The review run overwrote two Phase 08 UAT screenshots; they were restored with `git checkout`.
- `npx tsc --noEmit -p .` in `packages/desktop`: clean.
- Not run, per the hazards listed in the plan brief: `packages/core/tests/credentials.rs`. No core test was touched.

## Self-Check: PASSED

`brand-rule.test.ts`, `11-18-SUMMARY.md` and the amended documents exist; commits edcbc09, 8698b12, 5dbf6ef, 34f51f2 and ffe1b60 are present; no file under `.github/workflows/` or `scripts/release/` was touched; the grep gates (type-micro 0, `criteria unchecked` 2, D-198 6, `?raw` 4, spec phrases 3, D-197 1) pass.
