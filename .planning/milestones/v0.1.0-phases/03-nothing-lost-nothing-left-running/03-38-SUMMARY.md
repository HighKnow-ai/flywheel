---
phase: 03-nothing-lost-nothing-left-running
plan: 38
subsystem: security
tags: [destructive-gate, trust-boundary, friction-pricing, prose-shape-generator, requirements-bookkeeping]

requires:
  - phase: 03-nothing-lost-nothing-left-running
    provides: "03-37's '## Round nine' correction to docs/destructive-gate-trust-boundary.md (the class this plan prices) and 03-VERIFICATION.md's missing: item naming the structural blind spot this plan closes"
provides:
  - "Eight new ORDINARY_USAGE_CORPUS rows (four deny, four defer) pricing round nine's corrected plain-prose wrapper-flag-adjacency class through the real compiled hook against the real compiled shim, plus a corrected why on the pre-existing brace-flag row and raised corpus floors"
  - "PROSE_FRICTION_SHAPES / PROSE_FRICTION_TEMPLATES / proseFrictionVariants — a prose-shape sibling to obfuscationVariants that mechanically generates the shape class round nine found by hand, asserted through the real hook with a >=32-variant anti-vacuity floor"
  - "FRICTION_CLASSES — a document-to-corpus binding gate: every friction class docs/destructive-gate-trust-boundary.md names must have a corpus row of that exact shape, and vice versa"
  - "The trust-boundary structural gate now pins the '## Round nine' heading and requires >=8 Named-residuals rows"
  - "03-REQUIREMENTS-BOOKKEEPING.md section (g): round nine's coverage map, the branch decision, the structural blind spot and its closure, with no requirement status changed"
affects: []

actuals:
  tokens: 7123
  tasks: 3
  commits: 3

commits: 3
plan_head_before: b8a4078a65ac499a025e1ea8a15348ed37fe1dbd

tech-stack:
  added: []
  patterns:
    - "Document-to-corpus binding enforced by a gate (FRICTION_CLASSES), not by discipline alone — a friction class can no longer be claimed in the trust-boundary document without a corpus row pricing it, nor priced without a claim naming it."
    - "A second, sibling sweep generator (PROSE_FRICTION_SHAPES) over shapes (wrapper + follower) independent of any corpus row, alongside the existing obfuscationVariants sweep over LAUNCHER_CORPUS-derived invocations — used when the class under test lives entirely inside a quoted argument's own internal words, which no corpus row's command text contains."

key-files:
  created: []
  modified:
    - packages/sidecar/test/destructive-gate.test.mjs
    - .planning/phases/03-nothing-lost-nothing-left-running/03-REQUIREMENTS-BOOKKEEPING.md

key-decisions:
  - "FRICTION_CLASSES' c6-corrected and plain-prose-wrapper-flag-adjacency rows both anchor into text that genuinely exists in the document today, but not into two separate friction-accounting bullets as 03-38-PLAN.md's own wording assumed — 03-37 corrected the THIRD bullet in place to state the general, corrected class directly (03-37-SUMMARY.md: 'corrected the friction accounting's third bullet ... to the measured class') rather than adding a fourth bullet, matching that plan's own assumption_delta_decision (the general class is now primary, the brace/indeterminate form a variant inside it). c6-corrected anchors the bullet's own lead-in; plain-prose-wrapper-flag-adjacency anchors a distinct sentence inside the '## Round nine' narrative section instead — two real, independently-locatable anchors, just not two bullets."

requirements-completed: []

coverage:
  - id: D1
    description: "The plain-prose wrapper-flag-adjacency class round nine corrected is priced through the real compiled hook in both directions: four ordinary deny rows (the verifier's own named representative, env's half, the widest unrecognised-flag member, a non-commit template) and four bounding defer rows (command's closed flag set, the word-boundary control, the no-follower control, the D-61 AND-gate control), plus a corrected why on the pre-existing brace-flag row so the test file no longer repeats the falsified 'BOTH a brace-or-glob AND a dash' claim 03-37 retracted."
    requirement: "AGNT-07"
    verification:
      - kind: integration
        ref: "npm --prefix packages/sidecar test — ORDINARY_USAGE_CORPUS test (98 passed, 0 failed, 0 skipped overall)"
        status: pass
      - kind: other
        ref: "grep -c 'BOTH a brace-or-glob' packages/sidecar/test/destructive-gate.test.mjs → 0"
        status: pass
    human_judgment: false
  - id: D2
    description: "PROSE_FRICTION_SHAPES/PROSE_FRICTION_TEMPLATES/proseFrictionVariants mechanically generate the prose-in-quotes friction class across both wrapper tokens (env's OPEN recognised-flag set, command's CLOSED one), every recognised and unrecognised follower, and two argument templates (commit-message, log-search) — 32 generated variants asserted through the real hook, with a floor that makes a silent non-sweep fail loudly. Falsifiability confirmed live: flipping one shape's expect makes the suite fail by name."
    requirement: "AGNT-07"
    verification:
      - kind: integration
        ref: "packages/sidecar/test/destructive-gate.test.mjs#PROSE_FRICTION_SHAPES: ordinary prose naming a wrapper flag..."
        status: pass
    human_judgment: false
  - id: D3
    description: "FRICTION_CLASSES binds every friction class the trust-boundary document names to exactly one ORDINARY_USAGE_CORPUS row of that command/expect shape, checked in both directions; the structural gate now pins the '## Round nine' heading and requires the Named-residuals table to hold at least 8 rows (was 7). Falsifiability confirmed live: altering one class's representative to a non-existent row makes the gate fail by class id."
    requirement: "AGNT-07"
    verification:
      - kind: integration
        ref: "packages/sidecar/test/destructive-gate.test.mjs#FRICTION_CLASSES: a friction class named in the trust-boundary document must have a corpus row..."
        status: pass
      - kind: integration
        ref: "packages/sidecar/test/destructive-gate.test.mjs#the recorded trust boundary ... D-62 item 3's structural gate"
        status: pass
    human_judgment: false
  - id: D4
    description: "packages/shim/src/main.rs is byte-for-byte unchanged by this plan; no requirement status is flipped (all eight Phase-3 rows still read Gaps Found); the full sidecar suite, the full cargo workspace suite, and the desktop build all pass."
    requirement: "AGNT-07"
    verification:
      - kind: other
        ref: "git diff --quiet HEAD -- packages/shim/src/main.rs"
        status: pass
      - kind: unit
        ref: "cargo test --workspace (29+24+0 = all passed, including 24/24 classify_invocation.rs; no re-run needed)"
        status: pass
      - kind: other
        ref: "npm --prefix packages/desktop run build"
        status: pass
    human_judgment: false
---

# Phase 03 Plan 38: Round nine — pricing the corrected C6 friction class in the corpus, making prose shapes mechanically generable Summary

**`ORDINARY_USAGE_CORPUS` now prices round nine's corrected plain-prose wrapper-flag-adjacency class from both sides (8 new rows), a second sweep generator (`PROSE_FRICTION_SHAPES`) produces the shape mechanically across every follower and two argument templates, and `FRICTION_CLASSES` binds the trust-boundary document to the corpus so a friction class can no longer be claimed without a row pricing it — 98/98 sidecar tests pass, `packages/shim/src/main.rs` untouched, no requirement status changed.**

## Performance

- **Duration:** ~30 min
- **Started:** 2026-09-22T06:48:00Z (approx.)
- **Completed:** 2026-09-22T07:18:05Z
- **Tasks:** 3
- **Files modified:** 2

## Accomplishments

- Added four deny and four defer rows to `ORDINARY_USAGE_CORPUS`, each asserted through the real compiled hook against the real compiled shim, pricing round nine's corrected class from both sides: the verifier's own named representative (`git commit -m "document the command -p flag behavior"`), env's half, the widest unrecognised-flag member, a non-`commit` template, and four bounding controls (command's closed flag set, the word-boundary control, the no-follower control, and the D-61 AND-gate control).
- Corrected the pre-existing brace-flag row's `why` to state it as the class's INDETERMINATE-FLAG variant rather than repeat the falsified "BOTH a brace-or-glob character AND a dash" claim 03-37 retracted — `grep -c 'BOTH a brace-or-glob'` now prints `0`.
- Raised the corpus's own floors (17→25 rows, 12→16 defer, 5→9 deny) so it cannot silently shrink back below round nine's priced class.
- Built `PROSE_FRICTION_SHAPES` (16 rows), `PROSE_FRICTION_TEMPLATES` (2 templates), and `proseFrictionVariants()` — a sibling generator to `obfuscationVariants` that produces the prose-in-quotes shape class mechanically, since `obfuscationVariants` derives every variant from `LAUNCHER_CORPUS`-real-invocations and structurally cannot reach a shape living entirely inside one quoted argument's own words. 32 generated variants, asserted through the real hook, with an anti-vacuity floor.
- Added `FRICTION_CLASSES` (4 rows) and its gate test: every friction class the trust-boundary document names must have a corpus row of that exact shape, and vice versa — the mechanical enforcement whose absence let round nine's false claim land undetected.
- Extended the trust-boundary structural gate: pinned the `## Round nine` heading and raised the Named-residuals row floor from 7 to 8.
- Appended section (g) to `03-REQUIREMENTS-BOOKKEEPING.md`: round nine's coverage map (which plan covered which half of the `missing:` item), the branch decision, the structural blind spot and its closure, and a note reconciling this plan's own "fourth bullet" wording against what 03-37 actually wrote.
- Confirmed both falsifiability properties live: flipping a `PROSE_FRICTION_SHAPES` row's `expect` fails the sweep by name; altering a `FRICTION_CLASSES` row's `representative` fails the class gate by id. Both were restored before committing.

## Task Commits

Each task was committed atomically:

1. **Task 1: The corpus prices the plain-prose class from both sides, and stops repeating the false claim** - `b981279` (test)
2. **Task 2: `PROSE_FRICTION_SHAPES` — the generator `obfuscationVariants` structurally could not be** - `2326885` (test)
3. **Task 3: `FRICTION_CLASSES` — the document cannot claim a class the corpus does not price, and round nine's coverage map** - `13b4192` (test)

**Plan metadata:** committed alongside this SUMMARY (see final commit).

## Files Created/Modified

- `packages/sidecar/test/destructive-gate.test.mjs` - 8 new `ORDINARY_USAGE_CORPUS` rows, corrected brace-flag row `why`, raised floors, `PROSE_FRICTION_SHAPES`/`PROSE_FRICTION_TEMPLATES`/`proseFrictionVariants` plus their sweep test, `FRICTION_CLASSES` plus its gate test, and round-nine structural-gate anchors
- `.planning/phases/03-nothing-lost-nothing-left-running/03-REQUIREMENTS-BOOKKEEPING.md` - new section (g): round nine's coverage map

## Decisions Made

See `key-decisions` in frontmatter above. In short: `FRICTION_CLASSES`' two round-nine rows both anchor into text that genuinely exists in the document today, adapting the plan's own "fourth bullet" wording to what 03-37 actually delivered (a corrected third bullet, per its own `assumption_delta_decision`) rather than to a bullet that was never added.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 3 - Blocking] `FRICTION_CLASSES`' plain-prose anchor adapted to the document's actual structure**
- **Found during:** Task 3
- **Issue:** `03-38-PLAN.md`'s Task 3 instructions describe anchoring the `c6-corrected` and `plain-prose-wrapper-flag-adjacency` `FRICTION_CLASSES` rows to "the corrected third bullet" and "the new fourth bullet" of the friction-accounting list respectively. Reading `docs/destructive-gate-trust-boundary.md` at HEAD (as corrected by plan 03-37) showed only THREE friction-accounting bullets, not four — 03-37 corrected the THIRD bullet in place to state the general, corrected class directly, rather than adding a separate fourth bullet, matching that plan's own `assumption_delta_decision` (the general wrapper-flag-adjacency class is promoted to primary; the brace/indeterminate form becomes a variant described inside it, not a sibling class). Following the plan's literal instruction would have required asserting the presence of a bullet that does not exist, making the gate red on a correctly-implemented document.
- **Fix:** Kept `c6-corrected`'s anchor as the bullet's own lead-in ("C6's own class, corrected in round nine"), exactly as instructed. For `plain-prose-wrapper-flag-adjacency`, used a distinct, literal, single-line sentence from within the `## Round nine` narrative section ("plain-prose quoted commit message that merely MENTIONS a recognised") instead of a nonexistent fourth bullet — a real, independently-locatable anchor for the plain-prose member of the same class, satisfying the gate's own contract (a docAnchor that is a literal substring of the document, distinct per row) without asserting a document structure that was never built.
- **Files modified:** `packages/sidecar/test/destructive-gate.test.mjs` (documented in the `FRICTION_CLASSES` array's own doc comment), `.planning/phases/03-nothing-lost-nothing-left-running/03-REQUIREMENTS-BOOKKEEPING.md` section (g) (documented explicitly for the next reader)
- **Verification:** `FRICTION_CLASSES` test passes with all four rows' anchors present and each with exactly one matching corpus row; falsifiability confirmed live (altering `c6-corrected`'s representative fails the gate by class id, restored before committing)
- **Committed in:** `13b4192` (Task 3 commit)

---

**Total deviations:** 1 auto-fixed (1 blocking)
**Impact on plan:** The fix preserves every invariant `FRICTION_CLASSES` was designed to enforce (≥4 rows, each with a real document anchor and exactly one matching corpus row) using anchors that genuinely exist, rather than asserting the presence of document text the plan assumed but 03-37 never wrote. No scope creep — no document or scanner file was touched to manufacture a fourth bullet.

## Issues Encountered

None beyond the deviation above.

## User Setup Required

None - no external service configuration required.

## Self-Check: PASSED

- `packages/sidecar/test/destructive-gate.test.mjs` exists and contains `PROSE_FRICTION_SHAPES`, `PROSE_FRICTION_TEMPLATES`, `FRICTION_CLASSES`, `Round nine` (both anchor pin and corpus `why` references), zero occurrences of `BOTH a brace-or-glob`.
- `.planning/phases/03-nothing-lost-nothing-left-running/03-REQUIREMENTS-BOOKKEEPING.md` contains a `Round nine` section (3 occurrences).
- All three commit hashes (`b981279`, `2326885`, `13b4192`) found in `git log --oneline --all`.
- `git diff --quiet HEAD -- packages/shim/src/main.rs` exits 0 — scanner untouched.
- `npm --prefix packages/sidecar test` reports `# tests 98`, `# pass 98`, `# fail 0`, `# skipped 0` — no `SKIPPED (shim-binary tests)` line anywhere in the output.
- `cargo test --workspace` exits 0 on first run (no re-run needed); `classify_invocation.rs` reports 24/24. `npm --prefix packages/desktop run build` exits 0.
- `.planning/REQUIREMENTS.md` still reads `Gaps Found` for all eight Phase-3 rows (`WORK-03`, `WORK-04`, `WORK-05`, `WORK-06`, `PROC-03`, `PROC-04`, `PROC-05`, `AGNT-07`) — confirmed by direct grep, no requirement status flipped by this plan.

## Next Phase Readiness

Both halves of round nine's gap closure are now complete: plan 03-37 corrected the trust-boundary document's claim to the class C6 actually charges, and this plan priced that class in the corpus, made the shape mechanically generable so it cannot go unpriced again, and bound the document to the corpus with a gate. The phase is ready for a fresh `03-VERIFICATION.md` pass covering both plans; whether `AGNT-07` and the seven sibling requirement rows can leave `Gaps Found` is that verification's determination, not this plan's. No blockers.

---
*Phase: 03-nothing-lost-nothing-left-running*
*Completed: 2026-09-22*
