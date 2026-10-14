---
phase: 04-clear-is-free
plan: 06
subsystem: context-reconstitution
tags: [rusqlite, tauri, session-summaries, inbound-event, context-packet, mcp-tool-name]

requires:
  - phase: 04-clear-is-free
    provides: "04-01's session_summaries table, create_summary and the DecisionEntry/SummaryFields
      shape; 04-02's shared insert_summary_row/apply_session_closed transaction pattern; 04-03's
      SummaryReportedEvent wire shape (camelCase field names this plan's apply_summary_reported
      deserialises verbatim) and the report_summary MCP tool the closing requirement names"
provides:
  - "domain::session_summary::apply_summary_reported / SummaryReportOutcome — the database-only
    half of the inbound summary_reported contract"
  - "commands::agent_run::handle_inbound_summary_reported — the Tauri-facing half, wired as a
    fourth branch on sidecar.rs's reader loop, positioned after the live agent:event emit"
  - "ContextPacket.decisions (deduplicated, first-occurrence-wins) and render_prompt's
    '## Decisions On Record' / '## Closing Requirement' sections, naming
    context_packet::REPORT_SUMMARY_TOOL_NAME"
affects: [04-07, 04-08, 04-09, 04-14]

actuals:
  tokens: 8292
  tasks: 3
  commits: 3

tech-stack:
  added: []
  patterns:
    - "Reader-loop dispatch split, extended a fourth time: sidecar.rs tests event.get(\"type\")
      and delegates to a Tauri-facing commands::agent_run handler, which itself delegates the
      DB-only decision to a flywheel_core::domain function — the same three-layer split
      session_closed and permission_request already established, now applied to
      summary_reported"
    - "Guard sequence copied verbatim from apply_session_closed: wrong event type -> Ignored,
      missing runId -> Ignored, non-ULID runId -> Ignored BEFORE any database statement, unknown
      run -> UnknownRun — a run id read off a sidecar stdout line is exactly as trusted as any
      other value crossing that process boundary, never more"
    - "Board-entity identity resolved from the agent_runs row the (already-validated) runId
      points at, never from the event body — checkable by grep, not only by test, since the
      function's body contains no lookup of taskId/projectId/worktreeId keys at all"

key-files:
  created: []
  modified:
    - packages/core/src/domain/session_summary.rs
    - packages/core/tests/summary_report_wire.rs
    - packages/desktop/src-tauri/src/sidecar.rs
    - packages/desktop/src-tauri/src/commands/agent_run.rs
    - packages/core/src/context_packet.rs

key-decisions:
  - "handle_inbound_summary_reported resolves the summary's own task_id from agent_runs (a
    second, cheap read alongside the write) so the second board:changed emit names the run's
    real task — never the run id reused as a task id, which the plan's own worked example for
    'follow handle_inbound_permission_request's emit convention' did not make explicit"
  - "The Closing Requirement section's prose legitimately names 'the Decisions On Record
    section' even when that section is omitted — the omit-check for the heading therefore tests
    for the literal heading marker ('## Decisions On Record'), not the bare phrase, so the
    closing requirement's own cross-reference cannot false-positive the omit assertion"
  - "auto_generated is always false and diff_ref is always None on the agent-authored path — the
    same two fields plan 04-02's fallback path fixes at the opposite values — so a reader can
    tell which producer wrote a row without inspecting created_by"

requirements-completed: [CTX-01, CTX-02, CTX-06]

coverage:
  - id: D1
    description: "A summary_reported event arriving on the sidecar reader loop leaves exactly
      one summary row attributed to the run named by the event's own runId and to no other"
    requirement: CTX-01
    verification:
      - kind: unit
        ref: "tests/summary_report_wire.rs#a_valid_event_writes_one_row_and_returns_recorded"
        status: pass
      - kind: unit
        ref: "tests/summary_report_wire.rs#an_event_carrying_a_foreign_task_id_still_attaches_the_summary_to_the_runs_own_task"
        status: pass
    human_judgment: false
  - id: D2
    description: "Every malformed inbound shape (wrong type, missing/non-ULID runId, unknown
      run, malformed decisions entries) is ignored without erroring and without writing"
    requirement: CTX-01
    verification:
      - kind: unit
        ref: "tests/summary_report_wire.rs#an_event_of_a_different_type_is_ignored_and_writes_nothing"
        status: pass
      - kind: unit
        ref: "tests/summary_report_wire.rs#an_event_with_no_run_id_is_ignored_and_writes_nothing"
        status: pass
      - kind: unit
        ref: "tests/summary_report_wire.rs#a_non_ulid_run_id_is_ignored_and_writes_nothing"
        status: pass
      - kind: unit
        ref: "tests/summary_report_wire.rs#a_well_formed_ulid_naming_no_row_returns_unknown_run_and_writes_nothing"
        status: pass
      - kind: unit
        ref: "tests/summary_report_wire.rs#malformed_decisions_elements_are_dropped_and_well_formed_siblings_kept"
        status: pass
      - kind: unit
        ref: "tests/summary_report_wire.rs#missing_optional_fields_become_none_and_missing_arrays_become_empty_vecs"
        status: pass
    human_judgment: false
  - id: D3
    description: "No board-entity id is ever read off the wire — apply_summary_reported's body
      contains no lookup of taskId/projectId/worktreeId keys at all"
    requirement: CTX-01
    verification:
      - kind: other
        ref: "grep -v '^[[:space:]]*//' packages/core/src/domain/session_summary.rs | grep -cE '\"taskId\"|\"projectId\"|\"worktreeId\"' == 0"
        status: pass
      - kind: other
        ref: "grep -rv '^[[:space:]]*//' packages/core/src | grep -c 'INSERT INTO session_summaries' == 1"
        status: pass
    human_judgment: false
  - id: D4
    description: "A fault in the summary write can never delay, suppress or crash the live
      event stream — the reader-loop branch sits after the agent:event emit, the handler never
      panics, and it drops the database lock before emitting"
    verification:
      - kind: other
        ref: "grep -v '^[[:space:]]*//' packages/desktop/src-tauri/src/sidecar.rs | grep -c 'handle_inbound_summary_reported' == 1"
        status: pass
      - kind: other
        ref: "awk '/pub fn handle_inbound_summary_reported/,/^}/' packages/desktop/src-tauri/src/commands/agent_run.rs | grep -v '^[[:space:]]*//' | grep -cE 'unwrap\\(\\)|expect\\(|panic!' == 0"
        status: pass
    human_judgment: false
  - id: D5
    description: "Every rendered prompt names the exact tool the sidecar registers and lists the
      decision ids the agent must echo — the closing requirement has no omit case, and the
      accumulated decisions list is what the agent is asked to echo against"
    requirement: CTX-06
    verification:
      - kind: unit
        ref: "tests/summary_report_wire.rs#the_accumulated_decisions_list_deduplicates_a_shared_id_and_preserves_first_occurrence_order"
        status: pass
      - kind: unit
        ref: "tests/summary_report_wire.rs#a_task_with_no_summaries_renders_no_decisions_heading_but_still_renders_the_closing_requirement"
        status: pass
      - kind: unit
        ref: "tests/summary_report_wire.rs#the_rendered_closing_requirement_contains_the_fully_qualified_tool_string_character_for_character"
        status: pass
      - kind: unit
        ref: "tests/summary_report_wire.rs#render_prompt_is_byte_identical_across_two_calls_with_both_new_sections_present"
        status: pass
      - kind: other
        ref: "grep -c 'mcp__flywheel-permissions__report_summary' packages/core/src/context_packet.rs == 1"
        status: pass
    human_judgment: false
  - id: D6
    description: "The packet assembler stays a pure query — no process, no network call, no
      write — even with the new decisions field"
    verification:
      - kind: other
        ref: "grep -v '^[[:space:]]*//' packages/core/src/context_packet.rs | grep -cE 'Command::new|reqwest|ureq|tokio::process' == 0"
        status: pass
      - kind: integration
        ref: "tests/context_packet.rs (all 10 pre-existing tests, unchanged) — cargo test -p core --test context_packet"
        status: pass
    human_judgment: false

duration: 12min
completed: 2026-09-23
status: complete
---

# Phase 4 Plan 6: Inbound `summary_reported` Wire and the Closing Requirement Summary

**The agent's own `report_summary` call now reaches the database through the existing reader loop — `apply_summary_reported` writes one row attributed to the run's own task via a guard sequence copied from `apply_session_closed`, and every rendered prompt tells the agent, by exact tool name, to close with its own summary and echo the decision ids it saw.**

## Performance

- **Duration:** 12 min
- **Started:** 2026-09-23T09:08:00+08:00 (approx, following plan 04-03/04-05)
- **Completed:** 2026-09-23T09:20:02+08:00
- **Tasks:** 3
- **Files modified:** 5

## Accomplishments

- `domain::session_summary::apply_summary_reported` / `SummaryReportOutcome`: the database-only
  inbound contract — event-type and `runId` guards copied verbatim from
  `apply_session_closed`'s own ordering (reject a non-ULID `runId` before any database
  statement), an `UnknownRun` outcome for a well-formed ULID naming no row, and a delegation to
  the existing `create_summary` so the crate still has exactly one `INSERT INTO
  session_summaries` site. No `taskId`/`projectId`/`worktreeId` key is ever read off the event —
  a grep gate proves it structurally, not just by test.
- `commands::agent_run::handle_inbound_summary_reported`, wired as a fourth branch on
  `sidecar.rs`'s reader loop, positioned **after** the live `agent:event` emit and the
  `session_closed` branch — a fault in this database write can never delay or suppress the live
  stream. Never panics (no `unwrap`/`expect`/`panic!`), drops the database lock before emitting,
  and emits `board:changed` for both the `agent_run` and its own `task` (resolved from
  `agent_runs`, never the event) so the item-detail panel's runs and summaries sections refetch.
- `ContextPacket.decisions`: every decision entry from the task's own summaries, walked
  oldest-first and deduplicated by id (first occurrence wins, order preserved) — a pure fold
  over data `assemble_context_packet` already read, issuing no additional query.
- `render_prompt` gains `## Decisions On Record` (omitted when empty) and `## Closing
  Requirement` (no omit case — always rendered, placed last so it is the final thing the agent
  reads), naming the exact fully-qualified tool string
  (`context_packet::REPORT_SUMMARY_TOOL_NAME`, declared once and matching the sidecar's
  `SUMMARY_TOOL_NAME` composition character for character).
- `tests/summary_report_wire.rs`: 12 tests across the inbound contract (8) and the packet/prompt
  extension (4), including the hostile foreign-task-id case and a determinism check with both
  new sections present.

## Task Commits

Each task was committed atomically:

1. **Task 1: apply_summary_reported — the database-only half** - `df04e4d` (feat)
2. **Task 2: The reader-loop branch, placed after the live emit** - `f2a99b5` (feat)
3. **Task 3: The prompt asks for it — closing requirement and decisions on record** - `f644658` (feat)

_No plan metadata commit required beyond these three — STATE.md/ROADMAP.md updates follow in
this same session._

## Files Created/Modified

- `packages/core/src/domain/session_summary.rs` - `apply_summary_reported`, `SummaryReportOutcome`
- `packages/core/tests/summary_report_wire.rs` - 12 tests, the inbound contract and the packet/prompt extension
- `packages/desktop/src-tauri/src/sidecar.rs` - the fourth reader-loop dispatch branch
- `packages/desktop/src-tauri/src/commands/agent_run.rs` - `handle_inbound_summary_reported`
- `packages/core/src/context_packet.rs` - `REPORT_SUMMARY_TOOL_NAME`, `ContextPacket.decisions`, two new `render_prompt` sections

## Decisions Made

- `handle_inbound_summary_reported` reads the run's own `task_id` from `agent_runs` (a second,
  cheap read alongside the write) so the second `board:changed` emit names the run's real task —
  the plan's own worked instruction ("follow whichever convention
  `handle_inbound_permission_request` already sets") left the id source for a second, distinct
  entity underspecified; reusing `run_id` as the task's id would have been wrong.
- The Closing Requirement section's own prose legitimately names "the Decisions On Record
  section" even when that section is omitted for an empty list — the render_prompt omit-test
  therefore asserts against the literal heading marker (`## Decisions On Record`), not the bare
  phrase, so the closing requirement's cross-reference cannot false-positive the omit assertion.
- `auto_generated` is always `false` and `diff_ref` is always `None` on this (agent-authored)
  path — the mirror image of plan 04-02's fallback path, which fixes both at the opposite
  values — so a reader can tell which producer wrote a row without inspecting `created_by`.

## Deviations from Plan

None - plan executed exactly as written.

## Issues Encountered

An initial test assertion (`a_task_with_no_summaries_renders_no_decisions_heading_...`) checked
for the bare phrase `"Decisions On Record"` rather than the heading marker, and false-failed
because the Closing Requirement section's own prose legitimately names that section by phrase.
Fixed by asserting against `"## Decisions On Record"` instead — the closing requirement itself
was correct; only the test's assertion needed the heading marker. Caught and fixed before commit
(not a deviation from the plan's own instructions — no plan text or production code changed).

## User Setup Required

None - no external service configuration required.

## Next Phase Readiness

- The full closed loop is now proven end to end: an agent's own `report_summary` tool call
  (04-03) reaches the database through the reader loop (this plan), and the next session's
  prompt tells the agent, by exact tool name, to close the same way and echo the decision ids it
  saw (this plan) — the agent-authored path is now the common case the fallback synthesizer
  (04-02) exists to cover only when it is absent.
- `changed_files`/`diff_ref` still land empty/`None` on the fallback path (04-02's own reserved
  fill-in for plan 04-07's real `git diff --name-only` helper); this plan's agent-authored path
  already carries real `changed_files` and leaves `diff_ref` `None` by design (filled at
  packet-assembly time by a later plan, not here).
- `CTX-01` is declared by five plans in this phase (04-01, 04-02, 04-03, 04-06, 04-09); it stays
  `Pending` in REQUIREMENTS.md until the last of them lands a SUMMARY — expected, not a gap.
- No blockers for the next plan.

---
*Phase: 04-clear-is-free*
*Completed: 2026-09-23*

## Self-Check: PASSED

- FOUND: packages/core/src/domain/session_summary.rs
- FOUND: packages/core/tests/summary_report_wire.rs
- FOUND: packages/desktop/src-tauri/src/sidecar.rs
- FOUND: packages/desktop/src-tauri/src/commands/agent_run.rs
- FOUND: packages/core/src/context_packet.rs
- FOUND commit df04e4d in git log
- FOUND commit f2a99b5 in git log
- FOUND commit f644658 in git log
- `cargo test -p core --test summary_report_wire`: 12 passed, 0 failed
- `cargo test -p core --test context_packet`: 10 passed, 0 failed
- `cargo test -p core --test session_summary_lifecycle`: 15 passed, 0 failed
- `cargo build --workspace`: clean
- `cargo test --workspace`: every suite reports 0 failed (verified via full log)
