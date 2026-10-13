---
phase: 10-fleet-supervision-across-every-project
verified: 2026-10-12T17:00:00Z
status: passed
score: 5/5 roadmap success criteria verified by automated evidence; OS-level rendering of criterion 4 queued, not observed
closed_under: "deferred-human-verification policy (.claude/CLAUDE.md): a phase closes on its automated verification plus its ROADMAP success criteria. `passed` here records that rule being met — it does NOT assert that any queued item below was observed by a human. D-REV-52 and D-REV-53 (macOS drawing the banner, first-run permission prompt) remain unobserved and are tracked in .planning/DEFERRED-REVIEW.md."
covered_files:
  - .planning/REQUIREMENTS.md
  - .planning/phases/10-fleet-supervision-across-every-project/10-01-PLAN.md
  - .planning/phases/10-fleet-supervision-across-every-project/10-01-SUMMARY.md
  - .planning/phases/10-fleet-supervision-across-every-project/10-02-PLAN.md
  - .planning/phases/10-fleet-supervision-across-every-project/10-02-SUMMARY.md
  - .planning/phases/10-fleet-supervision-across-every-project/10-03-PLAN.md
  - .planning/phases/10-fleet-supervision-across-every-project/10-03-SUMMARY.md
  - .planning/phases/10-fleet-supervision-across-every-project/10-04-PLAN.md
  - .planning/phases/10-fleet-supervision-across-every-project/10-04-SUMMARY.md
  - .planning/phases/10-fleet-supervision-across-every-project/10-05-PLAN.md
  - .planning/phases/10-fleet-supervision-across-every-project/10-05-SUMMARY.md
  - .planning/phases/10-fleet-supervision-across-every-project/10-06-PLAN.md
  - .planning/phases/10-fleet-supervision-across-every-project/10-06-SUMMARY.md
  - .planning/phases/10-fleet-supervision-across-every-project/10-07-PLAN.md
  - .planning/phases/10-fleet-supervision-across-every-project/10-07-SUMMARY.md
  - .planning/phases/10-fleet-supervision-across-every-project/10-08-PLAN.md
  - .planning/phases/10-fleet-supervision-across-every-project/10-08-SUMMARY.md
  - .planning/phases/10-fleet-supervision-across-every-project/10-09-PLAN.md
  - .planning/phases/10-fleet-supervision-across-every-project/10-09-SUMMARY.md
  - packages/core/src/db/migrations/0020_fleet.sql
  - packages/core/src/db/migrations/0021_fleet_review_backlog.sql
  - packages/core/src/db/mod.rs
  - packages/core/src/domain/agent_run.rs
  - packages/core/src/domain/settings.rs
  - packages/core/src/domain/worktree.rs
  - packages/core/src/forge/mod.rs
  - packages/core/src/proc.rs
  - packages/core/src/query/fleet.rs
  - packages/core/src/query/mod.rs
  - packages/core/src/session_log.rs
  - packages/desktop/src-tauri/src/commands/agent_run.rs
  - packages/desktop/src-tauri/src/commands/fleet.rs
  - packages/desktop/src-tauri/src/commands/mod.rs
  - packages/desktop/src-tauri/src/commands/settings.rs
  - packages/desktop/src-tauri/src/main.rs
  - packages/desktop/src-tauri/src/menu.rs
  - packages/desktop/src-tauri/src/notify.rs
  - packages/desktop/src-tauri/src/scheduler.rs
  - packages/desktop/src-tauri/src/state.rs
  - packages/desktop/src/App.tsx
  - packages/desktop/src/adapters/tauri.ts
  - packages/desktop/src/board/BoardView.tsx
  - packages/desktop/src/fleet/BlockedQueue.tsx
  - packages/desktop/src/fleet/FleetSurface.tsx
  - packages/desktop/src/fleet/WorktreeInventory.tsx
  - packages/desktop/src/fleet/useFleet.ts
  - packages/desktop/src/fleet/useWatchedRun.ts
  - packages/desktop/src/item-detail/RunsSection.tsx
  - packages/desktop/src/legend/marks.ts
  - packages/desktop/src/legend/runStatus.ts
  - packages/desktop/src/projects/ProjectRail.tsx
  - packages/desktop/src/session/FeedRow.tsx
  - packages/desktop/src/session/PermissionRequestCard.tsx
  - packages/desktop/src/session/SessionSurface.tsx
  - packages/desktop/src/settings/NotificationsControl.tsx
  - packages/desktop/src/settings/SettingsSurface.tsx
  - packages/desktop/src/state/keyboard.ts
  - packages/desktop/src/state/uiStore.ts
  - packages/sidecar/src/claude-code-adapter.ts
covered_digest: "v1:sha256:7fb6399c27259f5dd2b44f4f6961245442fca4316c91a1f1de8bbb875931da86"
behavior_unverified: 0
overrides_applied: 0
re_verification: false
gaps: []
deferred_review_items:
  - id: D-REV-52
    truth: "A real banner appears in the macOS Notification Center when an agent blocks, finishes or fails (signed build)."
    automatable: "NO (physical: the OS draws it outside the process)"
  - id: D-REV-53
    truth: "First-run macOS notification permission prompt is handled; a user who declines is not left believing banners are on."
    automatable: "NO (physical: the prompt is drawn and answered by the OS)"
  - id: D-REV-47..51, D-REV-54, D-REV-55
    truth: "Look at row density in a WKWebView, plus several 'real IPC / shell' halves."
    automatable: "Mostly YES or PARTLY. See 'Deferred register audit' below; several are cheaper to automate than the register says."
---

# Phase 10: Fleet Supervision Across Every Project: Verification Report

**Phase Goal:** Cyril answers "what is every agent, everywhere, doing, and what needs me?" in one glance, across every registered project.
**Verified:** 2026-10-12 against commit 29f91ef (after all 11 code-review fixes)
**Status:** deferred (per CLAUDE.md "Human verification is deferred until MVP": would otherwise read `human_needed`)
**Re-verification:** No, initial verification

## What was and was not observed

Observed by reading code and by one targeted run (`cargo test -p core --test fleet_query`, 26 passed, including the
0021 upgrade-path test). The workspace-wide figures (791 Rust tests, 1431 vitest) are taken from the orchestrator's
measured facts and were not re-run here.

NOT observed by anyone: the running app, a real macOS banner, the look of any surface. Those are queued, not verified.

## Goal Achievement: ROADMAP success criteria

| # | Criterion | Status | Evidence |
|---|-----------|--------|----------|
| 1 | One view lists every agent across every project, distinguishing running, blocked, awaiting review, failed | VERIFIED | `FLEET_SQL` (`packages/core/src/query/fleet.rs`) joins `agent_runs` to `projects` with no project predicate, derives `awaiting_review` in a `CASE`, orders blocked, awaiting_review, abandoned, running, terminal. `FleetSurface.tsx` groups by `bandForState` and renders glyph plus word per state from `legend/runStatus.ts`. Mounted in `App.tsx` (lazy, below the session branch), reachable from the rail, keystroke and menu (`open-fleet`). Tests `bands_run_blocked_awaiting_review_abandoned_running_then_terminal`, `rows_from_three_projects_interleave_by_waiting_time_not_by_project`, `runs_with_no_task_are_first_class_rows` pass. |
| 2 | Dedicated queue of every blocked agent, all projects | VERIFIED | `BLOCKED_QUEUE_SQL`: `ar.status='blocked' AND pr.status='pending'`, one entry per run, no project predicate. `BlockedQueue.tsx` mounts `PermissionRequestCard` per entry, answers through the unchanged `answerPermissionRequest`; one keyboard owner (index 0). Rail count via `useBlockedQueue` in `ProjectRail.tsx`. Tests `the_queue_spans_projects_and_carries_each_project_name`, `only_blocked_runs_are_queued_and_the_fleet_band_disagrees_where_d172_says` pass. |
| 3 | Jump from any fleet entry to live output and to board item | VERIFIED (one warning, see W-1) | `FleetSurface.tsx`: row click / Enter calls `setActiveAgentRunId(runId, taskId, stage, epicId, null, status)`; subject key button / `b` calls `setCurrentProjectId` + `setPendingFocusItemId` + closes the fleet. `BoardView.tsx:715-755` consumes the one-shot request, opens a collapsed group, opens the detail panel, and drops an unresolvable id after a deadline. Unreachable projects get no target by design. |
| 4 | OS notification when an agent becomes blocked or completes | VERIFIED in code; OS rendering QUEUED (D-REV-52/53) | See "Specific checks" below. Transition sites exist in `commands/agent_run.rs` (running to blocked edge on a pending request; `session_closed` with Completed or Failed). Coalescer, suppression, per-fire-time switch and banner text are pure functions with tests. The drawing of the banner by macOS is not observed. |
| 5 | Every worktree across projects with disk usage and reclaim; token usage and cost per session | VERIFIED (sizes are on demand, see W-2) | `worktree_inventory_inputs` / `finish_worktree_inventory` cover every project; `reclaim_eligibility` plus a per-row re-derivation in `reclaim_worktrees` and a dirty-tree re-read in the removal verb. `WorktreeInventory.tsx` shows size with its age, a reason per row, a Re-measure action and a batch Remove behind one confirmation. Tokens and cost: `SpendCell` and `FleetFooter` in the fleet, `RunsSection.tsx` (cost), `SessionSurface.tsx` meter (tokens in/out, cost). |

**Score:** 5/5 criteria verified from code and tests, with criterion 4's last hop (the OS) deferred.

## Specific checks requested

1. **Tauri not bumped; no click-through.** `packages/desktop/src-tauri/Cargo.toml`: `tauri = "=2.11.5"`, `tauri-plugin-notification = "=2.4.0"`; `Cargo.lock` resolves `tauri 2.11.5` and `tauri-plugin-notification 2.4.0`. `grep -rn "on_action\|\.extra(" packages/desktop/src-tauri/src` returns nothing. `capabilities/default.json` permissions are `core:default`, `dialog:allow-open`, and the scoped sidecar `shell:allow-execute`: no notification permission is granted to the window (D-175 holds). PASS.
2. **Banner still names the agent after WR-07.** `single()` in `notify.rs` titles a banner `"{project} · {subject} is blocked"` and the body is the tool NAME only (`banner_body`), or "Waiting on a permission request." when none. The agent (project plus subject key) is still identified; tool input can no longer reach the banner (`target_of` and the `input` parameter are gone). Summary banners name the count and the distinct projects, not the subjects. Criterion 4 still holds. PASS.
3. **Awaiting-review reachable on an existing database.** `0020_fleet.sql` acknowledged every historic `completed` run. `0021_fleet_review_backlog.sql` un-acknowledges, for runs that are `completed`, whose task is not `done`, that are the task's latest run, and whose `acknowledged_at` equals `COALESCE(ended_at, started_at)` exactly. The test `migration_0021_restores_the_review_backlog_0020_swallowed_and_nothing_else` builds a populated database at migration 19, then migrates through 20 and 21 via `open_and_migrate`, and asserts the right rows return and a person-dismissed, a done-task, an older and a failed run stay hidden. Ran: passes. Reachable on existing installs. Residual: the "backfilled, not dismissed" test is an equality heuristic on a timestamp (acknowledged by the author as the part to confirm); the failure mode is one extra row on the fleet, not a lost one. PASS.
4. **AGNT-08 surfaced, not only persisted.** The write path (`apply_session_closed`, `agent_runs.cost_usd/tokens_in/tokens_out`) predates the phase. It is now read by `FLEET_SQL` into `FleetRow`, rendered by `SpendCell` (cost labelled as an estimate, tokens labelled "in incl. cache"), summed in `FleetFooter` by the core (`visible_cost_usd`), and also shown per run in `RunsSection.tsx` and in the session meter. A live run shows blank spend in the fleet by design (the backend reports totals once, on the terminal result). PASS.

## Requirements Coverage

All seven IDs are in `.planning/REQUIREMENTS.md` marked complete and mapped to Phase 10 in its traceability table; no orphans.

| Requirement | Description | Status | Evidence |
|-------------|-------------|--------|----------|
| FLEET-01 | One view, every agent, every project | SATISFIED | Criterion 1 |
| FLEET-02 | Dedicated blocked queue, all projects | SATISFIED | Criterion 2 |
| FLEET-03 | Jump to live output and board item | SATISFIED (W-1) | Criterion 3 |
| FLEET-04 | Distinguish running/blocked/awaiting review/failed | SATISFIED | Criterion 1; word plus glyph per state |
| FLEET-05 | OS notification on blocked or completed | SATISFIED in code, OS draw queued | Criterion 4; D-REV-52/53 |
| WORK-07 | All worktrees, disk usage, reclaim stale ones | SATISFIED (W-2) | Criterion 5; `worktree_reclaim.rs` |
| AGNT-08 | Token usage and cost per session | SATISFIED | Check 4 above |

## Anti-Patterns

Scanned the 70 non-markdown files this phase changed (`781d3d3..29f91ef`): no `TBD`, `FIXME`, `XXX`, `TODO`, `HACK`, `PLACEHOLDER` or "not yet implemented" in any of them. No blockers.

## Warnings (non-blocking)

- **W-1: Blocked-queue entries carry no jump.** `BlockedQueue.tsx` renders project, subject and the permission card but no link to the session or the board item. The same agent has both jumps as a NEEDS YOU row on the "All agents" view, and the queue's purpose is answer-in-place, so criterion 3 is met on fleet rows. If "any fleet entry" is read to include queue entries, this is a small gap. Cheap to close and to test with vitest.
- **W-2: Worktree sizes are blank until the user presses Re-measure.** `WorktreeInventory.tsx` has no measure-on-open. This is owner decision D-177 (on-demand, cached, shown with age), so "sees its disk usage" means after one press. Not a defect against the decision; flagged so it is not read as automatic.
- **W-3: Review-fix residuals, disclosed in `10-REVIEW-FIX.md`, still true.** WR-01 (hot and cold scheduler ticks still hold the DB mutex across git), WR-04 (live-run re-check narrows the reclaim race, does not close it), WR-05 (a half-removed tree is diagnosed but not reclaimable again; shared-connection deferred transactions remain). None breaks a success criterion. The dirty-tree refusal in the removal verb is untouched and still the final guard.
- **W-4: First launch of this build will show a possibly large awaiting-review backlog** (0021). Intended, but a visible behaviour change.

## Deferred register audit (`.planning/DEFERRED-REVIEW.md`, D-REV-47 to 55)

Nine entries; the count in 10-09's SUMMARY correction (47, 48, 49, 50, 51, 52, 53, 54, 55) matches the register. Only D-REV-52 and D-REV-53 are truthfully `automatable: NO`. The others are over-deferred in the following specific ways, and should be worked down before Phase 11 rather than redeemed by the owner:

- D-REV-49 and D-REV-50: the "real Tauri round trip" half is already covered. `acknowledging_each_terminal_status_removes_the_run_from_the_fleet` and `an_answered_request_does_not_appear` (fleet_query.rs) assert that acknowledge or answer removes the row from the read. What remains is the look, which is an aesthetic judgement (physical reason: no WebDriver for WKWebView). Reclassify as aesthetic-only.
- D-REV-51: the shell half ("mount App.tsx with a switched project, press the subject key, assert the detail panel") is a vitest test, not Playwright: `menu-bridge.test.tsx`, `unreachable-in-app.test.tsx` and `project-rail.test.tsx` already import and mount `App`. `automatable: YES`.
- D-REV-48, D-REV-54, D-REV-55: the logic halves (tail read after an append, reclaim outcomes, `fleet_list` answerable during a removal) are core-level tests against a scratch database; `worktree_reclaim.rs` already does most of this. "Window stays responsive during a multi-second walk" is the only part needing a real build.
- D-REV-47 and the look clauses elsewhere: human aesthetic judgement; legitimate deferrals.

No UAT file was created and no checkpoint is requested.

## Gaps Summary

No gaps against the five roadmap success criteria. The phase closes on automated verification. What is not claimed: that anyone has seen the fleet, the queue, a banner or the worktree inventory in a running app.

---

_Verified: 2026-10-12_
_Verifier: Claude (gsd-verifier)_
