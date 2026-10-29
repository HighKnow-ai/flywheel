//! `story_create` / `story_list` / `story_get` / `story_update` / `story_set_state` / `story_move`, plus
//! `story_write_by_hand` and `story_list_for_project` for the hand-written Story form, and
//! `story_request_changes` from the review card, and `story_make_ready` / `story_make_ready_offer` (issue
//! #166) — the Story command surface. A Story sits in one Epic and is the unit an agent executes in its own worktree
//! (`domain::story`). Every handler stamps the local human actor server-side (T-01-04), so every
//! transition reached from here is the developer's act; the hand-off is the session's, never an IPC
//! command's.

use flywheel_core::domain::story::HandWrittenCriterion;
use serde::{Deserialize, Serialize};
use tauri::{AppHandle, State};

use flywheel_core::domain::session_kind::SessionKind;

use super::criterion::MAX_CHECK_COMMAND_LEN;
use super::session::{prepare_launch, spawn_prepared_run, PreparedLaunch, StartRunOutcome};
use super::{emit_board_changed, validate_text, MAX_PROSE_LEN, MAX_TITLE_LEN};
use crate::state::AppState;

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct StoryDto {
    pub id: String,
    pub project_id: String,
    pub epic_id: String,
    pub key: String,
    pub title: String,
    pub description: Option<String>,
    /// `shaping`, `ready`, `running`, `in_review`, `merged` or `dropped`.
    pub state: String,
    pub runs_after_story_id: Option<String>,
    /// The one-line constraint behind the runs-after marker (issue #127).
    pub runs_after_reason: Option<String>,
    pub rank: String,
}

impl From<flywheel_core::domain::story::Story> for StoryDto {
    fn from(s: flywheel_core::domain::story::Story) -> Self {
        Self {
            id: s.id,
            project_id: s.project_id,
            epic_id: s.epic_id,
            key: s.key,
            title: s.title,
            description: s.description,
            state: s.state,
            runs_after_story_id: s.runs_after_story_id,
            runs_after_reason: s.runs_after_reason,
            rank: s.rank,
        }
    }
}

/// Create a Story at the end of `epic_id`'s execution order, in Shaping.
#[tauri::command]
pub fn story_create(
    state: State<AppState>,
    app: AppHandle,
    epic_id: String,
    title: String,
) -> Result<StoryDto, String> {
    validate_text("title", &title, MAX_TITLE_LEN)?;
    let mut conn = state.db.lock().map_err(|e| e.to_string())?;
    let actor_id =
        flywheel_core::domain::actor::local_human_actor_id(&conn).map_err(|e| e.to_string())?;
    let story = flywheel_core::domain::story::create_story(&mut conn, &actor_id, &epic_id, &title)
        .map_err(|e| e.to_string())?;
    drop(conn);
    emit_board_changed(&app, Some(&story.project_id), "story", Some(&story.id));
    Ok(story.into())
}

/// Every Story of an Epic, in execution order.
#[tauri::command]
pub fn story_list(state: State<AppState>, epic_id: String) -> Result<Vec<StoryDto>, String> {
    let conn = state.db.lock().map_err(|e| e.to_string())?;
    let stories = flywheel_core::domain::story::stories_in_epic(&conn, &epic_id)
        .map_err(|e| e.to_string())?;
    Ok(stories.into_iter().map(StoryDto::from).collect())
}

/// One Story, or `null` when it does not exist.
#[tauri::command]
pub fn story_get(state: State<AppState>, story_id: String) -> Result<Option<StoryDto>, String> {
    let conn = state.db.lock().map_err(|e| e.to_string())?;
    let story =
        flywheel_core::domain::story::get_story(&conn, &story_id).map_err(|e| e.to_string())?;
    Ok(story.map(StoryDto::from))
}

/// The size of the Context packet the Story's next session starts from (docs/mvp-spec.md §4.2):
/// bytes, an approximate token count, and whether it is above the soft warning threshold.
#[tauri::command]
pub async fn story_context_packet_size(
    state: State<'_, AppState>,
    story_id: String,
) -> Result<flywheel_core::context_packet::PacketSize, String> {
    // The packet reads the worktree's diff through git: a side connection, not the board mutex
    // (issue #215), on the blocking pool (issue #220).
    let db_path = super::board_path(&state.db)?;
    tauri::async_runtime::spawn_blocking(move || {
        let conn = super::open_beside(&db_path)?;
        flywheel_core::context_packet::context_packet_size(&conn, &story_id)
            .map_err(|e| e.to_string())
    })
    .await
    .map_err(|e| super::ipc_error("story_context_packet_size:join", e))?
}

/// Rewrite a Story's title and description.
#[tauri::command]
pub fn story_update(
    state: State<AppState>,
    app: AppHandle,
    story_id: String,
    title: String,
    description: Option<String>,
) -> Result<(), String> {
    validate_text("title", &title, MAX_TITLE_LEN)?;
    if let Some(description) = &description {
        validate_text("description", description, MAX_PROSE_LEN)?;
    }
    let mut conn = state.db.lock().map_err(|e| e.to_string())?;
    let actor_id =
        flywheel_core::domain::actor::local_human_actor_id(&conn).map_err(|e| e.to_string())?;
    flywheel_core::domain::story::update_story(
        &mut conn,
        &actor_id,
        &story_id,
        &title,
        description.as_deref(),
    )
    .map_err(|e| e.to_string())?;
    let project_id = super::project_of(&conn, "stories", &story_id);
    drop(conn);
    emit_board_changed(&app, project_id.as_deref(), "story", Some(&story_id));
    Ok(())
}

/// The developer moves a Story along the spec's transition table (starting it, requesting changes).
/// The domain refuses any move outside the table; Drop and Merge have commands of their own.
#[tauri::command]
pub fn story_set_state(
    state: State<AppState>,
    app: AppHandle,
    story_id: String,
    to: String,
) -> Result<(), String> {
    let to = flywheel_core::domain::story::StoryState::parse(&to).map_err(|e| e.to_string())?;
    refuse_bare_drop(to)?;
    refuse_bare_merge(to)?;
    refuse_bare_running(to)?;
    refuse_bare_ready(to)?;
    let mut conn = state.db.lock().map_err(|e| e.to_string())?;
    let actor_id =
        flywheel_core::domain::actor::local_human_actor_id(&conn).map_err(|e| e.to_string())?;
    flywheel_core::domain::story::set_story_state(&mut conn, &actor_id, &story_id, to)
        .map_err(|e| e.to_string())?;
    let project_id = super::project_of(&conn, "stories", &story_id);
    drop(conn);
    emit_board_changed(&app, project_id.as_deref(), "story", Some(&story_id));
    Ok(())
}

/// Dropping goes through [`story_drop`], which also removes the worktree and branch; a bare state
/// write would leave them behind.
fn refuse_bare_drop(to: flywheel_core::domain::story::StoryState) -> Result<(), String> {
    if to == flywheel_core::domain::story::StoryState::Dropped {
        return Err(
            "drop a Story with story_drop, which also removes its worktree and branch".to_string(),
        );
    }
    Ok(())
}

/// Merging goes through `review::story_merge` (issue #155), which writes the merge commit, removes
/// the worktree and branch and closes the review; a bare state write would mark a Story Merged with
/// nothing on its base branch.
fn refuse_bare_merge(to: flywheel_core::domain::story::StoryState) -> Result<(), String> {
    if to == flywheel_core::domain::story::StoryState::Merged {
        return Err(
            "merge a Story with story_merge, which writes the merge commit on its base branch"
                .to_string(),
        );
    }
    Ok(())
}

/// Ready is reached by closing the Epic's criteria Stage or by [`story_make_ready`] (issue #166), which
/// refuses a Story with no criterion or in an Epic still being shaped; a bare state write checks neither.
fn refuse_bare_ready(to: flywheel_core::domain::story::StoryState) -> Result<(), String> {
    if to == flywheel_core::domain::story::StoryState::Ready {
        return Err("make a Story Ready with story_make_ready, which needs a criterion and its Epic's shaping closed".to_string());
    }
    Ok(())
}

/// The developer's Make Ready (docs/mvp-spec.md §2, issue #166): a Story in Shaping, with a criterion, in
/// an Epic whose shaping is closed, moves to Ready. The core refuses anything else, an agent included.
#[tauri::command]
pub fn story_make_ready(
    state: State<AppState>,
    app: AppHandle,
    story_id: String,
) -> Result<(), String> {
    let mut conn = state.db.lock().map_err(|e| e.to_string())?;
    let actor_id =
        flywheel_core::domain::actor::local_human_actor_id(&conn).map_err(|e| e.to_string())?;
    flywheel_core::domain::story::make_ready(&mut conn, &actor_id, &story_id)
        .map_err(|e| format!("{e:#}"))?;
    let project_id = super::project_of(&conn, "stories", &story_id);
    drop(conn);
    emit_board_changed(&app, project_id.as_deref(), "story", Some(&story_id));
    Ok(())
}

/// Whether the Story view offers Make Ready on a Story, and what holds it back (issue #166).
#[tauri::command]
pub fn story_make_ready_offer(
    state: State<AppState>,
    story_id: String,
) -> Result<flywheel_core::domain::story::MakeReadyOffer, String> {
    let conn = state.db.lock().map_err(|e| e.to_string())?;
    flywheel_core::domain::story::make_ready_offer(&conn, &story_id).map_err(|e| format!("{e:#}"))
}

/// Running is reached only with a session: Start (`session::story_start`) from Ready, and
/// [`story_request_changes`] from In review. A bare state write would leave a Running Story with no
/// session, which reads Stopped.
fn refuse_bare_running(to: flywheel_core::domain::story::StoryState) -> Result<(), String> {
    if to == flywheel_core::domain::story::StoryState::Running {
        return Err("start a Story with story_start, or send it back with story_request_changes; both launch its session"
            .to_string());
    }
    Ok(())
}

/// The developer's Request changes on the review card (docs/mvp-spec.md §2 "In review → Running", §8,
/// issue #158): the comments close the open review, the Story moves to Running, and a fresh session
/// starts in its worktree from a Context packet that carries them. A launch that fails leaves the Story
/// Stopped, with Resume; the board is told either way.
#[tauri::command]
pub async fn story_request_changes(
    app: AppHandle,
    story_id: String,
    comments: String,
) -> Result<super::session::SessionDto, String> {
    // Blank comments are the core's to judge: the review's ADR review points may be enough (issue #164).
    if !comments.trim().is_empty() {
        validate_text("comments", &comments, MAX_PROSE_LEN)?;
    }
    // The review's diff, the launch's git and the spawn floor: on the blocking pool (issue #220).
    tauri::async_runtime::spawn_blocking(move || {
        request_changes_blocking(&app, story_id, &comments)
    })
    .await
    .map_err(|e| super::ipc_error("story_request_changes:join", e))?
}

fn request_changes_blocking(
    app: &AppHandle,
    story_id: String,
    comments: &str,
) -> Result<super::session::SessionDto, String> {
    let state = tauri::Manager::state::<AppState>(app);
    let result = request_changes_and_launch(
        &state.db,
        &story_id,
        comments,
        flywheel_core::login_path::claude_bin,
        crate::sidecar::merge_shim_env_for_run,
        |repo_path, request| super::session::send_gated_spawn(&state, repo_path, request),
    );
    let project_id = super::project_of_locked(&state.db, "stories", &story_id);
    emit_board_changed(app, project_id.as_deref(), "story", Some(&story_id));
    let outcome = result?;
    Ok(super::session::SessionDto {
        id: outcome.run_id,
        story_id,
        status: "running".to_string(),
        permission_mode: SessionKind::Story
            .launch_policy()
            .permission_mode
            .to_string(),
    })
}

/// [`story_request_changes`]'s body, driven without a Tauri app handle. The In review check, the move
/// and the launch share the Story's work lock ([`super::story_work`]) and run on a side connection,
/// never under the board mutex: the review's diff and the Context packet are git (issue #215). A
/// reader can see the Story Stopped only between the move's commit and the session row's, a few
/// database statements with no git between them once the worktree exists, which In review implies.
/// The comments are on the board before the packet is built, which is how section 7 carries them.
///
/// Nothing is written when the Story is not In review or `claude` is missing (issue #88): the Story
/// stays In review. Once it moved, a launch that fails (the credential, the session row, the shim or
/// the spawn) leaves it Running with no live session, which is Stopped: Resume starts the session
/// later, from a packet that still carries the comments.
pub(crate) fn request_changes_and_launch(
    db: &std::sync::Mutex<rusqlite::Connection>,
    story_id: &str,
    comments: &str,
    find_claude: impl FnOnce() -> Result<std::path::PathBuf, String>,
    merge_shim: impl FnOnce(&mut std::collections::HashMap<String, String>, &str) -> anyhow::Result<()>,
    send: impl FnOnce(&str, &serde_json::Value) -> Result<(), String>,
) -> Result<StartRunOutcome, String> {
    super::with_story_work(story_id, || {
        let mut conn = super::side_connection(db)?;
        let current = flywheel_core::domain::story::get_story(&conn, story_id)
            .map_err(|e| e.to_string())?
            .ok_or_else(|| format!("Story {story_id:?} not found"))?
            .state;
        if current != flywheel_core::domain::story::StoryState::InReview.as_str() {
            return Err(format!(
                "Request changes needs a Story In review; this one is {}",
                current.replace('_', " ")
            ));
        }
        find_claude()?;
        let human =
            flywheel_core::domain::actor::local_human_actor_id(&conn).map_err(|e| e.to_string())?;
        flywheel_core::domain::request_changes::request_changes(
            &mut conn, &human, story_id, comments,
        )
        .map_err(|e| format!("{e:#}"))?;

        let stopped = |why: String| {
            format!(
                "The Story is back in Running, but its session did not start ({why}). Resume it."
            )
        };
        let PreparedLaunch {
            outcome,
            repo_path,
            env,
        } = prepare_launch(&mut conn, story_id, SessionKind::Story, "").map_err(stopped)?;
        spawn_prepared_run(
            &mut conn,
            &outcome,
            env,
            SessionKind::Story,
            merge_shim,
            |request| send(&repo_path, request),
        )
        .map_err(stopped)?;
        Ok(outcome)
    })
}

/// The developer's Drop (docs/mvp-spec.md §2): the Story moves to Dropped and its worktree and
/// branch are removed, uncommitted work included; the record stays readable. Refused for a Merged
/// Story and while a session is live. Not a Gated action: it raises no permission request.
#[tauri::command]
pub async fn story_drop(
    state: State<'_, AppState>,
    app: AppHandle,
    story_id: String,
) -> Result<(), String> {
    // Removing the worktree and the branch is git: a side connection, under the Story's work lock
    // (issue #215), on the blocking pool (issue #220).
    let db_path = super::board_path(&state.db)?;
    let id = story_id.clone();
    let project_id = tauri::async_runtime::spawn_blocking(move || {
        super::with_story_work(&id, || -> Result<Option<String>, String> {
            let mut conn = super::open_beside(&db_path)?;
            let actor_id = flywheel_core::domain::actor::local_human_actor_id(&conn)
                .map_err(|e| e.to_string())?;
            flywheel_core::domain::story_drop::drop_story(&mut conn, &actor_id, &id)
                .map_err(|e| format!("{e:#}"))?;
            Ok(super::project_of(&conn, "stories", &id))
        })
    })
    .await
    .map_err(|e| super::ipc_error("story_drop:join", e))??;
    emit_board_changed(&app, project_id.as_deref(), "story", Some(&story_id));
    Ok(())
}

/// The most criteria one hand-written Story may carry over IPC.
const MAX_CRITERIA: usize = 50;

/// One criterion of a hand-written Story, as the form sends it. A missing or blank
/// `check_command` means the criterion is judged at review.
#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CriterionInput {
    pub statement: String,
    pub check_command: Option<String>,
}

/// Bound every field of a hand-written Story before anything touches the database.
fn validate_hand_written(
    title: &str,
    description: Option<&str>,
    criteria: &[CriterionInput],
) -> Result<(), String> {
    validate_text("title", title, MAX_TITLE_LEN)?;
    if let Some(description) = description {
        validate_text("description", description, MAX_PROSE_LEN)?;
    }
    if criteria.len() > MAX_CRITERIA {
        return Err(format!(
            "a Story may carry at most {MAX_CRITERIA} criteria, got {}",
            criteria.len()
        ));
    }
    for criterion in criteria {
        validate_text("statement", &criterion.statement, MAX_PROSE_LEN)?;
        if let Some(command) = &criterion.check_command {
            validate_text("command", command, MAX_CHECK_COMMAND_LEN)?;
        }
    }
    Ok(())
}

/// Write a Story by hand inside `epic_id`, with its criteria and their optional Checks, straight
/// into Ready (Milestone 2's stand-in for shaping; `domain::story::write_story_by_hand`).
#[tauri::command]
pub fn story_write_by_hand(
    state: State<AppState>,
    app: AppHandle,
    epic_id: String,
    title: String,
    description: Option<String>,
    criteria: Vec<CriterionInput>,
) -> Result<StoryDto, String> {
    validate_hand_written(&title, description.as_deref(), &criteria)?;
    let written: Vec<HandWrittenCriterion> = criteria
        .iter()
        .map(|c| HandWrittenCriterion {
            statement: &c.statement,
            check_command: c.check_command.as_deref(),
        })
        .collect();
    let mut conn = state.db.lock().map_err(|e| e.to_string())?;
    let actor_id =
        flywheel_core::domain::actor::local_human_actor_id(&conn).map_err(|e| e.to_string())?;
    let story = flywheel_core::domain::story::write_story_by_hand(
        &mut conn,
        &actor_id,
        &epic_id,
        &title,
        description.as_deref(),
        &written,
    )
    .map_err(|e| e.to_string())?;
    drop(conn);
    emit_board_changed(&app, Some(&story.project_id), "story", Some(&story.id));
    Ok(story.into())
}

/// The developer's Move to Epic (issue #168): the Story re-parents to another open Epic of its project,
/// landing at the end of its order, with its key, criteria, Tasks, worktree and branch untouched. The
/// core refuses an agent, a closed Story and a Done or Dropped Epic.
#[tauri::command]
pub fn story_move(
    state: State<AppState>,
    app: AppHandle,
    story_id: String,
    epic_id: String,
) -> Result<(), String> {
    let mut conn = state.db.lock().map_err(|e| e.to_string())?;
    let actor_id =
        flywheel_core::domain::actor::local_human_actor_id(&conn).map_err(|e| e.to_string())?;
    flywheel_core::domain::story::move_story_to_epic(&mut conn, &actor_id, &story_id, &epic_id)
        .map_err(|e| format!("{e:#}"))?;
    let project_id = super::project_of(&conn, "stories", &story_id);
    drop(conn);
    emit_board_changed(&app, project_id.as_deref(), "story", Some(&story_id));
    Ok(())
}

/// Every Story of a project, in Roadmap order (Milestone, then Epic, then Story).
#[tauri::command]
pub fn story_list_for_project(
    state: State<AppState>,
    project_id: String,
) -> Result<Vec<StoryDto>, String> {
    let conn = state.db.lock().map_err(|e| e.to_string())?;
    let stories = flywheel_core::domain::story::stories_in_project(&conn, &project_id)
        .map_err(|e| e.to_string())?;
    Ok(stories.into_iter().map(StoryDto::from).collect())
}

#[cfg(test)]
mod tests {
    use super::*;

    fn input(statement: &str, check: Option<&str>) -> CriterionInput {
        CriterionInput {
            statement: statement.to_string(),
            check_command: check.map(str::to_string),
        }
    }

    #[test]
    fn a_bare_state_write_cannot_drop_a_story() {
        use flywheel_core::domain::story::StoryState;
        assert!(refuse_bare_drop(StoryState::Dropped)
            .unwrap_err()
            .contains("story_drop"));
        assert!(refuse_bare_drop(StoryState::Merged).is_ok());
    }

    #[test]
    fn a_bare_state_write_cannot_merge_a_story() {
        use flywheel_core::domain::story::StoryState;
        assert!(refuse_bare_merge(StoryState::Merged)
            .unwrap_err()
            .contains("story_merge"));
        assert!(refuse_bare_merge(StoryState::Running).is_ok());
    }

    #[test]
    fn a_bare_state_write_cannot_make_a_story_ready() {
        use flywheel_core::domain::story::StoryState;
        assert!(refuse_bare_ready(StoryState::Ready)
            .unwrap_err()
            .contains("story_make_ready"));
        assert!(refuse_bare_ready(StoryState::InReview).is_ok());
    }

    #[test]
    fn a_bare_state_write_cannot_move_a_story_to_running() {
        use flywheel_core::domain::story::StoryState;
        let err = refuse_bare_running(StoryState::Running).unwrap_err();
        assert!(
            err.contains("story_start") && err.contains("story_request_changes"),
            "{err}"
        );
        assert!(refuse_bare_running(StoryState::InReview).is_ok());
    }

    // --- Request changes (issue #158): In review → Running with a fresh session -----------------

    use crate::commands::session::tests::{
        found_claude, seeded_git_conn_with_story, story_state, with_scratch_dirs,
    };
    use rusqlite::Connection;

    /// An In review Story: started, one Task done, handed off, its session ended.
    fn in_review_story() -> (
        std::sync::Mutex<Connection>,
        String,
        String,
        tempfile::TempDir,
    ) {
        let (mut conn, human, _project, story, repo) = seeded_git_conn_with_story();
        flywheel_core::domain::story::set_story_state(
            &mut conn,
            &human,
            &story,
            flywheel_core::domain::story::StoryState::Ready,
        )
        .unwrap();
        let db = std::sync::Mutex::new(conn);
        let first = crate::commands::session::start_ready_story(
            &db,
            &story,
            "",
            found_claude,
            |_, _| Ok(()),
            |_, _| Ok(()),
        )
        .unwrap();
        let mut conn = db.lock().unwrap();
        let agent = flywheel_core::domain::session::agent_actor_id(&conn).unwrap();
        let task =
            flywheel_core::domain::task::add_task(&mut conn, &agent, &story, "Write the parser")
                .unwrap();
        flywheel_core::domain::task::set_task_state(
            &mut conn,
            &agent,
            &task.id,
            flywheel_core::domain::task::TaskState::Done,
            None,
        )
        .unwrap();
        flywheel_core::domain::handoff::hand_off(&mut conn, &first.run_id, "Parser done.", "")
            .unwrap();
        flywheel_core::domain::session::close_session(
            &mut conn,
            &first.run_id,
            flywheel_core::domain::session::SessionStatus::Completed,
            None,
            None,
            None,
        )
        .unwrap();
        drop(conn);
        (db, story, first.worktree_path, repo)
    }

    fn live_sessions(conn: &Connection, story_id: &str) -> i64 {
        conn.query_row(
            "SELECT COUNT(*) FROM sessions WHERE story_id = ?1 AND status IN ('running', 'blocked')",
            rusqlite::params![story_id],
            |r| r.get(0),
        )
        .unwrap()
    }

    #[test]
    fn request_changes_starts_one_session_in_the_same_worktree_whose_packet_carries_the_comments() {
        with_scratch_dirs(|| {
            let (db, story, worktree_path, _repo) = in_review_story();
            let mut sent = None;
            let outcome = request_changes_and_launch(
                &db,
                &story,
                "Name the line in each error.",
                found_claude,
                |_, _| Ok(()),
                |_, request| {
                    sent = Some(request.clone());
                    Ok(())
                },
            )
            .expect("an In review Story goes back to Running");

            let conn = db.lock().unwrap();
            assert_eq!(story_state(&conn, &story), "running");
            assert_eq!(live_sessions(&conn, &story), 1, "one session");
            assert_eq!(outcome.worktree_path, worktree_path, "in the same worktree");
            let sent = sent.expect("one spawn request");
            assert_eq!(
                sent["worktreePath"],
                serde_json::Value::String(worktree_path)
            );
            let prompt = sent["prompt"].as_str().unwrap();
            assert!(
                prompt.contains(
                    "The developer requested changes at review:\n\nName the line in each error."
                ),
                "{prompt}"
            );
            assert!(
                prompt.contains("- [done] Write the parser"),
                "the checklist is kept: {prompt}"
            );
            assert!(
                flywheel_core::query::sessions::stopped_session_for_story(&conn, &story)
                    .unwrap()
                    .is_none()
            );
        });
    }

    #[test]
    fn a_failed_launch_leaves_the_story_stopped_with_resume() {
        with_scratch_dirs(|| {
            let (db, story, _worktree, _repo) = in_review_story();
            let err = request_changes_and_launch(
                &db,
                &story,
                "Cover an empty file.",
                found_claude,
                |_, _| Ok(()),
                |_, _| Err("spawn boom".to_string()),
            )
            .expect_err("the spawn fails");
            assert!(
                err.contains("spawn boom") && err.contains("Resume"),
                "{err}"
            );

            {
                let conn = db.lock().unwrap();
                assert_eq!(story_state(&conn, &story), "running");
                assert_eq!(live_sessions(&conn, &story), 0);
                assert!(
                    flywheel_core::query::sessions::stopped_session_for_story(&conn, &story)
                        .unwrap()
                        .is_some(),
                    "Stopped"
                );
            }
            let mut sent = None;
            crate::commands::session::resume_stopped_story(
                &db,
                &story,
                "",
                found_claude,
                |_, _| Ok(()),
                |_, request| {
                    sent = Some(request.clone());
                    Ok(())
                },
            )
            .expect("Resume starts the session");
            assert!(
                sent.unwrap()["prompt"]
                    .as_str()
                    .unwrap()
                    .contains("Cover an empty file."),
                "Resume's packet still carries the comments"
            );
        });
    }

    #[test]
    fn request_changes_without_claude_or_on_a_story_not_in_review_writes_nothing() {
        with_scratch_dirs(|| {
            let (db, story, _worktree, _repo) = in_review_story();
            let err = request_changes_and_launch(
                &db,
                &story,
                "Cover it.",
                || Err("no claude on PATH".to_string()),
                |_, _| panic!("no shim"),
                |_, _| panic!("nothing may be spawned"),
            )
            .expect_err("refused without claude");
            assert!(err.contains("no claude"), "{err}");
            assert_eq!(
                story_state(&db.lock().unwrap(), &story),
                "in_review",
                "the Story stays In review"
            );

            request_changes_and_launch(
                &db,
                &story,
                "Cover it.",
                found_claude,
                |_, _| Ok(()),
                |_, _| Ok(()),
            )
            .unwrap();
            let err = request_changes_and_launch(
                &db,
                &story,
                "Again.",
                found_claude,
                |_, _| panic!("no shim"),
                |_, _| panic!("nothing may be spawned"),
            )
            .expect_err("a Running Story is not In review");
            assert!(err.contains("In review"), "{err}");
        });
    }

    #[test]
    fn a_bounded_hand_written_story_passes_validation() {
        assert!(
            validate_hand_written("Title", Some("why"), &[input("ok", Some("cargo test"))]).is_ok()
        );
    }

    #[test]
    fn oversized_fields_and_too_many_criteria_are_refused_before_the_database() {
        let long = "x".repeat(MAX_PROSE_LEN + 1);
        assert!(validate_hand_written(&"t".repeat(MAX_TITLE_LEN + 1), None, &[]).is_err());
        assert!(validate_hand_written("t", Some(&long), &[]).is_err());
        assert!(validate_hand_written("t", None, &[input(&long, None)]).is_err());
        assert!(validate_hand_written(
            "t",
            None,
            &[input("ok", Some(&"c".repeat(MAX_CHECK_COMMAND_LEN + 1)))]
        )
        .is_err());
        let many: Vec<CriterionInput> = (0..=MAX_CRITERIA).map(|_| input("ok", None)).collect();
        assert!(validate_hand_written("t", None, &many)
            .unwrap_err()
            .contains("at most"));
    }
}
