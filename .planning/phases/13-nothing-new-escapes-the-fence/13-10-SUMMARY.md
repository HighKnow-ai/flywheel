---
phase: 13-nothing-new-escapes-the-fence
plan: 10
subsystem: events
tags: [tauri, react-query, board-changed, source-gate, fnc-07, two-sided-gate]

requires:
  - phase: 13-07
    provides: scheduler deriver trigger points (the ticks this plan re-scopes)
  - phase: 13-04
    provides: handler_roster.rs, the gate house style copied here
provides:
  - commands::emit_board_changed, the only place that names the board:changed event
  - a typed { projectId, entity, id } payload carried through the adapter seam
  - useBoardChangedSubscription routed by projectId, with explicit broadcast for null or malformed payloads
  - board_changed_payload.rs, a two-sided source gate on the emit seam
affects: [phase-14, phase-15, phase-16, phase-17, phase-18]

plan_head_before: 7785386d095fedb8a9bff20b2c7daa4ab35d30fa
actuals:
  tokens: 19000
  tasks: 3
  commits: 3

tech-stack:
  added: []
  patterns:
    - "One emit helper; a caller states its project scope as None (broadcast), Some(..) or a resolved project_id.as_deref()"
    - "Project resolved on the connection the handler already holds (project_of), read BEFORE a delete"
    - "Unroutable event broadcasts; it is never dropped"

key-files:
  created:
    - packages/desktop/src-tauri/tests/board_changed_payload.rs
    - packages/desktop/src/board/__tests__/board-changed-routing.test.tsx
  modified:
    - packages/desktop/src-tauri/src/commands/mod.rs
    - packages/desktop/src-tauri/src/commands/task.rs
    - packages/desktop/src-tauri/src/commands/epic.rs
    - packages/desktop/src-tauri/src/commands/issue.rs
    - packages/desktop/src-tauri/src/commands/criterion.rs
    - packages/desktop/src-tauri/src/commands/agent_run.rs
    - packages/desktop/src-tauri/src/commands/authoring.rs
    - packages/desktop/src-tauri/src/commands/dispatch.rs
    - packages/desktop/src-tauri/src/commands/file_set.rs
    - packages/desktop/src-tauri/src/commands/fleet.rs
    - packages/desktop/src-tauri/src/commands/forge.rs
    - packages/desktop/src-tauri/src/commands/review.rs
    - packages/desktop/src-tauri/src/sidecar.rs
    - packages/desktop/src-tauri/src/scheduler.rs
    - packages/desktop/src/adapters/tauri.ts
    - packages/desktop/src/board/useBoardQuery.ts
    - packages/desktop/src/App.tsx

key-decisions:
  - "The viewed-project branch also invalidates [board, dispatch]: the fan-out keys are keyed by epic, not project, and sat under the bare [board] prefix, so narrowing to [board, projectId] would have silently stopped dispatch plans refreshing."
  - "A scheduler tick still emits at most once. It collects the set of projects it changed; exactly one resolved project scopes the event, anything else broadcasts."
  - "The scope gate accepts None, Some(..) or a .as_deref() argument, plus an arity check, instead of the plan's literal Some(/None substring rule, because handlers pass a resolved Option<String> from project_of."
  - "Batch and fleet-wide emits (acknowledge-many, bulk reject/defer, worktree size and reclaim, the dispatch tick) pass an explicit None."

requirements-completed: [FNC-07]

coverage:
  - id: D1
    description: "board:changed carries a typed { projectId, entity, id } payload built by one helper; a raw emit elsewhere fails the build"
    requirement: FNC-07
    verification:
      - kind: unit
        ref: "packages/desktop/src-tauri/tests/board_changed_payload.rs#only_the_emit_helper_names_the_board_changed_event"
        status: pass
      - kind: unit
        ref: "packages/desktop/src-tauri/tests/board_changed_payload.rs#every_emit_helper_call_passes_an_explicit_project_scope"
        status: pass
      - kind: unit
        ref: "packages/desktop/src-tauri/tests/board_changed_payload.rs#the_emit_gate_fires_on_a_planted_raw_emit"
        status: pass
    human_judgment: false
  - id: D2
    description: "An event in one project does not invalidate another project's views; null, absent and malformed payloads broadcast; same-tick events are not coalesced"
    requirement: FNC-07
    verification:
      - kind: unit
        ref: "packages/desktop/src/board/__tests__/board-changed-routing.test.tsx (8 cases, cross-project spy count is zero)"
        status: pass
    human_judgment: false
  - id: D3
    description: "Every one of 69 former raw emit sites resolves the right project in the running app"
    requirement: FNC-07
    verification:
      - kind: other
        ref: "cargo test -p desktop --bin desktop (149 pass); no test drives each handler against a live AppHandle"
        status: unknown
    human_judgment: true
    rationale: "The helper needs an AppHandle, so the per-site project lookups are checked by the compiler and the source gate, not by a behavioural test. A reviewer should spot-check the lookups."

duration: 20min
completed: 2026-10-15
status: complete
---

# Phase 13 Plan 10: One typed board:changed emit helper, routed by project Summary

**All 69 raw `board:changed` emits in the Tauri crate now go through `commands::emit_board_changed` with a `{ projectId, entity, id }` payload, and the central renderer subscription routes on `projectId` so a change in one project invalidates nothing in another.**

## Performance

- **Duration:** about 20 min of execution (the Gatekeeper first-run scans dominated the wall clock)
- **Completed:** 2026-10-15
- **Tasks:** 3
- **Files modified:** 19 (17 modified, 2 created)

## Accomplishments

- One helper names the event string. `project_of` and `project_of_locked` resolve the project from a row id on the connection a handler already holds, reading before any delete. Nothing else in `src-tauri/src` mentions the literal.
- `subscribeBoardChanged` passes the typed `BoardChangedPayload` through the adapter seam. `@tauri-apps/api/event` is still imported in exactly one module.
- `useBoardChangedSubscription(projectId)` routes: the viewed project invalidates its board, epics and fan-out keys; any other project invalidates nothing (asserted as a spy count of exactly zero); null, absent or malformed payloads broadcast. No timer, debounce or coalescing was added.
- `board_changed_payload.rs` fails the build on a raw emit, on an ambiguous or wrong-arity call, and is proven live by a planted violation. 74 helper call sites today, floor of 70.

## Task Commits

1. **Task 1: typed payload, one helper, one routed reader, proven on the task path** - `68c5d08` (feat)
2. **Task 2: the remaining emitters move onto the helper** - `7987ebf` (feat)
3. **Task 3: both sides of the seam gated, routing edges asserted** - `32e170b` (test)

**Plan metadata:** the `docs(13-10)` commit that carries this file.

## Files Created/Modified

- `commands/mod.rs` - `emit_board_changed`, `project_of`, `project_of_locked`
- `commands/*.rs`, `sidecar.rs`, `scheduler.rs` - every emit site moved onto the helper
- `adapters/tauri.ts` - `BoardChangedPayload` and the typed `subscribeBoardChanged`
- `board/useBoardQuery.ts`, `App.tsx` - routed subscription, called with the viewed project id
- `tests/board_changed_payload.rs`, `board-changed-routing.test.tsx` - the two gates

## Decisions Made

See `key-decisions`. No Tauri command was added, removed or renamed, so `handler_roster.rs` needed no edit and still passes. No code moved between the modules the 13-09 canonical-write gate scans, and `13-AUTHORITY-ALLOWLIST.md` is untouched and still consistent.

### Sites that pass `None` (explicit broadcast), with reasons

| Site | Reason |
|------|--------|
| `agent_run_acknowledge_many` | one batch can name runs from several projects |
| `authoring_proposals_reject_bulk` | a bulk batch can span projects |
| `authoring_proposals_defer_bulk` | a bulk batch can span projects |
| dispatch tick pass in `dispatch.rs` | one pass can act on plans in several projects |
| `fleet.rs` worktree size measure | the fleet inventory spans every project |
| `fleet.rs` worktree reclaim | a reclaim batch can span projects |
| scheduler git-facts, cold and hot tick, forge poll | conditional: scoped when exactly one project changed, `None` when several or when a task's project did not resolve |

Every other site passes a resolved project. `project_of` returns `None` for a row that no longer exists or a poisoned lock; the helper then broadcasts, so a lookup failure over-refreshes rather than losing the event.

### Scheduler

The pre-change `Job::new|cron` count in `scheduler.rs` is 7 and is 7 after. Rate, tiering and the digest map are untouched. Each tick still emits at most once. The forge tick cannot tell which task changed (`apply_forge_results` returns a bool), so its scope is the projects of every task the poll covered, a superset of the change and never a subset.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 1 - Bug] Narrowing to `["board", projectId]` would have stopped dispatch plans refreshing**
- **Found during:** Task 1 (reading `dispatch/queries.ts`)
- **Issue:** `dispatchPlanKey`, `planningRunKey`, `GATE_KEY` and `CAP_KEY` sit at `["board","dispatch",...]` and relied on the bare `["board"]` prefix. `["board", projectId]` does not match them.
- **Fix:** the viewed-project branch also invalidates `["board","dispatch"]`. The routing test pins the exact three keys. This amends the plan's "and no other key" wording.
- **Files modified:** `packages/desktop/src/board/useBoardQuery.ts`, `board-changed-routing.test.tsx`
- **Committed in:** `68c5d08`

**2. [Rule 3 - Blocking] The scope gate could not use the plan's literal `Some(`/`None` rule**
- **Found during:** Task 3
- **Issue:** handlers pass a resolved `Option<String>` as `project_id.as_deref()`, which contains neither literal.
- **Fix:** the gate accepts `None`, `Some(..)` or an argument ending in `.as_deref()`, and also checks the call has four arguments. A bare variable or any other expression is rejected.
- **Committed in:** `32e170b`

**3. [Rule 3 - Blocking] The plan's `-p flywheel-desktop` is wrong**
- The package is `desktop`. Used `cargo test -p desktop --test board_changed_payload`.

**4. Site counts differ from the plan's 72.** There were 69 raw emits in 13 files; `criterion.rs` already had a private wrapper used by six handlers, which was deleted. The helper has 74 call sites.

---

**Total deviations:** 2 auto-fixed (1 bug, 1 blocking), plus 2 corrections of plan facts.
**Impact on plan:** none on scope. Deviation 1 prevented a silent regression.

## Issues Encountered

- A scripted insert for the `epic_delete` and `issue_delete` pre-read matched inside a multi-line `let actor_id =` statement and produced broken code. Found at the diff, fixed before compiling.
- The first vitest run after Task 3 ran from the wrong directory (a failed `cd` in my own command). Re-run from `packages/desktop`: 8 of 8 pass.
- `cargo test -p core` in full was not run; the environment note makes it unusable, and no file under `packages/core` changed. The core gates that touch this area were run by name: `proposal_no_promotion` (12 pass, includes the 13-09 canonical-write gate and its stale-allow-list check), `no_agent_status_write` (8 pass), `pm_vocabulary_gate` (4 pass).

## Verification (all counts non-zero)

- `cargo test -p desktop --bin desktop --test board_changed_payload --test handler_roster`: 149 + 3 + 2 pass.
- `npx vitest run` in `packages/desktop`: 91 files pass, 1490 tests pass. The routing file has 8 tests.
- `npx tsc --noEmit`: only the 2 pre-existing `brand-rule.test.ts` errors.
- `cargo check -p desktop --tests`: clean apart from one pre-existing dead-code warning in `agent_run.rs`.

## Known Stubs

None.

## Known limitations (logged in deferred-items.md)

- About thirty per-hook `subscribeBoardChanged` readers still invalidate on every event. Only the central subscription is routed, which is what the plan scoped.
- The account-wide dispatch gate and cap queries no longer refresh on a cross-project event. The cap's running count can lag until the next same-project or broadcast event.

## Threat Flags

None. No new endpoint, auth path or file access; the event payload gains a project id the renderer already holds.

## Next Phase Readiness

Plan 13-11 and phases 14-18 can add their reader sets by subscribing with the typed payload and routing on `projectId`, instead of adding another always-invalidated subscriber. The emit gate means a new emitter cannot skip the helper.

## Self-Check: PASSED

- Created files exist: `board_changed_payload.rs`, `board-changed-routing.test.tsx`.
- Commits `68c5d08`, `7987ebf`, `32e170b` exist in `git log`.
- `git rev-list --count 7785386..HEAD` was 3 at write time.

---
*Phase: 13-nothing-new-escapes-the-fence*
*Completed: 2026-10-15*
