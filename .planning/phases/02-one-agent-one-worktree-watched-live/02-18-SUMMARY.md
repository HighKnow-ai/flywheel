---
phase: 02-one-agent-one-worktree-watched-live
plan: 18
subsystem: infra
tags: [sqlite, tauri, sidecar, agent-runtime, tokens, gap-closure]

requires:
  - phase: 02-one-agent-one-worktree-watched-live
    provides: the sidecar reader loop's stderr/Terminated/Error observation and readiness handshake (02-15), the session feed's row-clamping/expand pattern (02-16), and SessionClosedEvent.detail plus the verified --verbose argv and system_notice classification (02-17) — this plan's token fields are the next change to the same SessionClosedEvent interface 02-17 left in place
provides:
  - "the missing production call site for close_agent_run — a run that ends on its own (completed or failed) is now recorded on the board as ended, with an end time, its cost and its token counts"
  - "apply_session_closed, the terminal-event applier owning the idempotency decision that protects an explicit Stop from being overwritten by a later terminal event"
  - "token usage carried once, as a session total, from the backend's terminal result line onto the result and session_closed events — tokens_in is the SUM of the three input-side usage fields, never the misleading plain field alone"
  - "a real-sidecar lifecycle test and a falsifiable source-scanning gate on the reader-loop call site itself, proving the gap two independent ways"
affects: []

actuals:
  tokens: 12416
  tasks: 3
  commits: 3

tech-stack:
  added: []
  patterns:
    - "A terminal-event applier (apply_session_closed) owns the idempotency decision (never overwrite an already-terminal row, but backfill an empty cost/token column) as a plain, Tauri-free function returning an enum outcome — mirroring PermissionRequestOutcome's own split between DB-only decision logic and the Tauri-facing handler that performs the IPC-adjacent side effect."
    - "A session-total figure (cost, tokens) is carried on the terminal event and written ONCE from it, never accumulated per message — the backend's own result.usage block is the authoritative session total, and re-adding a cached-read component every turn would overcount a multi-turn session by whatever its cached prefix costs."
    - "tokens_in is a SUM over three usage fields (input_tokens + cache_creation_input_tokens + cache_read_input_tokens), computed by a small helper that reads each field independently and returns undefined — never a fabricated zero — when a field is absent."

key-files:
  created:
    - packages/core/tests/session_close_lifecycle.rs
    - packages/core/tests/session_closed_call_site.rs
  modified:
    - packages/sidecar/src/adapter.ts
    - packages/sidecar/src/claude-code-adapter.ts
    - packages/sidecar/test/fake-claude.mjs
    - packages/core/src/domain/agent_run.rs
    - packages/desktop/src-tauri/src/commands/agent_run.rs
    - packages/desktop/src-tauri/src/sidecar.rs
    - packages/desktop/src/session/SessionSurface.tsx

key-decisions:
  - "Token counts are written ONCE from the terminal result event's summed usage, never accumulated per message — measured against the real CLI during this plan's planning: the plain input_tokens field alone read 2 for a turn that consumed roughly 33,000 input tokens once cache creation and cache reads are counted."
  - "The idempotency guard against overwriting an explicit Stop lives in the new caller (apply_session_closed), not inside close_agent_run itself — close_agent_run's own body and signature are unchanged, since it was already correct and thoroughly unit-tested; what was missing was a caller, not a change to its contract."
  - "An already-terminal run whose incoming terminal event carries a figure an empty column was missing gets that figure backfilled via a targeted UPDATE ... COALESCE, without touching status or ended_at and without appending a second terminal event — the cost the run actually incurred is still worth recording even when the status write itself must not happen again."
  - "D-29 is restated a second time in agent_run.rs's own module doc comment, explicitly correcting 02-UAT.md's earlier (now-corrected) impact note: nothing in this module — including the new apply_session_closed — ever moves a task out of in_progress."

requirements-completed: [DATA-06, PROC-06, AGNT-01, AGNT-02]

coverage:
  - id: D1
    description: "A run that ends on its own — completed or failed — is recorded on the board as ended, with an end time, its cost and its token counts"
    requirement: "DATA-06"
    verification:
      - kind: integration
        ref: "packages/core/tests/session_close_lifecycle.rs#a_session_driven_to_natural_completion_reaches_a_terminal_status"
        status: pass
      - kind: unit
        ref: "cargo test -p core (8 tests) — 0 failures"
        status: pass
    human_judgment: false
  - id: D2
    description: "The terminal event the sidecar already emits has a production consumer: the reader loop maps it onto the agent_runs row"
    requirement: "PROC-06"
    verification:
      - kind: integration
        ref: "packages/core/tests/session_closed_call_site.rs#the_reader_loop_dispatches_the_terminal_event_to_the_handler"
        status: pass
      - kind: unit
        ref: "packages/core/tests/session_closed_call_site.rs#a_fixture_without_the_dispatch_trips_the_gate (falsifiability case)"
        status: pass
    human_judgment: false
  - id: D3
    description: "A run the user explicitly stopped keeps the terminal status the stop path wrote — a later terminal event never overwrites it and never appends a second terminal event — while the cost the run actually incurred is still recorded"
    requirement: "AGNT-01"
    verification:
      - kind: integration
        ref: "packages/core/tests/session_close_lifecycle.rs#a_terminal_event_never_overwrites_an_explicit_stop"
        status: pass
    human_judgment: false
  - id: D4
    description: "The session header's token counters read the same authoritative figure the board row is written from, so the board and the surface can never disagree about what a run cost"
    requirement: "AGNT-02"
    verification:
      - kind: unit
        ref: "npm --prefix packages/sidecar test (38/38 passing) — ResultEvent/SessionClosedEvent.result carry inputTokens/outputTokens at the top level, the exact fields StatusStrip's latestNumericField already scans"
        status: pass
      - kind: other
        ref: "SessionSurface.tsx diff for this task is comment-only (git diff confirms zero code lines changed) — the field-name alias already present is precisely why no renderer change was needed"
        status: pass
    human_judgment: true
    rationale: "The header flipping from an em-dash to the real figures the moment a real session's result line arrives is a rendering behavior no automated test in this repository drives end-to-end through a mounted SessionSurface against a live sidecar; the field-carrying contract and the absence of any renderer code change are both structurally proven, but seeing the header itself update live is a human-observable confirmation."
  - id: D5
    description: "A test drives a session to NATURAL completion through the real sidecar process and asserts the agent_runs row reaches a terminal status — a missing call site fails it, which asserting on close_agent_run alone never could"
    requirement: "AGNT-01"
    verification:
      - kind: integration
        ref: "packages/core/tests/session_close_lifecycle.rs#a_session_driven_to_natural_completion_reaches_a_terminal_status (spawns packages/sidecar/dist/index.js as a real child process)"
        status: pass
    human_judgment: false

duration: 20min
completed: 2026-09-11
status: complete
---

# Phase 2 Plan 18: The Terminal Event Gets Its Production Caller (G-02-4) Summary

**Closed gap G-02-4: `close_agent_run` now has a real production caller — `apply_session_closed`, dispatched from the sidecar reader loop's `session_closed` branch — so a run that ends on its own is recorded on the board as ended, with an end time, its cost, and token counts summed correctly from the backend's own usage block; proven by a real-sidecar lifecycle test and a falsifiable source gate on the call site itself.**

## Performance

- **Duration:** 20 min (approx.)
- **Started:** 2026-09-11T09:28:00Z (approx.)
- **Completed:** 2026-09-11T09:48:48Z
- **Tasks:** 3
- **Files modified:** 9 (2 created, 7 modified)

## Accomplishments

- `packages/sidecar/src/adapter.ts` and `claude-code-adapter.ts`: `ResultEvent` and `SessionClosedEvent.result` gained top-level `inputTokens`/`outputTokens`. `normaliseStreamEvent`'s result branch now sums the three input-side usage fields (`input_tokens` + `cache_creation_input_tokens` + `cache_read_input_tokens`) into `inputTokens` — never the plain field alone, which read 2 for a turn that actually consumed ~33,000 input tokens once cache creation/reads are counted (measured live against the real CLI during this plan's planning). A missing usage field stays absent, never a fabricated zero. `fake-claude.mjs`'s two result lines now carry a fixed usage block (`input_tokens: 2, cache_creation_input_tokens: 30, cache_read_input_tokens: 400, output_tokens: 7`) whose three input-side values sum (432) to no single one of them, so a regression recording only one field cannot pass by accident.
- `packages/core/src/domain/agent_run.rs`: added `SessionClosedOutcome` (`Closed`, `AlreadyTerminal`, `BackfilledTerminal`, `UnknownRun`, `Ignored`) and `apply_session_closed` — the missing production caller `close_agent_run` never had. Rejects a malformed run id via `is_ulid` before any query; maps the event's `reason` to a status, ignoring any unrecognised value; and, for a run already in a terminal status (the explicit-Stop case), never overwrites the status or end time and never appends a second terminal event, while backfilling an empty cost/token column via a targeted `UPDATE ... COALESCE` when the incoming event carries a figure the row was missing. `close_agent_run`'s own body and signature are byte-for-byte unchanged. The module doc comment restates D-29 a second time, explicitly correcting the direction of 02-UAT.md's earlier (now-corrected) impact note.
- `packages/desktop/src-tauri/src/commands/agent_run.rs` and `sidecar.rs`: added `handle_inbound_session_closed`, the Tauri-facing half mirroring `handle_inbound_permission_request` — panic-free, silent no-op on any fault (no `expect`/`unwrap`/`panic!` in its region), emitting `board:changed` only when the outcome actually changed the row. The reader loop now dispatches `session_closed` events to it, directly below the existing `permission_request` dispatch, after both the persist call and the renderer emit — so a fault in the database write can never delay or suppress the live event the user is watching.
- `packages/desktop/src/session/SessionSurface.tsx`: comment-only update to `latestNumericField`'s doc comment — it now documents that the backend reports session totals once, on its terminal result event, as top-level fields this scan already looks for, so the header legitimately reads "—" for the duration of a running session and flips to real figures the moment the backend reports them. Zero code lines changed; the field-name alias was already correct.
- `packages/core/tests/session_close_lifecycle.rs` (new): spawns the real `packages/sidecar/dist/index.js` (asserted present with a build-command message, not skipped) driving `fake-claude.mjs`, writes a real spawn request over stdin, and feeds every emitted event through `apply_session_closed` exactly as the reader loop does. Asserts the `agent_runs` row reaches `completed` with an end time, `cost_usd = 0.0021`, `tokens_in = 432` (the SUMMED value — a regression recording only the plain field would read 2 and fail this exact assertion), `tokens_out = 7`, exactly one terminal event row, and the owning task still `in_progress`. Also covers the explicit-Stop overwrite guard and the unknown/malformed run id cases directly against the applier (no child process needed for those).
- `packages/core/tests/session_closed_call_site.rs` (new): a source-scanning gate following `app_exit_ordering.rs`'s idiom — reads the real `sidecar.rs` from disk, strips whole-line comments, and asserts the reader-loop region names both `session_closed` and `handle_inbound_session_closed`, with the handler call after the renderer emit. A falsifiability test proves the gate's own matching logic rejects a missing call, a commented-out call, and a reordered call.

## Task Commits

Each task was committed atomically:

1. **Task 1: Carry what the run cost onto the event that says it ended** - `03781d9` (feat)
2. **Task 2: Give the terminal event the production caller it never had** - `32a3dae` (feat)
3. **Task 3: Prove it against a real sidecar, and gate the call site itself** - `f83777d` (test)

_This plan's tasks carried `tdd="true"` in the plan frontmatter, but `workflow.tdd_mode` is not enabled in `.planning/config.json` for this project — matching this same phase's 02-15/02-16/02-17 precedent — so each task landed as a single commit following this repository's standard one-commit-per-task convention rather than a strict RED/GREEN/REFACTOR gate sequence._

## Files Created/Modified

- `packages/sidecar/src/adapter.ts` - `ResultEvent`/`SessionClosedEvent.result` gain top-level `inputTokens`/`outputTokens`
- `packages/sidecar/src/claude-code-adapter.ts` - `ClaudeStreamUsage`, `optionalUsageNumber`, `summedInputTokens`; `normaliseStreamEvent`'s result branch computes and carries the two counts; `LiveSession.lastResult` widened
- `packages/sidecar/test/fake-claude.mjs` - both result lines now carry a fixed, distinct-summed usage block
- `packages/core/src/domain/agent_run.rs` - `SessionClosedOutcome`, `apply_session_closed`; module doc comment restates D-29
- `packages/desktop/src-tauri/src/commands/agent_run.rs` - `handle_inbound_session_closed`
- `packages/desktop/src-tauri/src/sidecar.rs` - reader-loop dispatch to the new handler
- `packages/desktop/src/session/SessionSurface.tsx` - comment-only doc update on `latestNumericField`
- `packages/core/tests/session_close_lifecycle.rs` - new; real-sidecar natural-completion, overwrite-guard, and unknown/malformed-id tests
- `packages/core/tests/session_closed_call_site.rs` - new; falsifiable source-scanning gate on the reader-loop call site

## Decisions Made

See `key-decisions` in the frontmatter above.

## Deviations from Plan

None - plan executed exactly as written.

## Issues Encountered

None.

## User Setup Required

None - no external service configuration required.

## Next Phase Readiness

- G-02-4 is closed: all three of its `missing:` items exist — `session_closed` is now handled in the sidecar reader loop and maps onto the run's row with the mapped status, cost and token usage; the token-accounting question is decided (summed once from the terminal result) and reflected in the header via a comment-only change; and a test drives a session to natural completion through the real sidecar, asserting the `agent_runs` row reaches a terminal status, backed by a falsifiable source gate on the call site itself.
- No code path in this plan moves a task out of `in_progress` — D-29 holds, verified by the lifecycle test's own assertion and by `handle_inbound_session_closed`/`apply_session_closed` never touching `tasks.status`.
- This was the last plan in Phase 02's wave 3 gap-closure round (G-02-1 through G-02-4). Ready for `/gsd-verify-work 2` to resume UAT testing from test 1.

---
*Phase: 02-one-agent-one-worktree-watched-live*
*Completed: 2026-09-11*

## Self-Check: PASSED

All key files confirmed present on disk (`adapter.ts`, `claude-code-adapter.ts`, `fake-claude.mjs`, `agent_run.rs` (core), `agent_run.rs` (commands), `sidecar.rs`, `SessionSurface.tsx`, `session_close_lifecycle.rs`, `session_closed_call_site.rs`, this SUMMARY). All three task commits (`03781d9`, `32a3dae`, `f83777d`) confirmed present in `git log`. All acceptance criteria and the plan-level `<verification>` block re-run and passing: `cargo build --workspace` exits 0; `cargo test --workspace` reports 0 failures across every crate; `cargo test -p core --test session_close_lifecycle` reports 3/3 passing; `cargo test -p core --test session_closed_call_site` reports 2/2 passing; `npm --prefix packages/sidecar test` reports 38/38 passing; `npm --prefix packages/desktop run test` reports 312/312 passing; `npm --prefix packages/desktop run build` exits 0 with no `error TS` diagnostics; a non-comment line of `sidecar.rs` calls `handle_inbound_session_closed`; a non-comment line of `agent_run.rs` calls `close_agent_run(` (2 occurrences: definition + the new call site); no panicking call exists inside `handle_inbound_session_closed`'s region; `is_ulid` appears on a non-comment line of `agent_run.rs`.
