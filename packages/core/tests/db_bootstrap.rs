//! Behavior under test (01-01-PLAN.md Task 3):
//! - Opening a fresh database file leaves `PRAGMA journal_mode` reading back as `wal`.
//! - Opening an existing database a second time reports `synchronous = 1`, `busy_timeout = 5000`
//!   and `foreign_keys = 1` — these are connection-scoped and must be re-applied every open.
//! - `open_and_migrate` against a fresh path leaves `PRAGMA user_version` at `1`.
//! - `open_and_migrate` against an already-migrated path leaves `user_version` at `1` and appends
//!   no schema change.
//! - A backup file exists in the backups directory after `open_and_migrate`, and its bytes equal
//!   the pre-migration file's bytes.
//! - Backing up a path that does not yet exist is a no-op that returns `Ok` and writes no file.
//! - Inserting an actor with `type` outside `human|agent|system` returns an error from SQLite.

use core::db::backup::backup_database_file;
use core::db::{apply_pragmas, migration_sources, open_and_migrate};
use rusqlite::Connection;
use std::fs;

fn scratch_dir() -> tempfile::TempDir {
    tempfile::tempdir().expect("failed to create scratch dir")
}

#[test]
fn fresh_open_leaves_journal_mode_as_wal() {
    let dir = scratch_dir();
    let db_path = dir.path().join("flywheel.db");
    let backups_dir = dir.path().join("backups");

    let conn = open_and_migrate(&db_path, &backups_dir).expect("open_and_migrate should succeed");

    let journal_mode: String = conn
        .query_row("PRAGMA journal_mode", [], |row| row.get(0))
        .expect("journal_mode should be readable");
    assert_eq!(journal_mode.to_lowercase(), "wal");
}

#[test]
fn second_open_reapplies_connection_scoped_pragmas() {
    let dir = scratch_dir();
    let db_path = dir.path().join("flywheel.db");
    let backups_dir = dir.path().join("backups");

    // First open (creates + migrates the file).
    {
        let _conn =
            open_and_migrate(&db_path, &backups_dir).expect("first open_and_migrate should succeed");
    }

    // Second open against the same, already-migrated file: a plain `Connection::open` +
    // `apply_pragmas` (not `open_and_migrate`, so no re-migration is exercised here) must still
    // report all four pragmas correctly re-applied.
    let conn = Connection::open(&db_path).expect("second open should succeed");
    apply_pragmas(&conn).expect("apply_pragmas should succeed on second open");

    let synchronous: i64 = conn
        .query_row("PRAGMA synchronous", [], |row| row.get(0))
        .unwrap();
    assert_eq!(synchronous, 1, "synchronous should be NORMAL (1)");

    let busy_timeout: i64 = conn
        .query_row("PRAGMA busy_timeout", [], |row| row.get(0))
        .unwrap();
    assert_eq!(busy_timeout, 5000);

    let foreign_keys: i64 = conn
        .query_row("PRAGMA foreign_keys", [], |row| row.get(0))
        .unwrap();
    assert_eq!(foreign_keys, 1);
}

#[test]
fn open_and_migrate_on_fresh_path_advances_user_version_to_latest() {
    let dir = scratch_dir();
    let db_path = dir.path().join("flywheel.db");
    let backups_dir = dir.path().join("backups");

    let conn = open_and_migrate(&db_path, &backups_dir).expect("open_and_migrate should succeed");

    let user_version: i64 = conn
        .query_row("PRAGMA user_version", [], |row| row.get(0))
        .unwrap();
    // Asserts "the latest schema version" against the same ordered source list `open_and_migrate`
    // itself compiles from (`migration_sources`) — never a literal count that every future
    // migration would have to edit by hand.
    assert_eq!(user_version, migration_sources().len() as i64);
}

#[test]
fn open_and_migrate_is_idempotent_on_second_call() {
    let dir = scratch_dir();
    let db_path = dir.path().join("flywheel.db");
    let backups_dir = dir.path().join("backups");

    {
        let _conn = open_and_migrate(&db_path, &backups_dir).expect("first call should succeed");
    }
    let conn = open_and_migrate(&db_path, &backups_dir).expect("second call should succeed");

    let user_version: i64 = conn
        .query_row("PRAGMA user_version", [], |row| row.get(0))
        .unwrap();
    assert_eq!(
        user_version,
        migration_sources().len() as i64,
        "user_version must stay at the latest schema version, not advance again"
    );
}

#[test]
fn open_and_migrate_writes_a_byte_identical_backup_before_migrating() {
    let dir = scratch_dir();
    let db_path = dir.path().join("flywheel.db");
    let backups_dir = dir.path().join("backups");

    // Prime a schema-version-0 file (a plain, unmigrated SQLite file) so the second
    // `open_and_migrate` call has something real to back up before it migrates.
    {
        let _conn = Connection::open(&db_path).expect("priming open should succeed");
    }
    let pre_migration_bytes = fs::read(&db_path).expect("should be able to read the primed file");

    let _conn = open_and_migrate(&db_path, &backups_dir).expect("open_and_migrate should succeed");

    let backup_files: Vec<_> = fs::read_dir(&backups_dir)
        .expect("backups dir should exist")
        .filter_map(|e| e.ok())
        .collect();
    assert!(
        !backup_files.is_empty(),
        "expected at least one backup file in {backups_dir:?}"
    );

    let backup_bytes =
        fs::read(backup_files[0].path()).expect("should be able to read the backup file");
    assert_eq!(
        backup_bytes, pre_migration_bytes,
        "backup file bytes must match the pre-migration file exactly"
    );
}

#[test]
fn backing_up_a_missing_path_is_a_no_op() {
    let dir = scratch_dir();
    let db_path = dir.path().join("does-not-exist.db");
    let backups_dir = dir.path().join("backups");

    let result = backup_database_file(&db_path, &backups_dir)
        .expect("backing up a missing file should return Ok");
    assert!(result.is_none(), "expected no backup path for a missing file");
    assert!(
        !backups_dir.exists(),
        "backups dir must not be created for a no-op backup"
    );
}

#[test]
fn actor_insert_rejects_type_outside_the_fixed_enum() {
    let dir = scratch_dir();
    let db_path = dir.path().join("flywheel.db");
    let backups_dir = dir.path().join("backups");

    let conn = open_and_migrate(&db_path, &backups_dir).expect("open_and_migrate should succeed");

    let result = conn.execute(
        "INSERT INTO actors (id, type, display_name, created_at) VALUES (?1, ?2, ?3, ?4)",
        rusqlite::params![
            "01ARZ3NDEKTSV4RRFFQ69G5FAV",
            "not-a-real-type",
            "Someone",
            "2026-01-01T00:00:00Z"
        ],
    );
    assert!(
        result.is_err(),
        "inserting an actor with an invalid type should be rejected by the CHECK constraint"
    );
}

/// `FLYWHEEL_APP_DATA_DIR` is process-wide state, so the two tests below serialise against each
/// other exactly the way `context_packet.rs` serialises `FLYWHEEL_WORKTREE_ROOT`: without a lock
/// one test's `set_var`/`remove_var` interleaves with the other's read and the assertion becomes
/// a coin flip.
static APP_DATA_DIR_ENV_LOCK: std::sync::Mutex<()> = std::sync::Mutex::new(());

#[test]
fn app_data_dir_override_redirects_the_database_and_backups() {
    let guard = APP_DATA_DIR_ENV_LOCK
        .lock()
        .unwrap_or_else(|poisoned| poisoned.into_inner());
    let dir = scratch_dir();

    // SAFETY: the mutex above serialises every caller in this binary, so no other thread reads or
    // writes this variable while it is set here.
    unsafe { std::env::set_var("FLYWHEEL_APP_DATA_DIR", dir.path()) };

    let db_path = core::db::default_db_path().expect("default_db_path should succeed");
    let backups_dir = core::db::default_backups_dir().expect("default_backups_dir should succeed");

    // SAFETY: see the set_var call above.
    unsafe { std::env::remove_var("FLYWHEEL_APP_DATA_DIR") };
    drop(guard);

    assert_eq!(db_path, dir.path().join("flywheel.db"));
    assert_eq!(backups_dir, dir.path().join("backups"));
}

#[test]
fn absent_app_data_dir_override_leaves_the_os_app_data_location_in_use() {
    let guard = APP_DATA_DIR_ENV_LOCK
        .lock()
        .unwrap_or_else(|poisoned| poisoned.into_inner());

    // SAFETY: the mutex above serialises every caller in this binary.
    unsafe { std::env::remove_var("FLYWHEEL_APP_DATA_DIR") };

    let db_path = core::db::default_db_path().expect("default_db_path should succeed");

    drop(guard);

    let expected = dirs::data_dir()
        .expect("the OS app-data directory should resolve")
        .join("Flywheel")
        .join("flywheel.db");
    assert_eq!(db_path, expected);
}

/// WR-02 (03-REVIEW.md): a non-empty RELATIVE override must be rejected by name, mirroring
/// `packages/shim/src/main.rs::resolve_real_binary_from_env`'s own absolute-path assertion for
/// `FLYWHEEL_REAL_GIT`/`FLYWHEEL_REAL_RM` — before this task, `app_data_dir` returned
/// `PathBuf::from(over)` verbatim for any non-empty value, silently resolving a relative path
/// against whatever directory the process happened to be standing in.
#[test]
fn non_empty_relative_app_data_dir_override_is_rejected_by_name() {
    let guard = APP_DATA_DIR_ENV_LOCK
        .lock()
        .unwrap_or_else(|poisoned| poisoned.into_inner());

    // SAFETY: the mutex above serialises every caller in this binary.
    unsafe { std::env::set_var("FLYWHEEL_APP_DATA_DIR", "relative/scratch/path") };

    let result = core::db::default_db_path();

    // SAFETY: see the set_var call above.
    unsafe { std::env::remove_var("FLYWHEEL_APP_DATA_DIR") };
    drop(guard);

    let err = result.expect_err("a non-empty relative FLYWHEEL_APP_DATA_DIR must be rejected");
    let message = format!("{err:#}");
    assert!(
        message.contains("FLYWHEEL_APP_DATA_DIR"),
        "error message must name the offending variable: {message:?}"
    );
    assert!(
        message.contains("relative/scratch/path"),
        "error message must name the offending value: {message:?}"
    );
}

#[test]
fn empty_app_data_dir_override_is_ignored_rather_than_resolving_relative() {
    let guard = APP_DATA_DIR_ENV_LOCK
        .lock()
        .unwrap_or_else(|poisoned| poisoned.into_inner());

    // SAFETY: the mutex above serialises every caller in this binary.
    unsafe { std::env::set_var("FLYWHEEL_APP_DATA_DIR", "") };

    let db_path = core::db::default_db_path().expect("default_db_path should succeed");

    // SAFETY: see the set_var call above.
    unsafe { std::env::remove_var("FLYWHEEL_APP_DATA_DIR") };
    drop(guard);

    assert!(
        db_path.is_absolute(),
        "an empty override must fall back to the OS app-data directory, not a relative path: \
         {db_path:?}"
    );
}
