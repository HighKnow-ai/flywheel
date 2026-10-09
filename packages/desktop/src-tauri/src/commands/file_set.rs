//! `task_file_set_get` / `task_file_set_set` — a task's declared file-set (phase 09 plan 09-01,
//! D-147/D-148). RED-phase stub: the behaviours the tests below pin are implemented in the GREEN
//! commit.

use serde::Serialize;
use rusqlite::Connection;

/// One declared entry projected for the wire: `form` is `"file"` or `"dir"`, `path` keeps a `dir`'s
/// trailing `/`.
#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct FileSetEntryDto {
    pub form: String,
    pub path: String,
}

/// The server-side cap on a submitted set (the renderer cannot submit an unbounded one).
pub const MAX_ENTRIES: usize = 200;

pub(crate) fn get_task_file_set(
    _conn: &Connection,
    _task_id: &str,
) -> Result<Vec<FileSetEntryDto>, String> {
    Ok(Vec::new())
}

pub(crate) fn set_task_file_set(
    _conn: &mut Connection,
    _task_id: &str,
    _raw_entries: &[String],
    _actor_id: &str,
) -> Result<Vec<FileSetEntryDto>, String> {
    Err("not implemented".to_string())
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
