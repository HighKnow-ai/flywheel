//! `story_create` / `story_list` / `story_get` / `story_update` / `story_set_state`, plus
//! `story_write_by_hand` and `story_list_for_project` for the hand-written Story form — the Story
//! command surface. A Story sits in one Epic and is the unit an agent executes in its own worktree
//! (`domain::story`). Every handler stamps the local human actor server-side (T-01-04), so every
//! transition reached from here is the developer's act; the hand-off is the session's, never an IPC
//! command's.

use flywheel_core::domain::story::HandWrittenCriterion;
use serde::{Deserialize, Serialize};
use tauri::{AppHandle, State};

use super::criterion::MAX_CHECK_COMMAND_LEN;
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
pub fn story_create(state: State<AppState>, app: AppHandle, epic_id: String, title: String) -> Result<StoryDto, String> {
    validate_text("title", &title, MAX_TITLE_LEN)?;
    let mut conn = state.db.lock().map_err(|e| e.to_string())?;
    let actor_id = flywheel_core::domain::actor::local_human_actor_id(&conn).map_err(|e| e.to_string())?;
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
    let stories = flywheel_core::domain::story::stories_in_epic(&conn, &epic_id).map_err(|e| e.to_string())?;
    Ok(stories.into_iter().map(StoryDto::from).collect())
}

/// One Story, or `null` when it does not exist.
#[tauri::command]
pub fn story_get(state: State<AppState>, story_id: String) -> Result<Option<StoryDto>, String> {
    let conn = state.db.lock().map_err(|e| e.to_string())?;
    let story = flywheel_core::domain::story::get_story(&conn, &story_id).map_err(|e| e.to_string())?;
    Ok(story.map(StoryDto::from))
}

/// The size of the Context packet the Story's next session starts from (docs/mvp-spec.md §4.2):
/// bytes, an approximate token count, and whether it is above the soft warning threshold.
#[tauri::command]
pub fn story_context_packet_size(
    state: State<AppState>,
    story_id: String,
) -> Result<flywheel_core::context_packet::PacketSize, String> {
    let conn = state.db.lock().map_err(|e| e.to_string())?;
    flywheel_core::context_packet::context_packet_size(&conn, &story_id).map_err(|e| e.to_string())
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
    let actor_id = flywheel_core::domain::actor::local_human_actor_id(&conn).map_err(|e| e.to_string())?;
    flywheel_core::domain::story::update_story(&mut conn, &actor_id, &story_id, &title, description.as_deref())
        .map_err(|e| e.to_string())?;
    let project_id = super::project_of(&conn, "stories", &story_id);
    drop(conn);
    emit_board_changed(&app, project_id.as_deref(), "story", Some(&story_id));
    Ok(())
}

/// The developer moves a Story along the spec's transition table (starting it, requesting changes).
/// The domain refuses any move outside the table; Drop and Merge have commands of their own.
#[tauri::command]
pub fn story_set_state(state: State<AppState>, app: AppHandle, story_id: String, to: String) -> Result<(), String> {
    let to = flywheel_core::domain::story::StoryState::parse(&to).map_err(|e| e.to_string())?;
    refuse_bare_drop(to)?;
    refuse_bare_merge(to)?;
    let mut conn = state.db.lock().map_err(|e| e.to_string())?;
    let actor_id = flywheel_core::domain::actor::local_human_actor_id(&conn).map_err(|e| e.to_string())?;
    flywheel_core::domain::story::set_story_state(&mut conn, &actor_id, &story_id, to).map_err(|e| e.to_string())?;
    let project_id = super::project_of(&conn, "stories", &story_id);
    drop(conn);
    emit_board_changed(&app, project_id.as_deref(), "story", Some(&story_id));
    Ok(())
}

/// Dropping goes through [`story_drop`], which also removes the worktree and branch; a bare state
/// write would leave them behind.
fn refuse_bare_drop(to: flywheel_core::domain::story::StoryState) -> Result<(), String> {
    if to == flywheel_core::domain::story::StoryState::Dropped {
        return Err("drop a Story with story_drop, which also removes its worktree and branch".to_string());
    }
    Ok(())
}

/// Merging goes through `review::story_merge` (issue #155), which writes the merge commit, removes
/// the worktree and branch and closes the review; a bare state write would mark a Story Merged with
/// nothing on its base branch.
fn refuse_bare_merge(to: flywheel_core::domain::story::StoryState) -> Result<(), String> {
    if to == flywheel_core::domain::story::StoryState::Merged {
        return Err("merge a Story with story_merge, which writes the merge commit on its base branch".to_string());
    }
    Ok(())
}

/// The developer's Drop (docs/mvp-spec.md §2): the Story moves to Dropped and its worktree and
/// branch are removed, uncommitted work included; the record stays readable. Refused for a Merged
/// Story and while a session is live. Not a Gated action: it raises no permission request.
#[tauri::command]
pub fn story_drop(state: State<AppState>, app: AppHandle, story_id: String) -> Result<(), String> {
    let mut conn = state.db.lock().map_err(|e| e.to_string())?;
    let actor_id = flywheel_core::domain::actor::local_human_actor_id(&conn).map_err(|e| e.to_string())?;
    flywheel_core::domain::story_drop::drop_story(&mut conn, &actor_id, &story_id).map_err(|e| format!("{e:#}"))?;
    let project_id = super::project_of(&conn, "stories", &story_id);
    drop(conn);
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
fn validate_hand_written(title: &str, description: Option<&str>, criteria: &[CriterionInput]) -> Result<(), String> {
    validate_text("title", title, MAX_TITLE_LEN)?;
    if let Some(description) = description {
        validate_text("description", description, MAX_PROSE_LEN)?;
    }
    if criteria.len() > MAX_CRITERIA {
        return Err(format!("a Story may carry at most {MAX_CRITERIA} criteria, got {}", criteria.len()));
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
        .map(|c| HandWrittenCriterion { statement: &c.statement, check_command: c.check_command.as_deref() })
        .collect();
    let mut conn = state.db.lock().map_err(|e| e.to_string())?;
    let actor_id = flywheel_core::domain::actor::local_human_actor_id(&conn).map_err(|e| e.to_string())?;
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

/// Every Story of a project, in Roadmap order (Milestone, then Epic, then Story).
#[tauri::command]
pub fn story_list_for_project(state: State<AppState>, project_id: String) -> Result<Vec<StoryDto>, String> {
    let conn = state.db.lock().map_err(|e| e.to_string())?;
    let stories = flywheel_core::domain::story::stories_in_project(&conn, &project_id).map_err(|e| e.to_string())?;
    Ok(stories.into_iter().map(StoryDto::from).collect())
}

#[cfg(test)]
mod tests {
    use super::*;

    fn input(statement: &str, check: Option<&str>) -> CriterionInput {
        CriterionInput { statement: statement.to_string(), check_command: check.map(str::to_string) }
    }

    #[test]
    fn a_bare_state_write_cannot_drop_a_story() {
        use flywheel_core::domain::story::StoryState;
        assert!(refuse_bare_drop(StoryState::Dropped).unwrap_err().contains("story_drop"));
        assert!(refuse_bare_drop(StoryState::Merged).is_ok());
    }

    #[test]
    fn a_bare_state_write_cannot_merge_a_story() {
        use flywheel_core::domain::story::StoryState;
        assert!(refuse_bare_merge(StoryState::Merged).unwrap_err().contains("story_merge"));
        assert!(refuse_bare_merge(StoryState::Running).is_ok());
    }

    #[test]
    fn a_bounded_hand_written_story_passes_validation() {
        assert!(validate_hand_written("Title", Some("why"), &[input("ok", Some("cargo test"))]).is_ok());
    }

    #[test]
    fn oversized_fields_and_too_many_criteria_are_refused_before_the_database() {
        let long = "x".repeat(MAX_PROSE_LEN + 1);
        assert!(validate_hand_written(&"t".repeat(MAX_TITLE_LEN + 1), None, &[]).is_err());
        assert!(validate_hand_written("t", Some(&long), &[]).is_err());
        assert!(validate_hand_written("t", None, &[input(&long, None)]).is_err());
        assert!(validate_hand_written("t", None, &[input("ok", Some(&"c".repeat(MAX_CHECK_COMMAND_LEN + 1)))]).is_err());
        let many: Vec<CriterionInput> = (0..=MAX_CRITERIA).map(|_| input("ok", None)).collect();
        assert!(validate_hand_written("t", None, &many).unwrap_err().contains("at most"));
    }
}
