//! `milestone_create` / `milestone_list` / `milestone_update` / `milestone_set_state` /
//! `milestone_move` — the Roadmap's command surface. A project's Roadmap is its Milestones in rank
//! order (`domain::milestone`). Every handler stamps the local human actor server-side (T-01-04)
//! and emits `board:changed` after a successful mutation.

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
    /// Its Epics Done, and its Epics with a Dropped one left out (issue #134): the row offers Confirm
    /// exit test once every Epic is Done, `epics_done == epics_total > 0`.
    pub epics_done: i64,
    pub epics_total: i64,
}

pub(crate) fn to_dto(
    conn: &rusqlite::Connection,
    m: flywheel_core::domain::milestone::Milestone,
    current_id: Option<&str>,
) -> Result<MilestoneDto, String> {
    let state = flywheel_core::domain::milestone::milestone_state(conn, &m.id).map_err(|e| e.to_string())?;
    let (epics_done, epics_total): (i64, i64) = conn
        .query_row(
            "SELECT COUNT(*) FILTER (WHERE state = 'done'), COUNT(*) FILTER (WHERE state != 'dropped') FROM epics WHERE milestone_id = ?1",
            [&m.id],
            |r| Ok((r.get(0)?, r.get(1)?)),
        )
        .map_err(|e| e.to_string())?;
    Ok(MilestoneDto {
        epics_done,
        epics_total,
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

/// The developer rewrites a Milestone's title and exit test by hand, on the Milestone card (issue
/// #149). Human-only: the domain re-reads the actor's type in its write transaction and refuses a
/// Done or Dropped Milestone. A blank exit test clears it.
#[tauri::command]
pub fn milestone_update(
    state: State<AppState>,
    app: AppHandle,
    milestone_id: String,
    title: String,
    exit_test: Option<String>,
) -> Result<(), String> {
    validate_text("title", &title, MAX_TITLE_LEN)?;
    if let Some(exit_test) = &exit_test {
        validate_text("exitTest", exit_test, MAX_PROSE_LEN)?;
    }
    let mut conn = state.db.lock().map_err(|e| e.to_string())?;
    let actor_id = flywheel_core::domain::actor::local_human_actor_id(&conn).map_err(|e| e.to_string())?;
    flywheel_core::domain::milestone::update_milestone(&mut conn, &actor_id, &milestone_id, &title, exit_test.as_deref())
        .map_err(|e| e.to_string())?;
    let project_id = super::project_of(&conn, "milestones", &milestone_id);
    drop(conn);
    emit_board_changed(&app, project_id.as_deref(), "milestone", Some(&milestone_id));
    Ok(())
}

/// The developer moves a Milestone: `ready` closes shaping, `dropped` retires it, `shaping` reopens
/// shaping (declining the exit test). `done` is refused here: confirming the exit test is
/// `milestone_confirm_done`, which starts the roadmap Round (issue #134). The domain refuses the rest.
#[tauri::command]
pub fn milestone_set_state(
    state: State<AppState>,
    app: AppHandle,
    milestone_id: String,
    to: String,
) -> Result<(), String> {
    let to = flywheel_core::domain::milestone::MilestoneState::parse(&to).map_err(|e| e.to_string())?;
    super::roadmap_round::refuse_done_without_round(to.as_str())?;
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
    /// Issue #124: `waiting_on_you` while a live shaping session is held on an open Round of the Epic,
    /// `round_waiting` while a Round is open with no live shaping session, else `null`.
    pub attention: Option<String>,
    /// Issue #159: where an Epic in Shaping has got to, its card's shaping marker; `null` out of Shaping.
    pub shaping: Option<ShapingMarkerDto>,
    /// Its Proposals awaiting triage (issue #162): the roster's "n Proposals" marker.
    pub proposals: i64,
}

/// An Epic in Shaping's open Stage and that Stage's latest Round (`core::query::progress::ShapingMarker`).
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ShapingMarkerDto {
    /// `challenge_spec`, `slice` or `criteria`; `null` before shaping opened a Stage.
    pub stage_kind: Option<String>,
    pub stage_rank: Option<i64>,
    pub round_number: Option<i64>,
    pub round_open: bool,
    pub answered: i64,
    pub questions: i64,
}

impl From<flywheel_core::query::progress::ShapingMarker> for ShapingMarkerDto {
    fn from(m: flywheel_core::query::progress::ShapingMarker) -> Self {
        ShapingMarkerDto {
            stage_kind: m.stage_kind,
            stage_rank: m.stage_rank,
            round_number: m.round_number,
            round_open: m.round_open,
            answered: m.answered,
            questions: m.questions,
        }
    }
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
        .map(|e| EpicProgressDto {
            epic_id: e.epic_id,
            key: e.key,
            title: e.title,
            state: e.state,
            counts: e.counts.into(),
            attention: e.attention,
            shaping: e.shaping.map(Into::into),
            proposals: e.proposals,
        })
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

/// The open review's diff size: files changed, lines added and removed.
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ReviewDiffSizeDto {
    pub files: i64,
    pub added: i64,
    pub removed: i64,
}

/// One Story row's figures (`core::query::roster::RosterRow`, issue #159).
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct RosterRowDto {
    pub story_id: String,
    /// `stopped`, `waiting_on_you` or `null`.
    pub attention: Option<String>,
    /// Why a Stopped Story's session ended; `null` unless Stopped.
    pub ending_reason: Option<String>,
    /// The live session Answer and Open session open.
    pub live_session_id: Option<String>,
    pub doing_task_title: Option<String>,
    pub criteria_met: i64,
    pub criteria_total: i64,
    pub tasks_done: i64,
    pub tasks_total: i64,
    /// The open review's diff size, while the Story is In review.
    pub review: Option<ReviewDiffSizeDto>,
    /// Whether the row offers Make Ready (issue #166).
    pub can_make_ready: bool,
}

/// Every Story row of `milestone_id`'s roster, in Roadmap order (docs/mvp-spec.md §7). Read-only and
/// one core statement, so the roster issues no read per row.
#[tauri::command]
pub fn roster_rows(state: State<AppState>, milestone_id: String) -> Result<Vec<RosterRowDto>, String> {
    let conn = state.db.lock().map_err(|e| e.to_string())?;
    let rows = flywheel_core::query::roster::roster_rows(&conn, &milestone_id).map_err(|e| e.to_string())?;
    Ok(rows
        .into_iter()
        .map(|r| RosterRowDto {
            story_id: r.story_id,
            attention: r.attention,
            ending_reason: r.ending_reason,
            live_session_id: r.live_session_id,
            doing_task_title: r.doing_task_title,
            criteria_met: r.criteria_met,
            criteria_total: r.criteria_total,
            tasks_done: r.tasks_done,
            tasks_total: r.tasks_total,
            review: r.review.map(|d| ReviewDiffSizeDto { files: d.files, added: d.added, removed: d.removed }),
            can_make_ready: r.can_make_ready,
        })
        .collect())
}
