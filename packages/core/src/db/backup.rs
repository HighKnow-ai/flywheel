//! `backup_database_file` — copy-before-migrate (D-18). RED stub — see 01-01-PLAN.md Task 3.
//! Deliberately wrong: always reports no backup, so the RED-phase backup test fails on its
//! assertion (no backup file found), not on a missing symbol.

use std::path::{Path, PathBuf};

pub fn backup_database_file(
    _db_path: &Path,
    _backups_dir: &Path,
) -> anyhow::Result<Option<PathBuf>> {
    Ok(None)
}
