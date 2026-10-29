//! ADR 0003: a v0.1 database cannot be upgraded. On first launch of a build with the MVP baseline,
//! `open_and_migrate` moves the old-schema file aside (renamed with a timestamp, never deleted and
//! never migrated) and starts an empty database in its place.
//!
//! The v0.1 fixture is built from a hand-written slice of the v0.1 schema rather than the old
//! migrations, which no longer exist in this tree: what makes a file "v0.1" is that it holds tables
//! and has no `stories` table, at any `user_version`.

use std::path::{Path, PathBuf};

use flywheel_core::db::{open_and_migrate, LEGACY_SUFFIX};
use rusqlite::Connection;

/// A database shaped like v0.1 at its last migration: `tasks` with a five-state status, `issues`,
/// `cycles`, and `user_version` 24. One task row, so the moved file can be shown to keep its data.
fn write_v01_database(db_path: &Path) {
    let conn = Connection::open(db_path).expect("open the v0.1 fixture");
    conn.pragma_update(None, "journal_mode", "WAL")
        .expect("v0.1 ran in WAL mode");
    conn.execute_batch(
        "CREATE TABLE actors (id TEXT PRIMARY KEY, type TEXT NOT NULL, display_name TEXT NOT NULL, created_at TEXT NOT NULL);
         CREATE TABLE projects (id TEXT PRIMARY KEY, key_prefix TEXT NOT NULL, name TEXT NOT NULL);
         CREATE TABLE tasks (id TEXT PRIMARY KEY, project_id TEXT NOT NULL, key TEXT NOT NULL, title TEXT NOT NULL,
             status TEXT NOT NULL CHECK (status IN ('backlog', 'todo', 'in_progress', 'in_review', 'done')));
         CREATE TABLE issues (id TEXT PRIMARY KEY, project_id TEXT NOT NULL, title TEXT NOT NULL);
         CREATE TABLE cycles (id TEXT PRIMARY KEY, project_id TEXT NOT NULL, goal TEXT NOT NULL);
         INSERT INTO projects VALUES ('P1', 'FLY', 'Threadfin');
         INSERT INTO tasks VALUES ('T1', 'P1', 'FLY-1', 'A v0.1 task', 'todo');
         PRAGMA user_version = 24;",
    )
    .expect("build the v0.1 fixture");
}

fn scratch() -> (tempfile::TempDir, PathBuf, PathBuf) {
    let dir = tempfile::tempdir().expect("scratch dir");
    let db_path = dir.path().join("flywheel.db");
    let backups = dir.path().join("backups");
    (dir, db_path, backups)
}

/// Every file in `dir` whose name carries the legacy suffix.
fn moved_aside(dir: &Path) -> Vec<PathBuf> {
    let mut found: Vec<PathBuf> = std::fs::read_dir(dir)
        .expect("read scratch dir")
        .filter_map(|e| e.ok().map(|e| e.path()))
        .filter(|p| {
            p.file_name()
                .and_then(|n| n.to_str())
                .is_some_and(|n| n.contains(LEGACY_SUFFIX))
        })
        .collect();
    found.sort();
    found
}

fn table_names(conn: &Connection) -> Vec<String> {
    conn.prepare("SELECT name FROM sqlite_master WHERE type = 'table' ORDER BY name")
        .unwrap()
        .query_map([], |r| r.get(0))
        .unwrap()
        .collect::<Result<_, _>>()
        .unwrap()
}

fn count(conn: &Connection, sql: &str) -> i64 {
    conn.query_row(sql, [], |r| r.get(0)).unwrap()
}

#[test]
fn a_v01_database_is_moved_aside_and_the_app_starts_with_an_empty_board() {
    let (dir, db_path, backups) = scratch();
    write_v01_database(&db_path);

    let conn =
        open_and_migrate(&db_path, &backups).expect("a v0.1 database must not stop the launch");

    let tables = table_names(&conn);
    assert!(
        tables.contains(&"stories".to_string()),
        "the live file holds the baseline: {tables:?}"
    );
    for gone in ["issues", "cycles"] {
        assert!(
            !tables.contains(&gone.to_string()),
            "the live file must not keep v0.1's {gone}: {tables:?}"
        );
    }
    assert_eq!(
        count(&conn, "SELECT COUNT(*) FROM projects"),
        0,
        "no v0.1 project survives"
    );
    for table in [
        "milestones",
        "epics",
        "stories",
        "tasks",
        "acceptance_criteria",
        "proposals",
        "events",
    ] {
        assert_eq!(
            count(&conn, &format!("SELECT COUNT(*) FROM {table}")),
            0,
            "{table} starts empty"
        );
    }

    let moved = moved_aside(dir.path());
    let main_files: Vec<&PathBuf> = moved
        .iter()
        .filter(|p| p.extension().is_some_and(|e| e == "db"))
        .collect();
    assert_eq!(
        main_files.len(),
        1,
        "exactly one moved-aside database: {moved:?}"
    );
    let name = main_files[0]
        .file_name()
        .unwrap()
        .to_string_lossy()
        .to_string();
    assert!(
        name.starts_with("flywheel"),
        "the moved file keeps the database's name: {name}"
    );
    assert!(
        name.chars().filter(char::is_ascii_digit).count() >= 14,
        "the moved file carries a timestamp: {name}"
    );

    let old = Connection::open(main_files[0]).expect("the moved file is still a database");
    assert_eq!(
        old.query_row("SELECT title FROM tasks WHERE id = 'T1'", [], |r| r
            .get::<_, String>(0))
            .unwrap(),
        "A v0.1 task",
        "the moved file is the v0.1 data, untouched"
    );
    assert_eq!(
        old.query_row("PRAGMA user_version", [], |r| r.get::<_, i64>(0))
            .unwrap(),
        24
    );
}

#[test]
fn the_v01_write_ahead_log_travels_with_its_database() {
    let (dir, db_path, backups) = scratch();
    write_v01_database(&db_path);

    drop(open_and_migrate(&db_path, &backups).expect("launch"));

    let live_wal = dir.path().join("flywheel.db-wal");
    if live_wal.exists() {
        // The live WAL, if any, now belongs to the baseline database: it must not hold v0.1 pages.
        let conn = Connection::open(&db_path).unwrap();
        assert!(table_names(&conn).contains(&"stories".to_string()));
    }
    let moved = moved_aside(dir.path());
    let main = moved
        .iter()
        .find(|p| p.extension().is_some_and(|e| e == "db"))
        .expect("moved database");
    let old = Connection::open(main).unwrap();
    assert_eq!(
        count(&old, "SELECT COUNT(*) FROM tasks"),
        1,
        "no v0.1 write was lost in a WAL left behind"
    );
}

#[test]
fn a_baseline_database_is_never_moved_aside() {
    let (dir, db_path, backups) = scratch();
    drop(open_and_migrate(&db_path, &backups).expect("first launch"));
    drop(open_and_migrate(&db_path, &backups).expect("second launch"));
    assert!(
        moved_aside(dir.path()).is_empty(),
        "a database already on the baseline stays where it is"
    );
}

#[test]
fn a_fresh_path_creates_the_baseline_and_moves_nothing() {
    let (dir, db_path, backups) = scratch();
    let conn = open_and_migrate(&db_path, &backups).expect("fresh launch");
    assert!(table_names(&conn).contains(&"stories".to_string()));
    assert!(moved_aside(dir.path()).is_empty());
}

#[test]
fn a_second_launch_after_the_move_does_not_move_again() {
    let (dir, db_path, backups) = scratch();
    write_v01_database(&db_path);
    drop(open_and_migrate(&db_path, &backups).expect("first launch moves v0.1 aside"));
    drop(open_and_migrate(&db_path, &backups).expect("second launch"));
    let moved = moved_aside(dir.path());
    assert_eq!(
        moved
            .iter()
            .filter(|p| p.extension().is_some_and(|e| e == "db"))
            .count(),
        1,
        "{moved:?}"
    );
}
