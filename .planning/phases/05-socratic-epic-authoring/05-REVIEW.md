---
phase: 05-socratic-epic-authoring
reviewed: 2026-09-26T00:00:00Z
depth: standard
files_reviewed: 16
files_reviewed_list:
  - packages/core/src/domain/authoring_session.rs
  - packages/core/src/epic_context_packet.rs
  - packages/core/src/query/authoring.rs
  - packages/core/tests/authoring_board_read.rs
  - packages/core/tests/authoring_criterion_reachability.rs
  - packages/core/tests/authoring_distillation.rs
  - packages/core/tests/authoring_stage.rs
  - packages/core/tests/bin/uat_authoring_ops.rs
  - packages/core/tests/epic_context_packet.rs
  - packages/desktop/src-tauri/src/commands/authoring.rs
  - packages/sidecar/src/adapter.ts
  - packages/sidecar/src/mcp-permission-server.ts
  - packages/sidecar/test/authoring-tools.test.mjs
  - scripts/uat/lib/fake-authoring-claude.mjs
  - scripts/uat/README.md
  - scripts/uat/uat-08-socratic-authoring.mjs
findings:
  critical: 0
  warning: 2
  info: 1
  total: 3
status: issues_found
---

# Phase 05: Code Review Report

**Reviewed:** 2026-09-26T00:00:00Z
**Depth:** standard
**Files Reviewed:** 16
**Status:** issues_found

## Summary

This is an incremental review of gap-closure round 11 (plans 05-44 through 05-47, commits
`334f478..b540f99`), which closed gap G-05-9 — `propose_criterion` was unreachable in a fresh-epic
session because a staged proposal's id was never returned to the agent that staged it. I read every
listed file in full, then re-derived and read the exact diff for each (`git diff 334f478^..b540f99`)
to scope the review strictly to what this round actually changed, rather than re-litigating the rest
of the phase.

The product-facing delta is small, additive, and consistently applied:

- A fourth capped read tool, `proposal_list` (Rust: `query::authoring::resolve_board_read`'s new
  `"list_proposals"` arm; TS: `mcp-permission-server.ts`'s new tool registration and standalone-server
  branch; `adapter.ts`'s `BoardReadRequestEvent.readKind` union widened to match) — scoped
  server-side by the run id the function already receives, never by anything the event claims,
  mirroring the existing three read tools' own discipline. Cross-checked against
  `packages/core/tests/authoring_board_read.rs` and `packages/core/tests/authoring_criterion_reachability.rs`,
  both of which exercise the real dispatch function directly (never a hand-fabricated fixture on both
  sides) and cover the clamp/truncation edge cases, cross-run isolation, and the id round-trip through
  to a real `acceptance_criteria` row via `accept_proposal`'s D-96 implied-parent walk.
- A second `StageInstruction` (renamed from the narrower `DistillationInstruction`) delivered on
  entering the `criteria` stage, mirroring the existing `decompose`-stage instruction's own delivery
  path (`domain::authoring_session::advance_stage`, relayed as a best-effort `authoring_turn` by
  `commands::authoring::authoring_stage_advance`). The rename and the new match arm are mechanical and
  exhaustive; the `AuthoringStage::Challenge => None` arm is correctly noted as unreachable by
  construction rather than a live code path.
- The instruction texts (`DISTILLATION_INSTRUCTION_TEXT`, `CRITERIA_INSTRUCTION_TEXT`) and the opening
  prompt (`render_epic_prompt`) are updated consistently with the new capability, and every wording
  claim I checked against the corresponding assertion in `authoring_distillation.rs`/
  `epic_context_packet.rs` actually holds (e.g. "one tool call per criterion", "does not need to be
  accepted first", the three-stage summary sentence appearing in both the premise and no-premise
  branches).
- The UAT harness (`uat-08-socratic-authoring.mjs`) was widened to drive the whole three-stage machine
  live/offline (`drainProposalsUntilQuiet`'s re-scanning quiet-window drain, replacing a single-pass
  loop that structurally could not collect a second burst; `readCriteriaReachability`'s four-valued
  reading). Both are exercised by real self-tests (a two-burst timer fixture, a never-quiet fixture, a
  single-burst-no-duplicate fixture for the drain; four fixture-based checks for the reachability
  reading), and the live/replay bodies were updated in lockstep (two `advance-stage` call sites, two
  `waitForTurn` call sites, both pinned by source-scanning self-tests).

I found no BLOCKER-level defects in this delta — no security issue, no data-loss risk, no incorrect
board-state transition. The two WARNING-level findings below concern the precision of a new UAT
diagnostic reading and a minor deferred-detection gap in the same harness; the one INFO-level finding
is a small, harmless source duplication in the Rust core.

## Warnings

### WR-01: `readCriteriaReachability`'s "declined" reading can be triggered by a `proposal_list` call unrelated to criteria, misreporting "not-attempted" as "declined"

**File:** `scripts/uat/uat-08-socratic-authoring.mjs:4827-4851`
**Issue:** `readCriteriaReachability` is the reading gap G-05-9 asked for by name — to distinguish a
`Drafted criteria: 0` result caused by the agent *choosing* not to draft from one caused by the agent
being *structurally unable* to (see the function's own doc comment at lines 4803-4826, and
`scripts/uat/README.md`'s "eighth rule": *"Assert reachability, not usage — and make the impossibility
say its own name, because a zero that cannot distinguish 'would not' from 'could not' will be read as
'would not' every time."*). The function's third branch (`"declined"`) fires whenever any `tool_call`
in `window` names `proposal_list` (line 4836-4848), with `window` spanning the *entire* range from the
end of the challenge stage to the end of the run — i.e. both the decompose-stage window and the
criteria-stage window combined (see both call sites: `scripts/uat/uat-08-socratic-authoring.mjs:6401`
in the replay body and `:7128-7132` in the live body).

But `proposal_list` is a general-purpose id-lookup tool the agent is explicitly told to use during
`decompose` too — `DISTILLATION_INSTRUCTION_TEXT` (`packages/core/src/domain/authoring_session.rs:319-326`)
tells the agent "Any proposal you stage in this session can have its id read back with
`proposal_list`", and `propose_task`'s own schema accepts an optional `parent_proposal_id`
(`packages/sidecar/src/mcp-permission-server.ts:558-567`). So an agent that calls `proposal_list`
purely to nest a *task* under a previously-staged epic proposal during `decompose` — never once
considering criteria — will have `sawProposalListCall` set to `true` for the whole window, and a run
that genuinely never engaged with criteria at all will read `"declined"` (implying a considered
decision) rather than `"not-attempted"` (implying the topic was never engaged). This directly
undermines the precision the reading exists to provide, in the harness whose own README documents ten
prior rounds of exactly this defect class ("a reading that reports more confidence than the wire
actually supports").
**Fix:** Scope the `proposal_list`-detection scan to the criteria-stage sub-window only (i.e. from the
index the second `advance-stage` call returns onward), or additionally require that the matched
`proposal_list` call occurs after the criteria instruction was sent, e.g.:
```js
// Caller passes a `criteriaStageFromIndex` alongside the existing `window`, and the scan below is
// bounded by whichever is later:
const declineScanFrom = Math.max(fromIndex, criteriaStageFromIndex);
for (let i = declineScanFrom; i < toIndex; i += 1) { /* unchanged */ }
```

### WR-02: The decompose-stage proposal drain's held requests are not checked until after the criteria-stage drain completes

**File:** `scripts/uat/uat-08-socratic-authoring.mjs:7011-7101`
**Issue:** After the decompose-stage `drainProposalsUntilQuiet` call (line 6998-7010, applying every
`proposal_created` event through the real bridge), the live body proceeds directly to the second
`advance-stage` call (line 7026) and the criteria-stage instruction/drain (lines 7029-7096) before the
first `assertAllHeldRequestsAnswered(sidecar)` call for this whole phase of the run appears (line
7101). A `board_read_request` (e.g. a `proposal_list` call) that starved during the *decompose* window
— the exact failure mode gap G-05-1 exists to catch fast, per the comment at line 6869-6871 — will not
be reported until after the entire criteria-stage turn (bounded by `LIVE_TURN_CEILING_MS`, up to
900000ms) has also run to completion, rather than failing fast at the point the starvation actually
happened. This does not produce an incorrect result (the check does eventually fire, and no board
write is skipped), but it materially delays the diagnostic signal this repository's own README names
as a recurring, previously-fixed failure class ("every property a live script asserts must be provable
… the live arm exists for the judgements a human must make").
**Fix:** Add an `assertAllHeldRequestsAnswered(sidecar)` call immediately after the decompose-stage
drain (right after line 7010, before the `pendingAfterDecompose` read), mirroring the existing calls
at lines 6871 and 7101.

## Info

### IN-01: Duplicated literal string across the premise/no-premise branches in `render_epic_prompt`

**File:** `packages/core/src/epic_context_packet.rs:533-536` and `:547-550`
**Issue:** The new three-stage summary sentence ("This session has three stages — challenge, then
decompose, then criteria — and only the developer advances between them; each advance will bring its
own instruction saying what that stage wants.") is pushed as a byte-identical string literal in both
the `if let Some(premise)` branch and the `else` branch, immediately after each branch's own
premise-specific text. The two literals will silently drift apart if one is ever edited without the
other (the file's own tests only assert the sentence's *presence*, not that both branches share one
source of truth for it).
**Fix:** Hoist the shared sentence to a single `push_str` call after the `if`/`else` block (or a named
`const`), e.g.:
```rust
if premise.is_some() {
    out.push_str("...premise-specific text...\n");
} else {
    out.push_str("...no-premise-specific text...\n");
}
out.push_str(
    "This session has three stages — challenge, then decompose, then criteria — and only \
     the developer advances between them; each advance will bring its own instruction \
     saying what that stage wants.\n",
);
```

---

_Reviewed: 2026-09-26T00:00:00Z_
_Reviewer: Claude (gsd-code-reviewer)_
_Depth: standard_
