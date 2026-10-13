---
phase: 10-fleet-supervision-across-every-project
plan: 03
subsystem: fleet
tags: [rust, tauri, react, tanstack-query, session-log, fleet, activity]

requires:
  - phase: 10-fleet-supervision-across-every-project
    provides: "10-01 fleet_list, FleetRowDto, FleetSurface, useFleet; 10-02 ordered multi-event stream normalisation"
  - phase: 02-one-agent-one-worktree-watched-live
    provides: "buildFeedRows, FeedRow, the session log, agent:event"
provides:
  - "session_log::read_tail, LogTail, LOG_TAIL_MAX_BYTES, LOG_TAIL_MAX_LINES: a seek-from-EOF bounded read of a run's log"
  - "FleetRowDto.activity (raw tail lines plus a truncated flag) for live rows only, read after the database lock is dropped"
  - "FeedRow.tsx toolCallLabel and feedRowText: the one wording of a feed row on one line, used by the feed and the fleet"
  - "useFleet: one throttled app-level agent:event invalidation of the single fleet query key"
  - "FleetSurface ActivityCell and activityLine"
affects: [10-04, 10-05, 10-06, 10-07]

requirements-completed: [FLEET-01]

actuals:
  tokens: 11176
  tasks: 2
  commits: 3
plan_head_before: 24b88e7fb41c4550f6e11bdf444ec6a11c7b8338
commits: 3

tech-stack:
  added: []
  patterns:
    - "One read path, two triggers: board:changed and a throttled agent:event both invalidate the same fleet key"
    - "The Rust side ships raw log lines; the renderer owns the one normaliser (buildFeedRows)"
    - "A shared one-line wording lives next to the row kinds it words (feedRowText in FeedRow.tsx)"

key-files:
  created:
    - packages/core/tests/session_log_tail.rs
    - packages/desktop/src/fleet/__tests__/fleet-activity.test.tsx
  modified:
    - packages/core/src/session_log.rs
    - packages/desktop/src-tauri/src/commands/fleet.rs
    - packages/desktop/src/adapters/tauri.ts
    - packages/desktop/src/fleet/useFleet.ts
    - packages/desktop/src/fleet/FleetSurface.tsx
    - packages/desktop/src/fleet/__tests__/fleet-surface.test.tsx
    - packages/desktop/src/session/FeedRow.tsx

key-decisions:
  - "D-171 deviation: one static app-level agent:event listener, invalidation only, throttled to FLEET_ACTIVITY_THROTTLE_MS = 1000 on the trailing edge"
  - "LOG_TAIL_MAX_BYTES = 256 KiB, LOG_TAIL_MAX_LINES = 16"
  - "Activity line clipped to 80 characters, ellipsis at the tail, applied to every row kind; narration cut at its first clause first"
  - "fleet_list moved to async + spawn_blocking: read_tail measured about 1 ms per call on a 9 MB log"
  - "An unreadable log degrades only its own row to a dash; it does not fail the fleet"

duration: 35min
completed: 2026-10-12
status: complete

coverage:
  - id: D1
    description: "read_tail reads the end of a session log in bounded bytes and lines, handling a missing file, an in-flight final line, an oversize line and a non-ULID id"
    requirement: FLEET-01
    verification:
      - kind: integration
        ref: "packages/core/tests/session_log_tail.rs"
        status: pass
    human_judgment: false
  - id: D2
    description: "fleet_list reads the tail only for running or blocked rows, after dropping the database lock"
    requirement: FLEET-01
    verification:
      - kind: unit
        ref: "packages/desktop/src-tauri/src/commands/fleet.rs#only_live_rows_are_read_and_terminal_rows_never_are"
        status: pass
      - kind: unit
        ref: "packages/desktop/src-tauri/src/commands/fleet.rs#a_database_whose_only_runs_are_terminal_makes_no_read_at_all"
        status: pass
    human_judgment: false
  - id: D3
    description: "A live row shows its newest feed row in the session feed's own words, a dash when unreadable, and nothing when terminal"
    requirement: FLEET-01
    verification:
      - kind: unit
        ref: "packages/desktop/src/fleet/__tests__/fleet-activity.test.tsx"
        status: pass
      - kind: unit
        ref: "packages/desktop/src/fleet/__tests__/fleet-surface.test.tsx#renders no activity text for a failed row, even one that carries a tail"
        status: pass
    human_judgment: false
  - id: D4
    description: "One agent:event listener, throttled to one invalidation per second, removed on unmount"
    requirement: FLEET-01
    verification:
      - kind: unit
        ref: "packages/desktop/src/fleet/__tests__/fleet-activity.test.tsx#invalidates the fleet key once for ten events inside one throttle window"
        status: pass
    human_judgment: false
  - id: D5
    description: "The cell moves within about a second of a real agent's tool call, and the line reads well at row density"
    verification: []
    human_judgment: true
    rationale: "No end-to-end test drives a real sidecar against an open fleet, and the look of the line is an aesthetic judgement in a WKWebView with no WebDriver. Queued as D-REV-48, not observed."
---

# Phase 10 Plan 03: Activity line on the fleet row Summary

**Each live fleet row now shows one truncated line of what that agent is doing, taken from the tail of its own session log through the session feed's own `buildFeedRows` and `feedRowText`, and it moves within about a second through one throttled `agent:event` listener.**

## What was built

1. **`session_log::read_tail` (`d76f9fb`).** Seeks from the end, reads at most 256 KiB, returns at most 16 complete lines oldest first, never calls `count_lines`. A missing file is empty. An in-flight final line is dropped. When the window starts mid-file its first fragment is dropped too, so a line larger than the window yields no line and `truncated: true` rather than half a JSON object. A non-ULID id errors out of `session_log_path` before any path is built. Tests went in first (`000d41f`, RED against a stub that returned empty: 7 of 11 failed) and then the implementation.
2. **`fleet_list` carries `activity` (`4822089`).** `FleetRowDto.activity` is `{ lines, truncated }`, raw lines and no rendered string. Only rows with `run_status` of `running` or `blocked` are read. The database lock is taken, `fleet_rows` runs, and `drop(conn)` follows with the "nothing below may run with the database mutex held" comment before any file read. A failed read leaves that row's activity empty, which the renderer draws as a dash.
3. **One wording for a feed row.** `FeedRow.tsx` gained `toolCallLabel` (tool, ` · `, target) and `feedRowText` (every row kind on one line). `ToolCallRow` and `ScopeDeniedRow` now call them, so the feed and the fleet cannot word the same row differently. `FleetSurface` adds `activityLine`, which parses the tail lines (non-JSON becomes the same `unknown` entry `session_log.rs` makes), runs `buildFeedRows`, takes the last row, and renders it. It adds no row kind and no label.
4. **`useFleet` throttled listener.** One `subscribeAgentEvent` effect beside the `subscribeBoardChanged` one, same cancelled-flag cleanup, plus a timer cleared on unmount.

## Recorded choices

- **D-171 deviation, so a later reader does not read it as drift.** D-171 says one cross-project query re-run on `board:changed`. That is still true. This plan adds one app-level `agent:event` listener because `board:changed` is not emitted per agent event and the cell would not move. It is one static listener for the whole surface, not one per run. Its handler does nothing but arm a timer that invalidates `fleetQueryKey()` once per `FLEET_ACTIVITY_THROTTLE_MS` (1000 ms, trailing edge). It never reads the payload and never writes the cache. The normaliser still lives in one place. No subscription is created or destroyed as runs start and end.
- **`LOG_TAIL_MAX_BYTES` = 256 KiB**, per RESEARCH Assumption A5's suggested order. `LOG_TAIL_MAX_LINES` = 16, enough for the normaliser to step past `cost_update` and `result` and pair a `tool_result` with its call. A line larger than the window shows a dash by design.
- **Truncation width and ellipsis (Claude's discretion).** 80 characters, ellipsis at the tail, applied to every row kind alike, pinned as `ACTIVITY_MAX_CHARS` and asserted. The start of a line (the tool, the first clause) is what says what the agent is doing. Narration is cut at its first sentence or clause break (`. `, `! `, `? `, `: `, `; `) or its first line, then clipped.
- **`fleet_list` is now async with `spawn_blocking`.** Measured `read_tail` at about 1.06 ms per call on a 9 MB log, warm cache. At 8 live rows that is about 8 ms, and at the 200-row cap about 200 ms, all on the IPC thread if it stayed synchronous, repeated up to once a second per open fleet. That decided it. The lock is already released by then, so the conversion was mechanical.
- **Worst-case IPC payload.** A live row's tail can be up to 256 KiB if the last lines are large tool results. Eight such rows once a second is about 2 MiB over IPC. Accepted for now and noted because lowering `LOG_TAIL_MAX_LINES` is the lever if it ever shows.
- **Terminal rows.** Rust never reads them and the cell renders an empty span, so the column holds its place with no text.

## Deviations from Plan

**1. [Rule 3 - Blocking] The `subscribeAgentEvent` grep gate cannot read 1**
- **Found during:** Task 2 verification
- **Issue:** the plan's gate `grep -v '^[[:space:]]*[*/]' useFleet.ts | grep -c subscribeAgentEvent` must equal 1, but any correct file has the named import line and the one call, so it reads 2. The gate counts the import, not the registrations.
- **Fix:** none to the code. The intent (exactly one registration) is asserted by `is registered once for a surface of three live rows`, which counts calls to the mocked subscriber. The call site is a single line.
- **Files modified:** none

**2. [Rule 2 - Critical] Shared wording extracted instead of duplicated**
- **Found during:** Task 2
- **Issue:** `ToolCallRow` and `ScopeDeniedRow` built their label text inline, and the plan forbids a second vocabulary. Re-deriving it in the fleet would have been exactly that.
- **Fix:** extracted `toolCallLabel` and `scopeDeniedText` and exported `feedRowText` from `FeedRow.tsx`; both feed rows now call them. Rendered text is unchanged and the session tests pass untouched.
- **Files modified:** `session/FeedRow.tsx`
- **Commit:** `4822089`

**Total deviations:** 2 (1 blocking-gate defect, 1 critical-correctness extraction). **Impact:** none on scope.

The plan names six feed row kinds. The feed also has `developer_turn` (authoring sessions), which falls through `feedRowText` to its text like the others; no kind is excluded.

## Verification run

- `cargo test -p core --test session_log_tail`: 11 passed. Also `session_log_window` (10), `compaction` and `five_cycle_reconstitution` still pass.
- `cargo test -p core --test fleet_query`: 12 passed. `cargo test -p desktop`: 110 passed (4 new). `cargo build --workspace`: clean.
- `npm --prefix packages/desktop test`: 78 files, 1,339 tests passed, no existing expectation edited. `npm --prefix packages/desktop run build`: clean.
- Gates: no `count_lines` inside `read_tail`; `LOG_TAIL_MAX_BYTES` appears twice outside comments (declared and enforced); exactly one `drop(conn)` in `fleet_list`; `read_tail` is called in `fleet.rs`; `buildFeedRows` is used in `FleetSurface.tsx`; no Rust file in `src-tauri` mentions `tool_call`.
- Mutation check: removing the live-row guard in `ActivityCell` fails both terminal-row tests.

## Known Stubs

None.

## Threat Flags

None. The read path is the plan's register: bounded bytes and lines (T-10-03-01), the lock dropped before any read with a grep gate (T-10-03-02), the `is_ulid` gate before a path is built (T-10-03-03), and one invalidation-only listener (T-10-03-05).

## Deferred review

D5 is queued as D-REV-48 in `.planning/DEFERRED-REVIEW.md` with `automatable: PARTLY`: a harness run against a scratch `FLYWHEEL_APP_DATA_DIR` can assert `fleet_list` returns a freshly appended tail. It was not observed here.

## Self-Check: PASSED

`session_log_tail.rs` and `fleet-activity.test.tsx` exist, and commits `000d41f`, `d76f9fb` and `4822089` resolve.
