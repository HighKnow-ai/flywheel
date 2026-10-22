//! `milestone_create` / `milestone_list` / `milestone_set_state` / `milestone_move` — the Roadmap's
//! command surface. A
//! project's Roadmap is its Milestones in rank order (`domain::milestone`). Every handler stamps the
//! local human actor server-side (T-01-04) and emits `board:changed` after a successful mutation.

use serde::Serialize;
use tauri::{AppHandle, State};

use super::{emit_board_changed, validate_text, MAX_PROSE_LEN, MAX_TITLE_LEN};
use crate::state::AppState;

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct MilestoneDto {
    pub id: String,
    pub project_id: String,
    pub title: String,
    pub exit_test: Option<String>,
    /// The state with In progress derived: `shaping`, `ready`, `in_progress`, `done` or `dropped`.
    pub state: String,
    /// Whether this is the Current Milestone (the first in Roadmap order not done or dropped).
    pub current: bool,
    pub rank: String,
}

fn to_dto(
    conn: &rusqlite::Connection,
    m: flywheel_core::domain::milestone::Milestone,
    current_id: Option<&str>,
) -> Result<MilestoneDto, String> {
    let state = flywheel_core::domain::milestone::milestone_state(conn, &m.id).map_err(|e| e.to_string())?;
    Ok(MilestoneDto {
        current: current_id == Some(m.id.as_str()),
        id: m.id,
        project_id: m.project_id,
        title: m.title,
        exit_test: m.exit_test,
        state: state.as_str().to_string(),
        rank: m.rank,
    })
}

/// Add a Milestone at the end of the project's Roadmap, in Shaping.
#[tauri::command]
pub fn milestone_create(
    state: State<AppState>,
    app: AppHandle,
    project_id: String,
    title: String,
    exit_test: Option<String>,
) -> Result<MilestoneDto, String> {
    validate_text("title", &title, MAX_TITLE_LEN)?;
    if let Some(exit_test) = &exit_test {
        validate_text("exitTest", exit_test, MAX_PROSE_LEN)?;
    }
    let mut conn = state.db.lock().map_err(|e| e.to_string())?;
    let actor_id = flywheel_core::domain::actor::local_human_actor_id(&conn).map_err(|e| e.to_string())?;
    let m = flywheel_core::domain::milestone::create_milestone(&mut conn, &project_id, &actor_id, &title, exit_test.as_deref())
        .map_err(|e| e.to_string())?;
    let current = flywheel_core::domain::milestone::current_milestone(&conn, &project_id).map_err(|e| e.to_string())?;
    let dto = to_dto(&conn, m, current.as_ref().map(|c| c.id.as_str()))?;
    drop(conn);
    emit_board_changed(&app, Some(&project_id), "milestone", Some(&dto.id));
    Ok(dto)
}

/// The project's Roadmap: every Milestone in rank order, with its derived state.
#[tauri::command]
pub fn milestone_list(state: State<AppState>, project_id: String) -> Result<Vec<MilestoneDto>, String> {
    let conn = state.db.lock().map_err(|e| e.to_string())?;
    let current = flywheel_core::domain::milestone::current_milestone(&conn, &project_id).map_err(|e| e.to_string())?;
    let current_id = current.as_ref().map(|c| c.id.as_str());
    flywheel_core::domain::milestone::roadmap(&conn, &project_id)
        .map_err(|e| e.to_string())?
        .into_iter()
        .map(|m| to_dto(&conn, m, current_id))
        .collect()
}

/// The developer moves a Milestone: `ready` closes shaping, `done` confirms the exit test,
/// `dropped` retires it, `shaping` reopens shaping. The domain refuses the rest.
#[tauri::command]
pub fn milestone_set_state(
    state: State<AppState>,
    app: AppHandle,
    milestone_id: String,
    to: String,
) -> Result<(), String> {
    let to = flywheel_core::domain::milestone::MilestoneState::parse(&to).map_err(|e| e.to_string())?;
    let mut conn = state.db.lock().map_err(|e| e.to_string())?;
    let actor_id = flywheel_core::domain::actor::local_human_actor_id(&conn).map_err(|e| e.to_string())?;
    flywheel_core::domain::milestone::set_milestone_state(&mut conn, &actor_id, &milestone_id, to)
        .map_err(|e| e.to_string())?;
    let project_id = super::project_of(&conn, "milestones", &milestone_id);
    drop(conn);
    emit_board_changed(&app, project_id.as_deref(), "milestone", Some(&milestone_id));
    Ok(())
}

/// The developer moves a Milestone on the Roadmap (the Roadmap strip, #131): just before `before_id`,
/// or to the end when it is `null`. The Current Milestone follows the new order; the domain refuses a
/// Done or Dropped Milestone.
#[tauri::command]
pub fn milestone_move(
    state: State<AppState>,
    app: AppHandle,
    milestone_id: String,
    before_id: Option<String>,
) -> Result<(), String> {
    let mut conn = state.db.lock().map_err(|e| e.to_string())?;
    let actor_id = flywheel_core::domain::actor::local_human_actor_id(&conn).map_err(|e| e.to_string())?;
    flywheel_core::domain::milestone::move_milestone(&mut conn, &actor_id, &milestone_id, before_id.as_deref())
        .map_err(|e| e.to_string())?;
    let project_id = super::project_of(&conn, "milestones", &milestone_id);
    drop(conn);
    emit_board_changed(&app, project_id.as_deref(), "milestone", Some(&milestone_id));
    Ok(())
}

/// A Milestone's or an Epic's Stories by state (`core::query::progress::StoryStateCounts`).
/// Attention splits Running: `running` counts only Running Stories neither Waiting on you nor
/// Stopped. `stories_total` leaves out Dropped Stories, which are counted on their own.
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct StoryStateCountsDto {
    pub shaping: i64,
    pub ready: i64,
    pub running: i64,
    pub waiting_on_you: i64,
    pub stopped: i64,
    pub in_review: i64,
    pub merged: i64,
    pub dropped: i64,
    pub stories_total: i64,
}

impl From<flywheel_core::query::progress::StoryStateCounts> for StoryStateCountsDto {
    fn from(c: flywheel_core::query::progress::StoryStateCounts) -> Self {
        StoryStateCountsDto {
            shaping: c.shaping,
            ready: c.ready,
            running: c.running,
            waiting_on_you: c.waiting_on_you,
            stopped: c.stopped,
            in_review: c.in_review,
            merged: c.merged,
            dropped: c.dropped,
            stories_total: c.stories_total,
        }
    }
}

/// One Epic's progress row: its derived state and its Stories by state.
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct EpicProgressDto {
    pub epic_id: String,
    pub key: String,
    pub title: String,
    pub state: String,
    pub counts: StoryStateCountsDto,
}

/// The Milestone header (docs/mvp-spec.md §7): the Current Milestone, its exit test, the next
/// Milestone, its Stories by state, its Epics done, and each Epic's own counts.
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct MilestoneProgressDto {
    pub milestone_id: String,
    pub title: String,
    pub exit_test: Option<String>,
    pub state: String,
    /// Whether this is the Current Milestone; the strip can select any other one.
    pub current: bool,
    pub next_milestone_title: Option<String>,
    pub counts: StoryStateCountsDto,
    pub epics_done: i64,
    pub epics_total: i64,
    pub epics: Vec<EpicProgressDto>,
}

/// The progress of `milestone_id` (picked on the Roadmap strip), or of the Current Milestone when it
/// is `null`; `null` when there is no such Milestone. Read-only: the header is one core statement and
/// the Epic rows another, so the renderer never counts.
#[tauri::command]
pub fn milestone_progress(
    state: State<AppState>,
    project_id: String,
    milestone_id: Option<String>,
) -> Result<Option<MilestoneProgressDto>, String> {
    let conn = state.db.lock().map_err(|e| e.to_string())?;
    let Some(header) =
        flywheel_core::query::progress::milestone_progress(&conn, &project_id, milestone_id.as_deref())
            .map_err(|e| e.to_string())?
    else {
        return Ok(None);
    };
    let current = flywheel_core::domain::milestone::current_milestone(&conn, &project_id)
        .map_err(|e| e.to_string())?
        .is_some_and(|c| c.id == header.milestone_id);
    let epics = flywheel_core::query::progress::epic_progress(&conn, &header.milestone_id)
        .map_err(|e| e.to_string())?
        .into_iter()
        .map(|e| EpicProgressDto { epic_id: e.epic_id, key: e.key, title: e.title, state: e.state, counts: e.counts.into() })
        .collect();
    Ok(Some(MilestoneProgressDto {
        milestone_id: header.milestone_id,
        title: header.title,
        exit_test: header.exit_test,
        state: header.state,
        current,
        next_milestone_title: header.next_milestone_title,
        counts: header.counts.into(),
        epics_done: header.epics_done,
        epics_total: header.epics_total,
        epics,
    }))
}
