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

use self::backup::{backup_database_file, prune_backups, restore_from_backup, DEFAULT_BACKUP_RETENTION};

/// The migration SQL sources, in order. This is the *only* place a new migration file is
/// registered — [`MIGRATIONS`] is built from this list, and `tests/migration_safety.rs` (DATA-08)
/// reads it too, via [`migration_sources`], to build its "N-1" and "N-plus-one-bad-migration"
/// fixtures from the real sources rather than a hand-duplicated, driftable copy.
fn migration_source_list() -> Vec<&'static str> {
    vec![
        include_str!("migrations/0001_actors.sql"),
        include_str!("migrations/0002_board_schema.sql"),
        include_str!("migrations/0003_agent_runtime.sql"),
        include_str!("migrations/0004_permission_gate.sql"),
        include_str!("migrations/0005_credentials.sql"),
    ]
}

/// Public accessor for [`migration_source_list`] — the same ordered SQL sources [`MIGRATIONS`]
/// compiles from, exposed so integration tests can build their own `Migrations` values (a
/// deliberately truncated list, or the real list plus one malformed migration) without
/// re-declaring `include_str!` paths that could silently drift from the production list.
pub fn migration_sources() -> Vec<&'static str> {
    migration_source_list()
}

/// The compiled, ordered set of schema migrations. Later migrations append to
/// [`migration_source_list`] — this is the *only* place a new migration file is registered.
static MIGRATIONS: Lazy<Migrations<'static>> =
    Lazy::new(|| Migrations::new(migration_source_list().into_iter().map(M::up).collect()));

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
/// A failed migration is never auto-repaired, auto-deleted, or opened anyway: on a `to_latest`
/// error, the connection is dropped, the pre-migration backup [`backup_database_file`] wrote is
/// restored over the live file with [`restore_from_backup`], and the original migration error is
/// returned wrapped with that fact — the caller (the Tauri `setup` hook) aborts startup rather
/// than proceeding. This restore is the reversibility mechanism (D-18), not a hand-written
/// down-migration.
///
/// On a successful migration, old backups are pruned to [`DEFAULT_BACKUP_RETENTION`] (T-01-18)
/// and `PRAGMA integrity_check` is run before the connection is handed back — a migration that
/// "succeeded" but left a corrupt file is still an error here, not a silently-returned
/// `Connection`.
pub fn open_and_migrate(db_path: &Path, backups_dir: &Path) -> anyhow::Result<Connection> {
    let backup_path = backup_database_file(db_path, backups_dir)
        .with_context(|| format!("failed to back up {db_path:?} before migrating"))?;

    if let Some(parent) = db_path.parent() {
        std::fs::create_dir_all(parent)
            .with_context(|| format!("failed to create parent directory for {db_path:?}"))?;
    }

    let mut conn = Connection::open(db_path)
        .with_context(|| format!("failed to open database at {db_path:?}"))?;

    apply_pragmas(&conn).context("failed to apply pragmas after opening the database")?;

    if let Err(migration_err) = MIGRATIONS.to_latest(&mut conn) {
        // Drop the connection before touching the file on disk — SQLite (and the OS, on
        // Windows in particular) will not let another process overwrite a file that is still
        // held open.
        drop(conn);

        let Some(backup_path) = backup_path else {
            return Err(anyhow::Error::from(migration_err).context(format!(
                "failed to run pending migrations against {db_path:?}; no pre-migration backup \
                 existed to restore (this was a brand-new database)"
            )));
        };

        restore_from_backup(db_path, &backup_path).with_context(|| {
            format!(
                "migration failed AND restoring {db_path:?} from backup {backup_path:?} also \
                 failed — the live file may be in an inconsistent state"
            )
        })?;

        return Err(anyhow::Error::from(migration_err).context(format!(
            "failed to run pending migrations against {db_path:?}; restored the pre-migration \
             backup at {backup_path:?} and refused to open"
        )));
    }

    prune_backups(backups_dir, DEFAULT_BACKUP_RETENTION)
        .context("failed to prune old backups after a successful migration")?;

    let integrity_result: String = conn
        .query_row("PRAGMA integrity_check", [], |row| row.get(0))
        .context("failed to run PRAGMA integrity_check after migrating")?;
    if integrity_result != "ok" {
        anyhow::bail!(
            "PRAGMA integrity_check reported {integrity_result:?} for {db_path:?} after \
             migrating, expected \"ok\""
        );
    }

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
