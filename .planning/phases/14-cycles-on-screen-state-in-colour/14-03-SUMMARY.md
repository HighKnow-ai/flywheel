---
phase: 14-cycles-on-screen-state-in-colour
plan: 03
subsystem: demo-board
tags: [seeder, dev-tooling, fixtures, launch-reconciliation, vis-06]
requires: ["14-01"]
provides:
  - "demo_board: a dev-only binary seeding Flywheel's own planning tree into a separate database"
  - "scripts/demo-board.sh: re-seeds target/demo-board and launches the app against it"
  - "tests/demo_board.rs: 10 cases proving the board is fit to judge on"
affects: [14-09, 14-10]
tech-stack:
  added: []
  patterns: ["seed through domain writers over a real demo repository", "floors asserted on the seeder's own output", "id-free fingerprint for run-to-run equality"]
key-files:
  created:
    - packages/core/tests/bin/demo_board.rs
    - packages/core/tests/demo_board.rs
    - scripts/demo-board.sh
  modified:
    - packages/core/Cargo.toml
decisions:
  - "Cycle = roadmap phase; the current phase is the one active Cycle and later phases are planned Cycles. Earlier phases get no Cycle (no close writer exists, plan 14-06 owns it)."
  - "Statuses inside the active phase are assigned by plan ordinal, not by SUMMARY presence, so the board keeps every state class as the phase's own plans finish."
  - "The live rows are protected from launch reconciliation by a BEFORE UPDATE trigger in the demo database only."
  - "Row ids are not deterministic (the writers mint ULIDs); items, order, ranks, keys and states are."
requirements-completed: [VIS-06]
metrics:
  duration: "about 1h 30m, most of it cargo link time"
  completed: 2026-10-15
status: complete
actuals:
  tokens: 60000
  tasks: 3
  commits: 2
commits: 2
plan_head_before: f928631b2a0377f7d2d095b389cbd0cb25ff3572
---

# Phase 14 Plan 03: The demonstration board Summary

A dev-only `demo_board` binary seeds Flywheel's own `.planning/` (5 Cycles, 278 epics, 760 tasks, 11 issues) into a separate database through the real domain writers, with running, blocked, failed, completed, abandoned, awaiting-review, pending-proposal, commits-ahead, dirty and merged states synthesised on a real demo git repository, and a test proves the board is real work and not a fixture.

## What was built

- **Tasks 1 and 2** (`102f48b5`): `packages/core/tests/bin/demo_board.rs` and a `[[bin]]` block in `packages/core/Cargo.toml` (no dependency added). Reads `ROADMAP.md` phase headings and goals, every `*-PLAN.md` under `.planning/phases/*` and the archived `.planning/milestones/*-phases/*`, their `<task>` entries, and `.planning/todos/pending/*.md`. Writes only through `project::register_project`, `cycle::{create_cycle,start_cycle,assign_epic_to_cycle}`, `epic::{create_epic_in_tx,set_epic_status}`, `task::{create_task_in_tx,set_task_status_in_tx}`, `issue::create_issue_in_tx`, `agent_run::{start_agent_run,close_agent_run,mark_abandoned}`, `permission_request::create_pending_request`, `authoring_session::start_authoring_run`, `authoring_proposal::create_proposal`, `worktree::ensure_worktree` and `merge::{plan_merge,run_merge,record_merge_event}`. Git is driven through `core::git::git_at`. The mapping is recorded in the module header as the planner's reading of D-24.
- **Task 3** (`e0b641a3`): `scripts/demo-board.sh` (re-seeds the stable path `target/demo-board/`, says so on every run, keeps the unconditional build, the release-then-debug search, the dev-server branch and the `strings` proof, now for both `FLYWHEEL_APP_DATA_DIR` and `FLYWHEEL_WORKTREE_ROOT`; `DEMO_SEED_ONLY=1` seeds and prints the banner without a window) and `packages/core/tests/demo_board.rs` (10 tests, the seeder is RUN as a subprocess so the code path is the script's own).

The lead epic is `FLY-1015`, titled `14-03: the demonstration board, seeded from Flywheel's own .planning/ with every state live`: a real plan file of the current phase, first in board order and in the active Cycle `FLY-1`. A test asserts both the Cycle membership and that `14-03-PLAN.md` exists on disk.

## Verification

Printed summary line, two runs into two fresh scratch directories, `diff` clean:

```
SEEDED cycles=5 epics=278 tasks=760 issues=11 running=2 blocked=1 failed=1 completed=1 abandoned=1 awaiting_review=1 proposals_pending=3 commits_ahead=1 dirty=1 merged=1 active_cycle=FLY-1 lead_epic=FLY-1015
SEEDED cycles=5 epics=278 tasks=760 issues=11 running=2 blocked=1 failed=1 completed=1 abandoned=1 awaiting_review=1 proposals_pending=3 commits_ahead=1 dirty=1 merged=1 active_cycle=FLY-1 lead_epic=FLY-1015
```

- Refusal: with `FLYWHEEL_APP_DATA_DIR` unset the binary exits 1 with `refusing to seed a demonstration board into the real fleet database (~/Library/Application Support/Flywheel)` and writes nothing. A root with no roadmap phases, and one with no plan files, exit non-zero naming `roadmap` and `phases` and write no database (asserted).
- Floor fires: removing the failed role made it print `demo board floor not met - state class failed: absent` and exit non-zero. Source restored.
- `cargo test -p core --test demo_board`: 10 passed. `cargo test -p core --lib --test spine_pin --test pm_vocabulary_gate --test migration_safety --test table_classification --test db_bootstrap --test fleet_query --test recovery_statuses --test change_flags --test demo_board`: all green (lib 20, spine_pin 6, pm_vocabulary_gate 10, migration_safety 12, table_classification 2, db_bootstrap 11, fleet_query 26, recovery_statuses 8, change_flags 6). `cargo check --workspace` passes.
- Acceptance greps: `demo_board` in Cargo.toml 2; `FLYWHEEL_APP_DATA_DIR` in the bin 3; non-comment `INSERT INTO` 0 and non-comment `new_id` 0 in the bin; named `const` declarations 7; `awaiting` 9 and `ALTER TABLE|awaiting_review TEXT` 0; `pid` 2; `create_proposal` 1; script: `strings` 3, `mktemp -d` 0, non-comment `.planning` 0, `FLYWHEEL_APP_DATA_DIR` 4.
- `DEMO_SEED_ONLY=1 DEMO_SKIP_BUILD=1 scripts/demo-board.sh` printed the banner (database path, active Cycle, lead epic, per-state counts) and a second run printed `re-seeding the existing demo board`.
- Mutation check on the decisive finding below: with the protecting trigger disabled, `launch_reconciliation_leaves_the_live_rows_live` fails (`left: []`, `right: ["blocked", "running", "running"]`). Source restored.

## Deviations from Plan

**1. [Rule 1 - Bug, found in the plan's premise] The app's launch reconciler rewrites every processless `running` and `blocked` row to `abandoned`**
- **Found during:** Task 2, reading `reconcile_agent_runs` as the task instructed.
- **Issue:** `main.rs` calls `reconcile_agent_runs` before the first paint. Any `running`/`blocked` row with no live process (no run descriptor on disk) is written to `abandoned`. A live pid instead produces a live orphan and the blocking recovery modal. The plan's wording ("write the pid and session id so the liveness read resolves to not-alive") would have produced a board that lost running and blocked on first launch. There is also no pid column; the pid lives in a descriptor file.
- **Fix:** the seeder writes no descriptor and, after seeding, creates one `BEFORE UPDATE OF status ON agent_runs ... RAISE(IGNORE)` trigger in the demo database only, naming exactly the ids of the live runs. It is DDL on a scratch database, not a row, not a migration, and ships nothing. Rejected: an environment switch in `main.rs` (demo logic in the product, and the plan lists no such file). The session surface needs no help: it reads the session log by run id and never looks a process up.
- **Files modified:** `packages/core/tests/bin/demo_board.rs`, `packages/core/tests/demo_board.rs` (runs the real reconciler and holds the live rows live).
- **Commit:** `102f48b5`, `e0b641a3`.
- **Residue:** `mark_abandoned` still appends an `agent_run.abandoned` event and a fallback summary for those rows before the trigger ignores the status write, so the activity trail of those three runs carries a false "abandoned" entry after the first launch. Cosmetic on a demo board; the status is what the surfaces read.

**2. [Rule 3 - Blocking] Row ids cannot be derived from source content**
- **Found during:** Task 1.
- **Issue:** the plan says every id comes from a hash of the source and no `new_id` is called. Every domain writer mints its own ULID inside the function and none accepts one; adding an id seam to production id generation for a dev tool was declined.
- **Fix:** the binary never mints an id (the grep holds), and determinism is stated and tested for what a person sees: items, titles, keys, ranks, parents, Cycle membership and states, as an id-free fingerprint over more than 1000 rows, equal across two seeds. Ids differ per run. Because the script re-seeds the same path, "the board does not change under the owner" holds within a launch and across runs by content.
- **Commit:** `102f48b5`, `e0b641a3`.

**3. [Rule 3 - Blocking] Earlier phases get no Cycle, and Cycles carry no exit criteria**
- `create_cycle` takes no `exit_criteria` and no writer sets it; no `close` writer exists (14-06). Both would need hand-rolled SQL, which the plan forbids. Earlier phases' epics stay on the board unassigned and done. The Cycle layer is the active phase plus the four planned ones.

**4. [Rule 2 - Missing critical] Statuses in the active phase are assigned by plan ordinal, not by SUMMARY presence**
- The plan said the active Cycle's lead is "real current work". Driving states from SUMMARY presence would have thinned the runtime layer as 14-04 to 14-10 finish, and the floor assertions and tests would then fail on a later plan's run. Roles are bound to the first ten plans of the phase (`ACTIVE_PHASE_ROLES`); the seeder fails naming the level if the phase holds fewer than ten plans. An optional second argument pins the phase; the test pins 14.

**5. [Minor] Tasks 1 and 2 share one commit.** One file written in one pass; splitting it would have meant committing a version with the runtime layer removed. Both tasks' acceptance criteria were run against the combined file.

**Total deviations:** 1 premise bug fixed in the artifact (decisive), 2 blocking-rule adjustments, 1 missing-critical hardening, 1 minor. **Impact:** all acceptance criteria hold; plans 14-09 and 14-10 inherit the finding in deviation 1.

## Known Stubs

None in product code. Synthetic by design (D-25): run costs and tokens, the three staged proposal titles, the permission request text, and every status inside the active phase.

## Threat Flags

| Flag | File | Description |
|------|------|-------------|
| threat_flag: schema-trigger | packages/core/tests/bin/demo_board.rs | Creates one trigger on `agent_runs` in the demo database only. Never reaches a real database: the binary refuses to run without `FLYWHEEL_APP_DATA_DIR` and without `FLYWHEEL_WORKTREE_ROOT`, and the script removes and re-creates only `target/demo-board/appdata` and `target/demo-board/worktrees`. |

T-14-03-01 to -05 are mitigated as planned: refusal proven by test and by hand, domain writers only (no non-comment `INSERT INTO`), placeholder and plan-file assertions, the reconciler test, and the content-equality test.

## Not exercised here

The window itself was not launched: `scripts/demo-board.sh` ran in `DEMO_SEED_ONLY` mode. The script's `strings` guards, the dev-server branch and the launch line are carried over from `scripts/uat/uat-ui-setup.sh` unchanged in logic. Plan 14-09 is the first real launch; the first thing to check there is that the region and the roster show running and blocked.

## Self-Check: PASSED

`packages/core/tests/bin/demo_board.rs`, `packages/core/tests/demo_board.rs`, `scripts/demo-board.sh` exist; commits `102f48b5` and `e0b641a3` are in `git log`.
