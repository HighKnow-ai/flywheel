//! F7 — an older build cannot open a newer database, and that refusal is tested.
//!
//! A build that has rolled back meets a database whose `user_version` is ahead of its compiled
//! migration set. The only honest behaviour is to refuse: no down-migration exists, and "repairing"
//! a newer schema in place would destroy the newer build's data. Reversibility for a schema change
//! is restoring the pre-migration backup (D-18), never undoing the change.
//!
//! The fixture is built the way `migration_safety.rs` builds its N-1 database: in code, every run,
//! from `core::db::migration_sources()`, so it cannot drift from the real schema.

use std::fs;
use std::path::Path;

use core::db::{migration_sources, open_and_migrate};
use rusqlite::Connection;

/// A migrated scratch database, closed, whose `user_version` has been set ahead of this build's
/// migration count — the state an older build sees after a newer build has run.
struct AheadFixture {
    _dir: tempfile::TempDir,
    db_path: std::path::PathBuf,
    backups_dir: std::path::PathBuf,
    supported: i64,
}

fn set_user_version(db_path: &Path, version: i64) {
    let conn = Connection::open(db_path).expect("open for user_version");
    conn.pragma_update(None, "user_version", version).expect("set user_version");
}

fn ahead_fixture() -> AheadFixture {
    let dir = tempfile::tempdir().expect("scratch dir");
    let db_path = dir.path().join("flywheel.db");
    let backups_dir = dir.path().join("backups");
    let supported = migration_sources().len() as i64;

    drop(open_and_migrate(&db_path, &backups_dir).expect("the real migration set applies cleanly"));
    set_user_version(&db_path, supported + 1);

    AheadFixture { _dir: dir, db_path, backups_dir, supported }
}

#[test]
fn a_database_ahead_of_this_build_is_refused_with_the_mismatch_named() {
    let f = ahead_fixture();

    let err = match open_and_migrate(&f.db_path, &f.backups_dir) {
        Ok(_) => panic!("a database whose user_version is ahead of this build must not open"),
        Err(e) => e,
    };
    let chain = format!("{err:#}");

    assert!(!chain.is_empty());
    assert!(
        chain.contains(&format!("schema version {}", f.supported)),
        "the error must name the version this build supports ({}): {chain}",
        f.supported
    );
    assert!(
        chain.contains(&format!("at version {}", f.supported + 1)),
        "the error must name the version the database is at ({}): {chain}",
        f.supported + 1
    );
    assert!(
        chain.contains("install the newer build, or restore a backup"),
        "the error must name the recovery action: {chain}"
    );
}

#[test]
fn the_refused_database_is_left_byte_for_byte_intact() {
    let f = ahead_fixture();
    let before = fs::read(&f.db_path).expect("read db before");

    assert!(open_and_migrate(&f.db_path, &f.backups_dir).is_err());

    assert!(f.db_path.exists(), "a refused open must not delete the database file");
    let after = fs::read(&f.db_path).expect("read db after");
    assert_eq!(before.len(), after.len(), "a refused open must not truncate or grow the file");
    assert!(before == after, "a refused open must not rewrite, repair or downgrade any byte");

    // The recovery action names the backups directory, so it must actually hold a backup.
    let backups = fs::read_dir(&f.backups_dir).expect("backups dir exists").count();
    assert!(backups >= 1, "the pre-migration backup the error points at must exist");
}

#[test]
fn the_same_database_opens_once_its_version_is_back_in_range() {
    let f = ahead_fixture();
    assert!(open_and_migrate(&f.db_path, &f.backups_dir).is_err());

    // The refusal was about the version, not corruption: put the real count back and it opens.
    set_user_version(&f.db_path, f.supported);
    let conn = open_and_migrate(&f.db_path, &f.backups_dir)
        .expect("a database at this build's own version opens");

    let version: i64 = conn.query_row("PRAGMA user_version", [], |r| r.get(0)).expect("user_version");
    assert_eq!(version, f.supported);
    let epics: i64 = conn.query_row("SELECT count(*) FROM epics", [], |r| r.get(0)).expect("epics table");
    assert_eq!(epics, 0);
}
