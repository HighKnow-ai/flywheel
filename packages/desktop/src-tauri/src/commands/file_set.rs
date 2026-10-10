//! `task_file_set_get` / `task_file_set_set` — a task's declared file-set (phase 09 plan 09-01,
//! D-147/D-148): the scope the run-time hook enforces (PLAN-04) and the plan-time overlap check
//! compares (PLAN-02). In the module convention: lock `AppState.db`, validate input shape before
//! calling into the core, resolve the actor server-side with `local_human_actor_id` (never from a
//! renderer claim, T-01-04), map core errors through [`ipc_error`], emit `board:changed` after a
//! successful mutation.
//!
//! **`task_file_set_set` and `task_file_set_widen` are human-only commands** in the `advance_stage` family (T-09-01-08): there
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

/// The outcome of a widen, projected for the wire. The renderer renders this and decides nothing:
/// `status` is `accepted`, `refused` or `marker_not_rewritten`.
#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct WidenResultDto {
    pub status: String,
    /// The task's full declared set after an accepted (or partially accepted) widen.
    pub entries: Vec<String>,
    /// A refusal's reason in words, ready to display.
    pub refusal: Option<String>,
    /// The other task's entry the candidate collided with.
    pub colliding_path: Option<String>,
    pub other_task_key: Option<String>,
    /// Set when the widen committed but the enforcement marker could not be rewritten.
    pub marker_error: Option<String>,
}

/// The longest entry string a widen accepts. `parse_entry` has no length bound of its own.
const MAX_ENTRY_CHARS: usize = 1024;

pub(crate) fn widen_task_file_set(
    conn: &mut Connection,
    task_id: &str,
    entry: &str,
    actor_id: &str,
) -> Result<WidenResultDto, String> {
    use flywheel_core::domain::file_set::{widen_file_set, WidenOutcome, WidenRefusal};

    validate_task_id(task_id)?;
    if entry.chars().count() > MAX_ENTRY_CHARS {
        return Err(format!("a file-set entry holds at most {MAX_ENTRY_CHARS} characters"));
    }
    let dto = |status: &str| WidenResultDto {
        status: status.to_string(),
        entries: Vec::new(),
        refusal: None,
        colliding_path: None,
        other_task_key: None,
        marker_error: None,
    };
    match widen_file_set(conn, task_id, entry, actor_id)
        .map_err(|e| ipc_error("task_file_set_widen:widen", e))?
    {
        WidenOutcome::Accepted { entries } => Ok(WidenResultDto { entries, ..dto("accepted") }),
        WidenOutcome::MarkerNotRewritten { entries, error } => Ok(WidenResultDto {
            entries,
            marker_error: Some(error),
            ..dto("marker_not_rewritten")
        }),
        WidenOutcome::Refused(WidenRefusal::InvalidEntry { entry, cause }) => Ok(WidenResultDto {
            refusal: Some(format!("file-set entry {entry:?} refused: {cause}")),
            ..dto("refused")
        }),
        WidenOutcome::Refused(WidenRefusal::Collision { entry, colliding_path, other_task_key, .. }) => {
            Ok(WidenResultDto {
                refusal: Some(format!(
                    "{entry} overlaps {colliding_path}, which {other_task_key} is running against"
                )),
                colliding_path: Some(colliding_path),
                other_task_key: Some(other_task_key),
                ..dto("refused")
            })
        }
    }
}

/// Widen a task's declared file-set by one entry, live; takes effect on the agent's next tool call.
/// Refused when the entry overlaps any in-flight task's set. Human-only — see this module's doc
/// comment: no MCP tool, no agent-reachable caller, actor resolved here.
#[tauri::command]
pub fn task_file_set_widen(
    state: State<AppState>,
    app: AppHandle,
    task_id: String,
    entry: String,
) -> Result<WidenResultDto, String> {
    let mut conn = state.db.lock().map_err(|e| ipc_error("task_file_set_widen:lock", e))?;
    let actor_id = flywheel_core::domain::actor::local_human_actor_id(&conn)
        .map_err(|e| ipc_error("task_file_set_widen:actor", e))?;
    let result = widen_task_file_set(&mut conn, &task_id, &entry, &actor_id)?;
    if result.status != "refused" {
        app.emit("board:changed", serde_json::json!({ "entity": "task", "id": task_id })).ok();
    }
    Ok(result)
}

/// One task's refusal count for the board badge. Tasks with none are not sent.
#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ScopeFlagDto {
    pub task_id: String,
    pub count: i64,
}

/// The server-side cap on one board sweep of refusal counts.
const SCOPE_FLAGS_WINDOW: i64 = 1000;

/// Per-task scope-refusal counts for one project, read once per board read. Read-only: a project
/// id in and nothing else; the window is capped here.
#[tauri::command]
pub fn board_scope_flags(
    state: State<AppState>,
    project_id: String,
) -> Result<Vec<ScopeFlagDto>, String> {
    let conn = state.db.lock().map_err(|e| ipc_error("board_scope_flags:lock", e))?;
    let counts = flywheel_core::query::scope::scope_denied_counts(&conn, &project_id, SCOPE_FLAGS_WINDOW)
        .map_err(|e| ipc_error("board_scope_flags:read", e))?;
    Ok(counts.into_iter().map(|c| ScopeFlagDto { task_id: c.task_id, count: c.count }).collect())
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
    /// A `running` agent run for `task_id`, inserted directly: the handler only reads run status.
    fn give_live_run(conn: &Connection, task_id: &str, actor: &str) {
        let (project_id, agent): (String, String) = (
            conn.query_row("SELECT project_id FROM tasks WHERE id = ?1", rusqlite::params![task_id], |r| r.get(0)).unwrap(),
            flywheel_core::domain::agent_run::agent_actor_id(conn).unwrap(),
        );
        let (trigger_id, run_id) = (flywheel_core::ids::new_id(), flywheel_core::ids::new_id());
        let now = "2026-01-01T00:00:00.000Z";
        conn.execute(
            "INSERT INTO triggers (id, project_id, target_task_id, source, config, enabled, last_fired_at, created_by, created_at)
             VALUES (?1, ?2, ?3, 'user_action', NULL, 1, NULL, ?4, ?5)",
            rusqlite::params![trigger_id, project_id, task_id, actor, now],
        )
        .unwrap();
        conn.execute(
            "INSERT INTO agent_runs (id, worktree_id, task_id, project_id, trigger_id, adapter, actor_id, status,
                external_session_id, permission_mode, cost_usd, tokens_in, tokens_out, log_path, started_at, ended_at)
             VALUES (?1, NULL, ?2, ?3, ?4, 'claude_code', ?5, 'running', NULL, 'default', NULL, NULL, NULL, '/tmp/x.jsonl', ?6, NULL)",
            rusqlite::params![run_id, task_id, project_id, trigger_id, agent, now],
        )
        .unwrap();
    }

    #[test]
    fn replacing_the_set_of_a_task_with_a_live_run_reaches_the_renderer_as_a_readable_refusal() {
        let (mut conn, actor, task_id) = seeded();
        set_task_file_set(&mut conn, &task_id, &strings(&["src/a/"]), &actor).unwrap();
        give_live_run(&conn, &task_id, &actor);

        let message = set_task_file_set(&mut conn, &task_id, &strings(&["src/b/"]), &actor)
            .expect_err("the declare is refused while the run is live");

        assert!(!message.starts_with("failed:"), "the renderer must see the reason, not an opaque code: {message}");
        assert!(message.to_lowercase().contains("widen"), "points at the widen path: {message}");
        assert_eq!(get_task_file_set(&conn, &task_id).unwrap(), vec![dto("dir", "src/a/")], "stored set untouched");
        assert_eq!(event_payloads(&conn, &task_id).len(), 1, "no second declared event");
    }

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

    #[test]
    fn a_widen_with_no_collision_is_accepted_and_returns_the_new_set() {
        let (mut conn, actor, task_id) = seeded();
        set_task_file_set(&mut conn, &task_id, &strings(&["a/"]), &actor).unwrap();
        let r = widen_task_file_set(&mut conn, &task_id, "b.rs", &actor).unwrap();
        assert_eq!(r.status, "accepted");
        assert_eq!(r.entries, vec!["a/".to_string(), "b.rs".to_string()]);
        assert!(r.refusal.is_none());
    }

    #[test]
    fn a_glob_widen_is_a_refusal_the_renderer_can_show_not_an_ipc_error() {
        let (mut conn, actor, task_id) = seeded();
        let r = widen_task_file_set(&mut conn, &task_id, "src/*.rs", &actor).unwrap();
        assert_eq!(r.status, "refused");
        assert!(r.refusal.unwrap().contains("glob"));
    }

    #[test]
    fn a_malformed_task_id_and_an_oversized_entry_are_refused_before_the_database() {
        let (mut conn, actor, task_id) = seeded();
        assert!(widen_task_file_set(&mut conn, "../x", "a.rs", &actor).unwrap_err().contains("task id"));
        let long = "a".repeat(MAX_ENTRY_CHARS + 1);
        assert!(widen_task_file_set(&mut conn, &task_id, &long, &actor).is_err());
    }

    #[test]
    fn the_widen_handler_accepts_no_actor_and_no_path_argument() {
        let source = include_str!("file_set.rs");
        let code: Vec<&str> = source.lines().filter(|l| !l.trim_start().starts_with("//")).collect();
        let start = code
            .iter()
            .position(|l| l.trim_start().starts_with("pub fn task_file_set_widen("))
            .expect("the task_file_set_widen command handler must exist");
        let mut signature = String::new();
        for line in &code[start..] {
            signature.push_str(line);
            signature.push(' ');
            if line.contains('{') {
                break;
            }
        }
        assert!(!signature.contains("actor"), "no renderer-supplied actor: {signature}");
        assert!(!signature.contains("marker"), "no marker path: {signature}");
        assert!(!signature.contains("worktree"), "no worktree path: {signature}");
    }

    #[test]
    fn the_scope_flags_handler_accepts_a_project_id_and_nothing_else() {
        let source = include_str!("file_set.rs");
        let code: Vec<&str> = source.lines().filter(|l| !l.trim_start().starts_with("//")).collect();
        let start = code
            .iter()
            .position(|l| l.trim_start().starts_with("pub fn board_scope_flags("))
            .expect("the board_scope_flags command handler must exist");
        let mut signature = String::new();
        for line in &code[start..] {
            signature.push_str(line);
            signature.push(' ');
            if line.contains('{') {
                break;
            }
        }
        assert!(signature.contains("project_id"));
        for banned in ["path", "task_id", "limit", "actor"] {
            assert!(!signature.contains(banned), "no {banned} argument: {signature}");
        }
    }
}
