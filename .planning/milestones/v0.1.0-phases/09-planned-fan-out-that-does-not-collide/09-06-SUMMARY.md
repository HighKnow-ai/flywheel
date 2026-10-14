---
phase: 09-planned-fan-out-that-does-not-collide
plan: 06
subsystem: scope-widen-and-visibility
tags: [file-set, widen, scope-hook, in-flight-recheck, feed-row, board-badge, legend, rusqlite, tauri, react]

requires:
  - phase: 09-planned-fan-out-that-does-not-collide
    provides: "09-02: task.scope_denied rows, scope_denied_counts, the scope_denied agent event; 09-03: file_set::collisions and dispatch::in_flight_declared_sets; 09-01: parse_entry, arm_scope_marker, write_scope_marker, task_file_set_set"
provides:
  - "domain::file_set::widen_file_set: live widen, in-flight collision re-check and insert in one IMMEDIATE transaction, marker rewrite after the commit"
  - "WidenOutcome / WidenRefusal: Accepted, Refused(InvalidEntry | Collision), MarkerNotRewritten"
  - "task.file_set_widened event (EVENT_FILE_SET_WIDENED), same before/after payload idiom as the declare event"
  - "Human-only task_file_set_widen command and read-only board_scope_flags command, registered and in the audited roster"
  - "scope_denied feed row kind with a widen action; per-task scope-refusal badge; scope-denied legend mark"
affects: [09-07 dispatcher, 09-08 widen edges, 09-09 UI]

plan_head_before: 561f7f78e25d2916a53c8e033ea11b538cae7557

actuals:
  tokens: 21000
  tasks: 3
  commits: 6

tech-stack:
  added: []
  patterns:
    - "Re-check and write in one IMMEDIATE transaction: the write lock is held before the re-check reads, so two widens cannot both pass"
    - "Enforcement file rewritten only after the commit, and a failure there is a distinct outcome, not an error and not a success"
    - "An unchanged widen still rewrites the marker, so a retry repairs a MarkerNotRewritten outcome"
    - "The renderer displays a verdict from a DTO; it computes none"

key-files:
  created:
    - packages/core/tests/scope_widen.rs
    - packages/desktop/src/board/__tests__/scope-badge.test.tsx
  modified:
    - packages/core/src/domain/file_set.rs
    - packages/desktop/src-tauri/src/commands/file_set.rs
    - packages/desktop/src-tauri/src/main.rs
    - packages/desktop/src-tauri/capabilities/default.json
    - packages/desktop/src/adapters/tauri.ts
    - packages/desktop/src/session/FeedRow.tsx
    - packages/desktop/src/session/SessionSurface.tsx
    - packages/desktop/src/session/__tests__/feed-row.test.tsx
    - packages/desktop/src/board/BoardRow.tsx
    - packages/desktop/src/board/BoardView.tsx
    - packages/desktop/src/board/useBoardQuery.ts
    - packages/desktop/src/legend/marks.ts
    - packages/desktop/src/legend/__tests__/legend.test.tsx

key-decisions:
  - "The in-flight re-check calls dispatch::in_flight_declared_sets and file_set::collisions; no second overlap implementation exists. The source gate counts exactly one call site in domain/file_set.rs"
  - "A widen refusal names the colliding entry of the other task and that task's key only, never its whole set (T-09-06-04)"
  - "A task's own set is excluded from its own re-check; a not-running task's set never constrains a widen"
  - "The marker rewrite reuses arm_scope_marker over the stored rows, for every live run of the task, so there is one marker writer"
  - "An outside-the-worktree denial in the feed is worded differently and offers no widen: an absolute path is not a declarable entry"
  - "Widen outcome in the feed row is component state (ponytail comment): a row scrolled out of the virtualised window reads as un-widened again; widening twice is a no-op"
  - "Adding the scope-denied mark changed the legend registry pins to 17 agent marks and 53 in total; those pins are meant to change with a mark"

patterns-established:
  - "scope_denied FeedRowData member: its own row kind, never merged into the system notice or the raw row"

requirements-completed: [PLAN-05]

coverage:
  - id: D1
    description: "A declared file-set can be widened live and the widened entry is allowed by the shipped hook on the very next call, with no restart"
    requirement: PLAN-05
    verification:
      - kind: integration
        ref: "packages/core/tests/scope_widen.rs#the_widened_path_is_allowed_by_the_shipped_hook_on_the_very_next_call"
        status: pass
      - kind: integration
        ref: "packages/core/tests/scope_widen.rs#an_accepted_widen_adds_a_row_one_event_and_rewrites_the_marker"
        status: pass
    human_judgment: false
  - id: D2
    description: "A widen colliding with any in-flight task's declared set (same plan or none) is refused naming the colliding path and the other task, and leaves rows, events and marker bytes unchanged"
    requirement: PLAN-05
    verification:
      - kind: integration
        ref: "packages/core/tests/scope_widen.rs (same-plan, plan-less, not-running, rollback, sequential-race cases)"
        status: pass
    human_judgment: false
  - id: D3
    description: "A committed widen whose marker cannot be rewritten is reported as such, never swallowed, and a retry repairs it"
    requirement: PLAN-05
    verification:
      - kind: integration
        ref: "packages/core/tests/scope_widen.rs#a_committed_widen_whose_marker_cannot_be_rewritten_is_reported_not_swallowed"
        status: pass
    human_judgment: false
  - id: D4
    description: "The widen command is human-only: no actor, marker path or worktree argument, actor resolved server-side, and no sidecar source names a widen tool"
    requirement: PLAN-05
    verification:
      - kind: unit
        ref: "packages/desktop/src-tauri/src/commands/file_set.rs#the_widen_handler_accepts_no_actor_and_no_path_argument"
        status: pass
      - kind: integration
        ref: "packages/core/tests/scope_widen.rs#no_sidecar_source_exposes_a_widen_tool"
        status: pass
    human_judgment: false
  - id: D5
    description: "A scope refusal appears in the live feed as its own row with the refused path and a one-click widen that is single-flight, shows the command's refusal text, and stays in place after an accepted widen"
    requirement: PLAN-05
    verification:
      - kind: unit
        ref: "packages/desktop/src/session/__tests__/feed-row.test.tsx (FeedRow scope_denied, 7 cases)"
        status: pass
    human_judgment: false
  - id: D6
    description: "A task with refusals shows a count badge on the board; a task with none shows no badge; one aggregate read serves the board; the mark is in the legend"
    requirement: PLAN-05
    verification:
      - kind: unit
        ref: "packages/desktop/src/board/__tests__/scope-badge.test.tsx (10 cases)"
        status: pass
      - kind: integration
        ref: "packages/core/tests/perf_seed_1000.rs (3 tests)"
        status: pass
    human_judgment: true
    rationale: "That the badge and the feed row read well at a glance in the real WKWebView was not observed; the tests assert presence, value, accessible name and call counts, not appearance. Queued per the deferred-review rule."
---

# Phase 9 Plan 06: Live Widen With an In-Flight Re-Check, the Feed Row and the Board Badge Summary

**A declared file-set widens live from the scope event: the collision re-check against every in-flight set and the write share one `IMMEDIATE` transaction, the marker is rewritten only after the commit so the very next hook call sees it, and a refusal shows in the feed and as a per-task count badge.**

## What the guarantee is, and what it is not

- **The re-check is the load-bearing half.** `widen_file_set` reads `dispatch::in_flight_declared_sets` and runs `file_set::collisions` against every other in-flight task's declared set inside the write transaction. The transaction is opened `IMMEDIATE`, so the write lock is held before the re-check reads. Two widens cannot both pass. Tested sequentially (the second is refused); a true concurrent race was not run, since the app holds one database connection behind a mutex and the lock is what makes the sequential result also the concurrent one.
- **An undeclared manual launch has no declared set, so it cannot be checked against.** `in_flight_declared_sets` omits a live task with no entries (D-150). A widen can therefore grow into files such a run is touching, and the merge-conflict path is the only remaining guard. Declared sets only constrain declared sets.
- **Only in-flight sets constrain a widen.** A task whose run is not `running` or `blocked` does not block one; its files may be widened into, and the merge path owns that.
- **Prevention, then detection.** The widen takes effect on the next file-tool call because the hook reads the marker fresh. `Bash` writes are still caught only by the plan 09-02 close-time backstop.
- **Not observed:** the feed row and the badge in the real WKWebView, and a live widen against a running `claude` session. The shipped hook was driven against the rewritten marker; the live-agent arm was not run.

## Accomplishments

- `widen_file_set(conn, task_id, raw_entry, actor_id)`: `parse_entry` first (the same named cause the declare path gives), then in one `IMMEDIATE` transaction the in-flight re-check, the row insert and the `task.file_set_widened` event, then after the commit `arm_scope_marker` for each live run of the task.
- A refusal returns `Refused(Collision { entry, colliding_path, other_task_id, other_task_key })` and has written nothing: rows, events and marker bytes are identical to before the call.
- `MarkerNotRewritten { entries, error }` is a third outcome naming that the database is wider and the hook does not yet agree. An unchanged widen skips the write but still rewrites the marker, so retrying repairs it.
- `task_file_set_widen(task_id, entry)`: human-only, no actor or path argument, caps the entry at 1024 characters, returns a `WidenResultDto` (`accepted` | `refused` | `marker_not_rewritten`) with ready-to-show refusal text. A refusal is a result, not an IPC error.
- `board_scope_flags(project_id)`: read-only, delegates to `scope_denied_counts` with the window capped at 1000 server-side.
- `FeedRow.tsx`: a `scope_denied` row kind, built by `SessionSurface.buildFeedRows` from the logged `scope_denied` event. The widen routes through `adapters/tauri.ts`, with a synchronous in-flight ref guard, the command's refusal text, and a `data-widened` mark that leaves the row in place.
- `BoardRow.tsx`: a count badge with `role="img"` and an accessible name ("3 scope refusals"); the row's own accessible name gains the count. Absent at zero. Fed by `useScopeFlags`, one project-wide query invalidated on `board:changed`, no polling.
- Legend: a `scope-denied` mark (glyph `ShieldBan`) in the agent channel.

## Task Commits

1. **Task 1 RED:** `1c3e63a` (test) - ten failing cases against an inert stub
2. **Task 1 GREEN:** `a9a4e9a` (feat) - widen, the two commands, the roster entries
3. **Task 2 RED:** `a48951d` (test) - seven failing feed-row cases
4. **Task 2 GREEN:** `0bef328` (feat)
5. **Task 3 RED:** `7fbbb53` (test) - eight of ten badge cases failing
6. **Task 3 GREEN:** `3ed5f53` (feat)

**Plan metadata:** the `docs(09-06)` commit following this file.

## Deviations from Plan

### Auto-fixed Issues

**1. [Process] `board_scope_flags` landed in the Task 1 commit, not Task 3's**
- **Found during:** Task 1
- **Issue:** the plan places the read command in Task 3. It shares `commands/file_set.rs`, `main.rs` and the roster string with the widen command, so both were written together.
- **Fix:** committed with Task 1 (`a9a4e9a`). Task 3's commit holds the renderer half. Both commands have their own handler-signature tests.
- **Files modified:** `packages/desktop/src-tauri/src/commands/file_set.rs`, `main.rs`, `capabilities/default.json`

**2. [Rule 2 - Missing critical] A retry after a partial widen would have been a silent no-op**
- **Found during:** Task 1
- **Issue:** an unchanged widen returned early without touching the marker, so the retry the `MarkerNotRewritten` outcome invites could never repair the marker.
- **Fix:** the early path skips only the database write; the marker is rewritten on every call that commits or finds the entry present.
- **Files modified:** `packages/core/src/domain/file_set.rs`

**3. [Rule 2 - Missing critical] T-09-06-02 source gate**
- **Found during:** Task 1
- **Issue:** the threat model requires a gate asserting no widen tool exists on the MCP server; the plan named no test for it.
- **Fix:** `no_sidecar_source_exposes_a_widen_tool` reads every `packages/sidecar/src/*.ts` file and fails if one names the widen.
- **Files modified:** `packages/core/tests/scope_widen.rs`

**4. [Rule 3 - Blocking] Legend registry pins**
- **Issue:** the legend tests pin exact counts (16 agent marks, 52 total, an explicit expected list). Registering the new mark, which the plan requires, breaks them by design.
- **Fix:** updated to 17 and 53 and added the new id to the expected list, in the same commit as the mark.
- **Files modified:** `packages/desktop/src/legend/__tests__/legend.test.tsx`

**5. [Process] `BoardView.tsx` was edited though absent from the plan's file list**
- It is the one place `useChangeFlags` is distributed to rows, so the scope map had to be passed there. A 6-line addition beside the change-flag map.

**Total deviations:** 5 (2 missing critical, 1 blocking, 2 process). **Impact:** none on scope.

## Authentication Gates

None.

## Issues Encountered

- The full `packages/core` suite was not run (over 30 minutes here, keychain prompts in `credentials`, as in 09-01 to 09-03). Run: `scope_widen` (11), `scope_events` (15), `scope_marker_contract` (22), `dispatch_plan` (28), `perf_seed_1000` (3), `cargo build --workspace`, the desktop crate's `commands::file_set` tests (15), the entire desktop vitest suite (72 files, 1252 tests), `tsc --noEmit` and `npm run build`.
- `cargo build --workspace` reports the one pre-existing `desktop` dead-code warning (`StartRunOutcome`); none from this plan.
- The feed row shows only hook denials, because only those travel as `scope_denied` agent events in the session log. Close-time backstop rows (`detected_after_the_fact`) are database rows with no feed event, so they reach the user only through the badge. The badge counts every `task.scope_denied` row, both kinds, as separate rows. Nothing merges them, and the badge cannot tell the two apart by itself.

## Known Stubs

None.

## Threat Flags

None. The two new commands and the widen path are the plan's own T-09-06-01 to T-09-06-06 surface.

## Next Phase Readiness

- Plan 09-07/09-08 can write `cause = 'widen'` edges through `insert_edge_in_tx`; this plan's widen does not write edges, only rows and an event.
- A deferred human item for the review register: that the feed row and badge read well in the installed WKWebView build. `automatable: NO` (aesthetic judgment on a real window).

## Self-Check: PASSED

Created files present: `packages/core/tests/scope_widen.rs`, `packages/desktop/src/board/__tests__/scope-badge.test.tsx`. Commits `1c3e63a`, `a9a4e9a`, `a48951d`, `0bef328`, `7fbbb53`, `3ed5f53` exist in `git log`, each RED before its GREEN. Verify gates run and pass: in-flight call-site count = 1, `commands::file_set::task_file_set_widen` registration count = 1, `local_human_actor_id` count = 3, `@tauri-apps/api` in `FeedRow.tsx` = 0, `refetchInterval` in `useBoardQuery.ts` = 0, `board_scope_flags` in the roster = 1.
