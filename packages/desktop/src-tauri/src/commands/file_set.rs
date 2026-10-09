//! `task_file_set_get` / `task_file_set_set` — a task's declared file-set (phase 09 plan 09-01,
//! D-147/D-148): the scope the run-time hook enforces (PLAN-04) and the plan-time overlap check
//! compares (PLAN-02). In the module convention: lock `AppState.db`, validate input shape before
//! calling into the core, resolve the actor server-side with `local_human_actor_id` (never from a
//! renderer claim, T-01-04), map core errors through [`ipc_error`], emit `board:changed` after a
//! successful mutation.
//!
//! **`task_file_set_set` is a human-only command** in the `advance_stage` family (T-09-01-08): there
//! is no MCP tool for it and no agent-reachable caller, so an agent can never widen its own scope.
//! It accepts neither a worktree path nor an absolute path — an entry is a repo-relative string that
//! `flywheel_core::file_set::parse_entry` either accepts as-is or REFUSES with a named cause; nothing
//! is ever repaired, and one refused entry stores nothing, not even the valid entries beside it.

use rusqlite::Connection;
use serde::Serialize;
use tauri::{AppHandle, Emitter, State};

use super::ipc_error;
use crate::state::AppState;

/// One declared entry projected for the wire: `form` is `"file"` or `"dir"`, `path` keeps a `dir`'s
/// trailing `/`.
#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct FileSetEntryDto {
    pub form: String,
    pub path: String,
}

/// The server-side cap on a submitted set, so a renderer cannot submit an unbounded one.
pub const MAX_ENTRIES: usize = 200;

fn validate_task_id(task_id: &str) -> Result<(), String> {
    if flywheel_core::ids::is_ulid(task_id) {
        Ok(())
    } else {
        Err(format!("task id must be a 26-character ULID, got {task_id:?}"))
    }
}

/// A task's declared entries, in the order they were stored. A task that does not exist has none.
pub(crate) fn get_task_file_set(
    conn: &Connection,
    task_id: &str,
) -> Result<Vec<FileSetEntryDto>, String> {
    validate_task_id(task_id)?;
    let entries = flywheel_core::domain::file_set::list_entries_for_task(conn, task_id)
        .map_err(|e| ipc_error("task_file_set_get:read", e))?;
    Ok(entries
        .iter()
        .map(|e| FileSetEntryDto {
            form: flywheel_core::file_set::entry_form(e).to_string(),
            path: flywheel_core::file_set::entry_path(e).to_string(),
        })
        .collect())
}

/// Replace a task's declared set with `raw_entries`. Every string goes through `parse_entry`; the
/// first refusal, in submission order, is returned as its named cause and NOTHING is stored.
pub(crate) fn set_task_file_set(
    conn: &mut Connection,
    task_id: &str,
    raw_entries: &[String],
    actor_id: &str,
) -> Result<Vec<FileSetEntryDto>, String> {
    validate_task_id(task_id)?;
    if raw_entries.len() > MAX_ENTRIES {
        return Err(format!(
            "a file-set holds at most {MAX_ENTRIES} entries, got {}",
            raw_entries.len()
        ));
    }
    let mut parsed = Vec::with_capacity(raw_entries.len());
    for raw in raw_entries {
        let entry = flywheel_core::file_set::parse_entry(raw)
            .map_err(|refusal| format!("file-set entry {raw:?} refused: {refusal}"))?;
        parsed.push(entry);
    }

    let exists: bool = conn
        .query_row("SELECT 1 FROM tasks WHERE id = ?1", rusqlite::params![task_id], |_| Ok(true))
        .or_else(|e| match e {
            rusqlite::Error::QueryReturnedNoRows => Ok(false),
            other => Err(other),
        })
        .map_err(|e| ipc_error("task_file_set_set:lookup", e))?;
    if !exists {
        return Err(format!("task {task_id:?} was not found"));
    }

    flywheel_core::domain::file_set::declare_file_set(conn, task_id, &parsed, actor_id)
        .map_err(|e| ipc_error("task_file_set_set:declare", e))?;
    get_task_file_set(conn, task_id)
}

/// Read a task's declared file-set. Read-only.
#[tauri::command]
pub fn task_file_set_get(
    state: State<AppState>,
    task_id: String,
) -> Result<Vec<FileSetEntryDto>, String> {
    let conn = state.db.lock().map_err(|e| ipc_error("task_file_set_get:lock", e))?;
    get_task_file_set(&conn, &task_id)
}

/// Replace a task's declared file-set with `entries`; an empty list clears it (the task's next run
/// starts unarmed, D-150). Human-only — see this module's doc comment.
#[tauri::command]
pub fn task_file_set_set(
    state: State<AppState>,
    app: AppHandle,
    task_id: String,
    entries: Vec<String>,
) -> Result<Vec<FileSetEntryDto>, String> {
    let mut conn = state.db.lock().map_err(|e| ipc_error("task_file_set_set:lock", e))?;
    let actor_id = flywheel_core::domain::actor::local_human_actor_id(&conn)
        .map_err(|e| ipc_error("task_file_set_set:actor", e))?;
    let stored = set_task_file_set(&mut conn, &task_id, &entries, &actor_id)?;
    app.emit("board:changed", serde_json::json!({ "entity": "task", "id": task_id })).ok();
    Ok(stored)
}

#[cfg(test)]
mod tests {
    use super::*;

    /// A fresh migrated database with one project and one task. Returns the connection, the human
    /// actor id and the task id.
    fn seeded() -> (Connection, String, String) {
        let dir = tempfile::tempdir().expect("scratch dir");
        let db_path = dir.path().join("flywheel.db");
        let backups_dir = dir.path().join("backups");
        std::mem::forget(dir);
        let mut conn = flywheel_core::db::open_and_migrate(&db_path, &backups_dir)
            .expect("open_and_migrate should succeed");
        let actor = flywheel_core::domain::actor::local_human_actor_id(&conn).expect("human actor");
        let project = flywheel_core::domain::project::create_project(
            &mut conn, &actor, "Test Project", "/repo", "FLY", "main",
        )
        .expect("create_project");
        let task = flywheel_core::domain::task::create_task(&mut conn, &project.id, &actor, "T", None)
            .expect("create_task");
        (conn, actor, task.id)
    }

    fn strings(raw: &[&str]) -> Vec<String> {
        raw.iter().map(|s| s.to_string()).collect()
    }

    fn event_payloads(conn: &Connection, task_id: &str) -> Vec<serde_json::Value> {
        let mut stmt = conn
            .prepare("SELECT payload FROM events WHERE task_id = ?1 AND event_type = 'task.file_set_declared' ORDER BY sequence")
            .unwrap();
        stmt.query_map(rusqlite::params![task_id], |r| r.get::<_, String>(0))
            .unwrap()
            .map(|p| serde_json::from_str(&p.unwrap()).unwrap())
            .collect()
    }

    fn dto(form: &str, path: &str) -> FileSetEntryDto {
        FileSetEntryDto { form: form.to_string(), path: path.to_string() }
    }

    #[test]
    fn a_set_of_two_valid_entries_is_stored_as_two_rows_and_one_event() {
        let (mut conn, actor, task_id) = seeded();

        let stored = set_task_file_set(
            &mut conn,
            &task_id,
            &strings(&["packages/core/src/domain/", "packages/core/src/lib.rs"]),
            &actor,
        )
        .expect("two valid entries are accepted");

        assert_eq!(
            stored,
            vec![dto("dir", "packages/core/src/domain/"), dto("file", "packages/core/src/lib.rs")]
        );
        assert_eq!(get_task_file_set(&conn, &task_id).unwrap(), stored);
        let rows: i64 = conn
            .query_row("SELECT COUNT(*) FROM task_file_set_entries WHERE task_id = ?1", rusqlite::params![task_id], |r| r.get(0))
            .unwrap();
        assert_eq!(rows, 2);
        assert_eq!(event_payloads(&conn, &task_id).len(), 1, "exactly one event, in the same transaction");
    }

    #[test]
    fn a_glob_entry_is_refused_with_its_named_cause_and_nothing_is_stored_not_even_the_valid_ones() {
        let (mut conn, actor, task_id) = seeded();
        set_task_file_set(&mut conn, &task_id, &strings(&["kept/"]), &actor).expect("a first valid set");

        let err = set_task_file_set(&mut conn, &task_id, &strings(&["fine/path.rs", "src/*.rs"]), &actor)
            .expect_err("a glob must be refused");

        assert!(err.contains("glob"), "the refusal names the glob cause: {err}");
        assert!(err.contains('*'), "the refusal names the offending character: {err}");
        assert_eq!(
            get_task_file_set(&conn, &task_id).unwrap(),
            vec![dto("dir", "kept/")],
            "the set stored before the refused call is untouched"
        );
        assert_eq!(event_payloads(&conn, &task_id).len(), 1, "the refused call appended no event");
    }

    #[test]
    fn the_first_refusal_in_submission_order_is_the_one_reported() {
        let (mut conn, actor, task_id) = seeded();
        let err = set_task_file_set(&mut conn, &task_id, &strings(&["/abs/path", "src/*.rs"]), &actor)
            .expect_err("refused");
        assert!(err.contains("absolute"), "{err}");
    }

    #[test]
    fn resubmitting_replaces_the_rows_and_records_the_previous_list_as_before() {
        let (mut conn, actor, task_id) = seeded();
        set_task_file_set(&mut conn, &task_id, &strings(&["a.rs", "b/"]), &actor).unwrap();

        let stored = set_task_file_set(&mut conn, &task_id, &strings(&["c.rs"]), &actor).unwrap();

        assert_eq!(stored, vec![dto("file", "c.rs")]);
        let events = event_payloads(&conn, &task_id);
        assert_eq!(events.len(), 2);
        assert_eq!(events[1]["before"], serde_json::json!(["a.rs", "b/"]));
        assert_eq!(events[1]["after"], serde_json::json!(["c.rs"]));
    }

    #[test]
    fn submitting_an_empty_list_clears_the_set() {
        let (mut conn, actor, task_id) = seeded();
        set_task_file_set(&mut conn, &task_id, &strings(&["a.rs"]), &actor).unwrap();

        let stored = set_task_file_set(&mut conn, &task_id, &[], &actor).unwrap();

        assert!(stored.is_empty());
        assert!(get_task_file_set(&conn, &task_id).unwrap().is_empty());
    }

    #[test]
    fn a_task_id_that_does_not_exist_is_refused_without_a_panic() {
        let (mut conn, actor, _task_id) = seeded();
        let missing = flywheel_core::ids::new_id();

        let err = set_task_file_set(&mut conn, &missing, &strings(&["a.rs"]), &actor)
            .expect_err("an unknown task is refused");
        assert!(err.contains("task"), "the refusal names the task: {err}");
        assert!(get_task_file_set(&conn, &missing).unwrap().is_empty());
    }

    #[test]
    fn a_task_id_that_is_not_ulid_shaped_is_refused_before_the_database_is_touched() {
        let (mut conn, actor, _task_id) = seeded();
        for bad in ["", "not-a-ulid", "../../etc", "a'; DROP TABLE tasks;--"] {
            let err = set_task_file_set(&mut conn, bad, &strings(&["a.rs"]), &actor)
                .expect_err("a malformed task id is refused");
            assert!(err.contains("task id"), "{bad:?}: {err}");
            assert!(get_task_file_set(&conn, bad).is_err(), "{bad:?}: the read refuses it too");
        }
    }

    #[test]
    fn a_set_over_the_server_side_cap_is_refused_and_nothing_is_stored() {
        let (mut conn, actor, task_id) = seeded();
        let too_many: Vec<String> = (0..=MAX_ENTRIES).map(|i| format!("dir{i}/")).collect();

        let err = set_task_file_set(&mut conn, &task_id, &too_many, &actor).expect_err("over the cap");
        assert!(err.contains(&MAX_ENTRIES.to_string()), "{err}");
        assert!(get_task_file_set(&conn, &task_id).unwrap().is_empty());

        let at_cap: Vec<String> = (0..MAX_ENTRIES).map(|i| format!("dir{i}/")).collect();
        let stored = set_task_file_set(&mut conn, &task_id, &at_cap, &actor).expect("exactly at the cap is fine");
        assert_eq!(stored.len(), MAX_ENTRIES);
    }

    #[test]
    fn one_tasks_set_never_leaks_into_another_tasks_read() {
        let (mut conn, actor, task_id) = seeded();
        let project_id: String = conn
            .query_row("SELECT project_id FROM tasks WHERE id = ?1", rusqlite::params![task_id], |r| r.get(0))
            .unwrap();
        let other = flywheel_core::domain::task::create_task(&mut conn, &project_id, &actor, "Other", None).unwrap();

        set_task_file_set(&mut conn, &task_id, &strings(&["mine.rs"]), &actor).unwrap();
        assert!(get_task_file_set(&conn, &other.id).unwrap().is_empty());
    }

    /// The command that stores a set is human-only: no actor argument, no worktree path, no
    /// absolute path (T-09-01-08). Asserted over this file's own source so a later edit that adds
    /// an `actor_id` parameter to the handler goes red.
    #[test]
    fn the_command_handlers_accept_no_actor_and_no_path_argument() {
        let source = include_str!("file_set.rs");
        let code: Vec<&str> = source.lines().filter(|l| !l.trim_start().starts_with("//")).collect();
        let start = code
            .iter()
            .position(|l| l.trim_start().starts_with("pub fn task_file_set_set("))
            .expect("the task_file_set_set command handler must exist");
        let mut signature = String::new();
        for line in &code[start..] {
            signature.push_str(line);
            signature.push(' ');
            if line.contains('{') {
                break;
            }
        }
        assert!(!signature.contains("actor"), "no renderer-supplied actor: {signature}");
        assert!(!signature.contains("worktree"), "no worktree path: {signature}");
        assert!(!signature.contains("path"), "no path argument: {signature}");
    }
}
