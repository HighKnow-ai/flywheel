//! `#[tauri::command]` handlers, one module per entity — the only code in `packages/desktop`
//! that calls into `packages/core`'s mutation functions. Every handler locks `AppState.db`,
//! validates its input shape and length before calling into the core, stamps `actor_id` from the
//! local human actor on the Rust side (T-01-04, never from a renderer-supplied claim), and, after
//! a successful mutation, emits `board:changed` (D-04). A handler whose core error can carry a git
//! stderr or a filesystem path maps it through [`ipc_error`], so neither crosses IPC.
//!
//! The record commands follow `GLOSSARY.md`: `roadmap` (Milestones), `epic`, `story`, `criterion`
//! (Acceptance criteria and their Checks), `task` (the Story checklist) and `proposal`.

pub mod actor;
pub mod session;
pub mod criterion;
pub mod epic;
pub mod events;
pub mod fleet;
pub mod git_identity;
pub mod git_truth;
pub mod handoff;
pub mod menu;
pub mod needs_you;
pub mod project;
pub mod proposal;
pub mod review;
pub mod roadmap;
pub mod roadmap_round;
pub mod settings;
pub mod shaping;
pub mod story;
pub mod task;
pub mod worktree_open;

/// The longest title a record command accepts, in characters.
pub(crate) const MAX_TITLE_LEN: usize = 500;
/// The longest prose field (a spec part, an exit test, a statement) a record command accepts.
pub(crate) const MAX_PROSE_LEN: usize = 20_000;

/// Refuse an empty (after trimming) or over-long text argument before it reaches the core, naming
/// the field, the limit and the actual length.
pub(crate) fn validate_text(field: &str, value: &str, max_chars: usize) -> Result<(), String> {
    let count = value.trim().chars().count();
    if count == 0 || count > max_chars {
        return Err(format!("{field} must be 1-{max_chars} characters, got {count}"));
    }
    Ok(())
}

/// Map a core error to the string a handler returns to the renderer (T-07-08-01, T-08-08-06): the
/// full cause chain goes to the process log, and only the fixed category `failed:<context>` crosses
/// IPC. This generalises `forge::forge_error_code`, which does the same for the four forge CLI
/// categories. `git_at` errors carry the repository path, the argv and git's stderr, so forwarding
/// `to_string()` would hand the webview the user's home path.
///
/// `context` must be a fixed literal (`"review_files:git"`) — never a path, a branch, a sha or CLI
/// output — or the category itself becomes the leak. `impl Display` accepts both an
/// `anyhow::Error` (`{:#}` prints its whole chain) and the `PoisonError` of a failed `db.lock()`.
pub(crate) fn ipc_error(context: &str, e: impl std::fmt::Display) -> String {
    eprintln!("{context}: {e:#}");
    format!("failed:{context}")
}

/// The ONE place in this crate that names the `board:changed` event string (FNC-07, F8). The
/// payload is `{ projectId, entity, id }` — camelCase, the DTO mirror convention — so the renderer
/// can route a change to the readers it affects instead of invalidating every subscriber on every
/// event. `project_id: None` serialises `projectId` as JSON `null` and means "broadcast": an
/// emitter with genuinely no project scope says so explicitly, and the renderer refreshes
/// everything rather than dropping the event. `tests/board_changed_payload.rs` fails the build if
/// any other module names the event string, or calls this without declaring its scope.
pub fn emit_board_changed(
    app: &tauri::AppHandle,
    project_id: Option<&str>,
    entity: &str,
    id: Option<&str>,
) {
    use tauri::Emitter;
    app.emit(
        "board:changed",
        serde_json::json!({ "projectId": project_id, "entity": entity, "id": id }),
    )
    .ok();
}

/// The project a row belongs to, read on a connection the caller already holds so a notification
/// never opens a second one. `table` is one of the fixed literals below (never caller-supplied
/// text); any other table, or a row that no longer exists, resolves to `None`, which the emit
/// helper turns into a broadcast. Read BEFORE a delete — the row is gone afterwards.
pub(crate) fn project_of(conn: &rusqlite::Connection, table: &str, id: &str) -> Option<String> {
    let sql = match table {
        "milestones" => "SELECT project_id FROM milestones WHERE id = ?1",
        "epics" => "SELECT project_id FROM epics WHERE id = ?1",
        "stories" => "SELECT project_id FROM stories WHERE id = ?1",
        "tasks" => "SELECT s.project_id FROM tasks t JOIN stories s ON s.id = t.story_id WHERE t.id = ?1",
        "acceptance_criteria" => {
            "SELECT s.project_id FROM acceptance_criteria c JOIN stories s ON s.id = c.story_id WHERE c.id = ?1"
        }
        "proposals" => "SELECT project_id FROM proposals WHERE id = ?1",
        "sessions" => "SELECT project_id FROM sessions WHERE id = ?1",
        "stages" => "SELECT project_id FROM stages WHERE id = ?1",
        "worktrees" => "SELECT project_id FROM worktrees WHERE id = ?1",
        "permission_rules" => "SELECT project_id FROM permission_rules WHERE id = ?1",
        _ => return None,
    };
    conn.query_row(sql, [id], |r| r.get::<_, String>(0)).ok()
}

/// [`project_of`] for a caller that holds no connection. Takes the lock itself, so it must NEVER
/// be called while the caller already holds `db` (a re-lock on the same thread deadlocks). A
/// poisoned lock resolves to `None`: the emit helper then broadcasts, so the event is never lost.
pub(crate) fn project_of_locked(
    db: &std::sync::Mutex<rusqlite::Connection>,
    table: &str,
    id: &str,
) -> Option<String> {
    let conn = db.lock().ok()?;
    project_of(&conn, table, id)
}

/// A connection of its own on the board database, for a command whose work runs git or a process
/// between its reads and writes (issue #215, ADR 0024). The shared `AppState.db` mutex is held only
/// to read the database file's path, so no other command waits behind that git. In WAL mode this
/// connection's reads run beside the shared one's; its writes are the core's own short
/// transactions, never one held across git.
///
/// The board-wide mutex used to be what kept two such commands on one Story apart (two Starts, a
/// Start and a Drop); hold [`story_work`] for that.
pub(crate) fn side_connection(db: &std::sync::Mutex<rusqlite::Connection>) -> Result<rusqlite::Connection, String> {
    let path = {
        let conn = db.lock().map_err(|e| ipc_error("side_connection:lock", e))?;
        conn.path().filter(|p| !p.is_empty()).map(std::path::PathBuf::from)
    };
    let path = path.ok_or_else(|| "the board database has no file to open a second connection on".to_string())?;
    let conn = rusqlite::Connection::open(&path).map_err(|e| ipc_error("side_connection:open", e))?;
    flywheel_core::db::apply_pragmas(&conn).map_err(|e| ipc_error("side_connection:pragmas", e))?;
    Ok(conn)
}

/// The lock that serialises the commands doing git work on one Story's worktree and records (a
/// Start against a second Start, a Resume, a Request changes, a Drop, a worktree Remove or
/// Recreate), now that they run on a [`side_connection`] rather than under the board-wide mutex.
/// It is per Story: work on one Story never waits for another's.
pub(crate) fn story_work(story_id: &str) -> std::sync::Arc<std::sync::Mutex<()>> {
    use std::collections::HashMap;
    use std::sync::{Arc, Mutex, OnceLock};
    static LOCKS: OnceLock<Mutex<HashMap<String, Arc<Mutex<()>>>>> = OnceLock::new();
    let mut locks = LOCKS.get_or_init(|| Mutex::new(HashMap::new())).lock().unwrap_or_else(|p| p.into_inner());
    Arc::clone(locks.entry(story_id.to_string()).or_default())
}

/// Run `work` holding `story_id`'s [`story_work`] lock. A panic that poisoned it left nothing half
/// done that the lock guards, so a poisoned lock is taken as is.
pub(crate) fn with_story_work<T>(story_id: &str, work: impl FnOnce() -> T) -> T {
    let lock = story_work(story_id);
    let _held = lock.lock().unwrap_or_else(|p| p.into_inner());
    work()
}
