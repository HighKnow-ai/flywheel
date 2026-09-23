---
phase: 04-clear-is-free
reviewed: 2026-09-23T00:00:00Z
depth: standard
files_reviewed: 47
files_reviewed_list:
  - packages/core/src/compaction.rs
  - packages/core/src/context_packet.rs
  - packages/core/src/db/migrations/0008_session_summaries.sql
  - packages/core/src/db/migrations/0009_criteria_revisions.sql
  - packages/core/src/db/mod.rs
  - packages/core/src/domain/acceptance_criterion.rs
  - packages/core/src/domain/agent_run.rs
  - packages/core/src/domain/mod.rs
  - packages/core/src/domain/session_summary.rs
  - packages/core/src/drift.rs
  - packages/core/src/git.rs
  - packages/core/src/lib.rs
  - packages/core/src/query/mod.rs
  - packages/core/src/query/recovery.rs
  - packages/core/tests/compaction.rs
  - packages/core/tests/context_packet.rs
  - packages/core/tests/criteria.rs
  - packages/core/tests/criteria_pin.rs
  - packages/core/tests/destructive_classifier.rs
  - packages/core/tests/diff_so_far.rs
  - packages/core/tests/discard_lifecycle.rs
  - packages/core/tests/drift.rs
  - packages/core/tests/five_cycle_reconstitution.rs
  - packages/core/tests/session_summary_lifecycle.rs
  - packages/core/tests/summary_report_wire.rs
  - packages/desktop/src-tauri/src/commands/agent_run.rs
  - packages/desktop/src-tauri/src/commands/criterion.rs
  - packages/desktop/src-tauri/src/main.rs
  - packages/desktop/src-tauri/src/sidecar.rs
  - packages/desktop/src/App.tsx
  - packages/desktop/src/adapters/tauri.ts
  - packages/desktop/src/board/BoardView.tsx
  - packages/desktop/src/board/useBoardQuery.ts
  - packages/desktop/src/item-detail/AcceptanceCriteriaList.tsx
  - packages/desktop/src/item-detail/RunsSection.tsx
  - packages/desktop/src/item-detail/__tests__/criteria.test.tsx
  - packages/desktop/src/item-detail/__tests__/runs-section.test.tsx
  - packages/desktop/src/launch-sheet/LaunchSheet.tsx
  - packages/desktop/src/launch-sheet/__tests__/launch-sheet.test.tsx
  - packages/desktop/src/session/SessionSurface.tsx
  - packages/desktop/src/session/__tests__/session-surface.test.tsx
  - packages/desktop/src/state/uiStore.ts
  - packages/sidecar/src/adapter.ts
  - packages/sidecar/src/claude-code-adapter.ts
  - packages/sidecar/src/mcp-permission-server.ts
  - packages/sidecar/test/five-cycle.test.mjs
  - packages/sidecar/test/real-claude-argv.test.mjs
  - packages/sidecar/test/socket-test-helpers.mjs
  - packages/sidecar/test/summary-report.test.mjs
findings:
  critical: 2
  warning: 3
  info: 1
  total: 6
status: issues_found
---

# Phase 04: Code Review Report

**Reviewed:** 2026-09-23T00:00:00Z
**Depth:** standard
**Files Reviewed:** 47
**Status:** issues_found

## Summary

This phase built append-only session summaries, a pure compaction fold, revisable-but-immutable
acceptance criteria, fact-based drift detection, the diff-so-far briefing, and the one-action
Discard verb. The pure-function core (`compaction.rs`, `drift.rs`, `context_packet.rs`'s
`render_prompt`) is careful, well-tested at the unit level, and does what its extensive doc
comments claim. All new/changed SQL is parameterized; no injection surface was found. The
Tauri-command / sidecar wiring for `summary_reported`, `session_closed` and the permission-request
round trips correctly isolates DB-only decision logic from the IPC-adjacent side effects and is
resilient to malformed events.

However, two integration-level defects were found where the pieces are wired together, both of
which silently defeat guarantees this phase's own documentation states elsewhere as load-bearing:

1. The `CriteriaRevisionMoved` drift detector — one of the phase's four flagship fact-based
   detectors — never fires at the one call site whose entire purpose is to persist and forward it
   (`agent_run_start`), because the pin lookup resolves against the just-created run's own
   not-yet-set pin instead of the previous run's pin.
2. The Stop/Discard termination path (`stop_agent_run_recording_first`, plan 04-13) writes the
   run's terminal status and its fallback summary in two separate transactions, reintroducing
   exactly the "terminal run with no summary" gap that `apply_session_closed`'s doc comment states
   is closed by construction elsewhere in this same crate.

Both are provable from the code as written and neither is caught by the existing test suite
(confirmed by grep: `CriteriaRevisionMoved` has no integration-level test exercising
`agent_run_start`/`packet_extras_for`, and `discard_lifecycle.rs` documents the two-transaction
sequence verbatim without asserting anything about the window between the two commits).

## Critical Issues

### CR-01: `CriteriaRevisionMoved` drift never fires when a run actually starts

**File:** `packages/desktop/src-tauri/src/commands/agent_run.rs:373-380` (the bug), called from
`agent_run_start` at `packages/desktop/src-tauri/src/commands/agent_run.rs:509-527`

**Issue:**

`packet_extras_for` resolves the run whose criteria-revision pin should be compared against the
task's current criteria via:

```rust
let pinned_criterion_ids: Option<Vec<String>> =
    match flywheel_core::query::permissions::latest_run_id_for_task(conn, task_id) {
        Ok(Some(run_id)) => {
            flywheel_core::domain::agent_run::criteria_revision_pin_for_run(conn, &run_id)
                .unwrap_or(None)
        }
        _ => None,
    };
```

`latest_run_id_for_task` is `SELECT id FROM agent_runs WHERE task_id = ?1 ORDER BY started_at DESC
LIMIT 1` (`packages/core/src/query/permissions.rs:99-100`) — the run with the latest
`started_at`.

In `agent_run_preview` this correctly returns the task's most recently *existing* run (no run has
been created yet), so previewing a briefing after a criteria edit correctly surfaces the
`CriteriaRevisionMoved` warning.

In `agent_run_start`, `packet_extras_for` is called **after** `start_agent_run` has already
inserted the new `agent_runs` row (line 509-515) with `started_at = now`. That new row now has the
latest `started_at` for the task, so `latest_run_id_for_task` returns the *brand-new* run — whose
`criteria_revision_pin` column is still `NULL`, because `pin_criteria_revisions` is not called
until later, at line 566. `criteria_revision_pin_for_run` therefore returns `Ok(None)` for it,
`pinned_criterion_ids` becomes `None`, and `detect_criteria_revision` (`packages/core/src/drift.rs:148-149`)
returns `None` immediately on its own early-return guard (`let pinned = inputs.pinned_criterion_ids?;`).

The practical effect: a developer who sees the `CriteriaRevisionMoved` warning in the launch
sheet's preview, then clicks "Start Work" moments later, gets a prompt whose `## Warnings` section
(`render_prompt`, `packages/core/src/context_packet.rs:454-465`) is silently missing that exact
warning, and `record_drift_warnings` (called at `agent_run_start` line ~530-549) never persists a
`drift.detected` event for it either — which also means `query::recovery`'s arm 3 (the board's
Needs Decision pill) can never fire for this detector via the start path. No integration test
exercises this: `grep -rl CriteriaRevisionMoved` only finds the pure unit tests in `drift.rs`
itself and its own doc comment, never a test that drives `agent_run_start` end-to-end after a
criteria revision.

**Fix:** Resolve the *previous* latest run id (the one that exists before `start_agent_run`
mutates the table) and thread it through explicitly, rather than re-deriving "latest run for this
task" after the new row already outranks it:

```rust
// Before start_agent_run runs — the run whose pin should be compared against.
let previous_run_id =
    flywheel_core::query::permissions::latest_run_id_for_task(&conn, &task_id)
        .map_err(|e| e.to_string())?;

let run = flywheel_core::domain::agent_run::start_agent_run(&mut conn, &task_id, &permission_mode, &human_actor_id)
    .map_err(|e| e.to_string())?;

// packet_extras_for takes the previously-resolved run id explicitly instead of re-querying
// "latest run for task", which would now resolve to `run` itself.
let extras = packet_extras_for(&conn, &packet, &task_id, previous_run_id.as_deref());
```

with `packet_extras_for`'s pin lookup changed to use the passed-in id directly instead of calling
`latest_run_id_for_task` a second time.

---

### CR-02: Stop/Discard can leave a run terminal with no session summary across a crash

**File:** `packages/desktop/src-tauri/src/commands/agent_run.rs:645-691` (`stop_agent_run_recording_first`)

**Issue:**

```rust
pub(crate) fn stop_agent_run_recording_first(...) -> Result<AgentRunStopDto, String> {
    let interrupt_result = interrupt();
    ...
    flywheel_core::domain::agent_run::interrupt_agent_run(conn, agent_run_id, &human_actor_id)
        .map_err(|e| e.to_string())?;                      // <-- transaction #1, commits here

    let status: String = conn.query_row(...)?;

    if flywheel_core::domain::session_summary::latest_summary_for_run(conn, agent_run_id)
        .map_err(|e| e.to_string())?
        .is_none()
    {
        let tx = conn.transaction().map_err(|e| e.to_string())?;   // <-- transaction #2
        flywheel_core::domain::session_summary::synthesize_fallback_summary(&tx, agent_run_id, &status)
            .map_err(|e| e.to_string())?;
        tx.commit().map_err(|e| e.to_string())?;
    }
    ...
}
```

`interrupt_agent_run` opens and commits its own transaction (writes `agent_runs.status =
'interrupted'` and appends the terminal event). The fallback-summary insert then runs in a
**second**, independent transaction. This is exactly the ordering `apply_session_closed`'s own doc
comment (`packages/core/src/domain/agent_run.rs:589-596`) explains this crate deliberately avoids
for the natural-close path: "`close_agent_run`'s public `&mut Connection` entry point is
deliberately NOT called here, because it opens and commits its own transaction, which would let
the status update land while a crash before the summary insert left the run terminal with no
summary at all — exactly the gap D-64 exists to close."

`stop_agent_run_recording_first` (added by plan 04-13, per its own comment at line ~665) does not
follow that same discipline: a crash, forced-quit, or SQLite I/O error occurring between the two
commits leaves the run `interrupted`/terminal with `exit_summary_id` still `NULL` and no
`session_summaries` row at all — the exact "terminal run with no summary" state the crate
documents elsewhere as structurally impossible. Because `session_summaries` is append-only and
nothing ever retroactively backfills a missing summary for an already-terminal run, that session's
narrative is then permanently and silently lost from every future context packet for the task
(`assemble_context_packet`'s `SUMMARIES_SQL` simply has no row for it) — directly in the category
this phase's own review guidance calls out ("any place a summary...could be silently lost").

This is confirmed, not hypothetical: `packages/core/tests/discard_lifecycle.rs`'s
`simulate_discard_stop_path` helper (lines 91-111) reproduces this exact two-transaction sequence
verbatim as "the EXACT database sequence `stop_agent_run_recording_first` performs," with no test
anywhere asserting atomicity across the boundary between the two commits.

**Fix:** Mirror `apply_session_closed`'s own pattern — add an `interrupt_agent_run_in_tx(tx, ...)`
sibling to the existing `close_agent_run_in_tx` (`packages/core/src/domain/agent_run.rs:333-387`),
and have `stop_agent_run_recording_first` open exactly one transaction covering both the interrupt
write and the presence-checked fallback-summary insert:

```rust
let tx = conn.transaction().map_err(|e| e.to_string())?;
flywheel_core::domain::agent_run::interrupt_agent_run_in_tx(&tx, agent_run_id, &human_actor_id)
    .map_err(|e| e.to_string())?;
let status: String = tx.query_row(...)?;
if flywheel_core::domain::session_summary::latest_summary_for_run(&tx, agent_run_id)
    .map_err(|e| e.to_string())?
    .is_none()
{
    flywheel_core::domain::session_summary::synthesize_fallback_summary(&tx, agent_run_id, &status)
        .map_err(|e| e.to_string())?;
}
tx.commit().map_err(|e| e.to_string())?;
```

## Warnings

### WR-01: Unbounded growth in the prompt-assembly read path

**File:** `packages/core/src/context_packet.rs:166-168` (`SUMMARIES_SQL`), `packages/core/src/compaction.rs`

**Issue:** `SUMMARIES_SQL` reads every `session_summaries` row ever recorded for a task with no
`LIMIT`, and `compact_summaries` (deliberately, per D-68/D-69's own doc comments) never caps or
truncates anything by size — only the fixed `VERBATIM_WINDOW = 5` boundary changes what's folded
vs. carried verbatim; a folded summary still keeps its full `changed_files` list and every
`decisions` entry forever, and `ContextPacket.decisions` (the deduplicated-by-id list) grows
without bound as a task accumulates more unique decisions across dozens or hundreds of sessions.
This is an explicit, well-argued design decision (the module doc comment names the alternative —
"resist the temptation to save tokens by summarizing summaries" — and rejects it), but it means a
long-lived task has no documented or tested ceiling on the size of the DB read, the folded-history
list, or the resulting rendered prompt; nothing here would visibly degrade until a real project
accumulates enough history to notice the effect on cost/latency.

**Fix:** Not a correctness bug given the stated design, but worth either (a) documenting a tested
scale ceiling (e.g. "verified up to N summaries / M decisions"), or (b) adding a cheap
observability signal (a warning surfaced in the launch sheet, or a logged metric) once a task's
summary count or decision count crosses a threshold, so an operator notices before the prompt
itself becomes a problem rather than after.

### WR-02: Deleting a criterion's current revision orphans its history

**File:** `packages/core/src/domain/acceptance_criterion.rs:766-874` (`delete_criterion`,
`delete_criteria_for_parent`)

**Issue:** Both delete paths issue a plain `DELETE FROM acceptance_criteria WHERE id = ?1` (or the
cascading equivalent) with no awareness of the revision chain this phase introduced. If the
*current* revision of a criterion that has been revised at least once is deleted, its superseded
predecessor row(s) remain physically in the table (`superseded_at` still set from the earlier
revise) but become permanently unreachable: `list_revisions_for_root` (line 927-955) starts its
walk from the id it is given, and once the current row is gone, nothing else in the schema records
which predecessor(s) used to point at it. `list_criteria`/`list_current_criteria` no longer surface
the criterion at all (correct for the current row), but the prior wording that D-79's "revised"
marker exists specifically to preserve is now dead data with no code path that can ever read it
again.

`criterion_delete` is still registered as a live Tauri command (`packages/desktop/src-tauri/src/main.rs:134`)
even though this phase's UI (`AcceptanceCriteriaList.tsx`) does not wire a delete affordance to it —
so the gap is currently unreachable from the shipped UI, but the command surface itself is not
guarded against it.

**Fix:** Either refuse deletion of a criterion that has any revision history (mirroring the
`criteria_locked_for_task` check `revise_criterion` already performs), or cascade the delete across
the whole chain (`id = ?1 OR revision_of = <chain root>`) so no row is left orphaned either way.

### WR-03: `pending_permission_requests`/`liveSessions` maps grow unboundedly for the sidecar's process lifetime

**File:** `packages/sidecar/src/claude-code-adapter.ts` (`liveSessions.set` at line 832, no
corresponding `.delete` anywhere in the file)

**Issue:** Not new to this phase, but exercised more heavily by it (`normalizeSummaryNotice`/
`onSummary` add a third long-lived closure captured per session): every `LiveSession` inserted into
the module-level `liveSessions` map is never removed after the run closes, so the map grows for as
long as the sidecar process lives. This does not affect correctness of the summary-reporting or
drift paths reviewed here (an already-closed session's `interruptSession`/`killSession` calls
still early-return correctly via `closedEventEmitted`), but it is a real, unbounded per-session
memory retention that a very long-running desktop session will eventually notice.

**Fix:** Out of this phase's stated scope, but worth a follow-up ticket to delete a session's entry
once its `session.closed` promise settles.

## Info

### IN-01: `abandonedReason` field name is misleading

**File:** `packages/desktop/src-tauri/src/commands/agent_run.rs:1524-1549` (`RunSummaryDto`),
`packages/desktop/src/item-detail/RunsSection.tsx:347-350`

**Issue:** `abandoned_reason`/`abandonedReason` actually carries the kill record's `killed_at`
**timestamp**, not a textual reason — the frontend correctly treats it as a `Date` (`new
Date(run.abandonedReason)`), so this is not a bug, but the field name reads as though it holds an
explanation string, which is one keystroke away from a real mistake the next time this DTO is
touched.

**Fix:** Consider renaming to `abandonedAt` (or similarly) in a follow-up, non-urgent pass.

---

_Reviewed: 2026-09-23T00:00:00Z_
_Reviewer: Claude (gsd-code-reviewer)_
_Depth: standard_
