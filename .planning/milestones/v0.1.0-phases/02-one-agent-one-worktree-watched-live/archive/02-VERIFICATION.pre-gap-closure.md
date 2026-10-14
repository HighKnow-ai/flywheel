---
phase: 02-one-agent-one-worktree-watched-live
verified: 2026-09-11T00:00:00Z
status: gaps_found
score: 1/5 roadmap success criteria fully verified (2 failed, 2 human-verification-only)
covered_files:
  - .planning/REQUIREMENTS.md
  - .planning/phases/02-one-agent-one-worktree-watched-live/02-01-PLAN.md
  - .planning/phases/02-one-agent-one-worktree-watched-live/02-01-SUMMARY.md
  - .planning/phases/02-one-agent-one-worktree-watched-live/02-02-PLAN.md
  - .planning/phases/02-one-agent-one-worktree-watched-live/02-02-SUMMARY.md
  - .planning/phases/02-one-agent-one-worktree-watched-live/02-03-PLAN.md
  - .planning/phases/02-one-agent-one-worktree-watched-live/02-03-SUMMARY.md
  - .planning/phases/02-one-agent-one-worktree-watched-live/02-04-PLAN.md
  - .planning/phases/02-one-agent-one-worktree-watched-live/02-04-SUMMARY.md
  - .planning/phases/02-one-agent-one-worktree-watched-live/02-05-PLAN.md
  - .planning/phases/02-one-agent-one-worktree-watched-live/02-05-SUMMARY.md
  - .planning/phases/02-one-agent-one-worktree-watched-live/02-06-PLAN.md
  - .planning/phases/02-one-agent-one-worktree-watched-live/02-06-SUMMARY.md
  - .planning/phases/02-one-agent-one-worktree-watched-live/02-07-PLAN.md
  - .planning/phases/02-one-agent-one-worktree-watched-live/02-07-SUMMARY.md
  - .planning/phases/02-one-agent-one-worktree-watched-live/02-08-PLAN.md
  - .planning/phases/02-one-agent-one-worktree-watched-live/02-08-SUMMARY.md
  - .planning/phases/02-one-agent-one-worktree-watched-live/02-09-PLAN.md
  - .planning/phases/02-one-agent-one-worktree-watched-live/02-09-SUMMARY.md
  - .planning/phases/02-one-agent-one-worktree-watched-live/02-10-PLAN.md
  - .planning/phases/02-one-agent-one-worktree-watched-live/02-10-SUMMARY.md
  - .planning/phases/02-one-agent-one-worktree-watched-live/02-CONTEXT.md
  - .planning/phases/02-one-agent-one-worktree-watched-live/02-DISCUSSION-LOG.md
  - .planning/phases/02-one-agent-one-worktree-watched-live/02-PATTERNS.md
  - .planning/phases/02-one-agent-one-worktree-watched-live/02-RESEARCH.md
  - .planning/phases/02-one-agent-one-worktree-watched-live/02-REVIEW.md
  - .planning/phases/02-one-agent-one-worktree-watched-live/02-UI-SPEC.md
  - .planning/phases/02-one-agent-one-worktree-watched-live/02-VALIDATION.md
  - .planning/phases/02-one-agent-one-worktree-watched-live/COVERAGE.md
  - .planning/phases/02-one-agent-one-worktree-watched-live/deferred-items.md
covered_digest: "v1:sha256:2c2be0c6a8d46e9d435a669d0dbb1c3bf652d17b1cbfdc8cec0cd51b66872577"
behavior_unverified: 2
overrides_applied: 0
gaps:
  - truth: "PROC-06 / 02-02-PLAN must-have: 'A user can stop a running session at any time and the run closes as interrupted... never as failed' (with no third, stuck state)"
    status: failed
    reason: >
      `agent_run_stop` (packages/desktop/src-tauri/src/commands/agent_run.rs:249-256) calls
      `sidecar.interrupt_run(&agent_run_id)` and propagates its error with `?` BEFORE calling
      `domain::agent_run::interrupt_agent_run` — the only code path that ever writes a run to a
      terminal `interrupted` status. If the sidecar's ack never arrives (sidecar crashed, its
      shared reader task died — see CR-03 below — or it is merely wedged), `interrupt_run` times
      out (30s), returns `Err`, and the domain write is never reached. The run is left `running`
      or `blocked` forever; pressing Stop again repeats the same 30s timeout with the same
      outcome. No command anywhere in the reviewed code can force a run to a terminal state once
      the sidecar side is unresponsive. Confirmed by direct inspection of the cited lines — this
      is CR-04 in 02-REVIEW.md, independently re-verified here, not merely restated.
    artifacts:
      - path: "packages/desktop/src-tauri/src/commands/agent_run.rs"
        issue: "agent_run_stop gates the DB write on the sidecar ack via early-return `?`, with no fallback path to force a terminal status."
    missing:
      - "Decouple the domain write from the sidecar ack outcome: always record the run as interrupted once the user asks to stop it, surfacing any sidecar-side failure as a secondary, non-blocking warning."
      - "A test that stops a run when the sidecar never acks (or is killed mid-interrupt) and asserts the run still reaches a terminal status."
  - truth: "02-07-PLAN prohibition: 'The live feed must never silently drop or truncate agent output — every line the backend produced must be present in the persisted log'"
    status: failed
    reason: >
      The single shared `while let Some(event) = rx.recv().await` loop in `spawn_sidecar`
      (packages/desktop/src-tauri/src/sidecar.rs:256-278) is the only place any sidecar stdout
      line is ever read, for every run this sidecar drives. On that loop,
      `SessionLogWriter::open(&run_id).expect(...)` panics if the log file cannot be opened
      (disk full, unwritable app-data dir, a Windows file-lock). The panic silently terminates
      only this `tauri::async_runtime::spawn`ed task (no join, no restart), and stderr is
      suppressed on release Windows builds (`windows_subsystem = "windows"`). From that point,
      `rx.recv().await` is never polled again — no further event, for any run, is emitted to the
      renderer or written to any run's session log for the rest of the app session. This is a
      confirmed, provable violation of the plan's own stated prohibition, not merely a
      theoretical edge case (CR-03 in 02-REVIEW.md, independently re-verified here).
    artifacts:
      - path: "packages/desktop/src-tauri/src/sidecar.rs"
        issue: "One run's session-log open failure panics the single shared reader task, silently stopping event processing for every run."
    missing:
      - "Replace the `.expect(...)` with a fallback (log-and-skip, or a no-op writer) so a single run's I/O failure cannot take down the shared reader loop."
      - "A test that forces `SessionLogWriter::open` to fail for one run and asserts other runs' events keep flowing."
  - truth: "Phase-caused regression: task deletion (pre-existing feature) now fails once a task has ever had 'Start Work' pressed on it"
    status: failed
    reason: >
      This phase's migrations (0003_agent_runtime.sql, 0004_permission_gate.sql) add
      `triggers.target_task_id`, `worktrees.task_id`, `agent_runs.task_id`, and
      `permission_requests.task_id` as `NOT NULL REFERENCES tasks(id)` with no `ON DELETE`
      clause (SQLite's implicit default is `NO ACTION`), and `foreign_keys = ON` is enabled for
      every connection (`db/mod.rs:56`). `domain::task::delete_task` orphans `issues.task_id`
      (nullable FK) and deletes `acceptance_criteria`, but does nothing for the four new tables
      because they did not exist when it was written. Once a task has any row in
      triggers/worktrees/agent_runs/permission_requests, `DELETE FROM tasks` raises a raw SQLite
      FOREIGN KEY constraint error, the transaction rolls back, and `task_delete` fails silently
      from the user's perspective (opaque `e.to_string()`). No test in `packages/core/tests/`
      deletes a task with agent-run/worktree/trigger history. Confirmed by direct inspection of
      the migrations and `delete_task` (CR-01 in 02-REVIEW.md, independently re-verified here).
    artifacts:
      - path: "packages/core/src/db/migrations/0003_agent_runtime.sql"
        issue: "NOT NULL FK to tasks(id) with no ON DELETE clause on triggers, worktrees, agent_runs."
      - path: "packages/core/src/db/migrations/0004_permission_gate.sql"
        issue: "Same gap on permission_requests.task_id."
    missing:
      - "An explicit product decision (block deletion once a task has agent-run history, vs. cascade the audit rows) expressed as a migration-level ON DELETE clause or explicit pre-delete cleanup in delete_task."
      - "A test that starts an agent run against a task and then deletes it."
  - truth: "CLAUDE.md hard architectural constraint: 'killing orphans... at the OS-process-tree level' — no `claude` process should survive Flywheel quitting"
    status: failed
    reason: >
      `main.rs`'s `RunEvent::Exit` handler (lines 141-147) only calls `SidecarHandle::kill()`,
      which kills the sidecar's own single process via `tauri-plugin-shell`'s
      `CommandChild::kill()` — a signal to that one process only. Every individual `claude`
      session is spawned by `claude-code-adapter.ts`'s `startSession` with `detached: true`
      (line 321) specifically so it becomes its own process-group leader, independent of the
      sidecar's own group. Killing the sidecar therefore does nothing to any live session. If the
      user quits Flywheel (Cmd+Q, closing the window, OS termination) while any run is `running`,
      that `claude` process keeps running indefinitely with no supervisor left to interrupt it —
      still writing to the worktree and consuming API credit. No test anywhere in the phase
      (`stop.test.mjs`, `stop_lifecycle.rs`) exercises the app-exit path; every existing test only
      covers the explicit interrupt/kill request. Confirmed by direct inspection of the cited
      lines (CR-02 in 02-REVIEW.md, independently re-verified here).
    artifacts:
      - path: "packages/desktop/src-tauri/src/main.rs"
        issue: "RunEvent::Exit only kills the sidecar's own process, never the detached process groups of live sessions."
      - path: "packages/desktop/src-tauri/src/sidecar.rs"
        issue: "kill()'s own doc comment claims it kills every child session 'by extension' — false, per tauri-plugin-shell's CommandChild::kill() semantics."
    missing:
      - "On RunEvent::Exit, send the sidecar a kill-all-sessions instruction (or equivalent) and wait briefly for it to signal every live session's process group before killing the sidecar itself."
      - "A test that starts a session, triggers the app-exit path, and asserts the session's process group is gone."
deferred: []
behavior_unverified_items:
  - truth: "PROC-07: a user watches a long-running session live and application memory stays flat rather than growing with the transcript"
    test: "Start a long-running real session on a real task, leave it streaming for several minutes, and watch RSS in Activity Monitor while the transcript grows on disk."
    expected: "RSS stays flat while the persisted log on disk keeps growing; the renderer never holds more than a bounded window."
    why_human: "The windowed-read design (session_log.rs::read_window, LOG_WINDOW_MAX_LIMIT=100; SessionSurface.tsx's @tanstack/react-virtual usage) is present and structurally sound, but actual flat-RSS behavior over a long real session can only be observed by running the packaged app, per 02-VALIDATION.md's own Manual-Only Verifications table."
  - truth: "AGNT-06: a permission request pauses the agent, the user answers it from the board, and the agent genuinely resumes (full path through a real claude process)"
    test: "Press Start Work on a task whose work needs a permission decision, confirm the board surfaces the request and the agent is genuinely blocked, answer it, and confirm the agent resumes rather than restarting."
    expected: "The real claude process blocks on the MCP tool call, the board renders the pending request, answering it resolves the held call, and the agent continues the same turn."
    why_human: "The DB/MCP-server halves (permission_gate.rs, mcp-permission-server.ts) are proven by real automated tests, but the end-to-end path crosses the renderer and a real spawned claude process — explicitly manual-only per 02-VALIDATION.md. Execution notes also record that Claude Code's own built-in bash safety heuristic was empirically found to bypass a configured --permission-prompt-tool for commands it judges read-only, even in --permission-mode default, which bears directly on whether this criterion holds for all tool calls in practice."
  - truth: "AGNT-03/AGNT-04: the user can point Flywheel at local Claude Code credentials or an explicit API key with nothing else in the product behaving differently"
    test: "Run the same task once under local Claude Code credentials and once with an explicit API key configured in Settings; confirm nothing else in the product behaves differently, and confirm the key never appears in `ps` or the persisted session JSONL."
    expected: "Identical argv and event-kind/order between the two modes (already proven by packages/sidecar/test/credentials.test.mjs); the API key is present in the child's environment only."
    why_human: "The structural/code-level guarantees (argv parity, env-only injection, no credential-mode branching, single resolver) are proven by real spawned-child tests. What remains unverified is whether ANTHROPIC_API_KEY reliably overrides a present local subscription session in the real `claude` CLI — execution notes record this could not be measured in this environment (no spend-authorized key available) and is logged as a Phase 3 input."
  - truth: "Plan 02-02's own manual verification step: starting a real session, pressing Stop, and confirming from a bare terminal that the worktree is intact and no process survives under it"
    test: "Start a real session, press Stop, then from a bare terminal confirm the worktree directory and its uncommitted changes are intact and no `claude` (or descendant) process is still running."
    expected: "Worktree intact and dirty exactly as the agent left it; no orphaned process."
    why_human: "Logged as an open unrun-verify item in .planning/WINDOWS.md (row 3), deferred to end-of-phase UAT per workflow.human_verify_mode=end-of-phase. The underlying process-group-kill mechanism is proven by a real multi-process test (packages/sidecar/test/stop.test.mjs), but the packaged-app path has not been observed by a human."
  - truth: "Plan 02-10's own manual verification step: Settings surface reachable from menu/⌘,/palette, API key save-then-hide, and allow-always rule list/revoke from a real permission request"
    test: "Open Settings from the app menu, from ⌘,, and from the command palette; save an API key and confirm it cannot be read back; grant an allow-always rule from a real permission request and confirm it appears in the table with its project and can be revoked."
    expected: "All three entry points open the same Settings surface; the saved key is never re-rendered; the granted rule appears, attributable and revocable."
    why_human: "Logged as an open unrun-verify item in .planning/WINDOWS.md (row 7), deferred to end-of-phase UAT per workflow.human_verify_mode=end-of-phase."
human_verification:
  - test: "Start a long-running real session on a real task, leave it streaming for several minutes, and watch RSS in Activity Monitor while the transcript grows on disk."
    expected: "RSS stays flat while the persisted log keeps growing on disk."
    why_human: "Real-process memory behavior over minutes cannot be observed by static analysis; explicitly manual-only per 02-VALIDATION.md."
  - test: "Press Start Work on a task whose work needs a permission decision; confirm the board surfaces the request, the agent is genuinely blocked, and answering resumes the same turn rather than restarting it."
    expected: "The real claude process blocks on the MCP tool call and resumes correctly once answered."
    why_human: "Crosses the renderer and a real spawned claude process; also subject to the noted Claude Code bash-safety-heuristic caveat that may bypass the configured permission-prompt-tool for some commands."
  - test: "Run the same task once under local Claude Code credentials and once with an explicit API key configured in Settings; confirm identical product behavior and that the key never appears in `ps` or the persisted JSONL."
    expected: "No behavioral difference between the two credential paths; the key is present only in the child's environment."
    why_human: "Requires two real credential configurations on one machine; whether ANTHROPIC_API_KEY reliably overrides a present subscription session could not be measured in this environment (no spend-authorized key) and is recorded as a Phase 3 input."
  - test: "Start a real session, press Stop, and confirm from a bare terminal that the worktree is intact and no process survives under it."
    expected: "Worktree intact and dirty as left; no orphaned process."
    why_human: "Open unrun-verify item, .planning/WINDOWS.md row 3 — deferred to end-of-phase UAT."
  - test: "Open Settings from the app menu, ⌘,, and the command palette; save an API key and confirm it cannot be read back; grant and revoke an allow-always rule from a real permission request."
    expected: "All entry points open the same surface; key never re-rendered; rule appears and is revocable."
    why_human: "Open unrun-verify item, .planning/WINDOWS.md row 7 — deferred to end-of-phase UAT."
---

# Phase 2: One Agent, One Worktree, Watched Live — Verification Report

**Phase Goal:** Cyril presses Start Work on a board task and watches a Claude Code session do
that task inside a git worktree that belongs to the task rather than to the session.

**Verified:** 2026-09-11
**Status:** gaps_found
**Re-verification:** No — initial verification

## Goal Achievement

### Observable Truths (Roadmap Success Criteria)

| # | Truth | Status | Evidence |
|---|-------|--------|----------|
| 1 | Worktree appears on a branch derived from the task identifier, chained to the epic integration branch, visible from a bare terminal | ✓ VERIFIED | `packages/core/tests/branch_naming.rs` and `packages/core/tests/worktree_lifecycle.rs` are real behavioral tests: they create a real scratch git repo, call `ensure_worktree`, and assert against real `git worktree list` output (`core::git::worktree_list`). Branch derivation (`branch.rs`) covers both the epic and no-epic shapes plus the boundary/adjacency/empty/encoding edge probes listed in 02-01-PLAN's must-haves. `cargo test --workspace` passes (0 failures) including these suites. |
| 2 | User watches the agent's output stream live for a long session with flat memory | ✗ FAILED (partial) | Windowed-read design is present and correct in isolation (`session_log.rs::read_window`, capped at `LOG_WINDOW_MAX_LIMIT=100`; `SessionSurface.tsx` uses `@tanstack/react-virtual`). But a confirmed, unresolved defect (CR-03, re-verified below) means a single run's session-log write failure panics the *only* shared stdout-reader task, silently halting event delivery for every run for the rest of the app session — a direct, provable violation of 02-07-PLAN's own prohibition ("the live feed must never silently drop... agent output"). The true flat-memory claim over a long real session is also unverified (routed to human verification). |
| 3 | Agent pauses on a permission request, user answers from the board, agent resumes | ⚠️ PRESENT_BEHAVIOR_UNVERIFIED | `packages/core/tests/permission_gate.rs` and `packages/sidecar/test/permission.test.mjs`-equivalent DB/MCP logic are real, passing tests covering pending-row creation, the once-only answer transition, and project-scoped rule matching. The full path through a real spawned `claude` process is explicitly manual-only per 02-VALIDATION.md and was not exercised in this environment; execution notes additionally record a Claude Code CLI safety-heuristic caveat bearing directly on this path. |
| 4 | User stops a session, worktree stays intact/inspectable, and a second session reuses it — the worktree outlives the session | ✗ FAILED (partial) | The happy path is proven by real behavioral tests: `packages/sidecar/test/stop.test.mjs` spawns a real stubborn child with a real grandchild and proves the whole process group is torn down (`process.kill(grandchildPid, 0)` throws after force-kill); `packages/core/tests/stop_lifecycle.rs` proves a stopped run closes `interrupted` with the worktree left dirty; `worktree_lifecycle.rs` proves a second run reuses the same worktree row and on-disk contents. However, a confirmed, unresolved defect (CR-04, re-verified below) means `agent_run_stop` never reaches the domain write that marks a run `interrupted` if the sidecar's ack never arrives — directly contradicting 02-02-PLAN's own must-have ("a user can stop a running session **at any time**... never... a third, stuck state"). |
| 5 | Worktree, agent run and session are distinct linked records on the task; local-credential and API-key paths behave identically | ⚠️ PRESENT_BEHAVIOR_UNVERIFIED | The "distinct linked records" half is solidly VERIFIED: separate `worktrees`/`agent_runs`/`triggers`/`permission_requests` tables (0003/0004 migrations), each reachable from `RunsSection.tsx`/`WorktreeSummary.tsx` via bounded queries. The credential-parity half has strong structural/behavioral evidence — `packages/sidecar/test/credentials.test.mjs` spawns a real child under the API-key mode and proves the value reaches only its environment, plus an argv-parity test and an event-parity test between modes, plus a structural test asserting no module branches on a credential-mode string literal. What remains genuinely unverified is whether `ANTHROPIC_API_KEY` reliably overrides a present local subscription session in the real `claude` CLI — explicitly recorded in execution notes as unmeasurable in this environment and deferred as a Phase 3 input. Separately, CR-01 (below) shows the "first-class records" claim has an unguarded edge: deleting a task that has ever had an agent run now fails outright. |

**Score:** 1/5 roadmap success criteria fully verified without qualification; 2 failed on confirmed, reproducible defects; 2 have solid automated evidence for their mechanical/structural half but require human observation for their full real-process claim.

### Additional Plan-Level Must-Haves

All 10 plans' `must_haves.artifacts` exist and are substantive (not stubs); all 10 plans'
`must_haves.key_links` are wired (verified by direct `grep`/read, not just file presence — see
Key Link Verification below). Nearly all plan-level `truths` not already covered above have direct
automated test coverage (branch/worktree edge probes, permission-gate concurrency, credential
argv/event parity, UI legend/keyboard/contrast invariants). The exceptions are the two must-haves
this report treats as FAILED (PROC-06's "at any time... never a stuck state", 02-07's "never
silently drop... agent output") and the human-verification items listed above.

### Required Artifacts

| Artifact | Expected | Status | Details |
|----------|----------|--------|---------|
| `packages/core/src/branch.rs` | D-24/25/26 branch derivation | ✓ VERIFIED | Exports `task_branch_name`, `epic_integration_branch_name`, `slugify`; exercised by `branch_naming.rs` (9 tests, all passing). |
| `packages/core/src/git.rs` | `git_at` absolute-path wrapper, worktree add/list/remove | ✓ VERIFIED | `worktree_list` used directly in `worktree_lifecycle.rs` against a real repo. |
| `packages/core/src/domain/worktree.rs` | `ensure_worktree` create-or-reuse | ✓ VERIFIED | Exercised twice per task in `worktree_lifecycle.rs`, confirming reuse. |
| `packages/core/src/domain/agent_run.rs` | `start_agent_run` / `close_agent_run` | ✓ VERIFIED | Used throughout `worktree_lifecycle.rs`, `stop_lifecycle.rs`, `permission_gate.rs`. |
| `packages/core/src/session_log.rs` | Durable JSONL writer + bounded windowed read | ✓ VERIFIED (artifact) / ⚠️ see truth #2 | `read_window`/`count_lines` present with `LOG_WINDOW_MAX_LIMIT`; the shared-reader-panic defect (CR-03) lives in the caller (`sidecar.rs`), not this file. |
| `packages/sidecar/src/adapter.ts` | `AgentAdapter`, `AgentEvent`, `AdapterCapabilities` | ✓ VERIFIED | Single adapter (`ClaudeCodeAdapter`) instantiated once in `index.ts`; no branching on backend name anywhere in `src-tauri/src`. |
| `packages/sidecar/src/claude-code-adapter.ts` | Spawns `claude`, normalises stream-json, interrupt/kill | ✓ VERIFIED | `spawn(bin, argv, { env: {...process.env, ...options.env} })`; `detached: true`; interrupt/kill proven by `stop.test.mjs`. |
| `packages/desktop/src-tauri/src/sidecar.rs` | Sidecar supervisor: spawn, health-check, kill-on-exit | ⚠️ ORPHANED GUARANTEE — see CR-02/CR-03 | Spawn/health-check present and correct; `kill()`'s doc comment claim ("kills... every child session... by extension") is false per confirmed inspection. |
| `packages/core/src/db/migrations/0003_agent_runtime.sql`, `0004_permission_gate.sql` | New tables | ✓ VERIFIED (exist, substantive) / ✗ see CR-01 | Tables and constraints present as specified; the NOT NULL FK / no-ON-DELETE gap is a wiring-level gap against `delete_task`, not a missing artifact. |
| `packages/core/src/credentials.rs` | Keychain-backed resolver, single resolution point | ✓ VERIFIED | `resolve_credential` returns `ResolvedCredential{ mode, env }`; hand-written `Debug` redacts secrets; exercised by 12 passing tests in `credentials.rs` and `credentials.test.mjs`. |
| `packages/desktop/src/settings/SettingsSurface.tsx`, `PermissionRulesTable.tsx` | Settings surface, revocable rules | ✓ VERIFIED (exists, wired) | Wired to `getSettings`/`storeApiKey`/`listPermissionRules`/`revokePermissionRule`; full manual walkthrough deferred (WINDOWS row 7). |
| `packages/desktop/src/item-detail/WorktreeSummary.tsx`, `RunsSection.tsx` | Distinct linked worktree/run records | ✓ VERIFIED (exists, wired) | Wired to `useAgentRuns`/`useBoardQuery`; opens `SessionSurface` on selection. |
| `packages/desktop/src/session/FeedRow.tsx`, `RawLogView.tsx`, `PermissionRequestCard.tsx` | Row-per-event rendering, raw escape hatch, answerable card | ✓ VERIFIED (exists, wired) | `SessionSurface.tsx` uses `useVirtualizer`; `PermissionRequestCard` wired to `answerPermissionRequest`. |
| `packages/desktop/src/launch-sheet/LaunchSheet.tsx`, `packages/core/src/context_packet.rs` | Pre-spawn briefing sheet, pure deterministic packet | ✓ VERIFIED (exists, wired) | `assemble_context_packet` called from both `agent_run_preview` and `agent_run_start`. |

### Key Link Verification

| From | To | Via | Status | Details |
|------|----|----|--------|---------|
| `commands/agent_run.rs` | `domain/agent_run.rs` | `start_agent_run` | ✓ WIRED | Confirmed by reading `agent_run_start`. |
| `sidecar.rs` | `packages/sidecar/src/index.ts` | sidecar spawn, newline-delimited JSON stdio | ✓ WIRED | `spawn_sidecar` reads `rx.recv()` in a loop, parses `SidecarStdoutLine`. |
| `claude-code-adapter.ts` | `claude` CLI process | `child_process.spawn`, cwd = worktree, own process group | ✓ WIRED | `detached: true` confirmed at line 321; `spawn(bin, argv, { cwd, env, detached: true })`. |
| `SessionSurface.tsx` | `adapters/tauri.ts` | `agent_run_log_window` | ✓ WIRED | Confirmed via grep for the pattern in `SessionSurface.tsx`. |
| `commands/agent_run.rs` | `sidecar.rs` | `agent_run_stop` sends interrupt over sidecar stdio | ✓ WIRED (but see CR-04) | Wired correctly; the gap is in error handling after the call, not the wiring itself. |
| `claude-code-adapter.ts` | claude process group | `process.kill(-pid, signal)` | ✓ WIRED | Confirmed negative-pid group signalling; proven by `stop.test.mjs`'s grandchild-teardown test. |
| `mcp-permission-server.ts` | `sidecar.rs` | forwards every request upstream, awaits relayed answer | ✓ WIRED | `relay_permission_answer_direct`/`answer_request` confirmed in `agent_run.rs`. |
| `SettingsSurface.tsx` | `adapters/tauri.ts` | `storeApiKey`, `getSettings`, etc. | ✓ WIRED | Confirmed via grep. |
| `main.rs` (`RunEvent::Exit`) | `sidecar.rs` (`kill()`) | app-exit cleanup | ✗ NOT SUFFICIENT — see CR-02 | Wired, but `kill()` does not reach detached session process groups. |

### Requirements Coverage

| Requirement | Description | Status | Evidence |
|---|---|---|---|
| DATA-04 | Generic trigger record, `user_action` implemented, `schedule`/`webhook` schema-only | ✓ SATISFIED | `triggers` table + CHECK constraint; edge-probe tests in 02-01-PLAN's must-haves pass. |
| DATA-06 | Worktrees/runs/sessions/summaries/artifacts as first-class records | ⚠️ SATISFIED WITH GAP | Records exist with FK identity as designed, but CR-01 shows the FK design breaks `delete_task` once any such record exists — an unresolved regression. |
| WORK-01 | Start Work creates a dedicated worktree | ✓ SATISFIED | `worktree_lifecycle.rs`. |
| WORK-02 | Fixed branch topology (task → epic-integration → trunk) | ✓ SATISFIED | `branch.rs`, `branch_naming.rs`. |
| WORK-08 | Worktree persists across many sessions, removed only on explicit action | ✓ SATISFIED | `worktree_lifecycle.rs` proves reuse across two runs; no removal path exists yet (correct — not in scope). |
| LINK-01 | Branch name derives from task identifier, recognisable from CLI | ✓ SATISFIED | `branch_naming.rs` edge probes (boundary, adjacency, empty, encoding, ordering, precision). |
| PROC-01 | Each session is a separate OS process in its own worktree | ✓ SATISFIED | `supervisor_cwd.rs`; `spawn(..., { cwd, detached: true })`. |
| PROC-02 | Supervisor never reads its own cwd; explicit absolute paths only | ✓ SATISFIED | `supervisor_cwd.rs` structural gate; `git_at` requires an explicit path first. |
| PROC-06 | User can interrupt/stop at any time, worktree left consistent | ✗ BLOCKED | CR-04: no recovery path when the sidecar never acks — a run can be stuck `running`/`blocked` forever, contradicting "at any time... never a stuck state." |
| PROC-07 | Live streaming without unbounded memory growth | ✗ BLOCKED | CR-03: a single log-write failure silently halts event processing for every run, violating the plan's own no-silent-drop prohibition; the flat-memory claim itself is also unverified (human check). |
| AGNT-01 | Single adapter interface, no backend branching | ✓ SATISFIED | Single `ClaudeCodeAdapter` instance; no backend-name comparisons found in `src-tauri/src`. |
| AGNT-02 | Claude Code adapter normalises stream-json | ✓ SATISFIED | `claude-code-adapter.ts`; event-parity test in `credentials.test.mjs`. |
| AGNT-03 | Local Claude Code credentials, never leaving the machine | ⚠️ NEEDS HUMAN | Code-level guarantee proven (env-only injection, no argv leakage); real end-to-end parity with a real local session not exercised here. |
| AGNT-04 | Explicit API-key path as first-class alternative | ⚠️ NEEDS HUMAN | Structural/behavioral tests pass; whether the key reliably overrides a present subscription session could not be measured in this environment. |
| AGNT-06 | Permission requests block the agent until answered | ⚠️ NEEDS HUMAN (DB/MCP half SATISFIED) | `permission_gate.rs` proves the pending/blocked/once-only-answer invariants; full path through a real `claude` process is manual-only. |

No orphaned requirements — all 15 IDs mapped to this phase in REQUIREMENTS.md are declared in at
least one plan's frontmatter (`02-01` through `02-10`).

### Anti-Patterns Found

| File | Line | Pattern | Severity | Impact |
|---|---|---|---|---|
| `packages/desktop/src-tauri/src/db/migrations/0003_agent_runtime.sql`, `0004_permission_gate.sql` | multiple | `NOT NULL REFERENCES tasks(id)` with implicit `NO ACTION`, no matching `delete_task` update | 🛑 Blocker | CR-01 — task deletion regression once a task has agent-run history. |
| `packages/desktop/src-tauri/src/main.rs` / `sidecar.rs` | 141-147 / 224-232 | App-exit cleanup only kills the sidecar's own PID, not detached session process groups | 🛑 Blocker | CR-02 — orphaned `claude` processes survive app quit; violates CLAUDE.md's named hard constraint. |
| `packages/desktop/src-tauri/src/sidecar.rs` | 272-278 | `.expect(...)` panic inside the sole shared stdout-reader task | 🛑 Blocker | CR-03 — one run's log-write failure silently halts event processing for every run. |
| `packages/desktop/src-tauri/src/commands/agent_run.rs` | 249-256 | Domain write to `interrupted` gated behind `sidecar.interrupt_run(...)?` | 🛑 Blocker | CR-04 — a run can be stuck `running`/`blocked` forever if the sidecar never acks. |
| `packages/sidecar/src/claude-code-adapter.ts` | 354-357 | Un-guarded `process.kill(-pid, "SIGINT")` (SIGTERM escalation nearby IS guarded) | ⚠️ Warning | WR-01 — a natural-exit race can surface a spurious interrupt failure for a run that actually succeeded. |
| `packages/core/src/git.rs` / `domain/worktree.rs` | 83-110 / 130-135 | Existence check then separate `git worktree add` — TOCTOU gap | ⚠️ Warning | WR-02 — low real-world exposure given the single-connection, single-process architecture; worth a comment or relocation. |

All four Blockers are reproduced here independently of 02-REVIEW.md by direct inspection of the
exact cited lines — this is not a restatement of unverified review claims.

### Behavioral Spot-Checks

| Behavior | Command | Result | Status |
|---|---|---|---|
| Full workspace test suite | `cargo test --workspace` | All Rust test binaries pass (0 failures across `core`, `desktop`, `relay_client`) | ✓ PASS |
| Worktree survives two runs, `git worktree list` confirms one entry | test enumeration + read of `worktree_lifecycle.rs` | Real repo, real `git worktree` invocation, assertions on-disk and in DB | ✓ PASS |
| Stubborn child + grandchild torn down on force-kill | read of `packages/sidecar/test/stop.test.mjs` | Real spawned processes; `process.kill(grandchildPid, 0)` throws after force step | ✓ PASS |
| Credential parity: API-key value reaches only the child's environment | read of `packages/sidecar/test/credentials.test.mjs` | Real spawned child asserts the value is readable from env and absent from stdout | ✓ PASS |
| CR-01/CR-02/CR-03/CR-04 code claims | direct read of cited source lines | All four confirmed accurate against current code, independent of 02-REVIEW.md's own text | ✓ CONFIRMED (as defects) |

### Probe Execution

No `scripts/*/tests/probe-*.sh` conventions or phase-declared probes found for this phase. Skipped.

### Human Verification Required

See `human_verification` in frontmatter — 5 items: (1) flat-memory long-session observation
(PROC-07), (2) full permission-gate pause/resume through a real `claude` process (AGNT-06,
with a noted Claude Code bash-safety-heuristic caveat), (3) local-vs-API-key real-world parity
including `ANTHROPIC_API_KEY` override reliability (AGNT-03/04, unmeasurable in this environment),
(4) plan 02-02's own deferred bare-terminal stop verification (WINDOWS row 3), and (5) plan
02-10's own deferred Settings walkthrough (WINDOWS row 7).

### Gaps Summary

Ten plans, all requirement IDs, and every declared artifact/key-link pass structural, wiring, and
(where automatable) behavioral verification — the underlying engineering (worktree lifecycle,
branch derivation, credential resolution, permission-gate DB/MCP halves, real process-group
kill-on-stop) is genuinely solid and proven by real spawned-process tests, not mocks.

However, this phase's own code review (02-REVIEW.md, status `issues_found`) identified four
Critical defects sitting exactly on the paths this verification was asked to scrutinize hardest —
process lifecycle and the permission/stop hold-release path — and all four were independently
re-confirmed here by direct inspection of the cited source lines, not merely trusted from the
review text:

1. **CR-01** — a phase-introduced schema regression breaks deleting any task that has ever had
   "Start Work" pressed on it.
2. **CR-02** — quitting Flywheel while a session is running orphans the `claude` process, directly
   contradicting a hard architectural constraint named in `CLAUDE.md`.
3. **CR-03** — a single run's session-log write failure silently kills live event processing for
   *every* run, directly contradicting an explicit must-have prohibition from 02-07-PLAN.
4. **CR-04** — stopping a run has no recovery path if the sidecar never acknowledges the
   interrupt, leaving the run stuck `running`/`blocked` forever, directly contradicting an
   explicit must-have from 02-02-PLAN ("at any time... never a stuck state").

None of these are speculative: each was traced to specific, current lines of code and confirmed to
produce the described behavior. They are edge-case/failure-path defects rather than happy-path
breakage — a normal Start Work → watch → stop cycle, exercised by this phase's own real-process
test suites, works as designed. But the phase goal as stated ("watches a Claude Code session do
that task... rather than to the session") implies the session lifecycle is trustworthy under
failure, not only on the happy path, and three of the four Criticals sit directly on named
must-haves this phase itself wrote down as guarantees. Per the explicit instruction accompanying
this verification request, these are surfaced plainly rather than allowed to pass on
happy-path-only evidence.

Two additional items are genuinely not code gaps but unresolved human-verification needs, by the
phase's own design (`workflow.human_verify_mode: end-of-phase`): the true flat-memory claim under
a real long session, and the full end-to-end permission-gate and credential-parity paths through a
real `claude` process — the latter explicitly limited in this environment by the lack of a
spend-authorized API key.

---

_Verified: 2026-09-11T00:00:00Z_
_Verifier: Claude (gsd-verifier)_
