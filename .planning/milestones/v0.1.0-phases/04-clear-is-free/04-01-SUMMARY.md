---
phase: 04-clear-is-free
plan: 01
subsystem: context-reconstitution
tags: [rusqlite, session-summaries, context-packet, append-only, ulid, sqlite-migration]

requires:
  - phase: 03-safety-and-recovery
    provides: agent_runs/worktrees/permission_requests schema and the domain-layer
      one-transaction row-write-plus-event pattern (domain::permission_request::create_pending_request)
      this plan copies exactly
provides:
  - "session_summaries table (D-65's four content fields, decisions/acknowledged_decisions as JSON
    arrays, diff_ref, auto_generated) plus agent_runs.exit_summary_id"
  - "domain::session_summary::create_summary/list_summaries_for_task/latest_summary_for_run"
  - "ContextPacket.summaries and render_prompt's '## Prior Sessions' section"
  - "the end-to-end write-then-read-back proof plus the append-only/determinism structural proofs
    later plans in this phase build on"
affects: [04-02, 04-05, 04-07, 04-08, 04-09, 04-14]

actuals:
  tokens: 10352
  tasks: 2
  commits: 2

tech-stack:
  added: []
  patterns:
    - "One-transaction row-write-plus-event, copied verbatim from domain::permission_request::create_pending_request"
    - "Append-only-by-construction: the write path exposes no update/delete function; enforced with a grep gate over the whole crate, not a convention"
    - "Omit-the-heading-rather-than-emit-empty, extended to a fourth ContextPacket section (Prior Sessions)"

key-files:
  created:
    - packages/core/src/db/migrations/0008_session_summaries.sql
    - packages/core/src/domain/session_summary.rs
    - packages/core/tests/session_summary_lifecycle.rs
  modified:
    - packages/core/src/db/mod.rs
    - packages/core/src/domain/mod.rs
    - packages/core/src/context_packet.rs
    - packages/core/tests/context_packet.rs
    - packages/core/tests/destructive_classifier.rs

key-decisions:
  - "task_id/project_id/worktree_id are resolved from the agent_runs row inside create_summary's own transaction, never accepted as parameters (T-04-01) -- a caller cannot attribute a summary to a run it does not drive"
  - "exit_summary_id carries no REFERENCES clause (SQLite's ADD COLUMN forbids one); the referential rule is enforced at the single Rust write path instead, mirroring 0007_destructive_gate.sql's identical precedent for destructive_category"
  - "list_summaries_for_task/latest_summary_for_run use dedicated literal &str SQL consts rather than format!-composing a shared base string, keeping every statement in this module a literal bound through params![]"

patterns-established:
  - "Pattern: session_summaries append-only proof lives structurally (a grep gate over UPDATE/DELETE against the table name), not as a code-review convention -- future summary-touching plans (04-02's fallback synthesizer) inherit this gate for free"

requirements-completed: [CTX-01, CTX-02, CTX-03, CTX-04]

coverage:
  - id: D1
    description: "A summary written through create_summary is returned by the very next assemble_context_packet call for the same task and appears in render_prompt's rendered output"
    requirement: CTX-01
    verification:
      - kind: integration
        ref: "tests/session_summary_lifecycle.rs#a_summary_written_is_carried_by_the_next_context_packet"
        status: pass
      - kind: integration
        ref: "tests/session_summary_lifecycle.rs#a_task_with_zero_summaries_yields_an_empty_list_and_no_prior_sessions_heading"
        status: pass
    human_judgment: false
  - id: D2
    description: "Append-only is structurally true (no UPDATE/DELETE against session_summaries anywhere in the crate) and determinism holds with summaries present"
    requirement: CTX-02
    verification:
      - kind: integration
        ref: "tests/session_summary_lifecycle.rs#two_summaries_for_one_run_append_rather_than_replace"
        status: pass
      - kind: integration
        ref: "tests/session_summary_lifecycle.rs#ordering_is_stable_under_a_tied_created_at_timestamp"
        status: pass
      - kind: integration
        ref: "tests/session_summary_lifecycle.rs#the_auto_generated_flag_survives_the_round_trip_in_both_directions"
        status: pass
      - kind: integration
        ref: "tests/context_packet.rs#determinism_holds_with_summaries_present"
        status: pass
      - kind: other
        ref: "grep -rv '^\\s*//' packages/core/src --include=*.rs | grep -cE 'UPDATE\\s+session_summaries|DELETE\\s+FROM\\s+session_summaries' == 0"
        status: pass
    human_judgment: false

duration: 13min
completed: 2026-09-23
status: complete
---

# Phase 4 Plan 1: Session Summary Write-Through Tracer Summary

**D-65's four-field `session_summaries` table lands with a one-transaction domain write path, a `ContextPacket.summaries` read that carries every recorded row into the next assembled prompt, and a grep-enforced append-only guarantee — the phase's own proven tracer slice.**

## Performance

- **Duration:** 13 min
- **Started:** 2026-09-22T23:15:54Z
- **Completed:** 2026-09-22T23:29:15Z
- **Tasks:** 2
- **Files modified:** 8 (3 created, 5 modified)

## Accomplishments

- Migration `0008_session_summaries.sql`: `session_summaries` table with D-65's four content
  fields (`changed_files`, `changed_prose`, `remains`, `next_session_must_know`), plus
  `decisions`/`acknowledged_decisions` (JSON arrays, never a prose blob), `diff_ref`,
  `auto_generated`, and two indexes; `agent_runs.exit_summary_id` added via a plain `ALTER TABLE`
- `domain::session_summary`: `create_summary`/`list_summaries_for_task`/`latest_summary_for_run`,
  copying `permission_request::create_pending_request`'s one-transaction row-write-plus-event
  shape exactly; `task_id`/`project_id`/`worktree_id` resolved from the `agent_runs` row inside
  the transaction, never accepted as parameters (T-04-01)
- `ContextPacket.summaries` (`Vec<SummaryEntry>`) plus `render_prompt`'s `## Prior Sessions`
  section, omitted when the list is empty, marking any `auto_generated` block distinctly
- End-to-end tracer proof (`session_summary_lifecycle.rs`) plus determinism-with-summaries
  extension of the existing `context_packet.rs` determinism test
- Append-only made structurally checkable: a grep gate asserts no `UPDATE`/`DELETE` against
  `session_summaries` exists anywhere in `packages/core/src`

## Task Commits

Each task was committed atomically:

1. **Task 1: End-to-end — a summary written to the board is carried by the next context packet** - `6d12721` (feat)
2. **Task 2: Append-only is a property of the code, not a promise — plus determinism with summaries present** - `17fc84a` (test)

_No plan metadata commit required beyond these two — STATE.md/ROADMAP.md updates follow in this same session._

## Files Created/Modified

- `packages/core/src/db/migrations/0008_session_summaries.sql` - the `session_summaries` table and `agent_runs.exit_summary_id`
- `packages/core/src/db/mod.rs` - registers migration 0008 (append-only, after 0007)
- `packages/core/src/domain/mod.rs` - registers `pub mod session_summary;`
- `packages/core/src/domain/session_summary.rs` - `create_summary`/`list_summaries_for_task`/`latest_summary_for_run`, `SummaryFields`/`DecisionEntry`/`SessionSummary`
- `packages/core/src/context_packet.rs` - `SummaryEntry`, `ContextPacket.summaries`, `render_prompt`'s Prior Sessions section
- `packages/core/tests/session_summary_lifecycle.rs` - 5 tests: write-through, zero-summaries, append-not-replace, tied-timestamp ordering, auto_generated round trip
- `packages/core/tests/context_packet.rs` - `determinism_holds_with_summaries_present`
- `packages/core/tests/destructive_classifier.rs` - deviation fix (see below)

## Decisions Made

- `task_id`/`project_id`/`worktree_id` resolved from the `agent_runs` row inside `create_summary`'s own transaction, never accepted as caller parameters (T-04-01's spoofing mitigation)
- `exit_summary_id` carries no `REFERENCES` clause (SQLite's `ADD COLUMN` forbids one on a column referencing a table created earlier in the same migration run); the referential rule is enforced at the single Rust write path, mirroring `0007_destructive_gate.sql`'s identical precedent for `destructive_category`
- `list_summaries_for_task`/`latest_summary_for_run` each use their own literal `&str` SQL constant rather than a shared base string composed with `format!`, keeping every statement in the module a literal bound through `params![]`

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 1 - Bug] Fixed a stale destructive_classifier.rs test asserting exactly 7 migrations**
- **Found during:** Task 1 (`cargo test --workspace` verification)
- **Issue:** `migration_source_list_registers_the_destructive_gate_column_exactly_once_and_last` hardcoded `sources.len() == 7` and asserted migration `0007` was the last registered migration. Both became false the instant `0008_session_summaries.sql` was appended to the migration list — a direct consequence of this plan's own required change (`db/mod.rs` registration), not a pre-existing unrelated failure.
- **Fix:** Removed the length and last-migration-position assertions (renamed the test to `..._exactly_once`, dropping `_and_last`); kept the still-meaningful "exactly one migration adds `destructive_category`" assertion, which is independent of list length or position and does not need updating on every future migration.
- **Files modified:** `packages/core/tests/destructive_classifier.rs`
- **Verification:** `cargo test -p core --test destructive_classifier` — 76/76 passing; `cargo test --workspace` green.
- **Committed in:** `6d12721` (Task 1 commit)

---

**Total deviations:** 1 auto-fixed (1 bug fix, in-scope — directly caused by this plan's migration-list append)
**Impact on plan:** No scope creep; the fix only removes assertions this plan's own required change made false, and preserves the test's still-valid remaining assertion.

## Issues Encountered

None.

## User Setup Required

None - no external service configuration required.

## Next Phase Readiness

- The tracer slice holds end-to-end: `create_summary` → `assemble_context_packet` →
  `render_prompt` carries a written summary verbatim into the next session's prompt, with the
  append-only and determinism guarantees plan 04-02 (the fallback synthesizer) and later
  compaction/drift plans (04-05, 04-11) build directly on.
- `latest_summary_for_run` is already exposed for 04-02's "did this run already produce a
  summary" presence check — no interface gap to close before that plan starts.
- CTX-03's full scope (no byte of the assembled packet read from the session JSONL log) is
  primarily verified in plan 04-07 per the phase's probe ledger; this plan's
  `assemble_context_packet` purity contract (no model/network/git call, unchanged and
  re-asserted by the grep verification above) is the foundation that later verification builds on,
  not a redundant re-proof.
- No blockers for 04-02.

---
*Phase: 04-clear-is-free*
*Completed: 2026-09-23*

## Self-Check: PASSED

- FOUND: packages/core/src/db/migrations/0008_session_summaries.sql
- FOUND: packages/core/src/domain/session_summary.rs
- FOUND: packages/core/tests/session_summary_lifecycle.rs
- FOUND commit 6d12721 in git log
- FOUND commit 17fc84a in git log
