---
phase: 11-ship-it
plan: 19
subsystem: database
tags: [sqlite, migration, tauri, react, soft-hide, projects]

requires:
  - phase: 11-ship-it
    provides: "11-11 (retry/skip commands that extended main.rs, tauri.ts and the capability roster) and 11-08 (the v0.1.0/v0.1.1 releases and the epic_context_packet allowlist)"
provides:
  - "projects.hidden column (migration 0022) and domain::project::hide_project / restore_project"
  - "A hidden filter on every project-listing read; by-id reads deliberately unfiltered"
  - "Commands project_hide and project_restore, adapters projectHide and projectRestore"
  - "A 'Remove from Flywheel...' action in the project rail with a confirmation that names what is kept"
  - "Measured live-board numbers for D-REV-25 (junk lead epic) and D-REV-04 (criteria vacuum), and the junk-epic detection query under test"
affects: [11-21 register redemption, DEFERRED-REVIEW D-REV-29 / D-REV-25 / D-REV-04]

plan_head_before: fdb014d50b9ea7da69f47ae5adb232ef633c681c
actuals:
  tokens: 25000
  tasks: 3
  commits: 3

tech-stack:
  added: []
  patterns:
    - "Reversible removal = flag + filter on LISTING reads only; by-id lookups stay unfiltered so restore and history work"
    - "One set_hidden writer shared by hide, restore and register-by-marker, so the flag has a single write site and a single event shape"

key-files:
  created:
    - packages/core/src/db/migrations/0022_project_hidden.sql
    - packages/core/tests/project_hide.rs
  modified:
    - packages/core/src/db/mod.rs
    - packages/core/src/domain/project.rs
    - packages/core/src/query/fleet.rs
    - packages/core/src/git_identity.rs
    - packages/desktop/src-tauri/src/commands/project.rs
    - packages/desktop/src-tauri/src/main.rs
    - packages/desktop/src-tauri/src/scheduler.rs
    - packages/desktop/src-tauri/capabilities/default.json
    - packages/desktop/src/adapters/tauri.ts
    - packages/desktop/src/projects/ProjectRail.tsx
    - packages/desktop/src/projects/__tests__/project-rail.test.tsx

key-decisions:
  - "Hide filters go in the JOIN (`JOIN projects p ON p.id = ar.project_id AND p.hidden = 0`) for the two fleet statements, because their WHERE clauses contain a bare OR that an appended AND would mis-bind."
  - "The worktree inventory filters only its LISTING statement (WHERE p.hidden = 0), not the shared select macro, so worktree_inventory_input_for_task (a by-id read used by reclaim) still resolves a hidden project's worktree."
  - "project_restore re-runs reconcile_projects and returns the list, so a restored project's reachable/unreachable status is current instead of stale until the next launch."
  - "Registering the path of a hidden project restores it (via the shared set_hidden), inside the same transaction as the reuse-by-marker path."

patterns-established:
  - "Soft-hide: hidden INTEGER NOT NULL DEFAULT 0 CHECK (hidden IN (0,1)); event project.hidden / project.restored with {field, before, after, label}"

requirements-completed: [DIST-04]

coverage:
  - id: D1
    description: "Migration 0022 adds projects.hidden (default shown) and is registered once in migration_source_list(); N-1 and bad-migration fixtures still pass"
    requirement: DIST-04
    verification:
      - kind: unit
        ref: "packages/core/tests/project_hide.rs#migration_adds_hidden_defaulting_to_shown"
        status: pass
      - kind: integration
        ref: "cargo test -p core --test migration_safety"
        status: pass
    human_judgment: false
  - id: D2
    description: "hide_project / restore_project are transactional, event-writing, idempotent, refuse an unknown id, and a hide leaves every row count unchanged"
    requirement: DIST-04
    verification:
      - kind: unit
        ref: "packages/core/tests/project_hide.rs#a_hidden_project_is_absent_from_the_list_but_every_row_it_owns_survives_a_hide"
        status: pass
      - kind: unit
        ref: "packages/core/tests/project_hide.rs#hiding_twice_appends_no_second_event_and_restoring_twice_neither"
        status: pass
      - kind: unit
        ref: "packages/core/tests/project_hide.rs#hiding_or_restoring_an_unknown_project_is_refused_and_writes_nothing"
        status: pass
    human_judgment: false
  - id: D3
    description: "Registering the path of a hidden project restores it instead of creating a duplicate"
    requirement: DIST-04
    verification:
      - kind: unit
        ref: "packages/core/tests/project_hide.rs#registering_the_path_of_a_hidden_project_restores_it_instead_of_duplicating_it"
        status: pass
    human_judgment: false
  - id: D4
    description: "A hidden project is absent from the fleet, blocked queue, worktree inventory, measure targets and both git-identity sweeps, and restore brings it back to every one"
    requirement: DIST-04
    verification:
      - kind: unit
        ref: "packages/core/tests/project_hide.rs#the_fleet_blocked_queue_and_worktree_reads_skip_a_hidden_project_and_restore_brings_it_back"
        status: pass
      - kind: unit
        ref: "packages/core/tests/project_hide.rs#the_git_identity_sweeps_skip_a_hidden_project_and_restore_brings_it_back"
        status: pass
      - kind: e2e
        ref: "node scripts/uat/uat-12-fleet-live-reads.mjs"
        status: pass
    human_judgment: false
  - id: D5
    description: "project_hide / project_restore take only a project id, resolve the actor server-side, and are in generate_handler! and the capability roster"
    requirement: DIST-04
    verification:
      - kind: other
        ref: "grep -c project_hide packages/desktop/src-tauri/src/main.rs (1); grep -c project_restore packages/desktop/src-tauri/capabilities/default.json (1); cargo test -p desktop (149 passed)"
        status: pass
    human_judgment: false
  - id: D6
    description: "Rail action 'Remove from Flywheel...' confirms by naming the kept board, worktrees, runs and trail, calls project_hide once, then selects another project"
    requirement: DIST-04
    verification:
      - kind: automated_ui
        ref: "packages/desktop/src/projects/__tests__/project-rail.test.tsx#ProjectRail's Remove from Flywheel"
        status: pass
    human_judgment: true
    rationale: "Whether the confirmation copy reads as 'not a delete' to a person, and how the new rail row looks beside Register Project, is a judgment no assertion makes. Queued as D-REV-61 for plan 11-21 (not verified here)."
  - id: D7
    description: "D-REV-25 junk-epic detection query is under test, and run against a copy of the live board"
    verification:
      - kind: unit
        ref: "packages/core/tests/project_hide.rs#junk_epic_detection_matches_a_seeded_junk_epic_and_nothing_on_a_healthy_board"
        status: pass
    human_judgment: false
  - id: D8
    description: "D-REV-04 acceptance-criteria counts measured against a copy of the live board"
    verification: []
    human_judgment: true
    rationale: "A measurement taken once against a file copy, reported as numbers below. Remedy (real criteria on real tasks) is the owner's habit and no plan step can perform it."

duration: 92min
completed: 2026-10-14
status: complete
---

# Phase 11 Plan 19: Reversible project removal (D-200) Summary

**A `projects.hidden` flag (migration 0022) with hide/restore verbs, a hidden filter on every project-listing read, two id-only commands and a rail action whose confirmation names what is kept; nothing is deleted and a test proves the row counts do not move.**

## Performance

- **Duration:** 92 min (most of it waiting on the long core test binaries)
- **Started:** 2026-10-14 ~10:20 local
- **Completed:** 2026-10-14 11:52 local
- **Tasks:** 3
- **Files modified:** 13 (2 created, 11 modified), 673 insertions, 13 deletions

## Accomplishments

- **Migration 0022** adds `hidden INTEGER NOT NULL DEFAULT 0 CHECK (hidden IN (0,1))`, registered once in `migration_source_list()`. Every existing row is shown. `migration_safety` passes (6/6).
- **`hide_project` / `restore_project`** go through one writer, `set_hidden`: one transaction, the flag plus one `project.hidden` or `project.restored` event carrying the actor, a skip when the state already matches (no second event), and an error for an unknown id that writes nothing.
- **`register_project` restores a hidden match.** When the marker names a hidden project, the reuse-by-marker branch un-hides it in the same transaction instead of leaving it hidden or creating a duplicate.
- **Every listing read filters hidden projects** (full table below). By-id reads are untouched on purpose.
- **Commands** `project_hide(project_id)` and `project_restore(project_id)` take an id and nothing else, resolve the actor server-side, and sit in `generate_handler!` and the capability roster. `project_restore` re-verifies markers and returns the list.
- **Rail:** "Remove from Flywheel..." acts on the current project. Its confirmation reads: "Remove {name} from Flywheel? Its board, worktrees, runs and activity trail are all kept, and nothing is deleted. Register the repository again to bring it back." After the hide the rail calls `onSelect` with another project, and the empty list sends the app to first run.

## Listing-read sites (T-11-54): every `FROM projects` / `JOIN projects` found

Found with `grep -rnE "FROM projects|JOIN projects" packages/core/src packages/desktop/src-tauri/src packages/sidecar/src`.

| Site | Kind | Decision | Reason |
|---|---|---|---|
| `domain/project.rs` `list_projects` | listing | **filtered** (`WHERE hidden = 0`) | Feeds the rail, `reconcile_projects`, `forge.rs` and `settings.rs`; all inherit the filter. |
| `query/fleet.rs` fleet read (`JOIN projects p ... ar.project_id`) | listing | **filtered** in the JOIN | WHERE has a bare OR; an appended AND would mis-bind. |
| `query/fleet.rs` `BLOCKED_QUEUE_SQL` | listing | **filtered** in the JOIN | Same. |
| `query/fleet.rs` `WORKTREE_INVENTORY_SQL` | listing | **filtered** (`WHERE p.hidden = 0` on the listing statement only) | The select macro is shared with the by-id statement, which must keep resolving. |
| `query/fleet.rs` `WORKTREE_INVENTORY_ONE_SQL` | by-id | left alone | Reclaim re-reads one task's worktree; a hidden project's must resolve. Tested. |
| `query/fleet.rs` `worktree_measure_targets(None)` | listing (no projects join) | **filtered** (`project_id IN (SELECT id FROM projects WHERE hidden = 0)`) | It enumerates worktrees to measure; measuring a hidden project's disk is wasted work. |
| `git_identity.rs` `active_projects_ordered` | listing (sha sweep) | **filtered** | Sweeps every active repository. |
| `git_identity.rs` `active_project_ids_ordered` | listing (branch sweep) | **filtered** | Sweeps every active project's epics. |
| `desktop/src-tauri/src/scheduler.rs` `fetch_tick_targets` | listing | **filtered** | Not in the plan's file list; it lists active projects to `git fetch`, so it is a listing read (Rule 2, see Deviations). |
| `git_identity.rs` `resolve_branch` task-branch lookup (`worktrees w JOIN tasks`) | by-name lookup, no projects read | left alone | A hidden project's task branch still resolves; history stays readable. |
| `query/change_flags.rs:58` `JOIN projects p` (default_branch) | per-project (`WHERE w.project_id = ?1`) | left alone | Scoped to one project id the caller already holds. |
| `dispatch.rs:789`, `dispatch_exec.rs:318`, `domain/dispatch_plan.rs:179`, `domain/file_set.rs:463`, `commands/agent_run.rs:797` and `:1382` | by-id (`WHERE t.id / e.id / ar.id = ?1`) | left alone | Single-row reads keyed by an id. |
| `git_facts.rs:187`, `review.rs:224`, `merge.rs:182`, `forge/request_body.rs:106,217`, `forge/mod.rs:186,320`, `domain/epic.rs:761`, `domain/project.rs:128,157,311,505`, `domain/worktree.rs:94,126,275,497`, `domain/settings.rs:181,209,275,296`, `context_packet.rs:225,227`, `desktop sidecar.rs:87`, `commands/authoring.rs:303` | by-id (`WHERE id = ?1`) | left alone | Same: restore and history depend on by-id reads working for a hidden project. |
| `desktop scheduler.rs:867`, `commands/update.rs:194` (`SELECT id FROM projects LIMIT 1`) | test fixtures | left alone | Inside `#[cfg(test)]` helpers, not product reads. |

## D-REV-25 and D-REV-04: measured on the live board (D-196 board items)

**What "the live board" is here:** `~/Library/Application Support/Flywheel/flywheel.db`, last written 2026-10-07 and at `PRAGMA user_version = 18`. It was copied to the session scratchpad and every query ran on the copy. Nothing was written to, deleted from or reassigned on the live file. The installed v0.1.0 build has not migrated it (0022 has never touched it).

Board shape: 2 projects (the active `THRE` and its `unreachable` duplicate, same name, prefix and `repo_path`), 13 epics, 907 tasks, 186 with no epic.

### D-REV-25 (junk lead epic) — detected, NOT fixed

The detection query is `JUNK_EPIC_SQL` in `packages/core/tests/project_hide.rs` (epics whose trimmed title is `test`, or whose task total is 1 with no criteria on the epic or its task). Run verbatim against the copy it returns **1 row**:

| id | key | title | total |
|---|---|---|---|
| `01M22XY74YV7PJCHV027P6ASXJ` | THRE-4 | `test` | 1 |

Its one task is `THRE-5` (`test`, backlog). The same copy shows the other half of the register's claim: **181 tasks are `in_review` and all 181 have no epic** (186 tasks have no epic in all). The other 12 epics each hold 60 tasks.

Covered by a test: it matches a seeded `test` epic and a seeded one-task, no-criteria epic, and matches nothing on a healthy board (including a one-task epic that does carry a criterion).

**D-196 board item (open):** *Junk lead epic and homeless review queue.* Remedy, owner's call: delete epic THRE-4 and task THRE-5, or retitle and use them; and assign the 181 in-review tasks to epics, or decide that the status lens (A-02) is their home. Best drained through Flywheel. Not done here: the plan forbids deleting or reassigning on the live board.

### D-REV-04 (criteria vacuum) — the register's number is out of date

| Count | Register said | Measured now |
|---|---|---|
| Total `acceptance_criteria` rows | 2 | **15** |
| On tasks | — | **15** (0 on epics) |
| On tasks that have a worktree | 0 | **15** (the live board has 5 worktrees, all `active`; each of THRE-33, 38, 43, 53, 58 carries 3) |

The 15 rows are stamped `2026-10-07T11:34:55`, the same minute as `flywheel.pre-seed-criteria-20261007T113454.db` in the same directory. That is an inference, not something I verified: they look like the output of `seed_criteria`, not criteria written by hand. The vacuum has therefore moved, not closed: **5 of 907 tasks carry criteria; 902 tasks and all 13 epics carry none.** The interaction D-REV-04 wanted reachable has a seeded task to run against; the Core Value ("every unit of agent work anchored to real acceptance criteria") is still not a habit on this board.

**D-196 board item (open):** *Acceptance criteria on real work.* Remedy: put real criteria on the tasks that will actually be dispatched, starting with any task given a worktree. No plan step can do this for the owner. Not described as fixed.

## Task Commits

1. **Task 1: Migration 0022 and the two core verbs** - `31076d7` (feat)
2. **Task 2: Filter on every listing read, the commands, the rail action** - `ac0bf29` (feat)
3. **Task 3: Junk-epic detection under test (D-REV-25 / D-REV-04 measured)** - `98c8dc2` (test)

**Plan metadata:** the `docs(11-19)` commit that adds this file.

## Files Created/Modified

- `packages/core/src/db/migrations/0022_project_hidden.sql` - the flag, with a header citing D-200.
- `packages/core/src/db/mod.rs` - one `include_str!` line in `migration_source_list()`.
- `packages/core/src/domain/project.rs` - `set_hidden`, `hide_project`, `restore_project`, the `list_projects` filter, and the restore branch in `register_project`.
- `packages/core/src/query/fleet.rs`, `packages/core/src/git_identity.rs`, `packages/desktop/src-tauri/src/scheduler.rs` - the listing filters (table above).
- `packages/desktop/src-tauri/src/commands/project.rs`, `main.rs`, `capabilities/default.json` - the two commands, extended on top of 11-22, 11-06 and 11-11's additions (appended, nothing overwritten).
- `packages/desktop/src/adapters/tauri.ts` - `projectHide`, `projectRestore` (type-only import of `Project`, so no runtime cycle).
- `packages/desktop/src/projects/ProjectRail.tsx` and its test - the action, the confirmation, five new tests.
- `packages/core/tests/project_hide.rs` - 10 tests.

## Decisions Made

See `key-decisions` above. Two worth restating: the filter is on listing reads only (T-11-54), and there is no purge verb anywhere (T-11-52).

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 2 - Missing Critical] Hidden filter on the git-truth fetch tick**
- **Found during:** Task 2 (the grep the plan told me to run)
- **Issue:** `desktop/src-tauri/src/scheduler.rs` `fetch_tick_targets` lists every active project to `git fetch`. It is a listing read, so leaving it unfiltered would keep fetching a hidden project's repository. It was not in the plan's `files_modified`.
- **Fix:** `AND hidden = 0`.
- **Files modified:** `packages/desktop/src-tauri/src/scheduler.rs`
- **Verification:** `cargo test -p desktop` 149 passed.
- **Committed in:** `ac0bf29`

**2. [Rule 2 - Missing Critical] Filter on `worktree_measure_targets`**
- **Found during:** Task 2
- **Issue:** It enumerates all worktrees without joining `projects`, so a plain `JOIN` grep missed it. It is a listing read.
- **Fix:** `WHERE project_id IN (SELECT id FROM projects WHERE hidden = 0)`.
- **Files modified:** `packages/core/src/query/fleet.rs`
- **Verification:** asserted in `the_fleet_blocked_queue_and_worktree_reads_...`
- **Committed in:** `ac0bf29`

**3. [Rule 1 - Bug avoided] Filter placed in the JOIN, not appended to WHERE**
- **Found during:** Task 2
- **Issue:** The fleet statement's WHERE is `A OR (B AND ...)`; appending `AND p.hidden = 0` would bind to the last disjunct only and leave hidden running agents on the fleet.
- **Fix:** `JOIN projects p ON p.id = ar.project_id AND p.hidden = 0`.
- **Committed in:** `ac0bf29`

**4. [Plan gap] `project_restore` re-runs reconcile**
- The plan names only that restore flips the flag. A restored project would otherwise show a stale `unreachable`/`active` until the next launch, because `reconcile_projects` skips hidden projects. Small addition inside the same command.

**Total deviations:** 4 (2 Rule 2, 1 Rule 1, 1 gap). **Impact:** all four make the plan's own stated goal ("every project-listing read filters hidden projects") true; no scope creep.

### Verification-command defects (not code defects)

- Task 2's `grep -rl "@tauri-apps/" ... | grep -v adapters/tauri.ts | wc -l` expects `0`, but returns **3 on a clean tree**. All three are comments or `vi.mock(...)` strings in test files (`settings-surface.test.tsx`, `permission-card.test.tsx`, `changes-request-adapter.test.ts`), none an import, and none touched by this plan. The real rule (only the adapter imports `@tauri-apps/*`) holds.
- `cargo test --workspace` as written cannot be run here: `packages/core/tests/credentials.rs` writes into the real macOS Keychain and hangs (known hazard). I ran every other target by name instead: `core --lib` plus 106 integration binaries (all `ok`, none failed), `cargo test -p desktop` (149), `relay_client` and `flywheel-shim`, `npm --prefix packages/desktop test` (1484 passed, 2 expected fail) and `tsc --noEmit` (clean). The first 41 binaries and the remaining 66 ran in two passes because the suite exceeds a single 30-minute background limit.

## Issues Encountered

- A first draft of the git-identity test used a commit with no `Flywheel-Task` trailer; `resolve_sha` returns `NotFound` for that regardless of visibility, so the test could not distinguish hidden from shown. Fixed by stamping a trailer naming a real task.
- `epic_context_packet.rs` needed **no** allowlist entry: the new core reads are `projects` reads in `domain/project.rs` and `query/fleet.rs`, not the header reads that test scans for. It passes 16/16.
- The Phase 08 UAT screenshots were not touched (no browser suite was run); `git status` shows them clean.

## Known limits (honest, for plan 11-21)

- **No UI path lists or restores a hidden project by id.** `project_restore` exists and is tested at the core level, but nothing in the renderer calls `projectRestore`. The UI route back is registering the repository again, which restores the project whose marker names that path. The **duplicate** `unreachable` project has a different id and its path's marker names the other project, so re-registering that path restores the active project, not the duplicate. Restoring the duplicate in the app needs a "hidden projects" list. Data is safe; the recovery is a command, not a button.
- **Hiding a project with a live or blocked agent run removes that run from the fleet and the blocked queue** (that is the filter working as specified). Nothing stops the agent or refuses the hide. Not guarded, because the plan does not ask for it.
- The rail row's look and the confirmation's wording are queued as `D-REV-61`, not verified (coverage D6). The missing restore surface is queued as `D-REV-62`.
- Existing register entries D-REV-29, D-REV-25 and D-REV-04 were not edited: updating them is plan 11-21's job (only the two new entries above were appended). D-REV-29's code half is done; D-REV-25 and D-REV-04 are measured, not fixed.
- Finding `one-1` (live counts on the rail) is in the same file and was **not** implemented and is not claimed; it stays with plan 11-21 as an owner decision.

## User Setup Required

None - no external service configuration required.

## Next Phase Readiness

- Ready for 11-20 / 11-21 (register entries D-REV-61 and D-REV-62 added). The register entries for D-REV-29 (implemented, with the limits above), D-REV-25 and D-REV-04 (measured, remedies queued as D-196 items) are the inputs 11-21 needs.
- No blockers. Migration 0022 will apply on the next launch of any build containing it; existing rows are all shown.

---
*Phase: 11-ship-it*
*Completed: 2026-10-14*

## Self-Check: PASSED

- Created files exist: `0022_project_hidden.sql`, `project_hide.rs`.
- Commits exist: `31076d7`, `ac0bf29`, `98c8dc2`.
- Acceptance greps: `0022_project_hidden.sql` registered 1 time in `db/mod.rs`; `project_hide` in `main.rs` 1; `project_restore` in `capabilities/default.json` 1.
- Phase 08 UAT screenshots clean (no browser suite run).
