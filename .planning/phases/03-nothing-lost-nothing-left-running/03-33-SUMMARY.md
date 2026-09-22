---
phase: 03-nothing-lost-nothing-left-running
plan: 33
subsystem: security
tags: [rust, shell-parsing, destructive-gate, classification, tdd]

# Dependency graph
requires:
  - phase: 03-nothing-lost-nothing-left-running
    provides: "03-REVIEW.md's CR-01 finding (bash brace expansion is an unaddressed word-formation mechanism) and WR-03 (obfuscationVariants only sweeps three known mechanisms)"
provides:
  - "docs/destructive-gate-trust-boundary.md amended FIRST: C3 rewritten as a closed, four-mechanism enumeration naming brace expansion; the WR-03 enumeration-vs-inversion ruling with the git add *.rs measurement and a written reopening trigger; a dedicated paragraph narrowing text_names_gated_program's claim to the word-bounded-literal class; a new Named residuals row for brace-assembled gated program names; a sentence recording that plan 03-34 carries the corpus rows"
  - "raw_text_word_formation_is_indeterminate (C3) gains a fourth named mechanism: an asymmetric brace-adjacency trigger ({ looks backward only, } looks forward only)"
  - "text_names_gated_program's doc comment narrowed to state exactly what its false proves and does not prove"
  - "packages/shim/tests/classify_invocation.rs extended with 5 new tests (11 total)"
affects: [03-VERIFICATION.md, AGNT-07, "plan 03-34 (the corpus rows this plan's document amendment authorizes)"]

# Actuals (#2632)
actuals:
  tokens: 6847
  tasks: 2
  commits: 3

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "Asymmetric adjacency trigger ({ backward-only, } forward-only) as the fix shape for a word-formation mechanism whose symmetric or presence-based alternatives would either over-deny ordinary path-brace idioms or require brace-group parsing — mirrors C1-C4's own discipline of picking the cheapest sound trigger over a full parser"
    - "A function-level doc comment stating the exact soundness class a boolean field's false proves, with a named counterexample, rather than an unqualified claim of absence"

key-files:
  created: []
  modified:
    - docs/destructive-gate-trust-boundary.md
    - packages/shim/src/main.rs
    - packages/shim/tests/classify_invocation.rs

key-decisions:
  - "WR-03 ruling: C3 stays an enumeration (now four named mechanisms) rather than becoming a genuine inversion this round — a genuine inversion would flip git add *.rs to indeterminate, and D-61's AND-gate would then deny an ordinary git add on a wildcard, which ORDINARY_USAGE_CORPUS asserts must not happen. Recorded as a measurement, not an opinion, with a written reopening trigger (a bypass shape outside all four named mechanisms)."
  - "The brace-adjacency rule is deliberately asymmetric ({ backward-only, } forward-only), not symmetric like the glob rule, and requires no comma/matching-brace scan — the asymmetry is what keeps git add src/{a,b}.rs and mkdir -p src/{a,b} determinate while catching al{i,}as and {gi,}t; a symmetric or comma-aware rule would either over-deny ordinary path braces or need a parser whose own soundness class would have to be documented (the exact thing this contract exists to avoid)."
  - "xargs -I{} rm {} moving from false to true is accepted, priced friction (recorded in the doc comment and the trust-boundary document), not parsed away."
  - "text_names_gated_program's negative is narrowed to the word-bounded-literal class rather than repaired by folding indeterminacy into it — that fold was rejected because it would make an indeterminate eval \"$(direnv hook bash)\" report a gated program and start denying, destroying the Group 4 falsifiability companions."

requirements-completed: []  # AGNT-07 intentionally NOT marked complete — hard constraint: phase verification owns that call, not this plan

coverage:
  - id: D1
    description: "The trust-boundary document names brace expansion (four+ mentions), rules explicitly on WR-03 with the git add *.rs measurement as its reason, and records the document-before-corpus ordering against plan 03-34 — all before any code or corpus change"
    requirement: AGNT-07
    verification:
      - kind: other
        ref: "grep -ci 'brace' docs/destructive-gate-trust-boundary.md (>= 4); grep -q 'WR-03'; grep -q '03-34'"
        status: pass
    human_judgment: false
  - id: D2
    description: "text_names_gated_program's false is narrowed to the word-bounded-literal class in both the document and the source doc comment"
    requirement: AGNT-07
    verification:
      - kind: other
        ref: "grep -q 'word-bounded literal' docs/destructive-gate-trust-boundary.md; same phrase in packages/shim/src/main.rs's text_names_gated_program doc comment"
        status: pass
    human_judgment: false
  - id: D3
    description: "C3 gains a fourth named mechanism (brace-adjacency): a brace-assembled shadow keyword or program name adjacent to a letter run now reports textCanShadowPathResolution true"
    requirement: AGNT-07
    verification:
      - kind: unit
        ref: "packages/shim/tests/classify_invocation.rs#c3_brace_adjacency_reports_indeterminate_for_assembled_alias"
        status: pass
      - kind: unit
        ref: "packages/shim/tests/classify_invocation.rs#c3_brace_adjacency_reports_indeterminate_for_assembled_program_name"
        status: pass
    human_judgment: false
  - id: D4
    description: "Ordinary path-brace idioms (git add src/{a,b}.rs, mkdir -p src/{a,b}, JSON payloads) and the WR-03 falsifiability row (git add *.rs) stay determinate — the asymmetric rule does not over-trigger"
    requirement: AGNT-07
    verification:
      - kind: unit
        ref: "packages/shim/tests/classify_invocation.rs#c3_brace_rule_leaves_ordinary_path_braces_determinate"
        status: pass
      - kind: unit
        ref: "packages/shim/tests/classify_invocation.rs#c3_brace_rule_does_not_flip_the_wildcard_git_add_row"
        status: pass
    human_judgment: false
  - id: D5
    description: "The accepted, priced friction (xargs -I{} rm {}) is asserted explicitly as a decision"
    requirement: AGNT-07
    verification:
      - kind: unit
        ref: "packages/shim/tests/classify_invocation.rs#c3_brace_rule_priced_friction_xargs_placeholder"
        status: pass
    human_judgment: false
  - id: D6
    description: "No existing corpus decision moved — cargo test --workspace and npm --prefix packages/sidecar test both pass (96/96, fail 0) after the C3 change"
    verification:
      - kind: integration
        ref: "cargo test --workspace; npm --prefix packages/sidecar test; node --test --test-name-pattern=\"decision invariance\" packages/sidecar/test/destructive-gate.test.mjs"
        status: pass
    human_judgment: false

duration: 15min
completed: 2026-09-22
status: complete
---

# Phase 03 Plan 33: Brace Expansion Named, C3 Gains Its Fourth Mechanism Summary

**Amended the trust-boundary document first (naming brace expansion, ruling on WR-03, narrowing `text_names_gated_program`'s claim) then taught C3 an asymmetric brace-adjacency trigger so `al{i,}as`/`{gi,}t`/`{r,}m` report indeterminate while `git add src/{a,b}.rs` and `git add *.rs` stay determinate.**

## Performance

- **Duration:** 15 min
- **Started:** 2026-09-22T01:23:33Z (first commit)
- **Completed:** 2026-09-22T01:37:01Z (last commit)
- **Tasks:** 2
- **Files modified:** 3

## Accomplishments
- Amended `docs/destructive-gate-trust-boundary.md` FIRST, per its own "rule for round six": rewrote the C3 paragraph as a closed, positive enumeration of four named word-formation mechanisms (`$`, backtick, letter-adjacent glob, and the new letter-adjacent brace trigger), naming tilde expansion and process substitution as mechanisms it does not cover
- Recorded the WR-03 ruling as a named decision: C3 stays an enumeration rather than becoming a genuine inversion, with the `git add *.rs` measurement as the reason (a genuine inversion would flip that row to indeterminate and deny it) and a written reopening trigger
- Added a dedicated paragraph narrowing `text_names_gated_program`'s claim to the exact word-bounded-literal class its negative is sound for, using `{gi,}t push --force` as the counterexample and recording why folding indeterminacy into it was rejected (would deny `eval "$(direnv hook bash)"`)
- Added a Named residuals row for brace-assembled gated program names, and a sentence in "The rule for round six" recording that this plan (03-33) amends the document and the corpus rows land in dependent plan 03-34
- TDD'd `raw_text_word_formation_is_indeterminate`'s (C3) fourth trigger in `packages/shim/src/main.rs`: an asymmetric brace-adjacency rule (`{` looks backward only, `}` looks forward only) that catches `al{i,}as`/`so{u,}rce`/`{gi,}t`/`{r,}m` while leaving ordinary path-brace idioms and `git add *.rs` determinate
- Rewrote both `raw_text_word_formation_is_indeterminate`'s and `text_names_gated_program`'s doc comments to match the trust-boundary document's narrowed claims
- New integration tests in `packages/shim/tests/classify_invocation.rs` (5 new, 11 total) drive the compiled binary via `--classify-invocation` only (D-63)

## Task Commits

Each task was committed atomically:

1. **Task 1: The document names brace expansion, rules on WR-03, and states what a `false` proves** - `663eccd` (docs)
2. **Task 2: C3 gains its fourth named mechanism, and two doc comments stop overclaiming** - `cf3173e` (test — RED), `d0c1e3f` (feat — GREEN)

_Task 2 was TDD (RED → GREEN); no REFACTOR commit was needed — the implementation required no cleanup pass after GREEN._

## Files Created/Modified
- `docs/destructive-gate-trust-boundary.md` - C3 paragraph rewritten as a four-mechanism enumeration; WR-03 ruling recorded; new `text_names_gated_program` soundness-class paragraph; new Named residuals row for brace-assembled program names; new sentence in "The rule for round six" naming plan 03-34
- `packages/shim/src/main.rs` - `raw_text_word_formation_is_indeterminate` gains the asymmetric brace-adjacency trigger and a rewritten doc comment; `text_names_gated_program`'s doc comment narrowed to the word-bounded-literal class
- `packages/shim/tests/classify_invocation.rs` - 5 new tests: assembled-alias/source keyword shadows, assembled `git`/`rm` program names, ordinary path-brace non-triggers, the `git add *.rs` falsifiability row, the accepted `xargs -I{}` priced friction

## Decisions Made
- WR-03: C3 stays an enumeration, not a genuine inversion — the `git add *.rs` measurement is the reason, and turning it into an inversion is deferred to the same product-scope allowlist decision `## What was deliberately not done` already named
- The brace rule is asymmetric by design (`{` backward-only, `}` forward-only), accepting `xargs -I{} rm {}` as priced friction rather than adding comma/matching-brace parsing
- `text_names_gated_program`'s claim is narrowed rather than repaired — folding indeterminacy into it was rejected to avoid denying the Group 4 falsifiability companions (`eval "$(direnv hook bash)"`)

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 1 - Bug in own edit] Fixed a self-inflicted break in the D-62 item 3 structural gate test**
- **Found during:** Task 2 (running the full `packages/sidecar` test suite after the GREEN commit)
- **Issue:** Task 1's own new prose in `docs/destructive-gate-trust-boundary.md` contained the literal substrings `` `## Named residuals` `` and `` `## What was deliberately not done` `` inside inline code spans, ahead of the real headings later in the document. `destructive-gate.test.mjs`'s D-62 item 3 structural gate locates the "Named residuals" table via `content.indexOf("## Named residuals")`, which matched the earlier inline mention instead of the real heading — the `nextHeadingIndex` search then found the real heading almost immediately afterward, truncating the parsed table to 0 rows and failing test 66 (`expected at least 6 rows ... found 0`).
- **Fix:** Reworded both inline references to avoid the literal `"## "` heading prefix (`` `## Named residuals` `` → `the "Named residuals" table`; `` `## What was deliberately not done` `` → `the "What was deliberately not done" section`) — no change to the actual headings or table content.
- **Files modified:** `docs/destructive-gate-trust-boundary.md`
- **Verification:** `node --test --test-name-pattern="D-62 item 3" packages/sidecar/test/destructive-gate.test.mjs` — passes; full `npm --prefix packages/sidecar test` re-run confirmed 96/96, `# fail 0`
- **Committed in:** `d0c1e3f` (bundled with the Task 2 GREEN commit, since it corrects Task 1's already-committed file and was discovered while verifying Task 2)

---

**Total deviations:** 1 auto-fixed (Rule 1 — bug in own edit)
**Impact on plan:** Required for correctness of the delivered documentation and to keep the pre-existing D-62 item 3 structural gate passing. No scope creep — the fix only reworded two inline cross-references, changing no heading, table row, or claim.

## Issues Encountered
None beyond the deviation above.

## User Setup Required
None - no external service configuration required.

## Known Stubs
None.

## Threat Flags
None — every change stays within this plan's own `<threat_model>` (T-03-33-01 through T-03-33-06, T-03-33-SC); no new endpoint, auth path, file-access pattern, or schema change was introduced.

## Self-Check: PASSED

- `docs/destructive-gate-trust-boundary.md` — FOUND (modified, `grep -ci brace` = 6, contains `WR-03`, `word-bounded literal`, `03-34`)
- `packages/shim/src/main.rs` — FOUND (modified, contains the brace-adjacency trigger inside `raw_text_word_formation_is_indeterminate`, narrowed `text_names_gated_program` doc comment)
- `packages/shim/tests/classify_invocation.rs` — FOUND (modified, 11 tests total, 5 new)
- Commit `663eccd` — FOUND in `git log --oneline --all`
- Commit `cf3173e` — FOUND in `git log --oneline --all`
- Commit `d0c1e3f` — FOUND in `git log --oneline --all`
- `cargo build --workspace` — exits 0
- `cargo test -p flywheel-shim --test classify_invocation` — exits 0, 11 passed, no "running 0 tests"
- `cargo test --workspace` — exits 0, no `FAILED`
- `npm --prefix packages/sidecar test` — exits 0, `# fail 0`, no `SKIPPED (shim-binary tests)` (re-confirmed after the deviation fix: 96/96)
- All nine classification probes from Task 2's acceptance criteria — manually re-verified against `target/debug/flywheel-shim`, match exactly
- Decision-invariance sweep (WR-02) — re-run standalone, passes with zero carried exceptions

## Next Phase Readiness
- The trust-boundary document names brace expansion, rules on WR-03, and states `text_names_gated_program`'s soundness class — all before any corpus row was written, per the document's own rule for round six.
- C3 now covers four named word-formation mechanisms; the two live constructions CR-01 measured (`al{i,}as`, `{gi,}t`/`{r,}m`) now report indeterminate, and Layer 2 remains the proven backstop for the program-name case.
- `AGNT-07` is intentionally left `requirements-completed: []` in this SUMMARY's frontmatter and no `requirements.mark-complete` call was made — the plan's own hard constraint reserves that decision for `03-VERIFICATION.md`.
- Plan 03-34 (the dependent plan carrying the new corpus rows exercising C3's brace trigger) is unblocked — the document-before-corpus ordering this plan enforces is now satisfied.

---
*Phase: 03-nothing-lost-nothing-left-running*
*Completed: 2026-09-22*
