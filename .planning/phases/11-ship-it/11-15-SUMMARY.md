---
phase: 11-ship-it
plan: 15
subsystem: fleet-tests-and-uat
tags: [uat-harness, webkit, browser-tests, fleet, worktree, deferred-review]
requires: []
provides:
  - scripted coverage of register items D-REV-47, 48, 49, 50, 51, 54, 55 (automatable halves)
  - scripts/uat/uat-12-fleet-live-reads.mjs and the uat_fleet_ops core bin behind it
  - the first browser suites under packages/desktop/src/fleet/__tests__/browser/
affects: [11-16 (edits run-all.sh next), 11-21 closure pass]
tech-stack:
  added: []
  patterns:
    - "scratch FLYWHEEL_APP_DATA_DIR plus FLYWHEEL_WORKTREE_ROOT inside one mkdtemp, removed in a finally"
    - "an INSTRUMENT guard that fails the harness when the concurrency window it measures never opened"
    - "mutation checks on the product line each suite measures (restored after each)"
    - "it.fails to hold a found, deferred defect green-but-armed"
key-files:
  created:
    - scripts/uat/uat-12-fleet-live-reads.mjs
    - packages/core/tests/bin/uat_fleet_ops.rs
    - packages/desktop/src/fleet/__tests__/browser/fleet-group.browser.test.tsx
    - packages/desktop/src/fleet/__tests__/browser/fleet-jump.browser.test.tsx
  modified:
    - scripts/uat/run-all.sh
    - packages/core/Cargo.toml
    - packages/desktop/src/fleet/__tests__/jump.test.tsx
    - packages/desktop/src/fleet/__tests__/worktree-inventory.test.tsx
    - .planning/DEFERRED-REVIEW.md
    - .planning/phases/11-ship-it/deferred-items.md
key-decisions:
  - "The harness drives the core functions behind the five Tauri commands (through a new core bin), not the commands: the desktop crate needs an AppHandle and a 13-minute cold build."
  - "Two product defects found in the session/fleet path are held as it.fails and logged, not fixed: this is a test plan and both live in files it does not edit."
requirements-completed: [DIST-04]
status: complete
duration: ~50 min
completed: 2026-10-13
commits: 6
plan_head_before: e29f5e3b0e8ddc8a8f3290be13892c041ecc0b16
actuals:
  tokens: 22300
  tasks: 3
  commits: 6
coverage:
  - deliverable: "uat-12 harness: four fleet live reads against a scratch database"
    verification:
      - kind: command
        ref: "node scripts/uat/uat-12-fleet-live-reads.mjs"
        status: pass
    human_judgment: false
  - deliverable: "fleet surface and worktree inventory measured in WebKit, light and dark"
    verification:
      - kind: test
        ref: "packages/desktop/src/fleet/__tests__/browser/fleet-group.browser.test.tsx"
        status: pass
    human_judgment: false
  - deliverable: "where a fleet row lands, asserted at the AppShell (jsdom and WebKit)"
    verification:
      - kind: test
        ref: "packages/desktop/src/fleet/__tests__/jump.test.tsx"
        status: pass
      - kind: test
        ref: "packages/desktop/src/fleet/__tests__/browser/fleet-jump.browser.test.tsx"
        status: pass
    human_judgment: false
  - deliverable: "how the fleet, inventory and key-as-button read at row density"
    verification: []
    human_judgment: true
    rationale: "Human aesthetic judgement; stays in the register for 11-21."
---

# Phase 11 Plan 15: Fleet live reads, row density and jumps Summary

Seven Phase 10 register items now have their scriptable halves under test: one harness drives four fleet reads against throwaway data, two WebKit suites measure the fleet surface, the inventory and the row jumps in both colour schemes, and the shell is mounted to assert where a row takes you.

## Per register item

Legend: "first run" means the test passed when first written, because the behaviour was already correct. "caught" means it found a real defect. No RED run was manufactured; where I wanted proof a check could fail I broke the line it measures, saw it go red, and restored the file.

**This plan changed no production code**, so there is no RED/GREEN split to report. Every commit is a `test(11-15)` or `docs(11-15)` commit.

### D-REV-48 (log tail reaches `fleet_list`) - live-read half CLOSED
- Evidence: `uat-12-fleet-live-reads.mjs`, section `D-REV-48`. First run.
- Asserts: no log gives an empty tail; three appends give the three lines verbatim, oldest first; the next read sees the newest line; thirty appends give the last sixteen; the same run once completed carries no activity (the control).
- Left in the register: (1) a real sidecar writing a real log while the app is open, with Tauri `agent:event` delivery and the ~1 s throttle end to end. Physical reason: no WebDriver for WKWebView. (2) the look of the 80-character line (aesthetic judgement). Residual visual judgement 1 of 4 for 11-21: the activity line.
- The clip itself is now measured, not left to the eye: the activity cell ellipsizes without overflowing (`fleet-group.browser.test.tsx`).

### D-REV-49 (`agent_run_acknowledge` drops the row) - Dismiss half CLOSED
- Evidence: `uat-12`, section `D-REV-49`. First run in the harness; mutation-checked (below).
- Asserts: a completed and a failed run each leave `fleet_list` on acknowledge, the count dropping by exactly one per call; a live run is refused and stays; a repeat acknowledge reports no change; the other finished run is untouched.
- Left: (1) the Tauri round trip from the button press (physical: no WebDriver for WKWebView); (2) whether spend column, footer and Dismiss read clearly (aesthetic). Residual 2 of 4: the spend/footer/Dismiss look. Token text at narrow width is now measured (see D-REV-47).

### D-REV-50 (blocked queue shrinks by one per answer) - queue half CLOSED
- Evidence: `uat-12`, section `D-REV-50`. First run.
- Asserts: two blocked runs in two projects give two entries; answering one leaves exactly the other; answering the second empties it; re-answering an answered request is refused and does not move the queue (the control).
- Not driven: the desktop wrapper's sidecar relay and `allow_always` rule write; only the core `answer_request` is. Left: a real sidecar raising real requests, and the keypress round trip (physical: no WebDriver, real login); the owner marking's look (aesthetic). Residual 3 of 4: the owner marking.

### D-REV-55 (`worktree_reclaim`) - removal half CLOSED, responsiveness claim PARTLY
- Evidence: `uat-12`, section `D-REV-55`. First run.
- Asserts: of four reclaimable worktrees (6000 committed files each) three are selected; those three are gone from disk, the fourth and a live run's worktree are untouched, the live row is still on the fleet.
- Concurrency: the reclaim lasted 2.2 s; 321 `fleet_list` calls completed inside it, slowest 11 ms, bound 2000 ms, every one returned the live row. The harness fails with an `INSTRUMENT` message if no read fits inside the reclaim; `UAT12_BULK_FILES=0` trips it (verified).
- **What this does not prove.** Each `fleet_list` is its own process on its own connection, so this shows a reader is not blocked by the reclaim's connection under WAL and `busy_timeout`. It does NOT show that the desktop command releases the `AppState` mutex across the git calls. That is only reachable by a Rust test in the desktop crate (tauri `mock_app`, needs the `tauri/test` feature). `automatable: YES`, but a cold desktop test build is about 13 minutes, over the executor watchdog, so it was not attempted. This is a cost reason, not a physical one, and the register says so. Route it to a plan that can run the build detached.
- Left: a multi-second removal of a worktree holding `node_modules` in the installed app (physical: no WebDriver); the dialog and result list's look (aesthetic). Residual 4 of 4: the reclaim confirmation and result list.

### D-REV-47 (fleet reads at a glance) - containment half CLOSED
- Evidence: `fleet-group.browser.test.tsx`, fleet surface, 7 tests at each of 1200 and 900 px, light and dark. First run.
- Asserts by `getBoundingClientRect`/`scrollWidth`: every cell inside its row, no overlap; state/age/dismiss never cut, project/subject/activity/spend cut only with an ellipsis on one line; glyph and word inside the state cell; a 90-character project name leaves the row exactly as tall as a short-name row and the age column inside it; the state, project and age columns share edges down the list; the three band headers inside their bands on one line, Dismiss finished inside its bar; header count and footer inside the surface.
- Mutation check: removing the project cell's overflow, ellipsis and nowrap turned the long-name test red; restored.
- Left: whether it is easy to scan (human aesthetic judgement). Not the shipped WKWebView: this is Playwright's WebKit.

### D-REV-54 (worktree inventory) - view half CLOSED
- Evidence: the inventory block of `fleet-group.browser.test.tsx` (5 tests at each width and scheme) and one new test in `worktree-inventory.test.tsx`. First run.
- Asserts: all eight reasons and three dispositions render a chip with glyph and reason inside their row; a 1023.9 TiB size with a 40-day-old measurement is not cut; checkboxes only on reclaimable rows; no sideways scroll; a never-measured size is an empty cell that holds its column. Re-measure: blank before, `2.5 GiB measured 0s ago` after, with the list read again (mutation-checked: dropping the refetch turns it red).
- Left: a real multi-second walk through the installed app (physical: no WebDriver); the row's look (aesthetic).

### D-REV-51 (where a fleet row takes you) - shell half CLOSED, two findings
- Evidence: `jump.test.tsx` mounts the real AppShell (through `<App />`, its only export; the plan's "AppShell" means this) over a stubbed adapter; `fleet-jump.browser.test.tsx` repeats it in WebKit with real key presses and clicks.
- First run, all green: Enter and a click replace the fleet with that run's session and read that run's own log; Back returns to the fleet; the subject key (click and `b`) in another project switches the project, consumes the one-shot request and opens BET-7's panel, not a stale item; a jump into a project whose board takes 600 ms waits (request held, nothing open) and then lands.
- Mutation checks: dropping `setCurrentProjectId` turned the cross-project tests red in both suites; making Back also close the fleet turned the Back test red.
- **Finding 1 (held as `it.fails`):** Back returns to the fleet with NO row selected. The selection is local state in `FleetSurface`, which the shell unmounts while the session shows. The plan expected "the same row focused"; it is not true today. The decision records do not promise it, so it may be deliberate: owner call.
- **Finding 2 (held as `it.fails`):** a finished run with an empty log opens a session reading "Starting session..." above "This run has ended". The plan asked that the no-live-output case be decided rather than asserted as correct; this is the decision. A live run with nothing on disk yet correctly says it is starting (asserted).
- Left: the Tauri IPC behind any read and the packaged WKWebView's key delivery (physical: no WebDriver); how the key-as-button reads (aesthetic).

## Residual visual judgements routed to plan 11-21

Four separate items, not one:
1. The fleet activity line at row density (D-REV-48).
2. The spend column, estimate footer and Dismiss buttons (D-REV-49).
3. The blocked queue's owner marking (D-REV-50).
4. The reclaim confirmation and result list (D-REV-55).

Also human, listed for completeness: whether the fleet reads at a glance (D-REV-47), the inventory row's look (D-REV-54), and the key-as-button's look (D-REV-51). Not automatable and also routed: the installed-app joins (real sidecar, Tauri IPC, multi-second walks).

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 3 - Blocking] Added a core test-support binary and a Cargo.toml `[[bin]]`**
- **Found during:** Task 1
- **Issue:** the five commands live in the desktop crate (AppHandle, 13-minute cold build); a Node harness cannot call them or the core functions behind them. `uat_authoring_ops` is the established seam for exactly this, but has no fleet subcommands.
- **Fix:** `packages/core/tests/bin/uat_fleet_ops.rs` plus its `[[bin]]` entry. It refuses to run without `FLYWHEEL_APP_DATA_DIR`, and refuses reclaim/start-run/make-reclaimable without `FLYWHEEL_WORKTREE_ROOT` (the default root is the developer's real `~/Flywheel/`).
- **Files modified:** packages/core/tests/bin/uat_fleet_ops.rs, packages/core/Cargo.toml
- **Commit:** 19d54ea
- **Consequence:** the harness exercises core functions, not the Tauri commands. Stated in each register update.

**2. [Rule 2 - Missing critical] Added `fleet-jump.browser.test.tsx` and a slow-roster test**
- **Found during:** Task 3
- **Issue:** the plan's verify named only `jump.test.tsx`, but the register's automatable half is "a Playwright run ... can mount App.tsx", and jsdom key events are synthetic. "Write the cheap test instead of deferring it": it was cheap.
- **Fix:** a browser suite with real key presses, and a jsdom test for a project whose board loads slowly.
- **Commits:** 5e20bc5, ea19b9b

**3. [Scope] Plan-level full-suite verify skipped**
- Task 3's verify lists a bare `npm --prefix packages/desktop test`. Per the anti-stall directive I ran `src/fleet` only (8 files, 110 passed, 2 expected fail) and the fleet browser directory in both schemes (29 passed each). The phase-end regression gate runs the whole suite.

**Total deviations:** 3 (one blocking fix, one addition, one skipped broad run). **Impact:** none on scope; the harness covers core functions rather than Tauri commands.

## Notes on `run-all.sh`

Kept additive and narrow for 11-16: one `--bin uat_fleet_ops` token on the existing `cargo build` line and one `run_item` after UAT 11. Nothing else in the file moved.

## Known Stubs

None. The `FIXTURE`-style rows in the browser suites are synthetic stress inputs, labelled as such in the file headers, not placeholders in product code.

## Threat Flags

None. T-11-43 mitigated (scratch dirs, removed in a `finally`; the binary fails closed without the variables; the harness greps for the variable). T-11-44 mitigated (concurrent `fleet_list` with a stated bound and a non-vacuity guard), with the AppState-mutex caveat above.

## Self-Check: PASSED

All four created files exist; commits 19d54ea, cc10a64, 882e18a, 5e20bc5, ea19b9b exist. The measured count of 6 commits in `plan_head_before..HEAD` includes `ddf2b15` (an 11-14 provenance correction that landed while this plan ran); this plan's own commits are the five above.
