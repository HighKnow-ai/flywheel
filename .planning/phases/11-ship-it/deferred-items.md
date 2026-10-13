# Phase 11 deferred items

## Found by plan 11-14

### A refused "Approve and start" is invisible on any plan taller than the dialog

- File: `packages/desktop/src/dispatch/WavePlanSheet.tsx` (`approveError` renders at the end of `.wave-plan-body`, which scrolls).
- Evidence: `dispatch-layout.browser.test.tsx`, `it.fails("a failed approval is visible without scrolling the body")`. At 1440x900 a four-task draft is enough for the alert's bottom edge to sit about 50px below the body's visible bottom (797.8 vs 748.3).
- Effect: the user clicks Approve, the core refuses, Approve re-enables, and nothing visible changes unless they scroll to the bottom. Per-task edit refusals are not affected; they render beside the task being edited.
- Why not fixed in 11-14: pre-existing, not caused by this plan's changes, and the plan forbids restructuring that file (11-11 adds stuck-task rows to it in a later wave).
- Fix shape: render `approveError` in `.wave-plan-footer` beside the buttons, or scroll it into view. Flip the `it.fails` to `it` when done.

## Found by plan 11-15

### Back from a session opened on the fleet loses the selected row

- Files: `packages/desktop/src/fleet/FleetSurface.tsx` (`selectedRunId` is `useState` local to the surface), `packages/desktop/src/App.tsx` (the session branch renders instead of the fleet, so the surface unmounts).
- Evidence: `jump.test.tsx`, `it.fails("Back from the session returns to the fleet with the same row selected")`. The fleet does come back (asserted, passing); no row carries `data-selected` when it does.
- Effect: after reading one agent's session you press Back and the `j`/`k` selection starts again from nothing, so draining a queue of agents costs a re-navigation per agent. Not a wrong answer, a lost position.
- Why not fixed in 11-15: the plan is a test plan; the fix is a product change (hoist the selection into `uiStore`, or keep the surface mounted). The 10-CONTEXT decisions do not promise it, so it may be a deliberate omission: owner call.
- Fix shape: store `fleetSelectedRunId` in `uiStore` and read it as the initial value. Flip the `it.fails` to `it`.

### A finished run with an empty log opens a session that says "Starting session..."

- File: `packages/desktop/src/session/SessionSurface.tsx` (`StartingSessionRow` renders whenever `feedRows` is empty, regardless of run status).
- Evidence: `jump.test.tsx`, `it.fails("a finished run with no output opens a session that does not claim to be starting")`. The page text for a failed run with `total: 0` reads "Starting session... This run has ended. Nothing more will be added to this transcript."
- Effect: a run that failed before writing a line, or whose log was removed, shows a contradiction. The fleet row is a plain jump with no check that there is anything to open.
- Why not fixed in 11-15: pre-existing, in a file this plan does not edit.
- Fix shape: render `StartingSessionRow` only while the run is live; for a terminal run with an empty feed say that no output was recorded. Flip the `it.fails` to `it`.

## Found by plan 11-04

### A core test races on the authoring stage runtime marker directory

- File: `packages/core/tests/authoring_lifecycle.rs`, test `mark_abandoned_on_an_authoring_run_writes_a_fallback_summary_inside_its_own_transaction` (panics at line 269, the `start_authoring_run` or `mark_abandoned` unwrap).
- Evidence: open-core.yml run 38346874919 on macos-14, once in about 8 `cargo test --workspace` executions: `failed to write the authoring stage runtime marker for "01M4SRSBRQ97BK4SBDBF139W70": No such file or directory (os error 2)`. Green on the identical SHA in run 38346860235.
- Effect: a red ci.yml or open-core.yml, and a red release.yml, with nothing wrong in the change under test. Re-running the failed job clears it. `release.yml` gates the artifact on `cargo test --workspace`, so on the real v0.1.0 tag this can block the release until a re-run.
- Probable cause (not confirmed): the marker lives in a runtime directory that a concurrent test in the same binary or a sibling binary removes or never creates, the same family of defect as the `pkill -f` cross-file kill fixed in `permission.test.mjs`. Reproduce by running `cargo test -p core --test authoring_lifecycle` in a loop under CPU load.
- Why not fixed in 11-04: it was not on the path of the failures this plan had to clear, it is one failure in eight, and the cause is a guess. Fix shape: give each test its own runtime directory (a `tempfile::TempDir` passed or exported per test) instead of a shared one.

### GitHub Actions runs of ci.yml and open-core.yml also fire on every tag push

- Both workflows use bare `on: push`, so pushing `v0.1.0` starts ci.yml, open-core.yml and release.yml together, three macos-14 jobs for one tag. Harmless to correctness (the release builds its own copy), wasteful of runner minutes. Fix shape: `on: push: branches: ['**']` in both. Owned by plan 11-03's files, so not changed in 11-04.

## Found by plan 11-16

### The PATH shim raises a permission request for read-only git commands it does not list

- Files: `packages/core/src/destructive.rs` (`SAFE_GIT_SUBCOMMANDS`, `classify_git`), reached through `packages/shim`.
- Evidence: running `uat-13` with a fake agent that called `git rev-parse HEAD` and `git -c user.email=... -c user.name=... add -- f` produced a `permission_request` for each (`destructiveCategory: "uncategorized"`) and the session sat blocked until the harness timed out. Plain `git add`, `git commit` and `git log` passed. `rev-parse` is not in `SAFE_GIT_SUBCOMMANDS`, and a command line that opens with global options (`-c`, `-C <dir>`) has the option as its "subcommand", which no arm matches.
- Effect: a dispatched run (acceptEdits) whose agent runs `git rev-parse HEAD`, `git -C path status`, `git ls-tree`, `git cat-file` or `git symbolic-ref` stops as `blocked` and holds a cap slot until a person answers. The design is deliberate (the module is fail-closed and says it never uses a catch-all), so this is a coverage question, not a bug in the classifier. Agents reach for `rev-parse` constantly.
- Why not fixed in 11-16: it is a product-policy change in `destructive.rs` with its own tests, outside this plan's files. Not hit by the harness after it switched to `git log` and environment-supplied identity.
- Fix shape: add the read-only subcommands (`rev-parse`, `ls-tree`, `cat-file`, `symbolic-ref`, `rev-list`, `merge-base`, `for-each-ref`, `name-rev`, `show-ref`) to the allow-list, and skip leading `-c <kv>` / `-C <dir>` pairs before choosing the subcommand. Each needs a test that the destructive forms of the same family (`git -c ... push --force`) still classify as before.

### The register's "Read, Grep, Glob" wording is stale for the installed CLI

- `claude` 2.1.287 offers no Grep or Glob tool; search goes through Bash. Recorded under D-REV-35 in `DEFERRED-REVIEW.md`. No prompt or source file in this repository names Grep or Glob (grepped), so nothing is broken by it; only the register's sentence is out of date.
