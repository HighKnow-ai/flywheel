---
phase: 03-nothing-lost-nothing-left-running
plan: 30
subsystem: security
tags: [destructive-gate, shell-parsing, rust, typescript, tdd, trust-boundary]

# Dependency graph
requires:
  - phase: 03-nothing-lost-nothing-left-running
    provides: "03-29's boundary-document amendment writing the C1-C4 contract as a spec to implement against"
provides:
  - "shell_quote_removed(text) — context-free quote/backslash removal (C1), packages/shim/src/main.rs"
  - "Union matching (raw text OR quote-removed text) in text_names_gated_program and raw_text_can_shadow_path_resolution (C2)"
  - "raw_text_word_formation_is_indeterminate(text) — reports 'cannot prove' for $, backtick, or letter-adjacent glob (C3)"
  - "Widened, still-non-indeterminacy-carrying shadowable binding feeding invokedBareName (C4)"
  - "readProvenBoolean(value) — tri-state boolean/undefined read for the hook's D-61 safe-verdict fields (WR-01)"
  - "Tri-state safe-branch composition: an unestablished field denies by name before the two-genuine-booleans AND"
  - "docs/destructive-gate-trust-boundary.md C-contract status line flipped to implemented"
affects: [03-31, destructive-gate, security]

# Actuals (#2632)
actuals:
  tokens: 9944
  tasks: 3
  commits: 7
  plan_head_before: c7346d2

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "Context-free, unfaithful-to-a-single-shell's-grammar text normalization (quote/backslash removal) as a deliberate over-triggering safety scan, distinct from a real shell parser"
    - "Tri-state boolean read (boolean | undefined) to keep 'field absent/malformed' distinct from 'field present and false' inside a security-relevant AND"

key-files:
  created: []
  modified:
    - packages/shim/src/main.rs
    - packages/sidecar/src/pretooluse-hook.ts
    - packages/sidecar/test/destructive-gate.test.mjs
    - docs/destructive-gate-trust-boundary.md

key-decisions:
  - "C4 forbids carrying C3's indeterminacy into the bare-name fact (invokedBareName) — only C1's quote removal widens it. An expansion in an argument does not defeat a PATH search, so folding indeterminacy in would convert layer 2's human question into a layer 1 refusal for an ordinary force-push naming its branch through a variable."
  - "readProvenBoolean denies on an unestablished field BEFORE the AND is evaluated, not as a defaulted true fed into the AND — the prior !== false pattern let a genuinely-absent field be silently absorbed by the other field's real false (WR-01, one level down from the original D-59 asymmetric-trust shape)."
  - "[Rule 1 - Bug] Updated the pre-existing D-62 item 3 structural-gate test's pinned C-contract status string to the new implemented wording, with whitespace normalized before comparison — flipping the status line per Task 3(e) broke this older, literally-pinned assertion from plan 03-29; the fix preserves the gate's honesty-signal intent rather than weakening it."

patterns-established:
  - "A raw-text safety scan's negative (false) is a claim that must name the exact class for which it is sound (docs/destructive-gate-trust-boundary.md's own closing lesson); an indeterminate case reports 'cannot prove', never a false absence."

requirements-completed: [AGNT-07]

coverage:
  - id: D1
    description: "Quote/backslash-split shadow keywords (e\"\"val, e\\val, g\"\"it) inside sh -c now report textCanShadowPathResolution/namesGatedProgram true and deny through the real hook against the real shim (C1, C2)"
    requirement: AGNT-07
    verification:
      - kind: e2e
        ref: "packages/sidecar/test/destructive-gate.test.mjs — round-five reproduced-shape test (Task 1)"
        status: pass
      - kind: other
        ref: "target/debug/flywheel-shim --classify-invocation spot-checks (plan verify block)"
        status: pass
    human_judgment: false
  - id: D2
    description: "Text whose word formation is indeterminate (parameter expansion, command substitution, backtick, letter-adjacent glob) reports textCanShadowPathResolution true; ordinary wildcard/quoted-commit-message text keeps deferring (C3)"
    requirement: AGNT-07
    verification:
      - kind: e2e
        ref: "packages/sidecar/test/destructive-gate.test.mjs — determinacy test (Task 2), plus LAUNCHER_CORPUS group 4 controls"
        status: pass
    human_judgment: false
  - id: D3
    description: "A partially-reporting shim (a D-61 field absent or non-boolean) is denied by field name before the AND is evaluated; two genuine booleans behave exactly as before, including the falsifiability companion (one real false still defers) (WR-01)"
    requirement: AGNT-07
    verification:
      - kind: unit
        ref: "packages/sidecar/test/destructive-gate.test.mjs — 'the hook denies a partially-reporting shim by field name...' (Task 3, 5 payloads)"
        status: pass
    human_judgment: false
  - id: D4
    description: "docs/destructive-gate-trust-boundary.md's C-contract status line reads implemented, naming all four clauses and the functions that satisfy them; the D-62 item 3 structural gate still passes"
    verification:
      - kind: unit
        ref: "packages/sidecar/test/destructive-gate.test.mjs — D-62 item 3 structural gate test"
        status: pass
    human_judgment: false

duration: "~2h20m across two executor sessions (first died mid-Task-3; this session resumed from an uncommitted RED and finished Task 3 plus the doc/tracking close-out)"
completed: 2026-09-21
status: complete
---

# Phase 03 Plan 30: Close the quote/backslash-split shadow bypass and the hook's partial-verdict composition gap Summary

**Context-free quote/backslash removal with union matching (C1/C2), an indeterminacy predicate that refuses to claim a false absence (C3), a bare-name fact widened only by quoting (C4), and a tri-state read that stops the hook's own AND from absorbing a field the shim never reported (WR-01) — the exact command three people independently reproduced now denies through the real hook against the real compiled shim.**

## Performance

- **Duration:** ~2h20m across two executor sessions (see `duration` field)
- **Tasks:** 3 of 3 completed
- **Files modified:** 4 (`packages/shim/src/main.rs`, `packages/sidecar/src/pretooluse-hook.ts`, `packages/sidecar/test/destructive-gate.test.mjs`, `docs/destructive-gate-trust-boundary.md`)
- **Commits this plan:** 7 (measured `git rev-list --count c7346d2..HEAD` before the metadata commit)

## Accomplishments

- **Task 1 (C1 + C2):** `shell_quote_removed` performs context-free quote/backslash removal in `packages/shim/src/main.rs`; `text_names_gated_program` and `raw_text_can_shadow_path_resolution` union-match over the raw text and the quote-removed text. Closes the reproduced `e""val`/`e\val`/`g""it` bypass end to end through the real hook against the real shim, while the eight launcher shapes and ordinary commands still defer.
- **Task 2 (C3):** `raw_text_word_formation_is_indeterminate` reports "cannot prove" (`textCanShadowPathResolution: true`) for text containing `$`, a backtick, or a letter-adjacent `*`/`?`/`[` — folded only into the safe-verdict field, never into the bare-name fact. Ordinary `git add *.rs`, `git commit -m "fix: thing"`, `git status`, `command -v git`, `npm test`, `cargo build` and all six `LAUNCHER_CORPUS` group 4 controls still defer.
- **Task 3 (WR-01):** `readProvenBoolean` in `packages/sidecar/src/pretooluse-hook.ts` reads each D-61 field as a genuine boolean or `undefined`; the safe branch now denies on an unestablished field by name BEFORE the two-genuine-booleans AND is ever evaluated, closing the latent composition gap the code review named (a missing field could previously be silently absorbed by the other field's real `false`).
- Boundary document (`docs/destructive-gate-trust-boundary.md`) updated: the C-contract status line flips from "specified, not yet implemented" to "implemented by plan 03-30", naming all four clauses and their functions; Layer 1's paragraph records the WR-01 composition rule.
- Continuation close-out: this plan's SUMMARY, STATE.md and ROADMAP.md tracking, completed by a second executor after the first died immediately after writing (but not committing) Task 3's RED test.

## Task Commits

Each task was committed atomically (Tasks 1 and 2 by the first executor; Task 3 by this continuation):

1. **Task 1: One obfuscated command, all the way from raw text to a deny (C1, C2)** — `2840df8` (test, RED), `9dc38af` (feat, GREEN)
2. **Task 2: Refuse to answer where the text does not determine the words (C3)** — `9ad9ab3` (test, RED), `a58cee7` (feat, GREEN)
3. **Task 3: A missing fact cannot be absorbed by a present one (WR-01)** — `eecccca` (test, RED — committed by this continuation, matching the RED the first executor had already written and left uncommitted), `9ed5462` (feat, GREEN), `4c606b3` (fix — deviation, see below)

**Plan metadata:** committed as part of this close-out (STATE.md/ROADMAP.md/REQUIREMENTS.md/SUMMARY.md).

## Files Created/Modified

- `packages/shim/src/main.rs` — `shell_quote_removed` (C1), union matching in `text_names_gated_program`/`raw_text_can_shadow_path_resolution` (C2), `raw_text_word_formation_is_indeterminate` (C3), widened `shadowable`/`text_can_shadow` bindings in `classify_raw_command_text` (C2/C3/C4)
- `packages/sidecar/src/pretooluse-hook.ts` — `readProvenBoolean` tri-state helper; rewritten safe-branch step 2 (denies on an unestablished field by name before the AND); module doc comment's composition-rule paragraph corrected
- `packages/sidecar/test/destructive-gate.test.mjs` — round-five end-to-end regression (Task 1), determinacy regression (Task 2), partial-verdict stub-classifier regression with the falsifiability companion (Task 3), and the D-62 item 3 structural gate's pinned status string updated to the implemented wording
- `docs/destructive-gate-trust-boundary.md` — C-contract status line flipped to implemented; Layer 1 paragraph gained the WR-01 composition sentence

## Decisions Made

- C4 stays narrower than C3 by design: `shadowable` (feeding `invokedBareName`) is widened only by C1's quote removal, never by C3's indeterminacy predicate — an argument-position expansion does not defeat a `PATH` search, so folding it in would turn layer 2's human question into a layer 1 refusal for an ordinary variable-named branch force-push.
- `readProvenBoolean`'s tri-state deny-before-AND ordering is the fix, not a defaulted-unsafe value fed into the existing AND — the latter is exactly the shape that produced WR-01's latent bug.
- The pre-existing D-62 item 3 structural-gate test (plan 03-29) pinned the old "not yet implemented" status line literally; this plan's own required action flips that line, so the pinned assertion was updated to the new implemented wording (with whitespace normalized against the paragraph's own line-wrap) rather than left broken or weakened.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 1 - Bug] D-62 item 3's structural-gate test broke against its own plan-required doc change**
- **Found during:** Task 3, running the plan's own `<verification>` block after committing Task 3's GREEN commit.
- **Issue:** `docs/destructive-gate-trust-boundary.md`'s C-contract status line change (Task 3e, required by the plan) is a required edit, but a pre-existing test written by plan 03-29 (`packages/sidecar/test/destructive-gate.test.mjs`, the "D-62 item 3's structural gate" test) pinned the OLD "specified, not yet implemented" wording as a literal substring match. Flipping the line broke that test (`not ok`). A second attempt to fix it (matching the new wording as a single concatenated string) still failed, because the doc's actual paragraph wraps across three lines and `content.includes()` requires an exact substring including real newlines.
- **Fix:** Updated the pinned assertion to the new implemented-status wording (naming all four clauses and their functions, matching Task 3e's exact required text), and normalized whitespace (`content.replace(/\s+/g, " ")`) before comparison so the paragraph's own markdown line-wrap does not itself trip the gate.
- **Files modified:** `packages/sidecar/test/destructive-gate.test.mjs`
- **Verification:** `npm --prefix packages/sidecar test` — 94/94 passing, structural-gate test individually re-run with `--test-name-pattern "structural gate"` to confirm.
- **Committed in:** `4c606b3`

---

**Total deviations:** 1 auto-fixed (1 bug)
**Impact on plan:** Necessary correction to keep the plan's own required doc edit (Task 3e) from silently breaking an existing regression test; the structural gate's intent (catching drift of the status line) is preserved, not weakened. No scope creep.

## Issues Encountered

None beyond the deviation above. The first executor session died immediately after writing (but before committing) Task 3's RED test in `packages/sidecar/test/destructive-gate.test.mjs`; this continuation verified that RED test was correct and complete against the plan's own Task 3(f) specification, committed it as-is, then proceeded through GREEN.

## User Setup Required

None — no external service configuration required.

## Next Phase Readiness

- All three tasks complete; `cargo test --workspace`, `npm --prefix packages/sidecar test` (94/94), and `npm --prefix packages/desktop test` (440/440) all pass.
- `docs/destructive-gate-trust-boundary.md`'s C-contract status line now reads implemented — this satisfies plan 03-31's `<precondition>`, which halts unless that line reads the implemented form.
- **AGNT-07 requirements status:** NOT marked complete by this plan. `requirements.ready-ids` reports it blocked (0/1 ready) because sibling plan `03-31` in this same phase also declares `AGNT-07` and has not produced a SUMMARY yet (the shared-ID gate, #2388) — correct behavior, not an oversight. AGNT-07 will be marked complete once 03-31 finishes and both plans' SUMMARYs exist.
- **Suite results, reported honestly:** across the several full runs in this session, `packages/sidecar` reported either 94/94 passing or, once, a single unrelated failure on test "the shipped compiled hook blocks a destructive rm invoked by absolute path — the class the shim cannot see" (the pre-existing live-`claude`-backend test flagged in this plan's continuation brief as a known, pre-existing flake under a fixed 90s budget with no retry — plan 03-31 Task 3 de-flakes it deliberately). This plan's own tests (Task 1's round-five regression, Task 2's determinacy regression, Task 3's partial-verdict regression) passed in every run, with no flakiness observed.
- Ready for plan 03-31.

## Self-Check: PASSED

- All 4 key files confirmed present on disk (`[ -f ]`).
- All 7 task commits (`2840df8`, `9dc38af`, `9ad9ab3`, `a58cee7`, `eecccca`, `9ed5462`, `4c606b3`) confirmed present via `git log --oneline --all`.
- Plan-level `<verification>` re-run: `cargo build --workspace`, `cargo test --workspace` (all passing), `npm --prefix packages/sidecar test` (94/94), `npm --prefix packages/desktop test` (440/440), all four `--classify-invocation` spot-checks reproduced with expected output.
- Acceptance criteria for Task 3 re-checked against source: `readProvenBoolean` defined and used for both fields; the deny-on-unestablished check appears textually before the two-genuine-booleans AND; reason strings name the unestablished field's JSON key; module doc comment states the composition rule; boundary document carries the implemented status line naming all four clauses; the new partial-verdict test contains five payload cases including the falsifiability companion and reports `ok`.

---
*Phase: 03-nothing-lost-nothing-left-running*
*Completed: 2026-09-21*
