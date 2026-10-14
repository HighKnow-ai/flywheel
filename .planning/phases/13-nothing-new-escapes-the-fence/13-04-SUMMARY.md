---
phase: 13-nothing-new-escapes-the-fence
plan: 04
subsystem: testing
tags: [rust, tauri, sqlite, migration, source-gate, docs, fnc-01]

requires:
  - phase: 13-01
    provides: two-sided source gate house style the roster test copies; PM-vocabulary gate the new test code does not trip
  - phase: 13-03
    provides: migration 0023, so the too-far-ahead fixture runs against the real 23-migration set
provides:
  - "CLAUDE.md Technology Stack states what is in the tree: Monaco, xyflow, git2 and the claude-agent-sdk are marked not installed with the real mechanism"
  - "PROJECT.md Phase 6 gate sentence corrected; A-01..A-04 recorded as owner decisions"
  - "migration_schema_too_far_ahead.rs: a database ahead of this build is refused, left intact, and the error names both versions and the recovery action (F7)"
  - "handler_roster.rs: generate_handler! is checked against every #[tauri::command] in both directions (F11)"
  - "13-LIVE-PLANNING-RUN.md: criterion 6's recorded-artifact path and protocol, status NOT YET RECORDED"
affects: [13-05, 15-drft-01, 16-records]

actuals:
  tokens: 5200
  tasks: 3
  commits: 3

tech-stack:
  added: []
  patterns:
    - "closed-world roster gate: extract declared and registered sets, diff both ways, plus a planted-violation half"
    - "wrap a library's bare error at the call site with the two numbers and the one recovery action"

key-files:
  created:
    - packages/core/tests/migration_schema_too_far_ahead.rs
    - packages/desktop/src-tauri/tests/handler_roster.rs
    - .planning/phases/13-nothing-new-escapes-the-fence/13-LIVE-PLANNING-RUN.md
  modified:
    - CLAUDE.md
    - .planning/PROJECT.md
    - packages/core/src/db/mod.rs
    - packages/desktop/src-tauri/src/main.rs

key-decisions:
  - "The too-far-ahead error context measures the build's supported version by applying the migration set to a throwaway in-memory database, because rusqlite_migration's Migrations exposes no length; this runs only on the refusal path and works for truncated sets too"
  - "handler_roster.rs derives paths from CARGO_MANIFEST_DIR rather than a workspace_root helper: it only reads files inside its own crate"
  - "UI libraries row split into three rows (installed libs, Monaco, xyflow) so each not-installed marker sits on its own line and none of the original decisions is deleted"

patterns-established:
  - "Roster gate: collect_commands / parse_roster / diff shared by the real-tree test and the planted-violation test"

requirements-completed: [FNC-01]

coverage:
  - id: D1
    description: "CLAUDE.md marks the four absent stack entries not-installed with the real mechanism; no row deleted"
    requirement: FNC-01
    verification:
      - kind: other
        ref: "grep -nE 'monaco|xyflow|git2|claude-agent-sdk' CLAUDE.md | grep -ciE 'not installed|not a dependency|in no Cargo.toml' -> 4"
        status: pass
    human_judgment: false
  - id: D2
    description: "PROJECT.md names Gate 1's real scan list and carries A-01..A-04 in Key Decisions"
    requirement: FNC-01
    verification:
      - kind: other
        ref: "grep -cE '^\\| \\*\\*A-0[1-4]\\*\\*' .planning/PROJECT.md -> 4; grep -c 'sidecar/src' -> 1"
        status: pass
    human_judgment: false
  - id: D3
    description: "A database whose user_version is ahead of the build is refused with the mismatch named, the file left byte-identical, and it opens again once the version is back in range"
    requirement: FNC-01
    verification:
      - kind: integration
        ref: "packages/core/tests/migration_schema_too_far_ahead.rs#a_database_ahead_of_this_build_is_refused_with_the_mismatch_named"
        status: pass
      - kind: integration
        ref: "packages/core/tests/migration_schema_too_far_ahead.rs#the_refused_database_is_left_byte_for_byte_intact"
        status: pass
      - kind: integration
        ref: "packages/core/tests/migration_schema_too_far_ahead.rs#the_same_database_opens_once_its_version_is_back_in_range"
        status: pass
    human_judgment: false
  - id: D4
    description: "Every #[tauri::command] under src/commands is in generate_handler! and every roster entry resolves to one"
    requirement: FNC-01
    verification:
      - kind: integration
        ref: "packages/desktop/src-tauri/tests/handler_roster.rs#every_tauri_command_is_registered_in_generate_handler"
        status: pass
      - kind: unit
        ref: "packages/desktop/src-tauri/tests/handler_roster.rs#the_roster_gate_fires_on_a_planted_violation"
        status: pass
    human_judgment: false
  - id: D5
    description: "Criterion 6's live planning run exists as a recorded artifact"
    verification: []
    human_judgment: true
    rationale: "The file is a path, a protocol and a NOT YET RECORDED status. The run itself spends the developer's credentials and has not happened; only the owner can start and paste it."

duration: 15 min
completed: 2026-10-14
status: complete
plan_head_before: f4732be6cd32ea2e033d34fc0fa81d7564e6cb19
commits: 3
---

# Phase 13 Plan 04: Documents and rosters tell the truth Summary

**CLAUDE.md and PROJECT.md now state what is in the tree, a database newer than the build is refused with both version numbers and a recovery action under test, and `generate_handler!` is checked against every `#[tauri::command]` in both directions.**

## Performance

- **Duration:** 15 min (cargo first-exec scans were most of it)
- **Started:** 2026-10-14T15:03:38Z
- **Completed:** 2026-10-14T15:18:26Z
- **Tasks:** 3
- **Files modified:** 7 (3 created, 4 edited)

## Accomplishments

- Four CLAUDE.md stack claims corrected against the tree (evidence below); no decision row deleted.
- PROJECT.md's Phase 6 no-promotion gate sentence now lists Gate 1's real scan dirs and attributes `packages/desktop/src` to the walker-reachability gate only. A-01 to A-04 recorded as four Key Decisions rows.
- F7: the refusal is tested three ways (error content, byte-identical file plus a backup present, reopens at the real version). The production change is error context only.
- F11: `handler_roster.rs` found 145 declared commands equal to 145 roster entries on first run; the planted-violation test proves the extractor is not vacuous and handles `#[tauri::command(async)]`, an interposed `#[allow]`, `pub async fn`, and commented-out code.
- Criterion 6's artifact has its path, protocol and honest status.

## Verified before changing (CLAUDE.md claims)

| Claim | Evidence run against the tree |
|---|---|
| `@monaco-editor/react`, `@xyflow/react`, `@anthropic-ai/claude-agent-sdk` absent | `grep -rln` over every `package.json`, `package-lock.json`, `pnpm-lock.yaml`, `Cargo.lock` (excluding `node_modules`): no hits |
| `git2` absent | no `name = "git2"` in `Cargo.lock`; no `git2` in any `Cargo.toml` |
| review reads shell out to system `git` | `review.rs` calls `crate::git::{review_files,review_patch,git_at,...}`; `git.rs` line 37 names itself the crate's one `Command::new("git")`. Note `review.rs` has no `Command::new` of its own; the shell-out is one hop away in `git.rs`, and the CLAUDE.md wording says so |
| adapter spawns the user's `claude` binary | `packages/sidecar/src/claude-code-adapter.ts` line 2 and `spawn(bin, ...)` |
| sidecar's only runtime dependency is `@modelcontextprotocol/sdk` 1.30.0 | `packages/sidecar/package.json` `dependencies` |
| the four libs left as installed are really installed | `packages/desktop/package.json`: react-query 5.102.8, react-virtual 3.14.11, react-diff-view 3.3.3, zustand 5.0.15 |
| PROJECT.md Gate 1 scan list | `proposal_no_promotion.rs` lines 99-105: core/src, desktop/src-tauri/src, sidecar/src; `packages/desktop/src` only in `the_no_promotion_gate_actually_reaches_the_frontend_tree` |

## Task Commits

1. **Task 1: CLAUDE.md and PROJECT.md reconciled, A-01..A-04 recorded** - `731d42b` (docs)
2. **Task 2: F7 too-far-ahead test and honest wording** - `b5da7aa` (test)
3. **Task 3: F11 roster gate and the live-run artifact** - `8726055` (test)

**Plan metadata:** the docs commit following this file.

## Files Created/Modified

- `CLAUDE.md` - Technology Stack rows corrected (UI row split into three)
- `.planning/PROJECT.md` - Phase 6 gate sentence; four Key Decisions rows
- `packages/core/tests/migration_schema_too_far_ahead.rs` - 3 tests, self-contained
- `packages/core/src/db/mod.rs` - doc comment and `schema_ahead_context` error context
- `packages/desktop/src-tauri/tests/handler_roster.rs` - 2 tests
- `packages/desktop/src-tauri/src/main.rs` - comment naming the roster the enforcement point
- `.planning/phases/13-nothing-new-escapes-the-fence/13-LIVE-PLANNING-RUN.md` - artifact placeholder

## Decisions Made

- Reviewed hunk list for `packages/core/src/db/mod.rs` (`git diff -U0 HEAD`): the `use` line (adds the crate's `Error` and `MigrationDefinitionError`); the doc-comment paragraph on `open_and_migrate`; the new `schema_ahead_context` fn; two inserts inside the `Err(migration_err)` branch of `open_and_migrate_with` (a read of `PRAGMA user_version` before the connection is dropped, and wrapping `migration_err` with the extra context just before the existing `return Err`). No hunk alters the restore-on-failure control flow: `drop(conn)`, the `backup_path` guard, `restore_from_backup` and the final return are unchanged.
- The error chain now reads, outermost first: "failed to run pending migrations ... restored the pre-migration backup ... and refused to open" / "this build supports database schema version N but the database is at version M, written by a newer build; install the newer build, or restore a backup from <dir>" / the crate's own message.
- The refused open still writes a backup and "restores" it over the live file (a copy of identical bytes). That is existing behaviour and untouched; the test asserts bytes and length, not mtime, because the restore legitimately rewrites the file.
- `-p desktop` is the real crate name (the plan guessed `flywheel-desktop`): `cargo test -p desktop --test handler_roster`.

## Deviations from Plan

**1. [Rule 1 - Plan wording] Plan's `-p flywheel-desktop` is `-p desktop`**
- The acceptance criterion allowed this ("If the crate name differs, the SUMMARY records the real `-p` value"). Recorded here.

**2. [Rule 3 - Verification] CLAUDE.md UI row split in three so the plan's own count holds**
- **Issue:** the plan's verify counts lines mentioning the four packages that carry a not-installed marker and fails below 4, but Monaco and xyflow sit on one table row, which yields 3.
- **Fix:** split `UI libraries` into the installed set, a `UI - code editor` row and a `UI - graph canvas` row. Nothing deleted; each decision keeps its row with corrected status.
- **Committed in:** `731d42b`

**3. [Rule 1 - Plan wording] review.rs does not itself shell out**
- The plan and research say "`review.rs` shells out to system `git`". It calls `git.rs`, which owns the one `Command::new("git")`. CLAUDE.md now says exactly that.

**4. [Rule 2 - Scope] Roster extractor follows the attribute to the next `fn`**
- The plan said "immediately preceding non-blank, non-doc-comment line". Taking the next `fn` after the attribute (skipping other attributes) is a superset that also covers `#[tauri::command(async)]` plus an `#[allow(...)]` line. All 145 real commands are of the `#[tauri::command]` or `#[tauri::command(async)]` form (130 and 15).

**Total deviations:** 4 (2 plan wording, 1 verification arithmetic, 1 extractor superset). **Impact:** none on scope or must-haves.

## Issues Encountered

- First `cargo test` of each new target paid the macOS Gatekeeper first-exec scan (about 2.5 min for each of the core and desktop targets, 3.5 min for the four re-run suites). Not a hang; true run times are 0.3s, 0.01s.

## Other CLAUDE.md drift noticed, NOT changed (out of this plan's scope, for the owner)

- The `PTY` row names `node-pty` 1.1.0 "inside the sidecar"; `grep` over every `package.json` outside `node_modules` found no `node-pty`. It is phrased "only if headless stream-json is insufficient", so it reads as a conditional decision, not a false fact, but it is not installed either.
- The `Sidecar runtime` row says "match what the Agent SDK supports", which refers to the dependency now marked absent.
- `.planning/REQUIREMENTS.md` was searched for `reversib`, `down-migration`, `rollback`, `roll back`, `backwards` and `undo`: no requirement words migration reversibility, so nothing needs the owner's edit.

## Known Stubs

- `13-LIVE-PLANNING-RUN.md` is deliberately a placeholder with status "NOT YET RECORDED - start on day one". It is not a stub that blocks this plan's goal: criterion 6 makes it a parallel measurement, DRFT-01 (Phase 15) owns retiring the hand-typed path field, and the plan's prohibition forbids fabricating it. Phase verification must report the status to the owner, not pass it.

## Threat Flags

None. No dependency added (T-13-19). `capabilities/default.json` is untouched (`git diff HEAD -- ...` empty; T-13-18). The roster gate closes T-13-16 and the version test closes T-13-15.

## User Setup Required

Owner action, not a blocker: start the live planning run and paste the run id, log path and the planner's named paths into `13-LIVE-PLANNING-RUN.md` (protocol inside).

## Next Phase Readiness

- Plan 13-05 can write the spine pin against the post-drop schema. FNC-01 is listed in this plan's `requirements`, but the pin itself is 13-05's; this plan only recorded the amendments that frame it, so FNC-01 should not read Complete on this plan alone (the shared-ID gate handles it if 13-05 also declares it).
- Anyone adding a Tauri command now has the obligation stated in `main.rs` and enforced by `handler_roster.rs`.

## Verification

- `cargo test -p core --test migration_schema_too_far_ahead`: 3 passed
- `cargo test -p core --test migration_safety --test db_bootstrap --test pm_vocabulary_gate --test estimate_absent`: 11, 11, 4, 2 passed
- `cargo test -p desktop --test handler_roster`: 2 passed
- `cargo check --workspace`: pass
- Not run: the rest of the 121 core test binaries (Gatekeeper cost; scoped runs per the environment note).

## Self-Check: PASSED

- FOUND: packages/core/tests/migration_schema_too_far_ahead.rs, packages/desktop/src-tauri/tests/handler_roster.rs, .planning/phases/13-nothing-new-escapes-the-fence/13-LIVE-PLANNING-RUN.md
- FOUND commits: 731d42b, b5da7aa, 8726055 (`git rev-list --count f4732be..HEAD` = 3)

---
*Phase: 13-nothing-new-escapes-the-fence*
*Completed: 2026-10-14*
