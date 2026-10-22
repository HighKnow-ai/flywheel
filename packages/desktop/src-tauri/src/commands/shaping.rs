//! `epic_shape` / `epic_shaping_session` — the shaping command surface (docs/mvp-spec.md §3,
//! issue #122). Shape on an Epic in Shaping starts a shaping session on it: no worktree, its working
//! directory the project's own checkout, its packet `flywheel_core::shaping_packet`, and its launch
//! flags fixed by `SessionKind::Shaping` (read-only plus the Proposal tools, `dontAsk`, the board's
//! MCP server and no permission-prompt tool). Ending it is the session surface's ordinary Stop.
//!
//! Every handler resolves the human actor server-side (T-01-04) and emits `board:changed` after a
//! successful start, so the Epic card's Shape control turns into Open session.

use rusqlite::Connection;
use serde::Serialize;
use tauri::{AppHandle, State};

use flywheel_core::domain::session::ShapingSubject;
use flywheel_core::domain::session_kind::SessionKind;

use super::session::{fail_launch, send_gated_spawn, spawn_request_in};
use super::{emit_board_changed, project_of_locked};
use crate::state::AppState;

/// A shaping session as Shape returns it.
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ShapingSessionDto {
    pub id: String,
    pub epic_id: String,
    pub status: String,
    pub permission_mode: String,
}

/// Shape on an Epic in Shaping (issue #122): start a shaping session on it.
#[tauri::command]
pub fn epic_shape(state: State<AppState>, app: AppHandle, epic_id: String) -> Result<ShapingSessionDto, String> {
    let run_id = shape_epic(&state.db, &epic_id, flywheel_core::login_path::claude_bin, |repo_path, request| {
        send_gated_spawn(&state, repo_path, request)
    })?;
    let project_id = project_of_locked(&state.db, "epics", &epic_id);
    emit_board_changed(&app, project_id.as_deref(), "session", Some(&run_id));
    Ok(ShapingSessionDto {
        id: run_id,
        epic_id,
        status: "running".to_string(),
        permission_mode: SessionKind::Shaping.launch_policy().permission_mode.to_string(),
    })
}

/// The Epic's live shaping session, if any: what the card's Open session control opens.
#[tauri::command]
pub fn epic_shaping_session(state: State<AppState>, epic_id: String) -> Result<Option<String>, String> {
    let conn = state.db.lock().map_err(|e| e.to_string())?;
    flywheel_core::domain::session::live_shaping_session(&conn, &ShapingSubject::Epic(epic_id)).map_err(|e| e.to_string())
}

/// [`epic_shape`]'s body, driven without a Tauri app handle. `find_claude` runs before anything is
/// created, so a missing `claude` refuses the Shape and writes nothing (issue #88). The core refuses
/// an Epic that is not in Shaping or already has a live shaping session, inside the transaction that
/// would insert the row. The spawn request goes out once the lock is released (the spawn floor
/// sleeps); a launch that fails after the row exists closes it `failed`, never left `running`.
pub(crate) fn shape_epic(
    db: &std::sync::Mutex<Connection>,
    epic_id: &str,
    find_claude: impl FnOnce() -> Result<std::path::PathBuf, String>,
    send: impl FnOnce(&str, &serde_json::Value) -> Result<(), String>,
) -> Result<String, String> {
    let mut conn = db.lock().map_err(|e| e.to_string())?;
    let human = flywheel_core::domain::actor::local_human_actor_id(&conn).map_err(|e| e.to_string())?;
    let (project_id, repo_path): (String, String) = conn
        .query_row(
            "SELECT e.project_id, p.repo_path FROM epics e JOIN projects p ON p.id = e.project_id WHERE e.id = ?1",
            rusqlite::params![epic_id],
            |row| Ok((row.get(0)?, row.get(1)?)),
        )
        .map_err(|_| format!("Epic {epic_id:?} not found"))?;
    find_claude()?;
    // Resolved before the row exists: a missing API key must not leave a `running` row behind.
    let env = crate::sidecar::resolved_env_for_run(&conn, &project_id).map_err(|e| e.to_string())?;

    let kind = SessionKind::Shaping;
    let session = flywheel_core::domain::session::start_shaping_session(
        &mut conn,
        &ShapingSubject::Epic(epic_id.to_string()),
        kind.launch_policy().permission_mode,
        &human,
    )
    .map_err(|e| e.to_string())?;
    let prompt = match flywheel_core::shaping_packet::build_epic_shaping_packet(&conn, epic_id) {
        Ok(prompt) => prompt,
        Err(e) => return Err(fail_launch(&mut conn, &session.id, e.to_string())),
    };
    drop(conn);

    let request = spawn_request_in(&session.id, &repo_path, &prompt, &env, kind);
    send(&repo_path, &request).map_err(|why| match db.lock() {
        Ok(mut conn) => fail_launch(&mut conn, &session.id, why),
        Err(_) => why,
    })?;
    Ok(session.id)
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::commands::session::scratch_root;

    /// A migrated database, a project whose checkout is a plain directory (a shaping session never
    /// touches git), a Milestone and an Epic in Shaping with no Story.
    fn shaping_epic() -> (std::sync::Mutex<Connection>, String, tempfile::TempDir) {
        let checkout = tempfile::tempdir().unwrap();
        let dir = tempfile::tempdir().unwrap();
        let mut conn = flywheel_core::db::open_and_migrate(&dir.path().join("flywheel.db"), &dir.path().join("backups"))
            .unwrap();
        std::mem::forget(dir);
        let human = flywheel_core::domain::actor::local_human_actor_id(&conn).unwrap();
        let project = flywheel_core::domain::project::create_project(
            &mut conn,
            &human,
            "Threadfin",
            &checkout.path().to_string_lossy(),
            "FLY",
            "main",
        )
        .unwrap();
        let m = flywheel_core::domain::milestone::create_milestone(&mut conn, &project.id, &human, "Shaping", None).unwrap();
        let epic = flywheel_core::domain::epic::create_epic(&mut conn, &human, &m.id, "Epic shaping").unwrap();
        (std::sync::Mutex::new(conn), epic.id, checkout)
    }

    fn with_scratch<T>(f: impl FnOnce() -> T) -> T {
        scratch_root::with_scratch_worktree_root(|_| {
            let runtime = tempfile::tempdir().unwrap();
            // SAFETY: serialised by the shared helper's lock and cleared before returning.
            unsafe { std::env::set_var("FLYWHEEL_RUNTIME_DIR", runtime.path()) };
            let result = f();
            unsafe { std::env::remove_var("FLYWHEEL_RUNTIME_DIR") };
            result
        })
    }

    fn found_claude() -> Result<std::path::PathBuf, String> {
        Ok(std::path::PathBuf::from("/opt/stub/claude"))
    }

    fn session_count(conn: &Connection) -> i64 {
        conn.query_row("SELECT COUNT(*) FROM sessions", [], |r| r.get(0)).unwrap()
    }

    #[test]
    fn shape_starts_a_shaping_session_in_the_checkout_with_no_worktree() {
        with_scratch(|| {
            let (db, epic_id, checkout) = shaping_epic();
            let mut sent = None;
            let run_id = shape_epic(&db, &epic_id, found_claude, |repo, request| {
                sent = Some((repo.to_string(), request.clone()));
                Ok(())
            })
            .expect("Shape starts a session");

            let conn = db.lock().unwrap();
            let (kind, story, epic, worktree, status): (String, Option<String>, Option<String>, Option<String>, String) = conn
                .query_row(
                    "SELECT kind, story_id, epic_id, worktree_id, status FROM sessions WHERE id = ?1",
                    [&run_id],
                    |r| Ok((r.get(0)?, r.get(1)?, r.get(2)?, r.get(3)?, r.get(4)?)),
                )
                .unwrap();
            assert_eq!((kind.as_str(), story, epic.as_deref(), worktree, status.as_str()), ("shaping", None, Some(epic_id.as_str()), None, "running"));
            let worktrees: i64 = conn.query_row("SELECT COUNT(*) FROM worktrees", [], |r| r.get(0)).unwrap();
            assert_eq!(worktrees, 0, "shaping creates no worktree");

            let (repo, request) = sent.expect("one spawn request");
            let checkout = checkout.path().to_string_lossy().into_owned();
            assert_eq!(repo, checkout, "the spawn floor is keyed by the project's checkout");
            assert_eq!(request["worktreePath"], serde_json::json!(checkout), "the session runs in the checkout");
            assert_eq!(request["permissionMode"], "dontAsk");
            assert_eq!(request["permissionPrompt"], false, "no permission-prompt tool");
            let denied: Vec<String> = serde_json::from_value(request["disallowedTools"].clone()).unwrap();
            assert!(denied.iter().any(|t| t == "AskUserQuestion"), "Rounds are the only way to ask: {denied:?}");
            assert!(denied.iter().any(|t| t == "Bash"), "{denied:?}");
            assert!(request["env"].get(flywheel_core::destructive::WORKTREE_ENV).is_none(), "no worktree to fence");
            assert!(request["prompt"].as_str().unwrap().starts_with("# Shaping packet: Epic "));
            assert_eq!(request["runId"], serde_json::json!(run_id));
        });
    }

    #[test]
    fn shaping_without_claude_names_the_searched_path_and_writes_nothing() {
        with_scratch(|| {
            let (db, epic_id, _checkout) = shaping_epic();
            let empty = tempfile::tempdir().unwrap();
            let searched = format!("{}:/usr/bin:/bin", empty.path().display());
            let err = shape_epic(&db, &epic_id, || flywheel_core::login_path::claude_bin_on(&searched), |_, _| {
                panic!("nothing may be spawned")
            })
            .expect_err("Shape is refused without claude");
            assert!(err.contains(&searched), "{err}");
            assert_eq!(session_count(&db.lock().unwrap()), 0);
        });
    }

    #[test]
    fn shaping_is_refused_for_an_epic_out_of_shaping_and_a_second_live_session() {
        with_scratch(|| {
            let (db, epic_id, _checkout) = shaping_epic();
            shape_epic(&db, &epic_id, found_claude, |_, _| Ok(())).unwrap();
            let err = shape_epic(&db, &epic_id, found_claude, |_, _| panic!("no second spawn")).unwrap_err();
            assert!(err.contains("already has a live shaping session"), "{err}");

            let (db, epic_id, _checkout) = shaping_epic();
            {
                let mut conn = db.lock().unwrap();
                let human = flywheel_core::domain::actor::local_human_actor_id(&conn).unwrap();
                flywheel_core::domain::epic::set_epic_state(&mut conn, &human, &epic_id, flywheel_core::domain::epic::EpicState::Ready)
                    .unwrap();
            }
            let err = shape_epic(&db, &epic_id, found_claude, |_, _| panic!("nothing may be spawned")).unwrap_err();
            assert!(err.contains("only a record in Shaping is shaped"), "{err}");
            assert_eq!(session_count(&db.lock().unwrap()), 0);
        });
    }

    #[test]
    fn a_shaping_launch_whose_spawn_fails_leaves_no_running_row_and_shape_works_again() {
        with_scratch(|| {
            let (db, epic_id, _checkout) = shaping_epic();
            let err = shape_epic(&db, &epic_id, found_claude, |_, _| Err("spawn boom".to_string())).unwrap_err();
            assert!(err.contains("spawn boom"), "{err}");
            let status: String =
                db.lock().unwrap().query_row("SELECT status FROM sessions", [], |r| r.get(0)).unwrap();
            assert_eq!(status, "failed");
            shape_epic(&db, &epic_id, found_claude, |_, _| Ok(())).expect("Shape works again");
        });
    }

    #[test]
    fn a_shaping_session_stops_through_the_session_surfaces_stop_without_a_summary() {
        with_scratch(|| {
            let (db, epic_id, _checkout) = shaping_epic();
            let run_id = shape_epic(&db, &epic_id, found_claude, |_, _| Ok(())).unwrap();
            let live = |db: &std::sync::Mutex<Connection>| {
                flywheel_core::domain::session::live_shaping_session(&db.lock().unwrap(), &ShapingSubject::Epic(epic_id.clone()))
                    .unwrap()
            };
            assert_eq!(live(&db), Some(run_id.clone()), "the card's Open session control finds it");

            let dto = crate::commands::session::stop_session_recording_first(&mut db.lock().unwrap(), &run_id, || Ok(()))
                .expect("Stop records the end");
            assert_eq!(dto.status, "interrupted");
            let summaries: i64 =
                db.lock().unwrap().query_row("SELECT COUNT(*) FROM session_summaries", [], |r| r.get(0)).unwrap();
            assert_eq!(summaries, 0, "a shaping session leaves no Session summary");
            assert_eq!(live(&db), None, "and the card offers Shape again");
        });
    }

    #[test]
    fn a_shaping_session_reads_by_id_for_the_session_surface() {
        with_scratch(|| {
            let (db, epic_id, _checkout) = shaping_epic();
            let run_id = shape_epic(&db, &epic_id, found_claude, |_, _| Ok(())).unwrap();
            let run = flywheel_core::query::sessions::run_by_id(&db.lock().unwrap(), &run_id).unwrap().unwrap();
            assert_eq!(run.story_id, None);
            assert_eq!(run.status, "running");
        });
    }
}
