---
phase: 05-socratic-epic-authoring
reviewed: 2026-09-24T00:39:47Z
depth: standard
files_reviewed: 27
files_reviewed_list:
  - packages/core/src/domain/agent_run.rs
  - packages/core/src/domain/authoring_proposal.rs
  - packages/core/src/epic_context_packet.rs
  - packages/core/src/query/authoring.rs
  - packages/core/tests/authoring_acceptance.rs
  - packages/core/tests/authoring_lifecycle.rs
  - packages/core/tests/authoring_measurement.rs
  - packages/core/tests/authoring_proposal.rs
  - packages/core/tests/bin/uat_authoring_ops.rs
  - packages/core/tests/epic_context_packet.rs
  - packages/core/tests/launch_reconciliation.rs
  - packages/desktop/src-tauri/src/commands/agent_run.rs
  - packages/desktop/src-tauri/src/commands/authoring.rs
  - packages/desktop/src-tauri/src/main.rs
  - packages/desktop/src-tauri/src/sidecar.rs
  - packages/desktop/src/adapters/tauri.ts
  - packages/desktop/src/launch-sheet/__tests__/launch-sheet.test.tsx
  - packages/desktop/src/launch-sheet/LaunchSheet.tsx
  - packages/desktop/src/recovery/__tests__/orphan-recovery.test.tsx
  - packages/desktop/src/recovery/OrphanRecoveryModal.tsx
  - packages/desktop/src/session/__tests__/authoring-composer.test.tsx
  - packages/desktop/src/session/FeedRow.tsx
  - packages/desktop/src/session/SessionSurface.tsx
  - packages/sidecar/src/adapter.ts
  - packages/sidecar/src/claude-code-adapter.ts
  - packages/sidecar/src/mcp-permission-server.ts
  - packages/sidecar/test/adapter.test.mjs
  - scripts/uat/README.md
  - scripts/uat/uat-08-socratic-authoring.mjs
findings:
  critical: 1
  warning: 3
  info: 0
  total: 4
status: issues_found
---

# Phase 05: Code Review Report (Incremental — Gap Closure 05-11/05-12/05-13)

**Reviewed:** 2026-09-24T00:39:47Z
**Depth:** standard
**Files Reviewed:** 27
**Status:** issues_found

## Summary

This is an incremental review scoped to the gap-closure work (plans 05-11, 05-12, 05-13) and the
post-review fix commits (WR-01, WR-02, CR-01, WR-03) layered on top of the phase's original
05-01..05-10 work already reviewed at commit `2340cf0`. I read every file in the `files:` list,
diffed each against `2340cf0..HEAD` to isolate what actually changed, and traced the four stated
prohibitions from the gap-closure SUMMARYs through to the code that is supposed to enforce them.

Three of the four prohibitions hold cleanly on inspection:

- **Renderer-supplied text never advances a stage, creates a proposal, or reaches a
  proposal-writing tool.** `authoring_turn_send` (`commands/authoring.rs`) writes no board row,
  touches no `authoring_stage`, and calls no proposal function — confirmed by reading the command
  body end to end.
- **The developer's words are never attributed to the agent.** `developer_turn` is its own feed
  row kind (`FeedRow.tsx`), rendered in a distinct accent color, never folded into
  `assistant_text`; the backend's own restatement of a sent turn is separately typed
  (`backend_echo`) and suppressed rather than merged.
- **The Tauri transport is never called directly from a component.** No `invoke(`/`@tauri-apps/api`
  reference exists in `SessionSurface.tsx`, `LaunchSheet.tsx`, or `OrphanRecoveryModal.tsx` —
  every call routes through `adapters/tauri.ts`'s named wrappers.
- **The harness binary never migrates or writes to the developer's real fleet database.**
  `uat_authoring_ops measure-run`'s early-dispatch branch opens the resolved db path with
  `SQLITE_OPEN_READ_ONLY` and never calls `open_and_migrate` — confirmed by reading `main()`.

The fourth prohibition — **"every application-sent turn must leave exactly one transcript row"**
— does **not** hold under a realistic failure mode, and is this review's one Critical finding
(CR-01 below): the new persist-before-relay ordering in `SidecarHandle::send_authoring_turn`
writes the transcript row unconditionally, before the delivery attempt it is supposed to be a
record of even happens. Combined with `authoring_turn_send`'s own explicit "surface delivery
failure so the developer can retry" design, this produces exactly the duplicate/misleading-row
scenario the prohibition exists to prevent.

Also flagged: two correctness gaps in the new `measure_authoring_run` bounded reads (ordering
before `LIMIT`), and a pre-existing (not introduced by this gap-closure work, but present in a
file this review's scope covers) logic bug in `uat-08-socratic-authoring.mjs` that makes the live
acceptance script's own pass/fail assertion structurally unwinnable.

## Critical Issues

### CR-01: A failed authoring-turn send still leaves (and can duplicate) a transcript row claiming it was sent

**File:** `packages/desktop/src-tauri/src/sidecar.rs:507-523` (also
`packages/desktop/src-tauri/src/commands/authoring.rs:886-935`)

**Issue:** Plan 05-12's stated design for `authoring_turn_send` is that, unlike every other
authoring relay in this file, a delivery failure must be **surfaced** to the developer rather than
swallowed — "a developer who pressed send is entitled to know it did not land" — and the composer
keeps the typed text so they can retry. But `SidecarHandle::send_authoring_turn` now does this,
unconditionally, before attempting delivery:

```rust
pub fn send_authoring_turn(
    &self,
    app: &AppHandle,
    run_id: &str,
    text: &str,
    origin: AuthoringTurnOrigin,
) -> anyhow::Result<()> {
    self.record_authoring_turn(app, run_id, text, origin); // persists + emits, ALWAYS

    let request = serde_json::json!({ "op": "authoring_turn", "runId": run_id, "text": text, .. });
    self.send_request(&request.to_string()) // may still fail — Err propagates, but the row above already exists
}
```

`record_authoring_turn` persists a `developer_turn` line to the session log and emits it on
`agent:event` *before* `send_request` is ever called. `send_request` genuinely can fail — it
returns `Err` whenever `self.child` is `None` or the write to the child's stdin fails (e.g. the
`claude` process has already exited but `agent_runs.status` has not yet transitioned, which is
exactly the race `authoring_turn_send`'s own DB status check cannot close, since the connection is
dropped before the sidecar call).

When that happens today:

1. The feed already shows the developer's message as a normal `developer_turn` row —
   `FeedRow.tsx`'s `developer_turn` case carries no delivery-status field and renders identically
   whether the send succeeded or failed.
2. `authoring_turn_send` still returns `Err` to the renderer, which (correctly, per its own test
   `"a rejected send leaves the typed text in place and surfaces a worded message"`) shows an
   alert and leaves the text in the composer for retry.
3. If the developer retries (the intended, documented recovery path), `record_authoring_turn` runs
   again with a **new** `turnId`, persisting and emitting a **second** `developer_turn` row with
   the same (or edited) text — one logical send attempt now occupies two transcript rows, and only
   the second one ever actually reached the model.
4. If the developer does not retry, the transcript permanently and silently misrepresents that the
   developer said something the agent never received — there is no marker distinguishing this row
   from a delivered one, and no follow-up event ever corrects it.

This is the reverse failure mode of the prohibition it was meant to satisfy: the developer's typed
turn is not *discarded* on failure, but it is *falsely recorded as delivered*, and a retry produces
exactly the duplicate row the "exactly one transcript row per application-sent turn" contract
(D3/D4 of plan 05-12's own coverage table) is supposed to rule out. Neither the Rust unit tests
(`persist_tests::authoring_turn_line_carries_type_run_id_text_and_origin`, which only tests the
pure `build_authoring_turn_line` builder) nor the frontend composer tests (which mock
`sendAuthoringTurn` at the wrapper boundary and never exercise the real persist-then-relay
ordering) cover this path.

**Fix:** Do not persist/emit the `developer_turn` row unconditionally ahead of the delivery
attempt for the one caller (`authoring_turn_send`) that surfaces failure. Options, in order of
minimal disruption:

```rust
// Attempt delivery FIRST; persist+emit only once delivery is confirmed reachable —
// mirrors "the persisted log is ground truth" without also claiming a turn is ground
// truth before the child process has even accepted it.
pub fn send_authoring_turn(
    &self,
    app: &AppHandle,
    run_id: &str,
    text: &str,
    origin: AuthoringTurnOrigin,
) -> anyhow::Result<()> {
    let request = serde_json::json!({ .. });
    self.send_request(&request.to_string())?;   // fail fast, before any row exists
    self.record_authoring_turn(app, run_id, text, origin);
    Ok(())
}
```

If persist-before-relay must stay (e.g. because the three best-effort callers rely on that
ordering for their own reasons), then `build_authoring_turn_line` needs a delivery-status field
(`"pending"` / `"failed"` / `"delivered"`) that `authoring_turn_send`'s failure path can update in
place (or that `FeedRow.tsx` can render distinctly), so a retry supersedes rather than duplicates,
and a developer who never retries can tell their message did not land from the transcript itself,
not only from a toast that has since disappeared.

## Warnings

### WR-04: `record_authoring_turn`'s persist failure bypasses the codebase's own "make a skipped persist observable" discipline

**File:** `packages/desktop/src-tauri/src/sidecar.rs:470-486`

**Issue:** This same file already has `emit_persistence_failure_notice(app, run_id, detail)`
(line ~727), built specifically so PROC-07's "the live feed never silently drops agent output"
holds — every other persist-failure path in the shared reader loop uses it to put a visible
`system_notice` row in the feed. `record_authoring_turn` does not call it:

```rust
let outcome = persist_event_line(&self.writers, run_id, &line);
if outcome != PersistOutcome::Written {
    eprintln!("session log persist failed for an authoring turn on run {run_id}: {outcome:?}");
}
```

A failed persist here is only visible in the app's own stderr — invisible to the end user, and
inconsistent with the one other place in this file that already solved this exact problem.

**Fix:** Call `emit_persistence_failure_notice(app, run_id, &detail)` (extracting `detail` from
the non-`Written` `PersistOutcome` variant) alongside the `eprintln!`, matching the reader loop's
own established pattern.

### WR-05: `measure_authoring_run`'s bounded reads order (or fail to order) the wrong way for what they claim to compute

**File:** `packages/core/src/query/authoring.rs:364-397`

**Issue:** Two separate ordering problems in the same function:

1. The proposal-lifecycle event read truncates the WRONG end of the set:

   ```rust
   "SELECT e.stream_id, e.event_type, e.occurred_at FROM events e ... \
    ORDER BY e.occurred_at ASC LIMIT ?2"
   ```

   `last_accepted_at` is computed by scanning this result for the maximum `occurred_at`. Ordering
   `ASC` before `LIMIT` keeps the *oldest* events and discards the *newest* ones once a run's own
   accept/amend event count exceeds `resolved_limit` (200 by default, clamped at 500) — the exact
   opposite of what `last_accepted_at`/`elapsed_minutes` need. Every other bounded read in this
   crate (`epic_context_packet.rs`'s `ANSWERED_ASSUMPTIONS_SQL`/`REJECTED_PROPOSALS_SQL`, this same
   module's `list_pending_proposals`/`list_rejected_for_epic`) orders `DESC` before `LIMIT`
   precisely so a bound trims the tail, never the head, of what it needs. Here it is backwards:
   once the bound is exceeded, `last_accepted_at` silently reports an *earlier* acceptance than the
   run's real last one, undermining the "derived from the board, never recalled" / "two calls
   produce the identical [correct] result" framing this function's own doc comment claims — this is
   not merely an honest undercount (like the documented WR-02 approximations elsewhere), it is a
   wrong answer.

2. The proposal read has no deterministic order at all:

   ```rust
   "SELECT id, target_type, status FROM authoring_proposals WHERE agent_run_id = ?1 LIMIT ?2"
   ```

   With no `ORDER BY`, which rows SQLite returns first once the count exceeds `resolved_limit` is
   unspecified — unlike every sibling bounded query in this same file, which orders explicitly.

In practice a single epic-authoring run is unlikely to approach 200+ accept/amend events, so this
is a latent correctness bug rather than one currently observed in the shipped UAT runs — but it is
a real defect in code whose entire stated purpose is "derive the Product Kill Criterion's numbers
from the board, never recalled by hand."

**Fix:** Order the event read `DESC` (newest first) before the `LIMIT`, matching the rest of the
crate's convention; add `ORDER BY id ASC` (or another deterministic tiebreak) to the proposal read.

### WR-06: `uat-08-socratic-authoring.mjs`'s SHAPE-05 result can never be `true`, so the live script can never report an overall pass

**File:** `scripts/uat/uat-08-socratic-authoring.mjs:440-479`

**Issue:** Pre-existing (from plan 05-10, not touched by the reviewed 05-11/05-12/05-13 diff hunks
other than the `drainIncidentalPermissionRequests` wiring above it), but present in a file this
review's explicit scope covers, and worth recording since it defeats the script's own stated
contract ("reporting pass or fail per `ROADMAP.md` §Phase 5 success criterion"):

```js
let criterion4Reopened = false;
let criterion4PrimedRejected = false;
if (rejectedTaskId && materialisedEpicId === null) {
  step("no epic was materialised ... unproven rather than fabricating a pass");
}
...
const results = [
  ...
  [
    "SHAPE-05 — reopening primes the challenge against what the epic already contains",
    criterion4Reopened || criterion4PrimedRejected,
    ...
  ],
];
const allPassed = reportCriteria(results);
...
assert.ok(allPassed, "one or more Phase 5 roadmap criteria did not pass this run — ...");
```

Neither `criterion4Reopened` nor `criterion4PrimedRejected` is ever reassigned anywhere in the
file — both stay `false` unconditionally, by the script's own explicit design (this single-session
run structurally cannot exercise SHAPE-05's reopen leg, per the comment above the `if`). That means
`results`' fourth row is always `false`, `reportCriteria` always returns `allPassed = false`, and
the trailing `assert.ok(allPassed, ...)` always throws — even on a run where SHAPE-01 through
SHAPE-04 all genuinely passed. The script cannot currently exit `0`.

**Fix:** Either implement the second, reopening session this criterion actually needs to prove, or
remove criterion 4 from the pass/fail gate entirely (report it as a separate, always-informational
line, the way the SHAPE-05 comment already frames it as "reported honestly as unproven") so a
human running this script can tell "everything this run CAN prove, passed" from "something broke."

---

_Reviewed: 2026-09-24T00:39:47Z_
_Reviewer: Claude (gsd-code-reviewer)_
_Depth: standard_
