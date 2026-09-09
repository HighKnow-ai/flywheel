//! The database entry point: pragmas, backup-before-migrate, and the first migration.
//!
//! `packages/core` owns the SQLite connection exclusively (ARCHITECTURE.md Anti-Pattern 3,
//! D-03) — no other crate in this workspace opens the database file directly.

pub mod backup;

use anyhow::Context;
use once_cell::sync::Lazy;
use rusqlite::Connection;
use rusqlite_migration::{Migrations, M};
use std::path::{Path, PathBuf};

use self::backup::backup_database_file;

/// The compiled, ordered set of schema migrations. Later migrations append to this vector —
/// this is the *only* place a new migration file is registered.
static MIGRATIONS: Lazy<Migrations<'static>> = Lazy::new(|| {
    Migrations::new(vec![M::up(include_str!("migrations/0001_actors.sql"))])
});

/// Apply the four pragmas every connection needs.
///
/// `journal_mode` is the only one of these that persists in the database file itself; the other
/// three (`synchronous`, `busy_timeout`, `foreign_keys`) are connection-scoped and silently
/// revert to SQLite's defaults on every new `Connection::open` unless re-applied here
/// (01-RESEARCH.md Pitfall 1).
pub fn apply_pragmas(conn: &Connection) -> anyhow::Result<()> {
    conn.pragma_update(None, "journal_mode", "WAL")
        .context("failed to set journal_mode=WAL")?;
    conn.pragma_update(None, "synchronous", "NORMAL")
        .context("failed to set synchronous=NORMAL")?;
    conn.pragma_update(None, "busy_timeout", 5000i64)
        .context("failed to set busy_timeout=5000")?;
    conn.pragma_update(None, "foreign_keys", "ON")
        .context("failed to set foreign_keys=ON")?;
    Ok(())
}

/// Open the database at `db_path`, backing it up to `backups_dir` first (D-18), applying the
/// connection pragmas, and running every pending migration.
///
/// On a migration failure, the error is returned without leaving a half-migrated file silently
/// treated as ready — the caller (the Tauri `setup` hook) aborts startup rather than proceeding.
/// The pre-migration backup written by [`backup_database_file`] is the recovery path, not a
/// hand-written down-migration (D-18).
pub fn open_and_migrate(db_path: &Path, backups_dir: &Path) -> anyhow::Result<Connection> {
    backup_database_file(db_path, backups_dir)
        .with_context(|| format!("failed to back up {db_path:?} before migrating"))?;

    if let Some(parent) = db_path.parent() {
        std::fs::create_dir_all(parent)
            .with_context(|| format!("failed to create parent directory for {db_path:?}"))?;
    }

    let mut conn = Connection::open(db_path)
        .with_context(|| format!("failed to open database at {db_path:?}"))?;

    apply_pragmas(&conn).context("failed to apply pragmas after opening the database")?;

    MIGRATIONS
        .to_latest(&mut conn)
        .context("failed to run pending migrations")?;

    Ok(conn)
}

/// Resolve the one fleet-wide database file, under the OS app-data directory (D-14: one file
/// for every registered project, never one per repository).
///
/// Never reads or sets the process working directory (ARCHITECTURE.md Anti-Pattern 3) — the
/// path is derived entirely from the OS app-data API.
pub fn default_db_path() -> anyhow::Result<PathBuf> {
    Ok(app_data_dir()?.join("flywheel.db"))
}

/// Resolve the backups directory for the one fleet-wide database (D-18).
pub fn default_backups_dir() -> anyhow::Result<PathBuf> {
    Ok(app_data_dir()?.join("backups"))
}

fn app_data_dir() -> anyhow::Result<PathBuf> {
    let base = dirs::data_dir().context("could not resolve the OS app-data directory")?;
    Ok(base.join("Flywheel"))
}
