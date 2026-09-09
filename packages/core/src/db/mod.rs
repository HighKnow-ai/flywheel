//! The database entry point. RED stub — see 01-01-PLAN.md Task 3.
//! Deliberately wrong: `apply_pragmas` is a no-op and `open_and_migrate` never migrates, so the
//! RED-phase tests in `tests/db_bootstrap.rs` fail on their pragma/user_version assertions, not
//! on a missing symbol.

pub mod backup;

use rusqlite::Connection;
use std::path::Path;

pub fn apply_pragmas(_conn: &Connection) -> anyhow::Result<()> {
    Ok(())
}

pub fn open_and_migrate(db_path: &Path, _backups_dir: &Path) -> anyhow::Result<Connection> {
    let conn = Connection::open(db_path)?;
    Ok(conn)
}
