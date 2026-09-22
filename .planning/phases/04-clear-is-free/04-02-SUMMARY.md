---
phase: 04-clear-is-free
plan: 02
subsystem: context-reconstitution
tags: [rusqlite, session-summaries, fallback, agent-runs, sqlite-transaction]

requires:
  - phase: 04-clear-is-free
    provides: "session_summaries table, create_summary/list_summaries_for_task/latest_summary_for_run
      (plan 04-01), and the one-transaction row-write-plus-event pattern this plan's
      insert_summary_row factors out of create_summary"
provides:
  - "domain::session_summary::synthesize_fallback_summary — a best-effort, board-facts-only summary
    for a run that reaches a terminal state with no agent-recorded one"
  - "domain::session_summary::insert_summary_row — the single shared INSERT site both
    create_summary and synthesize_fallback_summary write through"
  - "apply_session_closed's own transaction, covering both the status write
    (close_agent_run_in_tx) and the fallback-summary presence check, so a run can never be
    terminal while its fallback summary is missing"
affects: [04-03, 04-05, 04-07, 04-08, 04-09, 04-14]

actuals:
  tokens: 8583
  tasks: 2
  commits: 2

tech-stack:
  added: []
  patterns:
    - "Shared single-insert-site refactor: insert_summary_row(tx, ...) factors the row-write-plus-
      event body out of create_summary so a second producer (synthesize_fallback_summary) can
      write through the identical path — a <verify> grep gate asserts exactly one INSERT INTO
      session_summaries in the whole crate"
    - "close_agent_run_in_tx(tx, ...): the same statement body as close_agent_run, callable inside
      a transaction the CALLER already owns — lets apply_session_closed cover the status write and
      the fallback-summary insert with one transaction instead of close_agent_run's own"

key-files:
  created: []
  modified:
    - packages/core/src/domain/session_summary.rs
    - packages/core/src/domain/agent_run.rs
    - packages/core/tests/session_summary_lifecycle.rs

key-decisions:
  - "insert_summary_row(tx: &Transaction, ...) is the ONE insert site create_summary and
    synthesize_fallback_summary both call — never two INSERT statements against
    session_summaries, enforced by a crate-wide grep <verify> gate"
  - "synthesize_fallback_summary's changed_prose/remains are built only from facts already in the
    database (close reason, the run's own started_at/ended_at, and a literal COUNT over the
    run's own events) — next_session_must_know stays None, decisions/acknowledged_decisions stay
    empty, diff_ref stays None, changed_files stays an empty Vec: the fallback never invents a
    claim it cannot ground in a fact the board already holds"
  - "close_agent_run_in_tx factors close_agent_run's statement body out so apply_session_closed can
    run it inside its OWN transaction alongside the summary-presence check — close_agent_run's
    public &mut Connection entry point is unchanged and, on its own, never synthesizes a fallback
    summary; only apply_session_closed's call site does"
  - "The event count synthesize_fallback_summary embeds in its prose counts rows whose stream_id
    names the run directly, OR whose task_id matches the run's own task within the run's own
    [started_at, ended_at] window — covering both the run's own bookkeeping/tool-call rows and a
    permission request raised during the run (which carries its own stream_id, not the run's)"

patterns-established:
  - "A run reaching a terminal state and a fallback summary existing for it are now the SAME
    database transaction, not two operations a crash could split — the property CTX-01 needs to
    be unconditional"

requirements-completed: []

coverage:
  - id: D1
    description: "A run that closes (interrupted/completed/failed) with no agent-recorded summary
      leaves exactly one summary row, flagged auto_generated, in the same transaction that made
      the run terminal"
    requirement: CTX-01
    verification:
      - kind: integration
        ref: "tests/session_summary_lifecycle.rs#apply_session_closed_interrupted_writes_a_fallback_summary_and_points_exit_summary_id_at_it"
        status: pass
      - kind: integration
        ref: "tests/session_summary_lifecycle.rs#apply_session_closed_behaves_identically_for_completed_and_failed"
        status: pass
    human_judgment: false
  - id: D2
    description: "A run whose agent already recorded a summary closes without a second, synthesized
      row being written"
    requirement: CTX-01
    verification:
      - kind: integration
        ref: "tests/session_summary_lifecycle.rs#apply_session_closed_never_synthesizes_a_second_summary_when_one_already_exists"
        status: pass
    human_judgment: false
  - id: D3
    description: "The fallback synthesizer never invents a claim: changed_files empty,
      next_session_must_know always None, decisions/acknowledged_decisions always empty, diff_ref
      always None, and a zero-event run still produces exactly one honest row"
    requirement: CTX-01
    verification:
      - kind: integration
        ref: "tests/session_summary_lifecycle.rs#fallback_summary_with_zero_matching_events_still_yields_one_honest_row"
        status: pass
      - kind: integration
        ref: "tests/session_summary_lifecycle.rs#fallback_summary_counts_the_runs_own_events_and_names_the_close_reason"
        status: pass
    human_judgment: false
  - id: D4
    description: "create_summary and synthesize_fallback_summary share exactly one INSERT INTO
      session_summaries site in the whole crate"
    verification:
      - kind: other
        ref: "grep -rv '^[[:space:]]*//' packages/core/src --include='*.rs' | grep -c 'INSERT INTO session_summaries' == 1"
        status: pass
      - kind: integration
        ref: "tests/session_summary_lifecycle.rs#create_summary_and_synthesize_fallback_summary_share_one_insert_site_and_stay_distinguishable"
        status: pass
    human_judgment: false

duration: 35min
completed: 2026-09-23
status: complete
---

# Phase 4 Plan 2: Fallback Session Summary Synthesizer Summary

**`synthesize_fallback_summary` writes a best-effort, board-facts-only summary the instant a run reaches a terminal state with none of its own, sharing one INSERT site with `create_summary` and running inside `apply_session_closed`'s own transaction so the status write and the fallback insert commit together or not at all.**

## Performance

- **Duration:** 35 min
- **Started:** 2026-09-23T07:31:40+08:00 (following plan 04-01)
- **Completed:** 2026-09-23T07:55:52+08:00
- **Tasks:** 2
- **Files modified:** 3

## Accomplishments

- `domain::session_summary::synthesize_fallback_summary(tx, agent_run_id, close_reason)`:
  a best-effort summary built ONLY from facts already in the database — the close reason,
  the run's own `started_at`/`ended_at`, and a literal `COUNT` over the run's events —
  attributed to the run's own agent actor, never the local human actor
- `insert_summary_row`, factored out of `create_summary`'s own insert-plus-event body, so
  both the agent-authored write path and the fallback write path share exactly one
  `INSERT INTO session_summaries` statement (a crate-wide grep `<verify>` gate proves it)
- `apply_session_closed` now owns one transaction covering both the run's status/`ended_at`
  write (`close_agent_run_in_tx`, the same statements as `close_agent_run`, factored out so
  it is callable inside a caller-owned transaction) and the fallback-summary presence check
  — a run can never reach a terminal status while its fallback summary is missing
- `close_agent_run`'s own public entry point is unchanged in signature and behavior; called
  alone (directly, not through `apply_session_closed`) it still never synthesizes a summary
  — that behavior belongs only to `apply_session_closed`'s call site

## Task Commits

Each task was committed atomically:

1. **Task 1: The synthesizer — a best-effort summary from facts the board already holds** - `4cf1206` (feat)
2. **Task 2: Every terminal run gets checked — the hook inside apply_session_closed** - `e643371` (feat)

## Files Created/Modified

- `packages/core/src/domain/session_summary.rs` - `insert_summary_row` (shared insert site),
  `synthesize_fallback_summary`, `FALLBACK_EVENT_COUNT_SQL`; `create_summary` now delegates
  to `insert_summary_row`
- `packages/core/src/domain/agent_run.rs` - `close_agent_run_in_tx` (statement body factored
  out of `close_agent_run`); `apply_session_closed`'s terminal-closing tail now owns one
  transaction covering the status write and the summary-presence check
- `packages/core/tests/session_summary_lifecycle.rs` - 10 new tests (5 per task): the
  synthesizer exercised directly (event counting, zero-event honesty, actor attribution,
  no-dedupe, shared-insert-site coexistence with `create_summary`), plus `apply_session_closed`
  exercised for all three close reasons, the already-recorded-summary no-op, the malformed-run-id
  no-op, and `close_agent_run`'s own unaffected direct-call behavior

## Decisions Made

- `insert_summary_row(tx: &Transaction, ...)` is the one shared insert site — `create_summary`
  opens its own transaction and delegates; `synthesize_fallback_summary` runs inside the
  caller's transaction and delegates identically
- The fallback's `changed_prose`/`remains` are built only from database facts (close reason,
  timestamps, a literal event count); `next_session_must_know` is always `None`,
  `decisions`/`acknowledged_decisions` are always empty, `diff_ref` is always `None`,
  `changed_files` is always an empty `Vec` — resolving CONTEXT.md's open discretion item
  exactly as the plan's own action text specified
- `close_agent_run_in_tx` factors `close_agent_run`'s statement body out so
  `apply_session_closed` can run it inside its own transaction; `close_agent_run`'s public
  `&mut Connection` entry point delegates to it and is otherwise unchanged
- The fallback event count query counts rows whose `stream_id` names the run directly OR
  whose `task_id` matches the run's own task within `[started_at, ended_at]` — covering both
  the run's own bookkeeping/tool-call rows and events raised by other entities (like a
  permission request) during the run

## Deviations from Plan

None - plan executed exactly as written.

## Issues Encountered

None.

## User Setup Required

None - no external service configuration required.

## Next Phase Readiness

- CTX-01's fallback half is now unconditional: any run reaching `completed`/`failed`/`interrupted`
  always has exactly one summary row in the same transaction that made it terminal, whether the
  agent wrote one or not.
- Plan 04-03 (the agent's own `report_summary` board tool) is unaffected by and complementary to
  this plan — `latest_summary_for_run`'s presence check already treats an agent-recorded summary
  as authoritative and skips synthesis, so 04-03 only needs to write through `create_summary`
  exactly as it already does; no interface gap to close.
- Plan 04-07 has two explicit fill-ins reserved here: `changed_files`/`diff_ref` stay empty/`None`
  in this plan's fallback rows until the real `git diff --name-only` helper exists.
- `CTX-01` is declared by five plans in this phase (04-01, 04-02, 04-03, 04-06, 04-09); it stays
  `Pending` in REQUIREMENTS.md until the last of them lands a SUMMARY — expected and not a gap.
- No blockers for the next plan.

---
*Phase: 04-clear-is-free*
*Completed: 2026-09-23*

## Self-Check: PASSED

- FOUND: packages/core/src/domain/session_summary.rs
- FOUND: packages/core/src/domain/agent_run.rs
- FOUND: packages/core/tests/session_summary_lifecycle.rs
- FOUND commit 4cf1206 in git log
- FOUND commit e643371 in git log
- `cargo test -p core --test session_summary_lifecycle`: 15 passed, 0 failed
- `cargo test -p core --test session_close_lifecycle`: 3 passed, 0 failed
- `cargo test --workspace`: every suite reports 0 failed (verified via full log)
- `cargo build --workspace`: clean
