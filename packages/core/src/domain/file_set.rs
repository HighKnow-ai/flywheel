//! A task's declared file-set (D-147, D-148): the child rows in `task_file_set_entries` and the
//! `task.file_set_declared` event that records every change to them. The set is the scope the
//! run-time hook enforces and the plan-time overlap check compares — both through
//! [`crate::file_set`], never through anything re-derived here.
//!
//! Plain values in, plain values out: entries arrive already parsed ([`FileSetEntry`]), so this
//! module never decides what a valid entry is. The projection rows and the event commit together
//! or not at all (DATA-01), following `merge.rs::record_merge_event` and `task::set_estimate`.

use anyhow::{anyhow, Context};
use chrono::Utc;
use rusqlite::{params, Connection, Transaction};

use crate::domain::event::{append_event, next_sequence};
use crate::file_set::{entry_form, entry_path, parse_entry, FileSetEntry};
use crate::ids::new_id;

/// The event appended when a task's declared set changes. The payload carries the previous and the
/// new entry lists in the `{field, before, after, label}` idiom, so the log is the version history.
pub const EVENT_FILE_SET_DECLARED: &str = "task.file_set_declared";

/// Read a task's declared entries in the order they were stored. An unreadable row (a form that
/// disagrees with its path, or a path `parse_entry` refuses) is an error, never skipped: a scope
/// that silently loses an entry would be wider or narrower than the one the developer approved.
pub fn list_entries_for_task(conn: &Connection, task_id: &str) -> anyhow::Result<Vec<FileSetEntry>> {
    let mut stmt = conn
        .prepare("SELECT form, path FROM task_file_set_entries WHERE task_id = ?1 ORDER BY id")
        .context("failed to prepare the file-set read")?;
    let rows = stmt
        .query_map(params![task_id], |row| {
            Ok((row.get::<_, String>(0)?, row.get::<_, String>(1)?))
        })
        .context("failed to read the file-set rows")?;
    let mut entries = Vec::new();
    for row in rows {
        let (form, path) = row.context("failed to read a file-set row")?;
        let entry = parse_entry(&path)
            .map_err(|refusal| anyhow!("stored file-set entry {path:?} is invalid: {refusal}"))?;
        if entry_form(&entry) != form {
            return Err(anyhow!(
                "stored file-set entry {path:?} has form {form:?} but parses as {:?}",
                entry_form(&entry)
            ));
        }
        entries.push(entry);
    }
    Ok(entries)
}

fn entry_strings(entries: &[FileSetEntry]) -> Vec<String> {
    entries.iter().map(|e| entry_path(e).to_string()).collect()
}

/// Replace `task_id`'s declared set with `entries` and append one [`EVENT_FILE_SET_DECLARED`]
/// event, inside the caller's transaction. Duplicate entries collapse (first occurrence wins). An
/// unchanged set is a no-op and appends nothing. An empty `entries` clears the set — and the next
/// run of the task starts unarmed (D-150).
pub fn declare_file_set_in_tx(
    tx: &Transaction,
    task_id: &str,
    entries: &[FileSetEntry],
    actor_id: &str,
    now: &str,
) -> anyhow::Result<()> {
    let (project_id, epic_id): (String, Option<String>) = tx
        .query_row(
            "SELECT project_id, epic_id FROM tasks WHERE id = ?1",
            params![task_id],
            |row| Ok((row.get(0)?, row.get(1)?)),
        )
        .with_context(|| format!("task {task_id:?} not found"))?;

    let mut deduped: Vec<FileSetEntry> = Vec::with_capacity(entries.len());
    for entry in entries {
        if !deduped.contains(entry) {
            deduped.push(entry.clone());
        }
    }

    let before = list_entries_for_task(tx, task_id)?;
    if before == deduped {
        return Ok(());
    }

    tx.execute(
        "DELETE FROM task_file_set_entries WHERE task_id = ?1",
        params![task_id],
    )
    .context("failed to clear the previous file-set")?;
    for entry in &deduped {
        tx.execute(
            "INSERT INTO task_file_set_entries (id, task_id, form, path, created_by, created_at)
             VALUES (?1, ?2, ?3, ?4, ?5, ?6)",
            params![new_id(), task_id, entry_form(entry), entry_path(entry), actor_id, now],
        )
        .with_context(|| format!("failed to store file-set entry {:?}", entry_path(entry)))?;
    }

    let after_strings = entry_strings(&deduped);
    let payload = serde_json::json!({
        "field": "file_set",
        "before": entry_strings(&before),
        "after": after_strings,
        "label": match after_strings.len() {
            0 => "Cleared the declared file-set".to_string(),
            1 => "Declared a file-set of 1 entry".to_string(),
            n => format!("Declared a file-set of {n} entries"),
        },
    });
    let sequence = next_sequence(tx, &project_id, "local")?;
    append_event(
        tx,
        &project_id,
        "local",
        sequence,
        "task",
        task_id,
        Some(task_id),
        epic_id.as_deref(),
        actor_id,
        EVENT_FILE_SET_DECLARED,
        &payload,
        now,
    )?;
    Ok(())
}

/// The own-transaction wrapper around [`declare_file_set_in_tx`].
pub fn declare_file_set(
    conn: &mut Connection,
    task_id: &str,
    entries: &[FileSetEntry],
    actor_id: &str,
) -> anyhow::Result<()> {
    let now = Utc::now().to_rfc3339();
    let tx = conn.transaction()?;
    declare_file_set_in_tx(&tx, task_id, entries, actor_id, &now)?;
    tx.commit()
        .context("failed to commit declare_file_set transaction")?;
    Ok(())
}

/// Whether the repository holding `worktree_path` is on a case-insensitive filesystem, read from
/// `core.ignorecase` (git sets it at init). Unset or unreadable reads as `false`: not folding is
/// the STRICTER direction for enforcement (an alias spelled in another case is refused rather
/// than allowed).
pub(crate) fn repo_is_case_insensitive(worktree_path: &std::path::Path) -> bool {
    crate::git::git_output_at(worktree_path, &["config", "--get", "core.ignorecase"])
        .map(|out| {
            out.status.success() && String::from_utf8_lossy(&out.stdout).trim() == "true"
        })
        .unwrap_or(false)
}

/// Write the run's scope marker (D-150, D-151) — the ONE place "armed or unarmed" is decided, so no
/// spawn path can forget it. A task with NO declared entries gets an explicit `unarmed` marker
/// (enforcement exists exactly where a declaration exists, never as an empty set that refuses every
/// write); a task with entries gets an `armed` one. `worktree_root` is canonicalised here.
///
/// Returns an error — and the caller MUST abort the run start — when the marker cannot be written,
/// the worktree cannot be canonicalised, or the stored entries cannot be read: a run that cannot
/// record its scope must not start (the `start_authoring_run` G-05-8(b) lesson).
pub fn arm_scope_marker(
    conn: &Connection,
    run_id: &str,
    task_id: &str,
    worktree_path: &std::path::Path,
) -> Result<crate::runtime_protocol::ScopeMode, String> {
    use crate::runtime_protocol::{
        write_scope_marker, RuntimeIo, ScopeMarker, ScopeMarkerEntry, ScopeMode, SCOPE_MARKER_VERSION,
    };

    let entries = list_entries_for_task(conn, task_id).map_err(|e| format!("{e:#}"))?;
    let canonical = std::fs::canonicalize(worktree_path).map_err(|e| {
        format!("cannot canonicalise worktree {worktree_path:?} for the scope marker: {e}")
    })?;
    let mode = if entries.is_empty() { ScopeMode::Unarmed } else { ScopeMode::Armed };
    let marker = ScopeMarker {
        version: SCOPE_MARKER_VERSION,
        mode,
        worktree_root: canonical.to_string_lossy().into_owned(),
        case_insensitive: repo_is_case_insensitive(&canonical),
        entries: entries
            .iter()
            .map(|e| ScopeMarkerEntry {
                form: entry_form(e).to_string(),
                path: entry_path(e).to_string(),
            })
            .collect(),
        written_at: Utc::now().to_rfc3339(),
    };
    match write_scope_marker(run_id, &marker) {
        RuntimeIo::Written => Ok(mode),
        RuntimeIo::WriteFailed(why) => Err(format!(
            "could not write the scope marker for run {run_id}: {why} — a run that cannot record its scope does not start"
        )),
    }
}

/// The event appended for a write the scope gate refused, or that the close-time backstop found
/// outside the declared set (PLAN-05). One row per refusal; never coalesced (D-154).
pub const EVENT_SCOPE_DENIED: &str = "task.scope_denied";

/// One refused (or after-the-fact detected) out-of-set write.
#[derive(Debug, Clone, PartialEq)]
pub struct ScopeDenial {
    pub path: String,
    pub tool: String,
    pub tool_use_id: String,
    pub outside_worktree: bool,
    pub detected_after_the_fact: bool,
}

#[allow(clippy::too_many_arguments)]
pub fn record_scope_denied_in_tx(
    _tx: &Transaction,
    _project_id: &str,
    _task_id: &str,
    _epic_id: Option<&str>,
    _run_id: &str,
    _actor_id: &str,
    _denial: &ScopeDenial,
    _now: &str,
) -> anyhow::Result<()> {
    Ok(())
}

pub fn record_scope_denied(_conn: &mut Connection, _run_id: &str, _denial: &ScopeDenial) -> anyhow::Result<Option<String>> {
    Ok(None)
}

pub fn record_backstop_denials(_conn: &mut Connection, _run_id: &str, _paths: &[String]) -> anyhow::Result<usize> {
    Ok(0)
}
