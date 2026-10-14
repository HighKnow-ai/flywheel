---
phase: 10-fleet-supervision-across-every-project
plan: 05
subsystem: fleet
tags: [rust, tauri, react, sqlite, fleet, permission-queue, keyboard]

requires:
  - phase: 10-fleet-supervision-across-every-project
    provides: "10-01 fleet surface, rail Fleet entry, fleetSurface store field; 10-03 single throttled agent:event listener; 10-04 acknowledge statement"
  - phase: 02-one-agent-one-worktree-watched-live
    provides: "PermissionRequestCard and the unchanged agent_run_answer_permission verb"
provides:
  - "query::fleet::blocked_queue: one entry per blocked run, its earliest pending request, live blocks only, across every project"
  - "fleet_blocked_queue command (read-only, no arguments, capped at 200), registered and listed in the audited roster"
  - "PermissionRequestCard keyboardEnabled prop: a disabled instance registers no key handler"
  - "BlockedQueue: the card's third mount, exactly one keyboard owner"
  - "fleetSurface target view 'queue'; the surface header switches between the fleet list and the queue"
  - "Rail Blocked row opens the queue with a fleet-wide count; Needs decision opens the fleet list"
affects: [10-06, 10-07]

requirements-completed: [FLEET-02]

actuals:
  tokens: 28562
  tasks: 3
  commits: 3
plan_head_before: 9d8bdfd8f7bf6717e4698ef89ed34873fbad726b
commits: 3

tech-stack:
  added: []
  patterns:
    - "One keyboard owner: an optional prop, default preserving the old index rule, with a disabled instance registering an empty handler set"
    - "One shared, reference-counted invalidation subscription per QueryClient for every fleet consumer"
    - "Earliest-request-per-run by a correlated subselect in the statement, never by renderer deduplication"

key-files:
  created:
    - packages/desktop/src/fleet/BlockedQueue.tsx
    - packages/desktop/src/fleet/__tests__/blocked-queue.test.tsx
  modified:
    - packages/core/src/query/fleet.rs
    - packages/core/tests/fleet_query.rs
    - packages/desktop/src-tauri/src/commands/fleet.rs
    - packages/desktop/src-tauri/src/main.rs
    - packages/desktop/src-tauri/capabilities/default.json
    - packages/desktop/src/adapters/tauri.ts
    - packages/desktop/src/session/PermissionRequestCard.tsx
    - packages/desktop/src/fleet/FleetSurface.tsx
    - packages/desktop/src/fleet/useFleet.ts
    - packages/desktop/src/state/uiStore.ts
    - packages/desktop/src/projects/ProjectRail.tsx
    - packages/desktop/src/projects/__tests__/project-rail.test.tsx

key-decisions:
  - "The owner is marked by a 4px left rule in --selection-rule (the codebase's existing 'selected' grammar) plus the words 'Keys A and D answer this one', and a data-keyboard-owner attribute; every other row carries a transparent 4px border so the columns align"
  - "The user moves between the two views from inside the surface with a two-button group in the header: 'All agents' and 'Blocked N' (aria-pressed marks the current one)"
  - "The rail's Blocked row moved from the Fleet section into the Review queue section, as a button that is always present; its numeral is absent at zero"
  - "Needs decision is a separate button that opens the fleet list (whose first section is NEEDS YOU), never the queue; it stays the current project's count"
  - "No new keyboard binding: the existing open-fleet action reaches the surface and the card owns a, d and shift-a, so keyboard.ts is unchanged and the fleet-surface allow-list still excludes all three"

duration: 33min
completed: 2026-10-12
status: complete

coverage:
  - id: D1
    description: "blocked_queue lists every blocked run across projects with its project name, one entry per run carrying the earliest pending request"
    requirement: FLEET-02
    verification:
      - kind: integration
        ref: "packages/core/tests/fleet_query.rs#the_queue_spans_projects_and_carries_each_project_name"
        status: pass
      - kind: integration
        ref: "packages/core/tests/fleet_query.rs#a_run_with_two_pending_requests_is_one_entry_carrying_the_earlier"
        status: pass
    human_judgment: false
  - id: D2
    description: "The queue holds live blocks only: an answered request, an abandoned run and an awaiting-review run are not in it, while the fleet's NEEDS YOU band still holds the abandoned run"
    requirement: FLEET-02
    verification:
      - kind: integration
        ref: "packages/core/tests/fleet_query.rs#only_blocked_runs_are_queued_and_the_fleet_band_disagrees_where_d172_says"
        status: pass
      - kind: integration
        ref: "packages/core/tests/fleet_query.rs#an_answered_request_does_not_appear"
        status: pass
    human_judgment: false
  - id: D3
    description: "Order is specified and repeatable (created-at, then request id), and an empty database returns zero entries"
    requirement: FLEET-02
    verification:
      - kind: integration
        ref: "packages/core/tests/fleet_query.rs#ties_on_created_at_order_by_request_id_and_repeat_identically"
        status: pass
      - kind: integration
        ref: "packages/core/tests/fleet_query.rs#an_empty_database_has_an_empty_queue"
        status: pass
    human_judgment: false
  - id: D4
    description: "One a, d or shift-a keypress over three queued cards answers exactly one request, for the first entry; the owner moves when the list moves; exactly one card is marked"
    requirement: FLEET-02
    verification:
      - kind: unit
        ref: "packages/desktop/src/fleet/__tests__/blocked-queue.test.tsx#BlockedQueue keyboard ownership"
        status: pass
    human_judgment: false
  - id: D5
    description: "Escape dismisses nothing, a destructive entry leads with Deny, the empty queue shows its copy and no card, and the card's two existing mounts keep the index rule"
    requirement: FLEET-02
    verification:
      - kind: unit
        ref: "packages/desktop/src/fleet/__tests__/blocked-queue.test.tsx#BlockedQueue contents"
        status: pass
    human_judgment: false
  - id: D6
    description: "The rail's blocked count is fleet-wide, absent at zero, never summed with the needs-decision count, and the rows open the queue and the fleet list respectively"
    requirement: FLEET-02
    verification:
      - kind: unit
        ref: "packages/desktop/src/projects/__tests__/project-rail.test.tsx#ProjectRail's review queue entry points (Phase 10 plan 10-05, FLEET-02)"
        status: pass
    human_judgment: false
  - id: D7
    description: "The queue works end to end in the real app with real blocked agents, and the owner marking reads well at row density"
    verification: []
    human_judgment: true
    rationale: "No test drives the real Tauri round trip or a real sidecar raising requests, and the look is an aesthetic judgement in a WKWebView with no WebDriver. Queued as D-REV-50, not observed."
---

# Phase 10 Plan 05: The blocked queue Summary

**Every agent blocked at a permission request, across every project, is now one list that can be answered in place through the card's third mount, with exactly one keyboard owner so a single keystroke can only ever answer a single agent.**

## What was built

1. **The read (`ae55e3b`).** `query::fleet::blocked_queue` joins `permission_requests` to `agent_runs`, `projects`, `tasks` and `epics`, admits only `ar.status = 'blocked'` and `pr.status = 'pending'`, and picks one request per run with a correlated subselect (earliest `created_at`, then id). It is a literal `&str` bound through `params![]`, with `BLOCKED_QUEUE_MAX_LIMIT` as the clamp. `fleet_blocked_queue` takes `State<AppState>` and nothing else, is registered once in `main.rs` and named once in the capability roster, and no new answer verb was added.
2. **The mount (`2c0e1a0`).** `PermissionRequestCard` gained `keyboardEnabled?: boolean`. Omitted, the first request of the card's own array owns the keyboard as before. Passed `false`, the row registers an empty handler set, so a keypress finds nothing there. `BlockedQueue` mounts one card per entry and passes `keyboardEnabled` true to the first entry only. Answers go through the unchanged `answerPermissionRequest`, then the queue, fleet and that run's pending-request keys are invalidated, so the owner moves because the list moved.
3. **The door (`b711bb3`).** `FleetSurfaceTarget.view` is now `"fleet" | "queue"` on the one existing store field. `FleetSurface` branches on it. The rail's Review queue section holds a Blocked button (opens the queue) and a Needs decision button (opens the fleet list).

## Required records

- **Red then green, observed.** After writing `blocked-queue.test.tsx` I temporarily changed the queue to pass `keyboardEnabled={true}` to every card (the unconstrained mount Finding 3 measured). Four tests failed: one `a`, one `d` and one shift-`a` keypress over three cards each produced 3 answer calls instead of 1, and the owner-moves test produced 2 instead of 1. Restoring `keyboardEnabled={owner}` turned all 12 green. Strictly, the prop already existed when this was run, so the red state was produced by defeating the queue's use of it, not by deleting the prop from the card.
- **Owner marking.** A 4px left rule in `--selection-rule`, the words "Keys A and D answer this one", and `data-keyboard-owner="true"`, on exactly one row. Not colour alone.
- **Moving between views from inside the surface.** A two-button group in the surface header: "All agents" and "Blocked N", with `aria-pressed` on the current one, both writing the same `fleetSurface` field. "← Board" still closes the surface.
- **Rail counts.** Blocked (fleet-wide, the queue's own read) and Needs decision (current project) are separate buttons with separate figures and nothing sums them; a test asserts the total "6" never renders. Needs decision calls `setFleetSurface({ view: "fleet" })`, the list whose first band is NEEDS YOU, not the queue.

## Deviations from Plan

**1. [Rule 3 - Blocking] The `subscribeAgentEvent` count gate reads 2, not 1**
- **Found during:** Task 3 verification
- **Issue:** `grep -v '^[[:space:]]*[*/]' useFleet.ts | grep -c subscribeAgentEvent` counts the import line as well as the call, and read 2 even before this plan.
- **Fix:** none to the code. The real count is one registration: `grep -c 'subscribeAgentEvent(' useFleet.ts` is 1.

**2. [Rule 1 - Bug] A second consumer of the invalidation would have bought a second listener**
- **Found during:** Task 3
- **Issue:** the plan said to extend the existing effect, but the rail, `useFleet` and `useBlockedQueue` are all separate consumers. Extending per-hook effects made the surface register two `agent:event` listeners, which breaks 10-03's "one listener" rule and its `fleet-activity` test.
- **Fix:** one reference-counted subscription per `QueryClient` (`useFleetInvalidation`), shared by all consumers, invalidating both keys. `fleet-activity.test.tsx` was updated to expect one invalidation per key per throttle window (2 then 4 calls).
- **Files modified:** `packages/desktop/src/fleet/useFleet.ts`, `fleet-activity.test.tsx`
- **Commit:** 2c0e1a0, b711bb3

**3. [Rule 3 - Blocking] Existing tests mocking the adapter needed the new exports**
- **Found during:** Task 3
- **Issue:** the rail is mounted by many tests, and it now reads the queue and subscribes to `agent:event`. Strict `vi.mock` factories without `fleetBlockedQueue` and `subscribeAgentEvent` threw.
- **Fix:** added both to `first-run`, `menu-bridge`, `unreachable-in-app`, `project-rail`, `fleet-surface`, `fleet-spend` and `fleet-activity` mocks. `blocked-indicator` and `needs-decision` seed the rail's count through `fleet_blocked_queue` instead of `board_blocked_summary`, and their tooltip wording is "agent(s) waiting on you". The count sources changed by design; no expectation was weakened.
- **Commit:** b711bb3

**4. [Rule 1 - Design] Rail "Nothing waiting" row and the Fleet-section Blocked row are gone**
- **Issue:** the Blocked row moved to the Review queue section as the queue's entry button, which is always present, so the muted "Nothing waiting" line became redundant. The button has no numeral at zero.
- **Commit:** b711bb3

**5. `state/keyboard.ts` was not changed.** The plan allowed a binding "if the surface needs one"; it does not. The `fleet-surface` allow-list still excludes `a`, `d` and shift-`a`.

**Total deviations:** 4 (1 bug, 2 blocking, 1 design). **Impact:** none on scope; the single-listener rule is stronger than before.

## Verification run

- `cargo test -p core --test fleet_query --test destructive_gate_layer_coverage`: 25 and 5 passed. `cargo test -p desktop`: 110 passed. `cargo build --workspace`: clean apart from the pre-existing `StartRunOutcome` dead-code warning.
- `npm --prefix packages/desktop test`: 80 files, 1,369 tests passed. `npm --prefix packages/desktop run build`: clean.
- Gates: no `format!` in `query/fleet.rs`; `fleet_blocked_queue` once in `main.rs` and once in `default.json`; one `agent_run_answer_permission` handler; `keyboardEnabled` in the card at least twice and in `BlockedQueue.tsx`; no escape handling in `BlockedQueue.tsx`.

## Known Stubs

None.

## Threat Flags

None. T-10-05-01 (keyboard ownership) and T-10-05-02 (destructive variant leads with Deny in the queue) are asserted by `blocked-queue.test.tsx`; T-10-05-03/04/06 hold by the literal bound statement, the 200 cap with earliest-request-per-run in SQL, and no new write path.

## Deferred review

D7 is queued as D-REV-50 in `.planning/DEFERRED-REVIEW.md` with `automatable: PARTLY`. It was not observed.

## Self-Check: PASSED

`BlockedQueue.tsx` and `blocked-queue.test.tsx` exist; commits `ae55e3b`, `2c0e1a0` and `b711bb3` resolve; the `commits: 3` figure is measured from `git rev-list --count 9d8bdfd..HEAD`.
