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

/// The default number of `pre-migration-*.db` backups [`prune_backups`] retains. `open_and_migrate`
/// uses this constant on every successful migration — a caller that needs a different retention
/// window (e.g. a test) calls `prune_backups` directly with an explicit `keep`.
pub const DEFAULT_BACKUP_RETENTION: usize = 5;

/// Restore `db_path` by copying `backup_path` over it.
///
/// This is the *only* recovery path a failed migration has (D-18) — there are no hand-written
/// down-migrations. `open_and_migrate` calls this exclusively with a path it itself just got back
/// from [`backup_database_file`] in the same call, never a caller-supplied or user-supplied
/// filename (T-01-17) — restoring from an attacker- or bug-controlled path would defeat the whole
/// point of the guarantee.
pub fn restore_from_backup(db_path: &Path, backup_path: &Path) -> anyhow::Result<()> {
    fs::copy(backup_path, db_path)
        .with_context(|| format!("failed to restore {db_path:?} from backup {backup_path:?}"))?;
    Ok(())
}

/// Delete all but the `keep` most recent `pre-migration-*.db` files in `backups_dir`, oldest
/// first by modification time. Returns the number of files removed.
///
/// A missing `backups_dir` (nothing has ever been backed up) is not an error — it simply has
/// nothing to prune. Only files matching the `pre-migration-*.db` naming convention this module
/// writes are ever considered; anything else in `backups_dir` is left untouched (T-01-18).
pub fn prune_backups(backups_dir: &Path, keep: usize) -> anyhow::Result<usize> {
    if !backups_dir.exists() {
        return Ok(0);
    }

    let mut candidates: Vec<(PathBuf, SystemTime)> = fs::read_dir(backups_dir)
        .with_context(|| format!("failed to read backups dir {backups_dir:?}"))?
        .filter_map(|entry| entry.ok())
        .filter(|entry| {
            entry
                .file_name()
                .to_str()
                .is_some_and(|name| name.starts_with("pre-migration-") && name.ends_with(".db"))
        })
        .filter_map(|entry| {
            let modified = entry.metadata().ok()?.modified().ok()?;
            Some((entry.path(), modified))
        })
        .collect();

    if candidates.len() <= keep {
        return Ok(0);
    }

    // Newest first, so `.skip(keep)` leaves the `keep` most recent files behind and removes the
    // rest — the oldest.
    candidates.sort_by_key(|(_, modified)| std::cmp::Reverse(*modified));

    let mut removed = 0usize;
    for (path, _modified) in candidates.into_iter().skip(keep) {
        fs::remove_file(&path).with_context(|| format!("failed to remove old backup {path:?}"))?;
        removed += 1;
    }

    Ok(removed)
}
