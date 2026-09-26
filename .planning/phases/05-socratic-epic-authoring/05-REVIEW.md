---
phase: 05-socratic-epic-authoring
reviewed: 2026-09-26T00:00:00Z
depth: standard
files_reviewed: 13
files_reviewed_list:
  - packages/core/src/domain/authoring_session.rs
  - packages/core/tests/authoring_stage_marker_contract.rs
  - packages/sidecar/src/adapter.ts
  - packages/sidecar/src/claude-code-adapter.ts
  - packages/sidecar/test/ask-user-question.test.mjs
  - packages/sidecar/test/authoring-proposal-wire.test.mjs
  - packages/sidecar/test/authoring-stage-gate.test.mjs
  - scripts/uat/fixtures/live-opus5-ask-user-question.json
  - scripts/uat/lib/fake-authoring-claude.mjs
  - scripts/uat/README.md
  - scripts/uat/uat-08-socratic-authoring.mjs
  - .planning/REQUIREMENTS.md
  - .planning/phases/05-socratic-epic-authoring/05-VALIDATION.md
findings:
  critical: 0
  warning: 1
  info: 1
  total: 2
status: issues_found
---

# Phase 05: Code Review Report (gap-closure round 10, G-05-8)

**Reviewed:** 2026-09-26T00:00:00Z
**Depth:** standard
**Files Reviewed:** 13
**Status:** issues_found

## Summary

This round closes G-05-8 in two independent places: (1) `start_authoring_run` now writes the D-88
runtime stage marker as the last step before commit, mirroring `transition_stage`'s existing
T-05-03-05 ordering rule exactly, with a marker-write failure surfacing as an `Err` and rolling back
the whole transaction (verified against the new `authoring_stage_marker_contract.rs`); and (2) the
adapter seam now models `AskUserQuestion` tool calls as typed, bounded, ordered data
(`ToolCallEvent.questions`), and the offline conversation driver reads those typed questions instead
of relying on prose containing a `?`, so a turn whose closing text carries no question mark is no
longer misread as settled.

I traced the transaction/rollback path in `authoring_session.rs` line by line against the new
contract test, the adapter's `parseAskUserQuestionInput`/`normaliseStreamEvent` changes against
their unit tests and the frozen live fixture, and the `uat-08` conversation-driver/exchange-builder
changes against both the self-tests and the `ask-user-question` `--replay-check` scenario. The
non-object/null guard in `normaliseStreamEvent` that prevents a readline-handler crash predates this
round (05-37, WR-03) and is untouched by it; the new `AskUserQuestion` parsing path is fully guarded
(no unguarded property read) and degrades to `undefined` (never a throw, never an empty array) on
every malformed shape the tests exercise. I did not find a genuine correctness defect introduced by
this round's production code. I did find one factual inconsistency in the requirements ledger this
round updated, and one low-severity residual in the marker-write rollback path worth recording
(neither blocks shipping).

## Warnings

### WR-01: REQUIREMENTS.md mislabels this round's own gap as G-05-7 instead of G-05-8

**File:** `.planning/REQUIREMENTS.md:93` (SHAPE-01) and `.planning/REQUIREMENTS.md:95` (SHAPE-03)
**Issue:** Both lines end with: *"round 10 additionally wrote the stage marker at session start so
a challenging agent is refused with an actionable reason rather than an infrastructure error,
modelled the `AskUserQuestion` payload at the adapter seam and rendered it into the evidence sheet
— closing `G-05-7`'s stated residual — and removed the tool from an authoring session's tool set,
proven as argv only."*

Every other source of record for this round — `scripts/uat/README.md`'s "Ninth finding" (explicitly
titled as the ninth instance of the defect class, covering the stage marker and `AskUserQuestion`
together, and explicitly citing `gap G-05-8`), and `05-VALIDATION.md`'s ledger rows `05-40-*` through
`05-43-*` (all fifteen rows tagged `gap closure G-05-8`) — agree that this round's own gap is G-05-8,
not G-05-7. G-05-7 was the *previous* round (plans 05-36 through 05-39, the evidence-sheet-on-throw
and unmodelled-event-truncation defects), already closed and recorded as such in the same
`05-VALIDATION.md` file this round also edited. The stage-marker write and the `AskUserQuestion`
modelling described in this sentence are both G-05-8 work, per this round's own commit messages
(`4022dca`, `b6e9b33`, `5257627`, `8a2c63e`, `d28aebb`, `54b1c8d`) and per the review's own required
`<structural_findings>`-equivalent source, `authoring_stage_marker_contract.rs`'s own module doc
comment (which names `G-05-8(b)` throughout). A downstream tool or reader that keys off this line to
decide whether G-05-7 or G-05-8 has open residual work will draw the wrong conclusion in both
directions: G-05-7 will look like it still has an outstanding item this text just "closed," and
G-05-8's own closure will not be traceable from `REQUIREMENTS.md` at all.

**Fix:**
```diff
- round 10 additionally wrote the stage marker at session start so a challenging agent is refused
- with an actionable reason rather than an infrastructure error, modelled the `AskUserQuestion`
- payload at the adapter seam and rendered it into the evidence sheet — closing `G-05-7`'s stated
- residual — and removed the tool from an authoring session's tool set, proven as argv only
+ round 10 additionally wrote the stage marker at session start so a challenging agent is refused
+ with an actionable reason rather than an infrastructure error, modelled the `AskUserQuestion`
+ payload at the adapter seam and rendered it into the evidence sheet — closing `G-05-8`'s two
+ stated residuals — and removed the tool from an authoring session's tool set, proven as argv only
```
Apply identically at both line 93 and line 95.

## Info

### IN-01: A marker-write failure that races with a later `commit()` failure can leave an orphaned stage-marker file on disk

**File:** `packages/core/src/domain/authoring_session.rs:145-156`
**Issue:** `start_authoring_run` writes the on-disk stage marker as the last step *before*
`tx.commit()`, and bails with an `Err` (rolling the transaction back via `Drop`) if the marker write
itself fails — this is exactly right, and the new `authoring_stage_marker_contract.rs` test proves
it (`a_marker_write_failure_at_start_leaves_no_agent_run_row`). The one case that test does not (and
structurally cannot) cover is the *reverse* ordering failure: the marker write **succeeds**, and then
`tx.commit()` itself fails (e.g. a disk-full or I/O error on the SQLite file, distinct from the
runtime-marker file). In that case the `agent_runs` row is rolled back (never committed, never
visible to any reader), but the stage-marker JSON file at `<runtimeDir>/stage/<runId>.json` is
already durably on disk, naming a run id that no `agent_runs` row will ever exist for. This mirrors
an identical, pre-existing residual in the sibling `transition_stage` function (T-05-03-05), so it is
not new in kind — but this round adds a second call site with the same shape, and the doc comment's
framing ("bail BEFORE commit... so the transaction rolls back and no row is left without its
marker") reads as a stronger guarantee ("no row without a marker") than the code actually delivers
in the untested direction ("no marker without a row" is not guaranteed). In practice this is
low-impact: run ids are ULIDs and never reused, so the orphaned file is inert clutter rather than a
correctness hazard (no live session will ever be spawned against the rolled-back run id, so the
stage-gate hook never reads the orphaned marker for a real call). Recorded for completeness because
the review brief specifically asked for scrutiny of this rollback path, not because it changes the
shipping recommendation.

**Fix:** If this residual is ever worth closing, the marker file would need to be deleted in a
best-effort cleanup on a `commit()` failure (mirroring how a failed marker write is already handled
in the other direction), e.g.:
```rust
tx.commit().map_err(|err| {
    // Best-effort: the marker file may already be on disk for a run whose row just failed
    // to commit — clean it up so a later `read_authoring_stage` can't find a stage marker for
    // a run that was never actually created. Errors here are swallowed; the commit error is
    // already the one that matters.
    let _ = crate::runtime_protocol::remove_authoring_stage_marker(&run_id);
    anyhow::Error::from(err).context("failed to commit start_authoring_run transaction")
})?;
```
(No such removal helper exists today; adding one is only worth doing if this residual is promoted to
an actual gap report.)

---

_Reviewed: 2026-09-26T00:00:00Z_
_Reviewer: Claude (gsd-code-reviewer)_
_Depth: standard_
