---
phase: 04-clear-is-free
plan: 15
subsystem: agent-runtime
tags: [sqlite, transactions, rust, rusqlite, tdd, gap-closure]

# Dependency graph
requires:
  - phase: 04-clear-is-free (plan 04-13)
    provides: "stop_agent_run_recording_first's fallback-summary composition (D-64) — the two-transaction shape this plan makes atomic"
  - phase: 04-clear-is-free (plan 04-02)
    provides: "close_agent_run_in_tx / apply_session_closed's single-transaction precedent (T-04-07) — the exact shape mirrored here for the interrupt variant"
provides:
  - "interrupt_agent_run_in_tx (core): the caller-transaction sibling of interrupt_agent_run, mirroring close_agent_run_in_tx"
  - "stop_agent_run_in_tx (desktop): the one-transaction Stop/Discard termination unit"
  - "A structural gate (termination_atomicity_call_site.rs) that goes red the instant a future edit reintroduces a non-atomic termination path"
affects: ["04-16 (CTX-06, shares this file's stop_agent_run_recording_first call site)", "any future terminal-status path (e.g. a summary contract added to mark_abandoned)"]

# Actuals (#2632)
actuals:
  tokens: 12312
  tasks: 3
  commits: 3

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "in-tx sibling pattern: a `pub fn foo_in_tx(tx: &Transaction, ...)` holding the statement body, with the connection-level `pub fn foo(conn: &mut Connection, ...)` reduced to open+delegate+commit — now used by both close_agent_run_in_tx/close_agent_run and interrupt_agent_run_in_tx/interrupt_agent_run"

key-files:
  created:
    - packages/core/tests/termination_atomicity_call_site.rs
  modified:
    - packages/core/src/domain/agent_run.rs
    - packages/desktop/src-tauri/src/commands/agent_run.rs
    - packages/core/tests/discard_lifecycle.rs

key-decisions:
  - "add-alongside (assumption_delta_decision): interrupt_agent_run_in_tx added beside close_agent_run_in_tx rather than promoting both into one terminate_agent_run_in_tx(tx, run_id, variant, ...) — the two variants differ in event type, payload label, which figures are written, and guard shape; a promoted function would need a real refactor of close_agent_run_in_tx, which is proven, heavily tested and explicitly out of this gap's scope."
  - "mark_abandoned is deliberately excluded from both the atomicity fix and the terminal-implies-summary contract test — it is a third terminal path 04-VERIFICATION.md does not name as a gap, and whether a reconciled-abandoned run owes the board a summary at all is a different question this gap-closure run has no mandate to answer."
  - "stop_agent_run_in_tx reads agent_runs.status AFTER interrupt_agent_run_in_tx's write, off the SAME &Transaction — never a separate connection-level read — so a synthesized fallback summary always records the terminal status, never the pre-terminal one."

requirements-completed: [CTX-01]

coverage:
  - id: D1
    description: "interrupt_agent_run_in_tx (core) — the caller-transaction sibling of interrupt_agent_run, mirroring close_agent_run_in_tx's shape"
    requirement: "CTX-01"
    verification:
      - kind: unit
        ref: "packages/core/tests/stop_lifecycle.rs (interrupt_agent_run's unchanged contract, re-run against the delegating body)"
        status: pass
      - kind: integration
        ref: "packages/core/tests/termination_atomicity_call_site.rs#interrupt_agent_run_in_tx_is_defined_and_referenced_by_its_connection_level_wrapper"
        status: pass
    human_judgment: false
  - id: D2
    description: "stop_agent_run_in_tx (desktop) — the Stop/Discard termination unit composed on ONE caller-owned transaction, and stop_agent_run_recording_first rewritten to open exactly one transaction around it"
    requirement: "CTX-01"
    verification:
      - kind: unit
        ref: "packages/desktop/src-tauri/src/commands/agent_run.rs#a_rolled_back_stop_leaves_the_run_running_with_no_summary_and_no_terminal_event"
        status: pass
      - kind: unit
        ref: "packages/desktop/src-tauri/src/commands/agent_run.rs#stop_records_interrupted_even_when_the_sidecar_never_acks"
        status: pass
      - kind: unit
        ref: "packages/desktop/src-tauri/src/commands/agent_run.rs#stop_twice_with_a_dead_sidecar_appends_exactly_one_interrupted_event"
        status: pass
    human_judgment: false
  - id: D3
    description: "The crash-window regression assertion and the terminal-implies-summary contract across both named terminal variants (natural close, Stop/Discard interrupt)"
    requirement: "CTX-01"
    verification:
      - kind: integration
        ref: "packages/core/tests/discard_lifecycle.rs#a_rolled_back_termination_unit_leaves_no_trace"
        status: pass
      - kind: integration
        ref: "packages/core/tests/discard_lifecycle.rs#a_terminal_transition_never_commits_without_a_summary"
        status: pass
    human_judgment: false
  - id: D4
    description: "A structural gate over the real desktop and core source proving the termination unit stays atomic against future edits"
    requirement: "CTX-01"
    verification:
      - kind: integration
        ref: "packages/core/tests/termination_atomicity_call_site.rs (6 tests, including 3 falsifiability companions)"
        status: pass
    human_judgment: false

duration: 55min
completed: 2026-09-23
status: complete
---

# Phase 04 Plan 15: Atomic Stop/Discard Termination Summary

**`interrupt_agent_run_in_tx` closes the crash window between a Stop/Discard's terminal write and its fallback summary by composing both on one caller-owned transaction, mirroring `close_agent_run_in_tx`'s existing atomic shape for the natural-close variant — with a structural gate that goes red if a future edit reopens it.**

## Performance

- **Duration:** 55 min
- **Tasks:** 3
- **Files modified:** 3 modified, 1 created

## Accomplishments

- `interrupt_agent_run_in_tx` (core): the caller-transaction sibling of `interrupt_agent_run`, holding the exact statement body between the old function's `conn.transaction()?` and its `tx.commit()`, with both early-return branches (unknown run, already-terminal) reduced to a plain `Ok(())`. `interrupt_agent_run` itself now delegates to it — signature byte-identical, `packages/core/tests/stop_lifecycle.rs` and `discard_lifecycle.rs`'s other tests are unaffected.
- `stop_agent_run_in_tx` (desktop): composes the core in-tx sibling with a presence-checked `synthesize_fallback_summary` call, both on the SAME `&Transaction`. The status read happens AFTER the terminal write, off the same `tx`, so a synthesized fallback always records the status the run actually reached.
- `stop_agent_run_recording_first` rewritten to open exactly ONE `conn.transaction()` around `stop_agent_run_in_tx` — the connection-level `interrupt` call and the second, independent fallback transaction are both gone.
- A rollback regression test (`a_rolled_back_stop_leaves_the_run_running_with_no_summary_and_no_terminal_event`) that the pre-fix two-transaction shape could not satisfy at all — captured empirically (see Deviations/RED evidence below) before the rewrite landed.
- `discard_lifecycle.rs`'s mirror of the desktop sequence realigned: `simulate_discard_stop_path` renamed `simulate_discard_stop_path_in_tx` and rewritten to the single-transaction shape; a non-committing sibling `simulate_discard_stop_path_rolled_back` added for the crash-window assertions.
- `a_rolled_back_termination_unit_leaves_no_trace`: rolling back the termination unit leaves the run `running`, `ended_at` NULL, `exit_summary_id` NULL, zero terminal events, and the board's own aggregate counts byte-identical to a pre-call snapshot.
- `a_terminal_transition_never_commits_without_a_summary`: the generalized "terminal implies summary" contract, driven across BOTH terminal variants 04-VERIFICATION.md names — natural close via `apply_session_closed` and interrupt via the committing Stop/Discard unit — with `mark_abandoned`'s exclusion documented in the test's own doc comment.
- `termination_atomicity_call_site.rs`: a structural gate over the real source on disk (not a duplicated copy), following `session_closed_call_site.rs`/`agent_run_stop_ordering.rs`'s idiom (whole-line-comment stripping, signature-anchored regions, falsifiability companions). Three properties: the Stop/Discard path never calls the connection-level core interrupt entry point; `stop_agent_run_recording_first` opens exactly one connection transaction; `interrupt_agent_run_in_tx` is defined and referenced by its connection-level wrapper.

## Task Commits

Each task was committed atomically:

1. **Task 1: One transaction for a Stop** — `2a4cd80` (feat)
2. **Task 2: The crash-window regression assertion** — `60f584b` (test)
3. **Task 3: The structural gate** — `d95790b` (test)

**Plan metadata:** committed separately after this summary.

## Files Created/Modified

- `packages/core/src/domain/agent_run.rs` — added `interrupt_agent_run_in_tx`; `interrupt_agent_run` reduced to the delegating shape
- `packages/desktop/src-tauri/src/commands/agent_run.rs` — added `stop_agent_run_in_tx`; `stop_agent_run_recording_first` rewritten to one transaction; added the rollback regression test
- `packages/core/tests/discard_lifecycle.rs` — renamed/realigned the desktop-mirror helper; added the non-committing sibling; added two new regression tests
- `packages/core/tests/termination_atomicity_call_site.rs` (new) — the structural gate, 6 tests

## Decisions Made

- **add-alongside**, not a generalized `terminate_agent_run_in_tx`: the natural-close and interrupt variants differ in event type, payload label, which figures are written, and guard shape. Promoting both now would mean refactoring `close_agent_run_in_tx`, which is proven and heavily tested — out of this gap's scope. A third variant (e.g. `mark_abandoned` gaining a summary contract) is the trigger that would force the promote; Task 3's structural gate is what makes that moment visible instead of silent.
- `mark_abandoned` stays excluded from both the atomicity fix and the terminal-implies-summary contract test — a deliberate scope boundary stated explicitly (in the plan's objective and in the test's own doc comment) rather than silently widened or silently dropped.
- The status read inside `stop_agent_run_in_tx` is ordered AFTER the terminal write, on the same `&Transaction`, so the synthesized fallback summary can never record a stale (pre-terminal) status.

## Deviations from Plan

None — plan executed exactly as written, including its two RED-BEFORE-GREEN gates.

### RED Evidence (Task 1)

Before rewriting `stop_agent_run_recording_first`, a temporary probe test called the pre-fix function and inspected what an "equivalent rollback" would observe. Since `interrupt_agent_run` opened and committed its own connection-level transaction internally, and the fallback insert committed its own second transaction, there was no encompassing transaction left for a caller to roll back at all. Observed:

```
RED EVIDENCE: pre-fix status="interrupted" ended_at=Some("2026-09-23T08:02:58.478583+00:00") (both already committed)
```

Both writes were already durable by the time the function returned — precisely the crash window gap #1 describes. The probe was written, run, its output captured, then deleted before the real `stop_agent_run_in_tx`/rewritten `stop_agent_run_recording_first` and the permanent rollback test were added.

### RED Evidence (Task 2)

The same pattern was repeated at `discard_lifecycle.rs`'s own mirror of the desktop sequence: calling the pre-fix `simulate_discard_stop_path` and inspecting the "rollback" produced:

```
RED EVIDENCE (Task 2): pre-fix agent_runs.status="interrupted" (already committed, not rollback-able)
```

Confirming the crash-window assertion (`a_rolled_back_termination_unit_leaves_no_trace`) genuinely could not pass against the pre-fix helper — `agent_runs.status` was already committed as `"interrupted"`, never `"running"`.

### Task 3's Falsifiability Observation

Per the task's own acceptance criteria, `stop_agent_run_recording_first` was temporarily reverted in place to the pre-fix two-transaction shape (via a scratch backup, restored afterward) and `cargo test -p core --test termination_atomicity_call_site` re-run:

```
test the_stop_discard_path_never_calls_the_connection_level_interrupt_entry_point ... FAILED
test result: FAILED. 5 passed; 1 failed; 0 ignored; 0 measured; 0 filtered out
```

The gate correctly went red on the reverted shape. The source file was restored byte-identical to the committed version before continuing (`git diff --stat` showed zero changes after restore).

## Issues Encountered

None.

## User Setup Required

None — no external service configuration required.

## Next Phase Readiness

- The Stop/Discard termination unit is atomic: `interrupt_agent_run_in_tx` is the only way the desktop crate writes an interrupt (proven by grep gate and by `termination_atomicity_call_site.rs`), and a crash mid-termination now leaves the board exactly as it was.
- Every pre-existing Stop, Discard, natural-close and summary-lifecycle assertion still passes (`cargo test -p core`, `cargo test -p desktop`, and the five named test binaries all report `0 failed`).
- `mark_abandoned`'s own summary contract remains an open, explicitly-stated question for a future phase — not silently resolved here.
- Plan 04-16 (CTX-06, pin resolution) touches the same `packages/desktop/src-tauri/src/commands/agent_run.rs` file; this plan's rewrite of `stop_agent_run_recording_first`/`stop_agent_run_in_tx` is complete and committed, so 04-16 composes against the final shape, not an in-flight one.

## Self-Check: PASSED

- `packages/core/tests/termination_atomicity_call_site.rs` — FOUND
- Commit `2a4cd80` — FOUND in `git log --oneline --all`
- Commit `60f584b` — FOUND in `git log --oneline --all`
- Commit `d95790b` — FOUND in `git log --oneline --all`
- `cargo build --workspace` — succeeds
- `cargo test -p core` — 0 failed
- `cargo test -p desktop` — 30 passed, 0 failed
- `cargo test -p core --test discard_lifecycle/stop_lifecycle/session_close_lifecycle/session_summary_lifecycle/termination_atomicity_call_site` — each 0 failed
- Three grep gates (Task 1's two, Task 2's `simulate_discard_stop_path(` absence) — all pass
- `git diff --name-only ee7d294f950b490f0334ec31580166fd53360a32..HEAD` lists exactly the four `files_modified` paths, no more

---
*Phase: 04-clear-is-free*
*Completed: 2026-09-23*
