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
pub mod project;
pub mod proposal;
pub mod roadmap;
pub mod settings;
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
