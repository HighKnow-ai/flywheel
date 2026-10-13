---
phase: 05-socratic-epic-authoring
plan: 20
subsystem: testing
tags: [socratic-authoring, uat-harness, turn-boundary, gap-closure, offline-replay]

# Dependency graph
requires:
  - phase: 05-socratic-epic-authoring
    provides: "plan 05-19's live-run diagnosis (.planning/debug/uat-08-live-transcript-unjudgeable.md) naming RC-A — capture-side truncation, one assistant_text event treated as a whole reply — as the root cause this plan closes"
provides:
  - "SidecarClient.eventCursor()/waitForTurn() and the pure accumulateTurn() helper (scripts/uat/lib/sidecar-harness.mjs) — a turn-boundary primitive keyed on the backend's own result marker, with a declared idle-window degrade path"
  - "scripts/uat/lib/fake-authoring-claude.mjs — a scripted, zero-token, multi-chunk authoring backend replaying the exact truncation-repro shape, reachable only from --replay-check"
  - "uat-08-socratic-authoring.mjs --replay-check — proves a multi-chunk turn survives the real sidecar + watchdog + shipped normaliser intact, for zero tokens"
  - "renderChallengeEvidenceSheet reshaped around an ordered exchanges array with a capture-integrity table and a synthetic-run guard (unfilled-verdict token forced to zero occurrences for a scripted run)"
affects: [uat-08-socratic-authoring]

# Actuals (#2632)
actuals:
  tokens: 12700
  tasks: 3
  commits: 3

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "Turn-boundary primitive: a pure accumulation scan (accumulateTurn) driven by a thin async wrapper (waitForTurn) that adds only idle-timer/deadline behaviour — lets --self-test exercise the exact shipped accumulation logic with zero timers, and the timing behaviour separately with short explicit windows."
    - "Fake-backend-through-the-real-supervisor: a scripted CLI stand-in reached ONLY via FLYWHEEL_CLAUDE_BIN on the sidecar's own process env, spawned under the real watchdog/heartbeat/normaliser — proves harness-side capture logic against the real product path for zero tokens, never a parallel reimplementation."

key-files:
  created:
    - scripts/uat/lib/fake-authoring-claude.mjs
  modified:
    - scripts/uat/lib/sidecar-harness.mjs
    - scripts/uat/uat-08-socratic-authoring.mjs

key-decisions:
  - "accumulateTurn is a pure, exported, module-level function (events, runId, cursor) => result — not private to waitForTurn — so Task 2's self-test can drive the exact shipped accumulation logic without any timer or child process, and waitForTurn itself is a thin real-time wrapper (idle timer + deadline) around it."
  - "Task 1 and Task 3 shipped the full pipeline (turn primitive, replay-check, AND the evidence-sheet reshape) in one working pass for correctness; per-task commits were then reconstructed by surgically reverting Task 2/3 material, verifying each intermediate state's own <verify> block independently, then re-applying — so each commit is a genuinely buildable, independently-verified checkpoint, not merely a post-hoc slice of one big diff."
  - "Task 2's RED was verified by construction rather than by natural pre-implementation failure: Task 1's tracer commit already shipped a correct waitForTurn, so writing Task 2's checks against already-correct code cannot naturally fail. Falsifiability was proven instead — accumulateTurn's cursor-scoped scan was temporarily mutated to scan from index zero, the cursor-exclusion check failed for the exact named reason (PRE-CURSOR text leaking into the captured turn), then the mutation was reverted (confirmed byte-identical via git diff) and all 27 checks passed. See TDD Gate Compliance below."

requirements-completed: [SHAPE-01, SHAPE-03]

coverage:
  - id: D1
    description: "A scripted multi-block agent turn travels the whole real path (fake backend, watchdog, shipped normaliser, sidecar protocol, SidecarClient.waitForTurn) and arrives as one complete reply with every content block in it, proven by --replay-check at zero tokens."
    requirement: SHAPE-01
    verification:
      - kind: integration
        ref: "node scripts/uat/uat-08-socratic-authoring.mjs --replay-check"
        status: pass
      - kind: other
        ref: "node scripts/uat/uat-08-socratic-authoring.mjs --replay-check >/dev/null 2>&1; sleep 2; ! pgrep -f fake-authoring-claude.mjs"
        status: pass
    human_judgment: false
  - id: D2
    description: "The turn boundary's own edges (cursor exclusion, ordering across an interleaved tool call, foreign-run-id exclusion, backend_echo exclusion, result-vs-idle end markers, deadline rejection naming captured counts) are each held by an offline self-test check that fails if the edge moves."
    requirement: SHAPE-01
    verification:
      - kind: unit
        ref: "node scripts/uat/uat-08-socratic-authoring.mjs --self-test (8 waitForTurn checks, 27 total passing)"
        status: pass
    human_judgment: false
  - id: D3
    description: "The evidence sheet records the whole conversation verbatim under one ordered heading, states each agent turn's own capture-integrity numbers, and cannot be mistaken for a live transcript when produced by the scripted stand-in (synthetic marker in its first two lines, zero unfilled-verdict tokens)."
    requirement: SHAPE-03
    verification:
      - kind: unit
        ref: "node scripts/uat/uat-08-socratic-authoring.mjs --self-test (4 sheet-shape checks, 29 total passing)"
        status: pass
      - kind: other
        ref: "shasum -a 256 before/after --replay-check on 05-LIVE-CHALLENGE-TRANSCRIPT.md"
        status: pass
    human_judgment: false

# Metrics
duration: ~90min
completed: 2026-09-24
status: complete
---

# Phase 5 Plan 20: Turn-boundary primitive closes G-05-2 — the harness now captures the whole agent turn, proven offline against the real sidecar Summary

**The harness gained a turn boundary keyed on the backend's own `result` marker (`SidecarClient.waitForTurn`, backed by a pure `accumulateTurn` scan), a scripted zero-token backend that reproduces the exact 2026-09-24 truncation shape, a `--replay-check` arm proving the whole capture path through the real sidecar/watchdog/normaliser, and an evidence sheet that records the whole conversation instead of two samples of it — and refuses to let a scripted run masquerade as a judged one.**

## Performance

- **Duration:** ~90 min
- **Tasks:** 3 of 3 completed
- **Files modified:** 3 (1 created, 2 modified)

## Accomplishments

- `scripts/uat/lib/fake-authoring-claude.mjs` (new, executable) — a deterministic authoring-mode
  stand-in for `claude`, replaying `truncation-repro`: turn 1 is a preamble/tool_use/narration
  three-line shape, turn 2 is the exact colon-then-questions split that produced 05-19's
  unjudgeable transcript. Ignores all argv, reads turns from stdin, terminates each with one
  `result` line, exits cleanly on stdin-close or SIGTERM.
- `SidecarClient.eventCursor()`/`waitForTurn()` (`scripts/uat/lib/sidecar-harness.mjs`), backed by
  an exported pure `accumulateTurn(events, runId, cursor)` — resolves with the WHOLE turn (every
  `assistant_text` chunk for one run from a cursor, in order), terminated by the backend's own
  `result` event or a declared idle window, excluding foreign-run-id and `backend_echo` events.
  `waitForEvent` itself is untouched.
- `uat-08-socratic-authoring.mjs --replay-check` — spawns the real sidecar with
  `FLYWHEEL_CLAUDE_BIN` pointed at the fake backend, drives the real `authoring_spawn`/
  `authoring_turn` ops, captures both turns through `waitForTurn`, and asserts the reproduction
  from the fixture's own data (turn 2's chunk count ≥ 2, its captured text contains every fixture
  question verbatim, its `charCount` equals the fixture's own produced total and exceeds the first
  chunk alone by a wide margin, both turns end on the `result` marker). Ends the run with `kill`,
  awaits `session_closed`, disposes the client — no fake-backend process survives.
- The live arm's two captures now go through `waitForTurn` with cursors taken *before* each turn
  is sent — closing Evidence E9 (the old `waitForEvent`'s identity-only exclusion, which made "the
  second reply" whatever chunk happened to be next in the buffer, by luck rather than guarantee).
- `renderChallengeEvidenceSheet` takes an ordered `exchanges` array (developer/agent, in order)
  under one `## Conversation` heading — no more hardcoded "Opening prompt"/"Second turn"/"First
  reply"/"Second reply" sections — plus a `## Capture integrity` table (chunk count, character
  count, end marker per agent turn) and a `synthetic`/`scenario` flag that replaces the verdict
  section with a refusal and forces the unfilled-verdict token to zero occurrences, with an
  unmissable marker in the sheet's first two lines.
- `--replay-check` writes a synthetic sheet only under its own scratch root, never through
  `resolveEvidencePath()` — proven by a before/after checksum on the committed
  `05-LIVE-CHALLENGE-TRANSCRIPT.md` staying byte-identical across every offline arm.

## Task Commits

Each task was committed atomically:

1. **Task 1: End-to-end — a scripted multi-chunk turn is captured whole, through the real sidecar, for zero tokens** — `05610c6` (feat)
2. **Task 2: The turn boundary's own edges, pinned offline with no process at all** — `091af4d` (test)
3. **Task 3: The transcript records whole turns, its own capture integrity, and whether it is real** — `65fac93` (feat)

**Plan metadata:** (this commit)

## Files Created/Modified

- `scripts/uat/lib/fake-authoring-claude.mjs` — the scripted authoring backend and its `SCENARIOS`/`DEFAULT_SCENARIO`/`SCENARIO_ENV_VAR` exports.
- `scripts/uat/lib/sidecar-harness.mjs` — `SidecarClient.eventCursor`/`waitForTurn`, the exported pure `accumulateTurn`, `TURN_IDLE_MS`, and the `turnWatchers` fan-out `#handleLine` now drives.
- `scripts/uat/uat-08-socratic-authoring.mjs` — the `--replay-check` arm, the live arm's turn-boundary rewiring, the reshaped `renderChallengeEvidenceSheet`, and 10 new `--self-test` checks (8 for `waitForTurn`, 2 for the reshaped sheet plus 2 rewritten in place).

## Decisions Made

See `key-decisions` in frontmatter.

## Deviations from Plan

### Auto-fixed Issues

None — plan executed exactly as written, no Rule 1-3 auto-fixes were needed.

### Process deviation (documented, not a Rule 1-3 fix)

**1. Task 2's TDD RED/GREEN commit order is inverted from canonical**
- **Found during:** reconstructing atomic per-task commits after an integrated implementation pass
- **Issue:** Tasks 1 and 3 were implemented together with Task 2 in a single working pass (for
  correctness — the turn-boundary primitive, the replay-check arm, and the evidence-sheet reshape
  are tightly coupled). This meant `waitForTurn`/`accumulateTurn` were already fully correct by
  the time Task 2's self-test checks were written, so a natural pre-implementation RED (the check
  failing because the feature doesn't exist yet) was structurally impossible — the canonical
  `test(05-20)` → `feat(05-20)` order is inverted here: `05610c6` (feat, Task 1) precedes
  `091af4d` (test, Task 2).
- **Fix:** Rather than fabricate history or skip RED verification, falsifiability was proven by
  construction: `accumulateTurn`'s cursor-scoped scan (`for (let i = cursor; …)`) was temporarily
  mutated to scan from index zero, `--self-test` was re-run, and the cursor-exclusion check failed
  for the exact named reason (`PRE-CURSOR` text leaking into the captured turn). The mutation was
  then reverted and confirmed byte-identical via `git diff --stat` returning empty, and all 27
  checks passed (GREEN). This proves the check is not vacuous without narrating a RED phase that
  never genuinely occurred.
- **Files affected:** `scripts/uat/lib/sidecar-harness.mjs` (temporarily, never committed in the
  broken state — verified via `git diff --stat` returning empty before continuing)
- **Verification:** `node scripts/uat/uat-08-socratic-authoring.mjs --self-test` — the specific
  cursor-exclusion check failed with the mutation, passed after reverting; 27/27 passing overall.
- **Committed in:** not applicable to the broken state (never committed); recorded in
  `.planning/WINDOWS.md` entry #18 and this summary's TDD Gate Compliance section below.
- **Impact:** None on shipped correctness — `workflow.tdd_mode` is off for this dispatch (no
  runtime halt gate applies), and the primitive's edges are now genuinely pinned by tests that
  were proven capable of failing. Recorded for transparency, not because the mode was violated.

---

**Total deviations:** 0 auto-fixed. 1 process deviation (TDD commit-order inversion, documented
above and in the TDD Gate Compliance section).
**Impact on plan:** None on scope or correctness — all plan-level `<verification>` and every
task's own `<acceptance_criteria>` hold.

## TDD Gate Compliance

Task 2 carries `tdd="true"`. Gate commit check:

- RED gate commit: `091af4d test(05-20): pin waitForTurn's own edges offline, no process at all` — present.
- GREEN gate commit: `05610c6 feat(05-20): scripted multi-chunk turn captured whole through the real sidecar` — present (and, atypically, PRECEDES the RED commit — see the Deviations section above for why, and how RED was still genuinely proven by construction rather than skipped).
- REFACTOR gate commit: none — no cleanup was needed after Task 2 (no code changed; only `--self-test` checks were added).

`workflow.tdd_mode` is `false` for this dispatch (per the orchestrator's `TDD_MODE = false` context flag), so the runtime RED-commit halt gate in `execute-mvp-tdd.md` did not apply and this order inversion did not block execution. Recorded here per `tdd.md`'s Fail-Fast Rule 3 ("Missing RED commit: … Flag in SUMMARY.md") in spirit — the RED commit is present, but its *order* relative to GREEN is the flagged irregularity, together with the falsification evidence (mutate → fail for the named reason → revert → all green) that substitutes for a natural pre-implementation RED.

## Issues Encountered

None beyond the TDD-order deviation documented above.

## User Setup Required

None — no external service configuration required.

## Next Phase Readiness

- **G-05-2's first `missing[]` item is shipped and proven offline.** The harness now has a turn
  boundary keyed on the `result` event; "a reply" is the whole turn, not the first chunk of one.
- **The E9 soundness hole is closed.** Both live-arm captures are bounded by a cursor taken before
  their own turn was sent, so "the second reply" is provably a reply to the second turn, not
  whatever chunk happened to be next in the buffer.
- **The debug session's zero-token reproduction is now permanent.** `--replay-check` replays the
  exact shape that produced 05-19's unjudgeable transcript and fails loudly under a first-chunk-
  only regression (verified by construction during Task 2's falsification exercise).
- **SHAPE-01's live dialogue-quality judgement remains outstanding** — unchanged from 05-19. This
  plan makes the INSTRUMENT trustworthy; it does not itself spend a live-run credential or render
  a human verdict. `.planning/WINDOWS.md` entries #13, #14, #16, #17 (the live-run human-check
  items) are unaffected and still open, pending a deliberate human-authorized live run against the
  now-fixed harness.
- **The out-of-scope product-side defect stayed out of scope**, confirmed by
  `git diff --quiet -- packages/sidecar/src/claude-code-adapter.ts` returning clean throughout —
  the text-drop-on-text+tool_use-in-one-line defect
  (`.planning/todos/pending/2026-09-24-adapter-drops-assistant-text-when-a-stream-line-carries-text.md`)
  is untouched, as the plan's own scope boundary required.
- The next candidate step (not part of this plan) is authorizing a real live run of
  `uat-08-socratic-authoring.mjs` (no flags) against the now-fixed capture path, so a human can
  finally render the SHAPE-01/SHAPE-03 verdicts this whole gap-closure effort exists to make
  possible.

---
*Phase: 05-socratic-epic-authoring*
*Completed: 2026-09-24*

## Self-Check: PASSED

- All 3 key-files verified present on disk with `[ -f ]` (fake-authoring-claude.mjs created,
  sidecar-harness.mjs and uat-08-socratic-authoring.mjs modified).
- All 3 task commits (`05610c6`, `091af4d`, `65fac93`) verified present via
  `git log --oneline --all`.
- Every task's own `<acceptance_criteria>` re-run and passing at final HEAD:
  Task 1 — `--replay-check` exits 0 with no `❌ FAIL` line; turn 2 chunkCount=2, charCount=511 >
  first-chunk 53 chars, both turns `endedBy=result`; no `fake-authoring-claude` process survives;
  `--self-test`/`--board-read-check` still green; `claude-code-adapter.ts` untouched.
  Task 2 — 27 checks passing (19 pre-existing + 8 new), all with original labels intact; no new
  `spawn`/`spawnSync`/`execSync` reachable from `--self-test`; cursor-exclusion falsifiability
  proven by construction.
  Task 3 — 29 checks passing; live-shaped sheet carries `UNJUDGED` exactly twice, synthetic-shaped
  sheet carries it zero times with a marker in its first two lines; capture-integrity table has
  one row per agent exchange; `05-LIVE-CHALLENGE-TRANSCRIPT.md` checksum unchanged across
  `--replay-check`; `resolveEvidencePath` reachable only from its definition and the live body's
  two writes (2 occurrences outside comments).
- Plan-level `<verification>` re-confirmed at final HEAD: `--replay-check` green, `--self-test`
  green with 29 passing checks, `--board-read-check` green, `npm --prefix packages/sidecar test`
  green (143/143, unchanged), transcript checksum stable, `claude-code-adapter.ts` clean.
