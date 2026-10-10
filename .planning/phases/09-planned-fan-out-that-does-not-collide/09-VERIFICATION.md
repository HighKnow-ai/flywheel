---
phase: 09-planned-fan-out-that-does-not-collide
verified: 2026-10-10T11:06:57Z
status: deferred
score: 10/13 must-haves verified
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
  - .planning/phases/09-planned-fan-out-that-does-not-collide/09-10-PLAN.md
  - .planning/phases/09-planned-fan-out-that-does-not-collide/09-10-SUMMARY.md
  - .planning/phases/09-planned-fan-out-that-does-not-collide/09-11-PLAN.md
  - .planning/phases/09-planned-fan-out-that-does-not-collide/09-11-SUMMARY.md
  - .planning/phases/09-planned-fan-out-that-does-not-collide/09-12-PLAN.md
  - .planning/phases/09-planned-fan-out-that-does-not-collide/09-12-SUMMARY.md
  - .planning/phases/09-planned-fan-out-that-does-not-collide/09-13-PLAN.md
  - .planning/phases/09-planned-fan-out-that-does-not-collide/09-13-SUMMARY.md
  - .planning/phases/09-planned-fan-out-that-does-not-collide/09-REVIEW.md
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
  - packages/desktop/src/launch-sheet/LaunchSheet.tsx
  - packages/desktop/src/launch-sheet/__tests__/launch-sheet.test.tsx
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
covered_digest: "v1:sha256:defc369f325cd60f9bf812146cc8ee8e0643ee364689bde0113f60274f68e850"
behavior_unverified: 2
overrides_applied: 0
re_verification:
  previous_status: gaps_found
  previous_score: 8/13
  gaps_closed:
    - "SC2 / PLAN-07: why answers truthfully for the undeclared pair and for the widened pair (D-REV-38)"
    - "Goal: the decide-to-launch window, the same-task double launch, and the task_file_set_set bypass (D-REV-37)"
  gaps_remaining: []
  regressions: []
gaps: []
deferred: []
warnings_open:
  - id: D-REV-44
    finding: "The launch body folds case unconditionally; the dispatcher folds by the repo's real case sensitivity (09-REVIEW WR-02). On a case-sensitive repository the one rule gives two verdicts. Safe-side only: the launch is stricter, never laxer."
  - id: D-REV-45
    finding: "A live widen records no edge for a same-wave task parked in a pre-spawn needs_attention state (09-REVIEW WR-03). That task can start on a base without the widener's work."
  - id: D-REV-46
    finding: "A failure after the run row exists strands a running row; the new HasLiveRun guard turns that into a refused retry on the manual path (09-REVIEW WR-01). MergeConfirmSheet drops the overlap warning and swallows refusal text (WR-05)."
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
    note: "hard rate-limit wire shape unobserved (open)"
  - id: D-REV-33
    note: "scope-denied row and badge look unobserved (open)"
  - id: D-REV-34
    note: "real launch through the sidecar untested (open)"
  - id: D-REV-35
    note: "real planning run never executed (open)"
  - id: D-REV-36
    note: "nothing on the fan-out surface looked at by a person (open)"
  - id: D-REV-37
    note: "RESOLVED by this verification: launch-time re-check, window test, declare guard. Manual-launch overlap stays allowed by design and is now recorded and warned."
  - id: D-REV-38
    note: "RESOLVED by this verification: why answers runs-alone and widen; sheet shows the signal. One narrow hole filed as D-REV-45."
  - id: D-REV-39
    note: "WR-03/04/05/07 + 3 Info (open)"
  - id: D-REV-40
    note: "TDD gate wiring, process finding (open)"
  - id: D-REV-41
    note: "no retry or skip for a failed, stopped or conflicted task; it strands its wave (open)"
  - id: D-REV-42
    note: "Bash writes are detective only; a detected breach does not stop the automatic merge (open; owner acceptance needed)"
  - id: D-REV-43
    note: "overlap-warning toast host has no component test (open)"
  - id: D-REV-44
    note: "NEW: launch body folds case unconditionally, dispatcher folds by the real flag (open, automatable)"
  - id: D-REV-45
    note: "NEW: widen records no edge for a pre-spawn needs_attention task (open, automatable)"
  - id: D-REV-46
    note: "NEW: stranded running row now blocks a manual retry; MergeConfirmSheet drops the warning (open, automatable)"
---

# Phase 9: Planned Fan-Out That Does Not Collide - Verification Report

**Phase Goal:** Cyril turns one epic into several agents working at once, with parallelism bounded by real file-set disjointness rather than optimism.
**Mode:** mvp
**Verified:** 2026-10-10T11:06:57Z
**Status:** deferred (the standard vocabulary would read `human_needed`; the owner's standing decision of 2026-10-07 maps it to `deferred`, so nothing holds the phase open)
**Re-verification:** Yes - after gap closure (plans 09-10, 09-11, 09-12, 09-13)

## Verdict in one paragraph

Both recorded gaps are closed in code, and I read the code rather than the summaries to say so. `why` now answers a runs-alone cause for an undeclared same-wave pair, and a live widen now writes a `widen` edge and a `task.sequenced` event inside its own transaction. There is one launch-conflict function (`launch_conflict`, `packages/core/src/dispatch.rs:627`) that `readiness` and the shared launch body both call. The launch body asks it under the database lock, before the run row is inserted, so the decide-to-launch window is closed at the one place every launch passes through. A declare on a task with a live run is refused in `declare_file_set_in_tx`, the only function that writes declared entries besides the widen. The phase is not unconditionally closed on its claims, though. Three things I would not let a summary say: (1) "one rule, one verdict" is true of the implementation and false of the verdict on a case-sensitive repository (WR-02 confirmed, filed D-REV-44); (2) a manual launch over a different live task is still allowed; it is now recorded and warned, by an earlier owner-recorded choice; (3) the two behaviours that need a real account (a real planning run, a real hard limit) and the Bash-write qualification on criterion 3 are unchanged from the first verification and remain deferred, not observed. No gap blocks the phase.

## Automated gates: what is and is not shown

| Gate | Source | Result |
| ---- | ------ | ------ |
| `cargo test -p core` (93 binaries) | orchestrator | 1256 passed, 0 failed, 2 ignored. Not re-run by me. |
| `cargo test -p relay-client -p flywheel-shim -p desktop` | orchestrator | 129 passed, 0 failed. Not re-run by me. |
| `credentials` (hangs on a macOS keychain prompt), `forge_live_chain`, `forge_live_github` (network) | orchestrator | **NOT RUN. NOT VERIFIED.** Not claimed. |
| `vitest run` on `wave-plan-sheet.test.tsx` and `launch-sheet.test.tsx` | me | 2 files, 62 tests passed. The orchestrator's gate did not cover the frontend, and 09-10 and 09-13 changed both files. |
| Full desktop vitest, `tsc`, `vite build`, sidecar suite | - | Not run in this re-verification. The first verification's orchestrator figures (vitest 1292, sidecar 275) predate the gap-closure commits and are not carried forward as evidence here. |

I did not re-run the sidecar tests: no gap-closure plan touched `packages/sidecar`, and `git log` shows the last sidecar commit is `ad78451` (CR-01), before the first verification.

## Goal Achievement

### Observable Truths

| #  | Truth | Status | Evidence |
| -- | ----- | ------ | -------- |
| 1  | SC1: a planner run leaves tasks that each declare a file-set, grouped into waves (PLAN-01) | ⚠️ PRESENT_BEHAVIOR_UNVERIFIED | Unchanged from the first verification. `submit_plan` held call, Rust-side authority, `dispatch_plan` tests. No real planning run has ever happened (D-REV-35). Not touched by 09-10..13. |
| 2  | SC2a: two tasks declaring overlapping files go sequential as a pair; the rest of the wave runs (PLAN-02, PLAN-03) | ✓ VERIFIED | `edges_for_plan` (`dispatch.rs:106`) emits one edge per colliding pair via `collisions`. `readiness` now delegates the in-flight comparison to `launch_conflict` (`dispatch.rs:567-602`) with the same `taken` list, and the 32 `dispatch_auto_merge` tests (incl. the seven `undeclared_*`) pass in the orchestrator's sweep. |
| 3  | SC2b: the user can ask why any two tasks were sequenced and get a true answer (PLAN-07) | ✓ VERIFIED | Three causes, three answers. (a) Overlap edge: unchanged, the stored edge is read first (`dispatch.rs:174-190`). (b) Undeclared pair: the no-edge, same-wave arm now reads `list_entries_for_task` and returns `RunsAlone { undeclared_task_ids }` (`:200-215`), the same rows `launch_conflict` refuses on; tests at `dispatch_plan.rs:451-496` cover both argument orders, one-sided and two-sided, different waves, and "a frozen edge still wins after both sets are emptied". (c) Widen: `record_widen_sequencing` (`domain/file_set.rs:526`) writes the edge with `EDGE_CAUSE_WIDEN` and a `task.sequenced` event through the same two writers approval uses; `scope_widen.rs:380-486` covers acceptance with `why` reporting the cause, no second edge on a second widen, no edge when refused, other wave, no live plan, nobody reached, and atomic rollback. Cosmetic defect in the sentence (WR-04, below). One narrow hole (D-REV-45). |
| 4  | SC3a: a write outside the declared set through a file-writing tool is refused at the tool call and becomes a scope event (PLAN-04, PLAN-05) | ✓ VERIFIED | Unchanged. Regression check only: `SCOPE_GATE_MATCHER = "Write\|Edit\|MultiEdit\|NotebookEdit"` (`claude-code-adapter.ts:184`); no sidecar file changed since the first verification. |
| 5  | SC3b: the same holds for a write through `Bash` | ? UNCERTAIN | Unchanged. The matcher cannot see `Bash`; the close-time backstop is detective; a flagged breach still auto-merges. Owner acceptance needed against the wording of PLAN-04 and criterion 3. D-REV-42. |
| 6  | SC4: the user caps global parallel width and the dispatcher never exceeds it (PLAN-06) | ✓ VERIFIED (decision time) | Unchanged in `decide`. 09-13 did not change the cap rule and the manual-launch test `a_manual_launch_at_or_above_the_cap_still_proceeds` pins D-159: the cap is the dispatcher's alone. A manual launch can exceed the cap by design. |
| 7  | SC5: a rate or session limit pauses new dispatch, the user is told, dispatch resumes at the reported instant (AGNT-05) | ⚠️ PRESENT_BEHAVIOR_UNVERIFIED | Unchanged. Wired end to end; the hard-limit `rejected` shape has never been observed (D-REV-32). |
| 8  | Goal: parallelism is bounded by real disjointness, as an invariant every launch path respects | ✓ VERIFIED (qualified) | Re-run of the first verification's three paths. **Path 2, the window: CLOSED.** `prepare_launch` calls `launch_conflict` (`agent_run.rs:786`) under the lock the caller already holds, before `start_agent_run_recording_first` (`:807`) inserts the row, so check and insert are atomic and a refused launch creates nothing; the dispatcher's closure passes `CrossTaskConflict::Refuse` (`commands/dispatch.rs:510`). Test `a_dispatched_launch_colliding_with_a_live_task_is_refused_and_creates_nothing` asserts run-row count and event count unchanged. The core-side window test (`dispatch_auto_merge.rs:1074`) simulates the window with a closure that calls `launch_conflict` itself, so it proves the rule and the retry, not the desktop wiring; the desktop `prepare_launch` tests prove the wiring. **Path 3, the declare bypass: CLOSED.** `declare_file_set_in_tx` calls `declare_refusal` first (`domain/file_set.rs:84-90`); I grepped every `INSERT`/`DELETE` on `task_file_set_entries` and the only two writers are that function and the widen. **Path 1, the manual launch: NOT CLOSED, by design.** A user's own launch over a different live task proceeds. It is now recorded as a `task.launch_overlap` event and the warning rides back on `AgentRunDto.overlapWarning` (`agent_run.rs:803-812`, `tauri.ts:71`) to a toast in `App.tsx:352-387`. The same-task double launch is refused on both paths. The invariant is therefore absolute for every autonomous launch and a visible, recorded override for a human one. |
| 9  | "Merged, not finished": wave N+1 branches off a base containing wave N (D-156, D-158) | ✓ VERIFIED | Unchanged. |
| 10 | Live widen takes effect on the next tool call and is refused if it reaches any in-flight task's set (D-152) | ✓ VERIFIED | Unchanged refusal; 09-11 added the edge write inside the same `IMMEDIATE` transaction without weakening it. `a_widen_refused_for_a_running_sibling_writes_no_edge_and_no_event` and `the_widen_and_its_record_land_together_or_not_at_all` cover it. |
| 11 | CR-01: an armed run whose scope gate cannot be installed is refused | ✓ VERIFIED | Unchanged. |
| 12 | CR-02: a task with no declared set runs alone | ✓ VERIFIED | Unchanged in behaviour. The loop moved into `launch_conflict` and keeps the empty-set test inside it (`dispatch.rs:655-657`); the seven `undeclared_*` tests are in the orchestrator's green sweep. |
| 13 | D-149: no agent spawns before the user approves a reviewable wave plan | ✓ VERIFIED | Unchanged. 09-10 added "No files declared, so this task runs alone." to the draft and read-only sheet (`WavePlanSheet.tsx:155-157`), read off `task.entries`, not recomputed; skipped tasks show nothing. |

**Score:** 10/13 truths verified (counting 8 as verified with its qualification stated), 2 present but behavior-unverified (1, 7), 1 uncertain (5).

### Gap-closure must-haves, checked against code

| Plan | Must-have | Status | Note |
| ---- | --------- | ------ | ---- |
| 09-10 | `why` returns runs-alone only on the no-edge branch; frozen edge read first | ✓ | `:174` edge read precedes `:200` |
| 09-10 | Sheet shows the signal, derived from `entries`, no new DTO field | ✓ | `WavePlanSheet.tsx:155`. Also shows on merged, finished and failed tasks (IN-03), where "runs alone" is stale. Cosmetic. |
| 09-11 | Widen writes edge and event in the widen's own transaction, skips a pair with an existing edge in either orientation, no subprocess | ✓ | `domain/file_set.rs:560-596` |
| 09-11 | Declare refused while a run is live; guard in the single function | ✓ | `:58-90` |
| 09-12 | ONE implementation of the rule; `readiness` calls it | ✓ | `launch_conflict`, `dispatch.rs:627`; no second `collisions` loop in the launch path |
| 09-12 | "…so the dispatcher's decision and any launch-time re-check can never drift apart" | ⚠️ FALSE on case-sensitive repos | `prepare_launch` passes `fold_case = true` (`agent_run.rs:786`); `readiness` passes the observed flag (`dispatch.rs:595`). Confirmed WR-02. One implementation, two arguments. The launch is the stricter side, so a collision is never admitted; the cost is a repeating decide-then-refuse cycle that surfaces as "Needs you" for a pair the dispatcher judged safe, until the live peer ends. The `ponytail:` comment at `:781-785` documents the ceiling. D-REV-44. |
| 09-13 | Conflict read before any run state is created; refusal creates no row | ✓ | `:786` before `:807`; test asserts footprint unchanged |
| 09-13 | Dispatched launch refused, retried by the dispatcher on the next pass | ✓ | `run_pass` Spawn error arm marks a pre-spawn `LaunchFailed` (`dispatch_exec.rs:211`), which `is_startable` retries |
| 09-13 | Manual launch over a different live task proceeds, recorded and warned; cap not applied | ✓ | tests at `agent_run.rs:3568-3600, 3632-3645` |
| 09-13 | One spawn site | ✓ | `send_gated_spawn` only; `spawn_stagger` in the orchestrator's green sweep |

### Required Artifacts

| Artifact | Expected | Status | Details |
| -------- | -------- | ------ | ------- |
| `packages/core/src/dispatch.rs` `launch_conflict`, `why` | one rule, truthful explanation | ✓ VERIFIED | Substantive, called by `readiness` and by `prepare_launch` |
| `packages/core/src/domain/file_set.rs` `record_widen_sequencing`, `declare_refusal` | widen record, declare guard | ✓ VERIFIED | Wired inside the widen transaction and `declare_file_set_in_tx` |
| `packages/desktop/src-tauri/src/commands/agent_run.rs` `prepare_launch`, `CrossTaskConflict` | conflict check before any state | ✓ VERIFIED | Called by `launch_run_for_task`, which both `agent_run_start` and the dispatcher call |
| `packages/desktop/src-tauri/src/commands/dispatch.rs` `dispatch_why` | sentence for every `SequencingReason` | ✓ VERIFIED | Exhaustive match; a new variant fails to compile |
| `packages/desktop/src/dispatch/WavePlanSheet.tsx` | runs-alone signal | ✓ VERIFIED | 62 vitest tests pass across it and the launch sheet |
| `packages/desktop/src/launch-sheet/LaunchSheet.tsx`, `App.tsx` toast | warning reaches the user | ⚠️ WIRED, one host untested | `App.tsx` is the reachable copy; the in-sheet copy is mounted for zero visible frames (IN-01). The toast has no component test (D-REV-43). |
| a retry or skip command | recovery for a stuck task | ✗ MISSING | Unchanged; D-REV-41. Not in scope of this phase's gap closure. |

### Key Link Verification

| From | To | Via | Status | Details |
| ---- | -- | --- | ------ | ------- |
| `readiness` | `launch_conflict` | direct call, `dispatch.rs:595` | WIRED | |
| `prepare_launch` | `launch_conflict` | direct call, `agent_run.rs:786` | WIRED | now the key link the first verification marked NOT_WIRED |
| `agent_run_start` | `launch_run_for_task` | `CrossTaskConflict::WarnAndProceed` | WIRED | |
| dispatcher closure | `launch_run_for_task` | `CrossTaskConflict::Refuse`, `commands/dispatch.rs:510` | WIRED | |
| `task_file_set_set` | `declare_file_set_in_tx` | `commands/file_set.rs:98` | WIRED | the core guard is the authority |
| widen | `insert_edge_in_tx`, `append_sequenced_event` | same writers as approval | WIRED | |
| `AgentRunDto.overlapWarning` | toast | `tauri.ts:71` -> `LaunchSheet.tsx:690` -> `App.tsx:359` | WIRED | `MergeConfirmSheet.tsx:218` calls the same command and renders nothing (WR-05, D-REV-46) |
| `after_completed_run` / `merge_task` | `task.scope_denied` | none | NOT_WIRED | D-REV-42, unchanged |

### Data-Flow Trace (Level 4)

`launch_conflict` and the widen scan read `agent_runs`, `dispatch_edges`, `dispatch_plan_tasks`, `task_file_set_entries` and `tasks` rows. The warning string is composed in Rust from stored rows (`conflict_sentence`) and passed verbatim; the renderer computes no overlap. The runs-alone signal on the sheet is derived from `task.entries`, which `dispatch_plan_get` fills from the stored rows. Not traced: each React value back through its Tauri command to a query, beyond these.

### Behavioral Spot-Checks

| Behavior | Command | Result | Status |
| -------- | ------- | ------ | ------ |
| Wave plan sheet and launch sheet | `npx vitest run` on the two files | 62 passed | ✓ PASS |
| Core and desktop crates | orchestrator's runs | 1256 and 129 passed | ✓ PASS (not mine) |
| Real launch through the sidecar | n/a | not runnable here | ? SKIP (D-REV-34) |

### Probe Execution

No probes declared in any PLAN and none under `scripts/*/tests/probe-*.sh`. Step 7c: SKIPPED (no probes).

### Requirements Coverage

All eight IDs are claimed in a PLAN's `requirements:` and a SUMMARY's `requirements-completed:`; none is ORPHANED.

| Requirement | Source Plans | REQUIREMENTS.md now | Verdict | Evidence |
| ----------- | ------------ | ------------------- | ------- | -------- |
| PLAN-01 | 09-08 | Gaps Found | ⚠️ mechanism satisfied, never run for real | Truth 1; D-REV-35 |
| PLAN-02 | 09-03, 09-11, 09-12, 09-13 | Complete | ✓ SATISFIED | Truths 2, 8 |
| PLAN-03 | 09-03, 09-07, 09-12, 09-13 | Complete | ✓ SATISFIED | Truths 2, 8 |
| PLAN-04 | 09-01 | Gaps Found | ⚠️ SATISFIED for file-writing tools only | Truths 4, 5; D-REV-42 |
| PLAN-05 | 09-02, 09-06 | Gaps Found | ✓ SATISFIED (look unobserved, D-REV-33) | Truth 4. The table's "Gaps Found" is stale against the evidence. |
| PLAN-06 | 09-04, 09-07 | Gaps Found | ✓ SATISFIED at decision time | Truth 6. The table's "Gaps Found" is stale against the evidence. |
| PLAN-07 | 09-03, 09-09, 09-10, 09-11 | Complete | ✓ SATISFIED, now for all three causes | Truth 3. This verification is what makes the existing "Complete" true. |
| AGNT-05 | 09-05 | Gaps Found | ✓ SATISFIED against the documented shape; hard shape unobserved | Truth 7; D-REV-32 |

I did not edit `REQUIREMENTS.md`. The orchestrator should reconcile PLAN-05 and PLAN-06 (evidence supports Complete) and decide PLAN-01, PLAN-04 and AGNT-05 (Complete with the qualification stated, or hold until the Phase 11 register is redeemed).

### Anti-Patterns Found

| File | Line | Pattern | Severity | Impact |
| ---- | ---- | ------- | -------- | ------ |
| (added lines, `git diff 540f296..HEAD` over the gap-closure files) | - | `TBD`, `FIXME`, `XXX` | none | Debt-marker gate clear: no added `TBD`, `FIXME` or `XXX` line in `git diff 540f296..HEAD -- packages`. |
| `agent_run.rs` | 807-812, 893-905 | A `?` after the run row exists strands a `running` row; `HasLiveRun` then refuses every manual retry | ⚠️ Warning | WR-01, D-REV-46. The dispatcher path was already blocked by `t.live`; the manual path is newly affected. Cleared only by startup reconcile. |
| `agent_run.rs` | 781-792 | `fold_case = true` unconditionally | ⚠️ Warning | WR-02, D-REV-44 |
| `domain/file_set.rs` | 564-575 | Queued-state list omits pre-spawn `needs_attention`, which `is_startable` starts | ⚠️ Warning | WR-03, D-REV-45. The task can start on a base without the widener's merged work; `why` answers `DisjointSets` for a pair that was in fact sequenced. |
| `commands/dispatch.rs` | 410-417 | Sentence says "never shares a wave" for a pair that is in the same wave | ⚠️ Warning | WR-04. Names the right cause, states a false detail. Reword to "never runs at the same time as another task". Unfiled; one-line fix. |
| `MergeConfirmSheet.tsx` | 213-224 | Drops `overlapWarning`; replaces any error with a fixed string | ⚠️ Warning | WR-05, D-REV-46 |
| `LaunchSheet.tsx`, `App.tsx` | 777-790; 155-163, 367-387 | In-sheet warning never visible; toast is non-announced, non-dismissible, timeout in a magic number | ℹ️ Info | IN-01, IN-02 |
| `WavePlanSheet.tsx` | 155-157 | Runs-alone line shows on settled tasks | ℹ️ Info | IN-03 |

None of these is a Critical. The review found 0 critical, 5 warning, 5 info, and I agree with its rating after reading the code for WR-01, WR-02, WR-03 and WR-05.

### WR-02 specifically (the one the orchestrator asked about)

Confirmed. `readiness` resolves `fold` from `obs.case_insensitive` for the task's project (`dispatch.rs:595`); `prepare_launch` hard-codes `true`. On a case-insensitive filesystem (macOS APFS default) both fold and the verdict is identical, so the v1 target does not exhibit it. On a case-sensitive repository, two same-wave tasks declaring `Src/a.rs` and `src/a.rs` are disjoint to planning and to `decide`; the launch body refuses the second; `run_pass` marks it `needs_attention` / `LaunchFailed`; `is_startable` accepts that state on the next tick; the cycle repeats until the first task ends. The failure direction is safe: the launch is stricter than the decision, so it can never admit a collision the dispatcher would refuse. That is why I rate it a warning and not a gap, and why the phase goal ("bounded") is intact. The 09-12 must-have text "can never drift apart" is, however, literally untrue, and I record it as such rather than as verified. The fix is cheap (resolve the flag before taking the lock, pass it in, make `repo_is_case_insensitive` public), so it is filed as automatable.

## Human Verification Required

None as a routing status. Under the owner's decision of 2026-10-07 no `09-UAT.md` is opened and nothing holds the phase. Every item below is **deferred, not verified**, and is in `.planning/DEFERRED-REVIEW.md`.

| Item | Register | Physical reason | Automatable half |
| ---- | -------- | --------------- | ---------------- |
| Real planning run completes headlessly | D-REV-35 | needs a live `claude` login | argv in `default` mode: YES |
| Real hard rate-limit wire shape | D-REV-32 | cannot be provoked on demand | freeze the line when one occurs: YES |
| Real launch through the sidecar | D-REV-34 | live account | scripted `fake-claude.mjs`: YES |
| How the sheet, row, badge, gate line and overlap toast look | D-REV-33, D-REV-36 | WKWebView has no WebDriver; aesthetic judgement | overflow checks already in WebKit |
| Bash writes are detective only (criterion 3 wording) | D-REV-42 | an owner decision, not a check | the cheap half (needs-attention on a flagged breach): YES |

Not human items, and filed as automatable: D-REV-44, D-REV-45, D-REV-46, D-REV-43, D-REV-41.

## Gaps Summary

None. Both gaps recorded by the first verification are closed. Three new warnings (D-REV-44, D-REV-45, D-REV-46) and one unfiled wording defect (WR-04) are open and none touches a ROADMAP success criterion.

The ROADMAP criteria, honestly: SC2 and SC4 are met and observed in tests. SC1 and SC5 are met by mechanism and tested against fakes; neither has been seen with a real account. SC3 is met for `Write`, `Edit`, `MultiEdit` and `NotebookEdit` and is detective only for `Bash`. The phase closes on this; it does not close with those three observed.

---

_Verified: 2026-10-10T11:06:57Z_
_Verifier: Claude (gsd-verifier)_
