---
phase: 09-planned-fan-out-that-does-not-collide
plan: 02
subsystem: agent-runtime
tags: [scope-hook, scope-denied, backstop, permission-socket, events, rusqlite, tauri]

requires:
  - phase: 09-planned-fan-out-that-does-not-collide
    provides: "plan 09-01: the fail-closed scope hook, the file_set matcher, migration 0019 (idx_events_type_task), task_file_set_entries"
provides:
  - "task.scope_denied event: one row per refusal, attributed to the agent actor, never coalesced"
  - "the scope_denied notice kind end to end: hook -> permission socket -> ScopeDeniedEvent -> reader branch -> row"
  - "scope_denied_counts: one grouped, capped read for the board badge; tasks with no refusal are absent"
  - "scope_backstop_inputs / scope_backstop_git / scope_backstop_findings: the close-time detective half"
affects: [09-03 overlap and wave edges, 09-08 widen path, 09-09 UI feed row and task-row badge]

plan_head_before: 084b4750d1bf24c68c09bd7c91b30fdc7d97a3ed

actuals:
  tokens: 15200
  tasks: 2
  commits: 2

tech-stack:
  added: []
  patterns:
    - "A PreToolUse hook prints its decision FIRST, then does bounded best-effort work, then exits 2; the work can never change the decision"
    - "Run identity for a notice-derived event comes from the sidecar session closure and the agent_runs row, never from the notice body"
    - "A detective layer compares git against the DATABASE rows, never against a file the agent can reach"
    - "Split a lock-sensitive close-time check into database half, git half (plain values, no Connection) and a composed convenience"

key-files:
  created:
    - packages/core/tests/scope_events.rs
  modified:
    - packages/sidecar/src/scope-hook.ts
    - packages/sidecar/src/mcp-permission-server.ts
    - packages/sidecar/src/adapter.ts
    - packages/sidecar/src/claude-code-adapter.ts
    - packages/desktop/src-tauri/src/sidecar.rs
    - packages/core/src/domain/file_set.rs
    - packages/core/src/drift.rs
    - packages/core/src/query/scope.rs
    - packages/core/src/query/mod.rs
    - packages/sidecar/test/scope-hook.test.mjs

key-decisions:
  - "An outside-the-worktree refusal stores only the file name, so no absolute filesystem path is written to a row that later reaches the renderer (T-09-02-05)"
  - "Backstop rows are deduplicated per (run, path, after-the-fact) so a session_closed event delivered twice does not double the count; hook denials are never deduplicated (D-154)"
  - "The backstop reads uncommitted paths with git status --porcelain -z -uall, not porcelain_entries, because the default mode collapses a new directory to one entry and quotes odd paths"
  - "The backstop runs on its own thread from the reader loop and takes the database lock only around the two database halves"
  - "scope_denied_counts clamps its limit to 1..=1000 server-side"

patterns-established:
  - "Preventive/detective statement: every artifact that states the scope guarantee names the two halves separately"

requirements-completed: [PLAN-05]

coverage:
  - id: D1
    description: "A refused file-tool write becomes a task.scope_denied row carrying the refused path, attributed to the agent, with the run identity taken from the database"
    requirement: PLAN-05
    verification:
      - kind: integration
        ref: "packages/core/tests/scope_events.rs#a_refusal_appends_one_row_attributed_to_the_runs_agent_actor"
        status: pass
      - kind: unit
        ref: "packages/desktop/src-tauri/src/sidecar.rs#scope_denied_tests (4 tests, including a spoofed taskId/actorId that is ignored)"
        status: pass
      - kind: integration
        ref: "packages/sidecar/test/scope-hook.test.mjs (the shipped hook through the real permission server and noticeToAgentEvent)"
        status: pass
    human_judgment: false
  - id: D2
    description: "Every refusal is recorded: twenty refusals are twenty rows in attempt order with distinct per-origin sequences"
    requirement: PLAN-05
    verification:
      - kind: integration
        ref: "packages/core/tests/scope_events.rs#twenty_refusals_are_twenty_rows_in_attempt_order_with_distinct_sequences"
        status: pass
    human_judgment: false
  - id: D3
    description: "The hook's decision and exit code never depend on the notice: socket unset, dead, or accepting and never answering all still deny with exit 2 within a bounded time"
    requirement: PLAN-05
    verification:
      - kind: integration
        ref: "packages/sidecar/test/scope-hook.test.mjs (socket unset, dead socket, stuck socket under 5s)"
        status: pass
    human_judgment: false
  - id: D4
    description: "The board count is one grouped, capped read and a task with no refusal is absent rather than zero"
    requirement: PLAN-05
    verification:
      - kind: integration
        ref: "packages/core/tests/scope_events.rs#counts_omit_a_task_with_no_refusals_and_group_the_rest, #counts_are_capped_server_side, #the_count_query_is_one_grouped_literal"
        status: pass
      - kind: integration
        ref: "packages/core/tests/perf_seed_1000.rs (3 tests, after the new read module)"
        status: pass
    human_judgment: false
  - id: D5
    description: "A change left outside the declared set at session close is surfaced even when no notice was ever sent, flagged after the fact, and is told apart from a hook denial of the same path"
    requirement: PLAN-05
    verification:
      - kind: integration
        ref: "packages/core/tests/scope_events.rs#a_lost_notice_is_still_surfaced_at_close_flagged_after_the_fact, #a_hook_denial_and_a_backstop_finding_for_one_path_are_two_rows_told_apart_by_the_flag"
        status: pass
      - kind: integration
        ref: "packages/core/tests/scope_events.rs (committed, uncommitted, new-directory, all-inside, unarmed and closing-twice cases)"
        status: pass
    human_judgment: false
---

# Phase 9 Plan 02: Scope Refusals as Board Events, Plus the Close-Time Backstop Summary

**A refused write now lands as a `task.scope_denied` row (hook notice over the existing permission socket, run identity from the session, one row per refusal), with a board count that omits zero and a session-close backstop that diffs git against the declared database rows.**

## What the guarantee is, and what it is not

**Preventive for the file-writing tools; detective for everything else.** The hook still matches only `Write|Edit|MultiEdit|NotebookEdit`.

- **Preventive half (09-01, reported by this plan):** a file-tool write outside the declared set is denied at the tool call, and this plan makes that denial a durable, countable board event instead of text in a transcript.
- **Detective half (this plan):** a change made through `Bash` (`echo >`, `sed -i`, an installer rewriting a lockfile), or any refusal whose notice was lost, is found at session close by comparing committed and uncommitted paths against the declared rows. It is raised after the fact and flagged `detected_after_the_fact: true`.
- **Residual, stated plainly:** a change made through `Bash` and then reverted inside the same session is covered by neither half. The hook never saw it and the tree is clean by close. Nothing here claims the guarantee is total, and the same sentence is in the doc comment of `packages/core/tests/scope_events.rs` and in the backstop's own header in `drift.rs`.
- **Also not covered:** a task that was unarmed when its run started but gained a declared set later is compared at close against the set as it stands then. A run with no declared set raises nothing, by design (D-150).

## Accomplishments

- `scope-hook.ts` prints the deny body first, then sends one `scope_denied` line over `FLYWHEEL_PERMISSION_SOCKET` with a 500 ms bound, then exits 2. Unset, dead and stuck sockets are all tested to leave the decision and exit code unchanged. No new socket, process or MCP config entry.
- `PermissionNoticePayload.kind`, `ScopeDeniedEvent` and `noticeToAgentEvent` carry the new kind; the event's `runId` is the session closure's, and the notice body's own `runId` is not read (T-09-02-01).
- `sidecar.rs` routes the event to `handle_inbound_scope_denied` (DB half `process_inbound_scope_denied`, testable without an `AppHandle`); a database failure logs and the reader loop continues.
- `file_set.rs`: `EVENT_SCOPE_DENIED`, `ScopeDenial`, `record_scope_denied_in_tx`, `record_scope_denied`, `record_backstop_denials`. Event and sequence commit in one transaction (DATA-01); actor is the run's agent actor.
- `query/scope.rs`: `scope_denied_counts` is one `GROUP BY` literal over `idx_events_type_task`, clamped to 1..=1000, absent for zero.
- `drift.rs`: `scope_backstop_inputs` (database), `scope_backstop_git` (plain values, no `Connection`), `scope_backstop_findings` (composed). It never names `read_scope_marker`.
- Session close: a new thread-per-close `handle_inbound_scope_backstop` runs after the existing `session_closed` branch. The single `apply_session_closed` call site is untouched.

## Task Commits

The plan has two TDD tasks; both were driven by one RED commit and one GREEN commit because the Rust fixture, the stubs and the hook tests were written together.

1. **RED (both tasks)** - `7e1badc` (test): 11 of 15 Rust cases and 2 of the new hook cases fail on assertions against inert stubs
2. **GREEN (both tasks)** - `a389d97` (feat)

**Plan metadata:** the `docs(09-02)` commit following this file.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 1 - Bug] The default `git status --porcelain` read would miss and misquote paths**
- **Found during:** Task 2
- **Issue:** the plan names `porcelain_entries` for the uncommitted read, but in its default mode git collapses a new untracked directory to one `dir/` entry (which no declared `dir/` entry can cover, and which hides the files inside it) and C-quotes odd paths.
- **Fix:** the git half reads `status --porcelain -z -uall` through `git_at`, and takes both paths of a rename or copy. A new-directory case is tested.
- **Files modified:** `packages/core/src/drift.rs`

**2. [Rule 2 - Missing critical] A `session_closed` event delivered twice would double the after-the-fact count**
- **Found during:** Task 2
- **Issue:** `apply_session_closed` already models a run arriving at a terminal state twice, so the backstop can run twice.
- **Fix:** `record_backstop_denials` skips a (run, path) already recorded after the fact. This is idempotency of the backstop only; hook denials are never skipped.
- **Files modified:** `packages/core/src/domain/file_set.rs`

**3. [Rule 2 - Missing critical] T-09-02-05: an absolute path would reach a stored row**
- **Found during:** Task 1
- **Issue:** for an outside-the-worktree refusal the shim reports the absolute path, and the threat model requires that none crosses to the renderer.
- **Fix:** `record_scope_denied_in_tx` keeps only the file name when `outside_worktree` is true, and caps any stored path at 1024 characters.
- **Files modified:** `packages/core/src/domain/file_set.rs`

**4. [Rule 3 - Blocking] Signature and placement differences from the plan text**
- `scope_backstop_findings(conn, task_id)` takes no `repo_path` or `run_id` (the worktree path and base branch come from the database; the run id is attached by the writer) and returns `anyhow::Result`, so a git failure is logged rather than read as "no findings". The plan's "no caller holds the lock across a subprocess" requirement is met by the separate `scope_backstop_inputs` / `scope_backstop_git` halves, which the reader handler calls itself.
- The close wiring is a new `handle_inbound_scope_backstop` in `sidecar.rs` beside the `session_closed` branch, on its own thread, rather than inside `handle_inbound_session_closed` (which lives in `commands/agent_run.rs`, not in the plan's file list).
- `drift.rs` opened with "the whole module is pure"; that sentence now says `detect_drift` is pure and names the backstop as the one exception.

**5. [Process] One RED and one GREEN commit for both tasks, not one commit per task**
- The two tasks share one test file and one set of stubs. The TDD order (RED before GREEN) holds; the per-task commit granularity does not.

**Total deviations:** 5 (1 bug, 2 missing critical, 1 blocking, 1 process). **Impact:** all were needed for correctness or the threat model; no scope creep.

## Authentication Gates

None.

## Issues Encountered

- `RED` honesty: the stubs are inert (they return empty values) so tests fail on assertions, but four cases pass against the stubs by construction (unknown run, unarmed, all-inside, and the structural "backstop never names the marker reader"). They constrain the implementation rather than prove new behaviour.
- The full `packages/core` suite takes over 30 minutes on this machine. It was run in two parts (76 binaries, then the remaining 12), plus `desktop` (71 passed) and the sidecar suite (248 passed, 11 skipped with `FLYWHEEL_REAL_CLAUDE_BIN=/nonexistent/claude`, so the live-`claude` cases did not run in this plan). `credentials` and the two `forge_live_*` binaries were excluded as in 09-01 (keychain prompts and live network).
- `StartRunOutcome` raises a dead-code warning in the desktop build. It is in `agent_run.rs` and predates this plan.

## Known Stubs

None.

## Threat Flags

| Flag | File | Description |
|------|------|-------------|
| threat_flag: new-event-type | packages/core/src/domain/file_set.rs | `task.scope_denied` carries agent-supplied text (a path, a tool name, a tool-call id). Bounded to 1024 characters, bound only through `params![]`, and an outside-worktree path is reduced to its file name. |

## Next Phase Readiness

- Plan 09-09 can render the feed row from the `scope_denied` agent event and the badge from `scope_denied_counts`; the `outside_worktree` flag separates "left its lane" from "left the repository".
- Not measured here: a real multi-step `claude` run producing a denial through the notice path (RESEARCH A6, headless runs writing memory or plan files outside the worktree). The unit and integration cases drive the shipped hook and the real permission server; the live-`claude` arm was not run in this plan.

## Self-Check: PASSED

`packages/core/tests/scope_events.rs` exists; commits `7e1badc` (test) and `a389d97` (feat) exist and RED precedes GREEN. Every `<automated>` verify command in both tasks was run and passes: `scope_events` (15), `drift` (30), `outside_commit_detection` (11), `session_close_lifecycle` (3), `session_closed_call_site` (2), `supervisor_cwd` (5), `perf_seed_1000` (3), `cargo build --workspace`, `npm --prefix packages/sidecar test`, the four grep gates, and `tsc --noEmit` for the desktop frontend.
