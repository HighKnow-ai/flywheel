---
phase: 10-fleet-supervision-across-every-project
plan: 07
subsystem: fleet
tags: [rust, tauri, react, notifications, settings, sqlite]

requires:
  - phase: 10-fleet-supervision-across-every-project
    provides: "10-01 fleet surface; 10-05 blocked queue; 10-06 fleet row jumps and the precedence chain in App.tsx"
  - phase: 09-planned-fan-out-that-does-not-collide
    provides: "dispatch_max_parallel, the setting pattern this switch copies (D-159)"
provides:
  - "notify.rs: Coalescer (3 s window), Banner, should_suppress, banner_body, target_of, and a tick that reads the switch and the window's focus at fire time"
  - "tauri-plugin-notification =2.4.0 registered on the Rust core only; the window's capability file carries no grant, enforced by a unit test"
  - "Two transition hooks in commands/agent_run.rs: running -> blocked, and a completed or failed close"
  - "fleet_watch_run and AppState.watched_run; useWatchedRun in the renderer"
  - "notifications_enabled / set_notifications_enabled (default on, degrades to on), settings_set_notifications_enabled, one checkbox in Settings"
affects: [10-08, 10-09, 11]

requirements-completed: [FLEET-05]

actuals:
  tokens: 26500
  tasks: 3
  commits: 3
plan_head_before: 392d6c47203d36859c035d0d765622dac3fdefb0
commits: 3

tech-stack:
  added: ["tauri-plugin-notification =2.4.0 (crates.io, official Tauri v2 plugin)"]
  patterns:
    - "Pure decision functions with the clock injected, plus a thin shell: the scheduler.rs split"
    - "A hook function returns Option<Transition> from a bare Connection, so the edge rule is unit-testable without an AppHandle"
    - "A read of state that processing is about to change (prior run status) happens before processing, under the same lock"

key-files:
  created:
    - packages/desktop/src-tauri/src/notify.rs
    - packages/core/tests/settings_notifications.rs
    - packages/desktop/src/fleet/useWatchedRun.ts
    - packages/desktop/src/fleet/__tests__/watched-run.test.tsx
    - packages/desktop/src/settings/NotificationsControl.tsx
    - packages/desktop/src/settings/__tests__/notifications.test.tsx
  modified:
    - packages/desktop/src-tauri/Cargo.toml
    - Cargo.lock
    - packages/desktop/src-tauri/src/main.rs
    - packages/desktop/src-tauri/src/state.rs
    - packages/desktop/src-tauri/src/commands/agent_run.rs
    - packages/desktop/src-tauri/src/commands/fleet.rs
    - packages/desktop/src-tauri/src/commands/settings.rs
    - packages/desktop/src-tauri/capabilities/default.json
    - packages/core/src/domain/settings.rs
    - packages/desktop/src/adapters/tauri.ts
    - packages/desktop/src/settings/SettingsSurface.tsx
    - packages/desktop/src/App.tsx

key-decisions:
  - "COALESCE_WINDOW is 3 seconds; TARGET_CAP is 60 characters and TOOL_CAP 32. All three are named constants and the window is pinned by a test"
  - "Suppression is applied per transition at fire time, so take_due takes a keep predicate; a wave of 8 with one watched run shows a 7-agent summary, not an 8-agent one"
  - "A mixed-kind burst reads 'N agents changed state', so Banner::Summary.kind is an Option"
  - "The permission hook gathers project and subject text with the connection still held, then drops it, then pushes"
  - "The Settings checkbox lives in its own file because settings/__tests__/finish.test.tsx requires control-edge on every input in SettingsSurface.tsx and the project's own checkbox idiom is admin-check"

duration: ~25min (not timed at start)
completed: 2026-10-12
status: complete

coverage:
  - id: D1
    description: "One transition inside the window is one single banner naming project, subject and state; several are one summary with a count and distinct projects; an identical run-and-kind pair collapses"
    requirement: FLEET-05
    verification:
      - kind: unit
        ref: "packages/desktop/src-tauri/src/notify.rs#tests (one_transition_is_one_single_banner..., three_transitions_are_one_summary..., the_same_run_and_kind_twice_collapses_to_one)"
        status: pass
    human_judgment: false
  - id: D2
    description: "interrupted and abandoned cannot be notified: TransitionKind has three variants and the close hook maps only Completed and Failed"
    requirement: FLEET-05
    verification:
      - kind: unit
        ref: "packages/desktop/src-tauri/src/commands/agent_run.rs#only_completed_and_failed_closes_notify"
        status: pass
    human_judgment: false
  - id: D3
    description: "A run already blocked that receives a second request notifies nothing; a running run notifies once with the tool and a target; a missing row degrades to generic words"
    requirement: FLEET-05
    verification:
      - kind: unit
        ref: "packages/desktop/src-tauri/src/commands/agent_run.rs#a_run_already_blocked_that_gets_a_second_request_notifies_nothing"
        status: pass
      - kind: unit
        ref: "packages/desktop/src-tauri/src/commands/agent_run.rs#a_missing_project_or_task_row_degrades_to_generic_words_and_never_panics"
        status: pass
    human_judgment: false
  - id: D4
    description: "Suppression only when the switch is off, or the window is focused and that very run is watched; the fleet surface is not a watched run; the switch is read at fire time"
    requirement: FLEET-05
    verification:
      - kind: unit
        ref: "packages/desktop/src-tauri/src/notify.rs#suppression_needs_the_switch_off_or_a_focused_window_on_that_very_run"
        status: pass
      - kind: unit
        ref: "packages/desktop/src-tauri/src/notify.rs#the_switch_is_read_at_fire_time_so_a_toggle_needs_no_restart"
        status: pass
      - kind: unit
        ref: "packages/desktop/src/fleet/__tests__/watched-run.test.tsx#useWatchedRun"
        status: pass
    human_judgment: false
  - id: D5
    description: "A banner body is the tool name plus a target capped at 60 characters, never the payload; the window capability file grants no notification permission"
    requirement: FLEET-05
    verification:
      - kind: unit
        ref: "packages/desktop/src-tauri/src/notify.rs#a_body_carries_the_tool_and_a_capped_target_never_the_payload"
        status: pass
      - kind: unit
        ref: "packages/desktop/src-tauri/src/notify.rs#the_window_capability_grants_no_notification_permission"
        status: pass
    human_judgment: false
  - id: D6
    description: "One global switch in Settings, default on, round-trips, degrades to on on a garbage stored value, no per-project control"
    requirement: FLEET-05
    verification:
      - kind: integration
        ref: "packages/core/tests/settings_notifications.rs"
        status: pass
      - kind: unit
        ref: "packages/desktop/src/settings/__tests__/notifications.test.tsx"
        status: pass
    human_judgment: false
  - id: D7
    description: "A real banner appears in the macOS Notification Center from a signed build, and the first-run permission behaves"
    verification: []
    human_judgment: true
    rationale: "The OS draws and gates the banner outside the process; no automation surface. Queued as D-REV-52 and D-REV-53 with automatable NO, not observed."
---

# Phase 10 Plan 07: OS notifications for blocked, finished and failed agents Summary

**The Rust core now shows one operating-system banner when an agent blocks, finishes or fails (a fan-out wave folds into a single summary), through `tauri-plugin-notification` 2.4.0 on the pinned Tauri 2.11.5, with the window granted nothing and one global switch in Settings.**

## What was built

1. **The decisions (`987bbc6`).** `notify.rs` holds the pure parts: `Coalescer` (3 s window), `Banner`, `should_suppress`, `banner_body`, `target_of`. `TransitionKind` is `Blocked | Completed | Failed`, so `interrupted` and `abandoned` have no representation. `tick` is the shell's one step with every input explicit: it reads the switch from the database and takes focus and the watched run as arguments, so a test can flip the stored value between two pushes. `spawn_notify_task` polls every 500 ms, reads focus from `get_webview_window("main")` in Rust, and calls `tick`. The plugin is registered on the core only.
2. **The hooks (`637f587`).** `handle_inbound_permission_request` reads the run's status before processing the request and pushes a transition only on `running -> blocked`. `handle_inbound_session_closed` pushes on `Closed(Completed)` and `Closed(Failed)` only. Both gather the banner text before `drop(conn)`. `useWatchedRun` reports `activeAgentRunId` to `fleet_watch_run` unless settings, triage or review is on top, and reports nothing while the fleet shows.
3. **The switch (`6e9ebc5`).** `notifications_enabled` / `set_notifications_enabled` copy the dispatch-cap pair (one transaction, actor recorded, no event); an unparseable value reads as on. `NotificationsControl` is one checkbox.

## Required records

- **`COALESCE_WINDOW`:** 3 seconds. **Target cap:** 60 characters (`TARGET_CAP`), tool name 32 (`TOOL_CAP`). Whitespace is flattened to one line before capping.
- **Single-banner wording:** title `{project} · {subject} is blocked`, `... has finished`, `... has failed`. Body for blocked: `{tool}: {capped target}` (or just the tool). For finished: `Ready for you to look at.` For failed: `The run ended with an error.` Subject is the task key, else the epic key, else `An agent`.
- **Summary wording:** title `{N} agents are blocked`, `{N} agents finished`, `{N} agents failed`, or `{N} agents changed state` for a mixed burst; body is the distinct project names joined with ` · ` in first-seen order.
- **D-181 honoured.** `tauri = "=2.11.5"` and `tauri-build = "=2.6.3"` are unchanged (Cargo.lock still resolves `tauri` 2.11.5). The grep for `on_action` and `.extra(` over non-comment lines of `src-tauri/src` returns 0. No click path exists. Click-to-jump is a deferred board issue, not an omission, and has not been filed on the board from here.
- **Deferred-review entries added:** D-REV-52 (a real banner in the macOS Notification Center from a signed build; physical reason: the OS draws it outside the process, and under `tauri dev` it is attributed to the terminal) and D-REV-53 (the first-run macOS permission prompt; physical reason: the plugin reports granted without asking, so there is no in-app signal). Both `automatable: NO`. Everything else is asserted by tests and is not deferred.

## Deviations from Plan

**1. [Rule 1 - Contradiction in the plan] The "no notification string in the capability file" gate cannot hold alongside the roster requirement**
- **Found during:** Task 3
- **Issue:** Task 1's gate is `grep -ci 'notification' capabilities/default.json == 0`, yet Task 3 requires `settings_set_notifications_enabled` to appear in that file's description, and Task 2 asks the description to say `fleet_watch_run` suppresses a notification.
- **Fix:** the gate that matters is the absence of a *grant*. The unit test parses the JSON and fails if any entry in `permissions` contains "notification", and a grep for `"notification:` identifiers returns 0. The prose in the description is not a grant.
- **Files:** `notify.rs` (test), `capabilities/default.json`
- **Commit:** 987bbc6

**2. [Rule 3 - Blocking] `take_due` takes a `keep` predicate**
- **Issue:** the plan's signature `take_due(&mut self, now) -> Option<Banner>` cannot apply per-transition suppression; `should_suppress` is per run, and suppressing a whole banner would hide the other seven agents in a wave.
- **Fix:** `take_due(now, keep)` drops refused transitions before folding. `Coalescer` also carries a `shown` ring for the burst counter, and `push` takes no `AppHandle` (the coalescer is a process-wide `OnceLock`).
- **Commit:** 987bbc6

**3. [Rule 3 - Blocking] Checkbox moved to its own file**
- **Issue:** `settings/__tests__/finish.test.tsx` demands `control-edge` on every `<input>` in `SettingsSurface.tsx`; its title says checkboxes are exempt but the code does not exempt them.
- **Fix:** `NotificationsControl.tsx` with the project's `admin-check` class. The test was not weakened.
- **Commit:** 6e9ebc5

**4. [Rule 3 - Blocking] Existing test mocks and fixtures**
- `menu-bridge`, `project-rail` and `unreachable-in-app` mock the adapter strictly and mount `App.tsx`, so each gained `fleetWatchRun`. Two `SettingsDto` fixtures gained `notificationsEnabled` for `tsc`.
- **Commit:** 637f587, 6e9ebc5

**5. Commit boundaries differ from the three task boundaries.** `main.rs`, `capabilities/default.json` and the settings command register commands from all three tasks in the same lines, so the first commit carries the Rust core of Tasks 1 and 3, the second the hooks and the watched-run report of Task 2, the third the Settings UI. No commit leaves the build broken. The TDD red commits were not made separately: tests and implementation landed together in each commit.

**Total deviations:** 5 (1 plan contradiction, 4 blocking). **Impact:** none on scope or on D-174..D-176 and D-181.

## Verification run

- `cargo build --workspace`: clean (the pre-existing `StartRunOutcome` dead-code warning only). `cargo test -p desktop`: 133 passed. `cargo test -p core --test settings_notifications --test credentials --test dispatch_cap`: all pass (4 new).
- `npm --prefix packages/desktop test`: 84 files, 1,405 passed before the final fixture edits; `src/settings src/fleet` re-run: 141 passed. `npm --prefix packages/desktop run build`: clean.
- Gates: `tauri = "=2.11.5"` once; the plugin inside `[dependencies]`; `tauri_plugin_notification::init` once in `main.rs`; `notify::push` twice in `agent_run.rs`; `fleet_watch_run` once each in `main.rs` and the roster; `settings_set_notifications_enabled` once each; `get_webview_window` in `notify.rs`; `SETTING_NOTIFICATIONS_ENABLED` three times in the core.

## Known Stubs

None.

## Threat Flags

None. T-10-07-01 (body cap test), -02 (capability test), -03 (suppression also needs Rust-read focus), -04 (edge-only, collapse, summary, burst counter), -05 (two suppression causes, both pure) and -06 (exact pin, official crate) hold.

## Self-Check: PASSED

`notify.rs`, `settings_notifications.rs`, `useWatchedRun.ts` and `NotificationsControl.tsx` exist; commits `987bbc6`, `637f587` and `6e9ebc5` resolve; `commits: 3` is measured from `git rev-list --count 392d6c4..HEAD`.
