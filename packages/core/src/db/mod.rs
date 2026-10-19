//! The database entry point: pragmas, backup-before-migrate, and the first migration.
//!
//! `packages/core` owns the SQLite connection exclusively (ARCHITECTURE.md Anti-Pattern 3,
//! D-03) — no other crate in this workspace opens the database file directly.

pub mod backup;

use anyhow::Context;
use once_cell::sync::Lazy;
use rusqlite::{Connection, OpenFlags, OptionalExtension};
use rusqlite_migration::{
    Error as MigrationError, MigrationDefinitionError, Migrations, SchemaVersion, M,
};
use std::path::{Path, PathBuf};

use self::backup::{backup_database_file, prune_backups, restore_from_backup, DEFAULT_BACKUP_RETENTION};

/// The migration SQL sources, in order. This is the *only* place a new migration file is
/// registered — [`MIGRATIONS`] is built from this list, and `tests/migration_safety.rs` (DATA-08)
/// reads it too, via [`migration_sources`], to build its "N-1" and "N-plus-one-bad-migration"
/// fixtures from the real sources rather than a hand-duplicated, driftable copy.
///
/// The list starts at the MVP baseline (ADR 0003): v0.1's migrations 0001–0024 were replaced by it,
/// and a v0.1 database is moved aside by [`move_aside_legacy_database`] rather than upgraded.
fn migration_source_list() -> Vec<&'static str> {
    vec![include_str!("migrations/0001_baseline.sql")]
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
/// A migration that may have half-run is never auto-repaired, auto-deleted, or opened anyway: on a
/// `to_latest` error, the connection is dropped, the pre-migration backup [`backup_database_file`]
/// wrote is restored over the live file with [`restore_from_backup`], and the original migration
/// error is returned wrapped with that fact — the caller (the Tauri `setup` hook) aborts startup
/// rather than proceeding. This restore is the reversibility mechanism (D-18), not a hand-written
/// down-migration.
///
/// An older build cannot open a newer database at all (its `user_version` is ahead of the compiled
/// migration set, and no down-migration exists to walk it back). That refusal is decided BEFORE any
/// filesystem write — no backup, no restore, no `fs::copy` over the live file (WR-01) — because no
/// SQL has run, so nothing can have half-run, and a newer build may be holding the file open under
/// a live WAL connection. Reversibility for a schema change means restoring the pre-migration
/// backup the newer build wrote before it migrated, never undoing the change in place. Tested by
/// `tests/migration_schema_too_far_ahead.rs`.
///
/// On a successful migration, old backups are pruned to [`DEFAULT_BACKUP_RETENTION`] (T-01-18)
/// and `PRAGMA integrity_check` is run before the connection is handed back — a migration that
/// "succeeded" but left a corrupt file is still an error here, not a silently-returned
/// `Connection`.
pub fn open_and_migrate(db_path: &Path, backups_dir: &Path) -> anyhow::Result<Connection> {
    open_and_migrate_with(db_path, backups_dir, &MIGRATIONS)
}

/// The sentence that makes `rusqlite_migration`'s bare "migration number that is too high" usable
/// (F7): the two numbers and the one recovery action. `None` for every other migration failure.
fn schema_ahead_context(
    migrations: &Migrations<'_>,
    err: &anyhow::Error,
    db_user_version: i64,
    backups_dir: &Path,
) -> Option<String> {
    match err.downcast_ref::<MigrationError>() {
        Some(MigrationError::MigrationDefinition(MigrationDefinitionError::DatabaseTooFarAhead)) => {}
        _ => return None,
    }
    schema_ahead_message(migrations, db_user_version, backups_dir)
}

/// The supported version is measured by applying `migrations` to a throwaway in-memory database,
/// because [`Migrations`] exposes no length; that only runs on a refusal path.
fn schema_ahead_message(
    migrations: &Migrations<'_>,
    db_user_version: i64,
    backups_dir: &Path,
) -> Option<String> {
    let mut probe = Connection::open_in_memory().ok()?;
    migrations.to_latest(&mut probe).ok()?;
    let supported: i64 = probe.query_row("PRAGMA user_version", [], |row| row.get(0)).ok()?;
    Some(format!(
        "this build supports database schema version {supported} but the database is at version \
         {db_user_version}, written by a newer build; install the newer build, or restore a \
         backup from {backups_dir:?}"
    ))
}

/// Refuse a database whose `user_version` is ahead of `migrations`, touching nothing (WR-01).
///
/// Uses a READ-ONLY connection and [`Migrations::current_version`], so the comparison runs against
/// the same migration set `to_latest` will use and cannot disagree with it. This deliberately does
/// not try to detect whether another process holds the file: the hazard (writing under a newer
/// build's live WAL connection) is removed by not writing at all, so there is nothing to detect.
fn refuse_if_schema_ahead(
    db_path: &Path,
    backups_dir: &Path,
    migrations: &Migrations<'_>,
) -> anyhow::Result<()> {
    if !db_path.exists() {
        return Ok(());
    }
    let conn = Connection::open_with_flags(db_path, OpenFlags::SQLITE_OPEN_READ_ONLY)
        .with_context(|| format!("failed to open {db_path:?} read-only to check its schema version"))?;
    if let SchemaVersion::Outside(on_disk) =
        migrations.current_version(&conn).context("failed to read the database schema version")?
    {
        let on_disk = on_disk.get() as i64;
        let msg = schema_ahead_message(migrations, on_disk, backups_dir)
            .unwrap_or_else(|| format!("the database is at schema version {on_disk}, ahead of this build"));
        return Err(anyhow::Error::from(MigrationError::MigrationDefinition(
            MigrationDefinitionError::DatabaseTooFarAhead,
        ))
        .context(msg)
        .context(format!("refused to open {db_path:?}: nothing was backed up, restored or modified")));
    }
    Ok(())
}

/// The marker a moved-aside v0.1 database carries in its file name: `flywheel.db` becomes
/// `flywheel.v0.1-20261017T101500Z.db` beside it.
pub const LEGACY_SUFFIX: &str = ".v0.1-";

/// ADR 0003's one-way door: if `db_path` holds a v0.1 database, rename it (and its `-wal`/`-shm`
/// files) aside with a timestamp and return where it went, so the caller creates an empty baseline
/// in its place. The file is never migrated, rewritten or deleted.
///
/// A file is v0.1 when it holds at least one table and no `stories` table: every v0.1 schema, at
/// any of its 24 versions, lacks it, and the baseline creates it in its first migration. A missing
/// file, an empty file, and a baseline database at any version are left where they are, so a
/// database written by a newer build still reaches the too-far-ahead refusal below untouched.
pub fn move_aside_legacy_database(db_path: &Path) -> anyhow::Result<Option<PathBuf>> {
    if !db_path.exists() {
        return Ok(None);
    }
    let is_legacy = {
        let conn = Connection::open_with_flags(db_path, OpenFlags::SQLITE_OPEN_READ_ONLY)
            .with_context(|| format!("failed to open {db_path:?} read-only to check its schema"))?;
        let (tables, has_stories): (i64, bool) = conn
            .query_row(
                "SELECT COUNT(*), COALESCE(SUM(name = 'stories'), 0) > 0 FROM sqlite_master
                 WHERE type = 'table' AND name NOT LIKE 'sqlite_%'",
                [],
                |row| Ok((row.get(0)?, row.get(1)?)),
            )
            .with_context(|| format!("failed to read the schema of {db_path:?}"))?;
        tables > 0 && !has_stories
    };
    if !is_legacy {
        return Ok(None);
    }

    // Fold any write-ahead log into the main file first, so the moved file is complete on its own
    // and no v0.1 page is left in a `-wal` the new database would then inherit.
    {
        let conn = Connection::open(db_path).with_context(|| format!("failed to open {db_path:?} to checkpoint it"))?;
        conn.query_row("PRAGMA wal_checkpoint(TRUNCATE)", [], |_| Ok(()))
            .with_context(|| format!("failed to checkpoint {db_path:?} before moving it aside"))?;
    }

    let target = legacy_target(db_path);
    std::fs::rename(db_path, &target).with_context(|| format!("failed to move {db_path:?} aside to {target:?}"))?;
    for suffix in ["-wal", "-shm"] {
        let side = sibling_with_suffix(db_path, suffix);
        if side.exists() {
            let side_target = sibling_with_suffix(&target, suffix);
            std::fs::rename(&side, &side_target)
                .with_context(|| format!("failed to move {side:?} aside to {side_target:?}"))?;
        }
    }
    Ok(Some(target))
}

/// `<dir>/<stem>.v0.1-<UTC timestamp>.<ext>` beside `db_path`, made unique with the milliseconds
/// when a second move lands in the same second.
fn legacy_target(db_path: &Path) -> PathBuf {
    let stem = db_path.file_stem().map(|s| s.to_string_lossy().into_owned()).unwrap_or_else(|| "flywheel".into());
    let ext = db_path.extension().map(|e| e.to_string_lossy().into_owned()).unwrap_or_else(|| "db".into());
    let now = chrono::Utc::now();
    let candidate = db_path.with_file_name(format!("{stem}{LEGACY_SUFFIX}{}.{ext}", now.format("%Y%m%dT%H%M%SZ")));
    if !candidate.exists() {
        return candidate;
    }
    db_path.with_file_name(format!("{stem}{LEGACY_SUFFIX}{}.{ext}", now.format("%Y%m%dT%H%M%S%.3fZ")))
}

/// `path` with `suffix` appended to its file name (`flywheel.db` + `-wal`).
fn sibling_with_suffix(path: &Path, suffix: &str) -> PathBuf {
    let mut name = path.file_name().map(|n| n.to_os_string()).unwrap_or_default();
    name.push(suffix);
    path.with_file_name(name)
}

/// [`open_and_migrate`] against an explicit migration set. The product always passes the full
/// [`MIGRATIONS`]; a maintenance tool that must leave a database at the schema an installed older
/// build still understands passes a truncated set built from [`migration_sources`] (plan 11-21,
/// `file_board_items`). Everything else — the pre-migration backup, the restore on failure, the
/// foreign-key check, the integrity check — is the same code path.
pub fn open_and_migrate_with(
    db_path: &Path,
    backups_dir: &Path,
    migrations: &Migrations<'_>,
) -> anyhow::Result<Connection> {
    // ADR 0003: a v0.1 database is moved aside before anything else reads its version, because
    // its `user_version` (up to 24) is "ahead" of the baseline and would otherwise be refused.
    if let Some(moved_to) = move_aside_legacy_database(db_path)? {
        eprintln!("moved a v0.1 database aside to {moved_to:?}; starting with an empty board");
    }

    // Decided before every filesystem write (WR-01): see `refuse_if_schema_ahead`.
    refuse_if_schema_ahead(db_path, backups_dir, migrations)?;

    let backup_path = backup_database_file(db_path, backups_dir)
        .with_context(|| format!("failed to back up {db_path:?} before migrating"))?;

    if let Some(parent) = db_path.parent() {
        std::fs::create_dir_all(parent)
            .with_context(|| format!("failed to create parent directory for {db_path:?}"))?;
    }

    let mut conn = Connection::open(db_path)
        .with_context(|| format!("failed to open database at {db_path:?}"))?;

    apply_pragmas(&conn).context("failed to apply pragmas after opening the database")?;

    // A future migration that rebuilds a table (SQLite cannot ALTER a CHECK constraint in place)
    // must `DROP TABLE` a table that is the parent side of a real foreign key (`sessions.worktree_id`
    // -> `worktrees.id`, for example), which fails under `PRAGMA foreign_keys = ON` when child rows
    // exist. Toggling the pragma from INSIDE a migration's own SQL is a documented no-op
    // (`rusqlite_migration` runs every migration body inside its own transaction, and SQLite
    // ignores `PRAGMA foreign_keys` once a transaction is already open), so it is toggled here
    // instead, at the connection level, around the whole `to_latest()` call — exactly as
    // `rusqlite_migration`'s own `foreign_key_check()` documentation recommends.
    conn.pragma_update(None, "foreign_keys", "OFF")
        .context("failed to disable foreign_keys before migrating")?;

    // A successful `to_latest()` is not yet trusted: re-enable enforcement and run
    // `PRAGMA foreign_key_check` before deciding the migration truly succeeded. A rebuild that
    // silently dropped or misdirected a foreign key must be treated exactly like a `to_latest`
    // failure — routed through the SAME restore-and-refuse path below (D-18) — never surfaced as
    // a late, un-recovered error after the connection has already been handed back.
    let migration_result: anyhow::Result<()> = migrations
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
        // Read before the connection goes away: only the too-far-ahead refusal uses it.
        let ahead_user_version: i64 =
            conn.query_row("PRAGMA user_version", [], |row| row.get(0)).unwrap_or(-1);
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

        let ahead = schema_ahead_context(migrations, &migration_err, ahead_user_version, backups_dir);
        let migration_err = match ahead {
            Some(msg) => migration_err.context(msg),
            None => migration_err,
        };
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
