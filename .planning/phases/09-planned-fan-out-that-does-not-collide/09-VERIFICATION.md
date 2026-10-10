---
phase: 09-planned-fan-out-that-does-not-collide
verified: 2026-10-10T08:32:16Z
status: gaps_found
score: 8/13 must-haves verified
covered_files:
  - .planning/REQUIREMENTS.md
  - .planning/phases/09-planned-fan-out-that-does-not-collide/09-01-PLAN.md
  - .planning/phases/09-planned-fan-out-that-does-not-collide/09-01-SUMMARY.md
  - .planning/phases/09-planned-fan-out-that-does-not-collide/09-02-PLAN.md
  - .planning/phases/09-planned-fan-out-that-does-not-collide/09-02-SUMMARY.md
  - .planning/phases/09-planned-fan-out-that-does-not-collide/09-03-PLAN.md
  - .planning/phases/09-planned-fan-out-that-does-not-collide/09-03-SUMMARY.md
  - .planning/phases/09-planned-fan-out-that-does-not-collide/09-04-PLAN.md
  - .planning/phases/09-planned-fan-out-that-does-not-collide/09-04-SUMMARY.md
  - .planning/phases/09-planned-fan-out-that-does-not-collide/09-05-PLAN.md
  - .planning/phases/09-planned-fan-out-that-does-not-collide/09-05-SUMMARY.md
  - .planning/phases/09-planned-fan-out-that-does-not-collide/09-06-PLAN.md
  - .planning/phases/09-planned-fan-out-that-does-not-collide/09-06-SUMMARY.md
  - .planning/phases/09-planned-fan-out-that-does-not-collide/09-07-PLAN.md
  - .planning/phases/09-planned-fan-out-that-does-not-collide/09-07-SUMMARY.md
  - .planning/phases/09-planned-fan-out-that-does-not-collide/09-08-PLAN.md
  - .planning/phases/09-planned-fan-out-that-does-not-collide/09-08-SUMMARY.md
  - .planning/phases/09-planned-fan-out-that-does-not-collide/09-09-PLAN.md
  - .planning/phases/09-planned-fan-out-that-does-not-collide/09-09-SUMMARY.md
  - packages/core/src/context_packet.rs
  - packages/core/src/db/migrations/0019_fan_out.sql
  - packages/core/src/db/mod.rs
  - packages/core/src/dispatch.rs
  - packages/core/src/dispatch_exec.rs
  - packages/core/src/domain/dispatch_plan.rs
  - packages/core/src/domain/file_set.rs
  - packages/core/src/domain/mod.rs
  - packages/core/src/domain/settings.rs
  - packages/core/src/drift.rs
  - packages/core/src/epic_context_packet.rs
  - packages/core/src/file_set.rs
  - packages/core/src/git_facts.rs
  - packages/core/src/lib.rs
  - packages/core/src/limit_gate.rs
  - packages/core/src/merge.rs
  - packages/core/src/query/mod.rs
  - packages/core/src/query/scope.rs
  - packages/core/src/runtime_protocol.rs
  - packages/core/tests/context_packet.rs
  - packages/core/tests/dispatch_auto_merge.rs
  - packages/core/tests/dispatch_cap.rs
  - packages/core/tests/dispatch_limit_gate.rs
  - packages/core/tests/dispatch_plan.rs
  - packages/core/tests/file_set_overlap.rs
  - packages/core/tests/fixtures/shim-main-string-literals.baseline.txt
  - packages/core/tests/scope_events.rs
  - packages/core/tests/scope_marker_contract.rs
  - packages/core/tests/scope_widen.rs
  - packages/core/tests/spawn_stagger.rs
  - packages/desktop/src-tauri/capabilities/default.json
  - packages/desktop/src-tauri/src/commands/agent_run.rs
  - packages/desktop/src-tauri/src/commands/authoring.rs
  - packages/desktop/src-tauri/src/commands/dispatch.rs
  - packages/desktop/src-tauri/src/commands/file_set.rs
  - packages/desktop/src-tauri/src/commands/mod.rs
  - packages/desktop/src-tauri/src/commands/settings.rs
  - packages/desktop/src-tauri/src/main.rs
  - packages/desktop/src-tauri/src/scheduler.rs
  - packages/desktop/src-tauri/src/sidecar.rs
  - packages/desktop/src/App.css
  - packages/desktop/src/App.tsx
  - packages/desktop/src/adapters/tauri.ts
  - packages/desktop/src/board/BoardRow.tsx
  - packages/desktop/src/board/BoardView.tsx
  - packages/desktop/src/board/EpicHeaderRow.tsx
  - packages/desktop/src/board/__tests__/scope-badge.test.tsx
  - packages/desktop/src/board/useBoardQuery.ts
  - packages/desktop/src/dispatch/DispatchGateLine.tsx
  - packages/desktop/src/dispatch/EpicDispatchControls.tsx
  - packages/desktop/src/dispatch/WavePlanSheet.tsx
  - packages/desktop/src/dispatch/__tests__/dispatch-controls.test.tsx
  - packages/desktop/src/dispatch/__tests__/dispatch-layout.browser.test.tsx
  - packages/desktop/src/dispatch/__tests__/gate-line.test.tsx
  - packages/desktop/src/dispatch/__tests__/wave-plan-sheet.test.tsx
  - packages/desktop/src/dispatch/dispatch.css
  - packages/desktop/src/dispatch/queries.ts
  - packages/desktop/src/legend/__tests__/legend.test.tsx
  - packages/desktop/src/legend/marks.ts
  - packages/desktop/src/session/FeedRow.tsx
  - packages/desktop/src/session/SessionSurface.tsx
  - packages/desktop/src/session/__tests__/feed-row.test.tsx
  - packages/desktop/src/settings/SettingsSurface.tsx
  - packages/desktop/src/settings/__tests__/browser/admin-group.browser.test.tsx
  - packages/desktop/src/settings/__tests__/parallel-cap.test.tsx
  - packages/desktop/src/settings/__tests__/settings-surface.test.tsx
  - packages/desktop/src/state/uiStore.ts
  - packages/shim/src/main.rs
  - packages/sidecar/src/adapter.ts
  - packages/sidecar/src/claude-code-adapter.ts
  - packages/sidecar/src/index.ts
  - packages/sidecar/src/mcp-permission-server.ts
  - packages/sidecar/src/scope-hook.ts
  - packages/sidecar/test/authoring-stage-gate.test.mjs
  - packages/sidecar/test/execution-hook-settings.test.mjs
  - packages/sidecar/test/fake-claude.mjs
  - packages/sidecar/test/rate-limit-wire.test.mjs
  - packages/sidecar/test/scope-gate-fail-closed.test.mjs
  - packages/sidecar/test/scope-hook-live.test.mjs
  - packages/sidecar/test/scope-hook.test.mjs
  - packages/sidecar/test/submit-plan-wire.test.mjs
covered_digest: "v1:sha256:d85596f02b187aab4dfb4b1e14f31e259f35c516bf5dd2f33847967085ca1f15"
behavior_unverified: 2
overrides_applied: 0
re_verification: false
gaps:
  - truth: "SC2 / PLAN-07: the user can ask why any two tasks were sequenced and get an answer"
    status: partial
    reason: "True for a pair sequenced by an overlap edge frozen at approval. FALSE for a pair that waits because neither declared a set (D-150, the default path for QuickAdd tasks) and for a pair that waits after a live widen. dispatch::why finds no edge, sees one wave, and answers DisjointSets: 'declare disjoint sets, so neither waits for the other'. REQUIREMENTS.md marks PLAN-07 Complete; it is complete for one of three causes."
    artifacts:
      - path: "packages/core/src/dispatch.rs"
        issue: "why() (line 158) reads only dispatch_edges and dispatch_plan_tasks.wave; ReadinessRefusal::RunsAlone and OverlapsInFlight are runtime-only and never persisted. EDGE_CAUSE_WIDEN (line 46) is declared and never written."
      - path: "packages/desktop/src-tauri/src/commands/dispatch.rs"
        issue: "dispatch_why (line 349) maps the no-edge, same-wave case to the sentence 'declare disjoint sets, so neither waits'."
    missing:
      - "why() returns a runs-alone cause when either task has an empty declared set"
      - "widen_file_set writes an EDGE_CAUSE_WIDEN edge and a task.sequenced event for a queued task its new entry now overlaps (D-157)"
      - "the wave plan sheet shows 'no files declared, runs alone' (D-149's one human look)"
    registered_as: "D-REV-38 (open)"
  - truth: "Goal: parallelism is bounded by real file-set disjointness, as an invariant every launch path respects"
    status: partial
    reason: "Enforced at ONE choke point (dispatch::readiness), which only the dispatcher consults. launch_run_for_task, the launch body both callers share, checks neither overlap, cap, gate nor liveness. Three reachable paths put two overlapping armed sets in flight: (1) a manual agent_run_start of a task that overlaps a live one; (2) the window between decide and launch, in which each Spawn sleeps in the 400 ms spawn floor with the lock released, so a manual launch or live widen landing there is not seen; (3) task_file_set_set on a task with a live run replaces the stored set with no D-152 re-check, and a later widen re-arms the marker from ALL stored rows, carrying the unchecked entries in. The live widen itself is sound (IMMEDIATE transaction, re-check inside it)."
    artifacts:
      - path: "packages/desktop/src-tauri/src/commands/agent_run.rs"
        issue: "launch_run_for_task (line 714) has no overlap, cap or live-run check; agent_run_start routes straight to it"
      - path: "packages/core/src/dispatch_exec.rs"
        issue: "run_pass Spawn arm (line 203) acts on a decision made earlier with no re-check"
      - path: "packages/core/src/domain/file_set.rs"
        issue: "declare_file_set_in_tx (line 58) has no live-run guard; reached by task_file_set_set"
    missing:
      - "re-run readiness for the task immediately before each spawn, under the lock"
      - "refuse (or route through widen_file_set) a declare on a task with a running or blocked run"
      - "a live-run guard in launch_run_for_task, or a partial unique index on agent_runs(task_id) for running and blocked"
    registered_as: "D-REV-37 (open, rated High for the headline claim). The user-launch half (path 1) is a deliberate design choice recorded in 09-07-SUMMARY; it is silent, with no warning to the user that the launch overlaps a live task."
deferred: []
behavior_unverified_items:
  - truth: "SC1 / PLAN-01: a real claude planning run, in the epic integration worktree, completes headlessly and submits tasks that each declare a file-set, grouped into waves"
    test: "Start dispatch_plan_generate against a real epic in an installed build"
    expected: "A draft plan appears with a set and a wave on every task; the run never stalls on a permission prompt; the worktree is clean afterward"
    why_human: "Needs a live claude login and the packaged sidecar. The wire, the held submit_plan call, the Rust-side authority and every refusal are tested against a fake backend. A real model's obedience and the real CLI's behaviour in default permission mode are not. Registered as D-REV-35."
  - truth: "SC5 / AGNT-05: a real hard rate or session limit presents as the documented wire shape and pauses dispatch"
    test: "Freeze a real limit's raw session-log line as a fixture once one occurs"
    expected: "rateLimitTier returns rejected and the gate pauses with the wire's resetsAt"
    why_human: "A hard limit cannot be produced on demand and none has been observed. Only an allowed and an allowed_warning event are real captures; every rejected assertion runs against a fixture built from the documented shape. Registered as D-REV-32."
deferred_review_register:
  - id: D-REV-32
    note: "hard rate-limit wire shape unobserved (pre-existing)"
  - id: D-REV-33
    note: "scope-denied row and badge look unobserved (pre-existing)"
  - id: D-REV-34
    note: "real launch through the sidecar untested (pre-existing)"
  - id: D-REV-35
    note: "real planning run never executed (pre-existing)"
  - id: D-REV-36
    note: "nothing on the fan-out surface looked at by a person (pre-existing)"
  - id: D-REV-37
    note: "no re-check between decide and launch; manual launch; task_file_set_set bypass (pre-existing)"
  - id: D-REV-38
    note: "why() answers wrongly for undeclared and widened pairs (pre-existing)"
  - id: D-REV-39
    note: "WR-03/04/05/07 + 3 Info (pre-existing)"
  - id: D-REV-40
    note: "TDD gate wiring, process finding (pre-existing)"
  - id: D-REV-41
    note: "NEW, filed by this verification: no retry or skip for a failed, stopped or conflicted task; it strands its wave"
  - id: D-REV-42
    note: "NEW, filed by this verification: Bash writes are detective only, and a detected breach does not stop the automatic merge"
---

# Phase 9: Planned Fan-Out That Does Not Collide - Verification Report

**Phase Goal:** Cyril turns one epic into several agents working at once, with parallelism bounded by real file-set disjointness rather than optimism.
**Mode:** mvp
**Verified:** 2026-10-10T08:32:16Z
**Status:** gaps_found
**Re-verification:** No - initial verification

## Verdict in one paragraph

The dispatcher does what the phase promises on its primary path. An approved plan fans out, a colliding pair alone goes sequential, wave two is cut from a base that contains wave one's merged commit (proved with a real git read), the cap bounds spawns against database truth, the scope hook refuses out-of-set file-tool writes and fails closed, and a rate-limit signal pauses new dispatch only. The two Critical review findings (CR-01, CR-02) are fixed in code and covered by tests that I re-ran. The goal's word "bounded" is not yet an invariant, though. The overlap check lives in `readiness`, which only the dispatcher calls, and the launch body does not repeat it. Two further things were reported as done and are not: PLAN-07 gives a false answer for the default path (undeclared tasks), and a stuck wave has no recovery. I record these as gaps, not as phase-closing blockers; the owner decides whether the phase closes with them open.

## Automated gates: what is and is not shown

Reported accurately; nothing upgraded.

| Gate | Source | Result |
| ---- | ------ | ------ |
| `packages/desktop` vitest 1292/1292, `tsc` and `vite build` clean | orchestrator | passing, **not re-run by me** |
| `packages/sidecar` 275/275 (run alone) | orchestrator | passing, **not re-run in full by me** (see below) |
| `cargo test --workspace --lib --bins`, `-p core --test spawn_stagger`, `-p desktop` | orchestrator | passing |
| **Full core integration sweep** | orchestrator | **OPEN GATE.** About 39 of 93 binaries had run clean at dispatch. No run in this phase has shown the whole core suite green at once. I do not write "all tests pass". |
| 9 core binaries I ran myself, alone, `cargo test -p core --test <name>` | me | `dispatch_auto_merge` 32, `dispatch_plan` 57, `dispatch_cap` 8, `dispatch_limit_gate` 32, `scope_widen` 11, `scope_events` 15, `scope_marker_contract` 23, `file_set_overlap` 36, `spawn_stagger` 9. 223 tests, 0 failed. |
| 4 sidecar files I ran myself after `npm run build` | me | `scope-gate-fail-closed`, `scope-hook`, `execution-hook-settings`, `rate-limit-wire`: 54 of 54 pass |

Two traps worth passing on. A first run of those four sidecar files **without** `npm run build` failed `rate-limit-wire` on a stale `dist/`; the failures were not real. My full `npm --prefix packages/sidecar test` run also hit the known 30 s handshake timeouts in `stub-invocation.test.mjs` while the orchestrator's core sweep was running, so I do not claim a green sidecar suite of my own. I did not run `scope-hook-live.test.mjs`: it spends real money against the installed `claude`, and I have no standing to spend it.

## Goal Achievement

### Observable Truths

| #  | Truth | Status | Evidence |
| -- | ----- | ------ | -------- |
| 1  | SC1: a planner run leaves tasks that each declare a file-set, grouped into waves (PLAN-01) | ⚠️ PRESENT_BEHAVIOR_UNVERIFIED | `submit_plan` is a held call (`mcp-permission-server.ts:190-294`), the authority is Rust (`sidecar.rs:984 process_inbound_submit_plan`, `dispatch_plan.rs:805 resolve_planning_run`, `:850 store_submitted_plan`), and `dispatch_plan` (57) passes. No real planning run has ever happened (D-REV-35). |
| 2  | SC2a: when two tasks declare overlapping files only that pair goes sequential; the rest of the wave runs (PLAN-02, PLAN-03) | ✓ VERIFIED | `edges_for_plan` (`dispatch.rs:102`) emits one edge per colliding pair; `readiness` holds only the `after` task until its predecessor is `merged`. `one_collision_in_a_wave_of_three_degrades_only_the_pair` and `the_successor_waits_for_merged_not_for_finished` pass in the 32. |
| 3  | SC2b: the user can ask why any two tasks were sequenced and get an answer (PLAN-07) | ✗ FAILED (partial) | Correct for overlap edges (frozen at approval, event `task.sequenced`). Wrong for the undeclared pair and the widened pair; see Gaps. |
| 4  | SC3a: a write outside the declared set through a file-writing tool is refused at the tool call and becomes a scope event (PLAN-04, PLAN-05) | ✓ VERIFIED | `scope-hook.ts` shells to the shim's `--scope-check`, so the containment predicate has one implementation (`file_set.rs`). Hook error paths all end in exit 2. Scope notice, `task.scope_denied` event, close-time backstop, feed row, board badge all exist and are wired (`sidecar.rs`, `domain/file_set.rs:224`, `FeedRow.tsx`, `BoardRow.tsx`). `scope_events` 15, `scope_marker_contract` 23, sidecar scope tests pass. Look of the row and badge: D-REV-33. |
| 5  | SC3b: the same holds for any write, including through `Bash` | ? UNCERTAIN | `SCOPE_GATE_MATCHER = "Write|Edit|MultiEdit|NotebookEdit"` (`claude-code-adapter.ts`). A `Bash` write is found at session close only. Disclosed in 09-RESEARCH, 09-01-SUMMARY, 09-02-SUMMARY, 09-07-SUMMARY, but PLAN-04 and criterion 3 say "stopped at the tool level" without qualification and nobody recorded the owner's acceptance. `decide` and `merge_task` never read `task.scope_denied`, so a flagged breach still auto-merges. Filed as **D-REV-42** (new). |
| 6  | SC4: the user caps global parallel width and the dispatcher never exceeds it (PLAN-06) | ✓ VERIFIED (decision time) | `decide`: `budget = cap - occupied_slots`, floored at 0 (`dispatch.rs:710`); `occupied_slots` counts running and blocked runs across every project and includes authoring and planning runs. Default 3, range 1-8, out-of-range stored value reads as default (`settings.rs:31-124`). Select control in `SettingsSurface.tsx:348`. `dispatch_cap` 8 pass. Caveat: a manual launch can exceed it by design, and the decide-to-launch window (D-REV-37) is unguarded. |
| 7  | SC5: a rate or session limit pauses new dispatch, running sessions continue, the user is told, and dispatch resumes at the reported instant with no probe (AGNT-05) | ⚠️ PRESENT_BEHAVIOR_UNVERIFIED | Chain is wired end to end: adapter `rateLimitTier` (`claude-code-adapter.ts:637,1097`) -> reader loop `handle_inbound_rate_limit` (`sidecar.rs:1912`) -> `apply_rate_limit_signal_for_run` -> `read_gate` / `may_spawn` / `may_advance` in `decide` -> `resume_if_due` at the head of every pass. `dispatch_limit_gate` 32 and `rate-limit-wire` pass. The hard-limit `rejected` shape has never been observed (D-REV-32). |
| 8  | Goal: parallelism is bounded by real disjointness as an invariant | ✗ FAILED (partial) | See Gaps. Holds on the dispatcher's own path; not enforced at a choke point all launch callers route through. |
| 9  | "Merged, not finished": wave N+1 branches off a base that contains wave N (D-156, D-158) | ✓ VERIFIED | `wave_is_drained` counts only `merged` and `skipped` (`dispatch.rs:519`); worktrees are cut from the epic integration tip at launch (`worktree.rs` `base_ref_for_task`); `merge_task` merges in the epic's own worktree. `two_waves_run_to_completion_and_wave_two_is_cut_from_a_base_containing_wave_one` runs real git and asserts `merge-base --is-ancestor` from wave two's worktree. The fake there replaces only the process start, not worktree creation (`start_agent_run`). |
| 10 | Live widen takes effect on the next tool call and is refused if it reaches any in-flight task's set (D-152) | ✓ VERIFIED | `widen_file_set` (`domain/file_set.rs:401`) takes an `IMMEDIATE` transaction, re-checks every in-flight declared set inside it, rewrites the marker after commit, returns `MarkerNotRewritten` rather than swallowing a failed rewrite. `scope_widen` 11 pass. |
| 11 | CR-01 fixed: an armed run whose scope gate cannot be installed is refused, and every hook failure blocks | ✓ VERIFIED | `scopeArmed` rides `StartRunOutcome` -> spawn request (`agent_run.rs:769`) -> `index.ts:204` -> `scopeGateUnavailable` refusal (`claude-code-adapter.ts:200,1438`); command is `'node' 'hook.js' \|\| exit 2` with both paths quoted (`:196`). `scope-gate-fail-closed.test.mjs` runs the real shell command, including a path with a space and a missing script. 54/54 with the neighbouring files. |
| 12 | CR-02 fixed: a task with no declared set runs alone with the hook disarmed (D-150) | ✓ VERIFIED | `readiness` now reads all in-flight sets including empty ones and returns `RunsAlone` if either side is empty (`dispatch.rs:579-590`); `taken` carries the same rule inside one decision. Seven `undeclared_*` tests in `dispatch_auto_merge.rs` (lines 797-887) pass. |
| 13 | D-149: no agent spawns before the user approves a reviewable wave plan | ✓ VERIFIED | `live_plans` selects only `approved`, `running`, `paused` (`dispatch.rs:445`); a `draft` plan is edited only through `edit_draft_plan`, which refuses any other status. Approval freezes the edges and appends one `task.sequenced` event per edge. |

**Score:** 8/13 truths verified, 2 present-but-behavior-unverified, 2 failed (partial), 1 uncertain.

### Required Artifacts

| Artifact | Expected | Status | Details |
| -------- | -------- | ------ | ------- |
| `packages/core/src/file_set.rs` | one entry vocabulary, one containment predicate | ✓ VERIFIED | Two forms only; globs refused; `covers`, `overlaps`, `collisions`; used by hook (via shim) and by plan-time check |
| `packages/core/src/db/migrations/0019_fan_out.sql` | tables for entries, plans, plan tasks, edges | ✓ VERIFIED | Applied by `open_and_migrate` in every test fixture |
| `packages/sidecar/src/scope-hook.ts` | fail-closed PreToolUse hook | ✓ VERIFIED | Header and tests; every path exits 2 on doubt |
| `packages/core/src/dispatch.rs` | edges, `readiness`, `decide` | ✓ VERIFIED | Substantive and wired (`dispatch_exec::run_pass`) |
| `packages/core/src/dispatch_exec.rs` | read, observe, decide, act with lock released across subprocesses | ✓ VERIFIED | Wired from `commands/dispatch.rs:467` and the fifth scheduled job |
| `packages/core/src/limit_gate.rs` | gate state, signal parse, resume | ✓ VERIFIED | `may_merge` and `hold_for_limit` are dead code (IN-01, D-REV-39) |
| `packages/desktop/src/dispatch/WavePlanSheet.tsx`, `EpicDispatchControls.tsx`, `DispatchGateLine.tsx` | plan review and controls | ✓ VERIFIED (exists, wired) | Mounted from `App.tsx:354` and `EpicHeaderRow.tsx:344`. Rendered against fixture DTOs in jsdom and WebKit; never seen by a person (D-REV-36) |
| a retry or skip command | recovery for a stuck task | ✗ MISSING | Nothing in `commands/dispatch.rs` sets a task to `planned` or `skipped`; D-REV-41 |

### Key Link Verification

| From | To | Via | Status | Details |
| ---- | -- | --- | ------ | ------- |
| 5 s tick, nudges | `run_pass` | `SingleFlight` (`scheduler.rs:540`) -> `execute_dispatch_actions` | WIRED | tick tests pass |
| `run_pass` Spawn | real launch | closure -> `launch_run_for_task` -> `send_gated_spawn` -> `SidecarHandle::send_spawn_request` (spawn floor) | WIRED | Process start is faked in tests (D-REV-34) |
| planning spawn | the same gated path | `send_gated_spawn` after `540f296` | WIRED | `spawn_stagger` 9/9 |
| `launch_run_for_task` | `readiness` | none | **NOT_WIRED** | by design for a user launch; also true for the dispatcher's window (WR-02) |
| `agent_run_start` | cap, gate, overlap | none | NOT_WIRED | documented: a user's own launch is never refused |
| `after_completed_run` / `merge_task` | `task.scope_denied` | none | NOT_WIRED | D-REV-42 |
| sidecar `rate_limit` event | gate | `process_inbound_rate_limit` | WIRED | |
| widen | marker | `rewrite_live_markers` after commit | WIRED | |

### Data-Flow Trace (Level 4)

Traced for the dispatcher, the gate, the cap and the widen: each reads database rows (`agent_runs`, `dispatch_*`, `task_file_set_entries`, `settings`), not constants. The UI components were checked for existence and wiring and exercised against fixture DTOs; I did not trace each rendered value back through its Tauri command to a query, so the Level 4 claim for the React surface rests on the plans' own tests.

### Behavioral Spot-Checks

| Behavior | Command | Result | Status |
| -------- | ------- | ------ | ------ |
| Pair-only sequencing, merged-not-finished, two-wave base, undeclared runs alone | `cargo test -p core --test dispatch_auto_merge` | 32 passed | ✓ PASS |
| Plan lifecycle, submit_plan authority | `cargo test -p core --test dispatch_plan` | 57 passed | ✓ PASS |
| Cap | `cargo test -p core --test dispatch_cap` | 8 passed | ✓ PASS |
| Gate | `cargo test -p core --test dispatch_limit_gate` | 32 passed | ✓ PASS |
| Widen, scope events, marker contract, overlap algebra, single spawn site | `cargo test -p core --test scope_widen` etc. | 11, 15, 23, 36, 9 passed | ✓ PASS |
| CR-01 fail-closed, hook, hook settings, rate-limit wire | `npm run build` then `node --test` on 4 files | 54 passed | ✓ PASS |
| Live hook against the installed `claude` | `scope-hook-live.test.mjs` | not run (spends money) | ? SKIP |
| Interleaved manual launch or widen between `decide` and launch | no such test exists | n/a | ✗ ABSENT (D-REV-37 says automatable: YES) |

### Probe Execution

No probes declared in any PLAN or SUMMARY and none under `scripts/*/tests/probe-*.sh`. Step 7c: SKIPPED (no probes).

### Requirements Coverage

All eight IDs appear in a PLAN's `requirements:` and a SUMMARY's `requirements-completed:`; no ORPHANED requirement. All eight are marked Complete in REQUIREMENTS.md. Is that true in code?

| Requirement | Source Plan | Marked | Verdict | Evidence |
| ----------- | ----------- | ------ | ------- | -------- |
| PLAN-01 | 09-08 | Complete | ✓ SATISFIED as a mechanism; **no real run has happened** | Truth 1; D-REV-35 |
| PLAN-02 | 09-03 | Complete | ✓ SATISFIED | Pairwise check at approval (`edges_for_plan`) and again at every spawn (`readiness`) |
| PLAN-03 | 09-03, 09-07 | Complete | ✓ SATISFIED | Truth 2 |
| PLAN-04 | 09-01 | Complete | ⚠️ SATISFIED for file-writing tools only | Truths 4, 5; "Complete" overstates it; D-REV-42 |
| PLAN-05 | 09-02, 09-06 | Complete | ✓ SATISFIED | Truth 4; backstop covers Bash after the fact; look unobserved (D-REV-33) |
| PLAN-06 | 09-04, 09-07 | Complete | ✓ SATISFIED at decision time | Truth 6 |
| PLAN-07 | 09-03, 09-09 | Complete | ✗ **MARKED COMPLETE BUT NOT DELIVERED for two of three sequencing causes** | Truth 3 |
| AGNT-05 | 09-05 | Complete | ✓ SATISFIED against the documented shape; hard shape unobserved | Truth 7; D-REV-32 |

PLAN-07 is the one that is marked complete and is not. PLAN-04 is complete with a qualification the requirement text does not carry.

### Anti-Patterns Found

| File | Line | Pattern | Severity | Impact |
| ---- | ---- | ------- | -------- | ------ |
| (added lines in 71 phase files) | - | `TBD`, `FIXME`, `XXX`, `TODO`, `HACK`, `PLACEHOLDER` | none found | Debt-marker gate clear |
| `agent_run.rs` | 734, 752-754 | `?` after the run row exists leaks a `running` row and a cap slot (WR-03) | ⚠️ Warning | Each sidecar hiccup shrinks the cap by one for the life of the process; D-REV-39 |
| `dispatch_exec.rs` | 133-148 | persistently failing merge flaps `merging` / `needs_attention` and appends an event each 5 s (WR-04) | ⚠️ Warning | D-REV-39 |
| `dispatch.rs` | 531 | `is_startable` relaunches a task run manually (WR-05) | ⚠️ Warning | D-REV-39 |
| `commands/dispatch.rs` | 512, 525 | planning spawn request carries no `scopeArmed`, so CR-01's refusal does not apply to a planning run whose armed-empty marker is then unenforced if hook wiring fails | ℹ️ Info | Residual protection is `default` permission mode, which blocks a `Write` on a prompt. Not filed; low. |
| `dispatch.rs`, `limit_gate.rs` | 46, 364, 422 | dead code (IN-01) | ℹ️ Info | D-REV-39 |

### Contradictions between a SUMMARY and CONTEXT

You asked me to look for a second case like 09-07's "a task with no declared set is never excluded", which contradicted D-150. I found two other places where a SUMMARY's account sits uneasily with an owner decision:

- **D-156, "a conflict stops that task and asks the user".** The task stops and a record is written. There is no action the user can take, so "asks" is half true. 09-07-SUMMARY named this ("the one gap worth a decision before the UI plan"), 09-09-SUMMARY repeated it ("should be filed"), and it was never filed. Now **D-REV-41**.
- **D-157, "recorded as an event ... after a live widen a recomputed answer and the answer actually acted on are not the same answer".** The migration allows `cause = 'widen'` and the sheet renders "(after a live widen)", but no code writes the edge. 09-06 and 09-09 do not claim it was written, but a reader of either would assume the path exists. Already D-REV-38.

I found no case where a SUMMARY states something false about code I read. The summaries are candid about limitations, and the review caught the two defects they missed.

## Human Verification Required

None as a routing status. Under the standing owner decision ("Human verification is deferred until MVP") no `09-UAT.md` is opened and nothing is held for a person. Every item below is **deferred, not verified**.

| Item | Register | Physical reason it needs a person or an account | Automatable half |
| ---- | -------- | ------------------------------------------------ | ---------------- |
| Real planning run completes headlessly | D-REV-35 | needs a live `claude` login | argv in `default` mode with a read-only prompt: YES |
| Real hard rate-limit wire shape | D-REV-32 | cannot be provoked on demand | freeze the line when one occurs: YES |
| Real launch through the sidecar | D-REV-34 | live account | scripted `fake-claude.mjs`: YES |
| How the sheet, row, badge and gate line look | D-REV-33, D-REV-36 | WKWebView has no WebDriver; aesthetic judgement | overflow checks already in WebKit |

Everything else I considered was a cheap test, so I did not file it as a human item: the decide-to-launch race (D-REV-37), the `why` answer for undeclared pairs (D-REV-38), and the missing retry and skip commands (D-REV-41) are all testable in the existing `dispatch_auto_merge.rs` harness.

## Gaps Summary

**Two gaps, plus one warning that needs an owner decision.**

1. **PLAN-07 gives a false answer on the default path.** A QuickAdd epic has no declared sets. The CR-02 fix makes its tasks run one at a time, correctly. Asking "why is B waiting?" then returns "declare disjoint sets, so neither waits for the other". A widened pair has the same defect. This is a regression from the CR-02 fix in the sense that the fix made the old answer wrong. Registered as D-REV-38; small, fully automatable.
2. **"Bounded" is enforced in one place that one of two launch callers uses.** `readiness` is sound and well tested. `launch_run_for_task` does not repeat it, so a manual launch, the sleep-in-the-floor window, and `task_file_set_set` on a live task can each put two overlapping armed sets in flight. The most dangerous of these, the laundering of unchecked entries into a live marker by a later widen, needs a command the current UI never calls. The window is real but short. Registered as D-REV-37 and rated High by the orchestrator; I agree with that rating.
3. **Warning (owner decision): the tool-level gate covers file tools, not `Bash`.** This is honestly disclosed in the plans and summaries but was never accepted against the wording of PLAN-04 and criterion 3. A detected breach also does not stop the automatic merge. New **D-REV-42**.

**New, unfiled until now: D-REV-41.** The first failed or conflicting task strands its wave and every later wave, with no in-app recovery other than stopping the plan. Two SUMMARYs said to file it.

**What I could not fault.** The overlap algebra, the shared containment predicate, the widen transaction, the hook's fail-closed paths and the CR-01 command quoting are careful work, and the CR-02 and CR-01 tests were written failing first and now pass. Wave N+1 branches from a base containing wave N, shown by a git read, not by reading code.

**Open gate, stated once more.** The full core integration sweep has not been shown green in one piece. My 223 tests across nine binaries and the orchestrator's partial sweep are evidence, not proof of the suite.

---

_Verified: 2026-10-10T08:32:16Z_
_Verifier: Claude (gsd-verifier)_
