//! The Tauri-facing half of the hand-off and the feedback-only Check run (issue #53,
//! docs/mvp-spec.md §4.4). `task.rs`'s board tool handler sends both tools here; the work runs on
//! its own thread because a Check may take its full ten minutes, and the database lock is held only
//! to read the plan and to write the result, never while a Check runs.

use std::sync::Mutex;

use flywheel_core::domain::handoff::{
    batch_as_tool_result, complete_handoff, handoff_as_tool_result, plan_feedback_run, plan_handoff, run_checks,
    HandoffToolCall,
};
use rusqlite::Connection;
use serde_json::{json, Value};
use tauri::AppHandle;

use super::emit_board_changed;
use super::task::send_board_tool_answer;
use crate::state::AppState;

/// Run one hand-off tool call against `db`: `{result}` or `{error}` for the agent, and the project
/// whose board changed (a hand-off only; a feedback run records nothing).
pub fn answer_handoff_tool_call(db: &Mutex<Connection>, run_id: &str, tool: &str, args: &Value) -> (Value, Option<String>) {
    match run_call(db, run_id, tool, args) {
        Ok(answer) => answer,
        // The reason goes to the agent so it can correct its call.
        Err(e) => (json!({ "error": format!("{e:#}") }), None),
    }
}

fn run_call(db: &Mutex<Connection>, run_id: &str, tool: &str, args: &Value) -> anyhow::Result<(Value, Option<String>)> {
    let lock = || db.lock().map_err(|_| anyhow::anyhow!("the board database is unavailable"));
    match HandoffToolCall::parse(tool, args)? {
        HandoffToolCall::ChecksRun => {
            let plan = plan_feedback_run(&*lock()?, run_id)?;
            let batch = run_checks(&plan)?;
            let mut result = batch_as_tool_result(&batch);
            result["recorded"] = Value::Bool(false);
            Ok((json!({ "result": result }), None))
        }
        HandoffToolCall::Handoff { next_session_must_know, decisions } => {
            let plan = plan_handoff(&*lock()?, run_id)?;
            let batch = run_checks(&plan)?;
            let outcome = complete_handoff(&mut *lock()?, &plan, &next_session_must_know, &decisions, batch)?;
            Ok((json!({ "result": handoff_as_tool_result(&outcome) }), Some(outcome.project_id)))
        }
    }
}

/// Answer a hand-off tool call on its own thread, then emit `board:changed` when the Story moved.
pub fn spawn_handoff_tool_call(app: AppHandle, run_id: String, request_id: String, tool: String, args: Value) {
    std::thread::spawn(move || {
        let Some(state) = tauri::Manager::try_state::<AppState>(&app) else { return };
        let (answer, changed) = answer_handoff_tool_call(&state.db, &run_id, &tool, &args);
        send_board_tool_answer(&app, &run_id, &request_id, &answer);
        if let Some(project_id) = changed {
            emit_board_changed(&app, Some(&project_id), "story", None);
        }
    });
}

#[cfg(test)]
mod tests {
    use super::*;
    // The one shared scratch worktree-root helper, so its lock serialises these tests with every
    // other test of this binary that sets the worktree root.
    use crate::commands::session::scratch_root;
    use flywheel_core::domain::{actor, check, epic, milestone, project, session, story, task};

    /// A Running Story in a real git repository, with a `true` and a `false` Check, a done Task and a
    /// live session. Returns the database, the run id, the project id and the Check ids.
    fn running_story(repo: &std::path::Path, db_dir: &std::path::Path) -> (Mutex<Connection>, String, String, Vec<String>) {
        let git = |args: &[&str]| {
            flywheel_core::git::git_at(repo, args).unwrap();
        };
        git(&["init", "--initial-branch=main"]);
        std::fs::write(repo.join("README.md"), "fixture\n").unwrap();
        git(&["add", "README.md"]);
        git(&["-c", "user.name=F", "-c", "user.email=f@flywheel.test", "commit", "-m", "initial"]);

        let mut conn = flywheel_core::db::open_and_migrate(&db_dir.join("flywheel.db"), &db_dir.join("backups")).unwrap();
        let human = actor::local_human_actor_id(&conn).unwrap();
        let p = project::create_project(&mut conn, &human, "P", &repo.to_string_lossy(), "FLY", "main").unwrap();
        let m = milestone::create_milestone(&mut conn, &p.id, &human, "M", None).unwrap();
        let e = epic::create_epic(&mut conn, &human, &m.id, "E").unwrap();
        // Written the way the developer writes a Story by hand, Checks included.
        let criteria = ["true", "false"]
            .map(|command| story::HandWrittenCriterion { statement: command, check_command: Some(command) });
        let s = story::write_story_by_hand(&mut conn, &human, &e.id, "S", None, &criteria).unwrap();
        let checks = check::checks_for_story(&conn, &s.id).unwrap().into_iter().map(|c| c.id).collect();
        story::set_story_state(&mut conn, &human, &s.id, story::StoryState::Running).unwrap();
        let run = session::start_session(&mut conn, &s.id, "acceptEdits", &human).unwrap();
        let agent = session::agent_actor_id(&conn).unwrap();
        let t = task::add_task(&mut conn, &agent, &s.id, "Work").unwrap();
        task::set_task_state(&mut conn, &agent, &t.id, task::TaskState::Done, None).unwrap();
        (Mutex::new(conn), run.id, p.id, checks)
    }

    #[test]
    fn a_feedback_run_answers_the_results_and_a_hand_off_records_them_and_moves_the_story() {
        scratch_root::with_scratch_worktree_root(|_| {
            let (repo, db_dir) = (tempfile::tempdir().unwrap(), tempfile::tempdir().unwrap());
            let (db, run_id, project_id, checks) = running_story(repo.path(), db_dir.path());

            let (answer, changed) = answer_handoff_tool_call(&db, &run_id, "checks_run", &json!({}));
            assert_eq!(changed, None, "a feedback run changes nothing on the board");
            assert_eq!(answer["result"]["recorded"], false);
            let results: Vec<&str> =
                answer["result"]["checks"].as_array().unwrap().iter().map(|c| c["result"].as_str().unwrap()).collect();
            assert_eq!(results, ["passed", "failed"]);
            let current = check::current_result(&db.lock().unwrap(), &checks[0]).unwrap();
            assert_eq!(current.result, check::CheckResult::NotRun);

            let (answer, changed) = answer_handoff_tool_call(
                &db,
                &run_id,
                "handoff",
                &json!({ "next_session_must_know": "Half the parser.", "decisions": "" }),
            );
            assert_eq!(changed.as_deref(), Some(project_id.as_str()), "{answer}");
            assert_eq!(answer["result"]["story_state"], "in_review");
            let conn = db.lock().unwrap();
            assert_eq!(check::current_result(&conn, &checks[1]).unwrap().result, check::CheckResult::Failed);
        });
    }

    #[test]
    fn a_refused_call_answers_the_reason() {
        let db_dir = tempfile::tempdir().unwrap();
        let conn = flywheel_core::db::open_and_migrate(&db_dir.path().join("f.db"), &db_dir.path().join("b")).unwrap();
        let db = Mutex::new(conn);
        let (answer, changed) = answer_handoff_tool_call(&db, "01NOSUCHSESSION00000000000", "checks_run", &json!({}));
        assert!(answer["error"].as_str().is_some(), "{answer}");
        assert_eq!(changed, None);
        let (answer, _) = answer_handoff_tool_call(&db, "x", "handoff", &json!({ "decisions": "" }));
        assert!(answer["error"].as_str().unwrap().contains("next_session_must_know"), "{answer}");
    }
}
