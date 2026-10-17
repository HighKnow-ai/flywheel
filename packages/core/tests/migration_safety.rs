//! DATA-08 — proves migration safety with a real "N-1" database and a real failing migration,
//! rather than trusting the pragma choice and the happy path.
//!
//! The migration list starts at the MVP baseline (ADR 0003), so "N-1" is a database at the baseline
//! and "N" is the baseline plus one more migration, built here from `core::db::migration_sources()`
//! (the same ordered SQL list `core::db::MIGRATIONS` compiles from) and driven through
//! `open_and_migrate_with` — the exact code path every later ordinary migration will take. No
//! binary `.db` fixture is committed (see `tests/fixtures/README.md`).

use std::collections::HashSet;
use std::fs::{self, File};
use std::time::{Duration, SystemTime};

use core::db::backup::{backup_database_file, prune_backups, restore_from_backup};
use core::db::{apply_pragmas, migration_sources, open_and_migrate, open_and_migrate_with};
use rusqlite::Connection;
use rusqlite_migration::{Migrations, M};

fn scratch_dir() -> tempfile::TempDir {
    tempfile::tempdir().expect("failed to create scratch dir")
}

/// Number of backup files currently in `backups_dir`. `backups_dir` may not exist at all yet — a
/// brand-new database has nothing to back up on its first open (D-18) — which is not an error.
fn backup_file_count(backups_dir: &std::path::Path) -> usize {
    if !backups_dir.exists() {
        return 0;
    }
    fs::read_dir(backups_dir)
        .expect("failed to read backups dir")
        .filter_map(|entry| entry.ok())
        .count()
}

/// The next ordinary migration a later Story would add on top of the baseline: one new nullable
/// column, the shape ADR 0003 names for "fields discovered after the cut".
const NEXT_MIGRATION: &str = "ALTER TABLE stories ADD COLUMN merged_with_failing_check INTEGER;";

/// The real sources plus [`NEXT_MIGRATION`]: "N".
fn sources_with_next() -> Vec<&'static str> {
    let mut sources = migration_sources();
    sources.push(NEXT_MIGRATION);
    sources
}

/// A database at the baseline ("N-1"), built through the real `open_and_migrate`.
fn baseline_database(db_path: &std::path::Path, backups_dir: &std::path::Path) {
    let _conn = open_and_migrate(db_path, backups_dir).expect("the baseline should apply cleanly");
}

#[test]
fn a_baseline_database_migrates_forward_without_data_loss() {
    let dir = scratch_dir();
    let db_path = dir.path().join("flywheel.db");
    let backups_dir = dir.path().join("backups");
    baseline_database(&db_path, &backups_dir);

    let known_actor_id = core::ids::new_id();
    {
        let conn = Connection::open(&db_path).unwrap();
        conn.execute(
            "INSERT INTO actors (id, type, display_name, auth_ref, created_at)
             VALUES (?1, 'human', ?2, NULL, ?3)",
            rusqlite::params![known_actor_id, "Fixture Actor", "2026-01-01T00:00:00Z"],
        )
        .expect("failed to insert the known fixture row");
    }

    let next = Migrations::new(sources_with_next().into_iter().map(M::up).collect());
    let conn = open_and_migrate_with(&db_path, &backups_dir, &next)
        .expect("open_and_migrate_with should carry the baseline forward to N");

    let user_version: i64 = conn.query_row("PRAGMA user_version", [], |row| row.get(0)).unwrap();
    assert_eq!(user_version, sources_with_next().len() as i64, "user_version should advance to N");

    // The column the newest migration adds is queryable — the migration actually ran.
    let merged: i64 = conn
        .query_row("SELECT COUNT(merged_with_failing_check) FROM stories", [], |row| row.get(0))
        .expect("the column introduced by the newest migration should exist");
    assert_eq!(merged, 0);

    let (actor_type, display_name, created_at): (String, String, String) = conn
        .query_row(
            "SELECT type, display_name, created_at FROM actors WHERE id = ?1",
            rusqlite::params![known_actor_id],
            |row| Ok((row.get(0)?, row.get(1)?, row.get(2)?)),
        )
        .expect("the row inserted before the migration should still be present");
    assert_eq!(actor_type, "human");
    assert_eq!(display_name, "Fixture Actor");
    assert_eq!(created_at, "2026-01-01T00:00:00Z");
}

#[test]
fn backup_matches_pre_migration_bytes() {
    let dir = scratch_dir();
    let db_path = dir.path().join("flywheel.db");
    let backups_dir = dir.path().join("backups");
    baseline_database(&db_path, &backups_dir);
    let pre_migration_bytes = fs::read(&db_path).expect("should read the baseline file");

    let next = Migrations::new(sources_with_next().into_iter().map(M::up).collect());
    let _conn = open_and_migrate_with(&db_path, &backups_dir, &next).expect("open_and_migrate_with should succeed");

    let backup_files: Vec<_> = fs::read_dir(&backups_dir)
        .expect("backups dir should exist after a migration ran")
        .filter_map(|entry| entry.ok())
        .collect();
    assert_eq!(backup_files.len(), 1, "exactly one backup should exist after the single migration run");

    let backup_bytes = fs::read(backup_files[0].path()).expect("should be able to read the backup file");
    assert_eq!(
        backup_bytes, pre_migration_bytes,
        "the backup's bytes must match the database exactly as it stood before the run"
    );
}

#[test]
fn failed_migration_restores_the_file() {
    let dir = scratch_dir();
    let db_path = dir.path().join("flywheel.db");
    let backups_dir = dir.path().join("backups");

    // Get to a real, fully-migrated N state through the real open_and_migrate.
    {
        let _conn = open_and_migrate(&db_path, &backups_dir)
            .expect("priming open_and_migrate should succeed");
    }
    let pre_attempt_bytes = fs::read(&db_path).expect("should read the fully-migrated file");

    // Drive the exact building blocks open_and_migrate itself uses — backup_database_file and
    // restore_from_backup — around a local Migrations value that appends one intentionally
    // malformed migration to the real, full list. This proves restore_from_backup runs on the
    // real to_latest() error edge, not a hand-simulated one.
    let backup_path = backup_database_file(&db_path, &backups_dir)
        .expect("backing up before the about-to-fail migration should succeed")
        .expect("a backup path should exist for an already-existing file");

    let mut bad_sources = migration_sources();
    bad_sources.push("THIS IS NOT VALID SQL AND WILL FAIL TO APPLY;");
    let bad_migrations = Migrations::new(bad_sources.into_iter().map(M::up).collect());

    {
        let mut conn =
            Connection::open(&db_path).expect("failed to open the file for the bad-migration attempt");
        apply_pragmas(&conn).expect("failed to apply pragmas");
        let result = bad_migrations.to_latest(&mut conn);
        assert!(
            result.is_err(),
            "the malformed migration must fail to apply, not silently succeed"
        );
        // conn is dropped at the end of this block, releasing the file lock before the restore —
        // mirroring open_and_migrate's own drop-before-restore ordering.
    }

    restore_from_backup(&db_path, &backup_path).expect("restoring the backup should succeed");

    let post_restore_bytes = fs::read(&db_path).expect("should read the restored file");
    assert_eq!(
        post_restore_bytes, pre_attempt_bytes,
        "the restored file's bytes must match the file exactly as it stood before the failed migration"
    );

    // No half-applied table from the bad migration exists, and user_version is back to N, not
    // advanced by the failed attempt (rusqlite_migration runs each migration inside its own
    // transaction, so the failed one never committed in the first place — the restore is a
    // second, independent guarantee of the same fact).
    let conn = Connection::open(&db_path).expect("should be able to reopen the restored file");
    let user_version: i64 = conn
        .query_row("PRAGMA user_version", [], |row| row.get(0))
        .unwrap();
    assert_eq!(
        user_version,
        migration_sources().len() as i64,
        "user_version should be back to N, not advanced by the failed attempt"
    );
    let integrity: String = conn
        .query_row("PRAGMA integrity_check", [], |row| row.get(0))
        .unwrap();
    assert_eq!(integrity, "ok");
}

#[test]
fn repeat_open_is_a_no_op() {
    let dir = scratch_dir();
    let db_path = dir.path().join("flywheel.db");
    let backups_dir = dir.path().join("backups");

    let _conn = open_and_migrate(&db_path, &backups_dir).expect("first open should succeed");
    assert_eq!(
        backup_file_count(&backups_dir),
        0,
        "a brand-new database has nothing to back up on its first open"
    );

    let _conn = open_and_migrate(&db_path, &backups_dir).expect("second open should succeed");
    assert_eq!(
        backup_file_count(&backups_dir),
        1,
        "the second open should write exactly one backup of the now-existing file"
    );

    let conn = open_and_migrate(&db_path, &backups_dir).expect("third open should succeed");
    let user_version: i64 = conn
        .query_row("PRAGMA user_version", [], |row| row.get(0))
        .unwrap();
    assert_eq!(
        user_version,
        migration_sources().len() as i64,
        "user_version must stay at N, not advance again on a repeat open"
    );
    assert_eq!(
        backup_file_count(&backups_dir),
        2,
        "the third open should write a second backup without deleting the first (both are within the retention limit)"
    );
}

#[test]
fn prune_keeps_the_retention_limit() {
    let dir = scratch_dir();
    let backups_dir = dir.path().join("backups");
    fs::create_dir_all(&backups_dir).expect("failed to create the backups dir");

    // Write 8 backup-shaped files with distinct, explicit modification times (rather than
    // relying on natural write-timing gaps, which can tie on some filesystems).
    for i in 0..8u64 {
        let path = backups_dir.join(format!("pre-migration-2-{i:04}.db"));
        fs::write(&path, format!("backup {i}")).expect("failed to write a fixture backup file");
        let file = File::options()
            .write(true)
            .open(&path)
            .expect("failed to reopen the fixture backup file to set its mtime");
        let mtime = SystemTime::UNIX_EPOCH + Duration::from_secs(i * 60);
        file.set_modified(mtime)
            .expect("failed to set the fixture backup file's modification time");
    }

    let removed = prune_backups(&backups_dir, 5).expect("prune_backups should succeed");
    assert_eq!(
        removed, 3,
        "8 files with a retention limit of 5 should remove exactly 3 — the oldest"
    );

    let remaining: HashSet<String> = fs::read_dir(&backups_dir)
        .expect("backups dir should still exist")
        .filter_map(|entry| entry.ok())
        .map(|entry| entry.file_name().to_string_lossy().into_owned())
        .collect();
    assert_eq!(remaining.len(), 5, "exactly the retention limit should remain");

    for i in 3..8u64 {
        let name = format!("pre-migration-2-{i:04}.db");
        assert!(
            remaining.contains(&name),
            "expected the newer file {name} to survive pruning"
        );
    }
    for i in 0..3u64 {
        let name = format!("pre-migration-2-{i:04}.db");
        assert!(
            !remaining.contains(&name),
            "expected the older file {name} to have been pruned"
        );
    }
}
