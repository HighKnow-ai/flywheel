//! `board_list` — the bounded, indexed read window the renderer consumes (D-03).

use serde::Serialize;
use tauri::State;

use crate::state::AppState;

/// The Rust core returns a page, never the whole board (D-03). 200 rows comfortably covers a
/// full viewport of virtualized rows with room to scroll before the next window is requested.
const DEFAULT_LIMIT: i64 = 200;

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct BoardItemDto {
    pub id: String,
    pub kind: String,
    pub key: String,
    pub title: String,
    pub status: String,
    pub rank: String,
    pub priority: i64,
    pub epic_id: Option<String>,
}

impl From<flywheel_core::query::BoardItem> for BoardItemDto {
    fn from(item: flywheel_core::query::BoardItem) -> Self {
        Self {
            id: item.id,
            kind: item.kind,
            key: item.key,
            title: item.title,
            status: item.status,
            rank: item.rank,
            priority: item.priority,
            epic_id: item.epic_id,
        }
    }
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct IssueItemDto {
    pub id: String,
    pub key: String,
    pub title: String,
    pub kind: String,
    pub epic_id: Option<String>,
    pub task_id: Option<String>,
}

impl From<flywheel_core::query::IssueItem> for IssueItemDto {
    fn from(item: flywheel_core::query::IssueItem) -> Self {
        Self {
            id: item.id,
            key: item.key,
            title: item.title,
            kind: item.kind,
            epic_id: item.epic_id,
            task_id: item.task_id,
        }
    }
}

#[derive(Debug, Clone, Default, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct BandCountsDto {
    pub backlog: i64,
    pub todo: i64,
    pub in_progress: i64,
    pub in_review: i64,
    pub done: i64,
}

impl From<flywheel_core::query::BandCounts> for BandCountsDto {
    fn from(counts: flywheel_core::query::BandCounts) -> Self {
        Self {
            backlog: counts.backlog,
            todo: counts.todo,
            in_progress: counts.in_progress,
            in_review: counts.in_review,
            done: counts.done,
        }
    }
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct BoardWindowDto {
    pub items: Vec<BoardItemDto>,
    pub issues: Vec<IssueItemDto>,
    pub counts: BandCountsDto,
}

/// Return the first bounded window of `project_id`'s board: epics and tasks banded by status,
/// plus the full issues lane (D-07). Cursor-based pagination beyond the first window lands with
/// the scroll-to-load-more UI in a later plan; this tracer proves the bounded-read path itself
/// (D-03).
#[tauri::command]
pub fn board_list(state: State<AppState>, project_id: String) -> Result<BoardWindowDto, String> {
    let conn = state.db.lock().map_err(|e| e.to_string())?;
    let window = flywheel_core::query::list_board(&conn, &project_id, DEFAULT_LIMIT, None)
        .map_err(|e| e.to_string())?;

    Ok(BoardWindowDto {
        items: window.items.into_iter().map(BoardItemDto::from).collect(),
        issues: window.issues.into_iter().map(IssueItemDto::from).collect(),
        counts: window.counts.into(),
    })
}
