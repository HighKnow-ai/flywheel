---
phase: 05-socratic-epic-authoring
reviewed: 2026-09-24T00:00:00Z
depth: standard
files_reviewed: 89
files_reviewed_list:
  - packages/core/Cargo.toml
  - packages/core/src/db/migrations/0010_authoring_runs.sql
  - packages/core/src/db/migrations/0011_authoring_staging.sql
  - packages/core/src/db/migrations/0012_authoring_proposals_project_status_index.sql
  - packages/core/src/db/migrations/0013_authoring_summaries.sql
  - packages/core/src/db/migrations/0014_permission_requests_authoring.sql
  - packages/core/src/db/mod.rs
  - packages/core/src/domain/acceptance_criterion.rs
  - packages/core/src/domain/agent_run.rs
  - packages/core/src/domain/authoring_proposal.rs
  - packages/core/src/domain/authoring_session.rs
  - packages/core/src/domain/epic.rs
  - packages/core/src/domain/mod.rs
  - packages/core/src/domain/permission_request.rs
  - packages/core/src/domain/session_summary.rs
  - packages/core/src/domain/task.rs
  - packages/core/src/domain/trigger.rs
  - packages/core/src/epic_context_packet.rs
  - packages/core/src/lib.rs
  - packages/core/src/query/authoring.rs
  - packages/core/src/query/mod.rs
  - packages/core/src/query/permissions.rs
  - packages/core/src/query/recovery.rs
  - packages/core/src/runtime_protocol.rs
  - packages/core/tests/authoring_acceptance.rs
  - packages/core/tests/authoring_distillation.rs
  - packages/core/tests/authoring_lifecycle.rs
  - packages/core/tests/authoring_proposal.rs
  - packages/core/tests/authoring_stage.rs
  - packages/core/tests/authoring_tracer.rs
  - packages/core/tests/bin/uat_authoring_ops.rs
  - packages/core/tests/discard_lifecycle.rs
  - packages/core/tests/epic_context_packet.rs
  - packages/core/tests/epic_roster.rs
  - packages/core/tests/perf_seed_1000.rs
  - packages/core/tests/permission_gate.rs
  - packages/core/tests/runtime_protocol.rs
  - packages/core/tests/spawn_stagger.rs
  - packages/desktop/src-tauri/src/commands/agent_run.rs
  - packages/desktop/src-tauri/src/commands/authoring.rs
  - packages/desktop/src-tauri/src/commands/epic.rs
  - packages/desktop/src-tauri/src/commands/mod.rs
  - packages/desktop/src-tauri/src/main.rs
  - packages/desktop/src-tauri/src/sidecar.rs
  - packages/desktop/src/App.tsx
  - packages/desktop/src/adapters/tauri.ts
  - packages/desktop/src/authoring/ProposalAmendEditor.tsx
  - packages/desktop/src/authoring/ProposalRow.tsx
  - packages/desktop/src/authoring/ProposalTray.tsx
  - packages/desktop/src/authoring/__tests__/proposal-keyboard.test.tsx
  - packages/desktop/src/authoring/__tests__/proposal-tray.test.tsx
  - packages/desktop/src/authoring/useAuthoringQuery.ts
  - packages/desktop/src/board/BoardRow.tsx
  - packages/desktop/src/board/BoardView.tsx
  - packages/desktop/src/board/CommandPalette.tsx
  - packages/desktop/src/board/FilterBar.tsx
  - packages/desktop/src/board/TriageLane.tsx
  - packages/desktop/src/board/__tests__/board-view.test.tsx
  - packages/desktop/src/board/__tests__/epic-assign.test.tsx
  - packages/desktop/src/board/__tests__/epic-roster.test.tsx
  - packages/desktop/src/board/__tests__/issue-parent.test.tsx
  - packages/desktop/src/board/__tests__/quick-add-focus.test.tsx
  - packages/desktop/src/board/__tests__/reopen-epic.test.tsx
  - packages/desktop/src/board/__tests__/triage-lane.test.tsx
  - packages/desktop/src/board/useBoardQuery.ts
  - packages/desktop/src/item-detail/ItemDetailPanel.tsx
  - packages/desktop/src/launch-sheet/LaunchSheet.tsx
  - packages/desktop/src/launch-sheet/__tests__/launch-sheet.test.tsx
  - packages/desktop/src/legend/__tests__/legend.test.tsx
  - packages/desktop/src/legend/marks.ts
  - packages/desktop/src/projects/__tests__/project-rail.test.tsx
  - packages/desktop/src/session/SessionSurface.tsx
  - packages/desktop/src/session/__tests__/authoring-stage.test.tsx
  - packages/desktop/src/session/__tests__/session-surface.test.tsx
  - packages/desktop/src/state/__tests__/keyboard-agent.test.ts
  - packages/desktop/src/state/keyboard.ts
  - packages/desktop/src/state/uiStore.ts
  - packages/sidecar/src/adapter.ts
  - packages/sidecar/src/claude-code-adapter.ts
  - packages/sidecar/src/index.ts
  - packages/sidecar/src/mcp-permission-server.ts
  - packages/sidecar/src/stage-gate-hook.ts
  - packages/sidecar/test/authoring-proposal-wire.test.mjs
  - packages/sidecar/test/authoring-stage-gate.test.mjs
  - packages/sidecar/test/authoring-tools.test.mjs
  - scripts/spike/authoring-stage-gate-spike.mjs
  - scripts/spike/authoring-transport-spike.mjs
  - scripts/uat/run-all.sh
  - scripts/uat/uat-08-socratic-authoring.mjs
findings:
  critical: 1
  warning: 3
  info: 1
  total: 5
status: issues_found
---

# Phase 05: Code Review Report

**Reviewed:** 2026-09-24T00:00:00Z
**Depth:** standard
**Files Reviewed:** 89
**Status:** issues_found

## Summary

Phase 05 adds a Socratic epic-authoring surface: a new `agent_runs` subject kind (epic, not task),
a staged-proposal table with a full accept/reject/amend/accept-subtree matrix, a hard
`PreToolUse` stage gate, and a bounded read surface for the agent (`board_search`/`epic_get`/
`task_list`). The overall implementation is careful and internally consistent: every domain writer
factors an `_in_tx` sibling so the accept path never duplicates a canonical writer; every bounded
read follows the same `DEFAULT_LIMIT`/`MAX_LIMIT`/clamp idiom; the stage gate fails closed on every
ambiguous input; identity (`project_id`/`epic_id`/actor) is always re-resolved server-side from the
`agent_runs` row, never trusted from a payload crossing a process boundary; and the migrations
correctly rebuild the three affected tables with explicit column lists and CHECK constraints.

One genuine correctness gap was found: the launch-time agent-run reconciler's own SQL silently
excludes every authoring run (an `INNER JOIN` against `tasks`, which an authoring run's NULL
`task_id` can never satisfy), so a crashed or killed authoring session is never reconciled,
never gets the fallback summary plan 05-09 explicitly added for exactly this case, and permanently
blocks the "one authoring session per epic" guard from ever letting a new session start on that
epic again. Three further issues degrade robustness/quality without being outright incorrect:
unbounded per-epic reads in the priming packet, an agent-writable proposal-content length bound
that the create path never actually enforces (only the human amend path does), and a
double-submission guard on the launch sheet that departs from this codebase's own established
synchronous-ref convention.

## Critical Issues

### CR-01: Authoring runs are invisible to launch-time reconciliation — a crashed session never gets reconciled and permanently blocks re-shaping its epic

**File:** `packages/core/src/domain/agent_run.rs:906-911` (`IN_FLIGHT_AGENT_RUNS_SELECT_SQL`, consumed by `reconcile_agent_runs`, lines 961-1028)

**Issue:** `reconcile_agent_runs` — called once at app startup (`main.rs`'s `.setup()`) to sort
every `running`/`blocked` `agent_runs` row into "killed by its watchdog" (write `abandoned`),
"dead, no kill record" (write `abandoned`), or "genuinely still alive" (surface as a live orphan
for the recovery modal) — selects its candidate rows with:

```rust
const IN_FLIGHT_AGENT_RUNS_SELECT_SQL: &str = "
    SELECT ar.id, ar.task_id, ar.project_id, ar.external_session_id, t.key, t.title
    FROM agent_runs ar
    JOIN tasks t ON t.id = ar.task_id
    WHERE ar.status IN ('running', 'blocked')
";
```

This is an `INNER JOIN`. D-84 (this phase) made `agent_runs.task_id` nullable specifically so an
authoring run can carry `epic_id` instead. For any authoring run, `ar.task_id IS NULL`, and
`t.id = ar.task_id` can never be true under SQL's three-valued NULL comparison — the row is
excluded from the join entirely, before the `WHERE` clause is even considered. The reconciler
therefore **never even looks at** a `running`/`blocked` authoring run.

Consequences, all observed by tracing the call graph rather than inferred:

1. **`mark_abandoned`'s own authoring-fallback-summary logic (added by this very phase, plan
   05-09 Task 2(c), specifically to close the `STATE.md` warning "`mark_abandoned` is a third
   terminal path that writes no summary") can never fire for a crashed authoring run reached via
   this path**, because `reconcile_agent_runs` never calls `mark_abandoned` for it in the first
   place. The doc comment on `mark_abandoned` (lines 818-829) states this gap is closed; the
   caller that was supposed to exercise it for a crashed session silently cannot reach it.
2. The run's `agent_runs.status` stays `running`/`blocked` in the database forever — there is no
   other writer of a terminal status for it, and the reconciler is the one mechanism that resolves
   an orphaned run without a live process attached.
3. `find_running_authoring_run` (`commands/authoring.rs:105-126`) matches on exactly
   `status IN ('running','blocked')` for the epic. Once a session dies uncleanly, this predicate
   stays permanently true for that epic — `authoring_run_start`'s own re-check (line 168-172) and
   `continueShapingEpic`'s door-level pre-flight read (`useBoardQuery.ts`) will forever route the
   user back to the dead run's id instead of ever letting a fresh session start on that epic again.
   There is no UI path that clears this (the live-orphan recovery modal never learns about the run
   either, per point 4).
4. The run is also never classified as a live orphan (`LiveOrphan`, the struct
   `reconcile_agent_runs` returns for the launch recovery modal to offer a Kill action on) — even
   if the underlying OS process is genuinely still alive, the modal that exists precisely to let a
   user resolve exactly this situation never learns the run exists.

This is not a documented/deferred debt: plan 05-09's own `<read_first>` list for Task 2 explicitly
named `reconcile_agent_runs` as required reading, and its own action text answers
`mark_abandoned`'s Phase-4 gap in detail — but the SQL the reconciler actually filters candidates
with was never touched to account for the new nullable `task_id`. No test in
`packages/core/tests/launch_reconciliation.rs` constructs an authoring run and asserts it is
reconciled; every existing case there is task-scoped.

**Fix:** Change the join to a `LEFT JOIN` against `tasks` (and, symmetrically, resolve the label
via `epics` when `task_id IS NULL`), so every in-flight row — task or authoring — is a candidate:

```rust
const IN_FLIGHT_AGENT_RUNS_SELECT_SQL: &str = "
    SELECT ar.id, ar.task_id, ar.epic_id, ar.project_id, ar.external_session_id,
           t.key, t.title, e.key, e.title
    FROM agent_runs ar
    LEFT JOIN tasks t ON t.id = ar.task_id
    LEFT JOIN epics e ON e.id = ar.epic_id
    WHERE ar.status IN ('running', 'blocked')
";
```

`LiveOrphan`'s own `task_id`/`task_key`/`task_title` fields would need to become optional (or grow
epic-scoped siblings) so the recovery modal can render either subject; `reconcile_agent_runs`'s row
handling already calls `mark_abandoned`/`clear_run_runtime_files` generically enough that the
kill-record/liveness branches need no further change. Add a case to
`packages/core/tests/launch_reconciliation.rs` that starts an authoring run, simulates a crash
(no kill record, no live process), and asserts `reconcile_agent_runs` writes it to `abandoned` with
a fallback summary — mirroring the existing task-run cases.

## Warnings

### WR-01: Staged-proposal content length is unenforced at creation — only the human amend path validates it

**File:** `packages/core/src/domain/authoring_proposal.rs:186-308` (`create_proposal`/`create_proposal_in_tx`), `:333-390` (`apply_proposal_created`); `packages/sidecar/src/mcp-permission-server.ts:578-615` (`proposeCriterionToolDefinition`, `proposeAssumptionToolDefinition`)

**Issue:** `validate_payload` (`authoring_proposal.rs:807-852`) enforces the same title/statement/
hint length bounds the tool schemas document (`MAX_PROPOSAL_TITLE_LEN = 500`,
`MAX_PROPOSAL_TEXT_LEN = 1000`), and its own doc comment states the intent explicitly: "matching
`commands/epic.rs`'s `MAX_TITLE_LEN`... so an amendment cannot introduce text the agent's own tool
would have been refused for." It is called from exactly one place: `amend_proposal` (line 868).

Neither `create_proposal_in_tx` (the path every `propose_*` tool call and the inbound
`proposal_created` event applier route through) nor `apply_proposal_created` calls
`validate_payload` at all. On the sidecar side, only `propose_task`'s schema documents a
`maxLength` on its `title` (`mcp-permission-server.ts:548`); `propose_criterion`'s `statement`
(line 587), `propose_epic`'s `description` (line 567), and `propose_assumption`'s `assumption`/
`answer` (lines 610-613) carry no `maxLength` at all, and none of these bounds is enforced by the
MCP transport itself (the tool handlers read `args.*` directly with no schema validation step —
confirmed by reading `buildProposeCriterionPayload`/`buildProposeEpicPayload`/
`buildProposeAssumptionPayload`, none of which checks a max length).

The practical effect: an agent's `propose_criterion`/`propose_epic`/`propose_assumption` call can
stage a row with an arbitrarily long `statement`/`description`/`assumption`/`answer` — text the
domain layer would then refuse if the *developer* tried to shorten-and-resave it below the bound
via `ProposalAmendEditor.tsx` only if it were somehow already over the limit in a way amend also
rejects (amend re-validates on save, so an over-limit staged row can never be *amended* without
first being trimmed under 1000 chars, but it renders, persists, and can be *accepted* as-is,
carrying the oversized text straight onto the canonical `tasks`/`epics`/`acceptance_criteria` row
via `materialise_proposal`, which also performs no length check).

**Fix:** Call `validate_payload(&payload)` inside `create_proposal_in_tx` (after computing
`target_type`, before the `INSERT`) and return its error the same way `apply_proposal_created`
already handles other malformed input (`Ignored`, never a panic, never a stored row). Add
`maxLength: 1000` to `propose_criterion.statement`/`verification_hint`,
`propose_epic.description`, and `propose_assumption.assumption`/`answer` in
`mcp-permission-server.ts` so the schema documentation matches the constraint that will now
actually run.

### WR-02: `epic_context_packet.rs`'s rejected/answered-assumption reads have no `LIMIT` and are explicitly outside the crate's `unbounded_reads` gate

**File:** `packages/core/src/epic_context_packet.rs:161-169` (`ANSWERED_ASSUMPTIONS_SQL`, `REJECTED_PROPOSALS_SQL`)

**Issue:** Both queries filter on `epic_id` (and, for the rejected read, `status = 'rejected'`)
with no `LIMIT`:

```rust
const ANSWERED_ASSUMPTIONS_SQL: &str = "SELECT payload FROM authoring_proposals \
    WHERE epic_id = ?1 AND status = 'accepted' AND target_type = 'assumption' \
    ORDER BY created_at ASC, id ASC";

const REJECTED_PROPOSALS_SQL: &str = "SELECT target_type, payload, rejection_reason, created_at \
    FROM authoring_proposals WHERE epic_id = ?1 AND status = 'rejected' \
    ORDER BY created_at DESC, id DESC";
```

D-83 (this phase) keeps every rejected proposal forever ("a decided row is never deleted"), and
`assemble_epic_context_packet` runs on every "Continue Shaping" preview AND every real authoring
session start — so an epic that has been reopened and reshaped many times over its life reads its
*entire* rejected-proposal and answered-assumption history into memory on every single open,
regardless of how many token-bearing `REJECTED_VERBATIM_WINDOW` (5) entries are actually used
afterward — the bound is applied only to the *rendered* output (`fold_rejected`), never to the SQL
itself.

This is explicitly and knowingly excluded from the crate's own safety net:
`packages/core/tests/epic_context_packet.rs`'s own `unbounded_reads_in_query_module_are_all_named_in_the_allowlist`
test doc comment states in so many words that this gate "does not scan `context_packet.rs`...
only `packages/core/src/query`", and calls the equivalent `context_packet.rs` debt "a real,
already-recorded `STATE.md` debt." `epic_context_packet.rs` sits in the identical blind spot but is
not named anywhere as an accepted exception — it is simply outside the scanner's directory scope,
silently.

**Fix:** Add `LIMIT` to both queries, bounded generously above `REJECTED_VERBATIM_WINDOW` (e.g. a
few hundred), and surface a truncation fact the same way `EpicRoster`/`list_pending_proposals`
already do, or at minimum record this in `STATE.md` next to the sibling `context_packet.rs` debt so
it is tracked rather than silently absent from the gate.

### WR-03: `LaunchSheet.tsx`'s double-submission guard uses only React state, not the synchronous ref guard this codebase applies everywhere else

**File:** `packages/desktop/src/launch-sheet/LaunchSheet.tsx:605-628` (`handleSubmit`)

**Issue:** `handleSubmit` — now the single entry point for both `startAgentRun` and (since plan
05-10, this phase) `startAuthoringRun` — guards against double-activation with only:

```ts
function handleSubmit() {
  if (starting) return;
  setStarting(true);
  ...
}
```

Every other double-activation guard added across this codebase (and explicitly called out in this
phase's own new code) uses a synchronous `useRef` in addition to the state flag, with the reason
stated verbatim in multiple places this phase touches: *"React has not necessarily flushed the
disabling re-render before a second click fires."* See `ProposalRow.tsx`'s `acceptingRef`/
`rejectingRef` (lines 172-173), `ProposalTray.tsx`'s `acceptingSubtreeRef` (line 106),
`ProposalAmendEditor.tsx`'s `savingRef` (line 56), and `SessionSurface.tsx`'s `stoppingRef`/
`discardingRef`/`advancingStageRef`/`returningStageRef` (lines 721, 727, 755, 757) — all in files
this phase either added or extended. `LaunchSheet.tsx`'s `handleSubmit` is reachable both from a
mouse click on the submit button and, independently, from `handleDialogKeyDown`'s own `Enter`
branch (line 641), which calls `handleSubmit()` directly rather than clicking the (state-disabled)
button — so a pointer click landing in the same synchronous tick as an `Enter` keydown (or two
rapid `Enter` keydowns dispatched before React flushes the `starting` state update) can invoke
`handleSubmit` twice, each reading the stale `starting === false` closure value, and issue two
`startAgentRun`/`startAuthoringRun` calls for the same task/epic — spawning two live sessions (two
worktrees for a task run; two conversations against the same epic, since `authoring_run_start`'s
own server-side re-check only rejects a *third* concurrent run once the first has already landed a
row, not a race between two near-simultaneous first calls).

**Fix:** Add a `startingRef = useRef(false)` guard mirroring this codebase's own established
pattern, checked and set synchronously at the top of `handleSubmit`, cleared only on the error path
(mirroring every other guard in this phase's own new code).

## Info

### IN-01: `authoring_proposal_accept`/`authoring_subtree_accept` always emit `board:changed` with `entity: "task"`, even when the materialised row is an epic or a criterion

**File:** `packages/desktop/src-tauri/src/commands/authoring.rs:554-557, 599-603`

**Issue:** Both commands unconditionally emit `{"entity": "task", "id": outcome.materialised_id}`
regardless of the accepted proposal's actual `target_type` (which can be `epic` or `criterion`, not
only `task`). In practice this is harmless today: every consumer of `board:changed`
(`useBoardChangedSubscription`, `useRunProposals`, `useProjectProposals`, etc., in
`useBoardQuery.ts`/`useAuthoringQuery.ts`) invalidates by query-key prefix and never branches on
the emitted `entity`/`id` payload at all — but the mislabeling is a latent trap for a future
consumer that does start reading this field expecting it to be accurate.

**Fix:** Derive the emitted `entity` from `outcome.proposal.target_type` (or the accepted
proposal's own `target_type` for the subtree case) rather than hard-coding `"task"`.

---

_Reviewed: 2026-09-24T00:00:00Z_
_Reviewer: Claude (gsd-code-reviewer)_
_Depth: standard_
