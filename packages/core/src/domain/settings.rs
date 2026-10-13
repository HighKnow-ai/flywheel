//! D-39's global default credential mode and per-project override — the settings surface's
//! backing reads/writes. `credentials::resolve_credential` is the only other module that reads
//! these values, and it does so through this module's own functions rather than re-deriving the
//! `settings`/`projects.credential_mode` reads itself (single source for both halves of D-39's
//! two-level setting).
//!
//! **Why the global half never appends an `events` row (and the per-project half does):**
//! `events.project_id` is `NOT NULL` (migration `0002_board_schema.sql`) — every event in this
//! product's activity trail belongs to exactly one project's stream. A GLOBAL setting change has
//! no natural project to attribute that row to; Settings itself lists every registered project
//! (02-UI-SPEC.md), so there is no "current project" to borrow one from either. `settings.
//! updated_by`/`updated_at` (migration `0005_credentials.sql`) are this module's answer: the row
//! itself is its own audit record for the global scope. The PER-PROJECT override
//! (`projects.credential_mode`) DOES have a natural project stream — `set_project_credential_mode`
//! appends a real event there, following this crate's usual transactional-outbox shape exactly.
//!
//! `dispatch_max_parallel` (D-159) follows the global rule too: one number covering concurrent agent
//! sessions across every project, so it has no project stream and writes no `events` row;
//! `settings.updated_by`/`updated_at` are its audit record.

use anyhow::Context;
use chrono::Utc;
use rusqlite::{params, Connection, OptionalExtension, Transaction};

use crate::domain::event::{append_event, next_sequence};

const SETTING_GLOBAL_CREDENTIAL_MODE: &str = "global_credential_mode";
const SETTING_DISPATCH_MAX_PARALLEL: &str = "dispatch_max_parallel";
const SETTING_NOTIFICATIONS_ENABLED: &str = "notifications_enabled";

/// Whether the OS notifications for a blocked, finished or failed agent are on when Settings has
/// never said (D-176).
pub const DEFAULT_NOTIFICATIONS_ENABLED: bool = true;

/// How many agent sessions the dispatcher may keep running at once when Settings has never said.
pub const DEFAULT_DISPATCH_MAX_PARALLEL: u32 = 3;
/// The smallest cap that still lets the dispatcher run anything.
pub const DISPATCH_MAX_PARALLEL_MIN: u32 = 1;
/// A judgement, not a measurement: the public report that anchors it saw failures at 13-way
/// parallelism without spawn staggering, a different configuration from this one.
pub const DISPATCH_MAX_PARALLEL_MAX: u32 = 8;

/// D-39's default when no setting row exists yet — a fresh install rides the developer's own
/// `claude login` session until Settings says otherwise.
pub const DEFAULT_GLOBAL_CREDENTIAL_MODE: &str = "local";

/// Insert or update one `settings` row inside the caller's transaction — shared by every module
/// that owns a key in this key/value table (`domain::settings` for the global credential mode,
/// `credentials` for `api_key_configured_at`), so there is exactly one upsert statement for the
/// whole table.
pub(crate) fn upsert_setting(
    tx: &Transaction,
    key: &str,
    value: &str,
    actor_id: &str,
    now: &str,
) -> anyhow::Result<()> {
    tx.execute(
        "INSERT INTO settings (key, value, updated_by, updated_at) VALUES (?1, ?2, ?3, ?4)
         ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_by = excluded.updated_by, updated_at = excluded.updated_at",
        params![key, value, actor_id, now],
    )
    .with_context(|| format!("failed to upsert setting {key:?}"))?;
    Ok(())
}

/// Read one `settings` row's value, or `None` if it has never been set — shared by
/// `domain::settings` and `credentials` for the same reason as [`upsert_setting`].
pub(crate) fn read_setting(conn: &Connection, key: &str) -> anyhow::Result<Option<String>> {
    conn.query_row(
        "SELECT value FROM settings WHERE key = ?1",
        params![key],
        |row| row.get(0),
    )
    .optional()
    .with_context(|| format!("failed to read setting {key:?}"))
}

/// Delete one `settings` row inside the caller's transaction, if it exists — a no-op (not an
/// error) when the key was never set.
pub(crate) fn delete_setting(tx: &Transaction, key: &str) -> anyhow::Result<()> {
    tx.execute("DELETE FROM settings WHERE key = ?1", params![key])
        .with_context(|| format!("failed to delete setting {key:?}"))?;
    Ok(())
}

/// The global default credential mode (`"local"` or `"api_key"`) — defaults to
/// [`DEFAULT_GLOBAL_CREDENTIAL_MODE`] when no setting row exists yet (a fresh install has never
/// touched Settings).
pub fn global_credential_mode(conn: &Connection) -> anyhow::Result<String> {
    Ok(read_setting(conn, SETTING_GLOBAL_CREDENTIAL_MODE)?
        .unwrap_or_else(|| DEFAULT_GLOBAL_CREDENTIAL_MODE.to_string()))
}

/// Set the global default credential mode. `mode` is expected to already be validated by the
/// caller (the command handler validates against exactly `"local"`/`"api_key"` before this is
/// ever reached, per plan 02-09 Task 2) — this function still refuses an unrecognised value
/// defensively, since a global setting has no schema CHECK constraint backing it the way
/// `projects.credential_mode` does (the `settings.value` column is a plain TEXT shared by more
/// than one setting shape).
pub fn set_global_credential_mode(
    conn: &mut Connection,
    actor_id: &str,
    mode: &str,
) -> anyhow::Result<()> {
    if mode != "local" && mode != "api_key" {
        return Err(anyhow::anyhow!(
            "credential mode must be \"local\" or \"api_key\", got {mode:?}"
        ));
    }

    let now = Utc::now().to_rfc3339();
    let tx = conn.transaction()?;
    upsert_setting(&tx, SETTING_GLOBAL_CREDENTIAL_MODE, mode, actor_id, &now)?;
    tx.commit()
        .context("failed to commit set_global_credential_mode transaction")?;
    Ok(())
}

/// The global cap on concurrently running agent sessions (D-159). An absent, unparseable or
/// out-of-range stored value reads as [`DEFAULT_DISPATCH_MAX_PARALLEL`] — `settings.value` is a
/// shared TEXT column with no CHECK, and the dispatcher tick reads this, so a bad row must degrade
/// rather than fail.
pub fn dispatch_max_parallel(conn: &Connection) -> anyhow::Result<u32> {
    let stored = read_setting(conn, SETTING_DISPATCH_MAX_PARALLEL)?;
    Ok(stored
        .and_then(|raw| raw.parse::<u32>().ok())
        .filter(|n| (DISPATCH_MAX_PARALLEL_MIN..=DISPATCH_MAX_PARALLEL_MAX).contains(n))
        .unwrap_or(DEFAULT_DISPATCH_MAX_PARALLEL))
}

/// Set the global parallel cap. The command handler validates first; this refuses again for the
/// same reason [`set_global_credential_mode`] does. Writes one `settings` row and no event.
pub fn set_dispatch_max_parallel(
    conn: &mut Connection,
    actor_id: &str,
    value: u32,
) -> anyhow::Result<()> {
    if !(DISPATCH_MAX_PARALLEL_MIN..=DISPATCH_MAX_PARALLEL_MAX).contains(&value) {
        return Err(anyhow::anyhow!(
            "parallel agent cap must be between {DISPATCH_MAX_PARALLEL_MIN} and {DISPATCH_MAX_PARALLEL_MAX}, got {value}"
        ));
    }
    let now = Utc::now().to_rfc3339();
    let tx = conn.transaction()?;
    upsert_setting(&tx, SETTING_DISPATCH_MAX_PARALLEL, &value.to_string(), actor_id, &now)?;
    tx.commit()
        .context("failed to commit set_dispatch_max_parallel transaction")?;
    Ok(())
}

/// The one global switch for OS notifications (D-176). An absent or unparseable stored value reads
/// as [`DEFAULT_NOTIFICATIONS_ENABLED`], like [`dispatch_max_parallel`]: the notify path reads this at
/// fire time, so a bad row must degrade to "on" rather than fail or silence a block.
pub fn notifications_enabled(conn: &Connection) -> anyhow::Result<bool> {
    let stored = read_setting(conn, SETTING_NOTIFICATIONS_ENABLED)?;
    Ok(stored
        .and_then(|raw| raw.parse::<bool>().ok())
        .unwrap_or(DEFAULT_NOTIFICATIONS_ENABLED))
}

/// Set the global notification switch. Writes one `settings` row and no event.
pub fn set_notifications_enabled(
    conn: &mut Connection,
    actor_id: &str,
    value: bool,
) -> anyhow::Result<()> {
    let now = Utc::now().to_rfc3339();
    let tx = conn.transaction()?;
    upsert_setting(&tx, SETTING_NOTIFICATIONS_ENABLED, &value.to_string(), actor_id, &now)?;
    tx.commit()
        .context("failed to commit set_notifications_enabled transaction")?;
    Ok(())
}

/// `project_id`'s credential-mode override, or `None` when the project has no override — the
/// resolver (`credentials::resolve_credential`) falls back to [`global_credential_mode`] in that
/// case.
pub fn project_credential_mode(conn: &Connection, project_id: &str) -> anyhow::Result<Option<String>> {
    conn.query_row(
        "SELECT credential_mode FROM projects WHERE id = ?1",
        params![project_id],
        |row| row.get(0),
    )
    .with_context(|| format!("project {project_id:?} not found"))
}

/// Set (or clear) `project_id`'s credential-mode override (D-39). Passing `Some(mode)` equal to
/// the CURRENT global default clears the override (stores `NULL`) instead of storing a redundant
/// row — "use the global default" stays a real, distinguishable state rather than an accident of
/// two columns happening to agree. `mode = None` always clears, regardless of the global default.
///
/// Appends a project-scoped `events` row (unlike the global half — see this module's own doc
/// comment) inside the same transaction as the `projects.credential_mode` write, following this
/// crate's usual "one transaction, the row write, `next_sequence` + `append_event`, one commit"
/// shape exactly. An out-of-set `mode` value is rejected by `projects.credential_mode`'s own CHECK
/// constraint (migration `0005_credentials.sql`), not by this function.
pub fn set_project_credential_mode(
    conn: &mut Connection,
    actor_id: &str,
    project_id: &str,
    mode: Option<&str>,
) -> anyhow::Result<()> {
    let now = Utc::now().to_rfc3339();
    let tx = conn.transaction()?;

    let project_name: String = tx
        .query_row(
            "SELECT name FROM projects WHERE id = ?1",
            params![project_id],
            |row| row.get(0),
        )
        .with_context(|| format!("project {project_id:?} not found"))?;

    let current_global = global_credential_mode(&tx)?;
    let effective_mode: Option<&str> = match mode {
        Some(m) if m == current_global => None,
        other => other,
    };

    tx.execute(
        "UPDATE projects SET credential_mode = ?1 WHERE id = ?2",
        params![effective_mode, project_id],
    )
    .context("failed to update the project's credential_mode override")?;

    let (event_type, label) = match effective_mode {
        Some(m) => (
            "project.credential_mode_set",
            format!("Set credential path to {}", human_mode_name(m)),
        ),
        None => (
            "project.credential_mode_cleared",
            format!("Cleared credential override for {project_name}"),
        ),
    };
    let payload = serde_json::json!({
        "field": "credential_mode",
        "before": null,
        "after": effective_mode,
        "label": label,
    });
    let sequence = next_sequence(&tx, project_id, "local")?;
    append_event(
        &tx,
        project_id,
        "local",
        sequence,
        "project",
        project_id,
        None,
        None,
        actor_id,
        event_type,
        &payload,
        &now,
    )?;

    tx.commit()
        .context("failed to commit set_project_credential_mode transaction")?;
    Ok(())
}

fn human_mode_name(mode: &str) -> &'static str {
    match mode {
        "api_key" => "API key",
        _ => "Local Claude Code Credentials",
    }
}

/// `project_id`'s stored `projects.forge` override (D-119), or `None` when the project has no
/// override — `forge::forge_for_project` falls back to `forge::detect_forge_from_origin` in that
/// case. Exact structural sibling of [`project_credential_mode`].
pub fn project_forge(conn: &Connection, project_id: &str) -> anyhow::Result<Option<String>> {
    conn.query_row("SELECT forge FROM projects WHERE id = ?1", params![project_id], |row| {
        row.get(0)
    })
    .with_context(|| format!("project {project_id:?} not found"))
}

/// Set (or clear) `project_id`'s forge override (D-119). An out-of-vocabulary value is rejected
/// by `projects.forge`'s own CHECK constraint (migration `0017_forge_setting.sql`), not by this
/// function — mirroring [`set_project_credential_mode`]'s own "the schema is the authority"
/// discipline. Appends one project-scoped `events` row carrying a human-readable label, exact
/// structural sibling of [`set_project_credential_mode`].
pub fn set_project_forge(
    conn: &mut Connection,
    actor_id: &str,
    project_id: &str,
    forge: Option<&str>,
) -> anyhow::Result<()> {
    let now = Utc::now().to_rfc3339();
    let tx = conn.transaction()?;

    let project_name: String = tx
        .query_row("SELECT name FROM projects WHERE id = ?1", params![project_id], |row| {
            row.get(0)
        })
        .with_context(|| format!("project {project_id:?} not found"))?;

    tx.execute("UPDATE projects SET forge = ?1 WHERE id = ?2", params![forge, project_id])
        .context("failed to update the project's forge override")?;

    let (event_type, label) = match forge {
        Some(f) => ("project.forge_set", format!("Set forge to {}", human_forge_name(f))),
        None => ("project.forge_cleared", format!("Cleared forge override for {project_name}")),
    };
    let payload = serde_json::json!({
        "field": "forge",
        "before": null,
        "after": forge,
        "label": label,
    });
    let sequence = next_sequence(&tx, project_id, "local")?;
    append_event(
        &tx,
        project_id,
        "local",
        sequence,
        "project",
        project_id,
        None,
        None,
        actor_id,
        event_type,
        &payload,
        &now,
    )?;

    tx.commit().context("failed to commit set_project_forge transaction")?;
    Ok(())
}

fn human_forge_name(forge: &str) -> &'static str {
    match forge {
        "github" => "GitHub",
        "gitlab" => "GitLab",
        "local" => "Local-only (no forge)",
        _ => "an unrecognised forge",
    }
}
