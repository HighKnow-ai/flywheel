//! The database entry point: pragmas, backup-before-migrate, and the first migration.
//!
//! `packages/core` owns the SQLite connection exclusively (ARCHITECTURE.md Anti-Pattern 3,
//! D-03) — no other crate in this workspace opens the database file directly.

pub mod backup;

use anyhow::Context;
use once_cell::sync::Lazy;
use rusqlite::{Connection, OptionalExtension};
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
        include_str!("migrations/0006_recovery_statuses.sql"),
        include_str!("migrations/0007_destructive_gate.sql"),
        include_str!("migrations/0008_session_summaries.sql"),
        include_str!("migrations/0009_criteria_revisions.sql"),
        include_str!("migrations/0010_authoring_runs.sql"),
        include_str!("migrations/0011_authoring_staging.sql"),
        include_str!("migrations/0012_authoring_proposals_project_status_index.sql"),
        include_str!("migrations/0013_authoring_summaries.sql"),
        include_str!("migrations/0014_permission_requests_authoring.sql"),
        include_str!("migrations/0015_proposal_triage_extension.sql"),
        include_str!("migrations/0016_authoring_proposals_fts.sql"),
        include_str!("migrations/0017_forge_setting.sql"),
        include_str!("migrations/0018_criterion_anchors.sql"),
        include_str!("migrations/0019_fan_out.sql"),
        include_str!("migrations/0020_fleet.sql"),
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

    // Migration `0006_recovery_statuses.sql` rebuilds `worktrees` and `agent_runs` (SQLite
    // cannot ALTER a CHECK constraint in place), and both are the parent side of a real foreign
    // key that a sibling table declares against them (`agent_runs.worktree_id` -> `worktrees.id`,
    // `permission_requests.agent_run_id` -> `agent_runs.id`). `DROP TABLE` on a table that is the
    // parent of an existing foreign key with matching child rows fails under
    // `PRAGMA foreign_keys = ON` — verified directly against a real `sqlite3` binary while writing
    // this migration. Toggling the pragma from INSIDE a migration's own SQL is a documented
    // no-op (`rusqlite_migration` runs every migration body inside its own transaction, and
    // SQLite ignores `PRAGMA foreign_keys` once a transaction is already open), so it is toggled
    // here instead, at the connection level, around the whole `to_latest()` call — exactly as
    // `rusqlite_migration`'s own `foreign_key_check()` documentation recommends for a migration
    // that rebuilds a referenced table.
    conn.pragma_update(None, "foreign_keys", "OFF")
        .context("failed to disable foreign_keys before migrating")?;

    // A successful `to_latest()` is not yet trusted: re-enable enforcement and run
    // `PRAGMA foreign_key_check` before deciding the migration truly succeeded. A rebuild that
    // silently dropped or misdirected a foreign key must be treated exactly like a `to_latest`
    // failure — routed through the SAME restore-and-refuse path below (D-18) — never surfaced as
    // a late, un-recovered error after the connection has already been handed back.
    let migration_result: anyhow::Result<()> = MIGRATIONS
        .to_latest(&mut conn)
        .map_err(anyhow::Error::from)
        .and_then(|()| {
            conn.pragma_update(None, "foreign_keys", "ON")
                .context("failed to re-enable foreign_keys after migrating")?;
            let fk_violation: Option<String> = conn
                .query_row("SELECT * FROM pragma_foreign_key_check LIMIT 1", [], |row| row.get(0))
                .optional()
                .context("failed to run foreign_key_check after migrating")?;
            if let Some(table) = fk_violation {
                anyhow::bail!(
                    "PRAGMA foreign_key_check reported a violation involving {table:?} for \
                     {db_path:?} after migrating — a table rebuild left a dangling foreign key"
                );
            }
            Ok(())
        });

    if let Err(migration_err) = migration_result {
        // Drop the connection before touching the file on disk — SQLite (and the OS, on
        // Windows in particular) will not let another process overwrite a file that is still
        // held open.
        drop(conn);

        let Some(backup_path) = backup_path else {
            return Err(migration_err.context(format!(
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

        return Err(migration_err.context(format!(
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

/// Resolve `<app-data>/Flywheel/` — the one directory holding the fleet-wide database, its
/// backups, `runtime/` and `sessions/`. Overridable via `FLYWHEEL_APP_DATA_DIR`, mirroring
/// `runtime_protocol::runtime_dir`'s own `FLYWHEEL_RUNTIME_DIR` pattern exactly: a test-only
/// override that is ALSO a production seam, because it is what lets a harness drive the REAL
/// application — the same binary, the same migrations, the same store of record — against a
/// scratch directory instead of the developer's own data.
///
/// Without this seam the only way to isolate a harness run would be to override `HOME`, which
/// would also move `~/.claude` out from under the agent binary a session spawns and so break the
/// very credential resolution those sessions depend on. Overriding this one directory moves
/// Flywheel's own state and nothing else.
///
/// Never reads or sets the process working directory (ARCHITECTURE.md Anti-Pattern 3): an empty
/// override is ignored rather than resolving to a relative path, so a caller that exports the
/// variable unset can never silently write the fleet database into whatever directory it happens
/// to be standing in. WR-02 (03-REVIEW.md): a non-empty override that is NOT absolute is rejected
/// with a named error rather than silently resolving against the process's current directory —
/// the same shape `packages/shim/src/main.rs::resolve_real_binary_from_env` already uses for
/// `FLYWHEEL_REAL_GIT`/`FLYWHEEL_REAL_RM`. The empty-override and no-override branches are
/// unchanged: an empty value is still ignored, and the OS app-data directory is still the
/// fallback.
fn app_data_dir() -> anyhow::Result<PathBuf> {
    if let Some(over) = std::env::var_os("FLYWHEEL_APP_DATA_DIR") {
        if !over.is_empty() {
            let path = PathBuf::from(&over);
            anyhow::ensure!(
                path.is_absolute(),
                "FLYWHEEL_APP_DATA_DIR does not name an absolute path: {path:?}"
            );
            return Ok(path);
        }
    }
    let base = dirs::data_dir().context("could not resolve the OS app-data directory")?;
    Ok(base.join("Flywheel"))
}
