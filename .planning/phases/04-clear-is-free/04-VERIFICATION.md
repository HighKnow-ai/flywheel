---
phase: 04-clear-is-free
verified: 2026-09-23T07:17:56Z
status: gaps_found
score: 3/5 must-haves verified
covered_files:
  - ".planning/REQUIREMENTS.md"
  - ".planning/phases/04-clear-is-free/04-01-PLAN.md"
  - ".planning/phases/04-clear-is-free/04-01-SUMMARY.md"
  - ".planning/phases/04-clear-is-free/04-02-PLAN.md"
  - ".planning/phases/04-clear-is-free/04-02-SUMMARY.md"
  - ".planning/phases/04-clear-is-free/04-03-PLAN.md"
  - ".planning/phases/04-clear-is-free/04-03-SUMMARY.md"
  - ".planning/phases/04-clear-is-free/04-04-PLAN.md"
  - ".planning/phases/04-clear-is-free/04-04-SUMMARY.md"
  - ".planning/phases/04-clear-is-free/04-05-PLAN.md"
  - ".planning/phases/04-clear-is-free/04-05-SUMMARY.md"
  - ".planning/phases/04-clear-is-free/04-06-PLAN.md"
  - ".planning/phases/04-clear-is-free/04-06-SUMMARY.md"
  - ".planning/phases/04-clear-is-free/04-07-PLAN.md"
  - ".planning/phases/04-clear-is-free/04-07-SUMMARY.md"
  - ".planning/phases/04-clear-is-free/04-08-PLAN.md"
  - ".planning/phases/04-clear-is-free/04-08-SUMMARY.md"
  - ".planning/phases/04-clear-is-free/04-09-PLAN.md"
  - ".planning/phases/04-clear-is-free/04-09-SUMMARY.md"
  - ".planning/phases/04-clear-is-free/04-10-PLAN.md"
  - ".planning/phases/04-clear-is-free/04-10-SUMMARY.md"
  - ".planning/phases/04-clear-is-free/04-11-PLAN.md"
  - ".planning/phases/04-clear-is-free/04-11-SUMMARY.md"
  - ".planning/phases/04-clear-is-free/04-12-PLAN.md"
  - ".planning/phases/04-clear-is-free/04-12-SUMMARY.md"
  - ".planning/phases/04-clear-is-free/04-13-PLAN.md"
  - ".planning/phases/04-clear-is-free/04-13-SUMMARY.md"
  - ".planning/phases/04-clear-is-free/04-14-PLAN.md"
  - ".planning/phases/04-clear-is-free/04-14-SUMMARY.md"
  - "packages/core/src/compaction.rs"
  - "packages/core/src/context_packet.rs"
  - "packages/core/src/domain/acceptance_criterion.rs"
  - "packages/core/src/domain/agent_run.rs"
  - "packages/core/src/domain/session_summary.rs"
  - "packages/core/src/drift.rs"
  - "packages/core/src/git.rs"
  - "packages/core/src/query/recovery.rs"
  - "packages/desktop/src-tauri/src/commands/agent_run.rs"
  - "packages/desktop/src-tauri/src/commands/criterion.rs"
  - "packages/sidecar/src/claude-code-adapter.ts"
  - "packages/sidecar/src/mcp-permission-server.ts"
covered_digest: "v1:sha256:27423075336c162011a336886060f282a2fe4c23fab87737875c4e52a3b98875"
behavior_unverified: 0
overrides_applied: 0
gaps:
  - truth: "Every session ends by writing a structured summary to the board — no existing summary is ever overwritten or rewritten in place."
    status: failed
    reason: "The append-only guarantee holds for the natural-close path (apply_session_closed, one atomic transaction) but not for the Stop/Discard termination path added by plan 04-13. stop_agent_run_recording_first writes the terminal status via interrupt_agent_run (which opens and commits its OWN transaction) and then, in a SECOND, independent transaction, writes the fallback summary if none exists. A crash, force-quit, or SQLite I/O error between the two commits leaves the run permanently terminal with exit_summary_id NULL and no session_summaries row — exactly the 'terminal run with no summary' state apply_session_closed's own doc comment (packages/core/src/domain/agent_run.rs:589-596) states this crate deliberately closes elsewhere. Because session_summaries is append-only and nothing backfills a missing summary for an already-terminal run, that session's narrative is then silently and permanently lost from every future context packet for the task."
    artifacts:
      - path: "packages/desktop/src-tauri/src/commands/agent_run.rs"
        issue: "stop_agent_run_recording_first (lines ~645-691) commits interrupt_agent_run's transaction, then opens a second conn.transaction() for synthesize_fallback_summary instead of covering both writes in one transaction the way close_agent_run_in_tx/apply_session_closed already do for the natural-close path."
    missing:
      - "An interrupt_agent_run_in_tx(tx, ...) sibling to the existing close_agent_run_in_tx (packages/core/src/domain/agent_run.rs:333-387)."
      - "stop_agent_run_recording_first rewritten to open exactly one transaction covering both the interrupt write and the presence-checked fallback-summary insert, mirroring apply_session_closed's own pattern."
  - truth: "When a new session states an understanding that contradicts a decision/fact already recorded on the board, the user is told rather than left to discover it in the diff (CTX-06's four fact-based drift detectors, of which CriteriaRevisionMoved is one)."
    status: failed
    reason: "packet_extras_for's criteria-revision pin lookup calls query::permissions::latest_run_id_for_task AFTER agent_run_start has already inserted the new agent_runs row (started_at = now). Because that new row now has the latest started_at for the task, latest_run_id_for_task returns the BRAND-NEW run instead of the previous one — and the new run's criteria_revision_pin column is still NULL (pin_criteria_revisions is not called until later in the same function). criteria_revision_pin_for_run therefore returns None, pinned_criterion_ids becomes None, and detect_criteria_revision's own early-return guard (`let pinned = inputs.pinned_criterion_ids?;`) makes it silently return None even when the task's criteria really did change since the run's actual predecessor. This is the ONE call site whose entire purpose is to persist the warning (record_drift_warnings) and forward it into the agent's own prompt (render_prompt's ## Warnings section) — both silently skip it. Net effect: a developer who sees the CriteriaRevisionMoved warning in the launch sheet's PREVIEW (agent_run_preview, which calls packet_extras_for before any run row exists, so it resolves correctly), then clicks Start Work moments later, gets a prompt with that exact warning missing, and no drift.detected event is ever written — so query::recovery's needs-you arm 3 (the board's Needs Decision pill) can never fire for this detector via the real start path either. Confirmed by grep: CriteriaRevisionMoved appears only in drift.rs and its own unit test file; no test anywhere drives agent_run_start end-to-end after a criteria revision to catch this."
    artifacts:
      - path: "packages/desktop/src-tauri/src/commands/agent_run.rs"
        issue: "packet_extras_for (lines ~364-380), called from agent_run_start at lines ~509-527, re-derives 'latest run for task' AFTER start_agent_run already inserted the new (unpinned) run, so it resolves the wrong run for the pin comparison."
    missing:
      - "Resolve the PREVIOUS latest run id before start_agent_run runs, and thread it explicitly into packet_extras_for instead of having packet_extras_for re-query latest_run_id_for_task after the new row already outranks the one that should be compared against."
      - "An integration-level test that revises a task's criteria, then calls agent_run_start (not just agent_run_preview), and asserts both that render_prompt's Warnings section contains the CriteriaRevisionMoved sentence and that a drift.detected event was persisted for it."
deferred: []
---

# Phase 04: `/clear` Is Free Verification Report

**Phase Goal:** Cyril throws away an agent's entire context in the middle of a task and the next
session picks up exactly where the last one left off, reconstituted from the board alone.

**Verified:** 2026-09-23T07:17:56Z
**Status:** gaps_found
**Re-verification:** No — initial verification

## Goal Achievement

### Observable Truths (Roadmap Success Criteria)

| # | Truth | Status | Evidence |
|---|-------|--------|----------|
| 1 | Every session ends by writing a structured summary to the board; no existing summary is ever overwritten or rewritten in place | ✗ FAILED | Append-only guarantee (no UPDATE/DELETE on `session_summaries`, verified by `two_summaries_for_one_run_append_rather_than_replace` and `the_auto_generated_flag_survives_the_round_trip_in_both_directions`, `session_summary_lifecycle.rs`, 15/15 pass) holds for the natural-close path. But the Stop/Discard path (`stop_agent_run_recording_first`, `packages/desktop/src-tauri/src/commands/agent_run.rs:645-691`) writes the terminal status and the fallback summary in two separate, independently-committed transactions — reopening the exact "terminal run, no summary" window `apply_session_closed`'s own doc comment (`packages/core/src/domain/agent_run.rs:589-596`) states this crate closes elsewhere. Confirmed by direct code read, not merely restated from 04-REVIEW.md's CR-02. |
| 2 | User discards a session's context in one action; the new session is primed automatically from the board (task, epic, criteria, summaries, diff), with no chat transcript, and the same board state always produces the same context packet | ✓ VERIFIED | `SessionSurface.tsx`'s `handleDiscard` (line 628) is a single `onClick` → `discardSession(agentRunId)` call with no intermediate confirmation. `assemble_context_packet`/`render_prompt` are pure functions over DB state (`context_packet.rs`); determinism directly proven by `two_assemblies_and_two_renders_are_byte_identical_at_every_one_of_the_ten_cycles` in `five_cycle_reconstitution.rs` (passed, `cargo test -p core --test five_cycle_reconstitution`, 10/10). |
| 3 | User sees which summaries are carried verbatim and exactly where compaction begins | ✓ VERIFIED | `LaunchSheet.tsx`'s boundary marker (line 158) renders `packet.compaction.sentence` verbatim; `verbatimEntries = packet.summaries.slice(foldedCount)` (line 188) renders under a "Recent sessions (verbatim)" label (line 211). Backed by `bounded_verbatim_carry_is_exactly_five_from_cycle_six_through_cycle_ten` (passed). |
| 4 | When a new session's stated understanding contradicts a decision/fact already recorded on the board, the user is told rather than left to discover it in the diff | ✗ FAILED | The decision-contradiction detectors (`UnacknowledgedDecision`/`FabricatedDecisionEcho` in `drift.rs`) depend only on `packet.summaries` and are NOT broken by the confirmed bug below. But `CriteriaRevisionMoved` — one of drift.rs's four fact-based detectors, explicitly framed by the module's own doc comment as serving CTX-06 — never fires at `agent_run_start`, the one call site whose entire purpose is to persist (`record_drift_warnings`) and forward (`render_prompt`) it. Root cause confirmed by direct code read: `packet_extras_for`'s pin lookup (`latest_run_id_for_task`) runs AFTER `start_agent_run` already inserted the new run row, so it resolves the new run's still-NULL pin instead of the previous run's pin. The launch sheet PREVIEW correctly shows this warning (no run row exists yet when `agent_run_preview` calls the same function); it silently vanishes the moment "Start Work" is clicked — exactly the "told, then left to discover it" failure mode SC4 exists to prevent. |
| 5 | An automated test runs one task through ≥5 session cycles proving criteria unchanged; editing criteria after work starts creates a new revision, never an overwrite | ✓ VERIFIED | `five_cycle_reconstitution.rs`'s `criteria_statements_are_byte_identical_at_cycle_five_and_cycle_ten` (10-cycle harness, passed). `criteria_locked_for_task` (`acceptance_criterion.rs:330`) gates on any `agent_runs` row ever existing for the task; `revise_criterion` mints a successor row and stamps `superseded_at` on the predecessor rather than mutating it in place when locked. Confirmed by `revising_a_criterion_mid_run_leaves_the_live_runs_pin_byte_identical` (`criteria_pin.rs`, passed) and `revising_twice_produces_a_three_revision_chain_sharing_one_root` (`criteria.rs`, passed, 17/17 and 5/5 respectively). |

**Score:** 3/5 truths verified (0 present, behavior-unverified)

### Required Artifacts

| Artifact | Expected | Status | Details |
|----------|----------|--------|---------|
| `packages/core/src/domain/session_summary.rs` | Append-only summary writes, fallback synthesis | ✓ VERIFIED | `create_summary`/`synthesize_fallback_summary` only INSERT; no UPDATE path exists for `session_summaries`. |
| `packages/core/src/compaction.rs` | Pure fold, fixed `VERBATIM_WINDOW`, no summarization-of-summaries | ✓ VERIFIED | Pure function, unit-tested, `VERBATIM_WINDOW = 5` confirmed by 5/10-cycle boundary tests. |
| `packages/core/src/context_packet.rs` | Deterministic assembly + `render_prompt` | ✓ VERIFIED | Byte-identical two-call assertion passes at all 10 cycles. |
| `packages/core/src/drift.rs` | Four fact-based, pure detectors (CTX-06) | ⚠️ PARTIAL (wiring) | All four detectors are correct and well-tested AS PURE FUNCTIONS (`drift.rs` test file, 30/30 pass). One of the four (`CriteriaRevisionMoved`) is never correctly fed at its sole production call site — see gap #2. |
| `packages/core/src/domain/agent_run.rs` | `close_agent_run_in_tx` atomic natural-close; `record_drift_warnings`; `criteria_revision_pin_for_run` | ⚠️ PARTIAL | `close_agent_run_in_tx`/`apply_session_closed` atomicity is real and tested. No `interrupt_agent_run_in_tx` sibling exists — `interrupt_agent_run` always opens/commits its own transaction, which `stop_agent_run_recording_first` then composes non-atomically with the fallback-summary write (gap #1). |
| `packages/desktop/src-tauri/src/commands/agent_run.rs` | `agent_run_start`, `agent_run_preview`, `stop_agent_run_recording_first`, `packet_extras_for` | ⚠️ PARTIAL (wiring) | Present and largely correct, but contains both confirmed defects (gap #1, gap #2) at exactly the two integration points named. |
| `packages/desktop/src/launch-sheet/LaunchSheet.tsx` | Verbatim/boundary rendering, `DriftWarningSection` | ✓ VERIFIED | Both wired to `packet.compaction`/`packet.drift`. |
| `packages/desktop/src/session/SessionSurface.tsx` | Single-action Discard | ✓ VERIFIED | `handleDiscard` — one click, no confirmation dialog. |

### Key Link Verification

| From | To | Via | Status | Details |
|------|-----|-----|--------|---------|
| `agent_run_start` | `record_drift_warnings` | one event per fired detector, persisted before spawn | ⚠️ PARTIAL | Wired and does persist events for the 3 detectors whose inputs don't depend on run-id resolution timing; `CriteriaRevisionMoved` specifically cannot fire here (gap #2). |
| `LaunchSheet.tsx` | `agent_run_preview` → `packet_extras_for` | preview drift/diff rendering | ✓ WIRED | `packet_extras_for` called with no run row yet inserted — correctly resolves the true latest run's pin. |
| `SessionSurface.tsx` | `discardSession` → `stop_agent_run_recording_first` | one-action discard, bounded wait, fall-through to Stop path | ✓ WIRED (happy path) / ⚠️ (crash window) | Reaches the shared stop path correctly; the shared path itself has the non-atomic write gap (gap #1). |
| `apply_session_closed` (natural close) | `close_agent_run_in_tx` + fallback summary | single transaction | ✓ WIRED | Confirmed atomic by code read and by `session_summary_lifecycle.rs`/`summary_report_wire.rs` passing. |

### Behavioral Spot-Checks

| Behavior | Command | Result | Status |
|----------|---------|--------|--------|
| Five/ten-cycle reconstitution (CTX-07, CTX-04, CTX-05) | `cargo test -p core --test five_cycle_reconstitution` | 10 passed; 0 failed | ✓ PASS |
| Criteria revision chain / immutability under lock (BOARD-03) | `cargo test -p core --test criteria` | 17 passed; 0 failed | ✓ PASS |
| Criteria pin stability across mid-run revision | `cargo test -p core --test criteria_pin` | 5 passed; 0 failed | ✓ PASS |
| Session summary append-only guarantee | `cargo test -p core --test session_summary_lifecycle` | 15 passed; 0 failed | ✓ PASS |
| Summary report wire (agent-authored summaries) | `cargo test -p core --test summary_report_wire` | 12 passed; 0 failed | ✓ PASS |
| Drift detectors as pure functions | `cargo test -p core --test drift` | 30 passed; 0 failed | ✓ PASS |
| `discard_lifecycle.rs` reproduces the two-transaction Stop/Discard sequence but asserts nothing about atomicity across the boundary | code read of `simulate_discard_stop_path` (lines 91-111) | confirmed — no atomicity assertion present | ⚠️ Confirms 04-REVIEW.md CR-02's claim; passing tests here are not evidence the atomicity gap is closed |
| No integration test drives `agent_run_start` end-to-end after a criteria revision | `grep -rl CriteriaRevisionMoved` across the workspace | only `drift.rs` (impl) and `drift.rs` (unit test) match | ⚠️ Confirms 04-REVIEW.md CR-01's claim — no regression coverage exists for the fix this gap requires |

All suites at HEAD (58 Rust test binaries, 463 desktop vitest, 108 sidecar tests) pass — consistent with the task brief's note that green runs are not evidence for the two confirmed gaps, since neither gap is exercised by an assertion in the existing suite.

### Requirements Coverage

| Requirement | Source Plan(s) | Description | Status | Evidence |
|---|---|---|---|---|
| CTX-01 | 04-01, 04-02, 04-03, 04-06, 04-09 | Every session ends by writing a structured summary | ✗ BLOCKED | Gap #1 — Stop/Discard path can leave a terminal run with no summary across a crash. |
| CTX-02 | 04-01, 04-06, 04-14 | Summaries are append-only, never overwritten | ✓ SATISFIED | Schema is insert-only; confirmed by passing lifecycle tests. |
| CTX-03 | 04-01, 04-07, 04-08, 04-09 | New session primed automatically from the board, no chat transcript | ✓ SATISFIED | `assemble_context_packet`/`render_prompt`, `LaunchSheet.tsx`. |
| CTX-04 | 04-01, 04-14 | Deterministic context assembly | ✓ SATISFIED | Byte-identical two-call assertion, 10/10 cycles. |
| CTX-05 | 04-05, 04-08, 04-09 | Verbatim carry + visible compaction boundary | ✓ SATISFIED | `LaunchSheet.tsx` boundary marker + verbatim section. |
| CTX-06 | 04-03, 04-06, 04-10, 04-11, 04-12 | Detects and surfaces contradictions with recorded board state | ✗ BLOCKED | Gap #2 — `CriteriaRevisionMoved` never fires at `agent_run_start`, the one persisting/forwarding call site. |
| CTX-07 | 04-09 | ≥5-cycle automated test, criteria unchanged | ✓ SATISFIED | `five_cycle_reconstitution.rs`, 10 cycles, 10/10 pass. |
| CTX-08 | 04-13 | One-action discard, no board state lost | ✓ SATISFIED (happy path) | `handleDiscard`, `discard_lifecycle.rs` row-count assertions pass; the crash-window edge case is captured under gap #1/CTX-01 rather than as a CTX-08 failure, since the row-count/no-worktree-removed guarantees CTX-08 states do hold in the tests as written. |
| BOARD-03 | 04-04, 04-10 | Criteria immutable once work starts; edits create a revision | ✓ SATISFIED | `criteria_locked_for_task`, `revise_criterion`, `criteria.rs`/`criteria_pin.rs` tests. |

No orphaned requirements — REQUIREMENTS.md's Phase 4 row (BOARD-03, CTX-01..CTX-08) matches the union of all 14 plans' `requirements:` frontmatter exactly.

### Anti-Patterns Found

| File | Line | Pattern | Severity | Impact |
|---|---|---|---|---|
| `packages/desktop/src-tauri/src/commands/agent_run.rs` | 373-380, 509-527 | Stale re-derivation of "latest run for task" after a mutating insert | 🛑 Blocker | Gap #2 — see above. |
| `packages/desktop/src-tauri/src/commands/agent_run.rs` | 645-691 | Two independently-committed transactions for one logical state transition | 🛑 Blocker | Gap #1 — see above. |
| `packages/core/src/context_packet.rs` | 166-168 | Unbounded `SUMMARIES_SQL` read, no cap on decisions/summaries growth | ⚠️ Warning | Documented, deliberate per D-68/D-69; no correctness bug, but no tested scale ceiling (04-REVIEW.md WR-01). Not a success-criterion gap. |
| `packages/core/src/domain/acceptance_criterion.rs` | 766-874 | `delete_criterion`/`delete_criteria_for_parent` orphan revision history; `criterion_delete` still a live Tauri command | ⚠️ Warning | Unreachable from the shipped UI (no delete affordance wired), so not currently exploitable, but the command surface is unguarded (04-REVIEW.md WR-02). Not a success-criterion gap since BOARD-03 concerns immutability of the CURRENT revision, not deletion. |
| `packages/sidecar/src/claude-code-adapter.ts` | 832 | `liveSessions` map never deletes entries | ⚠️ Warning | Pre-existing, unbounded memory retention over a long-running sidecar process; does not affect correctness of summary/drift paths (04-REVIEW.md WR-03). |
| `packages/desktop/src-tauri/src/commands/agent_run.rs` | 1524-1549 | `abandonedReason` field actually carries a timestamp | ℹ️ Info | Misleading name only (04-REVIEW.md IN-01). |

No `TBD`/`FIXME`/`XXX` markers found in any of the phase's covered implementation files.

### Human Verification Required

None. Both gaps are provable directly from the source (confirmed independently by this verifier, not merely restated from 04-REVIEW.md) and are not matters of UX judgment, visual appearance, or external-service behavior.

### Gaps Summary

Twelve of fourteen plans, and 7 of 9 requirement IDs, are solidly evidenced: append-only summaries,
deterministic context assembly, the verbatim/compaction-boundary UI, the criteria-revision chain
under lock, and the 10-cycle reconstitution harness all hold up under direct code and test
inspection — this is genuinely careful, well-tested work at the unit level.

Two integration-level defects, both independently confirmed against the source in this
verification (not merely carried forward from 04-REVIEW.md's Critical findings), block the phase
goal:

1. **CR-02 / gap #1 (blocks CTX-01, and by extension the phase goal's "next session picks up
   exactly where the last one left off"):** the Stop/Discard termination path composes two
   independently-committed transactions for what the codebase's own natural-close path treats as
   one atomic unit — reopening a documented, previously-closed gap where a crash can leave a
   session permanently without a summary.
2. **CR-01 / gap #2 (blocks CTX-06, and the phase goal's "no board state left to discover only in
   the diff"):** the `CriteriaRevisionMoved` detector cannot fire at the one call site
   (`agent_run_start`) that persists the warning and forwards it into the agent's own prompt,
   because the pin lookup resolves against the just-inserted, not-yet-pinned run instead of the
   run that actually existed before the criteria changed.

Neither gap is caught by the existing test suite (confirmed by this verifier via direct grep and
code reading, matching 04-REVIEW.md's own claim), so the 58/463/108 all-green test counts recorded
in this phase's own task brief are not evidence either gap is closed.

Both fixes described in 04-REVIEW.md (an `interrupt_agent_run_in_tx` sibling to
`close_agent_run_in_tx`; threading the previous run's id explicitly into `packet_extras_for` instead
of re-deriving "latest run" after the mutating insert) are narrow, targeted, and consistent with
patterns already proven elsewhere in this same codebase.

---

_Verified: 2026-09-23T07:17:56Z_
_Verifier: Claude (gsd-verifier)_
