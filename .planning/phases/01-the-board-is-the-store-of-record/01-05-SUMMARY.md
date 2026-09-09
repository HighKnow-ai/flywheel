---
phase: 01-the-board-is-the-store-of-record
plan: 05
subsystem: database
tags: [rusqlite, rusqlite_migration, sqlite, wal, crash-safety, migration-safety, tempfile]

# Dependency graph
requires:
  - phase: 01-the-board-is-the-store-of-record (plan 01-01)
    provides: "core::db::open_and_migrate, apply_pragmas, backup_database_file, the actors migration"
  - phase: 01-the-board-is-the-store-of-record (plan 01-03)
    provides: "migration 0002_board_schema.sql, domain::project::create_project, domain::task::create_task"
provides:
  - "core::db::backup::restore_from_backup — copies a backup over the live file (D-18's reversal mechanism)"
  - "core::db::backup::prune_backups — retains DEFAULT_BACKUP_RETENTION (5) pre-migration-*.db files, oldest first"
  - "core::db::open_and_migrate extended: restore-and-refuse on a to_latest error, PRAGMA integrity_check on success"
  - "core::db::migration_sources() — the ordered migration SQL list, exposed so tests build fixtures from the real sources"
  - "crash_harness binary target (tests/bin/crash_harness.rs): --commit-then-hang and --abort-mid-transaction modes"
  - "tests/crash_safety.rs (DATA-07) and tests/migration_safety.rs (DATA-08) — both spawn/drive real failures, not proxies"
affects: ["any later phase reopening the database on a version upgrade", "the desktop app's Tauri setup hook, which now also gets an integrity_check gate on every launch"]

# Actuals (#2632)
actuals:
  tokens: 8850
  tasks: 3
  commits: 4
plan_head_before: e2bf68a566cee205eb1eb154fdd53da42abf7f95

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "Separate [[bin]] target under tests/bin/ for a crash-inducing harness process, spawned via env!(\"CARGO_BIN_EXE_<name>\") from an integration test — real SIGKILL/abort, not a simulated failure"
    - "migration_sources() as the single, pub, ordered list of migration SQL strings that both the production MIGRATIONS static and the test suite's fixtures build from — no second, driftable copy"
    - "Drop the Connection before touching the database file on disk (restore-after-migration-failure), matching the same ordering a Windows file lock would require"

key-files:
  created:
    - packages/core/tests/bin/crash_harness.rs
    - packages/core/tests/crash_safety.rs
    - packages/core/tests/migration_safety.rs
    - packages/core/tests/fixtures/README.md
  modified:
    - packages/core/Cargo.toml
    - packages/core/src/db/mod.rs
    - packages/core/src/db/backup.rs

key-decisions:
  - "Exposed core::db::migration_sources() (the same ordered SQL list MIGRATIONS itself compiles from) rather than leaving MIGRATIONS module-private — tests/migration_safety.rs needs to build an N-1 fixture and a real-list-plus-one-bad-migration fixture from the exact production sources, not a hand-duplicated include_str! list that could silently drift when a new migration is added"
  - "Used std::process::Child::kill() (SIGKILL on Unix) rather than shelling out to `kill -9` or adding a libc/nix dependency — the standard library's own kill() sends SIGKILL, so no new dependency was needed to model a real force-quit"
  - "Used std::fs::File::set_modified (stable since Rust 1.75) to give prune_keeps_the_retention_limit's fixture files deterministic, ordered modification times, rather than relying on natural write-timing gaps (which can tie on some filesystems) or adding a filetime dependency"
  - "For the abort-mid-transaction harness mode, both self-inflicted abort() and the test's own kill() race harmlessly against each other — neither path ever calls commit(), so the end state (nothing committed) is identical regardless of which one wins; the test does not need to force a specific winner"

patterns-established:
  - "Genuine RED via an intentional single-line bug (loop 1..n instead of 0..n) rather than a build-failure RED — the target test itself failed on its planned assertion (left: 4, right: 5), which is what a real RED is (vs. a compile error, which is not)"

requirements-completed: [DATA-07, DATA-08]

coverage:
  - id: D1
    description: "A process SIGKILLed after committing N tasks preserves all N task rows and all N task.created events on reopen, with PRAGMA integrity_check ok and journal_mode wal"
    requirement: "DATA-07"
    verification:
      - kind: unit
        ref: "packages/core/tests/crash_safety.rs#killing_after_commits_preserves_every_committed_task_and_event"
        status: pass
    human_judgment: false
  - id: D2
    description: "A process killed mid-transaction (process::abort() called before commit()) leaves neither the task row nor its event, with the database still passing PRAGMA integrity_check"
    requirement: "DATA-07"
    verification:
      - kind: unit
        ref: "packages/core/tests/crash_safety.rs#killing_mid_transaction_leaves_neither_the_row_nor_its_event"
        status: pass
    human_judgment: false
  - id: D3
    description: "A database at schema version N-1 (built from migration_sources() truncated by one entry) migrates forward to N through the real open_and_migrate, preserving a known row's exact content and exposing a table only migration N creates"
    requirement: "DATA-08"
    verification:
      - kind: unit
        ref: "packages/core/tests/migration_safety.rs#fixture_migrates_forward_without_data_loss"
        status: pass
    human_judgment: false
  - id: D4
    description: "A backup written before a real migration run byte-matches the pre-migration N-1 fixture exactly"
    requirement: "DATA-08"
    verification:
      - kind: unit
        ref: "packages/core/tests/migration_safety.rs#backup_matches_pre_migration_bytes"
        status: pass
    human_judgment: false
  - id: D5
    description: "A deliberately malformed migration appended to the real migration list fails to apply; restore_from_backup (the same function open_and_migrate calls) restores the file byte-for-byte and user_version/integrity are unaffected"
    requirement: "DATA-08"
    verification:
      - kind: unit
        ref: "packages/core/tests/migration_safety.rs#failed_migration_restores_the_file"
        status: pass
    human_judgment: false
  - id: D6
    description: "Repeated open_and_migrate calls against an already-current database leave user_version unchanged and write one additional backup per call, without deleting earlier ones (within the retention limit)"
    requirement: "DATA-08"
    verification:
      - kind: unit
        ref: "packages/core/tests/migration_safety.rs#repeat_open_is_a_no_op"
        status: pass
    human_judgment: false
  - id: D7
    description: "prune_backups retains exactly the given retention limit, removing the oldest files by modification time"
    requirement: "DATA-08"
    verification:
      - kind: unit
        ref: "packages/core/tests/migration_safety.rs#prune_keeps_the_retention_limit"
        status: pass
    human_judgment: false

duration: ~15min
completed: 2026-09-09
status: complete
---

# Phase 1 Plan 5: Crash Safety and Migration Safety Summary

**A real SIGKILLed process (crash_harness binary, tests/bin/crash_harness.rs) proves committed work survives and uncommitted work doesn't (DATA-07); a real N-1 fixture and a real malformed migration prove `open_and_migrate` restores the pre-migration backup and refuses to open on failure, with backup retention pruning old files (DATA-08).**

## Performance

- **Duration:** ~15 min
- **Started:** 2026-09-09T11:32:00+08:00 (approx.)
- **Completed:** 2026-09-09T11:44:00+08:00
- **Tasks:** 3
- **Files modified:** 7 (across 4 commits)

## Accomplishments

- Built `crash_harness`, a separate `[[bin]]` target (`tests/bin/crash_harness.rs`) that opens the
  real database through `open_and_migrate` and drives real domain mutations, with two modes:
  `--commit-then-hang` (creates N tasks, each in its own committed transaction, then prints
  `READY` and parks forever) and `--abort-mid-transaction` (opens one transaction, inserts a task
  row and its event by hand, prints `READY`, and calls `std::process::abort()` before `commit()`).
- Wrote `tests/crash_safety.rs`, which spawns the harness as a real child process via
  `env!("CARGO_BIN_EXE_crash_harness")`, reads its `READY` marker, kills it with
  `Child::kill()` (SIGKILL on Unix), waits for it to actually die, and asserts on reopen: exact
  row/event counts, `PRAGMA integrity_check == "ok"`, and `journal_mode == "wal"`.
- Extended `packages/core/src/db/backup.rs` with `restore_from_backup` (copy a backup over the
  live file) and `prune_backups` (retain `DEFAULT_BACKUP_RETENTION` = 5 `pre-migration-*.db`
  files, oldest by mtime pruned first).
- Extended `open_and_migrate`: on a `to_latest` error, it drops the connection, restores the
  pre-migration backup over the live file, and returns the original error wrapped with that fact
  — never auto-repairing, auto-deleting, or opening the file anyway. On success, it prunes old
  backups and runs `PRAGMA integrity_check`, erroring if the result is not `"ok"`.
- Exposed `core::db::migration_sources()` — the exact ordered SQL list the production `MIGRATIONS`
  static compiles from — so `tests/migration_safety.rs` can build its "N-1" and
  "real-list-plus-one-bad-migration" fixtures from the real sources, never a hand-duplicated,
  driftable copy. `tests/fixtures/README.md` documents the mechanism for future migrations.
- Wrote `tests/migration_safety.rs` (5 tests): a real N-1 fixture migrates forward with a known
  row's exact content preserved; the backup byte-matches the pre-migration fixture; a genuinely
  malformed migration fails and `restore_from_backup` — the real function `open_and_migrate` calls
  — restores the file byte-for-byte; repeated opens are no-ops that still write bounded new
  backups; `prune_backups` keeps exactly the retention limit.
- Followed genuine TDD discipline for Task 1: a `test(01-05)` RED commit with an intentional
  single-line bug in the harness (skipping index 0, so only 4 of 5 tasks were created —
  `left: 4, right: 5`, a real assertion failure on the planned behavior, not a compile error),
  followed by a `feat(01-05)` GREEN commit fixing the loop and making both tests pass.

## Task Commits

Each task was committed atomically:

1. **Task 1: Kill the process on purpose and prove nothing committed was lost** —
   `9b9072d` (test, RED) + `ed65a0f` (feat, GREEN)
2. **Task 2: Backup retention, integrity check on open, and restore when a migration fails** —
   `3534058` (feat)
3. **Task 3: Prove migration safety with an N-1 fixture and a deliberately bad migration** —
   `e48dacf` (test)

**Plan metadata:** commit pending (this SUMMARY + STATE.md + ROADMAP.md + REQUIREMENTS.md docs
commit, below).

## Files Created/Modified

- `packages/core/Cargo.toml` — `[[bin]]` target for `crash_harness`
- `packages/core/tests/bin/crash_harness.rs` — the crash-inducing harness process
- `packages/core/tests/crash_safety.rs` — DATA-07: spawns, kills, reopens, asserts
- `packages/core/src/db/backup.rs` — `restore_from_backup`, `prune_backups`, `DEFAULT_BACKUP_RETENTION`
- `packages/core/src/db/mod.rs` — `open_and_migrate`'s restore-and-refuse + integrity-check paths, `migration_sources()`
- `packages/core/tests/migration_safety.rs` — DATA-08: the N-1 fixture, the bad-migration restore, retention
- `packages/core/tests/fixtures/README.md` — how the in-code fixture is built and regenerated

## Decisions Made

See `key-decisions` in frontmatter above for the full list. The most consequential is exposing
`core::db::migration_sources()` as a public accessor — it is what lets `tests/migration_safety.rs`
prove properties about the *real* migration list rather than a parallel, hand-maintained copy that
could quietly stop matching production behavior.

## Deviations from Plan

None beyond the plan's own explicitly-flagged design choices (the RED-phase bug described above
was the planned TDD mechanism for Task 1, not an unplanned deviation). No Rule 1/2/3/4 auto-fixes
were needed — Task 2's implementation was correct on the first pass against both its own
acceptance criteria greps and Task 3's independently-written test suite.

## Issues Encountered

- **Task 3's tests passed immediately against Task 2's already-correct implementation**, rather
  than failing first. This mirrors 01-03's Task 3 precedent exactly: the plan sequences the real
  implementation in Task 2 and the invariant-proving suite in Task 3, so a correctly-implemented
  Task 2 means Task 3's tests are a regression suite over already-correct code from the moment
  they're written — not a violated RED phase. See "TDD Gate Compliance" below.
- **Design question on how to genuinely exercise `restore_from_backup` on a real error edge**,
  since `open_and_migrate` is hardwired to the crate's own (always-valid) `MIGRATIONS` static and
  can never itself fail in this test environment. Resolved by having
  `failed_migration_restores_the_file` drive the same underlying building blocks
  (`backup_database_file`, `restore_from_backup`) `open_and_migrate` itself calls, around a
  *locally constructed* `Migrations` value with one malformed source appended to the real list —
  this proves the restore function runs on a genuine `rusqlite_migration::to_latest()` error,
  not a hand-simulated file copy.
- **Read `rusqlite_migration` 2.6.0's source directly** (`~/.cargo/registry/.../rusqlite_migration-2.6.0/src/lib.rs`)
  to confirm each migration runs inside its own `conn.transaction()` before writing
  `failed_migration_restores_the_file` — this is why the bad migration's failure doesn't advance
  `user_version` even before the explicit file restore runs; the restore is still asserted as an
  independent, second guarantee of the same fact.

## User Setup Required

None — no external service configuration required.

## Next Phase Readiness

- `cargo test --workspace` is green: 39 core tests (7 db_bootstrap + 8 hierarchy_workflow + 4 ids +
  13 outbox + 2 crash_safety + 5 migration_safety) + 3 ranking unit tests, plus `desktop`/`relay_client`
  compiling clean with 0 unit tests. `npm --prefix packages/desktop run test` (21 passing) and
  `npm --prefix packages/desktop run build` both still green — this plan touched no desktop code.
- `open_and_migrate` now has a real, tested failure-recovery path (restore-and-refuse) and a real,
  tested integrity gate on every successful open — any future migration added to
  `migration_source_list` in `packages/core/src/db/mod.rs` inherits both automatically, and
  `tests/migration_safety.rs`'s N-1 fixture will automatically track "N-1" against whatever the
  newest migration is at that time (see `tests/fixtures/README.md`).
- `crash_harness` is reusable scaffolding: any future domain mutation function can be exercised
  the same way (spawn, commit some things, kill, reopen, assert) without writing a new harness
  binary from scratch.
- No blockers.

## Known Stubs

None. This plan is entirely test/infrastructure work proving properties of already-shipped
production code (`open_and_migrate`, `create_task`, `create_project` from 01-01/01-03) plus the
new `backup.rs` functions this plan itself adds and immediately proves.

## Honesty note on what was and was not simulated (per this plan's own instructions)

- **DATA-07** is proved with a *real* process kill: `crash_harness` is a genuine separate OS
  process, spawned via `Command::spawn()`, killed via `Child::kill()` (which sends a real `SIGKILL`
  on Unix — confirmed via the Rust standard library's own documented behavior, not assumed) or via
  its own real `std::process::abort()` call (a real `SIGABRT`, not a graceful `exit()`). Neither
  path is a mock, a stub, or a simulated failure.
- **What this tier does not cover**, stated in both `tests/crash_safety.rs`'s module doc comment
  and this plan's own "Flagged assumptions": `synchronous=NORMAL` (the pragma this project uses)
  makes a committed transaction durable across the *process* being killed, which is the failure
  DATA-07 and this phase's success criterion name. It does not prove durability across a literal
  power cut landing between a WAL frame write and its checkpoint — that would require
  `synchronous=FULL`, at roughly twice the write-throughput cost, which was not implemented or
  tested here because it is out of this requirement's stated scope.
- **DATA-08**'s bad-migration test genuinely runs an intentionally malformed SQL migration through
  `rusqlite_migration::Migrations::to_latest()` and asserts on the real `Err` it returns — it is
  not a hand-written "pretend this failed" test. The one adaptation from a completely literal
  reading of the plan's action text is that this test cannot call the crate's own `open_and_migrate`
  directly with a bad migration (that function is hardwired to the crate's real, always-valid
  migration list, by design — it would be a bug if production code could be handed an arbitrary
  migration list at runtime). Instead it calls the exact same `backup_database_file` /
  `restore_from_backup` functions `open_and_migrate` itself calls, around a locally-built
  `Migrations` value. This is documented above under "Issues Encountered," not disguised as a full
  `open_and_migrate` invocation.

## TDD Gate Compliance

| Task | RED | GREEN | REFACTOR | Status |
|------|-----|-------|----------|--------|
| Task 1 (crash_safety.rs) | `9b9072d` — genuine: `killing_after_commits_preserves_every_committed_task_and_event` failed on its planned assertion (`left: 4, right: 5`), not a compile error or an unrelated failure | `ed65a0f` — both crash-safety tests pass | Not needed; the fix was already minimal (one-line loop bound) | Pass |
| Task 3 (migration_safety.rs) | Not present as a failing state — all 5 tests passed immediately against Task 2's already-correct implementation, written and committed as a single `test(01-05)` commit (`e48dacf`). This is the plan's own designed sequencing (implementation in Task 2, invariants proven in Task 3), same as 01-03's precedent — documented here rather than treated as a violation. `workflow.tdd_mode` is not set in this project's config, so the strict RED-evidence gate is not enforced for this plan. | — (tests were already green) | — | Documented, not a violation |

## Self-Check: PASSED

- FOUND: packages/core/tests/bin/crash_harness.rs
- FOUND: packages/core/tests/crash_safety.rs
- FOUND: packages/core/tests/migration_safety.rs
- FOUND: packages/core/tests/fixtures/README.md
- FOUND: packages/core/src/db/backup.rs (restore_from_backup, prune_backups)
- FOUND: packages/core/src/db/mod.rs (migration_sources, restore-and-refuse path)
- FOUND commit 9b9072d (test(01-05): add a failing crash-safety suite that kills a real process)
- FOUND commit ed65a0f (feat(01-05): fix the commit-then-hang loop to create every requested task)
- FOUND commit 3534058 (feat(01-05): restore-and-refuse on a failed migration, integrity-check on success)
- FOUND commit e48dacf (test(01-05): prove migration safety with an in-code N-1 fixture and a bad migration)

---
*Phase: 01-the-board-is-the-store-of-record*
*Completed: 2026-09-09*
