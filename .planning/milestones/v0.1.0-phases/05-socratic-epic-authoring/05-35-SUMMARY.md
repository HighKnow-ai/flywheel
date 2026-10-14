---
phase: 05-socratic-epic-authoring
plan: 35
subsystem: testing
tags: [uat-harness, documentation, gap-closure, requirements-traceability]

# Dependency graph
requires:
  - phase: 05-socratic-epic-authoring
    provides: "The credential-seam machinery (plan 05-33) and the wire-first non-conversation classifier (plan 05-34) — this plan documents and records what those two plans shipped, without touching any executable code"
provides:
  - "A corrected `scripts/uat/README.md`: the stale `back-to-back-proposals` bullet (05-REVIEW.md WR-01) now states only what the scenario's code actually asserts, the eleventh `--replay-check` scenario is documented, Item 8 records a seventh finding and a fifth rule, and an operator-facing credential-seam section names the four exported symbols an operator would grep for before spending a live credential"
  - "Eight new rows in `05-VALIDATION.md`'s per-task ledger (05-33-01..03, 05-34-01..03, 05-35-01..02), each citing a command actually run and observed, plus both manual-only rows' three-part 'what this round proved/did NOT measure/has NOT changed' cells updated for this closure — no existing row turned green, the red `05-22-03` row textually unchanged"
  - "SHAPE-01/SHAPE-03 entries in REQUIREMENTS.md narrowed to state exactly what this closure proved (live authentication now reachable, non-conversation turns now wire-classified) while staying unchecked, UNJUDGED, and free of any API-key path"
affects: [05-socratic-epic-authoring]

# Actuals (#2632) — chars/4 over the realized diff (git diff --stat across all 3 task commits)
actuals:
  tokens: 7207
  tasks: 3
  commits: 3
plan_head_before: bd94c5145323848ed195436716d3dd0d895671b6

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "A defect-class register (README Item 8) that names its own recurrence count explicitly (SEVENTH) rather than letting a new finding read as isolated — the same discipline the six prior rounds established, applied to this round's own finding about itself"
    - "Ledger rows cite the command actually run and observed from a prior plan's own SUMMARY, never a command composed at ledger-writing time — closing the exact class of overstatement 05-REVIEW.md's earlier WR-01 (bare unranged git diff --quiet) warned against"

key-files:
  created: []
  modified:
    - scripts/uat/README.md
    - .planning/phases/05-socratic-epic-authoring/05-VALIDATION.md
    - .planning/REQUIREMENTS.md

key-decisions:
  - "The `back-to-back-proposals` bullet's replacement text states only what `runReplayCheckScenario`'s current branch actually asserts (confirmed by direct inspection before writing: it computes `claimedReading` via `correlateProposeAttempts` and asserts `violated`, with no `preClaimingReading`/positional comparison anywhere in that branch) — the dated comparison clause was deleted entirely, not softened or requalified, per the plan's own instruction."
  - "The credential-seam operator section was placed inside Item 6's existing config-isolation paragraph (immediately after its `cleanClaudeConfigEnv` sentence) rather than inside Item 8 — the plan's own instruction was 'near the existing config-isolation paragraph rather than buried in Item 8', and Item 6 is where that paragraph already lives."
  - "Only 8 ledger rows were added (05-33-01..03, 05-34-01..03, 05-35-01..02), per the plan's own explicit enumeration — no 05-35-03 row exists, since the plan's Task 2 action text named exactly these eight and no more."
  - "SHAPE-01/SHAPE-03 remain unchecked and both `05-LIVE-CHALLENGE-TRANSCRIPT.md` verdict lines remain UNJUDGED, per this plan's own must_haves.prohibitions — this plan documents that the live judgement is now REACHABLE, never that it has been MADE."

requirements-completed: [SHAPE-01, SHAPE-02, SHAPE-03, SHAPE-04, SHAPE-05]

coverage:
  - id: D1
    description: "The stale `back-to-back-proposals` scenario description is corrected to match the shipped code, and the eleventh `--replay-check` scenario is documented in the README's scenario list"
    requirement: "SHAPE-01"
    verification:
      - kind: other
        ref: "grep -c 'as it shipped on 2026-09-24' scripts/uat/README.md -> 0"
        status: pass
      - kind: other
        ref: "node -e cross-check: every key of SCENARIOS in scripts/uat/lib/fake-authoring-claude.mjs appears verbatim in scripts/uat/README.md (all 11 present, including unauthenticated-backend-first-turn)"
        status: pass
    human_judgment: false
  - id: D2
    description: "Item 8 records the seventh finding (an unauthenticated CLI's login notice counted as agent speech, root-caused to the same inference-over-wire-fact class plan 05-30 ended), the trap that the result line's own subtype reads success on this error, and a fifth rule about one mechanism enforcing two properties at once"
    requirement: "SHAPE-01"
    verification:
      - kind: other
        ref: "grep -c 'SEVENTH' scripts/uat/README.md -> 1"
        status: pass
      - kind: other
        ref: "grep -n 'subtype' scripts/uat/README.md -> present, stating the result line's own subtype reads success on the captured error"
        status: pass
    human_judgment: false
  - id: D3
    description: "An operator-facing section documents the credential seam (CREDENTIAL_LINK_ALLOWLIST, BEHAVIOURAL_CONFIG_DENYLIST, assertBackendAuthenticated, scrubApiKeyEnv) and the README's file-role table gains a row for scripts/uat/fixtures/"
    requirement: "SHAPE-01"
    verification:
      - kind: other
        ref: "grep -c for each of the four symbol names in scripts/uat/README.md -> 1 each"
        status: pass
      - kind: other
        ref: "grep -c 'scripts/uat/fixtures/' scripts/uat/README.md -> 2 (prose reference + file-role table row)"
        status: pass
    human_judgment: false
  - id: D4
    description: "The validation ledger carries a row for every task in this closure (8 total across plans 05-33/05-34/05-35), each naming a command actually run and observed from that plan's own SUMMARY; no existing row is turned green and the red 05-22-03 row is textually unchanged"
    requirement: "SHAPE-01"
    verification:
      - kind: other
        ref: "grep -c '^| 05-3[3-5]-0[0-9] |' 05-VALIDATION.md -> 8"
        status: pass
      - kind: other
        ref: "grep -c '^| 05-22-03 |.*❌ red' 05-VALIDATION.md -> 1 (unchanged)"
        status: pass
      - kind: other
        ref: "grep -c '^| 05-3[3-5]-0[0-9] |.*git diff --quiet' 05-VALIDATION.md -> 0 (no new row cites a bare unranged history check)"
        status: pass
    human_judgment: false
  - id: D5
    description: "SHAPE-01 and SHAPE-03's REQUIREMENTS.md entries and status-table rows are narrowed to state exactly what this closure proved (live authentication now reachable via subscription login with config isolation preserved; non-conversation turns now classified from the wire's own error flag); both stay unchecked, both cite UNJUDGED and 05-LIVE-CHALLENGE-TRANSCRIPT.md, no ANTHROPIC_API_KEY path is named, and SHAPE-02/04/05 are untouched"
    requirement: "SHAPE-01, SHAPE-03"
    verification:
      - kind: other
        ref: "grep -c '^- \\[ \\] \\*\\*SHAPE-01\\*\\*' / SHAPE-03 REQUIREMENTS.md -> 1 each; grep -c '^- \\[x\\] \\*\\*SHAPE-0[245]\\*\\*' -> 3"
        status: pass
      - kind: other
        ref: "grep -ci 'ANTHROPIC_API_KEY' REQUIREMENTS.md -> 0; git diff --quiet -- 05-LIVE-CHALLENGE-TRANSCRIPT.md -> clean"
        status: pass
    human_judgment: false
  - id: D6
    description: "Whether the live acceptance run itself (now structurally reachable) produces a genuine, judgeable transcript remains outside this plan's scope — no live run happened, no credential was spent, and both verdict lines stay UNJUDGED"
    human_judgment: true
    rationale: "This closure proves the seam is now reachable and correctly classified offline; whether a real claude.ai-authenticated session actually authenticates cleanly end to end, and whether its dialogue is genuinely challenging, is a live judgement outside this plan's scope by explicit prohibition (must_haves.prohibitions) — a human must run the live arm deliberately, spending a real credential, before either verdict line can be filled."

duration: 12min
completed: 2026-09-25
status: complete
---

# Phase 5 Plan 35: Close Gap G-05-6's Documentation Drift — Seventh Finding, Credential Seam, Ledger and Requirements Narrowing Summary

**Corrects two shipped README descriptions that had drifted from the code they describe, records the phase's seventh recurring-defect-class finding and a fifth rule (Item 8), documents the credential seam plans 05-33/05-34 built for the next operator, writes eight evidence-backed rows into the validation ledger, and narrows SHAPE-01/SHAPE-03 to exactly what this round proved — without turning any ledger row green, without filling either live verdict line, and without naming an API key anywhere.**

## Performance

- **Duration:** 12 min
- **Started:** 2026-09-25T10:17:00Z
- **Completed:** 2026-09-25T10:29:00Z
- **Tasks:** 3 completed
- **Files modified:** 3

## Accomplishments

- `scripts/uat/README.md`: the `back-to-back-proposals` bullet no longer describes a comparison plan 05-30's own diff deleted (05-REVIEW.md WR-01 closed); the eleventh `--replay-check` scenario (`unauthenticated-backend-first-turn`, plan 05-34) is documented in the scenario list, which now names all eleven `SCENARIOS` keys one to one; Item 8 records the seventh finding (root-caused to the same wire-fact-inference class plan 05-30 ended, with the trap that the result line's own `subtype` reads `success` on this error) and a fifth rule about one mechanism enforcing two properties at once; a new operator-facing section documents the credential seam, naming `CREDENTIAL_LINK_ALLOWLIST`, `BEHAVIOURAL_CONFIG_DENYLIST`, `assertBackendAuthenticated` and `scrubApiKeyEnv`; the file-role table gained a row for `scripts/uat/fixtures/`.
- `05-VALIDATION.md`: eight new per-task rows (`05-33-01..03`, `05-34-01..03`, `05-35-01..02`), each citing a command actually run and observed from the preceding plans' own SUMMARY files; both manual-only rows' "what this round proved / did NOT measure / has NOT changed" cells rewritten for this closure, preserving the still-true, previously-recorded caveat about the live `tool_use` block's own unmeasured `id`.
- `REQUIREMENTS.md`: SHAPE-01 and SHAPE-03's entries and status-table rows narrowed to state that the live arm can now authenticate on the developer's own subscription login with configuration isolation preserved, and that a non-conversation backend message is now classified from the wire's own error flag rather than from its prose — both stay unchecked, both cite `UNJUDGED` and `05-LIVE-CHALLENGE-TRANSCRIPT.md`, and no `ANTHROPIC_API_KEY` path is named anywhere. SHAPE-02/04/05 untouched.

## Task Commits

Each task was committed atomically:

1. **Task 1: Correct the stale scenario description, record the seventh finding and the rule it earns, and document the credential seam for the next operator** — `2e752b1` (docs)
2. **Task 2: Write this closure's evidence into the validation ledger without turning a single existing row green** — `b848804` (docs)
3. **Task 3: Narrow the two open requirement lines to exactly what this round proved, and put the live-run decision to the developer** — `f4bae29` (docs)

**Plan metadata:** committed separately after this SUMMARY.

## Files Created/Modified

- `scripts/uat/README.md` — corrected `back-to-back-proposals` bullet, eleventh scenario bullet (`unauthenticated-backend-first-turn`), Item 8's seventh finding and fifth rule, the credential-seam operator section, and a file-role table row for `scripts/uat/fixtures/`
- `.planning/phases/05-socratic-epic-authoring/05-VALIDATION.md` — eight new per-task rows and both manual-only rows' updated three-part cells
- `.planning/REQUIREMENTS.md` — rewritten SHAPE-01/SHAPE-03 entries and their two status-table rows

## Decisions Made

See `key-decisions` in the frontmatter above — in short: the `back-to-back-proposals` bullet's replacement was verified against the actual shipped code (`runReplayCheckScenario`'s current branch) before writing, not merely against the plan's own description of it; the credential-seam section was placed inside Item 6's existing config-isolation paragraph, matching the plan's own "near... rather than buried in Item 8" instruction; exactly eight ledger rows were added, per the plan's own explicit list (no `05-35-03` row); and SHAPE-01/SHAPE-03 stay unchecked with both verdict lines UNJUDGED, per this plan's own prohibitions.

## Deviations from Plan

None - plan executed exactly as written. All three tasks' `<acceptance_criteria>` and the plan-level `<verification>` block passed on first execution; no repair cycles were needed.

## Issues Encountered

None.

## User Setup Required

None — no external service configuration required. This plan is documentation and record-keeping only; no code was touched, no server was started, and no credential was spent.

## Next Phase Readiness

- Gap G-05-6's MINOR finding (two shipped descriptions contradicting shipped code) is closed: every description in `scripts/uat/` now matches the code it describes, confirmed by the registry-to-README cross-check and direct inspection of `runReplayCheckScenario`'s current branch.
- The validation ledger and the requirements register now accurately reflect what plans 05-33/05-34/05-35 actually proved — reachable live authentication and wire-first non-conversation classification — without overstating a live run that did not happen.
- `05-LIVE-CHALLENGE-TRANSCRIPT.md` is unchanged by this plan (confirmed via `git diff --quiet`); both verdict lines remain `UNJUDGED`. SHAPE-01/SHAPE-03 stay unchecked in `REQUIREMENTS.md`.
- The live acceptance run (`node scripts/uat/uat-08-socratic-authoring.mjs`, no flags) is the developer's own next, deliberate step — no blockers remain in this phase's own instrumentation for taking it.

---
*Phase: 05-socratic-epic-authoring*
*Completed: 2026-09-25*

## Self-Check: PASSED
