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

/// Why replacing `task_id`'s declared set must be refused right now, or `None` if it may proceed.
/// A task with a running or blocked run holds a live scope marker, and the widen re-arms that
/// marker from ALL stored rows, so an unchecked replace would launder entries into a running
/// agent's scope. The widen is the one write that re-checks against every other in-flight set.
pub fn declare_refusal(conn: &Connection, task_id: &str) -> anyhow::Result<Option<String>> {
    let live: bool = conn
        .query_row(
            "SELECT EXISTS (SELECT 1 FROM agent_runs WHERE task_id = ?1 AND status IN ('running', 'blocked'))",
            params![task_id],
            |row| row.get(0),
        )
        .context("failed to read the task's live runs")?;
    if !live {
        return Ok(None);
    }
    let key: String = conn
        .query_row("SELECT key FROM tasks WHERE id = ?1", params![task_id], |row| row.get(0))
        .unwrap_or_else(|_| task_id.to_string());
    Ok(Some(format!(
        "task {key} has an agent run in flight, so its declared file-set cannot be replaced. \
         Widen it instead: the widen is the one write that can change a live task's scope, because \
         it re-checks against every other in-flight set in its own transaction (D-152)."
    )))
}

/// Replace `task_id`'s declared set with `entries` and append one [`EVENT_FILE_SET_DECLARED`]
/// event, inside the caller's transaction. Duplicate entries collapse (first occurrence wins). An
/// unchanged set is a no-op and appends nothing, except against a task with a live run, which is
/// refused outright (see [`declare_refusal`]). An empty `entries` clears the set — and the next
/// run of the task starts unarmed (D-150).
pub fn declare_file_set_in_tx(
    tx: &Transaction,
    task_id: &str,
    entries: &[FileSetEntry],
    actor_id: &str,
    now: &str,
) -> anyhow::Result<()> {
    if let Some(refusal) = declare_refusal(tx, task_id)? {
        return Err(anyhow!(refusal));
    }
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
///
/// This runs `git config`, a subprocess: call it with NO database lock held, and hand the answer to
/// the `*_with` variants ([`arm_scope_marker_with`], [`widen_file_set_with`], `preview_edges_with`)
/// rather than letting a command probe under `AppState.db` (D-REV-39 WR-07). It is `pub` so the
/// launch body can read the repository's observed flag before taking the lock (D-REV-44).
pub fn repo_is_case_insensitive(worktree_path: &std::path::Path) -> bool {
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
    let case_insensitive = repo_is_case_insensitive(worktree_path);
    arm_scope_marker_with(conn, run_id, task_id, worktree_path, case_insensitive)
}

/// [`arm_scope_marker`] with the repository's case flag supplied, so a caller holding the database
/// lock never runs the `git config` probe under it.
pub fn arm_scope_marker_with(
    conn: &Connection,
    run_id: &str,
    task_id: &str,
    worktree_path: &std::path::Path,
    case_insensitive: bool,
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
        case_insensitive,
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

/// The longest path a stored refusal keeps (characters). A path is agent-supplied text.
const MAX_STORED_PATH_CHARS: usize = 1024;

/// Append one [`EVENT_SCOPE_DENIED`] row inside the caller's transaction. Every refusal is its own
/// row: no coalescing, no threshold, no escalation (D-154) — the count is the signal and the
/// developer decides. `actor_id` is the agent that attempted the write, not the local human.
///
/// A path outside the worktree cannot be stored repository-relative, so only its file name is kept
/// (T-09-02-05: no absolute filesystem path is written to a row that later crosses to the renderer).
#[allow(clippy::too_many_arguments)]
pub fn record_scope_denied_in_tx(
    tx: &Transaction,
    project_id: &str,
    task_id: &str,
    epic_id: Option<&str>,
    run_id: &str,
    actor_id: &str,
    denial: &ScopeDenial,
    now: &str,
) -> anyhow::Result<()> {
    let raw_path: String = if denial.outside_worktree {
        std::path::Path::new(&denial.path)
            .file_name()
            .map(|n| n.to_string_lossy().into_owned())
            .unwrap_or_default()
    } else {
        denial.path.clone()
    };
    let stored_path: String = raw_path.chars().take(MAX_STORED_PATH_CHARS).collect();
    let label = if denial.detected_after_the_fact {
        format!("Found a change outside the declared file-set at session close: {stored_path}")
    } else if denial.outside_worktree {
        format!("Refused a write outside the worktree: {stored_path}")
    } else {
        format!("Refused a write outside the declared file-set: {stored_path}")
    };
    let payload = serde_json::json!({
        "label": label,
        "path": stored_path,
        "tool": denial.tool,
        "tool_use_id": denial.tool_use_id,
        "run_id": run_id,
        "outside_worktree": denial.outside_worktree,
        "detected_after_the_fact": denial.detected_after_the_fact,
    });
    let sequence = next_sequence(tx, project_id, "local")?;
    append_event(
        tx,
        project_id,
        "local",
        sequence,
        "task",
        task_id,
        Some(task_id),
        epic_id,
        actor_id,
        EVENT_SCOPE_DENIED,
        &payload,
        now,
    )?;
    Ok(())
}

/// Everything a refusal row needs that the run already knows: `(project, task, epic, actor)`.
/// `None` for an unknown run or one with no task (a planning run) — there is nothing to anchor to.
fn run_anchor(
    tx: &Transaction,
    run_id: &str,
) -> anyhow::Result<Option<(String, String, Option<String>, String)>> {
    use rusqlite::OptionalExtension;
    let row: Option<(String, Option<String>, String)> = tx
        .query_row(
            "SELECT project_id, task_id, actor_id FROM agent_runs WHERE id = ?1",
            params![run_id],
            |r| Ok((r.get(0)?, r.get(1)?, r.get(2)?)),
        )
        .optional()
        .context("failed to read the run a scope refusal belongs to")?;
    let Some((project_id, Some(task_id), actor_id)) = row else { return Ok(None) };
    let epic_id: Option<String> = tx
        .query_row("SELECT epic_id FROM tasks WHERE id = ?1", params![task_id], |r| r.get(0))
        .optional()
        .context("failed to read the task a scope refusal belongs to")?
        .flatten();
    Ok(Some((project_id, task_id, epic_id, actor_id)))
}

/// Record one refusal for `run_id` in its own transaction. Returns the task the row was attached
/// to, or `None` (and writes nothing) for an unknown run.
pub fn record_scope_denied(
    conn: &mut Connection,
    run_id: &str,
    denial: &ScopeDenial,
) -> anyhow::Result<Option<String>> {
    let now = Utc::now().to_rfc3339();
    let tx = conn.transaction()?;
    let Some((project_id, task_id, epic_id, actor_id)) = run_anchor(&tx, run_id)? else {
        return Ok(None);
    };
    record_scope_denied_in_tx(&tx, &project_id, &task_id, epic_id.as_deref(), run_id, &actor_id, denial, &now)?;
    tx.commit().context("failed to commit record_scope_denied transaction")?;
    Ok(Some(task_id))
}

/// Record the close-time backstop's findings for `run_id`: one after-the-fact row per path, all in
/// one transaction. A path already recorded after the fact for this run is skipped, so a
/// `session_closed` event delivered twice does not double the count. (A hook denial of the same path
/// is a different row and is never skipped: the two are told apart by `detected_after_the_fact`.)
/// Returns the number of rows appended.
pub fn record_backstop_denials(
    conn: &mut Connection,
    run_id: &str,
    paths: &[String],
) -> anyhow::Result<usize> {
    if paths.is_empty() {
        return Ok(0);
    }
    let now = Utc::now().to_rfc3339();
    let tx = conn.transaction()?;
    let Some((project_id, task_id, epic_id, actor_id)) = run_anchor(&tx, run_id)? else {
        return Ok(0);
    };
    let mut appended = 0;
    for path in paths {
        let already: bool = tx
            .query_row(
                "SELECT EXISTS (SELECT 1 FROM events WHERE task_id = ?1 AND event_type = ?2
                   AND json_extract(payload, '$.run_id') = ?3
                   AND json_extract(payload, '$.path') = ?4
                   AND json_extract(payload, '$.detected_after_the_fact') = 1)",
                params![task_id, EVENT_SCOPE_DENIED, run_id, path],
                |r| r.get(0),
            )
            .context("failed to check for an existing backstop row")?;
        if already {
            continue;
        }
        let denial = ScopeDenial {
            path: path.clone(),
            tool: String::new(),
            tool_use_id: String::new(),
            outside_worktree: false,
            detected_after_the_fact: true,
        };
        record_scope_denied_in_tx(&tx, &project_id, &task_id, epic_id.as_deref(), run_id, &actor_id, &denial, &now)?;
        appended += 1;
    }
    tx.commit().context("failed to commit record_backstop_denials transaction")?;
    Ok(appended)
}

/// The event appended when a live widen is accepted (D-152). Same `{field, before, after, label}`
/// payload as [`EVENT_FILE_SET_DECLARED`].
pub const EVENT_FILE_SET_WIDENED: &str = "task.file_set_widened";

/// Why a widen was refused. Nothing was stored and no marker was rewritten.
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum WidenRefusal {
    /// `parse_entry` refused the string; `cause` is its own named text.
    InvalidEntry { entry: String, cause: String },
    /// The entry overlaps a set an in-flight task is running against. Names the other task's
    /// colliding entry and its key, never its whole set (T-09-06-04).
    Collision { entry: String, colliding_path: String, other_task_id: String, other_task_key: String },
}

/// What a widen did.
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum WidenOutcome {
    /// Stored, evented and the marker rewritten. `entries` is the new full set.
    Accepted { entries: Vec<String> },
    Refused(WidenRefusal),
    /// Stored and evented, but the marker could not be rewritten: the database says the set is
    /// wider and the hook does not yet agree (T-09-06-05). `entries` is the new full set.
    MarkerNotRewritten { entries: Vec<String>, error: String },
}

/// Widen `task_id`'s declared set by one entry, live (D-152).
///
/// The order is the point. The entry is validated by the same `parse_entry` the declare path uses.
/// Then, **inside the write transaction** (taken `IMMEDIATE`, so the write lock is held before the
/// re-check reads), the candidate is compared against every other in-flight task's declared set; a
/// check made before the transaction would be a race. Only after the commit is the run's scope
/// marker rewritten: the hook reads it fresh on every call, so that rewrite IS "takes effect on the
/// next tool call". A rewrite failure after a commit is returned, never swallowed.
///
/// A widen of an entry the set already holds writes nothing but still rewrites the marker, so
/// retrying after [`WidenOutcome::MarkerNotRewritten`] repairs the marker.
pub fn widen_file_set(
    conn: &mut Connection,
    task_id: &str,
    raw_entry: &str,
    actor_id: &str,
) -> anyhow::Result<WidenOutcome> {
    let repo_path = task_repo_path(conn, task_id)?;
    let fold_case = repo_is_case_insensitive(std::path::Path::new(&repo_path));
    widen_file_set_with(conn, task_id, raw_entry, actor_id, fold_case)
}

/// The repository path of the project `task_id` belongs to. A database read only: the desktop
/// command reads it under a short lock, drops the lock, probes, then calls the `*_with` variant.
pub fn task_repo_path(conn: &Connection, task_id: &str) -> anyhow::Result<String> {
    conn.query_row(
        "SELECT p.repo_path FROM tasks t JOIN projects p ON p.id = t.project_id WHERE t.id = ?1",
        params![task_id],
        |r| r.get(0),
    )
    .with_context(|| format!("task {task_id:?} not found"))
}

/// [`widen_file_set`] with the repository's case flag supplied (see [`repo_is_case_insensitive`]).
pub fn widen_file_set_with(
    conn: &mut Connection,
    task_id: &str,
    raw_entry: &str,
    actor_id: &str,
    fold_case: bool,
) -> anyhow::Result<WidenOutcome> {
    use rusqlite::{OptionalExtension, TransactionBehavior};

    let candidate = match parse_entry(raw_entry) {
        Ok(entry) => entry,
        Err(refusal) => {
            return Ok(WidenOutcome::Refused(WidenRefusal::InvalidEntry {
                entry: raw_entry.to_string(),
                cause: refusal.to_string(),
            }))
        }
    };

    let (project_id, epic_id): (String, Option<String>) = conn
        .query_row(
            "SELECT project_id, epic_id FROM tasks WHERE id = ?1",
            params![task_id],
            |r| Ok((r.get(0)?, r.get(1)?)),
        )
        .with_context(|| format!("task {task_id:?} not found"))?;
    let now = Utc::now().to_rfc3339();

    let tx = conn.transaction_with_behavior(TransactionBehavior::Immediate)?;
    let before = list_entries_for_task(&tx, task_id)?;
    if !before.contains(&candidate) {
        for (other_id, other_entries) in crate::dispatch::in_flight_declared_sets(&tx, &project_id)? {
            if other_id == task_id {
                continue;
            }
            let found = crate::file_set::collisions(std::slice::from_ref(&candidate), &other_entries, fold_case);
            if let Some(hit) = found.first() {
                let other_task_key: String = tx
                    .query_row("SELECT key FROM tasks WHERE id = ?1", params![other_id], |r| r.get(0))
                    .optional()?
                    .unwrap_or_default();
                // Dropping `tx` rolls back; nothing was written yet.
                return Ok(WidenOutcome::Refused(WidenRefusal::Collision {
                    entry: entry_path(&candidate).to_string(),
                    colliding_path: entry_path(hit.second).to_string(),
                    other_task_id: other_id,
                    other_task_key,
                }));
            }
        }
        tx.execute(
            "INSERT INTO task_file_set_entries (id, task_id, form, path, created_by, created_at)
             VALUES (?1, ?2, ?3, ?4, ?5, ?6)",
            params![new_id(), task_id, entry_form(&candidate), entry_path(&candidate), actor_id, now],
        )
        .with_context(|| format!("failed to store widened entry {:?}", entry_path(&candidate)))?;
        let mut after = before.clone();
        after.push(candidate.clone());
        let payload = serde_json::json!({
            "field": "file_set",
            "before": entry_strings(&before),
            "after": entry_strings(&after),
            "label": format!("Widened the declared file-set to include {}", entry_path(&candidate)),
        });
        let sequence = next_sequence(&tx, &project_id, "local")?;
        append_event(
            &tx, &project_id, "local", sequence, "task", task_id, Some(task_id),
            epic_id.as_deref(), actor_id, EVENT_FILE_SET_WIDENED, &payload, &now,
        )?;
        record_widen_sequencing(&tx, &project_id, task_id, &candidate, fold_case, actor_id, &now)?;
    }
    tx.commit().context("failed to commit widen_file_set transaction")?;

    let entries = entry_strings(&list_entries_for_task(conn, task_id)?);
    match rewrite_live_markers(conn, task_id, fold_case) {
        Ok(()) => Ok(WidenOutcome::Accepted { entries }),
        Err(error) => Ok(WidenOutcome::MarkerNotRewritten { entries, error }),
    }
}

/// D-157: when a live widen makes the (running) widening task reach a QUEUED task in the same wave
/// of the same live plan, store the ordering edge and its `task.sequenced` event, in the widen's own
/// transaction. Execution already waits (readiness reads the widened rows); this is the record that
/// lets `why` answer a week later, and it is written through the same two writers approval uses.
///
/// Orientation comes from reality, not board rank: the widening task is live, so it is the before
/// side; the queued task waits. No cycle is possible. Approval's edges get acyclicity from a total
/// order, these get it from liveness: the before side is always running, and a queued task can only
/// become the live side of a later widen edge after its own predecessor has merged, when it is no
/// longer queued, so the edge points from live to not-yet-live and never back.
///
/// A pair that already has an edge, in either orientation, is skipped: the first answer is the one
/// acted on, and `dispatch_edges` is unique on (plan, before, after), so a blind insert would abort
/// the transaction and roll back a legitimate scope grant for bookkeeping.
fn record_widen_sequencing(
    tx: &Transaction,
    project_id: &str,
    task_id: &str,
    candidate: &FileSetEntry,
    fold_case: bool,
    actor_id: &str,
    now: &str,
) -> anyhow::Result<()> {
    use crate::dispatch::{DispatchEdge, EDGE_CAUSE_WIDEN};
    use crate::domain::dispatch_plan::{append_sequenced_event, insert_edge_in_tx};

    // Live plan membership of the widening task, with its wave. `queued` states are those a task has
    // before it ever spawns; a finished, failed or merged task is not waiting on anyone.
    let memberships: Vec<(String, String, u32)> = tx
        .prepare(
            "SELECT p.id, p.epic_id, pt.wave FROM dispatch_plan_tasks pt
               JOIN dispatch_plans p ON p.id = pt.plan_id
              WHERE pt.task_id = ?1 AND p.status IN ('approved', 'running', 'paused')",
        )?
        .query_map(params![task_id], |r| Ok((r.get(0)?, r.get(1)?, r.get(2)?)))?
        .collect::<Result<_, _>>()
        .context("failed to read the widening task's live plans")?;

    for (plan_id, epic_id, wave) in memberships {
        // D-REV-45: "queued" is exactly what the dispatcher would start, asked of the dispatcher's own
        // predicate. A hand-written state list here had drifted from `is_startable` and missed a task
        // parked at pre-spawn attention, which then cut its worktree from a base without the widener.
        let mut queued: Vec<String> = Vec::new();
        for t in crate::dispatch::task_views(tx, &plan_id)? {
            if t.wave == wave && t.task_id != task_id && !t.live && crate::dispatch::is_startable(tx, &plan_id, &t)? {
                queued.push(t.task_id);
            }
        }
        queued.sort();
        for other_id in queued {
            let other_entries = list_entries_for_task(tx, &other_id)?;
            let found = crate::file_set::collisions(std::slice::from_ref(candidate), &other_entries, fold_case);
            if found.is_empty() {
                continue;
            }
            let already: bool = tx.query_row(
                "SELECT EXISTS (SELECT 1 FROM dispatch_edges WHERE plan_id = ?1
                   AND ((before_task_id = ?2 AND after_task_id = ?3)
                     OR (before_task_id = ?3 AND after_task_id = ?2)))",
                params![plan_id, task_id, other_id],
                |r| r.get(0),
            )?;
            if already {
                continue;
            }
            let edge = DispatchEdge {
                before_task_id: task_id.to_string(),
                after_task_id: other_id,
                cause: EDGE_CAUSE_WIDEN.to_string(),
                colliding_paths: found
                    .iter()
                    .map(|c| (entry_path(c.first).to_string(), entry_path(c.second).to_string()))
                    .collect(),
            };
            insert_edge_in_tx(tx, &plan_id, &edge, now)?;
            append_sequenced_event(tx, project_id, &epic_id, &plan_id, &edge, actor_id, now)?;
        }
    }
    Ok(())
}

/// Re-arm the scope marker of every live run of `task_id` from the stored rows. A task with no live
/// run has no marker to rewrite: its next run arms from the same rows.
fn rewrite_live_markers(conn: &Connection, task_id: &str, case_insensitive: bool) -> Result<(), String> {
    let run_ids: Vec<String> = conn
        .prepare("SELECT id FROM agent_runs WHERE task_id = ?1 AND status IN ('running', 'blocked')")
        .and_then(|mut stmt| stmt.query_map(params![task_id], |r| r.get(0))?.collect())
        .map_err(|e| format!("could not list the task's live runs: {e}"))?;
    if run_ids.is_empty() {
        return Ok(());
    }
    let worktree = crate::domain::worktree::worktree_for_task(conn, task_id)
        .map_err(|e| format!("{e:#}"))?
        .ok_or_else(|| "the task has a live run but no worktree".to_string())?;
    for run_id in run_ids {
        arm_scope_marker_with(conn, &run_id, task_id, std::path::Path::new(&worktree.path), case_insensitive)?;
    }
    Ok(())
}
