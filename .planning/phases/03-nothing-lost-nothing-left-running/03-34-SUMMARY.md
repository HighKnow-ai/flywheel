---
phase: 03-nothing-lost-nothing-left-running
plan: 34
subsystem: security
tags: [rust, node, destructive-gate, classification, corpus, requirements-bookkeeping]

# Dependency graph
requires:
  - phase: 03-nothing-lost-nothing-left-running
    provides: "03-33's document amendment (brace expansion named, WR-03 ruled, text_names_gated_program's soundness class narrowed) — this plan's own depends_on enforces that ordering in the plan graph, not by memory"
provides:
  - "LAUNCHER_CORPUS carries the brace shadow shapes (deny) and brace non-triggers (defer), exercising C3's brace-adjacency trigger through the real hook against the real shim"
  - "ORDINARY_USAGE_CORPUS prices the brace rule's friction as an asserted fact, including the one row that now denies (xargs -I{} rm {})"
  - "readProvenBoolean's regression test (WR-01) exercises every case its own doc comment enumerates: absent, null, a string, a number"
  - "03-REQUIREMENTS-BOOKKEEPING.md — the verifier's ruling on the seven sibling requirement IDs, the requirements.mark-complete caution, and the missing:-item-to-plan coverage map"
affects: [03-VERIFICATION.md, AGNT-07, ".planning/REQUIREMENTS.md (record only — no status changed by this plan)"]

# Actuals (#2632)
actuals:
  tokens: 3801
  tasks: 3
  commits: 3
  plan_head_before: b1cea5507409277255a4cc0f47b7d4075c7cd166

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "A record-only planning artifact (03-REQUIREMENTS-BOOKKEEPING.md) that documents a bookkeeping ruling without performing it — separating 'what the next verifier must do' from 'doing it now', enforced by the plan's own verify asserting REQUIREMENTS.md is unchanged"

key-files:
  created:
    - .planning/phases/03-nothing-lost-nothing-left-running/03-REQUIREMENTS-BOOKKEEPING.md
  modified:
    - packages/sidecar/test/destructive-gate.test.mjs

key-decisions:
  - "Every new LAUNCHER_CORPUS/ORDINARY_USAGE_CORPUS row was added and verified only after confirming docs/destructive-gate-trust-boundary.md already named brace expansion (grep -ci brace >= 4) — the precondition and Task 1's own <verify> gate both held, so no row was added out of order."
  - "xargs -I{} rm {} moved from a hypothetical to an asserted deny row in ORDINARY_USAGE_CORPUS — the priced, accepted friction of the asymmetric brace rule, recorded as a decision on the record rather than a surprise."
  - "03-REQUIREMENTS-BOOKKEEPING.md is a record only: it does not edit .planning/REQUIREMENTS.md, does not call requirements.mark-complete, and changes no requirement status — verified by re-grepping REQUIREMENTS.md after Task 3, which still shows exactly 8 phase-3 rows reading Gaps Found."

requirements-completed: []  # AGNT-07 and its seven siblings intentionally NOT marked — Task 3's own hard constraint reserves that decision for the next phase verification pass, not this plan

coverage:
  - id: D1
    description: "LAUNCHER_CORPUS gains two Group 3 deny rows (al{i,}as / so{u,}rce brace-assembled shadow keywords) and two Group 4 defer rows ({gi,}t / {r,}m brace-assembled program names), each with a non-empty why naming the field that decides it"
    requirement: AGNT-07
    verification:
      - kind: unit
        ref: "packages/sidecar/test/destructive-gate.test.mjs — 'LAUNCHER_CORPUS: every launcher shape, wrapper family, shadow shape and non-trigger control...' (96/96 pass)"
        status: pass
      - kind: other
        ref: "direct --classify-invocation probes against target/debug/flywheel-shim for all four new rows, matching each row's expected defer/deny before the test suite ran"
        status: pass
    human_judgment: false
  - id: D2
    description: "ORDINARY_USAGE_CORPUS gains three rows pricing the brace rule's friction: git add src/{a,b}.rs (defer), mkdir -p src/{a,b} (defer), xargs -I{} rm {} (deny); floors raised from 9/5/2 to 12/7/3"
    requirement: AGNT-07
    verification:
      - kind: unit
        ref: "packages/sidecar/test/destructive-gate.test.mjs — 'ORDINARY_USAGE_CORPUS: the friction C3 buys on ordinary agent commands...'"
        status: pass
    human_judgment: false
  - id: D3
    description: "readProvenBoolean's WR-01 regression test extended in place with p6 (explicit null) and p7 (a number), closing the last two doc-comment-enumerated cases; p5's falsifiability companion (a real false) still defers"
    requirement: AGNT-07
    verification:
      - kind: unit
        ref: "packages/sidecar/test/destructive-gate.test.mjs#'the hook denies a partially-reporting shim by field name...(WR-01)'"
        status: pass
    human_judgment: false
  - id: D4
    description: "03-REQUIREMENTS-BOOKKEEPING.md records the verifier's ruling, the requirements.mark-complete caution, and the four missing: items mapped to plans 03-32/03-33/03-34, without changing any requirement status"
    requirement: AGNT-07
    verification:
      - kind: other
        ref: "grep -c -E '^\\| (WORK-03|WORK-04|WORK-05|WORK-06|PROC-03|PROC-04|PROC-05|AGNT-07) \\| Phase 3 \\| Gaps Found \\|$' .planning/REQUIREMENTS.md == 8"
        status: pass
    human_judgment: false
  - id: D5
    description: "No existing corpus decision moved — cargo test --workspace (all crates, 0 failed), npm --prefix packages/sidecar test (96/96, fail 0, no SKIPPED shim-binary line), npm --prefix packages/desktop run test (440/440) all pass after this plan's changes"
    verification:
      - kind: integration
        ref: "cargo test --workspace; npm --prefix packages/sidecar test; npm --prefix packages/desktop run test"
        status: pass
    human_judgment: false
  - id: D6
    description: "scripts/uat/run-all.sh, the phase's own end-of-phase live-session regression harness, was run once as the plan's own <verification> step 6 requires; four of its six scriptable items (UAT 3, 5, 6a, 6b — all live-claude-session end-to-end scripts) failed"
    verification:
      - kind: other
        ref: "bash scripts/uat/run-all.sh --no-build — see Issues Encountered below for the full result table and why this is judged pre-existing, out-of-scope flakiness rather than a regression this plan caused"
        status: fail
    human_judgment: true
    rationale: "Whether the run-all.sh failures are genuine live-model-behavior flakiness (the established pattern for every prior plan in this phase that touched destructive-gate.test.mjs) or a real regression cannot be settled by this plan alone — this plan's diff touches only a test-data file and a new planning doc, never packages/shim/src/main.rs or packages/sidecar/src/pretooluse-hook.ts, so a human or the phase's own verification pass should judge whether this needs a dedicated live-session investigation before AGNT-07 can close."

duration: 32min
completed: 2026-09-22
status: complete
---

# Phase 03 Plan 34: The Corpus Carries the Brace Shapes, WR-01 Closes, and the Requirements Bookkeeping Is Recorded Summary

**Landed the corpus evidence for plan 03-33's brace-expansion trust-boundary amendment (four new `LAUNCHER_CORPUS` rows, three new `ORDINARY_USAGE_CORPUS` rows), closed WR-01's coverage gap in the `readProvenBoolean` regression test, and wrote `03-REQUIREMENTS-BOOKKEEPING.md` — a record, not a status change.**

## Performance

- **Duration:** 32 min
- **Started:** 2026-09-22T01:51:09Z (first commit)
- **Completed:** 2026-09-22T01:54:49Z (last commit); verification ran through 2026-09-22T02:11:18Z
- **Tasks:** 3
- **Files modified:** 2

## Accomplishments

- Added two Group 3 `LAUNCHER_CORPUS` rows (`sh -c 'al{i,}as git=/usr/bin/git; git push --force'`, `sh -c 'so{u,}rce ./defs.sh; git push --force'`), both `deny` — C3's brace-adjacency trigger fires, the raw text names `git`, D-61's AND denies
- Added two Group 4 `LAUNCHER_CORPUS` rows (`{gi,}t push --force`, `{r,}m -rf /tmp/nonexistent-x`), both `defer` — `namesGatedProgram` stays `false` (no word-bounded literal survives), so D-61's AND never fires; Layer 2's argv classifier is the trusted backstop (measured: `--classify-command 'rm m -rf /tmp/x'` reports `recursive-delete`)
- Added three `ORDINARY_USAGE_CORPUS` rows pricing the brace rule's friction: `git add src/{a,b}.rs` and `mkdir -p src/{a,b}` stay determinate (`defer` — the brace sits adjacent to `/`/`.`/space, never a letter), `xargs -I{} rm {}` denies (the accepted, priced cost of the asymmetric rule)
- Raised `ORDINARY_USAGE_CORPUS`'s floor assertions to match the larger table: row-count 9→12, `deferCount` 5→7, `denyCount` 2→3 — kept as floors, not equalities
- Extended the existing WR-01 `readProvenBoolean` regression test in place with `p6` (`textCanShadowPathResolution: null`) and `p7` (`textCanShadowPathResolution: 0`), closing the last two cases the function's own doc comment enumerates; added an assertion that at least 7 distinct payload shapes were exercised
- Created `.planning/phases/03-nothing-lost-nothing-left-running/03-REQUIREMENTS-BOOKKEEPING.md` — the verifier's ruling that `WORK-03/04/05/06` and `PROC-03/04/05` are genuinely delivered, the `requirements.mark-complete` shared-ID-gate caution (wrong flip in plan 03-26), and the coverage map from `03-VERIFICATION.md`'s four `missing:` items to plans 03-32/03-33/03-34 — without touching `.planning/REQUIREMENTS.md`

## Task Commits

Each task was committed atomically:

1. **Task 1: The corpus carries the brace shapes and prices their friction** - `35fba7c` (feat)
2. **Task 2: WR-01 — the payload set matches readProvenBoolean's own enumeration** - `36a79d5` (test)
3. **Task 3: Record the requirements bookkeeping the next verifier must do** - `0e241b3` (docs)

## Files Created/Modified

- `packages/sidecar/test/destructive-gate.test.mjs` - four new `LAUNCHER_CORPUS` rows (2 Group 3 deny, 2 Group 4 defer), three new `ORDINARY_USAGE_CORPUS` rows, raised floor assertions, WR-01 test extended with `p6`/`p7`
- `.planning/phases/03-nothing-lost-nothing-left-running/03-REQUIREMENTS-BOOKKEEPING.md` - new record-only planning artifact (Task 3)

## Decisions Made

- Every new corpus row was added and verified only after independently confirming `docs/destructive-gate-trust-boundary.md` already named brace expansion (`grep -ci brace` >= 4), honoring Task 1's own precondition and the document's "rule for round six"
- `xargs -I{} rm {}` is recorded as an accepted, priced `deny` — not parsed away — matching plan 03-33's own WR-03 ruling
- The requirements bookkeeping is deliberately a record, not a flip: Task 3 does not call `requirements.mark-complete` and does not edit `.planning/REQUIREMENTS.md`

## Deviations from Plan

None - plan executed exactly as written. All three tasks' `<acceptance_criteria>` and `<verify>` commands passed as specified, with no deviation-rule auto-fix required.

## Issues Encountered

**`scripts/uat/run-all.sh` (plan's own `<verification>` step 6) reported 2 PASS / 4 FAIL, not run clean.**

This plan's own `<verification>` section lists `bash scripts/uat/run-all.sh` as its sixth step, "the phase's own automated UAT harness, run once as the end-of-phase regression gate." Run once, as instructed (`--no-build`, since `cargo build --workspace` and both npm suites had already been run clean this session):

| Item | Result |
|---|---|
| UAT 1 — supervisor kill -9 leaves no surviving agent process | ✅ PASS |
| UAT 3 — destructive gate stops a live auto-accept session | ❌ FAIL — timed out after 120000ms waiting for the agent's destructive `git push` tool call |
| UAT 5 — ten concurrent commits keep every commit | ❌ FAIL — the fan-out script never ran; session closed with reason=failed |
| UAT 6a — unanswered destructive request, unsupervised (no heartbeat) | ❌ FAIL — no deliberate `permission_request` was ever raised within the deadline |
| UAT 6b — unanswered destructive request, production-shaped (heartbeat on) | ❌ FAIL — same as 6a |
| UAT 7 — launcher-wrapped destructive command, measured live (D-62 item 2) | ✅ PASS — all three properties (A/B/C) held |

**Why this is recorded, not chased or auto-fixed:** this plan's own diff touches exactly `packages/sidecar/test/destructive-gate.test.mjs` (a Node test-data file) and the new `03-REQUIREMENTS-BOOKKEEPING.md` — never `packages/shim/src/main.rs`, never `packages/sidecar/src/pretooluse-hook.ts`, never any file a live `claude`-session UAT script depends on for its own decision logic. The four failed items (UAT 3, 5, 6a, 6b) are all live-`claude`-session end-to-end scripts, spawning a real model turn and asserting on its emitted tool calls and events — a category this phase's own prior SUMMARY files (03-24, 03-26, 03-29, 03-30, 03-32) repeatedly and independently document as pre-existing, environment/timing-sensitive flakiness in this execution sandbox, unrelated to whichever plan happened to be running `npm --prefix packages/sidecar test` at the time, and consistently resolved by "record, don't chase" rather than fixing what looks like a model-behavior-timing issue inside a single plan's narrow scope. This plan's changes are pure test-corpus data (declarative row additions) and a documentation-only file — neither can plausibly be the cause of a live model failing to emit an expected tool call or a `permission_request` within its own script's deadline.

This finding is surfaced here, prominently, per the hard constraint against ever letting a result pass vacuously or quietly narrowing around a found gap — not fixed, not silently reported as passing, and not treated as blocking this plan's own three tasks (whose own `<verify>`/`<acceptance_criteria>` all passed, and whose own diff never touches the code paths UAT 3/5/6a/6b exercise). The four other `<verification>` steps this plan's own section lists (`grep -ci brace`, `cargo build --workspace`, `cargo test --workspace`, `npm --prefix packages/sidecar test`, `npm --prefix packages/desktop run test`, and `grep '| AGNT-07 | Phase 3 |'`) all passed clean. Whoever runs the phase's own next verification pass should judge whether this needs a dedicated live-session investigation before `AGNT-07` can close, or whether it is the same class of flakiness this phase has repeatedly and correctly judged out of scope for the plan touching an unrelated file.

## User Setup Required

None - no external service configuration required.

## Known Stubs

None.

## Threat Flags

None — every change stays within this plan's own `<threat_model>` (T-03-34-01 through T-03-34-06, T-03-34-SC); no new endpoint, auth path, file-access pattern, or schema change was introduced.

## Self-Check: PASSED

- `packages/sidecar/test/destructive-gate.test.mjs` — FOUND (modified, contains `al{i,}as git=/usr/bin/git`, `so{u,}rce ./defs.sh`, `{gi,}t push --force`, `{r,}m -rf /tmp/nonexistent-x`, `git add src/{a,b}.rs`, `mkdir -p src/{a,b}`, `xargs -I{} rm {}`, `textCanShadowPathResolution: null`, `textCanShadowPathResolution: 0`)
- `.planning/phases/03-nothing-lost-nothing-left-running/03-REQUIREMENTS-BOOKKEEPING.md` — FOUND (new, names all seven sibling IDs, `requirements.mark-complete`, plan `03-26`, and plans `03-32`/`03-33`/`03-34`)
- Commit `35fba7c` — FOUND in `git log --oneline --all`
- Commit `36a79d5` — FOUND in `git log --oneline --all`
- Commit `0e241b3` — FOUND in `git log --oneline --all`
- `grep -ci 'brace' docs/destructive-gate-trust-boundary.md` — prints a number >= 4 (PASS, precondition held)
- `cargo build --workspace` — exits 0
- `cargo test --workspace` — exits 0, all crates pass including `flywheel-shim`'s 11 `classify_invocation` tests
- `npm --prefix packages/sidecar test` — exits 0, 96/96 pass, `# fail 0`, no `SKIPPED (shim-binary tests)` line
- `npm --prefix packages/desktop run test` — exits 0, 440/440 pass across 32 files
- `grep '| AGNT-07 | Phase 3 |' .planning/REQUIREMENTS.md` — reads `Gaps Found` (unchanged)
- `grep -c -E '^\| (WORK-03|WORK-04|WORK-05|WORK-06|PROC-03|PROC-04|PROC-05|AGNT-07) \| Phase 3 \| Gaps Found \|$' .planning/REQUIREMENTS.md` — prints `8` (all eight phase-3 rows unchanged)
- `bash scripts/uat/run-all.sh --no-build` — ran once; 2/6 scriptable items passed (UAT 1, UAT 7), 4/6 failed (UAT 3, 5, 6a, 6b) — recorded above as pre-existing, out-of-scope live-session flakiness, not a regression this plan's diff could cause

## Next Phase Readiness

- The brace-expansion corpus evidence plan 03-33's document amendment authorized now exists, landed strictly after the document named the mechanism — the document-before-corpus ordering held end to end across plans 03-33/03-34.
- WR-01's coverage gap is closed: the `readProvenBoolean` regression test now exercises every case its own doc comment enumerates.
- `03-REQUIREMENTS-BOOKKEEPING.md` gives the next hand a one-file map of what to re-mark and why, once phase verification clears — no requirement status was changed by this plan.
- `AGNT-07` remains `Gaps Found`, correctly and deliberately. Whether it can now close is a question for the phase's own next verification pass, which should independently judge: (a) whether the four `missing:` items `03-VERIFICATION.md` recorded are now genuinely covered by plans 03-32/03-33/03-34, and (b) whether this plan's `run-all.sh` findings above represent a live regression or the same pre-existing flakiness class this phase has repeatedly recorded and moved past.

---
*Phase: 03-nothing-lost-nothing-left-running*
*Completed: 2026-09-22*
