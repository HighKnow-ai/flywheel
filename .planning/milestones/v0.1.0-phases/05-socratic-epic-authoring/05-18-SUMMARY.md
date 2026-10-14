---
phase: 05-socratic-epic-authoring
plan: 18
subsystem: testing
tags: [socratic-authoring, board-read, uat-harness, rust, node, sidecar-protocol]

# Dependency graph
requires:
  - phase: 05-socratic-epic-authoring
    provides: "D-87's board_read_request wire protocol (plan 05-05), the uat_authoring_ops bridge binary and the drainIncidentalPermissionRequests loop (plan 05-10/05-11)"
provides:
  - "query::authoring::resolve_board_read — the ONE board-read dispatch, called by both the desktop app's inbound handler and the UAT bridge's answer-board-read verb"
  - "scripts/uat/lib/sidecar-harness.mjs's generalised drainInboundCoreRequests loop, with drainIncidentalPermissionRequests demoted to a signature-preserving preset over it"
  - "an offline, zero-token proof (--board-read-check) that the whole board-read round trip resolves against a real scratch board"
  - "a named harness-failure assertion (assertAllHeldRequestsAnswered) closing the starvation class that produced this gap"
affects: [uat-08-socratic-authoring, uat-06-permission-block-lifecycle, uat-07-launcher-shape-gate]

# Actuals (#2632)
actuals:
  tokens: 12800
  tasks: 3
  commits: 3

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "One dispatch function shared by a production Tauri command handler and an offline test-harness bridge binary, rather than two copies of the same query logic (D-87's own held-request round trip, now closed on both the read side and the answer side)."
    - "A generalised held-inbound-request drain (drainInboundCoreRequests, dispatching by event.type to a handlers map) with the prior single-purpose loop demoted to a thin preset over it — the promote pattern this plan's assumption_delta_decision names explicitly."

key-files:
  created:
    - packages/core/tests/authoring_board_read.rs
  modified:
    - packages/core/src/query/authoring.rs
    - packages/desktop/src-tauri/src/commands/authoring.rs
    - packages/core/tests/bin/uat_authoring_ops.rs
    - packages/core/tests/epic_context_packet.rs
    - scripts/uat/lib/sidecar-harness.mjs
    - scripts/uat/uat-08-socratic-authoring.mjs

key-decisions:
  - "Promoted the harness's single-purpose permission drain into a generalised drainInboundCoreRequests loop dispatching by event.type, per the plan's own assumption_delta_decision — drainIncidentalPermissionRequests kept its exact signature and became a thin preset over it, so uat-06/uat-07's existing callers and uat-08's own pre-existing self-test assertions needed zero edits."
  - "Fixed an existing test (epic_context_packet.rs's unbounded-SELECT allowlist gate) that the extraction tripped: the two inline SELECTs inside resolve_board_read moved from the desktop crate (outside the gate's scan scope) into packages/core/src/query (inside it). Allowlisted resolve_board_read with the same cardinality-one/aggregate justification already recorded for get_epic_for_agent and BLOCKED_COUNT_SQL — not a real unbounded read, just a function name the gate had never seen before."

requirements-completed: [SHAPE-01, SHAPE-02, SHAPE-03, SHAPE-04]

coverage:
  - id: D1
    description: "resolve_board_read is the one board-read dispatch, called by both the desktop app's handle_inbound_board_read_request (now a relay shell) and the UAT bridge's answer-board-read verb — no second copy of the scope resolution or clamp arithmetic."
    requirement: SHAPE-02
    verification:
      - kind: integration
        ref: "cargo build --workspace"
        status: pass
      - kind: other
        ref: "grep gate: exactly one resolve_board_read call site in commands/authoring.rs, zero references to flywheel_core::query::authoring::MAX_LIMIT there"
        status: pass
      - kind: integration
        ref: "packages/core/tests/authoring_board_read.rs (4 tests: scope, clamp/truncation, cross-project not-found equality, unknown-kind error)"
        status: pass
    human_judgment: false
  - id: D2
    description: "uat_authoring_ops gained an answer-board-read subcommand: reads one JSON board_read_request event from stdin, calls resolve_board_read, prints {result} or {error} and always exits 0 (only a usage failure is non-zero) so a held call is always released."
    requirement: SHAPE-01
    verification:
      - kind: integration
        ref: "cargo build -p core --bin uat_authoring_ops"
        status: pass
      - kind: e2e
        ref: "node scripts/uat/uat-08-socratic-authoring.mjs --board-read-check"
        status: pass
    human_judgment: false
  - id: D3
    description: "The harness's drain generalised into drainInboundCoreRequests (dispatching by event.type over HELD_INBOUND_REQUEST_TYPES), with drainIncidentalPermissionRequests demoted to a signature-preserving preset — uat-06/uat-07's callers and uat-08's own pre-existing self-test assertions are unedited."
    requirement: SHAPE-01
    verification:
      - kind: unit
        ref: "node scripts/uat/uat-08-socratic-authoring.mjs --self-test (4 pre-existing drain checks, byte-identical)"
        status: pass
    human_judgment: false
  - id: D4
    description: "createBoardReadHandler answers a real board_read_request through the bridge and relays authoring_read_answer back to the sidecar — wired into uat-08's live run alongside the permission drain."
    requirement: SHAPE-01
    verification:
      - kind: e2e
        ref: "node scripts/uat/uat-08-socratic-authoring.mjs --board-read-check (3 board reads answered from a real scratch board: get_epic, search, unrecognised-kind)"
        status: pass
    human_judgment: false
  - id: D5
    description: "A starved held request reports itself by name: assertAllHeldRequestsAnswered throws naming type+requestId, wired into the live run twice (after the second reply, before the final verdict); waitForEvent's timeout message names any unanswered held requests; every unrecognised sidecar event is logged unconditionally to stderr."
    requirement: SHAPE-01
    verification:
      - kind: unit
        ref: "node scripts/uat/uat-08-socratic-authoring.mjs --self-test (3 new checks: unhandled kind recorded, assertion throws/does-not-throw, answering-op-count invariant 2==2)"
        status: pass
    human_judgment: false
  - id: D6
    description: "Real product behaviour is unchanged: the desktop app answers a board read exactly as before, through dispatch that now lives in one place — proven by the full workspace build and test suite, and the sidecar's own protocol-level test suite."
    verification:
      - kind: integration
        ref: "cargo test --workspace"
        status: pass
      - kind: integration
        ref: "npm --prefix packages/sidecar test"
        status: pass
    human_judgment: false

duration: 95min
completed: 2026-09-24
status: complete
---

# Phase 05 Plan 18: uat-08's UAT harness answers board_read_request from the real scratch board Summary

**Extracted `query::authoring::resolve_board_read` as the ONE board-read dispatch shared by the desktop app's inbound handler and a new `uat_authoring_ops answer-board-read` bridge verb, generalised the harness's drain loop to answer both `permission_request` and `board_read_request`, and proved the whole round trip offline via `--board-read-check` — closing gap G-05-1 so `uat-08`'s live arm can finally finish a run.**

## Performance

- **Duration:** 95 min
- **Started:** 2026-09-24T05:14:00Z (approx, per STATE.md session start)
- **Completed:** 2026-09-24 (see commit timestamps)
- **Tasks:** 3 completed
- **Files modified:** 6 modified, 1 created

## Accomplishments

- `query::authoring::resolve_board_read` is the single board-read dispatch: the desktop app's `handle_inbound_board_read_request` is now a thin relay shell (extract `runId`/`requestId`, lock the DB, call the dispatch, relay the result), calling it exactly once with no leftover copy of the clamp arithmetic.
- `uat_authoring_ops` gained `answer-board-read`, the read-path twin of the existing `apply-proposal-created` write-path bridge — it calls the SAME `resolve_board_read` the desktop app calls, placed with the mutating subcommands behind the scratch-directory refusal guard (never the read-only early-dispatch block).
- `scripts/uat/lib/sidecar-harness.mjs`'s drain loop was generalised into `drainInboundCoreRequests`, dispatching by `event.type` over `HELD_INBOUND_REQUEST_TYPES` (`permission_request`, `board_read_request`); `drainIncidentalPermissionRequests` is now a signature-preserving preset over it, so its existing callers (`uat-06`, `uat-07`) and `uat-08`'s own pre-existing self-test assertions needed zero edits.
- `uat-08-socratic-authoring.mjs`'s live run now drains both roles at once via `createPermissionAnswerHandler` and the new `createBoardReadHandler`, and gained `--board-read-check`: an offline, zero-token mode that materialises a real epic, queues three `board_read_request` events (`get_epic`, `search`, an unrecognised kind), and asserts all three are answered from the real scratch board with zero unanswered held requests remaining.
- A starved held request now reports itself by name: `assertAllHeldRequestsAnswered` (called twice in the live run — after the second reply, and immediately before the final verdict), an enriched `waitForEvent` timeout message naming any unanswered held requests, and an unconditional stderr log for every unrecognised sidecar event.
- An invariant check (`node scripts/uat/uat-08-socratic-authoring.mjs --self-test`) now asserts the sidecar's own answering-op count (`permission_answer`, `authoring_read_answer`) equals `HELD_INBOUND_REQUEST_TYPES.length` — a future third held kind fails this check instead of reproducing the starvation live.

## Task Commits

Each task was committed atomically:

1. **Task 1: End-to-end — a board read raised on the wire is answered from the real scratch board** - `cb88231` (feat)
2. **Task 2: The extracted dispatch's own edges, and proof there is only one of it** - `7e2f6b4` (test)
3. **Task 3: A starved harness reports itself by name, and no third held kind can slip in silently** - `81e9392` (feat)

**Plan metadata:** (this commit)

## Files Created/Modified

- `packages/core/src/query/authoring.rs` - Added `resolve_board_read`, the extracted single board-read dispatch (scope, clamp/peek arithmetic, `search`/`get_epic`/`list_tasks` arms)
- `packages/desktop/src-tauri/src/commands/authoring.rs` - `handle_inbound_board_read_request` reduced to a relay shell calling `resolve_board_read` once
- `packages/core/tests/bin/uat_authoring_ops.rs` - New `answer-board-read` subcommand (reads one JSON event from stdin, prints `{result}` or `{error}`, exits 0 in both cases)
- `packages/core/tests/authoring_board_read.rs` - Four new integration tests pinning `resolve_board_read`'s scope, clamp/truncation and unknown-kind edges
- `packages/core/tests/epic_context_packet.rs` - Allowlisted `resolve_board_read`'s two cardinality-one/aggregate SELECTs in the existing unbounded-read scanner (deviation, see below)
- `scripts/uat/lib/sidecar-harness.mjs` - `HELD_INBOUND_REQUEST_TYPES`, `createPermissionAnswerHandler`, `drainInboundCoreRequests`, `drainIncidentalPermissionRequests` (now a preset), `assertAllHeldRequestsAnswered`, enriched `waitForEvent` timeout, unconditional unrecognised-event log
- `scripts/uat/uat-08-socratic-authoring.mjs` - `createBoardReadHandler`, `--board-read-check` mode, `drainInboundCoreRequests` wired into the live run, `assertAllHeldRequestsAnswered` called twice, three new self-test checks

## Decisions Made

See `key-decisions` in frontmatter: the promote-not-duplicate generalisation of the drain loop (per the plan's own `assumption_delta_decision`), and the allowlist fix for the pre-existing unbounded-SELECT scanner.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 1 - Bug] Fixed an existing test the extraction tripped: epic_context_packet.rs's unbounded-SELECT allowlist gate**
- **Found during:** Task 1, first `cargo test --workspace` run
- **Issue:** `packages/core/tests/epic_context_packet.rs` has a scanner asserting every unLIMIT'd `SELECT` under `packages/core/src/query` is named in an allowlist. The two inline SELECTs inside `resolve_board_read` (a run's `project_id` by primary key, and a `COUNT(*)` of an epic's tasks) previously lived in the desktop crate's `commands/authoring.rs`, outside the scanner's directory scope — moving them into `packages/core/src/query/authoring.rs` (the whole point of the extraction) put them inside it for the first time, and the test failed naming `resolve_board_read`.
- **Fix:** Added `"resolve_board_read"` to `ALLOWED_UNBOUNDED_SELECTS` with the same cardinality-one/aggregate justification already recorded there for `get_epic_for_agent` (single row by PRIMARY KEY) and `BLOCKED_COUNT_SQL`/`RECOVERY_COUNT_SQL` (COUNT(*) with no GROUP BY) — neither SELECT is a page read, so a LIMIT does not apply to either.
- **Files modified:** `packages/core/tests/epic_context_packet.rs`
- **Verification:** `cargo test -p core --test epic_context_packet` — 16 passed, 0 failed (previously 15 passed, 1 failed)
- **Committed in:** `cb88231` (Task 1 commit)

---

**Total deviations:** 1 auto-fixed (1 bug)
**Impact on plan:** Necessary to keep Task 1's own `cargo test --workspace` verification green; no scope creep — the allowlist entry documents exactly why the two reads are safely unbounded, matching the gate's own existing precedent.

## Issues Encountered

None. One flaky failure was observed on the first `npm --prefix packages/sidecar test` run (1 of 143 tests failed with no diagnostic captured due to output truncation in a background shell); a full rerun reported 143 tests, 0 failed. No source under `packages/sidecar/src` or `packages/sidecar/test` was touched by this plan, so the flake is unrelated to this plan's changes.

## User Setup Required

None - no external service configuration required.

## Next Phase Readiness

- Gap G-05-1 is closed: all three of its `missing[]` items are shipped (the harness's board-read answering role, the bridge's read verb over the same query functions the desktop app uses, and a named harness-failure assertion for an unanswered held request).
- The live `uat-08` run is no longer structurally blocked by an unanswered board read — provable without spending a token via `node scripts/uat/uat-08-socratic-authoring.mjs --board-read-check`, which now passes.
- Per this plan's own non-negotiables, the live (token-spending) `uat-08` run itself was NOT executed by this plan — that is `05-UAT.md` test 1's own manual-only verification, still pending a human running it deliberately to judge SHAPE-01's dialogue quality now that the instrument can finish.
- No production behaviour changed: the desktop app answers a board read exactly as it did before this plan, through a dispatch that now lives in exactly one place.

---
*Phase: 05-socratic-epic-authoring*
*Completed: 2026-09-24*

## Self-Check: PASSED

- All 6 modified files and 1 created file verified present on disk with `[ -f ]`.
- All 3 task commits (`cb88231`, `7e2f6b4`, `81e9392`) verified present via `git log --oneline --all`.
- All task-level `<acceptance_criteria>` re-run and passing (grep gates, `cargo build`, `cargo test`, `--self-test`, `--board-read-check`).
- Plan-level `<verification>` re-run: `cargo test --workspace` (0 failed), `cargo build --workspace` (green), `npm --prefix packages/sidecar test` (143 tests, 0 failed on rerun), `--self-test` (19 PASS, 0 FAIL), `--board-read-check` (green, 3/3 board reads answered, 0 unanswered held requests).
