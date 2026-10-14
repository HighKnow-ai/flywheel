---
phase: 05-socratic-epic-authoring
plan: 09
subsystem: agent-authoring
tags: [rusqlite, sqlite-migration, session-lifecycle, mcp-tool, react, zustand]

requires:
  - phase: 05-socratic-epic-authoring
    provides: "plan 05-02's agent_runs.task_id/epic_id generalisation (D-84) and start_authoring_run, plan 05-06's accept/reject/amend matrix on authoring_proposals — both extended here, never re-derived"
provides:
  - "session_summaries generalised the same way agent_runs already was (migration 0013): task_id nullable, epic_id added, never-both CHECK — create_summary/synthesize_fallback_summary resolve a run's subject generically, and a new authoring-specific fallback synthesises from staged-proposal counts and the stage reached"
  - "permission_requests generalised identically (migration 0014): a genuine (non-pre-approved) permission request raised by an authoring run is now representable at all — closes a real INSERT-time failure, not just a read-time one"
  - "Every terminal path in agent_run.rs (close_agent_run_in_tx, interrupt_agent_run_in_tx, mark_abandoned) and every permission-request write path (create_pending_request, answer_request, process_inbound_permission_request) reads agent_runs.task_id as Option<String> — each previously errored outright for an authoring run"
  - "mark_abandoned now writes a fallback summary inside its own transaction, for both run kinds — closes the STATE.md warning carried since Phase 4"
  - "query::permissions::blocked_count_for_project widened to count a blocked authoring run; query::recovery.rs's doc comment states the money-burning distinction and where the broader question is answered"
  - "SessionSurface.tsx's Stop gloss and Discard hand-off are subject-aware (uiStore's new activeAgentRunEpicId/launchSheetAuthoringHandoff channels)"
affects: [05-07-*, 05-08-*, 05-10-*, phase-05-verification]

actuals:
  tokens: 26700
  tasks: 3
  commits: 1
  plan_head_before: fc23870057daab742a1cd6ae6d193e60cf81d0be8

tech-stack:
  added: []
  patterns:
    - "The `<name>_new` / explicit-column INSERT / DROP / RENAME TO rebuild sequence (0006_recovery_statuses.sql's own worked example) applied a third and fourth time — session_summaries (0013) and permission_requests (0014) — for the identical never-both-subject CHECK D-84 already gave agent_runs"
    - "A subject dispatch inside a shared fallback-synthesiser entry point (synthesize_fallback_summary reads task_id/epic_id fresh and routes to synthesize_task_fallback_fields or synthesize_authoring_fallback_fields) rather than two separate public functions — every terminal-path caller still calls ONE function"

key-files:
  created:
    - packages/core/src/db/migrations/0013_authoring_summaries.sql
    - packages/core/src/db/migrations/0014_permission_requests_authoring.sql
    - packages/core/tests/authoring_lifecycle.rs
  modified:
    - packages/core/src/db/mod.rs
    - packages/core/src/domain/agent_run.rs
    - packages/core/src/domain/permission_request.rs
    - packages/core/src/domain/session_summary.rs
    - packages/core/src/epic_context_packet.rs
    - packages/core/src/query/permissions.rs
    - packages/core/src/query/recovery.rs
    - packages/core/tests/discard_lifecycle.rs
    - packages/core/tests/permission_gate.rs
    - packages/core/tests/spawn_stagger.rs
    - packages/desktop/src-tauri/src/commands/agent_run.rs
    - packages/desktop/src/App.tsx
    - packages/desktop/src/board/useBoardQuery.ts
    - packages/desktop/src/projects/__tests__/project-rail.test.tsx
    - packages/desktop/src/session/SessionSurface.tsx
    - packages/desktop/src/session/__tests__/session-surface.test.tsx
    - packages/desktop/src/state/uiStore.ts
    - packages/sidecar/src/mcp-permission-server.ts

key-decisions:
  - "Migration numbered 0013, not 0012 — plan 05-04 (which ran before this one in wave order but was written concurrently) already claimed 0012 for idx_authoring_proposals_project_status_index. Picked the next free number (0013) and a second one (0014, for permission_requests) rather than renumbering an already-shipped migration."
  - "permission_requests.task_id was made nullable too (migration 0014), though the plan's own <files> list never named this file or this migration. Discovered mid-Task-3: create_pending_request read agent_runs.task_id as a non-optional String, so an authoring run genuinely blocked on a permission request (the exact scenario Task 3(b)'s acceptance criterion requires) could not be constructed at all — not a read-time gap but an INSERT-time schema violation. Fixed as Rule 2/3 (missing critical functionality / blocking issue), following the identical rebuild pattern already used twice in this plan."
  - "synthesize_fallback_summary stays ONE function with an internal subject dispatch (synthesize_task_fallback_fields / synthesize_authoring_fallback_fields), rather than a second public entry point — every one of its four callers (apply_session_closed, stop_agent_run_in_tx, mark_abandoned x2) needed no signature change."
  - "The Discard hand-off's uiStore channel is a single launchSheetAuthoringHandoff: { epicId: string | null } | null field, not a bare string | null — a fresh-epic authoring run's own epic id genuinely IS null, so a bare field could not distinguish 'no hand-off pending' from 'hand-off pending for a new epic.'"
  - "The authoring spawn floor (D-52, Task 3c) needed NO fix at all: authoring_run_start (plan 05-02) already calls the same gated send_spawn_request the task-run path uses, sharing the one SpawnFloor instance. Task 3(c) is coverage, not a fix — see Deviations for the one plan verify gate this makes stale."

patterns-established:
  - "A subject-generic fallback synthesiser (session_summary.rs's synthesize_fallback_summary) as the template for any future third run kind: read the subject fresh inside the transaction, dispatch to a kind-specific field-builder, funnel through the one shared insert_summary_row."

requirements-completed: []

coverage:
  - id: D1
    description: "session_summaries generalised (nullable task_id, new epic_id, never-both CHECK); create_summary resolves an authoring run's epic_id and leaves task_id NULL; a fallback summary synthesised from staged-proposal counts and the stage reached for a run with no diff; epic_context_packet.rs's prior_authoring_runs reads the summary back"
    requirement: SHAPE-01
    verification:
      - kind: integration
        ref: "packages/core/tests/authoring_lifecycle.rs (12 tests covering the schema CHECK, subject resolution for both a reopened and a fresh epic, the fallback's stage/count text, and the packet read-back)"
        status: pass
      - kind: integration
        ref: "cargo test --workspace (0 failures)"
        status: pass
    human_judgment: false
  - id: D2
    description: "Every terminal path (Stop/Discard's committing unit, mark_abandoned, natural close via apply_session_closed) leaves an authoring run with a summary and its staged proposals untouched; mark_abandoned closes the STATE.md gap for both run kinds"
    requirement: SHAPE-05
    verification:
      - kind: integration
        ref: "packages/core/tests/authoring_lifecycle.rs (stopping/mark_abandoned/no-terminal-without-a-summary tests)"
        status: pass
      - kind: integration
        ref: "cargo test -p core --test stop_lifecycle, --test discard_lifecycle, --test launch_reconciliation, --test termination_atomicity_call_site (all pre-existing, all unregressed)"
        status: pass
    human_judgment: false
  - id: D3
    description: "Cost/tokens are written for an authoring run exactly as for a task run; a pending proposal never joins the blocked/recovery rail rollups; a permission-blocked authoring run does; the spawn floor already covers authoring spawns"
    requirement: SHAPE-01
    verification:
      - kind: integration
        ref: "packages/core/tests/authoring_lifecycle.rs (cost-columns, pending-proposal-unaffected, permission-blocked-authoring-run tests); packages/core/tests/spawn_stagger.rs (two new authoring-spawn timing tests plus a structural no-bypass gate over commands/authoring.rs)"
        status: pass
      - kind: unit
        ref: "packages/desktop/src/projects/__tests__/project-rail.test.tsx (source-scanning no-proposal-badge test)"
        status: pass
      - kind: integration
        ref: "cargo test --workspace; npm --prefix packages/desktop run test (494/494); npm --prefix packages/sidecar test (140/140)"
        status: pass
    human_judgment: false
  - id: D4
    description: "SessionSurface.tsx's Stop gloss and Discard hand-off distinguish an authoring run from a task run, never mentioning a worktree for the former"
    requirement: SHAPE-05
    verification:
      - kind: unit
        ref: "packages/desktop/src/session/__tests__/session-surface.test.tsx (3 new tests: epic-id hand-off for a reopened and a fresh epic, and the authoring Stop gloss)"
        status: pass
      - kind: integration
        ref: "npm --prefix packages/desktop run test (494/494)"
        status: pass
    human_judgment: false

duration: ~170min
completed: 2026-09-24
status: complete
---

# Phase 5 Plan 09: Supervision, Completed — Every Terminal Path Now Covers a Conversation Too Summary

**Every mechanism Phase 3 built for a task run — the terminal-status write, the fallback summary, Stop/Discard, `mark_abandoned`, cost tracking, the blocked-count rail signal, the per-repository spawn floor — is now genuinely generic across an authoring run, closing a real INSERT-time schema gap (`permission_requests.task_id`) the plan itself did not anticipate along the way.**

## Performance

- **Duration:** ~170 min
- **Completed:** 2026-09-24
- **Tasks:** 3
- **Files created:** 3
- **Files modified:** 18

## Accomplishments

- **Task 1 — the summary's subject, generalised.** Migration `0013_authoring_summaries.sql` rebuilds `session_summaries` with the exact same shape D-84 already gave `agent_runs`: `task_id` loses `NOT NULL`, a nullable `epic_id` is added, a table-level CHECK forbids both, and a new `idx_session_summaries_epic_created` index backs `epic_context_packet.rs`'s own read. `session_summary.rs`'s `insert_summary_row` now resolves `task_id`/`epic_id` as a pair of `Option<String>` from the `agent_runs` row instead of a non-optional `task_id` alone — the exact change that makes an authoring session's summary representable at all. `synthesize_fallback_summary` stays one function with an internal dispatch: a task run gets the unchanged plan-04-02 event-derived synthesis, an authoring run gets a new board-derived one (the stage reached, staged-proposal counts by target type, how many were decided, and the epic it was shaping or "a new epic"). `epic_context_packet.rs`'s `prior_authoring_runs` now LEFT JOINs `session_summaries` via `agent_runs.exit_summary_id`, so a reopened epic's priming prompt can quote the prior session's own closing summary. `mcp-permission-server.ts`'s `summaryToolDefinition` no longer requires `changed_files` — a shaping session's closing call has nothing to put there.
- **Task 2 — Stop, Discard, and the gap Phase 4 left open.** `interrupt_agent_run_in_tx` and `close_agent_run_in_tx` both previously read `agent_runs.task_id` as a non-optional `String`, which meant Stop (and natural close) would hard-error for any authoring run reaching that code path — not a display bug, a rusqlite type-conversion failure. Both are now `Option`-aware, with `interrupt_agent_run_in_tx`'s own event label naming the epic ("Stopped an epic-authoring session on FLY-3") instead of a task key when there is none. `mark_abandoned` now writes a fallback summary inside its own transaction — for BOTH run kinds — closing the exact `STATE.md` warning D-84 handed this plan: Phase 4's reasoning for excluding it (a run nobody watched die may have nothing worth summarising) does not survive an authoring run, whose fallback is synthesised from board facts that exist regardless of whether anyone was watching. `SessionSurface.tsx`'s Stop gloss is now subject-aware ("Every staged proposal is still waiting on the board" vs. the task run's "The worktree was left exactly as the agent left it"), and Discard's hand-off carries the epic id (or `null`, for a fresh epic) through a new `uiStore` channel (`launchSheetAuthoringHandoff`) mirroring the task case's `launchSheetTaskId` exactly.
- **Task 3 — three readings, written down, plus one gap the plan itself didn't anticipate.** Cost/token attribution needed no fix (already written generically by `close_agent_run_in_tx`/`apply_session_closed`). The needs-you count needed no fix either — `query::recovery.rs` never reads `authoring_proposals` at all, so a pending proposal already cannot join it; its doc comment now states that as a decision rather than an accident, naming the triage lane as where the broader question is answered. What DID need work, and was not named in the plan's own action text: `domain::permission_request::create_pending_request` read `agent_runs.task_id` as a non-optional `String` too — an authoring run genuinely blocked on a permission request (Task 3(b)'s own acceptance criterion) could not be INSERTed at all, since `permission_requests.task_id` itself was `NOT NULL` in the schema. Migration `0014_permission_requests_authoring.sql` gives it the same nullable-task_id/nullable-epic_id/never-both-CHECK shape, `create_pending_request`/`answer_request`/`commands::agent_run::process_inbound_permission_request` are all now `Option`-aware, and `query::permissions::blocked_count_for_project` widens (via a `UNION` keyed on `COALESCE(epic_id, id)` for the task-less case) to count a blocked authoring run alongside blocked tasks. The spawn floor needed no fix at all: `authoring_run_start` (plan 05-02) already calls the identically-gated `send_spawn_request`, so two authoring spawns against the same repository were already staggered by construction — Task 3(c) added coverage tests, not a fix.

## Task Commits

Implemented as one continuous pass and committed together — see "Deviations from Plan" below for why an atomic per-task split was not achievable without leaving a non-building or non-passing intermediate state.

1. **Tasks 1–3 combined: summary generalisation, Stop/Discard/mark_abandoned, and the three Task 3 readings** — `ff8e3ea` (feat)

**Plan metadata:** see below.

## Files Created/Modified

- `packages/core/src/db/migrations/0013_authoring_summaries.sql` — the `session_summaries` rebuild
- `packages/core/src/db/migrations/0014_permission_requests_authoring.sql` — the `permission_requests` rebuild (deviation)
- `packages/core/tests/authoring_lifecycle.rs` — 12 tests covering all three tasks
- `packages/core/src/db/mod.rs` — both migrations registered
- `packages/core/src/domain/agent_run.rs` — `close_agent_run_in_tx`/`interrupt_agent_run_in_tx`/`mark_abandoned` generalised
- `packages/core/src/domain/permission_request.rs` — `create_pending_request`/`answer_request` generalised (deviation)
- `packages/core/src/domain/session_summary.rs` — the full subject generalisation and the new authoring fallback synthesiser
- `packages/core/src/epic_context_packet.rs` — `prior_authoring_runs` reads the summary back
- `packages/core/src/query/permissions.rs` — `blocked_count_for_project` widened (deviation)
- `packages/core/src/query/recovery.rs` — doc comment states the money-burning distinction
- `packages/core/tests/discard_lifecycle.rs` — a stale comment corrected (deviation)
- `packages/core/tests/permission_gate.rs` — a gate's own literal narrowed to avoid a false positive against the new rebuild (deviation)
- `packages/core/tests/spawn_stagger.rs` — extended with the authoring-spawn structural gate and timing tests
- `packages/desktop/src-tauri/src/commands/agent_run.rs` — `process_inbound_permission_request` generalised (deviation)
- `packages/desktop/src/App.tsx` — threads `activeAgentRunEpicId`
- `packages/desktop/src/board/useBoardQuery.ts` — `startAuthoringSessionForProject` threads `run.epicId`
- `packages/desktop/src/projects/__tests__/project-rail.test.tsx` — the no-proposal-badge gate
- `packages/desktop/src/session/SessionSurface.tsx` — subject-aware Stop gloss and Discard hand-off
- `packages/desktop/src/session/__tests__/session-surface.test.tsx` — 3 new tests
- `packages/desktop/src/state/uiStore.ts` — `activeAgentRunEpicId`, `launchSheetAuthoringHandoff`
- `packages/sidecar/src/mcp-permission-server.ts` — `changed_files` no longer required

## Decisions Made

See `key-decisions` in frontmatter.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 2/3 - Missing critical / blocking] `permission_requests.task_id` needed the same nullable-subject rebuild as `agent_runs`/`session_summaries` — a new migration (0014) and generalised `permission_request.rs`, neither named in the plan's own `<files>` list**
- **Found during:** Task 3, implementing the "a permission-blocked authoring run appears in the blocked count" acceptance criterion
- **Issue:** `domain::permission_request::create_pending_request` read `agent_runs.task_id` as a non-optional `String` and would fail the whole query for any authoring run — but even fixing that read, the subsequent `INSERT INTO permission_requests` would still fail: that table's own `task_id` column was `NOT NULL REFERENCES tasks(id)`, a genuine schema-level block, not a Rust-side reading gap. Without this fix, an authoring run reaching a real (non-pre-approved) permission gate — plausible under D-86's read-only posture, still wrapped by the destructive gate — could never actually raise a `permission_requests` row at all, and `commands::agent_run::process_inbound_permission_request`'s own identical non-optional read meant the production inbound-relay path would silently misclassify every such request as `UnknownRun`.
- **Fix:** Migration `0014_permission_requests_authoring.sql` (the same `<name>_new`/rebuild sequence used twice already in this plan); `PermissionRequest.task_id: Option<String>` plus a new `epic_id`; `create_pending_request`/`answer_request` (`permission_request.rs`) and `process_inbound_permission_request` (`commands/agent_run.rs`) all read/write the pair as `Option`s.
- **Files modified:** `packages/core/src/db/migrations/0014_permission_requests_authoring.sql`, `packages/core/src/db/mod.rs`, `packages/core/src/domain/permission_request.rs`, `packages/desktop/src-tauri/src/commands/agent_run.rs`
- **Verification:** `cargo test -p core --test authoring_lifecycle` (`a_permission_blocked_authoring_run_does_appear_in_the_blocked_count`), `cargo test --workspace` (0 failures)
- **Committed in:** `ff8e3ea`

**2. [Rule 1 - Bug] `query::permissions::blocked_count_for_project` needed widening — it could never have counted a blocked authoring run even after fix 1 landed**
- **Found during:** Task 3, same acceptance criterion as above
- **Issue:** `BLOCKED_COUNT_SQL`'s "most recent run" correlation was keyed on `task_id`, self-joined as `WHERE task_id = ar.task_id` — for an authoring run (`task_id IS NULL`), `NULL = NULL` is never true in SQL, so the correlated `MAX(started_at)` subquery returns `NULL` and the row is excluded regardless of status.
- **Fix:** Widened `BLOCKED_COUNT_SQL` to a `UNION` of the original task-keyed arm and a new arm for `task_id IS NULL` rows, correlated on `COALESCE(epic_id, id)` (an epic-scoped run keys on its epic; a fresh-epic run, with no natural sibling, keys on its own id, which trivially satisfies the self-comparison). `blocked_task_ids_for_project` (the board's task-ROW indicator) is deliberately left unchanged — an authoring run has no task row to mark.
- **Files modified:** `packages/core/src/query/permissions.rs`
- **Verification:** `cargo test -p core --test authoring_lifecycle`
- **Committed in:** `ff8e3ea`

**3. [Rule 1 - Bug] A pre-existing test's own literal-substring gate false-positived against the new `permission_requests` rebuild**
- **Found during:** running `cargo test --workspace` after landing migration 0014
- **Issue:** `permission_gate.rs`'s `migration_source_list_registers_the_permission_gate_tables_exactly_once` asserted `.contains("CREATE TABLE permission_requests")` occurs exactly once across all migration sources — but `0014`'s rebuild creates a transient `permission_requests_new` table, and `"permission_requests_new"` starts with the substring `"permission_requests"`, so the count read `2`.
- **Fix:** Narrowed the literal to `"CREATE TABLE permission_requests ("` (the trailing space-then-paren, matching this codebase's own formatting) — the transient `_new` table's line never matches this narrower literal, while the real property under test (the BASE table is created by exactly one migration) still holds and is still checked.
- **Files modified:** `packages/core/tests/permission_gate.rs`
- **Verification:** `cargo test -p core --test permission_gate` (12/12)
- **Committed in:** `ff8e3ea`

**4. [Rule 1 - Bug] `mark_abandoned`'s callers (`close_agent_run_in_tx`/`interrupt_agent_run_in_tx`) both read `agent_runs.task_id` as a non-optional `String` before any authoring-specific work in this plan even began**
- **Found during:** Task 2, before writing any test — reading the existing functions in preparation for the Stop/mark_abandoned generalisation the plan's own action text describes
- **Issue:** Neither function had been updated when migration `0010_authoring_runs.sql` (plan 05-02) made `agent_runs.task_id` nullable — both still destructured a `(String, ...)` tuple from a query whose second column could now be `NULL`, which rusqlite reports as a column-conversion error, not a graceful `None`. An authoring run reaching either path (Stop, or a natural close) would error outright.
- **Fix:** Both now read `task_id`/`epic_id` as `Option<String>`, generalising the event label and `append_event` call accordingly (see Accomplishments above).
- **Files modified:** `packages/core/src/domain/agent_run.rs`
- **Verification:** `cargo test -p core --test authoring_lifecycle`, `cargo test -p core --test stop_lifecycle`, `cargo test -p core --test discard_lifecycle`, `cargo test --workspace`
- **Committed in:** `ff8e3ea`

---

**Total deviations:** 4 auto-fixed (1 Rule 2/3 — a missing-critical-plus-blocking schema gap the plan's own acceptance criterion required but its `<files>` list omitted, 2 Rule 1 — bugs directly exposed by generalising the schema the plan's own action text describes, 1 Rule 1 — a pre-existing test gate's own narrower-than-intended literal). **Impact:** All four are necessary consequences of implementing the plan's own must_haves as written (particularly "an authoring run blocked on a permission request... already joins the blocked count"), not scope creep — none touch product behaviour beyond what the plan specifies, though the blast radius (a second schema rebuild, a fourth table generalised) is larger than the plan's own `<files>` list anticipated.

### Process deviation: one commit for all three tasks, not three per-task commits

The `<task_commit_protocol>` calls for one commit per task. This plan's three tasks all extend the SAME cascading generalisation (`agent_runs.task_id`/`epic_id` → `session_summaries` → `permission_requests`, discovered progressively as each task's own acceptance criteria were implemented) across the SAME small set of files (`agent_run.rs` alone carries Task 1's close-path fix, Task 2's interrupt/mark_abandoned fixes, and is read by Task 3's tests). A mechanical per-task split would have required either committing a state where `cargo test --workspace` fails (Task 1's commit alone, with `agent_run.rs`'s Stop-path fix not yet landed, so the natural-close half of "no terminal status without a summary" holds but the Stop half does not — itself a Task 2 concern) or staging individual hunks within a single file across artificial task boundaries, at real risk of a regression for no genuine bisection benefit (none of the three tasks is independently meaningful to roll back — the plan's own objective is "make the supervision inheritance complete," delivered as one coherent closure). All three tasks are delivered together in commit `ff8e3ea`, fully built and tested as a whole. Recorded here per this phase's own established precedent (`05-05-SUMMARY.md`, `05-06-SUMMARY.md`'s identical "Process deviation" notes).

### Known limitation: one plan `<verify>` gate is now permanently stale, by design

Task 3's own `<verify>` includes `test "$(grep -v '^[[:space:]]*//' packages/desktop/src-tauri/src/sidecar.rs | grep -c 'wait_turn')" = "2"`, with the plan's own note "It reads 1 at HEAD, so this gate is genuinely red until the authoring call lands." Investigation found the premise was already false at HEAD: `commands::authoring::authoring_run_start` (plan 05-02, `packages/desktop/src-tauri/src/commands/authoring.rs:152`) already calls `sidecar.send_spawn_request(&repo_path, ...)` — the SAME public method `commands::agent_run::agent_run_start` calls, which itself calls `SpawnFloor::wait_turn` exactly ONCE, inside its own body (`sidecar.rs:279`). Because both spawn paths share this ONE call site rather than each carrying their own literal `wait_turn(...)` call, the comment-stripped count in `sidecar.rs` is `1` both before AND after this plan's own changes — it can only ever become `2` by literally duplicating the call site into `commands/authoring.rs` directly (bypassing `send_spawn_request`), which is a strictly WORSE design than the one already shipped: it would violate this plan's own "no second constant" instruction's spirit (a second call site to keep in sync with the first) for no behavioural gain, since the underlying guarantee (two authoring spawns against the same repository are staggered) already holds by construction. Left as designed; the gate's own premise, not the implementation, is what changed. Covered instead by two new behavioural tests (`spawn_stagger.rs`'s `two_authoring_spawns_against_the_same_repository_are_staggered_by_at_least_the_floor` / `...different_repositories_are_not_staggered`) and a structural no-bypass gate mirroring the existing `agent_run.rs` one, scoped to `commands/authoring.rs`.

## Issues Encountered

None beyond the deviations above.

## User Setup Required

None — no external service configuration required.

## Next Phase Readiness

- Every Phase 3 supervision mechanism (terminal-status write, fallback summary, Stop/Discard, `mark_abandoned`, cost tracking, the blocked-count rail signal, the per-repository spawn floor) now genuinely covers an authoring run — the phase's own `STATE.md` warning about `mark_abandoned` is closed, not deferred a second time.
- `SHAPE-01`/`SHAPE-05` are this plan's own declared requirements but are NOT yet marked complete: the shared-ID gate (`requirements.ready-ids`) reports `0/2 requirement(s) ready to mark complete` — both are also declared by plan `05-10` (still in progress, per `05-CONTEXT.md`'s discretion items: the reopened-epic launch UI and the keyboard map). They will flip to `Complete` automatically once every plan declaring them has a `*-SUMMARY.md`.
- The authoring hand-off channel (`launchSheetAuthoringHandoff`) exists and is threaded end to end, but has no UI consumer yet — the reopened-epic launch surface (`05-CONTEXT.md`'s own open Discretion item, "How a session is started when no epic exists yet... and whether D-27's launch sheet applies") remains a later plan's concern, most likely `05-10`'s.
- Plans `05-07`/`05-08`/`05-10` are independent of this plan in the dependency graph (this plan depends only on `05-05`) and can proceed without further changes here.

---
*Phase: 05-socratic-epic-authoring*
*Completed: 2026-09-24*

## Self-Check: PASSED

- All 3 created files found on disk (`0013_authoring_summaries.sql`, `0014_permission_requests_authoring.sql`, `authoring_lifecycle.rs`).
- The one commit hash (`ff8e3ea`) found in git history.
- `cargo build --workspace` succeeds (only the one pre-existing, unrelated `StartRunOutcome` dead-code warning).
- `cargo test --workspace` — 0 failures across every crate, including `authoring_lifecycle` 12/12, `spawn_stagger` (extended), `permission_gate` 12/12, `discard_lifecycle`, `stop_lifecycle`, `launch_reconciliation`, `termination_atomicity_call_site`, `recovery_summary`, `session_summary_lifecycle`, `migration_safety` all unregressed.
- `npm --prefix packages/desktop run build` succeeds; `npm --prefix packages/desktop run test` — 494/494 pass, including `session-surface.test.tsx` 45/45 and `project-rail.test.tsx` 6/6.
- `npm --prefix packages/sidecar run build` succeeds; `npm --prefix packages/sidecar test` — 140/140 pass.
- Named grep gates: exactly one `INSERT INTO session_summaries` in `packages/core/src`, zero `UPDATE`/`DELETE` against it, migration `0013` registered exactly once, `SPAWN_FLOOR_MS` declared and applied (4 occurrences) — all return their expected values. The one gate that does NOT return its plan-specified value (`sidecar.rs`'s `wait_turn` count) is documented above as a stale premise in the plan's own `<verify>`, not a defect in the implementation.
