//! DATA-07 — proves the store survives a real process kill, not merely that the pragma choice
//! ought to survive one. This suite spawns `crash_harness` (`tests/bin/crash_harness.rs`) as a
//! real child process, reads its `READY` marker, kills it, and then reopens the database and
//! inspects what actually landed.
//!
//! What this tier proves, and what it deliberately does not (per this plan's Flagged
//! Assumptions and `01-RESEARCH.md`'s "Flag 3"): `journal_mode=WAL` + `synchronous=NORMAL`
//! (`apply_pragmas`, `packages/core/src/db/mod.rs`) makes a committed transaction durable across
//! the *process* being killed — a force-quit, a SIGKILL, a panic — which is the failure this
//! phase's success criterion names. It does NOT guarantee durability across a literal power cut
//! landing between a WAL frame write and its checkpoint; closing that gap would need
//! `synchronous=FULL`, at roughly twice the write-throughput cost, which this phase does not pay.

use std::io::{BufRead, BufReader};
use std::path::PathBuf;
use std::process::{Command, Stdio};

use flywheel_core::db::open_and_migrate;

fn scratch_dir() -> tempfile::TempDir {
    tempfile::tempdir().expect("failed to create scratch dir")
}

fn harness_path() -> PathBuf {
    PathBuf::from(env!("CARGO_BIN_EXE_crash_harness"))
}

/// Spawn `crash_harness` with `args`, block until it prints its `READY` marker, then kill it —
/// `Child::kill()` sends `SIGKILL` on Unix, not a cooperative shutdown signal — and wait for it
/// to actually die before returning. If the harness has already terminated itself (the
/// mid-transaction mode calls `std::process::abort()` right after printing `READY`), the kill
/// harmlessly races against an already-exited process; either way, nothing committed after the
/// `READY` marker.
fn spawn_and_kill(args: &[&str]) {
    let mut child = Command::new(harness_path())
        .args(args)
        .stdout(Stdio::piped())
        .stderr(Stdio::inherit())
        .spawn()
        .expect("failed to spawn crash_harness");

    let stdout = child.stdout.take().expect("child stdout should be piped");
    let mut reader = BufReader::new(stdout);
    let mut line = String::new();
    let n = reader
        .read_line(&mut line)
        .expect("failed to read the harness's stdout");
    assert!(
        n > 0 && line.trim() == "READY",
        "expected a READY marker from the harness, got {line:?}"
    );

    let _ = child.kill();

    let status = child
        .wait()
        .expect("failed to wait for the harness process to exit");
    assert!(
        !status.success(),
        "a killed harness process should not report a clean exit"
    );
}

fn milestone_count(conn: &rusqlite::Connection) -> i64 {
    conn.query_row("SELECT COUNT(*) FROM milestones", [], |row| row.get(0))
        .expect("failed to count Milestones")
}

fn created_event_count(conn: &rusqlite::Connection) -> i64 {
    conn.query_row(
        "SELECT COUNT(*) FROM events WHERE event_type = 'milestone.created'",
        [],
        |row| row.get(0),
    )
    .expect("failed to count milestone.created events")
}

fn integrity_check(conn: &rusqlite::Connection) -> String {
    conn.query_row("PRAGMA integrity_check", [], |row| row.get(0))
        .expect("failed to run PRAGMA integrity_check")
}

fn journal_mode(conn: &rusqlite::Connection) -> String {
    conn.query_row("PRAGMA journal_mode", [], |row| row.get(0))
        .expect("failed to read journal_mode")
}

#[test]
fn killing_after_commits_preserves_every_committed_milestone_and_event() {
    let dir = scratch_dir();
    let db_path = dir.path().join("flywheel.db");
    let backups_dir = dir.path().join("backups");

    spawn_and_kill(&[
        "--commit-then-hang",
        db_path.to_str().unwrap(),
        backups_dir.to_str().unwrap(),
        "5",
    ]);

    let conn =
        open_and_migrate(&db_path, &backups_dir).expect("reopening after the kill should succeed");

    assert_eq!(
        milestone_count(&conn),
        5,
        "every Milestone committed before the kill must still be present"
    );
    assert_eq!(
        created_event_count(&conn),
        5,
        "every milestone.created event committed before the kill must still be present"
    );
    assert_eq!(integrity_check(&conn), "ok");
    assert_eq!(journal_mode(&conn).to_lowercase(), "wal");
}

#[test]
fn killing_mid_transaction_leaves_neither_the_row_nor_its_event() {
    let dir = scratch_dir();
    let db_path = dir.path().join("flywheel.db");
    let backups_dir = dir.path().join("backups");

    spawn_and_kill(&[
        "--abort-mid-transaction",
        db_path.to_str().unwrap(),
        backups_dir.to_str().unwrap(),
    ]);

    let conn =
        open_and_migrate(&db_path, &backups_dir).expect("reopening after the kill should succeed");

    assert_eq!(
        milestone_count(&conn),
        0,
        "the mid-transaction Milestone row must not have been committed"
    );
    assert_eq!(
        created_event_count(&conn),
        0,
        "the mid-transaction event must not have been committed"
    );
    assert_eq!(integrity_check(&conn), "ok");
    assert_eq!(journal_mode(&conn).to_lowercase(), "wal");
}
