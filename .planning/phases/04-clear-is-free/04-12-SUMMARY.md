---
phase: 04-clear-is-free
plan: 12
subsystem: context-reconstitution
tags: [rust, react, drift-detection, activity-trail, recovery-signal, launch-sheet, ctx-06]

requires:
  - phase: 04-clear-is-free
    provides: "04-11's drift::DriftWarning/DriftKind/detect_drift and
      commands::agent_run::packet_extras_for, which computes this plan's PacketExtras.drift from
      the same git reads the diff section already fetches"
provides:
  - "domain::agent_run::record_drift_warnings — one events row per fired drift warning, inside
    the caller's own transaction, called from agent_run_start only"
  - "query::recovery's third UNION arm: a task whose most recent run carries a drift.detected
    event joins the existing missing-worktree/unacknowledged-abandoned-run needs-you union"
  - "DriftWarningDto (Rust + TypeScript) and LaunchSheet.tsx's DriftWarningSection — the
    developer-facing half of the same warnings the agent's own rendered prompt carries"
affects: []

actuals:
  tokens: 10594
  tasks: 3
  commits: 3
  plan_head_before: 74e9530780a7685b465605e7996e286fbaee2d32

tech-stack:
  added: []
  patterns:
    - "A fired detector's durability is a transaction-composition property, not a stored verdict:
      record_drift_warnings takes a &Transaction (never opens its own), mirroring
      set_run_blocked/synthesize_fallback_summary — a rolled-back caller transaction leaves no
      drift trail at all, proven by a dedicated test rather than asserted by convention."
    - "A board-visible signal extends the EXISTING needs-you union as a new UNION arm with its own
      documented recency rule, rather than becoming a fourth badge or a second query. The module
      header now states three facts, each with a written reason for its own recency choice —
      arm 2 (abandoned runs) deliberately ignores recency, arm 3 (drift) deliberately requires it,
      and both reasons are recorded next to the SQL rather than left implicit."
    - "The developer-facing half of an agent-facing signal is a straight DTO mirror of the same
      Rust struct the prompt renderer already reads (drift::DriftWarning -> DriftWarningDto),
      never a second TypeScript-side derivation — one sentence, composed once, rendered on three
      surfaces (packet, activity trail, launch sheet) that can never disagree."

key-files:
  created: []
  modified:
    - packages/core/src/domain/agent_run.rs
    - packages/core/src/query/recovery.rs
    - packages/core/tests/drift.rs
    - packages/desktop/src-tauri/src/commands/agent_run.rs
    - packages/desktop/src/adapters/tauri.ts
    - packages/desktop/src/launch-sheet/LaunchSheet.tsx
    - packages/desktop/src/launch-sheet/__tests__/launch-sheet.test.tsx

key-decisions:
  - "record_drift_warnings resolves task_id AND project_id from the agent_runs row in one query
    (mirroring the existing close_agent_run_in_tx/record_lock_exhaustion shape), rather than a
    two-query task_id-then-project_id chase through tasks — the row already carries both columns."
  - "The drift event's kind travels as the exact string DriftKind's own Serialize impl would
    already produce for a fieldless enum (its Debug-formatted variant name, e.g.
    'ClaimedFilesMismatch') — confirmed against a live serde_json::to_value call rather than
    assumed, so the payload's 'kind' field and any future DTO reading it agree with serde's
    actual wire behaviour without a second, hand-maintained mapping."
  - "The recovery arm's 'most recent run' is a correlated subquery ordered started_at DESC, id
    DESC LIMIT 1 (the ULID id as a deterministic tie-break for runs started in the same instant),
    joined against events.stream_id = agent_runs.id AND event_type = 'drift.detected' via EXISTS
    — a single compile-time literal string with the project id as the only bound parameter,
    matching this file's own discipline for the two existing arms."
  - "DriftWarningSection reuses --destructive-text-rack — the same warning role
    RunsSection.tsx/ProjectRail.tsx/recovery surfaces already spend on
    abandoned/worktree-missing/recovery-needed — rather than introducing a dedicated 'warning'
    token. No new colour role, no hex literal, and the visual vocabulary agent-signal surfaces
    already established for 'something needs attention, nothing is blocked' extends cleanly to
    drift."
  - "agent_run_start's drift-event write is its own small transaction (open, write, commit),
    separate from start_agent_run's own already-committed run-creation transaction — the packet
    (and therefore the drift) cannot be computed until the worktree is real, which only exists
    after start_agent_run returns, so the two writes cannot share one literal transaction without
    restructuring start_agent_run itself. record_drift_warnings' own atomicity (proven by the
    rolled-back-transaction test) is what makes the drift trail itself all-or-nothing; it is not
    merged into the run-row insert."

patterns-established:
  - "Fact-based board signal, third arm: query/recovery.rs's module header now documents THREE
    outstanding-item facts, each with its own recency rule and its own stated reason — the
    template future needs-you contributors (a fourth arm, a fifth) should follow rather than
    inventing a parallel signal or a new badge."

requirements-completed: [CTX-06]

coverage:
  - id: D1
    description: "Starting a run whose briefing carries fired drift warnings appends one
      drift.detected events row per warning, worded exactly as the agent was shown; a run with no
      warnings appends none; opening the launch sheet (agent_run_preview) writes nothing at all"
    requirement: CTX-06
    verification:
      - kind: unit
        ref: "tests/drift.rs#record_drift_warnings_appends_one_drift_detected_event_per_warning"
        status: pass
      - kind: unit
        ref: "tests/drift.rs#record_drift_warnings_with_an_empty_slice_appends_nothing_and_returns_zero"
        status: pass
      - kind: unit
        ref: "tests/drift.rs#assembling_a_packet_with_drift_warnings_writes_no_events_row_mirroring_a_preview"
        status: pass
      - kind: unit
        ref: "tests/drift.rs#record_drift_warnings_events_render_the_exact_sentence_the_agent_was_shown"
        status: pass
      - kind: unit
        ref: "tests/drift.rs#record_drift_warnings_in_a_rolled_back_transaction_leaves_no_trace"
        status: pass
      - kind: other
        ref: "grep -v '^[[:space:]]*//' packages/desktop/src-tauri/src/commands/agent_run.rs | grep -c 'record_drift_warnings' == 1"
        status: pass
      - kind: integration
        ref: "packages/desktop/src-tauri/src/commands/agent_run.rs#build_preview_dto_performs_no_insert_update_or_delete (extended with an events row count)"
        status: pass
    human_judgment: false
  - id: D2
    description: "A task whose most recent run drifted joins the existing needs-you union
      (Needs Decision pill + project rail count) through the same signal Phase 3 built, and the
      signal clears itself the moment the next run comes back clean — no acknowledge action"
    requirement: CTX-06
    verification:
      - kind: unit
        ref: "tests/drift.rs#a_task_whose_latest_run_drifted_appears_in_the_recovery_set"
        status: pass
      - kind: unit
        ref: "tests/drift.rs#a_task_whose_latest_run_is_clean_does_not_appear_even_though_an_earlier_run_drifted"
        status: pass
      - kind: unit
        ref: "tests/drift.rs#a_task_with_both_a_missing_worktree_and_a_drift_signal_appears_exactly_once"
        status: pass
      - kind: unit
        ref: "tests/drift.rs#a_project_with_only_clean_runs_reports_zero_recovery_items"
        status: pass
      - kind: unit
        ref: "tests/drift.rs#count_and_ids_agree_when_drift_is_mixed_with_the_other_recovery_facts"
        status: pass
      - kind: other
        ref: "grep -v '^[[:space:]]*//' packages/core/src/query/recovery.rs | grep -c 'UNION ALL' == 0"
        status: pass
      - kind: integration
        ref: "cargo test -p core --test recovery_summary (7/7, the pre-existing two-arm contract unregressed)"
        status: pass
    human_judgment: false
  - id: D3
    description: "The launch sheet shows the same fired-detector sentences the agent receives, at
      the top of the briefing, and the Start Work control stays enabled and fires immediately —
      no acknowledgement, no colour hex literal, no new warning role"
    requirement: CTX-06
    verification:
      - kind: unit
        ref: "src/launch-sheet/__tests__/launch-sheet.test.tsx#renders both warning sentences verbatim, above the epic section, when the packet carries two"
        status: pass
      - kind: unit
        ref: "src/launch-sheet/__tests__/launch-sheet.test.tsx#renders no warning section when the packet carries none"
        status: pass
      - kind: unit
        ref: "src/launch-sheet/__tests__/launch-sheet.test.tsx#keeps the primary action enabled when the packet carries warnings"
        status: pass
      - kind: unit
        ref: "src/launch-sheet/__tests__/launch-sheet.test.tsx#fires the start call immediately on activation, with no confirmation in between"
        status: pass
      - kind: other
        ref: "grep -cE '#[0-9a-fA-F]{3,8}\\b' packages/desktop/src/launch-sheet/LaunchSheet.tsx == 0"
        status: pass
    human_judgment: false
  - id: D4
    description: "The full Rust workspace and desktop test suites, plus the TypeScript build, stay
      green after these changes"
    verification:
      - kind: other
        ref: "cargo test --workspace (exit 0, no FAILED lines, including the two previously-flaky worktree_lifecycle tests passing this run)"
        status: pass
      - kind: other
        ref: "npm --prefix packages/desktop run test (457 passed, 32 files)"
        status: pass
      - kind: other
        ref: "npm --prefix packages/desktop run build (clean)"
        status: pass
    human_judgment: false

duration: 20min
completed: 2026-09-23
status: complete
---

# Phase 4 Plan 12: A Fired Drift Detector Is Told, Not Enforced — Trail, Board Signal, Launch Sheet Summary

**A fired drift detector now leaves one activity-trail event per warning (worded exactly as the agent saw it), joins the existing needs-you union as a third UNION arm with its own recency rule, and shows on the launch sheet above the epic section — all without a new lifecycle, a new badge, or anything that blocks Start Work.**

## Performance

- **Duration:** 20 min
- **Started:** 2026-09-23T05:27:13Z (approx., following plan 04-11's completion)
- **Completed:** 2026-09-23T05:47:02Z
- **Tasks:** 3
- **Files modified:** 7

## Accomplishments

- `packages/core/src/domain/agent_run.rs`: `record_drift_warnings(tx, agent_run_id, warnings,
  actor_id, now)` — one `events` row per fired warning (stream type `drift`, event type
  `drift.detected`), inside the CALLER's own transaction, carrying the warning's `kind` and its
  exact `sentence` under both `"sentence"` and `"label"` so `render_description` renders the same
  words the agent read. An empty slice appends nothing and returns `0` without touching the
  database at all.
- `packages/desktop/src-tauri/src/commands/agent_run.rs`'s `agent_run_start` calls
  `record_drift_warnings` exactly once, right after the drift-bearing packet is re-assembled and
  before the spawn request — never from `agent_run_preview`/`build_preview_dto`, which stays
  write-free (asserted by both a single-call-site grep gate and an extended row-count test).
- `packages/core/src/query/recovery.rs`: a third `UNION` arm on `RECOVERY_TASK_IDS_SQL` and
  `RECOVERY_COUNT_SQL` — the task ids whose *most recent* `agent_runs` row carries a
  `drift.detected` event. Documented as a deliberate recency divergence from the abandoned-run arm
  (which intentionally ignores recency): a drift warning is a statement about the *current*
  board/repo relationship, so only the latest run's own drift events count, and the signal clears
  itself the instant the next run comes back clean.
- No desktop-layer UI change was needed for the board signal: `BoardRow.tsx`'s Needs Decision pill
  and `ProjectRail.tsx`'s rail count already read `board_recovery_summary`, which delegates
  straight to the two functions above — confirmed by reading both call sites rather than assumed.
- `DriftWarningDto` (Rust `commands/agent_run.rs` + TypeScript `adapters/tauri.ts`) mirrors
  `flywheel_core::drift::DriftWarning`; `ContextPacketDto.drift` is populated in the single
  existing `From<ContextPacket>` conversion from the same `PacketExtras.drift` the rendered
  prompt's own `## Warnings` section already carries.
- `LaunchSheet.tsx`'s `DriftWarningSection` renders each sentence verbatim, first inside the
  packet body (above the epic section) — reusing `--destructive-text-rack`, the existing
  agent-signal warning role already spent on `worktree-missing`/`recovery-needed`/`abandoned`.
  Purely informational: no button, no acknowledgement, no colour hex literal; Start Work stays
  enabled and fires immediately on activation.
- 14 new tests total: 10 in `packages/core/tests/drift.rs` (5 for the durable trail, 5 for the
  recovery-union arm) and 4 in `launch-sheet.test.tsx`.

## Task Commits

Each task was committed atomically:

1. **Task 1: A fired detector becomes an event — once per run, never on a preview** - `e063b65` (feat)
2. **Task 2: The board says so — drift as a third needs-you fact, not a fourth badge** - `8fe171a` (feat)
3. **Task 3: The developer sees the same sentences the agent was given** - `57c78a7` (feat)

**Plan metadata:** commit follows this SUMMARY.

## Files Created/Modified

- `packages/core/src/domain/agent_run.rs` - `record_drift_warnings`
- `packages/core/src/query/recovery.rs` - third `UNION` arm on both SQL constants, extended
  module header documenting the recency-divergence reasoning
- `packages/core/tests/drift.rs` - 10 new tests (5 Task 1, 5 Task 2), on top of 04-11's 20
- `packages/desktop/src-tauri/src/commands/agent_run.rs` - `DriftWarningDto`,
  `ContextPacketDto.drift`, the `record_drift_warnings` call site in `agent_run_start`, an
  `events` row-count assertion added to the existing preview-purity test
- `packages/desktop/src/adapters/tauri.ts` - `DriftWarningDto`, `ContextPacketDto.drift`
- `packages/desktop/src/launch-sheet/LaunchSheet.tsx` - `DriftWarningSection`, mounted first in
  `PacketBody`
- `packages/desktop/src/launch-sheet/__tests__/launch-sheet.test.tsx` - `drift: []` default in
  `makePacket`, 4 new tests

## Decisions Made

See `key-decisions` in the frontmatter above — summarised: (1) `record_drift_warnings` resolves
`task_id`/`project_id` from `agent_runs` in one query, (2) the event's `kind` uses the exact
string `DriftKind`'s own `Serialize` impl would produce, confirmed live rather than assumed, (3)
"most recent run" in the recovery arm is a correlated subquery with a ULID tie-break, (4) the
launch sheet's warning section reuses the existing `--destructive-text-rack` role rather than
inventing one, (5) the drift-event write is its own small transaction, separate from
`start_agent_run`'s already-committed run-creation transaction, since the drift-bearing packet
cannot be computed until after the worktree (and therefore the run) exists.

## Deviations from Plan

None - plan executed exactly as written. The plan's own Task 2 action text anticipated that "no UI
edit was needed" and asked for that to be confirmed by reading the call sites rather than assumed;
that confirmation is recorded above and no `BoardRow.tsx`/`ProjectRail.tsx` edit was made.

## Issues Encountered

None.

## User Setup Required

None - no external service configuration required.

## Next Phase Readiness

- D-72 through D-75 and CTX-06 are now fully closed end to end: a fired detector reaches the
  agent (plan 04-11), the activity trail, the project rail count, the board row pill, and the
  launch sheet, all in one sentence composed once and never re-worded on any surface.
- CTX-06 was declared by three plans in this phase (04-10, 04-11, 04-12); with this plan's own
  SUMMARY now on disk, `requirements.ready-ids` reports it ready to mark complete.
- Nothing about a drift warning blocks Start Work anywhere in the stack — asserted structurally by
  tests at every layer (the domain write, the SQL union, and the rendered launch sheet), not left
  as a convention to remember.
- No blockers for the next plan.

---
*Phase: 04-clear-is-free*
*Completed: 2026-09-23*
