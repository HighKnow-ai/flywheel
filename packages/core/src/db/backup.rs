//! `backup_database_file` — copy-before-migrate (D-18).
//!
//! Migration safety in this project is backup-first, not down-migrations (D-18): copy the
//! database file before every migration run, migrate inside a transaction, and on failure the
//! caller restores from the backup rather than trusting a hand-written down-migration. The
//! restore is the reversibility mechanism.

use anyhow::Context;
use rusqlite::Connection;
use std::fs;
use std::path::{Path, PathBuf};
use std::time::{SystemTime, UNIX_EPOCH};

/// Copy `db_path` to `backups_dir/pre-migration-{user_version}-{unix_millis}.db` before any DDL
/// runs against it.
///
/// Returns `Ok(None)` when `db_path` does not exist yet (a brand-new database has nothing to
/// back up, and no `backups_dir` is created in that case). Otherwise returns the path of the
/// newly written backup file.
pub fn backup_database_file(
    db_path: &Path,
    backups_dir: &Path,
) -> anyhow::Result<Option<PathBuf>> {
    if !db_path.exists() {
        return Ok(None);
    }

    fs::create_dir_all(backups_dir)
        .with_context(|| format!("failed to create backups dir {backups_dir:?}"))?;

    let user_version = read_user_version(db_path)
        .with_context(|| format!("failed to read user_version from {db_path:?}"))?;

    let unix_millis = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap_or_default()
        .as_millis();

    let backup_path =
        backups_dir.join(format!("pre-migration-{user_version}-{unix_millis}.db"));

    fs::copy(db_path, &backup_path).with_context(|| {
        format!("failed to copy {db_path:?} to {backup_path:?} before migrating")
    })?;

    Ok(Some(backup_path))
}

fn read_user_version(db_path: &Path) -> anyhow::Result<i64> {
    let conn = Connection::open(db_path)?;
    let user_version: i64 = conn.query_row("PRAGMA user_version", [], |row| row.get(0))?;
    Ok(user_version)
}
