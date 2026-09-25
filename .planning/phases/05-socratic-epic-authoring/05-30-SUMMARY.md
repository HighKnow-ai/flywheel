---
phase: 05-socratic-epic-authoring
plan: 30
subsystem: testing
tags: [sidecar, adapter, correlation-id, mcp-tool-events, tdd, gap-closure, uat-harness]

# Dependency graph
requires:
  - phase: 05-socratic-epic-authoring
    provides: readNoWorkPlanned / correlateProposeAttempts (plan 05-23/05-27), the challenge-stage propose/answer correlation SHAPE-01 grades
provides:
  - "ToolCallEvent.toolUseId / ToolResultEvent.toolUseId — the wire's own correlation key carried end to end across the adapter seam, optional, absent-never-fabricated"
  - "correlateProposeAttempts rewritten as an exact id lookup — no scan, no claimed-index set"
  - "the uncorrelatable reading plus a fail-closed PASSING_NO_WORK_READINGS allow-list for SHAPE-01's outcome"
  - "interleaved-read-during-proposal — the gap's own shape, driven through the real sidecar offline (9th replay scenario)"
  - "adapter-seam correlation-id tests (packages/sidecar/test/adapter.test.mjs) proving round-trip carry and honest absence"
  - "correlateProposeAttemptsPositionally — the ONE frozen negative control left in the file, a verbatim snapshot of the claimed-index scan at commit 47c10a0, proven to read WRONG on the new fixtures"
affects: [05-socratic-epic-authoring/05-31, 05-socratic-epic-authoring/05-32]

# Actuals (#2632)
actuals:
  tokens: 20761
  tasks: 3
  commits: 3

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "Correlation ids carried end to end through an adapter seam via conditional-spread (present-string-only), mirroring PermissionRequestEvent.requestId's existing convention"
    - "Fail-closed allow-list for a multi-valued reading, replacing a deny-list that let an unanticipated value pass by default"
    - "Exactly one frozen negative control per file, named for the mechanism it replaces, retired outright (not accumulated) when superseded"

key-files:
  created: []
  modified:
    - packages/sidecar/src/adapter.ts
    - packages/sidecar/src/claude-code-adapter.ts
    - packages/sidecar/test/adapter.test.mjs
    - scripts/uat/uat-08-socratic-authoring.mjs
    - scripts/uat/lib/fake-authoring-claude.mjs

key-decisions:
  - "An id-less tool_call/tool_result stream makes the whole challenge window read 'uncorrelatable', which does NOT pass SHAPE-01 — abstain loudly rather than silently degrade to a positional guess (STEP 5's rated, reversible-but-costly decision)."
  - "SHAPE-01's outcome is computed from a named allow-list of passing readings (refused, unproven), not a `!==` deny-list — a reading value nobody anticipated now fails closed instead of passing by default."
  - "Round 6's frozen control (readNoWorkPlannedWithoutClaiming) is retired outright rather than kept alongside a new one — exactly one frozen control (the immediately-superseded mechanism) lives in the file at a time."

requirements-completed: [SHAPE-01, SHAPE-03]

coverage:
  - id: D1
    description: "The wire's own tool_use id / tool_result tool_use_id carried end to end onto ToolCallEvent.toolUseId / ToolResultEvent.toolUseId, absent-never-fabricated"
    requirement: SHAPE-01
    verification:
      - kind: unit
        ref: "packages/sidecar/test/adapter.test.mjs#normaliseStreamEvent: a tool_use block's own id round-trips exactly onto toolUseId"
        status: pass
      - kind: unit
        ref: "packages/sidecar/test/adapter.test.mjs#normaliseStreamEvent: a tool_result block's own tool_use_id round-trips exactly onto toolUseId"
        status: pass
      - kind: unit
        ref: "packages/sidecar/test/adapter.test.mjs#normaliseStreamEvent: a tool_use's id and its answering tool_result's tool_use_id normalise to the SAME toolUseId"
        status: pass
      - kind: e2e
        ref: "node scripts/uat/uat-08-socratic-authoring.mjs --replay-check --scenario interleaved-read-during-proposal"
        status: pass
    human_judgment: false
  - id: D2
    description: "A tool_use/tool_result block declaring no id normalises without throwing and carries NO toolUseId key at all — never present-but-undefined, never present-but-empty, never adopted from a neighbouring field"
    requirement: SHAPE-01
    verification:
      - kind: unit
        ref: "packages/sidecar/test/adapter.test.mjs#normaliseStreamEvent: a tool_use block with no id normalises without throwing, and carries NO toolUseId key at all"
        status: pass
      - kind: unit
        ref: "packages/sidecar/test/adapter.test.mjs#normaliseStreamEvent: a tool_result block with no tool_use_id normalises without throwing, and carries NO toolUseId key at all"
        status: pass
      - kind: unit
        ref: "packages/sidecar/test/adapter.test.mjs#normaliseStreamEvent: a tool_result block carrying an id but no tool_use_id produces NO toolUseId"
        status: pass
      - kind: unit
        ref: "packages/sidecar/test/adapter.test.mjs#normaliseStreamEvent: an empty-string id yields NO toolUseId, never a present-but-empty value"
        status: pass
    human_judgment: false
  - id: D3
    description: "The attempt/answer pairing is an exact id lookup — no scan, no claimed-index set — and correctly reads violated for an interleaved unrelated-tool-call shape and refused for the mirror shape"
    requirement: SHAPE-01
    verification:
      - kind: integration
        ref: "node scripts/uat/uat-08-socratic-authoring.mjs --self-test (readNoWorkPlanned / correlateProposeAttempts checks)"
        status: pass
      - kind: e2e
        ref: "node scripts/uat/uat-08-socratic-authoring.mjs --replay-check (9/9 scenarios)"
        status: pass
    human_judgment: false
  - id: D4
    description: "SHAPE-01's outcome computed from a fail-closed allow-list; the uncorrelatable reading does not pass, and neither does any reading value nobody anticipated"
    requirement: SHAPE-01
    verification:
      - kind: unit
        ref: "node scripts/uat/uat-08-socratic-authoring.mjs --self-test (all four noWorkPlanned readings map to SHAPE-01's own outcome)"
        status: pass
    human_judgment: false
  - id: D5
    description: "Exactly one frozen control remains in the file — correlateProposeAttemptsPositionally, a verbatim snapshot at commit 47c10a0 — asserted side by side to read WRONG on the interleaved fixture; round 6's control is retired outright, not left dead under a comment claiming it is load-bearing"
    requirement: SHAPE-01
    verification:
      - kind: unit
        ref: "node scripts/uat/uat-08-socratic-authoring.mjs --self-test (correlateProposeAttemptsPositionally reads WRONG; the never-referenced-from-live-body + retired-declaration-gone check)"
        status: pass
    human_judgment: false
  - id: D6
    description: "No product change reached packages/core or packages/desktop; no Rust test regressed; no live claude run or credential spent"
    verification:
      - kind: other
        ref: "git diff --quiet 47c10a0..HEAD -- packages/core packages/desktop"
        status: pass
      - kind: integration
        ref: "cargo test --workspace"
        status: pass
    human_judgment: false

# Metrics
duration: 55min
completed: 2026-09-25
status: complete
---

# Phase 05 Plan 30: End-to-end correlation-id carry, closing G-05-5's positional-pairing vacuous pass Summary

**Replaced six rounds of narrowing positional heuristics with an exact id lookup — the wire's own `tool_use.id`/`tool_result.tool_use_id` now carried through the adapter seam onto `ToolCallEvent`/`ToolResultEvent`, `correlateProposeAttempts` rewritten as a map lookup, a fail-closed `uncorrelatable` reading added for id-less streams, and the positional scan frozen as the file's one negative control.**

## Performance

- **Duration:** 55 min (continuation session; Task 1 landed in a prior, watchdog-interrupted session)
- **Started:** 2026-09-25T05:56:00Z (approx, prior session's Task 1 commit)
- **Completed:** 2026-09-25T06:51:10Z
- **Tasks:** 3/3
- **Files modified:** 5 (adapter.ts, claude-code-adapter.ts, adapter.test.mjs, uat-08-socratic-authoring.mjs, fake-authoring-claude.mjs)

## Accomplishments
- `ToolCallEvent.toolUseId` / `ToolResultEvent.toolUseId` carry the Anthropic stream's own `tool_use`/`tool_result` correlation id end to end, absent entirely (never fabricated, never present-but-empty) when the backend declared none
- `correlateProposeAttempts` is now a single map lookup per attempt — no scan, no claimed-index set, no earliest-unclaimed rule — and a new `interleaved-read-during-proposal` scenario proves an unrelated `board_search` call interleaved before a propose attempt's own real answer now reads `violated`, not the vacuous `refused` a positional pairing produced
- A fourth reading, `uncorrelatable`, plus a fail-closed allow-list for SHAPE-01's outcome, means an id-less stream abstains loudly instead of silently passing
- The adapter seam's correlation carry is proven at the product level in `packages/sidecar/test/adapter.test.mjs` (round-trip equality, key-absence on missing/empty ids, no cross-field adoption)
- Round 6's frozen control (`readNoWorkPlannedWithoutClaiming`) is retired outright; the mechanism THIS round replaces (the claimed-index scan, snapshotted verbatim from commit `47c10a0`) is frozen as `correlateProposeAttemptsPositionally`, the file's one remaining negative control, and asserted side by side to read WRONG on the interleaved fixture

## Task Commits

Each task was committed atomically:

1. **Task 1: End-to-end id-based pairing (adapter seam + harness rewrite + 9th scenario)** - `70232b4` (fix) — landed in a prior session before this continuation started
2. **Task 2: Adapter-seam correlation-id tests, including honest absence** - `046c029` (test) — reviewed the 98 uncommitted lines a prior watchdog-interrupted session had written, confirmed they satisfied every acceptance criterion (7 new tests, both round-trip and absence cases, no-fabrication, no-cross-field-adoption), then committed unchanged
3. **Task 3: Retire round 6's frozen control, freeze the positional scan this round replaces** - `3228bd7` (test)

_Note: Task 1's commit predates this continuation session; verified present via `git log` before proceeding, per the orchestrator's prior-state block._

## Files Created/Modified
- `packages/sidecar/src/adapter.ts` - `ToolCallEvent.toolUseId` / `ToolResultEvent.toolUseId` optional fields, doc-commented per `PermissionRequestEvent.requestId`'s convention, no curly braces (pin-regex safe)
- `packages/sidecar/src/claude-code-adapter.ts` - `ClaudeStreamMessage`'s content-block type widened with `id?`/`tool_use_id?`; `normaliseStreamEvent` carries them onto `toolUseId` via conditional spread, never cross-reading
- `packages/sidecar/test/adapter.test.mjs` - seven new tests proving the correlation-id carry and its honest absence at the adapter seam
- `scripts/uat/uat-08-socratic-authoring.mjs` - `CORRELATION_ID_FIELD` pin; `correlateProposeAttempts` rewritten as an id-lookup; `uncorrelatable` reading + `PASSING_NO_WORK_READINGS` allow-list; `interleaved-read-during-proposal` scenario wired into `--self-test` and `--replay-check`; round 6's frozen control retired; `correlateProposeAttemptsPositionally` added as the sole remaining frozen control with its own side-by-side self-test assertion
- `scripts/uat/lib/fake-authoring-claude.mjs` - `interleaved-read-during-proposal` fixture scenario; existing scenarios' `tool_use`/`tool_result` blocks given distinct ids matching the wire they now describe

## Decisions Made
- The absent-id path (`uncorrelatable`) does not pass SHAPE-01 — a wrong-but-loud instrument was judged preferable to a sixth silent narrowing, isolated behind one named reading value and one named allow-list so the decision is a two-line change to reverse if the live `claude` binary turns out not to emit `id` on `tool_use` blocks (rated `costly` in the plan's own reversibility analysis, not `blocking`).
- Round 6's frozen control was deleted outright rather than kept as a second generation alongside the new one — the plan's "exactly one frozen control at a time" rule, enforced in code by a check asserting the retired declaration is gone from the whole file, not merely unreferenced.

## Deviations from Plan

None — plan executed exactly as written. Task 2's test additions were drafted by a prior session that was killed mid-task by a stream-output watchdog before it could commit; this continuation reviewed that uncommitted work against the plan's Task 2 `<behavior>`/`<acceptance_criteria>` in full (seven tests: two round-trip equalities, four absence/no-fabrication cases, one shared-key equality) before adopting it unchanged into the Task 2 commit.

## Issues Encountered

None. One transient local-only test failure surfaced while investigating readiness — running `node --test test/adapter.test.mjs` directly against a stale `dist/` (without the `npm run build` step `npm test` performs) produced 1/25 failures unrelated to this plan's changes (a fake-CLI-spawn event-count assertion). Rebuilding via `npm --prefix packages/sidecar run build` before re-running resolved it; the full `npm --prefix packages/sidecar test` (which always rebuilds first) passed 150/150. Not a deviation — no code was changed to address it, only the correct build step was run.

## User Setup Required

None - no external service configuration required.

## Next Phase Readiness

Ready for 05-31 (the honest-degradation replay scenario and the three-shape self-test battery for the absent-id path) and 05-32 (the validation ledger). SHAPE-01's live dialogue-quality judgement and SHAPE-03's draft-usefulness judgement remain UNJUDGED per the plan's explicit prohibition — no live run happened, both verdict lines in `05-LIVE-CHALLENGE-TRANSCRIPT.md` are untouched, and `.planning/REQUIREMENTS.md` was intentionally not touched by this plan. The `tool_use` block's `id` field remains grounded only in the content-block schema (never a live capture in this repository) — the asymmetry the plan documents and the reason the absent-id path exists.

## Self-Check: PASSED

- FOUND: packages/sidecar/src/adapter.ts
- FOUND: packages/sidecar/src/claude-code-adapter.ts
- FOUND: packages/sidecar/test/adapter.test.mjs
- FOUND: scripts/uat/uat-08-socratic-authoring.mjs
- FOUND: scripts/uat/lib/fake-authoring-claude.mjs
- FOUND commit 70232b4 (Task 1)
- FOUND commit 046c029 (Task 2)
- FOUND commit 3228bd7 (Task 3)
- Plan-level `<verification>` re-run: `npm --prefix packages/sidecar run build` (exit 0), `--self-test` (0 FAIL lines), `--replay-check` (9/9 PASS), `--replay-check --scenario interleaved-read-during-proposal` (PASS, `violated`), `npm --prefix packages/sidecar test` (150/150), `cargo test --workspace` (all green), `git diff --quiet 47c10a0..HEAD -- packages/core packages/desktop` (clean), `git diff --quiet 47c10a0..HEAD -- .../05-LIVE-CHALLENGE-TRANSCRIPT.md` (clean)

---
*Phase: 05-socratic-epic-authoring*
*Completed: 2026-09-25*
