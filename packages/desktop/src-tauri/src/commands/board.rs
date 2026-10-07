//! `board_list`/`board_search` — the bounded, indexed read window the renderer consumes (D-03,
//! BOARD-06). Both commands share the same DTO shapes so the renderer's `useBoardQuery.ts` hook
//! sends the identical filter/cursor payload to either, and both cap the requested window before
//! calling the core (T-01-24: no single call can be made to return the whole board).

use serde::{Deserialize, Serialize};
use tauri::State;

use crate::commands::ipc_error;
use crate::state::AppState;

/// The Rust core returns a page, never the whole board (D-03). 200 rows comfortably covers a
/// full viewport of virtualized rows with room to scroll before the next window is requested.
const DEFAULT_LIMIT: i64 = 200;

/// The command layer's own cap on the requested limit — independent of, and tighter than, any
/// cap the core itself might apply. A renderer bug or a malicious IPC caller asking for a window
/// of 10,000,000 rows still gets clamped here before `list_board`/`search_items` ever runs
/// (T-01-24).
const MAX_LIMIT: i64 = 500;

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
    pub estimate: Option<i64>,
    pub assignee_id: Option<String>,
    pub criteria_checked: i64,
    pub criteria_total: i64,
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
            estimate: item.estimate,
            assignee_id: item.assignee_id,
            criteria_checked: item.criteria_checked,
            criteria_total: item.criteria_total,
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

impl From<flywheel_core::query::BoardWindow> for BoardWindowDto {
    fn from(window: flywheel_core::query::BoardWindow) -> Self {
        Self {
            items: window.items.into_iter().map(BoardItemDto::from).collect(),
            issues: window.issues.into_iter().map(IssueItemDto::from).collect(),
            counts: window.counts.into(),
        }
    }
}

/// The typed filter set (BOARD-06), as it crosses the Tauri IPC boundary. Every field is a
/// renderer-supplied *value*, never a string that becomes SQL — `Into<BoardFilter>` below is the
/// only place that value is interpreted, and it can only ever produce one of `BoardFilter`'s own
/// fixed variants (T-01-23: no renderer-supplied string ever becomes a column name, an operator
/// or an `ORDER BY` clause).
///
/// `epic_ids`/`assignee_ids` carry `Option<String>` entries rather than a separate "include the
/// null bucket" boolean flag: `None` inside the list means "No epic"/"Unassigned", `Some(id)`
/// means that specific epic/assignee — one list expresses the whole selection the filter chips
/// in `FilterBar.tsx` render.
#[derive(Debug, Clone, Default, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct BoardFilterInput {
    pub statuses: Option<Vec<String>>,
    pub epic_ids: Option<Vec<Option<String>>>,
    pub assignee_ids: Option<Vec<Option<String>>>,
    pub priorities: Option<Vec<i64>>,
    pub estimates: Option<Vec<i64>>,
}

impl From<BoardFilterInput> for flywheel_core::query::filter::BoardFilter {
    fn from(input: BoardFilterInput) -> Self {
        use flywheel_core::query::filter::{AssigneeSelector, EpicSelector};
        Self {
            statuses: input.statuses,
            epics: input.epic_ids.map(|ids| {
                ids.into_iter()
                    .map(|id| match id {
                        Some(id) => EpicSelector::Epic(id),
                        None => EpicSelector::NoEpic,
                    })
                    .collect()
            }),
            assignees: input.assignee_ids.map(|ids| {
                ids.into_iter()
                    .map(|id| match id {
                        Some(id) => AssigneeSelector::Assignee(id),
                        None => AssigneeSelector::Unassigned,
                    })
                    .collect()
            }),
            priorities: input.priorities,
            estimates: input.estimates,
        }
    }
}

/// The opaque resume point `useBoardQuery.ts` echoes back unchanged from the last row of the
/// prior window it received — the renderer never constructs one from scratch, only forwards it
/// (mirrors `core::query::BoardCursor`'s own doc comment).
#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct BoardCursorInput {
    pub status_sort_key: i64,
    pub priority_sort_key: i64,
    pub rank: String,
    pub id: String,
}

impl From<BoardCursorInput> for flywheel_core::query::BoardCursor {
    fn from(cursor: BoardCursorInput) -> Self {
        Self {
            status_sort_key: cursor.status_sort_key,
            priority_sort_key: cursor.priority_sort_key,
            rank: cursor.rank,
            id: cursor.id,
        }
    }
}

fn resolve_limit(limit: Option<i64>) -> i64 {
    limit.unwrap_or(DEFAULT_LIMIT).clamp(1, MAX_LIMIT)
}

/// Return a bounded window of `project_id`'s board: epics and tasks banded by status, plus the
/// matching issues lane (D-07). `filter`/`limit`/`cursor` are all optional so existing callers
/// built before plan 01-08 (a bare `{ projectId }` call) keep working unchanged — an absent
/// `filter` is `BoardFilter::default()`, the unfiltered board.
#[tauri::command]
pub fn board_list(
    state: State<AppState>,
    project_id: String,
    filter: Option<BoardFilterInput>,
    limit: Option<i64>,
    cursor: Option<BoardCursorInput>,
) -> Result<BoardWindowDto, String> {
    let conn = state.db.lock().map_err(|e| e.to_string())?;
    let filter: flywheel_core::query::filter::BoardFilter =
        filter.map(Into::into).unwrap_or_default();
    let limit = resolve_limit(limit);
    let cursor: Option<flywheel_core::query::BoardCursor> = cursor.map(Into::into);

    let window =
        flywheel_core::query::list_board(&conn, &project_id, &filter, limit, cursor.as_ref())
            .map_err(|e| e.to_string())?;

    Ok(window.into())
}

/// Free-text search across titles, bodies and the human-readable key (BOARD-06, D-10), narrowed
/// by the same filter set `board_list` accepts and returned in the same order. An empty/
/// whitespace-only `term` is "no text constraint" — the caller is expected to call `board_list`
/// directly in that case, but `search_items` itself already degrades to the plain board window if
/// it is called with one anyway (defence in depth, never a second board-window implementation
/// here).
#[tauri::command]
pub fn board_search(
    state: State<AppState>,
    project_id: String,
    term: String,
    filter: Option<BoardFilterInput>,
    limit: Option<i64>,
    cursor: Option<BoardCursorInput>,
) -> Result<BoardWindowDto, String> {
    let conn = state.db.lock().map_err(|e| e.to_string())?;
    let filter: flywheel_core::query::filter::BoardFilter =
        filter.map(Into::into).unwrap_or_default();
    let limit = resolve_limit(limit);
    let cursor: Option<flywheel_core::query::BoardCursor> = cursor.map(Into::into);

    let window = flywheel_core::query::search::search_items(
        &conn,
        &project_id,
        &term,
        &filter,
        limit,
        cursor.as_ref(),
    )
    .map_err(|e| e.to_string())?;

    Ok(window.into())
}

/// One status's task count inside an epic's distribution strip (D-05).
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct StatusCountDto {
    pub status: String,
    pub count: u32,
}

/// An epic's criteria position (D-06): `checked` of `total` current criteria across its tasks.
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct CriteriaCountDto {
    pub checked: u32,
    pub total: u32,
}

/// One epic's roll-up for the roster (D-05/D-06) — mirrors
/// `flywheel_core::query::epic_progress::EpicProgress`. `epic_id: null` is the "No epic" bucket.
/// `criteria` is nullable and never defaulted to zero: an epic with no criteria must reach the
/// renderer as absent so it can print a true statement instead of a lying zero.
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct EpicProgressDto {
    pub epic_id: Option<String>,
    pub by_status: Vec<StatusCountDto>,
    pub total: u32,
    pub done: u32,
    pub agents_running: u32,
    pub agents_blocked: u32,
    pub criteria: Option<CriteriaCountDto>,
}

impl From<flywheel_core::query::epic_progress::EpicProgress> for EpicProgressDto {
    fn from(p: flywheel_core::query::epic_progress::EpicProgress) -> Self {
        Self {
            epic_id: p.epic_id,
            by_status: p
                .by_status
                .into_iter()
                .map(|(status, count)| StatusCountDto { status, count })
                .collect(),
            total: p.total,
            done: p.done,
            agents_running: p.agents_running,
            agents_blocked: p.agents_blocked,
            criteria: p.criteria.map(|(checked, total)| CriteriaCountDto { checked, total }),
        }
    }
}

/// Every epic that has tasks, plus the no-epic bucket, with its real status distribution, agent
/// counts and criteria position — one grouped read over ALL the project's tasks, never the
/// board's 200-row window (D-05, RESEARCH Correction 3). Database-only, so unlike
/// `board_change_flags` there is no git half to keep off the mutex; the project id is the only
/// input, and the epic cap lives in the core.
#[tauri::command]
pub fn board_epic_progress(
    state: State<AppState>,
    project_id: String,
) -> Result<Vec<EpicProgressDto>, String> {
    let conn = state.db.lock().map_err(|e| ipc_error("board_epic_progress:lock", e))?;
    let progress = flywheel_core::query::epic_progress::board_epic_progress(
        &conn,
        &project_id,
        flywheel_core::domain::epic::EPIC_ROSTER_CEILING as usize,
    )
    .map_err(|e| ipc_error("board_epic_progress:read", e))?;
    Ok(progress.into_iter().map(EpicProgressDto::from).collect())
}
